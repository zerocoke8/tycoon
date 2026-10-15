// 확대 화면의 작은 연출 도구: 트윈 묶음(씬을 닫으면 한꺼번에 멈춤), 이모트, 말풍선, 코인, 색종이, 결과 글자.
// 그림이 없으면 코드로 그린 대신 모양을 쓴다 (게임은 그림 없이도 돈다).

import { Container, Graphics, Text } from 'pixi.js';
import { type Ease, ease, tweens } from '../../core/tween.ts';
import type { EmoteKind } from '../../sim/types.ts';
import { artSprite, hasArt } from '../art.ts';

export const INK = 0x402c1c;
export const FONT = 'Jua, "Gowun Dodum", sans-serif';

export interface Pt {
  x: number;
  y: number;
}

/**
 * 씬 하나의 트윈 묶음. 공용 `tweens`를 쓰되, kill()하면 이 묶음의 트윈이 모두 멈추고
 * 그 뒤로는 step·then이 불리지 않는다 (지운 그림을 건드리지 않게).
 */
export class Anim {
  alive = true;
  private readonly owners: object[] = [];
  private readonly main = {};

  constructor() {
    this.owners.push(this.main);
  }

  /** cancel로 따로 멈출 수 있는 주인 하나 (예: 손님의 반응 연출). */
  owner(): object {
    const o = {};
    this.owners.push(o);
    return o;
  }

  run(duration: number, step: (t: number) => void, opts: { ease?: Ease; delay?: number; owner?: object } = {}): Promise<void> {
    return new Promise((resolve) => {
      void tweens
        .run(
          duration,
          (t) => {
            if (this.alive) step(t);
          },
          { ease: opts.ease ?? ease.outQuad, delay: opts.delay ?? 0, owner: opts.owner ?? this.main },
        )
        .then(() => {
          if (this.alive) resolve();
        });
    });
  }

  /** sec초 뒤에 fn (씬이 살아 있을 때만). */
  after(sec: number, fn: () => void, owner?: object): void {
    void this.run(0.0001, () => undefined, { delay: sec, ...(owner === undefined ? {} : { owner }) }).then(fn);
  }

  cancel(owner: object): void {
    tweens.cancel(owner);
  }

  kill(): void {
    this.alive = false;
    for (const o of this.owners) tweens.cancel(o);
  }
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** t를 [a, b] 구간 안의 0~1로. */
export function span(t: number, a: number, b: number): number {
  return clamp01((t - a) / Math.max(1e-6, b - a));
}

// ── 이모트 ──────────────────────────────────────────────────────────────

const EMOTE_FALLBACK: Record<EmoteKind, { glyph: string; color: number }> = {
  heart: { glyph: '♥', color: 0xff6f91 },
  sweat: { glyph: '; ;', color: 0x6bb7f0 },
  tear: { glyph: '…', color: 0x6bb7f0 },
  sparkle: { glyph: '★', color: 0xffc83d },
  storm: { glyph: '☁', color: 0x8090a8 },
  note: { glyph: '♪', color: 0x7cc46b },
  anger: { glyph: '!!', color: 0xf0644b },
  shock: { glyph: '!', color: 0xf08a3c },
};

/** 이모트 하나 (가운데 기준, 지름 약 size px). */
export function emoteNode(kind: EmoteKind, size: number): Container {
  if (hasArt('fx', `emote_${kind}`)) return artSprite('fx', `emote_${kind}`, { k: size / 800, anchor: 'center' });
  const f = EMOTE_FALLBACK[kind];
  const c = new Container();
  const r = size * 0.42;
  c.addChild(new Graphics().circle(0, 0, r).fill({ color: 0xffffff }).stroke({ color: INK, width: Math.max(2, size * 0.05) }));
  const t = new Text({ text: f.glyph, style: { fontFamily: FONT, fontSize: r * 1.1, fill: f.color, fontWeight: 'bold' } });
  t.anchor.set(0.5);
  c.addChild(t);
  return c;
}

// ── 말풍선 ──────────────────────────────────────────────────────────────

/** 말풍선 (아래 가운데 꼬리 끝이 (0,0)). */
export function bubbleNode(text: string, fontSize: number): Container {
  const c = new Container();
  const label = new Text({ text, style: { fontFamily: FONT, fontSize, fill: INK } });
  label.anchor.set(0.5);
  const padX = fontSize * 0.55;
  const padY = fontSize * 0.32;
  const bw = label.width + padX * 2;
  const bh = label.height + padY * 2;
  const tail = fontSize * 0.45;
  const top = -tail - bh;
  const line = Math.max(2, fontSize * 0.09);
  const g = new Graphics()
    .roundRect(-bw / 2, top, bw, bh, bh * 0.45)
    .fill({ color: 0xffffff })
    .stroke({ color: INK, width: line })
    .poly([-tail * 0.55, -tail - line * 0.5, tail * 0.25, -tail - line * 0.5, tail * 0.35, 0])
    .fill({ color: 0xffffff })
    .stroke({ color: INK, width: line, join: 'round' })
    // 꼬리와 풍선 사이의 선을 지운다.
    .rect(-tail * 0.55 + line * 0.6, -tail - line * 1.4, tail * 0.8 - line * 0.6, line * 1.8)
    .fill({ color: 0xffffff });
  label.position.set(0, top + bh / 2);
  c.addChild(g, label);
  return c;
}

// ── 코인·색종이·숫자 ────────────────────────────────────────────────────

export function coinNode(size: number): Container {
  if (hasArt('items', 'coin')) return artSprite('items', 'coin', { k: size / 552, anchor: 'center' });
  const c = new Container();
  const r = size / 2;
  c.addChild(
    new Graphics()
      .circle(0, 0, r)
      .fill({ color: 0xffcf4a })
      .stroke({ color: INK, width: Math.max(1.5, size * 0.08) })
      .circle(0, 0, r * 0.55)
      .stroke({ color: 0xe0a526, width: Math.max(1, size * 0.07) }),
  );
  return c;
}

/** 코인 n개를 from에서 to로 튕겨 보낸다. 첫 코인이 닿으면 onArrive. */
export function flyCoins(layer: Container, anim: Anim, from: Pt, to: Pt, n: number, size: number, onArrive?: () => void): void {
  let first = true;
  for (let i = 0; i < n; i++) {
    const coin = coinNode(size);
    coin.position.set(from.x, from.y);
    coin.scale.set(0.2);
    layer.addChild(coin);
    const sx = from.x + (Math.random() - 0.5) * size * 1.5;
    const ex = to.x + (Math.random() - 0.5) * size * 1.2;
    const ey = to.y + (Math.random() - 0.5) * size * 0.8;
    const lift = size * (3 + Math.random() * 2.5);
    const dur = 0.5 + Math.random() * 0.15;
    void anim
      .run(
        dur,
        (t) => {
          const x = lerp(sx, ex, t);
          const y = lerp(from.y, ey, t) - Math.sin(Math.PI * t) * lift;
          coin.position.set(x, y);
          coin.scale.set(t < 0.2 ? lerp(0.2, 1, t / 0.2) : 1);
          coin.rotation = t * 6;
        },
        { ease: ease.linear, delay: i * 0.06 },
      )
      .then(() => {
        if (first) {
          first = false;
          onArrive?.();
        }
        void anim.run(0.18, (t) => {
          coin.scale.set(1 + t * 0.4);
          coin.alpha = 1 - t;
        }).then(() => coin.destroy({ children: true }));
      });
  }
}

const CONFETTI_COLORS = [0xff6b6b, 0xffd166, 0x6bcb77, 0x4d96ff, 0xc77dff, 0xff9f43, 0xff8fab];

/** 색종이 n장이 패널 위(폭 w)에서 흔들리며 내려온다 (높이 h까지). */
export function confetti(layer: Container, anim: Anim, w: number, h: number, n: number): void {
  const unit = Math.min(w, h);
  for (let i = 0; i < n; i++) {
    const s = unit * (0.022 + Math.random() * 0.018);
    const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length] ?? 0xffd166;
    const g = new Graphics().rect(-s / 2, -s * 0.3, s, s * 0.6).fill({ color });
    const x0 = Math.random() * w;
    const y0 = -s - Math.random() * h * 0.35;
    g.position.set(x0, y0);
    layer.addChild(g);
    const drift = (Math.random() - 0.5) * unit * 0.25;
    const sway = unit * (0.02 + Math.random() * 0.03);
    const spin = (Math.random() - 0.5) * 10;
    const flip = 5 + Math.random() * 8;
    const dur = 1.7 + Math.random() * 0.9;
    const fall = h - y0 + s * 2;
    void anim
      .run(
        dur,
        (t) => {
          g.position.set(x0 + drift * t + Math.sin(t * 9 + i) * sway, y0 + fall * t);
          g.rotation = spin * t;
          g.scale.y = Math.cos(t * flip);
          g.alpha = t > 0.85 ? (1 - t) / 0.15 : 1;
        },
        { ease: ease.linear, delay: Math.random() * 0.25 },
      )
      .then(() => g.destroy());
  }
}

/** 떠오르는 숫자·글자 (+12). */
export function floatText(layer: Container, anim: Anim, text: string, x: number, y: number, size: number, color = 0xffd54a): void {
  const t = new Text({ text, style: { fontFamily: FONT, fontSize: size, fill: color, stroke: { color: INK, width: Math.max(3, size * 0.16), join: 'round' } } });
  t.anchor.set(0.5);
  t.position.set(x, y);
  t.scale.set(0.4);
  layer.addChild(t);
  void anim
    .run(1.3, (u) => {
      t.scale.set(u < 0.15 ? lerp(0.4, 1.15, u / 0.15) : u < 0.25 ? lerp(1.15, 1, (u - 0.15) / 0.1) : 1);
      t.y = y - size * 1.2 * u;
      t.alpha = u > 0.75 ? (1 - u) / 0.25 : 1;
    }, { ease: ease.linear })
    .then(() => t.destroy());
}

/** 크게 튀어나왔다 사라지는 결과 글자 ('대박!'). 일찍 치우려면 돌려준 글자를 dismiss로. */
export function popCaption(layer: Container, anim: Anim, text: string, x: number, y: number, size: number, color: number, hold = 1.3): Text {
  const t = new Text({
    text,
    style: {
      fontFamily: FONT,
      fontSize: size,
      fill: color,
      stroke: { color: INK, width: Math.max(4, size * 0.16), join: 'round' },
      dropShadow: { color: INK, alpha: 0.35, distance: size * 0.08, angle: Math.PI / 2, blur: 0 },
      padding: size * 0.2,
    },
  });
  t.anchor.set(0.5);
  t.position.set(x, y);
  t.scale.set(0.2);
  layer.addChild(t);
  void anim
    .run(0.4, (u) => t.scale.set(lerp(0.2, 1, u)), { ease: ease.outBack })
    .then(() => anim.run(0.35, (u) => {
      t.y = y - size * 0.35 * u;
      t.alpha = Math.min(t.alpha, 1 - u);
    }, { delay: hold, ease: ease.inQuad }))
    .then(() => {
      if (!t.destroyed) t.destroy();
    });
  return t;
}

/** 글자를 빨리 흐려 치운다 (다음 한판이 시작될 때). */
export function dismiss(anim: Anim, t: Text): void {
  if (t.destroyed) return;
  void anim.run(0.18, (u) => {
    if (!t.destroyed) t.alpha = Math.min(t.alpha, 1 - u);
  }, { ease: ease.linear });
}
