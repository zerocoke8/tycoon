// 주민(진행자): 고용 후보 만들기, 어울리는 자리 찾기, 레벨업 비용과 능력치 올리기.

import type { Rng } from '../core/rng.ts';
import { BOOTHS, BOOTH_IDS, HOST_PRESETS, type BoothId, type StaffStats } from '../data/defs.ts';
import type { Cost } from './api.ts';
import { boothRoles } from './booths.ts';
import { TUNE } from './tuning.ts';
import type { Candidate, GameState, Staff, StaffPost } from './types.ts';
import { isPlaced } from './village.ts';

/** 그림 없는 후보에게 붙이는 이름 (그림은 보통 부스 진행자 그림을 돌려 쓴다). TODO: defs.ts로 옮기기. */
const HOST_NAMES = ['푸근 아주머니', '깔깔 소년', '느긋 할아버지', '반짝 누나', '씩씩 아저씨', '방실 아가씨', '뚝딱 삼촌', '소곤 언니', '껄껄 영감님', '총총 꼬마'] as const;
/** 무작위 후보가 빌려 쓰는 그림: 처음 네 부스 진행자 (새 부스·경주장 진행자는 그 사람만의 그림). */
const HOST_ARTS = HOST_PRESETS.slice(0, 4).map((p) => p.art);

const STAT_KEYS: readonly (keyof StaffStats)[] = ['pace', 'charm', 'welcome'];
export const STAT_MAX = 5;

export function isPreset(c: Candidate): boolean {
  return HOST_PRESETS.some((p) => p.name === c.name && p.art === c.art);
}

/** 그림 있는 진행자(HOST_PRESETS)의 어울리는 자리. 그림만 빌려 쓴 무작위 진행자는 이름까지 같아야 한다 (ui/labels.ts presetPostOf와 같은 규칙). 없으면 null. */
export function presetPost(who: Pick<Staff, 'name' | 'art'>): StaffPost | null {
  const p = HOST_PRESETS.find((h) => h.art === who.art && h.name === who.name);
  return p === undefined ? null : { booth: p.booth, role: p.role };
}

/** 이 진행자가 이 자리에 어울리나 (그림 있는 진행자의 자기 자리). */
export function suits(s: Pick<Staff, 'name' | 'art'>, booth: BoothId, role: number): boolean {
  const p = presetPost(s);
  return p !== null && p.booth === booth && p.role === role;
}

/** 고용하면 맡을 자리. take = 자기 자리에 다른 진행자가 서 있어 바꿔 선다 (그 진행자는 다른 빈 자리로, 없으면 쉰다). */
export interface HirePost {
  readonly post: StaffPost;
  readonly take: boolean;
}

/**
 * 쉬는 진행자 who가 맡을 자리 (sim hire와 고용 후보 카드가 같이 쓴다).
 * 그림 있는 진행자는 자기 자리 (열린 부스면 다른 사람이 서 있어도 바꿔 선다) → 꼭 있어야 하는 빈 자리 → 있으면 좋은 빈 자리.
 * 자기 부스가 아직 잠겼으면 있으면 좋은 자리는 맡지 않고 쉰다 (부스를 열 때 바로 자기 자리로 가게).
 * 보관함에 있는 부스(지도에 놓지 않은 부스)는 잠긴 부스처럼 본다 (놓으면 sim이 자리를 채운다).
 */
export function hirePost(state: GameState, who: Pick<Staff, 'name' | 'art'>): HirePost | null {
  const own = presetPost(who);
  if (own !== null && state.booths[own.booth].unlocked && isPlaced(state, own.booth)) return { post: own, take: (state.booths[own.booth].staff[own.role] ?? null) !== null };
  const empty: { booth: BoothId; role: number; optional: boolean }[] = [];
  for (const b of BOOTH_IDS) {
    const bs = state.booths[b];
    if (!bs.unlocked || !isPlaced(state, b)) continue;
    boothRoles(b).forEach((r, role) => {
      if ((bs.staff[role] ?? null) === null) empty.push({ booth: b, role, optional: r.optional === true });
    });
  }
  const t = empty.find((x) => !x.optional) ?? (own === null ? empty[0] : undefined);
  return t === undefined ? null : { post: { booth: t.booth, role: t.role }, take: false };
}

/**
 * 고용 후보로 나올 그림 있는 진행자: 아직 없고(taken = 고용했거나 이미 후보인 그림), 그 부스를 열 수 있는 회관 레벨(hall)이 된 사람.
 * 처음에는 컵·다트·돌림판 진행자, 회관이 오를 때마다 새 구역 부스의 진행자가 더해진다.
 */
export function presetCandidates(hall: number, taken: readonly string[]): Candidate[] {
  return HOST_PRESETS.filter((p) => !taken.includes(p.art) && BOOTHS[p.booth].unlock.hall <= hall).map((p) => ({ name: p.name, art: p.art, stats: { ...p.stats }, cost: p.cost }));
}

/** 무작위 후보 하나. 사무소 레벨이 높을수록 능력치가 조금 좋다. */
export function randomCandidate(rng: Rng, state: GameState): Candidate {
  const taken = new Set([...state.staff.map((s) => s.name), ...state.candidates.map((c) => c.name)]);
  const names = HOST_NAMES.filter((n) => !taken.has(n));
  const name = rng.pick(names.length > 0 ? names : HOST_NAMES);
  const stats: Record<keyof StaffStats, number> = { pace: rng.int(1, 3), charm: rng.int(1, 3), welcome: rng.int(1, 3) };
  let bonus = state.buildings.office.level - 1 + rng.int(0, 1);
  while (bonus-- > 0) {
    const k = rng.pick(STAT_KEYS);
    stats[k] = Math.min(STAT_MAX, stats[k] + 1);
  }
  const sum = stats.pace + stats.charm + stats.welcome;
  return { name, art: rng.pick(HOST_ARTS), stats, cost: TUNE.candidateCost.base + sum * TUNE.candidateCost.perPoint };
}

/** 후보 목록을 count까지 채운다. refresh면 무작위 후보는 새로 바꾼다 (그림 있는 진행자는 남는다). */
export function fillCandidates(rng: Rng, state: GameState, count: number, refresh: boolean): void {
  if (refresh) state.candidates = state.candidates.filter(isPreset);
  while (state.candidates.length < count) state.candidates.push(randomCandidate(rng, state));
}

/** 다음 레벨업 비용 (능력치가 모두 최고면 null). */
export function levelUpCost(s: Staff): Cost | null {
  if (STAT_KEYS.every((k) => s.stats[k] >= STAT_MAX)) return null;
  return { coins: TUNE.staffLevelCost.base + s.level * TUNE.staffLevelCost.perLevel };
}

/** 가장 낮은 능력치 하나를 올린다 (같으면 진행 → 입담 → 손님맞이). 올린 능력치 이름. */
export function raiseStat(s: Staff): keyof StaffStats | null {
  let best: keyof StaffStats | null = null;
  for (const k of STAT_KEYS) if (s.stats[k] < STAT_MAX && (best === null || s.stats[k] < s.stats[best])) best = k;
  if (best === null) return null;
  s.stats = { ...s.stats, [best]: s.stats[best] + 1 };
  s.level += 1;
  return best;
}
