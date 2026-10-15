// 단체 놀이 모듈: 줄다리기. 손님이 홍(자리 짝수)·청(홀수) 편에 서서 줄을 잡고 자기 편에 건다.
// 자리 고르기: 사람이 적은 편으로 (같으면 같은 종 친구가 있는 편, 그다음 무작위), 편 안에서는 밧줄 가운데에 가까운 자리부터.
// 출발: 편마다 TUG.minSide 이상 (편 인원은 맞춘다: lineup이 많은 편의 늦게 온 손님을 다음 판으로). 판: 밧줄 가운데 c(t) (sim/group/duel.ts).
// 등급 (편마다 같다): 이긴 편 win (역전승이면 jackpot ×3), 마지막 20%까지 이기다 진 편 nearMiss, 나머지 lose. 배당 ODDS.tug.
// 구경꾼 들썩임: 선 바로 앞(brink) = 어머나, 역전(flip) = 환호, 앞선 편이 바뀜 = 박수.

import { TUG } from '../../data/defs.ts';
import { TUG_FIELD } from '../../data/map.ts';
import type { GroupEntry, GroupPlay, GroupSide, Monster } from '../types.ts';
import { groupOutcome, pollTimeline, type GroupGame } from './core.ts';
import { duelCheer, duelTimeline } from './duel.ts';

const sideOf = (e: GroupEntry): GroupSide => (e.pick === 1 ? 1 : 0);
const count = (es: readonly GroupEntry[], side: GroupSide): number => es.filter((e) => sideOf(e) === side).length;

/** 이번 판에 줄을 잡을 손님: 편마다 같은 수 (많아야 TUG.maxSide), 먼저 온 손님부터. 순서는 그대로. */
export function tugLineup(es: readonly GroupEntry[]): GroupEntry[] {
  const n = Math.min(count(es, 0), count(es, 1), TUG.maxSide);
  const took = [0, 0];
  return es.filter((e) => {
    const s = sideOf(e);
    if ((took[s] ?? 0) >= n) return false;
    took[s] = (took[s] ?? 0) + 1;
    return true;
  });
}

/** 줄다리기 자리: 적은 편의 가운데에 가까운 빈 자리 (자리 번호가 작을수록 가운데). 같으면 같은 종 친구 편, 그다음 무작위. */
export function tugSeat(pickSide: () => GroupSide, m: Monster, free: readonly number[], seated: readonly (Monster | null)[]): number {
  const n = [0, 0];
  const kin = [0, 0];
  seated.forEach((o, i) => {
    if (o === null) return;
    n[i % 2] = (n[i % 2] ?? 0) + 1;
    if (o.species === m.species) kin[i % 2] = (kin[i % 2] ?? 0) + 1;
  });
  const open = (s: number): number[] => free.filter((i) => i % 2 === s);
  let side: GroupSide = (n[0] ?? 0) < (n[1] ?? 0) ? 0 : (n[1] ?? 0) < (n[0] ?? 0) ? 1 : (kin[0] ?? 0) > (kin[1] ?? 0) ? 0 : (kin[1] ?? 0) > (kin[0] ?? 0) ? 1 : pickSide();
  if (open(side).length === 0) side = side === 0 ? 1 : 0;
  return open(side)[0] ?? free[0] ?? 0;
}

export const TUG_GAME: GroupGame = {
  booth: 'tug',
  picks: 2,
  center: TUG_FIELD.center,
  // 홍은 오른쪽(밧줄 가운데)을, 청은 왼쪽을 본다.
  face: (seat) => (seat < 0 ? TUG_FIELD.center : seat % 2 === 0 ? { x: TUG_FIELD.center.x + 400, y: TUG_FIELD.center.y } : { x: TUG_FIELD.center.x - 400, y: TUG_FIELD.center.y }),
  watchPoint: (rng) => ({ x: rng.range(6960, 7740), y: rng.range(5400, 5490) }),
  seatFor: (rng, m, free, seated) => tugSeat(() => (rng.chance(0.5) ? 0 : 1), m, free, seated),
  join: (_rng, seat) => ({ pick: seat % 2, role: 'player' }),
  // 편마다 둘이면 곧. 한참(TUG.soloAfterSec) 기다려도 안 차면 한 명씩이라도.
  readiness: (es, waited) => {
    const n = Math.min(count(es, 0), count(es, 1));
    return n >= TUG.minSide ? 'soon' : n >= 1 && waited >= TUG.soloAfterSec ? 'ok' : 'none';
  },
  lineup: tugLineup,
  generate: (rng, entries, ctx) => {
    const lucky = ctx.lucky >= 0 ? entries[ctx.lucky] : undefined;
    const winner: GroupSide = lucky !== undefined ? sideOf(lucky) : rng.chance(0.5) ? 0 : 1;
    const comeback = rng.chance(TUG.comebackChance);
    const close = comeback || rng.chance((TUG.closeChance - TUG.comebackChance) / (1 - TUG.comebackChance));
    const crossAt = ctx.duration * rng.range(TUG.crossAt[0], TUG.crossAt[1]);
    const { keys, events } = duelTimeline(rng, { winner, end: crossAt, step: 0.85, amp: 0.32, close, flip: comeback, closeFrom: TUG.closeFrom, brink: TUG.brink });
    const outcomes = entries.map((e) => {
      const side = sideOf(e);
      const won = side === winner;
      const tier = won ? (comeback ? 'jackpot' : 'win') : close ? 'nearMiss' : 'lose';
      return groupOutcome('tug', tier, { kind: 'tug', side, won, comeback, close });
    });
    const play: GroupPlay = { kind: 'tug', winner, comeback, close, crossAt, sizes: [count(entries, 0), count(entries, 1)], end: ctx.duration, tracks: [keys], events, outcomes };
    return play;
  },
  poll: pollTimeline,
  cheer: (_play, e, ev) => duelCheer(e.pick, ev),
  crowd: (play, entries) => {
    if (play.kind !== 'tug') return { tier: 'win', star: -1 };
    return { tier: play.comeback ? 'jackpot' : play.close ? 'nearMiss' : 'win', star: entries.findIndex((e) => sideOf(e) === play.winner) };
  },
  buzz: (_play, ev, entries) => {
    const star = entries.findIndex((e) => e.pick === ev.actor);
    switch (ev.type) {
      case 'flip':
        return { kind: 'wow', star };
      case 'brink':
        return { kind: 'gasp', star };
      case 'lead':
        return (ev.prev ?? -1) >= 0 ? { kind: 'cheer', star } : null;
      default:
        return null;
    }
  },
};
