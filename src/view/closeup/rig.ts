// 부스 장치(기계·소품)의 약속. 한판 연출은 '시간 t의 모습'을 그리는 함수(render)라서
// 중간에 열어도, 화면이 다시 지어져도 그 시각의 모습으로 바로 맞춘다. 결과는 시작할 때 이미 안다.

import type { Container } from 'pixi.js';
import type { OutcomeTier, SpeciesId } from '../../data/defs.ts';
import type { ActiveRound } from '../../sim/types.ts';
import type { HostActor, MonsterActor } from './actor.ts';
import type { Anim } from './fx.ts';
import type { Layout } from './layout.ts';

/** 진행 중인 한판의 화면 쪽 기록. */
export interface Play {
  readonly seat: number;
  readonly round: ActiveRound;
  /** 한판 시작 뒤 지난 초. */
  t: number;
  /** 연출 길이 (= round.duration). 이 안에 결과 모습으로 끝난다. */
  readonly D: number;
  /** roundFinished를 받았거나 sim에서 사라졌다. */
  done: boolean;
  /** 끝난 시각 (씬 시간). */
  doneAt: number;
}

export interface RigCtx {
  readonly L: Layout;
  readonly anim: Anim;
  /** 그 자리의 손님 (없으면 null). */
  actor(seat: number): MonsterActor | null;
  host(): HostActor | null;
  /** 손님보다 앞에 그리는 층 (날아가는 다트 등). */
  readonly front: Container;
  /** 도감에서 본 종 (인형 뽑기 더미). 없으면 모든 종. */
  plushPool?(): readonly SpeciesId[];
}

export interface Rig {
  /** 손님 뒤 장치 층. zIndex는 장치가 정한다 (진행자 10, 손님 32~36). */
  readonly root: Container;
  /** 손님 그림이 이보다 왼쪽으로 뻗지 않게 (패널 px, 장치의 오른쪽 끝: 고리 던지기 선반). 장면이 넓은 종을 오른쪽으로 민다. */
  readonly guardRight?: number;
  /** 새 한판을 맡는다 (결과에 맞춰 미리 계산). */
  begin(play: Play): void;
  /** play.t의 모습으로 그린다 (같은 t면 언제 불러도 같은 모습). */
  render(play: Play): void;
  /** 끝난 모습으로 맞춘다. */
  finish(play: Play): void;
  /** 한판이 없을 때 (dt초, 씬 시간). */
  idle(dt: number, time: number): void;
  /** 결과 연출 (대박이면 기계가 통통). */
  celebrate(tier: OutcomeTier): void;
  destroy(): void;
}

/** 연출이 끝나는 비율: 결과 모습을 조금 보여 준 뒤 roundFinished가 온다. */
export const SETTLE = 0.92;
