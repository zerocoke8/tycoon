// 시뮬레이션 본체 (Sim). 상태(GameState)를 바꾸고 이벤트(bus)를 낸다. 화면·DOM을 모른다.
// 손님 상태 기계: arriving → wandering → toBooth → queued → toSeat → playing → reacting → (다시 한판 | wandering | resting | leaving).
// 걷는 phase는 path가 남아 있는 동안 걷고, 다 걸으면 그 phase의 일을 한다 (wandering·resting·spectating은 timer만큼 머문다).
// 무작위는 모두 this.rng (상태는 GameState.rng에 바로 쓰인다).
// 넷째 묶음 (DESIGN 3.7): 돈이 떨어진 손님 → 전당포(장신구 맡기기)·은행(대출) 볼일 (toPawnshop·atPawnshop·toBank·atBank) → 지갑이 넉넉해지면 되찾기·갚기,
// 떠날 때 빚을 못 갚으면 파산 → 일터 (toWork → working | waitWork) → 다 갚으면 relieved → 떠나 단골. 빚 걸기 판은 '단체 놀이' 묶음의 mode 'debt'.
// 배치형 마을 (DESIGN 6.1): 건물·부스·장식은 GameState.village에 놓인 자리 (sim/village.ts), 손님은 길 칸으로만 걷는다 (sim/path.ts route).
// 다섯째 묶음 (DESIGN 3.8): 가게 (toShop → shopQueue → buying → (머무는 가게) toShopSeat → atShop), 아이스크림 트럭, 놀이기구, 꽃 선물 (toFriend), 진행자 팁.
// 놓이지 않았거나(보관함) 입구가 길로 마을 입구와 이어지지 않은 곳엔 손님이 가지 않는다 (booths.ts boothOpen, shopOpen). 촌장의 짓기 행동은 '배치형 마을' 묶음.

import { Emitter } from '../core/events.ts';
import { Rng } from '../core/rng.ts';
import { ACCESSORIES, BANK, BOOTHS, BOOTH_IDS, boothDef, BUILD_HALL, BUILDINGS, DEBT_MATCH, DECOR, FLOWER, FOOD_LIKE, FORTUNE, GROUP_RULES, isGroupBooth, LAND, LABOR, MATERIALS, MOOD, PAWN, PRECIOUS, RECIPES, RIDE, SALON, SHOP_IDS, SHOP_ITEMS, SHOP_URGE, SHOP_VISIT, SHOPS, SIDES, SIM, SPECIES, SPECIES_FOOD, SPECIES_IDS, SPRING, STAFF_STAT_NAMES, TIP, TRUCK, URGE_SHOPS, VAULT, WORK_FACILITIES, type AccessoryId, type BoothId, type BuildingId, type DecorId, type GoodId, type GroupBoothId, type MaterialId, type OutcomeTier, type PreciousId, type ShopId, type SpeciesId } from '../data/defs.ts';
import { CATALOG_KEYS, catalogKind, catalogName, footprint, storable, type CatalogKey } from '../data/catalog.ts';
import { CELL, CHUNKS, DEFAULT_LOTS, cellAt, cellIndex, type Cell, type Pt } from '../data/map.ts';
import type { CatalogEntry, Cost, Result, SimApi, StorageItem } from './api.ts';
import * as B from './booths.ts';
import { addMaterial, canAfford, costOf, fountainMoodPerMin, gateSpawnSec, goodDef, hallVisitors, isBuilt, missingReason, nextBuildingCost, officeCandidates, pay, warehouseCap, workshopSlots, workshopSpeed } from './economy.ts';
import { bankLoan, bankOpenFor, canLend, counterPt, debtEligible, errandShop, laborGauge, laborRate, loanDebt, pairDebtors, pawnPick, pawnPrice, pickWorkSpot, redeemCost, redeemPick, shopOpen, waitPt, wantMore, workPt, workSlots } from './debt.ts';
import { decideOutcome } from './games.ts';
import { betFraction, createMonster, displayName, faceToward, nameSubject, speedOf, stepMove } from './monsters.ts';
import { dist, gateDistance, laneOffset, onRoad, pathLength, roadPoint, route, walkCells } from './path.ts';
import { groupGame, groupGatherSec, groupStartSoonSec, idleGroup, type GroupReadiness } from './group/index.ts';
import { cheerKey, debtReaction, groupBuzzReaction, groupCheerReaction, groupSpectateReaction, moodDelta, pickReaction, shopReaction, snackReaction, spectateReaction, type DebtReactKind, type ShopReactKind } from './reactions.ts';
import { clearSave, newGame, saveGame } from './save.ts';
import { addFriends, chooseShop, fitShop, fortuneLuck, giftTarget, hasSlots, isFood, isRide, itemArt, newShops, nextStreak, orderItemKey, pickOrder, rollFortune, salonSparkleSec, shopCounterPt, shopHasRoom, shopPickupPt, shopIsOpen, shopOwned, shopQueuePt, shopServiceSec, shopSlotLook, shopSlotPt, shopSlots, shopStat, shopStaySec, sparkling, springBonus, startWallet, stepTruck, tipFor, truckCell, truckPlan, truckReroute, truckRouteOk, urgeAfter, urgeOf, visited } from './shops.ts';
import { fillCandidates, hirePost, isIdle, levelUpCost, presetCandidates, presetPost, raiseStat, suits } from './staff.ts';
import { josa } from './text.ts';
import { TUNE } from './tuning.ts';
import type { ActiveRound, DebtChange, Errand, GameState, GroupBuzz, GroupCancelReason, GroupCheer, GroupEntry, GroupPlay, GroupState, LaborState, Monster, MonsterId, MonsterPhase, Pose, Reaction, Regular, RoundOutcome, ShopOrder, SimBus, SimEvents, Staff, StaffId, StaffPost } from './types.ts';
import { addChunk, addPlaced, checkPlace, chunkInfo, findSpot, isPlaced, movePlaced, removePlaced, setRoads, villageOf, type ChunkInfo, type PlaceCheck, type Village } from './village.ts';

export { clearSave, loadGame, newGame, saveGame } from './save.ts';

const OK: Result = { ok: true };
const fail = (reason: string): Result => ({ ok: false, reason });
const clampMood = (v: number): number => Math.max(0, Math.min(100, v));
/** 이보다 짧게 자리를 비웠으면 catchUp 요약 토스트를 띄우지 않는다 (초). */
const CATCHUP_TOAST_SEC = 20;

/** catchUp 동안 내지 않는 연출 이벤트 (끝나고 coinsChanged·itemsChanged·요약 토스트를 한 번씩 낸다). */
const QUIET_EVENTS: ReadonlySet<string> = new Set([
  'monsterReact', 'monsterSpectate', 'monsterCheered', 'roundStarted', 'roundFinished', 'potFestival', 'groupJoined', 'groupStarted', 'groupEvent', 'groupFinished', 'groupCancelled', 'coinsChanged', 'itemsChanged', 'toast',
  'pawned', 'redeemed', 'pawnCollected', 'vaultEmpty', 'loanTaken', 'loanRepaid', 'bankrupt', 'laborTick', 'laborOutput', 'foremanCheer', 'debtCleared', 'debtMatchCalled', 'debtSettled',
  'shopVisit', 'shopServed', 'shopConsumed', 'giftGiven', 'photoTaken', 'tip', 'rideStarted', 'rideFinished', 'truckStopped',
]);

/** 가게 phase (Monster.shop이 있어야 한다). */
const SHOP_PHASES: ReadonlySet<MonsterPhase> = new Set(['toShop', 'shopQueue', 'buying', 'toShopSeat', 'atShop']);
/** 가게 볼일 뒤 다음 놀이까지 (Monster.shopTrip이 남는 phase): 가게 반응, 고르기, 부스 줄·자리로 걷기, 가게·꽃. */
const SHOP_TRIP_PHASES: ReadonlySet<MonsterPhase> = new Set(['reacting', 'wandering', 'toBooth', 'toSeat', 'toFriend', ...SHOP_PHASES]);

const samePost = (a: StaffPost | null, b: StaffPost | null): boolean => (a === null || b === null ? a === b : a.booth === b.booth && a.role === b.role);

/** 들고 가는 가게의 산 뒤 반응. 꽃집이 여기 오면 건넬 친구가 없다 (그새 떠났다): 꽃만 들고 시무룩. 새 가게는 여기에 꼭 넣는다 (never). */
function takeAwayReact(s: ShopId, fortune: 'great' | 'good' | 'bad' | undefined): ShopReactKind {
  switch (s) {
    case 'snack_stall':
      return 'snack';
    case 'drink_stand':
      return 'drink';
    case 'bakery':
      return 'bread';
    case 'icecream_truck':
      return 'icecream';
    case 'accessory_shop':
      return 'accessory';
    case 'fortune_teller':
      return fortune === 'bad' ? 'fortuneBad' : 'fortuneGood';
    case 'souvenir_shop':
      return 'souvenir';
    case 'flower_shop':
      return 'lonely';
    // 머무는 가게·놀이기구는 finishStay로 간다 (안전망).
    case 'restaurant':
      return 'feast';
    case 'beauty_salon':
      return 'salon';
    case 'inn':
      return 'innWake';
    case 'hot_spring':
      return 'soak';
    case 'photo_studio':
      return 'photo';
    case 'carousel':
    case 'ferris_wheel':
      return 'ride';
    default: {
      const never: never = s;
      return never;
    }
  }
}

export class Sim implements SimApi {
  /**
   * 새 Sim의 autoPlace 처음 값. true면 부스를 열거나 건물을 지을 때 알맞은 자리에 길까지 이어 바로 놓는다 (sim-check·개발용).
   * 게임에서는 false: 연 부스·지은 건물은 보관함으로 가고, 촌장이 짓기 모드로 놓는다.
   */
  static autoPlaceDefault = false;
  readonly state: GameState;
  readonly bus: SimBus = new Emitter<SimEvents>();
  /** 부스를 열거나 건물을 지으면 바로 자동 배치 (Sim.autoPlaceDefault). */
  autoPlaceOnBuy = Sim.autoPlaceDefault;
  /** 짓기 모드 ✓로 사서 바로 놓는 중 (사는 알림은 놓을 때 한 줄로). */
  private placingNow = false;
  private readonly rng: Rng;
  private quiet = false;
  private quietItems = false;
  private lastCapToast = -Infinity;
  private lastVaultToast = -Infinity;

  constructor(state: GameState) {
    this.state = state;
    state.regulars ??= [];
    state.pawnCollection ??= {};
    state.debtTotals ??= { pawned: 0, redeemed: 0, forfeited: 0, loans: 0, repaid: 0, bankrupt: 0, relieved: 0, forgiven: 0, matches: 0, laborMats: 0, laborBy: { farm: 0, mine: 0 } };
    state.debtTotals.laborBy ??= { farm: 0, mine: 0 };
    state.debtTotals.forgiven ??= 0;
    state.foremanTimer ??= LABOR.foreman.everySec;
    state.debtMatchAt ??= {};
    state.debtCheck ??= DEBT_MATCH.checkSec;
    // 다섯째 묶음 (옛 상태·시험용 상태에 칸이 없으면).
    state.shops ??= newShops();
    for (const [k, v] of Object.entries(newShops()) as [ShopId, GameState['shops'][ShopId]][]) state.shops[k] ??= v;
    state.photoAlbum ??= {};
    state.shopTotals ??= { visits: 0, served: 0, revenue: 0, tips: 0, tipCoins: 0, gifts: 0, photos: 0, innStays: 0, accessories: 0, byShop: {} };
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
    for (const s of SHOP_IDS) fitShop(state, s);
  }

  // ── 이벤트 ──────────────────────────────────────────────────────────

  private emit<K extends keyof SimEvents>(type: K, payload: SimEvents[K]): void {
    if (this.quiet && QUIET_EVENTS.has(type as string)) {
      if (type === 'itemsChanged') this.quietItems = true;
      return;
    }
    this.bus.emit(type, payload);
  }

  /** 알림 (topic 'debt' = 빚 알림 묶음: UI가 자주 띄우지 않는다, booth = 그 부스 이야기: 그 부스 패널이 열려 있으면 UI가 건너뛴다). */
  private toast(text: string, kind: 'info' | 'good' | 'warn' = 'info', topic?: 'debt', booth?: BoothId): void {
    this.emit('toast', { text, kind, ...(topic === undefined ? {} : { topic }), ...(booth === undefined ? {} : { booth }) });
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

  missingReason(cost: Cost): string | null {
    return missingReason(this.state, cost);
  }

  buildingUpgradeCost(id: BuildingId): Cost | null {
    return nextBuildingCost(this.state, id);
  }

  buildingBuilt(id: BuildingId): boolean {
    return isBuilt(this.state, id);
  }

  buildingLockReason(id: BuildingId): string | null {
    if (isBuilt(this.state, id)) return null;
    const need = BUILD_HALL[id];
    if (need === undefined || this.hallLevel() >= need) return null;
    return `마을회관 Lv.${need}부터 지을 수 있어요.`;
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
    return `마을회관 Lv.${need}부터 열 수 있어요.`;
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
    this.tickShops(dt);
    this.tickDebtMatches(dt);
    this.tickForeman(dt);
    for (const m of st.monsters.slice()) this.tickMonster(m, dt);
    for (const b of BOOTH_IDS) this.pump(b);
    for (const s of SHOP_IDS) this.pumpShop(s);
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
    // 입구에서 걸어 들어오는 손님과 일터의 채무자는 세지 않는다 (지도가 커도, 채무자가 많아도 노는 손님 수가 그대로).
    // 다섯째 묶음: 가게 볼일 중인 손님 (가게로 걷기·줄·계산대·자리·꽃 건네기)도 세지 않는다 (가게가 노는 손님 자리를 잡아먹어 마을이 느려지지 않게).
    // 가게에서 나와 다음 놀이로 걸어가는 길 (Monster.shopTrip)도: 가게가 먼 곳에 있어도 노는 손님 수가 그대로.
    const present = st.monsters.filter((m) => m.phase !== 'leaving' && m.phase !== 'arriving' && m.bankrupt !== true && !SHOP_PHASES.has(m.phase) && m.phase !== 'toFriend' && m.shopTrip !== true).length;
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
      // 같은 종·이름의 손님이 지금 마을에 있으면 이번엔 부르지 않는다 (같은 손님이 둘로 보이지 않게).
      if (r !== undefined && SPECIES[r.species].hall <= this.hallLevel() && !st.monsters.some((o) => o.species === r.species && o.nickname === r.nickname)) {
        regular = r;
        regs.splice(i, 1);
      }
    }
    const m = createMonster(rng, st, st.nextId++, villageOf(st).gateSpawn(), regular);
    st.monsters.push(m);
    st.totals.visitors += 1;
    const dex = (st.dex[m.species] ??= { visits: 0, reactions: [] });
    const first = dex.visits === 0;
    dex.visits += 1;
    this.go(m, this.arrivePoint());
    this.emit('monsterSpawned', { id: m.id });
    if (first) this.toast(`처음 보는 손님이 왔어요: ${SPECIES[m.species].name}`, 'good');
    else if (regular?.recovered === true) this.toast(`빚을 다 갚고 떠났던 단골 ${nameSubject(m)} 다시 놀러 왔어요.`, 'good');
    else if (regular !== null) this.toast(`단골 ${nameSubject(m)} 다시 놀러 왔어요.`, 'good');
  }

  /**
   * 입구에서 몇 걸음 들어온 길 칸: 마을 입구 → 광장(분수 입구) 길 거리의 TUNE.arriveFrac 사이 (분수가 없으면 가장 먼 길의 반까지).
   * 길이 없으면 마을 입구 그 자리.
   */
  private arrivePoint(): Pt {
    const v = villageOf(this.state);
    const walk = v.walkable;
    if (walk.length === 0) return v.gateSpawn();
    const fe = v.connected('fountain') ? v.entryPt('fountain') : null;
    let toPlaza = fe !== null ? gateDistance(this.state, cellIndex(cellAt(fe).x, cellAt(fe).y)) : -1;
    if (toPlaza <= 0) {
      let far = 0;
      for (const i of walk) far = Math.max(far, gateDistance(this.state, i));
      toPlaza = Math.max(2, far * 0.5);
    }
    const [f0, f1] = TUNE.arriveFrac;
    const near = walk.filter((i) => {
      const d = gateDistance(this.state, i);
      return d >= 1 && d >= toPlaza * f0 && d <= toPlaza * f1;
    });
    const i = near.length > 0 ? this.rng.pick(near) : (walk.find((c) => gateDistance(this.state, c) === 1) ?? (walk[0] as number));
    return roadPoint(i, this.rng.next(), this.rng.next(), 26);
  }

  /** 손님 m이 to까지 걷는 길 (sim/path.ts route: 길 칸으로만, via = 그 건물 입구로, 손님마다 조금 비켜 걷는다). */
  private walk(m: Monster, to: Pt, via: CatalogKey | null = null): Pt[] {
    return route(this.state, m.pos, to, via, laneOffset(m.id));
  }

  /** 손님 m을 to로 걷게 한다 (목적지를 적어 둔다: 길이 끊겨 덜 걸었으면 닿은 뒤 shortArrival이 다시 본다). */
  private go(m: Monster, to: Pt, via: CatalogKey | null = null): void {
    m.path = this.walk(m, to, via);
    m.dest = { x: to.x, y: to.y, via };
  }

  /**
   * 길을 다 걸었는데 목적지(Monster.dest)에 못 닿았다 (걷는 동안 길이 끊겨 가까운 길 칸까지만 왔다): 이제 갈 수 있으면 다시 걷고 (true),
   * 못 가면 줄·자리로 가던 손님은 다른 걸 하러 간다 (true). 그 밖(쉬기·구경·볼일·일터)은 하던 phase가 닿은 곳에서 알아서 본다 (false).
   */
  private shortArrival(m: Monster): boolean {
    const d = m.dest;
    m.dest = null;
    if (d === null || d === undefined || dist(m.pos, d) <= 3) return false;
    // 안전망: 가던 건물이 옮겨져 목적지가 그 발자국 밖에 남았다 (옛 자리): 하던 일에 맞게 새 자리로 다시 보낸다.
    const via = d.via ?? null;
    if (via !== null && footprint(via).entry !== undefined && isPlaced(this.state, via) && !this.insideOf(via, d)) {
      this.resend(m);
      return true;
    }
    const path = this.walk(m, d, d.via);
    const end = path[path.length - 1];
    if (end !== undefined && dist(end, d) <= 3) {
      m.path = path;
      m.dest = d;
      return true;
    }
    if (m.phase === 'toSeat' || m.phase === 'toBooth') {
      this.decideSoon(m);
      return true;
    }
    return false;
  }

  /** 점 pt가 key가 놓인 발자국 안인가 (놓이지 않았으면 false). */
  private insideOf(key: CatalogKey, pt: Pt): boolean {
    const v = villageOf(this.state);
    const p = v.placed(key);
    if (p === undefined) return false;
    const c = cellAt(pt);
    return v.at(c.x, c.y)?.id === p.id;
  }

  /**
   * 가던 곳을 잃은 손님 (건물이 옮겨졌거나 보관함으로): 하던 일에 맞게 다시 보낸다.
   * 파산 → 일터, 떠나는 중 → 마을 입구, 가게 볼일 → 그 계산대 (닫혔으면 닿은 뒤 arriveShop이 접는다), 그 밖 → 곧 다시 고르기.
   */
  private resend(m: Monster): void {
    const st = this.state;
    if (m.bankrupt === true) this.goWork(m);
    else if (m.phase === 'leaving') this.go(m, villageOf(st).gateSpawn(), 'gate');
    else if ((m.phase === 'toPawnshop' || m.phase === 'toBank') && m.errand !== null && m.errand !== undefined && isPlaced(st, errandShop(m.errand))) {
      const shop = errandShop(m.errand);
      this.go(m, counterPt(st, shop, m.counter ?? 0), shop);
    } else if (m.shop !== null && m.shop !== undefined && SHOP_PHASES.has(m.phase)) this.reShop(m);
    else this.decideSoon(m);
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
    // 가게 볼일 뒤 다음 놀이로 걸어가는 길 (반응·고르기·부스로 걷기)이 아니면 가게 길은 끝났다 (손님 수 한도에 다시 센다).
    if (m.shopTrip === true && !SHOP_TRIP_PHASES.has(p)) m.shopTrip = false;
  }

  private age(m: Monster): number {
    return this.state.time - (m.born ?? this.state.time) - (m.bonusSec ?? 0);
  }

  /** 머문 시간: 첫 한판부터 (아직 안 놀았으면 온 때부터). 입구에서 걸어오는 시간은 뺀다. */
  private visitAge(m: Monster): number {
    return this.state.time - (m.firstPlay ?? m.born ?? this.state.time) - (m.bonusSec ?? 0);
  }

  /** 반응이 끝난 뒤의 포즈: 파산한 손님은 늘 축 처짐, 빈털터리로 떠나는 손님은 시무룩. */
  private idlePose(m: Monster): Pose {
    if (m.bankrupt === true) return 'sad';
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
    if (m.phase !== 'leaving' && m.bankrupt !== true) {
      const f = fountainMoodPerMin(st);
      // 장식 둘레를 지나면 기분이 조금 더 (DECOR_AURA).
      const c = cellAt(m.pos);
      const a = villageOf(st).auraAt(cellIndex(c.x, c.y));
      if (f + a > 0) m.mood = clampMood(m.mood + ((f + a) / 60) * dt);
    }
    // 다섯째 묶음: 손에 든 것·가게 효과 시계, 트럭 따라가기·꽃 건네러 가기 (걷는 중에도 길을 고친다).
    this.tickHeld(m, dt);
    // 배 터지게 먹고 드러누운 손님: 다 누웠으면 일어난다 (반응하는 동안만: 다른 일로 바뀌었으면 그냥 선다).
    if ((m.lying ?? 0) > 0) {
      if (m.phase !== 'reacting') m.lying = 0;
      else if ((m.lying = (m.lying ?? 0) - dt) <= 0) this.getUp(m);
    }
    if (m.phase === 'toShop' && m.shop === 'icecream_truck') {
      this.followTruck(m);
      if (m.phase !== 'toShop' || m.path.length === 0) return;
    } else if (m.phase === 'toFriend') {
      this.tickGift(m);
      if (m.phase !== 'toFriend' || m.path.length === 0) return;
    }
    if (m.path.length > 0) {
      // 길 칸 위에서는 조금 빨리 (건물 안 자리로 들어갈 때는 보통 걸음).
      const c = cellAt(m.pos);
      stepMove(m, dt, villageOf(st).isWalkable(cellIndex(c.x, c.y)) ? TUNE.roadSpeed : 1);
      if (m.path.length > 0 || this.shortArrival(m)) return;
    } else if (this.backToRoad(m)) return;
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
        if (m.booth !== null) faceToward(m, villageOf(st).booth(m.booth).base.x);
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
        faceToward(m, villageOf(st).art('fountain').x);
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
      case 'toPawnshop':
      case 'toBank':
        this.arriveShop(m);
        break;
      case 'atPawnshop':
      case 'atBank':
        m.timer -= dt;
        if (m.timer <= 0) this.finishErrand(m);
        break;
      case 'toWork':
        this.arriveWork(m);
        break;
      case 'working':
        this.tickLabor(m, dt);
        break;
      case 'waitWork':
        this.tickWaitWork(m);
        break;
      case 'relieved':
        m.timer -= dt;
        if (m.timer <= 0) this.leave(m);
        break;
      case 'toShop':
        this.arriveShopQueue(m);
        break;
      case 'shopQueue':
        this.tickShopQueue(m);
        break;
      case 'buying':
        m.timer -= dt;
        if (m.timer <= 0) this.finishBuy(m);
        break;
      case 'toShopSeat':
        this.arriveShopSeat(m);
        break;
      case 'atShop':
        this.tickAtShop(m, dt);
        break;
      case 'toFriend':
        break;
    }
  }

  /**
   * 길 밖(지운 길·치우거나 옮긴 건물 자리·끊긴 길 조각)에 서 있으면 가장 가까운 걸을 수 있는 길로 걸어 돌아간다 (phase·timer는 그대로: 다 걸으면 하던 일을 한다).
   * 걸을 수 있는 길 칸·입구가 있는 건물 안이면 그대로. 돌아가기 시작했으면 true.
   */
  private backToRoad(m: Monster): boolean {
    const st = this.state;
    if (onRoad(st, m.pos)) return false;
    const c = cellAt(m.pos);
    const cells = villageOf(st).rescueCells(cellIndex(c.x, c.y));
    const end = cells?.[cells.length - 1];
    if (end === undefined) return false;
    const to = roadPoint(end, 0.5, 0.5, 0);
    m.path = this.walk(m, to);
    if (m.path.length === 0) m.path = [to];
    m.dest = null;
    return true;
  }

  /** 곧 다음 할 일을 고르게 (지금 자리에서 잠깐 멈춤). */
  private decideSoon(m: Monster): void {
    this.detach(m);
    this.setPhase(m, 'wandering');
    m.path = [];
    m.timer = this.rng.range(0.3, 0.8);
    // 길 밖(끊긴 길·치운 건물 자리)이면 먼저 길로 돌아간다.
    this.backToRoad(m);
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
    // 파산한 손님은 일터로 (빚 걸기 판이 끝났거나 접혔을 때도).
    if (m.bankrupt === true) {
      this.goWork(m);
      return;
    }
    // 떠나는 길에 들른 가게 (기념품)가 끝났거나 접혔다: 다시 집으로.
    if (m.shopHome === true) {
      m.shopHome = false;
      this.goHome(m);
      return;
    }
    // 지갑이 넉넉해졌으면 은행 빚을 갚거나 맡긴 장신구를 되찾으러 간다.
    if (this.goSettle(m, false)) return;
    // 거의 다 잃었지만 더 놀고 싶다: 전당포·은행 (끈기·머문 시간이 남았을 때, 더 놀고 싶은지는 seekMoney가 묻는다).
    // 돈이 다시 넉넉해졌으면 '싫다'고 한 것을 잊는다 (다음에 또 떨어지면 다시 묻는다).
    if (!this.shortOfMoney(m)) {
      if (m.declined) delete m.declined;
    } else if (this.seekMoney(m)) return;
    this.chaseDebt(m);
    if (this.shouldLeave(m)) {
      this.leave(m);
      return;
    }
    // 다섯째 묶음: 가게 (지면 먹거리, 따면 장신구·놀이기구 …: shops.ts chooseShop).
    if (this.goShopping(m)) return;
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

  /** 돌아다니기: 걸을 수 있는 길 칸 가운데 하나로 (가까운 칸일수록 자주, 몇 칸만 뽑아 본다). */
  private goWander(m: Monster): void {
    const walk = villageOf(this.state).walkable;
    this.setPhase(m, 'wandering');
    m.shopTrip = false;
    m.timer = this.rng.range(TUNE.wanderPauseSec[0], TUNE.wanderPauseSec[1]);
    if (walk.length === 0) {
      m.path = [];
      return;
    }
    const picks = Array.from({ length: Math.min(12, walk.length) }, () => this.rng.pick(walk));
    const i = this.rng.weighted(picks.map((c) => [c, 1 / (1 + dist(m.pos, roadPoint(c, 0.5, 0.5, 0)) / 700)] as const));
    this.go(m, roadPoint(i, this.rng.next(), this.rng.next(), 30));
  }

  /** 쉬기: 분수 둘레 빈 자리 (분수가 놓이고 길로 이어졌을 때). */
  private goRest(m: Monster): boolean {
    const st = this.state;
    const v = villageOf(st);
    if (!v.connected('fountain')) return false;
    const spots = v.rest();
    const taken = new Set(st.monsters.filter((o) => o !== m && o.phase === 'resting').map((o) => o.spot));
    const free: number[] = [];
    spots.forEach((_, i) => {
      if (!taken.has(i)) free.push(i);
    });
    if (free.length === 0) return false;
    const i = this.rng.pick(free);
    const p = spots[i] as Pt;
    this.setPhase(m, 'resting');
    m.spot = i;
    this.go(m, p, 'fountain');
    m.timer = this.rng.range(TUNE.restSec[0], TUNE.restSec[1]);
    return true;
  }

  /** 구경꾼: 한판이 한창인 부스 옆에 가서 구경. */
  private goWatch(m: Monster): boolean {
    const st = this.state;
    const rng = this.rng;
    const busy = BOOTH_IDS.filter((b) => B.boothOpen(st, b) && st.booths[b].seats.some((id) => id !== null && id !== m.id));
    if (busy.length === 0) return false;
    // 진행 중인 단체 놀이(밖에서 봐도 재미있는 판)를 더 자주, 가까운 부스를 더 자주 보러 간다 (부스 고르기와 같은 거리 무게).
    const near = (x: BoothId): number => {
      const d = walkCells(st, m.pos, x);
      return d > 0 ? 1 / (1 + d / (TUNE.boothNearCells * (isGroupBooth(x) ? TUNE.groupNearMult : 1))) : 1;
    };
    const b = rng.weighted(busy.map((x) => [x, (st.booths[x].group?.phase === 'running' || st.booths[x].group?.phase === 'gathering' ? TUNE.groupWatchWeight : 1) * near(x)] as const));
    let at: Pt;
    let via: CatalogKey | null = null;
    if (st.booths[b].group !== null && isGroupBooth(b)) {
      // 단체 놀이: 놀이마다 구경하는 자리 (시설 안, 경주장은 경주로 바깥 울타리 쪽).
      at = groupGame(b).watchPoint(st, rng);
      via = b;
    } else {
      // 보통 부스: 입구 앞 길 칸에 서서 본다.
      const e = villageOf(st).entryPt(b);
      if (e === null) return false;
      at = { x: e.x + rng.range(-30, 30), y: e.y + rng.range(-18, 22) };
    }
    this.setPhase(m, 'spectating');
    this.go(m, at, via);
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
    this.go(m, B.queuePt(st, b, bs.queue.length - 1), b);
    this.pump(b);
  }

  /**
   * 집에 가고 싶다: 갚을 은행 빚·되찾을 장신구가 있고 지갑으로 낼 수 있으면 먼저 들른다 (볼일 뒤 다시 leave).
   * 빚을 못 갚으면 파산 (일터로). 아니면 입구로 (goHome). 파산한 손님은 일터로.
   */
  private leave(m: Monster): void {
    if (m.bankrupt === true) {
      this.goWork(m);
      return;
    }
    if (this.goSettle(m, true)) return;
    if (m.debt > 0) {
      this.goBankrupt(m);
      return;
    }
    // 다섯째 묶음: 딴 적이 있고 기분이 좋으면 떠나는 길에 기념품 가게에 들른다 (인형을 안고 떠난다).
    if (this.goSouvenir(m)) return;
    this.goHome(m);
  }

  /** 입구로 걸어 나간다 (볼일이 다 끝난 손님). */
  private goHome(m: Monster): void {
    this.detach(m);
    this.setPhase(m, 'leaving');
    this.go(m, villageOf(this.state).gateSpawn(), 'gate');
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
    this.leaveShop(m);
  }

  /** 줄 선 손님들을 제자리로 (앞이 비면 한 칸씩 앞으로). */
  private layoutQueue(b: BoothId): void {
    const bs = this.state.booths[b];
    for (let i = bs.queue.length - 1; i >= 0; i--) if (this.monster(bs.queue[i] as MonsterId) === undefined) bs.queue.splice(i, 1);
    bs.queue.forEach((id, idx) => {
      const m = this.monster(id);
      if (m === undefined) return;
      const spot = B.queuePt(this.state, b, idx);
      if (m.phase === 'queued') {
        // 줄에 선 손님은 부스 안에서 한 칸씩 앞으로.
        if (dist(m.pos, spot) > 2) {
          m.path = [{ x: spot.x, y: spot.y }];
          m.dest = { x: spot.x, y: spot.y, via: b };
        }
      } else if (m.phase === 'toBooth') this.go(m, spot, b);
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
    if (!B.boothOpen(st, b)) {
      // 닫힌 부스: 자리로 걸어가던 손님도 다른 걸 하러 간다 (멀리서 오던 손님이 닫힌 자리를 붙잡고 있지 않게).
      for (const id of bs.seats) {
        const m = id === null ? undefined : this.monster(id);
        if (m !== undefined && m.phase === 'toSeat') this.decideSoon(m);
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
    // 빚 걸기 판 중인 (또는 예약된) 줄다리기 (구경하며 거는 자리가 없다): 채무자 말고는 앉히지 않는다 (줄은 판이 끝날 때까지 기다린다).
    if ((bs.group?.mode === 'debt' || bs.group?.debtNext === true) && (DEBT_MATCH.watchOnly as readonly BoothId[]).includes(b)) return;
    B.fitSeats(st, b);
    const n = B.boothSeats(st, b);
    // 단체 놀이는 놀이 모듈이 자리를 고른다 (씨름 선수·구경, 줄다리기 적은 편 …). 그 밖은 앞자리부터.
    const game = bs.group !== null && isGroupBooth(b) ? groupGame(b) : null;
    let moved = false;
    for (;;) {
      const free: number[] = [];
      // 빚 걸기 판이 예약된 부스의 선수 자리는 비워 둔다.
      for (let i = 0; i < n; i++) if ((bs.seats[i] ?? null) === null && !this.debtHeld(b, i)) free.push(i);
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
      const target = B.seatPt(st, b, i);
      const standing = m.phase === 'queued' && m.path.length === 0;
      this.setPhase(m, 'toSeat');
      if (standing) {
        m.path = [{ x: target.x, y: target.y }];
        m.dest = null;
      } else this.go(m, target, b);
      moved = true;
    }
    if (moved) this.layoutQueue(b);
  }

  /** 자리에 닿았다: 한판 시작 (부스가 닫혔거나 코인·재료가 모자라면 다른 걸 한다). */
  private seatArrive(m: Monster): void {
    const st = this.state;
    const b = m.booth;
    const i = m.seat;
    // 빚 걸기 판에 불린 채무자는 코인 없이 (자기 빚을 건다).
    const debtor = b !== null && this.isDebtor(b, m);
    if (b === null || i === null || st.booths[b].seats[i] !== m.id || !B.boothOpen(st, b) || (!debtor && !B.canPlay(st, b, m))) {
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
    this.earn(fee, B.seatPt(st, b, seat));
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
    // 점괘 (다섯째 묶음): 한동안 운 ±.
    const luck = (m.traits.includes('lucky') ? TUNE.luckTrait : 0) + (cheer?.luck ?? 0) + fortuneLuck(m);
    // 같은 부스에 앉은 손님끼리 친해진다 (꽃 선물).
    const mates = bs.seats.filter((x): x is MonsterId => x !== null && x !== m.id);
    if (mates.length > 0) {
      addFriends(m, mates);
      for (const id of mates) {
        const o = this.monster(id);
        if (o !== undefined) addFriends(o, [m.id]);
      }
    }
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
    faceToward(m, B.hostPt(st, b, 0).x);
    this.emit('roundStarted', { booth: b, seat, round });
  }

  /**
   * 한판 끝: 지급·기분·반응. crowd = 근처 손님이 따라 반응 (단체 놀이는 판 하나에 한 번, groupCrowd).
   * settled = 이미 항아리에서 뺀 지급 (단체 놀이는 이긴 손님을 한꺼번에 나눈다: finishGroup).
   * react = 이 반응으로 (빚 걸기 판의 채무자: 빚이 반·0·늘어남 반응), 없으면 결과 반응 표에서 고른다.
   */
  private finishRound(b: BoothId, seat: number, r: ActiveRound, crowd = true, settled: { payout: number; festival: boolean } | null = null, react: Reaction | null = null): void {
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
    // 다섯째 묶음: 최근 흐름 (가게 고르기).
    m.streak = nextStreak(m.streak ?? 0, festival ? 'jackpot' : tier);
    st.totals.rounds += 1;
    m.patience = Math.max(0, m.patience - 1);
    const cheer = B.boothCheer(bs);
    // 빈털터리: 이기지 못했고 더 놀 코인이 없다 (돌려받은 코인이 있어도). 빚 걸기 판의 채무자는 빼고.
    const broke = m.bankrupt !== true && !won && m.wallet < B.minPlayCost(st);
    if (broke) m.broke = true;
    const charm = B.boothStat(st, b, 'charm');
    const def = boothDef(b);
    // 미용실에서 반짝이는 손님은 진 판에 덜 속상하다.
    const lossScale = (def.moodLossScale ?? 1) * (sparkling(m) ? SALON.moodLossScale : 1);
    m.mood = clampMood(m.mood + moodDelta(tier, broke, m, charm, cheer?.moodPerRound ?? 0, lossScale) + (festival ? 10 : 0) + (def.moodPerRound ?? 0));
    // 다섯째 묶음: 결과가 남긴 마음 (지면 달래기, 아깝게 놓치면 단 것, 크게 따면 축하: 가게 고르기).
    if (m.bankrupt !== true) m.urge = urgeAfter(m, festival ? 'jackpot' : tier, festival, st.time);
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
    let reaction = react ?? pickReaction(rng, broke ? 'broke' : shown, m, cheer?.reactionBoost ?? 1, festival && tier !== 'jackpot' ? null : b, d);
    // 점괘가 붙은 손님의 한판이 점괘대로면 가끔 '점괘대로다!'·'점괘가 맞았어…' (빈털터리·빚 걸기 판은 그 반응대로).
    const luck = fortuneLuck(m);
    if (react === null && !broke && luck !== 0 && (luck > 0 ? won : tier === 'lose' || tier === 'nearMiss') && rng.chance(FORTUNE.trueChance)) reaction = shopReaction(rng, luck > 0 ? 'fortuneTrue' : 'fortuneCurse', m, luck > 0 ? (m.buffs?.fortune ?? 'good') : undefined);
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
    // 다섯째 묶음: 크게 딴 손님은 결과 뒤 진행자에게 팁 (마을 수입).
    if (payout > 0 && r.bet > 0 && m.bankrupt !== true) this.tipHost(b, m, payout, r.bet, tier, festival);
    this.emit('monsterReact', { id: m.id, reaction });
    if (crowd) this.spectate(b, seat, m, shown);
  }

  /** 반응이 끝났다: 같은 자리에서 다시 한판, 아니면 다음 할 일. */
  private afterReact(m: Monster): void {
    const st = this.state;
    const wasAgony = m.pose === 'agony';
    m.pose = m.bankrupt === true ? 'sad' : 'base';
    // 다섯째 묶음: 진행자에게 팁을 줬으면 결과 반응 뒤 고마워요 (걸어가며).
    if (m.tipped === true) {
      m.tipped = false;
      this.sideShopReact(m, 'tip');
    }
    // 파산한 손님 (빚 걸기 판이 끝났다·파산 반응이 끝났다): 다 갚았으면 홀가분, 아니면 일터로.
    if (m.bankrupt === true) {
      if (m.debt <= 0) this.relieve(m, false);
      else this.goWork(m);
      return;
    }
    // 집에 가는 길에 볼일을 마쳤다 (되찾기·갚기): 다시 집으로 (남은 볼일이 있으면 그것 먼저).
    if (m.homeward === true) {
      m.homeward = false;
      this.leave(m);
      return;
    }
    // 떠나는 길에 기념품을 샀다: 집으로.
    if (m.shopHome === true) {
      m.shopHome = false;
      this.goHome(m);
      return;
    }
    if (m.broke === true) {
      // 돈이 떨어졌지만 더 놀고 싶으면 전당포·은행으로 (빈털터리로 떠나지 않는다).
      if (this.seekMoney(m)) {
        m.broke = false;
        return;
      }
      this.leave(m);
      return;
    }
    // 거의 다 잃었다 (아직 놀 수는 있다): 같은 자리에서 다시 하기 전에 더 놀고 싶은지 묻는다 (전당포·은행). 빚이 있으면 갚으려고 한판만 더.
    if (this.shortOfMoney(m) && this.seekMoney(m)) return;
    this.chaseDebt(m);
    // 다섯째 묶음: 계속 져서 달래고 싶은 손님 (comfort)·크게 딴 손님 (celebrate)은 가끔 자리를 털고 가게로 (SHOP_URGE.leaveSeat, 갈 가게가 없으면 하던 대로).
    const urge = urgeOf(st, m);
    if ((urge === 'comfort' || urge === 'celebrate') && !this.shouldLeave(m) && this.rng.chance(SHOP_URGE.leaveSeat) && this.goShopping(m, true)) return;
    const b = m.booth;
    const seat = m.seat;
    if (b !== null && seat !== null && st.booths[b].seats[seat] === m.id && B.boothOpen(st, b) && B.canPlay(st, b, m) && !this.shouldLeave(m) && !this.debtHeld(b, seat)) {
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
    const at = B.seatPt(this.state, b, seat);
    for (const o of this.state.monsters) {
      if (o === m || o.phase === 'leaving' || o.phase === 'playing' || o.phase === 'reacting' || o.bankrupt === true || o.hidden === true) continue;
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
    faceToward(m, game.face(st, seat).x);
    if (g.phase === 'running' || g.phase === 'done') return;
    if (g.participants.some((e) => e.monster === m.id)) return;
    // 반장이 빚 걸기 판을 예약한 부스: 쉬는 판을 새로 열지 않고 (구경 자리에서) 빚 걸기 판을 기다린다.
    if (g.phase === 'idle' && g.debtNext === true) return;
    // 빚 걸기 판의 채무자: 참가비·건 코인 없이 자기 빚을 건다 (GroupEntry.debt).
    const debtor = this.isDebtor(b, m);
    const fee = debtor ? 0 : B.boothFee(st, b);
    // 지난 판에 편 맞추기로 빠진 손님은 이미 낸 참가비로 (줄다리기 lineup, startGroup).
    const pre = debtor ? -1 : (g.prepaid?.indexOf(m.id) ?? -1);
    if (pre >= 0) g.prepaid?.splice(pre, 1);
    else if (fee > 0) {
      m.wallet -= fee;
      this.earn(fee, B.seatPt(st, b, seat));
    }
    const bet = debtor ? 0 : Math.max(1, Math.min(m.wallet, Math.round(m.wallet * betFraction(this.rng, m.traits) * (boothDef(b).betScale ?? 1))));
    m.wallet -= bet;
    bs.pot += bet;
    m.stats.spent += (pre >= 0 ? 0 : fee) + bet;
    m.firstPlay ??= st.time;
    const { pick, role } = game.join(this.rng, seat, m, g.participants, (id) => this.monster(id));
    const entry: GroupEntry = { monster: m.id, seat, pick, role, bet, fee };
    if (debtor) entry.debt = m.debt;
    g.participants.push(entry);
    const pace = B.boothStat(st, b, 'pace');
    if (g.phase === 'idle') {
      g.phase = 'gathering';
      g.countdown = groupGatherSec(b, pace);
      g.elapsed = 0;
      g.duration = 0;
      g.play = null;
    }
    const ready = this.groupReady(b, g);
    // 빚 걸기 판: 마지막 채무자가 닿으면 조금 뒤 출발 (구경 손님이 모이고 3·2·1).
    if (debtor && ready === 'soon') g.countdown = groupStartSoonSec(b, pace);
    else if (ready === 'soon') g.countdown = Math.min(g.countdown, groupStartSoonSec(b, pace));
    if (g.participants.length >= B.boothSeats(st, b)) g.countdown = Math.min(g.countdown, GROUP_RULES[b].fullStartSec);
    this.emit('groupJoined', { booth: b, monster: m.id, seat, pick, role, bet });
  }

  /** 자리에 앉아 있는 단체 놀이 손님 (phase 'playing'): 이번 판의 참가자면 기다리고, 아니면 참가할 수 있을 때 참가. */
  private groupWait(m: Monster): void {
    const b = m.booth;
    const g = b === null ? null : this.state.booths[b].group;
    // 반장이 이 부스에 빚 걸기 판을 예약했다: 선수 자리에서 다음 판을 기다리던 손님은 비켜 준다 (참가자는 이번 판을 마친다).
    if (b !== null && m.seat !== null && this.debtHeld(b, m.seat) && !(g !== null && g.phase !== 'idle' && g.participants.some((e) => e.monster === m.id))) {
      this.decide(m);
      return;
    }
    if (g !== null && g.phase !== 'idle' && g.participants.some((e) => e.monster === m.id)) {
      // 참가자는 자기 자리의 놀이 쪽을 본다 (구경 자리에서 모래판으로 나서 걸어온 손님도).
      if (b !== null && m.seat !== null && isGroupBooth(b)) faceToward(m, groupGame(b).face(this.state, m.seat).x);
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

  /** 보통 부스의 하던 한판을 접는다 (보관하기): 자리마다 건 코인을 항아리에서 돌려준다 (참가비는 마을에 남는다). */
  private refundRounds(b: BoothId): void {
    const bs = this.state.booths[b];
    for (let i = 0; i < bs.rounds.length; i++) {
      const r = bs.rounds[i];
      if (r === null || r === undefined) continue;
      bs.rounds[i] = null;
      const m = this.monster(r.monster);
      if (m === undefined) continue;
      const back = Math.min(r.bet, bs.pot);
      bs.pot -= back;
      m.wallet += back;
      m.stats.spent = Math.max(0, m.stats.spent - back);
    }
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
  private cancelGroup(b: GroupBoothId, g: GroupState, reason: GroupCancelReason): void {
    const left = g.participants.slice();
    const debtors = g.mode === 'debt' ? (g.debtors ?? []).slice() : [];
    for (const e of left) this.refundBet(b, e);
    this.resetGroup(g);
    this.emit('groupCancelled', { booth: b, reason });
    // 빚 걸기 판의 채무자는 일터로 돌아간다 (자리로 걸어오던 채무자도).
    for (const id of debtors) {
      const m = this.monster(id);
      if (m !== undefined && m.booth === b) this.goWork(m);
    }
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
    delete g.mode;
    delete g.debtors;
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
          // 빚 걸기 판은 채무자가 걸어오는 동안 참가자가 없어도 모이는 중이다.
          const debt = g.mode === 'debt';
          if (g.participants.length === 0 && !debt) {
            this.resetGroup(g);
            break;
          }
          // 모이는 중에 문을 닫았다 (꼭 있어야 하는 진행자가 빠졌다, 입구 앞 길이 끊겼다): 건 코인을 돌려주고 판을 접는다 (앉은 손님은 다른 걸 하러 간다).
          if (!B.boothOpen(this.state, b)) {
            const why = B.boothIdleReason(this.state, b);
            this.cancelGroup(booth, g, why === 'road' || why === 'stored' ? why : 'closed');
            break;
          }
          g.elapsed += dt;
          g.countdown = Math.max(0, g.countdown - dt);
          const game = groupGame(booth);
          let ready = this.groupReady(booth, g);
          // 출발 조건이 안 맞으면 참가자가 다른 자리로 나서 본다 (밀어내기 상대가 오지 않으면 구경 손님이 모래판으로). 빚 걸기 판은 채무자만 선수.
          if (!debt && g.debtNext !== true && ready === 'none' && game.stepIn !== undefined && this.stepInGroup(booth, g)) ready = this.groupReady(booth, g);
          // 자리로 걸어오는 손님이 있으면 기다려 준다 (첫 손님이 앉고 gatherSec까지는 누구든, 그 뒤 조금 더는 곧 닿는 손님: waitComing).
          if (g.countdown <= 0 && ready !== 'none' && !this.waitComing(booth, g)) this.startGroup(booth, g);
          else if (ready === 'none' && g.elapsed > (debt ? DEBT_MATCH.maxWaitSec : GROUP_RULES[booth].maxWaitSec)) this.cancelGroup(booth, g, 'timeout');
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
    const to = B.seatPt(this.state, b, s.seat);
    m.path = [{ x: to.x, y: to.y }];
    m.dest = { x: to.x, y: to.y, via: b };
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
      // 길 위에서는 TUNE.roadSpeed배로 걷는다 (대강: 거의 다 길이다).
      best = Math.min(best, pathLength(m.pos, m.path) / (speedOf(m) * TUNE.roadSpeed));
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
    if (this.groupReady(b, g) === 'none') return;
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
      const fortune = m !== undefined && (m.buffs?.luckSec ?? 0) > 0 ? Math.max(0, m.buffs?.luck ?? 0) : 0;
      const luck = (m?.traits.includes('lucky') === true ? TUNE.luckTrait : 0) + (cheer?.luck ?? 0) + fortune;
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
      if (dist(o.pos, game.center(st)) > TUNE.groupDrawRadius) continue;
      if (!rng.chance((o.traits.includes('watcher') ? TUNE.groupWatcherDrawChance : TUNE.groupDrawChance) * k)) continue;
      const path = this.walk(o, game.watchPoint(st, rng), b);
      const walk = pathLength(o.pos, path) / (speedOf(o) * TUNE.roadSpeed);
      if (walk > play.end * 0.6) continue;
      this.setPhase(o, 'spectating');
      o.path = path;
      o.dest = { x: path[path.length - 1]?.x ?? o.pos.x, y: path[path.length - 1]?.y ?? o.pos.y, via: b };
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
    const look = game.face(this.state, -1);
    const center = game.center(this.state);
    for (const o of this.state.monsters) {
      if (joined.has(o.id) || o.phase === 'leaving' || o.phase === 'arriving' || o.phase === 'reacting' || o.bankrupt === true || o.hidden === true || (o.poseTime ?? 0) > 0) continue;
      if (o.phase === 'playing' && o.booth !== b) continue;
      if (dist(o.pos, center) > TUNE.groupSpectateRadius) continue;
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
    // 같은 판에서 논 손님끼리 친해진다 (꽃 선물: 단체 놀이 친구는 따로 적어 꽃을 더 주고 싶다).
    const ids = done.map(({ e }) => e.monster);
    for (const id of ids) {
      const m = this.monster(id);
      if (m === undefined) continue;
      addFriends(m, ids);
      m.groupFriends = [...ids.filter((x) => x !== id), ...(m.groupFriends ?? []).filter((x) => !ids.includes(x))].slice(0, FLOWER.friendsMax);
    }
    // 빚 걸기 판: 채무자 선수들의 빚을 먼저 정산한다 (이기면 반·대박이면 0, 지면 상대 빚만큼 더). 채무자의 반응은 빚 반응으로.
    const debts = g.mode === 'debt' && play !== null ? this.settleDebts(b, g, play) : [];
    done.forEach(({ e, r }, i) => {
      const ch = debts.find((c) => c.id === e.monster);
      const m = ch === undefined ? undefined : this.monster(e.monster);
      const react = ch === undefined || m === undefined ? null : debtReaction(this.rng, ch.result === 'halved' ? 'matchHalved' : ch.result === 'cleared' ? 'matchCleared' : 'matchAdded', m);
      this.finishRound(b, e.seat, r, false, pays[i] ?? { payout: 0, festival: false }, react);
    });
    if (debts.length > 0) this.debtSettledNotice(b, debts);
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
        // 빚 걸기 판의 채무자 선수는 코인을 걸지 않았다 (항아리 축제도 없다).
        if (!won[i] || e.debt !== undefined) return;
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
    const center = game.center(st);
    const look = game.face(st, -1);
    for (const o of st.monsters) {
      if (joined.has(o.id) || o.phase === 'leaving' || o.phase === 'arriving' || o.bankrupt === true || o.hidden === true) continue;
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
    // 파산했던 손님은 일한 만큼의 재료(일터)만 준다: 떠날 때 종 재료·귀한 물건은 없다 (DESIGN 3.7 돈의 흐름).
    const recovered = m.wasBankrupt === true;
    let material: MaterialId | null = null;
    const [c0, c1] = MOOD.materialChance;
    if (!recovered && rng.chance(c0 + (c1 - c0) * Math.max(0, Math.min(1, m.mood / 100)))) {
      const mat = SPECIES[m.species].material;
      const want = m.mood >= TUNE.bonusMaterialMood ? 2 : 1;
      const got = addMaterial(st, mat, want);
      if (got > 0) material = mat;
      if (got < want) this.capToast(mat);
    }
    let precious: PreciousId | null = null;
    if (!recovered && (m.surePrecious === true || (m.hadJackpot && m.mood >= TUNE.preciousMood && rng.chance(MOOD.preciousChance)))) {
      precious = this.pickPrecious();
      st.precious[precious] = (st.precious[precious] ?? 0) + 1;
    }
    this.earn(tip, m.pos);
    if (material !== null || precious !== null) this.emit('itemsChanged', {});
    // 못 찾고 떠나는 장신구는 전당포 컬렉션으로.
    for (const t of m.pawned.splice(0)) this.collect(t.key, m.id);
    this.emit('monsterLeft', { id: m.id, tip, material, precious });
    if (precious !== null) this.toast(`${nameSubject(m)} ${josa(PRECIOUS[precious].name, '을', '를')} 남기고 갔어요!`, 'good');
    // 단골 목록에는 떠나는 순간에 (마을에 있는 동안 같은 단골이 또 오지 않게). 빚을 다 갚은 손님은 '다시 일어선 단골'.
    if (recovered) this.addRegular(m, true);
    else if (m.broke === true && m.snacked === true) this.addRegular(m);
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

  /** 단골 목록에 (recovered = 파산했다가 빚을 다 갚은 손님: 다시 올 때 '다시 일어선 단골'). */
  private addRegular(m: Monster, recovered = false): void {
    const regs = (this.state.regulars ??= []);
    const had = regs.find((r) => r.species === m.species && r.nickname === m.nickname);
    if (had !== undefined) {
      if (recovered) had.recovered = true;
      return;
    }
    regs.push(recovered ? { species: m.species, nickname: m.nickname, traits: [...m.traits], recovered: true } : { species: m.species, nickname: m.nickname, traits: [...m.traits] });
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

  // ── 넷째 묶음: 전당포·은행 볼일, 파산, 일터, 빚 걸기 판 (DESIGN 3.7) ─────────────────────
  // 돈이 떨어진 손님 → seekMoney: 더 놀고 싶은지 묻는다 (기분·끈기·성격: debt.ts wantMore, 거의 다 잃었을 때와 정말 못 놀 때 한 번씩)
  //   → 전당포에 장신구 맡기기 (없거나 전당포가 없으면 은행 대출, 빚이 없을 때만) → 볼일 (goShop → atPawnshop·atBank → finishErrand). 걸어가며 '맡겨야겠다…'.
  // 지갑이 넉넉해지면 (그리고 떠나기 전에) goSettle: 은행 빚 갚기 먼저, 그다음 맡긴 장신구 되찾기. 떠날 때 빚을 못 갚으면 goBankrupt → 일터 (goWork).
  // 일터: 일하는 자리(working)에서 빚이 줄고 (laborTick) 재료가 나온다 (laborOutput + 한숨·영차 반응), 자리가 없으면 기다린다 (waitWork, 오래 기다린 손님부터 자리로).
  //   반장이 가끔 다독이고 (tickForeman), 파산하고 LABOR.forgiveSec가 지나면 남은 빚을 덜어 준다. 다 갚으면 relieve → 떠나 단골.
  // 빚 걸기 판: tickDebtMatches가 쉬는 줄다리기·밀어내기에 빚이 비슷한 채무자끼리 불러 단체 놀이 mode 'debt'로 연다. 끝나면 settleDebts (finishGroup).

  /** 빚 걸기 판에 불린 채무자인가 (그 부스의 판이 mode 'debt'이고 debtors에 있다). */
  private isDebtor(b: BoothId, m: Monster): boolean {
    const g = this.state.booths[b].group;
    return m.bankrupt === true && g !== null && g.mode === 'debt' && (g.debtors ?? []).includes(m.id);
  }

  /** 출발 조건: 빚 걸기 판은 불린 채무자가 모두 참가하면 'soon', 그 밖은 놀이 모듈의 readiness. */
  private groupReady(b: GroupBoothId, g: GroupState): GroupReadiness {
    if (g.mode === 'debt') {
      const ds = g.debtors ?? [];
      return ds.length > 0 && ds.every((id) => g.participants.some((e) => e.monster === id)) ? 'soon' : 'none';
    }
    return groupGame(b).readiness(g.participants, g.elapsed);
  }

  /** 돈이 떨어진 단계: 정말 못 논다 (가장 싼 한판보다 적다) = broke, 아직 놀 수는 있지만 거의 다 잃었다 = low. */
  private moneyStage(m: Monster): 'low' | 'broke' {
    return m.wallet < B.minPlayCost(this.state) ? 'broke' : 'low';
  }

  /**
   * 돈이 떨어졌을 때 (shortOfMoney, 끈기가 남고 머문 시간 안): 더 놀고 싶으면 (wantMore 확률, 기분 PAWN·BANK.wantMood 이상)
   * 전당포에 장신구를 맡기러, 장신구가 없거나 전당포가 없으면 은행에서 빌리러 (은행·일터가 있고, 빚이 없고, 이번 방문에 BANK.maxLoans번 안). 갔으면 true.
   * 한 단계(low·broke)에 한 번만 묻는다 ('싫다'면 Monster.declined). 마을 금고가 모자라면 가지 않는다 ('금고가 비었어요' 토스트는 가끔).
   */
  private seekMoney(m: Monster): boolean {
    const st = this.state;
    if (m.bankrupt === true || !this.shortOfMoney(m)) return false;
    if (m.patience <= 0 || this.visitAge(m) > TUNE.maxVisitSec || this.age(m) > TUNE.maxStaySec) return false;
    const stage = this.moneyStage(m);
    if (m.declined === 'broke' || m.declined === stage) return false;
    const a = pawnPick(m);
    const pawn = a !== undefined && shopOpen(st, 'pawnshop') && m.mood >= PAWN.wantMood;
    const loan = !pawn && bankOpenFor(st, m) && m.mood >= BANK.wantMood;
    if (!pawn && !loan) return false;
    // 은행: 일터에서 일하는 채무자가 많으면 망설인다 ('저렇게 되긴 싫어…').
    const wary = loan ? st.monsters.filter((o) => o.bankrupt === true).length * BANK.wary : 0;
    if (!this.rng.chance(wantMore(m, pawn ? PAWN.want : BANK.want, wary))) {
      m.declined = stage;
      return false;
    }
    if (!canLend(st, pawn && a !== undefined ? pawnPrice(st, a) : bankLoan(st))) {
      m.declined = stage;
      this.emit('vaultEmpty', { id: m.id, errand: pawn ? 'pawn' : 'loan' });
      this.vaultToast();
      return false;
    }
    this.goShop(m, pawn ? 'pawn' : 'loan', false);
    return true;
  }

  /**
   * 빚이 있는데 갚을 만큼 없다: 끈기가 다 됐어도 '갚으려고 한판만 더' (BANK.chase.chance, 한 방문에 BANK.chase.max판까지, 머문 시간 안).
   * 한 번 마음을 접으면 (확률에 지면) 더 쫓지 않는다.
   */
  private chaseDebt(m: Monster): void {
    if (m.debt <= 0 || m.bankrupt === true || m.patience > 0) return;
    if (m.wallet >= m.debt || m.wallet < B.minPlayCost(this.state)) return;
    if ((m.chased ?? 0) >= BANK.chase.max || this.visitAge(m) > TUNE.maxVisitSec || this.age(m) > TUNE.maxStaySec) return;
    if (!this.rng.chance(BANK.chase.chance)) {
      m.chased = BANK.chase.max;
      return;
    }
    m.chased = (m.chased ?? 0) + 1;
    m.patience += 1;
  }

  /** 돈이 떨어졌다: 가장 싼 한판보다 적거나, 처음 지갑(지갑 + 쓴 코인 - 받은 코인)의 PAWN.lowFrac보다 적다. */
  private shortOfMoney(m: Monster): boolean {
    const start = m.wallet + m.stats.spent - m.stats.won;
    return m.wallet < Math.max(B.minPlayCost(this.state), start * PAWN.lowFrac);
  }

  /**
   * 낼 수 있는 볼일 (갔으면 true): 은행 빚 갚기 먼저 (빚이 있으면 되찾기는 미룬다), 그다음 맡긴 장신구 되찾기 (값이 큰 것부터).
   * homeward = 떠나기 전 (지갑으로 낼 수만 있으면), 아니면 낸 뒤에도 다음 판 몇 번 분량(BANK.repayRounds·PAWN.redeemRounds)이 남고
   * 돈이 떨어지지 않을 때만 (빌리자마자 갚거나 맡기자마자 되찾지 않게: 따서 지갑이 넉넉해졌을 때).
   */
  private goSettle(m: Monster, homeward: boolean): boolean {
    const st = this.state;
    if (m.bankrupt === true) return false;
    const left = (rounds: number): number => this.settleReserve(m, rounds, homeward);
    if (m.debt > 0) {
      if (shopOpen(st, 'bank') && m.wallet >= m.debt + left(BANK.repayRounds)) {
        this.goShop(m, 'repay', homeward);
        return true;
      }
      return false;
    }
    if (m.pawned.length > 0 && shopOpen(st, 'pawnshop') && redeemPick(m, left(PAWN.redeemRounds)) !== undefined) {
      this.goShop(m, 'redeem', homeward);
      return true;
    }
    return false;
  }

  /** 되찾기·갚기 뒤에도 남길 코인: 떠나기 전(homeward)이면 0, 아니면 다음 판 rounds번 분량과 '거의 다 잃음' 선 가운데 큰 것. */
  private settleReserve(m: Monster, rounds: number, homeward: boolean): number {
    if (homeward) return 0;
    const low = (m.wallet + m.stats.spent - m.stats.won) * PAWN.lowFrac;
    return Math.max(B.minPlayCost(this.state) * rounds, low);
  }

  /** 볼일을 보러 가게 계산대로 (먼저 온 손님이 쓰지 않는 자리). 걸어가며 작게 반응한다 ('맡겨야겠다…', '되찾으러 가자!'). */
  private goShop(m: Monster, errand: Errand, homeward: boolean): void {
    const st = this.state;
    this.detach(m);
    const shop = errandShop(errand);
    const used = new Set(st.monsters.filter((o) => o !== m && o.errand !== null && o.errand !== undefined && errandShop(o.errand) === shop).map((o) => o.counter ?? -1));
    let i = 0;
    while (used.has(i)) i++;
    m.errand = errand;
    m.counter = i;
    m.homeward = homeward;
    this.setPhase(m, shop === 'pawnshop' ? 'toPawnshop' : 'toBank');
    this.go(m, counterPt(st, shop, i), shop);
    m.pose = 'base';
    m.poseTime = 0;
    this.sideReact(m, errand === 'pawn' ? 'seekPawn' : errand === 'loan' ? 'seekLoan' : errand === 'redeem' ? 'goRedeem' : 'goRepay');
  }

  /** 걷거나 일하는 중의 작은 반응 (phase는 그대로, 포즈는 반응 시간만큼 뒤 idlePose로). */
  private sideReact(m: Monster, kind: DebtReactKind): void {
    const reaction = debtReaction(this.rng, kind, m);
    m.pose = reaction.pose;
    m.poseTime = reaction.duration;
    this.recordDex(m, reaction.label);
    this.emit('monsterReact', { id: m.id, reaction });
  }

  /** 계산대에 닿았다: 주인을 보고 잠깐 (PAWN·BANK.counterSec) 볼일을 본다. */
  private arriveShop(m: Monster): void {
    if (m.errand === null || m.errand === undefined) {
      this.decide(m);
      return;
    }
    const shop = errandShop(m.errand);
    // 오는 동안 가게가 보관함에 들어갔거나 길이 끊겼다: 볼일을 접는다 (집에 가던 길이면 다시 집으로).
    if (!shopOpen(this.state, shop)) {
      m.errand = null;
      delete m.counter;
      if (m.homeward === true) {
        m.homeward = false;
        this.leave(m);
      } else this.decide(m);
      return;
    }
    this.setPhase(m, shop === 'pawnshop' ? 'atPawnshop' : 'atBank');
    faceToward(m, villageOf(this.state).shop(shop).npc.x);
    m.timer = shop === 'pawnshop' ? PAWN.counterSec : BANK.counterSec;
  }

  /** 볼일 끝: 맡기기·되찾기·빌리기·갚기를 하고 반응한다 (반응이 끝나면 다음 할 일, homeward면 다시 집으로). */
  private finishErrand(m: Monster): void {
    const st = this.state;
    const e = m.errand ?? null;
    const at = counterPt(st, e === null ? 'bank' : errandShop(e), m.counter ?? 0);
    m.errand = null;
    delete m.counter;
    let kind: DebtReactKind | null = null;
    switch (e) {
      case 'pawn': {
        const a = pawnPick(m);
        if (a === undefined) break;
        const price = pawnPrice(st, a);
        if (!canLend(st, price)) {
          // 걸어오는 동안 금고가 비었다: 이 단계에서는 다시 오지 않는다.
          this.emit('vaultEmpty', { id: m.id, errand: 'pawn' });
          this.vaultToast();
          m.declined = this.moneyStage(m);
          kind = 'refused';
          break;
        }
        m.accessories.splice(m.accessories.indexOf(a), 1);
        m.pawned.push({ key: a.key, slot: a.slot, value: a.value, price });
        this.lend(price, at);
        m.wallet += price;
        this.afterBorrow(m);
        st.debtTotals.pawned += 1;
        this.emit('pawned', { id: m.id, key: a.key, price, at: { x: at.x, y: at.y } });
        kind = 'pawn';
        break;
      }
      case 'redeem': {
        // goSettle과 같은 남길 코인으로 (비싼 것을 되찾고 돈이 떨어져 곧바로 다시 맡기지 않게).
        const t = redeemPick(m, this.settleReserve(m, PAWN.redeemRounds, m.homeward === true));
        if (t === undefined) break;
        const cost = redeemCost(t);
        m.wallet -= cost;
        m.pawned.splice(m.pawned.indexOf(t), 1);
        m.accessories.push({ key: t.key, slot: t.slot, value: t.value });
        this.vaultIn(cost, cost - t.price, at);
        st.debtTotals.redeemed += 1;
        this.emit('redeemed', { id: m.id, key: t.key, cost, at: { x: at.x, y: at.y } });
        kind = 'redeem';
        break;
      }
      case 'loan': {
        if (!bankOpenFor(st, m)) break;
        const amount = bankLoan(st);
        if (!canLend(st, amount)) {
          this.emit('vaultEmpty', { id: m.id, errand: 'loan' });
          this.vaultToast();
          m.declined = this.moneyStage(m);
          kind = 'refused';
          break;
        }
        this.lend(amount, at);
        m.wallet += amount;
        m.debt += loanDebt(amount);
        m.loans = (m.loans ?? 0) + 1;
        this.afterBorrow(m);
        st.debtTotals.loans += 1;
        this.emit('loanTaken', { id: m.id, amount, debt: m.debt, at: { x: at.x, y: at.y } });
        kind = 'loan';
        break;
      }
      case 'repay': {
        if (m.debt <= 0 || m.wallet < m.debt) break;
        const amount = m.debt;
        m.wallet -= amount;
        m.debt = 0;
        this.vaultIn(amount, amount - Math.round(amount / BANK.interest), at);
        st.debtTotals.repaid += 1;
        this.emit('loanRepaid', { id: m.id, amount, at: { x: at.x, y: at.y } });
        kind = 'repay';
        break;
      }
      default:
        break;
    }
    if (kind === null) {
      if (m.homeward === true) {
        m.homeward = false;
        this.leave(m);
      } else this.decide(m);
      return;
    }
    this.debtReact(m, kind, 'reacting');
  }

  /** 맡기거나 빌린 뒤: 아직 거의 다 잃은 채라도 한판은 해 보고, 정말 못 놀 때 다시 묻는다 (곧장 다른 장신구·은행으로 줄줄이 가지 않게). */
  private afterBorrow(m: Monster): void {
    if (this.shortOfMoney(m) && this.moneyStage(m) === 'low') m.declined = 'low';
    else delete m.declined;
  }

  /** 볼일·파산·다 갚음 반응 (phase를 바꾸고 timer = 반응 시간). */
  private debtReact(m: Monster, kind: DebtReactKind, phase: 'reacting' | 'relieved'): void {
    const reaction = debtReaction(this.rng, kind, m);
    this.setPhase(m, phase);
    m.path = [];
    m.pose = reaction.pose;
    m.poseTime = phase === 'relieved' ? reaction.duration : 0;
    m.timer = phase === 'relieved' ? Math.max(reaction.duration, LABOR.reliefSec + 1) : reaction.duration;
    this.recordDex(m, reaction.label);
    this.emit('monsterReact', { id: m.id, reaction });
  }

  /** 마을 금고에서 빌려준다 (수입이 아니다). */
  private lend(amount: number, at: Pt): void {
    this.state.coins -= amount;
    this.emit('coinsChanged', { coins: this.state.coins, delta: -amount, at: { x: at.x, y: at.y } });
  }

  /** 금고로 돌아온 코인 (되찾기·갚기·파산 때 낸 지갑). earned = 그 가운데 마을 수입(이자)만. */
  private vaultIn(amount: number, earned: number, at: Pt | null): void {
    if (amount <= 0) return;
    this.state.coins += amount;
    this.state.totals.coinsEarned += Math.max(0, earned);
    this.emit('coinsChanged', { coins: this.state.coins, delta: amount, at: at === null ? null : { x: at.x, y: at.y } });
  }

  private vaultToast(): void {
    if (this.state.time - this.lastVaultToast < VAULT.emptyToastSec) return;
    this.lastVaultToast = this.state.time;
    this.toast('마을 금고가 비어서 전당포·은행이 손님에게 빌려주지 못했어요.', 'warn');
  }

  /** 못 찾고 떠난 장신구 하나를 전당포 컬렉션에 (그 종류가 처음이면 알린다). from = 맡겼던 손님. */
  private collect(key: AccessoryId, from: MonsterId): void {
    const st = this.state;
    const count = (st.pawnCollection[key] ?? 0) + 1;
    st.pawnCollection[key] = count;
    st.debtTotals.forfeited += 1;
    this.emit('pawnCollected', { key, count, first: count === 1, from });
    if (count === 1) this.toast(`전당포 진열장에 처음 들어왔어요: ${ACCESSORIES[key].name}`, 'good');
  }

  /**
   * 떠날 때 빚을 못 갚았다: 지갑을 다 내고 (금고로), 맡긴 장신구는 못 찾는다 (컬렉션으로). 남은 빚은 일터에서 갚는다.
   * 어두운 모습·축 처진 슬픔 (bankrupt), 파산 반응이 끝나면 일터로 (afterReact → goWork).
   */
  private goBankrupt(m: Monster): void {
    const st = this.state;
    this.detach(m);
    const paid = Math.min(Math.floor(m.wallet), m.debt);
    if (paid > 0) {
      m.wallet -= paid;
      m.debt -= paid;
      // 글자는 화면이 '빚 N' 위에 따로 띄운다 (bankrupt 이벤트의 paid): 여기서 자리를 주면 먹구름·게이지와 겹친다.
      this.vaultIn(paid, 0, null);
    }
    // 안전망: 다 갚았거나 일터가 없으면 (은행은 일터가 있어야 빌려준다) 그냥 집으로.
    if (m.debt <= 0 || !shopOpen(st, 'workyard')) {
      m.debt = 0;
      this.goHome(m);
      return;
    }
    for (const t of m.pawned.splice(0)) this.collect(t.key, m.id);
    m.bankrupt = true;
    m.wasBankrupt = true;
    m.broke = false;
    delete m.declined;
    m.mood = Math.min(m.mood, LABOR.mood);
    m.labor = this.newLabor(m.debt);
    st.debtTotals.bankrupt += 1;
    this.emit('bankrupt', { id: m.id, debt: m.debt, paid });
    this.toast(`${nameSubject(m)} 빚 ${m.debt}코인을 못 갚아 일터에서 일하게 됐어요…`, 'warn', 'debt');
    this.debtReact(m, 'bankrupt', 'reacting');
  }

  private newLabor(debt: number): LaborState {
    return { facility: 'farm', spot: -1, wait: -1, progress: 0, made: 0, total: Math.max(1, debt), boostSec: 0, boostMult: 1, match: null, since: this.state.time, matches: 0 };
  }

  /** 일터의 다른 채무자 (자리를 차지하고 있을 수 있는 손님). */
  private workers(): Monster[] {
    return this.state.monsters.filter((o) => o.bankrupt === true && o.labor !== null && o.labor !== undefined && o.labor.match === null);
  }

  /** 일터에 갈 수 있나: 놓였고 길로 이어졌거나, 이미 일터 안에 있다 (입구 앞 길만 끊겼으면 안에 있던 채무자는 그대로 일한다). */
  private yardReach(m: Monster): boolean {
    return shopOpen(this.state, 'workyard') || (isBuilt(this.state, 'workyard') && this.insideOf('workyard', m.pos));
  }

  /** 일터로: 빈 일하는 자리 (없으면 기다리는 자리)로 느리게 걸어간다. 일터에 갈 수 없으면 (보관함·길이 끊김) 가까운 길에서 기다린다 (backToRoad). */
  private goWork(m: Monster): void {
    const st = this.state;
    this.detach(m);
    const lab = (m.labor ??= this.newLabor(m.debt));
    lab.match = null;
    if (!this.yardReach(m)) {
      lab.spot = -1;
      lab.wait = -1;
      this.setPhase(m, 'waitWork');
      m.path = [];
      if ((m.poseTime ?? 0) <= 0) m.pose = 'sad';
      return;
    }
    const p = pickWorkSpot(this.rng, st, m, this.workers());
    lab.facility = p.facility;
    lab.spot = p.spot;
    lab.wait = p.wait;
    this.setPhase(m, 'toWork');
    const to = p.spot >= 0 ? workPt(st, p.facility, p.spot) : waitPt(st, p.facility, p.wait);
    this.go(m, to, 'workyard');
    if ((m.poseTime ?? 0) <= 0) m.pose = 'sad';
  }

  /** 일터 자리에 닿았다: 일하기 또는 기다리기 (시설을 본다). */
  private arriveWork(m: Monster): void {
    const lab = m.labor;
    if (m.bankrupt !== true || lab === null || lab === undefined) {
      this.decide(m);
      return;
    }
    // 오는 동안 일터가 보관함에 들어갔거나 길이 끊겼다 (일터 밖에서 멈췄다): 길에서 기다린다 (goWork).
    if (!this.yardReach(m)) {
      this.goWork(m);
      return;
    }
    this.setPhase(m, lab.spot >= 0 ? 'working' : 'waitWork');
    faceToward(m, villageOf(this.state).yard().facilities[lab.facility].face.x);
  }

  /**
   * 일: 빚이 laborRate만큼 줄고 (1코인마다 laborTick), LABOR.coinsPerMat코인마다 그 시설의 재료 하나 (laborOutput, 한숨·영차 반응).
   * 다 갚으면 홀가분. 파산하고 LABOR.forgiveSec가 지났으면 반장이 남은 빚을 덜어 준다.
   */
  private tickLabor(m: Monster, dt: number): void {
    const st = this.state;
    const lab = m.labor;
    if (m.bankrupt !== true || lab === null || lab === undefined) {
      this.decide(m);
      return;
    }
    if (this.forgiveLong(m, lab)) return;
    const rate = laborRate(st, m);
    lab.boostSec = Math.max(0, lab.boostSec - dt);
    if (lab.boostSec <= 0) lab.boostMult = 1;
    lab.progress += rate * dt;
    while (lab.progress >= 1 && m.debt > 0) {
      lab.progress -= 1;
      m.debt -= 1;
      lab.made += 1;
      this.emit('laborTick', { id: m.id, facility: lab.facility, debt: m.debt, total: lab.total, at: { x: m.pos.x, y: m.pos.y } });
      if (lab.made >= LABOR.coinsPerMat) {
        lab.made -= LABOR.coinsPerMat;
        const mat = LABOR.facilities[lab.facility].material;
        const got = addMaterial(st, mat, 1);
        st.debtTotals.laborMats += 1;
        st.debtTotals.laborBy[lab.facility] += 1;
        this.emit('laborOutput', { id: m.id, facility: lab.facility, material: mat, at: { x: m.pos.x, y: m.pos.y }, stored: got > 0 });
        if (got > 0) this.emit('itemsChanged', {});
        else this.capToast(mat);
        // 한숨·영차 (다 갚는 순간은 홀가분 반응이 이어서 난다).
        if (m.debt > 0 && (m.poseTime ?? 0) <= 0) this.sideReact(m, lab.facility === 'farm' ? 'laborFarm' : 'laborMine');
      }
    }
    if (m.debt <= 0) {
      m.debt = 0;
      this.relieve(m, false);
    }
  }

  /** 파산하고 LABOR.forgiveSec가 지났다 (일터에서 일하거나 기다리는 중): 반장이 남은 빚을 덜어 준다. 덜어 줬으면 true. */
  private forgiveLong(m: Monster, lab: LaborState): boolean {
    const st = this.state;
    lab.since ??= st.time;
    if (st.time - lab.since < LABOR.forgiveSec || m.debt <= 0) return false;
    const left = m.debt;
    m.debt = 0;
    this.relieve(m, true, left);
    return true;
  }

  /** 기다리는 채무자: 1초에 한 번 빈 일하는 자리를 본다 (오래 기다린 손님부터 그리로), 가끔 한숨. */
  private tickWaitWork(m: Monster): void {
    const lab = m.labor;
    if (m.bankrupt !== true || lab === null || lab === undefined) {
      this.decide(m);
      return;
    }
    if (this.forgiveLong(m, lab)) return;
    const t = m.phaseTime ?? 0;
    if (Math.floor(t) === Math.floor(t - SIM.dt)) return;
    // 일터에 갈 수 없었던 채무자 (보관함·길이 끊김): 다시 갈 수 있으면 간다. 너무 오래 못 가면 반장이 남은 빚을 덜어 준다.
    if (lab.wait < 0) {
      if (this.yardReach(m)) this.goWork(m);
      else if (t > LABOR.noYardSec) {
        const left = m.debt;
        m.debt = 0;
        this.relieve(m, true, left, 'noYard');
      }
      return;
    }
    const others = this.workers().filter((o) => o !== m);
    const free = WORK_FACILITIES.some((f) => {
      const used = others.filter((o) => o.labor?.facility === f && o.labor.spot >= 0).length;
      return used < workSlots(this.state, f);
    });
    if (free && others.every((o) => o.phase !== 'waitWork' || (o.phaseTime ?? 0) <= t)) {
      this.goWork(m);
      return;
    }
    if ((m.poseTime ?? 0) <= 0 && this.rng.chance(LABOR.waitMutter)) this.sideReact(m, 'waitWork');
  }

  /** 응원·간식·반장: 일하는 채무자가 sec초 동안 mult배 빨리 갚는다 (더 센 쪽이 남는다). */
  private boostLabor(m: Monster, mult: number, sec: number): void {
    const lab = m.labor;
    if (m.bankrupt !== true || lab === null || lab === undefined) return;
    lab.boostMult = Math.max(lab.boostSec > 0 ? lab.boostMult : 1, mult);
    lab.boostSec = Math.max(lab.boostSec, sec);
  }

  /** 일터 반장: LABOR.foreman.everySec마다 일하는 채무자 하나를 다독인다 (게이지가 덜 찬 손님이 더 자주, 잠깐 빨라짐). */
  private tickForeman(dt: number): void {
    const st = this.state;
    if (!shopOpen(st, 'workyard')) return;
    st.foremanTimer = (st.foremanTimer ?? LABOR.foreman.everySec) - dt;
    if (st.foremanTimer > 0) return;
    st.foremanTimer = LABOR.foreman.everySec;
    const working = st.monsters.filter((m) => m.phase === 'working' && m.bankrupt === true && m.labor !== null && m.labor !== undefined);
    if (working.length === 0) return;
    const m = this.rng.weighted(working.map((w) => [w, 1.2 - laborGauge(w)] as const));
    const lab = m.labor;
    if (lab === null || lab === undefined) return;
    this.boostLabor(m, LABOR.foreman.mult, LABOR.foreman.sec);
    this.emit('foremanCheer', { id: m.id, facility: lab.facility });
    if ((m.poseTime ?? 0) <= 0) this.sideReact(m, 'cheered');
  }

  /**
   * 빚을 다 갚았다 (forgiven = 반장이 남은 빚 left를 덜어 줌): 어둠이 걷히고 기뻐한 뒤 (relieved) 떠나 단골이 된다 ('다시 일어선 단골').
   */
  private relieve(m: Monster, forgiven: boolean, left = 0, why: 'long' | 'noYard' = 'long'): void {
    const st = this.state;
    this.detach(m);
    m.bankrupt = false;
    m.debt = 0;
    m.labor = null;
    m.broke = false;
    m.patience = 0;
    m.mood = clampMood(Math.max(m.mood, 70));
    st.debtTotals.relieved += 1;
    if (forgiven) st.debtTotals.forgiven += 1;
    this.emit('debtCleared', { id: m.id, forgiven });
    const text = !forgiven
      ? `${nameSubject(m)} 빚을 다 갚았어요! 홀가분하게 떠나요.`
      : why === 'noYard'
        ? `일터로 가는 길이 없어서 반장이 ${displayName(m)}의 남은 빚 ${left}코인을 덜어 줬어요. 홀가분하게 떠나요.`
        : `${josa(displayName(m), '은', '는')} 오래 일해서 반장이 남은 빚 ${left}코인을 덜어 줬어요. 홀가분하게 떠나요.`;
    this.toast(text, 'good', 'debt');
    this.debtReact(m, forgiven ? 'forgiven' : 'relieved', 'relieved');
  }

  /** 빚 걸기 판의 선수 자리인가 (밀어내기 = 모래판 자리 0·1, 줄다리기 = 모든 자리). */
  private debtSeat(b: BoothId, seat: number): boolean {
    return (DEBT_MATCH.watchOnly as readonly BoothId[]).includes(b) || seat <= 1;
  }

  /** 빚 걸기 판이 예약된 부스의 선수 자리 (다른 손님이 앉거나 다시 한판 하지 않는다). */
  private debtHeld(b: BoothId, seat: number): boolean {
    return this.state.booths[b].group?.debtNext === true && this.debtSeat(b, seat);
  }

  /** 빚 걸기 판에 부를 수 있는 채무자 (debt.ts debtEligible). */
  private debtPool(): Monster[] {
    return this.state.monsters.filter(debtEligible);
  }

  /**
   * 빚 걸기 판: DEBT_MATCH.checkSec마다, 부를 수 있는 채무자가 넉넉하면 가끔 (chance) 반장이 부스 하나를 고른다 (부스마다 cooldownSec에 한 번).
   * 부스가 쉬는 중(판이 쉬고 선수 자리가 빔)이면 바로 연다. 아니면 예약 (GroupState.debtNext): 지금 판이 끝나면 선수 자리를 비워 두었다가 연다
   * (예약하고 DEBT_MATCH.holdSec 안에 못 열면 그만둔다).
   */
  private tickDebtMatches(dt: number): void {
    const st = this.state;
    // 예약된 부스: 매 틱 열 수 있는지 본다.
    for (const b of DEBT_MATCH.booths) {
      const g = st.booths[b].group;
      if (g === null || g.debtNext !== true) continue;
      const pool = this.debtPool();
      // 줄다리기는 예약 뒤에도 편마다 둘 (tugMin) 모여 있어야 연다.
      const need = b === 'tug' ? DEBT_MATCH.tugMin : DEBT_MATCH.minDebtors;
      if (!B.boothOpen(st, b) || pool.length < need || st.time - (st.debtMatchAt[b] ?? 0) > DEBT_MATCH.holdSec) {
        delete g.debtNext;
        continue;
      }
      if (this.debtReady(b)) this.callDebtMatch(b, pool);
    }
    st.debtCheck -= dt;
    if (st.debtCheck > 0) return;
    st.debtCheck = DEBT_MATCH.checkSec;
    const pool = this.debtPool();
    if (pool.length < DEBT_MATCH.minDebtors) return;
    // 줄다리기는 편마다 둘이 설 만큼 (DEBT_MATCH.tugMin) 모였을 때만 (멀리 있어 한 짝만 부르기엔 걷는 길이 길다).
    const free = DEBT_MATCH.booths.filter((b) => {
      const g = st.booths[b].group;
      if (b === 'tug' && pool.length < DEBT_MATCH.tugMin) return false;
      return B.boothOpen(st, b) && g !== null && g.mode !== 'debt' && g.debtNext !== true && st.time - (st.debtMatchAt[b] ?? -Infinity) >= DEBT_MATCH.cooldownSec;
    });
    if (free.length === 0 || !this.rng.chance(DEBT_MATCH.chance)) return;
    const b = this.rng.pick(free);
    st.debtMatchAt[b] = st.time;
    if (this.debtReady(b)) {
      this.callDebtMatch(b, pool);
      return;
    }
    const g = st.booths[b].group;
    if (g !== null) g.debtNext = true;
  }

  /** 빚 걸기 판을 지금 열 수 있나: 판이 쉬고 선수 자리가 비었다. */
  private debtReady(b: GroupBoothId): boolean {
    const bs = this.state.booths[b];
    if (bs.group === null || bs.group.phase !== 'idle') return false;
    for (let i = 0; i < bs.seats.length; i++) if ((bs.seats[i] ?? null) !== null && this.debtSeat(b, i)) return false;
    return true;
  }

  /**
   * 반장이 빚 걸기 판을 연다: 빚이 비슷한 채무자끼리 짝지어 (debt.ts pairDebtors: 줄다리기는 짝마다 홍·청, 편마다 tugSide명까지)
   * 자리 0부터 앉히러 부른다 ('빚을 걸고 한판!'). 판은 채무자가 다 오면 시작한다.
   */
  private callDebtMatch(b: GroupBoothId, pool: readonly Monster[]): void {
    const st = this.state;
    const bs = st.booths[b];
    const g = (bs.group ??= idleGroup());
    B.fitSeats(st, b);
    const pairs = b === 'tug' ? Math.min(DEBT_MATCH.tugSide, Math.floor(B.boothSeats(st, b) / 2)) : 1;
    const picked = pairDebtors(this.rng, pool, pairs);
    delete g.debtNext;
    if (picked.length < 2) return;
    g.phase = 'gathering';
    g.mode = 'debt';
    g.debtors = picked.map((m) => m.id);
    g.countdown = groupGatherSec(b, B.boothStat(st, b, 'pace'));
    g.elapsed = 0;
    g.duration = 0;
    g.participants = [];
    g.play = null;
    picked.forEach((m, i) => {
      this.detach(m);
      const lab = m.labor;
      if (lab !== null && lab !== undefined) {
        lab.match = b;
        lab.spot = -1;
        lab.wait = -1;
        lab.matches = (lab.matches ?? 0) + 1;
      }
      bs.seats[i] = m.id;
      m.booth = b;
      m.seat = i;
      this.setPhase(m, 'toSeat');
      this.go(m, B.seatPt(st, b, i), b);
      this.sideReact(m, 'matchCalled');
    });
    st.debtMatchAt[b] = st.time;
    st.debtTotals.matches += 1;
    this.emit('debtMatchCalled', { booth: b, debtors: g.debtors.slice() });
    this.toast(`일터 반장이 ${BOOTHS[b].name}에서 빚 걸기 판을 열었어요! 빚진 손님들이 자기 빚을 걸고 겨뤄요.`, 'info');
  }

  /**
   * 빚 걸기 판 정산 (finishGroup, 참가자마다 roundFinished 전): 채무자 선수마다 이기면 빚 × DEBT_MATCH.winKeep (뒤집기·역전 대박이면 0),
   * 지면 짝 상대의 (판을 시작할 때) 빚만큼 더 (maxDebt까지). 게이지 분모(labor.total)는 늘어난 빚으로. 알림은 debtSettledNotice.
   */
  private settleDebts(b: GroupBoothId, g: GroupState, play: GroupPlay): DebtChange[] {
    const changes: DebtChange[] = [];
    g.participants.forEach((e, i) => {
      const o = play.outcomes[i];
      const m = this.monster(e.monster);
      if (e.debt === undefined || o === undefined || m === undefined) return;
      const stake = e.debt;
      const won = o.tier === 'win' || o.tier === 'jackpot';
      const opp = this.debtOpponent(b, g, e);
      const before = m.debt;
      const result: DebtChange['result'] = won ? (o.tier === 'jackpot' ? 'cleared' : 'halved') : 'added';
      const after = result === 'cleared' ? 0 : result === 'halved' ? Math.round(stake * DEBT_MATCH.winKeep) : Math.min(DEBT_MATCH.maxDebt, Math.max(stake, stake + (opp?.debt ?? 0)));
      m.debt = Math.max(0, after);
      const lab = m.labor;
      if (lab !== null && lab !== undefined) {
        lab.progress = 0;
        if (m.debt > lab.total) lab.total = m.debt;
      }
      changes.push({ id: m.id, before, after: m.debt, tier: o.tier, opponent: opp?.monster ?? null, result });
    });
    return changes;
  }

  /**
   * 빚 걸기 판 정산 알림: debtSettled 이벤트와 짧은 토스트 ('빚 걸기 판 끝! 말랑 빚 반으로 · 호떡 빚이 늘었어요', 줄다리기는 편마다).
   * 숫자는 부스 패널·확대 화면 결과판에 있다 (그 부스 패널이 열려 있으면 UI가 토스트를 건너뛴다).
   */
  private debtSettledNotice(b: GroupBoothId, changes: DebtChange[]): void {
    this.emit('debtSettled', { booth: b, changes });
    const word = (cs: readonly DebtChange[]): string => (cs.every((c) => c.result === 'cleared') ? '빚이 사라졌어요' : cs.some((c) => c.result === 'added') ? '빚이 늘었어요' : '빚 반으로');
    const parts: string[] = [];
    if (b === 'tug') {
      const g = this.state.booths[b].group;
      for (const side of [0, 1]) {
        const cs = changes.filter((c) => g?.participants.find((e) => e.monster === c.id)?.pick === side);
        if (cs.length > 0) parts.push(`${SIDES[side]?.name ?? ''} 편 ${word(cs)}`);
      }
    } else {
      for (const c of changes) {
        const m = this.monster(c.id);
        if (m !== undefined) parts.push(`${m.nickname} ${word([c])}`);
      }
    }
    this.toast(`빚 걸기 판 끝! ${parts.join(' · ')}`, 'info', undefined, b);
  }

  /** 빚 걸기 판의 상대 채무자 (밀어내기 = 다른 선수, 줄다리기 = 짝지은 상대 편 선수: 자리 2k ↔ 2k+1). */
  private debtOpponent(b: GroupBoothId, g: GroupState, e: GroupEntry): GroupEntry | undefined {
    if (b === 'tug') return g.participants.find((x) => x !== e && x.debt !== undefined && x.seat === (e.seat ^ 1));
    return g.participants.find((x) => x !== e && x.debt !== undefined && x.role === 'player');
  }

  /**
   * 개발용 (주소 ?match=부스, ?debtors=N과 같이): 반장이 지금 그 부스에 빚 걸기 판을 연다 (쉬고 있으면 바로, 아니면 예약).
   * 부스가 닫혔거나 부를 채무자가 모자라면 (줄다리기는 tugMin) false.
   */
  devDebtMatch(b: GroupBoothId): boolean {
    const st = this.state;
    const g = st.booths[b].group;
    const pool = this.debtPool();
    if (!B.boothOpen(st, b) || g === null || pool.length < (b === 'tug' ? DEBT_MATCH.tugMin : DEBT_MATCH.minDebtors)) return false;
    st.debtMatchAt[b] = st.time;
    if (this.debtReady(b)) this.callDebtMatch(b, pool);
    else g.debtNext = true;
    return true;
  }

  /**
   * 개발용 (주소 ?debtors=N, sim-check): 손님 id를 빚 debt (DEBT_MATCH.maxDebt까지)로 바로 파산시켜 일터로 보낸다 (일터가 없으면 아무것도 안 한다).
   * 파산 반응 없이 곧장 걸어간다.
   */
  devBankrupt(id: MonsterId, debt: number): boolean {
    const m = this.monster(id);
    if (m === undefined || !shopOpen(this.state, 'workyard')) return false;
    this.detach(m);
    m.debt = Math.max(1, Math.min(DEBT_MATCH.maxDebt, Math.round(debt)));
    // 진짜 파산처럼 지갑은 비운다 (개발용이라 금고로 보내지는 않는다).
    m.wallet = 0;
    m.bankrupt = true;
    m.wasBankrupt = true;
    m.mood = Math.min(m.mood, LABOR.mood);
    m.labor = this.newLabor(m.debt);
    this.state.debtTotals.bankrupt += 1;
    this.emit('bankrupt', { id: m.id, debt: m.debt, paid: 0 });
    this.goWork(m);
    return true;
  }

  // ── 다섯째 묶음: 손님이 돈을 쓰는 가게 (DESIGN 3.8) ─────────────────────────────
  // decide → goShopping (shops.ts chooseShop: 기분·흐름·지갑·거리, 살 것은 그때 정한다) → toShop (줄로) → shopQueue
  //   → (계산대가 비고, 머무는 가게는 자리가 나면) buying (계산대에서 serviceSec초) → finishBuy: 낸다 (마을 수입, shopServed)
  //   → 들고 가는 가게 = 효과 + 손에 든 것 (held, 먹으며 걷기) + 반응 / 머무는 가게 = toShopSeat → atShop (stay초) → finishStay
  //   / 놀이기구 = 자리에 서서 한 바퀴를 같이 (tickRide: boarding → running → 탄 손님 모두 finishStay).
  // 아이스크림 트럭은 길 위를 다니다 선다 (tickTruck). 손님은 트럭을 따라가 (followTruck) 트럭 둘레 줄에 선다. 꽃다발을 산 손님은 친한 손님에게 걸어가 건넨다 (toFriend).
  // 떠나기 전에는 기념품 가게 (goSouvenir, shopHome: 끝나면 집으로). 크게 딴 손님은 진행자에게 팁 (tipHost, finishRound).
  // 가게 주인 = Staff.shop (짓으면 그 가게의 주인이 같이 온다: buyShop). 주인이 없거나 길이 끊기면 닫힌다 (shopOpen).

  /** 가게마다: 자리 수 맞추기, 트럭·놀이기구 돌리기. */
  private tickShops(dt: number): void {
    const st = this.state;
    for (const s of SHOP_IDS) {
      const ss = st.shops[s];
      if (ss.level < 1) continue;
      fitShop(st, s);
      if (ss.truck !== null) this.tickTruck(dt);
      if (ss.ride !== null) this.tickRide(s, dt);
    }
  }

  /** 손에 든 것 (먹으며 걷기: 다 먹으면 shopConsumed)과 가게 효과 (걸음·운·반짝이)의 남은 초. */
  private tickHeld(m: Monster, dt: number): void {
    const h = m.held;
    if (h !== null && h !== undefined) {
      h.left -= dt;
      if (h.left <= 0) {
        m.held = null;
        if (h.eat && h.shop !== null) this.emit('shopConsumed', { id: m.id, shop: h.shop, item: h.item, at: { x: m.pos.x, y: m.pos.y }, react: null });
      }
    }
    const b = m.buffs;
    if (b === undefined) return;
    if (b.speedSec !== undefined && (b.speedSec -= dt) <= 0) {
      delete b.speedSec;
      delete b.speed;
    }
    if (b.luckSec !== undefined && (b.luckSec -= dt) <= 0) {
      delete b.luckSec;
      delete b.luck;
      delete b.fortune;
    }
    if (b.sparkleSec !== undefined && (b.sparkleSec -= dt) <= 0) delete b.sparkleSec;
  }

  /**
   * 가게에 갈까 (decide에서, sure = 확률 없이: 자리를 털고 먹으러 갈 때): 다녀온 뒤 SHOP_VISIT.cooldownSec가 지났고 한 방문 maxPerVisit곳 안이면 확률 (기분이 낮거나 흐름이 크면 더, 마음이 남았으면 더, 아직 안 논 손님은 덜)로
   * 갈 가게와 살 것을 고른다 (shops.ts chooseShop). 갔으면 true.
   */
  private goShopping(m: Monster, sure = false): boolean {
    const st = this.state;
    if (m.bankrupt === true || m.broke === true) return false;
    if ((m.shopsVisited?.length ?? 0) >= SHOP_VISIT.maxPerVisit) return false;
    if (st.time - (m.shopAt ?? -Infinity) < SHOP_VISIT.cooldownSec) return false;
    // 열린 가게가 없으면 난수도 쓰지 않는다 (가게가 없는 마을의 흐름이 예전과 같게).
    if (!SHOP_IDS.some((s) => shopIsOpen(st, s))) return false;
    // 결과가 남긴 마음 (달래기·단 것·축하)이 있으면 더 자주 떠올린다.
    const urge = urgeOf(st, m);
    let p = SHOP_VISIT.chance + (m.mood < 40 ? SHOP_VISIT.lowMoodBonus : 0) + Math.min(SHOP_VISIT.streakMax, Math.abs(m.streak ?? 0)) * SHOP_VISIT.streakBonus + (urge !== null ? SHOP_URGE.chance : 0);
    if (m.stats.rounds === 0) p *= SHOP_VISIT.newcomer;
    if (!sure && !this.rng.chance(p)) return false;
    const pick = chooseShop(st, this.rng, m, this.visitAge(m));
    if (pick === null) return false;
    this.goToShop(m, pick.shop, pick.order, false);
    return true;
  }

  /** 떠나는 길의 기념품 가게 (딴 적이 있거나 지갑이 넉넉하고, 기분 SHOP_VISIT.souvenirMood 이상, 대박·남은 코인이 많으면 더 자주). 갔으면 true. */
  private goSouvenir(m: Monster): boolean {
    const st = this.state;
    const s: ShopId = 'souvenir_shop';
    // 딴 적이 없어도 지갑이 넉넉하면 (souvenirWallet 이상) 즐거웠던 기념으로.
    if (m.broke === true || m.bankrupt === true || m.wasBankrupt === true || visited(m, s) || (m.stats.wins === 0 && m.wallet < SHOP_VISIT.souvenirWallet) || m.mood < SHOP_VISIT.souvenirMood) return false;
    if (!shopIsOpen(st, s) || !shopHasRoom(st, s)) return false;
    // 지갑에 남은 코인이 많을수록 '남은 코인으로 기념품 하나'.
    const p = SHOP_VISIT.souvenirChance * ((m.hadJackpot ? 1.5 : 1) + (0.5 * Math.max(0, m.wallet)) / SHOP_VISIT.souvenirWallet);
    if (!this.rng.chance(Math.min(0.95, p))) return false;
    const order = pickOrder(st, this.rng, m, s, 0);
    if (order === null) return false;
    this.goToShop(m, s, order, true);
    return true;
  }

  /** 가게 줄 끝에 선다 (살 것 order는 지금 값: 계산대에서 낼 수 없으면 사지 않는다). home = 떠나는 길 (볼일 뒤 집으로). */
  private goToShop(m: Monster, s: ShopId, order: ShopOrder, home: boolean): void {
    const st = this.state;
    const ss = st.shops[s];
    this.detach(m);
    m.shop = s;
    m.shopSlot = -1;
    m.order = order;
    m.shopHome = home;
    ss.queue.push(m.id);
    st.shopTotals.visits += 1;
    this.setPhase(m, 'toShop');
    this.goShopSpot(m, s, ss.queue.length - 1);
    m.pose = 'base';
    m.poseTime = 0;
    // 걸어가며 작게: 마음이 있으면 더 자주, 그 마음대로 ('배고파…'·'한턱 쏜다!').
    const urge = home ? null : urgeOf(st, m);
    if (this.rng.chance(urge !== null ? 0.6 : 0.4)) this.sideShopReact(m, urge === 'celebrate' ? 'goShopHappy' : urge !== null ? 'goShopSad' : 'goShop');
    this.emit('shopVisit', { id: m.id, shop: s, order: { ...order } });
  }

  /** 줄 i번째 자리로 걷는다 (트럭은 길 위의 트럭 둘레). */
  private goShopSpot(m: Monster, s: ShopId, i: number): void {
    const p = shopQueuePt(this.state, s, i);
    if (s === 'icecream_truck') this.go(m, p);
    else this.go(m, p, s);
  }

  /** 줄 선 손님들을 제자리로 (앞이 비면 한 칸씩 앞으로). */
  private layoutShopQueue(s: ShopId): void {
    const st = this.state;
    const ss = st.shops[s];
    ss.queue.forEach((id, i) => {
      const m = this.monster(id);
      if (m === undefined) return;
      const spot = shopQueuePt(st, s, i);
      if (m.phase === 'shopQueue') {
        if (dist(m.pos, spot) > 2) {
          m.path = [{ x: spot.x, y: spot.y }];
          m.dest = { x: spot.x, y: spot.y, via: s === 'icecream_truck' ? null : s };
        }
      } else if (m.phase === 'toShop' && s !== 'icecream_truck') this.go(m, spot, s);
    });
  }

  /** 가게 줄·계산대·자리에서 빼고 가게 칸을 지운다 (낸 코인은 돌려주지 않는다: 머무는 중에 접히면 효과는 finishStay·storeShop이 먼저 준다). */
  private leaveShop(m: Monster): void {
    const s = m.shop;
    if (s !== null && s !== undefined) {
      const ss = this.state.shops[s];
      const qi = ss.queue.indexOf(m.id);
      if (qi >= 0) {
        ss.queue.splice(qi, 1);
        this.layoutShopQueue(s);
      }
      if (ss.serving === m.id) ss.serving = null;
      for (let i = 0; i < ss.slots.length; i++) if (ss.slots[i] === m.id) ss.slots[i] = null;
      const r = ss.ride;
      if (r !== null) {
        const k = r.riders.indexOf(m.id);
        if (k >= 0) r.riders.splice(k, 1);
      }
    }
    if (m.shop !== undefined) m.shop = null;
    if (m.shopSlot !== undefined) m.shopSlot = -1;
    if (m.order !== undefined) m.order = null;
    if (m.hidden === true) m.hidden = false;
  }

  /** 가게 볼일을 접는다 (닫혔음·줄이 너무 김·낼 수 없음·트럭을 놓침): 떠나는 길이면 집으로, 아니면 곧 다른 걸 한다. */
  private dropShop(m: Monster): void {
    const home = m.shopHome === true;
    this.leaveShop(m);
    m.shopTrip = !home;
    m.shopHome = false;
    m.shopAt = this.state.time;
    if (home) this.goHome(m);
    else this.decideSoon(m);
  }

  /** 가게를 잃은 손님 (옮겼거나 보관함): phase에 맞게 새 자리로 (보관했으면 접는다). */
  private reShop(m: Monster): void {
    const st = this.state;
    const s = m.shop;
    if (s === null || s === undefined || !shopOwned(st, s) || !isPlaced(st, s)) {
      this.dropShop(m);
      return;
    }
    const ss = st.shops[s];
    if (m.phase === 'toShop' || m.phase === 'shopQueue') this.goShopSpot(m, s, Math.max(0, ss.queue.indexOf(m.id)));
    else if (m.phase === 'buying') this.go(m, shopCounterPt(st, s), s === 'icecream_truck' ? null : s);
    else this.go(m, shopSlotPt(st, s, Math.max(0, m.shopSlot ?? 0)), s);
  }

  /** 줄 자리에 닿았다 (트럭은 followTruck이 본다). 가게가 닫혔으면 접는다. */
  private arriveShopQueue(m: Monster): void {
    const st = this.state;
    const s = m.shop;
    if (s === null || s === undefined || !shopIsOpen(st, s) || !st.shops[s].queue.includes(m.id)) {
      this.dropShop(m);
      return;
    }
    if (s === 'icecream_truck') return;
    this.setPhase(m, 'shopQueue');
    faceToward(m, shopCounterPt(st, s).x);
  }

  /** 줄에서 기다린다: 너무 오래면 (SHOP_VISIT.queueGiveUpSec) 다른 걸 한다. 트럭이 떠나면 다시 따라간다. */
  private tickShopQueue(m: Monster): void {
    const st = this.state;
    const s = m.shop;
    if (s === null || s === undefined || !st.shops[s].queue.includes(m.id)) {
      this.dropShop(m);
      return;
    }
    if ((m.phaseTime ?? 0) > SHOP_VISIT.queueGiveUpSec) {
      m.mood = clampMood(m.mood - 2);
      this.dropShop(m);
      return;
    }
    const t = st.shops[s].truck;
    if (t !== null && (t.parked || t.stop <= 0)) this.setPhase(m, 'toShop');
  }

  /** 트럭을 따라간다: 트럭 둘레 줄 자리로 (트럭이 움직이면 1초마다 길을 고친다), 닿았고 트럭이 서 있으면 줄에 선다. TRUCK.followSec 안에 못 닿으면 그만. */
  private followTruck(m: Monster): void {
    const st = this.state;
    const ss = st.shops.icecream_truck;
    const t = ss.truck;
    if (t === null || t.parked || !shopIsOpen(st, 'icecream_truck') || !ss.queue.includes(m.id) || (m.phaseTime ?? 0) > TRUCK.followSec) {
      this.dropShop(m);
      return;
    }
    const spot = shopQueuePt(st, 'icecream_truck', Math.max(0, ss.queue.indexOf(m.id)));
    if (m.path.length === 0 && dist(m.pos, spot) <= 14) {
      if (t.stop > 0) {
        this.setPhase(m, 'shopQueue');
        faceToward(m, t.x);
      }
      return;
    }
    const d = m.dest ?? null;
    const stale = d === null || dist(d, spot) > 40;
    if (m.path.length === 0 || (stale && ((m.phaseTime ?? 0) % 1 < SIM.dt + 1e-6 || (m.phaseTime ?? 0) < SIM.dt * 2))) this.go(m, spot);
  }

  /** 계산대가 비었으면 줄 맨 앞 손님 (줄 자리에 서 있는 손님)을 계산대로. 머무는 가게는 빈 자리가 있어야 (놀이기구는 달리는 중이 아니어야). 닫혔으면 줄을 푼다. */
  private pumpShop(s: ShopId): void {
    const st = this.state;
    const ss = st.shops[s];
    if (ss.level < 1 && ss.queue.length === 0) return;
    // 안전망: 없어졌거나 다른 걸 하는 손님은 지운다.
    for (let i = ss.queue.length - 1; i >= 0; i--) {
      const m = this.monster(ss.queue[i] as MonsterId);
      if (m === undefined || m.shop !== s || (m.phase !== 'toShop' && m.phase !== 'shopQueue')) ss.queue.splice(i, 1);
    }
    if (ss.serving !== null) {
      const m = this.monster(ss.serving);
      if (m === undefined || m.shop !== s || m.phase !== 'buying') ss.serving = null;
    }
    for (let i = 0; i < ss.slots.length; i++) {
      const id = ss.slots[i] ?? null;
      if (id === null) continue;
      const m = this.monster(id);
      if (m === undefined || m.shop !== s || m.shopSlot !== i || (m.phase !== 'buying' && m.phase !== 'toShopSeat' && m.phase !== 'atShop')) ss.slots[i] = null;
    }
    if (!shopIsOpen(st, s)) {
      // 닫힌 가게: 아직 내지 않은 손님 (줄·계산대)은 다른 걸 하러 간다. 낸 손님 (자리)은 마저 머문다.
      for (const id of [...ss.queue, ...(ss.serving === null ? [] : [ss.serving])]) {
        const m = this.monster(id);
        if (m !== undefined) this.dropShop(m);
      }
      return;
    }
    if (ss.serving !== null || ss.queue.length === 0) return;
    const t = ss.truck;
    if (t !== null && (t.parked || t.stop <= 0)) return;
    // 산 손님이 아직 계산대 가까이에서 반응 중이면 (비켜서는 중이거나 비켜설 곳이 없었다) 다음 손님은 기다린다: 둘이 겹치지 않게.
    if (!hasSlots(s)) {
      const at = shopCounterPt(st, s);
      if (st.monsters.some((o) => o.phase === 'reacting' && dist(o.pos, at) <= 44)) return;
    }
    const m = this.monster(ss.queue[0] as MonsterId);
    if (m === undefined || m.phase !== 'shopQueue' || m.path.length > 0) return;
    let slot = -1;
    if (hasSlots(s)) {
      // 놀이기구가 도는 동안은 줄에서 기다린다 (다음 바퀴: 판 위에 서서 기다리지 않게).
      if (ss.ride !== null && ss.ride.phase === 'running') return;
      const n = shopSlots(st, s);
      for (let i = 0; i < n; i++) {
        if ((ss.slots[i] ?? null) === null) {
          slot = i;
          break;
        }
      }
      if (slot < 0) return;
    }
    ss.queue.shift();
    ss.serving = m.id;
    if (slot >= 0) ss.slots[slot] = m.id;
    m.shopSlot = slot;
    this.setPhase(m, 'buying');
    m.timer = shopServiceSec(st, s);
    const at = shopCounterPt(st, s);
    m.path = [{ x: at.x, y: at.y }];
    m.dest = null;
    this.layoutShopQueue(s);
  }

  /** 계산대에서 다 샀다: 낸다 (마을 수입) → 들고 가는 가게는 효과·손에 든 것·반응, 머무는 가게는 자리로. 낼 수 없으면 (지갑이 줄었다) 사지 않는다. */
  private finishBuy(m: Monster): void {
    const st = this.state;
    const s = m.shop;
    if (s === null || s === undefined) {
      this.decideSoon(m);
      return;
    }
    const ss = st.shops[s];
    if (ss.serving === m.id) ss.serving = null;
    const o = m.order ?? null;
    if (o === null || !(o.price > 0) || m.wallet < o.price || !shopIsOpen(st, s)) {
      this.dropShop(m);
      return;
    }
    m.wallet -= o.price;
    m.stats.spent += o.price;
    const at = shopCounterPt(st, s);
    this.earn(o.price, at);
    ss.revenue += o.price;
    ss.served += 1;
    const T = st.shopTotals;
    T.served += 1;
    T.revenue += o.price;
    T.byShop[s] = (T.byShop[s] ?? 0) + 1;
    (m.shopsVisited ??= []).push(s);
    // 그 마음을 달래 줄 가게에서 샀으면 마음이 풀린다. 먹거리면 배고픔이 처음부터.
    const urge = urgeOf(st, m);
    if (urge !== null && URGE_SHOPS[urge].includes(s)) m.urge = null;
    if (isFood(s)) m.ateAt = st.time;
    this.emit('shopServed', { id: m.id, shop: s, item: o.item, price: o.price, at: { x: at.x, y: at.y } });
    if (hasSlots(s)) {
      const i = m.shopSlot ?? -1;
      if (i >= 0 && ss.slots[i] === m.id) {
        this.setPhase(m, 'toShopSeat');
        this.go(m, shopSlotPt(st, s, i), s);
        return;
      }
      // 안전망: 자리가 없어졌다 (레벨이 내려간 일은 없지만): 머문 셈 친다.
      this.finishStay(m);
      return;
    }
    this.takeAway(m, s, o);
  }

  /** 들고 가는 가게 (간식·음료·빵·트럭·장신구·점괘·기념품·꽃): 효과, 손에 든 것, 작은 반응 (꽃은 친한 손님에게 걸어간다). */
  private takeAway(m: Monster, s: ShopId, o: ShopOrder): void {
    const st = this.state;
    this.applyShopEffect(m, s, o);
    const d = SHOPS[s] as { hold?: number };
    const hold = d.hold ?? 0;
    if (o.accessory !== undefined) {
      // 새 장신구를 단다 (자리가 그새 찼으면 못 단다: 고를 때 빈 자리만 골랐다).
      if (!m.accessories.some((a) => a.slot === o.accessory?.slot) && !m.pawned.some((a) => a.slot === o.accessory?.slot)) {
        m.accessories.push({ key: o.accessory.key, slot: o.accessory.slot, value: o.accessory.value });
        st.shopTotals.accessories += 1;
      }
    } else if (o.item !== null && hold > 0) {
      const key = orderItemKey(o.item);
      m.held = { item: o.item, left: hold, total: hold, eat: key !== null && SHOP_ITEMS[key].hold === 'eat', shop: s };
    }
    if (s === 'flower_shop' && this.goGift(m)) return;
    // 점괘: 대길·길 = fortuneGood (열쇠로 '오늘 운수 대통!'·'좋은 점괘!'), 흉 = fortuneBad.
    const fortune = m.buffs?.fortune;
    this.endShop(m, takeAwayReact(s, fortune), s === 'fortune_teller' ? fortune : undefined);
  }

  /** 자리에 닿았다: 머물기 시작 (숨는 가게는 안 보인다, 놀이기구는 한 바퀴를 기다린다). */
  private arriveShopSeat(m: Monster): void {
    const st = this.state;
    const s = m.shop;
    const i = m.shopSlot ?? -1;
    if (s === null || s === undefined || i < 0 || st.shops[s].slots[i] !== m.id) {
      this.dropShop(m);
      return;
    }
    this.setPhase(m, 'atShop');
    faceToward(m, shopSlotLook(st, s, i).x);
    if ((SHOPS[s] as { hidden?: boolean }).hidden === true) m.hidden = true;
    m.timer = isRide(s) ? 0 : shopStaySec(this.rng, s);
  }

  /** 자리에서 머문다 (timer초 뒤 finishStay). 놀이기구는 tickRide가 끝낸다. */
  private tickAtShop(m: Monster, dt: number): void {
    const s = m.shop;
    if (s === null || s === undefined) {
      this.decideSoon(m);
      return;
    }
    if (isRide(s)) {
      // 안전망: 자리를 잃었으면 (보관하기) 접는다. 한 바퀴를 너무 오래 기다리면 (두 바퀴 넘게) 그냥 내린다.
      if (!this.state.shops[s].slots.includes(m.id)) this.dropShop(m);
      else if ((m.phaseTime ?? 0) > RIDE.boardSec * 3 + shopStaySec(this.rng, s) * 2.2) this.finishStay(m);
      return;
    }
    m.timer -= dt;
    if (m.timer <= 0) this.finishStay(m);
  }

  /** 다 머물렀다 (먹음·잠·탕·사진·한 바퀴): 효과, 자리를 비우고 반응. */
  private finishStay(m: Monster): void {
    const st = this.state;
    const s = m.shop;
    if (s === null || s === undefined) {
      this.decideSoon(m);
      return;
    }
    const o = m.order ?? { item: null, price: 0 };
    const at = shopSlotPt(st, s, Math.max(0, m.shopSlot ?? 0));
    m.hidden = false;
    this.applyShopEffect(m, s, o);
    let kind: ShopReactKind = 'ride';
    switch (s) {
      case 'restaurant': {
        // 좋아하는 메뉴면 가끔 배 터지게 먹고 드러눕는다 (미식가는 더, 다른 메뉴도 가끔).
        const fav = SPECIES_FOOD[m.species];
        const loved = fav !== undefined && o.item === itemArt(fav);
        const foodie = m.traits.includes('foodie');
        const p = loved ? FOOD_LIKE.stuffedChance * (foodie ? 2 : 1) : foodie ? FOOD_LIKE.foodieStuffed : 0;
        const stuffed = p > 0 && this.rng.chance(p);
        kind = stuffed ? 'stuffed' : loved ? 'favorite' : 'feast';
        break;
      }
      case 'beauty_salon':
        kind = 'salon';
        break;
      case 'inn':
        kind = 'innWake';
        break;
      case 'hot_spring':
        kind = 'soak';
        break;
      case 'photo_studio':
        kind = 'photo';
        break;
      default:
        kind = 'ride';
    }
    this.stayDone(m, s, o, at);
    this.emit('shopConsumed', { id: m.id, shop: s, item: s === 'photo_studio' ? null : o.item, at: { x: at.x, y: at.y }, react: kind });
    this.endShop(m, kind);
    if (kind === 'stuffed') this.flop(m);
  }

  /** 머문 가게의 남는 일 (다 머물렀거나, 낸 뒤 가게를 보관했다): 여관 기록, 사진관 사진첩·찰칵·손에 든 사진. */
  private stayDone(m: Monster, s: ShopId, o: ShopOrder, at: Pt): void {
    const st = this.state;
    if (s === 'inn') st.shopTotals.innStays += 1;
    if (s !== 'photo_studio') return;
    const first = st.photoAlbum[m.species] === undefined;
    if (first) st.photoAlbum[m.species] = st.time;
    st.shopTotals.photos += 1;
    this.emit('photoTaken', { id: m.id, species: m.species, first, at: { x: at.x, y: at.y } });
    if (first) this.toast(`사진첩에 처음 들어왔어요: ${SPECIES[m.species].name}`, 'good');
    const hold = (SHOPS[s] as { hold?: number }).hold ?? 0;
    if (o.item !== null && hold > 0) m.held = { item: o.item, left: hold, total: hold, eat: false, shop: s };
  }

  /** 가게 볼일 끝: 가게 칸을 지우고 반응 (reacting, 끝나면 다음 할 일: 떠나는 길이면 집으로). key = 반응 후보 열쇠 (점괘 등급). */
  private endShop(m: Monster, kind: ShopReactKind, key?: string): void {
    const st = this.state;
    const s = m.shop ?? null;
    // 들고 가는 가게: 계산대에 선 채 반응하면 다음 손님이 그 위에 올라선다. 비켜서는 점으로 몇 걸음 (반응은 비켜선 뒤 센다).
    const aside = s !== null && !hasSlots(s) && dist(m.pos, shopCounterPt(st, s)) <= 40 ? shopPickupPt(st, s) : null;
    this.leaveShop(m);
    m.shopAt = st.time;
    m.shopTrip = m.shopHome !== true;
    const reaction = shopReaction(this.rng, kind, m, key);
    this.setPhase(m, 'reacting');
    m.path = [];
    m.dest = null;
    if (aside !== null && s !== null) this.go(m, aside, s === 'icecream_truck' ? null : s);
    m.pose = reaction.pose;
    m.poseTime = 0;
    m.timer = reaction.duration;
    this.recordDex(m, reaction.label);
    this.emit('monsterReact', { id: m.id, reaction });
  }

  /**
   * 배 터지게 먹었다 (식당): 테이블 옆에 FOOD_LIKE.stuffedSec초 드러눕는다 (Monster.lying, reacting이 그만큼 길어진다),
   * 근처 손님이 보고 웃거나 걱정한다 (monsterSpectate). 다 누우면 getUp.
   */
  private flop(m: Monster): void {
    const rng = this.rng;
    m.lying = FOOD_LIKE.stuffedSec;
    m.timer = Math.max(m.timer, FOOD_LIKE.stuffedSec + 0.4);
    for (const o of this.state.monsters) {
      if (o === m || o.phase === 'leaving' || o.phase === 'playing' || o.phase === 'reacting' || o.bankrupt === true || o.hidden === true || o.path.length > 0) continue;
      if (dist(o.pos, m.pos) > FOOD_LIKE.watchRadius || !rng.chance(FOOD_LIKE.watchChance)) continue;
      const reaction = shopReaction(rng, 'flopWatch', o);
      o.pose = reaction.pose;
      o.poseTime = reaction.duration;
      faceToward(o, m.pos.x);
      // 도감에도 남긴다 (도감의 '가게·놀이기구' 줄이 이 반응을 센다).
      this.recordDex(o, reaction.label);
      this.emit('monsterSpectate', { id: o.id, target: m.id, reaction });
    }
  }

  /** 드러누웠다 일어난다: 뒤뚱뒤뚱 (FOOD_LIKE.waddle 동안 걸음이 느리다), '영차… 일어났다' 반응 (그동안 reacting). */
  private getUp(m: Monster): void {
    m.lying = 0;
    const b = (m.buffs ??= {});
    b.speed = FOOD_LIKE.waddle.mult;
    b.speedSec = FOOD_LIKE.waddle.sec;
    const reaction = shopReaction(this.rng, 'stuffedUp', m);
    this.setPhase(m, 'reacting');
    m.pose = reaction.pose;
    m.poseTime = 0;
    m.timer = reaction.duration;
    this.recordDex(m, reaction.label);
    this.emit('monsterReact', { id: m.id, reaction });
  }

  /** 걷는 중의 작은 가게 반응 (phase는 그대로). */
  private sideShopReact(m: Monster, kind: ShopReactKind): void {
    const reaction = shopReaction(this.rng, kind, m);
    m.pose = reaction.pose;
    m.poseTime = reaction.duration;
    this.recordDex(m, reaction.label);
    this.emit('monsterReact', { id: m.id, reaction });
  }

  /**
   * 가게 효과 (defs.ts SHOPS.effect): 기분 + 주인 입담 (좋아하는 메뉴면 더, 미식가는 먹거리에 더), 끈기, 걸음·운·반짝이 (Monster.buffs),
   * 여관은 지갑 일부 회복 (처음 지갑의 비율, 받은 코인으로 센다)·머무는 시간 연장 (bonusSec). 점괘가 좋았으면 true.
   */
  private applyShopEffect(m: Monster, s: ShopId, o: ShopOrder): boolean {
    const st = this.state;
    const d = SHOPS[s];
    const e = d.effect as { mood: number; patience?: number; speed?: { mult: number; sec: number }; luck?: { add: number; sec: number; goodChance: number }; sparkleSec?: number; wallet?: number; walletMax?: number; visitSec?: number };
    const charm = shopStat(st, s, 'charm');
    let mood = e.mood + (charm - 3);
    const fav = SPECIES_FOOD[m.species];
    if (fav !== undefined && o.item === itemArt(fav)) mood += FOOD_LIKE.favoriteMood;
    if (d.category === 'food' && m.traits.includes('foodie')) mood *= 1.3;
    // 온천: 처진 손님일수록 크게 녹는다.
    if (s === 'hot_spring') mood += springBonus(m.mood);
    let good = true;
    const b = (m.buffs ??= {});
    if (e.luck !== undefined) {
      // 점괘: 대길·길·흉 (주인 입담이 흉을 줄인다).
      const f = rollFortune(this.rng, charm);
      const g = FORTUNE[f];
      good = f !== 'bad';
      b.fortune = f;
      b.luck = g.luck;
      b.luckSec = e.luck.sec;
      mood = g.mood + (good ? charm - 3 : 0);
    }
    m.mood = clampMood(m.mood + mood);
    // 간식은 계속 지던 손님 (흐름 SHOP_URGE.comfortStreak 이하)이면 끈기가 하나 더 (사 먹고 기운을 차린다), 온천도 그렇다.
    if (e.patience !== undefined) m.patience += e.patience + (d.category === 'food' && (m.streak ?? 0) <= SHOP_URGE.comfortStreak ? 1 : 0);
    if (s === 'hot_spring' && (m.streak ?? 0) <= -2) m.patience += SPRING.losingPatience;
    if (e.speed !== undefined) {
      b.speed = e.speed.mult;
      b.speedSec = e.speed.sec;
    }
    // 미용실 반짝이: 레벨·주인 입담만큼 길게.
    if (e.sparkleSec !== undefined) b.sparkleSec = salonSparkleSec(st);
    if (e.wallet !== undefined) {
      const add = Math.max(0, Math.min(e.walletMax ?? Infinity, Math.round(startWallet(m) * e.wallet)));
      m.wallet += add;
      m.stats.won += add;
    }
    if (e.visitSec !== undefined) m.bonusSec = (m.bonusSec ?? 0) + e.visitSec;
    return good;
  }

  // ── 아이스크림 트럭 ──

  /**
   * 트럭: 가게가 닫혔으면 차고에. 열리면 차고 입구 앞 길 칸으로 나와 (TRUCK.startSec 서 있다가) 다음 설 길 칸까지 달리고 (shops.ts truckPlan·stepTruck),
   * 서면 TRUCK.stopSec 동안 판다 (truckStopped, 줄이 있으면 holdMax까지 더). 길이 끊겨 트럭 칸이 걸을 수 없는 길이 되면 차고로 돌아간다.
   */
  private tickTruck(dt: number): void {
    const st = this.state;
    const ss = st.shops.icecream_truck;
    const t = ss.truck;
    if (t === null) return;
    const v = villageOf(st);
    const home = v.truckHome();
    const park = (): void => {
      t.parked = true;
      t.path = [];
      t.stop = 0;
      t.held = 0;
      t.x = home.x;
      t.y = home.y;
    };
    if (!shopIsOpen(st, 'icecream_truck')) {
      park();
      return;
    }
    if (t.parked) {
      const p = v.placed('icecream_truck');
      const e = p === undefined ? -1 : v.entryCellIndex(p);
      if (e < 0 || !v.isWalkable(e)) {
        park();
        return;
      }
      const c = roadPoint(e, 0.5, 0.5, 0);
      t.parked = false;
      t.x = c.x;
      t.y = c.y;
      t.path = [];
      t.stop = TRUCK.startSec;
      t.held = 0;
      return;
    }
    // 길이 바뀌었다: 트럭 칸이 끊겼으면 차고로, 가던 길이 끊겼으면 여기서 다시 고른다.
    const cell = truckCell(t);
    if (!v.isWalkable(cell)) {
      park();
      return;
    }
    // 가던 길 중간 칸 (꺾이는 점 사이 곧은 길)까지 본다: 끊겼으면 같은 곳으로 돌아가는 길, 그것도 없으면 여기서 다시 고른다.
    if (t.path.length > 0 && !truckRouteOk(st, t)) {
      t.path = truckReroute(st, t);
      if (t.path.length > 0 && !truckRouteOk(st, t)) t.path = [];
    }
    if (t.stop > 0) {
      t.stop -= dt;
      const waiting = (id: MonsterId): boolean => {
        const o = this.monster(id);
        return o !== undefined && (o.phase === 'shopQueue' || (o.phase === 'toShop' && dist(o.pos, t) < TRUCK.waitNear));
      };
      if (t.stop <= 0 && (ss.queue.some(waiting) || ss.serving !== null) && t.held < TRUCK.holdMax) {
        // 줄 선 손님이 있거나 따라오던 손님이 거의 닿았으면 조금 더 선다 (코앞에서 떠나지 않게).
        t.held += dt;
        t.stop = dt;
      }
      if (t.stop <= 0) {
        t.held = 0;
        t.path = truckPlan(st, this.rng, cell);
        if (t.path.length === 0) t.stop = this.rng.range(TRUCK.stopSec[0], TRUCK.stopSec[1]);
      }
      return;
    }
    if (t.path.length > 0) {
      stepTruck(t, dt);
      if (t.path.length === 0) {
        t.stop = this.rng.range(TRUCK.stopSec[0], TRUCK.stopSec[1]);
        this.emit('truckStopped', { at: { x: t.x, y: t.y }, sec: t.stop });
        this.layoutShopQueue('icecream_truck');
      }
      return;
    }
    t.path = truckPlan(st, this.rng, cell);
    if (t.path.length === 0) t.stop = this.rng.range(TRUCK.stopSec[0], TRUCK.stopSec[1]);
  }

  // ── 놀이기구 ──

  /**
   * 회전목마·관람차: 첫 손님이 자리에 서면 boarding, RIDE.boardSec 뒤 (자리가 다 차면 fullSec 뒤, 자리로 오는 손님은 조금 기다린다) running (한 바퀴 = SHOPS.stay[0]초),
   * 다 돌면 탄 손님 모두 finishStay (효과·반응). 출발 뒤 온 손님은 다음 바퀴.
   */
  private tickRide(s: ShopId, dt: number): void {
    const st = this.state;
    const ss = st.shops[s];
    const r = ss.ride;
    if (r === null) return;
    r.t += dt;
    if (r.phase === 'running') {
      r.riders = r.riders.filter((id) => this.monster(id)?.shop === s);
      if (r.t < r.duration && r.riders.length > 0) return;
      const riders = r.riders;
      r.phase = 'idle';
      r.t = 0;
      r.riders = [];
      this.emit('rideFinished', { shop: s, riders: [...riders] });
      for (const id of riders) {
        const m = this.monster(id);
        if (m !== undefined && m.shop === s && m.phase === 'atShop') this.finishStay(m);
      }
      return;
    }
    const seated: MonsterId[] = [];
    let coming = false;
    for (const id of ss.slots) {
      if (id === null) continue;
      const m = this.monster(id);
      if (m === undefined) continue;
      if (m.phase === 'atShop') seated.push(id);
      else coming = true;
    }
    if (seated.length === 0) {
      r.phase = 'idle';
      r.t = 0;
      return;
    }
    if (r.phase === 'idle') {
      r.phase = 'boarding';
      r.t = 0;
      return;
    }
    const full = seated.length >= shopSlots(st, s);
    const go = (full && r.t >= RIDE.fullSec) || (r.t >= RIDE.boardSec && (!coming || r.t >= RIDE.boardSec * 2));
    if (!go) return;
    r.phase = 'running';
    r.t = 0;
    r.duration = shopStaySec(this.rng, s);
    r.riders = seated;
    this.emit('rideStarted', { shop: s, riders: [...seated] });
  }

  // ── 꽃 선물 ──

  /** 꽃다발을 든 손님이 친한 손님에게 간다 (shops.ts giftTarget: 시무룩한 친구 → 단체 놀이 친구 → 가장 가까운 친구). 친한 손님이 없으면 false. */
  private goGift(m: Monster): boolean {
    const st = this.state;
    const t = giftTarget(st, m);
    if (t === null) return false;
    const f = t.friend;
    this.leaveShop(m);
    m.shopAt = st.time;
    m.giftTo = f.id;
    this.setPhase(m, 'toFriend');
    this.go(m, f.pos);
    return true;
  }

  /** 꽃을 건네러 가는 중: 닿으면 건넨다, 친구가 떠났거나 FLOWER.giveUpSec 안에 못 닿으면 그만 (꽃은 들고 다닌다). */
  private tickGift(m: Monster): void {
    const f = m.giftTo === null || m.giftTo === undefined ? undefined : this.monster(m.giftTo);
    if (f === undefined || f.phase === 'leaving' || f.hidden === true || f.bankrupt === true || (m.phaseTime ?? 0) > FLOWER.giveUpSec) {
      m.giftTo = null;
      this.sideShopReact(m, 'lonely');
      this.decideSoon(m);
      return;
    }
    if (dist(m.pos, f.pos) <= FLOWER.reach) {
      this.giveGift(m, f);
      return;
    }
    const d = m.dest ?? null;
    if (m.path.length === 0 || ((d === null || dist(d, f.pos) > 60) && (m.phaseTime ?? 0) % 1.2 < SIM.dt + 1e-6)) this.go(m, f.pos);
  }

  /** 꽃을 건넨다: 둘 다 기분 +, 하트 (꽃다발은 받은 손님 손으로). 받는 친구가 시무룩하면 위로 꽃 (받은 손님 기분 +FLOWER.comfortMood, '기운 내!'·'훌쩍… 고마워'). */
  private giveGift(m: Monster, f: Monster): void {
    const st = this.state;
    m.giftTo = null;
    const comfort = f.mood < FLOWER.sadBelow;
    const bouquet = m.held?.item ?? itemArt('bouquet');
    m.held = null;
    f.held = { item: bouquet, left: 20, total: 20, eat: false, shop: null };
    m.mood = clampMood(m.mood + FLOWER.mood);
    f.mood = clampMood(f.mood + (comfort ? FLOWER.comfortMood : FLOWER.mood));
    st.shopTotals.gifts += 1;
    faceToward(m, f.pos.x);
    faceToward(f, m.pos.x);
    this.emit('giftGiven', { from: m.id, to: f.id, at: { x: (m.pos.x + f.pos.x) / 2, y: (m.pos.y + f.pos.y) / 2 } });
    const got = shopReaction(this.rng, comfort ? 'giftThanks' : 'giftGet', f);
    f.pose = got.pose;
    f.poseTime = got.duration;
    this.recordDex(f, got.label);
    this.emit('monsterReact', { id: f.id, reaction: got });
    this.endShop(m, comfort ? 'giftComfort' : 'giftGive');
  }

  // ── 팁 ──

  /** 크게 딴 손님이 진행자(0번 자리)에게 팁 (shops.ts tipFor: 성격마다 다르게, 마을 수입). 진행자가 없거나 지갑이 모자라면 주지 않는다. 결과 반응 뒤 고마워요 (afterReact). */
  private tipHost(b: BoothId, m: Monster, payout: number, bet: number, tier: OutcomeTier, festival: boolean): void {
    const st = this.state;
    if (B.boothStaff(st, b, 0) === null) return;
    const amount = tipFor(payout, bet, tier, festival, this.rng, m.traits);
    if (amount <= 0 || amount > m.wallet) return;
    m.wallet -= amount;
    m.tipped = this.rng.chance(TIP.reactChance);
    const at = B.hostPt(st, b, 0);
    this.earn(amount, at);
    st.shopTotals.tips += 1;
    st.shopTotals.tipCoins += amount;
    this.emit('tip', { id: m.id, booth: b, role: 0, amount, at: { x: at.x, y: at.y } });
  }

  // ── 보관하기 ──

  /** 가게를 보관함에 넣는다: 머무는 중이던 손님은 효과를 받고 나온다, 줄·계산대 손님은 다른 걸 하러 (out에 더한다). 놀이기구·트럭은 처음으로. */
  private storeShop(s: ShopId, out: Monster[]): void {
    const st = this.state;
    const ss = st.shops[s];
    for (const m of st.monsters) {
      if (m.shop !== s) continue;
      // 낸 손님 (자리로 가는 중·머무는 중)은 효과와 남는 일 (사진첩·여관 기록)까지 받고 나온다: 내고 아무것도 못 받는 일이 없게.
      if ((m.phase === 'atShop' || m.phase === 'toShopSeat') && m.order !== null && m.order !== undefined) {
        this.applyShopEffect(m, s, m.order);
        this.stayDone(m, s, m.order, m.pos);
      }
      this.leaveShop(m);
      if (m.shopHome === true) {
        m.shopHome = false;
        this.goHome(m);
        continue;
      }
      out.push(m);
    }
    ss.queue = [];
    ss.serving = null;
    ss.slots = ss.slots.map(() => null);
    if (ss.ride !== null) ss.ride = { phase: 'idle', t: 0, duration: 0, riders: [] };
    if (ss.truck !== null) {
      ss.truck.parked = true;
      ss.truck.path = [];
      ss.truck.stop = 0;
    }
  }

  // ── 촌장의 행동 (가게) ──

  /** 손님을 받는 중 (지었고 주인이 있고 놓여 길로 이어졌다). */
  shopOpen(s: ShopId): boolean {
    return shopIsOpen(this.state, s);
  }

  /** 짓는 비용 (이미 있으면 null). */
  shopBuyCost(s: ShopId): Cost | null {
    if (shopOwned(this.state, s)) return null;
    const u = SHOPS[s].unlock as { coins: number; mats?: Partial<Record<MaterialId, number>> };
    return costOf({ coins: u.coins, mats: u.mats });
  }

  /** 비용 말고 아직 지을 수 없는 이유 (회관 레벨). */
  shopLockReason(s: ShopId): string | null {
    if (shopOwned(this.state, s)) return null;
    const need = SHOPS[s].unlock.hall;
    return this.hallLevel() >= need ? null : `마을회관 Lv.${need}부터 지을 수 있어요.`;
  }

  /** 다음 레벨 비용 (없거나 최고 레벨이면 null). */
  shopUpgradeCost(s: ShopId): Cost | null {
    const lv = this.state.shops[s].level;
    if (lv < 1) return null;
    const u = (SHOPS[s].upgrade as readonly { coins: number; mats?: Partial<Record<MaterialId, number>> }[])[lv - 1];
    return u === undefined ? null : costOf(u);
  }

  upgradeShop(s: ShopId): Result {
    const st = this.state;
    const cost = this.shopUpgradeCost(s);
    if (st.shops[s].level < 1) return fail('아직 없는 가게예요.');
    if (cost === null) return fail('이미 최고 레벨이에요.');
    const why = missingReason(st, cost);
    if (why !== null) return fail(why);
    this.spend(cost, isPlaced(st, s) ? villageOf(st).art(s) : null);
    st.shops[s].level += 1;
    fitShop(st, s);
    this.emit('buildingUpgraded', { id: s, level: st.shops[s].level });
    return OK;
  }

  /** 가게를 짓는다 (보관함으로, 가게 주인이 같이 온다: SHOPS.owner). 짓기 모드 ✓·autoPlaceOnBuy면 놓는 알림은 놓을 때. */
  private buyShop(s: ShopId): Result {
    const st = this.state;
    if (shopOwned(st, s)) return fail('이미 있는 가게예요.');
    const lock = this.shopLockReason(s);
    if (lock !== null) return fail(lock);
    const cost = this.shopBuyCost(s);
    if (cost === null) return fail('이미 있는 가게예요.');
    const why = missingReason(st, cost);
    if (why !== null) return fail(why);
    this.spend(cost, null);
    this.openShopRaw(s);
    if (this.placingNow) return OK;
    const placed = this.autoPlaceOnBuy && this.autoPlace(s).ok;
    if (!placed) this.toast(`${josa(SHOPS[s].name, '을', '를')} 지었어요! 지도에 놓아 주세요.`, 'good');
    return OK;
  }

  /** 가게를 레벨 1로 열고 주인을 들인다 (비용·검사 없이: buyShop·개발용). */
  private openShopRaw(s: ShopId): void {
    const st = this.state;
    const ss = st.shops[s];
    ss.level = Math.max(1, ss.level);
    fitShop(st, s);
    if (ss.owner === null) {
      const o = SHOPS[s].owner;
      const id = st.nextId++;
      st.staff.push({ id, name: o.name, art: o.art, stats: { ...o.stats }, level: 1, post: null, shop: s });
      ss.owner = id;
      this.emit('staffChanged', {});
    }
    this.emit('buildingUpgraded', { id: s, level: ss.level });
  }

  /**
   * 진행자를 가게 주인으로 세운다 (shop = null이면 쉬게). 맡던 부스 자리·가게는 빈다. 그 가게에 다른 주인이 있으면 그 주인은 이 진행자가 맡던 가게로 (없으면 쉰다).
   */
  assignShop(staff: StaffId, shop: ShopId | null): Result {
    const st = this.state;
    const s = st.staff.find((x) => x.id === staff);
    if (s === undefined) return fail('진행자를 찾을 수 없어요.');
    const from = s.shop ?? null;
    if (shop === null) {
      if (from === null) return OK;
      if (st.shops[from].owner === s.id) st.shops[from].owner = null;
      s.shop = null;
      this.emit('staffChanged', {});
      return OK;
    }
    if (!shopOwned(st, shop)) return fail('아직 없는 가게예요.');
    const ss = st.shops[shop];
    if (ss.owner === s.id) return OK;
    if (s.post !== null) this.assignRaw(s, null);
    if (from !== null && st.shops[from].owner === s.id) st.shops[from].owner = null;
    const prev = ss.owner === null ? undefined : st.staff.find((x) => x.id === ss.owner);
    if (prev !== undefined) {
      prev.shop = from;
      if (from !== null) st.shops[from].owner = prev.id;
    }
    ss.owner = s.id;
    s.shop = shop;
    this.emit('staffChanged', {});
    return OK;
  }

  /**
   * 개발용·시험용: 손님 id를 가게 shop에 보낸다 (열린 가게, 살 것은 지갑으로 낼 수 있는 것: 남길 코인 없이). home = 떠나는 길처럼 (끝나면 집으로). 보냈으면 true.
   */
  devVisitShop(id: MonsterId, shop: ShopId, home = false): boolean {
    const m = this.monster(id);
    if (m === undefined || m.bankrupt === true || !shopIsOpen(this.state, shop) || !shopHasRoom(this.state, shop)) return false;
    const order = pickOrder(this.state, this.rng, m, shop, 0);
    if (order === null) return false;
    this.goToShop(m, shop, order, home);
    return true;
  }

  /** 개발용: 가게를 비용·회관 레벨 없이 열고 (주인 포함) 자동 배치 (near = 이 칸 가까이, 자리가 없으면 보관함에 남는다). */
  devOpenShop(s: ShopId, near?: Cell): boolean {
    if (!shopOwned(this.state, s)) this.openShopRaw(s);
    return this.autoPlace(s, true, near).ok;
  }

  // ── 촌장의 행동 ─────────────────────────────────────────────────────

  cheer(id: MonsterId): Result {
    const m = this.monster(id);
    if (m === undefined) return fail('손님을 찾을 수 없어요.');
    if (m.cheerCooldown > 0) return fail('응원은 조금 있다가 다시 할 수 있어요.');
    m.mood = clampMood(m.mood + MOOD.cheerTap);
    m.cheerCooldown = MOOD.cheerCooldownSec;
    // 일하는 채무자: 잠깐 빨라진다.
    this.boostLabor(m, LABOR.cheerMult, LABOR.cheerSec);
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
    m.ateAt = st.time;
    // 일하는 채무자: 한동안 빨라진다.
    this.boostLabor(m, LABOR.snackMult, LABOR.snackSec);
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
    const lock = this.buildingLockReason(id);
    if (lock !== null) return fail(lock);
    const why = missingReason(st, cost);
    if (why !== null) return fail(why);
    this.spend(cost, isPlaced(st, id) ? villageOf(st).art(id) : null);
    st.buildings[id].level += 1;
    const level = st.buildings[id].level;
    this.emit('buildingUpgraded', { id, level });
    // 처음에 없던 건물 (전당포·은행·일터)을 지었다: 보관함으로 (짓기 모드로 놓는다, 자동 배치면 바로).
    if (level === 1 && BUILD_HALL[id] !== undefined && !this.placingNow) {
      const placed = this.autoPlaceOnBuy && this.autoPlace(id).ok;
      this.toast(placed ? `${josa(BUILDINGS[id].name, '을', '를')} 지었어요!` : `${josa(BUILDINGS[id].name, '을', '를')} 지었어요! 지도에 놓아 주세요.`, 'good');
    }
    if (id === 'hall') this.onHallLevel(level);
    if (id === 'office') {
      fillCandidates(this.rng, st, officeCandidates(st), false);
      this.emit('staffChanged', {});
    }
    return OK;
  }

  private onHallLevel(level: number): void {
    const st = this.state;
    // 이 레벨부터 살 수 있는 땅 (먼 고리).
    if (LAND.hall.some((h, ring) => h === level && ring > 0)) this.toast('마을회관이 커져서 더 먼 땅도 살 수 있어요!', 'good');
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
    this.spend(cost, null);
    bs.unlocked = true;
    bs.level = 1;
    bs.pot = BOOTHS[booth].potSeed;
    bs.queue.length = 0;
    bs.seats.fill(null);
    bs.rounds.fill(null);
    B.fitSeats(st, booth);
    this.emit('boothUnlocked', { booth });
    // 연 부스는 보관함으로 (짓기 모드로 놓는다: 놓으면 진행자를 세운다). 자동 배치면 바로 놓는다. 짓기 모드의 ✓로 사서 놓는 중이면 놓을 때 알린다.
    if (this.placingNow) return OK;
    if (!this.autoPlaceOnBuy || !this.autoPlace(booth).ok) this.toast(`${josa(BOOTHS[booth].name, '을', '를')} 열었어요! 지도에 놓으면 손님이 와요.`, 'good');
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
  private autoAssign(booth: BoothId, say?: string[]): boolean {
    const st = this.state;
    const bs = st.booths[booth];
    B.fitSeats(st, booth);
    const roles = B.boothRoles(booth);
    const order = roles.map((r, i) => ({ r, i })).sort((a, b) => Number(a.r.optional === true) - Number(b.r.optional === true));
    const free = (i: number): boolean => (bs.staff[i] ?? null) === null;
    let changed = false;
    // say를 주면 알림을 거기에 모은다 (부르는 쪽이 한 줄로 낸다).
    const put = (s: Staff, i: number): void => {
      this.assignRaw(s, { booth, role: i });
      changed = true;
      if (say !== undefined) say.push(this.tookText(s, booth, i));
      else this.toast(this.tookText(s, booth, i), 'good');
    };
    for (const { i } of order) {
      if (!free(i)) continue;
      const s = st.staff.find((x) => suits(x, booth, i));
      if (s === undefined) continue;
      const p = s.post;
      if ((p === null && isIdle(s)) || (p !== null && p.booth !== booth && B.boothRoles(p.booth)[p.role]?.optional === true)) put(s, i);
    }
    for (const { i } of order) {
      if (!free(i)) continue;
      const idle = st.staff.filter((x) => isIdle(x) && !roles.some((_, j) => j !== i && free(j) && suits(x, booth, j)));
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
    this.spend(cost, isPlaced(st, booth) ? villageOf(st).booth(booth).base : null);
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
    // 다섯째 묶음: 가게 주인을 부스에 세우면 그 가게는 주인이 빈다 (닫힌다).
    if (to !== null && s.shop !== null && s.shop !== undefined) {
      if (st.shops[s.shop].owner === s.id) st.shops[s.shop].owner = null;
      s.shop = null;
    }
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
      if (s.shop !== null && s.shop !== undefined) return this.assignShop(staff, null);
      if (s.post === null) return OK;
      this.assignRaw(s, null);
      this.emit('staffChanged', {});
      return OK;
    }
    if (!st.booths[booth].unlocked) return fail('아직 열리지 않은 부스예요.');
    if (!isPlaced(st, booth)) return fail('보관함에 있는 부스예요. 먼저 지도에 놓아요.');
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
    if (r.hall > this.hallLevel()) return fail(`마을회관 Lv.${r.hall}부터 만들 수 있어요.`);
    if (st.crafting.length >= workshopSlots(st)) return fail('공방 자리가 꽉 찼어요.');
    const cost: Cost = { coins: r.coins, mats: r.mats };
    const why = missingReason(st, cost);
    if (why !== null) return fail(why);
    this.spend(cost, isPlaced(st, 'workshop') ? villageOf(st).art('workshop') : null);
    st.crafting.push({ out: r.out, left: r.sec, total: r.sec });
    return OK;
  }

  // ── 배치형 마을 (DESIGN 6.1): 사기·놓기·옮기기·보관하기·길·땅 ───────────────────
  // 부스·건물은 가지면 (열기 unlockBooth·짓기 upgradeBuilding, buy) 보관함으로 가고, place로 지도에 놓는다 (가지지 않았으면 place가 먼저 사서 놓는다).
  // 장식은 사면 (buy) 보관함 개수가 늘고 place가 하나씩 놓는다. 놓인 것 옮기기 move (안의 손님도 같이 옮겨진다),
  // 보관하기 store (안의 손님은 다른 걸 하러 가고, 부스 진행자는 쉰다, 모이거나 하던 판은 접고 건 코인을 돌려준다).
  // 길: paintRoad·eraseRoad (가진 땅의 빈 칸, 지우면 걷던 손님은 길을 다시 찾는다). 땅: buyChunk (가진 땅에 이웃한 조각, village.ts chunkInfo).

  /** 칸 지도·이어짐·세계 좌표 모양 (sim/village.ts Village, 매 틱 같은 객체일 수도 아닐 수도: 쥐고 있지 말 것). */
  village(): Village {
    return villageOf(this.state);
  }

  /** 가진 수 (부스·건물 0·1, 장식 = 놓인 것 + 보관함). */
  owned(key: CatalogKey): number {
    const st = this.state;
    switch (catalogKind(key)) {
      case 'booth':
        return st.booths[key as BoothId].unlocked ? 1 : 0;
      case 'building':
        return isBuilt(st, key as BuildingId) ? 1 : 0;
      case 'shop':
        return shopOwned(st, key as ShopId) ? 1 : 0;
      default:
        return (st.village.decor[key as DecorId] ?? 0) + st.village.placed.filter((p) => p.key === key).length;
    }
  }

  /** 보관함에 있는 수 (가졌는데 놓지 않은 것). */
  stored(key: CatalogKey): number {
    if (catalogKind(key) === 'decor') return this.state.village.decor[key as DecorId] ?? 0;
    return this.owned(key) > 0 && !isPlaced(this.state, key) ? 1 : 0;
  }

  /** 보관함 (부스 → 건물 → 장식 차례). */
  storage(): StorageItem[] {
    const out: StorageItem[] = [];
    for (const key of CATALOG_KEYS) {
      const n = this.stored(key);
      if (n > 0) out.push({ key, count: n });
    }
    return out;
  }

  /** 사는 비용 (부스 = 열기, 처음엔 없는 건물 = 짓기, 장식 = 값). 이미 가진 부스·건물은 null. */
  buyCost(key: CatalogKey): Cost | null {
    switch (catalogKind(key)) {
      case 'booth':
        return this.boothUnlockCost(key as BoothId);
      case 'building': {
        const id = key as BuildingId;
        return isBuilt(this.state, id) ? null : nextBuildingCost(this.state, id);
      }
      case 'shop':
        return this.shopBuyCost(key as ShopId);
      default:
        return { coins: DECOR[key as DecorId].cost };
    }
  }

  /** 비용 말고 아직 살 수 없는 이유 (마을회관 레벨). 살 수 있으면 null. */
  buyLockReason(key: CatalogKey): string | null {
    switch (catalogKind(key)) {
      case 'booth':
        return this.boothLockReason(key as BoothId);
      case 'building':
        return this.buildingLockReason(key as BuildingId);
      case 'shop':
        return this.shopLockReason(key as ShopId);
      default:
        return null;
    }
  }

  /** 짓기 목록 한 줄씩 (부스 → 건물 → 장식). */
  catalog(): CatalogEntry[] {
    return CATALOG_KEYS.map((key) => {
      const fp = footprint(key);
      return {
        key,
        kind: catalogKind(key),
        owned: this.owned(key),
        stored: this.stored(key),
        placed: catalogKind(key) === 'decor' ? this.state.village.placed.filter((p) => p.key === key).length : isPlaced(this.state, key) ? 1 : 0,
        cost: this.buyCost(key),
        lock: this.buyLockReason(key),
        w: fp.w,
        h: fp.h,
        needsRoad: fp.entry !== undefined,
        fixed: fp.fixed === true,
        storable: storable(key),
      };
    });
  }

  /** key를 칸 cell(왼쪽 위)에 놓을 수 있나 (moving = 옮기는 중인 자기 id). 미리보기 칠하기용 bad 칸, 입구가 길에 닿았나. */
  canPlace(key: CatalogKey, cell: Cell, moving = 0): PlaceCheck {
    return checkPlace(this.state, key, cell.x, cell.y, moving);
  }

  /** 사서 보관함에 (부스 열기·건물 짓기·장식 사기). autoPlaceOnBuy면 부스·건물은 바로 놓는다. */
  buy(key: CatalogKey): Result {
    const st = this.state;
    switch (catalogKind(key)) {
      case 'booth':
        return this.unlockBooth(key as BoothId);
      case 'building': {
        const id = key as BuildingId;
        if (isBuilt(st, id)) return fail('이미 있는 건물이에요.');
        return this.upgradeBuilding(id);
      }
      case 'shop':
        return this.buyShop(key as ShopId);
      default: {
        const k = key as DecorId;
        const cost: Cost = { coins: DECOR[k].cost };
        const why = missingReason(st, cost);
        if (why !== null) return fail(why);
        this.spend(cost, null);
        st.village.decor[k] = (st.village.decor[k] ?? 0) + 1;
        return OK;
      }
    }
  }

  /** 지도에 놓는다 (보관함에서, 없으면 먼저 산다). 부스는 놓으면 진행자를 세운다. */
  place(key: CatalogKey, cell: Cell): Result {
    const st = this.state;
    if (catalogKind(key) !== 'decor' && isPlaced(st, key)) return fail('이미 지도에 있어요. 옮기기로 자리를 바꿔요.');
    const chk = checkPlace(st, key, cell.x, cell.y);
    if (!chk.ok) return fail(chk.reason ?? '여기에는 놓을 수 없어요.');
    let fresh = false;
    if (this.stored(key) <= 0) {
      const auto = this.autoPlaceOnBuy;
      this.autoPlaceOnBuy = false;
      // 사는 순간의 알림('…을 열었어요! 지도에 놓으면 …')은 내지 않는다: 바로 놓으니 placeRaw가 한 줄로 알린다.
      this.placingNow = true;
      const r = this.buy(key);
      this.placingNow = false;
      this.autoPlaceOnBuy = auto;
      if (!r.ok) return r;
      // 부스·건물을 사는 동안 (드물게) 다른 데 놓였으면 그대로.
      if (catalogKind(key) !== 'decor' && isPlaced(st, key)) return OK;
      fresh = catalogKind(key) !== 'decor';
    }
    this.placeRaw(key, cell.x, cell.y, fresh);
    return OK;
  }

  /**
   * 놓기 (검사는 먼저). 장식은 보관함에서 하나 뺀다. 부스는 진행자를 세운다.
   * 알림은 한 줄로 (fresh = 막 열거나 지었다: '…을 열었어요!'를 앞에): 길이 이어지지 않았으면 길 먼저, 아니면 비어 있는 진행자 자리, 아니면 맡은 진행자.
   */
  private placeRaw(key: CatalogKey, x: number, y: number, fresh = false): void {
    const st = this.state;
    const kind = catalogKind(key);
    if (kind === 'decor') {
      const k = key as DecorId;
      st.village.decor[k] = Math.max(0, (st.village.decor[k] ?? 0) - 1);
    }
    addPlaced(st, key, x, y);
    this.emit('villageChanged', { what: 'place', key });
    const name = catalogName(key);
    const head = fresh ? `${josa(name, '을', '를')} ${kind === 'booth' ? '열었어요' : '지었어요'}! ` : '';
    const took: string[] = [];
    let staffed = true;
    if (kind === 'booth') {
      const b = key as BoothId;
      B.fitSeats(st, b);
      staffed = this.autoAssign(b, took);
    }
    if (kind !== 'decor' && footprint(key).entry !== undefined && !villageOf(st).connected(key)) {
      const who = fresh ? '' : `${name} `;
      this.toast(`${head}${who}입구 앞에 길을 이어 주세요. 길이 없으면 손님이 못 와요.`, 'warn');
    } else if (!staffed) {
      this.toast(`${head}${this.closedText(key as BoothId)}`, 'info');
    } else if (head !== '' || took.length > 0) {
      this.toast(`${head}${took.join(' ')}`.trim(), 'good');
    }
  }

  /** 놓인 것(id)을 칸 cell로 옮긴다. 안에 있던 손님(자리·줄·계산대·일터)도 같이 옮겨지고, 오던 손님은 새 자리로 길을 다시 찾는다. */
  move(id: number, cell: Cell): Result {
    const st = this.state;
    const p = st.village.placed.find((q) => q.id === id);
    if (p === undefined) return fail('찾을 수 없어요.');
    if (footprint(p.key).fixed === true) return fail('마을 입구는 옮길 수 없어요.');
    if (p.x === cell.x && p.y === cell.y) return OK;
    const chk = checkPlace(st, p.key, cell.x, cell.y, id);
    if (!chk.ok) return fail(chk.reason ?? '여기에는 옮길 수 없어요.');
    const fp = footprint(p.key);
    const x0 = p.x * CELL;
    const y0 = p.y * CELL;
    const inside = (pt: Pt): boolean => pt.x >= x0 && pt.x < x0 + fp.w * CELL && pt.y >= y0 && pt.y < y0 + fp.h * CELL;
    const dx = (cell.x - p.x) * CELL;
    const dy = (cell.y - p.y) * CELL;
    const shift = (pt: Pt): Pt => (inside(pt) ? { x: pt.x + dx, y: pt.y + dy } : { x: pt.x, y: pt.y });
    const reroute: { m: Monster; to: Pt; via: CatalogKey | null }[] = [];
    for (const m of st.monsters) {
      // 가는 곳 = 적어 둔 목적지 (길이 끊겨 덜 걷는 길이면 길의 끝은 건물 밖이다), 없으면 길의 끝.
      const last = m.path[m.path.length - 1];
      const d = m.dest ?? null;
      const was = inside(m.pos);
      if (was) m.pos = shift(m.pos);
      const tgt = d !== null && inside(d) ? d : last !== undefined && inside(last) ? last : null;
      if (tgt !== null) reroute.push({ m, to: shift(tgt), via: p.key });
      else if (was && last !== undefined) reroute.push({ m, to: d ?? last, via: d?.via ?? null });
    }
    movePlaced(st, id, cell.x, cell.y);
    for (const r of reroute) this.go(r.m, r.to, r.via);
    this.emit('villageChanged', { what: 'place', key: p.key });
    return OK;
  }

  /** 놓인 것(id)을 보관함으로. 안의 손님은 다른 걸 하러 가고, 부스 진행자는 쉰다. 마을 입구는 보관할 수 없다. */
  store(id: number): Result {
    const st = this.state;
    const p = st.village.placed.find((q) => q.id === id);
    if (p === undefined) return fail('찾을 수 없어요.');
    if (footprint(p.key).fixed === true) return fail('마을 입구는 보관할 수 없어요.');
    if (!storable(p.key)) return fail(`${josa(catalogName(p.key), '은', '는')} 보관할 수 없어요. 옮기기로 자리를 바꿔요.`);
    const key = p.key;
    const kind = catalogKind(key);
    const fp = footprint(key);
    const x0 = p.x * CELL;
    const y0 = p.y * CELL;
    const inside = (pt: Pt): boolean => pt.x >= x0 && pt.x < x0 + fp.w * CELL && pt.y >= y0 && pt.y < y0 + fp.h * CELL;
    removePlaced(st, id);
    if (kind === 'decor') st.village.decor[key as DecorId] = (st.village.decor[key as DecorId] ?? 0) + 1;
    const out: Monster[] = [];
    if (kind === 'booth') {
      const b = key as BoothId;
      const bs = st.booths[b];
      // 모이던·하던 판은 접고 건 코인을 돌려준다 (빚 걸기 판의 채무자는 일터로). 결과가 난 판(done)은 이미 나눴으니 그대로 치운다.
      const g = this.groupOf(b);
      if (g !== null && (g.g.phase === 'gathering' || g.g.phase === 'running')) this.cancelGroup(g.booth, g.g, 'stored');
      else if (g !== null && g.g.phase === 'done') this.resetGroup(g.g);
      // 보통 부스: 하던 한판은 접고 건 코인을 돌려준다.
      if (bs.group === null) this.refundRounds(b);
      for (const m of st.monsters) if (m.booth === b) out.push(m);
      // 진행자는 쉰다.
      let moved = false;
      bs.staff.forEach((sid, i) => {
        if (sid === null) return;
        const s = st.staff.find((x) => x.id === sid);
        if (s !== undefined) s.post = null;
        bs.staff[i] = null;
        moved = true;
      });
      if (moved) this.emit('staffChanged', {});
    } else if (key === 'pawnshop' || key === 'bank') {
      for (const m of st.monsters) {
        if (m.errand === null || m.errand === undefined || errandShop(m.errand) !== key) continue;
        m.errand = null;
        delete m.counter;
        out.push(m);
      }
    } else if (key === 'fountain') {
      for (const m of st.monsters) if (m.phase === 'resting') out.push(m);
    } else if (kind === 'shop') {
      this.storeShop(key as ShopId, out);
    }
    for (const m of st.monsters) {
      if (out.includes(m)) continue;
      const d = m.dest ?? null;
      if (inside(m.pos) || (m.path.length > 0 && inside(m.path[m.path.length - 1] as Pt)) || (d !== null && inside(d))) out.push(m);
    }
    for (const m of out) {
      if (!st.monsters.includes(m)) continue;
      if (m.bankrupt === true) this.goWork(m);
      else if (m.phase === 'leaving') this.go(m, villageOf(st).gateSpawn(), 'gate');
      else this.decideSoon(m);
    }
    this.emit('villageChanged', { what: 'place', key });
    return OK;
  }

  /** 길 칸을 깐다 (가진 땅의 빈 칸만, 나머지는 건너뛴다). 그래서 마을 입구와 이어진 건물이 생기면 알린다. */
  paintRoad(cells: readonly Cell[]): Result {
    const st = this.state;
    const before = villageOf(st);
    const cut = st.village.placed.filter((p) => catalogKind(p.key) !== 'decor' && footprint(p.key).entry !== undefined && !before.linkedId(p.id)).map((p) => p.key);
    const n = setRoads(st, cells, true);
    if (n === 0) return fail('길을 깔 수 있는 칸이 없어요.');
    this.emit('villageChanged', { what: 'road' });
    const after = villageOf(st);
    const joined = cut.filter((k) => after.connected(k));
    if (joined.length > 0) {
      const names = joined.map((k) => catalogName(k)).join(', ');
      const idle = joined.some((k) => catalogKind(k) === 'booth' && !B.boothStaffed(st, k as BoothId));
      this.toast(`${names}에 길이 이어졌어요! ${idle ? '진행자를 세우면 손님이 와요.' : '이제 손님이 와요.'}`, 'good');
    }
    return OK;
  }

  /** 길 칸을 지운다. 걷던 손님은 길을 다시 찾는다. */
  eraseRoad(cells: readonly Cell[]): Result {
    const st = this.state;
    // 마을 입구 앞 길 칸은 지우지 않는다 (손님이 들어오고 나가는 길: 마을 입구처럼 고정).
    const g = villageOf(st).placed('gate');
    const ge = g === undefined ? -1 : villageOf(st).entryCellIndex(g);
    const list = cells.filter((c) => cellIndex(c.x, c.y) !== ge);
    if (list.length === 0 && cells.length > 0 && ge >= 0) return fail('마을 입구 앞 길은 지울 수 없어요.');
    const n = setRoads(st, list, false);
    if (n === 0) return fail('지울 길이 없어요.');
    for (const m of st.monsters) {
      const last = m.path[m.path.length - 1];
      if (last === undefined) continue;
      const d = m.dest;
      this.go(m, d ?? last, d?.via ?? null);
    }
    this.emit('villageChanged', { what: 'road' });
    return OK;
  }

  /** 땅 조각 하나의 상태 (가졌나·이웃·고리·회관 레벨·값). */
  chunk(index: number): ChunkInfo {
    return chunkInfo(this.state, index);
  }

  /** 비용 말고 그 땅을 살 수 없는 이유 (살 수 있으면 null). */
  chunkLockReason(index: number): string | null {
    const info = chunkInfo(this.state, index);
    if (info.owned) return '이미 가진 땅이에요.';
    if (!info.adjacent) return '가진 땅에 붙은 땅만 살 수 있어요.';
    if (this.hallLevel() < info.hall) return `마을회관 Lv.${info.hall}부터 살 수 있어요.`;
    return null;
  }

  /** 땅 조각을 산다 (구름이 걷힌다). */
  buyChunk(index: number): Result {
    const st = this.state;
    if (!Number.isInteger(index) || index < 0 || index >= CHUNKS.w * CHUNKS.h) return fail('없는 땅이에요.');
    const lock = this.chunkLockReason(index);
    if (lock !== null) return fail(lock);
    const info = chunkInfo(st, index);
    const cost: Cost = { coins: info.price };
    const why = missingReason(st, cost);
    if (why !== null) return fail(why);
    this.spend(cost, null);
    addChunk(st, index);
    this.emit('landBought', { chunk: index });
    this.emit('villageChanged', { what: 'land' });
    this.toast('땅을 넓혔어요! 새 땅에 건물을 놓을 수 있어요.', 'good');
    return OK;
  }

  /**
   * 보관함의 key를 알맞은 자리에 길까지 이어 놓는다 (village.ts findSpot: 이어 줄 길이 짧고 마을 입구에 가까운 곳). 자리가 없으면 실패 (땅을 넓혀야).
   * 옛 저장 옮기기·sim-check 촌장·개발용 ?all=1이 쓴다 (autoPlaceOnBuy면 열기·짓기가 부른다).
   */
  autoPlace(key: CatalogKey, spread = false, near?: Cell): Result {
    const st = this.state;
    if (catalogKind(key) !== 'decor' && isPlaced(st, key)) return OK;
    if (this.stored(key) <= 0) return fail('보관함에 없어요.');
    const spot = findSpot(st, key, DEFAULT_LOTS[key as BoothId], spread, near);
    if (spot === null) return fail('놓을 자리가 없어요. 땅을 넓혀요.');
    if (spot.road.length > 0 && setRoads(st, spot.road, true) > 0) this.emit('villageChanged', { what: 'road' });
    this.placeRaw(key, spot.x, spot.y);
    return OK;
  }

  /** 불러온 저장에 보관함의 부스·건물이 있으면 알린다 (옛 저장을 옮기다 자리를 못 잡은 것: main.ts가 UI를 만든 뒤 부른다). */
  announceStorage(): void {
    const left = this.storage().filter((x) => catalogKind(x.key) !== 'decor');
    if (left.length > 0) this.toast(`보관함에 아직 놓지 않은 건물이 있어요: ${left.map((x) => catalogName(x.key)).join(', ')}. 짓기 탭에서 지도에 놓아요.`, 'info');
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
