// 놀이 결과: 한판을 시작할 때 등급(ODDS 표)과 세부(연출용)를 함께 정한다. 세부는 등급과 늘 맞는다.
//   slot: jackpot = 종 셋, win = 같은 그림 셋(종 아님), nearMiss = 첫째·둘째가 같고 셋째가 한 칸 비껴감, lose = 첫째·둘째가 다름.
//   oddeven: 조약돌 1~9개, 홀짝을 맞히면 win.
//   cups: ballAt = 섞은 뒤 구슬이 있는 자리, picked = 고른 자리. win = 같음, nearMiss = 바로 옆, lose = 반대쪽 끝.
//   darts: dist 0~0.12 jackpot, 0.12~0.45 win, 0.45~0.6 nearMiss, 그 밖 lose (1 이상 = 과녁 밖).
//   wheel: 칸 i = SLOT_SYMBOLS[i]. jackpot = 종(5) 찜·종에 멈춤, win = 찜한 칸(종 아님), nearMiss = 찜한 칸 바로 옆(±1), lose = 두 칸 이상 떨어짐.
//   duck: jackpot = 금 표식, win = 은 표식, nearMiss = 걸었다가 놓침(slipped, 놓친 오리는 금·은), lose = 표식 없음.
//   ring: 걸린 고리 수 jackpot 3, win 2, nearMiss 1 + 마지막 고리가 흔들리다 떨어짐, lose 0~1 (마지막이 흔들리다 떨어진 1은 아님).
//   claw: jackpot = double(둘), win = win(하나), nearMiss = slip(slipAt 0.75~0.95), lose = miss(헛집기).
//   pouch: jackpot = 노랑 주머니(2)의 대박, win = 코인 주머니, nearMiss = 동전 하나, lose = 빈 주머니.
//   race: 손님 하나의 한판으로 부르면 경주 하나를 만들어 선수 하나를 고른다 (경주장이 손님 여럿을 한 경주로 묶기 전까지의 임시 길).

import type { Rng } from '../core/rng.ts';
import { CLAW, DUCK, ODDS, POUCH, RING, SLOT_SYMBOLS, SPECIES_IDS, WHEEL, type BoothId, type OutcomeTier, type SlotSymbol, type SpeciesId } from '../data/defs.ts';
import { generateRace, raceOutcome, RACERS } from './race.ts';
import type { DuckMark, PouchContent, RingThrow, RoundDetail, RoundOutcome } from './types.ts';

const TIERS: readonly OutcomeTier[] = ['jackpot', 'win', 'nearMiss', 'lose'];
type OddsRow = Partial<Record<OutcomeTier, readonly [number, number]>>;

/** 행운(luck)만큼 lose 확률을 win으로 옮긴다. */
function tierWeights(booth: BoothId, luck: number): [OutcomeTier, number][] {
  const row = ODDS[booth] as OddsRow;
  const w = new Map<OutcomeTier, number>();
  for (const t of TIERS) w.set(t, Math.max(0, row[t]?.[0] ?? 0));
  if (luck > 0 && (w.get('win') ?? 0) > 0) {
    const moved = Math.min(luck, w.get('lose') ?? 0);
    w.set('lose', (w.get('lose') ?? 0) - moved);
    w.set('win', (w.get('win') ?? 0) + moved);
  }
  return TIERS.map((t) => [t, w.get(t) ?? 0] as [OutcomeTier, number]).filter(([, v]) => v > 0);
}

export function multiplierOf(booth: BoothId, tier: OutcomeTier): number {
  return (ODDS[booth] as OddsRow)[tier]?.[1] ?? 0;
}

export interface GameCtx {
  /** 부스 레벨 1~3. */
  level: number;
  /** 진행자 진행 1~5. */
  pace: number;
  /** 한판 하는 손님의 종 (인형 뽑기: 자기 인형을 자주 노린다). */
  species?: SpeciesId;
  /** 인형 뽑기 상품으로 나올 종 (없거나 비면 모든 종). sim은 도감에 있는 종을 준다. */
  plushPool?: readonly SpeciesId[];
  /** 경주 시간 (초, race만). */
  raceSec?: number;
}

export function decideOutcome(rng: Rng, booth: BoothId, luck: number, ctx: GameCtx): RoundOutcome {
  if (booth === 'race') return soloRace(rng, luck, ctx);
  const tier = rng.weighted(tierWeights(booth, luck));
  return { tier, multiplier: multiplierOf(booth, tier), detail: makeDetail(rng, booth, tier, ctx) };
}

/** 경주 하나를 만들어 선수 하나에 건다 (행운만큼 1등 선수를 고를 확률이 오른다). */
function soloRace(rng: Rng, luck: number, ctx: GameCtx): RoundOutcome {
  const race = generateRace(rng, ctx.raceSec ?? 10);
  const winner = race.finishOrder[0] ?? 0;
  const racer = luck > 0 && rng.chance(luck) ? winner : rng.pick(RACERS);
  return raceOutcome(race, racer);
}

function makeDetail(rng: Rng, booth: BoothId, tier: OutcomeTier, ctx: GameCtx): RoundDetail {
  switch (booth) {
    case 'slot':
      return { kind: 'slot', reels: slotReels(rng, tier) };
    case 'oddeven':
      return oddEven(rng, tier);
    case 'cups':
      return cups(rng, tier, ctx);
    case 'darts':
      return darts(rng, tier);
    case 'wheel':
      return wheel(rng, tier);
    case 'duck':
      return duck(rng, tier);
    case 'ring':
      return ring(rng, tier);
    case 'claw':
      return claw(rng, tier, ctx);
    case 'pouch':
      return pouch(rng, tier);
    case 'race': {
      // decideOutcome이 먼저 받는다. 여기로 오면 등급에 맞는 선수로 경주를 하나 만든다.
      const race = generateRace(rng, ctx.raceSec ?? 10, tier === 'nearMiss' ? { comeback: false, photo: true } : { comeback: tier === 'jackpot' });
      const at = tier === 'jackpot' || tier === 'win' ? 0 : tier === 'nearMiss' ? 1 : rng.int(2, 3);
      return raceOutcome(race, race.finishOrder[at] ?? 0).detail;
    }
  }
}

const BELL: SlotSymbol = SLOT_SYMBOLS[SLOT_SYMBOLS.length - 1] as SlotSymbol;
const PLAIN: readonly SlotSymbol[] = SLOT_SYMBOLS.slice(0, -1);

function sym(i: number): SlotSymbol {
  const n = SLOT_SYMBOLS.length;
  return SLOT_SYMBOLS[((i % n) + n) % n] as SlotSymbol;
}

function slotReels(rng: Rng, tier: OutcomeTier): [SlotSymbol, SlotSymbol, SlotSymbol] {
  switch (tier) {
    case 'jackpot':
      return [BELL, BELL, BELL];
    case 'win': {
      const s = rng.pick(PLAIN);
      return [s, s, s];
    }
    case 'nearMiss': {
      // 종 둘이 가장 아깝다: 조금 더 자주.
      const s = rng.chance(0.3) ? BELL : rng.pick(PLAIN);
      const i = SLOT_SYMBOLS.indexOf(s);
      return [s, s, sym(i + (rng.chance(0.5) ? 1 : -1))];
    }
    case 'lose': {
      const a = rng.pick(SLOT_SYMBOLS);
      let b = rng.pick(SLOT_SYMBOLS);
      while (b === a) b = rng.pick(SLOT_SYMBOLS);
      // 셋째는 아무거나 (첫째나 둘째와 같아도 lose).
      return [a, b, rng.pick(SLOT_SYMBOLS)];
    }
  }
}

function oddEven(rng: Rng, tier: OutcomeTier): RoundDetail {
  const pebbles = rng.int(1, 9);
  const actual = pebbles % 2 === 1 ? 'odd' : 'even';
  const other = actual === 'odd' ? 'even' : 'odd';
  const won = tier === 'win' || tier === 'jackpot';
  return { kind: 'oddeven', pebbles, guess: won ? actual : other };
}

type Cup = 0 | 1 | 2;
const CUPS: readonly Cup[] = [0, 1, 2];

function cups(rng: Rng, tier: OutcomeTier, ctx: GameCtx): RoundDetail {
  // 부스 레벨·진행자 진행이 높을수록 많이 섞는다 (3~6번).
  const n = Math.max(3, Math.min(6, 3 + (ctx.level - 1) + (ctx.pace >= 4 ? 1 : 0) + rng.int(0, 1)));
  const swaps: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = rng.int(0, 2);
    const b = (a + rng.int(1, 2)) % 3;
    swaps.push([a, b]);
  }
  let ballAt: Cup;
  let picked: Cup;
  if (tier === 'win' || tier === 'jackpot') {
    ballAt = rng.pick(CUPS);
    picked = ballAt;
  } else if (tier === 'nearMiss') {
    ballAt = rng.pick(CUPS);
    picked = ballAt === 1 ? (rng.chance(0.5) ? 0 : 2) : 1;
  } else {
    ballAt = rng.chance(0.5) ? 0 : 2;
    picked = ballAt === 0 ? 2 : 0;
  }
  return { kind: 'cups', ballAt, picked, swaps };
}

function darts(rng: Rng, tier: OutcomeTier): RoundDetail {
  let d: number;
  switch (tier) {
    case 'jackpot':
      d = rng.range(0, 0.11);
      break;
    case 'win':
      d = rng.range(0.13, 0.44);
      break;
    case 'nearMiss':
      d = rng.range(0.46, 0.59);
      break;
    case 'lose':
      d = rng.chance(0.12) ? rng.range(1.02, 1.12) : rng.range(0.62, 0.97);
      break;
  }
  return { kind: 'darts', dist: d, angle: rng.range(0, Math.PI * 2) };
}

function wheel(rng: Rng, tier: OutcomeTier): RoundDetail {
  const n = WHEEL.slices;
  const turns = rng.int(WHEEL.turns[0], WHEEL.turns[1]);
  let picked: number;
  let landed: number;
  switch (tier) {
    case 'jackpot':
      picked = WHEEL.bell;
      landed = WHEEL.bell;
      break;
    case 'win':
      // 종이 아닌 칸 (종은 대박 칸).
      picked = (WHEEL.bell + rng.int(1, n - 1)) % n;
      landed = picked;
      break;
    case 'nearMiss':
      // 종 칸을 찜했다가 옆에서 멈추는 게 가장 아깝다: 조금 더 자주.
      picked = rng.chance(0.3) ? WHEEL.bell : rng.int(0, n - 1);
      landed = (picked + (rng.chance(0.5) ? 1 : n - 1)) % n;
      break;
    case 'lose':
      picked = rng.int(0, n - 1);
      landed = (picked + rng.int(2, n - 2)) % n;
      break;
  }
  return { kind: 'wheel', picked, landed, turns };
}

function duck(rng: Rng, tier: OutcomeTier): RoundDetail {
  const d = rng.int(0, DUCK.ducks - 1);
  const mark: DuckMark = tier === 'jackpot' ? 'gold' : tier === 'win' ? 'silver' : tier === 'nearMiss' ? (rng.chance(0.3) ? 'gold' : 'silver') : 'none';
  return { kind: 'duck', duck: d, mark, slipped: tier === 'nearMiss' };
}

function ring(rng: Rng, tier: OutcomeTier): RoundDetail {
  const n = RING.throws;
  const bottles = rng.shuffle(Array.from({ length: RING.bottles }, (_, i) => i)).slice(0, n);
  const idx = Array.from({ length: n }, (_, i) => i);
  let hits: boolean[];
  switch (tier) {
    case 'jackpot':
      hits = idx.map(() => true);
      break;
    case 'win': {
      const miss = rng.int(0, n - 1);
      hits = idx.map((i) => i !== miss);
      break;
    }
    case 'nearMiss': {
      // 하나는 앞에서 걸고, 마지막 고리가 병목을 돌다 떨어진다.
      const hit = rng.int(0, n - 2);
      hits = idx.map((i) => i === hit);
      break;
    }
    case 'lose': {
      const one = rng.chance(0.4) ? rng.int(0, n - 1) : -1;
      hits = idx.map((i) => i === one);
      break;
    }
  }
  const throws: RingThrow[] = hits.map((hit, i) => ({ bottle: bottles[i] ?? i, hit, wobble: rng.chance(hit ? 0.25 : 0.2) }));
  const last = throws[n - 1] as RingThrow;
  if (tier === 'nearMiss') last.wobble = true;
  // 고리 하나만 걸린 꽝에서 마지막이 흔들리다 떨어지면 아깝다와 같은 모양이 된다: 그냥 빗나가게.
  if (tier === 'lose' && !last.hit && hits.filter((x) => x).length === 1) last.wobble = false;
  return { kind: 'ring', throws };
}

function claw(rng: Rng, tier: OutcomeTier, ctx: GameCtx): RoundDetail {
  const pool: readonly SpeciesId[] = ctx.plushPool !== undefined && ctx.plushPool.length > 0 ? ctx.plushPool : SPECIES_IDS;
  const target = ctx.species !== undefined && rng.chance(CLAW.ownChance) ? ctx.species : rng.pick(pool);
  const x = rng.range(0.15, 0.85);
  switch (tier) {
    case 'jackpot':
      return { kind: 'claw', x, target, target2: rng.pick(pool), result: 'double', slipAt: 1 };
    case 'win':
      return { kind: 'claw', x, target, target2: null, result: 'win', slipAt: 1 };
    case 'nearMiss':
      return { kind: 'claw', x, target, target2: null, result: 'slip', slipAt: rng.range(0.75, 0.95) };
    case 'lose':
      return { kind: 'claw', x, target, target2: null, result: 'miss', slipAt: 0 };
  }
}

function pouch(rng: Rng, tier: OutcomeTier): RoundDetail {
  const content: PouchContent = tier === 'jackpot' ? 'jackpot' : tier === 'win' ? 'coins' : tier === 'nearMiss' ? 'one' : 'empty';
  const pick = tier === 'jackpot' ? POUCH.gold : rng.int(0, POUCH.pouches.length - 1);
  return { kind: 'pouch', pick, content };
}
