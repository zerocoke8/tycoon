// 편 대 편 겨루기의 타임라인 (씨름 p(t), 줄다리기 c(t)가 같이 쓴다. 순수: Rng만).
// 값 v(t) ∈ [-1, 1]: +1 = 홍(편 0)이 이김, -1 = 청(편 1)이 이김. end초에 이긴 편 쪽 ±1에 닿고, 그 전에는 ±1에 닿지 않는다.
// 앞부분은 밀고 밀리는 흔들림, closeFrom(end의 비율)부터 끝까지는 결과 모양:
//   보통 판: 이긴 편이 줄곧 앞선다 (부호 = 이긴 편).
//   close (진 편 nearMiss): 진 편이 closeFrom 뒤에 앞서다가 막판에 뒤집힌다.
//   flip (이긴 편 jackpot, close 포함): 이긴 편이 brink 너머까지 밀렸다가 뒤집는다.
// 사건: lead (앞선 편이 바뀜, 0.06 넘게), brink (한 편이 0.75 넘게 밀림, 편마다 한 번), flip (뒤집기 시작), finish (end).

import type { Rng } from '../../core/rng.ts';
import type { GroupEvent, GroupKey, GroupSide } from '../types.ts';
import { trackAt } from './core.ts';

export interface DuelOpts {
  /** 이긴 편. */
  readonly winner: GroupSide;
  /** 승부가 나는 때 (초). */
  readonly end: number;
  /** 흔들림 키 간격 (초). */
  readonly step: number;
  /** 흔들림 세기 (0~1). */
  readonly amp: number;
  readonly close: boolean;
  readonly flip: boolean;
  /** 결과 모양이 시작되는 때 (end의 비율). */
  readonly closeFrom: number;
  /** 뒤집기 판에서 이긴 편이 밀리는 깊이 (이보다 더). */
  readonly brink: number;
}

/** 앞섰다고 보는 값 (이보다 작으면 팽팽). */
export const DUEL_LEAD = 0.06;
/** 질 뻔했다고 보는 값. */
export const DUEL_BRINK = 0.75;
/** lead 사건 사이 최소 초. */
const LEAD_GAP = 0.8;

/** 편 쪽 부호 (+1 홍, -1 청). */
export const sideSign = (side: GroupSide): 1 | -1 => (side === 0 ? 1 : -1);

/** 키프레임과 사건. */
export function duelTimeline(rng: Rng, o: DuelOpts): { keys: GroupKey[]; events: GroupEvent[]; flipAt: number } {
  const s = sideSign(o.winner);
  const E = o.end;
  const tail = o.closeFrom * E;
  const keys: GroupKey[] = [{ t: 0, p: 0 }];
  // 앞부분: 평균으로 돌아가는 흔들림 (±0.55 안).
  let v = 0;
  for (let t = o.step; t < tail - o.step * 0.5; t += o.step * rng.range(0.8, 1.2)) {
    v = Math.max(-0.55, Math.min(0.55, v * 0.5 + rng.range(-1, 1) * o.amp));
    keys.push({ t, p: v });
  }
  const at = (f: number): number => tail + (E - tail) * f;
  let flipAt = -1;
  if (o.flip) {
    keys.push({ t: tail, p: -s * rng.range(0.3, 0.5) });
    keys.push({ t: at(0.35), p: -s * rng.range(o.brink + 0.04, 0.92) });
    flipAt = at(0.62);
    keys.push({ t: flipAt, p: -s * rng.range(o.brink + 0.03, 0.94) });
  } else if (o.close) {
    keys.push({ t: tail, p: -s * rng.range(0.2, 0.45) });
    flipAt = at(0.62);
    keys.push({ t: flipAt, p: -s * rng.range(0.3, 0.6) });
  } else {
    keys.push({ t: tail, p: s * rng.range(0.12, 0.35) });
    keys.push({ t: at(0.55), p: s * rng.range(0.38, 0.68) });
  }
  keys.push({ t: E, p: s });

  // 사건: 0.1초 간격으로 훑는다.
  const events: GroupEvent[] = [];
  let leader = -1;
  let leadAt = -Infinity;
  const brinked = [false, false];
  for (let t = 0.1; t < E - 1e-6; t += 0.1) {
    const p = trackAt(keys, t);
    const side = p > DUEL_LEAD ? 0 : p < -DUEL_LEAD ? 1 : -1;
    if (side >= 0 && side !== leader && t - leadAt >= LEAD_GAP && t >= 0.5) {
      events.push({ t, type: 'lead', actor: side, prev: leader });
      leader = side;
      leadAt = t;
    }
    // 밀리는 편 = 앞선 편의 반대.
    const danger = p >= DUEL_BRINK ? 1 : p <= -DUEL_BRINK ? 0 : -1;
    if (danger >= 0 && !brinked[danger]) {
      brinked[danger] = true;
      events.push({ t, type: 'brink', actor: danger });
    }
  }
  if (o.flip && flipAt > 0) events.push({ t: flipAt, type: 'flip', actor: o.winner });
  events.push({ t: E, type: 'finish', actor: o.winner });
  events.sort((a, b) => a.t - b.t);
  return { keys, events, flipAt };
}

/** 씨름·줄다리기 응원: 앞서거나 뒤집는 편 = lead, 밀리거나 뒤처진 편 = behind. 끝(finish)은 결과 반응이 곧 오니 없다. */
export function duelCheer(pick: number, ev: GroupEvent): 'lead' | 'behind' | null {
  switch (ev.type) {
    case 'lead':
    case 'flip':
      return pick === ev.actor ? 'lead' : 'behind';
    case 'brink':
      return pick === ev.actor ? 'behind' : 'lead';
    default:
      return null;
  }
}
