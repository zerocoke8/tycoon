// 화면 없이 시뮬레이션을 돌려 경제 수치를 본다 (밸런스 확인용). Node 24로 바로 돈다:
//   node scripts/sim-check.ts                 새 게임(시드 1)을 30분 돌리며 1분마다 수치
//   node scripts/sim-check.ts --auto          욕심쟁이 촌장(살 수 있으면 산다)으로 회관 2·3·4와 부스 해금 시각
//   node scripts/sim-check.ts --selftest      저장·불러오기 왕복, 결과 세부, 행동, catchUp 시험
//   node scripts/sim-check.ts --auto --seeds 8   여러 시드의 이정표(처음 산 때) 표
//   --minutes N, --seed N, --verbose (토스트 찍기), --detail (--seeds와 같이: 다음 회관 비용 항목마다 처음 모인 때),
//   --first N (--seeds와 같이: 시드 N부터, 여러 프로세스로 나눠 돌릴 때)
// 모든 모드에서 매 틱 불변식을 검사한다 (NaN, 음수 코인, 멈춘 손님, 자리·줄 어긋남). 어긋나면 바로 멈춘다.

import { Rng } from '../src/core/rng.ts';
import { ACCESSORIES, ACCESSORY_SPAWN, BANK, LABOR, PAWN, VAULT, type AccessoryId, BOOTHS, BOOTH_IDS, boothDef, BUILDINGS, DEBT_MATCH, DIG, GOODS, GROUP_BOOTHS, GROUP_RULES, HOST_PRESETS, isGroupBooth, KITE, MOOD, ODDS, RACE, RECIPES, SIM, SPECIES_IDS, SSIREUM, TUG, WHEEL, type BoothId, type BuildingId, type GoodId, type GroupBoothId, type MaterialId, type OutcomeTier, type SpeciesId, type TraitId } from '../src/data/defs.ts';
import { devOpenAll } from '../src/sim/dev.ts';
import { decideOutcome } from '../src/sim/games.ts';
import { boothStat, minPlayCost } from '../src/sim/booths.ts';
import { digNear, groupGame, raceOf, sideSign, trackAt, tugLineup } from '../src/sim/group/index.ts';
import { COMEBACK_KEY_INDEX, generateRace, raceGatherSec, raceOutcome, racePlace, raceProgress, RACERS, raceStandings, raceTier } from '../src/sim/race.ts';
import { cheerKey, DEBT_REACT_KINDS, debtReactionLabels, detailKeys, groupReactionLabels, moodDelta, pickReaction, reactionKeys, reactionLabels } from '../src/sim/reactions.ts';
import { normalizeState } from '../src/sim/save.ts';
import { bankLoan, bankOpenFor, canLend, laborRate, loanDebt, pairDebtors, pawnPrice, redeemCost, rollAccessories, wantMore, workSlots } from '../src/sim/debt.ts';
import { createMonster } from '../src/sim/monsters.ts';
import { presetPost } from '../src/sim/staff.ts';
import { BOOTH_SPOTS, DISTRICTS, NODES, type DistrictId, type NodeId } from '../src/data/map.ts';
import { crossesBooth, distancesFrom } from '../src/sim/path.ts';
import { clearSave, loadGame, newGame, saveGame, Sim } from '../src/sim/sim.ts';
import { TUNE } from '../src/sim/tuning.ts';
import type { GameState, GroupEntry, GroupEvent, GroupKey, GroupPlay, GroupState, Monster, MonsterId, MonsterPhase, RacerIndex, RoundOutcome, SimEvents } from '../src/sim/types.ts';

declare const process: { argv: string[]; exitCode?: number };

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
const num = (name: string, def: number): number => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(v) ? v : def;
};
const verbose = flag('verbose');

// ── 불변식 ────────────────────────────────────────────────────────────

/** 길 그래프에서 가장 먼 두 노드 사이를 가장 느린 손님이 걷는 초 (모든 구역이 열렸을 때). 지도가 커지면 같이 늘어난다. */
const WALK_MAX_SEC = (() => {
  const all = Object.keys(DISTRICTS) as DistrictId[];
  let far = 0;
  for (const id of Object.keys(NODES) as NodeId[]) for (const v of distancesFrom(id, all).values()) far = Math.max(far, v);
  return far / Math.min(SIM.walkSpeed, SIM.floatSpeed);
})();
/** 이 phase 말고는 한 phase에 STUCK_SEC 넘게 머물면 멈춘 것 (가장 먼 길을 걷는 시간보다 넉넉히). */
const LONG_OK: ReadonlySet<MonsterPhase> = new Set(['queued', 'resting', 'working', 'waitWork']);
const STUCK_SEC = Math.max(120, WALK_MAX_SEC * 1.25 + 20);
/** 온 때부터 머무는 최대 시간 + 줄에서 기다리는 시간 + 입구까지 걷는 시간. 이보다 오래 있으면 떠나지 못한 것. */
// 넷째 묶음: 떠나기 전 볼일(갚기·되찾기)로 가게 둘을 들를 수 있다 (걷기 둘 + 계산대 + 반응). 파산했던 손님은 빚을 다 갚을 때까지 머문다 (따로 잰다).
const MAX_AGE = TUNE.maxStaySec + TUNE.queueGiveUpSec + WALK_MAX_SEC * 3 + 90;
/** 파산·일터에서 머물 수 있는 phase. */
const DEBT_PHASES: ReadonlySet<MonsterPhase> = new Set(['reacting', 'toWork', 'working', 'waitWork', 'toSeat', 'playing']);
/**
 * 파산한 손님이 일터에 머물 수 있는 가장 긴 초: 반장이 남은 빚을 덜어 주는 때 (LABOR.forgiveSec, 일터에서 일하거나 기다릴 때 본다)
 * + 그때 빚 걸기 판에 불려 가 있었다면 판 (모이기 maxWaitSec + 판 + 반응) + 오가는 걸음 (느린 걸음).
 */
const BANKRUPT_MAX = LABOR.forgiveSec + DEBT_MATCH.maxWaitSec + 60 + (WALK_MAX_SEC * 2) / LABOR.walkMult + 30;
/** 빚이 이보다 커지지 않는다: 은행 대출 하나 (가장 높은 은행 레벨) 또는 빚 걸기 판의 maxDebt. */
const DEBT_CAP = Math.max(DEBT_MATCH.maxDebt, loanDebt(BANK.base + (BUILDINGS.bank.levels.length) * BANK.perLevel));

function fail(msg: string, st: GameState): never {
  console.error(`\n불변식 어긋남 (t=${st.time.toFixed(1)}s): ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function finite(v: number, what: string, st: GameState): void {
  if (!Number.isFinite(v)) fail(`${what}가 수가 아님 (${v})`, st);
}

function checkInvariants(sim: Sim): void {
  const st = sim.state;
  finite(st.coins, 'coins', st);
  if (st.coins < 0) fail(`코인이 음수 (${st.coins})`, st);
  const cap = sim.materialCap();
  for (const [k, v] of Object.entries(st.materials)) {
    finite(v, k, st);
    if (v < 0 || v > cap) fail(`재료 ${k} = ${v} (한도 ${cap})`, st);
  }
  for (const [k, v] of Object.entries(st.precious)) if (!(v >= 0)) fail(`귀한 물건 ${k} = ${v}`, st);
  for (const [k, v] of Object.entries(st.goods)) if (!(v >= 0)) fail(`가공품 ${k} = ${v}`, st);
  const ids = new Set<number>();
  for (const m of st.monsters) {
    if (ids.has(m.id)) fail(`손님 id 겹침 ${m.id}`, st);
    ids.add(m.id);
    finite(m.wallet, `손님 ${m.id} 지갑`, st);
    finite(m.mood, `손님 ${m.id} 기분`, st);
    finite(m.pos.x, `손님 ${m.id} x`, st);
    finite(m.pos.y, `손님 ${m.id} y`, st);
    if (m.wallet < 0) fail(`손님 ${m.id} 지갑이 음수 (${m.wallet})`, st);
    if (m.mood < 0 || m.mood > 100) fail(`손님 ${m.id} 기분 범위 밖 (${m.mood})`, st);
    const pt = m.phaseTime ?? 0;
    if (!LONG_OK.has(m.phase) && pt > STUCK_SEC) {
      const g = m.booth !== null ? st.booths[m.booth].group : null;
      const gs = g === null ? '' : `, 판 ${g.phase} ${g.elapsed.toFixed(1)}초 남은 ${g.countdown.toFixed(1)} 참가 [${g.participants.map((e) => `${e.monster}@${e.seat}:${e.pick}`).join(' ')}] 자리 [${st.booths[m.booth!].seats.join(' ')}]`;
      fail(`손님 ${m.id}가 ${m.phase}에 ${pt.toFixed(0)}초 멈춤 (path ${m.path.length}, booth ${m.booth}, seat ${m.seat}${gs})`, st);
    }
    const age = st.time - (m.born ?? st.time);
    if (age > MAX_AGE && m.wasBankrupt !== true) fail(`손님 ${m.id}가 ${age.toFixed(0)}초째 떠나지 않음 (phase ${m.phase})`, st);
    // 넷째 묶음: 빚·장신구·일
    finite(m.debt, `손님 ${m.id} 빚`, st);
    if (m.debt < 0) fail(`손님 ${m.id} 빚이 음수 (${m.debt})`, st);
    if (m.debt > DEBT_CAP) fail(`손님 ${m.id} 빚 ${m.debt} > ${DEBT_CAP}`, st);
    // 몸에 단 것과 맡긴 것을 합쳐도 자리마다 하나 (맡기면 빠지고 되찾으면 다시).
    if (new Set([...m.accessories, ...m.pawned].map((a) => a.slot)).size !== m.accessories.length + m.pawned.length) fail(`손님 ${m.id} 장신구 자리가 겹침`, st);
    if (m.declined !== undefined && m.declined !== null && m.declined !== 'low' && m.declined !== 'broke') fail(`손님 ${m.id} declined ${String(m.declined)}`, st);
    if (m.loans !== undefined && m.loans > BANK.maxLoans) fail(`손님 ${m.id} 대출 ${m.loans}번`, st);
    for (const t of m.pawned) if (!(t.price > 0)) fail(`손님 ${m.id} 맡긴 장신구 값 ${t.price}`, st);
    if (m.bankrupt === true) {
      if (!m.labor) fail(`파산한 손님 ${m.id}의 일이 없음`, st);
      if (!DEBT_PHASES.has(m.phase)) fail(`파산한 손님 ${m.id}가 ${m.phase}`, st);
      if (m.pawned.length > 0) fail(`파산한 손님 ${m.id}에게 맡긴 장신구가 남음`, st);
      const since = m.labor?.since;
      if (since !== undefined && st.time - since > BANKRUPT_MAX) fail(`파산한 손님 ${m.id}가 ${(st.time - since).toFixed(0)}초째 풀려나지 않음 (${m.phase}, 빚 ${m.debt})`, st);
    } else if (m.labor) fail(`파산하지 않은 손님 ${m.id}에게 일이 남음`, st);
    if ((m.phase === 'toPawnshop' || m.phase === 'atPawnshop' || m.phase === 'toBank' || m.phase === 'atBank') && !m.errand) fail(`손님 ${m.id}가 볼일 없이 ${m.phase}`, st);
    const group = m.booth !== null ? st.booths[m.booth].group : null;
    if (m.phase === 'playing' && group !== null) {
      // 단체 놀이: 모이는 중이면 참가자, 진행 중이면 참가자(한판 있음)나 다음 판을 기다리는 손님, 결과 중이면 기다리는 손님.
      const entry = group.participants.find((e) => e.monster === m.id);
      if (group.phase === 'idle' && group.debtNext !== true) fail(`손님 ${m.id}가 쉬는 ${m.booth}에서 playing`, st);
      if (group.phase === 'gathering' && entry === undefined) fail(`손님 ${m.id}가 모이는 ${m.booth}에 참가하지 않고 앉아 있음`, st);
      if (group.phase === 'running' && entry !== undefined) {
        const r = st.booths[m.booth!].rounds[entry.seat];
        if (!r || r.monster !== m.id) fail(`손님 ${m.id}가 ${m.booth} 참가자인데 한판이 없음`, st);
      }
      // 결과 중: 이번 판 참가자의 한판은 끝나 있어야 한다 (반응을 마치고 다시 앉아 다음 판을 기다리는 것은 괜찮다).
      if (group.phase === 'done' && entry !== undefined && st.booths[m.booth!].rounds[entry.seat]?.monster === m.id) fail(`손님 ${m.id}가 ${m.booth} 판이 끝났는데 한판이 남음`, st);
    } else if (m.phase === 'playing') {
      const r = m.booth !== null && m.seat !== null ? st.booths[m.booth].rounds[m.seat] : null;
      if (!r || r.monster !== m.id) fail(`손님 ${m.id}가 playing인데 한판이 없음`, st);
    }
    if (m.seat !== null && m.phase !== 'toSeat' && m.phase !== 'playing' && m.phase !== 'reacting') fail(`손님 ${m.id}가 자리(${m.booth}.${m.seat})에 있는데 ${m.phase}`, st);
    if ((m.phase === 'toBooth' || m.phase === 'queued') && (m.booth === null || !st.booths[m.booth].queue.includes(m.id))) fail(`손님 ${m.id} ${m.phase}인데 줄에 없음`, st);
    if ((m.phase === 'toSeat' || m.phase === 'playing') && (m.booth === null || m.seat === null || st.booths[m.booth].seats[m.seat] !== m.id)) fail(`손님 ${m.id} ${m.phase}인데 자리가 없음`, st);
  }
  for (const b of BOOTH_IDS) {
    const bs = st.booths[b];
    finite(bs.pot, `${b} 항아리`, st);
    if (bs.pot < 0) fail(`${b} 항아리가 음수`, st);
    if (bs.seats.length !== bs.rounds.length) fail(`${b} 자리·한판 배열 길이가 다름`, st);
    bs.seats.forEach((id, i) => {
      if (id === null) return;
      const m = sim.monster(id);
      if (!m || m.booth !== b || m.seat !== i) fail(`${b} 자리 ${i}의 손님 ${id}가 어긋남`, st);
    });
    for (const id of bs.queue) {
      const m = sim.monster(id);
      if (!m || m.booth !== b || m.seat !== null) fail(`${b} 줄의 손님 ${id}가 어긋남`, st);
    }
    if (new Set(bs.queue).size !== bs.queue.length) fail(`${b} 줄에 같은 손님이 둘`, st);
    // 진행자 자리: 길이 = 역할 수, 자리의 진행자와 진행자의 post가 서로 맞는다.
    if (bs.staff.length !== BOOTHS[b].roles.length) fail(`${b} 진행자 자리 수 ${bs.staff.length} ≠ 역할 ${BOOTHS[b].roles.length}`, st);
    bs.staff.forEach((id, role) => {
      if (id === null) return;
      const s = st.staff.find((x) => x.id === id);
      if (!s || s.post === null || s.post.booth !== b || s.post.role !== role) fail(`${b} 자리 ${role}의 진행자 ${id}가 어긋남`, st);
    });
    if (isGroupBooth(b) !== (bs.group !== null)) fail(`${b} group 칸이 어긋남`, st);
    const group = bs.group;
    if (group !== null && isGroupBooth(b)) {
      const rules = GROUP_RULES[b];
      finite(group.countdown, `${b} 단체 놀이 countdown`, st);
      finite(group.elapsed, `${b} 단체 놀이 elapsed`, st);
      if (group.phase === 'idle' && (group.participants.length > 0 || group.play !== null)) fail(`${b} 쉬는 판에 참가자·결과가 남음`, st);
      const debtMode = group.mode === 'debt';
      if (group.phase === 'gathering' && ((group.participants.length === 0 && !debtMode) || group.play !== null || group.countdown > rules.gatherSec * (1 + 2 * rules.gatherPacePerPoint) + 1e-6)) fail(`${b} 모이는 판이 어긋남`, st);
      if (group.phase === 'gathering' && group.elapsed > (debtMode ? DEBT_MATCH.maxWaitSec : rules.maxWaitSec) + rules.gatherSec + 1) fail(`${b} 모이는 판이 너무 오래 (${group.elapsed.toFixed(0)}초)`, st);
      if (debtMode && (group.phase === 'idle' || !(group.debtors?.length ?? 0))) fail(`${b} 빚 걸기 판이 어긋남 (${group.phase})`, st);
      if ((group.phase === 'running' || group.phase === 'done') && (group.play === null || group.play.outcomes.length !== group.participants.length || group.play.kind !== b)) fail(`${b} 진행 중인 판에 결과가 없거나 참가자와 어긋남`, st);
      if (group.phase === 'running' && group.elapsed > group.duration + 1e-6) fail(`${b} 판이 끝나지 않음`, st);
      if (new Set(group.participants.map((e) => e.seat)).size !== group.participants.length) fail(`${b} 참가자 자리가 겹침`, st);
      if (new Set(group.participants.map((e) => e.monster)).size !== group.participants.length) fail(`${b} 같은 손님이 둘`, st);
      if (group.participants.length > bs.seats.length) fail(`${b} 참가자가 자리보다 많음`, st);
      if (group.phase === 'gathering' || group.phase === 'running') {
        for (const e of group.participants) {
          const m = sim.monster(e.monster);
          if (group.phase === 'gathering' && (!m || m.booth !== b || m.seat !== e.seat || m.phase !== 'playing')) fail(`${b} 모이는 판 참가자 ${e.monster}가 자리에 없음`, st);
          if (!Number.isInteger(e.pick) || e.pick < 0 || e.pick >= groupGame(b).picks || !(e.bet >= 1 || (e.debt !== undefined && e.bet === 0))) fail(`${b} 참가 ${e.monster} 고른 것·건 코인 (${e.pick}, ${e.bet})`, st);
        }
      }
    }
  }
  for (const s of st.staff) {
    if (s.post === null) continue;
    if (st.booths[s.post.booth].staff[s.post.role] !== s.id) fail(`진행자 ${s.id}의 자리(${s.post.booth}.${s.post.role})가 어긋남`, st);
  }
  for (const m of st.monsters) if (!(m.mats >= 0)) fail(`손님 ${m.id} 재료 ${m.mats}`, st);
  // 일터: 일하는 자리는 한 사람씩.
  const spots = new Set<string>();
  for (const m of st.monsters) {
    const lab = m.labor;
    if (!lab || lab.spot < 0 || lab.match !== null) continue;
    const k = `${lab.facility}${lab.spot}`;
    if (spots.has(k)) fail(`일터 자리 ${k}에 둘`, st);
    spots.add(k);
  }
  for (const [k, v] of Object.entries(st.pawnCollection)) if (!(v !== undefined && v >= 1 && Number.isInteger(v))) fail(`전당포 컬렉션 ${k} = ${v}`, st);
}

// ── 공통: 이벤트 모으기 ─────────────────────────────────────────────────

interface Tally {
  left: number;
  moodSum: number;
  tips: number;
  festivals: number;
  broke: number;
  spectates: number;
}
const zeroTally = (): Tally => ({ left: 0, moodSum: 0, tips: 0, festivals: 0, broke: 0, spectates: 0 });

function listen(sim: Sim, minute: Tally, all: Tally, labels: Set<string>): void {
  sim.bus.on('monsterLeft', (e) => {
    const m = sim.monster(e.id);
    const mood = m?.mood ?? 0;
    for (const t of [minute, all]) {
      t.left++;
      t.moodSum += mood;
      t.tips += e.tip;
      if (m?.broke) t.broke++;
    }
  });
  sim.bus.on('potFestival', () => {
    minute.festivals++;
    all.festivals++;
  });
  sim.bus.on('monsterSpectate', () => {
    minute.spectates++;
    all.spectates++;
  });
  sim.bus.on('monsterReact', (e) => labels.add(e.reaction.label));
  sim.bus.on('coinsChanged', (e) => {
    if (!Number.isFinite(e.coins) || !Number.isFinite(e.delta)) throw new Error('coinsChanged에 수가 아닌 값');
  });
  if (verbose) sim.bus.on('toast', (e) => console.log(`   [${(sim.state.time / 60).toFixed(1)}분] ${e.kind}: ${e.text}`));
}

const pad = (v: string | number, n: number): string => String(v).padStart(n);
const sumMats = (st: GameState): number => Object.values(st.materials).reduce((a, b) => a + b, 0);

// ── 기본 모드: 1분마다 수치 ──────────────────────────────────────────────

function runReport(seed: number, minutes: number, chief: ((sim: Sim, log: (s: string) => void) => void) | null): void {
  const sim = new Sim(newGame(seed));
  const minute = zeroTally();
  const all = zeroTally();
  const labels = new Set<string>();
  listen(sim, minute, all, labels);
  const events: string[] = [];
  const log = (s: string) => events.push(`${(sim.state.time / 60).toFixed(1).padStart(5)}분  ${s}`);
  console.log(` 분  코인  손님  한판수  대박  떠남  떠난기분  팁   재료  축제  구경  회관  부스`);
  const ticksPerMin = Math.round(60 / SIM.dt);
  const ticksPerSec = Math.round(1 / SIM.dt);
  for (let min = 1; min <= minutes; min++) {
    Object.assign(minute, zeroTally());
    for (let t = 0; t < ticksPerMin; t++) {
      sim.tick(SIM.dt);
      checkInvariants(sim);
      if (chief !== null && t % ticksPerSec === 0) chief(sim, log);
    }
    const st = sim.state;
    const avg = minute.left > 0 ? (minute.moodSum / minute.left).toFixed(0) : '-';
    const open = BOOTH_IDS.filter((b) => st.booths[b].unlocked).map((b) => `${b}${st.booths[b].level}`).join(',');
    console.log(
      `${pad(min, 3)} ${pad(st.coins, 5)} ${pad(st.monsters.length, 5)} ${pad(st.totals.rounds, 7)} ${pad(st.totals.jackpots, 5)} ${pad(minute.left, 5)} ${pad(avg, 9)} ${pad(minute.tips, 4)} ${pad(sumMats(st), 6)} ${pad(all.festivals, 5)} ${pad(all.spectates, 5)} ${pad(st.buildings.hall.level, 5)}  ${open}`,
    );
  }
  const st = sim.state;
  console.log(`\n합계: 손님 ${st.totals.visitors}명, 한판 ${st.totals.rounds}, 대박 ${st.totals.jackpots}, 항아리 축제 ${all.festivals}, 마을 수입 ${st.totals.coinsEarned}`);
  console.log(`떠난 손님 ${all.left}명 (빈털터리 ${all.broke}), 평균 기분 ${(all.moodSum / Math.max(1, all.left)).toFixed(1)}, 팁 합 ${all.tips}`);
  console.log(`재료 ${JSON.stringify(st.materials)}`);
  console.log(`귀한 물건 ${JSON.stringify(st.precious)}, 가공품 ${JSON.stringify(st.goods)}`);
  console.log(`항아리 ${BOOTH_IDS.map((b) => `${b}:${st.booths[b].pot}`).join(' ')}`);
  console.log(`넷째 묶음 ${debtLine(st)}`);
  console.log(`본 반응 ${labels.size}가지: ${[...labels].join(', ')}`);
  if (events.length > 0) {
    console.log('\n촌장의 기록:');
    for (const e of events) console.log(e);
  }
}

// ── --auto: 욕심쟁이 촌장 ─────────────────────────────────────────────

type Chief = (sim: Sim, log: (s: string) => void) => void;

/** 열린 부스의 빈 진행자 자리. */
function emptySlots(sim: Sim): { booth: BoothId; role: number; optional: boolean }[] {
  const st = sim.state;
  const out: { booth: BoothId; role: number; optional: boolean }[] = [];
  for (const b of BOOTH_IDS) {
    if (!st.booths[b].unlocked) continue;
    boothDef(b).roles.forEach((r, role) => {
      if ((st.booths[b].staff[role] ?? null) === null) out.push({ booth: b, role, optional: r.optional === true });
    });
  }
  return out;
}

/** 욕심쟁이 촌장. milestones에 처음 산 때(초)를 남긴다 (key: hall2, unlock-cups, first …). */
function makeGreedyChief(seed: number, milestones: Map<string, number> = new Map()): Chief {
  const rng = new Rng(seed * 7919 + 13);
  let simRef: Sim | null = null;
  const once = (key: string, log: (s: string) => void, text: string) => {
    if (milestones.has(key)) return;
    const t = simRef?.state.time ?? 0;
    milestones.set(key, t);
    if (!milestones.has('first') && !key.startsWith('hire')) milestones.set('first', t);
    log(text);
  };
  return (sim, log) => {
    simRef = sim;
    const st = sim.state;
    const hallNext = sim.buildingUpgradeCost('hall');

    // 진행자 배치: 쉬는 진행자를 빈 자리로 (꼭 있어야 하는 자리 먼저).
    for (const s of st.staff) {
      if (s.post !== null) continue;
      const slot = emptySlots(sim).sort((a, c) => Number(a.optional) - Number(c.optional))[0];
      if (slot !== undefined && sim.assign(s.id, slot.booth, slot.role).ok) log(`${s.name} → ${slot.booth}.${slot.role} 배치`);
    }

    // 간식: 슬픈 손님, 빈털터리로 떠나는 손님.
    const snack = (['snack_ricecake', 'snack_cookie'] as GoodId[]).find((g) => st.goods[g] > 0);
    if (snack !== undefined) {
      // 일터의 채무자는 늘 축 처져 있다 (기분이 낮다): 간식은 가끔만 (일이 1.5배 빨라진다).
      const sad = st.monsters.find((m) => !m.snacked && m.bankrupt !== true && (m.mood < 35 || (m.phase === 'leaving' && m.broke)));
      const worker = rng.chance(0.02) ? st.monsters.find((m) => !m.snacked && m.phase === 'working') : undefined;
      const to = sad ?? worker;
      if (to !== undefined && sim.giveSnack(to.id, snack).ok) log(`간식(${GOODS[snack].name}) → 손님 ${to.id} (기분 ${to.mood.toFixed(0)}, ${to.phase})`);
    }

    // 응원 톡: 3초에 한 번쯤, 기분이 낮은 손님부터 (채무자는 따로 30초에 한 번쯤: 늘 기분이 낮아 응원을 다 가져가지 않게).
    if (rng.chance(0.33) && st.monsters.length > 0) {
      const pick = [...st.monsters].filter((m) => m.cheerCooldown <= 0 && m.phase !== 'leaving' && m.bankrupt !== true).sort((a, b) => a.mood - b.mood)[0];
      if (pick !== undefined) sim.cheer(pick.id);
    }
    if (rng.chance(0.03)) {
      const w = st.monsters.find((m) => m.phase === 'working' && m.cheerCooldown <= 0);
      if (w !== undefined) sim.cheer(w.id);
    }

    // 응원 도구: 가장 바쁜 열린 부스에.
    for (const g of ['cheer_flag', 'lucky_charm'] as GoodId[]) {
      if (st.goods[g] <= 0) continue;
      const b = BOOTH_IDS.filter((x) => sim.boothOpen(x) && st.booths[x].cheer === null).sort((a, c) => st.booths[c].queue.length - st.booths[a].queue.length)[0];
      if (b !== undefined && sim.placeCheer(b, g).ok) log(`응원 도구 ${GOODS[g].name} → ${b}`);
    }

    // 사기 (위에서부터 살 수 있는 것 하나).
    const buy = (key: string, label: string, fn: () => { ok: boolean }): boolean => {
      if (!fn().ok) return false;
      log(label);
      once(key, log, `★ ${label} (처음)`);
      return true;
    };
    if (buy(`hall${st.buildings.hall.level + 1}`, `회관 → ${st.buildings.hall.level + 1}`, () => sim.upgradeBuilding('hall'))) return;
    // --debt-build: 전당포·일터·은행을 지을 수 있게 되면 바로 짓는다 (넷째 묶음 흐름이 돈에 미치는 영향 보기).
    if (flag('debt-build')) {
      for (const id of ['pawnshop', 'workyard', 'bank'] as BuildingId[]) {
        if (st.buildings[id].level < 1 && sim.buildingLockReason(id) === null && buy(`build-${id}`, `짓기 ${id}`, () => sim.upgradeBuilding(id))) return;
      }
    }
    // 이미 열 수 있는 단체 놀이(회관 1 밀어내기, 회관 2 오리배 …)와, 회관 2부터 막 열린 구역의 부스(회관 2 오리 낚시·고리 던지기,
    // 회관 3 경주장·연날리기, 회관 4 인형 뽑기·복주머니, 회관 5 줄다리기·보물찾기)는 다음 회관보다 먼저 연다 (귀한 물건이 있으면 코인을 모은다).
    let saving = false;
    const lv = st.buildings.hall.level;
    {
      for (const b of BOOTH_IDS) {
        const h = boothDef(b).unlock.hall;
        if (st.booths[b].unlocked || !((lv >= 2 && h === lv) || (isGroupBooth(b) && h <= lv))) continue;
        if (buy(`unlock-${b}`, `부스 해금 ${b}`, () => sim.unlockBooth(b))) return;
        const c = sim.boothUnlockCost(b);
        if (c !== null && sim.canAfford({ ...c, coins: 0 })) saving = true;
      }
    }
    // 다음 회관이 코인만 모자라면 코인을 모은다 (해금·업그레이드는 미룬다).
    if (hallNext !== null && sim.canAfford({ ...hallNext, coins: 0 })) {
      const key = `ready-hall${st.buildings.hall.level + 1}`;
      if (!milestones.has(key)) milestones.set(key, st.time);
      saving ||= st.coins < hallNext.coins;
    }
    if (!saving) {
      for (const b of BOOTH_IDS) {
        // 아직 닫힌 구역의 부스는 넘어간다 (회관 레벨이 모자람).
        if (st.booths[b].unlocked || sim.boothLockReason(b) !== null) continue;
        if (buy(`unlock-${b}`, `부스 해금 ${b}`, () => sim.unlockBooth(b))) return;
        // 귀한 물건(재료)이 있으면 해금 코인을 모은다.
        const c = sim.boothUnlockCost(b);
        if (c !== null && sim.canAfford({ ...c, coins: 0 })) saving = true;
      }
    }
    if (BOOTH_IDS.some((b) => st.booths[b].unlocked && !sim.boothOpen(b))) {
      const i = st.candidates.findIndex((c) => c.cost <= st.coins);
      if (i >= 0) {
        const name = st.candidates[i]?.name ?? '';
        if (buy(`hire-${name}`, `고용 ${name}`, () => sim.hire(i))) return;
      }
    }

    // 가공: 다음 회관에 쓸 재료는 남겨 둔다.
    const reserve: Partial<Record<MaterialId, number>> = { ...(hallNext?.mats ?? {}) };
    // 지금 열 수 있는 부스의 해금 재료도 남겨 둔다 (돌림판의 캐러멜 등).
    for (const b of BOOTH_IDS) {
      if (st.booths[b].unlocked || sim.boothLockReason(b) !== null) continue;
      for (const [k, n] of Object.entries(sim.boothUnlockCost(b)?.mats ?? {}) as [MaterialId, number][]) reserve[k] = Math.max(reserve[k] ?? 0, n);
    }
    if (st.crafting.length < sim.craftSlots()) {
      const snacks = st.goods.snack_cookie + st.goods.snack_ricecake;
      const order = sim
        .availableRecipes()
        .filter((r) => r.affordable)
        .map((r) => ({ ...r, def: RECIPES[r.index]! }))
        .filter(({ def }) => (Object.entries(def.mats) as [MaterialId, number][]).every(([k, n]) => st.materials[k] - n >= (reserve[k] ?? 0)))
        .filter(({ def }) => (GOODS[def.out].kind === 'snack' ? snacks < 3 : st.goods[def.out] < 1))
        .filter(({ def }) => st.coins - def.coins >= 20 && (!saving || GOODS[def.out].kind === 'snack'));
      const r = order[0];
      if (r !== undefined && sim.craft(r.index).ok) log(`가공 ${GOODS[r.def.out].name}`);
    }

    if (saving) return;
    const lines: [string, string, () => { ok: boolean }][] = [
      ['gate', '입구 업그레이드', () => sim.upgradeBuilding('gate')],
      // 넷째 묶음: 전당포 → 일터 → 은행 (은행은 일터가 있어야 빌려준다).
      // --no-debt: 넷째 묶음 건물을 짓지 않는다 (넷째 묶음이 회관 시각에 주는 영향 비교).
      ...(flag('no-debt')
        ? []
        : ([
            ['pawnshop', '전당포', () => sim.upgradeBuilding('pawnshop')],
            ['workyard', '일터', () => sim.upgradeBuilding('workyard')],
            ['bank', '은행', () => sim.upgradeBuilding('bank')],
          ] as [string, string, () => { ok: boolean }][])),
      ...BOOTH_IDS.map((b) => [`up-${b}`, `부스 업그레이드 ${b}`, () => sim.upgradeBooth(b)] as [string, string, () => { ok: boolean }]),
      ['workshop', '공방 업그레이드', () => sim.upgradeBuilding('workshop')],
      ['office', '사무소 업그레이드', () => sim.upgradeBuilding('office')],
      ['fountain', '분수 업그레이드', () => sim.upgradeBuilding('fountain')],
    ];
    if (Object.values(st.materials).some((v) => v >= sim.materialCap() - 2)) lines.unshift(['warehouse', '창고 업그레이드', () => sim.upgradeBuilding('warehouse')]);
    for (const [key, label, fn] of lines) {
      const lvKey = key in BUILDINGS ? `${key}${st.buildings[key as BuildingId].level + 1}` : `${key}${BOOTH_IDS.includes(key.slice(3) as BoothId) ? st.booths[key.slice(3) as BoothId].level + 1 : ''}`;
      if (buy(lvKey, label, fn)) return;
    }
    // 남는 코인으로 진행자 레벨업 (넉넉할 때만).
    for (const s of st.staff) {
      const c = sim.staffLevelUpCost(s.id);
      if (c !== null && st.coins - c.coins >= 150 && buy(`staff-${s.id}-${s.level + 1}`, `진행자 레벨업 ${s.name}`, () => sim.staffLevelUp(s.id))) return;
    }
  };
}

// ── --auto --seeds N: 여러 시드의 이정표 (분) ───────────────────────────

/** 넷째 묶음 누적 기록 한 줄. */
function debtLine(st: GameState): string {
  const d = st.debtTotals;
  const lv = `전당포${st.buildings.pawnshop.level}/은행${st.buildings.bank.level}/일터${st.buildings.workyard.level}`;
  const working = st.monsters.filter((m) => m.bankrupt === true).length;
  return `${lv} 맡김 ${d.pawned} 되찾음 ${d.redeemed} 컬렉션 ${d.forfeited} 대출 ${d.loans} 갚음 ${d.repaid} 파산 ${d.bankrupt} 다 갚음 ${d.relieved} (반장이 덜어 줌 ${d.forgiven}) 일하는 중 ${working} 빚 걸기 판 ${d.matches} 일터 재료 ${d.laborMats}`;
}

/**
 * 넷째 묶음 흐름 재기 (이벤트로): 파산마다 빚과 일한 시간 (파산 → 다 갚음), 일하는 채무자 수 (평균·가장 많이), 금고가 가장 적었을 때,
 * 맡긴 장신구 장부 (맡김 = 되찾음 + 컬렉션 + 아직 맡긴 것, 하나가 두 번 끝나지 않는다), 빚 걸기 판 정산.
 * from = 셈을 시작한 때 (일터를 지은 때, 없으면 처음).
 */
interface DebtTally {
  bankruptAt: Map<number, number>;
  stints: number[];
  debts: number[];
  workerSec: number;
  maxWorkers: number;
  /** 일터를 지은 뒤 지난 초 (평균 일하는 채무자 수의 분모). */
  yardSec: number;
  minCoins: number;
  /** 손님마다 맡긴 장신구 (key 목록): 되찾거나 컬렉션에 들어가면 하나씩 지운다. */
  tickets: Map<number, string[]>;
  ledgerErrors: string[];
  matchChanges: { before: number; after: number; tier: OutcomeTier }[];
  refusals: number;
  /** 금고: 빌려준 코인 (맡김·대출), 돌아온 코인 (되찾음·갚음·파산 때 낸 지갑). */
  lent: number;
  back: number;
  /** 일터를 지은 뒤 은행 대출 하나를 빌려줄 수 있던 초 (금고 = 마을 코인). */
  vaultOkSec: number;
  /** 파산한 손님이 phase마다 보낸 초 (일터로 걷기·일하기·기다리기·빚 걸기 판 …). */
  phaseSec: Map<string, number>;
  /** 일터를 지은 뒤 떠난 손님: 모두, 돈이 떨어진 적이 있음 (끈기가 남았을 때), 더 놀기 싫다고 함, 전당포·은행에 감. */
  funnel: { left: number; short: number; declined: number; sought: number };
  shortIds: Set<number>;
  declinedIds: Set<number>;
  soughtIds: Set<number>;
}

function tallyDebt(sim: Sim): DebtTally {
  const t: DebtTally = { bankruptAt: new Map(), stints: [], debts: [], workerSec: 0, maxWorkers: 0, yardSec: 0, minCoins: Infinity, tickets: new Map(), ledgerErrors: [], matchChanges: [], refusals: 0, lent: 0, back: 0, vaultOkSec: 0, phaseSec: new Map(), funnel: { left: 0, short: 0, declined: 0, sought: 0 }, shortIds: new Set(), declinedIds: new Set(), soughtIds: new Set() };
  // 빌려준 뒤에도 금고에 VAULT.reserve가 남는다 (빌려주기가 금고를 바닥내지 않는다).
  const vault = (what: string) => {
    if (sim.state.coins < VAULT.reserve) t.ledgerErrors.push(`${what} 뒤 금고 ${sim.state.coins} < ${VAULT.reserve}`);
  };
  sim.bus.on('pawned', (e) => {
    t.lent += e.price;
    vault('맡김');
  });
  sim.bus.on('loanTaken', (e) => {
    t.lent += e.amount;
    vault('대출');
  });
  sim.bus.on('redeemed', (e) => (t.back += e.cost));
  sim.bus.on('loanRepaid', (e) => (t.back += e.amount));
  sim.bus.on('bankrupt', (e) => {
    t.back += e.paid;
    t.bankruptAt.set(e.id, sim.state.time);
    t.debts.push(e.debt);
    // 파산하면 맡긴 장신구는 컬렉션으로 (pawnCollected가 그 앞뒤에 난다): 장부는 pawnCollected가 지운다.
  });
  sim.bus.on('debtCleared', (e) => {
    const at = t.bankruptAt.get(e.id);
    if (at !== undefined) t.stints.push(sim.state.time - at);
    t.bankruptAt.delete(e.id);
  });
  sim.bus.on('pawned', (e) => {
    const list = t.tickets.get(e.id) ?? [];
    list.push(e.key);
    t.tickets.set(e.id, list);
  });
  sim.bus.on('redeemed', (e) => {
    const list = t.tickets.get(e.id) ?? [];
    const i = list.indexOf(e.key);
    if (i < 0) t.ledgerErrors.push(`손님 ${e.id}가 맡기지 않은 ${e.key}를 되찾음`);
    else list.splice(i, 1);
  });
  sim.bus.on('pawnCollected', (e) => {
    if (e.from === undefined) return;
    const list = t.tickets.get(e.from) ?? [];
    const i = list.indexOf(e.key);
    if (i < 0) t.ledgerErrors.push(`손님 ${e.from}가 맡기지 않은 ${e.key}가 컬렉션에`);
    else list.splice(i, 1);
  });
  sim.bus.on('monsterLeft', (e) => {
    const m = sim.monster(e.id);
    const left = t.tickets.get(e.id) ?? [];
    if (left.length > 0 || (m !== undefined && m.pawned.length > 0)) t.ledgerErrors.push(`손님 ${e.id}가 맡긴 장신구 ${left.join(',')}를 남기고 떠남`);
    if (m !== undefined && (m.debt > 0 || m.bankrupt === true)) t.ledgerErrors.push(`손님 ${e.id}가 빚 ${m.debt}을 남기고 떠남`);
    t.tickets.delete(e.id);
    if (sim.state.buildings.workyard.level >= 1) {
      t.funnel.left++;
      if (t.shortIds.has(e.id)) t.funnel.short++;
      if (t.declinedIds.has(e.id)) t.funnel.declined++;
      if (t.soughtIds.has(e.id)) t.funnel.sought++;
    }
    t.shortIds.delete(e.id);
    t.declinedIds.delete(e.id);
    t.soughtIds.delete(e.id);
  });
  sim.bus.on('debtSettled', (e) => {
    for (const c of e.changes) t.matchChanges.push({ before: c.before, after: c.after, tier: c.tier });
  });
  sim.bus.on('vaultEmpty', () => t.refusals++);
  return t;
}

/** 매 틱 (dt초): 일하는 채무자 수와 금고. */
function sampleDebt(t: DebtTally, st: GameState, dt: number): void {
  if (st.buildings.workyard.level < 1) return;
  const n = st.monsters.filter((m) => m.bankrupt === true).length;
  t.workerSec += n * dt;
  t.yardSec += dt;
  t.maxWorkers = Math.max(t.maxWorkers, n);
  if (canLend(st, Math.max(1, bankLoan(st)))) t.vaultOkSec += dt;
  const min = minPlayCost(st);
  for (const m of st.monsters) {
    if (m.bankrupt === true) {
      const k = m.labor?.match ? `판:${m.phase}` : m.phase;
      t.phaseSec.set(k, (t.phaseSec.get(k) ?? 0) + dt);
    }
    if (m.bankrupt === true || m.phase === 'leaving') continue;
    const start = m.wallet + m.stats.spent - m.stats.won;
    if (m.patience > 0 && m.wallet < Math.max(min, start * PAWN.lowFrac)) t.shortIds.add(m.id);
    if (m.declined) t.declinedIds.add(m.id);
    if (m.errand === 'pawn' || m.errand === 'loan') t.soughtIds.add(m.id);
  }
  if (st.buildings.pawnshop.level >= 1 || st.buildings.bank.level >= 1) t.minCoins = Math.min(t.minCoins, st.coins);
}

/** 맡긴 장신구 장부가 맞나 (끝에): 남은 표 = 마을에 있는 손님의 m.pawned. */
function checkLedger(sim: Sim, t: DebtTally): string[] {
  const errs = [...t.ledgerErrors];
  for (const [id, list] of t.tickets) {
    const m = sim.monster(id);
    const have = (m?.pawned ?? []).map((x) => x.key as string).sort().join(',');
    if (have !== [...list].sort().join(',')) errs.push(`손님 ${id} 장부 ${list.join(',')} ≠ 맡긴 것 ${have}`);
  }
  const d = sim.state.debtTotals;
  if (d.pawned !== d.redeemed + d.forfeited + sim.state.monsters.reduce((s, m) => s + m.pawned.length, 0)) errs.push(`맡김 ${d.pawned} ≠ 되찾음 ${d.redeemed} + 컬렉션 ${d.forfeited} + 아직 맡긴 것`);
  return errs;
}

/** 정렬된 목록의 q 분위 (없으면 NaN). */
function quantile(xs: readonly number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] as number;
}

/** 부스마다 연 뒤의 한판 수와 단체 놀이 묶음 (sim 이벤트로 센다). races·runners·maxRunners = 경주장. */
interface BoothTally {
  rounds: Record<BoothId, number>;
  races: number;
  runners: number;
  maxRunners: number;
  /** 단체 놀이마다 판 수·참가자 합·가장 많이·접힌 판. */
  groups: Record<GroupBoothId, { n: number; runners: number; max: number; cancelled: number }>;
}

function tallyBooths(sim: Sim): BoothTally {
  const t: BoothTally = {
    rounds: Object.fromEntries(BOOTH_IDS.map((b) => [b, 0])) as Record<BoothId, number>,
    races: 0,
    runners: 0,
    maxRunners: 0,
    groups: Object.fromEntries(GROUP_BOOTHS.map((b) => [b, { n: 0, runners: 0, max: 0, cancelled: 0 }])) as BoothTally['groups'],
  };
  sim.bus.on('roundStarted', (e) => {
    t.rounds[e.booth] += 1;
  });
  sim.bus.on('groupStarted', (e) => {
    const n = e.group.participants.length;
    const g = t.groups[e.booth];
    g.n += 1;
    g.runners += n;
    g.max = Math.max(g.max, n);
    if (e.booth !== 'race') return;
    t.races += 1;
    t.runners += n;
    t.maxRunners = Math.max(t.maxRunners, n);
  });
  sim.bus.on('groupCancelled', (e) => {
    t.groups[e.booth].cancelled += 1;
  });
  return t;
}

function runSeeds(count: number, minutes: number, detail = false, first = 1): void {
  const keys = ['first', 'hall2', 'unlock-cups', 'unlock-darts', 'unlock-wheel', 'unlock-ssireum', 'unlock-duck', 'unlock-ring', 'unlock-boat', 'ready-hall3', 'hall3', 'unlock-race', 'unlock-kite', 'ready-hall4', 'hall4', 'unlock-claw', 'unlock-pouch', 'ready-hall5', 'hall5', 'unlock-tug', 'unlock-dig'];
  const short = (k: string) => k.replace('unlock-', '').replace('ready-hall', 'rdy');
  console.log(`--auto --seeds ${count}: 욕심쟁이 촌장이 처음 산 때 (분), ${minutes}분까지
`);
  console.log(`시드 ${keys.map((k) => short(k).padStart(7)).join('')}   코인  귀한(g/a/s)  기분  빈털  경주(평균/최대 참가)`);
  const sums = new Map<string, number[]>();
  /** 부스마다 연 뒤 1분에 시작한 한판 수 (시드마다). */
  const rates = new Map<BoothId, number[]>();
  const runnerAvg: number[] = [];
  /** 단체 놀이마다 시드의 판 평균 참가자·접힌 판 비율 (판이 5번 넘은 시드만). */
  const groupAvg = new Map<GroupBoothId, { avg: number[]; fold: number[] }>();
  const needAll = new Map<string, number[]>();
  const debtRows: DebtRow[] = [];
  for (let seed = first; seed < first + count; seed++) {
    const sim = new Sim(newGame(seed));
    // --open-all: 처음부터 다 열린 마을 (회관 5, 전당포·은행·일터 끝까지, devOpenAll). 넷째 묶음 수치를 큰 마을에서 본다.
    if (flag('open-all')) devOpenAll(sim);
    const ms = new Map<string, number>();
    const chief = makeGreedyChief(seed, ms);
    const all = zeroTally();
    listen(sim, zeroTally(), all, new Set());
    const tb = tallyBooths(sim);
    const dt = tallyDebt(sim);
    const openedAt = new Map<BoothId, number>();
    const need = new Map<string, number>();
    const n = Math.round((minutes * 60) / SIM.dt);
    for (let i = 0; i < n; i++) {
      sim.tick(SIM.dt);
      checkInvariants(sim);
      sampleDebt(dt, sim.state, SIM.dt);
      if (i % Math.round(1 / SIM.dt) === 0) {
        chief(sim, () => {});
        for (const b of BOOTH_IDS) if (!openedAt.has(b) && sim.boothOpen(b)) openedAt.set(b, sim.state.time);
        // --detail: 다음 회관 비용 항목마다 처음 모인 때 (그 회관 레벨에서).
        const next = sim.buildingUpgradeCost('hall');
        if (detail && next !== null) {
          const lv = sim.state.buildings.hall.level + 1;
          const items: [string, boolean][] = [['coins', sim.state.coins >= next.coins]];
          for (const [k, v] of Object.entries(next.mats ?? {})) items.push([k, (sim.state.materials[k as MaterialId] ?? 0) >= (v ?? 0)]);
          for (const [k, v] of Object.entries(next.precious ?? {})) items.push([k, (sim.state.precious[k as keyof GameState['precious']] ?? 0) >= (v ?? 0)]);
          for (const [k, ok] of items) {
            const key = `hall${lv}:${k}`;
            if (ok && !need.has(key)) need.set(key, sim.state.time / 60);
          }
        }
      }
    }
    // 연 지 5분이 넘은 부스만 센다.
    for (const b of BOOTH_IDS) {
      const at = openedAt.get(b);
      const open = at === undefined ? 0 : (sim.state.time - at) / 60;
      if (open < 5) continue;
      const list = rates.get(b) ?? [];
      list.push(tb.rounds[b] / open);
      rates.set(b, list);
    }
    if (tb.races > 0) runnerAvg.push(tb.runners / tb.races);
    for (const b of GROUP_BOOTHS) {
      const g = tb.groups[b];
      if (g.n <= 5) continue;
      const row = groupAvg.get(b) ?? { avg: [], fold: [] };
      row.avg.push(g.runners / g.n);
      row.fold.push(g.cancelled / (g.n + g.cancelled));
      groupAvg.set(b, row);
    }
    for (const [k, v] of need) needAll.set(k, [...(needAll.get(k) ?? []), v]);
    const st = sim.state;
    const cells = keys.map((k) => {
      const t = ms.get(k);
      if (t !== undefined) {
        const list = sums.get(k) ?? [];
        list.push(t / 60);
        sums.set(k, list);
      }
      return (t === undefined ? '-' : (t / 60).toFixed(1)).padStart(7);
    });
    const p = st.precious;
    const race = tb.races > 0 ? `${tb.races}판 ${(tb.runners / tb.races).toFixed(1)}/${tb.maxRunners}` : '-';
    console.log(`${pad(seed, 4)} ${cells.join('')} ${pad(st.coins, 6)}  ${pad(`${p.gem}/${p.golden_acorn}/${p.star_piece}`, 10)}  ${pad((all.moodSum / Math.max(1, all.left)).toFixed(0), 4)}  ${pad(all.broke, 4)}  ${race}`);
    if (flag('debt')) {
      console.log(`     ${debtLine(st)}`);
      const row = debtRow(sim, dt);
      console.log(`     ${row.text}`);
      debtRows.push(row);
    }
  }
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '-');
  console.log(`p25  ${keys.map((k) => fmt(quantile(sums.get(k) ?? [], 0.25)).padStart(7)).join('')}`);
  console.log(`중간 ${keys.map((k) => fmt(quantile(sums.get(k) ?? [], 0.5)).padStart(7)).join('')}`);
  console.log(`p75  ${keys.map((k) => fmt(quantile(sums.get(k) ?? [], 0.75)).padStart(7)).join('')}`);
  console.log(`몇 판 ${keys.map((k) => String((sums.get(k) ?? []).length).padStart(7)).join('')}`);
  console.log(`\n부스마다 연 뒤 1분에 한판 (시드 중간 / 가장 적은 시드, 연 지 5분 넘은 시드 수):`);
  console.log(`  ${BOOTH_IDS.map((b) => { const r = rates.get(b) ?? []; return `${b} ${fmt(quantile(r, 0.5))}/${fmt(quantile(r, 0))} (${r.length})`; }).join('  ')}`);
  if (detail) {
    console.log('\n다음 회관 비용 항목이 처음 모인 때 (분, 시드 중간 / p75):');
    for (const [k, list] of [...needAll.entries()].sort()) console.log(`  ${k.padEnd(22)} ${fmt(quantile(list, 0.5))} / ${fmt(quantile(list, 0.75))} (${list.length})`);
  }
  if (runnerAvg.length > 0) console.log(`경주 한 번 평균 참가자 (시드 중간): ${fmt(quantile(runnerAvg, 0.5))}`);
  console.log(`단체 놀이 한 판 평균 참가자 / 접힌 판 비율 (시드 중간, 판이 5번 넘은 시드 수): ${GROUP_BOOTHS.map((b) => { const r = groupAvg.get(b); return r === undefined ? `${b} -` : `${b} ${fmt(quantile(r.avg, 0.5))}/${(quantile(r.fold, 0.5) * 100).toFixed(0)}% (${r.avg.length})`; }).join('  ')}`);
  if (debtRows.length > 0) debtSummary(debtRows);
}

/** 시드 하나의 넷째 묶음 수치 (일터를 지은 뒤 30분마다로 맞춘다). */
interface DebtRow {
  text: string;
  per30: { pawned: number; forfeited: number; loans: number; bankrupt: number; matches: number };
  stints: number[];
  debts: number[];
  avgWorkers: number;
  maxWorkers: number;
  minCoins: number;
  ledger: number;
  funnel: DebtTally['funnel'];
  phaseSec: Map<string, number>;
  refusals: number;
}

function debtRow(sim: Sim, t: DebtTally): DebtRow {
  const st = sim.state;
  const d = st.debtTotals;
  const k = t.yardSec > 60 ? 1800 / t.yardSec : NaN;
  const per30 = { pawned: d.pawned * k, forfeited: d.forfeited * k, loans: d.loans * k, bankrupt: d.bankrupt * k, matches: d.matches * k };
  const avgWorkers = t.yardSec > 0 ? t.workerSec / t.yardSec : 0;
  const ledger = checkLedger(sim, t).length;
  const f = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '-');
  const stint = t.stints.length > 0 ? `${f(quantile(t.stints, 0.5) / 60)}/${f(quantile(t.stints, 0.9) / 60)}분` : '-';
  const text = `일터 ${f(t.yardSec / 60)}분 · 30분마다 맡김 ${f(per30.pawned)} 컬렉션 ${f(per30.forfeited)} 대출 ${f(per30.loans)} 파산 ${f(per30.bankrupt)} 빚 걸기 ${f(per30.matches)} · 일한 시간 중간/p90 ${stint} · 빚 중간 ${f(quantile(t.debts, 0.5))} · 채무자 평균 ${avgWorkers.toFixed(2)} 최대 ${t.maxWorkers} · 금고 최저 ${Number.isFinite(t.minCoins) ? t.minCoins : '-'} · 금고가 모자람 ${t.refusals} · 빌려줌 ${t.lent} 돌아옴 ${t.back} · 빌려줄 수 있던 때 ${((t.vaultOkSec / Math.max(1, t.yardSec)) * 100).toFixed(0)}%${ledger > 0 ? ` · 장부 어긋남 ${ledger}` : ''}`;
  const fn = t.funnel;
  return { text: `${text} · 떠난 손님 ${fn.left} (돈이 떨어짐 ${fn.short}, 싫다 ${fn.declined}, 빌리러 감 ${fn.sought})`, per30, stints: t.stints, debts: t.debts, avgWorkers, maxWorkers: t.maxWorkers, minCoins: t.minCoins, ledger, funnel: fn, phaseSec: t.phaseSec, refusals: t.refusals };
}

function debtSummary(rows: readonly DebtRow[]): void {
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '-');
  const q = (xs: number[]) => {
    const ok = xs.filter(Number.isFinite);
    return `${fmt(quantile(ok, 0.25))}/${fmt(quantile(ok, 0.5))}/${fmt(quantile(ok, 0.75))}`;
  };
  const per = (k: keyof DebtRow['per30']) => q(rows.map((r) => r.per30[k]));
  const stints = rows.flatMap((r) => r.stints).map((s) => s / 60);
  console.log('\n넷째 묶음 (일터를 지은 뒤 30분마다, 시드 p25/중간/p75):');
  console.log(`  맡김 ${per('pawned')}  컬렉션 ${per('forfeited')}  대출 ${per('loans')}  파산 ${per('bankrupt')}  빚 걸기 판 ${per('matches')}`);
  console.log(`  일한 시간 (분, 모든 파산) p10/중간/p90 ${fmt(quantile(stints, 0.1))}/${fmt(quantile(stints, 0.5))}/${fmt(quantile(stints, 0.9))} (${stints.length}번), 빚 중간 ${fmt(quantile(rows.flatMap((r) => r.debts), 0.5))}`);
  const ps = new Map<string, number>();
  for (const r of rows) for (const [k, v] of r.phaseSec) ps.set(k, (ps.get(k) ?? 0) + v);
  const psTotal = [...ps.values()].reduce((a, b) => a + b, 0);
  console.log(`  채무자가 보낸 시간: ${[...ps.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${((v / Math.max(1, psTotal)) * 100).toFixed(0)}%`).join(', ')}`);
  const fsum = (k: keyof DebtTally['funnel']) => rows.reduce((sum, r) => sum + r.funnel[k], 0);
  console.log(`  떠난 손님 ${fsum('left')}: 돈이 떨어진 적 ${fsum('short')}, 더 놀기 싫다 ${fsum('declined')}, 전당포·은행에 감 ${fsum('sought')}`);
  console.log(`  채무자 평균 ${q(rows.map((r) => r.avgWorkers))}, 최대 ${q(rows.map((r) => r.maxWorkers))}, 금고 최저 ${q(rows.map((r) => r.minCoins))}, 금고가 모자람 ${q(rows.map((r) => r.refusals))}, 장부 어긋남 ${rows.reduce((s, r) => s + r.ledger, 0)}`);
}

// ── --selftest ─────────────────────────────────────────────────────────

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    process.exitCode = 1;
    throw new Error(`시험 실패: ${msg}`);
  }
}

function stripTime(st: GameState): string {
  return JSON.stringify({ ...st, savedAt: 0 });
}

function runFor(sim: Sim, sec: number, check = true): void {
  const n = Math.round(sec / SIM.dt);
  for (let i = 0; i < n; i++) {
    sim.tick(SIM.dt);
    if (check) checkInvariants(sim);
  }
}

function selftest(): void {
  // 1) 결과 세부가 등급과 맞고 확률이 표와 비슷한가 (경주는 2)에서 따로).
  const rng = new Rng(42);
  const pool = SPECIES_IDS.slice(0, 9);
  for (const b of BOOTH_IDS) {
    if (isGroupBooth(b)) continue;
    const counts: Record<OutcomeTier, number> = { jackpot: 0, win: 0, nearMiss: 0, lose: 0 };
    const N = 40000;
    for (let i = 0; i < N; i++) {
      const o = decideOutcome(rng, b, 0, { level: 1 + (i % 3), pace: 1 + (i % 5), species: 'dragon', plushPool: pool });
      counts[o.tier]++;
      const d = o.detail;
      const t = o.tier;
      assert(d.kind === b, `${b} 세부 kind = ${d.kind}`);
      assert(o.multiplier === ((ODDS[b] as Partial<Record<OutcomeTier, readonly [number, number]>>)[t]?.[1] ?? 0), `${b} ${t} 배당`);
      if (d.kind === 'wheel') {
        assert(Number.isInteger(d.picked) && d.picked >= 0 && d.picked < WHEEL.slices && Number.isInteger(d.landed) && d.landed >= 0 && d.landed < WHEEL.slices, 'wheel 칸 0~5');
        assert(d.turns >= WHEEL.turns[0] && d.turns <= WHEEL.turns[1], 'wheel 바퀴 3~5');
        const gap = Math.min((d.landed - d.picked + WHEEL.slices) % WHEEL.slices, (d.picked - d.landed + WHEEL.slices) % WHEEL.slices);
        if (t === 'jackpot') assert(d.picked === WHEEL.bell && d.landed === WHEEL.bell, 'wheel jackpot = 종 찜, 종에 멈춤');
        if (t === 'win') assert(gap === 0 && d.picked !== WHEEL.bell, 'wheel win = 찜한 칸 (종 아님)');
        if (t === 'nearMiss') assert(gap === 1, 'wheel nearMiss = 바로 옆 칸');
        if (t === 'lose') assert(gap >= 2, 'wheel lose = 두 칸 이상');
      } else if (d.kind === 'duck') {
        assert(d.duck >= 0 && d.duck <= 4, 'duck 오리 0~4');
        if (t === 'jackpot') assert(d.mark === 'gold' && !d.slipped, 'duck jackpot = 금');
        if (t === 'win') assert(d.mark === 'silver' && !d.slipped, 'duck win = 은');
        if (t === 'nearMiss') assert(d.slipped && d.mark !== 'none', 'duck nearMiss = 놓침 (금·은)');
        if (t === 'lose') assert(d.mark === 'none' && !d.slipped, 'duck lose = 표식 없음');
      } else if (d.kind === 'ring') {
        assert(d.throws.length === 3 && d.throws.every((x) => x.bottle >= 0 && x.bottle <= 8), 'ring 세 번, 병 0~8');
        const hits = d.throws.filter((x) => x.hit).length;
        const last = d.throws[2]!;
        const nearShape = hits === 1 && !last.hit && last.wobble;
        if (t === 'jackpot') assert(hits === 3, 'ring jackpot = 셋');
        if (t === 'win') assert(hits === 2, 'ring win = 둘');
        if (t === 'nearMiss') assert(nearShape, 'ring nearMiss = 하나 + 마지막 흔들리다 떨어짐');
        if (t === 'lose') assert(hits <= 1 && !nearShape, 'ring lose = 0~1 (아깝다 모양 아님)');
      } else if (d.kind === 'claw') {
        assert(d.x >= 0 && d.x <= 1 && d.slipAt >= 0 && d.slipAt <= 1, 'claw x·slipAt 0~1');
        assert(d.target === 'dragon' || pool.includes(d.target), 'claw 상품은 손님 종이나 도감 종');
        if (t === 'jackpot') assert(d.result === 'double' && d.target2 !== null, 'claw jackpot = 둘');
        if (t === 'win') assert(d.result === 'win' && d.target2 === null, 'claw win = 하나');
        if (t === 'nearMiss') assert(d.result === 'slip' && d.slipAt >= 0.75 && d.target2 === null, 'claw nearMiss = 구멍 앞에서 떨어뜨림');
        if (t === 'lose') assert(d.result === 'miss', 'claw lose = 헛집기');
      } else if (d.kind === 'pouch') {
        assert(d.pick >= 0 && d.pick <= 2, 'pouch 주머니 0~2');
        if (t === 'jackpot') assert(d.content === 'jackpot' && d.pick === 2, 'pouch jackpot = 노랑 주머니');
        if (t === 'win') assert(d.content === 'coins', 'pouch win = 코인');
        if (t === 'nearMiss') assert(d.content === 'one', 'pouch nearMiss = 동전 하나');
        if (t === 'lose') assert(d.content === 'empty', 'pouch lose = 빈 주머니');
      } else if (d.kind === 'slot') {
        const [a, c, e] = d.reels;
        if (t === 'jackpot') assert(a === 'sym_bell' && c === 'sym_bell' && e === 'sym_bell', 'slot jackpot = 종 셋');
        if (t === 'win') assert(a === c && c === e && a !== 'sym_bell', 'slot win = 같은 그림 셋 (종 아님)');
        if (t === 'nearMiss') assert(a === c && e !== a, 'slot nearMiss = 둘 같고 셋째 다름');
        if (t === 'lose') assert(a !== c, 'slot lose = 첫째·둘째 다름');
      } else if (d.kind === 'oddeven') {
        assert(d.pebbles >= 1 && d.pebbles <= 9, 'oddeven 조약돌 1~9');
        const right = (d.pebbles % 2 === 1 ? 'odd' : 'even') === d.guess;
        assert(right === (t === 'win'), 'oddeven 맞힘 = win');
      } else if (d.kind === 'cups') {
        assert(d.swaps.length >= 3 && d.swaps.length <= 6, 'cups swaps 3~6');
        assert(d.swaps.every(([x, y]) => x !== y && x >= 0 && x <= 2 && y >= 0 && y <= 2), 'cups swaps 모양');
        const diff = Math.abs(d.ballAt - d.picked);
        if (t === 'win') assert(diff === 0, 'cups win = 같은 컵');
        if (t === 'nearMiss') assert(diff === 1, 'cups nearMiss = 바로 옆');
        if (t === 'lose') assert(diff === 2, 'cups lose = 반대쪽 끝');
      } else if (d.kind === 'darts') {
        const x = d.dist;
        if (t === 'jackpot') assert(x >= 0 && x < 0.12, 'darts jackpot 0~0.12');
        if (t === 'win') assert(x >= 0.12 && x < 0.45, 'darts win 0.12~0.45');
        if (t === 'nearMiss') assert(x >= 0.45 && x < 0.6, 'darts nearMiss 0.45~0.6');
        if (t === 'lose') assert(x >= 0.6, 'darts lose 0.6~');
      }
    }
    const row = ODDS[b] as Partial<Record<OutcomeTier, readonly [number, number]>>;
    let rtp = 0;
    for (const t of Object.keys(counts) as OutcomeTier[]) {
      const p = row[t]?.[0] ?? 0;
      assert(Math.abs(counts[t] / N - p) < 0.012, `${b} ${t} 확률 ${(counts[t] / N).toFixed(3)} ≈ ${p}`);
      rtp += p * (row[t]?.[1] ?? 0);
    }
    console.log(`  결과 세부·확률 OK: ${b} (환급률 ${rtp.toFixed(3)})`);
  }

  // 1b) 경주: 들어온 순서·결승 시각·키프레임이 맞고, 역전·사진 판정 비율이 RACE 표와 비슷한가.
  {
    const R = 6000;
    let comebacks = 0;
    let photos = 0;
    let leadChanges = 0;
    const wins = [0, 0, 0, 0];
    const tiers: Record<OutcomeTier, number> = { jackpot: 0, win: 0, nearMiss: 0, lose: 0 };
    let rtp = 0;
    const keyAt = COMEBACK_KEY_INDEX;
    for (let i = 0; i < R; i++) {
      const dur = 9 + (i % 3) * 0.5;
      const race = generateRace(rng, dur);
      const order = race.finishOrder;
      assert(new Set(order).size === 4, '경주 들어온 순서는 선수 넷');
      for (let k = 1; k < 4; k++) assert(race.finishAt[order[k]!]! > race.finishAt[order[k - 1]!]!, '들어온 순서 = 결승 시각 순서');
      assert(race.finishAt[order[3]!]! <= dur + 1e-9, '모두 경주 시간 안에 들어온다');
      const margin = race.finishAt[order[1]!]! - race.finishAt[order[0]!]!;
      assert(Math.abs(margin - race.margin) < 1e-9 && race.photoFinish === margin <= RACE.photoMargin, '사진 판정 = 1·2등 차이 photoMargin 이하');
      for (const r of RACERS) {
        const keys = race.keys[r]!;
        assert(keys[0]!.t === 0 && keys[0]!.p === 0, '키는 0초 0에서');
        const last = keys[keys.length - 1]!;
        assert(last.p === 1 && Math.abs(last.t - race.finishAt[r]!) < 1e-9, '마지막 키 = 결승 시각에 1');
        for (let k = 1; k < keys.length; k++) assert(keys[k]!.t > keys[k - 1]!.t && keys[k]!.p > keys[k - 1]!.p && keys[k]!.p <= 1, `키는 앞으로만 (선수 ${r})`);
        let prev = -1;
        for (let s = 0; s <= 40; s++) {
          const p = raceProgress(race, r, (dur * s) / 40);
          assert(p >= prev - 1e-9 && p >= 0 && p <= 1, 'raceProgress는 뒤로 가지 않는다');
          prev = p;
        }
      }
      // 역전 = 1등 선수가 그 지점에서 혼자 꼴찌.
      const w = order[0]!;
      const pw = race.keys[w]![keyAt]!.p;
      const last = RACERS.filter((r) => r !== w).every((r) => race.keys[r]![keyAt]!.p > pw);
      assert(last === race.comeback, `역전 표시 = 역전 지점 꼴찌 (${last} / ${race.comeback})`);
      if (race.comeback) comebacks++;
      if (race.photoFinish) photos++;
      wins[w]!++;
      let leader = raceStandings(race, 0.3)[0];
      for (let s = 1; s <= 20; s++) {
        const now = raceStandings(race, (race.finishAt[w]! * s) / 20)[0];
        if (now !== leader) leadChanges++;
        leader = now;
      }
      for (const r of RACERS) {
        const o = raceOutcome(race, r);
        tiers[o.tier]++;
        rtp += o.multiplier / (R * 4);
      }
    }
    assert(Math.abs(comebacks / R - RACE.comebackChance) < 0.015, `역전 비율 ${(comebacks / R).toFixed(3)}`);
    assert(Math.abs(photos / R - RACE.photoChance) < 0.02, `사진 판정 비율 ${(photos / R).toFixed(3)}`);
    for (const n of wins) assert(Math.abs(n / R - 0.25) < 0.02, `선수마다 1등 비율 ${(n / R).toFixed(3)}`);
    const row = ODDS.race as Partial<Record<OutcomeTier, readonly [number, number]>>;
    for (const t of Object.keys(tiers) as OutcomeTier[]) assert(Math.abs(tiers[t] / (R * 4) - (row[t]?.[0] ?? 0)) < 0.012, `경주 ${t} 비율 ${(tiers[t] / (R * 4)).toFixed(3)} ≈ ${row[t]?.[0]}`);
    // 행운: 1등 선수를 정해 둘 수 있다 (역전·사진 판정 모양은 그대로 맞다).
    for (let i = 0; i < 400; i++) {
      const want = RACERS[i % 4]!;
      const race = generateRace(rng, 10, { winner: want });
      assert(race.finishOrder[0] === want && raceTier(race, want) !== 'lose', '정해 둔 선수가 1등');
    }
    // 손님 한판으로 부르는 임시 길도 경주 세부를 낸다.
    const solo = decideOutcome(rng, 'race', 0, { level: 1, pace: 3 });
    assert(solo.detail.kind === 'race' && solo.detail.place >= 1 && solo.detail.place <= 4, 'race 한판 세부');
    console.log(`  경주 OK: 역전 ${(comebacks / R).toFixed(3)}, 사진 판정 ${(photos / R).toFixed(3)}, 1등 바뀜 평균 ${(leadChanges / R).toFixed(1)}번, 손님 환급률 ${rtp.toFixed(3)}`);
  }

  // 2) 저장·불러오기 왕복: 같은 상태에서 같은 미래.
  const a = new Sim(newGame(7));
  runFor(a, 240);
  const text = JSON.stringify(a.state);
  const loaded = normalizeState(JSON.parse(text));
  assert(loaded !== null, '저장 읽기');
  const b = new Sim(loaded);
  assert(stripTime(a.state) === stripTime(b.state), '읽은 상태가 같다');
  runFor(a, 180);
  runFor(b, 180);
  assert(stripTime(a.state) === stripTime(b.state), '불러온 뒤 180초가 똑같이 흐른다');
  console.log(`  저장 왕복 OK (손님 ${a.state.monsters.length}, 한판 ${a.state.totals.rounds}, ${text.length}바이트)`);

  // 3) 버전·모양 확인.
  assert(normalizeState({ ...JSON.parse(text), version: 1 }) === null, '옛 버전(1) 저장은 null (새로 시작)');
  assert(normalizeState({ hello: 1 }) === null, '모양이 다르면 null');
  const old = JSON.parse(text) as Record<string, unknown>;
  delete old.regulars;
  delete (old.materials as Record<string, unknown>).mat_ember;
  const fixed = normalizeState(old);
  assert(fixed !== null && fixed.materials.mat_ember === 0 && Array.isArray(fixed.regulars), '빠진 칸을 채운다');
  console.log('  버전·빠진 칸 OK');

  // 4) localStorage: 없으면 조용히, 있으면 왕복.
  assert(loadGame() === null, 'localStorage가 없으면 null');
  saveGame(a.state);
  clearSave();
  const store = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  try {
    a.save();
    assert(store.has('mpv-save-v1'), 'mpv-save-v1에 저장');
    const back = loadGame();
    assert(back !== null && stripTime(back) === stripTime(a.state), 'localStorage 왕복');
    store.set('mpv-save-v1', JSON.stringify({ ...a.state, version: 99 }));
    assert(loadGame() === null, '버전이 다른 저장은 무시');
    store.set('mpv-save-v1', '{망가진');
    assert(loadGame() === null, '망가진 저장은 무시');
    clearSave();
    assert(!store.has('mpv-save-v1'), 'clearSave');
  } finally {
    delete g.localStorage;
  }
  console.log('  localStorage OK');

  // 5) catchUp: 연출 이벤트 없이 요약 하나.
  const c = new Sim(newGame(3));
  runFor(c, 60);
  const seen: string[] = [];
  const quietTypes: (keyof SimEvents)[] = ['monsterReact', 'monsterSpectate', 'roundStarted', 'roundFinished', 'potFestival', 'groupJoined', 'groupStarted', 'groupEvent', 'groupFinished', 'groupCancelled', 'coinsChanged', 'toast', 'itemsChanged', 'monsterSpawned', 'monsterLeft'];
  for (const t of quietTypes) c.bus.on(t, () => seen.push(t as string));
  const coins0 = c.state.coins;
  const t0 = c.state.time;
  c.catchUp(10_000);
  checkInvariants(c);
  assert(Math.abs(c.state.time - t0 - SIM.catchUpMaxSec) < 1e-6, `catchUp은 ${SIM.catchUpMaxSec}초까지`);
  const loud = ['monsterReact', 'monsterSpectate', 'roundStarted', 'roundFinished', 'potFestival', 'groupJoined', 'groupStarted', 'groupEvent', 'groupFinished', 'groupCancelled'];
  for (const t of loud) assert(!seen.includes(t), `catchUp 중 ${t} 없음`);
  assert(seen.filter((t) => t === 'toast').length === 1, 'catchUp 요약 토스트 하나');
  assert(seen.filter((t) => t === 'coinsChanged').length <= 1, 'catchUp coinsChanged 한 번');
  console.log(`  catchUp OK (+${c.state.coins - coins0}코인, 이벤트 ${seen.length}개: ${[...new Set(seen)].join(',')})`);
  seen.length = 0;
  c.catchUp(5);
  assert(!seen.includes('toast'), '잠깐(20초 미만) 비운 catchUp은 요약 토스트가 없다');
  // 경주장이 도는 마을에서도 catchUp 동안 경주 연출 이벤트가 없다 (경주는 그대로 흐른다).
  const cr = new Sim(newGame(33));
  devOpenAll(cr);
  runFor(cr, 120);
  const races0 = cr.state.totals.rounds;
  const heard: string[] = [];
  for (const t of loud) cr.bus.on(t as keyof SimEvents, () => heard.push(t));
  cr.catchUp(300);
  checkInvariants(cr);
  assert(heard.length === 0 && cr.state.totals.rounds > races0, `경주장 catchUp 조용히 (${heard.join(',')})`);

  // 6) 행동과 실패 이유.
  const d = new Sim(newGame(5));
  const st = d.state;
  const r1 = d.unlockBooth('cups');
  assert(!r1.ok && /모자라|필요/.test(r1.reason), `해금 실패 이유: ${r1.ok ? '' : r1.reason}`);
  assert(!d.upgradeBooth('darts').ok, '잠긴 부스 업그레이드 불가');
  assert(!d.assign(st.staff[0]!.id, 'darts').ok, '잠긴 부스 배치 불가');
  st.coins = 5000;
  st.precious.golden_acorn = 1;
  st.precious.gem = 1;
  st.precious.star_piece = 1;
  // 다트 해금은 무 꼬마의 무청 (회관 1 손님 재료).
  st.materials.mat_radishgreen = 1;
  assert(d.unlockBooth('cups').ok && st.booths.cups.unlocked && st.booths.cups.staff[0] === null, '컵 해금 (진행자 없음)');
  assert(!d.boothOpen('cups'), '진행자 없으면 닫힘');
  const ci = st.candidates.findIndex((x) => x.art === 'host_cups');
  assert(ci >= 0 && d.hire(ci).ok, '컵 진행자 고용');
  assert(d.boothOpen('cups'), '고용하면 빈 부스를 바로 맡는다');
  assert(d.unlockBooth('darts').ok, '다트 해금');
  const di = st.candidates.findIndex((x) => x.art === 'host_darts');
  assert(di >= 0 && d.hire(di).ok && d.boothOpen('darts'), '다트 진행자');
  // 자리 바꾸기
  const slotHost = st.booths.slot.staff[0]!;
  const dartsHost = st.booths.darts.staff[0]!;
  assert(d.assign(slotHost, 'darts').ok && st.booths.darts.staff[0] === slotHost && st.booths.slot.staff[0] === dartsHost, '배치하면 서로 자리를 바꾼다');
  assert(d.assign(slotHost, null).ok && st.booths.darts.staff[0] === null && !d.boothOpen('darts'), '쉬게 하면 부스가 닫힌다');
  assert(!d.assign(slotHost, 'darts', 1).ok, '없는 진행자 자리는 안 된다');
  assert(d.assign(slotHost, 'darts').ok, '다시 배치');
  // 다른 구역 부스는 그 구역이 열릴 때까지 열 수 없다
  const lockWhy = d.unlockBooth('duck');
  assert(!lockWhy.ok && lockWhy.reason.includes('마을회관 레벨 2'), `구역이 닫힌 부스: ${lockWhy.ok ? '' : lockWhy.reason}`);
  assert(d.boothLockReason('wheel') === null && d.boothLockReason('race') !== null, '돌림판은 회관 1, 경주장은 회관 3부터');
  // 레벨업
  const s0 = st.staff[0]!;
  const before = s0.stats.pace + s0.stats.charm + s0.stats.welcome;
  assert(d.staffLevelUp(s0.id).ok && s0.stats.pace + s0.stats.charm + s0.stats.welcome === before + 1 && s0.level === 2, '레벨업은 능력치 하나 +1');
  // 건물·부스 업그레이드
  st.materials.mat_ember = 10;
  st.materials.mat_shell = 10;
  assert(d.upgradeBuilding('hall').ok && st.districts.includes('east'), '회관 2 → 연못 동네');
  assert(d.upgradeBooth('slot').ok && d.boothSeats('slot') === BOOTHS.slot.seats[1], '슬롯 업그레이드');
  assert(!d.upgradeBuilding('fountain').ok, '분수는 황금 도토리가 필요');
  // 가공
  st.materials.mat_spoon = 5;
  assert(d.craft(0).ok, '쿠키 만들기');
  const full = d.craft(0);
  assert(!full.ok && full.reason.includes('꽉'), '공방 자리가 꽉 참');
  assert(!d.craft(4).ok, '행운 부적은 회관 3부터');
  runFor(d, 31);
  assert(st.goods.snack_cookie === 1, '30초 뒤 쿠키 완성');
  // 손님에게 간식·응원
  runFor(d, 30);
  const m = st.monsters[0];
  assert(m !== undefined, '손님이 왔다');
  assert(d.cheer(m.id).ok && !d.cheer(m.id).ok, '응원 쿨타임');
  const mood0 = m.mood;
  assert(d.giveSnack(m.id, 'snack_cookie').ok && (m.mood > mood0 || m.mood === 100) && (st.goods.snack_cookie as number) === 0, '간식 주기');
  assert(!d.giveSnack(m.id, 'snack_cookie').ok, '간식이 없으면 실패');
  assert(!d.giveSnack(m.id, 'cheer_flag').ok, '응원 도구는 간식이 아님');
  st.goods.cheer_flag = 2;
  assert(d.placeCheer('slot', 'cheer_flag').ok && st.booths.slot.cheer?.good === 'cheer_flag', '응원 도구 걸기');
  runFor(d, 10);
  assert(d.placeCheer('slot', 'cheer_flag').ok && (st.booths.slot.cheer?.left ?? 0) > GOODS.cheer_flag.durationSec + 160, '같은 응원 도구는 남은 시간에 더해진다');
  st.goods.lucky_charm = 1;
  const other = d.placeCheer('slot', 'lucky_charm');
  assert(!other.ok && other.reason.includes('이미') && st.goods.lucky_charm === 1 && st.booths.slot.cheer?.good === 'cheer_flag', '다른 응원 도구는 덮어쓰지 않는다');
  runFor(d, 380);
  assert(st.booths.slot.cheer === null, '응원 도구가 다 닳는다');
  // 창고 한도
  st.materials.mat_ember = d.materialCap();
  runFor(d, 400);
  checkInvariants(d);
  console.log('  행동·실패 이유 OK');

  // 6b) 진행자 자리 여럿 (경주장)·새 부스 규칙.
  const f = new Sim(newGame(11));
  const fs = f.state;
  fs.coins = 50_000;
  fs.precious = { gem: 20, golden_acorn: 20, star_piece: 20 };
  for (const k of Object.keys(fs.materials) as MaterialId[]) fs.materials[k] = 20;
  while (f.upgradeBuilding('warehouse').ok) for (const k of Object.keys(fs.materials) as MaterialId[]) fs.materials[k] = f.materialCap();
  assert(f.upgradeBuilding('hall').ok && f.upgradeBuilding('hall').ok && fs.districts.includes('north') && !fs.districts.includes('west'), '회관 3 → 북쪽 언덕 (숲 동네는 회관 4)');
  assert(fs.candidates.some((c) => c.art === 'race_starter') && !fs.candidates.some((c) => c.art === 'host_claw'), '회관 3이면 경주장 진행자가 후보로, 숲 동네 진행자는 아직');
  // 쉬는 진행자를 다 치워 두고 경주장을 연다 (자리 셋이 빈다).
  assert(f.unlockBooth('race').ok && fs.booths.race.staff.length === 3 && !fs.booths.race.staff.some((x) => x !== null), '경주장 해금 (자리 셋 비어 있음)');
  assert(!f.boothOpen('race'), '출발 신호·해설자가 없으면 닫힘');
  const hireArt = (art: string): number => {
    const i = fs.candidates.findIndex((c) => c.art === art);
    assert(i >= 0 && f.hire(i).ok, `${art} 고용`);
    return fs.staff[fs.staff.length - 1]!.id;
  };
  const starter = hireArt('race_starter');
  assert(fs.booths.race.staff[0] === starter && !f.boothOpen('race'), '출발 신호는 자기 자리로, 해설자 없으면 아직 닫힘');
  const caster = hireArt('race_caster');
  assert(fs.booths.race.staff[1] === caster && f.boothOpen('race'), '출발 신호 + 해설자 = 열림 (사육사 없어도)');
  const keeper = hireArt('race_keeper');
  assert(fs.booths.race.staff[2] === keeper, '사육사는 있으면 좋은 자리로');
  assert(f.assign(keeper, null).ok && f.boothOpen('race'), '사육사가 쉬어도 열림');
  assert(f.assign(caster, null).ok && !f.boothOpen('race'), '해설자가 쉬면 닫힘');
  assert(f.assign(keeper, 'race', 1).ok && f.boothOpen('race') && fs.booths.race.staff[1] === keeper, '다른 진행자를 해설자 자리에');
  assert(f.assign(caster, 'race', 1).ok && fs.booths.race.staff[1] === caster && fs.staff.find((s) => s.id === keeper)?.post === null, '쉬던 진행자가 그 자리에 오면 원래 진행자는 쉰다');
  assert(f.assign(starter, 'race', 1).ok && fs.booths.race.staff[0] === caster && fs.booths.race.staff[1] === starter, '자리 둘을 서로 바꾼다');
  checkInvariants(f);
  // 고용 순서가 달라도 진행자는 자기 자리로: 해설자를 먼저 고용 (경주장이 잠겨 있으면 쉰다) → 해금하면 해설자 자리 → 출발 신호는 출발 신호 자리.
  {
    const g = new Sim(newGame(12));
    const gs = g.state;
    gs.coins = 50_000;
    gs.precious = { gem: 20, golden_acorn: 20, star_piece: 20 };
    const fillMats = (): void => {
      for (const k of Object.keys(gs.materials) as MaterialId[]) gs.materials[k] = g.materialCap();
    };
    while (g.upgradeBuilding('warehouse').ok) fillMats();
    fillMats();
    assert(g.upgradeBuilding('hall').ok && g.upgradeBuilding('hall').ok, '회관 3');
    const hire = (art: string): number => {
      const i = gs.candidates.findIndex((c) => c.art === art);
      assert(i >= 0 && g.hire(i).ok, `${art} 고용`);
      return gs.staff[gs.staff.length - 1]!.id;
    };
    const post = (id: number): string => JSON.stringify(gs.staff.find((x) => x.id === id)?.post ?? null);
    const gc = hire('race_caster');
    assert(post(gc) === 'null', '경주장이 잠겼으면 해설자는 쉰다');
    assert(g.unlockBooth('race').ok && gs.booths.race.staff[1] === gc && gs.booths.race.staff[0] === null, `해금하면 해설자는 해설자 자리로 (${JSON.stringify(gs.booths.race.staff)})`);
    const gst = hire('race_starter');
    assert(gs.booths.race.staff[0] === gst && g.boothOpen('race'), '출발 신호는 출발 신호 자리로');
    assert(boothStat(gs, 'race', 'pace') === 4 && boothStat(gs, 'race', 'charm') === 5, '경주장 진행·입담 = 출발 신호·해설자 능력치');
    assert(gs.booths.race.staff[2] === null, '사육사 자리는 비어 있다');
    fillMats();
    assert(g.upgradeBuilding('hall').ok && gs.districts.includes('west'), '회관 4');
    // 자기 부스가 잠긴 진행자는 다른 부스의 있으면 좋은 자리에 가지 않고 쉰다.
    const claw = hire('host_claw');
    assert(post(claw) === 'null', `인형 뽑기가 잠겼으면 수줍 소년은 사육사 자리에 가지 않고 쉰다 (${post(claw)})`);
    assert(g.unlockBooth('claw').ok && g.boothOpen('claw') && gs.booths.claw.staff[0] === claw, '해금하면 바로 자기 부스');
    // 있으면 좋은 자리에 서 있던 자기 진행자는 해금 때 데려온다.
    const pouchHost = hire('host_pouch');
    assert(g.assign(pouchHost, 'race', 2).ok && g.unlockBooth('pouch').ok && gs.booths.pouch.staff[0] === pouchHost && gs.booths.race.staff[2] === null, '사육사 자리의 복 아주머니를 복주머니로');
    // 자기 자리에 다른 진행자가 서 있으면 고용한 진행자가 바꿔 서고, 원래 진행자는 빈 자리로 (여기서는 자기 부스).
    assert(g.assign(claw, 'race', 2).ok && !g.boothOpen('claw'), '수줍 소년을 사육사 자리에');
    const keeper2 = hire('race_keeper');
    assert(gs.booths.race.staff[2] === keeper2 && gs.booths.claw.staff[0] === claw && g.boothOpen('claw'), `사육사를 고용하면 사육사 자리로, 수줍 소년은 인형 뽑기로 (${post(claw)})`);
    // 그림만 빌린 무작위 진행자는 그림 주인의 자리에 '어울리지' 않는다.
    const borrowed = { name: '푸근 아주머니', art: 'host_cups' };
    assert(!HOST_PRESETS.some((h) => h.name === borrowed.name) && presetPost(borrowed) === null && presetPost({ name: '찡긋 청년', art: 'host_cups' })?.booth === 'cups', '무작위 진행자는 이름까지 같아야 그림 주인 자리');
    checkInvariants(g);
  }
  // 모이는 중에 출발 신호가 빠지면 경주를 접고 건 코인을 돌려준다.
  {
    const r = new Sim(newGame(31));
    devOpenAll(r);
    const rs = r.state;
    let started = 0;
    r.bus.on('groupStarted', (e) => {
      if (e.booth === 'race') started++;
    });
    let wallets = 0;
    let gathered = false;
    for (let i = 0; i < 20_000 && !gathered; i++) {
      r.tick(SIM.dt);
      const race = rs.booths.race.group;
      if (race !== null && race.phase === 'gathering' && race.participants.length > 0) gathered = true;
    }
    assert(gathered, '경주장에 손님이 모인다');
    const race = rs.booths.race.group!;
    const who = race.participants.map((e) => ({ m: r.monster(e.monster)!, bet: e.bet }));
    wallets = who.reduce((a, x) => a + x.m.wallet + x.bet, 0);
    const before = started;
    const starterId = rs.booths.race.staff[0]!;
    assert(r.assign(starterId, null).ok && !r.boothOpen('race'), '출발 신호가 쉰다');
    r.tick(SIM.dt);
    assert(race.phase === 'idle' && race.participants.length === 0, '모이는 중이던 경주를 접는다');
    assert(who.reduce((a, x) => a + x.m.wallet, 0) === wallets, '건 코인을 돌려준다');
    runFor(r, 40);
    assert(started === before, '닫힌 경주장은 출발하지 않는다');
    assert(r.assign(starterId, 'race', 0).ok && r.boothOpen('race'), '다시 연다');
    checkInvariants(r);
  }
  // 부스 그림 뒤를 가로지르지 않는다: 돌림판 자리 → 다트 앞 길은 부스 그림 위를 지난다.
  assert(crossesBooth({ x: 4020, y: 6700 }, NODES.darts_front) && !crossesBooth({ x: 4020, y: 6700 }, NODES.wheel_front), '부스 그림 땅 판정');
  // 복주머니: 재료가 없는 손님은 고르지 않고, 한판마다 손님 재료 1개가 마을 창고로.
  devOpenAll(f);
  assert(BOOTH_IDS.every((b) => f.boothOpen(b)), 'devOpenAll: 모든 부스가 열린다');
  checkInvariants(f);
  for (const b of BOOTH_IDS) if (b !== 'pouch') fs.booths[b].unlocked = false;
  // 재료 창고를 비워 두고 (한도에 막히지 않게) 손님이 낸 재료가 들어오는지 본다.
  for (const k of Object.keys(fs.materials) as MaterialId[]) fs.materials[k] = 0;
  let pouchRounds = 0;
  let freeRounds = 0;
  let matsIn = 0;
  const matsBefore = new Map<number, number>();
  f.bus.on('roundStarted', (e) => {
    if (e.booth !== 'pouch') return;
    pouchRounds++;
    const m = f.monster(e.round.monster);
    const was = m === undefined ? undefined : matsBefore.get(m.id);
    if (m === undefined || was === undefined || was < 1 || m.mats !== was - 1) freeRounds++;
  });
  for (let i = 0; i < 3000; i++) {
    matsBefore.clear();
    for (const m of fs.monsters) matsBefore.set(m.id, m.mats);
    const before = Object.values(fs.materials).reduce((a, b) => a + b, 0);
    const r0 = pouchRounds;
    f.tick(SIM.dt);
    // 떠나는 손님의 재료 팁과 섞이지 않게, 이번 틱에 시작한 한판 수만큼은 늘어야 한다.
    if (pouchRounds > r0) matsIn += Math.min(pouchRounds - r0, Object.values(fs.materials).reduce((a, b) => a + b, 0) - before);
    for (const m of fs.monsters) if (m.booth === 'pouch' && (m.phase === 'toBooth' || m.phase === 'queued') && m.mats < 1) freeRounds++;
  }
  for (const b of BOOTH_IDS) fs.booths[b].unlocked = true;
  assert(pouchRounds > 0 && freeRounds === 0, `복주머니: 한판 ${pouchRounds}, 재료 없이 한 판/줄 ${freeRounds}`);
  assert(matsIn === pouchRounds, `복주머니 참가비 재료가 창고로 (${matsIn}/${pouchRounds})`);
  // 인형 뽑기: 이기면 도감에 인형.
  const plush0 = SPECIES_IDS.reduce((a, s) => a + (fs.dex[s]?.plush ?? 0), 0);
  let clawWins = 0;
  f.bus.on('roundFinished', (e) => {
    if (e.round.outcome.detail.kind === 'claw' && (e.round.outcome.tier === 'win' || e.round.outcome.tier === 'jackpot')) clawWins += e.round.outcome.tier === 'jackpot' ? 2 : 1;
  });
  for (const b of BOOTH_IDS) if (b !== 'claw') fs.booths[b].unlocked = false;
  runFor(f, 600, false);
  for (const b of BOOTH_IDS) fs.booths[b].unlocked = true;
  const plush1 = SPECIES_IDS.reduce((a, s) => a + (fs.dex[s]?.plush ?? 0), 0);
  assert(clawWins > 0 && plush1 - plush0 === clawWins, `인형 뽑기 인형 ${plush1 - plush0} = 이긴 인형 ${clawWins}`);
  checkInvariants(f);
  console.log(`  진행자 자리·새 부스 OK (복주머니 한판 ${pouchRounds}, 인형 ${clawWins})`);

  // 6c) 새 부스 반응 표: 등급마다 3~5개, 부스 안에서 이름이 겹치지 않는다. 오리 낚시는 지면 기분이 덜 내려간다.
  {
    const fresh: BoothId[] = ['wheel', 'duck', 'ring', 'race', 'claw', 'pouch'];
    for (const b of fresh) {
      const names: string[] = [];
      for (const t of ['jackpot', 'win', 'nearMiss', 'lose'] as OutcomeTier[]) {
        const ls = reactionLabels(t, b);
        assert(ls.length >= 3 && ls.length <= 5, `${b} ${t} 반응 후보 3~5개 (${ls.length})`);
        assert(ls.every((x) => !reactionLabels(t, null).includes(x)), `${b} ${t} 반응은 공통 표와 다르다`);
        names.push(...ls);
      }
      assert(new Set(names).size === names.length, `${b} 반응 이름이 겹치지 않는다`);
    }
    const probe = new Sim(newGame(2)).state.monsters[0]!;
    probe.traits = ['watcher'];
    assert(moodDelta('lose', false, probe, 0, 0, boothDef('duck').moodLossScale) === MOOD.delta.lose * (boothDef('duck').moodLossScale ?? 1), '오리 낚시: 지면 기분 하락이 작다');
    assert(moodDelta('win', false, probe, 0, 0, 0.5) === MOOD.delta.win, '오리 낚시: 이기면 그대로');
    console.log('  새 부스 반응 표·오리 낚시 기분 OK');
  }

  // 6d) 경주장 lifecycle: 손님 여럿이 한 경주, 출발 조건, 등수·등급·지급, 경주 중 응원, 구경꾼, 자리 비우기.
  {
    const r = new Sim(newGame(31));
    const rs = r.state;
    devOpenAll(r);
    // 손님이 경주장으로만 가게 다른 부스를 닫아 둔다.
    for (const b of BOOTH_IDS) if (b !== 'race') rs.booths[b].unlocked = false;
    const bs = rs.booths.race;
    const race = bs.group!;
    const pace = boothStat(rs, 'race', 'pace');
    const wallets = new Map<number, number>();
    let gatherAt = 0;
    let joinedMax = 0;
    let started = 0;
    let multi = 0;
    let biggest = 0;
    let progress = 0;
    let cheers = 0;
    let crowd = 0;
    let finishedRaces = 0;
    let settled = 0;
    let festivals = 0;
    const payouts: { monster: number; payout: number; want: number }[] = [];
    const festivalOf = new Set<number>();
    let expected = new Set<number>();
    r.bus.on('groupJoined', (e) => {
      if (e.booth !== 'race') return;
      assert(race.phase === 'gathering', '참가하면 모이는 중');
      const p = race.participants.find((x) => x.monster === e.monster);
      assert(p !== undefined && p.pick === e.pick && p.seat === e.seat && p.bet === e.bet && e.bet >= 1 && p.role === 'bettor', '참가 목록에 선수·자리·건 코인');
      wallets.set(e.monster, r.monster(e.monster)!.wallet);
      if (race.participants.length === 1) {
        gatherAt = rs.time;
        joinedMax = 0;
      }
      joinedMax = Math.max(joinedMax, race.participants.length);
    });
    r.bus.on('groupStarted', (e) => {
      if (e.booth !== 'race') return;
      started++;
      const res = raceOf(e.group.play)!;
      const waited = rs.time - gatherAt;
      // 자리로 걸어오는 손님이 곧 닿으면 (TUNE.groupWaitWalkSec 안) groupWaitExtraSec까지 더 기다려 준다.
      assert(waited <= raceGatherSec(pace) + TUNE.groupWaitExtraSec + SIM.dt * 1.5, `첫 손님이 앉고 ${(raceGatherSec(pace) + TUNE.groupWaitExtraSec).toFixed(1)}초 안에 출발 (${waited.toFixed(1)})`);
      if (joinedMax === 1) assert(waited >= raceGatherSec(pace) - SIM.dt * 1.5, `혼자면 끝까지 기다린다 (${waited.toFixed(1)})`);
      if (e.group.participants.length >= 2) multi++;
      biggest = Math.max(biggest, e.group.participants.length);
      for (let k = 1; k < 4; k++) assert(res.finishAt[res.finishOrder[k]!]! > res.finishAt[res.finishOrder[k - 1]!]!, '들어온 순서 = 결승 시각 순서');
      for (const x of RACERS) {
        const keys = res.keys[x]!;
        for (let k = 1; k < keys.length; k++) assert(keys[k]!.t > keys[k - 1]!.t && keys[k]!.p > keys[k - 1]!.p, '경주 키프레임은 앞으로만');
      }
      expected = new Set(e.group.participants.map((p) => p.monster));
      for (const p of e.group.participants) {
        const round = bs.rounds[p.seat];
        assert(round !== null && round !== undefined && round.monster === p.monster && round.outcome.tier === raceTier(res, p.pick as RacerIndex), '참가자마다 한판 (등급 = 그 선수의 결과)');
      }
    });
    r.bus.on('groupEvent', (e) => {
      if (e.booth !== 'race') return;
      progress++;
      const res = raceOf(e.group.play)!;
      assert(e.group.phase === 'running' && e.event.type === 'lead' && e.event.actor === raceStandings(res, e.event.t)[0] && e.event.t === e.group.elapsed, 'groupEvent 1등 = 그때 순위');
      for (const ch of e.cheers) {
        const p = e.group.participants.find((x) => x.monster === ch.id);
        assert(p !== undefined && p.pick === ch.pick, '응원은 참가자만');
        assert((ch.kind === 'lead') === (ch.pick === e.event.actor), '자기 선수가 1등이면 들썩, 아니면 땀');
        cheers++;
      }
    });
    r.bus.on('groupFinished', (e) => {
      if (e.booth !== 'race') return;
      finishedRaces++;
      assert(e.group.phase === 'done' && raceOf(e.group.play) !== null, '끝나면 done');
    });
    r.bus.on('roundFinished', (e) => {
      if (e.booth !== 'race') return;
      const d = e.round.outcome.detail;
      assert(d.kind === 'race' && race.phase === 'done' && raceOf(race.play) !== null, '경주 한판은 경주가 끝날 때');
      assert(expected.has(e.round.monster), '이번 경주 참가자만 결과');
      const res = raceOf(race.play)!;
      const place = racePlace(res, d.racer);
      const t = e.round.outcome.tier;
      assert(d.place === place, '세부 등수 = 들어온 순서');
      if (place === 1) assert(t === (res.comeback ? 'jackpot' : 'win'), '1등 = win (역전이면 jackpot)');
      else if (place === 2 && res.photoFinish) assert(t === 'nearMiss', '사진 판정 2등 = nearMiss');
      else assert(t === 'lose', '나머지 = lose');
      const m = r.monster(e.round.monster)!;
      assert(m.wallet === (wallets.get(m.id) ?? NaN) + e.payout, `지갑 = 참가 뒤 지갑 + 지급 (${m.id})`);
      assert(m.phase === 'reacting', '결과 뒤 반응');
      payouts.push({ monster: m.id, payout: e.payout, want: Math.round(e.round.bet * e.round.outcome.multiplier) });
      settled++;
    });
    r.bus.on('potFestival', (e) => {
      if (e.booth !== 'race') return;
      festivals++;
      festivalOf.add(e.monster);
    });
    r.bus.on('monsterSpectate', (e) => {
      if (race.phase === 'done' && !expected.has(e.id)) crowd++;
    });
    runFor(r, 1200);
    for (const p of payouts) {
      if (p.want === 0) assert(p.payout === 0, '진 손님은 받지 않는다');
      else assert(p.payout <= p.want || festivalOf.has(p.monster), `지급 ≤ 배당 × 건 코인 (항아리 축제 말고) ${p.payout}/${p.want}`);
    }
    assert(started >= 15 && finishedRaces >= started - 1 && multi >= 5 && settled > started, `경주 ${started}번 (여럿 ${multi}, 끝 ${finishedRaces}, 결과 ${settled})`);
    assert(progress > 0 && cheers > 0, `경주 중 1등 바뀜 ${progress}, 응원 ${cheers}`);
    // 경주 중에 저장·불러오기: 같은 상태에서 같은 미래 (경주 상태가 모두 GameState에 있다).
    for (let i = 0; i < 600 && race.phase !== 'running'; i++) runFor(r, SIM.dt);
    assert(race.phase === 'running', '경주가 달리는 중');
    const twin = new Sim(normalizeState(JSON.parse(JSON.stringify(rs)))!);
    runFor(r, 40);
    runFor(twin, 40);
    assert(stripTime(r.state) === stripTime(twin.state), '경주 중 저장·불러오기 뒤 40초가 똑같이 흐른다');
    // 출발 신호를 쉬게 하면 (닫힘) 이번 경주까지만 하고 손님이 자리를 비운다.
    const starter = bs.staff[0]!;
    assert(r.assign(starter, null).ok && !r.boothOpen('race'), '출발 신호가 쉬면 경주장이 닫힌다');
    runFor(r, 60);
    assert(bs.seats.every((x) => x === null) && bs.rounds.every((x) => x === null) && bs.queue.length === 0 && rs.booths.race.group?.phase === 'idle' && race.participants.length === 0, `닫힌 경주장: 자리·한판·줄이 비고 경주는 쉰다 (자리 ${bs.seats.map((x) => (x === null ? '-' : `${x}:${r.monster(x)?.phase}:${r.monster(x)?.booth}:${r.monster(x)?.bankrupt}`)).join(' ')}, 줄 ${bs.queue.length}, 판 ${rs.booths.race.group?.phase})`);
    for (const b of BOOTH_IDS) rs.booths[b].unlocked = true;
    checkInvariants(r);
    console.log(`  경주장 OK: 경주 ${started}번 (둘 이상 ${multi}, 가장 많이 ${biggest}명), 결과 ${settled}, 1등 바뀜 ${progress} (응원 ${cheers}), 구경 ${crowd}, 항아리 축제 ${festivals}`);
  }

  // 6e) 단체 놀이 생성기 (셋째 묶음): 타임라인·사건·등급이 규칙과 맞고, 등급 비율이 ODDS와 비슷한가.
  groupGenerators(rng);

  // 6e') 단체 놀이 고르기 (셋째 묶음): 자리 고르기·구경 손님 고르기·나서기·진행 중 구경꾼 들썩임.
  groupChoices(rng);
  ssireumStepIn();

  // 6f) 단체 놀이 엔진 (셋째 묶음): 부스 하나만 연 마을에서 판이 돌고, 출발 조건·편 맞추기·결과·지급·응원·반응이 맞는가.
  groupLifecycles();

  // 6g) 넷째 묶음: 장신구·전당포·금고·은행·파산·일터·빚 걸기 판·저장.
  debtFlows();

  // 7) 오래 돌려도 멈추지 않는다 (여러 시드, 120분).
  for (const seed of [1, 2, 3]) {
    const e = new Sim(newGame(seed));
    e.state.coins = 99999;
    e.state.precious = { gem: 9, golden_acorn: 9, star_piece: 9 };
    for (const k of Object.keys(e.state.materials) as MaterialId[]) e.state.materials[k] = 20;
    const chief = makeGreedyChief(seed);
    const n = Math.round((60 * 60) / SIM.dt);
    for (let i = 0; i < n; i++) {
      e.tick(SIM.dt);
      checkInvariants(e);
      if (i % 10 === 0) chief(e, () => {});
    }
    console.log(`  60분 (시드 ${seed}, 코인 넉넉한 마을) OK: 손님 ${e.state.totals.visitors}, 한판 ${e.state.totals.rounds}, 회관 ${e.state.buildings.hall.level}`);
  }

  // 7b) 처음부터 다 열린 마을 (devOpenAll) 60분: 불변식, 모든 부스에 손님, 경주는 여럿이.
  for (const seed of [4, 5, 6]) {
    const e = new Sim(newGame(seed));
    devOpenAll(e);
    const tb = tallyBooths(e);
    const td = tallyDebt(e);
    let progress = 0;
    e.bus.on('groupEvent', (x) => {
      if (x.booth === 'race') progress++;
    });
    // 항아리 축제는 이긴 손님만, 이기지 못하고 코인이 모자라면 (돌려받았어도) 빈털터리.
    const lastTier = new Map<number, OutcomeTier>();
    let badFestival = 0;
    let missedBroke = 0;
    e.bus.on('roundFinished', (x) => {
      const tier = x.round.outcome.tier;
      lastTier.set(x.round.monster, tier);
      const m = e.monster(x.round.monster);
      if (m !== undefined && m.bankrupt !== true && tier !== 'win' && tier !== 'jackpot' && m.wallet < minPlayCost(e.state) && m.broke !== true) missedBroke++;
    });
    e.bus.on('potFestival', (x) => {
      const t = lastTier.get(x.monster);
      if (t !== 'win' && t !== 'jackpot') badFestival++;
    });
    // 판이 끝날 때 놀이 근처에서 구경하는 손님 (판이 시작할 때 걷다가 발을 멈춘 손님 포함).
    let watching = 0;
    e.bus.on('groupFinished', (x) => {
      const c = groupGame(x.booth).center;
      watching += e.state.monsters.filter((m) => m.phase === 'spectating' && Math.hypot(m.pos.x - c.x, m.pos.y - c.y) < TUNE.groupDrawRadius + 400).length;
    });
    const chief = makeGreedyChief(seed);
    const n = Math.round((60 * 60) / SIM.dt);
    for (let i = 0; i < n; i++) {
      e.tick(SIM.dt);
      checkInvariants(e);
      sampleDebt(td, e.state, SIM.dt);
      if (i % 10 === 0) chief(e, () => {});
    }
    // 넷째 묶음: 맡긴 장신구 장부가 맞고, 파산한 손님은 풀려났거나 아직 일하는 중, 빚 걸기 판이 열린다.
    const lerr = checkLedger(e, td);
    assert(lerr.length === 0, `다 열린 마을 장부: ${lerr.slice(0, 3).join(' / ')}`);
    const dd = e.state.debtTotals;
    assert(dd.relieved + e.state.monsters.filter((m) => m.bankrupt === true).length === dd.bankrupt && dd.bankrupt > 0 && dd.matches > 0, `파산 ${dd.bankrupt} = 풀려남 ${dd.relieved} + 일하는 중, 빚 걸기 판 ${dd.matches}`);
    // 부스가 15개라 손님 한 명이 들르는 부스가 흩어진다: 부스마다 20판 이상.
    for (const b of BOOTH_IDS) assert(tb.rounds[b] >= 20, `다 열린 마을 60분: ${b} 한판 ${tb.rounds[b]} (20 이상)`);
    for (const b of GROUP_BOOTHS) assert(tb.groups[b].n >= 10, `다 열린 마을 60분: ${b} ${tb.groups[b].n}판 (10 이상)`);
    assert(badFestival === 0, `이기지 않은 한판의 항아리 축제 ${badFestival}`);
    assert(missedBroke === 0, `코인이 모자란데 빈털터리가 아닌 손님 ${missedBroke}`);
    // 부스 15개에 손님이 흩어져 경주 한 번 참가자가 예전(10개, 약 2.4명)보다 적다: 1.3명 이상. 줄다리기는 편마다 둘이라 2.5명 이상.
    assert(tb.races >= 30 && tb.runners / tb.races >= 1.3 && progress > 0, `경주 ${tb.races}번, 평균 참가 ${(tb.runners / Math.max(1, tb.races)).toFixed(2)}`);
    assert(tb.groups.tug.runners / Math.max(1, tb.groups.tug.n) >= 2.5, `줄다리기 평균 참가 ${(tb.groups.tug.runners / Math.max(1, tb.groups.tug.n)).toFixed(2)}`);
    // 밀어내기는 상대가 오지 않으면 접히지만 (구경 손님이 나서기도 한다) 셋 가운데 하나를 넘지 않는다. 판이 끝날 때 구경하는 손님이 있다.
    const sg = tb.groups.ssireum;
    assert(sg.cancelled <= (sg.n + sg.cancelled) / 3, `밀어내기 접힌 판 ${sg.cancelled} / ${sg.n + sg.cancelled}`);
    assert(watching > 0, '단체 놀이를 구경하는 손님');
    console.log(`  60분 (시드 ${seed}, 처음부터 다 열린 마을) OK: 손님 ${e.state.totals.visitors}, 한판 ${e.state.totals.rounds}, 경주 ${tb.races}번 (평균 ${(tb.runners / tb.races).toFixed(1)}명, 가장 많이 ${tb.maxRunners}명)`);
    console.log(`     ${BOOTH_IDS.map((b) => `${b} ${tb.rounds[b]}`).join(', ')}`);
    console.log(`     단체 놀이: ${GROUP_BOOTHS.map((b) => { const g = tb.groups[b]; return `${b} ${g.n}판 평균 ${(g.runners / Math.max(1, g.n)).toFixed(1)}명 (접힘 ${g.cancelled})`; }).join(', ')}, 판 끝 구경 ${watching}`);
    console.log(`     ${debtLine(e.state)}`);
  }
  console.log('\nselftest 통과');
}

// ── 단체 놀이 (셋째 묶음) 시험 ─────────────────────────────────────────

/** 참가자 n명 (자리 0부터, 고른 것은 그 놀이의 join 규칙으로). */
function groupEntries(rng: Rng, b: GroupBoothId, n: number, seats: readonly number[] = Array.from({ length: n }, (_, i) => i)): GroupEntry[] {
  const game = groupGame(b);
  const probe = new Sim(newGame(1)).state.monsters[0]!;
  const out: GroupEntry[] = [];
  for (const seat of seats.slice(0, n)) {
    const j = game.join(rng, seat, { ...probe, species: 'dragon' }, out);
    out.push({ monster: 1000 + seat, seat, pick: j.pick, role: j.role, bet: 10, fee: 2 });
  }
  return out;
}

/** 판 하나의 사건을 엔진처럼 시계대로 하나씩 꺼낸다 (0.1초 틱, poll이 받아들인 사건 순서). */
function pollAll(b: GroupBoothId, play: GroupPlay): GroupEvent[] {
  const game = groupGame(b);
  const g: GroupState = { phase: 'running', countdown: 0, elapsed: 0, duration: play.end, participants: [], play, mark: null, markAt: 0, cursor: 0 };
  const got: GroupEvent[] = [];
  while (g.elapsed < g.duration) {
    g.elapsed += SIM.dt;
    const ev = game.poll(play, g, g.elapsed);
    if (ev === null) continue;
    if (play.events[g.cursor ?? 0] === ev) g.cursor = (g.cursor ?? 0) + 1;
    g.mark = ev.actor;
    g.markAt = g.elapsed;
    got.push(ev);
  }
  return got;
}

type TierCount = Record<OutcomeTier, number>;
const zeroTiers = (): TierCount => ({ jackpot: 0, win: 0, nearMiss: 0, lose: 0 });

function checkOdds(b: GroupBoothId, counts: TierCount, tol = 0.012): string {
  const row = ODDS[b] as Partial<Record<OutcomeTier, readonly [number, number]>>;
  const n = counts.jackpot + counts.win + counts.nearMiss + counts.lose;
  let rtp = 0;
  for (const t of Object.keys(counts) as OutcomeTier[]) {
    const p = counts[t] / n;
    assert(Math.abs(p - (row[t]?.[0] ?? 0)) < tol, `${b} ${t} 비율 ${p.toFixed(3)} ≈ ODDS ${row[t]?.[0]}`);
    rtp += p * (row[t]?.[1] ?? 0);
  }
  return `환급률 ${rtp.toFixed(3)}`;
}

/** 키프레임이 시각 순서이고 값이 범위 안인가. */
function checkKeys(keys: readonly GroupKey[], lo: number, hi: number, what: string): void {
  for (let k = 0; k < keys.length; k++) {
    const x = keys[k]!;
    assert(Number.isFinite(x.t) && Number.isFinite(x.p) && x.p >= lo - 1e-9 && x.p <= hi + 1e-9, `${what} 키 값 범위 (${x.t}, ${x.p})`);
    if (k > 0) assert(x.t > keys[k - 1]!.t, `${what} 키 시각 순서`);
  }
}

function groupGenerators(rng: Rng): void {
  const ctxOf = (b: GroupBoothId, lucky = -1): { duration: number; level: number; pace: number; lucky: number; seats: number } => ({ duration: BOOTHS[b].roundSec[0], level: 1, pace: 3, lucky, seats: BOOTHS[b].seats[0] });
  const N = 6000;
  // 씨름·줄다리기: p(t)·c(t) 모양 (끝에 ±1, 그 전엔 닿지 않음), 막판 모양과 등급, 사건.
  for (const b of ['ssireum', 'tug'] as const) {
    const tiers = zeroTiers();
    let flips = 0;
    let wins = 0;
    const rules = b === 'ssireum' ? SSIREUM : TUG;
    for (let i = 0; i < N; i++) {
      const n = b === 'ssireum' ? 2 + rng.int(0, 4) : 2 * rng.int(2, 4);
      const es = groupEntries(rng, b, n);
      if (b === 'ssireum') assert(es[0]!.role === 'player' && es[0]!.pick === 0 && es[1]!.role === 'player' && es[1]!.pick === 1 && es.slice(2).every((e) => e.role === 'bettor'), '씨름 자리 0·1 = 홍·청 선수, 나머지 구경');
      const play = groupGame(b).generate(rng, es, ctxOf(b));
      assert(play.kind === b && play.outcomes.length === es.length && play.end === ctxOf(b).duration, `${b} 판 모양`);
      if (play.kind !== 'ssireum' && play.kind !== 'tug') continue;
      const end = play.kind === 'ssireum' ? play.throwAt : play.crossAt;
      const flip = play.kind === 'ssireum' ? play.flip : play.comeback;
      const s = sideSign(play.winner);
      const keys = play.tracks[0]!;
      checkKeys(keys, -1, 1, b);
      assert(Math.abs(keys[keys.length - 1]!.t - end) < 1e-9 && keys[keys.length - 1]!.p === s, `${b} 끝에 이긴 편 쪽 ±1`);
      const tail = rules.closeFrom * end;
      let ledLate = false;
      let minS = 1;
      for (let t = 0.05; t < end - 1e-6; t += 0.05) {
        const v = trackAt(keys, t);
        assert(Math.abs(v) < 1, `${b} 끝나기 전에는 ±1에 닿지 않는다 (${t.toFixed(2)}: ${v})`);
        minS = Math.min(minS, s * v);
        if (t >= tail && s * v < 0) ledLate = true;
        if (t >= tail && !play.close) assert(s * v >= -1e-9, `${b} 보통 판: 막판엔 이긴 편이 앞선다`);
      }
      assert(ledLate === play.close, `${b} close = 막판에 진 편이 앞섰다 (${ledLate}/${play.close})`);
      if (flip) assert(play.close && minS <= -rules.brink, `${b} 뒤집기: 이긴 편이 ${-rules.brink}보다 밀렸다 (${minS.toFixed(2)})`);
      else assert(minS > -rules.brink, `${b} 뒤집기가 아니면 이긴 편이 그만큼 밀리지 않는다 (${minS.toFixed(2)})`);
      // 사건: 시각 순서, 끝(finish)이 승부 시각에 이긴 편, 뒤집기 판에만 flip, 엔진처럼 꺼내면 다 나온다.
      for (let k = 1; k < play.events.length; k++) assert(play.events[k]!.t >= play.events[k - 1]!.t, `${b} 사건 시각 순서`);
      const fin = play.events.filter((e) => e.type === 'finish');
      assert(fin.length === 1 && Math.abs(fin[0]!.t - end) < 1e-9 && fin[0]!.actor === play.winner, `${b} 끝 사건`);
      assert(play.events.some((e) => e.type === 'flip') === flip, `${b} 뒤집기 사건 = 뒤집기 판`);
      assert(pollAll(b, play).length === play.events.length, `${b} 사건이 판 안에 다 나온다`);
      es.forEach((e, k) => {
        const o = play.outcomes[k]!;
        const won = e.pick === play.winner;
        assert(o.tier === (won ? (flip ? 'jackpot' : 'win') : play.close ? 'nearMiss' : 'lose') && o.multiplier === (ODDS[b] as Partial<Record<OutcomeTier, readonly [number, number]>>)[o.tier]?.[1], `${b} 등급·배당`);
        tiers[o.tier]++;
      });
      wins++;
      if (flip) flips++;
    }
    console.log(`  ${b} 생성기 OK: 뒤집기 ${(flips / wins).toFixed(3)}, ${checkOdds(b, tiers)}`);
  }
  // 행운: 그 손님 편이 이긴다.
  for (const b of ['ssireum', 'tug', 'kite', 'boat'] as const) {
    for (let i = 0; i < 300; i++) {
      const es = groupEntries(rng, b, b === 'tug' ? 4 : 3);
      const lucky = rng.int(0, es.length - 1);
      const play = groupGame(b).generate(rng, es, ctxOf(b, lucky));
      assert(play.outcomes[lucky]!.tier === 'win' || play.outcomes[lucky]!.tier === 'jackpot', `${b} 행운이 붙은 손님 쪽이 이긴다`);
    }
  }
  // 줄다리기 편 맞추기·출발 조건.
  {
    const mk = (sides: number[]): GroupEntry[] => sides.map((p, i) => ({ monster: i, seat: i, pick: p, role: 'player', bet: 1, fee: 0 }));
    for (let i = 0; i < 500; i++) {
      const es = mk(Array.from({ length: rng.int(1, 10) }, () => rng.int(0, 1)));
      const keep = tugLineup(es);
      const r = keep.filter((e) => e.pick === 0).length;
      const bl = keep.filter((e) => e.pick === 1).length;
      const want = Math.min(es.filter((e) => e.pick === 0).length, es.filter((e) => e.pick === 1).length, TUG.maxSide);
      assert(r === bl && r === want, `줄다리기 편 인원을 맞춘다 (${r}:${bl}, ${want})`);
      assert(keep.every((e, k) => k === 0 || e.seat > keep[k - 1]!.seat), '먼저 온 손님부터, 순서 그대로');
    }
    const game = groupGame('tug');
    assert(game.readiness(mk([0, 1, 0, 1]), 0) === 'soon' && game.readiness(mk([0, 1]), 0) === 'none' && game.readiness(mk([0, 1]), TUG.soloAfterSec) === 'ok' && game.readiness(mk([0, 0, 0]), 99) === 'none', '줄다리기 출발 조건 (편마다 둘, 오래 기다리면 하나씩)');
    const sg = groupGame('ssireum');
    assert(sg.readiness(groupEntries(rng, 'ssireum', 1), 99) === 'none' && sg.readiness(groupEntries(rng, 'ssireum', 2), 0) === 'soon', '씨름 출발 조건 (선수 둘)');
  }
  // 연날리기: 끊긴 순서·사건·키·등급.
  {
    const tiers = zeroTiers();
    let lates = 0;
    let closes = 0;
    for (let i = 0; i < N; i++) {
      const es = groupEntries(rng, 'kite', rng.int(1, 6));
      const play = groupGame('kite').generate(rng, es, { ...ctxOf('kite'), duration: BOOTHS.kite.roundSec[i % 3]! });
      if (play.kind !== 'kite') throw new Error('kite');
      const K = KITE.kites.length;
      const D = play.end;
      const winner = play.order[K - 1]!;
      assert(new Set(play.order).size === K && play.cutAt[winner] === -1, '연: 끊긴 순서는 연 넷, 이긴 연은 안 끊긴다');
      for (let k = 0; k < K - 1; k++) {
        const a: number = play.order[k]!;
        assert(play.cutAt[a]! > 0 && play.cutAt[a]! < D - 0.3 && (k === 0 || play.cutAt[a]! > play.cutAt[play.order[k - 1]!]!), '연: 끊긴 때는 순서대로, 판 안');
        const cut: GroupEvent | undefined = play.events.find((e) => e.type === 'cut' && e.actor === a);
        assert(cut !== undefined && Math.abs(cut.t - play.cutAt[a]!) < 1e-9, '연: 끊김 사건 = 끊긴 때');
        const other: number = cut.other ?? -1;
        assert(other !== a && (play.cutAt[other] === -1 || play.cutAt[other]! > cut.t), '연: 끊은 연은 그때 살아 있다');
        assert(play.events.some((e) => e.type === 'tangle' && e.actor === a && e.other === other && e.t < cut.t && e.t > cut.t - 1.6), '연: 끊기기 전에 그 둘이 연싸움');
        if (k === K - 2) assert(other === winner, '연: 마지막 연싸움은 이긴 연과');
        // 끊긴 연의 키는 끊긴 때에서 끝난다.
        const hk = play.tracks[a * 2]!;
        assert(Math.abs(hk[hk.length - 1]!.t - play.cutAt[a]!) < 1e-9, '연: 끊긴 연의 키는 끊긴 때까지');
      }
      for (let k = 0; k < K; k++) {
        checkKeys(play.tracks[k * 2]!, 0, 1.05, '연 높이');
        checkKeys(play.tracks[k * 2 + 1]!, -4, 4, '연 좌우');
        assert(play.tracks[k * 2]!.length === play.tracks[k * 2 + 1]!.length, '연 높이·좌우 키 수');
      }
      const last = play.cutAt[play.order[K - 2]!]!;
      assert(play.late === last >= KITE.lateFrom * D - 1e-9, `연: late = 마지막에서 두 번째 연이 끝 무렵 끊김 (${(last / D).toFixed(2)})`);
      assert(play.close === play.events.some((e) => e.type === 'brink' && e.actor === winner), '연: close = 이긴 연이 끊길 뻔한 사건');
      assert(play.events.filter((e) => e.type === 'cut').length === K - 1, '연: 끊김 셋');
      for (let k = 1; k < play.events.length; k++) assert(play.events[k]!.t >= play.events[k - 1]!.t, '연 사건 시각 순서');
      assert(pollAll('kite', play).length === play.events.length, '연 사건이 판 안에 다 나온다');
      es.forEach((e, k) => {
        const o = play.outcomes[k]!;
        const place = K - play.order.indexOf(e.pick);
        assert(o.detail.kind === 'kite' && o.detail.place === place && o.tier === (place === 1 ? (play.close ? 'jackpot' : 'win') : place === 2 && play.late ? 'nearMiss' : 'lose'), '연 등급');
        tiers[o.tier]++;
      });
      if (play.late) lates++;
      if (play.close) closes++;
    }
    console.log(`  kite 생성기 OK: 끝 무렵 끊김 ${(lates / N).toFixed(3)}, 끊길 뻔 ${(closes / N).toFixed(3)}, ${checkOdds('kite', tiers)}`);
  }
  // 보물찾기: 상자는 많아야 하나, 판의 chestChance, 바로 옆 = nearMiss, 할아버지가 판다.
  {
    const tiers = zeroTiers();
    let chests = 0;
    let found = 0;
    for (let i = 0; i < N * 2; i++) {
      const es = groupEntries(rng, 'dig', rng.int(1, 6));
      const play = groupGame('dig').generate(rng, es, ctxOf('dig'));
      if (play.kind !== 'dig') throw new Error('dig');
      assert(play.finds.filter((f) => f === 'chest').length <= 1, '보물찾기: 상자는 판마다 많아야 하나');
      assert(play.found === (play.chest >= 0 && es.some((e) => e.pick === play.chest)), '보물찾기: found = 상자 자리를 판 손님이 있다');
      assert(play.events.some((e) => e.type === 'reveal') === (play.chest >= 0 && !play.found), '보물찾기: 못 찾은 상자만 할아버지가');
      play.finds.forEach((f, spot) => assert((f === 'none') === !es.some((e) => e.pick === spot) && ((play.findAt[spot] ?? -1) >= 0) === (f !== 'none'), '보물찾기: 판 자리만 나온다'));
      es.forEach((e, k) => {
        const o = play.outcomes[k]!;
        const f = play.finds[e.pick]!;
        const near = digNear(play.chest, e.pick);
        const want: OutcomeTier = f === 'chest' ? 'jackpot' : f === 'coins' || f === 'gem' ? 'win' : near ? 'nearMiss' : 'lose';
        assert(o.tier === want && o.detail.kind === 'dig' && o.detail.chestNear === near, `보물찾기 등급 (${f}, ${near})`);
        tiers[o.tier]++;
      });
      for (let k = 1; k < play.events.length; k++) assert(play.events[k]!.t >= play.events[k - 1]!.t, '보물찾기 사건 시각 순서');
      assert(pollAll('dig', play).length === play.events.length, '보물찾기 사건이 판 안에 다 나온다');
      if (play.chest >= 0) chests++;
      if (play.found) found++;
    }
    assert(Math.abs(chests / (N * 2) - DIG.chestChance) < 0.015, `보물찾기: 상자가 묻힌 판 ${(chests / (N * 2)).toFixed(3)} ≈ ${DIG.chestChance}`);
    console.log(`  dig 생성기 OK: 상자 ${(chests / (N * 2)).toFixed(3)} (찾음 ${(found / (N * 2)).toFixed(3)}), ${checkOdds('dig', tiers)}`);
  }
  // 오리배: 경주와 같은 생성기, 세부는 boat.
  {
    const tiers = zeroTiers();
    for (let i = 0; i < N; i++) {
      const es = groupEntries(rng, 'boat', rng.int(1, 6));
      const play = groupGame('boat').generate(rng, es, ctxOf('boat'));
      assert(play.kind === 'boat' && play.tracks === play.race.keys, '오리배 판 = 경주');
      es.forEach((e, k) => {
        const o = play.outcomes[k]!;
        assert(o.detail.kind === 'boat' && o.detail.racer === e.pick && o.tier === raceTier(raceOf(play)!, e.pick as RacerIndex), '오리배 등급 = 경주 등급');
        tiers[o.tier]++;
      });
    }
    console.log(`  boat 생성기 OK: ${checkOdds('boat', tiers)}`);
  }
  // 반응 표: 셋째 묶음 부스마다 등급마다 (결과 세부 열쇠마다: 선수·구경 손님, 나온 것) 3~5개, 공통 표와 다르고 부스 안에서 겹치지 않는다.
  for (const b of ['ssireum', 'boat', 'kite', 'tug', 'dig'] as const) {
    const names: string[] = [];
    for (const t of ['jackpot', 'win', 'nearMiss', 'lose'] as OutcomeTier[]) {
      const keys = reactionKeys(b, t);
      for (const k of keys.length > 0 ? keys : [undefined]) {
        const ls = reactionLabels(t, b, k);
        assert(ls.length >= 3 && ls.length <= 5 && ls.every((x) => !reactionLabels(t, null).includes(x)), `${b} ${t}${k === undefined ? '' : ` (${k})`} 반응 후보 3~5개 (${ls.length}), 공통 표와 다름`);
      }
      names.push(...reactionLabels(t, b));
    }
    assert(new Set(names).size === names.length, `${b} 반응 이름이 겹치지 않는다`);
    const gl = groupReactionLabels(b);
    assert(gl.cheer.length >= 6 && gl.spectate.length >= 10 && gl.buzz.length >= 9, `${b} 응원·구경·들썩임 반응 표`);
    for (const x of [...names, ...gl.cheer, ...gl.spectate, ...gl.buzz]) assert(!/씨름|샅바|방패연|도박|겜블|베팅|판돈/.test(x), `${b} 반응 낱말 (${x})`);
  }
  // 놀이마다 꼭 있는 말, 세부가 후보를 좁힌다 (벌러덩은 모래판의 선수만, 헌 장화는 장화가 나온 손님만), 사건마다 다른 응원.
  const has = (ls: readonly string[], x: string): boolean => ls.includes(x);
  assert(has(reactionLabels('jackpot', 'ssireum', 'player'), '뒤집기!') && has(reactionLabels('lose', 'ssireum', 'player'), '벌러덩') && !has(reactionLabels('lose', 'ssireum', 'bettor'), '벌러덩'), '밀어내기: 뒤집기!·벌러덩 (선수만)');
  assert(has(reactionLabels('lose', 'tug'), '우르르') && has(groupReactionLabels('tug', { kind: 'lead', key: 'lead' }).cheer, '영차영차'), '줄다리기: 우르르·영차영차');
  assert(has(reactionLabels('nearMiss', 'dig'), '바로 옆이었는데!') && has(reactionLabels('lose', 'dig', 'boot'), '헌 장화…') && !has(reactionLabels('lose', 'dig', 'pebble'), '헌 장화…'), '보물찾기: 바로 옆이었는데!·헌 장화… (장화만)');
  assert(has(reactionLabels('lose', 'kite', 'player'), '줄이 끊겼다') && has(reactionLabels('jackpot', 'boat'), '물보라 역전'), '연: 줄이 끊겼다, 오리배: 물보라 역전');
  assert(has(groupReactionLabels('ssireum', { kind: 'lead', key: 'flip' }).cheer, '뒤집어라!') && has(groupReactionLabels('ssireum', { kind: 'behind', key: 'flip:other' }).cheer, '어어 뒤집힌다?!'), '밀어내기 뒤집기 응원');
  assert(has(groupReactionLabels('kite', { kind: 'behind', key: 'cut' }).cheer, '앗, 끊어졌다!') && has(groupReactionLabels('kite', { kind: 'lead', key: 'cut:other' }).cheer, '끊었다!'), '연줄 끊김 응원');
  assert(has(groupReactionLabels('dig', { kind: 'behind', key: 'find:other' }).cheer, '옆을 팔걸') && !has(groupReactionLabels('dig', { kind: 'behind', key: 'find' }).cheer, '옆을 팔걸'), '보물찾기: 옆에서 상자가 나오면');
  // 자기 땅에서 나온 것에 맞는 말 (조약돌에 '장화네…'가 나오지 않게).
  const digFind = (f: string): string[] => groupReactionLabels('dig', { kind: 'behind', key: cheerKey('find', 2, 2, f) }).cheer;
  assert(has(digFind('boot'), '장화네…') && !has(digFind('boot'), '에이 돌멩이') && has(digFind('pebble'), '에이 돌멩이') && !has(digFind('pebble'), '장화네…'), '보물찾기: 장화·조약돌마다 다른 응원');
  {
    const probe = { ...new Sim(newGame(2)).state.monsters[0]!, traits: [] };
    for (let i = 0; i < 400; i++) {
      const pl = pickReaction(rng, 'lose', probe, 1, 'ssireum', { kind: 'ssireum', side: 0, role: 'bettor', won: false, flip: false, close: false });
      assert(pl.label !== '벌러덩' && reactionLabels('lose', 'ssireum', 'bettor').includes(pl.label), '구경 손님은 벌러덩하지 않는다');
      const dg = pickReaction(rng, 'lose', probe, 1, 'dig', { kind: 'dig', spot: 0, find: 'pebble', chestNear: false });
      assert(reactionLabels('lose', 'dig', 'pebble').includes(dg.label), '조약돌이 나온 손님의 반응');
    }
  }
  console.log('  셋째 묶음 반응 표 OK');
}

/**
 * 단체 놀이의 고르기 (셋째 묶음 모듈의 순수 규칙): 자리 고르기(seatFor), 구경 손님의 고르기(join), 나서기(stepIn), 진행 중 구경꾼 들썩임(buzz).
 */
function groupChoices(rng: Rng): void {
  const base = new Sim(newGame(1)).state.monsters[0]!;
  const mk = (species: SpeciesId, traits: TraitId[] = [], id = 1): Monster => ({ ...base, id, species, traits });
  const all = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
  const rate = (n: number, f: () => boolean): number => {
    let k = 0;
    for (let i = 0; i < n; i++) if (f()) k++;
    return k / n;
  };
  // 줄다리기: 적은 편으로, 같으면 같은 종 친구 편, 편 안에서는 가운데(작은 자리 번호)부터. 무작위로 앉혀도 편 차이는 1 이하.
  {
    const g = groupGame('tug');
    const seated = (xs: (SpeciesId | null)[]): (Monster | null)[] => xs.map((s, i) => (s === null ? null : mk(s, [], 10 + i)));
    assert(g.seatFor!(rng, mk('pudding'), [3, 4, 5], seated(['dragon', 'crab', 'goblin', null, null, null])) === 3, '줄다리기: 적은 편(청)의 가운데 자리로');
    assert(g.seatFor!(rng, mk('pudding'), [2, 3, 4, 5], seated(['pudding', 'crab', null, null, null, null])) === 2, '줄다리기: 같으면 같은 종 친구 편');
    assert(g.seatFor!(rng, mk('pudding'), [1, 3, 5], seated(['dragon', null, 'goblin', null, 'kabocha', null])) === 1, '줄다리기: 적은 편의 가운데부터');
    for (let i = 0; i < 300; i++) {
      const seats: (Monster | null)[] = Array.from({ length: 8 }, () => null);
      for (let k = 0; k < 8; k++) {
        const free = all(8).filter((j) => seats[j] === null);
        const at = g.seatFor!(rng, mk(rng.pick(SPECIES_IDS)), free, seats);
        assert(free.includes(at), '줄다리기: 빈 자리에');
        seats[at] = mk('dragon', [], 100 + k);
        const red = seats.filter((x, j) => x !== null && j % 2 === 0).length;
        const blue = seats.filter((x, j) => x !== null && j % 2 === 1).length;
        assert(Math.abs(red - blue) <= 1, `줄다리기: 편 차이 1 이하 (${red}:${blue})`);
      }
    }
  }
  // 밀어내기: 대담이는 선수로 잘 나서고 겁쟁이는 구경 자리로, 상대가 기다리면 더 잘 나선다. 구경 손님은 같은 종 선수 쪽, 구경꾼은 많은 쪽, 대담이는 적은 쪽.
  {
    const g = groupGame('ssireum');
    const empty: (Monster | null)[] = Array.from({ length: 6 }, () => null);
    const waiting: (Monster | null)[] = [mk('dragon', [], 50), null, null, null, null, null];
    const ring = (m: Monster, seated: (Monster | null)[], free: number[]): number => rate(3000, () => g.seatFor!(rng, m, free, seated) <= 1);
    const bold = ring(mk('dragon', ['bold']), empty, all(6));
    const coward = ring(mk('crab', ['coward']), empty, all(6));
    const cowardWait = ring(mk('crab', ['coward']), waiting, [1, 2, 3, 4, 5]);
    assert(bold > 0.7 && coward < 0.35 && cowardWait > coward + 0.3, `밀어내기 자리: 대담이 ${bold.toFixed(2)}, 겁쟁이 ${coward.toFixed(2)}, 상대가 기다리면 ${cowardWait.toFixed(2)}`);
    assert(g.seatFor!(rng, mk('dragon', ['bold']), [2, 3], [mk('crab'), mk('goblin'), null, null, null, null]) >= 2, '모래판이 차면 구경 자리');
    assert(g.seatFor!(rng, mk('crab', ['coward']), [1], [mk('dragon'), null, mk('goblin'), mk('pudding'), mk('radish'), mk('kabocha')]) === 1, '구경 자리가 차면 모래판');
    const players: GroupEntry[] = [
      { monster: 1, seat: 0, pick: 0, role: 'player', bet: 5, fee: 2 },
      { monster: 2, seat: 1, pick: 1, role: 'player', bet: 5, fee: 2 },
    ];
    const who = (id: number): Monster | undefined => (id === 1 ? mk('dragon', [], 1) : id === 2 ? mk('crab', [], 2) : id === 5 ? mk('crab', ['coward'], 5) : id === 6 ? mk('kabocha', [], 6) : undefined);
    const kin = rate(2000, () => g.join(rng, 3, mk('crab', [], 9), players, who).pick === 1);
    assert(kin > 0.8, `구경 손님은 같은 종 선수 쪽 (${kin.toFixed(2)})`);
    const crowded: GroupEntry[] = [...players, { monster: 3, seat: 2, pick: 0, role: 'bettor', bet: 5, fee: 2 }, { monster: 4, seat: 3, pick: 0, role: 'bettor', bet: 5, fee: 2 }];
    const follow = rate(2000, () => g.join(rng, 4, mk('turtle', ['watcher'], 9), crowded, who).pick === 0);
    const under = rate(2000, () => g.join(rng, 4, mk('otter', ['bold'], 9), crowded, who).pick === 1);
    assert(follow > 0.7 && under > 0.65, `구경꾼은 많은 편 (${follow.toFixed(2)}), 대담이는 적은 편 (${under.toFixed(2)})`);
    // 나서기: stepInSec 전에는 없고, 뒤에는 겁쟁이가 아닌 구경 손님이 빈 모래판 자리로 (그 편 선수가 된다).
    const lone: GroupEntry[] = [
      { monster: 1, seat: 0, pick: 0, role: 'player', bet: 5, fee: 2 },
      { monster: 5, seat: 3, pick: 0, role: 'bettor', bet: 5, fee: 2 },
      { monster: 6, seat: 4, pick: 0, role: 'bettor', bet: 5, fee: 2 },
    ];
    assert(g.stepIn!(lone, SSIREUM.stepInSec - 0.5, [1, 2, 5], who) === null, '밀어내기: 조금 기다린 뒤에 나선다');
    const s = g.stepIn!(lone, SSIREUM.stepInSec, [1, 2, 5], who);
    assert(s !== null && s.index === 2 && s.seat === 1 && s.pick === 1 && s.role === 'player', `밀어내기: 겁쟁이가 아닌 구경 손님이 빈 모래판 자리로 (${JSON.stringify(s)})`);
    assert(g.stepIn!(lone, 99, [2, 5], who) === null, '밀어내기: 모래판 자리가 없으면 나서지 않는다');
  }
  // 연날리기: 대담이는 연을 날리러, 겁쟁이·구경꾼은 구경 자리로. 구경 손님은 같은 종이 날리는 연.
  {
    const g = groupGame('kite');
    const empty: (Monster | null)[] = Array.from({ length: 6 }, () => null);
    const fly = (m: Monster): number => rate(3000, () => g.seatFor!(rng, m, all(6), empty) < KITE.flyers);
    const bold = fly(mk('dragon', ['bold']));
    const shy = fly(mk('crab', ['coward', 'watcher']));
    assert(bold > 0.75 && shy < bold - 0.4, `연: 대담이 ${bold.toFixed(2)} 날리기, 겁쟁이 구경꾼 ${shy.toFixed(2)}`);
    const flyers: GroupEntry[] = [0, 1, 2, 3].map((k) => ({ monster: 20 + k, seat: k, pick: k, role: 'player', bet: 5, fee: 2 }));
    const who = (id: number): Monster | undefined => (id >= 20 && id < 24 ? mk(id === 22 ? 'owl' : 'dragon', [], id) : undefined);
    const kin = rate(2000, () => g.join(rng, 4, mk('owl', [], 9), flyers, who).pick === 2);
    assert(kin > 0.8, `연: 구경 손님은 같은 종이 날리는 연 (${kin.toFixed(2)})`);
  }
  // 보물찾기: 빈 흙더미 가운데 무작위.
  {
    const g = groupGame('dig');
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const at = g.seatFor!(rng, mk('mole'), [1, 3, 4], Array.from({ length: 6 }, (_, k) => (k === 1 || k === 3 || k === 4 ? null : mk('dragon', [], 30 + k))));
      assert([1, 3, 4].includes(at), '보물찾기: 빈 흙더미에');
      seen.add(at);
    }
    assert(seen.size === 3, '보물찾기: 빈 흙더미 어디나');
  }
  // 오리배: 좋아하는 배가 있는 종은 그 배를 자주.
  {
    const g = groupGame('boat');
    const fan = rate(2000, () => g.join(rng, 0, mk('otter', [], 9), [], () => undefined).pick === 0);
    assert(fan > 0.55, `오리배: 수달은 오리배를 자주 (${fan.toFixed(2)})`);
  }
  // 진행 중 구경꾼 들썩임: 사건마다 맞는 모양.
  {
    const ctxOf = (b: GroupBoothId) => ({ duration: BOOTHS[b].roundSec[0], level: 1, pace: 3, lucky: -1, seats: BOOTHS[b].seats[0] });
    const kinds = new Map<string, number>();
    const count = (k: string): void => {
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
    };
    for (let i = 0; i < 400; i++) {
      for (const b of ['ssireum', 'tug', 'kite', 'dig', 'boat', 'race'] as const) {
        const game = groupGame(b);
        const es = groupEntries(rng, b, b === 'tug' ? 4 : b === 'dig' ? 6 : 4);
        const play = game.generate(rng, es, ctxOf(b));
        for (const ev of pollAll(b, play)) {
          const z = game.buzz?.(play, ev, es) ?? null;
          if (z !== null) {
            assert(z.star >= -1 && z.star < es.length, `${b} 들썩임 주인공`);
            count(`${b}:${ev.type}:${z.kind}`);
          }
          if (b === 'ssireum' || b === 'tug') {
            if (ev.type === 'flip') assert(z?.kind === 'wow', `${b} 뒤집기 = 환호`);
            if (ev.type === 'brink') assert(z?.kind === 'gasp', `${b} 질 뻔함 = 어머나`);
            if (ev.type === 'lead') assert((ev.prev ?? -1) < 0 ? z === null : z?.kind === 'cheer', `${b} 앞선 편이 바뀜 = 박수 (처음은 없음)`);
          }
          if (b === 'kite' && (ev.type === 'tangle' || ev.type === 'brink')) assert(z?.kind === 'gasp', '연싸움·끊길 뻔 = 어머나');
          if (b === 'dig' && play.kind === 'dig' && ev.type === 'find') {
            const f = play.finds[ev.actor];
            assert(z?.kind === (f === 'chest' ? 'wow' : f === 'coins' || f === 'gem' ? 'cheer' : f === 'boot' ? 'laugh' : undefined), `보물찾기 들썩임 (${f})`);
          }
          if ((b === 'race' || b === 'boat') && z !== null) {
            const r = raceOf(play)!;
            assert(ev.type === 'lead' && ev.t >= r.finishAt[r.finishOrder[0]!]! * TUNE.raceBuzzFrom, `${b} 들썩임은 막판 1등 바뀜만`);
          }
        }
      }
    }
    for (const k of ['ssireum:flip:wow', 'ssireum:brink:gasp', 'tug:flip:wow', 'kite:tangle:gasp', 'kite:cut:wow', 'dig:find:wow', 'dig:find:laugh', 'dig:reveal:gasp', 'race:lead:cheer', 'boat:lead:cheer']) assert((kinds.get(k) ?? 0) > 0, `들썩임 ${k}이 나온다`);
  }
  console.log('  셋째 묶음 고르기 OK: 줄다리기 편 맞추기, 밀어내기 선수·구경·나서기, 연 날리기·구경, 보물찾기 자리, 오리배 팬, 구경꾼 들썩임');
}

/** 밀어내기: 선수 하나와 구경 손님 하나만 앉아 상대가 오지 않으면, 구경 손님이 모래판으로 나서 판이 열린다 (손님은 더 오지 않는다). */
function ssireumStepIn(): void {
  const r = new Sim(newGame(77));
  devOpenAll(r);
  const rs = r.state;
  for (const x of BOOTH_IDS) if (x !== 'ssireum') rs.booths[x].unlocked = false;
  rs.monsters = rs.monsters.slice(0, 2);
  rs.spawnTimer = 1e9;
  const bs = rs.booths.ssireum;
  const [a, c] = rs.monsters as [Monster, Monster];
  const sit = (m: Monster, seat: number): void => {
    m.traits = ['cheerful'];
    m.wallet = 200;
    m.booth = 'ssireum';
    m.seat = seat;
    m.phase = 'toSeat';
    m.phaseTime = 0;
    m.path = [{ ...BOOTH_SPOTS.ssireum.seats[seat]! }];
    bs.seats[seat] = m.id;
  };
  sit(a, 0);
  sit(c, 3);
  let stepped = false;
  let started: GroupState | null = null;
  r.bus.on('groupJoined', (e) => {
    if (e.monster === c.id && e.role === 'player') stepped = true;
  });
  r.bus.on('groupStarted', (e) => {
    started ??= JSON.parse(JSON.stringify(e.group)) as GroupState;
  });
  for (let i = 0; i < 600 && started === null; i++) runFor(r, SIM.dt);
  const g = started as GroupState | null;
  assert(stepped && g !== null, '밀어내기: 구경 손님이 나서 판이 열린다');
  const ps = g.participants;
  assert(ps.length === 2 && ps.some((e) => e.monster === a.id && e.pick === 0 && e.role === 'player') && ps.some((e) => e.monster === c.id && e.pick === 1 && e.role === 'player' && e.seat === 1), '밀어내기: 나선 손님은 청 선수');
  assert(g.elapsed === 0 && rs.booths.ssireum.group?.phase === 'running', '밀어내기: 나선 뒤 곧 출발');
  console.log(`  밀어내기 나서기 OK (출발 ${(rs.time).toFixed(1)}초)`);
}

/** 부스 b 하나만 연 마을 (모든 진행자 고용, 그 밖의 부스는 닫는다)을 sec초. */
function groupLifecycles(): void {
  for (const b of ['ssireum', 'boat', 'kite', 'tug', 'dig'] as const) {
    const r = new Sim(newGame(40 + GROUP_BOOTHS.indexOf(b)));
    devOpenAll(r);
    const rs = r.state;
    for (const x of BOOTH_IDS) if (x !== b) rs.booths[x].unlocked = false;
    const bs = rs.booths[b];
    const g = bs.group!;
    let started = 0;
    let done = 0;
    let settled = 0;
    let events = 0;
    let cheers = 0;
    let runners = 0;
    let crowd = 0;
    let buzz = 0;
    let badCheer = 0;
    let badReact = 0;
    /** 결과를 받은 손님 → 그 한판 (monsterReact가 바로 뒤에 온다). */
    const finished = new Map<number, RoundOutcome>();
    const festivalOf = new Set<number>();
    const wallets = new Map<number, number>();
    let expected = new Map<number, RoundOutcome>();
    const payouts: { monster: number; payout: number; cap: number }[] = [];
    /** 판마다 지급 (한꺼번에 나누나: 먼저 온 승자가 항아리를 비우지 않게). */
    const roundPays: { monster: number; payout: number; cap: number }[][] = [];
    /** 줄다리기 편 맞추기로 빠진 손님 → 빠질 때의 쓴 코인 (다시 참가할 때 참가비를 다시 내지 않나). */
    const joinedNow = new Set<number>();
    const benchSpent = new Map<number, number>();
    let rejoined = 0;
    r.bus.on('groupJoined', (e) => {
      if (e.booth !== b) return;
      assert(g.phase === 'gathering' && g.participants.some((p) => p.monster === e.monster && p.pick === e.pick && p.seat === e.seat), `${b} 참가하면 모이는 중, 목록에`);
      const m = r.monster(e.monster)!;
      wallets.set(e.monster, m.wallet);
      const was = benchSpent.get(e.monster);
      if (was !== undefined) {
        assert(m.stats.spent - was === e.bet, `${b} 편 맞추기로 빠졌던 손님은 참가비를 다시 내지 않는다 (${m.stats.spent - was} ≠ ${e.bet})`);
        benchSpent.delete(e.monster);
        rejoined++;
      }
      joinedNow.add(e.monster);
    });
    r.bus.on('groupCancelled', (e) => {
      if (e.booth === b) joinedNow.clear();
    });
    r.bus.on('groupStarted', (e) => {
      if (e.booth !== b) return;
      started++;
      const ps = e.group.participants;
      for (const id of joinedNow) {
        const m = r.monster(id);
        if (m !== undefined && m.booth === b && bs.seats.includes(id) && !ps.some((p) => p.monster === id)) benchSpent.set(id, m.stats.spent);
      }
      joinedNow.clear();
      runners += ps.length;
      const play = e.group.play!;
      assert(play.kind === b && play.outcomes.length === ps.length, `${b} 판 = 참가자 수`);
      if (b === 'ssireum') assert(ps.some((p) => p.role === 'player' && p.pick === 0) && ps.some((p) => p.role === 'player' && p.pick === 1), '씨름은 선수 둘이 있어야 시작');
      if (b === 'tug') {
        const red = ps.filter((p) => p.pick === 0).length;
        assert(red === ps.length - red && red >= 1 && red <= TUG.maxSide, `줄다리기 편 인원 (${red}:${ps.length - red})`);
      }
      // 판 길이: 경주장·오리배 밖은 진행이 높을수록 조금 짧게.
      const pace = boothStat(rs, b, 'pace');
      const want = BOOTHS[b].roundSec[bs.level - 1]! / (b === 'boat' ? 1 : 1 + (pace - 3) * TUNE.groupPacePerPoint);
      assert(Math.abs(play.end - want) < 1e-9, `${b} 판 길이 ${play.end.toFixed(2)} = roundSec / 진행 (${want.toFixed(2)})`);
      // 자리마다 역할: 밀어내기 0·1 선수, 연 0~3 날리는 손님, 그 밖은 구경 손님.
      for (const p of ps) {
        if (b === 'ssireum') assert((p.seat <= 1) === (p.role === 'player') && (p.role === 'bettor' || p.pick === p.seat), '밀어내기 자리와 역할');
        if (b === 'kite') assert((p.seat < KITE.flyers) === (p.role === 'player') && (p.role === 'bettor' || p.pick === p.seat), '연 자리와 역할');
        if (b === 'dig') assert(p.pick === p.seat, '보물찾기 판 자리 = 자리');
      }
      expected = new Map(ps.map((p, i) => [p.monster, play.outcomes[i]!]));
      ps.forEach((p) => {
        const round = bs.rounds[p.seat];
        assert(round !== null && round !== undefined && round.monster === p.monster && round.outcome === expected.get(p.monster), `${b} 참가자마다 한판 (결과 = 판의 결과)`);
      });
    });
    r.bus.on('groupEvent', (e) => {
      if (e.booth !== b) return;
      events++;
      assert(e.group.phase === 'running' && e.event.t <= e.group.elapsed + 1e-9, `${b} 사건은 진행 중, 시각이 된 뒤`);
      for (const ch of e.cheers) {
        assert(e.group.participants.some((p) => p.monster === ch.id && p.pick === ch.pick), `${b} 응원은 참가자만`);
        const detail = e.group.play === null ? null : (groupGame(b).cheerDetail?.(e.group.play, e.event) ?? null);
        if (!groupReactionLabels(b, { kind: ch.kind, key: cheerKey(e.event.type, e.event.actor, ch.pick, detail) }).cheer.includes(ch.reaction.label)) badCheer++;
        cheers++;
      }
    });
    r.bus.on('groupFinished', (e) => {
      if (e.booth !== b) return;
      done++;
      roundPays.push([]);
    });
    r.bus.on('roundFinished', (e) => {
      if (e.booth !== b) return;
      const want = expected.get(e.round.monster);
      assert(want !== undefined && e.round.outcome === want && g.phase === 'done', `${b} 결과는 판이 끝날 때, 판이 정한 그대로`);
      const m = r.monster(e.round.monster)!;
      assert(m.wallet === (wallets.get(m.id) ?? NaN) + e.payout, `${b} 지갑 = 참가 뒤 지갑 + 지급`);
      payouts.push({ monster: m.id, payout: e.payout, cap: Math.round(e.round.bet * e.round.outcome.multiplier) });
      roundPays[roundPays.length - 1]?.push(payouts[payouts.length - 1]!);
      finished.set(m.id, e.round.outcome);
      settled++;
    });
    r.bus.on('potFestival', (x) => {
      if (x.booth === b) festivalOf.add(x.monster);
    });
    r.bus.on('monsterSpectate', (x) => {
      if (g.phase === 'done') crowd++;
      if (g.phase === 'running') {
        assert(!g.participants.some((p) => p.monster === x.id) && g.participants.some((p) => p.monster === x.target), `${b} 진행 중 구경꾼은 참가자가 아니고, 주인공은 참가자`);
        buzz++;
      }
    });
    r.bus.on('monsterReact', (x) => {
      const o = finished.get(x.id);
      if (o === undefined) return;
      finished.delete(x.id);
      const keys = detailKeys(o.detail);
      // 항아리 축제·빈털터리는 공통 표, 빚 걸기 판의 채무자는 빚 반응 (반·0·늘어남).
      const debtLabels = (['matchHalved', 'matchCleared', 'matchAdded'] as const).flatMap((k) => debtReactionLabels(k));
      const ok = reactionLabels(o.tier, b, keys[0]).includes(x.reaction.label) || reactionLabels('broke').includes(x.reaction.label) || reactionLabels('jackpot').includes(x.reaction.label) || debtLabels.includes(x.reaction.label);
      if (!ok) badReact++;
    });
    runFor(r, 900);
    for (const p of payouts) {
      if (p.cap === 0) assert(p.payout === 0, `${b} 진 손님은 받지 않는다`);
      else assert(p.payout <= p.cap || festivalOf.has(p.monster), `${b} 지급 ≤ 배당 × 건 코인 (항아리 축제 말고) ${p.payout}/${p.cap}`);
    }
    // 항아리가 모자라면 판의 승자 모두 같은 비율로 (참가 차례로 주면 늦게 온 승자가 0코인).
    let short = 0;
    for (const rp of roundPays) {
      const paid = rp.filter((p) => p.cap > 0 && !festivalOf.has(p.monster));
      const top = Math.max(0, ...paid.map((p) => p.payout / p.cap));
      for (const p of paid) assert(p.payout / p.cap > top - 1 / p.cap - 1e-9, `${b} 한 판의 승자는 같은 비율로 받는다 (${p.payout}/${p.cap}, 가장 많이 ${top.toFixed(2)})`);
      if (top < 1) short++;
    }
    if (b === 'tug') assert(rejoined > 0, `줄다리기 편 맞추기로 빠졌다 다시 든 손님 (${rejoined})`);
    // 판 중 저장·불러오기: 같은 상태에서 같은 미래.
    for (let i = 0; i < 1200 && g.phase !== 'running'; i++) runFor(r, SIM.dt);
    if (g.phase === 'running') {
      const twin = new Sim(normalizeState(JSON.parse(JSON.stringify(rs)))!);
      runFor(r, 30);
      runFor(twin, 30);
      assert(stripTime(r.state) === stripTime(twin.state), `${b} 판 중 저장·불러오기 뒤 30초가 똑같이 흐른다`);
    }
    // 진행자가 빠지면 모이던 판을 접고, 달리던 판은 끝까지.
    const host = bs.staff[0]!;
    assert(r.assign(host, null).ok && !r.boothOpen(b), `${b} 진행자가 쉬면 닫힌다`);
    runFor(r, 60);
    assert(bs.seats.every((x) => x === null) && g.phase === 'idle', `${b} 닫히면 자리가 비고 쉰다`);
    for (const x of BOOTH_IDS) rs.booths[x].unlocked = true;
    checkInvariants(r);
    assert(started >= 8 && done >= started - 1 && settled >= started && events > 0, `${b} 판 ${started} (끝 ${done}, 결과 ${settled}, 사건 ${events})`);
    assert(badCheer === 0 && badReact === 0, `${b} 응원은 사건마다, 결과 반응은 세부마다 맞는 말 (어긋남 ${badCheer}·${badReact})`);
    assert(buzz > 0, `${b} 진행 중 구경꾼이 들썩인다 (${buzz})`);
    console.log(`  ${b} 엔진 OK: ${started}판 (평균 ${(runners / started).toFixed(1)}명), 결과 ${settled}, 사건 ${events} (응원 ${cheers}), 진행 중 구경 ${buzz}, 결과 구경 ${crowd}, 항아리가 모자란 판 ${short}${b === 'tug' ? `, 빠졌다 다시 든 손님 ${rejoined}` : ''}`);
  }
  // 옛 저장(2) → 3: 경주장 race 칸이 group으로 옮겨지고 마을이 그대로 이어진다.
  // 셋째 묶음 전의 마을처럼: 회관 3까지, 경주장만 연다 (새 부스는 닫힌 채, 새 진행자는 후보로만).
  {
    const a = new Sim(newGame(31));
    const as = a.state;
    as.coins = 50_000;
    as.precious = { gem: 20, golden_acorn: 20, star_piece: 20 };
    const fill = (): void => {
      for (const k of Object.keys(as.materials) as MaterialId[]) as.materials[k] = a.materialCap();
    };
    while (a.upgradeBuilding('warehouse').ok) fill();
    fill();
    assert(a.upgradeBuilding('hall').ok && a.upgradeBuilding('hall').ok && a.unlockBooth('race').ok, '회관 3, 경주장');
    for (const art of ['race_starter', 'race_caster']) {
      const i = as.candidates.findIndex((c) => c.art === art);
      assert(i >= 0 && a.hire(i).ok, `${art} 고용`);
    }
    for (const k of Object.keys(as.materials) as MaterialId[]) as.materials[k] = 5;
    for (let i = 0; i < 3000 && a.state.booths.race.group?.phase !== 'running'; i++) runFor(a, SIM.dt);
    assert(a.state.booths.race.group?.phase === 'running', '경주가 달리는 중');
    const old = JSON.parse(JSON.stringify(a.state)) as Record<string, unknown> & { booths: Record<string, Record<string, unknown>> };
    old.version = 2;
    for (const [k, bsv] of Object.entries(old.booths)) {
      const gv = bsv.group as (GroupState & Record<string, unknown>) | null;
      delete bsv.group;
      if (!['slot', 'oddeven', 'cups', 'darts', 'wheel', 'duck', 'ring', 'race', 'claw', 'pouch'].includes(k)) {
        delete old.booths[k];
        continue;
      }
      if (gv === null || gv === undefined) {
        bsv.race = null;
        continue;
      }
      const race: Record<string, unknown> = { phase: gv.phase, countdown: gv.countdown, elapsed: gv.elapsed, duration: gv.duration, participants: gv.participants.map((e) => ({ monster: e.monster, seat: e.seat, racer: e.pick, bet: e.bet, fee: e.fee })), result: raceOf(gv.play) };
      if ('mark' in gv) race.leader = gv.mark;
      if ('markAt' in gv) race.cheerAt = gv.markAt;
      bsv.race = race;
    }
    const back = normalizeState(old);
    assert(back !== null && back.version === 4, '옛 저장(2)을 읽는다 (2 → 3 → 4)');
    const twin = new Sim(back);
    runFor(a, 40);
    runFor(twin, 40);
    // 새로 채운 부스 칸은 뒤에 붙으니 열쇠 순서를 맞춰 비교한다.
    const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v);
    const strip = (st: GameState): string => {
      const o = JSON.parse(stripTime(st)) as { booths: Record<string, { group: Record<string, unknown> | null }> };
      for (const bsv of Object.values(o.booths)) if (bsv.group !== null) delete bsv.group.cursor;
      return JSON.stringify(canon(o));
    };
    assert(strip(a.state) === strip(twin.state), '옛 저장(2)에서 이어도 경주가 똑같이 흐른다');
    console.log('  옛 저장(2 → 3) OK');
  }
}


/// ── 넷째 묶음 (장신구·전당포·은행·파산·일터·빚 걸기 판) 시험 ───────────────────

/** 부스 하나(b)만 열고 나머지는 닫은 마을 + 전당포·은행·일터 레벨 1, 금고 넉넉. */
function debtVillage(seed: number, only: BoothId | null = 'slot'): Sim {
  const s = new Sim(newGame(seed));
  devOpenAll(s);
  if (only !== null) for (const b of BOOTH_IDS) if (b !== only) s.state.booths[b].unlocked = false;
  for (const id of ['pawnshop', 'bank', 'workyard'] as BuildingId[]) s.state.buildings[id].level = 1;
  s.state.coins = 5000;
  // 처음 손님은 지우고 새 손님도 오지 않게 (시험 손님만).
  s.state.monsters.length = 0;
  s.state.spawnTimer = 1e9;
  return s;
}

/** 손님 하나를 광장에 (시험용: 장신구·지갑·기분·성격을 정한다). 쓴 코인 60 (처음 지갑 = 지갑 + 60). */
function testGuest(s: Sim, opts: { wallet: number; mood?: number; acc?: { key: AccessoryId; value: number }[]; species?: SpeciesId; traits?: TraitId[]; patience?: number }): Monster {
  const st = s.state;
  const rng = new Rng(st.nextId * 31 + 7);
  const m = createMonster(rng, st, st.nextId++, { x: 3200, y: 4600 }, null);
  if (opts.species !== undefined) m.species = opts.species;
  m.phase = 'wandering';
  m.timer = 0.2;
  m.wallet = opts.wallet;
  m.mood = opts.mood ?? 70;
  m.patience = opts.patience ?? 6;
  m.traits = opts.traits ?? ['cheerful'];
  m.accessories = (opts.acc ?? []).map((a) => ({ key: a.key, slot: ACCESSORIES[a.key].slot, value: a.value }));
  m.firstPlay = st.time;
  m.stats.spent = 60;
  st.monsters.push(m);
  return m;
}

/** 조건이 맞을 때까지 (최대 sec초) 돌린다. 맞았으면 true. */
function runUntil(s: Sim, sec: number, cond: () => boolean): boolean {
  const n = Math.round(sec / SIM.dt);
  for (let i = 0; i < n; i++) {
    s.tick(SIM.dt);
    checkInvariants(s);
    if (cond()) return true;
  }
  return cond();
}

/** 더 놀고 싶은 마음 (PAWN·BANK.want)과 빚 쫓기 (BANK.chase)를 고정해 fn을 돌린다 (시험용: 확률을 빼고 흐름만 본다). */
function withWant<T>(p: number, fn: () => T, chase: number | null = null): T {
  const tables = [PAWN.want, BANK.want] as unknown as { lo: number; hi: number }[];
  const ch = BANK.chase as unknown as { chance: number };
  const saved = tables.map((t) => [t.lo, t.hi] as const);
  const savedChase = ch.chance;
  for (const t of tables) {
    t.lo = p;
    t.hi = p;
  }
  if (chase !== null) ch.chance = chase;
  try {
    return fn();
  } finally {
    tables.forEach((t, i) => {
      const v = saved[i];
      if (v !== undefined) [t.lo, t.hi] = v;
    });
    ch.chance = savedChase;
  }
}

/** 이 손님의 반응 이름을 모은다 (monsterReact). */
function reactLog(s: Sim, id: number): string[] {
  const out: string[] = [];
  s.bus.on('monsterReact', (e) => {
    if (e.id === id) out.push(e.reaction.label);
  });
  return out;
}

function debtFlows(): void {
  // a) 장신구 고르기: 하나 35%·둘 8% 안팎, 자리가 겹치지 않고, 고블린에게 돈주머니는 없다.
  {
    const rng = new Rng(7);
    let one = 0;
    let two = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const sp = SPECIES_IDS[i % SPECIES_IDS.length] as SpeciesId;
      const list = rollAccessories(rng, sp);
      if (list.length === 1) one++;
      if (list.length === 2) two++;
      assert(new Set(list.map((a) => a.slot)).size === list.length, '장신구 자리가 겹치지 않는다');
      for (const a of list) {
        const d = ACCESSORIES[a.key];
        assert(a.slot === d.slot && a.value >= d.value[0] && a.value <= d.value[1], `장신구 ${a.key} 자리·값`);
        assert(!(sp === 'goblin' && a.key === 'acc_coin_pouch'), '고블린에게 돈주머니를 달지 않는다');
      }
    }
    assert(Math.abs(one / N - ACCESSORY_SPAWN.one) < 0.02 && Math.abs(two / N - ACCESSORY_SPAWN.two) < 0.015, `장신구 비율 하나 ${(one / N).toFixed(3)} 둘 ${(two / N).toFixed(3)}`);
    console.log(`  장신구 고르기 OK: 하나 ${((one / N) * 100).toFixed(1)}%, 둘 ${((two / N) * 100).toFixed(1)}%`);
  }

  // a2) 더 놀고 싶은 마음: 기분·끈기가 클수록 크고, 대담이는 더, 겁쟁이는 은행을 덜, 언제나 lo~hi.
  {
    const g = (mood: number, patience: number, traits: TraitId[], t: typeof PAWN.want | typeof BANK.want) => wantMore({ mood, patience, traits }, t);
    for (const t of [PAWN.want, BANK.want]) {
      assert(g(90, 5, [], t) > g(30, 5, [], t) && g(60, 8, [], t) > g(60, 1, [], t), '기분·끈기가 클수록 더 놀고 싶다');
      assert(g(60, 5, ['bold'], t) > g(60, 5, [], t), '대담이는 더 놀고 싶다');
      for (const mood of [0, 50, 100]) for (const p of [0, 9, 30]) for (const tr of [[], ['bold', 'lucky'], ['coward']] as TraitId[][]) {
        const v = g(mood, p, tr, t);
        assert(v >= t.lo - 1e-9 && v <= t.hi + 1e-9, `더 놀고 싶은 마음 ${v} (${t.lo}~${t.hi})`);
      }
    }
    assert(g(60, 5, ['coward'], BANK.want) < g(60, 5, [], BANK.want) - 0.2, '겁쟁이는 은행을 무서워한다');
    // 빚 걸기 판 짝: 빚이 비슷한 채무자끼리.
    const rng = new Rng(3);
    for (let i = 0; i < 50; i++) {
      const pool = [{ debt: 10 }, { debt: 55 }, { debt: 12 }, { debt: 50 }];
      const out = pairDebtors(rng, pool, 2);
      assert(out.length === 4, '짝 둘');
      for (let k = 0; k < 4; k += 2) assert(Math.abs((out[k]?.debt ?? 0) - (out[k + 1]?.debt ?? 0)) <= 5, `짝은 빚이 비슷하다 (${out.map((x) => x.debt).join(',')})`);
      assert(pairDebtors(rng, pool.slice(0, 3), 2).length === 2 && pairDebtors(rng, pool.slice(0, 1), 1).length === 0, '모자라면 짝 수만큼');
    }
    console.log('  더 놀고 싶은 마음·빚 걸기 짝 OK');
  }

  // b) 전당포: 돈이 떨어진 손님이 장신구를 맡기고 (금고에서 빌린다, '맡겨야겠다…'), 따면 되찾는다. 못 찾고 떠나면 컬렉션.
  withWant(1, () => {
    const s = debtVillage(11);
    const st = s.state;
    const m = testGuest(s, { wallet: 1, acc: [{ key: 'acc_ribbon', value: 26 }, { key: 'acc_scarf', value: 33 }] });
    const labels = reactLog(s, m.id);
    const coins0 = st.coins;
    let pawnedEv = 0;
    s.bus.on('pawned', (e) => {
      if (e.id === m.id) pawnedEv++;
    });
    assert(runUntil(s, 60, () => m.pawned.length > 0), '돈이 떨어진 손님이 전당포에 맡긴다');
    const t = m.pawned[0]!;
    assert(t.key === 'acc_scarf' && t.price === pawnPrice(st, { value: 33 }) && pawnedEv === 1, '값이 가장 큰 장신구를 맡기고 그 값을 빌린다');
    assert(st.coins === coins0 - t.price && !m.accessories.some((a) => a.key === 'acc_scarf'), '금고에서 나가고 몸에서 빠진다');
    assert(debtReactionLabels('seekPawn').some((l) => labels.includes(l)) && debtReactionLabels('pawn').some((l) => labels.includes(l)), `맡기러 가며·맡기고 반응 (${labels.join(', ')})`);
    // 따서 지갑이 넉넉해지면 되찾는다.
    m.wallet = 200;
    const coins1 = st.coins;
    assert(runUntil(s, 90, () => m.pawned.length === 0), '지갑이 넉넉해지면 되찾는다');
    assert(m.accessories.some((a) => a.key === 'acc_scarf') && st.coins >= coins1 + redeemCost(t) - 1 && st.debtTotals.redeemed === 1, '되찾으면 다시 몸에, 금고로 값 × 1.25');
    assert(labels.includes('되찾았다!') || debtReactionLabels('redeem').some((l) => labels.includes(l)), '되찾으면 기쁨');
    // 못 찾고 떠나면 컬렉션으로.
    const m2 = testGuest(s, { wallet: 1, acc: [{ key: 'acc_mini_crown', value: 100 }] });
    assert(runUntil(s, 60, () => m2.pawned.length > 0), '왕관을 맡긴다');
    m2.wallet = 0;
    m2.patience = 0;
    let firstToast = false;
    s.bus.on('pawnCollected', (e) => {
      if (e.key === 'acc_mini_crown' && e.first && e.from === m2.id) firstToast = true;
    });
    assert(runUntil(s, 200, () => s.monster(m2.id) === undefined), '못 찾고 떠난다');
    assert((st.pawnCollection.acc_mini_crown ?? 0) === 1 && firstToast && st.debtTotals.forfeited === 1, '못 찾고 떠난 장신구는 전당포 컬렉션에');
    console.log(`  전당포 OK: 맡김 ${st.debtTotals.pawned}, 되찾음 ${st.debtTotals.redeemed}, 컬렉션 ${JSON.stringify(st.pawnCollection)}`);
  });

  // b2) 더 놀기 싫다: 거의 다 잃었을 때 한 번, 정말 못 놀 때 한 번만 묻는다 ('싫다'면 그 단계에서는 다시 묻지 않는다).
  withWant(0, () => {
    const s = debtVillage(19);
    const st = s.state;
    const m = testGuest(s, { wallet: 20, acc: [{ key: 'acc_ribbon', value: 26 }] });
    // 처음 지갑 80의 35%보다 적지만 아직 한판은 된다 → low.
    assert(m.wallet >= minPlayCost(st) && m.wallet < 80 * PAWN.lowFrac, '시험 손님은 거의 다 잃었다');
    assert(runUntil(s, 30, () => m.declined === 'low'), '거의 다 잃었을 때 묻고 싫다고 한다');
    assert(m.pawned.length === 0 && m.errand !== 'pawn', '싫으면 맡기지 않는다');
    m.wallet = 0;
    assert(runUntil(s, 60, () => m.declined === 'broke' || s.monster(m.id) === undefined), '정말 못 놀 때 다시 묻는다');
    assert(st.debtTotals.pawned === 0, '싫다고 한 손님은 맡기지 않는다');
    // 싫다고 한 단계에서는 다시 묻지 않는다 (지금 마음이 바뀌어도).
    const m3 = testGuest(s, { wallet: 0, acc: [{ key: 'acc_ribbon', value: 26 }] });
    m3.declined = 'broke';
    withWant(1, () => runUntil(s, 40, () => s.monster(m3.id) === undefined || m3.phase === 'leaving'));
    assert(m3.pawned.length === 0 && st.debtTotals.pawned === 0, '정말 못 놀 때 싫다고 했으면 다시 묻지 않는다');
    console.log('  더 놀기 싫다 OK (한 단계에 한 번)');
  });

  // c) 금고가 모자라면 빌려주지 않는다 (코인이 음수가 되지 않고, 빌려준 뒤에도 VAULT.reserve가 남는다).
  withWant(1, () => {
    const s = debtVillage(12);
    const st = s.state;
    st.coins = 10;
    let empty = 0;
    s.bus.on('vaultEmpty', () => empty++);
    const m = testGuest(s, { wallet: 0, acc: [{ key: 'acc_ribbon', value: 25 }] });
    runFor(s, 30);
    assert(m.pawned.length === 0 && m.debt === 0 && st.coins >= 0 && empty >= 1 && m.declined === 'broke', '금고가 모자라면 맡기기·대출 없음 (vaultEmpty)');
    // 금고가 빌려줄 만큼: 빌려준 뒤에도 reserve가 남는다.
    st.coins = VAULT.reserve + 25;
    const m2 = testGuest(s, { wallet: 0, acc: [{ key: 'acc_ribbon', value: 25 }] });
    assert(runUntil(s, 60, () => m2.pawned.length > 0), '금고가 빌려줄 만큼이면 맡긴다');
    assert(st.coins >= VAULT.reserve, `빌려준 뒤에도 금고 ${st.coins} ≥ ${VAULT.reserve}`);
    console.log('  금고 OK');
  });

  // d) 은행 → 빚 쫓기 → 파산 → 일터 → 다 갚음: 장신구가 없으면 빌리고 ('빌려야겠다…'), 갚을 만큼 없으면 '한판만 더' (BANK.chase.max까지),
  //    떠날 때 못 갚으면 파산해서 일하고 (1코인마다 laborTick, 재료 coinsPerMat마다 + 한숨·영차), 다 갚으면 단골 ('다시 일어선 단골')로 떠난다.
  withWant(
    1,
    () => {
      const s = debtVillage(13);
      const st = s.state;
      const m = testGuest(s, { wallet: 1 });
      const labels = reactLog(s, m.id);
      assert(runUntil(s, 60, () => m.debt > 0), '장신구가 없는 손님은 은행에서 빌린다');
      const loan = bankLoan(st);
      assert(m.debt === loanDebt(loan) && m.loans === 1 && st.debtTotals.loans === 1, `빌린 코인 ${loan}, 갚을 돈 ×${BANK.interest}`);
      assert(debtReactionLabels('seekLoan').some((l) => labels.includes(l)), '빌리러 가며 반응');
      // 빚이 있으면 더 빌려주지 않는다.
      assert(!bankOpenFor(st, m), '빚이 있으면 은행이 더 빌려주지 않는다');
      // 끈기가 다 됐지만 갚을 만큼 없다: 한판만 더 (확률 1로 BANK.chase.max번).
      let paid = -1;
      let left = -1;
      s.bus.on('bankrupt', (e) => {
        if (e.id !== m.id) return;
        paid = e.paid;
        left = e.debt;
      });
      m.wallet = 30;
      m.patience = 0;
      const rounds0 = m.stats.rounds;
      assert(runUntil(s, 300, () => (m.chased ?? 0) >= BANK.chase.max || m.bankrupt === true || m.debt === 0), '빚을 갚으려고 한판만 더');
      assert(m.stats.rounds > rounds0, `끈기가 다 된 뒤에도 더 놀았다 (${m.stats.rounds - rounds0}판)`);
      // 다 잃고 떠난다 → 파산.
      if (m.bankrupt !== true) {
        m.wallet = 3;
        m.patience = 0;
        m.chased = BANK.chase.max;
        if (m.debt === 0) m.debt = loanDebt(loan);
      }
      assert(runUntil(s, 120, () => m.bankrupt === true), '떠날 때 못 갚으면 파산');
      assert(paid >= 0 && left === m.debt && m.wallet === 0 && m.labor?.since !== undefined, `지갑을 다 내고 (${paid}) 남은 빚 ${m.debt}`);
      assert(runUntil(s, 180, () => m.phase === 'working'), '일터로 가서 일한다');
      let ticks = 0;
      let outs = 0;
      s.bus.on('laborTick', (e) => {
        if (e.id !== m.id) return;
        ticks++;
        assert(e.debt === m.debt && e.total >= e.debt, 'laborTick = 남은 빚');
      });
      s.bus.on('laborOutput', (e) => {
        if (e.id === m.id) outs++;
      });
      const debt1 = m.debt;
      const mats0 = st.materials.mat_veggie + st.materials.mat_ore;
      runFor(s, LABOR.secPerCoin * LABOR.coinsPerMat * 1.2);
      assert(m.debt < debt1 && ticks === debt1 - m.debt && outs >= 1 && st.materials.mat_veggie + st.materials.mat_ore > mats0 && st.debtTotals.laborMats >= 1, `일하면 빚이 줄고 (1코인마다 laborTick ${ticks}) 재료가 나온다 (${outs})`);
      assert([...debtReactionLabels('laborFarm'), ...debtReactionLabels('laborMine'), ...debtReactionLabels('cheered')].some((l) => labels.includes(l)), `일하며 한숨·영차 (${labels.join(', ')})`);
      // 응원하면 잠깐 빨라진다.
      const rate0 = laborRate(st, m);
      assert(s.cheer(m.id).ok && laborRate(st, m) > rate0 * 1.4 - 1e-9, '응원 톡 = 잠깐 빨라진다');
      // 다 갚는다.
      m.debt = 2;
      let cleared: boolean | null = null;
      s.bus.on('debtCleared', (e) => {
        if (e.id === m.id) cleared = e.forgiven;
      });
      assert(runUntil(s, 30, () => cleared !== null), '다 갚으면 홀가분');
      const got = cleared as boolean | null;
      assert(got === false && m.bankrupt === false && m.phase === 'relieved', '스스로 다 갚았다 (반장이 덜어 준 것 아님)');
      // 단골 목록에는 떠나는 순간에 (마을에 있는 동안 같은 단골이 또 오지 않게).
      const isReg = (): boolean => (st.regulars ?? []).some((r) => r.nickname === m.nickname && r.species === m.species && r.recovered === true);
      assert(!isReg(), '다 갚고 아직 마을에 있는 동안은 단골 목록에 없다');
      assert(debtReactionLabels('relieved').some((l) => labels.includes(l)), '다 갚은 반응');
      // 파산했던 손님은 떠날 때 종 재료·귀한 물건을 남기지 않는다 (기분이 좋아도).
      m.mood = 100;
      m.hadJackpot = true;
      let leftEv: SimEvents['monsterLeft'] | null = null;
      s.bus.on('monsterLeft', (e) => {
        if (e.id === m.id) leftEv = e;
      });
      assert(runUntil(s, 300, () => s.monster(m.id) === undefined), '다 갚고 떠난다');
      const gone = leftEv as SimEvents['monsterLeft'] | null;
      assert(gone !== null && gone.material === null && gone.precious === null, '파산했던 손님은 떠날 때 종 재료·귀한 물건이 없다');
      assert(isReg(), '다 갚고 떠나면 다시 일어선 단골');
      assert(st.debtTotals.relieved === 1 && st.debtTotals.bankrupt === 1 && st.debtTotals.forgiven === 0, '파산 1 다 갚음 1');
      console.log(`  은행·빚 쫓기·파산·일터 OK: 빌림 ${loan} → 빚 ${loanDebt(loan)}, 한판만 더 ${BANK.chase.max}번, 일터 재료 ${st.debtTotals.laborMats}`);
    },
    1,
  );

  // d2) 떠나기 전에 낼 수 있으면: 은행 빚을 갚고, 맡긴 장신구를 되찾고 떠난다 (파산·컬렉션 없음).
  withWant(1, () => {
    const s = debtVillage(20);
    const st = s.state;
    const m = testGuest(s, { wallet: 1, acc: [{ key: 'acc_star_pin', value: 24 }] });
    assert(runUntil(s, 60, () => m.pawned.length > 0), '맡긴다');
    // 빚도 있게: 은행 대출을 한 것처럼.
    m.debt = 30;
    m.loans = 1;
    m.wallet = 30 + redeemCost(m.pawned[0]!) + 5;
    m.patience = 0;
    let repaid = 0;
    let redeemed = 0;
    s.bus.on('loanRepaid', (e) => {
      if (e.id === m.id) repaid++;
    });
    s.bus.on('redeemed', (e) => {
      if (e.id === m.id) redeemed++;
    });
    const ids = new Set<number>();
    s.bus.on('monsterLeft', (e) => ids.add(e.id));
    assert(runUntil(s, 300, () => ids.has(m.id)), '볼일을 보고 떠난다');
    assert(repaid === 1 && redeemed === 1 && st.debtTotals.bankrupt === 0 && st.debtTotals.forfeited === 0, `떠나기 전에 갚고 (${repaid}) 되찾고 (${redeemed}) 떠난다`);
    console.log('  떠나기 전 갚기·되찾기 OK');
  });

  // e) 일터 자리: 자리보다 채무자가 많으면 기다리고, 자리가 나면 가장 오래 기다린 채무자가 일한다.
  {
    const s = debtVillage(14);
    const st = s.state;
    const slots = workSlots(st, 'farm') + workSlots(st, 'mine');
    const ids: number[] = [];
    for (let i = 0; i < slots + 2; i++) {
      const m = testGuest(s, { wallet: 0 });
      assert(s.devBankrupt(m.id, 100 + i), '개발용 파산');
      ids.push(m.id);
      runFor(s, 3);
    }
    runFor(s, 120);
    const ms = ids.map((id) => s.monster(id)!);
    const working = ms.filter((m) => m.phase === 'working').length;
    const waiting = ms.filter((m) => m.phase === 'waitWork');
    assert(working === slots && waiting.length === 2, `일하는 ${working} (자리 ${slots}), 기다리는 ${waiting.length}`);
    // 하나가 다 갚으면 가장 오래 기다린 채무자가 그 자리로.
    const longest = waiting.slice().sort((a, b) => (b.phaseTime ?? 0) - (a.phaseTime ?? 0))[0]!;
    const w = ms.find((m) => m.phase === 'working')!;
    w.debt = 1;
    runFor(s, 40);
    assert(ms.filter((m) => m !== w && m.phase === 'working').length === slots && longest.phase === 'working', '자리가 나면 가장 오래 기다린 채무자가 일한다');
    console.log(`  일터 자리 OK: 자리 ${slots}, 기다림 2 → 1 (오래 기다린 손님부터)`);
  }

  // e2) 반장: 일하는 채무자를 다독이고 (foremanCheer, 잠깐 빨라짐), 파산하고 LABOR.forgiveSec가 지나면 남은 빚을 덜어 준다.
  {
    const s = debtVillage(21);
    const st = s.state;
    const m = testGuest(s, { wallet: 0 });
    s.devBankrupt(m.id, 90);
    assert(runUntil(s, 180, () => m.phase === 'working'), '일한다');
    let cheered = 0;
    s.bus.on('foremanCheer', (e) => {
      if (e.id === m.id) cheered++;
    });
    assert(runUntil(s, LABOR.foreman.everySec + 1, () => cheered > 0), '반장이 다독인다');
    assert((m.labor?.boostSec ?? 0) > 0 && (m.labor?.boostMult ?? 1) >= LABOR.foreman.mult, '다독이면 잠깐 빨라진다');
    // 오래 일했다 (파산한 지 forgiveSec).
    m.labor!.since = st.time - LABOR.forgiveSec - 1;
    const left = m.debt;
    let forgiven: boolean | null = null;
    s.bus.on('debtCleared', (e) => {
      if (e.id === m.id) forgiven = e.forgiven;
    });
    runFor(s, 1);
    const fg = forgiven as boolean | null;
    assert(fg === true && m.bankrupt === false && m.phase === 'relieved' && st.debtTotals.forgiven === 1 && left > 0, '오래 일하면 반장이 남은 빚을 덜어 준다');
    assert(runUntil(s, 300, () => s.monster(m.id) === undefined), '덜어 받고 떠난다');
    console.log(`  반장 OK: 다독임 ${cheered}, 남은 빚 ${left} 덜어 줌`);
  }

  // f) 빚 걸기 판 (밀어내기·줄다리기 1:1): 쉬는 부스에 채무자 둘을 불러 겨루고, 이기면 빚이 반 (대박이면 0), 지면 상대 빚만큼 더.
  for (const b of ['ssireum', 'tug'] as const) {
    const s = debtVillage(15, b);
    const st = s.state;
    const a = testGuest(s, { wallet: 0 });
    const c = testGuest(s, { wallet: 0 });
    // 줄다리기는 부를 수 있는 채무자가 tugMin명 이상일 때만 (짝 둘). 1:1 시험은 tugMin을 잠깐 2로.
    const tugMin = DEBT_MATCH as unknown as { tugMin: number };
    const savedMin = tugMin.tugMin;
    tugMin.tugMin = 2;
    s.devBankrupt(a.id, 40);
    s.devBankrupt(c.id, 24);
    const la = reactLog(s, a.id);
    const lc = reactLog(s, c.id);
    let called = 0;
    let settled: SimEvents['debtSettled'] | null = null;
    // 판을 열 때의 빚 (일터에서 일하는 동안 줄었다: 걸어가는 동안은 그대로).
    const stake = new Map<number, number>();
    s.bus.on('debtMatchCalled', (e) => {
      if (e.booth !== b) return;
      called++;
      for (const id of e.debtors) stake.set(id, s.monster(id)?.debt ?? -1);
    });
    s.bus.on('debtSettled', (e) => {
      settled = e;
    });
    runFor(s, 60);
    // 확인 때마다 chance로 연다: 여러 번 확인하게 시계를 당긴다.
    assert(
      runUntil(s, 400, () => {
        if (called === 0) st.debtCheck = Math.min(st.debtCheck, 0.05);
        return settled !== null;
      }),
      `${b} 빚 걸기 판이 열리고 끝난다`,
    );
    tugMin.tugMin = savedMin;
    const ev = settled as SimEvents['debtSettled'] | null;
    assert(ev !== null && ev.booth === b && ev.changes.length === 2, `${b} 빚 정산 둘`);
    for (const ch of ev.changes) {
      const mine = stake.get(ch.id)!;
      const [otherId, other] = [...stake.entries()].find(([id]) => id !== ch.id)!;
      // 걸어가는 동안·기다리는 동안은 일하지 않았다 (빚 그대로 걸었다).
      const won = ch.tier === 'win' || ch.tier === 'jackpot';
      const want = won ? (ch.tier === 'jackpot' ? 0 : Math.round(mine * DEBT_MATCH.winKeep)) : Math.min(DEBT_MATCH.maxDebt, mine + other);
      assert(ch.before === mine && ch.after === want, `${b} 빚 ${ch.before} → ${ch.after} (${ch.tier}, 바라는 값 ${want})`);
      assert(ch.opponent === otherId && ch.result === (won ? (ch.tier === 'jackpot' ? 'cleared' : 'halved') : 'added'), `${b} 정산의 상대·결과 (${ch.opponent}, ${ch.result})`);
      const log = ch.id === a.id ? la : lc;
      const kind = ch.result === 'halved' ? 'matchHalved' : ch.result === 'cleared' ? 'matchCleared' : 'matchAdded';
      assert(debtReactionLabels(kind).some((l) => log.includes(l)) && debtReactionLabels('matchCalled').some((l) => log.includes(l)), `${b} 채무자 반응: 불려 갈 때·정산 (${log.join(', ')})`);
    }
    assert(st.debtTotals.matches === 1, `${b} 빚 걸기 판 1`);
    // 끝나면 일터로 (빚이 0이면 홀가분). 한 번 겨룬 채무자는 이번 파산에 다시 부르지 않는다 (DEBT_MATCH.maxPerStint).
    assert(
      runUntil(s, 300, () => [a, c].every((m) => s.monster(m.id) === undefined || m.phase === 'working' || m.phase === 'waitWork' || m.phase === 'relieved' || m.phase === 'leaving')),
      `${b} 판이 끝나면 일터로`,
    );
    assert([a, c].every((m) => s.monster(m.id) === undefined || m.bankrupt !== true || (m.labor?.matches ?? 0) >= DEBT_MATCH.maxPerStint), `${b} 겨룬 횟수`);
    st.debtCheck = 0.05;
    runFor(s, 30);
    assert(st.debtTotals.matches === 1, `${b} 한 번 겨룬 채무자는 다시 부르지 않는다`);
    console.log(`  빚 걸기 판 ${b} OK: ${ev.changes.map((x) => `${x.before}→${x.after} (${x.tier}, ${x.result})`).join(', ')}`);
  }

  // f2) 줄다리기 2:2 빚 걸기 판: 빚이 비슷한 채무자끼리 짝 (자리 2k ↔ 2k+1), 진 채무자는 짝 상대의 빚만큼 더. 빚이 minStake보다 적으면 부르지 않는다.
  {
    const s = debtVillage(22, 'tug');
    const st = s.state;
    const debts = [10, 55, 12, 50, DEBT_MATCH.minStake - 1];
    const ms = debts.map((d) => {
      const m = testGuest(s, { wallet: 0 });
      s.devBankrupt(m.id, d);
      return m;
    });
    // 일하는 동안 빚이 줄지 않게 아주 느리게 (짝을 빚으로 보려고).
    for (const m of ms) if (m.labor) m.labor.progress = -1e9;
    let called: MonsterId[] = [];
    let settled: SimEvents['debtSettled'] | null = null;
    s.bus.on('debtMatchCalled', (e) => {
      if (e.booth === 'tug') called = e.debtors.slice();
    });
    s.bus.on('debtSettled', (e) => {
      settled = e;
    });
    runFor(s, 30);
    assert(
      runUntil(s, 400, () => {
        if (called.length === 0) st.debtCheck = Math.min(st.debtCheck, 0.05);
        return settled !== null;
      }),
      '줄다리기 2:2 빚 걸기 판',
    );
    const debtOf = new Map(ms.map((m, i) => [m.id, debts[i]!]));
    assert(called.length === 4 && !called.includes(ms[4]!.id), `넷을 부르고 빚이 적은 채무자는 뺀다 (${called.map((id) => debtOf.get(id)).join(',')})`);
    for (let k = 0; k < 4; k += 2) assert(Math.abs(debtOf.get(called[k]!)! - debtOf.get(called[k + 1]!)!) <= 5, '짝은 빚이 비슷하다 (자리 2k ↔ 2k+1)');
    const ev = settled as SimEvents['debtSettled'] | null;
    assert(ev !== null && ev.changes.length === 4, '정산 넷');
    for (const ch of ev.changes) {
      const seat = called.indexOf(ch.id);
      const opp = called[seat ^ 1]!;
      assert(ch.opponent === opp, '줄다리기 상대 = 짝 (자리 2k ↔ 2k+1)');
      if (ch.result === 'added') assert(ch.after === Math.min(DEBT_MATCH.maxDebt, ch.before + debtOf.get(opp)!), `진 채무자 = 자기 빚 + 짝 상대 빚 (${ch.before} + ${debtOf.get(opp)} → ${ch.after})`);
      else assert(ch.after === (ch.result === 'cleared' ? 0 : Math.round(ch.before * DEBT_MATCH.winKeep)), '이긴 채무자는 반 (대박이면 0)');
    }
    console.log(`  줄다리기 2:2 빚 걸기 판 OK: ${ev.changes.map((x) => `${x.before}→${x.after}`).join(', ')}`);
  }

  // g) 저장·불러오기 (파산한 손님·맡긴 장신구·컬렉션·빚 걸기 판 중 그대로), 옛 저장(3) → 4.
  withWant(1, () => {
    const s = debtVillage(16, 'ssireum');
    const st = s.state;
    const p = testGuest(s, { wallet: 1, acc: [{ key: 'acc_tophat', value: 60 }] });
    runUntil(s, 60, () => p.pawned.length > 0);
    const w = testGuest(s, { wallet: 0 });
    s.devBankrupt(w.id, 50);
    const w2 = testGuest(s, { wallet: 0 });
    s.devBankrupt(w2.id, 30);
    runFor(s, 30);
    st.pawnCollection.acc_ribbon = 2;
    const back = normalizeState(JSON.parse(JSON.stringify(st)));
    assert(back !== null && back.version === 4, '저장 4를 읽는다');
    const twin = new Sim(back);
    runFor(s, 30);
    runFor(twin, 30);
    assert(stripTime(s.state) === stripTime(twin.state), '파산·일터·맡긴 장신구가 저장 뒤에도 똑같이 흐른다');
    // 빚 걸기 판 중에 저장.
    assert(
      runUntil(s, 400, () => {
        if (st.debtTotals.matches === 0) st.debtCheck = Math.min(st.debtCheck, 0.05);
        return st.booths.ssireum.group?.mode === 'debt' && st.booths.ssireum.group.phase === 'running';
      }),
      '빚 걸기 판이 달린다',
    );
    const mid = new Sim(normalizeState(JSON.parse(JSON.stringify(st)))!);
    runFor(s, 40);
    runFor(mid, 40);
    assert(stripTime(s.state) === stripTime(mid.state), '빚 걸기 판 중 저장·불러오기 뒤 40초가 똑같이 흐른다');
    // 옛 저장 3: 넷째 묶음 칸이 없다.
    const old = JSON.parse(JSON.stringify(newGame(17))) as Record<string, unknown>;
    old.version = 3;
    for (const k of ['pawnCollection', 'debtTotals', 'debtMatchAt', 'debtCheck']) delete old[k];
    for (const k of ['pawnshop', 'bank', 'workyard']) delete (old.buildings as Record<string, unknown>)[k];
    delete (old.materials as Record<string, unknown>).mat_veggie;
    for (const m of old.monsters as Record<string, unknown>[]) {
      delete m.accessories;
      delete m.pawned;
      delete m.debt;
    }
    const up = normalizeState(old);
    assert(up !== null && up.version === 4 && up.buildings.pawnshop.level === 0 && up.materials.mat_veggie === 0 && up.debtTotals.forgiven === 0 && up.monsters.every((m) => Array.isArray(m.accessories) && m.debt === 0), '옛 저장(3) → 4');
    const us = new Sim(up);
    runFor(us, 60);
    // 기초 작업 때의 저장 4 (forgiven·since·foremanTimer가 없다)도 읽는다.
    const early = JSON.parse(JSON.stringify(st)) as Record<string, unknown>;
    delete (early.debtTotals as Record<string, unknown>).forgiven;
    delete early.foremanTimer;
    for (const m of early.monsters as Record<string, unknown>[]) if (m.labor !== null && typeof m.labor === 'object') delete (m.labor as Record<string, unknown>).since;
    const es = normalizeState(early);
    assert(es !== null && es.debtTotals.forgiven === 0, '기초 작업 때의 저장 4');
    runFor(new Sim(es), 60);
    console.log('  저장 4 (빚 걸기 판 중 포함)·옛 저장(3 → 4) OK');
  });

  // h) 전당포·은행·일터 짓기: 회관 레벨, 레벨 0 = 빈 부지.
  {
    const s = new Sim(newGame(18));
    const st = s.state;
    assert(st.buildings.pawnshop.level === 0 && st.buildings.bank.level === 0 && st.buildings.workyard.level === 0, '처음엔 빈 부지');
    st.coins = 2000;
    assert(s.buildingLockReason('bank') !== null && !s.upgradeBuilding('bank').ok, '은행은 회관 2부터');
    assert(s.upgradeBuilding('pawnshop').ok && s.buildingBuilt('pawnshop'), '전당포는 회관 1에 짓는다');
    console.log('  짓기 OK');
  }

  // i) 넷째 묶음 반응 표: 종류마다 둘 이상, 이름이 겹치지 않는 종류끼리 (허리가 아파… 같은 일터 말은 밭·광산 같이), 기획의 말이 있다.
  {
    for (const k of DEBT_REACT_KINDS) assert(debtReactionLabels(k).length >= 2, `${k} 반응 둘 이상`);
    const all = DEBT_REACT_KINDS.flatMap((k) => debtReactionLabels(k));
    for (const want of ['맡겨야겠다…', '되찾았다!', '빚이 늘었다…', '홀가분해!', '흙투성이 한숨', '빚이 반으로!', '빚이 사라졌다!', '언제 내 차례…']) assert(all.includes(want), `반응 '${want}'`);
    console.log(`  넷째 묶음 반응 표 OK (${DEBT_REACT_KINDS.length}종류, ${new Set(all).size}가지)`);
  }

  // j) 오래 돌리기 (넷째 묶음 건물이 있는 마을, 촌장 있음): 장부 (맡김 = 되찾음 + 컬렉션 + 아직 맡긴 것, 둘로 끝나지 않음),
  //    빚·금고가 음수가 아니고 (불변식), 파산한 손님은 모두 풀려나거나 아직 일하는 중 (BANKRUPT_MAX 안: 불변식).
  for (const seed of [7, 8]) {
    const s = new Sim(newGame(seed));
    const st = s.state;
    st.coins = 600;
    st.buildings.hall.level = 2;
    for (const d of Object.keys(DISTRICTS) as DistrictId[]) if (DISTRICTS[d].hall <= 2 && !st.districts.includes(d)) st.districts.push(d);
    for (const id of ['pawnshop', 'bank', 'workyard'] as BuildingId[]) st.buildings[id].level = 1;
    const t = tallyDebt(s);
    const chief = makeGreedyChief(seed);
    const n = Math.round((45 * 60) / SIM.dt);
    for (let i = 0; i < n; i++) {
      s.tick(SIM.dt);
      checkInvariants(s);
      sampleDebt(t, st, SIM.dt);
      if (i % 10 === 0) chief(s, () => {});
    }
    const errs = checkLedger(s, t);
    assert(errs.length === 0, `장부: ${errs.slice(0, 3).join(' / ')}`);
    const d = st.debtTotals;
    const working = st.monsters.filter((m) => m.bankrupt === true).length;
    assert(d.relieved + working === d.bankrupt, `파산 ${d.bankrupt} = 풀려남 ${d.relieved} + 일하는 중 ${working}`);
    assert(d.pawned > 0 && d.forfeited + d.redeemed > 0, `맡김 ${d.pawned}, 되찾음 ${d.redeemed}, 컬렉션 ${d.forfeited}`);
    console.log(`  넷째 묶음 45분 (시드 ${seed}) OK: ${debtLine(st)}`);
  }
}

// ── 실행 ───────────────────────────────────────────────────────────────

const seed = num('seed', 1);
const minutes = num('minutes', 30);
if (flag('selftest')) {
  selftest();
} else if (flag('auto') && flag('seeds')) {
  runSeeds(num('seeds', 8), minutes, flag('detail'), num('first', 1));
} else if (flag('auto')) {
  console.log(`--auto: 욕심쟁이 촌장, 시드 ${seed}, ${minutes}분 (MOOD.leaveBelow ${MOOD.leaveBelow})\n`);
  runReport(seed, minutes, makeGreedyChief(seed));
} else {
  console.log(`시드 ${seed}, ${minutes}분 (촌장은 아무것도 하지 않음)\n`);
  runReport(seed, minutes, null);
}
