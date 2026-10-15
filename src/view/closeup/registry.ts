// 부스마다의 확대 장면 고르기. 보통 부스는 BoothScene + 부스 장치(Rig), 단체 놀이는 자기 장면 (GROUP_SCENES:
// 경주장 RaceScene(race.ts), 씨름·오리배·연날리기·줄다리기·보물찾기는 GroupScene(group.ts)을 이은 장면 <booth>.ts).
// 새 보통 부스는 RIGS에 장치를, 새 단체 놀이는 GROUP_SCENES에 장면을 넣는다. CloseupView는 이 약속(CloseupScene)만 안다.

import type { Container } from 'pixi.js';
import { isGroupBooth, type BoothId, type GroupBoothId } from '../../data/defs.ts';
import type { SimApi } from '../../sim/api.ts';
import type { ActiveRound, MonsterId, Reaction } from '../../sim/types.ts';
import { BoatScene } from './boat.ts';
import { ClawRig } from './claw.ts';
import { CupsRig } from './cups.ts';
import { DartsRig } from './darts.ts';
import { DigScene } from './dig.ts';
import { DuckRig } from './duck.ts';
import { KiteScene } from './kite.ts';
import { OddEvenRig } from './oddeven.ts';
import { PouchRig } from './pouch.ts';
import { RaceScene } from './race.ts';
import type { Rig, RigCtx } from './rig.ts';
import { RingRig } from './ring.ts';
import { BoothScene } from './scene.ts';
import { SlotRig } from './slot.ts';
import { SsireumScene } from './ssireum.ts';
import { TugScene } from './tug.ts';
import { WheelRig } from './wheel.ts';

/** 확대 장면 하나 (패널 px, (0,0) = 패널 왼쪽 위). CloseupView가 sim 이벤트를 그대로 넘겨준다. */
export interface CloseupScene {
  readonly booth: BoothId;
  readonly root: Container;
  /** 자리 수·열림 등이 바뀌어 다시 지어야 한다. */
  needsRebuild(): boolean;
  update(dt: number): void;
  onRoundStarted(seat: number, round: ActiveRound): void;
  onRoundFinished(seat: number, round: ActiveRound, payout: number): void;
  onReact(id: MonsterId, r: Reaction): void;
  onSpectate(id: MonsterId, r: Reaction): void;
  onCheer(id: MonsterId): void;
  onLeft(id: MonsterId): void;
  onPotFestival(amount: number): void;
  destroy(): void;
}

/** 보통 부스의 장치. */
export const RIGS: Record<Exclude<BoothId, GroupBoothId>, (ctx: RigCtx) => Rig> = {
  slot: (c) => new SlotRig(c),
  oddeven: (c) => new OddEvenRig(c),
  cups: (c) => new CupsRig(c),
  darts: (c) => new DartsRig(c),
  wheel: (c) => new WheelRig(c),
  duck: (c) => new DuckRig(c),
  ring: (c) => new RingRig(c),
  claw: (c) => new ClawRig(c),
  pouch: (c) => new PouchRig(c),
};

export type GroupSceneFactory = (sim: SimApi, w: number, h: number, onTap: (id: MonsterId) => void) => CloseupScene;

/** 단체 놀이의 장면 (패널 크기 w·h, 손님을 누르면 onTap). */
export const GROUP_SCENES: Record<GroupBoothId, GroupSceneFactory> = {
  race: (sim, w, h, onTap) => new RaceScene(sim, w, h, onTap),
  ssireum: (sim, w, h, onTap) => new SsireumScene(sim, w, h, onTap),
  boat: (sim, w, h, onTap) => new BoatScene(sim, w, h, onTap),
  kite: (sim, w, h, onTap) => new KiteScene(sim, w, h, onTap),
  tug: (sim, w, h, onTap) => new TugScene(sim, w, h, onTap),
  dig: (sim, w, h, onTap) => new DigScene(sim, w, h, onTap),
};

export function makeScene(sim: SimApi, booth: BoothId, w: number, h: number, onTap: (id: MonsterId) => void): CloseupScene {
  if (isGroupBooth(booth)) return GROUP_SCENES[booth](sim, w, h, onTap);
  return new BoothScene(sim, booth, w, h, onTap, RIGS[booth]);
}
