// 손님 몸에 다는 장신구 (넷째 묶음, DESIGN 3.7). 지도 손님(monsterView.ts)·확대 화면·UI 그림이 같이 쓴다.
// AccessoryLayer는 손님 몸 그릇(발 기준점이 (0,0), 좌우 뒤집기 scale.x)의 자식으로 넣는다: 몸을 뒤집거나 기울이면(단체 놀이 꼭두각시)
// 장신구도 같이 뒤집히고 기운다. 어두운 필터(moodFilter.ts)도 몸 그릇에 걸면 장신구까지 같이 어두워진다.
// 붙는 점은 data/accessoryAnchors.ts 표 (종·포즈마다 캔버스 좌표, 그림에서 잰 값 + 손으로 고친 값), 표에 없는 종은 몸 그림 상자로 대략.
// 장신구 그림(items/<key>)이 없으면 코드로 작은 모양 (색 동그라미·띠)을 그린다.

import { Container, Graphics } from 'pixi.js';
import { ACCESSORY_ANCHORS, ACCESSORY_FIT, type AccessoryAnchor, type AccessoryFit, type AnchorPose } from '../data/accessoryAnchors.ts';
import { ACCESSORY_SLOTS, type AccessoryId, type AccessorySlot, type SpeciesId } from '../data/defs.ts';
import type { Pose } from '../sim/types.ts';
import { ArtNode, artMeta, hasArt, monsterFoot } from './art.ts';

/** 붙는 점 (캔버스 좌표)과 기울기·크기 배수·앞뒤, size = 자리 기준 폭 (캔버스 px: 장신구 폭 = size × ACCESSORY_FIT.w × scale). */
export interface CanvasAnchor {
  readonly x: number;
  readonly y: number;
  readonly rot: number;
  readonly scale: number;
  readonly behind: boolean;
  readonly size: number;
}

/** 그림이 없을 때의 몸 상자 (캔버스 좌표, 몸 높이 약 절반·발은 아래에서 15% 위). */
const FALLBACK_TRIM = { x: 292, y: 400, w: 440, h: 470 } as const;

/** 그 포즈 몸 그림의 잘라 낸 상자 (없으면 기본 포즈, 그것도 없으면 대략). */
function bodyTrim(species: SpeciesId, pose: Pose): { x: number; y: number; w: number; h: number } {
  const m = artMeta('monsters', `${species}_${pose}`) ?? artMeta('monsters', `${species}_base`);
  return m === undefined ? FALLBACK_TRIM : m.trim;
}

/** 표에 없는 종의 대략 붙는 점: 머리 = 위 가운데 조금 안, 목 = 상자 45% 높이 조금 앞, 옆구리 = 등 쪽(오른쪽) 아래. */
function guess(slot: AccessorySlot, t: { x: number; y: number; w: number; h: number }): AccessoryAnchor {
  switch (slot) {
    case 'head':
      return { x: t.x + t.w * 0.5, y: t.y + t.h * 0.08 };
    case 'neck':
      return { x: t.x + t.w * 0.45, y: t.y + t.h * 0.45 };
    case 'side':
      return { x: t.x + t.w * 0.68, y: t.y + t.h * 0.7 };
  }
}

/**
 * 종·포즈의 자리마다 붙는 점 (캔버스 좌표, 그 포즈 그림의 캔버스). 표(ACCESSORY_ANCHORS)에 그 종이 없으면 몸 그림 상자로 대략 (guess).
 * 연장(괭이·곡괭이)처럼 장신구가 아닌 것을 몸에 붙일 때도 쓴다 (monsterView: 옆구리 = 손 높이).
 */
export function accessoryAnchors(species: SpeciesId, pose: Pose): Record<AccessorySlot, CanvasAnchor> {
  const row = ACCESSORY_ANCHORS[species];
  const out = {} as Record<AccessorySlot, CanvasAnchor>;
  if (row !== undefined) {
    const p = row.poses[pose as AnchorPose] ?? row.poses.base;
    for (const slot of ACCESSORY_SLOTS) {
      const a = p[slot];
      out[slot] = { x: a.x, y: a.y, rot: a.rot ?? 0, scale: a.scale ?? 1, behind: a.behind ?? false, size: row.size[slot] };
    }
    return out;
  }
  const t = bodyTrim(species, pose);
  const tb = bodyTrim(species, 'base');
  for (const slot of ACCESSORY_SLOTS) {
    const a = guess(slot, t);
    out[slot] = { x: a.x, y: a.y, rot: 0, scale: 1, behind: false, size: tb.w * 0.6 };
  }
  return out;
}

/** 장신구 하나가 놓이는 곳 (몸 캔버스 좌표): 붙는 점 (x, y), 기울기, 폭 (캔버스 px), 그림 안 붙는 점 비율 (ax, ay), 몸 뒤에. */
export interface AccessoryPlacement {
  readonly x: number;
  readonly y: number;
  readonly rot: number;
  readonly width: number;
  readonly ax: number;
  readonly ay: number;
  readonly behind: boolean;
}

/** 자리마다 장신구 기본 붙이기 (ACCESSORY_FIT에 없는 장신구): 머리는 아래쪽, 목·옆구리는 위쪽 가운데, 폭은 자리 기준 폭 비율. */
const DEFAULT_FIT: Record<AccessorySlot, AccessoryFit> = {
  head: { ax: 0.5, ay: 0.82, w: 0.5 },
  neck: { ax: 0.5, ay: 0.2, w: 0.6 },
  side: { ax: 0.5, ay: 0.15, w: 0.28 },
};

function fitOf(key: AccessoryId, slot: AccessorySlot): AccessoryFit {
  return (ACCESSORY_FIT as Partial<Record<AccessoryId, AccessoryFit>>)[key] ?? DEFAULT_FIT[slot];
}

/** 장신구 하나를 종·포즈 몸에 놓는 곳 (붙는 점 + 장신구마다 붙이는 법 ACCESSORY_FIT). */
export function accessoryPlacement(species: SpeciesId, pose: Pose, key: AccessoryId, slot: AccessorySlot): AccessoryPlacement {
  const a = accessoryAnchors(species, pose)[slot];
  const f = fitOf(key, slot);
  const dx = (f.dx ?? 0) * a.size;
  const dy = (f.dy ?? 0) * a.size;
  const c = Math.cos(a.rot);
  const s = Math.sin(a.rot);
  return {
    x: a.x + dx * c - dy * s,
    y: a.y + dx * s + dy * c,
    rot: a.rot + (f.rot ?? 0),
    width: a.size * f.w * a.scale,
    ax: f.ax,
    ay: f.ay,
    behind: a.behind,
  };
}

/** UI 그림(<img>)에 장신구를 겹칠 때 하나의 자리: 몸 그림(잘라 낸 그 포즈 그림) 상자 비율. */
export interface PortraitPiece {
  readonly key: AccessoryId;
  readonly slot: AccessorySlot;
  /** 붙는 점: 몸 그림 상자 안 비율 (0 = 왼쪽·위, 1 = 오른쪽·아래, 상자 밖이면 0 미만·1 초과). */
  readonly left: number;
  readonly top: number;
  /** 장신구 그림(잘라 낸) 폭 / 몸 그림 폭. */
  readonly width: number;
  /** 장신구 그림 안 붙는 점 비율 (CSS: translate(-ax*100%, -ay*100%), transform-origin ax ay). */
  readonly ax: number;
  readonly ay: number;
  /** 기울기 (rad, + = 시계 방향). */
  readonly rot: number;
  readonly behind: boolean;
}

/**
 * UI 카드용: 몸 그림 <img> (monsters/<종>_<포즈>, 없으면 _base: ui/pics.ts setMonsterPic과 같은 고르기) 위에 장신구 <img>를 겹치는 자리.
 * 부르는 쪽: 몸 그림과 같은 비율의 position: relative 상자에 몸 <img>를 꽉 채우고, 장신구마다 position: absolute;
 * left: left×100%, top: top×100%, width: width×100%, transform: translate(-ax×100%, -ay×100%) rotate(rot) (transform-origin ax×100% ay×100%).
 * behind는 몸 <img> 앞(아래 z)에. 그림 정보(meta.json)가 아직 없으면 빈 목록.
 */
export function accessoryPortrait(species: SpeciesId, pose: Pose, list: readonly { readonly key: AccessoryId; readonly slot: AccessorySlot }[]): PortraitPiece[] {
  const usePose: Pose = artMeta('monsters', `${species}_${pose}`) !== undefined ? pose : 'base';
  const m = artMeta('monsters', `${species}_${usePose}`);
  if (m === undefined) return [];
  const t = m.trim;
  return list.map((a) => {
    const p = accessoryPlacement(species, usePose, a.key, a.slot);
    return { key: a.key, slot: a.slot, left: (p.x - t.x) / t.w, top: (p.y - t.y) / t.h, width: p.width / t.w, ax: p.ax, ay: p.ay, rot: p.rot, behind: p.behind };
  });
}

/** 그림이 없을 때 장신구 자리 표시 색 (자리마다). */
const PH_COLOR: Record<AccessorySlot, number> = { head: 0xf2b5a8, neck: 0x9ed9bf, side: 0xc9995f };
/** 그림이 없을 때 장신구 이름별 색 (있으면). */
const KEY_COLOR: Partial<Record<AccessoryId, number>> = {
  acc_flower_crown: 0xf2b5a8,
  acc_ribbon: 0xc9614a,
  acc_tophat: 0x5f5a55,
  acc_straw_hat: 0xe2c27a,
  acc_star_pin: 0xf3d36a,
  acc_mini_crown: 0xf3d36a,
  acc_scarf: 0xbfe6d2,
  acc_pearl_necklace: 0xf4efe3,
  acc_bell_collar: 0xc9614a,
  acc_coin_pouch: 0xa0785a,
};
/** 코드 모양의 폭 (그릇 배율 1일 때 px). */
const PH_W = 116;

interface Piece {
  readonly key: AccessoryId;
  readonly slot: AccessorySlot;
  readonly node: Container;
  /** 그림이 있으면 ArtNode (붙는 점 = 그림 안 ax·ay), 없으면 null (코드 모양: 붙는 점이 (0,0)). */
  readonly art: ArtNode | null;
  /** 그림(잘라 낸) 폭 (캔버스 px, 그림이 없으면 코드 모양 폭). */
  readonly w: number;
}

/**
 * 몸에 단 장신구들. k = 몸 그림 배율 (세계 px / 캔버스 px: 지도 ART_SCALE.monster, 확대 화면은 그 화면의 배율).
 * 몸 그릇의 자식으로 넣으면 (0,0) = 그 포즈의 발 기준점 (monsterFoot)이라 여기서 캔버스 점을 그 기준으로 옮긴다.
 * 몸 그림 뒤에 그릴 장신구(behind)는 back 그릇에: 부르는 쪽이 back을 몸 그림 앞(아래)에 넣는다 (넣지 않으면 그리지 않는다).
 * 이 층과 back은 몸 그릇의 (0,0)에 그대로 둔다 (옮기거나 돌리지 않는다: 몸 그릇이 움직인다).
 */
export class AccessoryLayer extends Container {
  /** 몸 그림 뒤에 그릴 장신구 그릇 (몸 그릇에 몸 그림보다 먼저 넣는다). */
  readonly back = new Container();
  private k: number;
  private pieces: Piece[] = [];
  private species: SpeciesId | null = null;
  private pose: Pose = 'base';
  private sig = '';

  constructor(opts: { readonly k: number }) {
    super();
    this.k = opts.k;
    this.eventMode = 'none';
    this.back.eventMode = 'none';
  }

  /** 몸 그림 배율을 바꾼다 (확대 화면에서 크기가 바뀔 때). */
  setScaleK(k: number): void {
    if (k === this.k) return;
    this.k = k;
    this.place();
  }

  /** 단 장신구 목록 (같으면 아무것도 안 한다). */
  setAccessories(list: readonly { readonly key: AccessoryId; readonly slot: AccessorySlot }[]): void {
    const sig = list.map((a) => `${a.key}@${a.slot}`).join(',');
    if (sig === this.sig) return;
    this.sig = sig;
    for (const p of this.pieces) p.node.destroy({ children: true });
    this.pieces = list.map((a) => this.makePiece(a.key, a.slot));
    this.place();
  }

  /** 종·포즈 (포즈가 바뀌면 붙는 점도). 포즈 그림이 없어 base 그림을 그리면 'base'를 준다. */
  setPose(species: SpeciesId, pose: Pose): void {
    if (species === this.species && pose === this.pose) return;
    this.species = species;
    this.pose = pose;
    this.place();
  }

  private makePiece(key: AccessoryId, slot: AccessorySlot): Piece {
    const f = fitOf(key, slot);
    const t = artMeta('items', key)?.trim;
    if (hasArt('items', key) && t !== undefined) {
      const art = new ArtNode({ k: 1, anchor: { x: t.x + t.w * f.ax, y: t.y + t.h * f.ay } });
      art.setArt('items', key);
      return { key, slot, node: art, art, w: t.w };
    }
    // 그림이 없으면 작은 코드 모양 (크기는 place에서 배율로, 붙는 점은 (0,0)).
    const g = new Graphics();
    const c = KEY_COLOR[key] ?? PH_COLOR[slot];
    if (slot === 'head') g.ellipse(0, -18, PH_W * 0.4, 30).fill(c).stroke({ color: 0x402c1c, width: 6 });
    else if (slot === 'neck') g.roundRect(-PH_W / 2, -14, PH_W, 28, 14).fill(c).stroke({ color: 0x402c1c, width: 6 });
    else g.circle(0, 30, 30).fill(c).stroke({ color: 0x402c1c, width: 6 });
    const node = new Container();
    node.addChild(g);
    return { key, slot, node, art: null, w: PH_W };
  }

  /** 붙는 점·크기를 다시 잡는다 (장신구·포즈·배율이 바뀔 때). */
  private place(): void {
    const sp = this.species;
    if (sp === null) return;
    const foot = monsterFoot(sp, this.pose);
    const k = this.k;
    for (const p of this.pieces) {
      const a = accessoryPlacement(sp, this.pose, p.key, p.slot);
      // ArtNode는 k = 1 (그림 폭 = 캔버스 px)로 만들었다: 그릇 배율로 원하는 폭 (세계 px)에 맞춘다.
      p.node.scale.set((a.width * k) / Math.max(1, p.w));
      p.node.position.set((a.x - foot.x) * k, (a.y - foot.y) * k);
      p.node.rotation = a.rot;
      const parent = a.behind ? this.back : this;
      if (p.node.parent !== parent) parent.addChild(p.node);
    }
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.back.destroy({ children: true });
    super.destroy(options);
  }
}
