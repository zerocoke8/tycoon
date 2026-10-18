// 단체 놀이 모듈: 밀어내기 대결장 (key ssireum). 손님 둘(자리 0 홍·1 청)이 직접 겨루고 (자기에게 건다), 구경 손님(자리 2~5)은 홍·청에 건다.
// 자리 고르기: 대담이는 선수로 잘 나서고 겁쟁이·구경꾼·떠다니는 종은 구경 자리로 (상대가 기다리고 있으면 더 잘 나선다, SSIREUM.wrestle).
// 구경 손님의 편: 같은 종 선수 쪽, 구경꾼 성격은 사람 많은 쪽, 대담이는 적은 쪽 (core.ts crowdPick).
// 출발: 선수 둘이 다 와야 (구경 손님은 없어도 된다). 판: 미는 힘 p(t) (sim/group/duel.ts), throwAt에 넘어뜨린다.
// 등급 (편마다 같다): 이긴 편 win (뒤집기면 jackpot ×3), 막판까지 이기다 진 편 nearMiss, 나머지 lose. 배당 ODDS.ssireum.
// 구경꾼 들썩임: 질 뻔함(brink) = 어머나, 뒤집기(flip) = 환호, 앞선 편이 바뀜 = 박수.

import { SPECIES, SSIREUM } from '../../data/defs.ts';
import type { GroupEntry, GroupPlay, GroupSide, Monster } from '../types.ts';
import { villageOf } from '../village.ts';
import { crowdPick, eagerness, groupOutcome, pollTimeline, type GroupGame } from './core.ts';
import { duelCheer, duelTimeline } from './duel.ts';

/** 선수 둘이 다 왔나. */
const hasPlayers = (es: readonly GroupEntry[]): boolean => es.some((e) => e.role === 'player' && e.pick === 0) && es.some((e) => e.role === 'player' && e.pick === 1);

/** 편 side의 선수 참가 (없으면 undefined). */
const playerOf = (es: readonly GroupEntry[], side: number): GroupEntry | undefined => es.find((e) => e.role === 'player' && e.pick === side);

export const SSIREUM_GAME: GroupGame = {
  booth: 'ssireum',
  picks: 2,
  center: (st) => villageOf(st).ring().center,
  // 선수는 서로 마주 보고, 구경 손님은 모래판 가운데를 본다.
  face: (st, seat) => {
    const v = villageOf(st);
    const c = v.ring().center;
    const seats = v.booth('ssireum').seats;
    return seat === 0 ? (seats[1] ?? c) : seat === 1 ? (seats[0] ?? c) : c;
  },
  // 모래판 둘레 앞쪽.
  watchPoint: (st, rng) => {
    const R = villageOf(st).ring();
    const a = rng.range(0.12, 0.88) * Math.PI;
    return { x: R.center.x + Math.cos(a) * (R.rx + 170), y: R.center.y + Math.sin(a) * (R.ry + 120) };
  },
  seatFor: (rng, m, free, seated) => {
    const ring = free.filter((s) => s <= 1);
    const side = free.filter((s) => s >= 2);
    if (ring.length === 0 || side.length === 0) return rng.pick(ring.length > 0 ? ring : side);
    // 상대가 이미 모래판에 있으면 더 잘 나선다 (판이 열리게).
    const waiting = (seated[0] ?? null) !== null || (seated[1] ?? null) !== null;
    const w = SSIREUM.wrestle;
    const p = eagerness(m, w.base + (waiting ? w.waiting : 0), w, SPECIES[m.species].floats);
    return rng.chance(p) ? rng.pick(ring) : rng.pick(side);
  },
  join: (rng, seat, m, entries, who) => {
    if (seat <= 1) return { pick: seat, role: 'player' };
    const own = (side: number): Monster | undefined => {
      const e = playerOf(entries, side);
      return e === undefined ? undefined : who?.(e.monster);
    };
    return { pick: crowdPick(rng, m, entries.filter((e) => e.role === 'bettor'), [0, 1], own), role: 'bettor' };
  },
  readiness: (es) => (hasPlayers(es) ? 'soon' : 'none'),
  // 상대가 SSIREUM.stepInSec 넘게 오지 않으면 구경 손님이 모래판으로 나선다 (겁쟁이가 아닌 손님 먼저, 먼저 온 손님부터).
  stepIn: (es, waited, free, who) => {
    if (waited < SSIREUM.stepInSec) return null;
    const ring = free.find((s) => s <= 1);
    if (ring === undefined) return null;
    const bettors = es.map((e, i) => ({ e, i })).filter((x) => x.e.role === 'bettor');
    const brave = bettors.find((x) => who(x.e.monster)?.traits.includes('coward') !== true) ?? bettors[0];
    return brave === undefined ? null : { index: brave.i, seat: ring, pick: ring, role: 'player' };
  },
  generate: (rng, entries, ctx) => {
    const lucky = ctx.lucky >= 0 ? entries[ctx.lucky] : undefined;
    const winner: GroupSide = lucky !== undefined ? (lucky.pick === 1 ? 1 : 0) : rng.chance(0.5) ? 0 : 1;
    const flip = rng.chance(SSIREUM.flipChance);
    const close = flip || rng.chance((SSIREUM.closeChance - SSIREUM.flipChance) / (1 - SSIREUM.flipChance));
    const throwAt = ctx.duration * rng.range(SSIREUM.throwAt[0], SSIREUM.throwAt[1]);
    const { keys, events } = duelTimeline(rng, { winner, end: throwAt, step: 0.55, amp: 0.42, close, flip, closeFrom: SSIREUM.closeFrom, brink: SSIREUM.brink });
    const outcomes = entries.map((e) => {
      const side: GroupSide = e.pick === 1 ? 1 : 0;
      const won = side === winner;
      const tier = won ? (flip ? 'jackpot' : 'win') : close ? 'nearMiss' : 'lose';
      return groupOutcome('ssireum', tier, { kind: 'ssireum', side, role: e.role, won, flip, close });
    });
    const play: GroupPlay = { kind: 'ssireum', winner, flip, close, throwAt, end: ctx.duration, tracks: [keys], events, outcomes };
    return play;
  },
  poll: pollTimeline,
  cheer: (_play, e, ev) => duelCheer(e.pick, ev),
  crowd: (play, entries) => {
    if (play.kind !== 'ssireum') return { tier: 'win', star: -1 };
    const star = entries.findIndex((e) => e.role === 'player' && e.pick === play.winner);
    return { tier: play.flip ? 'jackpot' : play.close ? 'nearMiss' : 'win', star: star >= 0 ? star : entries.findIndex((e) => e.pick === play.winner) };
  },
  buzz: (_play, ev, entries) => {
    const star = (side: number): number => {
      const i = entries.findIndex((e) => e.role === 'player' && e.pick === side);
      return i >= 0 ? i : entries.findIndex((e) => e.pick === side);
    };
    switch (ev.type) {
      case 'flip':
        return { kind: 'wow', star: star(ev.actor) };
      case 'brink':
        // 밀리는 편의 선수가 주인공 (모래판 끝에서 버틴다).
        return { kind: 'gasp', star: star(ev.actor) };
      case 'lead':
        // 처음 앞선 것은 빼고, 앞선 편이 바뀔 때만.
        return (ev.prev ?? -1) >= 0 ? { kind: 'cheer', star: star(ev.actor) } : null;
      default:
        return null;
    }
  },
};
