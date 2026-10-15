// 오리배(boat.ts)·연날리기(kite.ts) 확대 화면이 같이 쓰는 작은 도구.
// - fitHost: 진행자를 바깥 장면 크기로 줄여 세운다 (GroupScene은 진행자를 L.kHost 크기로 만든다: 둑·언덕 위에 멀리 서 있게 매 프레임 줄인다).
// - HostTalk: 진행자 머리 위 말풍선 하나 (새 말이 앞 말을 지운다, 위 가운데 판을 피하고 패널 밖으로 나가지 않는다).
// - pickBadge: 손님이 건 것 표 (색 동그라미 + 작은 그림, 톡 커지며 나타난다).

import { Container, Graphics } from 'pixi.js';
import { ease } from '../../core/tween.ts';
import { artMeta, artSprite, hasArt } from '../art.ts';
import type { HostActor } from './actor.ts';
import { type Anim, bubbleNode, INK, lerp } from './fx.ts';
import type { GroupHostSpot } from './group.ts';

/** 패널 위쪽에서 말풍선이 피할 사각형 (순위판 등). */
export interface Box {
  readonly x0: number;
  readonly x1: number;
  readonly bottom: number;
}

/** 진행자를 s배(L.kHost 대비)로 줄여 자리 at에 (패널 폭 w 안에 다 보이게). drawPlay에서 매 프레임. */
export function fitHost(h: HostActor, at: GroupHostSpot, s: number, w: number): void {
  h.root.scale.set(at.face * s, s);
  const half = h.halfW * s;
  h.root.position.set(Math.max(4 + half, Math.min(w - 4 - half, at.x)), at.y);
}

/** 진행자 머리 꼭대기 y (패널 px). */
export function hostHeadTop(h: HostActor): number {
  const s = Math.abs(h.root.scale.y) || 1;
  const m = artMeta('characters', h.art);
  const H = m !== undefined && hasArt('characters', h.art) ? m.trim.h * h.k : h.height * 0.9;
  return h.root.y - H * s * 0.97;
}

/** 진행자 말풍선 (장면마다 하나). */
export class HostTalk {
  private bubble: { node: Container; until: number } | null = null;
  private readonly layer: Container;
  private readonly anim: Anim;
  private readonly w: number;
  private readonly fs: number;

  constructor(layer: Container, anim: Anim, w: number, fontSize: number) {
    this.layer = layer;
    this.anim = anim;
    this.w = w;
    this.fs = fontSize;
  }

  /** 지금 말풍선이 떠 있나 (now 기준, 끝나기 margin초 전까지). */
  busy(now: number, margin = 0.3): boolean {
    return this.bubble !== null && now < this.bubble.until - margin;
  }

  /**
   * h 머리 위에 text를 sec초. 말풍선은 진행자가 보는 쪽으로 조금 비켜 꼬리 끝이 머리 꼭대기에 오게.
   * avoid(위 가운데 판)와 겹치면 판 아래로 내리고 머리 옆으로 비킨다.
   */
  say(h: HostActor | null, text: string, sec: number, now: number, avoid: Box | null): void {
    if (h === null) return;
    this.bubble?.node.destroy({ children: true });
    this.bubble = null;
    const b = bubbleNode(text, this.fs);
    const side = h.root.scale.x < 0 ? -1 : 1;
    const half = b.width / 2 + 4;
    const bh = b.height;
    const clampX = (v: number): number => Math.max(half, Math.min(this.w - half, v));
    const beside = (): number => clampX(h.root.x + side * (h.halfW * Math.abs(h.root.scale.y) + half * 0.9));
    let x = clampX(h.root.x + side * half * 0.55);
    let y = hostHeadTop(h);
    // 머리가 패널 위 끝에 붙어 있으면 얼굴을 가리지 않게 머리 옆으로.
    if (y - bh < 4) {
      y = bh + 4;
      x = beside();
    }
    if (avoid !== null && x + half > avoid.x0 && x - half < avoid.x1 && y - bh < avoid.bottom + 4) {
      y = avoid.bottom + 4 + bh;
      x = beside();
    }
    b.position.set(x, y);
    b.scale.set(0.3);
    this.layer.addChild(b);
    this.bubble = { node: b, until: now + sec };
    void this.anim.run(0.22, (u) => {
      if (!b.destroyed) b.scale.set(lerp(0.3, 1, u));
    }, { ease: ease.outBack });
  }

  update(now: number): void {
    if (this.bubble !== null && now >= this.bubble.until) {
      this.bubble.node.destroy({ children: true });
      this.bubble = null;
    }
  }
}

/**
 * 건 것 표: 반지름 r 동그라미(color) 안에 그림(group/key, 캔버스 폭 artW 기준으로 동그라미에 맞춤). 톡 커지며 나타난다.
 * shape = 'diamond'면 동그라미 대신 마름모 (연).
 */
export function pickBadge(anim: Anim, r: number, color: number, group: string, key: string, artW: number, shape: 'circle' | 'diamond' = 'circle'): Container {
  const b = new Container();
  const g = new Graphics();
  const line = Math.max(2, r * 0.16);
  if (shape === 'diamond') g.poly([0, -r * 1.2, r, 0, 0, r * 1.2, -r, 0]).fill({ color }).stroke({ color: INK, width: line, join: 'round' });
  else g.circle(0, 0, r).fill({ color }).stroke({ color: INK, width: line });
  b.addChild(g);
  if (shape === 'circle') b.addChild(artSprite(group, key, { k: (r * 1.55) / artW, anchor: 'center', placeholder: { w: artW, h: artW * 0.7, color: 0xffffff } }));
  b.scale.set(0.3);
  void anim.run(0.3, (u) => {
    if (!b.destroyed) b.scale.set(lerp(0.3, 1, u));
  }, { ease: ease.outBack });
  return b;
}
