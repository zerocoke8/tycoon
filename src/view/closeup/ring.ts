// 고리 던지기 부스: 계단 선반(코드로 그림, 3단) 위에 병(objects/bottle) 3×3. 손님이 고리(objects/toss_ring)를 세 번 던진다.
// 고리는 포물선으로 날아가 detail.throws[i].bottle 위에서: 걸림 = 병목을 타고 내려가 어깨에 걸쳐 앉는다,
// 빗나감 = 병 주둥이에 맞고 튕겨 바닥으로, wobble = 주둥이에서 빙글빙글 돌다가 (걸림이면) 내려앉거나 (빗나감이면) 떨어진다.
// 아깝다(nearMiss)는 늘 마지막 고리가 오래 돌다 떨어진다. 선반 앞면의 표시 셋이 던질 때마다 걸림·빗나감을 보여 준다.
// 병 i: 줄 = floor(i / 3) (0 = 앞줄, 가장 낮은 단), 칸 = i % 3. 고리가 병목에 걸리면 고리 뒤쪽 반은 병 뒤, 앞쪽 반은 병 앞에 그린다.

import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { type OutcomeTier, RING } from '../../data/defs.ts';
import { ease } from '../../core/tween.ts';
import type { RingThrow } from '../../sim/types.ts';
import { type ArtNode, artMeta, artSprite, artTexture } from '../art.ts';
import { clamp01, INK, lerp, span } from './fx.ts';
import { type Play, type Rig, type RigCtx, SETTLE } from './rig.ts';

/** objects/bottle에서 잰 값 (병 높이의 비율, 아래에서): 고리가 걸려 앉는 어깨 높이, 주둥이 위 끝. 병 폭(캔버스 px). */
const BOTTLE_ART = { neck: 0.56, lip: 0.9, w: 395, h: 612 } as const;
/** objects/toss_ring 폭 (캔버스 px). */
const RING_W = 505;

/** 고리 하나의 시간표 (한판 길이의 비율): 손에 들기, 놓기, 병에 닿기, 흔들림 끝. */
interface Throw {
  readonly th: RingThrow;
  readonly hold: number;
  readonly release: number;
  readonly land: number;
  /** wobble이면 이때까지 주둥이에서 돈다. */
  readonly spinEnd: number;
  /** 빗나간 고리가 튕기는 방향 (-1 왼쪽, 1 오른쪽). */
  readonly side: number;
}

interface Slot {
  x: number;
  /** 병 아래 끝 y. */
  y: number;
  /** 줄의 원근 배율 (앞줄 1). */
  s: number;
  z: number;
}

export class RingRig implements Rig {
  readonly root = new Container();
  private readonly ctx: RigCtx;
  private readonly slots: Slot[] = [];
  private readonly bottles: ArtNode[] = [];
  /** 던지는 중·떨어지는 고리 (손님보다 앞). */
  private readonly fly: ArtNode[] = [];
  /** 병에 걸친 고리: 뒤쪽(전체 그림, 병 뒤)과 앞쪽 반(병 앞, 그림이 오면 만든다). */
  private readonly back: ArtNode[] = [];
  private readonly frontHalf: (Sprite | null)[] = [null, null, null];
  /** 앞쪽 반 그림의 배율 (그림 해상도에 맞춘 값). */
  private halfK = 1;
  private readonly marks = new Graphics();
  readonly guardRight: number;
  private readonly markAt: { x: number; y: number; r: number };
  private readonly hb: number;
  private readonly kR: number;
  private readonly base: number;
  private readonly g: number;
  private plan: Throw[] = [];
  /** 끝난 한판의 고리를 두는 시간, 그다음 흐려지는 정도. */
  private hold = 0;
  private fade = 1;
  private shake = 0;

  constructor(ctx: RigCtx) {
    this.ctx = ctx;
    const L = ctx.L;
    const sw = L.sw;
    this.root.zIndex = 20;
    this.root.sortableChildren = true;
    this.g = sw * 3.2;
    // 진행자(왼쪽)와 손님(오른쪽, 몸이 왼쪽으로 뻗는다) 사이: 조금 왼쪽으로.
    const cx = L.sx + sw * 0.43;
    this.base = L.rig.y + (L.h - L.rig.y) * 0.05;
    // 앞줄 병 높이와 단 높이 (뒷줄 병이 앞줄 병 위로 거의 다 보이게).
    this.hb = L.bodyH * 0.31;
    const kB = this.hb / BOTTLE_ART.h;
    this.kR = (kB * BOTTLE_ART.w * 1.3) / RING_W;
    const rise = this.hb * 0.72;
    const top = rise * 0.3;
    const widths = [sw * 0.34, sw * 0.31, sw * 0.28];
    // 넓은 손님(게 집게·거북 등딱지)이 앞단 오른쪽 병과 표시를 가리지 않게 (scene.ts가 손님을 민다).
    this.guardRight = cx + (widths[0] ?? 0) / 2 + Math.max(2, sw * 0.008);
    // 계단 선반: 뒷단부터 (앞단이 뒷단 아래를 가린다).
    for (let k = RING.bottles / 3 - 1; k >= 0; k--) {
      const w = widths[k] ?? sw * 0.4;
      const y = this.base - (k + 1) * rise;
      const line = Math.max(2, sw * 0.007);
      const step = new Graphics()
        .roundRect(cx - w / 2, y, w, this.base - y, Math.max(3, sw * 0.012))
        .fill({ color: 0xbf8656 })
        .stroke({ color: INK, width: line })
        .roundRect(cx - w / 2, y, w, top, Math.max(3, sw * 0.012))
        .fill({ color: 0xe2b27c })
        .stroke({ color: INK, width: line });
      step.zIndex = 10 + (2 - k) * 10 - 5;
      this.root.addChild(step);
      const s = 1 - k * 0.08;
      for (let c = 0; c < 3; c++) {
        this.slots.push({ x: cx + (c - 1) * sw * 0.092 * s, y: y + top * 0.62, s, z: 10 + (2 - k) * 10 });
      }
    }
    // slots는 뒷단부터 넣었다: 병 번호(0 = 앞줄)에 맞게 뒤집는다.
    const rows = [this.slots.slice(6, 9), this.slots.slice(3, 6), this.slots.slice(0, 3)].flat();
    this.slots.splice(0, this.slots.length, ...rows);
    for (const sl of this.slots) {
      const b = artSprite('objects', 'bottle', { k: kB * sl.s, anchor: 'bottom', placeholder: { w: 395, h: 612, color: 0x9ed9bf } });
      b.position.set(sl.x, sl.y);
      b.zIndex = sl.z;
      this.bottles.push(b);
      this.root.addChild(b);
    }
    for (let i = 0; i < RING.throws; i++) {
      const f = artSprite('objects', 'toss_ring', { k: this.kR, anchor: 'center', placeholder: { w: 505, h: 311, color: 0xe0705a } });
      f.visible = false;
      this.fly.push(f);
      ctx.front.addChild(f);
      const b = artSprite('objects', 'toss_ring', { k: this.kR, anchor: 'center', placeholder: { w: 505, h: 311, color: 0xe0705a } });
      b.visible = false;
      this.back.push(b);
      this.root.addChild(b);
    }
    // 앞단 앞면의 표시 셋 (던진 고리마다 걸림·빗나감)
    this.markAt = { x: cx, y: this.base - (rise - top) * 0.5, r: Math.max(5, Math.min(rise * 0.24, sw * 0.022)) };
    this.marks.zIndex = 40;
    this.root.addChild(this.marks);
    this.drawMarks([]);
  }

  /** 병에 걸친 고리의 앞쪽 반: 그림이 있을 때만 (늦게 오면 그때 만든다). */
  private half(i: number): Sprite | null {
    const cur = this.frontHalf[i] ?? null;
    if (cur !== null) return cur;
    const tex = artTexture('objects', 'toss_ring');
    const m = artMeta('objects', 'toss_ring');
    if (tex === undefined || m === undefined) return null;
    const fr = tex.frame;
    const sub = new Texture({ source: tex.source, frame: new Rectangle(fr.x, fr.y + fr.height / 2, fr.width, fr.height / 2) });
    const sp = new Sprite(sub);
    sp.anchor.set(0.5, 0);
    this.halfK = this.kR / m.scale;
    sp.visible = false;
    this.root.addChild(sp);
    this.frontHalf[i] = sp;
    return sp;
  }

  private guestHand(seat: number): { x: number; y: number } {
    const a = this.ctx.actor(seat);
    const L = this.ctx.L;
    if (a === null) return { x: L.sx + L.sw * 0.75, y: L.feetY - L.bodyH * 0.6 };
    const h = a.hand();
    const s = a.root.scale.x;
    return { x: a.root.x + h.x * s, y: a.root.y + h.y * s };
  }

  begin(play: Play): void {
    const d = play.round.outcome.detail;
    if (d.kind !== 'ring') return;
    const n = d.throws.length;
    const last = play.round.outcome.tier === 'nearMiss';
    this.plan = d.throws.map((th, i) => {
      const hold = 0.03 + i * 0.27;
      const release = hold + 0.07;
      const land = release + 0.12;
      // 마지막 고리가 아깝게 돌 때는 끝까지 오래 돈다.
      const spinEnd = th.wobble ? (i === n - 1 && last ? 0.88 : Math.min(0.88, land + 0.13)) : land;
      return { th, hold, release, land, spinEnd, side: Math.random() < 0.5 ? -1 : 1 };
    });
    this.hold = 0;
    this.fade = 1;
    this.clearRings();
  }

  private clearRings(): void {
    for (const f of this.fly) f.visible = false;
    for (const b of this.back) {
      b.visible = false;
      b.alpha = 1;
    }
    for (const h of this.frontHalf) if (h !== null) h.visible = false;
    this.drawMarks([]);
  }

  render(play: Play): void {
    const plan = this.plan;
    if (plan.length === 0) return;
    const { D } = play;
    const t = Math.min(play.t, SETTLE * D);
    const sw = this.ctx.L.sw;
    const a = this.ctx.actor(play.seat);
    const hand = this.guestHand(play.seat);
    const results: boolean[] = [];
    let throwPose = 0;
    let fling = 0;
    plan.forEach((p, i) => {
      const fly = this.fly[i];
      const back = this.back[i];
      const slot = this.slots[p.th.bottle];
      if (fly === undefined || back === undefined || slot === undefined) return;
      const hold = p.hold * D;
      const rel = p.release * D;
      const land = p.land * D;
      const spinEnd = p.spinEnd * D;
      // 손님: 움츠렸다 던지기
      if (t >= hold && t < rel + 0.06 * D) {
        throwPose = span(t, hold, rel) * (1 - span(t, rel, rel + 0.03 * D));
        fling = Math.max(fling, Math.sin(Math.PI * span(t, rel, rel + 0.06 * D)));
      }
      const neck = this.neckAt(slot);
      const lip = this.lipAt(slot);
      const half = this.half(i);
      const setOn = (x: number, y: number, rot: number, sy: number): void => {
        back.visible = true;
        back.position.set(x, y);
        back.rotation = rot;
        back.scale.set(slot.s, slot.s * sy);
        back.zIndex = slot.z - 1;
        if (half !== null) {
          half.visible = true;
          half.position.set(x, y);
          half.rotation = rot;
          half.scale.set(this.halfK * slot.s, this.halfK * slot.s * sy);
          half.zIndex = slot.z + 1;
        }
        fly.visible = false;
      };
      const offBottle = (): void => {
        back.visible = false;
        if (half !== null) half.visible = false;
      };
      if (t < hold) {
        fly.visible = false;
        offBottle();
        return;
      }
      if (t < rel) {
        // 손에 든 고리 (살짝 흔들)
        fly.visible = true;
        fly.position.set(hand.x, hand.y - sw * 0.01);
        fly.rotation = -0.3 + Math.sin(play.t * 10) * 0.08;
        fly.scale.set(1.15);
        fly.alpha = 1;
        offBottle();
        return;
      }
      if (t < land) {
        // 포물선 (멀어질수록 작게, 빙글 돌며)
        const u = (t - rel) / (land - rel);
        const to = { x: lip.x, y: lip.y - this.hb * slot.s * 0.25 };
        const ctrl = { x: lerp(hand.x, to.x, 0.5), y: Math.min(hand.y, to.y) - sw * 0.2 };
        fly.visible = true;
        fly.position.set((1 - u) ** 2 * hand.x + 2 * (1 - u) * u * ctrl.x + u * u * to.x, (1 - u) ** 2 * hand.y + 2 * (1 - u) * u * ctrl.y + u * u * to.y);
        fly.rotation = Math.sin(u * Math.PI * 3) * 0.35;
        fly.scale.set(lerp(1.15, slot.s, u), lerp(1.15, slot.s, u) * (1 - 0.25 * Math.abs(Math.sin(u * Math.PI * 4))));
        fly.alpha = 1;
        offBottle();
        return;
      }
      // 닿은 뒤
      const tau = t - land;
      if (p.th.wobble && t < spinEnd) {
        // 주둥이에서 빙글빙글: 기울기가 원을 그리며 점점 빨라진다 (걸림이면 잦아들고, 빗나감이면 커진다).
        const w = clamp01(tau / Math.max(0.01, spinEnd - land));
        const phase = tau * (10 + w * 16);
        const amp = p.th.hit ? lerp(0.5, 0.15, w) : lerp(0.35, 0.65, w);
        const bw = BOTTLE_ART.w * (this.hb / BOTTLE_ART.h) * slot.s;
        setOn(lip.x + Math.cos(phase) * bw * 0.18 * amp, lip.y + this.hb * slot.s * 0.12 + Math.abs(Math.sin(phase)) * this.hb * 0.03, Math.sin(phase) * amp, 0.85 + 0.15 * Math.cos(phase * 2));
        // 도는 동안은 표시가 아직 비어 있다 (두근두근).
        return;
      }
      const after = p.th.wobble ? t - spinEnd : tau;
      if (p.th.hit) {
        // 병목을 타고 내려가 어깨에 걸쳐 앉는다 (톡 튕기며).
        const u = clamp01(after / (0.06 * D));
        const y = lerp(p.th.wobble ? lip.y + this.hb * slot.s * 0.12 : lip.y - this.hb * slot.s * 0.1, neck.y, ease.outBounce(u));
        const settle = (1 - u) * Math.sin(after * 30) * 0.12;
        setOn(neck.x, y, settle, 1);
        results[i] = true;
        return;
      }
      // 빗나감: 주둥이에 맞고 튕겨 (wobble이면 옆으로 넘어가) 바닥으로, 한 번 튕기고 사라진다.
      offBottle();
      const x0 = lip.x;
      const y0 = lip.y - this.hb * slot.s * (p.th.wobble ? -0.04 : 0.12);
      const vx = p.side * sw * (p.th.wobble ? 0.22 : 0.35);
      const vy = -sw * (p.th.wobble ? 0.25 : 0.7);
      const floor = this.base + sw * 0.02;
      const pos = this.toss(after, x0, y0, vx, vy, floor);
      fly.visible = true;
      fly.position.set(pos.x, pos.y);
      fly.rotation = p.side * (p.th.wobble ? 0.6 : 0) + after * p.side * 9 * (pos.rest ? 0 : 1);
      fly.scale.set(slot.s * lerp(1, 1.1, clamp01(after / 0.4)), slot.s * (pos.rest ? 0.7 : 1));
      fly.alpha = 1 - span(after, 0.45, 0.7);
      results[i] = false;
    });
    if (a !== null) {
      a.rig.sx = 1 + throwPose * 0.08 - fling * 0.05;
      a.rig.sy = 1 - throwPose * 0.12 + fling * 0.08;
      a.rig.rot = throwPose * 0.1 - fling * 0.14;
      a.rig.dx = a.bodyH * (throwPose * 0.04 - fling * 0.06);
    }
    // 진행자: 걸릴 때마다 까딱.
    const host = this.ctx.host();
    if (host !== null) {
      let nod = 0;
      for (const p of plan) {
        if (!p.th.hit) continue;
        const at = (p.th.wobble ? p.spinEnd : p.land) * D;
        nod = Math.max(nod, Math.sin(Math.PI * span(t, at, at + 0.08 * D)));
      }
      host.rig.dy = -nod * host.height * 0.02;
    }
    this.drawMarks(results);
  }

  /** 던진 물체의 s초 뒤 자리 (바닥에서 한 번 튕긴 뒤 머문다). */
  private toss(s: number, x0: number, y0: number, vx: number, vy: number, floor: number): { x: number; y: number; rest: boolean } {
    const g = this.g;
    let x = x0;
    let y = Math.min(y0, floor);
    let u = vx;
    let v = vy;
    let left = s;
    for (let b = 0; b < 2; b++) {
      const hit = (-v + Math.sqrt(Math.max(0, v * v + 2 * g * (floor - y)))) / g;
      if (left <= hit) return { x: x + u * left, y: y + v * left + 0.5 * g * left * left, rest: false };
      left -= hit;
      x += u * hit;
      y = floor;
      v = -(v + g * hit) * 0.3;
      u *= 0.5;
    }
    return { x, y: floor, rest: true };
  }

  private neckAt(sl: Slot): { x: number; y: number } {
    return { x: sl.x, y: sl.y - this.hb * sl.s * BOTTLE_ART.neck };
  }

  private lipAt(sl: Slot): { x: number; y: number } {
    return { x: sl.x, y: sl.y - this.hb * sl.s * BOTTLE_ART.lip };
  }

  /** 선반 앞면의 표시: 걸림 = 주황 고리, 빗나감 = 흐린 ✕, 아직 = 빈 동그라미. */
  private drawMarks(results: readonly (boolean | undefined)[]): void {
    const { x, y, r } = this.markAt;
    const g = this.marks.clear();
    const gap = r * 3;
    const line = Math.max(1.5, r * 0.3);
    for (let i = 0; i < RING.throws; i++) {
      const cx = x + (i - (RING.throws - 1) / 2) * gap;
      const res = results[i];
      if (res === true) {
        g.circle(cx, y, r).stroke({ color: INK, width: line * 2.2 }).circle(cx, y, r).stroke({ color: 0xf08a5c, width: line * 1.3 });
      } else if (res === false) {
        const k = r * 0.6;
        g.circle(cx, y, r).fill({ color: 0xfff6e6, alpha: 0.5 });
        g.moveTo(cx - k, y - k).lineTo(cx + k, y + k).moveTo(cx + k, y - k).lineTo(cx - k, y + k).stroke({ color: 0x8a7a6a, width: line });
      } else {
        g.circle(cx, y, r).fill({ color: 0xfff6e6, alpha: 0.6 }).stroke({ color: INK, width: line * 0.7, alpha: 0.6 });
      }
    }
  }

  finish(play: Play): void {
    play.t = Math.max(play.t, SETTLE * play.D);
    this.render(play);
    for (const f of this.fly) f.visible = false;
    this.hold = 2;
    this.fade = 0;
  }

  idle(dt: number): void {
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const k = this.shake;
      this.bottles.forEach((b, i) => {
        b.rotation = Math.sin(k * 40 + i) * 0.08 * k;
      });
      if (this.shake === 0) for (const b of this.bottles) b.rotation = 0;
    }
    if (this.hold > 0) {
      this.hold -= dt;
      return;
    }
    // 걸친 고리는 조금 뒤 흐려지며 치운다 (다음 손님을 위해).
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / 0.5);
      for (const b of this.back) b.alpha = 1 - this.fade;
      for (const h of this.frontHalf) if (h !== null) h.alpha = 1 - this.fade;
      if (this.fade >= 1) {
        this.clearRings();
        for (const h of this.frontHalf) if (h !== null) h.alpha = 1;
        for (const b of this.back) b.alpha = 1;
      }
    }
  }

  celebrate(tier: OutcomeTier): void {
    // 대박: 병들이 달그락 흔들린다.
    if (tier === 'jackpot') this.shake = 0.8;
  }

  destroy(): void {
    for (const f of this.fly) f.destroy({ children: true });
    this.root.destroy({ children: true });
  }
}
