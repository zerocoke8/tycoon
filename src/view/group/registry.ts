// 지도 위 단체 놀이 화면 고르기 (부스 → GroupMapRenderer). VillageView(world.ts)가 단체 놀이 부스마다 하나씩 만든다.
// 화면마다 자기 파일 하나 (view/group/<booth>.ts, 경주장은 view/racetrack.ts). 새 단체 놀이는 GROUP_MAP에 더한다.
// 약속(층·순서·손님 몸 맡기기)은 view/group/base.ts 머리말.

import type { GroupBoothId } from '../../data/defs.ts';
import { RaceTrackView } from '../racetrack.ts';
import type { GroupMapCtx, GroupMapRenderer } from './base.ts';
import { BoatMapView } from './boat.ts';
import { DigMapView } from './dig.ts';
import { KiteMapView } from './kite.ts';
import { SsireumMapView } from './ssireum.ts';
import { TugMapView } from './tug.ts';

export type { GroupMapCtx, GroupMapLayers, GroupMapRenderer } from './base.ts';

export type GroupMapFactory = (ctx: GroupMapCtx) => GroupMapRenderer;

export const GROUP_MAP: Record<GroupBoothId, GroupMapFactory> = {
  race: (c) => new RaceTrackView(c.sim, { objects: c.layers.objects, shadows: c.layers.shadows }, c.fx, c.buildings),
  ssireum: (c) => new SsireumMapView(c),
  boat: (c) => new BoatMapView(c),
  kite: (c) => new KiteMapView(c),
  tug: (c) => new TugMapView(c),
  dig: (c) => new DigMapView(c),
};
