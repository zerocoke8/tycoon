// 새 게임과 저장 (localStorage 'mpv-save-v1'). Node(scripts/sim-check.ts)에서는 localStorage가 없으니 조용히 넘어간다.

import { Rng } from '../core/rng.ts';
import { catalogKind, footprint, type CatalogKey } from '../data/catalog.ts';
import { BOOTHS, BOOTH_IDS, BUILD_HALL, BUILDINGS, DEBT_MATCH, GOODS, HOST_PRESETS, isGroupBooth, LAND, MATERIALS, PRECIOUS, SIM, type BoothId, type BuildingId, type GoodId, type MaterialId, type PreciousId } from '../data/defs.ts';
import { CHUNK, CHUNKS, DEFAULT_LOTS, LAND_START, chunkIndex, chunkRing } from '../data/map.ts';
import { byLevel } from './economy.ts';
import { createMonster } from './monsters.ts';
import { gateDistance, roadPoint } from './path.ts';
import { idleGroup } from './group/core.ts';
import { raceOutcome } from './race.ts';
import { presetCandidates } from './staff.ts';
import { TUNE } from './tuning.ts';
import type { BoothState, GameState, RaceResult, RacerIndex, Staff, StaffId } from './types.ts';
import { addChunk, addPlaced, defaultVillage, findSpot, setRoads, startChunks, villageOf } from './village.ts';

export const SAVE_KEY = 'mpv-save-v1';
/**
 * 2: 진행자 자리(BoothState.staff, Staff.post), 손님 재료(Monster.mats), 경주장. 3: 단체 놀이 엔진 (BoothState.race → group).
 * 4: 넷째 묶음 (손님 장신구·맡긴 장신구·빚, 전당포 컬렉션, 전당포·은행·일터 건물). 5: 배치형 마을 (GameState.village, 구역 districts는 없앰).
 * 2·3·4는 이어서 읽는다 (migrate2 → migrate3 → migrate4), 그보다 옛 저장은 새로 시작.
 */
export const SAVE_VERSION = 5;

/** 처음부터 열린 부스와 그 진행자. */
const START_BOOTHS: readonly BoothId[] = ['slot', 'oddeven'];

function zeros<K extends string>(keys: readonly K[]): Record<K, number> {
  const r = {} as Record<K, number>;
  for (const k of keys) r[k] = 0;
  return r;
}

/** 새 부스 상태. host = 0번 자리 진행자 (없으면 null). */
function newBooth(b: BoothId, unlocked: boolean, host: StaffId | null): BoothState {
  const seats = byLevel(BOOTHS[b].seats, 1);
  const staff: (StaffId | null)[] = BOOTHS[b].roles.map(() => null);
  staff[0] = host;
  return {
    unlocked,
    level: 1,
    pot: BOOTHS[b].potSeed,
    staff,
    seats: Array.from({ length: seats }, () => null),
    queue: [],
    rounds: Array.from({ length: seats }, () => null),
    cheer: null,
    group: isGroupBooth(b) ? idleGroup() : null,
  };
}

/** 새 게임. seed를 주면 같은 게임이 다시 나온다. */
export function newGame(seed?: number): GameState {
  const s = seed ?? ((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
  const rng = new Rng(s | 0);
  let nextId = 1;
  const staff: Staff[] = [];
  const hostOf = new Map<BoothId, number>();
  for (const b of START_BOOTHS) {
    const p = HOST_PRESETS.find((h) => h.booth === b);
    if (p === undefined) continue;
    const id = nextId++;
    staff.push({ id, name: p.name, art: p.art, stats: { ...p.stats }, level: 1, post: { booth: b, role: 0 } });
    hostOf.set(b, id);
  }
  const booths = {} as Record<BoothId, BoothState>;
  for (const b of BOOTH_IDS) booths[b] = newBooth(b, START_BOOTHS.includes(b), hostOf.get(b) ?? null);
  const buildings = {} as Record<BuildingId, { level: number }>;
  // 처음에 없는 건물 (전당포·은행·일터)은 레벨 0 = 아직 없다 (지으면 보관함으로, 놓으면 손님이 온다).
  for (const id of Object.keys(BUILDINGS) as BuildingId[]) buildings[id] = { level: BUILD_HALL[id] !== undefined ? 0 : 1 };
  const state: GameState = {
    version: SAVE_VERSION,
    time: 0,
    rng: rng.state,
    nextId,
    coins: SIM.startCoins,
    materials: zeros(Object.keys(MATERIALS) as MaterialId[]),
    precious: zeros(Object.keys(PRECIOUS) as PreciousId[]),
    goods: zeros(Object.keys(GOODS) as GoodId[]),
    buildings,
    booths,
    staff,
    candidates: presetCandidates(1, staff.map((x) => x.art)),
    candidateRefresh: TUNE.candidateRefreshSec,
    monsters: [],
    spawnTimer: TUNE.firstSpawnSec,
    crafting: [],
    dex: {},
    totals: { visitors: 0, rounds: 0, jackpots: 0, coinsEarned: 0 },
    village: defaultVillage(),
    savedAt: 0,
    regulars: [],
    pawnCollection: {},
    debtTotals: { pawned: 0, redeemed: 0, forfeited: 0, loans: 0, repaid: 0, bankrupt: 0, relieved: 0, forgiven: 0, matches: 0, laborMats: 0, laborBy: { farm: 0, mine: 0 } },
    debtMatchAt: {},
    debtCheck: DEBT_MATCH.checkSec,
  };
  addOpeningGuests(state, rng);
  state.rng = rng.state;
  return state;
}

/** 새 게임을 열면 손님 몇이 이미 광장 둘레 길을 걷고 있다 (첫 한판까지 기다리지 않게): 분수 입구에서 가까운 길 칸 TUNE.openingNodes개 가운데. */
function addOpeningGuests(state: GameState, rng: Rng): void {
  const v = villageOf(state);
  const fe = v.placed('fountain');
  const ei = fe === undefined ? -1 : v.entryCellIndex(fe);
  const field = ei >= 0 && v.isWalkable(ei) ? v.fieldTo(ei) : null;
  const near = v.walkable
    .filter((c) => gateDistance(state, c) > 2)
    .map((c) => ({ c, d: field?.[c] ?? 0 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, TUNE.openingNodes)
    .map((x) => x.c);
  if (near.length === 0) return;
  for (let i = 0; i < TUNE.openingGuests; i++) {
    const p = roadPoint(rng.pick(near), rng.next(), rng.next(), 28);
    const m = createMonster(rng, state, state.nextId++, p, null);
    m.phase = 'wandering';
    m.timer = rng.range(0.5, 2.5);
    state.monsters.push(m);
    state.totals.visitors += 1;
    const d = (state.dex[m.species] ??= { visits: 0, reactions: [] });
    d.visits += 1;
  }
}

function storage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 이름을 바꾼 그림 있는 진행자: 옛 이름 → 새 이름 (셋째 묶음, 그림 설명과 맞춤). */
const RENAMED_PRESETS: Readonly<Record<string, string>> = {
  '부채 심판': '홍청 깃발 심판',
  '구수한 할머니': '마이크 할머니',
  '꽥꽥 누나': '세일러 꼬마',
  '방패연 장인': '얼레 할머니',
  '바람 소녀': '바람개비 꼬마',
  '호루라기 아저씨': '호루라기 청년',
};

/**
 * 읽은 저장을 지금 데이터에 맞춘다 (새로 생긴 재료·부스·건물 칸을 채운다). 모양이 크게 다르면 null.
 * 새 칸은 newGame의 값으로.
 */
export function normalizeState(raw: unknown): GameState | null {
  if (isObj(raw) && raw.version === 2) migrate2(raw);
  if (isObj(raw) && raw.version === 3) migrate3(raw);
  if (isObj(raw) && raw.version === 4) migrate4(raw);
  if (!isObj(raw) || raw.version !== SAVE_VERSION) return null;
  if (typeof raw.coins !== 'number' || !Number.isFinite(raw.coins)) return null;
  if (!Array.isArray(raw.monsters) || !Array.isArray(raw.staff) || !isObj(raw.booths) || !isObj(raw.buildings)) return null;
  const base = newGame(typeof raw.rng === 'number' ? raw.rng : 1) as unknown as Record<string, unknown>;
  const st = raw as Record<string, unknown>;
  for (const [k, v] of Object.entries(base)) if (!(k in st)) st[k] = v;
  for (const key of ['materials', 'precious', 'goods', 'buildings', 'booths', 'debtTotals', 'village'] as const) {
    const have = st[key];
    const def = base[key];
    if (!isObj(have) || !isObj(def)) return null;
    for (const [k, v] of Object.entries(def)) if (!(k in have)) have[k] = v;
  }
  // 부스마다 단체 놀이 칸 (새로 생긴 단체 놀이 부스·옛 저장).
  for (const b of BOOTH_IDS) {
    const bs = (st.booths as Record<string, unknown>)[b];
    if (!isObj(bs)) return null;
    if (!('group' in bs) || (isGroupBooth(b) && bs.group === null)) bs.group = isGroupBooth(b) ? idleGroup() : null;
  }
  // 새로 생긴 그림 있는 진행자 (옛 저장의 회관 레벨에서 이미 열 수 있는 부스의 진행자: 씨름장·오리배·연날리기)를 고용 후보로.
  const state = st as unknown as GameState;
  // 이름을 바꾼 그림 있는 진행자 (그림 설명과 맞춤): 옛 이름이면 새 이름으로 (presetPost는 그림과 이름이 같아야 자기 자리를 안다).
  for (const who of [...state.staff, ...state.candidates]) {
    const p = HOST_PRESETS.find((h) => h.art === who.art);
    if (p !== undefined && RENAMED_PRESETS[who.name] === p.name) who.name = p.name;
  }
  const hall = state.buildings.hall?.level ?? 1;
  const fresh = presetCandidates(hall, [...state.staff.map((x) => x.art), ...state.candidates.map((c) => c.art)]);
  if (fresh.length > 0) state.candidates.push(...fresh);
  return state;
}

/**
 * 저장 2 → 3: 경주장 BoothState.race(RaceState)를 단체 놀이 BoothState.group(GroupState)으로 옮긴다 (마을은 그대로 이어진다).
 * 참가자 racer → pick (role 'bettor'), result → play (kind 'race'), leader·cheerAt → mark·markAt.
 */
function migrate2(raw: Record<string, unknown>): void {
  const booths = raw.booths;
  if (isObj(booths)) {
    for (const bs of Object.values(booths)) {
      if (!isObj(bs) || !('race' in bs)) continue;
      const race = bs.race;
      delete bs.race;
      if (!isObj(race)) {
        bs.group = null;
        continue;
      }
      const parts = Array.isArray(race.participants) ? (race.participants as Record<string, unknown>[]) : [];
      const participants = parts.map((e) => ({ monster: e.monster, seat: e.seat, pick: e.racer, role: 'bettor', bet: e.bet, fee: e.fee }));
      const result = isObj(race.result) ? (race.result as unknown as RaceResult) : null;
      const play = result === null ? null : { kind: 'race', race: result, end: race.duration, tracks: result.keys, events: [], outcomes: parts.map((e) => raceOutcome(result, e.racer as RacerIndex)) };
      const g: Record<string, unknown> = { phase: race.phase, countdown: race.countdown, elapsed: race.elapsed, duration: race.duration, participants, play };
      if ('leader' in race) g.mark = race.leader;
      if ('cheerAt' in race) g.markAt = race.cheerAt;
      bs.group = g;
    }
  }
  raw.version = 3;
}

/**
 * 저장 3 → 4 (넷째 묶음): 손님마다 장신구(없음)·맡긴 장신구·빚 칸. 새 건물(빈 부지)·전당포 컬렉션·누적 기록은 normalizeState가 newGame 값으로 채운다.
 */
function migrate3(raw: Record<string, unknown>): void {
  if (Array.isArray(raw.monsters)) {
    for (const m of raw.monsters) {
      if (!isObj(m)) continue;
      if (!Array.isArray(m.accessories)) m.accessories = [];
      if (!Array.isArray(m.pawned)) m.pawned = [];
      if (typeof m.debt !== 'number') m.debt = 0;
    }
  }
  raw.version = 4;
}

/**
 * 저장 4 → 5 (배치형 마을, DESIGN 6.1): 고정 지도·구역(districts)을 없애고 처음 마을(map.ts DEFAULT_*)에서 시작해,
 * 가진 부스·건물(열림·지음)을 큰 것부터 자동 배치한다 (village.ts findSpot, 길까지 잇는다). 자리가 없으면 그 회관 레벨로 살 수 있는 땅 가운데
 * 한 조각으로 놓이는 땅을 (없으면 가까운 고리부터) 한 조각씩 공짜로 더 주고, 다 놓은 뒤 비어 남은 조각은 돌려놓는다
 * (놓을 만큼만: 빈 풀밭이 넓게 남지 않게, 그 뒤 땅 넓히기는 성장 단계 그대로. 옛 저장은 땅값을 낸 적이 없어 돌려줄 코인은 없다).
 * 그래도 자리를 못 잡은 것은 보관함에 남는다 (Sim.announceStorage가 알린다). 해금·레벨·진행자·도감·컬렉션은 그대로.
 * 손님은 옛 자리가 새 지도에 없으니 모두 마을 입구 둘레에서 다시 고르게 (자리·줄·볼일을 비우고, 모이거나 하던 판·한판은 건 코인을 돌려주고 접는다:
 * 결과가 난 단체 놀이(done)는 이미 나눴으니 그대로 접는다). 보관함에 남은 부스의 진행자는 쉰다.
 */
function migrate4(raw: Record<string, unknown>): void {
  // 이미 마을 칸이 있는 저장 (배치형 마을에서 만든 저장의 옛 모양을 시험으로 흉내 낸 것): 마을은 그대로.
  if (isObj(raw.village) && Array.isArray(raw.village.placed)) {
    delete raw.districts;
    raw.version = 5;
    return;
  }
  const booths = isObj(raw.booths) ? raw.booths : {};
  const buildings = isObj(raw.buildings) ? raw.buildings : {};
  const lv = (v: unknown): number => (isObj(v) && typeof v.level === 'number' ? v.level : 0);
  const hall = Math.max(1, lv(buildings.hall));
  const owned = (key: CatalogKey): boolean => {
    const kind = catalogKind(key);
    if (kind === 'booth') return isObj(booths[key]) && (booths[key] as Record<string, unknown>).unlocked === true;
    if (kind === 'building') return lv(buildings[key]) >= 1;
    return true;
  };
  delete raw.districts;
  const village = defaultVillage();
  village.placed = village.placed.filter((p) => owned(p.key));
  raw.village = village;
  const st = raw as unknown as GameState;
  // 이 회관 레벨로 살 수 있는 땅 (옛 구역이 열려 있던 만큼).
  const allowed = (i: number): boolean => (LAND.hall[Math.min(chunkRing(i % CHUNKS.w, Math.floor(i / CHUNKS.w)), LAND.hall.length - 1)] ?? 5) <= hall;
  const L = LAND_START;
  const mid = { x: L.x + L.w / 2 - 0.5, y: L.y + L.h / 2 - 0.5 };
  const start = new Set(startChunks());
  const touches = (cx: number, cy: number): boolean => [chunkIndex(cx + 1, cy), chunkIndex(cx - 1, cy), chunkIndex(cx, cy + 1), chunkIndex(cx, cy - 1)].some((n) => n >= 0 && village.chunks.includes(n));
  /** 공짜로 줄 수 있는 땅: 가진 땅에 붙고 살 수 있는 조각, 고리가 가깝고 처음 땅 가운데에 가까운 차례. */
  const candidates = (): number[] => {
    const out: { i: number; sc: number }[] = [];
    for (let i = 0; i < CHUNKS.w * CHUNKS.h; i++) {
      if (village.chunks.includes(i) || !allowed(i)) continue;
      const cx = i % CHUNKS.w;
      const cy = Math.floor(i / CHUNKS.w);
      if (touches(cx, cy)) out.push({ i, sc: chunkRing(cx, cy) * 100 + Math.hypot(cx - mid.x, cy - mid.y) });
    }
    return out.sort((a, b) => a.sc - b.sc).map((c) => c.i);
  };
  const dropChunk = (i: number): void => {
    village.chunks = village.chunks.filter((c) => c !== i);
    village.rev.land += 1;
  };
  // 가진 것 가운데 놓이지 않은 것: 큰 시설부터 (작은 부스가 먼저 자리를 흩어 놓지 않게).
  const todo = ([...BOOTH_IDS, 'pawnshop', 'bank', 'workyard'] as CatalogKey[])
    .filter((k) => owned(k) && !village.placed.some((p) => p.key === k))
    .sort((a, b) => {
      const fa = footprint(a);
      const fb = footprint(b);
      return fb.w * fb.h - fa.w * fa.h;
    });
  for (const key of todo) {
    const lot = DEFAULT_LOTS[key as BoothId];
    let spot = findSpot(st, key, lot, true);
    // 자리가 없으면 땅을 한 조각씩 더: 그 한 조각으로 놓이는 땅이 있으면 그것 (가까운 차례), 없으면 가장 가까운 땅을 주고 다시.
    while (spot === null) {
      const list = candidates();
      if (list.length === 0) break;
      let got = -1;
      for (const c of list) {
        addChunk(st, c);
        spot = findSpot(st, key, lot, true);
        if (spot !== null) {
          got = c;
          break;
        }
        dropChunk(c);
      }
      if (got < 0) addChunk(st, list[0] as number);
    }
    if (spot === null) continue;
    setRoads(st, spot.road, true);
    addPlaced(st, key, spot.x, spot.y);
  }
  // 놓다 남은 빈 땅 (건물·길이 하나도 없는 조각)은 돌려놓는다 (처음 땅은 그대로): 빈 풀밭이 넓게 남지 않게.
  {
    const v = villageOf(st);
    const used = (ci: number): boolean => {
      const x0 = (ci % CHUNKS.w) * CHUNK;
      const y0 = Math.floor(ci / CHUNKS.w) * CHUNK;
      for (let y = y0; y < y0 + CHUNK; y++) for (let x = x0; x < x0 + CHUNK; x++) if (v.at(x, y) !== undefined || v.isRoad(x, y)) return true;
      return false;
    };
    const keep = village.chunks.filter((ci) => start.has(ci) || used(ci));
    // 남는 땅이 처음 땅과 이어지게 (떨어진 조각은 빈 조각을 다리로 남긴다): 처음 땅에서 번져 닿는 조각만 쓰고, 못 닿으면 다 남긴다.
    const set = new Set(keep);
    const seen = new Set<number>();
    const q = [...start].filter((c) => set.has(c));
    for (const c of q) seen.add(c);
    for (let k = 0; k < q.length; k++) {
      const c = q[k] as number;
      const cx = c % CHUNKS.w;
      const cy = Math.floor(c / CHUNKS.w);
      for (const n of [chunkIndex(cx + 1, cy), chunkIndex(cx - 1, cy), chunkIndex(cx, cy + 1), chunkIndex(cx, cy - 1)]) {
        if (n < 0 || seen.has(n) || !set.has(n)) continue;
        seen.add(n);
        q.push(n);
      }
    }
    if (seen.size === set.size && keep.length < village.chunks.length) {
      village.chunks = keep.sort((a, b) => a - b);
      village.rev.land += 1;
    }
  }
  const placedKeys = new Set(village.placed.map((p) => p.key));
  const staff = Array.isArray(raw.staff) ? (raw.staff as Record<string, unknown>[]) : [];
  const monsters = Array.isArray(raw.monsters) ? (raw.monsters as Record<string, unknown>[]) : [];
  for (const b of BOOTH_IDS) {
    const bs = booths[b];
    if (!isObj(bs)) continue;
    const seats = Array.isArray(bs.seats) ? bs.seats : [];
    /** 건 코인을 항아리에서 손님 id에게 돌려준다. */
    const refund = (id: unknown, bet: unknown): void => {
      const m = monsters.find((x) => x.id === id);
      if (m === undefined || typeof bet !== 'number' || typeof m.wallet !== 'number' || typeof bs.pot !== 'number') return;
      const back = Math.min(bet, bs.pot);
      bs.pot -= back;
      m.wallet += back;
      if (isObj(m.stats) && typeof m.stats.spent === 'number') m.stats.spent = Math.max(0, m.stats.spent - back);
    };
    const g = bs.group;
    if (isObj(g)) {
      // 모이거나 하던 판은 건 코인을 돌려주고 접는다. 결과가 난 판(done)은 이미 나눴으니 그대로 접는다.
      if (Array.isArray(g.participants) && g.phase !== 'done') for (const e of g.participants as Record<string, unknown>[]) refund(e.monster, e.bet);
      bs.group = idleGroup();
    } else if (Array.isArray(bs.rounds)) {
      // 보통 부스: 하던 한판의 건 코인을 돌려준다.
      for (const r of bs.rounds as unknown[]) if (isObj(r)) refund(r.monster, r.bet);
    }
    bs.seats = seats.map(() => null);
    bs.rounds = (Array.isArray(bs.rounds) ? bs.rounds : seats).map(() => null);
    bs.queue = [];
    // 보관함에 남은 부스의 진행자는 쉰다.
    if (!placedKeys.has(b) && Array.isArray(bs.staff)) {
      bs.staff = (bs.staff as unknown[]).map((sid) => {
        const s = staff.find((x) => x.id === sid);
        if (s !== undefined) s.post = null;
        return null;
      });
    }
  }
  // 손님: 마을 입구 둘레에서 다시 고른다 (파산한 손님은 일터로, 떠나던 손님은 떠난다).
  const spawn = villageOf(st).gateSpawn();
  monsters.forEach((m, i) => {
    m.pos = { x: spawn.x + ((i % 5) - 2) * 26, y: spawn.y - 10 - (i % 3) * 12 };
    m.path = [];
    m.booth = null;
    m.seat = null;
    m.errand = null;
    delete m.counter;
    m.homeward = false;
    delete m.spot;
    if (isObj(m.labor)) {
      m.labor.spot = -1;
      m.labor.wait = -1;
      m.labor.match = null;
    }
    // 파산한 손님은 일터를 기다리는 자리에서 (다음 틱에 일터로 걸어간다: sim.ts tickWaitWork).
    if (m.bankrupt === true) m.phase = 'waitWork';
    else if (m.phase !== 'leaving') m.phase = 'wandering';
    m.timer = 0.3 + (i % 7) * 0.2;
    m.phaseTime = 0;
  });
  raw.version = 5;
}

/** 저장된 게임 (없거나 버전이 다르면 null). */
export function loadGame(): GameState | null {
  const ls = storage();
  if (ls === null) return null;
  try {
    const text = ls.getItem(SAVE_KEY);
    if (text === null) return null;
    return normalizeState(JSON.parse(text));
  } catch {
    return null;
  }
}

export function saveGame(state: GameState): void {
  const ls = storage();
  if (ls === null) return;
  try {
    state.savedAt = Date.now();
    ls.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    // 저장 공간이 없거나 막혀 있으면 넘어간다.
  }
}

export function clearSave(): void {
  const ls = storage();
  if (ls === null) return;
  try {
    ls.removeItem(SAVE_KEY);
  } catch {
    // 넘어간다.
  }
}
