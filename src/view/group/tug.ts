// 지도 위 줄다리기. 심판대·깃발은 buildings.ts (부스 그림 map/tug_stand, props tug_flag_red·blue).
// 바닥: 가운데 흰 점선, 홍·청 승리 선 (리본이 그 편 선을 넘으면 그 편 승리, 넘는 순간 번쩍).
// 밧줄(코드: 굵은 갈색 선, 가운데 빨간 리본)은 줄 잡은 손님들의 손을 지난다 (몸이 기울면 손도 따라간다). 아무도 없으면 땅에 놓여 있다.
// 모이는 중: 온 손님이 줄을 느슨하게 잡고 (줄이 처진다), 출발이 가까우면 뒤로 기울어 준비.
// 판 중: 밧줄 가운데 c(t)(play.tracks[0], +1 = 홍 쪽)만큼 줄과 양편이 같이 끌려가고, 편마다 '영차' 박자로 뒤로 젖혀 당긴다.
//   끌려가는 편은 덜 젖히고 발밑에 먼지, 많이 밀리면 괴로운 얼굴. 사건(앞섬·위기·역전)마다 응원단장이 들썩.
// crossAt에 승부: 진 편은 줄을 놓치고 안쪽부터 차례로 앞으로 우르르 넘어지고, 이긴 편은 뒤로 엉덩방아를 찧은 뒤 기쁨 포즈로 폴짝 (역전이면 색종이).
// 모두 화면 시계(this.clock)의 함수. 밧줄은 보일 때만 다시 그린다 (점은 미리 만든 버퍼에, 프레임마다 새 객체를 만들지 않는다).

import { Graphics } from 'pixi.js';
import { SIDES } from '../../data/defs.ts';
import { TUG_FIELD, type Pt } from '../../data/map.ts';
import { ease } from '../../core/tween.ts';
import { trackAt } from '../../sim/group/core.ts';
import type { GroupEntry, GroupPlay, GroupState, Pose } from '../../sim/types.ts';
import type { ViewRect } from '../mapUtil.ts';
import { GroupMapBase, type GroupMapCtx } from './base.ts';
import { clamp01, crossed, LieShadows, NO_KEYS, PuppetSet, seated, smooth, type Body } from './ssireumPuppets.ts';

const OUTLINE = 0x402c1c;
const CHALK = 0xfff6e2;
const ROPE = 0x9a6a3e;
const ROPE_HI = 0xc99a62;
const RIBBON = 0xe0503a;
/** 편마다 줄 잡는 자리 수 (자리 짝수 홍·홀수 청, 가운데에서 바깥으로). */
const RANKS = 4;
/** 줄이 땅에 놓인 높이 (발 y 기준 아래로). */
const GROUND = 8;
/** 아무도 없을 때 땅에 놓인 밧줄의 반 길이. */
const REST_HALF = 470;
/** 진행자 자리. */
const REFEREE = 0;
const CHEER = 1;
/** 진 편이 넘어지기까지 (초), 안쪽부터 한 사람마다 늦게. */
const FALL = 0.34;
const FALL_STAGGER = 0.07;

/** 한 손님의 손 (고쳐 쓴다). */
interface Grip {
  has: boolean;
  /** 줄을 놓았다 (진 편, 넘어진 뒤). */
  dropped: boolean;
  x: number;
  y: number;
  /** 발 (먼지·땅 높이). */
  fx: number;
  fy: number;
}

const grip = (): Grip => ({ has: false, dropped: false, x: 0, y: 0, fx: 0, fy: 0 });

export class TugMapView extends GroupMapBase {
  private readonly bodies: PuppetSet;
  private readonly lie = new LieShadows();
  private readonly lines = new Graphics();
  /** 승리 선이 번쩍 (홍·청). */
  private readonly flash: [Graphics, Graphics];
  private readonly rope = new Graphics();
  /** 편마다 안쪽부터 손 (홍 0, 청 1). */
  private readonly grips: [Grip[], Grip[]] = [Array.from({ length: RANKS }, grip), Array.from({ length: RANKS }, grip)];
  /** 밧줄 점 버퍼 (x, y 번갈아). */
  private readonly pts = new Float64Array(512);
  private n = 0;
  private prevClock = 0;
  private evi = 0;
  private dustAt = 0;
  /** 땅에 놓인 밧줄을 그려 두었다 (그대로면 다시 그리지 않는다). */
  private restDrawn = false;
  /** 승리 선 번쩍임 (남은 초). */
  private flashT = 0;
  private flashSide = 0;

  constructor(ctx: GroupMapCtx) {
    super(ctx);
    this.bodies = new PuppetSet(ctx.monsters);
    this.own(ctx.layers.floor, this.lines);
    const c = TUG_FIELD.center;
    // 가운데 흰 점선과 홍·청 승리 선.
    for (let y = c.y - 64; y < c.y + 60; y += 22) this.lines.roundRect(c.x - 3, y, 6, 12, 3).fill({ color: CHALK, alpha: 0.8 });
    for (let s = 0; s < 2; s++) {
      const x = c.x + (s === 0 ? -1 : 1) * TUG_FIELD.lineHalf;
      this.lines.roundRect(x - 5, c.y - 70, 10, 134, 5).fill({ color: CHALK, alpha: 0.9 });
      this.lines.roundRect(x - 2.5, c.y - 66, 5, 126, 2.5).fill({ color: SIDES[s as 0 | 1].color, alpha: 0.9 });
    }
    this.flash = [this.flashLine(0), this.flashLine(1)];
    this.own(ctx.layers.shadows, this.lie.node);
    this.own(ctx.layers.objects, this.rope);
  }

  private flashLine(side: 0 | 1): Graphics {
    const c = TUG_FIELD.center;
    const x = c.x + (side === 0 ? -1 : 1) * TUG_FIELD.lineHalf;
    const g = new Graphics().roundRect(x - 14, c.y - 78, 28, 150, 14).fill({ color: 0xfff3b0, alpha: 0.85 });
    g.alpha = 0;
    return this.own(this.ctx.layers.floor, g);
  }

  protected override onShown(show: boolean): void {
    super.onShown(show);
    if (!show) this.bodies.clear();
    this.restDrawn = false;
  }

  protected override onPlay(p: GroupPlay | null): void {
    this.prevClock = this.clock;
    this.evi = 0;
    if (p === null) return;
    while (this.evi < p.events.length && (p.events[this.evi]?.t ?? Infinity) <= this.clock) this.evi++;
  }

  private seatPt(seat: number): Pt {
    return this.spot.seats[seat] ?? TUG_FIELD.center;
  }

  protected draw(dt: number, view: ViewRect): void {
    const g = this.group;
    const play = this.play;
    const t = this.clock;
    const prev = this.prevClock;
    this.prevClock = t;
    // 시작 숫자 3·2·1 (심판대 위).
    this.startCount(TUG_FIELD.center.x, this.spot.base.y - 250, REFEREE);
    for (let s = 0; s < 2; s++) for (let r = 0; r < RANKS; r++) ((this.grips[s] as Grip[])[r] as Grip).has = false;
    this.lie.begin();
    const tug = play !== null && play.kind === 'tug' ? play : null;
    let ribbon = 0;
    if (g !== null && g.participants.length > 0) ribbon = this.pull(g, tug, t, prev);
    this.lie.end();
    this.bodies.flush(dt);
    if (tug !== null) this.events(tug, t);
    // 승리 선 번쩍.
    this.flashT = Math.max(0, this.flashT - dt);
    for (let s = 0; s < 2; s++) (this.flash[s] as Graphics).alpha = s === this.flashSide ? Math.sin(Math.min(1, this.flashT / 1.6) * Math.PI) * (0.6 + 0.4 * Math.sin(this.time * 18)) : 0;
    // 밧줄: 보일 때만.
    const c = TUG_FIELD.center;
    const onScreen = view.x1 >= c.x - 620 && view.x0 <= c.x + 620 && view.y1 >= c.y - 160 && view.y0 <= c.y + 120;
    this.rope.visible = onScreen;
    if (!onScreen) {
      this.restDrawn = false;
      return;
    }
    if (!this.anyGrip()) {
      if (!this.restDrawn) this.drawRest();
      return;
    }
    this.restDrawn = false;
    this.drawRope(ribbon);
  }

  /**
   * 줄 잡은 손님마다 몸을 맡기고 손 자리를 grips에 적는다. 돌려주는 값 = 리본(밧줄 가운데)의 x.
   */
  private pull(g: GroupState, play: Extract<GroupPlay, { kind: 'tug' }> | null, t: number, prev: number): number {
    const c = TUG_FIELD.center;
    const R = TUG_FIELD.reach;
    const fx = this.ctx.fx;
    const cv = play === null ? 0 : t < play.crossAt ? trackAt(play.tracks[0] ?? NO_KEYS, t) : play.winner === 0 ? 1 : -1;
    const vel = play === null || t >= play.crossAt ? 0 : (cv - trackAt(play.tracks[0] ?? NO_KEYS, t - 0.15)) / 0.15;
    const shift = -cv * R;
    const after = play === null ? -1 : t - play.crossAt;
    // 모이는 중: 편마다 한 사람 이상이고 출발이 가까우면 준비 자세.
    let hasRed = false;
    let hasBlue = false;
    for (let i = 0; i < g.participants.length; i++) {
      if ((g.participants[i] as GroupEntry).pick === 0) hasRed = true;
      else hasBlue = true;
    }
    const ready = play === null ? (g.phase === 'gathering' && hasRed && hasBlue ? smooth((1.5 - g.countdown) / 0.6) : 0) : 1;
    let dust = false;
    if (play !== null && after < 0 && Math.abs(vel) > 0.14 && this.time >= this.dustAt) {
      dust = true;
      this.dustAt = this.time + 0.2;
    }
    // 이긴 편이 엉덩방아로 물러난 거리 (리본도 같이).
    let winBack = 0;
    for (let i = 0; i < g.participants.length; i++) {
      const e = g.participants[i] as GroupEntry;
      const m = this.monster(e.monster);
      const v = this.view(e.monster);
      if (!seated(m, this.booth, e.seat) || v === undefined) continue;
      const side = e.pick === 1 ? 1 : 0;
      const f: 1 | -1 = side === 0 ? 1 : -1;
      const rank = Math.min(RANKS - 1, Math.floor(e.seat / 2));
      const s = this.seatPt(e.seat);
      const b = this.bodies.take(e.monster);
      b.facing = f;
      const gp = (this.grips[side] as Grip[])[rank] as Grip;
      gp.has = true;
      gp.dropped = false;
      if (play === null) {
        // 느슨하게 잡고 기다린다 → 출발 직전 뒤로 기울어 준비.
        b.rot = -f * (0.05 + 0.22 * ready);
        b.sx = 1 + 0.03 * ready;
        b.sy = 1 - 0.06 * ready;
      } else if (after < 0) {
        // 영차: 편마다 같은 박자로 뒤로 젖힌다 (두 편은 엇박).
        const adv = f * cv;
        const gain = f * vel;
        const heave = Math.max(0, Math.sin(this.time * 5.6 + (side === 0 ? 0 : Math.PI)));
        const dragged = clamp01(-gain * 2.5);
        const lean = 0.3 + 0.1 * heave * (1 - dragged) + 0.1 * clamp01(adv) - 0.14 * dragged;
        const k = smooth(t / 0.35);
        b.dx = shift - f * 4 * heave * k;
        b.rot = -f * (0.27 + (lean - 0.27) * k);
        b.sx = 1.03;
        b.sy = 0.94;
        // 끌려가는 편은 발을 동동.
        b.lift = Math.abs(Math.sin(this.time * 12 + e.seat * 1.7)) * 4 * dragged;
        if (adv < -0.4) b.pose = 'agony';
        if (dust && dragged > 0.3) fx.puff(s.x + b.dx - f * 10, s.y + 2, 2, 22);
      } else if (e.pick === play.winner) {
        winBack = this.winner(b, f, rank, after, shift, play.end - play.crossAt);
        if (crossed(prev - play.crossAt, after, 0.28 + rank * 0.05)) fx.puff(s.x + b.dx - f * 12, s.y, 3, 30);
      } else {
        const fall = this.loser(b, f, rank, after, shift, v.halfW, m.pose, t >= play.end);
        gp.dropped = fall > 0.25;
        // 누운 몸 아래 그림자 (머리는 앞쪽).
        if (fall > 0.4) this.lie.add(s.x + b.dx + f * v.headH * 0.5, s.y + 3, v.headH * 0.55, v.halfW * 0.38, smooth((fall - 0.4) / 0.6));
        if (crossed(prev - play.crossAt, after, FALL + rank * FALL_STAGGER)) fx.puff(s.x + b.dx + f * v.headH * 0.45, s.y + 2, 4, 46);
      }
      this.hand(gp, b, s, f, v.headH, v.halfW);
    }
    if (play !== null && after >= 0) return c.x + shift + (play.winner === 0 ? -1 : 1) * winBack;
    return c.x + shift;
  }

  /** 이긴 편: 줄이 풀리며 뒤로 휘청 → 엉덩방아 → 일어나 폴짝. 돌려주는 값 = 뒤로 물러난 거리. */
  private winner(b: Body, f: 1 | -1, rank: number, after: number, shift: number, tail: number): number {
    const u = after - rank * 0.05;
    const back = 26 * ease.outQuad(clamp01(u / 0.28));
    b.dx = shift - f * back;
    if (after >= tail) {
      // 결과 반응(sim)의 연출을 그대로.
      b.still = false;
      b.rot = 0;
      return back;
    }
    if (u < 0.28) {
      const s = clamp01(u / 0.28);
      b.rot = -f * (0.32 + 0.3 * s);
      b.lift = Math.sin(s * Math.PI) * 10;
    } else if (u < 0.8) {
      // 엉덩방아: 납작하게 주저앉는다.
      const s = clamp01((u - 0.28) / 0.12);
      b.rot = -f * (0.62 - 0.42 * s);
      b.sx = 1 + 0.12 * s;
      b.sy = 1 - 0.2 * s;
    } else {
      const w = u - 0.8;
      b.pose = 'joy';
      b.sy = 1 - 0.2 * Math.max(0, 1 - w / 0.12);
      b.lift = Math.abs(Math.sin(w * 7.5 + rank * 0.6)) * 13 * Math.max(0.25, 1 - w / 2.5);
    }
    return back;
  }

  /** 진 편: 앞으로 끌려가며 우르르 엎어진다 (안쪽부터). 돌려주는 값 = 넘어진 정도 0~1. */
  private loser(b: Body, f: 1 | -1, rank: number, after: number, shift: number, halfW: number, mp: Pose, ended: boolean): number {
    const u = after - rank * FALL_STAGGER;
    const s = clamp01(u / FALL);
    const lean = 0.18;
    b.dx = shift + f * 30 * ease.outQuad(s);
    const lieLift = halfW * 0.72;
    if (s < 1) {
      b.rot = -f * lean * (1 - s) + f * 1.35 * ease.inQuad(s);
      b.lift = lieLift * s + Math.sin(s * Math.PI) * 14;
      b.pose = 'agony';
    } else {
      const w = u - FALL;
      const decay = Math.exp(-w * 3.5);
      b.rot = f * 1.35 + Math.sin(w * 9) * 0.06 * decay;
      b.lift = lieLift + Math.abs(Math.sin(w * 11)) * 8 * decay;
      b.pose = ended && (mp === 'agony' || mp === 'sad') ? mp : 'sad';
    }
    return s;
  }

  /** 몸(기울기·들림)을 따라간 손 자리 (발에서 앞으로 반폭의 반, 머리 높이의 0.42). */
  private hand(gp: Grip, b: Body, s: Pt, f: 1 | -1, headH: number, halfW: number): void {
    const lx = f * halfW * 0.5;
    const ly = -headH * 0.42;
    const cs = Math.cos(b.rot);
    const sn = Math.sin(b.rot);
    gp.fx = s.x + b.dx;
    gp.fy = s.y + b.dy;
    gp.x = gp.fx + lx * cs - ly * sn;
    gp.y = gp.fy + lx * sn + ly * cs - b.lift;
  }

  private anyGrip(): boolean {
    for (let s = 0; s < 2; s++) for (let r = 0; r < RANKS; r++) if (((this.grips[s] as Grip[])[r] as Grip).has) return true;
    return false;
  }

  // ── 밧줄 그리기 ──

  private push(x: number, y: number): void {
    if (this.n >= this.pts.length - 2) return;
    this.pts[this.n++] = x;
    this.pts[this.n++] = y;
  }

  /** 지금 끝점에서 (cx, cy)를 거쳐 (x, y)까지 2차 곡선을 점으로. */
  private quad(cx: number, cy: number, x: number, y: number, steps: number): void {
    const x0 = this.pts[this.n - 2] ?? x;
    const y0 = this.pts[this.n - 1] ?? y;
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      const a = (1 - u) * (1 - u);
      const bb = 2 * (1 - u) * u;
      const cc = u * u;
      this.push(a * x0 + bb * cx + cc * x, a * y0 + bb * cy + cc * y);
    }
  }

  /** 지금 끝점에서 (x, y)까지: 팽팽하면 곧게, 느슨하면 처지게. */
  private span(x: number, y: number, slack: number): void {
    const x0 = this.pts[this.n - 2] ?? x;
    const y0 = this.pts[this.n - 1] ?? y;
    if (slack <= 0.01) this.push(x, y);
    else this.quad((x0 + x) / 2, (y0 + y) / 2 + slack * (10 + Math.abs(x - x0) * 0.08), x, y, 6);
  }

  /** 리본 x에서 밧줄 y (점 사이 보간). */
  private ropeY(x: number): number {
    const p = this.pts;
    for (let i = 0; i + 3 < this.n; i += 2) {
      const x0 = p[i] as number;
      const x1 = p[i + 2] as number;
      if ((x0 - x) * (x1 - x) <= 0 && x0 !== x1) return (p[i + 1] as number) + ((p[i + 3] as number) - (p[i + 1] as number)) * ((x - x0) / (x1 - x0));
    }
    return TUG_FIELD.center.y + GROUND;
  }

  /** 아무도 없을 때: 땅에 놓인 밧줄 (한 번만 그린다). */
  private drawRest(): void {
    const c = TUG_FIELD.center;
    this.n = 0;
    const y = c.y + GROUND + 4;
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      this.push(c.x - REST_HALF + u * REST_HALF * 2, y + Math.sin(u * Math.PI * 3) * 7);
    }
    this.rope.zIndex = c.y - 60;
    this.stroke();
    this.ribbonAt(c.x, this.ropeY(c.x), true);
    this.restDrawn = true;
  }

  /** 줄 잡은 손을 지나는 밧줄 (판 중에는 팽팽, 모이는 중에는 처진다). */
  private drawRope(ribbonX: number): void {
    const c = TUG_FIELD.center;
    const red = this.grips[0];
    const blue = this.grips[1];
    const play = this.play;
    const running = play !== null && play.kind === 'tug' && this.clock < play.crossAt;
    const slack = running ? 0 : this.play === null ? 1 : 0.3;
    // 손: 홍은 바깥(왼쪽)부터, 청은 안쪽부터 (왼쪽에서 오른쪽 순서).
    let maxY: number = c.y;
    let outerRed = -1;
    let innerRed = -1;
    let innerBlue = -1;
    let outerBlue = -1;
    for (let r = 0; r < RANKS; r++) {
      const a = red[r] as Grip;
      if (a.has && !a.dropped) {
        if (innerRed < 0) innerRed = r;
        outerRed = r;
        maxY = Math.max(maxY, a.fy);
      }
      const b = blue[r] as Grip;
      if (b.has && !b.dropped) {
        if (innerBlue < 0) innerBlue = r;
        outerBlue = r;
        maxY = Math.max(maxY, b.fy);
      }
    }
    this.n = 0;
    // 왼쪽 끝.
    if (outerRed >= 0) {
      const a = red[outerRed] as Grip;
      this.push(a.x - 120, (a.fy + GROUND) + 2);
      this.push(a.x - 62, (a.fy + GROUND));
      this.quad(a.x - 22, a.y + 8, a.x, a.y, 5);
      for (let r = outerRed - 1; r >= 0; r--) {
        const h = red[r] as Grip;
        if (h.has && !h.dropped) this.span(h.x, h.y, slack);
      }
    } else if (outerBlue >= 0) {
      // 홍이 없다 (모이는 중이거나 진 홍이 놓쳤다): 홍 쪽 줄은 땅에.
      const b = blue[innerBlue] as Grip;
      this.push(ribbonX - REST_HALF + 140, (b.fy + GROUND) + 2);
      this.push(b.x - 80, (b.fy + GROUND));
      this.quad(b.x - 28, b.y + 8, b.x, b.y, 5);
    }
    // 가운데.
    if (innerRed >= 0 && innerBlue >= 0) {
      const b = blue[innerBlue] as Grip;
      this.span(b.x, b.y, slack);
    } else if (innerRed >= 0) {
      const a = red[innerRed] as Grip;
      this.quad(a.x + 28, a.y + 8, a.x + 80, (a.fy + GROUND), 5);
      this.push(ribbonX + REST_HALF - 140, (a.fy + GROUND) + 2);
    }
    // 오른쪽.
    if (innerBlue >= 0) {
      for (let r = innerBlue + 1; r <= outerBlue; r++) {
        const h = blue[r] as Grip;
        if (h.has && !h.dropped) this.span(h.x, h.y, slack);
      }
      const b = blue[outerBlue] as Grip;
      this.quad(b.x + 22, b.y + 8, b.x + 62, (b.fy + GROUND), 5);
      this.push(b.x + 120, (b.fy + GROUND) + 2);
    }
    this.rope.zIndex = maxY + 1;
    this.stroke();
    // 팽팽한 줄은 살짝 떨린다.
    const ry = this.ropeY(ribbonX) + (running ? Math.sin(this.time * 31) * 0.8 : 0);
    // 땅에 놓인 리본은 납작하게.
    this.ribbonAt(ribbonX, ry, !running && ry > c.y);
  }

  /** 점 버퍼를 테두리·속·밝은 줄 세 번 긋는다. */
  private stroke(): void {
    const g = this.rope;
    g.clear();
    if (this.n < 4) return;
    for (let pass = 0; pass < 3; pass++) {
      const oy = pass === 2 ? -1.6 : 0;
      g.moveTo(this.pts[0] as number, (this.pts[1] as number) + oy);
      for (let i = 2; i < this.n; i += 2) g.lineTo(this.pts[i] as number, (this.pts[i + 1] as number) + oy);
      if (pass === 0) g.stroke({ width: 11, color: OUTLINE, cap: 'round', join: 'round' });
      else if (pass === 1) g.stroke({ width: 7, color: ROPE, cap: 'round', join: 'round' });
      else g.stroke({ width: 2, color: ROPE_HI, cap: 'round', join: 'round', alpha: 0.9 });
    }
  }

  /** 가운데 빨간 리본 (매듭 + 늘어진 두 자락). flat = 땅에 놓였다. */
  private ribbonAt(x: number, y: number, flat: boolean): void {
    const g = this.rope;
    const sway = flat ? 0 : Math.sin(this.time * 4) * 3;
    const tail = flat ? 9 : 20;
    for (let s = -1; s <= 1; s += 2) {
      g.moveTo(x + s * 2, y)
        .lineTo(x + s * 13 + sway, y + tail)
        .lineTo(x + s * 4 + sway, y + tail - 4)
        .closePath()
        .fill(RIBBON)
        .stroke({ color: OUTLINE, width: 2.5, join: 'round' });
    }
    g.roundRect(x - 7, y - 7, 14, 14, 4).fill(RIBBON).stroke({ color: OUTLINE, width: 2.5 });
  }

  // ── 사건 ──

  private events(play: Extract<GroupPlay, { kind: 'tug' }>, t: number): void {
    const fx = this.ctx.fx;
    const b = this.ctx.buildings;
    const c = TUG_FIELD.center;
    while (this.evi < play.events.length) {
      const ev = play.events[this.evi];
      if (ev === undefined || ev.t > t) break;
      this.evi++;
      if (t - ev.t > 0.5) continue;
      switch (ev.type) {
        case 'lead':
          b.hostHop(this.booth, CHEER, 0.8);
          break;
        case 'brink':
          b.hostHop(this.booth, CHEER, 1.1);
          b.hostHop(this.booth, REFEREE, 0.6);
          break;
        case 'flip':
          // 역전 시작: 응원단장이 크게, 리본에서 반짝.
          b.hostHop(this.booth, CHEER, 1.6);
          fx.sparkles(c.x - trackAt(play.tracks[0] ?? NO_KEYS, t) * TUG_FIELD.reach, c.y - 60, 6, 50);
          break;
        case 'finish': {
          // 선을 넘었다: 리본 자리 먼지, 그 편 선이 번쩍, 심판·응원단장 들썩. 역전이면 색종이.
          const x = c.x + (play.winner === 0 ? -1 : 1) * TUG_FIELD.reach;
          fx.puff(x, c.y - 20, 7, 62);
          this.flashSide = play.winner;
          this.flashT = 1.6;
          b.hostHop(this.booth, REFEREE, 1.4);
          b.hostHop(this.booth, CHEER, 1.4);
          if (play.comeback) fx.confetti(x, c.y - 60, 28);
          break;
        }
        default:
          break;
      }
    }
  }

  override hitTest(wx: number, wy: number): boolean {
    const c = TUG_FIELD.center;
    return wx >= c.x - 560 && wx <= c.x + 560 && wy >= c.y - 120 && wy <= c.y + 60;
  }

  override destroy(): void {
    this.bodies.clear();
    super.destroy();
    this.lie.destroy();
  }
}
