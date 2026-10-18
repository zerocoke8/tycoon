// 지도 위 효과: 코인 튀기기, 떠오르는 숫자, 색종이, 반짝이, 눈물, 먼지, 하트.
// 넷째 묶음 (DESIGN 3.7): 물건 날리기(itemArc: 재료가 바구니로), 일터의 흙덩이(clods)·돌 조각(chips)·땀(sweat)·한숨(sigh), 반장 호루라기 선(toot).
// 입자는 미리 만든 Sprite를 돌려 쓴다 (풀). 프레임마다 새 객체를 만들지 않는다.
// 그림(fx/*, items/coin)이 아직 없으면 코드로 그린 작은 텍스처를 한 번 만들어 쓴다.
// 화면 연출용 무작위라 Math.random을 쓴다 (ARCHITECTURE: 연출 무작위는 허용).

import { ColorMatrixFilter, Container, Graphics, Sprite, Text, Texture, type Renderer } from 'pixi.js';
import type { EmoteKind } from '../sim/types.ts';
import { artTexture } from './art.ts';

const OUTLINE = 0x402c1c;

/** 색종이 색 (art-kit 팔레트에서). */
const CONFETTI_COLORS = [0xf3d36a, 0xe8875a, 0x8ec8ee, 0xa8c47e, 0xb8a5d8, 0xf2b5a8, 0xf2b279] as const;

// ── 텍스처 (그림 또는 코드로 그린 대신 그림) ───────────────────────────────

type FallbackKey = 'coin' | 'confetti' | 'sparkle' | 'puff' | 'tear' | 'heart' | 'chip' | 'clod' | 'line' | `emote_${EmoteKind}`;

/** 효과용 텍스처 상자. 그림이 있으면 그림, 없으면 코드로 그린 것 (한 번만 만든다). */
export class FxTextures {
  private readonly renderer: Renderer;
  private readonly made = new Map<string, Texture>();

  constructor(renderer: Renderer) {
    this.renderer = renderer;
  }

  /** group/key 그림을 찾고, 없으면 fallback 모양을 코드로 그린다. */
  get(group: string, key: string, fallback: FallbackKey): Texture {
    return artTexture(group, key) ?? this.fallback(fallback);
  }

  emote(kind: EmoteKind): Texture {
    return this.get('fx', `emote_${kind}`, `emote_${kind}`);
  }

  /**
   * 색종이 바탕: 그림(주황 리본)을 밝은 회색으로 바꿔 한 번 구워 둔다 → tint로 팔레트 색이 깨끗하게 나온다
   * (주황에 바로 파랑 tint를 곱하면 탁해진다). 그림이 없으면 흰 네모.
   */
  confetti(): Texture {
    const hit = this.made.get('confetti_base');
    if (hit !== undefined) return hit;
    const art = artTexture('fx', 'fx_confetti');
    if (art === undefined) return this.fallback('confetti');
    const sp = new Sprite(art);
    const f = new ColorMatrixFilter();
    const k = 1.45;
    const r = 0.299 * k;
    const g = 0.587 * k;
    const b = 0.114 * k;
    f.matrix = [r, g, b, 0, 0, r, g, b, 0, 0, r, g, b, 0, 0, 0, 0, 0, 1, 0];
    sp.filters = [f];
    const tex = this.renderer.generateTexture({ target: sp, resolution: 1, antialias: true });
    sp.destroy();
    f.destroy();
    this.made.set('confetti_base', tex);
    return tex;
  }

  private fallback(key: FallbackKey): Texture {
    const hit = this.made.get(key);
    if (hit !== undefined) return hit;
    const g = drawFallback(key);
    const tex = this.renderer.generateTexture({ target: g, resolution: 2, antialias: true });
    g.destroy();
    this.made.set(key, tex);
    return tex;
  }

  /**
   * WebGL 문맥을 되찾은 뒤: 코드로 구운 텍스처(RenderTexture)는 비어 버리니 잊고, 다음에 쓸 때 다시 굽는다.
   * 날고 있는 입자가 아직 들고 있을 수 있어 지우지는 않는다 (몇 개라 작다).
   */
  reset(): void {
    this.made.clear();
  }

  destroy(): void {
    for (const t of this.made.values()) t.destroy(true);
    this.made.clear();
  }
}

/** 물방울 모양 (테두리 먼저, 속 나중 → 겹친 선이 안 보인다). */
function drop(g: Graphics, color: number, s: number): void {
  const body = (gg: Graphics): Graphics => gg.circle(0, 5 * s, 9 * s).poly([0, -14 * s, 8 * s, 1 * s, -8 * s, 1 * s]);
  body(g).stroke({ color: OUTLINE, width: 5 * s, join: 'round' });
  body(g).fill(color);
  g.circle(-3 * s, 3 * s, 2.6 * s).fill({ color: 0xffffff, alpha: 0.8 });
}

function star(g: Graphics, r: number, inner: number, color: number): void {
  const pts: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : inner;
    pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.poly(pts).fill(color).stroke({ color: OUTLINE, width: 3.5, join: 'round' });
}

function drawFallback(key: FallbackKey): Graphics {
  const g = new Graphics();
  switch (key) {
    case 'coin':
      g.circle(0, 0, 20).fill(0xf3d36a).stroke({ color: OUTLINE, width: 4 });
      g.circle(0, 0, 11).stroke({ color: 0xc9953a, width: 3 });
      break;
    case 'confetti':
      g.roundRect(-6, -10, 12, 20, 3).fill(0xffffff);
      break;
    case 'sparkle':
    case 'emote_sparkle':
      star(g, 24, 7, 0xffe680);
      break;
    case 'puff': {
      const blob = (gg: Graphics): Graphics => gg.circle(0, 0, 22).circle(-16, 8, 15).circle(17, 7, 16);
      blob(g).stroke({ color: OUTLINE, width: 5 });
      blob(g).fill(0xf4f1ea);
      break;
    }
    case 'tear':
    case 'emote_tear':
      drop(g, 0x74bae5, key === 'tear' ? 0.8 : 1.4);
      break;
    case 'emote_sweat':
      drop(g, 0xbfe3f5, 1.4);
      break;
    case 'heart':
    case 'emote_heart': {
      const heart = (gg: Graphics): Graphics => gg.circle(-9, -5, 10.5).circle(9, -5, 10.5).poly([-19.2, -1, 19.2, -1, 0, 19]);
      heart(g).stroke({ color: OUTLINE, width: 5, join: 'round' });
      heart(g).fill(0xf28b9b);
      g.circle(-11, -8, 3).fill({ color: 0xffffff, alpha: 0.85 });
      break;
    }
    case 'chip':
      // 작은 돌 조각 (tint로 회색 여러 가지).
      g.poly([-7, -3, -1, -8, 7, -4, 6, 4, -2, 7, -8, 3]).fill(0xffffff).stroke({ color: OUTLINE, width: 2.5, join: 'round' });
      break;
    case 'clod':
      // 흙덩이 (tint로 흙색).
      g.circle(0, 0, 7).circle(5, 3, 5).stroke({ color: OUTLINE, width: 5 });
      g.circle(0, 0, 7).circle(5, 3, 5).fill(0xffffff);
      break;
    case 'line':
      // 짧은 선 (호루라기 소리, 가로로 길다).
      g.roundRect(-9, -2.6, 18, 5.2, 2.6).fill(OUTLINE);
      break;
    case 'emote_storm': {
      const cloud = (gg: Graphics): Graphics => gg.circle(-11, 0, 11).circle(4, -6, 13).circle(15, 2, 9).roundRect(-20, 0, 42, 10, 5);
      cloud(g).stroke({ color: OUTLINE, width: 5 });
      cloud(g).fill(0x9a98a6);
      g.poly([2, 12, -6, 24, 1, 24, -4, 34, 10, 20, 3, 20, 8, 12]).fill(0xf3d36a).stroke({ color: OUTLINE, width: 2.5, join: 'round' });
      break;
    }
    case 'emote_note':
      g.rect(3, -20, 5, 26).fill(0x6b4fa0);
      g.poly([8, -20, 20, -14, 20, -8, 8, -13]).fill(0x6b4fa0);
      g.ellipse(-1, 7, 9, 7).fill(0x6b4fa0).stroke({ color: OUTLINE, width: 3 });
      break;
    case 'emote_anger':
      for (const [sx, sy] of [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ] as const) {
        g.moveTo(sx * 15, sy * 5).lineTo(sx * 5, sy * 5).lineTo(sx * 5, sy * 15).stroke({ color: OUTLINE, width: 9, cap: 'round', join: 'round' });
        g.moveTo(sx * 15, sy * 5).lineTo(sx * 5, sy * 5).lineTo(sx * 5, sy * 15).stroke({ color: 0xd9534f, width: 5, cap: 'round', join: 'round' });
      }
      break;
    case 'emote_shock':
      g.roundRect(-6, -24, 12, 28, 6).fill(0xf3d36a).stroke({ color: OUTLINE, width: 4 });
      g.circle(0, 14, 6.5).fill(0xf3d36a).stroke({ color: OUTLINE, width: 4 });
      break;
    case 'emote_sleep':
      // 초승달 대신 'z' 둘 (졸림).
      for (const [x, y, s] of [
        [-6, 4, 1],
        [10, -12, 0.7],
      ] as const) {
        g.moveTo(x - 8 * s, y - 8 * s).lineTo(x + 8 * s, y - 8 * s).lineTo(x - 8 * s, y + 8 * s).lineTo(x + 8 * s, y + 8 * s).stroke({ color: OUTLINE, width: 8 * s, cap: 'round', join: 'round' });
        g.moveTo(x - 8 * s, y - 8 * s).lineTo(x + 8 * s, y - 8 * s).lineTo(x - 8 * s, y + 8 * s).lineTo(x + 8 * s, y + 8 * s).stroke({ color: 0x9fb0e8, width: 4 * s, cap: 'round', join: 'round' });
      }
      break;
    case 'emote_yum': {
      const heart = (gg: Graphics): Graphics => gg.circle(-7, -4, 8).circle(7, -4, 8).poly([-14.6, -1, 14.6, -1, 0, 14]);
      heart(g).stroke({ color: OUTLINE, width: 5, join: 'round' });
      heart(g).fill(0xf0a04b);
      break;
    }
  }
  return g;
}

// ── 입자 ────────────────────────────────────────────────────────────────

const PHYS = 0; // 속도·중력
const ARC = 1; // 출발점 → 도착점 포물선 (코인)
const POP = 2; // 제자리에서 커졌다 작아짐 (반짝이)

interface Particle {
  sp: Sprite;
  active: boolean;
  mode: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  drag: number;
  maxVy: number;
  sway: number;
  phase: number;
  rot: number;
  vr: number;
  life: number;
  max: number;
  delay: number;
  s0: number;
  s1: number;
  texSize: number;
  fadeFrom: number;
  flip: boolean;
  // ARC
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  h: number;
  sparkleAtEnd: boolean;
}

interface FloatText {
  t: Text;
  active: boolean;
  x: number;
  y: number;
  life: number;
  max: number;
  big: boolean;
  /** 나타나기까지 남은 초. */
  delay: number;
  /** 더 올린 높이 (글자 px: 지도를 넓게 볼수록 글자와 같이 커진다). */
  dy: number;
}

/** gain·loss = 마을 코인, win = 받은 코인·대박, debt = 빚 (넷째 묶음), whistle = 반장 호루라기 (작게). */
export type FloatKind = 'gain' | 'loss' | 'win' | 'debt' | 'whistle';
const FLOAT_COLORS: Record<FloatKind, number> = { gain: 0x5f7f2a, loss: 0xa0522d, win: 0xd99a1e, debt: 0x6e5a86, whistle: 0x3f6f7a };
/** 글자 크기 (big이면 1.5배). */
const FLOAT_SIZE: Record<FloatKind, number> = { gain: 34, loss: 34, win: 34, debt: 30, whistle: 26 };
/** 흙덩이·돌 조각 색 (tint). */
const CLOD_COLORS = [0x9a6a45, 0xb07e52, 0x8a5c3b] as const;
const CHIP_COLORS = [0xb3aea8, 0x9a948d, 0xc9c3bb, 0x8a847d] as const;

const MAX_PARTICLES = 700;
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export class FxLayer {
  readonly node = new Container();
  readonly tex: FxTextures;
  private readonly partLayer = new Container();
  private readonly textLayer = new Container();
  private readonly parts: Particle[] = [];
  private readonly texts: FloatText[] = [];
  private free: number[] = [];
  private zoom = 1;

  constructor(renderer: Renderer) {
    this.tex = new FxTextures(renderer);
    this.node.addChild(this.partLayer, this.textLayer);
    this.node.eventMode = 'none';
  }

  // ── 내보내는 연출 ──

  /** 항아리(fx,fy)에서 손님(tx,ty)에게 코인이 포물선으로 튄다. */
  coinArc(fx: number, fy: number, tx: number, ty: number, count: number): void {
    this.itemArc(this.tex.get('items', 'coin', 'coin'), fx, fy, tx, ty, count, 25, true);
  }

  /**
   * 그림 tex가 (fx,fy)에서 (tx,ty)로 포물선으로 날아간다 (코인·재료). size = 긴 변 (세계 px), spin = 동전처럼 빙글 (좌우로 납작해짐).
   * 여럿이면 조금씩 늦게, 셋에 하나는 닿을 때 작은 반짝이.
   */
  itemArc(tex: Texture, fx: number, fy: number, tx: number, ty: number, count: number, size: number, spin: boolean, delay = 0): void {
    for (let i = 0; i < count; i++) {
      const p = this.spawn(tex);
      if (p === null) return;
      p.mode = ARC;
      // 코인·여럿은 흩뿌린다, 재료 하나는 그 점에서 그 점으로.
      const j = count > 1 || spin ? 1 : 0;
      p.sx = fx + rand(-14, 14) * j;
      p.sy = fy - rand(20, 40) * j;
      p.tx = tx + rand(-16, 16) * j;
      p.ty = ty + rand(-10, 10) * j;
      p.h = rand(70, 130) + Math.abs(tx - fx) * 0.25;
      p.max = rand(0.55, 0.75);
      p.delay = delay + i * 0.045;
      p.s0 = p.s1 = size * (j === 1 ? rand(0.88, 1.12) : 1);
      p.flip = spin;
      p.phase = Math.random() * 6;
      p.sparkleAtEnd = i % 3 === 0;
      p.fadeFrom = 0.92;
    }
  }

  /** 제자리에서 코인이 위로 솟았다 떨어진다 (항아리 축제). */
  coinSpray(x: number, y: number, count: number): void {
    const tex = this.tex.get('items', 'coin', 'coin');
    for (let i = 0; i < count; i++) {
      const p = this.spawn(tex);
      if (p === null) return;
      p.x = x + rand(-20, 20);
      p.y = y - rand(10, 40);
      const a = rand(-Math.PI * 0.85, -Math.PI * 0.15);
      const v = rand(380, 720);
      p.vx = Math.cos(a) * v * 0.6;
      p.vy = Math.sin(a) * v;
      p.g = 1300;
      p.drag = 0.4;
      p.max = rand(0.9, 1.3);
      p.delay = rand(0, 0.25);
      p.s0 = p.s1 = rand(22, 30);
      p.flip = true;
      p.phase = Math.random() * 6;
      p.fadeFrom = 0.7;
    }
  }

  confetti(x: number, y: number, count: number): void {
    const tex = this.tex.confetti();
    for (let i = 0; i < count; i++) {
      const p = this.spawn(tex);
      if (p === null) return;
      p.x = x + rand(-30, 30);
      p.y = y - rand(40, 90);
      const a = rand(-Math.PI * 0.92, -Math.PI * 0.08);
      const v = rand(420, 820);
      p.vx = Math.cos(a) * v * 0.75;
      p.vy = Math.sin(a) * v;
      p.g = 950;
      p.drag = 1.8;
      p.maxVy = rand(110, 170);
      p.sway = rand(30, 70);
      p.phase = Math.random() * 6;
      p.vr = rand(-9, 9);
      p.rot = Math.random() * 6;
      p.max = rand(1.5, 2.3);
      p.delay = rand(0, 0.12);
      p.s0 = p.s1 = rand(12, 20);
      p.sp.tint = CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0] ?? 0xffffff;
      p.fadeFrom = 0.75;
    }
  }

  sparkles(x: number, y: number, count: number, radius: number): void {
    const tex = this.tex.get('fx', 'emote_sparkle', 'sparkle');
    for (let i = 0; i < count; i++) {
      const p = this.spawn(tex);
      if (p === null) return;
      p.mode = POP;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      p.x = x + Math.cos(a) * r;
      p.y = y + Math.sin(a) * r * 0.7;
      p.vy = -rand(10, 40);
      p.vr = rand(-2, 2);
      p.max = rand(0.5, 0.85);
      p.delay = rand(0, 0.35);
      p.s0 = p.s1 = rand(16, 30);
    }
  }

  /** 눈물 방울이 머리 양옆으로 튄다. dir = 바라보는 쪽 (-1 왼쪽, 1 오른쪽). */
  tears(x: number, y: number, dir: number, count: number): void {
    const tex = this.tex.get('fx', 'fx_tear', 'tear');
    for (let i = 0; i < count; i++) {
      const p = this.spawn(tex);
      if (p === null) return;
      const side = i % 2 === 0 ? dir : -dir;
      p.x = x + side * 14;
      p.y = y;
      p.vx = side * rand(70, 150);
      p.vy = -rand(120, 220);
      p.g = 800;
      p.drag = 0.5;
      p.max = rand(0.55, 0.8);
      p.delay = i * 0.09;
      p.s0 = rand(10, 13);
      p.s1 = p.s0 * 0.8;
      p.fadeFrom = 0.6;
    }
  }

  /** 먼지 뭉치 (짓기·업그레이드·도착). spread = 퍼지는 반지름, tint = 흙먼지 색 (일터). */
  puff(x: number, y: number, count: number, spread: number, tint = 0xffffff): void {
    const tex = this.tex.get('fx', 'fx_puff', 'puff');
    for (let i = 0; i < count; i++) {
      const p = this.spawn(tex);
      if (p === null) return;
      p.sp.tint = tint;
      const a = (i / count) * Math.PI * 2 + rand(-0.3, 0.3);
      p.x = x + Math.cos(a) * spread * 0.4;
      p.y = y + Math.sin(a) * spread * 0.15;
      p.vx = Math.cos(a) * rand(60, 120) * (spread / 60);
      p.vy = Math.sin(a) * rand(15, 35) - rand(15, 40);
      p.drag = 3.2;
      p.max = rand(0.55, 0.8);
      p.delay = rand(0, 0.06);
      p.s0 = spread * 0.35;
      p.s1 = spread * 0.75;
      p.vr = rand(-1, 1);
      p.fadeFrom = 0.35;
    }
  }

  /** 흙덩이가 앞쪽(dir: -1 왼쪽, 1 오른쪽)으로 톡톡 튄다 (밭 괭이질). */
  clods(x: number, y: number, count: number, dir: number): void {
    this.bits(this.tex.get('fx', 'fx_clod', 'clod'), CLOD_COLORS, x, y, count, dir, 9, 13);
  }

  /** 작은 돌 조각이 튄다 (광산 곡괭이질). */
  chips(x: number, y: number, count: number, dir: number): void {
    this.bits(this.tex.get('fx', 'fx_chip', 'chip'), CHIP_COLORS, x, y, count, dir, 8, 12);
  }

  private bits(tex: Texture, colors: readonly number[], x: number, y: number, count: number, dir: number, s0: number, s1: number): void {
    for (let i = 0; i < count; i++) {
      const p = this.spawn(tex);
      if (p === null) return;
      p.x = x + rand(-8, 8);
      p.y = y - rand(0, 6);
      // 대부분 앞쪽 위로, 가끔 뒤로.
      const side = Math.random() < 0.75 ? dir : -dir;
      p.vx = side * rand(40, 150);
      p.vy = -rand(170, 300);
      p.g = 1100;
      p.drag = 0.6;
      p.vr = rand(-10, 10);
      p.rot = Math.random() * 6;
      p.max = rand(0.4, 0.6);
      p.delay = i * 0.02;
      p.s0 = p.s1 = rand(s0, s1);
      p.sp.tint = colors[(Math.random() * colors.length) | 0] ?? 0xffffff;
      p.fadeFrom = 0.7;
    }
  }

  /** 땀방울 하나가 머리에서 옆으로 톡 (일하는 손님). dir = 튀는 쪽. */
  sweat(x: number, y: number, dir: number): void {
    const p = this.spawn(this.tex.emote('sweat'));
    if (p === null) return;
    p.x = x;
    p.y = y;
    p.vx = dir * rand(50, 90);
    p.vy = -rand(90, 140);
    p.g = 520;
    p.drag = 0.8;
    p.rot = dir * 0.5;
    p.max = rand(0.6, 0.8);
    p.s0 = 15;
    p.s1 = 11;
    p.fadeFrom = 0.55;
  }

  /** 한숨: 작은 회색 김이 천천히 떠올라 사라진다 (기다리는 채무자). dir = 바라보는 쪽. */
  sigh(x: number, y: number, dir: number): void {
    const p = this.spawn(this.tex.get('fx', 'fx_puff', 'puff'));
    if (p === null) return;
    p.x = x;
    p.y = y;
    p.vx = dir * rand(18, 30);
    p.vy = -rand(26, 40);
    p.drag = 0.6;
    p.max = rand(1.1, 1.4);
    p.s0 = 12;
    p.s1 = 26;
    p.vr = rand(-0.6, 0.6);
    p.sp.tint = 0xc9c6cf;
    p.fadeFrom = 0.2;
  }

  /** 호루라기 소리: 짧은 선 셋이 입 앞(dir 쪽)에서 부채꼴로 퍼진다. big = 크게. */
  toot(x: number, y: number, dir: number, big = false): void {
    const tex = this.tex.get('fx', 'fx_line', 'line');
    for (let i = 0; i < 3; i++) {
      const p = this.spawn(tex);
      if (p === null) return;
      // 앞쪽 수평 둘레 -35°·0°·35°.
      const a = (i - 1) * 0.6;
      const ca = Math.cos(a) * dir;
      const sa = Math.sin(a);
      p.x = x + ca * 10;
      p.y = y + sa * 10;
      const v = big ? 200 : 140;
      p.vx = ca * v;
      p.vy = sa * v;
      p.drag = 5;
      p.rot = Math.atan2(sa, ca);
      p.max = big ? 0.55 : 0.4;
      p.delay = big ? i * 0.03 : 0;
      p.s0 = big ? 22 : 16;
      p.s1 = big ? 30 : 20;
      p.fadeFrom = 0.5;
    }
  }

  /** 작은 하트가 둥실 떠오른다 (응원). */
  hearts(x: number, y: number, count: number): void {
    const tex = this.tex.get('fx', 'emote_heart', 'heart');
    for (let i = 0; i < count; i++) {
      const p = this.spawn(tex);
      if (p === null) return;
      p.x = x + rand(-26, 26);
      p.y = y + rand(-8, 8);
      p.vy = -rand(55, 90);
      p.sway = rand(20, 40);
      p.phase = Math.random() * 6;
      p.max = rand(0.9, 1.25);
      p.delay = i * 0.12;
      p.s0 = rand(14, 18);
      p.s1 = p.s0 * 1.2;
      p.fadeFrom = 0.55;
    }
  }

  /**
   * 떠오르는 글자 ('+12'). 둥근 굵은 글꼴, 흰 테두리.
   * delay = 나타나기까지 초, dy = 더 올릴 높이 (글자 px, 한꺼번에 받는 단체 놀이 승자들의 글자가 겹치지 않게).
   */
  floatText(x: number, y: number, text: string, kind: FloatKind, big = false, delay = 0, dy = 0): void {
    let f: FloatText | undefined;
    for (const it of this.texts) {
      if (!it.active) {
        f = it;
        break;
      }
    }
    if (f === undefined) {
      if (this.texts.length >= 40) return;
      const t = new Text({
        text: '',
        style: { fontFamily: 'Jua, sans-serif', fontSize: 34, fill: 0xffffff, stroke: { color: 0xffffff, width: 8, join: 'round' }, align: 'center' },
        resolution: 3,
      });
      t.anchor.set(0.5, 1);
      this.textLayer.addChild(t);
      f = { t, active: false, x: 0, y: 0, life: 0, max: 1, big: false, delay: 0, dy: 0 };
      this.texts.push(f);
    }
    f.active = true;
    f.t.visible = true;
    f.t.text = text;
    f.t.style.fill = FLOAT_COLORS[kind];
    f.t.style.fontSize = FLOAT_SIZE[kind] * (big ? 1.5 : 1);
    f.x = x;
    f.y = y;
    f.life = 0;
    f.max = big ? 1.9 : 1.35;
    f.big = big;
    f.delay = delay;
    f.dy = dy;
    f.t.alpha = 0;
    f.t.visible = delay <= 0;
  }

  // ── 매 프레임 ──

  update(dt: number, zoom: number): void {
    this.zoom = zoom;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i] as Particle;
      if (!p.active) continue;
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.sp.visible = true;
      p.life += dt;
      const u = p.life / p.max;
      if (u >= 1) {
        if (p.mode === ARC && p.sparkleAtEnd) this.sparkles(p.tx, p.ty - 10, 1, 8);
        this.release(p, i);
        continue;
      }
      let size = p.s0 + (p.s1 - p.s0) * u;
      if (p.mode === ARC) {
        const e = u * (2 - u) * 0.35 + u * 0.65; // 처음에 조금 빠르게
        p.x = p.sx + (p.tx - p.sx) * e;
        p.y = p.sy + (p.ty - p.sy) * e - Math.sin(Math.PI * u) * p.h;
      } else if (p.mode === POP) {
        p.y += p.vy * dt;
        size *= Math.sin(Math.PI * Math.min(1, u * 1.15));
      } else {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vy = p.vy * k + p.g * dt;
        if (p.maxVy > 0 && p.vy > p.maxVy) p.vy = p.maxVy;
        p.x += p.vx * dt + (p.sway > 0 ? Math.cos(p.life * 7 + p.phase) * p.sway * dt : 0);
        p.y += p.vy * dt;
      }
      p.rot += p.vr * dt;
      const sp = p.sp;
      sp.position.set(p.x, p.y);
      sp.rotation = p.rot;
      const s = Math.max(0.001, size / p.texSize);
      sp.scale.set(p.flip ? s * Math.cos(p.life * 13 + p.phase) : s, s);
      sp.alpha = u < p.fadeFrom ? 1 : 1 - (u - p.fadeFrom) / (1 - p.fadeFrom);
    }

    const ts = Math.min(2.4, Math.max(1, 0.8 / this.zoom));
    for (let i = 0; i < this.texts.length; i++) {
      const f = this.texts[i] as FloatText;
      if (!f.active) continue;
      if (f.delay > 0) {
        f.delay -= dt;
        continue;
      }
      f.t.visible = true;
      f.life += dt;
      const u = f.life / f.max;
      if (u >= 1) {
        f.active = false;
        f.t.visible = false;
        continue;
      }
      const pop = u < 0.14 ? backOut(u / 0.14) : 1;
      const rise = 1 - (1 - Math.min(1, u * 1.3)) ** 2;
      f.t.position.set(f.x, f.y - (f.dy + rise * (f.big ? 80 : 56)) * ts);
      f.t.scale.set(pop * ts);
      f.t.alpha = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
    }
  }

  destroy(): void {
    this.node.destroy({ children: true });
    this.tex.destroy();
    this.parts.length = 0;
    this.texts.length = 0;
  }

  // ── 풀 ──

  private spawn(tex: Texture): Particle | null {
    let p: Particle | undefined;
    const idx = this.free.pop();
    if (idx !== undefined) p = this.parts[idx];
    if (p === undefined) {
      if (this.parts.length >= MAX_PARTICLES) return null;
      const sp = new Sprite(Texture.WHITE);
      sp.anchor.set(0.5);
      this.partLayer.addChild(sp);
      p = {
        sp, active: false, mode: PHYS, x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, maxVy: 0, sway: 0, phase: 0, rot: 0, vr: 0,
        life: 0, max: 1, delay: 0, s0: 1, s1: 1, texSize: 1, fadeFrom: 0.7, flip: false, sx: 0, sy: 0, tx: 0, ty: 0, h: 0, sparkleAtEnd: false,
      };
      this.parts.push(p);
    }
    p.active = true;
    p.mode = PHYS;
    p.x = p.y = p.vx = p.vy = p.g = p.drag = p.maxVy = p.sway = p.phase = p.rot = p.vr = 0;
    p.life = 0;
    p.max = 1;
    p.delay = 0;
    p.fadeFrom = 0.7;
    p.flip = false;
    p.sparkleAtEnd = false;
    p.sp.texture = tex;
    p.sp.tint = 0xffffff;
    p.sp.visible = false;
    p.sp.alpha = 1;
    p.texSize = Math.max(1, tex.width, tex.height);
    return p;
  }

  private release(p: Particle, index: number): void {
    p.active = false;
    p.sp.visible = false;
    this.free.push(index);
  }
}

function backOut(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
