// 오리 낚시 부스: 물통(objects/duck_tub)에 오리 다섯(objects/rubber_duck)이 둥글게 돌며 둥실. 손님이 낚싯대(objects/fishing_rod)를 쥐고
// 줄을 내려 detail.duck 오리를 걸어 들어 올린 뒤, 손에 받아 뒤집어 바닥 표식(코드로 그린 금별·은별·빈 동그라미)을 보여 준다.
// 아깝다(slipped): 들어 올리다 오리가 버둥거리며 빠져 빙글 돌며(그때 금·은별이 슬쩍 보인다) 물로 퐁당.
// 낚싯대 그림에 그려진 줄·고리는 마스크로 가리고 줄과 고리는 코드로 그린다. 오리 아래쪽은 물빛 타원(물결)이 덮어 떠 있는 듯.
// 물 위의 오리는 장면 시계로 돌고(한판과 상관없이 이어짐), 낚는 오리만 한판 시각 t로 움직인다.

import { Container, Graphics } from 'pixi.js';
import { DUCK, type OutcomeTier } from '../../data/defs.ts';
import { ease } from '../../core/tween.ts';
import type { DuckMark } from '../../sim/types.ts';
import { type ArtNode, artSprite } from '../art.ts';
import { INK, lerp, span } from './fx.ts';
import { type Play, type Rig, type RigCtx, SETTLE } from './rig.ts';

/** objects/duck_tub (캔버스 px): 기준점(아래 가운데), 폭, 물 타원. */
const TUB = { anchor: { x: 512.5, y: 730 }, w: 683, water: { x: 512, y: 483, rx: 294, ry: 52 } } as const;
/** objects/rubber_duck (캔버스 px, 그림은 왼쪽을 본다): 고리 거는 머리 꼭대기(기준점), 물 닿는 선, 몸 가운데, 바닥 가운데, 크기. */
const DUCK_ART = { hook: { x: 438, y: 374 }, water: { x: 512, y: 668 }, center: { x: 512, y: 540 }, bottom: { x: 521, y: 710 }, w: 399, h: 359 } as const;
/**
 * objects/fishing_rod (캔버스 px, 손잡이 왼쪽 아래 → 끝 오른쪽 위): 쥐는 자리(기준점), 줄이 매달리는 끝,
 * 그림에 그려진 줄·고리를 빼고 대만 남기는 마스크 (대를 따라 가는 네모).
 */
const ROD = {
  grip: { x: 347, y: 671 },
  tip: { x: 714, y: 318 },
  mask: [
    { x: 324, y: 779 },
    { x: 241, y: 695 },
    { x: 710, y: 265 },
    { x: 755, y: 309 },
  ],
} as const;

const N = DUCK.ducks;
/** 물 위 오리가 도는 빠르기 (rad/초). */
const LOOP_SPEED = 0.45;
/** 낚싯대 쉬는 각·가장 낮은·가장 높은 들림 (rad, 수평에서 위로). */
const ROD_REST = 1.0;
const ROD_MIN = 0.45;
const ROD_MAX = 1.25;
/** 낚싯대 그림이 짤막하고 굵어서, 굵기만 이만큼 줄인다. */
const ROD_THIN = 0.62;
const WATER_COLOR = 0x8ec6ea;

// 한판 시각 (D 비율)
const AIM = [0.04, 0.14] as const; // 대를 들어 겨눔
const LOWER = [0.14, 0.34] as const; // 줄 내리기
const BITE = [0.34, 0.4] as const; // 걸림 (톡 당김)
const LIFT = [0.4, 0.56] as const; // 들어 올리기
const FLIP = [0.58, 0.7] as const; // 손에 받아 뒤집기
const BADGE = [0.7, 0.76] as const; // 표식 톡
const SLIP = 0.6; // 아깝다: 빠지는 시각
const FALL = 0.1; // 떨어지는 시간 (D 비율)

interface Plan {
  duck: number;
  mark: DuckMark;
  slipped: boolean;
  /** 걸린 순간 오리 자리 (물 위, 그 뒤로 멈춘다). null = 아직. */
  bite: { x: number; y: number; fx: number; s: number } | null;
  splashOut: boolean;
  splashIn: boolean;
}

interface DuckView {
  group: Container;
  node: ArtNode;
  ripple: Graphics;
}

export class DuckRig implements Rig {
  readonly root = new Container();
  private readonly ctx: RigCtx;
  private readonly duckLayer = new Container();
  private readonly ducks: DuckView[] = [];
  private readonly rodC = new Container();
  private readonly line = new Graphics();
  private readonly badge = new Container();
  private readonly badgeG = new Graphics();
  private readonly sparkles = new Graphics();
  private readonly kDuck: number;
  private readonly kRod: number;
  private readonly rodLen: number;
  private readonly duckW: number;
  private readonly duckH: number;
  /** 물 위 오리가 도는 길 (패널 px). */
  private readonly loop: { x: number; y: number; rx: number; ry: number };
  private readonly tub: { x: number; y: number; w: number; waterY: number };
  private readonly present: { x: number; y: number };
  private clock = Math.random() * 10;
  private lastT = 0;
  private plan: Plan | null = null;
  /** 손에 든 오리 (한판이 끝난 뒤 보여 주다가 물로 돌려보낸다). */
  private shown: { duck: number; x: number; y: number; rot: number; s: number; fx: number; mark: DuckMark } | null = null;
  private hold = 0;
  /** 물로 돌아가는 오리 (0~1). */
  private back: { duck: number; u: number; from: { x: number; y: number; rot: number; s: number; fx: number } } | null = null;
  private rodSeat = 0;
  private rodE = ROD_REST;
  private bounce = 0;
  private time = 0;

  constructor(ctx: RigCtx) {
    this.ctx = ctx;
    const L = ctx.L;
    this.root.zIndex = 20;
    const tubW = L.sw * 0.5;
    const kTub = tubW / TUB.w;
    const tx = L.sx + L.sw * 0.43;
    const waterY = L.rig.y + (TUB.water.y - TUB.anchor.y) * kTub;
    this.tub = { x: tx, y: L.rig.y, w: tubW, waterY };
    const tub = artSprite('objects', 'duck_tub', { k: kTub, anchor: TUB.anchor, placeholder: { w: TUB.w, h: 360, color: 0x74bae5 } });
    tub.position.set(tx, L.rig.y);
    this.loop = { x: tx + (TUB.water.x - TUB.anchor.x) * kTub, y: waterY + TUB.water.ry * kTub * 0.1, rx: TUB.water.rx * kTub * 0.72, ry: TUB.water.ry * kTub * 0.62 };

    this.duckW = tubW * 0.18;
    this.kDuck = this.duckW / DUCK_ART.w;
    this.duckH = DUCK_ART.h * this.kDuck;
    this.duckLayer.sortableChildren = true;
    for (let i = 0; i < N; i++) {
      const group = new Container();
      const node = artSprite('objects', 'rubber_duck', { k: this.kDuck, anchor: DUCK_ART.hook, placeholder: { w: DUCK_ART.w, h: DUCK_ART.h, color: 0xf3d36a } });
      const w = this.duckW;
      const ripple = new Graphics()
        .ellipse(0, 0, w * 0.56, w * 0.13)
        .fill({ color: WATER_COLOR })
        .moveTo(-w * 0.62, -w * 0.01)
        .quadraticCurveTo(-w * 0.5, w * 0.06, -w * 0.32, w * 0.05)
        .moveTo(w * 0.3, w * 0.06)
        .quadraticCurveTo(w * 0.5, w * 0.07, w * 0.62, -w * 0.01)
        .stroke({ color: 0xffffff, width: Math.max(1.5, w * 0.05), cap: 'round', alpha: 0.9 });
      group.addChild(node, ripple);
      this.duckLayer.addChild(group);
      this.ducks.push({ group, node, ripple });
    }
    this.present = { x: tx - tubW * 0.01, y: waterY - L.bodyH * 0.55 };
    this.root.addChild(tub, this.duckLayer);

    // 낚싯대 (손님 손에, 손님보다 앞). 그림을 뒤집어 끝이 왼쪽 위를 보게.
    this.rodLen = L.sw * 0.31;
    const g = ROD.grip;
    const tipV = { x: ROD.tip.x - g.x, y: ROD.tip.y - g.y };
    this.kRod = this.rodLen / Math.hypot(tipV.x, tipV.y);
    const rod = artSprite('objects', 'fishing_rod', { k: this.kRod, anchor: g, placeholder: { w: 505, h: 464, color: 0xa0703f } });
    const mask = new Graphics().poly(ROD.mask.flatMap((p) => [(p.x - g.x) * this.kRod, (p.y - g.y) * this.kRod])).fill({ color: 0xffffff });
    rod.mask = mask;
    // 그림의 대를 +x 방향으로 눕히고(안쪽), 굵기만 줄인 뒤(가운데), 바깥이 왼쪽 위로 돌린다.
    const inner = new Container();
    inner.addChild(rod, mask);
    inner.rotation = -Math.atan2(tipV.y, tipV.x);
    const thin = new Container();
    thin.addChild(inner);
    thin.scale.set(1, -ROD_THIN);
    this.rodC.addChild(thin);
    // 바닥 표식 (뒤집은 오리 위에 톡)
    this.badge.addChild(this.badgeG, this.sparkles);
    this.badge.visible = false;
    ctx.front.addChild(this.line, this.rodC, this.badge);
    this.idle(0, 0);
  }

  // ── 위치 계산 ──────────────────────────────────────────────────────────

  /** 물 위 오리 i의 물 닿는 점, 바라보는 쪽(+1 = 왼쪽, 그림 그대로), 앞뒤 배율. */
  private loopPos(i: number): { x: number; y: number; fx: number; s: number; th: number } {
    const th = this.clock * LOOP_SPEED + (i * Math.PI * 2) / N;
    const sn = Math.sin(th);
    return {
      x: this.loop.x + Math.cos(th) * this.loop.rx,
      y: this.loop.y + sn * this.loop.ry,
      // 앞쪽(sin > 0)에서는 왼쪽으로 간다: 돌아설 때는 납작해졌다 뒤집힌다.
      fx: Math.max(-1, Math.min(1, sn * 6)),
      // 뒤쪽은 작게: 앞뒤 오리가 같은 x에 겹쳐도 뒤 오리 머리가 보이게.
      s: 0.86 + 0.14 * (sn + 1) * 0.5,
      th,
    };
  }

  /** 오리 그림의 한 점(캔버스, 기준점에서)을 world에 두게 놓는다. */
  private placeDuck(v: DuckView, local: { x: number; y: number }, world: { x: number; y: number }, rot: number, sx: number, sy: number): void {
    const k = this.kDuck;
    const lx = (local.x - DUCK_ART.hook.x) * k * sx;
    const ly = (local.y - DUCK_ART.hook.y) * k * sy;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    v.node.scale.set(sx, sy);
    v.node.rotation = rot;
    v.node.position.set(world.x - (lx * c - ly * s), world.y - (lx * s + ly * c));
  }

  /** 오리 그림의 한 점(캔버스)이 지금 화면 어디에 있나. */
  private duckPoint(v: DuckView, local: { x: number; y: number }): { x: number; y: number } {
    const k = this.kDuck;
    const lx = (local.x - DUCK_ART.hook.x) * k * v.node.scale.x;
    const ly = (local.y - DUCK_ART.hook.y) * k * v.node.scale.y;
    const c = Math.cos(v.node.rotation);
    const s = Math.sin(v.node.rotation);
    return { x: v.node.x + lx * c - ly * s, y: v.node.y + lx * s + ly * c };
  }

  /** 물 위에 떠 있는 모습. */
  private floatDuck(i: number, p: { x: number; y: number; fx: number; s: number }, extraDy = 0): void {
    const v = this.ducks[i];
    if (v === undefined) return;
    const bob = Math.sin(this.time * 2.6 + i * 1.7) * this.duckH * 0.04;
    const rock = Math.sin(this.time * 2.1 + i * 2.3) * 0.08;
    const fx = Math.abs(p.fx) < 0.15 ? (p.fx < 0 ? -0.15 : 0.15) : p.fx;
    this.placeDuck(v, DUCK_ART.water, { x: p.x, y: p.y + bob + extraDy }, rock, fx * p.s, p.s);
    v.ripple.visible = true;
    v.ripple.position.set(p.x, p.y + this.duckW * 0.02);
    v.ripple.scale.set(p.s);
    v.group.zIndex = p.y;
  }

  /** 낚싯대를 쥔 손 (패널 px). 손님이 없으면 물통에 기대 둔 자리. */
  private gripAt(seat: number): { x: number; y: number; held: boolean } {
    const a = this.ctx.actor(seat);
    if (a === null) return { x: this.tub.x + this.tub.w * 0.56, y: this.tub.y - this.ctx.L.bodyH * 0.04, held: false };
    const h = a.hand();
    const o = a.bodyOffset();
    const s = a.root.scale.x;
    return { x: a.root.x + (h.x + o.x) * s, y: a.root.y + (h.y + o.y) * s, held: true };
  }

  /** 대를 e(수평에서 위로)로 들고 끝 자리를 돌려준다. */
  private setRod(grip: { x: number; y: number }, e: number): { x: number; y: number } {
    this.rodE = e;
    this.rodC.position.set(grip.x, grip.y);
    this.rodC.rotation = -Math.PI + e;
    return { x: grip.x - Math.cos(e) * this.rodLen, y: grip.y - Math.sin(e) * this.rodLen };
  }

  /** 겨눔 각: 끝이 x 바로 위에 오게 (닿지 않으면 끝까지). */
  private aimAt(grip: { x: number; y: number }, x: number): number {
    const c = (grip.x - x) / this.rodLen;
    return Math.acos(Math.max(Math.cos(ROD_MAX * 0.9), Math.min(Math.cos(ROD_MIN), c)));
  }

  private drawLine(tip: { x: number; y: number }, end: { x: number; y: number }, hook: boolean): void {
    const lw = Math.max(1.2, this.duckW * 0.035);
    this.line.clear().moveTo(tip.x, tip.y).lineTo(end.x, end.y).stroke({ color: 0x5b4636, width: lw, cap: 'round' });
    if (hook) {
      const r = this.duckW * 0.07;
      this.line.circle(end.x, end.y + r, r).stroke({ color: INK, width: lw * 2.2 }).circle(end.x, end.y + r, r).stroke({ color: 0xc9c3bb, width: lw });
    }
  }

  // ── 표식 ───────────────────────────────────────────────────────────────

  private drawBadge(mark: DuckMark): void {
    const r = this.duckW * 0.42;
    const g = this.badgeG.clear();
    const lw = Math.max(2, r * 0.13);
    g.circle(0, 0, r).fill({ color: 0xfff6e0 }).stroke({ color: INK, width: lw });
    if (mark === 'none') {
      // 아무것도 없다: 물방울 자국 하나
      g.moveTo(-r * 0.45, r * 0.05).quadraticCurveTo(-r * 0.22, -r * 0.2, 0, r * 0.05).quadraticCurveTo(r * 0.22, r * 0.3, r * 0.45, r * 0.05).stroke({ color: 0x9cc9e6, width: lw, cap: 'round' });
    } else {
      const pts: number[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 === 0 ? r * 0.72 : r * 0.31;
        pts.push(Math.cos(a) * rr, Math.sin(a) * rr + r * 0.04);
      }
      const gold = mark === 'gold';
      g.poly(pts).fill({ color: gold ? 0xffc83d : 0xdfe5ec }).stroke({ color: gold ? 0x8a5a12 : 0x6f7c8c, width: lw * 0.9, join: 'round' });
      g.circle(-r * 0.12, -r * 0.12, r * 0.08).fill({ color: 0xffffff, alpha: 0.9 });
    }
  }

  /** 금별 둘레 반짝이 (time으로 깜빡). */
  private drawSparkles(on: boolean): void {
    const g = this.sparkles.clear();
    if (!on) return;
    const r = this.duckW * 0.42;
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI * 0.85 + i * 0.85;
      const tw = 0.5 + 0.5 * Math.sin(this.time * 9 + i * 2.1);
      const s = r * (0.22 + 0.16 * tw);
      const x = Math.cos(a) * r * 1.45;
      const y = Math.sin(a) * r * 1.45;
      g.poly([x, y - s, x + s * 0.28, y - s * 0.28, x + s, y, x + s * 0.28, y + s * 0.28, x, y + s, x - s * 0.28, y + s * 0.28, x - s, y, x - s * 0.28, y - s * 0.28]).fill({ color: 0xffe066, alpha: 0.5 + 0.5 * tw });
    }
  }

  private splash(x: number, y: number, big: boolean): void {
    const anim = this.ctx.anim;
    const layer = this.ctx.front;
    const w = this.duckW;
    const ring = new Graphics().ellipse(0, 0, w * 0.5, w * 0.12).stroke({ color: 0xffffff, width: Math.max(1.5, w * 0.05) });
    ring.position.set(x, y);
    this.root.addChild(ring);
    void anim.run(0.6, (u) => {
      ring.scale.set(0.6 + u * (big ? 1.2 : 0.8));
      ring.alpha = 1 - u;
    }).then(() => ring.destroy());
    const n = big ? 8 : 5;
    for (let i = 0; i < n; i++) {
      const d = new Graphics().circle(0, 0, w * (0.05 + Math.random() * 0.04)).fill({ color: 0xd6eefc }).stroke({ color: 0x5b9bc6, width: Math.max(1, w * 0.025) });
      const vx = (i / (n - 1) - 0.5) * w * (big ? 2.4 : 1.6) * (0.7 + Math.random() * 0.6);
      const up = w * (big ? 0.9 : 0.55) * (0.6 + Math.random() * 0.6);
      d.position.set(x, y);
      layer.addChild(d);
      void anim.run(0.5 + Math.random() * 0.15, (u) => {
        d.position.set(x + vx * u, y - up * 4 * u * (1 - u) + u * w * 0.1);
        d.alpha = u > 0.7 ? (1 - u) / 0.3 : 1;
      }, { ease: ease.linear }).then(() => d.destroy());
    }
  }

  // ── Rig ────────────────────────────────────────────────────────────────

  begin(play: Play): void {
    const d = play.round.outcome.detail;
    if (d.kind !== 'duck') return;
    // 손에 들고 있던 오리는 물로 돌려보낸다 (이번에 낚을 오리면 바로 물 위로).
    const duck = ((d.duck % N) + N) % N;
    if (this.shown !== null) this.sendBack();
    if (this.back?.duck === duck) this.back = null;
    this.badge.visible = false;
    this.plan = { duck, mark: d.mark, slipped: d.slipped, bite: null, splashOut: false, splashIn: false };
    this.drawBadge(d.mark);
    this.lastT = play.t;
    this.rodSeat = play.seat;
    this.hold = 0;
  }

  render(play: Play): void {
    const pl = this.plan;
    if (pl === null) return;
    const D = play.D;
    const t = Math.min(play.t, SETTLE * D);
    const dt = Math.max(0, Math.min(0.1, play.t - this.lastT));
    this.lastT = play.t;
    this.time += dt;
    this.clock += dt;

    // 다른 오리는 그대로 돈다.
    this.tickBack(dt);
    for (let i = 0; i < N; i++) if (i !== pl.duck && i !== this.back?.duck) this.floatDuck(i, this.loopPos(i));
    const v = this.ducks[pl.duck];
    if (v === undefined) return;

    const grip = this.gripAt(play.seat);
    const live = this.loopPos(pl.duck);
    // 걸리기 전에는 물 위에서 돈다.
    if (t < BITE[0] * D) {
      this.floatDuck(pl.duck, live);
      pl.bite = null;
    } else if (pl.bite === null) pl.bite = { x: live.x, y: live.y, fx: live.fx >= 0 ? 1 : -1, s: live.s };
    const bite = pl.bite ?? { x: live.x, y: live.y, fx: 1, s: 1 };

    // 낚싯대 각: 쉼 → 오리 위로 겨눔 → 걸리면 톡 → 들어 올림
    const aim = this.aimAt(grip, (pl.bite ?? live).x);
    const lift = Math.min(ROD_MAX, aim + 0.35);
    let e = lerp(ROD_REST, aim, ease.inOutQuad(span(t, AIM[0] * D, AIM[1] * D)));
    if (t >= BITE[0] * D) e = aim - 0.08 * Math.sin(Math.PI * span(t, BITE[0] * D, BITE[1] * D));
    if (t >= LIFT[0] * D) e = lerp(aim, lift, ease.inOutQuad(span(t, LIFT[0] * D, LIFT[1] * D)));
    const slipT = SLIP * D;
    if (pl.slipped && t >= slipT) e = lift + 0.12 * Math.sin((t - slipT) * 18) * Math.exp(-(t - slipT) * 5);
    else if (!pl.slipped && t >= FLIP[0] * D) e = lerp(lift, ROD_REST, ease.inOutQuad(span(t, FLIP[0] * D, FLIP[1] * D)));
    const tip = this.setRod(grip, e);
    const dangle = { x: tip.x + Math.sin(this.time * 2) * this.duckW * 0.05, y: tip.y + this.duckH * 0.6 };

    // 매달린 자리: 끝 바로 아래
    const hang = { x: tip.x, y: tip.y + this.duckH * 0.55 };
    const hangRot = -0.42 * bite.fx;
    const head = { x: bite.x + (DUCK_ART.hook.x - DUCK_ART.water.x) * this.kDuck * bite.fx * bite.s, y: bite.y + (DUCK_ART.hook.y - DUCK_ART.water.y) * this.kDuck * bite.s };

    let lineEnd = dangle;
    let hooked = true;
    v.node.alpha = 1;
    if (t < LOWER[0] * D) hooked = false;
    else if (t < BITE[0] * D) {
      // 줄 끝이 도는 오리의 머리를 따라간다 (오리는 위에서 이미 놓았다).
      const liveHead = this.duckPoint(v, DUCK_ART.hook);
      lineEnd = { x: lerp(dangle.x, liveHead.x, ease.outQuad(span(t, LOWER[0] * D, LOWER[1] * D))), y: lerp(dangle.y, liveHead.y, ease.inOutQuad(span(t, LOWER[0] * D, LOWER[1] * D))) };
      hooked = false;
    } else if (t < LIFT[0] * D) {
      // 걸림: 오리가 톡 잠겼다 뜬다
      const dip = Math.sin(Math.PI * span(t, BITE[0] * D, BITE[1] * D)) * this.duckH * 0.12;
      this.floatDuck(pl.duck, { x: bite.x, y: bite.y, fx: bite.fx, s: bite.s }, dip);
      lineEnd = this.duckPoint(v, DUCK_ART.hook);
    } else if (!pl.slipped && t >= FLIP[0] * D) {
      // 손에 받아 뒤집어 보여 준다
      const u = ease.inOutQuad(span(t, FLIP[0] * D, FLIP[1] * D));
      this.showDuck(v, pl, hang, hangRot, bite.fx, u);
      hooked = false;
      lineEnd = { x: lerp(hang.x, dangle.x, u), y: lerp(hang.y, dangle.y, u) };
      const b = span(t, BADGE[0] * D, BADGE[1] * D);
      this.placeBadge(v, ease.outBack(b), pl.mark === 'gold' && b > 0.5);
    } else if (pl.slipped && t >= slipT) {
      // 빠져서 빙글 돌며 퐁당
      hooked = false;
      lineEnd = dangle;
      const land = this.loopPos(pl.duck);
      const fallT = FALL * D;
      const u = span(t, slipT, slipT + fallT);
      if (u < 1) {
        const from = { x: hang.x, y: hang.y };
        const world = { x: lerp(from.x, land.x, u), y: lerp(from.y, land.y - this.duckH * 0.5, u * u) };
        const rot = hangRot + u * Math.PI * 2 * -bite.fx;
        this.placeDuck(v, DUCK_ART.center, world, rot, bite.fx, 1);
        v.ripple.visible = false;
        v.group.zIndex = 9999;
        // 뒤집힌 순간 표식이 슬쩍
        const peek = Math.max(0, Math.cos(rot)) < 0.3 ? Math.sin(Math.PI * span(u, 0.25, 0.75)) : 0;
        this.placeBadge(v, peek * 0.8, false, peek);
      } else {
        this.badge.visible = false;
        this.floatDuck(pl.duck, land, Math.exp(-(t - slipT - fallT) * 6) * this.duckH * 0.25 * Math.cos((t - slipT - fallT) * 14));
        if (!pl.splashIn) {
          pl.splashIn = true;
          if (t - slipT - fallT < 0.3) this.splash(land.x, land.y, true);
        }
      }
    } else {
      // 들어 올리기 (아깝다면 점점 버둥)
      const u = ease.inOutQuad(span(t, LIFT[0] * D, LIFT[1] * D));
      const wr = pl.slipped ? span(t, LIFT[0] * D + 0.1, slipT) : 0;
      const sway = Math.sin(this.time * (4 + wr * 14)) * (0.08 + wr * 0.3);
      const end = { x: lerp(head.x, hang.x, u), y: lerp(head.y, hang.y, u) };
      const rot = lerp(0, hangRot, span(u, 0, 0.5)) + sway * span(u, 0, 0.3);
      const sc = lerp(bite.s, 1, u);
      this.placeDuck(v, DUCK_ART.hook, end, rot, bite.fx * sc, sc);
      v.ripple.visible = u < 0.15;
      v.group.zIndex = 9999;
      lineEnd = end;
      if (!pl.splashOut && u > 0.05) {
        pl.splashOut = true;
        if (t - LIFT[0] * D < 0.3) this.splash(bite.x, bite.y, false);
      }
    }
    this.drawLine(tip, lineEnd, !hooked);

    // 손님: 겨눌 때 몸을 숙이고, 걸리면 움찔, 들어 올릴 때 뒤로 젖힌다
    const a = this.ctx.actor(play.seat);
    if (a !== null) {
      const lean = span(t, AIM[0] * D, LOWER[0] * D) * (1 - span(t, BITE[0] * D, LIFT[0] * D));
      const pull = span(t, LIFT[0] * D, LIFT[0] * D + 0.25) * (1 - span(t, LIFT[1] * D, FLIP[0] * D + 0.2));
      const jolt = Math.sin(Math.PI * span(t, BITE[0] * D, BITE[0] * D + 0.2));
      a.rig.rot = -0.07 * lean + 0.07 * pull;
      a.rig.dx = a.bodyH * (-0.04 * lean + 0.03 * pull);
      a.rig.sy = 1 + jolt * 0.06 - lean * 0.02;
    }
  }

  /** 매달린 오리를 손에 받아(보여 주는 자리로) 뒤집는다. u = 0~1. */
  private showDuck(v: DuckView, pl: Plan, hang: { x: number; y: number }, hangRot: number, fx: number, u: number): void {
    // 매달린 모습의 몸 가운데에서 보여 주는 자리로 둥글게
    const k = this.kDuck;
    const cx = (DUCK_ART.center.x - DUCK_ART.hook.x) * k * fx;
    const cy = (DUCK_ART.center.y - DUCK_ART.hook.y) * k;
    const c0 = { x: hang.x + cx * Math.cos(hangRot) - cy * Math.sin(hangRot), y: hang.y + cx * Math.sin(hangRot) + cy * Math.cos(hangRot) };
    const p = this.present;
    const world = { x: lerp(c0.x, p.x, u), y: lerp(c0.y, p.y, u) - Math.sin(Math.PI * u) * this.duckH * 0.6 };
    const rot = lerp(hangRot, -Math.PI * fx, u);
    const s = lerp(1, 1.45, u);
    this.placeDuck(v, DUCK_ART.center, world, rot, fx * s, s);
    v.ripple.visible = false;
    v.group.zIndex = 9999;
    this.shown = { duck: pl.duck, x: world.x, y: world.y, rot, s, fx, mark: pl.mark };
  }

  /** 오리 바닥(뒤집히면 위)에 표식. */
  private placeBadge(v: DuckView, scale: number, sparkle: boolean, alpha = 1): void {
    if (scale <= 0.02 || alpha <= 0.02) {
      this.badge.visible = false;
      return;
    }
    const p = this.duckPoint(v, DUCK_ART.bottom);
    const s = Math.abs(v.node.scale.y);
    this.badge.visible = true;
    this.badge.alpha = alpha;
    this.badge.scale.set(scale * s);
    this.badge.position.set(p.x, p.y - this.duckW * 0.36 * s);
    this.drawSparkles(sparkle);
  }

  finish(play: Play): void {
    const pl = this.plan;
    play.t = Math.max(play.t, SETTLE * play.D);
    if (pl !== null) {
      this.lastT = play.t;
      this.render(play);
      if (pl.slipped) this.shown = null;
    }
    this.hold = 1.6;
    this.plan = null;
  }

  /** 손에 든 오리를 물로 돌려보내기 시작. */
  private sendBack(): void {
    const sh = this.shown;
    if (sh === null) return;
    this.back = { duck: sh.duck, u: 0, from: { x: sh.x, y: sh.y, rot: sh.rot, s: sh.s, fx: sh.fx } };
    this.shown = null;
    this.badge.visible = false;
  }

  /** 물로 돌아가는 오리: 빙글 돌며 제자리(도는 길)로 퐁당. */
  private tickBack(dt: number): void {
    const bk = this.back;
    const bv = bk === null ? undefined : this.ducks[bk.duck];
    if (bk === null || bv === undefined) return;
    bk.u = Math.min(1, bk.u + dt / 0.55);
    const to = this.loopPos(bk.duck);
    const u = bk.u;
    if (u < 1) {
      const world = { x: lerp(bk.from.x, to.x, u), y: lerp(bk.from.y, to.y - this.duckH * 0.5, u) - Math.sin(Math.PI * u) * this.duckH * 0.8 };
      const rot = lerp(bk.from.rot, bk.from.fx > 0 ? -Math.PI * 2 : Math.PI * 2, u);
      const s = lerp(bk.from.s, to.s, u);
      this.placeDuck(bv, DUCK_ART.center, world, rot, bk.from.fx * s, s);
      bv.ripple.visible = false;
      bv.group.zIndex = 9999;
    } else {
      this.splash(to.x, to.y, false);
      this.back = null;
      this.floatDuck(bk.duck, to);
    }
  }

  idle(dt: number, time: number): void {
    this.time += dt;
    this.clock += dt;
    this.tickBack(dt);
    const sh = this.shown;
    for (let i = 0; i < N; i++) if (i !== sh?.duck && i !== this.back?.duck) this.floatDuck(i, this.loopPos(i));

    // 손에 든 오리: 잠시 보여 준 뒤 물로 퐁당
    const v = sh === null ? undefined : this.ducks[sh.duck];
    if (sh !== null && v !== undefined) {
      this.placeDuck(v, DUCK_ART.center, { x: sh.x, y: sh.y + Math.sin(time * 3) * this.duckH * 0.03 }, sh.rot, sh.fx * sh.s, sh.s);
      v.group.zIndex = 9999;
      this.placeBadge(v, 1, sh.mark === 'gold');
      this.hold -= dt;
      if (this.hold <= 0) this.sendBack();
    }

    // 낚싯대: 손에 쥐고 쉬는 모습, 줄은 대롱대롱 (쥐던 손님이 가면 다른 자리 손님이 쥔다)
    if (this.ctx.actor(this.rodSeat) === null) this.rodSeat = this.ctx.actor(0) !== null ? 0 : this.ctx.actor(1) !== null ? 1 : this.rodSeat;
    const grip = this.gripAt(this.rodSeat);
    const want = grip.held ? ROD_REST : 1.25;
    const e = lerp(this.rodE, want, 1 - Math.exp(-dt * 4));
    const tip = this.setRod(grip, dt === 0 ? want : e);
    this.drawLine(tip, { x: tip.x + Math.sin(time * 2) * this.duckW * 0.05, y: tip.y + this.duckH * 0.6 }, true);

    if (this.bounce > 0) {
      this.bounce = Math.max(0, this.bounce - dt);
      const b = this.bounce;
      const s = Math.abs(Math.sin(b * Math.PI * 4)) * Math.min(1, b);
      this.duckLayer.y = -s * this.duckH * 0.3;
    } else this.duckLayer.y = 0;
  }

  celebrate(tier: OutcomeTier): void {
    if (tier === 'jackpot') this.bounce = 1.4;
    else if (tier === 'win') this.bounce = 0.5;
  }

  destroy(): void {
    this.line.destroy();
    this.rodC.destroy({ children: true });
    this.badge.destroy({ children: true });
    this.root.destroy({ children: true });
  }
}
