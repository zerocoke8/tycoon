// 화면 없이 시뮬레이션을 돌려 경제 수치를 본다 (밸런스 확인용). Node 24로 바로 돈다:
//   node scripts/sim-check.ts                 새 게임(시드 1)을 30분 돌리며 1분마다 수치
//   node scripts/sim-check.ts --auto          욕심쟁이 촌장(살 수 있으면 산다)으로 회관 2·3·4와 부스 해금 시각
//   node scripts/sim-check.ts --selftest      저장·불러오기 왕복, 결과 세부, 행동, catchUp 시험
//   node scripts/sim-check.ts --auto --seeds 8   여러 시드의 이정표(처음 산 때) 표
//   --minutes N, --seed N, --verbose (토스트 찍기), --detail (--seeds와 같이: 다음 회관 비용 항목마다 처음 모인 때)
// 모든 모드에서 매 틱 불변식을 검사한다 (NaN, 음수 코인, 멈춘 손님, 자리·줄 어긋남). 어긋나면 바로 멈춘다.

import { Rng } from '../src/core/rng.ts';
import { BOOTHS, BOOTH_IDS, boothDef, BUILDINGS, GOODS, HOST_PRESETS, MOOD, ODDS, RACE, RECIPES, SIM, SPECIES_IDS, WHEEL, type BoothId, type BuildingId, type GoodId, type MaterialId, type OutcomeTier } from '../src/data/defs.ts';
import { devOpenAll } from '../src/sim/dev.ts';
import { decideOutcome } from '../src/sim/games.ts';
import { boothStat, minPlayCost } from '../src/sim/booths.ts';
import { COMEBACK_KEY_INDEX, generateRace, raceGatherSec, raceOutcome, racePlace, raceProgress, RACERS, raceStandings, raceTier } from '../src/sim/race.ts';
import { moodDelta, reactionLabels } from '../src/sim/reactions.ts';
import { normalizeState } from '../src/sim/save.ts';
import { presetPost } from '../src/sim/staff.ts';
import { DISTRICTS, NODES, type DistrictId, type NodeId } from '../src/data/map.ts';
import { crossesBooth, distancesFrom } from '../src/sim/path.ts';
import { clearSave, loadGame, newGame, saveGame, Sim } from '../src/sim/sim.ts';
import { TUNE } from '../src/sim/tuning.ts';
import type { GameState, MonsterPhase, SimEvents } from '../src/sim/types.ts';

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
const LONG_OK: ReadonlySet<MonsterPhase> = new Set(['queued', 'resting']);
const STUCK_SEC = Math.max(120, WALK_MAX_SEC * 1.25 + 20);
/** 온 때부터 머무는 최대 시간 + 줄에서 기다리는 시간 + 입구까지 걷는 시간. 이보다 오래 있으면 떠나지 못한 것. */
const MAX_AGE = TUNE.maxStaySec + TUNE.queueGiveUpSec + WALK_MAX_SEC + 60;

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
    if (!LONG_OK.has(m.phase) && pt > STUCK_SEC) fail(`손님 ${m.id}가 ${m.phase}에 ${pt.toFixed(0)}초 멈춤 (path ${m.path.length}, booth ${m.booth}, seat ${m.seat})`, st);
    const age = st.time - (m.born ?? st.time);
    if (age > MAX_AGE) fail(`손님 ${m.id}가 ${age.toFixed(0)}초째 떠나지 않음 (phase ${m.phase})`, st);
    const race = m.booth !== null ? st.booths[m.booth].race : null;
    if (m.phase === 'playing' && race !== null) {
      // 경주장: 모이는 중이면 참가자, 달리는 중이면 참가자(한판 있음)나 다음 경주를 기다리는 손님, 결과 중이면 기다리는 손님.
      const entry = race.participants.find((e) => e.monster === m.id);
      if (race.phase === 'idle') fail(`손님 ${m.id}가 쉬는 경주장에서 playing`, st);
      if (race.phase === 'gathering' && entry === undefined) fail(`손님 ${m.id}가 모이는 경주에 참가하지 않고 앉아 있음`, st);
      if (race.phase === 'running' && entry !== undefined) {
        const r = st.booths[m.booth!].rounds[entry.seat];
        if (!r || r.monster !== m.id) fail(`손님 ${m.id}가 경주 참가자인데 한판이 없음`, st);
      }
      // 결과 중: 이번 경주 참가자의 한판은 끝나 있어야 한다 (반응을 마치고 다시 앉아 다음 경주를 기다리는 것은 괜찮다).
      if (race.phase === 'done' && entry !== undefined && st.booths[m.booth!].rounds[entry.seat]?.monster === m.id) fail(`손님 ${m.id}가 경주가 끝났는데 한판이 남음`, st);
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
    if ((b === 'race') !== (bs.race !== null)) fail(`${b} race 칸이 어긋남`, st);
    const race = bs.race;
    if (race !== null) {
      finite(race.countdown, `${b} 경주 countdown`, st);
      finite(race.elapsed, `${b} 경주 elapsed`, st);
      if (race.phase === 'idle' && (race.participants.length > 0 || race.result !== null)) fail(`${b} 쉬는 경주에 참가자·결과가 남음`, st);
      if (race.phase === 'gathering' && (race.participants.length === 0 || race.result !== null || race.countdown > RACE.gatherSec * (1 + 2 * RACE.gatherPacePerPoint) + 1e-6)) fail(`${b} 모이는 경주가 어긋남`, st);
      if ((race.phase === 'running' || race.phase === 'done') && race.result === null) fail(`${b} 달리는 경주에 결과가 없음`, st);
      if (race.phase === 'running' && race.elapsed > race.duration + 1e-6) fail(`${b} 경주가 끝나지 않음`, st);
      if (new Set(race.participants.map((e) => e.seat)).size !== race.participants.length) fail(`${b} 경주 참가자 자리가 겹침`, st);
      if (new Set(race.participants.map((e) => e.monster)).size !== race.participants.length) fail(`${b} 경주에 같은 손님이 둘`, st);
      if (race.participants.length > bs.seats.length) fail(`${b} 경주 참가자가 자리보다 많음`, st);
      if (race.phase === 'gathering' || race.phase === 'running') {
        for (const e of race.participants) {
          const m = sim.monster(e.monster);
          if (race.phase === 'gathering' && (!m || m.booth !== b || m.seat !== e.seat || m.phase !== 'playing')) fail(`${b} 모이는 경주 참가자 ${e.monster}가 자리에 없음`, st);
          if (e.racer < 0 || e.racer > 3 || !(e.bet >= 1)) fail(`${b} 경주 참가 ${e.monster} 선수·건 코인 (${e.racer}, ${e.bet})`, st);
        }
      }
    }
  }
  for (const s of st.staff) {
    if (s.post === null) continue;
    if (st.booths[s.post.booth].staff[s.post.role] !== s.id) fail(`진행자 ${s.id}의 자리(${s.post.booth}.${s.post.role})가 어긋남`, st);
  }
  for (const m of st.monsters) if (!(m.mats >= 0)) fail(`손님 ${m.id} 재료 ${m.mats}`, st);
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
      const sad = st.monsters.find((m) => !m.snacked && (m.mood < 35 || (m.phase === 'leaving' && m.broke)));
      if (sad !== undefined && sim.giveSnack(sad.id, snack).ok) log(`간식(${GOODS[snack].name}) → 손님 ${sad.id} (기분 ${sad.mood.toFixed(0)}, ${sad.phase})`);
    }

    // 응원 톡: 3초에 한 번쯤, 기분이 낮은 손님부터.
    if (rng.chance(0.33) && st.monsters.length > 0) {
      const pick = [...st.monsters].filter((m) => m.cheerCooldown <= 0 && m.phase !== 'leaving').sort((a, b) => a.mood - b.mood)[0];
      if (pick !== undefined) sim.cheer(pick.id);
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
    // 회관 3부터: 막 열린 구역의 부스(회관 3 경주장, 회관 4 인형 뽑기·복주머니)는 다음 회관보다 먼저 연다 (귀한 물건이 있으면 코인을 모은다).
    let saving = false;
    const lv = st.buildings.hall.level;
    if (lv >= 3) {
      for (const b of BOOTH_IDS) {
        if (st.booths[b].unlocked || boothDef(b).unlock.hall !== lv) continue;
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

/** 정렬된 목록의 q 분위 (없으면 NaN). */
function quantile(xs: readonly number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] as number;
}

/** 부스마다 연 뒤의 한판 수와 경주 묶음 (sim 이벤트로 센다). */
interface BoothTally {
  rounds: Record<BoothId, number>;
  races: number;
  runners: number;
  maxRunners: number;
}

function tallyBooths(sim: Sim): BoothTally {
  const t: BoothTally = { rounds: Object.fromEntries(BOOTH_IDS.map((b) => [b, 0])) as Record<BoothId, number>, races: 0, runners: 0, maxRunners: 0 };
  sim.bus.on('roundStarted', (e) => {
    t.rounds[e.booth] += 1;
  });
  sim.bus.on('raceStarted', (e) => {
    t.races += 1;
    t.runners += e.race.participants.length;
    t.maxRunners = Math.max(t.maxRunners, e.race.participants.length);
  });
  return t;
}

function runSeeds(count: number, minutes: number, detail = false): void {
  const keys = ['first', 'hall2', 'unlock-cups', 'unlock-darts', 'unlock-wheel', 'unlock-duck', 'unlock-ring', 'ready-hall3', 'hall3', 'unlock-race', 'ready-hall4', 'hall4', 'unlock-claw', 'unlock-pouch'];
  const short = (k: string) => k.replace('unlock-', '').replace('ready-hall', 'rdy');
  console.log(`--auto --seeds ${count}: 욕심쟁이 촌장이 처음 산 때 (분), ${minutes}분까지
`);
  console.log(`시드 ${keys.map((k) => short(k).padStart(7)).join('')}   코인  귀한(g/a/s)  기분  빈털  경주(평균/최대 참가)`);
  const sums = new Map<string, number[]>();
  /** 부스마다 연 뒤 1분에 시작한 한판 수 (시드마다). */
  const rates = new Map<BoothId, number[]>();
  const runnerAvg: number[] = [];
  const needAll = new Map<string, number[]>();
  for (let seed = 1; seed <= count; seed++) {
    const sim = new Sim(newGame(seed));
    const ms = new Map<string, number>();
    const chief = makeGreedyChief(seed, ms);
    const all = zeroTally();
    listen(sim, zeroTally(), all, new Set());
    const tb = tallyBooths(sim);
    const openedAt = new Map<BoothId, number>();
    const need = new Map<string, number>();
    const n = Math.round((minutes * 60) / SIM.dt);
    for (let i = 0; i < n; i++) {
      sim.tick(SIM.dt);
      checkInvariants(sim);
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
    if (b === 'race') continue;
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
  const quietTypes: (keyof SimEvents)[] = ['monsterReact', 'monsterSpectate', 'roundStarted', 'roundFinished', 'potFestival', 'raceStarted', 'raceFinished', 'raceJoined', 'raceProgress', 'coinsChanged', 'toast', 'itemsChanged', 'monsterSpawned', 'monsterLeft'];
  for (const t of quietTypes) c.bus.on(t, () => seen.push(t as string));
  const coins0 = c.state.coins;
  const t0 = c.state.time;
  c.catchUp(10_000);
  checkInvariants(c);
  assert(Math.abs(c.state.time - t0 - SIM.catchUpMaxSec) < 1e-6, `catchUp은 ${SIM.catchUpMaxSec}초까지`);
  const loud = ['monsterReact', 'monsterSpectate', 'roundStarted', 'roundFinished', 'potFestival', 'raceStarted', 'raceFinished', 'raceJoined', 'raceProgress'];
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
    r.bus.on('raceStarted', () => started++);
    let wallets = 0;
    let gathered = false;
    for (let i = 0; i < 20_000 && !gathered; i++) {
      r.tick(SIM.dt);
      const race = rs.booths.race.race;
      if (race !== null && race.phase === 'gathering' && race.participants.length > 0) gathered = true;
    }
    assert(gathered, '경주장에 손님이 모인다');
    const race = rs.booths.race.race!;
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
    const race = bs.race!;
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
    r.bus.on('raceJoined', (e) => {
      assert(race.phase === 'gathering', '참가하면 모이는 중');
      const p = race.participants.find((x) => x.monster === e.monster);
      assert(p !== undefined && p.racer === e.racer && p.seat === e.seat && p.bet === e.bet && e.bet >= 1, '참가 목록에 선수·자리·건 코인');
      wallets.set(e.monster, r.monster(e.monster)!.wallet);
      if (race.participants.length === 1) {
        gatherAt = rs.time;
        joinedMax = 0;
      }
      joinedMax = Math.max(joinedMax, race.participants.length);
    });
    r.bus.on('raceStarted', (e) => {
      started++;
      const res = e.race.result!;
      const waited = rs.time - gatherAt;
      assert(waited <= raceGatherSec(pace) + SIM.dt * 1.5, `첫 손님이 앉고 ${raceGatherSec(pace).toFixed(1)}초 안에 출발 (${waited.toFixed(1)})`);
      if (joinedMax === 1) assert(waited >= raceGatherSec(pace) - SIM.dt * 1.5, `혼자면 끝까지 기다린다 (${waited.toFixed(1)})`);
      if (e.race.participants.length >= 2) multi++;
      biggest = Math.max(biggest, e.race.participants.length);
      for (let k = 1; k < 4; k++) assert(res.finishAt[res.finishOrder[k]!]! > res.finishAt[res.finishOrder[k - 1]!]!, '들어온 순서 = 결승 시각 순서');
      for (const x of RACERS) {
        const keys = res.keys[x]!;
        for (let k = 1; k < keys.length; k++) assert(keys[k]!.t > keys[k - 1]!.t && keys[k]!.p > keys[k - 1]!.p, '경주 키프레임은 앞으로만');
      }
      expected = new Set(e.race.participants.map((p) => p.monster));
      for (const p of e.race.participants) {
        const round = bs.rounds[p.seat];
        assert(round !== null && round !== undefined && round.monster === p.monster && round.outcome.tier === raceTier(res, p.racer), '참가자마다 한판 (등급 = 그 선수의 결과)');
      }
    });
    r.bus.on('raceProgress', (e) => {
      progress++;
      assert(e.race.phase === 'running' && e.leader === raceStandings(e.race.result!, e.elapsed)[0], 'raceProgress 1등 = 그때 순위');
      for (const ch of e.cheers) {
        const p = e.race.participants.find((x) => x.monster === ch.id);
        assert(p !== undefined && p.racer === ch.racer, '응원은 참가자만');
        assert((ch.kind === 'lead') === (ch.racer === e.leader), '자기 선수가 1등이면 들썩, 아니면 땀');
        cheers++;
      }
    });
    r.bus.on('raceFinished', (e) => {
      finishedRaces++;
      assert(e.race.phase === 'done' && e.race.result !== null, '끝나면 done');
    });
    r.bus.on('roundFinished', (e) => {
      if (e.booth !== 'race') return;
      const d = e.round.outcome.detail;
      assert(d.kind === 'race' && race.phase === 'done' && race.result !== null, '경주 한판은 경주가 끝날 때');
      assert(expected.has(e.round.monster), '이번 경주 참가자만 결과');
      const res = race.result!;
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
    assert(bs.seats.every((x) => x === null) && bs.rounds.every((x) => x === null) && bs.queue.length === 0 && rs.booths.race.race?.phase === 'idle' && race.participants.length === 0, '닫힌 경주장: 자리·한판·줄이 비고 경주는 쉰다');
    for (const b of BOOTH_IDS) rs.booths[b].unlocked = true;
    checkInvariants(r);
    console.log(`  경주장 OK: 경주 ${started}번 (둘 이상 ${multi}, 가장 많이 ${biggest}명), 결과 ${settled}, 1등 바뀜 ${progress} (응원 ${cheers}), 구경 ${crowd}, 항아리 축제 ${festivals}`);
  }

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
    let progress = 0;
    e.bus.on('raceProgress', () => progress++);
    // 항아리 축제는 이긴 손님만, 이기지 못하고 코인이 모자라면 (돌려받았어도) 빈털터리.
    const lastTier = new Map<number, OutcomeTier>();
    let badFestival = 0;
    let missedBroke = 0;
    e.bus.on('roundFinished', (x) => {
      const tier = x.round.outcome.tier;
      lastTier.set(x.round.monster, tier);
      const m = e.monster(x.round.monster);
      if (m !== undefined && tier !== 'win' && tier !== 'jackpot' && m.wallet < minPlayCost(e.state) && m.broke !== true) missedBroke++;
    });
    e.bus.on('potFestival', (x) => {
      const t = lastTier.get(x.monster);
      if (t !== 'win' && t !== 'jackpot') badFestival++;
    });
    const chief = makeGreedyChief(seed);
    const n = Math.round((60 * 60) / SIM.dt);
    for (let i = 0; i < n; i++) {
      e.tick(SIM.dt);
      checkInvariants(e);
      if (i % 10 === 0) chief(e, () => {});
    }
    for (const b of BOOTH_IDS) assert(tb.rounds[b] >= 30, `다 열린 마을 60분: ${b} 한판 ${tb.rounds[b]} (30 이상)`);
    assert(badFestival === 0, `이기지 않은 한판의 항아리 축제 ${badFestival}`);
    assert(missedBroke === 0, `코인이 모자란데 빈털터리가 아닌 손님 ${missedBroke}`);
    assert(tb.races >= 40 && tb.runners / tb.races >= 1.8 && progress > 0, `경주 ${tb.races}번, 평균 참가 ${(tb.runners / Math.max(1, tb.races)).toFixed(2)}`);
    console.log(`  60분 (시드 ${seed}, 처음부터 다 열린 마을) OK: 손님 ${e.state.totals.visitors}, 한판 ${e.state.totals.rounds}, 경주 ${tb.races}번 (평균 ${(tb.runners / tb.races).toFixed(1)}명, 가장 많이 ${tb.maxRunners}명)`);
    console.log(`     ${BOOTH_IDS.map((b) => `${b} ${tb.rounds[b]}`).join(', ')}`);
  }
  console.log('\nselftest 통과');
}

// ── 실행 ───────────────────────────────────────────────────────────────

const seed = num('seed', 1);
const minutes = num('minutes', 30);
if (flag('selftest')) {
  selftest();
} else if (flag('auto') && flag('seeds')) {
  runSeeds(num('seeds', 8), minutes, flag('detail'));
} else if (flag('auto')) {
  console.log(`--auto: 욕심쟁이 촌장, 시드 ${seed}, ${minutes}분 (MOOD.leaveBelow ${MOOD.leaveBelow})\n`);
  runReport(seed, minutes, makeGreedyChief(seed));
} else {
  console.log(`시드 ${seed}, ${minutes}분 (촌장은 아무것도 하지 않음)\n`);
  runReport(seed, minutes, null);
}
