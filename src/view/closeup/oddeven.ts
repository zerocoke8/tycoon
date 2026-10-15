// 홀짝 부스: 탁자 위 조약돌 그릇. 진행자(조약돌 할머니)가 내민 손을 흔들다가, 그 손에서 조약돌을 하나씩 그릇에 던져 넣고
// 탁자 앞천에 센 숫자가 오른다. 손님 머리 위에는 '홀?' '짝?' 말풍선.
// 손은 진행자 그림의 손이다 (코드로 그린 손을 따로 띄우지 않는다): 손 자리는 layout.ts ODDEVEN_HAND (그림에서 잰 값).

import { Container, Text } from 'pixi.js';
import type { OutcomeTier } from '../../data/defs.ts';
import { type ArtNode, artSprite } from '../art.ts';
import { FONT, lerp, span } from './fx.ts';
import { ODDEVEN_HAND, TABLE_TOP } from './layout.ts';
import type { Play, Rig, RigCtx } from './rig.ts';

export class OddEvenRig implements Rig {
  readonly root = new Container();
  private readonly ctx: RigCtx;
  private readonly pebbles: ArtNode[] = [];
  private readonly count: Text;
  private readonly cx: number;
  private readonly mouthY: number;
  /** 조약돌이 던져지는 높이 (손에서 그릇까지 포물선). */
  private readonly arcH: number;
  private jitter: number[] = [];
  private shown = '';
  private fade = 0;

  constructor(ctx: RigCtx) {
    this.ctx = ctx;
    const L = ctx.L;
    this.root.zIndex = 20;
    this.root.sortableChildren = true;
    const sw = L.sw;
    this.cx = L.sx + sw * 0.46;
    this.arcH = sw * 0.12;
    const kTable = (sw * 0.6) / 848;
    const tableH = 367 * kTable;
    const table = artSprite('objects', 'table', { k: kTable, anchor: 'bottom', placeholder: { w: 848, h: 367, color: 0xf3e3c6 } });
    table.position.set(this.cx, L.rig.y);
    table.zIndex = 0;
    const surface = L.rig.y - tableH + TABLE_TOP * tableH;
    const kBowl = (sw * 0.25) / 602;
    const bowlH = 436 * kBowl;
    const bowl = artSprite('objects', 'pebble_bowl', { k: kBowl, anchor: 'bottom', placeholder: { w: 602, h: 436, color: 0xb07a4f } });
    const bowlBottom = surface + sw * 0.015;
    bowl.position.set(this.cx, bowlBottom);
    bowl.zIndex = 3;
    this.mouthY = bowlBottom - bowlH * 0.62;
    // 떨어지는 조약돌은 그릇 뒤로 들어간다.
    const kPeb = (sw * 0.05) / 427;
    for (let i = 0; i < 9; i++) {
      const p = artSprite('objects', 'pebble', { k: kPeb, anchor: 'center', placeholder: { w: 427, h: 273, color: 0xb9b4ad } });
      p.visible = false;
      p.zIndex = 2;
      this.pebbles.push(p);
    }
    // 센 숫자: 탁자 앞천에 크게.
    this.count = new Text({ text: '', style: { fontFamily: FONT, fontSize: Math.max(18, sw * 0.1), fill: 0x7a4a2a, stroke: { color: 0xffffff, width: Math.max(3, sw * 0.012), join: 'round' } } });
    this.count.anchor.set(0.5);
    this.count.position.set(this.cx, L.rig.y - tableH * 0.42);
    this.count.zIndex = 4;
    this.root.addChild(table, ...this.pebbles, bowl, this.count);
  }

  /** 진행자 손 자리 (패널 px). 진행자가 없으면 그릇 왼쪽 위. */
  private hand(): { x: number; y: number } {
    const host = this.ctx.host();
    if (host === null) return { x: this.cx - this.ctx.L.sw * 0.18, y: this.mouthY - this.ctx.L.sw * 0.05 };
    // 진행자는 뒤집혀 오른쪽을 본다: 그림의 왼쪽 손이 오른쪽으로.
    return { x: host.root.x - ODDEVEN_HAND.x * host.k, y: host.root.y + ODDEVEN_HAND.y * host.k };
  }

  begin(play: Play): void {
    const d = play.round.outcome.detail;
    const n = d.kind === 'oddeven' ? d.pebbles : 0;
    this.jitter = Array.from({ length: n }, () => Math.random() * 2 - 1);
    this.setCount('', 1);
    this.fade = 0;
  }

  private setCount(text: string, scale: number): void {
    if (text !== this.shown) {
      this.shown = text;
      this.count.text = text;
    }
    this.count.scale.set(scale);
    this.count.alpha = 1;
  }

  /** 조약돌 j가 손을 떠나는 때와 그릇에 닿는 때 (초). */
  private drop(j: number, n: number, D: number): { a: number; land: number } {
    const step = (0.5 * D) / Math.max(1, n);
    const a = 0.32 * D + j * step;
    return { a, land: a + Math.min(0.34, 0.09 * D) };
  }

  render(play: Play): void {
    const d = play.round.outcome.detail;
    if (d.kind !== 'oddeven') return;
    const { D } = play;
    const t = play.t;
    const n = d.pebbles;
    const sw = this.ctx.L.sw;
    // 진행자: 처음엔 쥔 손을 짤랑짤랑 흔들고, 던지는 동안은 하나 던질 때마다 살짝 까딱.
    const host = this.ctx.host();
    if (host !== null) {
      if (t < 0.3 * D) {
        const k = Math.sin(t * 24) * span(t, 0, 0.06 * D);
        host.rig.dy = -Math.abs(k) * host.height * 0.012;
        host.rig.rot = k * 0.025;
      } else if (t < 0.84 * D) {
        host.rig.rot = Math.sin(t * 14) * 0.012;
      }
    }
    const from = this.hand();
    // 조약돌
    let landed = 0;
    let lastLand = -1;
    this.pebbles.forEach((p, j) => {
      if (j >= n) {
        p.visible = false;
        return;
      }
      const { a, land } = this.drop(j, n, D);
      if (t >= land) {
        landed++;
        lastLand = land;
      }
      p.visible = t >= a && t < land;
      if (!p.visible) return;
      // 손에서 그릇 입구로 작은 포물선 (그릇 뒤로 들어간다).
      const u = (t - a) / (land - a);
      const jit = (this.jitter[j] ?? 0) * sw * 0.03;
      p.position.set(lerp(from.x, this.cx + jit, u), lerp(from.y, this.mouthY, u) - Math.sin(Math.PI * u) * this.arcH);
      p.rotation = u * 3 * (this.jitter[j] ?? 1);
    });
    // 숫자: 하나 닿을 때마다 톡.
    const pop = lastLand < 0 ? 0 : Math.max(0, 1 - (t - lastLand) / 0.18);
    if (t >= 0.86 * D) this.setCount(`${n} ${n % 2 === 1 ? '홀' : '짝'}`, 1 + Math.max(0, 1 - (t - 0.86 * D) / 0.2) * 0.3);
    else this.setCount(landed > 0 ? `${landed}` : '', 1 + pop * 0.35);
    // 손님 머리 위 말풍선과 두근두근.
    const a = this.ctx.actor(play.seat);
    if (a !== null) {
      a.setBubble(t >= 0.06 * D ? (d.guess === 'odd' ? '홀?' : '짝?') : null);
      a.rig.sy = 1 + Math.sin(t * 16) * 0.012;
    }
  }

  finish(play: Play): void {
    const d = play.round.outcome.detail;
    for (const p of this.pebbles) p.visible = false;
    if (d.kind === 'oddeven') this.setCount(`${d.pebbles} ${d.pebbles % 2 === 1 ? '홀' : '짝'}`, 1);
    this.fade = 2.5;
    const seat = play.seat;
    this.ctx.anim.after(1.3, () => this.ctx.actor(seat)?.setBubble(null));
  }

  idle(dt: number): void {
    const s = this.count.scale.x;
    if (s > 1) this.count.scale.set(Math.max(1, s - dt * 1.5));
    if (this.fade > 0) {
      this.fade = Math.max(0, this.fade - dt);
      if (this.fade < 0.6) this.count.alpha = Math.max(0.35, this.fade / 0.6);
    }
  }

  celebrate(_tier: OutcomeTier): void {
    this.count.scale.set(1.3);
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
