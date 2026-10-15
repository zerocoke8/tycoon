// 몬스터 경주장의 경주 (순수 함수: Rng만 쓴다, 화면·상태를 모른다).
// 결과(들어온 순서·결승 시각·역전·사진 판정)를 먼저 정하고, 그 결과로 끝나는 키프레임(선수마다 시각별 진행)을 만든다.
// 중간 키에서는 순위가 몇 번 바뀐다 (흔들림). 역전 경주는 1등 선수가 RACE.comebackAt 지점에서 꼴찌다.
// 화면은 raceProgress(result, 선수, 초)로 선수 자리를, raceStandings로 지금 순위를 읽는다.
// 손님마다의 등급은 raceOutcome(result, 건 선수): 1등 win(역전이면 jackpot), 사진 판정 2등 nearMiss, 나머지 lose.
// 경주장의 흐름(모이기·출발·응원)은 단체 놀이 엔진 (sim/group/race.ts 모듈, sim.ts). 오리배 경주도 같은 경주를 쓴다 (sim/group/boat.ts).

import type { Rng } from '../core/rng.ts';
import { ODDS, RACE, type OutcomeTier } from '../data/defs.ts';
import type { RaceKey, RaceResult, RacerIndex, RoundOutcome } from './types.ts';

export const RACERS: readonly RacerIndex[] = [0, 1, 2, 3];

/** 중간 키 시각 (1등 결승 시각의 비율). 역전 지점(RACE.comebackAt)이 꼭 들어 있다. */
const SAMPLES: readonly number[] = [0.12, 0.26, 0.41, 0.56, RACE.comebackAt, 0.86];
const COMEBACK_KEY = SAMPLES.indexOf(RACE.comebackAt);
/** RaceResult.keys[선수]에서 역전 지점 키의 index (0번 키는 출발 0초). */
export const COMEBACK_KEY_INDEX = COMEBACK_KEY + 1;
/** 흔들림 세기 (진행 비율). */
const WOBBLE = 0.06;
/** 가장 느릴 때의 빠르기 (그 선수 평균의 비율): 뒤로 가거나 멈추지 않게. */
const MIN_SPEED = 0.35;
/** 마지막 선수가 들어오고 결과를 보여 주는 여유 (경주 시간의 비율 안쪽). */
const LAST_AT = 0.985;

export interface RaceOptions {
  /** 역전 경주로 만들기 (없으면 RACE.comebackChance). */
  readonly comeback?: boolean;
  /** 사진 판정 경주로 만들기 (없으면 RACE.photoChance). */
  readonly photo?: boolean;
  /** 1등 선수를 정해 두기 (행운: 손님 선수가 1등). 없으면 고르게. */
  readonly winner?: RacerIndex;
}

/** duration초 경주 하나 (모든 선수가 duration 안에 들어온다). */
export function generateRace(rng: Rng, duration: number, opts: RaceOptions = {}): RaceResult {
  const D = Math.max(3, duration);
  const order = rng.shuffle([...RACERS]);
  if (opts.winner !== undefined && RACERS.includes(opts.winner)) {
    order.splice(order.indexOf(opts.winner), 1);
    order.unshift(opts.winner);
  }
  const comeback = opts.comeback ?? rng.chance(RACE.comebackChance);
  const photo = opts.photo ?? rng.chance(RACE.photoChance);

  // 결승 시각: 1등 → 2등(사진 판정이면 아주 가깝게) → 3·4등.
  const f1 = D * rng.range(RACE.winnerAt[0], RACE.winnerAt[1]);
  const gaps = [
    photo ? rng.range(0.02, RACE.photoMargin * 0.9) : rng.range(RACE.photoMargin + 0.15, 0.7),
    rng.range(0.12, 0.6),
    rng.range(0.1, 0.6),
  ];
  const room = D * LAST_AT - f1;
  const total = gaps[0]! + gaps[1]! + gaps[2]!;
  if (total > room) {
    const k = room / total;
    for (let i = 0; i < gaps.length; i++) gaps[i] = gaps[i]! * k;
    // 사진 판정이 아닌데 줄이다가 사진 판정 차이가 되면 안 된다.
    if (!photo && gaps[0]! <= RACE.photoMargin + 0.03) {
      gaps[0] = RACE.photoMargin + 0.05;
      const rest = Math.max(0.1, room - gaps[0]);
      const r = rest / (gaps[1]! + gaps[2]!);
      gaps[1] = gaps[1]! * r;
      gaps[2] = gaps[2]! * r;
    }
  }
  const finishAt = [0, 0, 0, 0];
  let t = f1;
  order.forEach((r, i) => {
    if (i > 0) t += gaps[i - 1]!;
    finishAt[r] = t;
  });

  // 중간 키: 평균 빠르기 + 부드러운 흔들림 (출발·결승에서 0).
  const times = SAMPLES.map((f) => f * f1);
  const prog: number[][] = RACERS.map((r) => {
    const F = finishAt[r]!;
    let n = 0;
    return times.map((tk, k) => {
      n = n * 0.55 + rng.range(-1, 1) * 0.8;
      const env = Math.sin(Math.PI * (SAMPLES[k] ?? 0));
      return tk / F + n * WOBBLE * env;
    });
  });

  const winner = order[0] as RacerIndex;
  const w = prog[winner]!;
  const lowestOther = (k: number): number => Math.min(...RACERS.filter((r) => r !== winner).map((r) => prog[r]![k]!));
  if (comeback) {
    // 역전 지점에서 1등 선수를 꼴찌로.
    w[COMEBACK_KEY] = Math.min(w[COMEBACK_KEY]!, lowestOther(COMEBACK_KEY) - rng.range(0.015, 0.035));
  } else if (w[COMEBACK_KEY]! <= lowestOther(COMEBACK_KEY)) {
    // 저절로 역전 모양이 되었으면 꼴찌는 면하게.
    const others = RACERS.filter((r) => r !== winner)
      .map((r) => prog[r]![COMEBACK_KEY]!)
      .sort((a, b) => a - b);
    w[COMEBACK_KEY] = (others[0]! + others[1]!) / 2;
  }

  // 키를 앞뒤로 다듬는다: 늘 앞으로 (가장 느려도 MIN_SPEED), 결승 전에는 1 미만.
  const minStep = (r: RacerIndex, dt: number): number => (MIN_SPEED * dt) / finishAt[r]!;
  const lowerBefore = (r: RacerIndex, from: number): void => {
    const p = prog[r]!;
    for (let k = from - 1; k >= 0; k--) p[k] = Math.min(p[k]!, p[k + 1]! - minStep(r, times[k + 1]! - times[k]!));
  };
  const raiseAfter = (r: RacerIndex, from: number): void => {
    const p = prog[r]!;
    let prev = from > 0 ? p[from - 1]! : 0;
    let prevT = from > 0 ? times[from - 1]! : 0;
    for (let k = from; k < p.length; k++) {
      const tk = times[k]!;
      p[k] = Math.min(1 - minStep(r, finishAt[r]! - tk), Math.max(p[k]!, prev + minStep(r, tk - prevT)));
      prev = p[k]!;
      prevT = tk;
    }
  };
  for (const r of RACERS) {
    // 역전 지점 값을 지키려고 그 앞은 뒤에서부터 낮춘 다음 앞에서부터 다듬는다.
    lowerBefore(r, COMEBACK_KEY);
    raiseAfter(r, 0);
  }
  // 다듬은 뒤에도 역전 모양이 정한 대로인지 확인하고 맞춘다 (역전 = 1등 선수가 그 지점에서 혼자 꼴찌).
  const low = lowestOther(COMEBACK_KEY);
  if (comeback && !(w[COMEBACK_KEY]! < low)) {
    w[COMEBACK_KEY] = low - 0.01;
    lowerBefore(winner, COMEBACK_KEY);
  } else if (!comeback && w[COMEBACK_KEY]! < low) {
    const others = RACERS.filter((r) => r !== winner)
      .map((r) => prog[r]![COMEBACK_KEY]!)
      .sort((a, b) => a - b);
    w[COMEBACK_KEY] = (others[0]! + others[1]!) / 2;
    raiseAfter(winner, COMEBACK_KEY + 1);
  }

  const keys: RaceKey[][] = RACERS.map((r) => [{ t: 0, p: 0 }, ...times.map((tk, k) => ({ t: tk, p: prog[r]![k]! })), { t: finishAt[r]!, p: 1 }]);
  return {
    keys,
    finishOrder: order as RacerIndex[],
    finishAt,
    comeback,
    photoFinish: photo,
    margin: finishAt[order[1] as RacerIndex]! - f1,
  };
}

/** 선수 racer의 t초 진행 (0~1). 키 사이는 단조 3차 보간 (뒤로 가지 않고 부드럽게). */
export function raceProgress(result: RaceResult, racer: RacerIndex, t: number): number {
  const keys = result.keys[racer];
  if (keys === undefined || keys.length === 0) return 0;
  const last = keys[keys.length - 1]!;
  if (t <= 0) return 0;
  if (t >= last.t) return 1;
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1]!.t) i++;
  const a = keys[i]!;
  const b = keys[i + 1]!;
  const h = b.t - a.t;
  if (h <= 0) return b.p;
  const m0 = tangent(keys, i);
  const m1 = tangent(keys, i + 1);
  const s = (t - a.t) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  const v = (2 * s3 - 3 * s2 + 1) * a.p + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * b.p + (s3 - s2) * h * m1;
  return Math.max(a.p, Math.min(b.p, v));
}

/** 키 i의 기울기 (Fritsch–Carlson: 넘치지 않는 단조 보간). */
function tangent(keys: readonly RaceKey[], i: number): number {
  const sec = (j: number): number => {
    const a = keys[j]!;
    const b = keys[j + 1]!;
    return (b.p - a.p) / Math.max(1e-6, b.t - a.t);
  };
  const n = keys.length;
  if (i === 0) return sec(0);
  if (i === n - 1) return sec(n - 2);
  const d0 = sec(i - 1);
  const d1 = sec(i);
  if (d0 <= 0 || d1 <= 0) return 0;
  // 조화 평균 (가파른 쪽으로 넘치지 않게).
  return (2 * d0 * d1) / (d0 + d1);
}

/** t초의 순위 (앞선 선수부터). 결승에 들어온 선수는 들어온 순서대로 앞. */
export function raceStandings(result: RaceResult, t: number): RacerIndex[] {
  const done = result.finishOrder.filter((r) => (result.finishAt[r] ?? Infinity) <= t);
  const running = RACERS.filter((r) => !done.includes(r)).sort((a, b) => raceProgress(result, b, t) - raceProgress(result, a, t));
  return [...done, ...running];
}

/** 선수 racer의 등수 (1~4). */
export function racePlace(result: RaceResult, racer: RacerIndex): number {
  return result.finishOrder.indexOf(racer) + 1;
}

/** 선수 racer에 건 손님의 결과: 1등 win (역전이면 jackpot), 사진 판정 2등 nearMiss, 나머지 lose. */
export function raceTier(result: RaceResult, racer: RacerIndex): OutcomeTier {
  const place = racePlace(result, racer);
  if (place === 1) return result.comeback ? 'jackpot' : 'win';
  if (place === 2 && result.photoFinish) return 'nearMiss';
  return 'lose';
}

/** 출발 신호의 진행(1~5)으로 줄어드는 대기 배수 (진행 3 = 1, 1점마다 RACE.gatherPacePerPoint, RACE.gatherMinFrac까지). */
function paceFactor(pace: number): number {
  return Math.max(RACE.gatherMinFrac, 1 - (pace - 3) * RACE.gatherPacePerPoint);
}

/** 첫 손님이 앉고 출발까지 초. */
export function raceGatherSec(pace: number): number {
  return RACE.gatherSec * paceFactor(pace);
}

/** 둘 이상 모였을 때 출발까지 초 (이보다 많이 남았으면 줄인다). */
export function raceStartSoonSec(pace: number): number {
  return RACE.startSoonSec * paceFactor(pace);
}

/** 손님이 응원할 선수: 좋아하는 선수가 있는 종(RACE.fans)은 RACE.fanChance로 그 선수, 아니면 고르게. */
export function pickRacer(rng: Rng, species: string): RacerIndex {
  const fan = (RACE.fans as Readonly<Record<string, number>>)[species];
  if (fan !== undefined && RACERS.includes(fan as RacerIndex) && rng.chance(RACE.fanChance)) return fan as RacerIndex;
  return rng.pick(RACERS);
}

/** 선수 racer에 건 손님 한판 (booth = 'race' 경주장, 'boat' 오리배: 배당은 그 부스의 ODDS, 세부 kind도 그 부스). */
export function raceOutcome(result: RaceResult, racer: RacerIndex, booth: 'race' | 'boat' = 'race'): RoundOutcome {
  const tier = raceTier(result, racer);
  const row = ODDS[booth] as Partial<Record<OutcomeTier, readonly [number, number]>>;
  return {
    tier,
    multiplier: row[tier]?.[1] ?? 0,
    detail: { kind: booth, racer, place: racePlace(result, racer), comeback: result.comeback, photoFinish: result.photoFinish },
  };
}
