// 놀이부스: 레벨 값, 진행자 자리, 열림 여부, 자리·줄 위치, 손님의 부스 고르기.

import type { Rng } from '../core/rng.ts';
import { BOOTHS, BOOTH_IDS, boothDef, isGroupBooth, SPECIES, type BoothId, type BoothRole, type StaffStats } from '../data/defs.ts';
import { BOOTH_SPOTS, type Pt } from '../data/map.ts';
import { byLevel, goodDef, type GoodDef } from './economy.ts';
import { groupGame } from './group/index.ts';
import { TUNE } from './tuning.ts';
import type { BoothState, GameState, Monster, Staff } from './types.ts';

export function boothFee(state: GameState, b: BoothId): number {
  return byLevel(BOOTHS[b].fee, state.booths[b].level);
}

/** 한판에 내는 손님의 특산 재료 수 (복주머니, 없으면 0). */
export function boothMatFee(b: BoothId): number {
  return boothDef(b).matFee ?? 0;
}

/** 자리 수 (지도에 놓인 자리 수를 넘지 않는다). */
export function boothSeats(state: GameState, b: BoothId): number {
  return Math.max(1, Math.min(byLevel(BOOTHS[b].seats, state.booths[b].level), BOOTH_SPOTS[b].seats.length));
}

export function boothRoundSec(state: GameState, b: BoothId): number {
  return byLevel(BOOTHS[b].roundSec, state.booths[b].level);
}

export function boothPotCap(state: GameState, b: BoothId): number {
  return byLevel(BOOTHS[b].potCap, state.booths[b].level);
}

/** 진행자 자리 (defs.ts BOOTHS[b].roles). */
export function boothRoles(b: BoothId): readonly BoothRole[] {
  return boothDef(b).roles;
}

/** 자리 role을 맡은 진행자 (없으면 null). */
export function boothStaff(state: GameState, b: BoothId, role: number): Staff | null {
  const id = state.booths[b].staff[role] ?? null;
  if (id === null) return null;
  return state.staff.find((s) => s.id === id) ?? null;
}

/** 0번 자리 진행자 (보통 부스의 진행자, 경주장의 출발 신호). */
export function boothHost(state: GameState, b: BoothId): Staff | null {
  return boothStaff(state, b, 0);
}

/**
 * 부스에 쓰이는 능력치: 그 능력치를 맡은 자리(roles[i].stat)가 있으면 그 자리 진행자의 값, 없으면 0번 자리 진행자의 값.
 * 맡은 진행자가 없으면 fallback (진행·손맞이 3, 입담 0: 예전 '진행자 없음' 값).
 */
export function boothStat(state: GameState, b: BoothId, stat: keyof StaffStats, fallback = stat === 'charm' ? 0 : 3): number {
  const roles = boothRoles(b);
  let role = roles.findIndex((r) => r.stat === stat);
  if (role < 0) role = 0;
  return boothStaff(state, b, role)?.stats[stat] ?? fallback;
}

/** 꼭 있어야 하는 진행자 자리가 다 찼다. */
export function boothStaffed(state: GameState, b: BoothId): boolean {
  const bs = state.booths[b];
  return boothRoles(b).every((r, i) => r.optional === true || (bs.staff[i] ?? null) !== null);
}

/** 열림 = 해금됐고 꼭 있어야 하는 진행자 자리가 다 찼다. */
export function boothOpen(state: GameState, b: BoothId): boolean {
  return state.booths[b].unlocked && boothStaffed(state, b);
}

/** 걸어 둔 응원 도구 (없으면 null). */
export function boothCheer(bs: BoothState): GoodDef | null {
  return bs.cheer !== null && bs.cheer.left > 0 ? goodDef(bs.cheer.good) : null;
}

/** 자리·한판·진행자 배열 길이를 맞춘다 (업그레이드로 자리가 늘어날 때, 옛 상태). */
export function fitSeats(state: GameState, b: BoothId): void {
  const bs = state.booths[b];
  const n = boothSeats(state, b);
  while (bs.seats.length < n) bs.seats.push(null);
  while (bs.rounds.length < n) bs.rounds.push(null);
  const roles = boothRoles(b).length;
  while (bs.staff.length < roles) bs.staff.push(null);
}

export function seatPt(b: BoothId, i: number): Pt {
  const s = BOOTH_SPOTS[b].seats;
  return s[i] ?? s[0] ?? BOOTH_SPOTS[b].base;
}

/** 진행자 자리 role이 서는 점 (지도에 없으면 0번 자리). */
export function hostPt(b: BoothId, role: number): Pt {
  const h = BOOTH_SPOTS[b].hosts;
  return h[role] ?? h[0] ?? BOOTH_SPOTS[b].base;
}

/** 줄 i번째 자리. 지도에 놓인 줄보다 길면 마지막 두 점의 방향으로 늘인다. */
export function queuePt(b: BoothId, i: number): Pt {
  const q = BOOTH_SPOTS[b].queue;
  const p = q[i];
  if (p !== undefined) return p;
  const last = q[q.length - 1] ?? seatPt(b, 0);
  const prev = q[q.length - 2] ?? seatPt(b, 0);
  const k = i - (q.length - 1);
  return { x: last.x + (last.x - prev.x) * k, y: last.y + (last.y - prev.y) * k };
}

export function queueCap(b: BoothId): number {
  return Math.max(1, BOOTH_SPOTS[b].queue.length);
}

/** 한판에 드는 최소 코인 (참가비 + 건 코인 1). 재료 참가비 부스는 따로 (canPlay). */
export function playCost(state: GameState, b: BoothId): number {
  return boothFee(state, b) + 1;
}

/** 손님이 이 부스에서 한판 할 수 있나 (코인, 재료 참가비). */
export function canPlay(state: GameState, b: BoothId, m: Monster): boolean {
  return m.wallet >= playCost(state, b) && (m.mats ?? 0) >= boothMatFee(b);
}

/**
 * 지금 열린 부스(없으면 해금된 부스) 가운데 가장 싼 한판 (없으면 Infinity). 지갑이 이보다 적으면 빈털터리.
 * 재료로 참가비를 내는 부스(복주머니)는 세지 않는다 (재료가 떨어지면 못 하니 코인 기준으로 본다).
 */
export function minPlayCost(state: GameState): number {
  const scan = (withMats: boolean): number => {
    let open = Infinity;
    let unlocked = Infinity;
    for (const b of BOOTH_IDS) {
      if (!state.booths[b].unlocked || (!withMats && boothMatFee(b) > 0)) continue;
      unlocked = Math.min(unlocked, playCost(state, b));
      if (boothOpen(state, b)) open = Math.min(open, playCost(state, b));
    }
    return Number.isFinite(open) ? open : unlocked;
  };
  const coins = scan(false);
  // 코인 참가비 부스가 하나도 없으면 (시험용 마을) 재료 부스로.
  return Number.isFinite(coins) ? coins : scan(true);
}

/** 빈 자리가 있거나 줄에 설 수 있나. */
export function boothHasRoom(state: GameState, b: BoothId): boolean {
  const bs = state.booths[b];
  const n = boothSeats(state, b);
  let free = 0;
  for (let i = 0; i < n; i++) if ((bs.seats[i] ?? null) === null) free++;
  return free > bs.queue.length || bs.queue.length < queueCap(b);
}

/**
 * 손님이 갈 부스를 고른다: 좋아하는 부스 ×3, 열린 부스만, 줄이 길수록 덜, 진행자 손님맞이 보너스.
 * 갈 곳이 없으면 null (줄이 가득이거나 지갑·재료가 모자람).
 */
export function chooseBooth(state: GameState, rng: Rng, m: Monster, avoid: BoothId | null = null): BoothId | null {
  const fav = SPECIES[m.species].favorite as readonly BoothId[];
  const entries: [BoothId, number][] = [];
  for (const b of BOOTH_IDS) {
    if (!boothOpen(state, b) || !boothHasRoom(state, b)) continue;
    if (!canPlay(state, b, m)) continue;
    let w = fav.includes(b) ? TUNE.favoriteWeight : 1;
    w *= Math.max(0.2, 1 + (boothStat(state, b, 'welcome', TUNE.emptyWelcome) - 3) * TUNE.welcomePerPoint);
    w /= 1 + state.booths[b].queue.length * TUNE.queuePenalty;
    // 단체 놀이: 모이는 중인 판은 손님을 더 끈다 (여럿이 같이 보고 싶다). 출발 조건이 아직 안 맞으면 (밀어내기 상대가 없음) 더, 많아야 groupPullMax배.
    const g = state.booths[b].group;
    if (g !== null && g.phase === 'gathering' && isGroupBooth(b)) {
      const need = groupGame(b).readiness(g.participants, g.elapsed) === 'none';
      w *= Math.min(TUNE.groupPullMax, 1 + g.participants.length * TUNE.groupGatherPull * (need ? TUNE.groupNeedPull : 1));
    }
    if (b === avoid) w *= 0.35;
    entries.push([b, w]);
  }
  return entries.length === 0 ? null : rng.weighted(entries);
}
