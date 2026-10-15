// 씨름장·줄다리기·보물찾기 확대 화면이 같이 쓰는 작은 도구 (ssireum.ts·tug.ts·dig.ts).
// - Timeline: 판(play.events)을 화면 시계로 훑어 이번 프레임에 시각이 된 사건만 (판 중간에 열면 지난 사건은 건너뛴다), 한 번만 하는 연출 열쇠.
// - Talk: 진행자 머리 위 말풍선 하나 (해설·심판 신호). 진행자가 없으면 다른 진행자가 대신.
// - 먼지(fx/fx_puff)·흙덩이·반짝이·코인 연출, 진행자 크기 맞추기, 웹 글꼴 글자 미리 받기.

import { Container, Graphics, Text } from 'pixi.js';
import type { OutcomeTier } from '../../data/defs.ts';
import { ease } from '../../core/tween.ts';
import type { GroupEvent, GroupPlay } from '../../sim/types.ts';
import { artMeta, artSprite, hasArt } from '../art.ts';
import type { HostActor, MonsterActor } from './actor.ts';
import { type Anim, bubbleNode, emoteNode, FONT, floatText, flyCoins, INK, lerp, popCaption } from './fx.ts';
import type { Layout } from './layout.ts';

/**
 * 한글 웹 글꼴은 글자 묶음마다 따로 받는다: 처음 그리는 말풍선 글자가 대신 글꼴로 굳지 않게 미리 받아 둔다
 * (main.ts FONT_SAMPLE에 없는 해설 글자).
 */
export function preloadGlyphs(text: string): void {
  try {
    if (typeof document === 'undefined' || document.fonts === undefined) return;
    void document.fonts.load(`20px Jua`, text).catch(() => undefined);
  } catch {
    // 글꼴을 못 받아도 대신 글꼴로 그린다.
  }
}

/** 판 하나의 사건을 시각대로 하나씩, 한 번만 하는 연출 열쇠. */
export class Timeline {
  private play: GroupPlay | null = null;
  private next = 0;
  private readonly done = new Set<string>();

  /** 판이 바뀌었으면 true. 판 중간(t > 0.3)에 처음 보면 지난 사건은 건너뛴다. */
  sync(play: GroupPlay | null, t: number): boolean {
    if (play === this.play) return false;
    this.play = play;
    this.next = 0;
    this.done.clear();
    if (play !== null && t > 0.3) while (this.next < play.events.length && (play.events[this.next] as GroupEvent).t <= t) this.next++;
    return true;
  }

  /** 시각 t까지 새로 된 사건들. */
  due(t: number): GroupEvent[] {
    const p = this.play;
    if (p === null) return [];
    const out: GroupEvent[] = [];
    while (this.next < p.events.length && (p.events[this.next] as GroupEvent).t <= t) out.push(p.events[this.next++] as GroupEvent);
    return out;
  }

  /** 이 판에서 처음이면 true. */
  once(key: string): boolean {
    if (this.done.has(key)) return false;
    this.done.add(key);
    return true;
  }
}

/**
 * 진행자 그림 크기·방향·자리 (face = 1 오른쪽을 봄, -1 왼쪽). GroupScene은 처음 한 번 배율 1로 자리를 잡으니 장면이 매 프레임 맞춘다.
 * x는 줄인 그림이 패널 끝에 잘리지 않게.
 */
export function placeHost(h: HostActor, L: Layout, x: number, y: number, scale: number, face: 1 | -1): void {
  h.root.scale.set(face * scale, scale);
  const half = h.halfW * scale;
  h.root.position.set(Math.max(4 + half, Math.min(L.w - 4 - half, x)), y);
}

/**
 * 결과 (sim roundFinished) 하나를 손님 그림에: 작은 글자(꽝은 글자 없이, caption = false면 글자 없이), 항아리 → 코인, 반응 기다리기.
 * at = 글자 자리 (없으면 서 있는 손님 머리 위: 누워 있는 손님은 장면이 준다).
 */
export function settle(a: MonsterActor, tier: OutcomeTier, payout: number, now: number, parts: { ui: Container; fx: Container; anim: Anim; L: Layout }, size: number, caption = true, at?: { x: number; y: number }): void {
  const { ui, fx, anim, L } = parts;
  a.holdUntil = Math.max(a.holdUntil, now + 2.4);
  if (now - a.lastReact > 0.6) a.expect = { tier, at: now + 0.35 };
  const s = Math.abs(a.root.scale.y);
  // 받은 코인 숫자는 글자 위로 (글자 아래에 깔려 가려지지 않게).
  let numY: number | undefined;
  if (caption && tier !== 'lose') {
    const c = SETTLE_CAPTION[tier];
    const cy = at?.y ?? a.root.y + a.headY * s - L.bodyH * 0.06;
    const cs = size * (tier === 'jackpot' ? 1.25 : 1);
    popCaption(ui, anim, c.text, at?.x ?? a.root.x, cy, cs, c.color);
    numY = cy - cs * 1.2;
  }
  coinsTo(fx, anim, L, potMouth(L), a, payout, numY);
}

const SETTLE_CAPTION: Record<Exclude<OutcomeTier, 'lose'>, { text: string; color: number }> = {
  jackpot: { text: '대박!', color: 0xffc83d },
  win: { text: '이겼다!', color: 0x9ad66f },
  nearMiss: { text: '아깝다!', color: 0xff9a5c },
};

/** 진행자 머리 꼭대기 y (패널 px). */
export function hostTop(h: HostActor): number {
  const m = artMeta('characters', h.art);
  const tall = m !== undefined && hasArt('characters', h.art) ? m.trim.h * h.k : h.height * 0.9;
  return h.root.y - tall * Math.abs(h.root.scale.y);
}

/** 진행자 머리 위 말풍선 하나. */
export class Talk {
  private readonly layer: Container;
  private readonly anim: Anim;
  private readonly L: Layout;
  private node: Container | null = null;
  private until = 0;

  constructor(layer: Container, anim: Anim, L: Layout) {
    this.layer = layer;
    this.anim = anim;
    this.L = L;
  }

  /** h 머리 위에 text를 sec초. minY = 말풍선 위 끝이 이보다 위로 가지 않게 (위쪽 막대를 피해). */
  say(h: HostActor | null, text: string, sec: number, now: number, minY = 4): void {
    if (h === null || h.root.destroyed) return;
    this.clear();
    const L = this.L;
    const fs = Math.max(13, L.sw * 0.042);
    const b = bubbleNode(text, fs);
    const side = h.root.scale.x < 0 ? -1 : 1;
    const half = b.width / 2 + 4;
    const x = Math.max(half, Math.min(L.w - half, h.root.x + side * half * 0.45));
    const y = Math.max(hostTop(h) + fs * 0.4, minY + b.height);
    b.position.set(x, y);
    b.scale.set(0.3);
    this.layer.addChild(b);
    this.node = b;
    this.until = now + sec;
    void this.anim.run(0.22, (u) => {
      if (!b.destroyed) b.scale.set(lerp(0.3, 1, u));
    }, { ease: ease.outBack });
  }

  /** 말하는 중인가. */
  busy(now: number): boolean {
    return this.node !== null && now < this.until - 0.25;
  }

  update(now: number): void {
    if (this.node !== null && now >= this.until) this.clear();
  }

  clear(): void {
    this.node?.destroy({ children: true });
    this.node = null;
  }
}

/** 먼지 뭉치 n개가 (x, y)에서 퍼지며 사라진다 (size = 뭉치 하나 폭). */
export function puff(layer: Container, anim: Anim, x: number, y: number, size: number, n = 4, spread = 1): void {
  for (let i = 0; i < n; i++) {
    const p = hasArt('fx', 'fx_puff')
      ? artSprite('fx', 'fx_puff', { k: size / 800, anchor: 'center' })
      : new Graphics().circle(0, 0, size * 0.4).fill({ color: 0xf2e6d0 }).stroke({ color: INK, width: 2, alpha: 0.5 });
    const ang = Math.PI + (i / Math.max(1, n - 1)) * Math.PI + (Math.random() - 0.5) * 0.5;
    const dist = size * (0.5 + Math.random() * 0.5) * spread;
    p.position.set(x, y);
    p.scale.set(0.3);
    p.alpha = 0.95;
    layer.addChild(p);
    void anim
      .run(0.5 + Math.random() * 0.2, (t) => {
        p.position.set(x + Math.cos(ang) * dist * t, y + Math.sin(ang) * dist * 0.45 * t - size * 0.15 * t);
        p.scale.set(lerp(0.3, 1, t));
        p.alpha = 0.95 * (1 - t * t);
      }, { ease: ease.outQuad })
      .then(() => p.destroy({ children: true }));
  }
}

/** 흙덩이 n개가 (x, y)에서 dir 쪽(1 오른쪽, -1 왼쪽)으로 포물선을 그리며 떨어진다. */
export function clods(layer: Container, anim: Anim, x: number, y: number, size: number, dir: number, n = 3, color = 0x8a5a34): void {
  for (let i = 0; i < n; i++) {
    const r = size * (0.28 + Math.random() * 0.22);
    const g = new Graphics().ellipse(0, 0, r, r * 0.8).fill({ color }).stroke({ color: INK, width: Math.max(1, r * 0.35) });
    const dx = dir * size * (1 + Math.random() * 1.6);
    const up = size * (1.2 + Math.random() * 1.2);
    const drop = size * (0.2 + Math.random() * 0.5);
    g.position.set(x, y);
    layer.addChild(g);
    void anim
      .run(0.42 + Math.random() * 0.16, (t) => {
        g.position.set(x + dx * t, y - Math.sin(Math.PI * t) * up + drop * t);
        g.alpha = t > 0.8 ? (1 - t) / 0.2 : 1;
      }, { ease: ease.linear, delay: i * 0.03 })
      .then(() => g.destroy());
  }
}

/** 반짝이 n개가 (x, y) 둘레에서 톡톡 (size = 반짝이 하나 폭). */
export function sparkles(layer: Container, anim: Anim, x: number, y: number, size: number, n = 6, radius = size * 2): void {
  for (let i = 0; i < n; i++) {
    const s = emoteNode('sparkle', size);
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
    const d = radius * (0.6 + Math.random() * 0.5);
    s.position.set(x, y);
    s.scale.set(0);
    layer.addChild(s);
    void anim
      .run(0.7, (t) => {
        s.position.set(x + Math.cos(a) * d * t, y + Math.sin(a) * d * t * 0.8);
        s.scale.set(t < 0.35 ? lerp(0, 1.1, t / 0.35) : lerp(1.1, 0.2, (t - 0.35) / 0.65));
        s.rotation = t * 2;
      }, { ease: ease.outQuad, delay: Math.random() * 0.2 })
      .then(() => s.destroy({ children: true }));
  }
}

/** 항아리에서 손님에게 코인 (+숫자). potTop = 항아리 입구. numY = 숫자 자리 (없으면 머리 바로 위). */
export function coinsTo(layer: Container, anim: Anim, L: Layout, potTop: { x: number; y: number }, a: MonsterActor, payout: number, numY?: number): void {
  if (payout <= 0) return;
  const s = Math.abs(a.root.scale.y);
  const to = { x: a.root.x, y: a.root.y - L.bodyH * 0.45 * s };
  const headY = a.root.y + a.headY * s;
  flyCoins(layer, anim, potTop, to, Math.max(3, Math.min(14, Math.round(3 + payout / 4))), L.sw * 0.05, () => {
    floatText(layer, anim, `+${payout}`, to.x, Math.max(L.sw * 0.05, numY ?? headY - L.bodyH * 0.1), Math.max(16, L.sw * 0.06));
  });
}

/** 항아리 입구 (GroupScene이 L.pot에 그리는 objects/prize_pot 기준). */
export function potMouth(L: Layout): { x: number; y: number } {
  return { x: L.pot.x, y: L.pot.y - (617 * L.pot.w) / 668 * 0.85 };
}

/** 손에 든 둥근 표지 (심판 부채: 색 원판 + 자루, 가운데 글자). (0, 0) = 자루 끝. */
export function paddleNode(color: number, label: string, size: number): Container {
  const c = new Container();
  const r = size / 2;
  const line = Math.max(2, size * 0.06);
  c.addChild(
    new Graphics()
      .roundRect(-size * 0.06, -size * 0.9, size * 0.12, size * 0.9, size * 0.05)
      .fill({ color: 0x9a6a3e })
      .stroke({ color: INK, width: line })
      .circle(0, -size * 0.9 - r * 0.8, r)
      .fill({ color })
      .stroke({ color: INK, width: line }),
  );
  if (label !== '') {
    const t = new Text({ text: label, style: { fontFamily: FONT, fontSize: r * 0.95, fill: 0xffffff, stroke: { color: INK, width: Math.max(2, r * 0.18), join: 'round' } } });
    t.anchor.set(0.5);
    t.position.set(0, -size * 0.9 - r * 0.8);
    c.addChild(t);
  }
  return c;
}

/** 세모 깃발 (줄다리기 심판). (0, 0) = 자루 끝, 깃발은 dir 쪽(1 오른쪽, -1 왼쪽)으로. */
export function flagNode(color: number, size: number, dir: number): Container {
  const c = new Container();
  const line = Math.max(2, size * 0.06);
  c.addChild(
    new Graphics()
      .roundRect(-size * 0.04, -size * 1.3, size * 0.08, size * 1.3, size * 0.04)
      .fill({ color: 0x6b4a2e })
      .stroke({ color: INK, width: line })
      .poly([0, -size * 1.28, dir * size * 0.85, -size * 1.08, 0, -size * 0.86])
      .fill({ color })
      .stroke({ color: INK, width: line, join: 'round' })
      .circle(0, -size * 1.32, size * 0.07)
      .fill({ color: 0x6b4a2e })
      .stroke({ color: INK, width: line * 0.8 }),
  );
  return c;
}

/** 바닥 위 자리 표시 (빈 자리: 점선 고리와 물음표). */
export function emptySpot(g: Graphics, x: number, y: number, rx: number, color: number): void {
  const n = 14;
  for (let i = 0; i < n; i += 1) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / n / 2;
    g.moveTo(x + Math.cos(a0) * rx, y + Math.sin(a0) * rx * 0.36).lineTo(x + Math.cos(a1) * rx, y + Math.sin(a1) * rx * 0.36);
  }
  g.stroke({ color, width: Math.max(2, rx * 0.07), alpha: 0.9, cap: 'round' });
}
