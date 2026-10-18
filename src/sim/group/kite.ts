// 단체 놀이 모듈: 연날리기 대회. 연 넷이 늘 난다 (자리 0~3 = 날리는 손님, 자기 연에 건다. 빈 자리의 연은 말뚝에 묶여 난다),
// 구경 손님(자리 4·5)은 연 하나에 건다. 연싸움(tangle) 끝에 연줄이 하나씩 끊어지고(cut) 마지막 연이 이긴다.
// 자리 고르기: 대개 연을 날리러 나서고, 겁쟁이·구경꾼은 구경 자리로 (KITE.fly). 구경 손님의 연: 같은 종이 날리는 연, 구경꾼은 사람 많은 연, 대담이는 적은 연.
// 구경꾼 들썩임: 연싸움(tangle)·끊길 뻔함(brink) = 어머나, 끊김(cut) = 박수, 마지막 연싸움에서 끊김 = 환호.
// 등급: 이긴 연 win ×3.2 (끊길 뻔했다 살아남으면 jackpot ×5), 끝나기 직전에 끊긴 마지막에서 두 번째 연 nearMiss, 나머지 lose. 배당 ODDS.kite.
// tracks[2k] = 연 k 높이 (0~1), tracks[2k+1] = 좌우 (KITE_GEO.sway px 단위: 보통 -1~1, 연싸움 때는 상대 연 쪽으로 더 간다). 끊긴 연의 키는 cutAt에서 끝난다.

import type { Rng } from '../../core/rng.ts';
import { KITE, SPECIES } from '../../data/defs.ts';
import { KITE_GEO } from '../../data/catalog.ts';
import type { GroupEntry, GroupEvent, GroupKey, GroupPlay, Monster } from '../types.ts';
import { villageOf } from '../village.ts';
import { crowdPick, eagerness, groupOutcome, pollTimeline, type GroupGame } from './core.ts';

const N = KITE.kites.length;
/** 날리는 자리 사이 (세계 px)를 sway 단위로: 연싸움 때 두 연이 가운데에서 만나게. */
const SPOT_GAP = (() => {
  const f = KITE_GEO.flyers;
  const a = f[0];
  const b = f[1];
  return a !== undefined && b !== undefined ? Math.abs(b.x - a.x) / KITE_GEO.sway : 1.4;
})();
/** 연싸움이 끊기기 전 몇 초 동안. */
const TANGLE_SEC: readonly [number, number] = [1.0, 1.4];

interface Fight {
  /** 끊긴 연, 끊은 연. */
  readonly a: number;
  readonly b: number;
  readonly tangleAt: number;
  readonly cutAt: number;
  /** 연싸움 높이. */
  readonly h: number;
}

/** 연 하나의 키 (시각 순서로 다듬는다: 너무 가까운 흔들림 키는 뺀다). */
function kiteKeys(rng: Rng, k: number, fights: readonly Fight[], end: number): { h: GroupKey[]; s: GroupKey[] } {
  const anchors: { t: number; h: number; s: number; fixed: boolean }[] = [];
  let until = end;
  for (const f of fights) {
    if (f.a !== k && f.b !== k) continue;
    const other = f.a === k ? f.b : f.a;
    const dir = Math.sign(other - k) || 1;
    // 두 연이 가운데에서 만나 엇갈린다.
    const meet = (Math.abs(other - k) * SPOT_GAP) / 2;
    anchors.push({ t: f.tangleAt, h: f.h, s: dir * meet * 0.85, fixed: true });
    anchors.push({ t: f.cutAt, h: f.h + (f.a === k ? 0.04 : 0), s: dir * meet * 1.08, fixed: true });
    if (f.a === k) until = f.cutAt;
    // 끊은 연은 제자리로 (곧 다음 연싸움이 있으면 그대로 간다).
    else if (f.cutAt + 0.8 < end && !fights.some((g) => g !== f && (g.a === k || g.b === k) && g.tangleAt > f.cutAt && g.tangleAt < f.cutAt + 1.3)) anchors.push({ t: f.cutAt + 0.8, h: rng.range(0.6, 0.9), s: rng.range(-0.3, 0.3), fixed: true });
  }
  // 떠오르기와 흔들림.
  const rise = rng.range(1.0, 1.6);
  anchors.push({ t: 0, h: 0, s: 0, fixed: true });
  anchors.push({ t: rise, h: rng.range(0.45, 0.65), s: rng.range(-0.3, 0.3), fixed: true });
  for (let t = rise + rng.range(0.7, 1.1); t < until - 0.3; t += rng.range(0.8, 1.2)) anchors.push({ t, h: rng.range(0.55, 0.95), s: rng.range(-0.7, 0.7), fixed: false });
  anchors.sort((x, y) => x.t - y.t || Number(y.fixed) - Number(x.fixed));
  // 고정 키 가까이(0.45초 안)의 흔들림 키는 뺀다. 끊긴 연은 cutAt 뒤 키가 없다.
  const keep = anchors.filter((x, i) => {
    if (x.t > until + 1e-9) return false;
    if (x.fixed) return anchors.findIndex((y) => y.fixed && Math.abs(y.t - x.t) < 1e-6) === i;
    return !anchors.some((y) => y.fixed && Math.abs(y.t - x.t) < 0.45);
  });
  return { h: keep.map((x) => ({ t: x.t, p: x.h })), s: keep.map((x) => ({ t: x.t, p: x.s })) };
}

/** 살아 있는 연 가운데 k에서 가장 가까운 연 (같으면 무작위). */
function nearest(rng: Rng, k: number, alive: readonly number[]): number {
  const others = alive.filter((x) => x !== k);
  const d = Math.min(...others.map((x) => Math.abs(x - k)));
  return rng.pick(others.filter((x) => Math.abs(x - k) === d));
}

export const KITE_GAME: GroupGame = {
  booth: 'kite',
  picks: N,
  center: (st) => villageOf(st).kite().center,
  face: (st) => villageOf(st).kite().center,
  watchPoint: (st, rng) => {
    const w = villageOf(st).kite().watch;
    return { x: w.x + rng.next() * w.w, y: w.y + rng.next() * w.h };
  },
  seatFor: (rng, m, free) => {
    const fly = free.filter((s) => s < KITE.flyers);
    const watch = free.filter((s) => s >= KITE.flyers);
    if (fly.length === 0 || watch.length === 0) return rng.pick(fly.length > 0 ? fly : watch);
    return rng.chance(eagerness(m, KITE.fly.base, KITE.fly, SPECIES[m.species].floats)) ? rng.pick(fly) : rng.pick(watch);
  },
  join: (rng, seat, m, entries, who) => {
    if (seat < KITE.flyers) return { pick: seat, role: 'player' };
    const own = (k: number): Monster | undefined => {
      const e = entries.find((x) => x.role === 'player' && x.pick === k);
      return e === undefined ? undefined : who?.(e.monster);
    };
    return { pick: crowdPick(rng, m, entries.filter((e) => e.role === 'bettor'), Array.from({ length: N }, (_, k) => k), own), role: 'bettor' };
  },
  readiness: (es) => (es.length >= KITE.soonAt ? 'soon' : es.length > 0 ? 'ok' : 'none'),
  generate: (rng, entries, ctx) => {
    const D = ctx.duration;
    const lucky = ctx.lucky >= 0 ? entries[ctx.lucky] : undefined;
    const winner = lucky !== undefined ? lucky.pick : rng.int(0, N - 1);
    const close = rng.chance(KITE.closeChance);
    const late = rng.chance(KITE.lateChance);
    const losers = rng.shuffle(Array.from({ length: N }, (_, i) => i).filter((k) => k !== winner));
    // 끊기는 때: 첫째는 이르게, 마지막(마지막에서 두 번째 연)은 late면 끝 무렵, 가운데는 그 사이.
    const last = late ? D * rng.range(KITE.lateFrom, KITE.cutTo) : D * rng.range(0.6, KITE.lateFrom - 0.05);
    const first = D * rng.range(KITE.cutFrom, KITE.cutFrom + 0.1);
    const times = [first];
    for (let i = 1; i < losers.length - 1; i++) {
      const lo = times[i - 1]! + 1.7;
      const hi = last - 1.7 * (losers.length - 1 - i);
      times.push(hi > lo ? rng.range(lo, hi) : (lo + hi) / 2);
    }
    times.push(last);
    const fights: Fight[] = [];
    const alive = Array.from({ length: N }, (_, i) => i);
    losers.forEach((a, i) => {
      const cutAt = times[i]!;
      // 마지막 싸움은 늘 이긴 연과.
      const b = i === losers.length - 1 ? winner : nearest(rng, a, alive);
      fights.push({ a, b, cutAt, tangleAt: cutAt - rng.range(TANGLE_SEC[0], TANGLE_SEC[1]), h: rng.range(0.6, 0.85) });
      alive.splice(alive.indexOf(a), 1);
    });
    const tracks: GroupKey[][] = [];
    for (let k = 0; k < N; k++) {
      const kk = kiteKeys(rng, k, fights, D);
      tracks.push(kk.h, kk.s);
    }
    const events: GroupEvent[] = [];
    for (const f of fights) {
      events.push({ t: f.tangleAt, type: 'tangle', actor: f.a, other: f.b });
      events.push({ t: f.cutAt, type: 'cut', actor: f.a, other: f.b });
    }
    const lastFight = fights[fights.length - 1];
    if (close && lastFight !== undefined) events.push({ t: (lastFight.tangleAt + lastFight.cutAt) / 2, type: 'brink', actor: winner });
    events.push({ t: last + 0.4, type: 'finish', actor: winner });
    events.sort((x, y) => x.t - y.t);
    const order = [...losers, winner];
    const cutAt = Array.from({ length: N }, (_, k) => fights.find((f) => f.a === k)?.cutAt ?? -1);
    const outcomes = entries.map((e: GroupEntry) => {
      const place = N - order.indexOf(e.pick);
      const tier = place === 1 ? (close ? 'jackpot' : 'win') : place === 2 && late ? 'nearMiss' : 'lose';
      return groupOutcome('kite', tier, { kind: 'kite', kite: e.pick, role: e.role, place, cutAt: cutAt[e.pick] ?? -1 });
    });
    const play: GroupPlay = { kind: 'kite', order, cutAt, close, late, end: D, tracks, events, outcomes };
    return play;
  },
  poll: pollTimeline,
  cheer: (_play, e, ev) => {
    switch (ev.type) {
      case 'tangle':
        return e.pick === ev.actor || e.pick === ev.other ? 'behind' : null;
      case 'cut':
        return e.pick === ev.actor ? 'behind' : e.pick === ev.other ? 'lead' : null;
      case 'brink':
        return e.pick === ev.actor ? 'behind' : null;
      default:
        return null;
    }
  },
  crowd: (play, entries) => {
    if (play.kind !== 'kite') return { tier: 'win', star: -1 };
    const winner = play.order[play.order.length - 1];
    const star = entries.findIndex((e) => e.role === 'player' && e.pick === winner);
    return { tier: play.close ? 'jackpot' : play.late ? 'nearMiss' : 'win', star: star >= 0 ? star : entries.findIndex((e) => e.pick === winner) };
  },
  buzz: (play, ev, entries) => {
    if (play.kind !== 'kite') return null;
    const star = (k: number): number => {
      const i = entries.findIndex((e) => e.role === 'player' && e.pick === k);
      return i >= 0 ? i : entries.findIndex((e) => e.pick === k);
    };
    switch (ev.type) {
      case 'tangle':
      case 'brink':
        return { kind: 'gasp', star: star(ev.actor) };
      case 'cut':
        // 마지막 연싸움(남은 연 둘)에서 끊기면 환호, 그 밖은 박수. 주인공 = 끊은 연.
        return { kind: ev.actor === play.order[play.order.length - 2] ? 'wow' : 'cheer', star: star(ev.other ?? ev.actor) };
      default:
        return null;
    }
  },
};
