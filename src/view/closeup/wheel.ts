// 돌림판 부스: 받침대(wheel_stand) 굴대에 원판(wheel_disc)을 걸고, 원판 위 기둥 끝에 바늘(wheel_pointer)을 단다.
// 원판 칸 i에 슬롯 심볼(icons/SLOT_SYMBOLS[i])을 코드로 얹어 원판과 함께 돈다. 칸 사이 테두리에 작은 못.
// 손님이 찜한 칸은 노란 테두리(코드 선), 손님 머리 위에는 찜한 그림 말풍선.
// 원판 각도는 시간의 함수 (같은 t면 같은 모습): 진행자가 휙 돌리면 빨리 돌다 천천히 멈춰 detail.landed 칸이 바늘 아래 온다.
// 아깝다(nearMiss): 찜한 칸 안에서 기어가다 경계 못에 바늘이 걸려 휘고, 머뭇거리다 옆 칸으로 겨우 넘어가 멈춘다
// (그렇게 넘어가도록 도는 방향을 고른다). 대박 = 종 칸.

import { Container, Graphics, Text } from 'pixi.js';
import { type OutcomeTier, SLOT_SYMBOLS, type SlotSymbol, WHEEL } from '../../data/defs.ts';
import { ease } from '../../core/tween.ts';
import { artSprite, hasArt } from '../art.ts';
import { FONT, INK, lerp, span } from './fx.ts';
import { WHEEL_ART } from './layout.ts';
import { type Play, type Rig, type RigCtx, SETTLE } from './rig.ts';

/** objects/wheel_disc에서 잰 반지름 (캔버스 px, 가운데 WHEEL_ART.center에서): 테 바깥, 칸 끝(테 안쪽 선), 가운데 굴대, 못 자리(테 가운데). */
const DISC = { rim: 339, slice: 288, hub: 46, peg: 312 } as const;
/** objects/wheel_pointer: 위 손잡이 가운데(돌림 중심)와 거기서 아래 끝(바늘 끝)까지 (캔버스 px). */
const POINTER = { knob: { x: 511, y: 402 }, len: 345, knobR: 80 } as const;
/** objects/wheel_stand: 굴대 가운데 y와 아래 끝 y (캔버스 px). */
const STAND = { hubY: 299, bottomY: 797, w: 469 } as const;

const N = WHEEL.slices;
const SLICE = (Math.PI * 2) / N;
/** 칸 i 가운데 각도 (원판 기준, 화면 좌표: 위 = -π/2, 시계 방향 +). */
const sliceAngle = (i: number): number => -Math.PI / 2 + i * SLICE;
const wrapPi = (a: number): number => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

/** 바늘이 못에 닿는 폭 (rad): 이 안에서 못이 바늘 끝을 밀어 휜다. */
const PEG_W = 0.13;
/** 바늘이 가장 크게 휘는 각 (rad). */
const MAX_BEND = 0.5;
/** 아깝다: 경계를 넘어 멈추는 거리 (rad, 약 6°). */
const NEAR_PAST = 0.1;

const SYM_FALLBACK: Record<SlotSymbol, { name: string; color: number }> = {
  sym_apple: { name: '사과', color: 0xf0644b },
  sym_mushroom: { name: '버섯', color: 0xd9825b },
  sym_star: { name: '별', color: 0xffc83d },
  sym_gem: { name: '보석', color: 0x6bc4e8 },
  sym_acorn: { name: '도토리', color: 0xb07a4f },
  sym_bell: { name: '종', color: 0xf5b82e },
};

function symbolNode(sym: SlotSymbol, size: number): Container {
  if (hasArt('icons', sym)) return artSprite('icons', sym, { k: size / 730, anchor: 'center' });
  const f = SYM_FALLBACK[sym];
  const c = new Container();
  c.addChild(new Graphics().circle(0, 0, size * 0.42).fill({ color: f.color }).stroke({ color: INK, width: Math.max(1.5, size * 0.05) }));
  const t = new Text({ text: f.name, style: { fontFamily: FONT, fontSize: size * (f.name.length > 2 ? 0.24 : 0.3), fill: 0xffffff, stroke: { color: INK, width: Math.max(2, size * 0.05) } } });
  t.anchor.set(0.5);
  c.addChild(t);
  return c;
}

// ── 도는 모양: 속도 v(u) = 처음 살짝 붙는 힘 × (1-u)², 그 적분을 0~1로 편 표 ─────────────────
const TABLE_N = 200;
const RAMP = 0.07;
const vel = (u: number): number => (u < RAMP ? (u / RAMP) ** 2 * (3 - (2 * u) / RAMP) : 1) * (1 - u) ** 2;
const TABLE = ((): { f: Float32Array; area: number } => {
  const f = new Float32Array(TABLE_N + 1);
  let acc = 0;
  let prev = vel(0);
  for (let k = 1; k <= TABLE_N; k++) {
    const cur = vel(k / TABLE_N);
    acc += (prev + cur) / 2 / TABLE_N;
    prev = cur;
    f[k] = acc;
  }
  for (let k = 1; k <= TABLE_N; k++) f[k] = (f[k] ?? 0) / acc;
  return { f, area: acc };
})();

/** 0~1 → 간 거리 비율 0~1. */
function progress(u: number): number {
  const x = Math.max(0, Math.min(1, u)) * TABLE_N;
  const i = Math.min(TABLE_N - 1, Math.floor(x));
  return lerp(TABLE.f[i] ?? 0, TABLE.f[i + 1] ?? 1, x - i);
}

interface SpinPlan {
  picked: number;
  landed: number;
  tier: OutcomeTier;
  /** 시작·끝 각도 (rad), 도는 방향 (+1 = 시계 방향). */
  phi0: number;
  phi1: number;
  dir: 1 | -1;
  /** 도는 시간 [ts, te] (한판 시작 뒤 초). */
  ts: number;
  te: number;
  /** 아깝다: 경계 못 앞에서 머뭇거림 (가운데 시각, 폭, 늦추는 각). */
  hes: { at: number; w: number; a: number } | null;
}

export class WheelRig implements Rig {
  readonly root = new Container();
  private readonly ctx: RigCtx;
  /** 원판 (굴대 기준, 돈다). */
  private readonly wheel = new Container();
  private readonly hilite = new Graphics();
  private readonly flash = new Graphics();
  private readonly icons = new Container();
  /** 빨리 돌 때 원판 위에 얹는 흐림 (흰 원). */
  private readonly blur = new Graphics();
  private readonly pointer: Container;
  private readonly bubble = new Container();
  private readonly bubbleIcons: Container[] = [];
  private readonly k: number;
  private readonly rimPx: number;
  private readonly hub: { x: number; y: number };
  private phi = 0;
  private plan: SpinPlan | null = null;
  /** 끝난 결과를 보여 주는 남은 시간 (idle). */
  private hold = 0;
  private bounce = 0;
  private flashLeft = 0;
  private bubbleSeat = 0;

  constructor(ctx: RigCtx) {
    this.ctx = ctx;
    const L = ctx.L;
    this.root.zIndex = 20;
    this.rimPx = L.sw * 0.225;
    this.k = this.rimPx / DISC.rim;
    const k = this.k;
    this.hub = { x: L.sx + L.sw * 0.47, y: L.rig.y - this.rimPx - L.bodyH * 0.32 };
    const { x: hx, y: hy } = this.hub;

    // 바늘 기둥 (원판 뒤, 위로 솟아 바늘 손잡이를 받친다)
    const kPtr = (0.36 * this.rimPx) / POINTER.len;
    const tipY = hy - 296 * k;
    const knobY = tipY - POINTER.len * kPtr;
    const postW = this.rimPx * 0.11;
    const post = new Graphics()
      .roundRect(hx - postW / 2, knobY, postW, hy - knobY, postW * 0.35)
      .fill({ color: 0xa8703f })
      .stroke({ color: INK, width: Math.max(2, postW * 0.22) });

    // 받침대
    const kStand = (L.rig.y - hy) / (STAND.bottomY - STAND.hubY);
    const stand = artSprite('objects', 'wheel_stand', { k: kStand, anchor: 'bottom', placeholder: { w: STAND.w, h: 559, color: 0xa0703f } });
    stand.position.set(hx, L.rig.y);

    // 원판 + 칸마다 심볼 + 못 + 찜 테두리
    const disc = artSprite('objects', 'wheel_disc', { k, anchor: WHEEL_ART.center, placeholder: { w: 686, h: 686, color: 0xf3d36a } });
    const icons = this.icons;
    const rc = 0.6 * DISC.slice * k;
    const icon = 0.78 * rc;
    SLOT_SYMBOLS.forEach((s, i) => {
      const n = symbolNode(s, icon);
      const a = sliceAngle(i);
      n.position.set(Math.cos(a) * rc, Math.sin(a) * rc);
      n.rotation = a + Math.PI / 2;
      icons.addChild(n);
    });
    const pegs = new Graphics();
    const pegR = Math.max(2.2, 15 * k);
    for (let i = 0; i < N; i++) {
      const a = sliceAngle(i) - SLICE / 2;
      pegs.circle(Math.cos(a) * DISC.peg * k, Math.sin(a) * DISC.peg * k, pegR).fill({ color: 0xfff3d6 }).stroke({ color: INK, width: Math.max(1.5, pegR * 0.45) });
    }
    this.flash.alpha = 0;
    this.hilite.alpha = 0;
    this.blur.circle(0, 0, DISC.slice * k).fill({ color: 0xffffff });
    this.blur.alpha = 0;
    this.wheel.addChild(disc, this.flash, icons, this.blur, this.hilite, pegs);
    this.wheel.position.set(hx, hy);

    // 바늘 (손잡이를 축으로 휜다)
    this.pointer = new Container();
    const ptr = artSprite('objects', 'wheel_pointer', { k: kPtr, anchor: POINTER.knob, placeholder: { w: 345, h: 426, color: 0xe0705a } });
    this.pointer.addChild(ptr);
    this.pointer.position.set(hx, knobY);

    this.root.addChild(post, stand, this.wheel, this.pointer);

    // 찜한 그림 말풍선 (손님 머리 위, 손님보다 앞)
    const br = L.bodyH * 0.17;
    const line = Math.max(2, br * 0.12);
    const bg = new Graphics()
      .poly([-br * 0.5, br * 0.7, -br * 0.62, br * 1.4, br * 0.05, br * 0.9])
      .fill({ color: 0xffffff })
      .stroke({ color: INK, width: line, join: 'round' })
      .circle(0, 0, br)
      .fill({ color: 0xffffff })
      .stroke({ color: INK, width: line });
    this.bubble.addChild(bg);
    for (const s of SLOT_SYMBOLS) {
      const n = symbolNode(s, br * 1.5);
      n.visible = false;
      this.bubbleIcons.push(n);
      this.bubble.addChild(n);
    }
    this.bubble.visible = false;
    ctx.front.addChild(this.bubble);
    this.drawWheel(0);
  }

  // ── 그리기 도우미 ─────────────────────────────────────────────────────

  /** 칸 i의 부채꼴 (원판 기준 px). */
  private wedge(g: Graphics, i: number, inset: number): Graphics {
    const k = this.k;
    const a0 = sliceAngle(i) - SLICE / 2 + inset;
    const a1 = sliceAngle(i) + SLICE / 2 - inset;
    const ro = DISC.slice * k * 0.97;
    const ri = DISC.hub * k * 1.25;
    return g
      .moveTo(Math.cos(a0) * ri, Math.sin(a0) * ri)
      .arc(0, 0, ro, a0, a1)
      .lineTo(Math.cos(a1) * ri, Math.sin(a1) * ri)
      .arc(0, 0, ri, a1, a0, true)
      .closePath();
  }

  private drawWheel(phi: number): void {
    this.phi = phi;
    this.wheel.rotation = phi;
  }

  /** 바늘 휨: 바늘 쪽으로 오는 못이 바늘 끝을 밀고, 지나간 못 뒤로는 바늘이 튕겨 돌아온다. */
  private bend(phi: number, speed: number, dir: number): number {
    let push = 0;
    let wob = 0;
    let nearPass = Infinity;
    for (let i = 0; i < N; i++) {
      // 못 i (칸 i와 i-1 사이)가 바늘(위)에서 떨어진 각, 움직이는 쪽을 +로.
      const q = dir * wrapPi(sliceAngle(i) - SLICE / 2 + phi + Math.PI / 2);
      if (q <= 0 && q > -PEG_W) push = Math.max(push, 1 + q / PEG_W);
      else if (q > 0) nearPass = Math.min(nearPass, q);
    }
    if (nearPass < Infinity) {
      const tau = nearPass / Math.max(0.05, Math.abs(speed));
      wob = Math.exp(-tau * 9) * Math.cos(tau * 32);
    }
    const b = Math.max(-1, Math.min(1, push + wob * (1 - push)));
    return -dir * MAX_BEND * b;
  }

  private phiAt(pl: SpinPlan, t: number): number {
    if (t <= pl.ts) return pl.phi0;
    if (t >= pl.te) return pl.phi1;
    const total = Math.abs(pl.phi1 - pl.phi0);
    let d = total * progress((t - pl.ts) / (pl.te - pl.ts));
    if (pl.hes !== null) d -= pl.hes.a * Math.exp(-(((t - pl.hes.at) / pl.hes.w) ** 2)) * (1 - span(t, pl.te - pl.hes.w * 0.5, pl.te));
    return pl.phi0 + pl.dir * d;
  }

  // ── Rig ────────────────────────────────────────────────────────────────

  begin(play: Play): void {
    const d = play.round.outcome.detail;
    if (d.kind !== 'wheel') return;
    const tier = play.round.outcome.tier;
    const D = play.D;
    const picked = ((d.picked % N) + N) % N;
    const landed = ((d.landed % N) + N) % N;
    let dir: 1 | -1 = 1;
    // 칸 landed 가운데에서 바늘이 얼마나 비껴 멈추나 (rad, +면 원판이 그만큼 더 돈 자리).
    let off = (Math.random() * 2 - 1) * 0.33;
    const near = tier === 'nearMiss' && landed !== picked;
    if (near) {
      // 찜한 칸에서 옆 칸으로 '넘어가도록' 도는 방향: 시계 방향이면 바늘 아래 칸이 i → i-1.
      dir = landed === (picked + N - 1) % N ? 1 : -1;
      off = dir * (NEAR_PAST - SLICE / 2);
    }
    // 각은 한 바퀴 안으로 접어 둔다 (한판마다 몇 바퀴씩 쌓이지 않게).
    const phi0 = this.phi - Math.PI * 2 * Math.floor(this.phi / (Math.PI * 2));
    const target = -landed * SLICE + off;
    const turns = Math.max(1, d.turns);
    const rest = (((dir * (target - phi0)) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const total = turns * Math.PI * 2 + rest;
    const ts = 0.13 * D;
    const te = (near ? 0.86 : 0.82) * D;
    let hes: SpinPlan['hes'] = null;
    if (near) {
      // 경계를 넘는 때 (남은 각 = NEAR_PAST)를 찾아, 그 바로 앞에서 못에 걸려 머뭇거리게.
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (total * (1 - progress(mid)) > NEAR_PAST) lo = mid;
        else hi = mid;
      }
      const T = te - ts;
      const tc = ts + lo * T;
      const w = Math.max(0.12, 0.07 * T);
      const speed = (total * vel(lo)) / (TABLE.area * T);
      // 뒤로 돌지 않게: 늦추는 양의 기울기가 그때 속도를 넘지 않게.
      const a = Math.min(0.1, (0.65 * speed * w) / 0.86);
      hes = { at: tc - w * 0.45, w, a };
    }
    this.plan = { picked, landed, tier, phi0, phi1: phi0 + dir * total, dir, ts, te, hes };

    this.hilite.clear();
    const line = Math.max(3, this.rimPx * 0.07);
    this.wedge(this.hilite, picked, 0.02).stroke({ color: INK, width: line + 3, join: 'round' });
    this.wedge(this.hilite, picked, 0.02).stroke({ color: 0xffd84a, width: line, join: 'round' });
    this.flash.clear();
    this.wedge(this.flash, landed, 0).fill({ color: 0xffffff });
    this.flash.alpha = 0;
    this.hold = 0;
    this.bubbleSeat = play.seat;
    this.bubbleIcons.forEach((n, i) => (n.visible = i === picked));
  }

  render(play: Play): void {
    const pl = this.plan;
    if (pl === null) return;
    const D = play.D;
    const t = Math.min(play.t, SETTLE * D);
    const phi = this.phiAt(pl, t);
    const speed = (phi - this.phiAt(pl, t - 1 / 60)) * 60;
    this.drawWheel(phi);
    this.pointer.rotation = this.bend(phi, speed, pl.dir);
    // 빠르면 그림이 흐려진다 (한 프레임에 칸 반쯤 도는 속도).
    const blur = Math.max(0, Math.min(1, (Math.abs(speed) - 7) / 10));
    this.icons.alpha = 1 - blur * 0.6;
    this.blur.alpha = blur * 0.22;

    // 찜: 말풍선이 톡, 칸 테두리가 반짝 두 번 → 도는 동안 은은히
    const pick = span(t, 0.02 * D, 0.1 * D);
    this.hilite.alpha = pick < 1 ? (Math.sin(pick * Math.PI * 4) > -0.3 ? pick : 0.2) : 0.85 + 0.15 * Math.sin(t * 7);
    this.placeBubble(play.seat, ease.outBack(pick), 1);

    // 맞으면 그 칸이 깜빡
    const won = pl.tier === 'win' || pl.tier === 'jackpot';
    this.flash.alpha = won && t >= pl.te ? 0.25 + 0.3 * (0.5 + 0.5 * Math.cos((t - pl.te) * 14)) : 0;

    // 진행자: 원판 쪽으로 몸을 기울여 휙
    const host = this.ctx.host();
    if (host !== null) {
      const fling = span(t, 0.07 * D, 0.17 * D);
      host.rig.rot += 0.12 * Math.sin(Math.PI * fling);
      host.rig.dy -= host.height * 0.02 * Math.sin(Math.PI * fling);
    }
    // 손님: 도는 동안 들썩, 느려지면 몸을 앞으로 숙이고 떤다
    const a = this.ctx.actor(play.seat);
    if (a !== null) {
      const lean = span(t, lerp(pl.ts, pl.te, 0.55), lerp(pl.ts, pl.te, 0.8)) * (1 - span(t, pl.te + 0.1 * D, pl.te + 0.16 * D));
      a.rig.dx = -a.bodyH * 0.05 * lean;
      a.rig.rot = -0.06 * lean;
      a.rig.sy = 1 + Math.sin(play.t * (lean > 0 ? 38 : 14)) * (lean > 0 ? 0.008 : 0.012);
    }
  }

  /** 찜한 그림 말풍선을 그 자리 손님 머리 위에 (꼬리가 머리를 가리킨다). */
  private placeBubble(seat: number, scale: number, alpha: number): void {
    const a = this.ctx.actor(seat);
    if (a === null || scale <= 0.01 || alpha <= 0.01) {
      this.bubble.visible = false;
      return;
    }
    const s = a.root.scale.x;
    const r = this.ctx.L.bodyH * 0.17;
    this.bubble.visible = true;
    this.bubble.alpha = alpha;
    this.bubble.scale.set(scale * s);
    this.bubble.position.set(a.root.x + (a.bodyH * 0.02 + a.rig.dx) * s, a.root.y + a.headY * s - r * 1.45 * s);
  }

  finish(play: Play): void {
    play.t = Math.max(play.t, SETTLE * play.D);
    this.render(play);
    this.hold = 1.8;
    this.icons.alpha = 1;
    this.blur.alpha = 0;
    this.flashLeft = this.flash.alpha > 0 ? 1.4 : 0;
    this.plan = null;
  }

  idle(dt: number, time: number): void {
    // 바늘은 제자리로
    this.pointer.rotation *= Math.exp(-dt * 10);
    if (this.hold > 0) {
      this.hold = Math.max(0, this.hold - dt);
      this.placeBubble(this.bubbleSeat, 1, Math.min(1, this.hold / 0.4));
      if (this.flashLeft > 0) {
        this.flashLeft = Math.max(0, this.flashLeft - dt);
        this.flash.alpha = this.flashLeft > 0 ? 0.25 + 0.3 * (0.5 + 0.5 * Math.cos(time * 14)) : 0;
      }
    } else {
      this.bubble.visible = false;
      this.flash.alpha = Math.max(0, this.flash.alpha - dt * 2);
      this.hilite.alpha = Math.max(0, this.hilite.alpha - dt * 1.5);
    }
    if (this.bounce > 0) {
      this.bounce = Math.max(0, this.bounce - dt);
      const u = this.bounce;
      const s = Math.abs(Math.sin(u * Math.PI * 4)) * Math.min(1, u);
      this.wheel.scale.set(1 + s * 0.06);
    } else this.wheel.scale.set(1);
  }

  celebrate(tier: OutcomeTier): void {
    if (tier === 'jackpot') {
      this.bounce = 1.6;
      this.flashLeft = 1.8;
    } else if (tier === 'win') this.bounce = 0.5;
  }

  destroy(): void {
    this.bubble.destroy({ children: true });
    this.root.destroy({ children: true });
  }
}
