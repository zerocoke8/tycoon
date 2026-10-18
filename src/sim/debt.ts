// 넷째 묶음 (DESIGN 3.7)의 순수 도구: 장신구 고르기, 전당포·은행 값, 마을 금고, 일터 자리·빠르기·게이지.
// 흐름(볼일 → 파산 → 일 → 다 갚음, 빚 걸기 판)은 sim.ts가 돌린다. UI·화면도 여기 함수로 값을 읽는다 (숫자는 defs.ts).

import type { Rng } from '../core/rng.ts';
import { ACCESSORIES, ACCESSORY_IDS, ACCESSORY_SPAWN, BANK, DEBT_MATCH, LABOR, PAWN, VAULT, WORK_FACILITIES, type AccessoryId, type SpeciesId, type WantTable, type WorkFacility } from '../data/defs.ts';
import { YARD_GEO } from '../data/catalog.ts';
import type { Pt } from '../data/map.ts';
import { isBuilt, pawnRatio, yardPace, yardWorkers } from './economy.ts';
import { clampInto } from './path.ts';
import type { Accessory, GameState, Monster, PawnTicket } from './types.ts';
import { isConnected, villageOf } from './village.ts';

/** 들어오는 손님의 장신구 (ACCESSORY_SPAWN: 없음·하나·둘, 둘이면 자리가 다른 것끼리, 종이 빠진 장신구는 빼고). */
export function rollAccessories(rng: Rng, species: SpeciesId): Accessory[] {
  const r = rng.next();
  const n = r < ACCESSORY_SPAWN.two ? 2 : r < ACCESSORY_SPAWN.two + ACCESSORY_SPAWN.one ? 1 : 0;
  const out: Accessory[] = [];
  for (let i = 0; i < n; i++) {
    const cands = ACCESSORY_IDS.filter((k) => {
      const d = ACCESSORIES[k];
      const ex: readonly SpeciesId[] = 'exclude' in d ? d.exclude : [];
      return !ex.includes(species) && !out.some((a) => a.slot === d.slot);
    });
    if (cands.length === 0) break;
    const key = rng.weighted(cands.map((k) => [k, ACCESSORIES[k].weight] as const));
    const d = ACCESSORIES[key];
    out.push({ key, slot: d.slot, value: rng.int(d.value[0], d.value[1]) });
  }
  return out;
}

/** 이 장신구를 맡기면 빌려주는 코인 (값 × PAWN.loanRatio × 전당포 레벨 배수, 짓지 않았으면 0). */
export function pawnPrice(state: GameState, a: Pick<Accessory, 'value'>): number {
  return Math.max(1, Math.round(a.value * PAWN.loanRatio * pawnRatio(state)));
}

/** 맡길 장신구: 값이 가장 큰 것 (없으면 undefined). */
export function pawnPick(m: Monster): Accessory | undefined {
  let best: Accessory | undefined;
  for (const a of m.accessories) if (best === undefined || a.value > best.value) best = a;
  return best;
}

/** 되찾는 값 = 빌린 코인 × PAWN.redeemMarkup. */
export function redeemCost(t: Pick<PawnTicket, 'price'>): number {
  return Math.ceil(t.price * PAWN.redeemMarkup);
}

/** 지갑 wallet로 되찾을 수 있는 맡긴 장신구 (reserve만큼은 남기고): 값이 가장 큰 것. 없으면 undefined. */
export function redeemPick(m: Monster, reserve = 0): PawnTicket | undefined {
  let best: PawnTicket | undefined;
  for (const t of m.pawned) if (m.wallet >= redeemCost(t) + reserve && (best === undefined || t.value > best.value)) best = t;
  return best;
}

/** 은행이 한 번에 빌려주는 코인 (BANK.base + 레벨 × perLevel, 짓지 않았으면 0). */
export function bankLoan(state: GameState): number {
  return isBuilt(state, 'bank') ? BANK.base + state.buildings.bank.level * BANK.perLevel : 0;
}

/** 빌린 코인 amount의 갚을 돈. */
export function loanDebt(amount: number): number {
  return Math.round(amount * BANK.interest);
}

/** 지었고 지도에 놓여 입구가 길로 마을 입구와 이어졌다 (손님이 들를 수 있다: 전당포·은행·일터). */
export function shopOpen(state: GameState, id: 'pawnshop' | 'bank' | 'workyard'): boolean {
  return isBuilt(state, id) && isConnected(state, id);
}

/** 은행이 빌려줄 수 있나: 은행과 일터(못 갚은 빚을 갚을 곳)가 있고, 갚을 빚이 없고 (빚이 있으면 더 빌려주지 않는다), 이번 방문에 BANK.maxLoans번 안. 금고는 따로 (canLend). */
export function bankOpenFor(state: GameState, m: Monster): boolean {
  return shopOpen(state, 'bank') && shopOpen(state, 'workyard') && m.debt <= 0 && m.bankrupt !== true && (m.loans ?? 0) < BANK.maxLoans;
}

/**
 * 돈이 떨어진 손님이 더 놀고 싶어 전당포·은행에 갈 확률 (defs.ts WantTable: PAWN.want·BANK.want).
 * 기분이 좋을수록, 끈기가 많이 남을수록, 대담이·흥부자일수록 높다 (겁쟁이는 은행을 무서워한다).
 * less = 깎을 값 (은행: 일터에서 일하는 채무자를 보면 망설인다, BANK.wary × 채무자 수).
 */
export function wantMore(m: Pick<Monster, 'mood' | 'patience' | 'traits'>, t: WantTable, less = 0): number {
  let p = t.base + (m.mood - 50) * t.perMood + Math.max(0, m.patience) * t.perPatience - less;
  for (const k of m.traits) p += t.traits[k] ?? 0;
  return Math.max(t.lo, Math.min(t.hi, p));
}

/**
 * 빚 걸기 판에 부를 수 있는 채무자: 일터로 가는·일하는·기다리는 채무자 가운데 빚이 DEBT_MATCH.minStake 이상이고
 * 이번 파산에 빚 걸기 판을 maxPerStint번보다 적게 한 손님 (sim의 판 고르기와 일터 시트가 같이 쓴다).
 */
export function debtEligible(m: Monster): boolean {
  const lab = m.labor;
  if (m.bankrupt !== true || lab === null || lab === undefined || lab.match !== null) return false;
  if (m.debt < DEBT_MATCH.minStake || (lab.matches ?? 0) >= DEBT_MATCH.maxPerStint) return false;
  return m.phase === 'toWork' || m.phase === 'working' || m.phase === 'waitWork';
}

/**
 * 빚 걸기 판의 짝 (pairs쌍): 빚 순서로 늘어놓고 이웃끼리 (지면 상대 빚만큼 늘어나니 비슷한 빚끼리), 어느 이웃을 고를지는 무작위.
 * 돌려주는 목록은 [2k, 2k+1]이 짝 (줄다리기는 자리 2k = 홍, 2k+1 = 청: 짝 안의 순서도 무작위). 모자라면 짝 수만큼만 (빈 목록일 수 있다).
 */
export function pairDebtors<T extends { debt: number }>(rng: Rng, pool: readonly T[], pairs: number): T[] {
  const n = Math.min(pairs, Math.floor(pool.length / 2)) * 2;
  if (n < 2) return [];
  const sorted = [...pool].sort((a, b) => a.debt - b.debt);
  const start = rng.int(0, sorted.length - n);
  const couples: [T, T][] = [];
  for (let i = start; i < start + n; i += 2) {
    const a = sorted[i] as T;
    const b = sorted[i + 1] as T;
    couples.push(rng.chance(0.5) ? [a, b] : [b, a]);
  }
  // 어느 짝이 앞자리인지도 섞는다.
  return rng.shuffle(couples).flat();
}

/** 마을 금고에서 amount를 빌려줄 수 있나 (빌려준 뒤에도 VAULT.reserve가 남고, 한 번에 마을 코인의 VAULT.maxShare까지). */
export function canLend(state: GameState, amount: number): boolean {
  return amount > 0 && state.coins - amount >= VAULT.reserve && amount <= state.coins * VAULT.maxShare;
}

/** 가게 계산대 자리 i (세계 좌표, 목록보다 많으면 마지막 자리 둘레로 비켜 선다). */
export function counterPt(state: GameState, shop: 'pawnshop' | 'bank', i: number): Pt {
  const g = villageOf(state).shop(shop);
  const c = g.counter;
  const p = c[i];
  if (p !== undefined) return p;
  const last = c[c.length - 1] ?? g.npc;
  const k = i - c.length + 1;
  // 가게 발자국 밖(옆 건물·풀밭)으로 나가지 않게.
  return clampInto(state, shop, { x: last.x + (k % 2 === 0 ? -1 : 1) * 46 * Math.ceil(k / 2), y: last.y + 34 * k });
}

/** 볼일 → 가게. */
export const errandShop = (e: 'pawn' | 'redeem' | 'loan' | 'repay'): 'pawnshop' | 'bank' => (e === 'pawn' || e === 'redeem' ? 'pawnshop' : 'bank');

/** 일터 시설 f의 일하는 자리 i (세계 좌표). */
export function workPt(state: GameState, f: WorkFacility, i: number): Pt {
  const y = villageOf(state).yard();
  const s = y.facilities[f].spots;
  return s[i] ?? s[0] ?? y.center;
}

/** 일터 시설 f의 기다리는 자리 i (세계 좌표, 목록보다 많으면 마지막 자리 옆으로). */
export function waitPt(state: GameState, f: WorkFacility, i: number): Pt {
  const y = villageOf(state).yard();
  const w = y.facilities[f].wait;
  const p = w[i];
  if (p !== undefined) return p;
  const last = w[w.length - 1] ?? y.center;
  const k = i - w.length + 1;
  // 일터 발자국 밖으로 나가지 않게 (기다리는 채무자가 아주 많을 때).
  return clampInto(state, 'workyard', { x: last.x + (k % 2 === 0 ? -1 : 1) * 70 * Math.ceil(k / 2), y: last.y + 42 * k });
}

/** 시설마다 일하는 자리 수 (일터 레벨, 지도 자리 수까지). */
export function workSlots(state: GameState, f: WorkFacility): number {
  return Math.min(yardWorkers(state), YARD_GEO.facilities[f].spots.length);
}

/**
 * 일터 자리 고르기: 빈 일하는 자리 (종이 좋아하는 시설 먼저, 아니면 빈 자리가 많은 시설, 같으면 무작위), 없으면 기다리는 자리.
 * others = 다른 채무자들 (자리를 차지한 손님).
 */
export function pickWorkSpot(rng: Rng, state: GameState, m: Monster, others: readonly Monster[]): { facility: WorkFacility; spot: number; wait: number } {
  const used = (f: WorkFacility): Set<number> => new Set(others.filter((o) => o !== m && o.labor?.facility === f && o.labor.spot >= 0).map((o) => o.labor?.spot ?? -1));
  const free = (f: WorkFacility): number[] => {
    const u = used(f);
    return Array.from({ length: workSlots(state, f) }, (_, i) => i).filter((i) => !u.has(i));
  };
  const prefer = (LABOR.prefer as Partial<Record<SpeciesId, WorkFacility>>)[m.species];
  // 같으면 무작위 (섞은 뒤 안정 정렬).
  const order = rng.shuffle([...WORK_FACILITIES]).sort((a, b) => free(b).length - free(a).length);
  if (prefer !== undefined) order.sort((a, b) => Number(b === prefer && free(b).length > 0) - Number(a === prefer && free(a).length > 0));
  for (const f of order) {
    const fs = free(f);
    if (fs.length > 0) return { facility: f, spot: fs[0] as number, wait: -1 };
  }
  // 자리가 없다: 기다리는 손님이 적은 시설 옆에.
  const waiting = (f: WorkFacility): Set<number> => new Set(others.filter((o) => o !== m && o.labor?.facility === f && o.labor.spot < 0 && o.labor.wait >= 0).map((o) => o.labor?.wait ?? -1));
  const f = prefer ?? [...WORK_FACILITIES].sort((a, b) => waiting(a).size - waiting(b).size)[0] ?? 'farm';
  const w = waiting(f);
  let i = 0;
  while (w.has(i)) i++;
  return { facility: f, spot: -1, wait: i };
}

/** 일하는 손님이 1초에 갚는 빚 (응원·간식 배수 포함). */
export function laborRate(state: GameState, m: Monster): number {
  const lab = m.labor;
  const boost = lab !== null && lab !== undefined && lab.boostSec > 0 ? lab.boostMult : 1;
  return (yardPace(state) / LABOR.secPerCoin) * boost;
}

/** 빚 게이지 (0 = 막 파산, 1 = 다 갚음). */
export function laborGauge(m: Monster): number {
  const total = m.labor?.total ?? m.debt;
  if (!(total > 0)) return 1;
  return Math.max(0, Math.min(1, 1 - m.debt / total));
}

/** 남은 빚을 다 갚는 데 드는 초 (지금 빠르기로, 응원 없이). */
export function laborSecLeft(state: GameState, m: Monster): number {
  return m.debt / Math.max(1e-6, yardPace(state) / LABOR.secPerCoin);
}

/** 이 장신구 종류의 이름. */
export const accessoryName = (k: AccessoryId): string => ACCESSORIES[k].name;
