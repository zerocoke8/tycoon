// 지도 위 가게 (다섯째 묶음, DESIGN 3.8): 놓인 가게마다 그림 조각(catalog.ts SHOP_LAYOUT.parts)·가게 주인 (숨쉬기). 누르기 hitTest.
// 손님을 그리기 전에 돌린다 (world.ts). sim은 읽기만 한다.
// 놀이기구 (회전목마·관람차)는 주인만 여기서, 그림·목마·바퀴·곤돌라·탄 손님은 rides.ts (RidesView). 여관·온천·점집·사진관 연출은 rest.ts,
// 먹거리·꾸미기·선물 가게 연출은 shopsFood.ts, 아이스크림 트럭 (그림·누르기)은 truck.ts. 그 화면들이 ownerNode·shopParts로 주인·그림을 움직인다.

import { Container } from 'pixi.js';
import { catalogKind, footprint, type ShopPart } from '../data/catalog.ts';
import type { ShopId } from '../data/defs.ts';
import { CELL, type Pt } from '../data/map.ts';
import type { SimApi } from '../sim/api.ts';
import type { Placed } from '../sim/types.ts';
import { ART_SCALE, ArtNode } from './art.ts';
import { boxHits, type Box, type ViewRect } from './mapUtil.ts';

/** 그림이 없을 때 자리 표시 (캔버스 px). */
const PART_PH = { w: 760, h: 640, color: 0xe8c9a0 };
const PERSON_PH = { w: 560, h: 980, color: 0xf2d0a9 };
/** 가려 내기 상자 여유. */
const PAD = 60;

interface OwnerSlot {
  readonly node: ArtNode;
  readonly at: Pt;
  readonly flip: number;
  art: string;
  readonly breath: number;
}

interface ShopView {
  readonly id: ShopId;
  readonly placedId: number;
  readonly parts: ArtNode[];
  readonly owner: OwnerSlot;
  readonly box: Box;
}

/** 놓인 것의 대략 상자 (세계 좌표): 발자국 + 위로 삐져나온 그림. */
function placedBox(p: Placed, w: number, h: number, up: number): Box {
  return { x0: p.x * CELL - PAD, y0: p.y * CELL - up - PAD, x1: (p.x + w) * CELL + PAD, y1: (p.y + h) * CELL + PAD };
}

export interface ShopLayers {
  readonly objects: Container;
  readonly floor?: Container;
}

export class ShopsView {
  private readonly sim: SimApi;
  private readonly layers: ShopLayers;
  private shops: ShopView[] = [];
  private placeStamp = -1;
  private time = 0;

  constructor(sim: SimApi, layers: ShopLayers) {
    this.sim = sim;
    this.layers = layers;
    this.sync();
  }

  // ── 세우기 ──

  private clear(): void {
    for (const v of this.shops) for (const n of [...v.parts, v.owner.node]) n.destroy({ children: true });
    this.shops = [];
  }

  /** 놓인 자리가 바뀌었으면 다시 세운다. */
  private sync(): void {
    const v = this.sim.village();
    if (v.stamp.place === this.placeStamp) return;
    this.placeStamp = v.stamp.place;
    this.clear();
    for (const p of v.state.placed) if (catalogKind(p.key) === 'shop') this.add(p.key as ShopId, p);
  }

  private part(p: ShopPart, z: number): ArtNode {
    const node = new ArtNode({ k: p.k, anchor: p.anchor ?? 'bottom', placeholder: PART_PH });
    node.setArt(p.group, p.key);
    node.position.set(p.at.x, p.at.y);
    node.zIndex = z;
    node.eventMode = 'none';
    (p.flat === true ? (this.layers.floor ?? this.layers.objects) : this.layers.objects).addChild(node);
    return node;
  }

  private add(id: ShopId, placed: Placed): void {
    const v = this.sim.village();
    const sp = v.shopSpot(id);
    const parts: ArtNode[] = [];
    // 놀이기구 그림은 rides.ts가 그린다 (판을 겹으로 나누고 목마·곤돌라를 돌린다): 여기는 주인만.
    if (id !== 'carousel' && id !== 'ferris_wheel') for (const p of sp.parts) parts.push(this.part(p, p.at.y));
    const ownerNode = new ArtNode({ k: ART_SCALE.villager, anchor: 'bottom', placeholder: PERSON_PH });
    ownerNode.position.set(sp.owner.x, sp.owner.y);
    ownerNode.zIndex = sp.owner.y;
    ownerNode.visible = false;
    ownerNode.eventMode = 'none';
    this.layers.objects.addChild(ownerNode);
    const flip = sp.ownerLook.x <= sp.owner.x ? 1 : -1;
    ownerNode.scale.x = flip;
    const fp = footprint(id);
    const up = id === 'ferris_wheel' ? 420 : 320;
    this.shops.push({
      id,
      placedId: placed.id,
      parts,
      owner: { node: ownerNode, at: sp.owner, flip, art: '', breath: Math.random() * 6 },
      box: placedBox(placed, fp.w, fp.h, up),
    });
  }

  // ── 바깥에서 부르는 것 ──

  /** 누른 곳의 가게 (Placed.id, 없으면 0): 가게 그림·주인 (트럭은 truck.ts, 놀이기구 그림은 rides.ts). */
  hitTest(wx: number, wy: number): number {
    let best = 0;
    let bestY = -Infinity;
    for (const s of this.shops) {
      for (const n of [...s.parts, s.owner.node]) {
        if (!n.visible || n.destroyed) continue;
        const b = n.getBounds();
        // getBounds는 화면 좌표: 물체층 → 세계 좌표로 (물체층은 카메라 안이라 부모 변환을 거꾸로).
        const p = n.parent;
        if (p === null) continue;
        const a = p.toLocal({ x: b.minX, y: b.minY });
        const c = p.toLocal({ x: b.maxX, y: b.maxY });
        if (wx >= Math.min(a.x, c.x) && wx <= Math.max(a.x, c.x) && wy >= Math.min(a.y, c.y) && wy <= Math.max(a.y, c.y) && n.y > bestY) {
          best = s.placedId;
          bestY = n.y;
        }
      }
    }
    return best;
  }

  /** 가게 주인 그림과 서는 점 (빌더 연출용, 없으면 null). */
  ownerNode(id: ShopId): { node: ArtNode; at: Pt } | null {
    const s = this.shops.find((x) => x.id === id);
    return s === undefined ? null : { node: s.owner.node, at: s.owner.at };
  }

  /** 가게 그림들 (빌더 연출용: 통통 튀기기 등). */
  shopParts(id: ShopId): readonly ArtNode[] {
    return this.shops.find((x) => x.id === id)?.parts ?? [];
  }

  // ── 매 프레임 ──

  update(dt: number, view: ViewRect): void {
    this.time += dt;
    this.sync();
    const st = this.sim.state;
    for (const s of this.shops) {
      const ss = st.shops[s.id];
      // 주인 (가게 주인이 바뀌면 그림을 바꾼다, 트럭 주인은 트럭 안).
      const oid = ss.owner;
      const staff = oid === null ? undefined : st.staff.find((x) => x.id === oid);
      const art = staff?.art ?? '';
      const o = s.owner;
      if (art !== o.art) {
        o.art = art;
        if (art !== '') o.node.setArt('characters', art);
      }
      o.node.visible = art !== '' && s.id !== 'icecream_truck';
      if (o.node.visible) {
        const br = Math.sin(this.time * 2.1 + o.breath) * 0.012;
        o.node.scale.set(o.flip * (1 - br * 0.5), 1 + br);
      }
      const visible = boxHits(s.box, view);
      for (const n of s.parts) n.culled = !visible;
      o.node.culled = !visible;
    }
    // 숨은 손님 (여관 방·미용실 안)은 monsterView가 안 그린다 (Monster.hidden).
  }

  destroy(): void {
    this.clear();
  }
}
