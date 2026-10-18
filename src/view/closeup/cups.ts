// 구슬 찾기 부스 (key cups, 옛 이름 컵 야바위): 탁자 위 컵 셋. 구슬 든 컵을 들어 보여 주고 → swaps대로 둥글게 자리를 바꾸고
// → 손님이 하나를 가리키면 그 컵을 든다 (구슬이 다른 컵이면 그 컵도 이어서 들어 보여 준다).
// swaps는 자리 번호 쌍 [a, b] (그 두 자리의 컵을 맞바꾼다). ballAt·picked는 마지막 자리 번호.

import { Container, Graphics } from 'pixi.js';
import type { OutcomeTier } from '../../data/defs.ts';
import { type ArtNode, artSprite } from '../art.ts';
import { INK, lerp, span } from './fx.ts';
import { TABLE_TOP } from './layout.ts';
import { type Play, type Rig, type RigCtx, SETTLE } from './rig.ts';

interface Plan {
  /** arr[k][자리] = k번 바꾼 뒤 그 자리의 컵 번호. */
  arr: number[][];
  swaps: [number, number][];
  /** 구슬이 든 컵 번호. */
  ballCup: number;
  picked: number;
  ballAt: number;
}

export class CupsRig implements Rig {
  readonly root = new Container();
  private readonly ctx: RigCtx;
  private readonly cupLayer = new Container();
  private readonly cups: ArtNode[] = [];
  private readonly ball: ArtNode;
  private readonly arrow: Graphics;
  private readonly xs: number[];
  private readonly baseY: number;
  private readonly lift: number;
  private readonly arc: number;
  private plan: Plan | null = null;
  /** 컵 번호마다 지금 자리(소수)·들림(0~1). idle이 이어서 내린다. */
  private pos = [0, 1, 2];
  private lifted = [0, 0, 0];
  private ballCup = 1;
  private hold = 0;

  constructor(ctx: RigCtx) {
    this.ctx = ctx;
    const L = ctx.L;
    const sw = L.sw;
    this.root.zIndex = 20;
    // 진행자 얼굴을 가리지 않게 가운데보다 조금 오른쪽.
    const cx = L.sx + sw * 0.5;
    const kTable = (sw * 0.6) / 848;
    const tableH = 367 * kTable;
    const table = artSprite('objects', 'table', { k: kTable, anchor: 'bottom', placeholder: { w: 848, h: 367, color: 0xf3e3c6 } });
    table.position.set(cx, L.rig.y);
    const surface = L.rig.y - tableH + TABLE_TOP * tableH;
    this.baseY = surface + sw * 0.03;
    this.xs = [cx - sw * 0.15, cx, cx + sw * 0.15];
    const kCup = (sw * 0.145) / 485;
    this.lift = 495 * kCup * 0.62;
    this.arc = sw * 0.06;
    const kBall = (sw * 0.06) / 371;
    this.ball = artSprite('objects', 'ball', { k: kBall, anchor: 'bottom', placeholder: { w: 371, h: 369, color: 0xf06b6b } });
    this.cupLayer.sortableChildren = true;
    for (let i = 0; i < 3; i++) {
      const c = artSprite('objects', 'cup', { k: kCup, anchor: 'bottom', placeholder: { w: 485, h: 495, color: 0xb87a4a } });
      this.cups.push(c);
      this.cupLayer.addChild(c);
    }
    // 손님이 고른 컵 위의 화살표
    const a = sw * 0.035;
    this.arrow = new Graphics().poly([-a, -a * 1.2, a, -a * 1.2, 0, 0]).fill({ color: 0xffd54a }).stroke({ color: INK, width: Math.max(2, a * 0.22), join: 'round' });
    this.arrow.visible = false;
    this.root.addChild(table, this.ball, this.cupLayer, this.arrow);
    this.draw();
  }

  /** 자리(소수)의 x. */
  private x(p: number): number {
    const i = Math.max(0, Math.min(1.999, p / 2)) * 2;
    const a = Math.floor(i);
    return lerp(this.xs[a] ?? 0, this.xs[a + 1] ?? this.xs[a] ?? 0, i - a);
  }

  private draw(arcs: number[] = [0, 0, 0]): void {
    this.cups.forEach((c, i) => {
      const p = this.pos[i] ?? i;
      const arc = arcs[i] ?? 0;
      const l = this.lifted[i] ?? 0;
      // arc > 0 = 뒤로 넘어간다 (위, 작게), < 0 = 앞으로 (아래, 크게)
      c.position.set(this.x(p), this.baseY - arc * this.arc * (arc > 0 ? 1 : 0.35) - l * this.lift);
      c.scale.set(1 - arc * 0.08);
      c.rotation = l * -0.18;
      c.zIndex = arc < 0 ? 2 : arc > 0 ? 0 : 1;
    });
    const bp = this.pos[this.ballCup] ?? 1;
    this.ball.position.set(this.x(bp), this.baseY);
  }

  begin(play: Play): void {
    const d = play.round.outcome.detail;
    if (d.kind !== 'cups') return;
    const swaps = d.swaps.filter(([a, b]) => a !== b && a >= 0 && a < 3 && b >= 0 && b < 3);
    // 마지막 자리 ballAt에서 거꾸로 돌려 처음 자리를 찾는다.
    let start: number = d.ballAt;
    for (let k = swaps.length - 1; k >= 0; k--) {
      const s = swaps[k];
      if (s === undefined) continue;
      if (start === s[0]) start = s[1];
      else if (start === s[1]) start = s[0];
    }
    const arr: number[][] = [[0, 1, 2]];
    for (const [a, b] of swaps) {
      const next = [...(arr[arr.length - 1] ?? [0, 1, 2])];
      const ca = next[a] ?? a;
      next[a] = next[b] ?? b;
      next[b] = ca;
      arr.push(next);
    }
    this.plan = { arr, swaps, ballCup: start, picked: d.picked, ballAt: d.ballAt };
    this.ballCup = start;
    this.hold = 0;
  }

  render(play: Play): void {
    const pl = this.plan;
    if (pl === null) return;
    const { D } = play;
    const t = Math.min(play.t, SETTLE * D);
    const n = pl.swaps.length;
    const s0 = 0.25 * D;
    const s1 = 0.7 * D;
    const each = (s1 - s0) / Math.max(1, n);
    // 몇 번째 바꾸기 중인가
    const k = n === 0 ? 0 : Math.max(0, Math.min(n, Math.floor((t - s0) / each)));
    const inSwap = n > 0 && t >= s0 && t < s1;
    const u = inSwap ? (t - s0 - k * each) / each : 0;
    const before = pl.arr[Math.min(k, n)] ?? [0, 1, 2];
    const arcs = [0, 0, 0];
    // 컵 번호 → 자리
    before.forEach((cup, place) => {
      this.pos[cup] = place;
    });
    if (inSwap) {
      const sw = pl.swaps[k];
      if (sw !== undefined) {
        const [a, b] = sw;
        const ca = before[a] ?? a;
        const cb = before[b] ?? b;
        const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
        this.pos[ca] = lerp(a, b, e);
        this.pos[cb] = lerp(b, a, e);
        const bump = Math.sin(Math.PI * e);
        arcs[ca] = bump;
        arcs[cb] = -bump;
      }
    }
    // 들기: 처음에 구슬 컵 → 마지막에 고른 컵 (→ 구슬 컵)
    const final = pl.arr[n] ?? [0, 1, 2];
    const pickedCup = final[pl.picked] ?? 0;
    const ballCupFinal = final[pl.ballAt] ?? 0;
    const up = (a: number, b: number, c: number, e: number): number => (t < a ? 0 : t < b ? span(t, a, b) : t < c ? 1 : 1 - span(t, c, e));
    this.lifted = [0, 0, 0];
    this.lifted[pl.ballCup] = up(0.04 * D, 0.1 * D, 0.16 * D, 0.22 * D);
    this.lifted[pickedCup] = Math.max(this.lifted[pickedCup] ?? 0, span(t, 0.78 * D, 0.84 * D));
    if (ballCupFinal !== pickedCup) this.lifted[ballCupFinal] = Math.max(this.lifted[ballCupFinal] ?? 0, span(t, 0.85 * D, 0.9 * D));
    this.ballCup = pl.ballCup;
    this.draw(arcs);
    // 가리키기: 화살표 + 손님이 몸을 숙인다.
    const pointing = t >= 0.72 * D;
    this.arrow.visible = pointing;
    if (pointing) {
      const bob = Math.abs(Math.sin(play.t * 8)) * this.arc * 0.4;
      this.arrow.position.set(this.xs[pl.picked] ?? 0, this.baseY - this.lift * 1.25 - (this.lifted[pickedCup] ?? 0) * this.lift - bob);
    }
    const a = this.ctx.actor(play.seat);
    if (a !== null) {
      const lean = span(t, 0.7 * D, 0.76 * D) * (1 - span(t, 0.86 * D, 0.9 * D));
      a.rig.rot = -0.1 * lean;
      a.rig.dx = -a.bodyH * 0.05 * lean;
      if (t < 0.7 * D) a.rig.sy = 1 + Math.sin(play.t * 14) * 0.01;
    }
  }

  finish(play: Play): void {
    play.t = Math.max(play.t, SETTLE * play.D);
    this.render(play);
    this.arrow.visible = false;
    this.hold = 1.6;
    this.plan = null;
  }

  idle(dt: number): void {
    this.arrow.visible = false;
    if (this.hold > 0) {
      this.hold -= dt;
      return;
    }
    let moved = false;
    this.lifted = this.lifted.map((l) => {
      if (l <= 0) return 0;
      moved = true;
      return Math.max(0, l - dt * 3);
    });
    if (moved) this.draw();
  }

  celebrate(_tier: OutcomeTier): void {}

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
