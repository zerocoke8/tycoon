// 단체 놀이 모듈: 몬스터 경주장 (경주 만들기는 sim/race.ts). 손님은 모두 관중석에서 선수 하나를 응원한다 (bettor).
// 출발: 한 명이면 대기 시간이 끝날 때, 둘 이상이면 곧. 행운이 붙은 손님의 선수가 1등.
// 사건: 달리는 중에 1등이 바뀌면 'lead' (타임라인에 미리 넣지 않고 sim 틱마다 순위를 본다: TUNE.raceCheerStartSec부터, raceCheerGapSec 간격).

import type { Rng } from '../../core/rng.ts';
import { RACE } from '../../data/defs.ts';
import { generateRace, pickRacer, raceOutcome, raceStandings } from '../race.ts';
import { TUNE } from '../tuning.ts';
import { villageOf } from '../village.ts';
import type { GroupEntry, GroupEvent, GroupPlay, GroupState, RaceResult, RacerIndex } from '../types.ts';
import { raceOf, type GroupGame, type GroupGenCtx } from './core.ts';

/** 달리는 중 1등이 바뀌었나 (경주장·오리배 같이): 'lead' 사건 (actor = 새 1등, prev = 앞서던 선수, order = 그때 순위). */
export function racePoll(play: GroupPlay, g: GroupState, t: number): GroupEvent | null {
  const result = raceOf(play);
  if (result === null) return null;
  const first = result.finishOrder[0];
  if (t < TUNE.raceCheerStartSec || first === undefined || t >= (result.finishAt[first] ?? Infinity)) return null;
  const standings = raceStandings(result, t);
  const leader = standings[0];
  if (leader === undefined || (g.mark ?? null) === leader) return null;
  const prev = g.mark ?? null;
  if (prev !== null && t - (g.markAt ?? 0) < TUNE.raceCheerGapSec) return null;
  return { t, type: 'lead', actor: leader, prev: prev ?? -1, order: standings };
}

/** 자기 선수가 1등이 되면 들썩, 1등을 뺏기거나 꼴찌면 조마조마. */
export function raceCheer(_play: GroupPlay, e: GroupEntry, ev: GroupEvent): 'lead' | 'behind' | null {
  if (ev.type !== 'lead') return null;
  const last = ev.order?.[ev.order.length - 1];
  return e.pick === ev.actor ? 'lead' : e.pick === ev.prev || e.pick === last ? 'behind' : null;
}

/** 결승 뒤 구경꾼: 역전이면 박수(jackpot), 사진 판정이면 어머나(nearMiss). 주인공 = 1등 선수에 건 손님. */
export function raceCrowd(play: GroupPlay, entries: readonly GroupEntry[]): { tier: 'jackpot' | 'nearMiss' | 'win'; star: number } {
  const r = raceOf(play);
  if (r === null) return { tier: 'win', star: -1 };
  const winner = r.finishOrder[0];
  return { tier: r.comeback ? 'jackpot' : r.photoFinish ? 'nearMiss' : 'win', star: entries.findIndex((e) => e.pick === winner) };
}

/**
 * 달리는 중 구경꾼 (경주장·오리배 같이): 막판(1등 결승 시각의 TUNE.raceBuzzFrom 뒤)에 1등이 바뀌면 박수, 그것이 꼴찌에서 올라온 역전 1등이면 환호.
 * 주인공 = 새 1등에 건 손님.
 */
export function raceBuzz(play: GroupPlay, ev: GroupEvent, entries: readonly GroupEntry[]): { kind: 'wow' | 'cheer'; star: number } | null {
  const r = raceOf(play);
  const first = r?.finishOrder[0];
  if (r === null || first === undefined || ev.type !== 'lead' || (ev.prev ?? -1) < 0) return null;
  if (ev.t < (r.finishAt[first] ?? 0) * TUNE.raceBuzzFrom) return null;
  return { kind: r.comeback && ev.actor === first ? 'wow' : 'cheer', star: entries.findIndex((e) => e.pick === ev.actor) };
}

/** 경주 하나 (행운이 붙은 손님의 선수가 1등). */
export function makeRace(rng: Rng, entries: readonly GroupEntry[], ctx: GroupGenCtx): RaceResult {
  const lucky = ctx.lucky >= 0 ? entries[ctx.lucky] : undefined;
  return generateRace(rng, ctx.duration, lucky === undefined ? {} : { winner: lucky.pick as RacerIndex });
}

export const RACE_GAME: GroupGame = {
  booth: 'race',
  picks: RACE.racers.length,
  center: (st) => villageOf(st).race().center,
  face: (st) => villageOf(st).race().finish,
  // 관중석 양옆 경주로 바깥 (catalog.ts RACE_GEO.watch: 입구 쪽 위 띠라 달리는 경주로를 가로지르지 않는다).
  watchPoint: (st, rng) => {
    const w = rng.pick(villageOf(st).race().watch);
    return { x: w.x + rng.next() * w.w, y: w.y + rng.next() * w.h };
  },
  join: (rng, _seat, m) => ({ pick: pickRacer(rng, m.species), role: 'bettor' }),
  readiness: (es) => (es.length >= RACE.minRunners ? 'soon' : es.length > 0 ? 'ok' : 'none'),
  generate: (rng, entries, ctx) => {
    const race = makeRace(rng, entries, ctx);
    return { kind: 'race', race, end: ctx.duration, tracks: race.keys, events: [], outcomes: entries.map((e) => raceOutcome(race, e.pick as RacerIndex)) };
  },
  poll: racePoll,
  cheer: raceCheer,
  crowd: raceCrowd,
  buzz: raceBuzz,
};
