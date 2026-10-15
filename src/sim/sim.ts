// 시뮬레이션 본체 (Sim). 상태(GameState)를 바꾸고 이벤트(bus)를 낸다. 화면·DOM을 모른다.
// 손님 상태 기계: arriving → wandering → toBooth → queued → toSeat → playing → reacting → (다시 한판 | wandering | resting | leaving).
// 걷는 phase는 path가 남아 있는 동안 걷고, 다 걸으면 그 phase의 일을 한다 (wandering·resting·spectating은 timer만큼 머문다).
// 무작위는 모두 this.rng (상태는 GameState.rng에 바로 쓰인다).

import { Emitter } from '../core/events.ts';
import { Rng } from '../core/rng.ts';
import { BOOTHS, BOOTH_IDS, boothDef, GROUP_RULES, isGroupBooth, MATERIALS, MOOD, PRECIOUS, RECIPES, SIM, SPECIES, SPECIES_IDS, STAFF_STAT_NAMES, type BoothId, type BuildingId, type GoodId, type GroupBoothId, type MaterialId, type OutcomeTier, type PreciousId, type SpeciesId } from '../data/defs.ts';
import { BOOTH_SPOTS, BUILDING_SPOTS, DISTRICTS, NODES, REST_SPOTS, type DistrictId, type Pt } from '../data/map.ts';
import type { Cost, Result, SimApi } from './api.ts';
import * as B from './booths.ts';
import { addMaterial, canAfford, costOf, fountainMoodPerMin, gateSpawnSec, goodDef, hallVisitors, missingReason, nextBuildingCost, officeCandidates, pay, warehouseCap, workshopSlots, workshopSpeed } from './economy.ts';
import { decideOutcome } from './games.ts';
import { betFraction, createMonster, displayName, faceToward, nameSubject, speedOf, stepMove } from './monsters.ts';
import { dist, distancesFrom, nearestNodes, openNodes, pointOpen, route } from './path.ts';
import { groupGame, groupGatherSec, groupStartSoonSec, idleGroup } from './group/index.ts';
import { cheerKey, groupBuzzReaction, groupCheerReaction, groupSpectateReaction, moodDelta, pickReaction, snackReaction, spectateReaction } from './reactions.ts';
import { clearSave, newGame, saveGame } from './save.ts';
import { fillCandidates, hirePost, levelUpCost, presetCandidates, presetPost, raiseStat, suits } from './staff.ts';
import { josa } from './text.ts';
import { TUNE } from './tuning.ts';
import type { ActiveRound, GameState, GroupBuzz, GroupCheer, GroupEntry, GroupPlay, GroupState, Monster, MonsterId, MonsterPhase, Pose, Regular, RoundOutcome, SimBus, SimEvents, Staff, StaffId, StaffPost } from './types.ts';

export { clearSave, loadGame, newGame, saveGame } from './save.ts';

const OK: Result = { ok: true };
const fail = (reason: string): Result => ({ ok: false, reason });
const clampMood = (v: number): number => Math.max(0, Math.min(100, v));
/** 이보다 짧게 자리를 비웠으면 catchUp 요약 토스트를 띄우지 않는다 (초). */
const CATCHUP_TOAST_SEC = 20;

/** catchUp 동안 내지 않는 연출 이벤트 (끝나고 coinsChanged·itemsChanged·요약 토스트를 한 번씩 낸다). */
const QUIET_EVENTS: ReadonlySet<string> = new Set(['monsterReact', 'monsterSpectate', 'monsterCheered', 'roundStarted', 'roundFinished', 'potFestival', 'groupJoined', 'groupStarted', 'groupEvent', 'groupFinished', 'groupCancelled', 'coinsChanged', 'itemsChanged', 'toast']);

const samePost = (a: StaffPost | null, b: StaffPost | null): boolean => (a === null || b === null ? a === b : a.booth === b.booth && a.role === b.role);

export class Sim implements SimApi {
  readonly state: GameState;
  readonly bus: SimBus = new Emitter<SimEvents>();
  private readonly rng: Rng;
  private quiet = false;
  private quietItems = false;
  private lastCapToast = -Infinity;

  constructor(state: GameState) {
    this.state = state;
    state.regulars ??= [];
    // 난수 상태를 GameState.rng에 바로 읽고 쓴다 (저장·불러오기 뒤에도 같은 흐름).
    const rng = new Rng(0);
    Object.defineProperty(rng, 'state', {
      get: () => this.state.rng,
      set: (v: number) => {
        this.state.rng = v;
      },
      enumerable: true,
      configurable: true,
    });
    this.rng = rng;
    for (const b of BOOTH_IDS) B.fitSeats(state, b);
  }

  // ── 이벤트 ──────────────────────────────────────────────────────────

  private emit<K extends keyof SimEvents>(type: K, payload: SimEvents[K]): void {
    if (this.quiet && QUIET_EVENTS.has(type as string)) {
      if (type === 'itemsChanged') this.quietItems = true;
      return;
    }
    this.bus.emit(type, payload);
  }

  private toast(text: string, kind: 'info' | 'good' | 'warn' = 'info'): void {
    this.emit('toast', { text, kind });
  }

  /** 마을 수입 (참가비·팁). */
  private earn(delta: number, at: Pt | null): void {
    if (delta <= 0) return;
    this.state.coins += delta;
    this.state.totals.coinsEarned += delta;
    this.emit('coinsChanged', { coins: this.state.coins, delta, at: at === null ? null : { x: at.x, y: at.y } });
  }

  /** 비용을 낸다 (확인은 먼저). */
  private spend(cost: Cost, at: Pt | null): void {
    const items = pay(this.state, cost);
    if (cost.coins !== 0) this.emit('coinsChanged', { coins: this.state.coins, delta: -cost.coins, at: at === null ? null : { x: at.x, y: at.y } });
    if (items) this.emit('itemsChanged', {});
  }

  // ── 물어보기 ────────────────────────────────────────────────────────

  monster(id: MonsterId): Monster | undefined {
    return this.state.monsters.find((m) => m.id === id);
  }

  hallLevel(): number {
    return this.state.buildings.hall.level;
  }

  boothFee(booth: BoothId): number {
    return B.boothFee(this.state, booth);
  }

  boothSeats(booth: BoothId): number {
    return B.boothSeats(this.state, booth);
  }

  boothMatFee(booth: BoothId): number {
    return B.boothMatFee(booth);
  }

  /** 해금됐고 진행자가 있어 손님을 받는 중. */
  boothOpen(booth: BoothId): boolean {
    return B.boothOpen(this.state, booth);
  }

  canAfford(cost: Cost): boolean {
    return canAfford(this.state, cost);
  }

  buildingUpgradeCost(id: BuildingId): Cost | null {
    return nextBuildingCost(this.state, id);
  }

  boothUnlockCost(booth: BoothId): Cost | null {
    if (this.state.booths[booth].unlocked) return null;
    const u = boothDef(booth).unlock;
    return costOf({ coins: u.coins, mats: u.mats, precious: u.precious });
  }

  boothLockReason(booth: BoothId): string | null {
    if (this.state.booths[booth].unlocked) return null;
    const need = boothDef(booth).unlock.hall;
    if (this.hallLevel() >= need) return null;
    const d = (Object.keys(DISTRICTS) as DistrictId[]).find((k) => DISTRICTS[k].hall === need);
    return `마을회관 레벨 ${need}부터 열 수 있어요${d !== undefined ? ` (${josa(DISTRICTS[d].name, '이', '가')} 열려요)` : ''}.`;
  }

  boothUpgradeCost(booth: BoothId): Cost | null {
    const bs = this.state.booths[booth];
    if (!bs.unlocked) return null;
    const u = (BOOTHS[booth].upgrade as readonly { coins: number; precious?: Partial<Record<PreciousId, number>> }[])[bs.level - 1];
    return u === undefined ? null : costOf(u);
  }

  availableRecipes(): readonly { readonly index: number; readonly affordable: boolean }[] {
    const hall = this.hallLevel();
    const out: { index: number; affordable: boolean }[] = [];
    RECIPES.forEach((r, index) => {
      if (r.hall <= hall) out.push({ index, affordable: canAfford(this.state, { coins: r.coins, mats: r.mats }) });
    });
    return out;
  }

  /** 재료 한 종류마다 둘 수 있는 최대 개수 (창고). */
  materialCap(): number {
    return warehouseCap(this.state);
  }

  /** 공방에서 한꺼번에 만들 수 있는 개수. */
  craftSlots(): number {
    return workshopSlots(this.state);
  }

  // ── 진행 ────────────────────────────────────────────────────────────

  tick(dt: number): void {
    if (!(dt > 0)) return;
    const st = this.state;
    st.time += dt;
    this.tickSpawn(dt);
    this.tickCandidates(dt);
    this.tickCrafting(dt);
    this.tickBooths(dt);
    for (const m of st.monsters.slice()) this.tickMonster(m, dt);
    for (const b of BOOTH_IDS) this.pump(b);
  }

  catchUp(sec: number): void {
    const total = Math.min(Math.max(0, sec), SIM.catchUpMaxSec);
    if (!(total > 0)) return;
    const st = this.state;
    const coins0 = st.coins;
    const earned0 = st.totals.coinsEarned;
    const visitors0 = st.totals.visitors;
    const precious0 = { ...st.precious };
    const mats0 = Object.values(st.materials).reduce((a, b) => a + b, 0);
    this.quiet = true;
    this.quietItems = false;
    try {
      let left = total;
      while (left > 1e-6) {
        const d = Math.min(SIM.dt, left);
        this.tick(d);
        left -= d;
      }
    } finally {
      this.quiet = false;
    }
    const delta = st.coins - coins0;
    if (delta !== 0) this.emit('coinsChanged', { coins: st.coins, delta, at: null });
    if (this.quietItems) this.emit('itemsChanged', {});
    // 잠깐 자리를 비운 것은 알리지 않는다 (탭을 잠깐 바꾼 정도).
    if (total < CATCHUP_TOAST_SEC) return;
    const earned = st.totals.coinsEarned - earned0;
    const came = st.totals.visitors - visitors0;
    const gotPrecious = (Object.keys(PRECIOUS) as PreciousId[]).filter((k) => (st.precious[k] ?? 0) > (precious0[k] ?? 0)).map((k) => PRECIOUS[k].name);
    const gotMats = Object.values(st.materials).reduce((a, b) => a + b, 0) - mats0;
    const parts: string[] = [];
    if (earned > 0) parts.push(`손님들이 ${earned}코인을 벌어 줬어요${came > 0 ? ` (새 손님 ${came}명)` : ''}.`);
    else if (came > 0) parts.push(`새 손님 ${came}명이 놀러 왔어요.`);
    if (gotPrecious.length > 0) parts.push(`${josa(gotPrecious.join('·'), '을', '를')} 받았어요!`);
    if (gotMats > 0) parts.push(`재료 ${gotMats}개도 모였어요.`);
    const good = gotPrecious.length > 0;
    this.toast(parts.length > 0 ? `자리를 비운 동안 ${parts.join(' ')}` : '자리를 비운 동안 마을은 조용했어요.', good ? 'good' : 'info');
  }

  private tickSpawn(dt: number): void {
    const st = this.state;
    st.spawnTimer -= dt;
    if (st.spawnTimer > 0) return;
    // 입구에서 걸어 들어오는 손님은 세지 않는다 (지도가 커도 노는 손님 수가 그대로).
    const present = st.monsters.filter((m) => m.phase !== 'leaving' && m.phase !== 'arriving').length;
    if (present >= hallVisitors(st)) {
      st.spawnTimer = TUNE.spawnRetrySec;
      return;
    }
    this.spawn();
    const fast = present + 1 < TUNE.fillFast.below ? TUNE.fillFast.mult : 1;
    st.spawnTimer = gateSpawnSec(st) * fast * this.rng.range(1 - TUNE.spawnJitter, 1 + TUNE.spawnJitter);
  }

  private spawn(): void {
    const st = this.state;
    const rng = this.rng;
    const regs = (st.regulars ??= []);
    let regular: Regular | null = null;
    if (regs.length > 0 && rng.chance(TUNE.regularChance)) {
      const i = rng.int(0, regs.length - 1);
      const r = regs[i];
      if (r !== undefined && SPECIES[r.species].hall <= this.hallLevel()) {
        regular = r;
        regs.splice(i, 1);
      }
    }
    const m = createMonster(rng, st, st.nextId++, NODES.gate, regular);
    st.monsters.push(m);
    st.totals.visitors += 1;
    const dex = (st.dex[m.species] ??= { visits: 0, reactions: [] });
    const first = dex.visits === 0;
    dex.visits += 1;
    m.path = route(m.pos, this.arrivePoint(), st.districts);
    this.emit('monsterSpawned', { id: m.id });
    if (first) this.toast(`처음 보는 손님이 왔어요: ${SPECIES[m.species].name}`, 'good');
    else if (regular !== null) this.toast(`단골 ${nameSubject(m)} 다시 놀러 왔어요.`, 'good');
  }

  /** 입구에서 몇 걸음 들어온 곳: 입구 → 광장(분수에서 가장 가까운 노드) 길 거리의 TUNE.arriveFrac 사이. */
  private arrivePoint(): Pt {
    const d = distancesFrom('gate', this.state.districts);
    const plaza = nearestNodes(BUILDING_SPOTS.fountain, this.state.districts, 1)[0];
    const toPlaza = (plaza !== undefined ? d.get(plaza) : undefined) ?? 1500;
    const [f0, f1] = TUNE.arriveFrac;
    const near = [...d.entries()].filter(([, v]) => v >= toPlaza * f0 && v <= toPlaza * f1).map(([id]) => id);
    const fallback = [...d.entries()].filter(([id]) => id !== 'gate').sort((a, b) => a[1] - b[1])[0]?.[0];
    const id = near.length > 0 ? this.rng.pick(near) : (fallback ?? 'gate');
    return this.jitter(NODES[id], 40);
  }

  private jitter(p: Pt, r: number): Pt {
    return { x: p.x + this.rng.range(-r, r), y: p.y + this.rng.range(-r * 0.6, r * 0.6) };
  }

  private tickCandidates(dt: number): void {
    const st = this.state;
    st.candidateRefresh -= dt;
    if (st.candidateRefresh > 0) return;
    st.candidateRefresh = TUNE.candidateRefreshSec;
    fillCandidates(this.rng, st, officeCandidates(st), true);
    this.emit('staffChanged', {});
  }

  private tickCrafting(dt: number): void {
    const st = this.state;
    if (st.crafting.length === 0) return;
    const speed = workshopSpeed(st);
    const done: GoodId[] = [];
    for (let i = st.crafting.length - 1; i >= 0; i--) {
      const j = st.crafting[i];
      if (j === undefined) continue;
      j.left -= dt * speed;
      if (j.left <= 0) {
        done.unshift(j.out);
        st.crafting.splice(i, 1);
      }
    }
    if (done.length === 0) return;
    for (const g of done) {
      st.goods[g] = (st.goods[g] ?? 0) + 1;
      this.emit('craftDone', { good: g });
      this.toast(`${goodDef(g).name} 완성!`, 'good');
    }
    this.emit('itemsChanged', {});
  }

  private tickBooths(dt: number): void {
    const st = this.state;
    for (const b of BOOTH_IDS) {
      const bs = st.booths[b];
      if (bs.cheer !== null) {
        bs.cheer.left -= dt;
        if (bs.cheer.left <= 0) {
          const name = goodDef(bs.cheer.good).name;
          bs.cheer = null;
          this.toast(`${BOOTHS[b].name}의 ${name} 효과가 끝났어요.`, 'info');
        }
      }
      // 단체 놀이의 한판은 판 하나가 같이 끝낸다 (tickGroups).
      if (bs.group !== null) continue;
      for (let i = 0; i < bs.rounds.length; i++) {
        const r = bs.rounds[i];
        if (r === null || r === undefined) continue;
        r.elapsed += dt;
        if (r.elapsed >= r.duration) this.finishRound(b, i, r);
      }
    }
    this.tickGroups(dt);
  }

  // ── 손님 ────────────────────────────────────────────────────────────

  private setPhase(m: Monster, p: MonsterPhase): void {
    m.phase = p;
    m.phaseTime = 0;
  }

  private age(m: Monster): number {
    return this.state.time - (m.born ?? this.state.time);
  }

  /** 머문 시간: 첫 한판부터 (아직 안 놀았으면 온 때부터). 입구에서 걸어오는 시간은 뺀다. */
  private visitAge(m: Monster): number {
    return this.state.time - (m.firstPlay ?? m.born ?? this.state.time);
  }

  /** 반응이 끝난 뒤의 포즈: 빈털터리로 떠나는 손님은 시무룩. */
  private idlePose(m: Monster): Pose {
    return m.phase === 'leaving' && m.broke === true && m.snacked !== true ? 'sad' : 'base';
  }

  private tickMonster(m: Monster, dt: number): void {
    const st = this.state;
    m.phaseTime = (m.phaseTime ?? 0) + dt;
    if (m.cheerCooldown > 0) m.cheerCooldown = Math.max(0, m.cheerCooldown - dt);
    if ((m.poseTime ?? 0) > 0) {
      m.poseTime = (m.poseTime ?? 0) - dt;
      if (m.poseTime <= 0) {
        m.poseTime = 0;
        if (m.phase !== 'reacting') m.pose = this.idlePose(m);
      }
    }
    if (m.phase !== 'leaving') {
      const f = fountainMoodPerMin(st);
      if (f > 0) m.mood = clampMood(m.mood + (f / 60) * dt);
    }
    if (m.path.length > 0) {
      stepMove(m, dt);
      if (m.path.length > 0) return;
    }
    switch (m.phase) {
      case 'arriving':
        this.setPhase(m, 'wandering');
        m.timer = this.rng.range(0.5, 1.5);
        break;
      case 'wandering':
        m.timer -= dt;
        if (m.timer <= 0) this.decide(m);
        break;
      case 'toBooth':
        this.setPhase(m, 'queued');
        if (m.booth !== null) faceToward(m, BOOTH_SPOTS[m.booth].base.x);
        break;
      case 'queued':
        if (m.booth === null || !st.booths[m.booth].queue.includes(m.id)) {
          this.decideSoon(m);
        } else if ((m.phaseTime ?? 0) > TUNE.queueGiveUpSec) {
          m.mood = clampMood(m.mood + TUNE.queueGiveUpMood);
          this.decide(m);
        }
        break;
      case 'toSeat':
        this.seatArrive(m);
        break;
      case 'playing': {
        // 단체 놀이: 참가해 판을 기다리거나 보는 중, 아니면 다음 판에 참가할 때를 본다.
        if (m.booth !== null && st.booths[m.booth].group !== null) {
          this.groupWait(m);
          break;
        }
        // 안전망: 자리에 한판이 없으면 다시 시작하거나 다른 걸 한다.
        const r = m.booth !== null && m.seat !== null ? st.booths[m.booth].rounds[m.seat] : null;
        if (r === null || r === undefined || r.monster !== m.id) this.seatArrive(m);
        break;
      }
      case 'reacting':
        m.timer -= dt;
        if (m.timer <= 0) this.afterReact(m);
        break;
      case 'resting':
        faceToward(m, BUILDING_SPOTS.fountain.x);
        m.timer -= dt;
        m.mood = clampMood(m.mood + TUNE.restMoodPerSec * dt);
        if (m.timer <= 0) this.decide(m);
        break;
      case 'spectating':
        m.timer -= dt;
        if (m.timer <= 0) this.decide(m);
        break;
      case 'leaving':
        this.depart(m);
        break;
    }
  }

  /** 곧 다음 할 일을 고르게 (지금 자리에서 잠깐 멈춤). */
  private decideSoon(m: Monster): void {
    this.detach(m);
    this.setPhase(m, 'wandering');
    m.path = [];
    m.timer = this.rng.range(0.3, 0.8);
  }

  private shouldLeave(m: Monster): boolean {
    return m.patience <= 0 || m.mood < MOOD.leaveBelow || m.wallet < B.minPlayCost(this.state) || this.visitAge(m) > TUNE.maxVisitSec || this.age(m) > TUNE.maxStaySec;
  }

  /** 다음 할 일: 부스 / 쉬기 / 구경 / 걷기 / 떠나기. */
  private decide(m: Monster): void {
    const st = this.state;
    const rng = this.rng;
    const last = m.booth;
    this.detach(m);
    if (this.shouldLeave(m)) {
      this.leave(m);
      return;
    }
    const newcomer = m.stats.rounds === 0;
    if (!newcomer && m.traits.includes('watcher') && rng.chance(0.25) && this.goWatch(m)) return;
    const b = B.chooseBooth(st, rng, m, last);
    const low = m.mood < 40;
    if (b !== null && rng.chance(newcomer ? TUNE.newcomerBooth : low ? 0.55 : 0.8)) {
      this.goBooth(m, b);
      return;
    }
    if (rng.chance(low ? 0.6 : 0.25) && this.goRest(m)) return;
    if (b === null && this.age(m) > 150 && rng.chance(0.2)) {
      this.leave(m);
      return;
    }
    this.goWander(m);
  }

  private goWander(m: Monster): void {
    const nodes = openNodes(this.state.districts).filter((id) => id !== 'gate');
    this.setPhase(m, 'wandering');
    m.timer = this.rng.range(TUNE.wanderPauseSec[0], TUNE.wanderPauseSec[1]);
    if (nodes.length === 0) {
      m.path = [];
      return;
    }
    const id = this.rng.weighted(nodes.map((n) => [n, 1 / (1 + dist(m.pos, NODES[n]) / 700)] as const));
    m.path = route(m.pos, this.jitter(NODES[id], 50), this.state.districts);
  }

  private goRest(m: Monster): boolean {
    const st = this.state;
    const taken = new Set(st.monsters.filter((o) => o !== m && o.phase === 'resting').map((o) => o.spot));
    const free: number[] = [];
    REST_SPOTS.forEach((p, i) => {
      if (!taken.has(i) && pointOpen(p, st.districts)) free.push(i);
    });
    if (free.length === 0) return false;
    const i = this.rng.pick(free);
    const p = REST_SPOTS[i] as Pt;
    this.setPhase(m, 'resting');
    m.spot = i;
    m.path = route(m.pos, p, st.districts);
    m.timer = this.rng.range(TUNE.restSec[0], TUNE.restSec[1]);
    return true;
  }

  /** 구경꾼: 한판이 한창인 부스 옆에 가서 구경. */
  private goWatch(m: Monster): boolean {
    const st = this.state;
    const rng = this.rng;
    const busy = BOOTH_IDS.filter((b) => B.boothOpen(st, b) && st.booths[b].seats.some((id) => id !== null && id !== m.id));
    if (busy.length === 0) return false;
    // 진행 중인 단체 놀이(밖에서 봐도 재미있는 판)를 더 자주 보러 간다.
    const b = rng.weighted(busy.map((x) => [x, st.booths[x].group?.phase === 'running' || st.booths[x].group?.phase === 'gathering' ? TUNE.groupWatchWeight : 1] as const));
    let at: Pt;
    if (st.booths[b].group !== null && isGroupBooth(b)) {
      // 단체 놀이: 놀이마다 구경하는 자리 (경주장은 경주로 바깥 울타리 쪽).
      at = groupGame(b).watchPoint(rng);
    } else {
      const seat = B.seatPt(b, 0);
      const base = BOOTH_SPOTS[b].base;
      const dx = seat.x - base.x;
      const dy = seat.y - base.y;
      const len = Math.hypot(dx, dy) || 1;
      at = { x: seat.x + (dx / len) * 130 + rng.range(-100, 100), y: seat.y + (dy / len) * 130 + rng.range(-30, 50) };
    }
    this.setPhase(m, 'spectating');
    m.path = route(m.pos, at, st.districts);
    m.timer = rng.range(TUNE.watchSec[0], TUNE.watchSec[1]);
    return true;
  }

  private goBooth(m: Monster, b: BoothId): void {
    const st = this.state;
    const bs = st.booths[b];
    this.detach(m);
    bs.queue.push(m.id);
    m.booth = b;
    m.seat = null;
    this.setPhase(m, 'toBooth');
    m.path = route(m.pos, B.queuePt(b, bs.queue.length - 1), st.districts, BOOTH_SPOTS[b].front);
    this.pump(b);
  }

  private leave(m: Monster): void {
    this.detach(m);
    this.setPhase(m, 'leaving');
    m.path = route(m.pos, NODES.gate, this.state.districts, 'gate');
    if ((m.poseTime ?? 0) <= 0) m.pose = this.idlePose(m);
  }

  /** 줄·자리에서 뺀다. */
  private detach(m: Monster): void {
    for (const b of BOOTH_IDS) {
      const bs = this.state.booths[b];
      if (bs.group !== null) this.leaveGroup(b, m);
      const qi = bs.queue.indexOf(m.id);
      if (qi >= 0) {
        bs.queue.splice(qi, 1);
        this.layoutQueue(b);
      }
      for (let i = 0; i < bs.seats.length; i++) {
        if (bs.seats[i] !== m.id) continue;
        bs.seats[i] = null;
        const r = bs.rounds[i];
        if (r !== null && r !== undefined && r.monster === m.id) bs.rounds[i] = null;
      }
    }
    m.booth = null;
    m.seat = null;
  }

  /** 줄 선 손님들을 제자리로 (앞이 비면 한 칸씩 앞으로). */
  private layoutQueue(b: BoothId): void {
    const bs = this.state.booths[b];
    for (let i = bs.queue.length - 1; i >= 0; i--) if (this.monster(bs.queue[i] as MonsterId) === undefined) bs.queue.splice(i, 1);
    bs.queue.forEach((id, idx) => {
      const m = this.monster(id);
      if (m === undefined) return;
      const spot = B.queuePt(b, idx);
      if (m.phase === 'queued') {
        if (dist(m.pos, spot) > 2) m.path = [{ x: spot.x, y: spot.y }];
      } else if (m.phase === 'toBooth') {
        if (m.path.length === 0) m.path = [{ x: spot.x, y: spot.y }];
        else m.path[m.path.length - 1] = { x: spot.x, y: spot.y };
      }
    });
  }

  /** 빈 자리에 줄 맨 앞 손님을 앉힌다. 부스가 닫혔으면 줄을 푼다. */
  private pump(b: BoothId): void {
    const st = this.state;
    const bs = st.booths[b];
    // 안전망: 자리 주인이 없어졌거나 다른 데 있으면 자리를 비운다.
    for (let i = 0; i < bs.seats.length; i++) {
      const id = bs.seats[i];
      if (id === null || id === undefined) continue;
      const m = this.monster(id);
      if (m === undefined || m.booth !== b || m.seat !== i) {
        bs.seats[i] = null;
        const r = bs.rounds[i];
        if (r !== null && r !== undefined && r.monster === id) bs.rounds[i] = null;
      }
    }
    if (bs.queue.length === 0) return;
    if (!B.boothOpen(st, b)) {
      for (const id of bs.queue.splice(0)) {
        const m = this.monster(id);
        if (m === undefined) continue;
        m.booth = null;
        this.decideSoon(m);
      }
      return;
    }
    B.fitSeats(st, b);
    const n = B.boothSeats(st, b);
    // 단체 놀이는 놀이 모듈이 자리를 고른다 (씨름 선수·구경, 줄다리기 적은 편 …). 그 밖은 앞자리부터.
    const game = bs.group !== null && isGroupBooth(b) ? groupGame(b) : null;
    let moved = false;
    for (;;) {
      const free: number[] = [];
      for (let i = 0; i < n; i++) if ((bs.seats[i] ?? null) === null) free.push(i);
      if (free.length === 0) break;
      let m: Monster | undefined;
      while (m === undefined && bs.queue.length > 0) m = this.monster(bs.queue.shift() as MonsterId);
      if (m === undefined) break;
      let i = free[0] as number;
      if (game?.seatFor !== undefined) {
        const seated = Array.from({ length: n }, (_, k) => {
          const id = bs.seats[k] ?? null;
          return id === null ? null : (this.monster(id) ?? null);
        });
        const want = game.seatFor(this.rng, m, free, seated);
        if (free.includes(want)) i = want;
      }
      bs.seats[i] = m.id;
      m.seat = i;
      m.booth = b;
      const target = B.seatPt(b, i);
      const standing = m.phase === 'queued' && m.path.length === 0;
      this.setPhase(m, 'toSeat');
      m.path = standing ? [{ x: target.x, y: target.y }] : route(m.pos, target, st.districts, BOOTH_SPOTS[b].front);
      moved = true;
    }
    if (moved) this.layoutQueue(b);
  }

  /** 자리에 닿았다: 한판 시작 (부스가 닫혔거나 코인·재료가 모자라면 다른 걸 한다). */
  private seatArrive(m: Monster): void {
    const st = this.state;
    const b = m.booth;
    const i = m.seat;
    if (b === null || i === null || st.booths[b].seats[i] !== m.id || !B.boothOpen(st, b) || !B.canPlay(st, b, m)) {
      this.decide(m);
      return;
    }
    this.play(b, i, m);
  }

  /** 자리에서 한판: 단체 놀이는 판에 참가 (또는 다음 판을 기다림), 그 밖은 바로 한판. */
  private play(b: BoothId, seat: number, m: Monster): void {
    if (this.state.booths[b].group !== null && isGroupBooth(b)) this.joinGroup(b, seat, m);
    else this.startRound(b, seat, m);
  }

  private startRound(b: BoothId, seat: number, m: Monster): void {
    const st = this.state;
    const rng = this.rng;
    const bs = st.booths[b];
    const fee = B.boothFee(st, b);
    m.wallet -= fee;
    this.earn(fee, B.seatPt(b, seat));
    // 재료 참가비 (복주머니): 손님이 들고 온 특산 재료가 마을 창고로.
    const matFee = Math.min(B.boothMatFee(b), m.mats);
    if (matFee > 0) {
      m.mats -= matFee;
      const mat = SPECIES[m.species].material;
      const got = addMaterial(st, mat, matFee);
      if (got > 0) this.emit('itemsChanged', {});
      if (got < matFee) this.capToast(mat);
    }
    const betScale = boothDef(b).betScale ?? 1;
    const bet = Math.max(1, Math.min(m.wallet, Math.round(m.wallet * betFraction(rng, m.traits) * betScale)));
    m.wallet -= bet;
    bs.pot += bet;
    m.stats.spent += fee + bet;
    const pace = B.boothStat(st, b, 'pace');
    const cheer = B.boothCheer(bs);
    const luck = (m.traits.includes('lucky') ? TUNE.luckTrait : 0) + (cheer?.luck ?? 0);
    const outcome = decideOutcome(rng, b, luck, { level: bs.level, pace, species: m.species, plushPool: this.plushPool(), raceSec: B.boothRoundSec(st, b) });
    const duration = B.boothRoundSec(st, b) / Math.max(0.5, 1 + (pace - 3) * TUNE.pacePerPoint);
    const round: ActiveRound = { monster: m.id, bet, fee, outcome, elapsed: 0, duration };
    bs.rounds[seat] = round;
    this.setPhase(m, 'playing');
    m.path = [];
    m.pose = 'base';
    m.poseTime = 0;
    m.firstPlay ??= st.time;
    // 앉은 손님은 진행자(0번 자리)를 본다 (화면의 진행자도 같은 점에 서서 손님을 본다).
    faceToward(m, B.hostPt(b, 0).x);
    this.emit('roundStarted', { booth: b, seat, round });
  }

  /**
   * 한판 끝: 지급·기분·반응. crowd = 근처 손님이 따라 반응 (단체 놀이는 판 하나에 한 번, groupCrowd).
   * settled = 이미 항아리에서 뺀 지급 (단체 놀이는 이긴 손님을 한꺼번에 나눈다: finishGroup).
   */
  private finishRound(b: BoothId, seat: number, r: ActiveRound, crowd = true, settled: { payout: number; festival: boolean } | null = null): void {
    const st = this.state;
    const rng = this.rng;
    const bs = st.booths[b];
    bs.rounds[seat] = null;
    const m = this.monster(r.monster);
    if (m === undefined) return;
    const tier = r.outcome.tier;
    const won = tier === 'win' || tier === 'jackpot';
    let payout = settled?.payout ?? 0;
    let festival = settled?.festival ?? false;
    if (settled === null && r.outcome.multiplier > 0) {
      // 항아리 축제는 이긴 손님만 (오리 낚시·복주머니의 돌려받기·아까운 판은 보통 지급).
      if (won && bs.pot >= B.boothPotCap(st, b)) {
        // 항아리 축제: 가득 찬 항아리를 통째로. 부스가 새 항아리를 채운다.
        payout = bs.pot;
        festival = true;
        bs.pot = BOOTHS[b].potSeed;
      } else {
        payout = Math.min(bs.pot, Math.round(r.bet * r.outcome.multiplier));
        bs.pot -= payout;
      }
    }
    m.wallet += payout;
    m.stats.rounds += 1;
    m.stats.won += payout;
    if (won) m.stats.wins += 1;
    if (tier === 'nearMiss') m.stats.nearMisses += 1;
    if (tier === 'jackpot') {
      m.stats.jackpots += 1;
      st.totals.jackpots += 1;
    }
    if (tier === 'jackpot' || festival) m.hadJackpot = true;
    st.totals.rounds += 1;
    m.patience = Math.max(0, m.patience - 1);
    const cheer = B.boothCheer(bs);
    // 빈털터리: 이기지 못했고 더 놀 코인이 없다 (돌려받은 코인이 있어도).
    const broke = !won && m.wallet < B.minPlayCost(st);
    if (broke) m.broke = true;
    const charm = B.boothStat(st, b, 'charm');
    const def = boothDef(b);
    m.mood = clampMood(m.mood + moodDelta(tier, broke, m, charm, cheer?.moodPerRound ?? 0, def.moodLossScale ?? 1) + (festival ? 10 : 0) + (def.moodPerRound ?? 0));
    const d = r.outcome.detail;
    // 인형 뽑기: 뽑은 인형은 도감의 인형 칸에 모인다.
    if (d.kind === 'claw' && (d.result === 'win' || d.result === 'double')) {
      this.addPlush(d.target);
      if (d.target2 !== null) this.addPlush(d.target2);
    }
    // 복주머니 대박: 떠날 때 귀한 물건 확정.
    if (d.kind === 'pouch' && d.content === 'jackpot') m.surePrecious = true;
    const shown: OutcomeTier = festival ? 'jackpot' : tier;
    // 축제로 받은 대박은 부스 대박 반응('종이다 종!' 등)이 아니라 공용 대박 반응으로.
    const reaction = pickReaction(rng, broke ? 'broke' : shown, m, cheer?.reactionBoost ?? 1, festival && tier !== 'jackpot' ? null : b, d);
    this.setPhase(m, 'reacting');
    m.pose = reaction.pose;
    m.poseTime = 0;
    m.timer = reaction.duration;
    this.recordDex(m, reaction.label);
    this.emit('roundFinished', { booth: b, seat, round: r, payout });
    if (festival) {
      this.emit('potFestival', { booth: b, monster: m.id, amount: payout });
      this.toast(`항아리 축제! ${nameSubject(m)} ${BOOTHS[b].name} 항아리를 통째로 받았어요.`, 'good');
    }
    this.emit('monsterReact', { id: m.id, reaction });
    if (crowd) this.spectate(b, seat, m, shown);
  }

  /** 반응이 끝났다: 같은 자리에서 다시 한판, 아니면 다음 할 일. */
  private afterReact(m: Monster): void {
    const st = this.state;
    const wasAgony = m.pose === 'agony';
    m.pose = 'base';
    if (m.broke === true) {
      this.leave(m);
      return;
    }
    const b = m.booth;
    const seat = m.seat;
    if (b !== null && seat !== null && st.booths[b].seats[seat] === m.id && B.boothOpen(st, b) && B.canPlay(st, b, m) && !this.shouldLeave(m)) {
      const pa = TUNE.playAgain;
      let p: number = pa.base;
      if (wasAgony) p += pa.afterNearMiss;
      if (st.booths[b].queue.length > 0) p += pa.queue;
      if (m.traits.includes('bold')) p += pa.bold;
      if (st.booths[b].group !== null) p += pa.group;
      if (this.rng.chance(p)) {
        this.play(b, seat, m);
        return;
      }
    }
    this.decide(m);
  }

  /** 근처 손님이 대박·아깝다(구경꾼은 이김도)를 보고 따라 반응한다. */
  private spectate(b: BoothId, seat: number, m: Monster, tier: OutcomeTier): void {
    if (tier === 'lose') return;
    const rng = this.rng;
    const at = B.seatPt(b, seat);
    for (const o of this.state.monsters) {
      if (o === m || o.phase === 'leaving' || o.phase === 'playing' || o.phase === 'reacting') continue;
      if (dist(o.pos, at) > TUNE.spectateRadius) continue;
      const watcher = o.traits.includes('watcher');
      if (tier === 'win' && !watcher) continue;
      if (!rng.chance(watcher ? TUNE.watcherSpectateChance : TUNE.spectateChance)) continue;
      const reaction = spectateReaction(rng, tier, o);
      o.mood = clampMood(o.mood + TUNE.spectateMood[tier]);
      if (o.path.length === 0) {
        if (o.phase === 'wandering') {
          this.setPhase(o, 'spectating');
          o.timer = reaction.duration + 0.5;
        }
        o.pose = reaction.pose;
        o.poseTime = reaction.duration;
        faceToward(o, at.x);
      }
      this.emit('monsterSpectate', { id: o.id, target: m.id, reaction });
    }
  }

  // ── 단체 놀이 (손님 여럿이 한 판: 경주장·밀어내기·오리배·연날리기·줄다리기·보물찾기) ─────────
  // 줄 맨 앞 손님이 자리를 고른다 (GroupGame.seatFor, pump) → 자리에 앉은 손님이 고르고 건다 (gathering, 출발 조건이 안 맞으면 stepIn) →
  // 출발 (running, 판을 이때 정하고 참가자마다 한판, 근처를 걷던 손님이 구경하러 온다: drawCrowd) → 사건마다 참가자 응원과 근처 구경꾼 들썩임 (groupBuzz) →
  // 끝나면 참가자가 한꺼번에 반응 (done), 근처 손님 구경 반응 (groupCrowd) → idle.
  // 상태는 BoothState.group (types.ts GroupState), 놀이마다의 규칙은 sim/group/<booth>.ts.

  /** 단체 놀이 부스의 상태 (그 밖은 null). */
  private groupOf(b: BoothId): { g: GroupState; booth: GroupBoothId } | null {
    const g = this.state.booths[b].group;
    return g !== null && isGroupBooth(b) ? { g, booth: b } : null;
  }

  /** 자리에 앉은 손님: 판이 쉬거나 모이는 중이면 골라서 참가, 진행 중·결과 중이면 다음 판을 기다린다. */
  private joinGroup(b: GroupBoothId, seat: number, m: Monster): void {
    const st = this.state;
    const bs = st.booths[b];
    const g = (bs.group ??= idleGroup());
    const game = groupGame(b);
    if (m.phase !== 'playing') {
      this.setPhase(m, 'playing');
      m.pose = 'base';
      m.poseTime = 0;
    }
    m.path = [];
    faceToward(m, game.face(seat).x);
    if (g.phase === 'running' || g.phase === 'done') return;
    if (g.participants.some((e) => e.monster === m.id)) return;
    const fee = B.boothFee(st, b);
    // 지난 판에 편 맞추기로 빠진 손님은 이미 낸 참가비로 (줄다리기 lineup, startGroup).
    const pre = g.prepaid?.indexOf(m.id) ?? -1;
    if (pre >= 0) g.prepaid?.splice(pre, 1);
    else {
      m.wallet -= fee;
      this.earn(fee, B.seatPt(b, seat));
    }
    const bet = Math.max(1, Math.min(m.wallet, Math.round(m.wallet * betFraction(this.rng, m.traits) * (boothDef(b).betScale ?? 1))));
    m.wallet -= bet;
    bs.pot += bet;
    m.stats.spent += (pre >= 0 ? 0 : fee) + bet;
    m.firstPlay ??= st.time;
    const { pick, role } = game.join(this.rng, seat, m, g.participants, (id) => this.monster(id));
    g.participants.push({ monster: m.id, seat, pick, role, bet, fee });
    const pace = B.boothStat(st, b, 'pace');
    if (g.phase === 'idle') {
      g.phase = 'gathering';
      g.countdown = groupGatherSec(b, pace);
      g.elapsed = 0;
      g.duration = 0;
      g.play = null;
    }
    if (game.readiness(g.participants, g.elapsed) === 'soon') g.countdown = Math.min(g.countdown, groupStartSoonSec(b, pace));
    if (g.participants.length >= B.boothSeats(st, b)) g.countdown = Math.min(g.countdown, GROUP_RULES[b].fullStartSec);
    this.emit('groupJoined', { booth: b, monster: m.id, seat, pick, role, bet });
  }

  /** 자리에 앉아 있는 단체 놀이 손님 (phase 'playing'): 이번 판의 참가자면 기다리고, 아니면 참가할 수 있을 때 참가. */
  private groupWait(m: Monster): void {
    const b = m.booth;
    const g = b === null ? null : this.state.booths[b].group;
    if (g !== null && g.phase !== 'idle' && g.participants.some((e) => e.monster === m.id)) {
      // 참가자는 자기 자리의 놀이 쪽을 본다 (구경 자리에서 모래판으로 나서 걸어온 손님도).
      if (b !== null && m.seat !== null && isGroupBooth(b)) faceToward(m, groupGame(b).face(m.seat).x);
      return;
    }
    // 판에 끼지 못하고 (줄다리기 편 맞추기) 너무 오래 기다렸다: 다른 걸 하러 간다.
    if (g !== null && (g.phase === 'running' || g.phase === 'done') && (m.phaseTime ?? 0) > TUNE.groupBenchGiveUpSec) {
      m.mood = clampMood(m.mood + TUNE.queueGiveUpMood);
      this.decide(m);
      return;
    }
    this.seatArrive(m);
  }

  /** 건 코인을 항아리에서 돌려준다 (참가비는 마을에 남는다). */
  private refundBet(b: BoothId, e: GroupEntry): void {
    const bs = this.state.booths[b];
    const m = this.monster(e.monster);
    if (m === undefined) return;
    const back = Math.min(e.bet, bs.pot);
    bs.pot -= back;
    m.wallet += back;
    m.stats.spent = Math.max(0, m.stats.spent - back);
  }

  /** 모이는 중에 자리를 뜬 참가자: 참가를 무르고 건 코인을 돌려준다. 진행 중이면 결과만 못 받는다. */
  private leaveGroup(b: BoothId, m: Monster): void {
    const g = this.state.booths[b].group;
    if (g === null || g.phase !== 'gathering') return;
    const i = g.participants.findIndex((e) => e.monster === m.id);
    const e = g.participants[i];
    if (e === undefined) return;
    g.participants.splice(i, 1);
    this.refundBet(b, e);
  }

  /** 출발 전에 판을 접는다: 참가자마다 건 코인을 돌려준다 (leaveGroup과 같이). timeout이면 앉아 있던 참가자는 다른 걸 하러 간다. */
  private cancelGroup(b: GroupBoothId, g: GroupState, reason: 'closed' | 'timeout'): void {
    const left = g.participants.slice();
    for (const e of left) this.refundBet(b, e);
    this.resetGroup(g);
    this.emit('groupCancelled', { booth: b, reason });
    if (reason !== 'timeout') return;
    for (const e of left) {
      const m = this.monster(e.monster);
      if (m !== undefined && m.booth === b && m.seat === e.seat && m.phase === 'playing') this.decide(m);
    }
  }

  private resetGroup(g: GroupState): void {
    g.phase = 'idle';
    g.countdown = 0;
    g.elapsed = 0;
    g.duration = 0;
    g.participants = [];
    g.play = null;
    delete g.mark;
    delete g.markAt;
    delete g.cursor;
  }

  private tickGroups(dt: number): void {
    for (const b of BOOTH_IDS) {
      const gb = this.groupOf(b);
      if (gb === null) continue;
      const { g, booth } = gb;
      switch (g.phase) {
        case 'idle':
          if (g.participants.length > 0) g.participants = [];
          break;
        case 'gathering': {
          if (g.participants.length === 0) {
            this.resetGroup(g);
            break;
          }
          // 모이는 중에 꼭 있어야 하는 진행자가 빠졌다: 건 코인을 돌려주고 판을 접는다 (앉은 손님은 다른 걸 하러 간다).
          if (!B.boothOpen(this.state, b)) {
            this.cancelGroup(booth, g, 'closed');
            break;
          }
          g.elapsed += dt;
          g.countdown = Math.max(0, g.countdown - dt);
          const game = groupGame(booth);
          let ready = game.readiness(g.participants, g.elapsed);
          // 출발 조건이 안 맞으면 참가자가 다른 자리로 나서 본다 (밀어내기 상대가 오지 않으면 구경 손님이 모래판으로).
          if (ready === 'none' && game.stepIn !== undefined && this.stepInGroup(booth, g)) ready = game.readiness(g.participants, g.elapsed);
          // 자리로 걸어오는 손님이 있으면 기다려 준다 (첫 손님이 앉고 gatherSec까지는 누구든, 그 뒤 조금 더는 곧 닿는 손님: waitComing).
          if (g.countdown <= 0 && ready !== 'none' && !this.waitComing(booth, g)) this.startGroup(booth, g);
          else if (ready === 'none' && g.elapsed > GROUP_RULES[booth].maxWaitSec) this.cancelGroup(booth, g, 'timeout');
          break;
        }
        case 'running': {
          g.elapsed += dt;
          const rounds = this.state.booths[b].rounds;
          for (const e of g.participants) {
            const r = rounds[e.seat];
            if (r !== null && r !== undefined && r.monster === e.monster) r.elapsed = Math.min(g.elapsed, r.duration);
          }
          this.groupProgress(booth, g);
          if (g.elapsed >= g.duration) this.finishGroup(booth, g);
          break;
        }
        case 'done':
          g.countdown -= dt;
          if (g.countdown <= 0) this.resetGroup(g);
          break;
      }
    }
  }

  /** 참가자 하나가 다른 자리로 나선다 (GroupGame.stepIn): 자리를 옮겨 걸어가고, 출발은 조금 기다린다. 옮겼으면 true. */
  private stepInGroup(b: GroupBoothId, g: GroupState): boolean {
    const bs = this.state.booths[b];
    const n = B.boothSeats(this.state, b);
    const free: number[] = [];
    for (let i = 0; i < n; i++) if ((bs.seats[i] ?? null) === null) free.push(i);
    const s = groupGame(b).stepIn?.(g.participants, g.elapsed, free, (id) => this.monster(id)) ?? null;
    const e = s === null ? undefined : g.participants[s.index];
    const m = e === undefined ? undefined : this.monster(e.monster);
    if (s === null || e === undefined || m === undefined || !free.includes(s.seat) || bs.seats[e.seat] !== m.id) return false;
    bs.seats[e.seat] = null;
    bs.seats[s.seat] = m.id;
    m.seat = s.seat;
    e.seat = s.seat;
    e.pick = s.pick;
    e.role = s.role;
    const to = B.seatPt(b, s.seat);
    m.path = [{ x: to.x, y: to.y }];
    g.countdown = Math.max(g.countdown, groupStartSoonSec(b, B.boothStat(this.state, b, 'pace')));
    this.emit('groupJoined', { booth: b, monster: m.id, seat: s.seat, pick: s.pick, role: s.role, bet: e.bet });
    this.pump(b);
    return true;
  }

  /** 이 부스 자리로 걸어오는 손님 가운데 가장 먼저 닿는 손님까지 남은 초 (없으면 Infinity). */
  private comingSec(b: BoothId): number {
    let best = Infinity;
    for (const id of this.state.booths[b].seats) {
      if (id === null) continue;
      const m = this.monster(id);
      if (m === undefined || m.phase !== 'toSeat' || m.booth !== b) continue;
      let d = 0;
      let at = m.pos;
      for (const p of m.path) {
        d += dist(at, p);
        at = p;
      }
      best = Math.min(best, d / speedOf(m));
    }
    return best;
  }

  /**
   * 출발을 미루고 걸어오는 손님을 기다리나: 첫 손님이 앉고 gatherSec까지는 누구든, 그 뒤 TUNE.groupWaitExtraSec까지는
   * TUNE.groupWaitWalkSec 안에 닿는 손님을 (여럿이 같이 놀게: 큰 지도에서 멀리서 오는 손님이 다음 판으로 밀리지 않게).
   */
  private waitComing(b: GroupBoothId, g: GroupState): boolean {
    const gather = groupGatherSec(b, B.boothStat(this.state, b, 'pace'));
    if (g.elapsed >= gather + TUNE.groupWaitExtraSec) return false;
    const sec = this.comingSec(b);
    return sec < Infinity && (g.elapsed < gather || sec <= TUNE.groupWaitWalkSec);
  }

  /**
   * 출발: 자리에 남은 참가자(놀이 모듈 lineup이 고른 손님)로 판 하나를 정하고 참가자마다 한판을 연다.
   * lineup에서 빠진 손님은 건 코인을 돌려받고 다음 판을 기다린다. 행운(행운아·행운 부적)이 붙은 손님 쪽이 이긴다.
   */
  private startGroup(b: GroupBoothId, g: GroupState): void {
    const st = this.state;
    const bs = st.booths[b];
    const game = groupGame(b);
    g.participants = g.participants.filter((e) => {
      const m = this.monster(e.monster);
      return m !== undefined && m.booth === b && m.seat === e.seat && bs.seats[e.seat] === m.id;
    });
    if (g.participants.length === 0) {
      this.resetGroup(g);
      return;
    }
    // 자리를 뜬 손님이 있어 출발 조건이 깨졌으면 (씨름 선수가 떠남) 더 기다린다.
    if (game.readiness(g.participants, g.elapsed) === 'none') return;
    if (game.lineup !== undefined) {
      // 오래 기다린 손님부터 (지난 판에 빠진 손님이 이번엔 끼게): 자리에서 기다린 초(phaseTime) 순서로 고르고, 순서는 그대로 둔다.
      const waited = (e: GroupEntry): number => this.monster(e.monster)?.phaseTime ?? 0;
      const keep = new Set(game.lineup(g.participants.slice().sort((x, y) => waited(y) - waited(x))));
      // 빠진 손님: 건 코인은 돌려주고, 낸 참가비는 다음 판 몫으로 (prepaid: 다음 joinGroup에서 참가비를 다시 받지 않는다).
      // 지난번에 빠졌다가 자리를 뜬 손님은 지운다.
      const prepaid = (g.prepaid ?? []).filter((id) => bs.seats.includes(id) && !g.participants.some((e) => e.monster === id));
      for (const e of g.participants) {
        if (keep.has(e)) continue;
        this.refundBet(b, e);
        if (!prepaid.includes(e.monster)) prepaid.push(e.monster);
      }
      g.prepaid = prepaid;
      g.participants = g.participants.filter((e) => keep.has(e));
    }
    const cheer = B.boothCheer(bs);
    let lucky = -1;
    for (let i = 0; i < g.participants.length; i++) {
      const m = this.monster((g.participants[i] as GroupEntry).monster);
      const luck = (m?.traits.includes('lucky') === true ? TUNE.luckTrait : 0) + (cheer?.luck ?? 0);
      if (luck > 0 && this.rng.chance(luck)) {
        lucky = i;
        break;
      }
    }
    // 판 길이: 경주장·오리배는 부스 레벨대로 (진행은 출발 대기만 줄인다), 그 밖은 진행(심판·바람지기·삽 대여)이 높을수록 조금 짧게.
    const pace = B.boothStat(st, b, 'pace');
    const base = B.boothRoundSec(st, b);
    const duration = b === 'race' || b === 'boat' ? base : base / Math.max(0.5, 1 + (pace - 3) * TUNE.groupPacePerPoint);
    const play = game.generate(this.rng, g.participants, { duration, level: bs.level, pace, lucky, seats: B.boothSeats(st, b) });
    g.phase = 'running';
    g.countdown = 0;
    g.elapsed = 0;
    g.duration = play.end;
    g.play = play;
    g.mark = null;
    g.markAt = 0;
    g.cursor = 0;
    // 한판을 먼저 다 열고 (groupStarted를 듣는 쪽이 자리마다 한판을 읽을 수 있게) 알린다.
    const rounds = g.participants.map((e, i) => {
      const outcome = play.outcomes[i] as RoundOutcome;
      const round: ActiveRound = { monster: e.monster, bet: e.bet, fee: e.fee, outcome, elapsed: 0, duration: play.end };
      bs.rounds[e.seat] = round;
      return { seat: e.seat, round };
    });
    this.emit('groupStarted', { booth: b, group: g });
    for (const x of rounds) this.emit('roundStarted', { booth: b, seat: x.seat, round: x.round });
    this.drawCrowd(b, play);
  }

  /**
   * 판이 시작했다: 근처를 걷던 손님이 발을 멈추고 구경하러 온다 (놀이마다 구경하는 자리 watchPoint, 결과를 볼 때까지).
   * 손님맞이가 높을수록 더 잘 모인다. 아직 한판도 안 한 손님은 부스로 가게 둔다. 걸어서 판이 끝나기 전에 닿지 못하면 오지 않는다.
   */
  private drawCrowd(b: GroupBoothId, play: GroupPlay): void {
    const st = this.state;
    const rng = this.rng;
    const game = groupGame(b);
    const welcome = B.boothStat(st, b, 'welcome', TUNE.emptyWelcome);
    const k = Math.max(0.3, 1 + (welcome - 3) * TUNE.groupDrawPerWelcome);
    const stay = play.end + GROUP_RULES[b].resultSec + 0.5;
    for (const o of st.monsters) {
      if (o.phase !== 'wandering' || o.stats.rounds === 0) continue;
      if (dist(o.pos, game.center) > TUNE.groupDrawRadius) continue;
      if (!rng.chance((o.traits.includes('watcher') ? TUNE.groupWatcherDrawChance : TUNE.groupDrawChance) * k)) continue;
      const path = route(o.pos, game.watchPoint(rng), st.districts);
      let walk = 0;
      let at = o.pos;
      for (const p of path) {
        walk += dist(at, p);
        at = p;
      }
      walk /= speedOf(o);
      if (walk > play.end * 0.6) continue;
      this.setPhase(o, 'spectating');
      o.path = path;
      o.timer = Math.max(1.5, stay - walk);
    }
  }

  /** 진행 중 사건 (놀이 모듈 poll): 참가자 기분 + 입담, 자기 쪽이 앞서면 들썩·뒤처지면 조마조마 (pose도 잠깐). */
  private groupProgress(b: GroupBoothId, g: GroupState): void {
    const play = g.play;
    if (play === null) return;
    const game = groupGame(b);
    const t = g.elapsed;
    const ev = game.poll(play, g, t);
    if (ev === null) return;
    if (play.events[g.cursor ?? 0] === ev) g.cursor = (g.cursor ?? 0) + 1;
    g.mark = ev.actor;
    g.markAt = t;
    const charm = B.boothStat(this.state, b, 'charm');
    const boost = B.boothCheer(this.state.booths[b])?.reactionBoost ?? 1;
    const mood = game.moodOn?.(ev) ?? true;
    const cheers: GroupCheer[] = [];
    for (const e of g.participants) {
      const m = this.monster(e.monster);
      if (m === undefined || m.booth !== b || m.phase !== 'playing') continue;
      if (mood) m.mood = clampMood(m.mood + charm * TUNE.groupCommentMood);
      const kind = game.cheer(play, e, ev);
      if (kind === null) continue;
      const reaction = groupCheerReaction(this.rng, b, kind, m, boost, cheerKey(ev.type, ev.actor, e.pick, game.cheerDetail?.(play, ev) ?? null));
      m.pose = reaction.pose;
      m.poseTime = reaction.duration;
      cheers.push({ id: m.id, pick: e.pick, kind, reaction });
    }
    this.emit('groupEvent', { booth: b, group: g, event: ev, cheers });
    const buzz = game.buzz?.(play, ev, g.participants) ?? null;
    if (buzz !== null) this.groupBuzz(b, g, buzz.kind, buzz.star, charm);
  }

  /** 진행 중 큰 사건에 놀이 근처 손님(참가자 말고, 자리에서 다음 판을 기다리는 손님 포함)이 들썩인다 (monsterSpectate, 이미 반응 중이면 넘어간다). */
  private groupBuzz(b: GroupBoothId, g: GroupState, kind: GroupBuzz, star: number, charm: number): void {
    const rng = this.rng;
    const game = groupGame(b);
    const target = (star >= 0 ? g.participants[star] : undefined)?.monster ?? g.participants[0]?.monster;
    if (target === undefined) return;
    const joined = new Set(g.participants.map((e) => e.monster));
    const look = game.face(-1);
    for (const o of this.state.monsters) {
      if (joined.has(o.id) || o.phase === 'leaving' || o.phase === 'arriving' || o.phase === 'reacting' || (o.poseTime ?? 0) > 0) continue;
      if (o.phase === 'playing' && o.booth !== b) continue;
      if (dist(o.pos, game.center) > TUNE.groupSpectateRadius) continue;
      if (!rng.chance((o.traits.includes('watcher') ? TUNE.groupWatcherBuzzChance : TUNE.groupBuzzChance) + charm * TUNE.groupBuzzPerCharm)) continue;
      const reaction = groupBuzzReaction(rng, b, kind, o);
      o.mood = clampMood(o.mood + TUNE.groupBuzzMood[kind]);
      if (o.path.length === 0) {
        if (o.phase === 'wandering') {
          this.setPhase(o, 'spectating');
          o.timer = reaction.duration + 0.5;
        }
        o.pose = reaction.pose;
        o.poseTime = reaction.duration;
        if (o.phase !== 'playing') faceToward(o, look.x);
      }
      this.emit('monsterSpectate', { id: o.id, target, reaction });
    }
  }

  /** 판이 끝났다: 참가자마다 한판 끝 (한꺼번에 반응), 근처 손님은 구경 반응. */
  private finishGroup(b: GroupBoothId, g: GroupState): void {
    const bs = this.state.booths[b];
    const play = g.play;
    g.phase = 'done';
    g.countdown = GROUP_RULES[b].resultSec;
    g.elapsed = g.duration;
    this.emit('groupFinished', { booth: b, group: g });
    const done: { e: GroupEntry; r: ActiveRound }[] = [];
    for (const e of g.participants) {
      const r = bs.rounds[e.seat];
      if (r !== null && r !== undefined && r.monster === e.monster) done.push({ e, r });
    }
    const pays = this.settleGroup(b, done);
    done.forEach(({ e, r }, i) => this.finishRound(b, e.seat, r, false, pays[i] ?? { payout: 0, festival: false }));
    if (play !== null) this.groupCrowd(b, g, play);
  }

  /**
   * 단체 놀이 지급을 한꺼번에 정한다 (항아리에서 뺀다): 참가 차례대로 주면 먼저 온 손님이 항아리를 비워 늦게 온 승자가 0코인이 된다.
   * 항아리가 가득 찼으면 (항아리 축제) 이긴 손님 하나(받을 몫이 가장 큰 손님, 같으면 선수)가 다른 손님 몫을 뺀 나머지를 통째로 받는다.
   * 모자라면 모두 같은 비율로 줄인다.
   */
  private settleGroup(b: GroupBoothId, done: readonly { e: GroupEntry; r: ActiveRound }[]): { payout: number; festival: boolean }[] {
    const st = this.state;
    const bs = st.booths[b];
    const want = done.map(({ r }) => (r.outcome.multiplier > 0 ? Math.round(r.bet * r.outcome.multiplier) : 0));
    const won = done.map(({ r }) => r.outcome.tier === 'win' || r.outcome.tier === 'jackpot');
    let fest = -1;
    if (bs.pot >= B.boothPotCap(st, b)) {
      done.forEach(({ e }, i) => {
        if (!won[i]) return;
        const best = fest < 0 ? null : done[fest];
        const w = want[i] ?? 0;
        const bw = fest < 0 ? -1 : (want[fest] ?? 0);
        if (best === null || best === undefined || w > bw || (w === bw && e.role === 'player' && best.e.role !== 'player')) fest = i;
      });
    }
    // 다른 손님 몫을 빼고 남는 것이 제 몫보다 적으면 축제 없이 나눈다.
    if (fest >= 0 && bs.pot - want.reduce((sum, w, i) => sum + (i === fest ? 0 : w), 0) < (want[fest] ?? 0)) fest = -1;
    const total = want.reduce((sum, w, i) => sum + (i === fest ? 0 : w), 0);
    const k = total > bs.pot ? bs.pot / total : 1;
    const pays = want.map((w, i) => ({ payout: i === fest ? 0 : Math.floor(w * k), festival: false }));
    bs.pot -= pays.reduce((sum, p) => sum + p.payout, 0);
    const f = pays[fest];
    if (f !== undefined) {
      f.payout = Math.max(0, bs.pot);
      f.festival = true;
      bs.pot = BOOTHS[b].potSeed;
    }
    return pays;
  }

  /** 결과 뒤 놀이 근처 손님 (자리에서 다음 판을 기다리는 손님, 줄, 지나가던 손님): 역전이면 박수, 아슬아슬하면 어머나. */
  private groupCrowd(b: GroupBoothId, g: GroupState, play: GroupPlay): void {
    const st = this.state;
    const rng = this.rng;
    const game = groupGame(b);
    const { tier, star } = game.crowd(play, g.participants);
    const joined = new Set(g.participants.map((e) => e.monster));
    const target = (star >= 0 ? g.participants[star] : undefined)?.monster ?? g.participants[0]?.monster;
    if (target === undefined) return;
    const charm = B.boothStat(st, b, 'charm');
    const center = game.center;
    const look = game.face(-1);
    for (const o of st.monsters) {
      if (joined.has(o.id) || o.phase === 'leaving' || o.phase === 'arriving') continue;
      // 다른 부스에서 노는 손님은 빼고, 이 부스 자리에서 기다리던 손님은 넣는다.
      if ((o.phase === 'playing' || o.phase === 'reacting') && o.booth !== b) continue;
      if (dist(o.pos, center) > TUNE.groupSpectateRadius) continue;
      if (!rng.chance(o.traits.includes('watcher') ? TUNE.groupWatcherSpectateChance : TUNE.groupSpectateChance)) continue;
      const reaction = groupSpectateReaction(rng, b, tier, o);
      o.mood = clampMood(o.mood + TUNE.spectateMood[tier] + charm * TUNE.groupCasterSpectate);
      if (o.path.length === 0) {
        if (o.phase === 'wandering') {
          this.setPhase(o, 'spectating');
          o.timer = reaction.duration + 0.5;
        }
        o.pose = reaction.pose;
        o.poseTime = reaction.duration;
        faceToward(o, look.x);
      }
      this.emit('monsterSpectate', { id: o.id, target, reaction });
    }
  }

  /** 입구에 닿았다: 팁·재료·귀한 물건을 남기고 사라진다. monsterLeft는 지우기 직전에 낸다 (sim.monster(id)가 아직 있다). */
  private depart(m: Monster): void {
    const st = this.state;
    const rng = this.rng;
    const tip = Math.max(0, Math.min(Math.floor(m.wallet), Math.round(m.mood * MOOD.tipPerMood * (1 + m.stats.wins * TUNE.tipWinBonus))));
    m.wallet -= tip;
    let material: MaterialId | null = null;
    const [c0, c1] = MOOD.materialChance;
    if (rng.chance(c0 + (c1 - c0) * Math.max(0, Math.min(1, m.mood / 100)))) {
      const mat = SPECIES[m.species].material;
      const want = m.mood >= TUNE.bonusMaterialMood ? 2 : 1;
      const got = addMaterial(st, mat, want);
      if (got > 0) material = mat;
      if (got < want) this.capToast(mat);
    }
    let precious: PreciousId | null = null;
    if (m.surePrecious === true || (m.hadJackpot && m.mood >= TUNE.preciousMood && rng.chance(MOOD.preciousChance))) {
      precious = this.pickPrecious();
      st.precious[precious] = (st.precious[precious] ?? 0) + 1;
    }
    this.earn(tip, m.pos);
    if (material !== null || precious !== null) this.emit('itemsChanged', {});
    this.emit('monsterLeft', { id: m.id, tip, material, precious });
    if (precious !== null) this.toast(`${nameSubject(m)} ${josa(PRECIOUS[precious].name, '을', '를')} 남기고 갔어요!`, 'good');
    if (m.broke === true && m.snacked === true) this.addRegular(m);
    const i = st.monsters.indexOf(m);
    if (i >= 0) st.monsters.splice(i, 1);
  }

  /** 귀한 물건: 적게 가진 것, 다음 회관(×4)·부스 해금(×2)에 모자란 것이 더 잘 나온다. */
  private pickPrecious(): PreciousId {
    const st = this.state;
    const ids = Object.keys(PRECIOUS) as PreciousId[];
    const boost = new Map<PreciousId, number>(ids.map((id) => [id, 1]));
    const want = (c: Cost | null, k: number) => {
      for (const [id, n] of Object.entries(c?.precious ?? {}) as [PreciousId, number][]) {
        if ((st.precious[id] ?? 0) < n) boost.set(id, Math.max(boost.get(id) ?? 1, k));
      }
    };
    for (const b of BOOTH_IDS) want(this.boothUnlockCost(b), 2);
    want(this.buildingUpgradeCost('hall'), 4);
    return this.rng.weighted(ids.map((id) => [id, (boost.get(id) ?? 1) / (1 + (st.precious[id] ?? 0))] as const));
  }

  private capToast(mat: MaterialId): void {
    if (this.state.time - this.lastCapToast < TUNE.capToastSec) return;
    this.lastCapToast = this.state.time;
    this.toast(`창고가 가득 차서 ${josa(MATERIALS[mat].name, '을', '를')} 더 못 받았어요.`, 'warn');
  }

  private addRegular(m: Monster): void {
    const regs = (this.state.regulars ??= []);
    if (regs.some((r) => r.species === m.species && r.nickname === m.nickname)) return;
    regs.push({ species: m.species, nickname: m.nickname, traits: [...m.traits] });
    while (regs.length > TUNE.regularMax) regs.shift();
  }

  private recordDex(m: Monster, label: string): void {
    const d = (this.state.dex[m.species] ??= { visits: 1, reactions: [] });
    if (!d.reactions.includes(label)) d.reactions.push(label);
  }

  /** 인형 하나를 도감에 (그 종을 아직 못 봤어도 칸을 연다). 그 종 인형이 처음이면 알린다. */
  private addPlush(species: SpeciesId): void {
    const d = (this.state.dex[species] ??= { visits: 0, reactions: [] });
    const first = (d.plush ?? 0) === 0;
    d.plush = (d.plush ?? 0) + 1;
    if (first) this.toast(`${SPECIES[species].name} 인형을 처음 뽑았어요! 도감에 모았어요.`, 'good');
  }

  /** 인형 뽑기 상품으로 나올 종: 마을에 와 본 종 (없으면 모든 종). */
  private plushPool(): SpeciesId[] {
    const dex = this.state.dex;
    return SPECIES_IDS.filter((s) => (dex[s]?.visits ?? 0) > 0);
  }

  // ── 촌장의 행동 ─────────────────────────────────────────────────────

  cheer(id: MonsterId): Result {
    const m = this.monster(id);
    if (m === undefined) return fail('손님을 찾을 수 없어요.');
    if (m.cheerCooldown > 0) return fail('응원은 조금 있다가 다시 할 수 있어요.');
    m.mood = clampMood(m.mood + MOOD.cheerTap);
    m.cheerCooldown = MOOD.cheerCooldownSec;
    this.emit('monsterCheered', { id, by: 'tap' });
    return OK;
  }

  giveSnack(id: MonsterId, good: GoodId): Result {
    const st = this.state;
    const m = this.monster(id);
    if (m === undefined) return fail('손님을 찾을 수 없어요.');
    const g = goodDef(good);
    if (g.kind !== 'snack') return fail('간식이 아니에요.');
    if ((st.goods[good] ?? 0) <= 0) return fail(`${josa(g.name, '이', '가')} 없어요. 공방에서 만들어요.`);
    st.goods[good] -= 1;
    const foodie = m.traits.includes('foodie');
    m.mood = clampMood(m.mood + (g.mood ?? 0) * (foodie ? TUNE.foodieSnack : 1));
    m.patience += (g.patience ?? 0) + (foodie ? 1 : 0);
    m.snacked = true;
    const reaction = snackReaction(this.rng, m);
    this.recordDex(m, reaction.label);
    this.emit('itemsChanged', {});
    this.emit('monsterCheered', { id, by: good });
    if (m.phase !== 'playing') {
      m.pose = reaction.pose;
      m.poseTime = reaction.duration;
      this.emit('monsterReact', { id, reaction });
    }
    // 떠나던 손님이 기운을 차리면 다시 놀러 간다 (빈털터리는 웃으며 떠난다).
    if (m.phase === 'leaving' && m.broke !== true && !this.shouldLeave(m)) this.decideSoon(m);
    return OK;
  }

  placeCheer(booth: BoothId, good: GoodId): Result {
    const st = this.state;
    const g = goodDef(good);
    if (g.kind !== 'cheer') return fail('응원 도구가 아니에요.');
    if (!st.booths[booth].unlocked) return fail('아직 열리지 않은 부스예요.');
    const now = st.booths[booth].cheer;
    // 다른 응원 도구가 걸려 있으면 덮어쓰지 않는다 (남은 시간이 날아가지 않게). 같은 도구는 시간이 늘어난다.
    if (now !== null && now.left > 0 && now.good !== good) return fail(`이미 ${josa(goodDef(now.good).name, '이', '가')} 걸려 있어요 (${Math.ceil(now.left)}초 남음).`);
    if ((st.goods[good] ?? 0) <= 0) return fail(`${josa(g.name, '이', '가')} 없어요. 공방에서 만들어요.`);
    st.goods[good] -= 1;
    const dur = g.durationSec ?? 180;
    st.booths[booth].cheer = now !== null && now.left > 0 ? { good, left: now.left + dur } : { good, left: dur };
    this.emit('itemsChanged', {});
    return OK;
  }

  upgradeBuilding(id: BuildingId): Result {
    const st = this.state;
    const cost = nextBuildingCost(st, id);
    if (cost === null) return fail('이미 최고 레벨이에요.');
    const why = missingReason(st, cost);
    if (why !== null) return fail(why);
    this.spend(cost, BUILDING_SPOTS[id]);
    st.buildings[id].level += 1;
    const level = st.buildings[id].level;
    this.emit('buildingUpgraded', { id, level });
    if (id === 'hall') this.onHallLevel(level);
    if (id === 'office') {
      fillCandidates(this.rng, st, officeCandidates(st), false);
      this.emit('staffChanged', {});
    }
    return OK;
  }

  private onHallLevel(level: number): void {
    const st = this.state;
    for (const d of Object.keys(DISTRICTS) as DistrictId[]) {
      if (DISTRICTS[d].hall > level || st.districts.includes(d)) continue;
      st.districts.push(d);
      this.emit('districtOpened', { district: d });
      this.toast(`${josa(DISTRICTS[d].name, '이', '가')} 열렸어요!`, 'good');
    }
    const newcomers = SPECIES_IDS.filter((s) => SPECIES[s].hall === level).map((s) => SPECIES[s].name);
    if (newcomers.length > 0) this.toast(`이제 ${newcomers.join(', ')} 손님도 놀러 와요.`, 'good');
    // 새로 열 수 있는 부스의 진행자(그림 있는 진행자)가 고용 후보로 온다.
    const fresh = presetCandidates(level, [...st.staff.map((x) => x.art), ...st.candidates.map((c) => c.art)]);
    if (fresh.length > 0) {
      st.candidates.push(...fresh);
      this.emit('staffChanged', {});
    }
  }

  unlockBooth(booth: BoothId): Result {
    const st = this.state;
    const bs = st.booths[booth];
    if (bs.unlocked) return fail('이미 열린 부스예요.');
    const lock = this.boothLockReason(booth);
    if (lock !== null) return fail(lock);
    const cost = this.boothUnlockCost(booth);
    if (cost === null) return fail('이미 열린 부스예요.');
    const why = missingReason(st, cost);
    if (why !== null) return fail(why);
    this.spend(cost, BOOTH_SPOTS[booth].base);
    bs.unlocked = true;
    bs.level = 1;
    bs.pot = BOOTHS[booth].potSeed;
    bs.queue.length = 0;
    bs.seats.fill(null);
    bs.rounds.fill(null);
    B.fitSeats(st, booth);
    this.emit('boothUnlocked', { booth });
    if (!this.autoAssign(booth)) this.toast(this.closedText(booth), 'info');
    return OK;
  }

  /** '방글 아저씨가 슬롯 부스를 맡았어요' / 자리가 여럿이면 '깃발 소녀가 몬스터 경주장의 출발 신호를 맡았어요'. */
  private tookText(s: Staff, booth: BoothId, role: number): string {
    const roles = B.boothRoles(booth);
    const what = roles.length > 1 ? `${BOOTHS[booth].name}의 ${josa(roles[role]?.name ?? '진행자', '을', '를')}` : josa(BOOTHS[booth].name, '을', '를');
    return `${josa(s.name, '이', '가')} ${what} 맡았어요.`;
  }

  /** 진행자가 모자라 닫힌 부스 안내: '슬롯 부스에 진행자를 세우면 문을 열어요' / '몬스터 경주장은 출발 신호·해설자 자리를 채우면 문을 열어요'. */
  private closedText(booth: BoothId): string {
    const roles = B.boothRoles(booth);
    if (roles.length <= 1) return `${BOOTHS[booth].name}에 진행자를 세우면 문을 열어요.`;
    const bs = this.state.booths[booth];
    const need = roles.filter((r, i) => r.optional !== true && (bs.staff[i] ?? null) === null).map((r) => r.name);
    return `${josa(BOOTHS[booth].name, '은', '는')} ${need.join('·')} 자리를 채우면 문을 열어요.`;
  }

  /**
   * 빈 자리를 채운다 (부스를 열 때). 꼭 있어야 하는 자리 먼저.
   * 1) 자리마다 어울리는 진행자 (그림 있는 진행자): 쉬는 중이거나 다른 부스의 있으면 좋은 자리에 있으면 데려온다.
   * 2) 남은 꼭 있어야 하는 자리·있으면 좋은 자리: 쉬는 진행자 가운데 이 부스의 다른 빈 자리에 어울리지 않는 사람 (그림 없는 진행자 먼저).
   * 꼭 있어야 하는 자리가 다 찼으면 true.
   */
  private autoAssign(booth: BoothId): boolean {
    const st = this.state;
    const bs = st.booths[booth];
    B.fitSeats(st, booth);
    const roles = B.boothRoles(booth);
    const order = roles.map((r, i) => ({ r, i })).sort((a, b) => Number(a.r.optional === true) - Number(b.r.optional === true));
    const free = (i: number): boolean => (bs.staff[i] ?? null) === null;
    let changed = false;
    const put = (s: Staff, i: number): void => {
      this.assignRaw(s, { booth, role: i });
      changed = true;
      this.toast(this.tookText(s, booth, i), 'good');
    };
    for (const { i } of order) {
      if (!free(i)) continue;
      const s = st.staff.find((x) => suits(x, booth, i));
      if (s === undefined) continue;
      const p = s.post;
      if (p === null || (p.booth !== booth && B.boothRoles(p.booth)[p.role]?.optional === true)) put(s, i);
    }
    for (const { i } of order) {
      if (!free(i)) continue;
      const idle = st.staff.filter((x) => x.post === null && !roles.some((_, j) => j !== i && free(j) && suits(x, booth, j)));
      const s = idle.find((x) => presetPost(x) === null) ?? idle[0];
      if (s === undefined) continue;
      put(s, i);
    }
    if (changed) this.emit('staffChanged', {});
    return B.boothStaffed(st, booth);
  }

  upgradeBooth(booth: BoothId): Result {
    const st = this.state;
    const bs = st.booths[booth];
    if (!bs.unlocked) return fail('아직 열리지 않은 부스예요.');
    const cost = this.boothUpgradeCost(booth);
    if (cost === null) return fail('이미 최고 레벨이에요.');
    const why = missingReason(st, cost);
    if (why !== null) return fail(why);
    this.spend(cost, BOOTH_SPOTS[booth].base);
    bs.level += 1;
    B.fitSeats(st, booth);
    this.emit('buildingUpgraded', { id: booth, level: bs.level });
    return OK;
  }

  hire(candidate: number): Result {
    const st = this.state;
    const c = st.candidates[candidate];
    if (c === undefined) return fail('없는 후보예요.');
    if (st.coins < c.cost) return fail(`코인이 ${c.cost - st.coins} 모자라요.`);
    this.spend({ coins: c.cost }, null);
    st.candidates.splice(candidate, 1);
    const s: Staff = { id: st.nextId++, name: c.name, art: c.art, stats: { ...c.stats }, level: 1, post: null };
    st.staff.push(s);
    // 맡을 자리 (staff.ts hirePost): 자기 자리 → 꼭 있어야 하는 빈 자리 → 있으면 좋은 빈 자리. 없으면 쉰다.
    const t = hirePost(st, s);
    if (t !== null) {
      const prevId = st.booths[t.post.booth].staff[t.post.role] ?? null;
      this.assignRaw(s, t.post);
      this.toast(this.tookText(s, t.post.booth, t.post.role), 'good');
      // 자기 자리에 서 있던 진행자는 다른 빈 자리로 (없으면 쉰다).
      const prev = t.take && prevId !== null ? st.staff.find((x) => x.id === prevId) : undefined;
      if (prev !== undefined && prev.post === null) {
        const t2 = hirePost(st, prev);
        if (t2 !== null && !t2.take) {
          this.assignRaw(prev, t2.post);
          this.toast(this.tookText(prev, t2.post.booth, t2.post.role), 'good');
        } else this.toast(`${josa(prev.name, '은', '는')} 잠시 쉬어요.`, 'info');
      }
    }
    this.emit('staffChanged', {});
    return OK;
  }

  /** 배치 (확인 없이). 맡을 자리에 진행자가 있으면 서로 자리를 바꾼다 (옮겨 온 진행자가 쉬던 중이었으면 원래 진행자는 쉰다). */
  private assignRaw(s: Staff, to: StaffPost | null): void {
    const st = this.state;
    const from = s.post;
    if (samePost(from, to)) return;
    if (from !== null) st.booths[from.booth].staff[from.role] = null;
    if (to !== null) {
      const bs = st.booths[to.booth];
      B.fitSeats(st, to.booth);
      const prevId = bs.staff[to.role] ?? null;
      const prev = prevId === null ? undefined : st.staff.find((x) => x.id === prevId);
      if (prev !== undefined && prev !== s) {
        prev.post = from === null ? null : { booth: from.booth, role: from.role };
        if (from !== null) st.booths[from.booth].staff[from.role] = prev.id;
      }
      bs.staff[to.role] = s.id;
    }
    s.post = to === null ? null : { booth: to.booth, role: to.role };
  }

  assign(staff: StaffId, booth: BoothId | null, role = 0): Result {
    const st = this.state;
    const s = st.staff.find((x) => x.id === staff);
    if (s === undefined) return fail('진행자를 찾을 수 없어요.');
    if (booth === null) {
      if (s.post === null) return OK;
      this.assignRaw(s, null);
      this.emit('staffChanged', {});
      return OK;
    }
    if (!st.booths[booth].unlocked) return fail('아직 열리지 않은 부스예요.');
    if (!Number.isInteger(role) || role < 0 || role >= B.boothRoles(booth).length) return fail('없는 진행자 자리예요.');
    const to: StaffPost = { booth, role };
    if (samePost(s.post, to)) return OK;
    this.assignRaw(s, to);
    this.emit('staffChanged', {});
    return OK;
  }

  staffLevelUpCost(staff: StaffId): Cost | null {
    const s = this.state.staff.find((x) => x.id === staff);
    return s === undefined ? null : levelUpCost(s);
  }

  staffLevelUp(staff: StaffId): Result {
    const st = this.state;
    const s = st.staff.find((x) => x.id === staff);
    if (s === undefined) return fail('진행자를 찾을 수 없어요.');
    const cost = levelUpCost(s);
    if (cost === null) return fail('능력치가 모두 최고예요.');
    const why = missingReason(st, cost);
    if (why !== null) return fail(why);
    this.spend(cost, null);
    const k = raiseStat(s);
    this.emit('staffChanged', {});
    if (k !== null) this.toast(`${s.name}의 ${josa(STAFF_STAT_NAMES[k], '이', '가')} 올랐어요.`, 'good');
    return OK;
  }

  craft(recipe: number): Result {
    const st = this.state;
    const r = RECIPES[recipe];
    if (r === undefined) return fail('없는 만들기예요.');
    if (r.hall > this.hallLevel()) return fail(`마을회관 레벨 ${r.hall}부터 만들 수 있어요.`);
    if (st.crafting.length >= workshopSlots(st)) return fail('공방 자리가 꽉 찼어요.');
    const cost: Cost = { coins: r.coins, mats: r.mats };
    const why = missingReason(st, cost);
    if (why !== null) return fail(why);
    this.spend(cost, BUILDING_SPOTS.workshop);
    st.crafting.push({ out: r.out, left: r.sec, total: r.sec });
    return OK;
  }

  // ── 저장 ────────────────────────────────────────────────────────────

  save(): void {
    saveGame(this.state);
  }

  reset(): void {
    clearSave();
    // 화면이 손님 그림을 지우게 (보상 없음).
    for (const m of this.state.monsters.slice()) this.bus.emit('monsterLeft', { id: m.id, tip: 0, material: null, precious: null });
    const fresh = newGame();
    const st = this.state as unknown as Record<string, unknown>;
    for (const k of Object.keys(st)) delete st[k];
    Object.assign(st, fresh);
    this.lastCapToast = -Infinity;
    this.bus.emit('coinsChanged', { coins: this.state.coins, delta: 0, at: null });
    this.bus.emit('itemsChanged', {});
    this.bus.emit('staffChanged', {});
    this.toast('새 마을을 시작해요.', 'info');
  }
}

/** 손님 이름 ('콩 꼬마 용'). UI가 쓸 수 있게 내보낸다. */
export { displayName };
