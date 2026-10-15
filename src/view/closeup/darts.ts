// 다트 부스: 뒷벽의 과녁. 손님이 움츠렸다 던지면(squash) 다트가 포물선으로 날아가 (dist, angle) 자리에 꽂힌다.
// 과녁 고리를 결과 등급에 맞춰 잰다: 대박 = 빨간 가운데, 이김 = 주황 고리, 아깝다 = 주황 고리 테두리에 걸쳐 흔들, 꽝 = 바깥.

import { Container } from 'pixi.js';
import type { OutcomeTier } from '../../data/defs.ts';
import { type ArtNode, artSprite } from '../art.ts';
import { lerp, span } from './fx.ts';
import { BOARD_ART, DART_ART } from './layout.ts';
import { type Play, type Rig, type RigCtx, SETTLE } from './rig.ts';

/**
 * dist(0~1, 1 이상 = 과녁 밖) → 과녁 캔버스 반지름. 등급 경계가 그림의 고리 선과 맞게 구간마다 편다:
 * 대박 = 빨간 가운데, 이김 = 주황 고리, 아깝다 = 주황 고리 바깥 선에 걸침, 꽝 = 흰 고리·나무 테, 1 이상 = 테 밖 벽.
 */
function boardRadius(d: number): number {
  const B = BOARD_ART;
  if (d <= 0.12) return (d / 0.12) * (B.red - 12);
  if (d <= 0.45) return B.red + 8 + ((d - 0.12) / 0.33) * (B.orange - B.red - 18);
  if (d <= 0.6) return B.orange - 6 + ((d - 0.45) / 0.15) * 14;
  if (d <= 1) return B.orange + 14 + ((d - 0.6) / 0.4) * (B.rim - B.orange - 26);
  return B.rim + 14 + Math.min(1, (d - 1) / 0.15) * 40;
}

/** a에서 b로 가장 짧게 도는 각도 보간. */
function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

/** 꽂힌 다트의 모습: 바늘이 과녁 가운데를 향하고 꼬리가 바깥으로 (가운데를 가리지 않게). 짧아 보이게 줄인다. */
const STUCK_LEN = 0.55;

export class DartsRig implements Rig {
  readonly root = new Container();
  private readonly ctx: RigCtx;
  private readonly board: ArtNode;
  private readonly dart: ArtNode;
  private readonly bx: number;
  private readonly by: number;
  private readonly kBoard: number;
  /** 지금 판의 꽂힐 자리 (과녁 기준 px). */
  private target = { x: 0, y: 0 };
  private nearMiss = false;
  /** 꽂힌 뒤 흔들림이 이어지는 시간 (idle). */
  private wobble = 0;
  private stuckRot = 2.5;
  private shake = 0;

  constructor(ctx: RigCtx) {
    this.ctx = ctx;
    const L = ctx.L;
    const sw = L.sw;
    // 과녁은 벽에 걸려 있다: 진행자보다 뒤.
    this.root.zIndex = 5;
    this.kBoard = (sw * 0.42) / (BOARD_ART.rim * 2);
    // 진행자 손(왼쪽)과 겹치지 않게 조금 오른쪽.
    this.bx = L.sx + sw * 0.48;
    this.by = Math.min(L.bg.y + L.bg.size * 0.42, L.floorY - BOARD_ART.rim * this.kBoard * 1.6);
    this.board = artSprite('objects', 'dartboard', { k: this.kBoard, anchor: BOARD_ART.center, placeholder: { w: 650, h: 650, color: 0xf2b27a } });
    this.board.position.set(this.bx, this.by);
    this.root.addChild(this.board);
    const kDart = (sw * 0.17) / DART_ART.length;
    this.dart = artSprite('objects', 'dart', { k: kDart, anchor: DART_ART.tip, placeholder: { w: 501, h: 120, color: 0x9b6a3c } });
    this.dart.visible = false;
    ctx.front.addChild(this.dart);
  }

  begin(play: Play): void {
    const d = play.round.outcome.detail;
    if (d.kind !== 'darts') return;
    const r = boardRadius(d.dist) * this.kBoard;
    this.target = { x: Math.cos(d.angle) * r, y: Math.sin(d.angle) * r };
    // 가운데 가까이면 꼬리가 오른쪽 위(던진 쪽), 아니면 바깥쪽으로.
    this.stuckRot = r > BOARD_ART.red * 0.5 * this.kBoard ? Math.atan2(-this.target.y, -this.target.x) : 2.5;
    this.nearMiss = play.round.outcome.tier === 'nearMiss';
    this.wobble = 0;
  }

  /** 던지는 손 자리 (무대 좌표). */
  private handAt(seat: number): { x: number; y: number } {
    const a = this.ctx.actor(seat);
    const L = this.ctx.L;
    if (a === null) return { x: L.sx + L.sw * 0.75, y: L.feetY - L.bodyH * 0.6 };
    const h = a.hand();
    const s = a.root.scale.x;
    return { x: a.root.x + h.x * s, y: a.root.y + h.y * s };
  }

  render(play: Play): void {
    const { D } = play;
    const t = Math.min(play.t, SETTLE * D);
    const throwAt = 0.3 * D;
    const hitAt = 0.6 * D;
    // 손님: 움츠림(squash) → 쭉 펴며 던지기 → 제자리
    const a = this.ctx.actor(play.seat);
    if (a !== null) {
      const wind = span(t, 0.05 * D, throwAt);
      const fling = span(t, throwAt, throwAt + 0.08 * D);
      const back = span(t, hitAt, 0.7 * D);
      const squash = wind * (1 - fling);
      const stretch = Math.sin(Math.PI * fling) * (1 - back);
      a.rig.sx = 1 + squash * 0.1 - stretch * 0.06;
      a.rig.sy = 1 - squash * 0.14 + stretch * 0.1;
      a.rig.rot = squash * 0.12 - stretch * 0.14;
      a.rig.dx = a.bodyH * (squash * 0.05 - stretch * 0.08);
    }
    // 다트
    const flyStart = throwAt + 0.05 * D;
    if (t < flyStart) {
      // 지난 판의 다트는 던지기 전에 빠진다.
      this.dart.visible = t < 0.1 * D && this.dart.visible;
      this.dart.alpha = 1 - span(t, 0, 0.1 * D);
      this.board.position.set(this.bx, this.by);
      return;
    }
    this.dart.visible = true;
    this.dart.alpha = 1;
    const from = this.handAt(play.seat);
    const to = { x: this.bx + this.target.x, y: this.by + this.target.y };
    const sw = this.ctx.L.sw;
    const ctrl = { x: lerp(from.x, to.x, 0.5), y: Math.min(from.y, to.y) - sw * 0.22 };
    if (t < hitAt) {
      const u = (t - flyStart) / (hitAt - flyStart);
      const x = (1 - u) ** 2 * from.x + 2 * (1 - u) * u * ctrl.x + u * u * to.x;
      const y = (1 - u) ** 2 * from.y + 2 * (1 - u) * u * ctrl.y + u * u * to.y;
      const dx = 2 * (1 - u) * (ctrl.x - from.x) + 2 * u * (to.x - ctrl.x);
      const dy = 2 * (1 - u) * (ctrl.y - from.y) + 2 * u * (to.y - ctrl.y);
      // 끝 무렵에는 꽂힐 모습으로 돌며 멀어진다(작아진다).
      const turn = span(u, 0.7, 1);
      this.setDart(x, y, lerpAngle(Math.atan2(dy, dx), this.stuckRot, turn), lerp(1.3, 1, u), lerp(1, STUCK_LEN, turn));
      this.board.position.set(this.bx, this.by);
      return;
    }
    // 꽂힘: 과녁이 살짝 흔들리고 다트가 떤다. 아깝다면 테두리에 걸쳐 오래 흔들.
    const tau = t - hitAt;
    const amp = this.nearMiss ? 0.32 : 0.14;
    const decay = this.nearMiss ? 2.2 : 7;
    const wob = amp * Math.sin(tau * 34) * Math.exp(-tau * decay);
    const tilt = this.nearMiss ? 0.22 * Math.min(1, tau * 3) : 0;
    this.setDart(to.x, to.y, this.stuckRot + wob + tilt, 1, STUCK_LEN);
    const shake = Math.sin(tau * 50) * Math.exp(-tau * 12) * sw * 0.008;
    this.board.position.set(this.bx + shake, this.by);
  }

  private setDart(x: number, y: number, rot: number, s: number, len: number): void {
    this.dart.position.set(x, y);
    this.dart.rotation = rot;
    // 왼쪽으로 날면 깃이 뒤집히지 않게 위아래를 뒤집는다.
    this.dart.scale.set(s * len, Math.cos(rot) < 0 ? -s : s);
  }

  finish(play: Play): void {
    play.t = Math.max(play.t, SETTLE * play.D);
    this.render(play);
    this.wobble = this.nearMiss ? 1.2 : 0;
  }

  idle(dt: number): void {
    if (this.wobble > 0) {
      this.wobble = Math.max(0, this.wobble - dt);
      const w = this.wobble;
      this.dart.rotation = this.stuckRot + 0.22 + Math.sin(w * 30) * 0.12 * w;
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      this.board.position.set(this.bx + Math.sin(this.shake * 60) * this.ctx.L.sw * 0.01 * this.shake, this.by);
    }
  }

  celebrate(tier: OutcomeTier): void {
    if (tier === 'jackpot') this.shake = 0.6;
  }

  destroy(): void {
    this.dart.destroy({ children: true });
    this.root.destroy({ children: true });
  }
}
