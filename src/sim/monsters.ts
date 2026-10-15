// 손님 만들기, 걷기, 성격에 따른 건 코인.

import type { Rng } from '../core/rng.ts';
import { GUEST_MATS, MOOD, NICKNAMES, SIM, SPECIES, SPECIES_IDS, TRAITS, type SpeciesId, type TraitId } from '../data/defs.ts';
import type { Pt } from '../data/map.ts';
import { josa } from './text.ts';
import { TUNE } from './tuning.ts';
import type { GameState, Monster, MonsterId, Regular } from './types.ts';

const TRAIT_IDS = Object.keys(TRAITS) as TraitId[];

/** '콩 꼬마 용' */
export function displayName(m: Pick<Monster, 'nickname' | 'species'>): string {
  return `${m.nickname} ${SPECIES[m.species].name}`;
}

/** '콩 꼬마 용이' */
export function nameSubject(m: Pick<Monster, 'nickname' | 'species'>): string {
  return josa(displayName(m), '이', '가');
}

export function speedOf(m: Monster): number {
  return SPECIES[m.species].floats ? SIM.floatSpeed : SIM.walkSpeed;
}

export function faceToward(m: Monster, x: number): void {
  if (Math.abs(x - m.pos.x) > 1) m.facing = x > m.pos.x ? 1 : -1;
}

/** path를 따라 dt초만큼 걷는다. 바라보는 쪽은 가로로 움직이는 쪽. */
export function stepMove(m: Monster, dt: number): void {
  let budget = speedOf(m) * dt;
  let x = m.pos.x;
  let y = m.pos.y;
  while (budget > 0 && m.path.length > 0) {
    const t = m.path[0] as Pt;
    const dx = t.x - x;
    const dy = t.y - y;
    const d = Math.hypot(dx, dy);
    if (Math.abs(dx) > 0.5) m.facing = dx > 0 ? 1 : -1;
    if (d <= budget) {
      x = t.x;
      y = t.y;
      budget -= d;
      m.path.shift();
    } else {
      x += (dx / d) * budget;
      y += (dy / d) * budget;
      budget = 0;
    }
  }
  m.pos = { x, y };
}

/** 건 코인 비율: 겁쟁이 0.08~0.12, 보통 0.15~0.25, 대담이 0.3~0.45 (둘 다면 보통). */
export function betFraction(rng: Rng, traits: readonly TraitId[]): number {
  const coward = traits.includes('coward');
  const bold = traits.includes('bold');
  const [a, b] = coward && !bold ? TUNE.betFrac.coward : bold && !coward ? TUNE.betFrac.bold : TUNE.betFrac.normal;
  return rng.range(a, b);
}

/** 회관 레벨로 올 수 있는 종. 막 열린 종(그 회관 레벨에 새로 오는 종)은 TUNE.newSpeciesWeight배 자주 온다. */
export function allowedSpecies(hall: number): SpeciesId[] {
  return SPECIES_IDS.filter((s) => SPECIES[s].hall <= hall);
}

function pickSpecies(rng: Rng, hall: number): SpeciesId {
  const list = allowedSpecies(hall);
  return rng.weighted(list.map((s) => [s, SPECIES[s].hall === hall && hall > 1 ? TUNE.newSpeciesWeight : 1] as const));
}

function pickTraits(rng: Rng, species: SpeciesId): TraitId[] {
  const own = SPECIES[species].traits as readonly TraitId[];
  const traits: TraitId[] = [rng.pick(own)];
  if (rng.chance(TUNE.extraTraitChance)) {
    const clash = (t: TraitId) => traits.includes(t) || (t === 'coward' && traits.includes('bold')) || (t === 'bold' && traits.includes('coward'));
    const options = TRAIT_IDS.filter((t) => !clash(t));
    if (options.length > 0) traits.push(rng.pick(options));
  }
  return traits;
}

function pickNickname(rng: Rng, state: GameState, species: SpeciesId): string {
  const used = new Set(state.monsters.filter((m) => m.species === species).map((m) => m.nickname));
  const free = NICKNAMES.filter((n) => !used.has(n));
  return rng.pick(free.length > 0 ? free : NICKNAMES);
}

/** 새 손님 (입구에 선다). 단골이면 그 이름·성격 그대로. */
export function createMonster(rng: Rng, state: GameState, id: MonsterId, at: Pt, regular: Regular | null): Monster {
  const hall = state.buildings.hall.level;
  const species = regular?.species ?? pickSpecies(rng, hall);
  const def = SPECIES[species];
  const [w0, w1] = def.wallet;
  const [m0, m1] = MOOD.start;
  const [p0, p1] = TUNE.patience;
  return {
    id,
    species,
    nickname: regular?.nickname ?? pickNickname(rng, state, species),
    traits: regular !== null ? [...regular.traits] : pickTraits(rng, species),
    wallet: rng.int(w0, w1),
    mood: Math.min(100, rng.range(m0, m1) + (regular !== null ? TUNE.regularMoodBonus : 0)),
    patience: rng.int(p0, p1),
    phase: 'arriving',
    pos: { x: at.x, y: at.y },
    facing: -1,
    path: [],
    booth: null,
    seat: null,
    pose: 'base',
    stats: { rounds: 0, wins: 0, jackpots: 0, nearMisses: 0, spent: 0, won: 0 },
    timer: 0,
    cheerCooldown: 0,
    hadJackpot: false,
    mats: rng.int(GUEST_MATS[0], GUEST_MATS[1]),
    born: state.time,
    phaseTime: 0,
    poseTime: 0,
    regular: regular !== null,
  };
}
