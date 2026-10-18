// 놀이기구·쉼 가게 화면 (rides.ts·rest.ts, 다섯째 묶음 DESIGN 3.8)이 같이 쓰는 작은 도구.
//  - 그림 자리 (artFrame: 그림 px → 세계 좌표), 그림의 네모 조각 (sliceSprite: 같은 텍스처를 나눠 쓴다, 기둥·지붕을 목마 앞에 따로 그릴 때),
//    그림 색으로 고른 덮개 (keyedTexture: 여관 창유리만 골라 어둡게 칠한 그림).
//  - 손님 몸 빌리기 (Borrow: 그림자 숨기기·이모트 올리기·가리개를 이번 프레임만, 안 빌린 손님은 다음 프레임에 돌려놓는다).
// 떠오르는 작은 그림 (Bits)·날아가는 물건 (Flights)은 shopsFx.ts (먹거리 가게·트럭과 같이 쓴다).
// 화면 연출용 무작위라 Math.random을 쓴다.

import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { Pt } from '../data/map.ts';
import type { MonsterId } from '../sim/types.ts';
import { artMeta, artTexture } from './art.ts';
import type { MonstersView, MonsterView } from './monsterView.ts';

export const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export function backOut(t: number): number {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

// ── 그림 자리 ──

/** 그림 (group/key)을 세계에 놓은 자리: 그림 px (tx, ty) → 세계 (x0 + tx × s, y0 + ty × s). w·h = 그림 px 크기. */
export interface ArtFrame {
  readonly x0: number;
  readonly y0: number;
  readonly s: number;
  readonly w: number;
  readonly h: number;
}

/** ArtNode(k, anchor)를 at에 놓았을 때와 같은 자리 (anchor = 'bottom' 또는 캔버스 점). 그림 정보가 없으면 null. */
export function artFrame(group: string, key: string, at: Pt, k: number, anchor: 'bottom' | Pt = 'bottom'): ArtFrame | null {
  const m = artMeta(group, key);
  if (m === undefined) return null;
  const s = k / m.scale;
  const ax = anchor === 'bottom' ? m.w / 2 : (anchor.x - m.trim.x) * m.scale;
  const ay = anchor === 'bottom' ? m.h : (anchor.y - m.trim.y) * m.scale;
  return { x0: at.x - ax * s, y0: at.y - ay * s, s, w: m.w, h: m.h };
}

/** 그림 px → 세계 좌표. */
export function framePt(f: ArtFrame, tx: number, ty: number): Pt {
  return { x: f.x0 + tx * f.s, y: f.y0 + ty * f.s };
}

/** 그림 px 네모 (x, y, w, h). */
export interface PxRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 그림의 네모 조각 r (그림 px)을 같은 텍스처의 조각으로 (픽셀을 복사하지 않는다), 큰 그림과 꼭 겹치게 세계 좌표에 놓는다.
 * 그림이 아직 없으면 null. 지울 때는 destroySlice (조각 텍스처만 지우고 그림은 남긴다).
 */
export function sliceSprite(group: string, key: string, f: ArtFrame, r: PxRect): Sprite | null {
  const tex = artTexture(group, key);
  if (tex === undefined) return null;
  const fr = tex.frame;
  const x = Math.max(0, Math.min(fr.width, r.x));
  const y = Math.max(0, Math.min(fr.height, r.y));
  const w = Math.max(1, Math.min(fr.width - x, r.w));
  const h = Math.max(1, Math.min(fr.height - y, r.h));
  const sub = new Texture({ source: tex.source, frame: new Rectangle(fr.x + x, fr.y + y, w, h) });
  const sp = new Sprite(sub);
  sp.position.set(f.x0 + x * f.s, f.y0 + y * f.s);
  sp.scale.set(f.s);
  sp.eventMode = 'none';
  return sp;
}

export function destroySlice(sp: Sprite): void {
  sp.destroy({ texture: true, textureSource: false });
}

/**
 * 그림의 네모 조각 r에서 pick(r, g, b)인 픽셀만 color로 칠해 남긴 텍스처 (알파는 그림 그대로, grow px만큼 둘레로 넓힌다: 테두리 색 섞인 픽셀까지 덮게).
 * 그림 픽셀을 읽지 못하면 null (화면은 덮개 없이 돈다).
 */
export function keyedTexture(group: string, key: string, r: PxRect, pick: (r: number, g: number, b: number) => boolean, color: number, grow = 1): Texture | null {
  const tex = artTexture(group, key);
  if (tex === undefined) return null;
  try {
    const src = tex.source.resource as CanvasImageSource | undefined;
    if (src === undefined || src === null) return null;
    const c = document.createElement('canvas');
    c.width = r.w;
    c.height = r.h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (g === null) return null;
    // 텍스처 px = 그림 px (resolution 1).
    const fr = tex.frame;
    const sx = tex.source.pixelWidth / Math.max(1, tex.source.width);
    g.drawImage(src, (fr.x + r.x) * sx, (fr.y + r.y) * sx, r.w * sx, r.h * sx, 0, 0, r.w, r.h);
    const img = g.getImageData(0, 0, r.w, r.h);
    const d = img.data;
    const n = r.w * r.h;
    let on = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const a = d[i * 4 + 3] ?? 0;
      if (a > 40 && pick(d[i * 4] ?? 0, d[i * 4 + 1] ?? 0, d[i * 4 + 2] ?? 0)) on[i] = 1;
    }
    for (let k = 0; k < grow; k++) {
      const next = on.slice();
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
          const i = y * r.w + x;
          if (on[i] === 1) continue;
          if ((x > 0 && on[i - 1] === 1) || (x < r.w - 1 && on[i + 1] === 1) || (y > 0 && on[i - r.w] === 1) || (y < r.h - 1 && on[i + r.w] === 1)) next[i] = 1;
        }
      }
      on = next;
    }
    const cr = (color >> 16) & 0xff;
    const cg = (color >> 8) & 0xff;
    const cb = color & 0xff;
    for (let i = 0; i < n; i++) {
      if (on[i] === 1) {
        d[i * 4] = cr;
        d[i * 4 + 1] = cg;
        d[i * 4 + 2] = cb;
        d[i * 4 + 3] = Math.max(d[i * 4 + 3] ?? 0, 200);
      } else d[i * 4 + 3] = 0;
    }
    g.putImageData(img, 0, 0);
    const out = Texture.from(c);
    out.source.scaleMode = 'linear';
    return out;
  } catch {
    return null;
  }
}

// ── 손님 몸 빌리기 ──

/**
 * 손님 화면(MonsterView)의 그림자·이모트 높이·가리개를 이번 프레임만 바꾼다 (곤돌라 안·탕 속 손님).
 * 프레임마다 빌린 손님만 바꾸고, end()에서 이번 프레임에 빌리지 않은 손님은 돌려놓는다 (그림자 보이기, 이모트 높이 0, 가리개 없음).
 */
export class Borrow {
  private readonly monsters: MonstersView;
  private now = new Set<MonsterId>();
  private last = new Set<MonsterId>();

  constructor(monsters: MonstersView) {
    this.monsters = monsters;
  }

  /** 그림자를 숨기고 (lift = 이모트를 더 올릴 높이, mask = 몸 가리개). */
  take(mv: MonsterView, lift: number, mask: Container | null): void {
    this.now.add(mv.id);
    mv.shadow.visible = false;
    mv.emoteLift = lift;
    if (mv.node.mask !== mask) mv.node.mask = mask;
  }

  /** 이번 프레임 끝: 빌리지 않은 손님을 돌려놓는다. */
  end(): void {
    for (const id of this.last) {
      if (this.now.has(id)) continue;
      const v = this.monsters.get(id);
      if (v === undefined) continue;
      v.shadow.visible = true;
      v.emoteLift = 0;
      if (v.node.mask !== null) v.node.mask = null;
    }
    const t = this.last;
    this.last = this.now;
    this.now = t;
    this.now.clear();
  }

  /** 모두 돌려놓는다 (화면을 지울 때). */
  release(): void {
    this.end();
    this.end();
  }
}
