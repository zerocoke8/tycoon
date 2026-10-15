// 재화: 비용 확인·지불, 건물 레벨 효과, 재료 창고 한도, 가공품 표.

import { BUILDINGS, GOODS, MATERIALS, PRECIOUS, SPECIES, SPECIES_IDS, type BuildingId, type GoodId, type MaterialId, type PreciousId } from '../data/defs.ts';
import type { Cost } from './api.ts';
import { josa } from './text.ts';
import type { GameState } from './types.ts';

/** 건물 레벨 한 칸 (defs.ts BUILDINGS의 levels 항목을 한 모양으로). */
export interface BuildingLevel {
  readonly coins: number;
  readonly mats?: Partial<Record<MaterialId, number>>;
  readonly precious?: Partial<Record<PreciousId, number>>;
  readonly visitors?: number;
  readonly spawnSec?: number;
  readonly slots?: number;
  readonly speed?: number;
  readonly candidates?: number;
  readonly cap?: number;
  readonly moodPerMin?: number;
}

export function buildingLevels(id: BuildingId): readonly BuildingLevel[] {
  return BUILDINGS[id].levels as readonly BuildingLevel[];
}

/** 표에서 레벨(1부터) 값. 범위를 넘으면 끝 값. */
export function byLevel<T>(arr: readonly T[], level: number): T {
  const v = arr[Math.max(0, Math.min(arr.length - 1, Math.floor(level) - 1))];
  if (v === undefined) throw new Error('byLevel: 빈 표');
  return v;
}

function levelDef(state: GameState, id: BuildingId): BuildingLevel {
  return byLevel(buildingLevels(id), state.buildings[id].level);
}

export const hallVisitors = (s: GameState): number => levelDef(s, 'hall').visitors ?? 4;
export const gateSpawnSec = (s: GameState): number => levelDef(s, 'gate').spawnSec ?? 14;
export const workshopSlots = (s: GameState): number => levelDef(s, 'workshop').slots ?? 1;
export const workshopSpeed = (s: GameState): number => levelDef(s, 'workshop').speed ?? 1;
export const officeCandidates = (s: GameState): number => levelDef(s, 'office').candidates ?? 2;
export const warehouseCap = (s: GameState): number => levelDef(s, 'warehouse').cap ?? 20;
export const fountainMoodPerMin = (s: GameState): number => levelDef(s, 'fountain').moodPerMin ?? 0;

export function costOf(lv: { coins: number; mats?: Partial<Record<MaterialId, number>>; precious?: Partial<Record<PreciousId, number>> }): Cost {
  const c: { coins: number; mats?: Partial<Record<MaterialId, number>>; precious?: Partial<Record<PreciousId, number>> } = { coins: lv.coins };
  if (lv.mats !== undefined && Object.keys(lv.mats).length > 0) c.mats = { ...lv.mats };
  if (lv.precious !== undefined && Object.keys(lv.precious).length > 0) c.precious = { ...lv.precious };
  return c;
}

/** 다음 레벨 비용 (최고 레벨이면 null). */
export function nextBuildingCost(state: GameState, id: BuildingId): Cost | null {
  const next = buildingLevels(id)[state.buildings[id].level];
  return next === undefined ? null : costOf(next);
}

/** 모자란 것을 한국어로 (넉넉하면 null). */
export function missingReason(state: GameState, cost: Cost): string | null {
  if (state.coins < cost.coins) return `코인이 ${cost.coins - state.coins} 모자라요.`;
  for (const [k, n] of Object.entries(cost.mats ?? {}) as [MaterialId, number][]) {
    const have = state.materials[k] ?? 0;
    if (have < n) {
      const from = SPECIES_IDS.filter((s) => SPECIES[s].material === k).map((s) => SPECIES[s].name);
      return `${josa(MATERIALS[k].name, '이', '가')} ${n - have}개 모자라요.${from.length > 0 ? ` ${from.join('·')} 손님이 기분 좋게 떠날 때 남겨요.` : ''}`;
    }
  }
  for (const [k, n] of Object.entries(cost.precious ?? {}) as [PreciousId, number][]) {
    const have = state.precious[k] ?? 0;
    if (have < n) return `${josa(PRECIOUS[k].name, '이', '가')} ${n - have}개 더 필요해요. 대박 난 손님을 기분 좋게 보내 보세요.`;
  }
  return null;
}

export function canAfford(state: GameState, cost: Cost): boolean {
  return missingReason(state, cost) === null;
}

/** 비용을 낸다 (canAfford를 먼저 확인할 것). 재료·귀한 물건이 줄었으면 true. */
export function pay(state: GameState, cost: Cost): boolean {
  state.coins -= cost.coins;
  let items = false;
  for (const [k, n] of Object.entries(cost.mats ?? {}) as [MaterialId, number][]) {
    state.materials[k] = (state.materials[k] ?? 0) - n;
    items = true;
  }
  for (const [k, n] of Object.entries(cost.precious ?? {}) as [PreciousId, number][]) {
    state.precious[k] = (state.precious[k] ?? 0) - n;
    items = true;
  }
  return items;
}

/** 재료를 창고에 넣는다 (종류마다 창고 한도까지). 실제로 넣은 개수. */
export function addMaterial(state: GameState, mat: MaterialId, n: number): number {
  const cap = warehouseCap(state);
  const have = state.materials[mat] ?? 0;
  const add = Math.max(0, Math.min(n, cap - have));
  state.materials[mat] = have + add;
  return add;
}

/** 가공품 한 줄 (defs.ts GOODS를 한 모양으로). */
export interface GoodDef {
  readonly name: string;
  readonly kind: 'snack' | 'cheer';
  readonly desc: string;
  readonly mood?: number;
  readonly patience?: number;
  readonly moodPerRound?: number;
  readonly reactionBoost?: number;
  readonly luck?: number;
  readonly durationSec?: number;
}

export function goodDef(id: GoodId): GoodDef {
  return GOODS[id] as GoodDef;
}
