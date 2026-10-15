// 단체 놀이 모듈 등록 (부스 → GroupGame). 새 단체 놀이는 defs.ts GROUP_BOOTHS·GROUP_RULES·BOOTHS·ODDS와 여기에 더한다.

import type { GroupBoothId } from '../../data/defs.ts';
import { BOAT_GAME } from './boat.ts';
import type { GroupGame } from './core.ts';
import { DIG_GAME } from './dig.ts';
import { KITE_GAME } from './kite.ts';
import { RACE_GAME } from './race.ts';
import { SSIREUM_GAME } from './ssireum.ts';
import { TUG_GAME } from './tug.ts';

export const GROUP_GAMES: Record<GroupBoothId, GroupGame> = {
  race: RACE_GAME,
  boat: BOAT_GAME,
  ssireum: SSIREUM_GAME,
  kite: KITE_GAME,
  tug: TUG_GAME,
  dig: DIG_GAME,
};

export function groupGame(b: GroupBoothId): GroupGame {
  return GROUP_GAMES[b];
}

export * from './core.ts';
export { duelCheer, duelTimeline, sideSign, DUEL_BRINK, DUEL_LEAD } from './duel.ts';
export { digNear } from './dig.ts';
export { pickBoat } from './boat.ts';
export { tugLineup, tugSeat } from './tug.ts';
export { makeRace, raceBuzz, raceCheer, raceCrowd, racePoll } from './race.ts';
