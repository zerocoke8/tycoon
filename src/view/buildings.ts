// 지도 위 건물·놀이부스·장식·진행자·촌장, 길이 이어지지 않은 건물의 표시. (사지 않은 땅을 덮는 구름은 land.ts)
// 배치형 마을 (DESIGN 6.1): 놓인 것(GameState.village.placed)마다 그림을 세운다. 자리가 바뀌면 (sim.village().stamp.place) 모두 다시 세운다.
// 상태(레벨·해금·진행자)는 매 프레임 비교해서 바뀐 것만 고친다. 바뀔 때의 연출: 업그레이드·해금·진행자 바뀜 = 통통 + 먼지.
// 바닥에 깔리는 부스 그림·소품(catalog.ts BoothSpot.flat·props[].flat: 모래판, 흙더미)과 일터 밭은 바닥층(floor)에 그린다: 손님이 그 위에 선다.
// 넷째 묶음 (DESIGN 3.7): 전당포·은행·일터의 주인(전당포 주인·은행원·일터 반장, catalog.ts SHOP_GEO·YARD_GEO.foreman)이 선다.
// 일터 반장은 일하는 채무자가 있으면 밭 고랑 사이·광산 앞을 오가며 (foremanRoute) 가끔 호루라기를 분다 (foremanWhistle).
// 장신구·코인이 드나드는 전당포 진열창·은행 문은 shopPort, 재료가 들어가는 바구니·수레는 yardPropTop·yardPropHop.
// 입구가 길로 마을 입구와 이어지지 않은 건물(손님이 들르는 곳) 위에는 '길이 없어요' 표시.

import { Container, Graphics, Text, type Renderer } from 'pixi.js';
import { catalogKind, footprint, type BoothSpot, type CatalogKey, type YardGeo } from '../data/catalog.ts';
import { BOOTHS, WORK_FACILITIES, type BoothId, type BuildingId, type OutcomeTier } from '../data/defs.ts';
import { CELL, CHUNK, CHUNKS, type Pt } from '../data/map.ts';
import { ease, tweens } from '../core/tween.ts';
import type { SimApi } from '../sim/api.ts';
import type { Placed } from '../sim/types.ts';
import type { Village } from '../sim/village.ts';
import { ART_SCALE, ArtNode, artMeta, hasArt } from './art.ts';
import type { FxLayer } from './fx.ts';
import { RACE_GATE_FLIP, boxHits, clamp, follow, type Box, type ViewRect } from './mapUtil.ts';

const OUTLINE = 0x402c1c;
/** 닫힌 부스(개발용 ?only)의 흐린 건물. */
const LOCKED_ALPHA = 0.35;
/** 가려 내기 상자 여유 (항아리가 커지고 소품이 통통 튀어도 잘리지 않게). */
const CULL_PAD = 40;

/** 그림이 없을 때 자리 표시 크기(캔버스 px)와 색. 배치를 눈으로 맞출 수 있게 대략 실제 크기로. */
const PROP_PH: Record<string, { w: number; h: number; color: number }> = {
  tree_round: { w: 460, h: 560, color: 0x8fae6b },
  tree_pine: { w: 380, h: 600, color: 0x5f7f55 },
  bush: { w: 380, h: 240, color: 0x8fae6b },
  flowers: { w: 360, h: 200, color: 0xf2b5a8 },
  lamp: { w: 120, h: 520, color: 0xf3d36a },
  bench: { w: 420, h: 260, color: 0xa0703f },
  fence: { w: 520, h: 260, color: 0xa0703f },
  signpost: { w: 300, h: 420, color: 0xa0703f },
  crates: { w: 420, h: 360, color: 0xa0703f },
  rocks: { w: 380, h: 220, color: 0xb3aea8 },
  planter: { w: 380, h: 260, color: 0xa0703f },
  balloons: { w: 300, h: 560, color: 0xf3d36a },
  lot_sign: { w: 220, h: 300, color: 0xc9995f },
  ore_cart: { w: 460, h: 340, color: 0x9a948d },
  crop_basket: { w: 380, h: 300, color: 0xc9995f },
};
/** 일터 시설 그림이 없을 때 (밭은 납작하게). */
const FACILITY_PH: Record<string, { w: number; h: number; color: number }> = {
  farm_plot: { w: 840, h: 560, color: 0xa0785a },
  mine_entrance: { w: 900, h: 700, color: 0xb3aea8 },
};
const BUILDING_PH = { w: 760, h: 700, color: 0xd9c7a6 };
/** 바닥에 깔리는 부스 그림의 자리 표시 (납작하게). */
const FLAT_PH = { w: 760, h: 420, color: 0xe2c38f };
/** 바닥 그림을 물체층에 넣을 때 (바닥층이 없을 때) 맨 아래로. */
const FLAT_Z = -1e6;
const POT_PH = { w: 500, h: 460, color: 0xc9824a };
const PERSON_PH = { w: 560, h: 980, color: 0xf2d0a9 };

/** 전당포 진열창·은행 문 (그림 캔버스 좌표): 맡긴 장신구가 날아 들어가고 코인이 나오는 곳. 그림이 없으면 건물 자리 위. */
const SHOP_PORT: Record<'pawnshop' | 'bank', Pt> = { pawnshop: { x: 587, y: 779 }, bank: { x: 468, y: 739 } };

/**
 * 일터 반장이 오가는 길 (YARD_GEO에서 정한다): 집(반장 자리) → 밭 고랑 사이 동쪽 → 서쪽 → 동쪽 → 집 → 광산 앞 → 집.
 * pause = 닿고 쉬는 초, whistle = 거기서 호루라기를 불 확률, look = 쉴 때 바라보는 곳.
 */
interface PatrolStop {
  readonly at: Pt;
  readonly pause: number;
  readonly whistle: number;
  readonly look: Pt;
}
function foremanRoute(Y: YardGeo): PatrolStop[] {
  const farm = Y.facilities.farm;
  const mine = Y.facilities.mine;
  const xs = farm.spots.map((p) => p.x);
  const ys = farm.spots.map((p) => p.y);
  // 밭 고랑 사이 = 일하는 자리 두 줄의 가운데 높이.
  const aisle = (Math.min(...ys) + Math.max(...ys)) / 2;
  // 고랑 양 끝 (일하는 손님을 가리지 않게 자리 줄 밖에서 쉰다).
  const east = { x: Math.max(...xs) + 95, y: aisle };
  const west = { x: Math.min(...xs) - 95, y: aisle };
  const my = Math.max(...mine.spots.map((p) => p.y));
  const mx = mine.spots.reduce((a, p) => a + p.x, 0) / Math.max(1, mine.spots.length);
  const home = Y.foreman;
  return [
    { at: east, pause: 1.2, whistle: 0.2, look: farm.face },
    { at: west, pause: 2.4, whistle: 0.45, look: { x: east.x, y: aisle } },
    { at: east, pause: 1.0, whistle: 0, look: farm.face },
    { at: home, pause: 2.2, whistle: 0.25, look: farm.face },
    { at: { x: mx, y: my + 70 }, pause: 2.4, whistle: 0.45, look: mine.face },
    { at: home, pause: 2.6, whistle: 0, look: farm.face },
  ];
}
/** 반장 걷는 빠르기 (세계 px/초)와 걸음 폭. */
const FOREMAN_SPEED = 85;
const FOREMAN_STRIDE = 26;

interface Prop {
  readonly node: Container;
  readonly box: Box;
  /** 톡 나타날 때 돌아갈 기본 배율. */
  sx: number;
  sy: number;
}

/** 진행자 자리 하나 (BOOTHS[b].roles와 같은 순서, BoothSpot.hosts의 점에 선다). */
interface HostSlot {
  readonly node: ArtNode;
  readonly prop: Prop;
  readonly at: Pt;
  readonly flip: number;
  art: string;
  readonly breath: number;
  hopT: number;
  hopK: number;
}

interface BoothView {
  readonly id: BoothId;
  readonly placedId: number;
  readonly spot: BoothSpot;
  readonly building: ArtNode;
  readonly pot: ArtNode;
  readonly hosts: readonly HostSlot[];
  /** 부스 그림과 같이 놓는 그림 (경주장의 출발대·결승선). 닫혀 있으면 흐리게. */
  readonly extras: readonly ArtNode[];
  readonly buildingProp: Prop;
  readonly hit: Box;
  readonly potBox: Box;
  unlocked: boolean;
  level: number;
  potShown: number;
  potScale: number;
  potJiggle: number;
  /** 부스 그림 계산대 위 항아리 (부스 앞에 그리고, 그림 속 항아리를 덮게 덜 작아진다). */
  readonly potOnCounter: boolean;
}

/** 일터 반장의 걷기 (집 = YARD_GEO.foreman, foremanRoute를 돈다). */
interface Patrol {
  x: number;
  y: number;
  /** 다음에 갈 route index (일하는 손님이 없으면 집으로). */
  leg: number;
  /** 서서 쉬는 남은 초. */
  pause: number;
  flip: number;
  walk: number;
  phase: number;
  /** 지금 가는 곳이 집인가 (일하는 손님이 없을 때). */
  homing: boolean;
  /** 다독이러 가는 채무자 곁 (foremanCheer, 닿으면 run을 부르고 길로 돌아간다). */
  visit: { readonly x: number; readonly y: number; readonly look: number; readonly run: () => void } | null;
  readonly route: readonly PatrolStop[];
  readonly home: Pt;
  readonly face: Pt;
}

interface BuildingView {
  readonly id: BuildingId;
  readonly placedId: number;
  /** 그림 자리 (아래 가운데). 일터는 일터 가운데. */
  readonly at: Pt;
  /** 대표 그림 (일터는 첫 시설). 레벨에 따라 배율이 조금 커진다 (일터는 그대로). */
  readonly node: ArtNode;
  readonly prop: Prop;
  /** 같이 흐려지고 같이 통통 튀는 그림 (전당포·은행 = 그림 하나, 일터 = 시설 둘 + 소품). key = 그림 이름. */
  readonly parts: readonly { readonly node: ArtNode; readonly prop: Prop; readonly key: string }[];
  /** 주인 (전당포 주인·은행원·일터 반장). */
  readonly npc: HostSlot | null;
  /** 일터 반장의 걷기 (그 밖은 null). */
  readonly patrol: Patrol | null;
  readonly hit: Box;
  level: number;
}

/** 길이 없는 건물 위 표시. */
interface RoadMark {
  readonly node: Container;
  readonly at: Pt;
  readonly box: Box;
}

export type MapHit = { readonly kind: 'booth'; readonly id: BoothId } | { readonly kind: 'building'; readonly id: BuildingId };

export interface BuildingLayers {
  /** y로 정렬되는 물체층 (구름 묶음도 여기에 zIndex = 조각 아래 변으로 들어간다). */
  readonly objects: Container;
  /** 바닥층 (바닥 타일 위, 그림자 아래): 바닥에 깔리는 그림. 없으면 물체층 맨 아래. */
  readonly floor?: Container;
}

function emptyBox(): Box {
  return { x0: 0, y0: 0, x1: 0, y1: 0 };
}

/** 놓인 노드의 세계 상자 (로컬 경계 × 배율 + 위치). shrink = 누르기용으로 가장자리를 깎는 비율, pad = 늘리기. */
function nodeBox(node: Container, out: Box, shrink = 0, pad = 0): Box {
  const b = node.getLocalBounds();
  if (b.isEmpty() || !Number.isFinite(b.minX + b.maxX + b.minY + b.maxY)) {
    // 아직 그림이 없는 노드 (진행자 없음 등): 제자리 한 점.
    out.x0 = out.x1 = node.x;
    out.y0 = out.y1 = node.y;
    return out;
  }
  const sx = node.scale.x;
  const sy = node.scale.y;
  const ax = b.minX * sx;
  const bx = b.maxX * sx;
  const ay = b.minY * sy;
  const by = b.maxY * sy;
  const x0 = node.x + Math.min(ax, bx);
  const x1 = node.x + Math.max(ax, bx);
  const y0 = node.y + Math.min(ay, by);
  const y1 = node.y + Math.max(ay, by);
  const w = (x1 - x0) * shrink;
  const h = (y1 - y0) * shrink;
  out.x0 = x0 + w - pad;
  out.x1 = x1 - w + pad;
  out.y0 = y0 + h - pad;
  out.y1 = y1 - h * 0.2 + pad;
  return out;
}

function unionBox(a: Box, b: Box): void {
  a.x0 = Math.min(a.x0, b.x0);
  a.y0 = Math.min(a.y0, b.y0);
  a.x1 = Math.max(a.x1, b.x1);
  a.y1 = Math.max(a.y1, b.y1);
}

/** 그림 후보 중 처음 있는 것 (없으면 첫 후보: 자리 표시). */
function pickArt(cands: readonly (readonly [string, string])[]): readonly [string, string] {
  for (const c of cands) if (hasArt(c[0], c[1])) return c;
  return cands[0] as readonly [string, string];
}

/** 진행자 자리 role (BoothSpot.hosts): 자리 0을 바라본다. sim도 앉은 손님이 0번 진행자의 점을 보게 한다. */
function hostSpot(spot: BoothSpot, role: number): { at: Pt; flip: number } {
  const s0 = spot.seats[0] ?? spot.base;
  const at = spot.hosts[role] ?? spot.hosts[0] ?? spot.base;
  // 그림은 왼쪽을 본다: 진행자가 자리 오른쪽에 서면 그대로, 왼쪽이면 뒤집는다.
  return { at, flip: at.x >= s0.x ? 1 : -1 };
}

export class BuildingsView {
  private readonly sim: SimApi;
  private readonly layers: BuildingLayers;
  private readonly fx: FxLayer;
  /** 놓인 것마다 세운 그림 (자리가 바뀌면 모두 지우고 다시). */
  private props: Prop[] = [];
  private booths: BoothView[] = [];
  private buildings: BuildingView[] = [];
  private decorNodes = new Map<number, Prop>();
  private marks: RoadMark[] = [];
  /** 트윈이 배율을 쥐고 있는 노드와 그 트윈 번호 (그동안 숨쉬기 같은 매 프레임 배율을 쉰다). */
  private readonly busy = new Map<Container, number>();
  private tweenGen = 0;
  private readonly renderer: Renderer;
  private chief: ArtNode | null = null;
  private chiefAt: Pt = { x: 0, y: 0 };
  private chiefHopT = -1;
  private initialized = false;
  private time = 0;
  private placeStamp = -1;
  private roadStamp = -1;
  /** 짓기 모드가 옮기는 중이라 숨긴 것 (Placed.id, 없으면 0). */
  private hiddenId = 0;

  constructor(sim: SimApi, layers: BuildingLayers, fx: FxLayer, renderer: Renderer) {
    this.sim = sim;
    this.layers = layers;
    this.fx = fx;
    this.renderer = renderer;
    this.syncVillage();
    this.initialized = true;
  }

  // ── 놓인 것 세우기 ──

  /** 놓인 것이 바뀌었으면 그림을 모두 다시 세우고, 길이 바뀌었으면 '길이 없어요' 표시를 맞춘다. */
  private syncVillage(): void {
    const v = this.sim.village();
    if (v.stamp.place !== this.placeStamp) {
      this.placeStamp = v.stamp.place;
      this.rebuild(v);
      this.roadStamp = -1;
    }
    if (v.stamp.road !== this.roadStamp) {
      this.roadStamp = v.stamp.road;
      this.rebuildMarks(v);
    }
  }

  private clearInstances(): void {
    for (const p of this.props) {
      tweens.cancel(p.node);
      this.busy.delete(p.node);
      p.node.destroy({ children: true });
    }
    this.props = [];
    this.booths = [];
    this.buildings = [];
    this.decorNodes.clear();
    this.chief = null;
  }

  private rebuild(v: Village): void {
    this.clearInstances();
    for (const p of v.state.placed) {
      const kind = catalogKind(p.key);
      if (kind === 'booth') this.addBooth(v, p.key as BoothId, p);
      else if (kind === 'building') this.addBuilding(v, p.key as BuildingId, p);
      else this.decorNodes.set(p.id, this.addDecor(p.key, v.artOf(p), (p.id * 7) % 3 === 0));
    }
    // 촌장 (마을회관 앞).
    if (v.placed('hall') !== undefined) {
      const at = v.chief();
      const chief = new ArtNode({ k: ART_SCALE.villager, anchor: 'bottom', placeholder: PERSON_PH });
      chief.setArt('characters', 'chief');
      chief.position.set(at.x, at.y);
      chief.zIndex = at.y;
      this.layers.objects.addChild(chief);
      this.addProp(chief);
      this.chief = chief;
      this.chiefAt = at;
    }
    for (const b of this.booths) b.level = 0;
    for (const bv of this.buildings) bv.level = -1;
    this.sync(false);
    this.applyHidden();
  }

  private addBuilding(v: Village, id: BuildingId, placed: Placed): void {
    const parts: { node: ArtNode; prop: Prop; key: string }[] = [];
    const put = (key: string, p: Pt, k: number, flat: boolean, ph: { w: number; h: number; color: number }, flip = false): void => {
      const node = new ArtNode({ k, anchor: 'bottom', placeholder: ph });
      node.setArt('map', key);
      node.position.set(p.x, p.y);
      node.zIndex = flat ? FLAT_Z : p.y;
      if (flip) node.scale.x = -1;
      this.floorOf(flat).addChild(node);
      parts.push({ node, prop: this.addProp(node), key });
    };
    let at = v.art(id);
    if (id === 'workyard') {
      const Y = v.yard();
      for (const f of WORK_FACILITIES) {
        const fs = Y.facilities[f];
        put(fs.art, fs.at, fs.k, fs.flat, FACILITY_PH[fs.art] ?? BUILDING_PH);
      }
      for (const pr of Y.props) put(pr.key, pr.at, pr.k, false, PROP_PH[pr.key] ?? { w: 400, h: 300, color: 0xa0703f }, pr.flip === true);
      at = Y.center;
    } else {
      put(id, at, v.buildingK(id) ?? ART_SCALE.building, false, BUILDING_PH);
    }
    const first = parts[0] as { node: ArtNode; prop: Prop; key: string };
    const npc = this.npcSlot(v, id);
    const hit = emptyBox();
    this.buildingHit(parts, hit);
    let patrol: Patrol | null = null;
    if (id === 'workyard' && npc !== null) {
      const Y = v.yard();
      patrol = { x: npc.at.x, y: npc.at.y, leg: 0, pause: 1, flip: npc.flip, walk: 0, phase: 0, homing: true, visit: null, route: foremanRoute(Y), home: Y.foreman, face: Y.facilities.farm.face };
    }
    this.buildings.push({ id, placedId: placed.id, at, node: first.node, prop: first.prop, parts, npc, patrol, hit, level: -1 });
  }

  private addBooth(v: Village, id: BoothId, placed: Placed): void {
    const spot = v.booth(id);
    const flat = spot.flat === true;
    const building = new ArtNode({ k: spot.buildingK ?? ART_SCALE.booth, anchor: 'bottom', placeholder: flat ? FLAT_PH : BUILDING_PH });
    building.setArt('map', BOOTHS[id].building);
    building.position.set(spot.base.x, spot.base.y);
    building.zIndex = flat ? FLAT_Z : spot.base.y;
    const potArt = pickArt([
      ['map', 'prize_pot'],
      ['objects', 'prize_pot'],
    ]);
    const pot = new ArtNode({ k: ART_SCALE.potOnMap, anchor: 'bottom', placeholder: POT_PH });
    pot.setArt(potArt[0], potArt[1]);
    pot.position.set(spot.pot.x, spot.pot.y);
    // 계산대 위 항아리는 부스 그림 바로 앞에 (그림 속 항아리를 덮는다).
    const potOnCounter = spot.pot.y < spot.base.y;
    pot.zIndex = potOnCounter ? spot.base.y + 1 : spot.pot.y;
    this.floorOf(flat).addChild(building);
    this.layers.objects.addChild(pot);
    const buildingProp = this.addProp(building);
    this.addProp(pot);
    // 진행자 자리마다 한 사람 (경주장은 셋).
    const hosts: HostSlot[] = BOOTHS[id].roles.map((_, role) => {
      const hs = hostSpot(spot, role);
      const node = new ArtNode({ k: ART_SCALE.villager, anchor: 'bottom', placeholder: PERSON_PH });
      node.position.set(hs.at.x, hs.at.y);
      node.zIndex = hs.at.y;
      node.scale.x = hs.flip;
      node.visible = false;
      this.layers.objects.addChild(node);
      return { node, prop: this.addProp(node), at: hs.at, flip: hs.flip, art: '', breath: Math.random() * 6, hopT: -1, hopK: 1 };
    });
    // 같이 놓는 그림 (경주장 출발대·결승선, 줄다리기 깃발, 보물찾기 흙더미). 출발대는 칸 색이 레인 순서와 맞게 뒤집기도 한다 (mapUtil RACE_GATE_FLIP).
    const extras = (spot.props ?? []).map((p) => {
      const node = new ArtNode({ k: p.k, anchor: 'bottom', placeholder: p.flat === true ? { w: 500, h: 220, color: 0xb88a5a } : { w: 600, h: 500, color: 0xa0703f } });
      node.setArt('map', p.key);
      node.position.set(p.at.x, p.at.y);
      node.zIndex = p.flat === true ? FLAT_Z : p.at.y;
      if (p.key === 'race_gate' && RACE_GATE_FLIP) node.scale.x = -1;
      this.floorOf(p.flat === true).addChild(node);
      this.addProp(node);
      return node;
    });
    const view: BoothView = {
      id, placedId: placed.id, spot, building, pot, hosts, extras, buildingProp, hit: emptyBox(), potBox: emptyBox(),
      unlocked: false, level: 0, potShown: -1, potScale: 1, potJiggle: 0, potOnCounter,
    };
    this.booths.push(view);
    this.boothHit(view);
  }

  /** 넷째 묶음 건물의 주인 (전당포 주인·은행원: 계산대를 본다, 일터 반장: 밭을 본다). 없으면 null. */
  private npcSlot(v: Village, id: BuildingId): HostSlot | null {
    let at: Pt;
    let look: Pt;
    let art: string;
    if (id === 'pawnshop' || id === 'bank') {
      const sh = v.shop(id);
      at = sh.npc;
      look = sh.counter[0] ?? v.art(id);
      art = sh.art;
    } else if (id === 'workyard') {
      const Y = v.yard();
      at = Y.foreman;
      look = Y.facilities.farm.face;
      art = 'foreman';
    } else return null;
    const node = new ArtNode({ k: ART_SCALE.villager, anchor: 'bottom', placeholder: PERSON_PH });
    node.setArt('characters', art);
    node.position.set(at.x, at.y);
    node.zIndex = at.y;
    // 그림은 왼쪽을 본다: 볼 곳이 오른쪽이면 뒤집는다.
    const flip = look.x <= at.x ? 1 : -1;
    node.scale.x = flip;
    node.visible = false;
    this.layers.objects.addChild(node);
    return { node, prop: this.addProp(node), at, flip, art, breath: Math.random() * 6, hopT: -1, hopK: 1 };
  }

  /** 건물 누르기 상자: 그림들을 합친 상자. */
  private buildingHit(parts: readonly { readonly node: ArtNode }[], out: Box): void {
    let first = true;
    for (const p of parts) {
      const b = nodeBox(p.node, emptyBox(), 0.08);
      if (first) Object.assign(out, b);
      else unionBox(out, b);
      first = false;
    }
  }

  /** 바닥에 깔리는 그림은 바닥층에 (없으면 물체층 맨 아래). */
  private floorOf(flat: boolean): Container {
    return flat ? (this.layers.floor ?? this.layers.objects) : this.layers.objects;
  }

  private addProp(node: Container): Prop {
    // 손으로 가려 내지만(culled), Pixi CullerPlugin이 붙어 있어도 같은 답이 나오게 cullable도 켠다.
    node.cullable = true;
    node.cullableChildren = false;
    const p: Prop = { node, box: nodeBox(node, emptyBox(), 0, CULL_PAD), sx: node.scale.x, sy: node.scale.y };
    this.props.push(p);
    return p;
  }

  private addDecor(key: string, at: Pt, flip: boolean): Prop {
    const node = new ArtNode({ k: ART_SCALE.prop, anchor: 'bottom', placeholder: PROP_PH[key] ?? { w: 400, h: 400 } });
    node.setArt('map', key);
    node.position.set(at.x, at.y);
    node.zIndex = at.y;
    if (flip) node.scale.x = -1;
    this.layers.objects.addChild(node);
    return this.addProp(node);
  }

  private boothHit(b: BoothView): void {
    nodeBox(b.building, b.hit, 0.08);
    nodeBox(b.pot, b.potBox);
    unionBox(b.hit, b.potBox);
  }

  // ── 길이 없어요 ──

  private rebuildMarks(v: Village): void {
    for (const m of this.marks) m.node.destroy({ children: true });
    this.marks = [];
    for (const p of v.state.placed) {
      const fp = footprint(p.key);
      if (fp.entry === undefined || catalogKind(p.key) === 'decor' || v.linkedId(p.id)) continue;
      // 입구 앞 칸 위쪽에 (건물 앞): 빨간 띠 + '길이 없어요' (입구 앞 칸에 길이 있는데 마을 입구와 끊겼으면 '길이 끊겼어요') + 아래를 가리키는 꼬리.
      const e = { x: (p.x + fp.entry.x) * CELL + CELL / 2, y: (p.y + fp.entry.y) * CELL + CELL / 2 };
      const ei = v.entryCellIndex(p);
      const node = new Container();
      const label = new Text({ text: ei >= 0 && v.road[ei] === 1 ? '길이 끊겼어요' : '길이 없어요', style: { fontFamily: 'Jua, sans-serif', fontSize: 30, fill: 0xffffff } });
      label.anchor.set(0.5);
      const w = label.width + 34;
      const h = 48;
      const g = new Graphics()
        .roundRect(-w / 2, -h / 2, w, h, 16)
        .fill(0xd9614c)
        .stroke({ width: 4, color: OUTLINE })
        .poly([-12, h / 2 - 2, 12, h / 2 - 2, 0, h / 2 + 16])
        .fill(0xd9614c);
      node.addChild(g, label);
      node.position.set(e.x, e.y - 70);
      node.zIndex = 1e6;
      node.eventMode = 'none';
      this.layers.objects.addChild(node);
      this.marks.push({ node, at: e, box: { x0: e.x - w, y0: e.y - 140, x1: e.x + w, y1: e.y } });
    }
  }

  private tweenScale(node: Container, sec: number, delay: number, step: (t: number) => void, e: (t: number) => number, sx: number, sy: number): void {
    tweens.cancel(node);
    const gen = ++this.tweenGen;
    this.busy.set(node, gen);
    void tweens.run(sec, step, { ease: e, delay, owner: node }).then(() => {
      // 멈춘 트윈(cancel)도 여기로 온다: 더 새 트윈이 쥐고 있으면 손대지 않는다.
      if (this.busy.get(node) !== gen) return;
      this.busy.delete(node);
      if (!node.destroyed) node.scale.set(sx, sy);
    });
  }

  /** 트윈을 멈추고 배율을 바로 정한다. */
  private setScaleNow(node: Container, sx: number, sy: number): void {
    tweens.cancel(node);
    this.busy.delete(node);
    node.scale.set(sx, sy);
  }

  // ── 상태 맞추기 ──

  private sync(animate = this.initialized): void {
    const st = this.sim.state;
    for (let i = 0; i < this.buildings.length; i++) {
      const bv = this.buildings[i] as BuildingView;
      const lvl = st.buildings[bv.id]?.level ?? 1;
      if (lvl === bv.level) continue;
      const up = animate && bv.level > 0 && lvl > bv.level;
      bv.level = lvl;
      for (const p of bv.parts) p.node.alpha = lvl >= 1 ? 1 : LOCKED_ALPHA;
      if (bv.npc !== null && !this.busy.has(bv.npc.node)) bv.npc.node.visible = lvl >= 1;
      // 레벨마다 조금 커진다 (일터는 시설이 여럿이라 그대로).
      const s = bv.id === 'workyard' ? 1 : 1 + 0.04 * Math.max(0, lvl - 1);
      if (bv.id !== 'workyard') {
        this.setScaleNow(bv.node, s, s);
        bv.prop.sx = s;
        bv.prop.sy = s;
        nodeBox(bv.node, bv.prop.box, 0, CULL_PAD);
      }
      this.buildingHit(bv.parts, bv.hit);
      if (up) this.celebrate(bv.node, s, s, bv.at);
    }
    this.syncBooths(animate);
  }

  private syncBooths(animate: boolean): void {
    const st = this.sim.state;
    for (let i = 0; i < this.booths.length; i++) {
      const b = this.booths[i] as BoothView;
      const bs = st.booths[b.id];
      if (bs === undefined) continue;
      const wasInit = b.level > 0;
      if (bs.unlocked !== b.unlocked) {
        b.unlocked = bs.unlocked;
        if (animate && wasInit && bs.unlocked) {
          this.celebrate(b.building, b.building.scale.x, b.building.scale.y, b.spot.base);
          this.fx.confetti(b.spot.base.x, b.spot.base.y - 140, 26);
        }
      }
      b.building.alpha = b.unlocked ? 1 : LOCKED_ALPHA;
      for (let e = 0; e < b.extras.length; e++) (b.extras[e] as ArtNode).alpha = b.unlocked ? 1 : LOCKED_ALPHA;
      b.pot.visible = b.unlocked && b.placedId !== this.hiddenId;

      if (bs.level !== b.level) {
        const up = animate && wasInit && bs.level > b.level;
        b.level = bs.level;
        const s = 1 + 0.04 * (bs.level - 1);
        this.setScaleNow(b.building, s, s);
        b.buildingProp.sx = s;
        b.buildingProp.sy = s;
        nodeBox(b.building, b.buildingProp.box, 0, CULL_PAD);
        this.boothHit(b);
        if (up) this.celebrate(b.building, s, s, b.spot.base);
      }

      // 진행자 (자리마다)
      for (let role = 0; role < b.hosts.length; role++) {
        const hv = b.hosts[role] as HostSlot;
        const id = bs.staff[role] ?? null;
        let art = '';
        if (id !== null) {
          for (let k = 0; k < st.staff.length; k++) {
            const s = st.staff[k];
            if (s !== undefined && s.id === id) {
              art = s.art;
              break;
            }
          }
        }
        const show = art !== '' && b.unlocked && b.placedId !== this.hiddenId;
        if (art !== hv.art) {
          hv.art = art;
          if (art !== '') {
            hv.node.setArt('characters', art);
            nodeBox(hv.node, hv.prop.box, 0, CULL_PAD);
          }
          if (show && animate && wasInit) {
            hv.node.visible = true;
            this.fx.puff(hv.at.x, hv.at.y, 6, 60);
            this.celebrate(hv.node, hv.flip, 1, null);
          }
        }
        if (!this.busy.has(hv.node)) hv.node.visible = show;
      }
    }
  }

  /** 통통 튀기 + 먼지·반짝이 (at이 있으면). amp = 출렁이는 세기. */
  private celebrate(node: Container, sx: number, sy: number, at: Pt | null, amp = 0.13): void {
    this.tweenScale(
      node,
      0.65,
      0,
      (u) => {
        if (node.destroyed) return;
        const a = Math.sin(u * Math.PI * 2.5) * (1 - u) * amp;
        node.scale.set(sx * (1 - a * 0.6), sy * (1 + a));
      },
      ease.linear,
      sx,
      sy,
    );
    if (at !== null) {
      this.fx.puff(at.x, at.y, 9, 150);
      this.fx.sparkles(at.x, at.y - 160, 6, 120);
    }
  }

  /** 짓기 모드가 옮기는 동안 그 건물 그림을 숨긴다 (id = Placed.id, 0 = 다시 보인다). */
  setHidden(id: number): void {
    if (this.hiddenId === id) return;
    this.hiddenId = id;
    this.applyHidden();
    this.sync(false);
  }

  private applyHidden(): void {
    const hide = (n: Container, on: boolean): void => {
      n.renderable = !on;
    };
    for (const b of this.booths) {
      const on = b.placedId === this.hiddenId;
      hide(b.building, on);
      hide(b.pot, on);
      for (const e of b.extras) hide(e, on);
      for (const h of b.hosts) hide(h.node, on);
    }
    for (const bv of this.buildings) {
      const on = bv.placedId === this.hiddenId;
      for (const p of bv.parts) hide(p.node, on);
      if (bv.npc !== null) hide(bv.npc.node, on);
    }
    for (const [id, p] of this.decorNodes) hide(p.node, id === this.hiddenId);
  }

  // ── 바깥에서 부르는 것 ──

  /** WebGL 문맥을 되찾은 뒤: 코드로 구운 텍스처가 없다 (그림 텍스처는 Pixi가 다시 올린다, 구름은 land.ts). */
  restoreTextures(): void {}

  /** 상태가 바뀌었다는 이벤트 (업그레이드·해금·진행자·마을): 바로 맞춘다. */
  refresh(): void {
    this.syncVillage();
    this.sync();
  }

  /** 누른 부스·건물이 살짝 출렁 (눌렀다는 느낌). */
  poke(hit: MapHit): void {
    if (hit.kind === 'booth') {
      for (const b of this.booths) if (b.id === hit.id && !this.busy.has(b.building)) this.celebrate(b.building, b.buildingProp.sx, b.buildingProp.sy, null, 0.05);
    } else {
      for (const bv of this.buildings) if (bv.id === hit.id && !this.busy.has(bv.node)) this.celebrate(bv.node, bv.prop.sx, bv.prop.sy, null, 0.05);
    }
  }

  /** 진행자(와 촌장) 반응: 부스에서 한판이 끝났을 때. */
  hostReact(booth: BoothId, tier: OutcomeTier): void {
    for (const b of this.booths) {
      if (b.id !== booth || (tier !== 'jackpot' && tier !== 'win')) continue;
      for (const hv of b.hosts) {
        if (!hv.node.visible) continue;
        hv.hopT = 0;
        hv.hopK = tier === 'jackpot' ? 1.6 : 0.8;
      }
    }
    if (tier === 'jackpot') this.chiefHopT = 0;
  }

  /** 부스 그림 (단체 놀이 화면이 흔들거나 숨길 때: 보물상자 뚜껑 등은 자기 그림으로). 놓이지 않았으면 null. */
  boothNode(booth: BoothId): ArtNode | null {
    return this.booths.find((b) => b.id === booth)?.building ?? null;
  }

  /** 진행자 자리 role의 그림과 서는 점 (단체 놀이 화면이 진행자 연출을 더할 때, 없으면 null). 진행자가 없으면 node.visible = false. */
  hostNode(booth: BoothId, role: number): { node: ArtNode; at: Pt } | null {
    const hv = this.booths.find((b) => b.id === booth)?.hosts[role];
    return hv === undefined ? null : { node: hv.node, at: hv.at };
  }

  /** 넷째 묶음 건물의 주인 그림과 서는 점 (전당포 주인·은행원·일터 반장, 놓이지 않았으면 null). */
  npcNode(id: BuildingId): { node: ArtNode; at: Pt } | null {
    const hv = this.buildings.find((b) => b.id === id)?.npc ?? null;
    return hv === null ? null : { node: hv.node, at: hv.at };
  }

  /** 넷째 묶음 건물의 주인을 통통 (맡기기·갚기·재료가 나올 때). 없으면 아무것도 안 한다. */
  npcHop(id: BuildingId, k = 1): void {
    const hv = this.buildings.find((b) => b.id === id)?.npc ?? null;
    if (hv === null || !hv.node.visible) return;
    hv.hopT = 0;
    hv.hopK = k;
  }

  /** 건물 그림들 (일터는 시설 둘 + 소품, 그 밖은 하나). 화면 쪽 연출이 흔들 때. */
  buildingParts(id: BuildingId): readonly ArtNode[] {
    return this.buildings.find((b) => b.id === id)?.parts.map((p) => p.node) ?? [];
  }

  /** 전당포 진열창·은행 문 (세계 좌표, 그림 배율·레벨 크기를 따른다): 장신구가 날아 들어가고 코인이 드나드는 곳. */
  shopPort(id: 'pawnshop' | 'bank', out: { x: number; y: number }): void {
    const bv = this.buildings.find((b) => b.id === id);
    const at = this.sim.village().art(id);
    const m = artMeta('map', id);
    if (bv === undefined || m === undefined) {
      out.x = at.x;
      out.y = at.y - 90;
      return;
    }
    const p = SHOP_PORT[id];
    const k = this.sim.village().buildingK(id) ?? ART_SCALE.building;
    // 그림 기준점 = 잘라 낸 그림의 아래 가운데 (ArtNode 'bottom').
    const ax = m.trim.x + m.trim.w / 2;
    const ay = m.trim.y + m.trim.h;
    out.x = bv.node.x + (p.x - ax) * k * bv.node.scale.x;
    out.y = bv.node.y + (p.y - ay) * k * bv.node.scale.y;
  }

  /** 일터 소품 (crop_basket·ore_cart) 위 가운데 (재료가 떨어져 들어가는 곳, 세계 좌표). 없으면 false. */
  yardPropTop(key: string, out: { x: number; y: number }): boolean {
    const part = this.buildings.find((b) => b.id === 'workyard')?.parts.find((p) => p.key === key);
    if (part === undefined) return false;
    const b = nodeBox(part.node, emptyBox());
    out.x = (b.x0 + b.x1) / 2;
    // 그림 위 끝에서 조금 아래 (바구니·수레 입구).
    out.y = b.y0 + (part.node.y - b.y0) * 0.3;
    return true;
  }

  /** 일터 소품이 톡 출렁 (재료가 들어왔을 때). */
  yardPropHop(key: string): void {
    const part = this.buildings.find((b) => b.id === 'workyard')?.parts.find((p) => p.key === key);
    if (part === undefined || !part.node.visible || this.busy.has(part.node)) return;
    this.celebrate(part.node, part.prop.sx, part.prop.sy, null, 0.09);
  }

  /** 일터 반장이 호루라기를 분다 (통통 + 소리 선 + '삑!'). big = 빚 걸기 판을 부를 때. 없으면 아무것도 안 한다. */
  foremanWhistle(big = false): void {
    this.foremanShout(big ? '삐익!' : '삑!', big ? 1.3 : 0.6, true, big);
  }

  /** 반장 통통 + 입 앞 글자 (toot = 호루라기 소리 선도). */
  private foremanShout(text: string, hop: number, toot = false, big = false): void {
    const bv = this.buildings.find((b) => b.id === 'workyard');
    const hv = bv?.npc ?? null;
    if (bv === undefined || hv === null || !hv.node.visible) return;
    hv.hopT = 0;
    hv.hopK = hop;
    const x = bv.patrol?.x ?? hv.at.x;
    const y = bv.patrol?.y ?? hv.at.y;
    const dir = -(bv.patrol?.flip ?? hv.flip);
    // 입: 반장 그림 높이의 약 70% (주민 그림 약 140px).
    const mx = x + dir * 16;
    const my = y - 100;
    if (toot) this.fx.toot(mx + dir * 10, my, dir, big);
    this.fx.floatText(mx + dir * 30, my - 20, text, 'whistle', big);
  }

  /**
   * 반장이 일하는 채무자 (wx, wy)를 다독이러 곁으로 걸어가, 닿으면 호루라기 대신 '힘내!' 하고 run (하트 등)을 부른다.
   * 반장이 없거나 너무 멀면 run을 바로 부른다.
   */
  foremanCheer(wx: number, wy: number, run: () => void): void {
    const bv = this.buildings.find((b) => b.id === 'workyard');
    const pt = bv?.patrol ?? null;
    if (bv === undefined || pt === null || bv.npc === null || !bv.npc.node.visible || Math.hypot(wx - pt.x, wy - pt.y) > 900) {
      run();
      return;
    }
    // 채무자 옆 (반장 쪽에서 다가가 조금 아래에 선다: 손님을 가리지 않게).
    const side = pt.x <= wx ? -1 : 1;
    pt.visit?.run();
    pt.visit = { x: wx + side * 75, y: wy + 14, look: wx, run };
    pt.pause = 0;
  }

  /** 진행자 한 사람만 통통 (경주장 출발 신호·해설자). 그 자리에 진행자가 없으면 아무것도 안 한다. */
  hostHop(booth: BoothId, role: number, k = 1): void {
    for (const b of this.booths) {
      if (b.id !== booth) continue;
      const hv = b.hosts[role];
      if (hv === undefined || !hv.node.visible) return;
      hv.hopT = 0;
      hv.hopK = k;
    }
  }

  /** 항아리 입구 (코인이 튀어나오는 점). */
  potTop(booth: BoothId, out: { x: number; y: number }): void {
    const p = this.sim.village().booth(booth).pot;
    out.x = p.x;
    out.y = p.y - 40;
    for (const b of this.booths) if (b.id === booth) out.y = p.y - (p.y - b.potBox.y0) * 0.8 * b.potScale;
  }

  hitTest(wx: number, wy: number): MapHit | null {
    let best: MapHit | null = null;
    let bestY = -Infinity;
    for (const b of this.booths) {
      const h = b.hit;
      // 진행자를 눌러도 그 부스.
      let onHost = false;
      for (const hv of b.hosts) {
        const hb = hv.prop.box;
        if (hv.node.visible && wx >= hb.x0 + CULL_PAD && wx <= hb.x1 - CULL_PAD && wy >= hb.y0 + CULL_PAD && wy <= hb.y1 - CULL_PAD) onHost = true;
      }
      if ((onHost || (wx >= h.x0 && wx <= h.x1 && wy >= h.y0 && wy <= h.y1)) && b.spot.base.y > bestY) {
        best = { kind: 'booth', id: b.id };
        bestY = b.spot.base.y;
      }
    }
    if (best !== null) return best;
    for (const bv of this.buildings) {
      const h = bv.hit;
      const y = bv.at.y;
      if (wx >= h.x0 && wx <= h.x1 && wy >= h.y0 && wy <= h.y1 && y > bestY) {
        best = { kind: 'building', id: bv.id };
        bestY = y;
      }
    }
    // 그림이 없는 자리 (그림 아래 칸): 칸으로 찾는다.
    if (best === null) {
      const p = this.sim.village().at(Math.floor(wx / CELL), Math.floor(wy / CELL));
      if (p !== undefined && catalogKind(p.key) === 'booth') best = { kind: 'booth', id: p.key as BoothId };
      else if (p !== undefined && catalogKind(p.key) === 'building') best = { kind: 'building', id: p.key as BuildingId };
    }
    return best;
  }

  /** 누른 곳의 놓인 것 (그림 상자 또는 차지한 칸, 장식 포함: 짓기 모드의 옮기기·보관하기 고르기). 없으면 undefined. */
  placedAt(wx: number, wy: number): Placed | undefined {
    const v = this.sim.village();
    const hit = this.hitTest(wx, wy);
    if (hit !== null) return v.placed(hit.id);
    for (const [id, p] of this.decorNodes) {
      const b = p.box;
      if (wx >= b.x0 + CULL_PAD && wx <= b.x1 - CULL_PAD && wy >= b.y0 + CULL_PAD && wy <= b.y1 - CULL_PAD) return v.byId.get(id);
    }
    return v.at(Math.floor(wx / CELL), Math.floor(wy / CELL));
  }

  /** 구름에 덮인 곳인가 (사지 않은 땅). */
  covered(wx: number, wy: number): boolean {
    return !this.sim.village().isOwned(Math.floor(wx / CELL), Math.floor(wy / CELL));
  }

  /** 누른 곳의 사지 않은 땅 조각 번호 (가진 땅이거나 지도 밖이면 -1). */
  chunkAt(wx: number, wy: number): number {
    if (!this.covered(wx, wy)) return -1;
    const cx = Math.floor(wx / (CHUNK * CELL));
    const cy = Math.floor(wy / (CHUNK * CELL));
    return cx < 0 || cy < 0 || cx >= CHUNKS.w || cy >= CHUNKS.h ? -1 : cy * CHUNKS.w + cx;
  }

  /** 놓인 부스·건물인가 (단체 놀이 화면이 놓였을 때만 그린다). */
  placed(key: CatalogKey): boolean {
    return this.sim.village().placed(key) !== undefined;
  }

  /** 일터에 일하거나 기다리는 채무자가 있나 (반장이 오가며 지켜본다). */
  private yardBusy(): boolean {
    const list = this.sim.state.monsters;
    for (let i = 0; i < list.length; i++) {
      const ph = list[i]?.phase;
      if (ph === 'working' || ph === 'waitWork') return true;
    }
    return false;
  }

  /** 반장 한 걸음: 일하는 손님이 있으면 route를 돌고 (닿으면 쉬며 가끔 호루라기), 없으면 집으로 가서 선다. */
  private walkForeman(pt: Patrol, busy: boolean, dt: number): void {
    const home = pt.home;
    if (!busy && !pt.homing) {
      pt.homing = true;
      pt.pause = 0;
    } else if (busy && pt.homing) {
      pt.homing = false;
      pt.pause = Math.max(pt.pause, 0.8);
    }
    const visit = pt.visit;
    const stop = visit !== null || pt.homing ? null : (pt.route[pt.leg % pt.route.length] ?? null);
    const to = visit ?? stop?.at ?? home;
    let moving = false;
    if (pt.pause > 0) pt.pause -= dt;
    else {
      const dx = to.x - pt.x;
      const dy = to.y - pt.y;
      const d = Math.hypot(dx, dy);
      const step = FOREMAN_SPEED * dt;
      if (d <= step) {
        pt.x = to.x;
        pt.y = to.y;
        if (visit !== null) {
          // 다독이기: 채무자를 보고 통통 + '힘내!'.
          pt.visit = null;
          pt.pause = 1.6;
          pt.flip = visit.look <= pt.x ? 1 : -1;
          this.foremanShout('힘내!', 0.9);
          visit.run();
        } else if (stop !== null) {
          pt.pause = stop.pause;
          pt.leg = (pt.leg + 1) % pt.route.length;
          pt.flip = stop.look.x <= pt.x ? 1 : -1;
          if (Math.random() < stop.whistle) this.foremanWhistle(false);
        } else {
          pt.pause = 1;
          pt.flip = pt.face.x <= pt.x ? 1 : -1;
        }
      } else {
        moving = true;
        pt.x += (dx / d) * step;
        pt.y += (dy / d) * step;
        pt.phase += (step / FOREMAN_STRIDE) * Math.PI;
        // 그림은 왼쪽을 본다: 오른쪽으로 가면 뒤집는다.
        if (Math.abs(dx) > 4) pt.flip = dx < 0 ? 1 : -1;
      }
    }
    pt.walk += ((moving ? 1 : 0) - pt.walk) * follow(10, dt);
  }

  // ── 매 프레임 ──

  update(dt: number, view: ViewRect): void {
    this.time += dt;
    const t = this.time;
    this.syncVillage();
    this.sync();

    const st = this.sim.state;
    for (let i = 0; i < this.booths.length; i++) {
      const b = this.booths[i] as BoothView;
      const bs = st.booths[b.id];
      if (bs === undefined) continue;
      // 항아리: 항아리 비율에 따라 0.8~1.25배, 코인이 들어오고 나가면 살짝 출렁.
      if (b.pot.visible && !this.busy.has(b.pot)) {
        const caps = BOOTHS[b.id].potCap;
        const cap = caps[clamp(bs.level, 1, caps.length) - 1] ?? caps[0];
        const fill = clamp(bs.pot / Math.max(1, cap), 0, 1);
        const target = b.potOnCounter ? 1.05 + 0.25 * fill : 0.8 + 0.45 * fill;
        if (b.potShown >= 0 && bs.pot !== b.potShown) b.potJiggle = 1;
        b.potShown = bs.pot;
        b.potScale += (target - b.potScale) * follow(3, dt);
        b.potJiggle = Math.max(0, b.potJiggle - dt * 2.2);
        const j = Math.sin(t * 28) * 0.07 * b.potJiggle;
        b.pot.scale.set(b.potScale * (1 - j * 0.6), b.potScale * (1 + j));
      }
      // 진행자: 숨쉬기와 기뻐 뛰기.
      for (let r = 0; r < b.hosts.length; r++) {
        const hv = b.hosts[r] as HostSlot;
        if (!hv.node.visible || this.busy.has(hv.node)) continue;
        let dy = 0;
        if (hv.hopT >= 0) {
          hv.hopT += dt;
          const u = hv.hopT / 0.45;
          if (u >= 1) hv.hopT = -1;
          else dy = -Math.sin(Math.PI * u) * 18 * hv.hopK;
        }
        const br = Math.sin(t * 2.1 + hv.breath) * 0.012;
        hv.node.scale.set(hv.flip * (1 - br * 0.5), 1 + br);
        hv.node.y = hv.at.y + dy;
      }
    }
    // 넷째 묶음 건물의 주인: 숨쉬기 (일터 반장은 걷기).
    let working = -1;
    for (let i = 0; i < this.buildings.length; i++) {
      const bv = this.buildings[i] as BuildingView;
      const hv = bv.npc;
      if (hv === null || !hv.node.visible || this.busy.has(hv.node)) continue;
      let dy = 0;
      if (hv.hopT >= 0) {
        hv.hopT += dt;
        const u = hv.hopT / 0.45;
        if (u >= 1) hv.hopT = -1;
        else dy = -Math.sin(Math.PI * u) * 18 * hv.hopK;
      }
      const pt = bv.patrol;
      if (pt !== null) {
        if (working < 0) working = this.yardBusy() ? 1 : 0;
        this.walkForeman(pt, working === 1, dt);
        const bob = Math.abs(Math.sin(pt.phase)) * 5 * pt.walk;
        const br = Math.sin(t * 2.0 + hv.breath) * 0.012 * (1 - pt.walk);
        hv.node.scale.set(pt.flip * (1 - br * 0.5), 1 + br);
        hv.node.rotation = Math.sin(pt.phase) * 0.05 * pt.walk;
        hv.node.position.set(pt.x, pt.y + dy - bob);
        if (hv.node.zIndex !== Math.round(pt.y)) hv.node.zIndex = Math.round(pt.y);
        if (pt.walk > 0.01) nodeBox(hv.node, hv.prop.box, 0, CULL_PAD);
        continue;
      }
      const br = Math.sin(t * 2.0 + hv.breath) * 0.012;
      hv.node.scale.set(hv.flip * (1 - br * 0.5), 1 + br);
      hv.node.y = hv.at.y + dy;
    }
    // 촌장: 숨쉬기, 대박이 나면 통통.
    const chief = this.chief;
    if (chief !== null && !this.busy.has(chief)) {
      let dy = 0;
      if (this.chiefHopT >= 0) {
        this.chiefHopT += dt;
        const u = this.chiefHopT / 0.9;
        if (u >= 1) this.chiefHopT = -1;
        else dy = -Math.abs(Math.sin(Math.PI * 2 * u)) * 16;
      }
      const br = Math.sin(t * 1.9) * 0.012;
      chief.scale.set(1 - br * 0.5, 1 + br);
      chief.y = this.chiefAt.y + dy;
    }

    // 길이 없어요: 살짝 통통.
    for (const m of this.marks) {
      m.node.culled = !boxHits(m.box, view);
      m.node.y = m.at.y - 70 - Math.abs(Math.sin(t * 2.4)) * 8;
    }

    // 화면 밖 소품은 그리지 않는다.
    for (let i = 0; i < this.props.length; i++) {
      const p = this.props[i] as Prop;
      p.node.culled = !boxHits(p.box, view);
    }
  }

  destroy(): void {
    this.clearInstances();
    for (const m of this.marks) m.node.destroy({ children: true });
    this.marks = [];
    this.busy.clear();
  }
}
