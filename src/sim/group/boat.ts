// 단체 놀이 모듈: 오리배 경주. 경주장과 같은 규칙과 같은 경주 생성기 (sim/race.ts generateRace)를 연못 물길(map.ts BOAT_COURSE)에서.
// 손님은 모두 선착장에서 배 하나를 응원한다 (bettor). 1등 ×3.5, 꼴찌에서 1등 역전 ×6, 사진 판정 2등 nearMiss (ODDS.boat).
// 배 고르기: 좋아하는 배가 있는 종(BOAT.fans)은 그 배, 아니면 구경꾼 성격은 사람 많은 배, 대담이는 적은 배, 그 밖은 고르게.
// 사건·응원·구경은 경주장과 같다 (sim/group/race.ts racePoll·raceCheer·raceCrowd·raceBuzz: 막판에 1등이 바뀌면 물가 구경꾼이 들썩).

import type { Rng } from '../../core/rng.ts';
import { BOAT, RACE } from '../../data/defs.ts';
import { RACERS, raceOutcome } from '../race.ts';
import { villageOf } from '../village.ts';
import type { GroupEntry, GroupPlay, Monster, RacerIndex } from '../types.ts';
import { crowdPick, type GroupGame } from './core.ts';
import { makeRace, raceBuzz, raceCheer, raceCrowd, racePoll } from './race.ts';

/** 손님이 응원할 배: 좋아하는 배가 있는 종(BOAT.fans)은 BOAT.fanChance로 그 배, 아니면 (참가자를 주면) 성격대로, 없으면 고르게. */
export function pickBoat(rng: Rng, species: string, m?: Monster, entries: readonly GroupEntry[] = []): RacerIndex {
  const fan = (BOAT.fans as Readonly<Record<string, number>>)[species];
  if (fan !== undefined && RACERS.includes(fan as RacerIndex) && rng.chance(BOAT.fanChance)) return fan as RacerIndex;
  if (m === undefined) return rng.pick(RACERS);
  return crowdPick(rng, m, entries, RACERS, () => undefined) as RacerIndex;
}

export const BOAT_GAME: GroupGame = {
  booth: 'boat',
  picks: BOAT.boats.length,
  center: (st) => villageOf(st).boat().course.center,
  face: (st) => villageOf(st).boat().course.center,
  // 선착장 양옆 물가 (catalog.ts BOAT_GEO.watch).
  watchPoint: (st, rng) => {
    const w = rng.pick(villageOf(st).boat().watch);
    return { x: w.x + rng.next() * w.w, y: w.y + rng.next() * w.h };
  },
  join: (rng, _seat, m, entries) => ({ pick: pickBoat(rng, m.species, m, entries), role: 'bettor' }),
  readiness: (es) => (es.length >= RACE.minRunners ? 'soon' : es.length > 0 ? 'ok' : 'none'),
  generate: (rng, entries, ctx) => {
    const race = makeRace(rng, entries, ctx);
    const play: GroupPlay = { kind: 'boat', race, end: ctx.duration, tracks: race.keys, events: [], outcomes: entries.map((e) => raceOutcome(race, e.pick as RacerIndex, 'boat')) };
    return play;
  },
  poll: racePoll,
  cheer: raceCheer,
  crowd: raceCrowd,
  buzz: raceBuzz,
};
