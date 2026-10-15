// 단체 놀이 모듈: 보물찾기 마당. 손님마다 판 자리 하나(= 자리, map.ts DIG_FIELD.spots)를 판다.
// 판의 DIG.chestChance에만 상자가 DIG_FIELD.chests 가운데 한 곳에 묻힌다 (판마다 많아야 하나).
// 등급 (손님마다): 상자를 판 손님 jackpot ×8, 상자 바로 옆(DIG.nearPx 안)을 판 손님 nearMiss ("바로 옆이었는데!"),
// 나머지는 DIG.winChance로 작은 보물(동전 주머니·보석, win ×2.5), 아니면 헌 장화·조약돌(lose). 배당 ODDS.dig.
// 타임라인: 손님마다 삽질 시작(dig) → 차례로 무언가 튀어 오른다(find, 상자는 마지막에). 아무도 못 찾은 상자는 끝에 할아버지가 판다(reveal).
// 자리(판 자리)는 빈 흙더미 가운데 무작위로 고른다. 상자가 바로 옆에서 나오면 그 손님은 "바로 옆이었는데!" (응원 behind).

import { DIG, DIG_FINDS, type OutcomeTier } from '../../data/defs.ts';
import { DIG_FIELD } from '../../data/map.ts';
import type { DigFind, GroupEntry, GroupEvent, GroupKey, GroupPlay } from '../types.ts';
import { groupOutcome, pollTimeline, type GroupGame } from './core.ts';

const SPOTS = DIG_FIELD.spots.length;

/** 상자 자리 c(DIG_FIELD.chests index) 바로 옆의 판 자리인가 (상자 자리 그곳은 아니다). */
export function digNear(c: number, spot: number): boolean {
  if (c < 0 || c === spot) return false;
  const a = DIG_FIELD.chests[c];
  const b = DIG_FIELD.spots[spot];
  return a !== undefined && b !== undefined && Math.hypot(a.x - b.x, a.y - b.y) <= DIG.nearPx;
}

const findIndex = (f: DigFind): number => DIG_FINDS.indexOf(f);

export const DIG_GAME: GroupGame = {
  booth: 'dig',
  picks: SPOTS,
  center: DIG_FIELD.center,
  // 손님은 자기 흙더미(왼쪽)를 본다.
  face: (seat) => (seat >= 0 ? (DIG_FIELD.spots[seat] ?? DIG_FIELD.center) : DIG_FIELD.center),
  watchPoint: (rng) => ({ x: rng.range(6960, 7660), y: rng.range(6960, 7030) }),
  // 판 자리는 빈 흙더미 가운데 무작위 (판마다 상자 자리가 달라 어디나 같다).
  seatFor: (rng, _m, free) => rng.pick(free),
  join: (_rng, seat) => ({ pick: seat, role: 'player' }),
  readiness: (es) => (es.length >= DIG.soonAt ? 'soon' : es.length > 0 ? 'ok' : 'none'),
  generate: (rng, entries, ctx) => {
    const D = ctx.duration;
    const chest = rng.chance(DIG.chestChance) ? rng.int(0, DIG_FIELD.chests.length - 1) : -1;
    const finds: DigFind[] = Array.from({ length: SPOTS }, () => 'none');
    const findAt: number[] = Array.from({ length: SPOTS }, () => -1);
    const tiers: OutcomeTier[] = [];
    const near: boolean[] = [];
    entries.forEach((e: GroupEntry, i) => {
      const spot = e.pick;
      let find: DigFind;
      let tier: OutcomeTier;
      const isNear = digNear(chest, spot);
      if (chest === spot) {
        find = 'chest';
        tier = 'jackpot';
      } else if (ctx.lucky === i || (!isNear && rng.chance(DIG.winChance))) {
        find = rng.chance(0.6) ? 'coins' : 'gem';
        tier = 'win';
      } else {
        find = rng.chance(0.55) ? 'boot' : 'pebble';
        tier = isNear ? 'nearMiss' : 'lose';
      }
      finds[spot] = find;
      tiers.push(tier);
      near.push(isNear);
    });
    const found = chest >= 0 && entries.some((e) => e.pick === chest);
    // 튀어 오르는 차례: 섞되 상자는 마지막에.
    const order = rng.shuffle(entries.map((e) => e.pick));
    if (found) {
      order.splice(order.indexOf(chest), 1);
      order.push(chest);
    }
    const events: GroupEvent[] = [];
    const tracks: GroupKey[][] = Array.from({ length: SPOTS }, () => []);
    const t0 = D * 0.36;
    const t1 = D * 0.78;
    entries.forEach((e, i) => events.push({ t: 0.35 + i * 0.3, type: 'dig', actor: e.pick }));
    order.forEach((spot, k) => {
      const at = order.length === 1 ? t1 : t0 + ((t1 - t0) * k) / (order.length - 1) + rng.range(-0.12, 0.12);
      findAt[spot] = at;
      const start = 0.35 + entries.findIndex((e) => e.pick === spot) * 0.3;
      tracks[spot] = [
        { t: 0, p: 0 },
        { t: start, p: 0 },
        { t: start + (at - start) * 0.5, p: rng.range(0.4, 0.6) },
        { t: at, p: 1 },
      ];
      events.push({ t: at, type: 'find', actor: spot, value: findIndex(finds[spot] ?? 'none') });
    });
    if (chest >= 0 && !found) events.push({ t: D * 0.87, type: 'reveal', actor: chest });
    events.sort((a, b) => a.t - b.t);
    const outcomes = entries.map((e, i) => groupOutcome('dig', tiers[i] ?? 'lose', { kind: 'dig', spot: e.pick, find: finds[e.pick] ?? 'none', chestNear: near[i] === true }));
    const play: GroupPlay = { kind: 'dig', finds, findAt, chest, found, end: D, tracks, events, outcomes };
    return play;
  },
  poll: pollTimeline,
  // 삽질 시작은 기분 + 없이 (사건이 많다).
  moodOn: (ev) => ev.type !== 'dig',
  cheer: (play, e, ev) => {
    if (play.kind !== 'dig') return null;
    if (ev.type === 'find' && ev.actor === e.pick) {
      const f = play.finds[e.pick];
      return f === 'chest' || f === 'coins' || f === 'gem' ? 'lead' : 'behind';
    }
    // 바로 옆에서 상자가 나왔다 (남이 찾았거나 할아버지가 팠다): "바로 옆이었는데!"
    if ((ev.type === 'reveal' || (ev.type === 'find' && play.finds[ev.actor] === 'chest')) && ev.actor !== e.pick) return digNear(play.chest, e.pick) ? 'behind' : null;
    return null;
  },
  // 자기 땅에서 나온 것: 헌 장화·조약돌마다 다른 말 ('find:boot' → '장화네…').
  cheerDetail: (play, ev) => (play.kind === 'dig' && ev.type === 'find' ? (play.finds[ev.actor] ?? null) : null),
  crowd: (play, entries) => {
    if (play.kind !== 'dig') return { tier: 'win', star: -1 };
    const star = play.found ? entries.findIndex((e) => e.pick === play.chest) : entries.findIndex((e) => play.finds[e.pick] === 'coins' || play.finds[e.pick] === 'gem');
    return { tier: play.found ? 'jackpot' : play.chest >= 0 ? 'nearMiss' : 'win', star };
  },
  // 구경꾼: 상자 = 환호, 동전·보석 = 박수, 헌 장화 = 킥킥, 할아버지가 상자를 파면 = 어머나.
  buzz: (play, ev, entries) => {
    if (play.kind !== 'dig') return null;
    const at = entries.findIndex((e) => e.pick === ev.actor);
    if (ev.type === 'reveal') return { kind: 'gasp', star: entries.findIndex((e) => digNear(play.chest, e.pick)) };
    if (ev.type !== 'find') return null;
    const f = play.finds[ev.actor];
    return f === 'chest' ? { kind: 'wow', star: at } : f === 'coins' || f === 'gem' ? { kind: 'cheer', star: at } : f === 'boot' ? { kind: 'laugh', star: at } : null;
  },
};
