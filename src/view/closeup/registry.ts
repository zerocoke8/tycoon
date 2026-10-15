// 부스마다의 확대 장면 고르기. 보통 부스는 BoothScene + 부스 장치(Rig), 경주장은 자기 장면(RaceScene).
// 새 부스를 더하면 RIGS에 장치를 (또는 makeScene에 자기 장면을) 넣는다. CloseupView는 이 약속(CloseupScene)만 안다.

import type { Container } from 'pixi.js';
import type { BoothId } from '../../data/defs.ts';
import type { SimApi } from '../../sim/api.ts';
import type { ActiveRound, MonsterId, Reaction } from '../../sim/types.ts';
import { ClawRig } from './claw.ts';
import { CupsRig } from './cups.ts';
import { DartsRig } from './darts.ts';
import { DuckRig } from './duck.ts';
import { OddEvenRig } from './oddeven.ts';
import { PouchRig } from './pouch.ts';
import { RaceScene } from './race.ts';
import type { Rig, RigCtx } from './rig.ts';
import { RingRig } from './ring.ts';
import { BoothScene } from './scene.ts';
import { SlotRig } from './slot.ts';
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
export const RIGS: Record<Exclude<BoothId, 'race'>, (ctx: RigCtx) => Rig> = {
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

export function makeScene(sim: SimApi, booth: BoothId, w: number, h: number, onTap: (id: MonsterId) => void): CloseupScene {
  if (booth === 'race') return new RaceScene(sim, w, h, onTap);
  return new BoothScene(sim, booth, w, h, onTap, RIGS[booth]);
}
