// 새 게임과 저장 (localStorage 'mpv-save-v1'). Node(scripts/sim-check.ts)에서는 localStorage가 없으니 조용히 넘어간다.

import { Rng } from '../core/rng.ts';
import { BOOTHS, BOOTH_IDS, BUILDINGS, GOODS, HOST_PRESETS, isGroupBooth, MATERIALS, PRECIOUS, SIM, type BoothId, type BuildingId, type GoodId, type MaterialId, type PreciousId } from '../data/defs.ts';
import { BUILDING_SPOTS, DISTRICTS, NODES, type DistrictId, type NodeId } from '../data/map.ts';
import { byLevel } from './economy.ts';
import { createMonster } from './monsters.ts';
import { nearestNodes } from './path.ts';
import { idleGroup } from './group/core.ts';
import { raceOutcome } from './race.ts';
import { presetCandidates } from './staff.ts';
import { TUNE } from './tuning.ts';
import type { BoothState, GameState, RaceResult, RacerIndex, Staff, StaffId } from './types.ts';

export const SAVE_KEY = 'mpv-save-v1';
/** 2: 진행자 자리(BoothState.staff, Staff.post), 손님 재료(Monster.mats), 경주장. 3: 단체 놀이 엔진 (BoothState.race → group). 옛 저장은 새로 시작. */
export const SAVE_VERSION = 3;

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
  for (const id of Object.keys(BUILDINGS) as BuildingId[]) buildings[id] = { level: 1 };
  const districts = (Object.keys(DISTRICTS) as DistrictId[]).filter((d) => DISTRICTS[d].hall <= 1);
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
    districts,
    savedAt: 0,
    regulars: [],
  };
  addOpeningGuests(state, rng);
  state.rng = rng.state;
  return state;
}

/** 새 게임을 열면 손님 몇이 이미 광장을 걷고 있다 (첫 한판까지 기다리지 않게). */
function addOpeningGuests(state: GameState, rng: Rng): void {
  const center = BUILDING_SPOTS.fountain;
  const near = nearestNodes(center, state.districts, TUNE.openingNodes + 1).filter((id: NodeId) => id !== 'gate').slice(0, TUNE.openingNodes);
  if (near.length === 0) return;
  for (let i = 0; i < TUNE.openingGuests; i++) {
    const p = NODES[rng.pick(near)];
    const m = createMonster(rng, state, state.nextId++, { x: p.x + rng.range(-60, 60), y: p.y + rng.range(-40, 40) }, null);
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
  if (!isObj(raw) || raw.version !== SAVE_VERSION) return null;
  if (typeof raw.coins !== 'number' || !Number.isFinite(raw.coins)) return null;
  if (!Array.isArray(raw.monsters) || !Array.isArray(raw.staff) || !isObj(raw.booths) || !isObj(raw.buildings)) return null;
  const base = newGame(typeof raw.rng === 'number' ? raw.rng : 1) as unknown as Record<string, unknown>;
  const st = raw as Record<string, unknown>;
  for (const [k, v] of Object.entries(base)) if (!(k in st)) st[k] = v;
  for (const key of ['materials', 'precious', 'goods', 'buildings', 'booths'] as const) {
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
  raw.version = SAVE_VERSION;
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
