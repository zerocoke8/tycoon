// 지도 위 건물·놀이부스·장식 소품·진행자·촌장·빈 부지, 그리고 닫힌 구역을 덮는 구름.
// sim 상태와 매 프레임 비교해서 바뀐 것만 고친다 (이벤트를 놓쳐도, 새 게임으로 되돌려도 맞는다).
// 바뀔 때의 연출: 업그레이드·해금·진행자 바뀜 = 통통 + 먼지, 구역 열림 = 구름이 흩어지고 소품이 톡 나타난다.
// 구름은 구역 사각형에 붙여 깔고(바깥으로 조금만 삐져나옴), 물체층 안에서 구역 아래 변의 y로 정렬한다:
// 구역 바로 아래에 선 키 큰 건물(예: 북쪽 언덕 아래 마을회관 지붕)이 구름에 가리지 않고 앞에 선다.
// 바닥에 깔리는 부스 그림·소품(map.ts BoothSpot.flat·props[].flat: 씨름 모래판, 오리배 선착장, 보물찾기 흙더미)은 바닥층(floor)에 그린다: 손님이 그 위에 선다.
// 넷째 묶음 (DESIGN 3.7): 전당포·은행 (BUILDING_K 배율)과 일터 (WORK_YARD: 밭 = 바닥층, 광산·소품)는 짓기 전(레벨 0)엔 흐린 그림 + 빈 부지 표식,
// 지으면 주인(전당포 주인·은행원·일터 반장, map.ts SHOP_SPOTS·WORK_YARD.foreman)이 선다.
// 일터 반장은 일하는 채무자가 있으면 밭 고랑 사이·광산 앞을 오가며 (FOREMAN_ROUTE) 가끔 호루라기를 분다 (foremanWhistle).
// 장신구·코인이 드나드는 전당포 진열창·은행 문은 shopPort, 재료가 들어가는 바구니·수레는 yardPropTop·yardPropHop.

import { Container, Graphics, Sprite, type Renderer, type Texture } from 'pixi.js';
import { BOOTHS, BOOTH_IDS, BUILD_HALL, WORK_FACILITIES, type BoothId, type BuildingId, type OutcomeTier } from '../data/defs.ts';
import { BOOTH_SPOTS, BUILDING_K, BUILDING_SPOTS, CHIEF_SPOT, DECOR, DISTRICTS, SHOP_SPOTS, SPARE_LOTS, WORK_YARD, type BoothSpot, type District, type DistrictId, type Pt } from '../data/map.ts';
import { Rng } from '../core/rng.ts';
import { ease, tweens } from '../core/tween.ts';
import type { SimApi } from '../sim/api.ts';
import { ART_SCALE, ArtNode, artMeta, artTexture, hasArt } from './art.ts';
import type { FxLayer } from './fx.ts';
import { DISTRICT_IDS, RACE_GATE_FLIP, boxHits, clamp, districtAt, follow, onGrass, type Box, type ViewRect } from './mapUtil.ts';

const OUTLINE = 0x402c1c;
const CLOUD_FILL = 0xf4f1ea;
const CLOUD_SHADE = 0xe4e1da;
/** 닫힌 부스(빈 부지)의 흐린 건물. */
const LOCKED_ALPHA = 0.35;
/** 가려 내기 상자 여유 (항아리가 커지고 소품이 통통 튀어도 잘리지 않게). */
const CULL_PAD = 40;
/** 구름이 구역 밖으로 삐져나오는 정도 (세계 px). */
const CLOUD_OVERHANG = 60;

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

/** 촌장이 서 있는 곳 (map.ts). */
const CHIEF_AT: Pt = CHIEF_SPOT;

/** 전당포 진열창·은행 문 (그림 캔버스 좌표): 맡긴 장신구가 날아 들어가고 코인이 나오는 곳. 그림이 없으면 건물 자리 위. */
const SHOP_PORT: Record<'pawnshop' | 'bank', Pt> = { pawnshop: { x: 587, y: 779 }, bank: { x: 468, y: 739 } };

/**
 * 일터 반장이 오가는 길 (WORK_YARD에서 정한다): 집(반장 자리) → 밭 고랑 사이 동쪽 → 서쪽 → 동쪽 → 집 → 광산 앞 → 집.
 * pause = 닿고 쉬는 초, whistle = 거기서 호루라기를 불 확률, look = 쉴 때 바라보는 곳.
 */
interface PatrolStop {
  readonly at: Pt;
  readonly pause: number;
  readonly whistle: number;
  readonly look: Pt;
}
const FOREMAN_ROUTE: readonly PatrolStop[] = (() => {
  const farm = WORK_YARD.facilities.farm;
  const mine = WORK_YARD.facilities.mine;
  const xs = farm.spots.map((p) => p.x);
  const ys = farm.spots.map((p) => p.y);
  // 밭 고랑 사이 = 일하는 자리 두 줄의 가운데 높이.
  const aisle = (Math.min(...ys) + Math.max(...ys)) / 2;
  // 고랑 양 끝 (일하는 손님을 가리지 않게 자리 줄 밖에서 쉰다).
  const east = { x: Math.max(...xs) + 95, y: aisle };
  const west = { x: Math.min(...xs) - 95, y: aisle };
  const my = Math.max(...mine.spots.map((p) => p.y));
  const mx = mine.spots.reduce((a, p) => a + p.x, 0) / Math.max(1, mine.spots.length);
  const home = WORK_YARD.foreman;
  return [
    { at: east, pause: 1.2, whistle: 0.2, look: farm.face },
    { at: west, pause: 2.4, whistle: 0.45, look: { x: east.x, y: aisle } },
    { at: east, pause: 1.0, whistle: 0, look: farm.face },
    { at: home, pause: 2.2, whistle: 0.25, look: farm.face },
    { at: { x: mx, y: my + 70 }, pause: 2.4, whistle: 0.45, look: mine.face },
    { at: home, pause: 2.6, whistle: 0, look: farm.face },
  ];
})();
/** 반장 걷는 빠르기 (세계 px/초)와 걸음 폭. */
const FOREMAN_SPEED = 85;
const FOREMAN_STRIDE = 26;
/** 나무를 더 흩뿌리는 숲 구역 (map.ts 머리말). 없으면 건너뛴다. */
const FOREST_DISTRICT = 'west';

interface Prop {
  readonly node: Container;
  readonly box: Box;
  readonly district: DistrictId | null;
  /** 톡 나타날 때 돌아갈 기본 배율. */
  sx: number;
  sy: number;
}

/** 진행자 자리 하나 (BOOTHS[b].roles와 같은 순서, 지도 BoothSpot.hosts의 점에 선다). */
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
  readonly spot: BoothSpot;
  readonly district: DistrictId | null;
  readonly building: ArtNode;
  readonly lot: ArtNode;
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

/** 일터 반장의 걷기 (집 = WORK_YARD.foreman, FOREMAN_ROUTE를 돈다). */
interface Patrol {
  x: number;
  y: number;
  /** 다음에 갈 FOREMAN_ROUTE index (일하는 손님이 없으면 집으로). */
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
}

interface BuildingView {
  readonly id: BuildingId;
  /** 대표 그림 (일터는 첫 시설). 레벨에 따라 배율이 조금 커진다 (일터는 그대로). */
  readonly node: ArtNode;
  readonly prop: Prop;
  /** 같이 흐려지고 같이 통통 튀는 그림 (전당포·은행 = 그림 하나, 일터 = 시설 둘 + 소품). key = 그림 이름. */
  readonly parts: readonly { readonly node: ArtNode; readonly prop: Prop; readonly key: string }[];
  /** 짓기 전(레벨 0) 빈 부지 표식 (처음부터 있는 건물은 null). */
  readonly lot: ArtNode | null;
  /** 주인 (전당포 주인·은행원·일터 반장, 지으면 선다). */
  readonly npc: HostSlot | null;
  /** 일터 반장의 걷기 (그 밖은 null). */
  readonly patrol: Patrol | null;
  readonly hit: Box;
  readonly district: DistrictId | null;
  level: number;
}

interface Cloud {
  readonly sp: Sprite;
  readonly bx: number;
  readonly by: number;
  readonly ph: number;
  readonly box: Box;
  readonly s: number;
  readonly flip: number;
  /** 흩어질 방향 (단위 벡터)과 늦춤. */
  readonly dx: number;
  readonly dy: number;
  readonly delay: number;
}

interface CloudGroup {
  readonly id: DistrictId;
  readonly node: Container;
  readonly fill: Graphics;
  readonly fillBox: Box;
  readonly clouds: Cloud[];
  opening: boolean;
  openT: number;
  dead: boolean;
}

export type MapHit = { readonly kind: 'booth'; readonly id: BoothId } | { readonly kind: 'building'; readonly id: BuildingId };

export interface BuildingLayers {
  /** y로 정렬되는 물체층 (구름 묶음도 여기에 zIndex = 구역 아래 변으로 들어간다). */
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

/** 진행자 자리 role (map.ts BoothSpot.hosts): 자리 0을 바라본다. sim도 앉은 손님이 0번 진행자의 점을 보게 한다. */
function hostSpot(spot: BoothSpot, role: number): { at: Pt; flip: number } {
  const s0 = spot.seats[0] ?? spot.base;
  const at = spot.hosts[role] ?? spot.hosts[0] ?? spot.base;
  // 그림은 왼쪽을 본다: 진행자가 자리 오른쪽에 서면 그대로, 왼쪽이면 뒤집는다.
  return { at, flip: at.x >= s0.x ? 1 : -1 };
}

/** 구름 그림이 없을 때 코드로 그린 구름 (테두리 먼저, 속 나중 → 바깥 테두리만 남는다). */
function drawCloud(): Graphics {
  const g = new Graphics();
  const bumps: readonly (readonly [number, number, number])[] = [
    [0, 0, 150],
    [-150, 30, 112],
    [152, 28, 116],
    [-78, -72, 106],
    [86, -76, 110],
    [-238, 72, 78],
    [240, 70, 82],
    [0, 86, 120],
    [-120, 100, 90],
    [125, 98, 92],
  ];
  for (const [x, y, r] of bumps) g.circle(x, y, r).stroke({ color: OUTLINE, width: 16 });
  for (const [x, y, r] of bumps) g.circle(x, y, r).fill(CLOUD_FILL);
  // 아래쪽 조금 더 회색인 덩어리와 안쪽 짧은 곡선 둘.
  g.circle(-150, 104, 58).fill(CLOUD_SHADE);
  g.circle(150, 102, 60).fill(CLOUD_SHADE);
  g.circle(0, 146, 60).fill(CLOUD_SHADE);
  g.arc(-60, 10, 60, Math.PI * 1.1, Math.PI * 1.6).stroke({ color: OUTLINE, width: 7, cap: 'round' });
  g.arc(120, 40, 50, Math.PI * 1.15, Math.PI * 1.55).stroke({ color: OUTLINE, width: 7, cap: 'round' });
  return g;
}

export class BuildingsView {
  private readonly sim: SimApi;
  private readonly layers: BuildingLayers;
  private readonly fx: FxLayer;
  private readonly props: Prop[] = [];
  private readonly booths: BoothView[] = [];
  private readonly buildings: BuildingView[] = [];
  private readonly cloudGroups: CloudGroup[] = [];
  private readonly districtOpen = new Map<DistrictId, boolean>();
  /** 트윈이 배율을 쥐고 있는 노드와 그 트윈 번호 (그동안 숨쉬기 같은 매 프레임 배율을 쉰다). */
  private readonly busy = new Map<Container, number>();
  private tweenGen = 0;
  private cloudTex: Texture;
  private readonly ownCloudTex: boolean;
  private readonly renderer: Renderer;
  private readonly chief: ArtNode;
  private chiefHopT = -1;
  private initialized = false;
  private time = 0;

  constructor(sim: SimApi, layers: BuildingLayers, fx: FxLayer, renderer: Renderer) {
    this.sim = sim;
    this.layers = layers;
    this.fx = fx;
    this.renderer = renderer;

    const art = artTexture('map', 'cloud_puff');
    if (art !== undefined) {
      this.cloudTex = art;
      this.ownCloudTex = false;
    } else {
      const g = drawCloud();
      this.cloudTex = renderer.generateTexture({ target: g, resolution: 1, antialias: true });
      g.destroy();
      this.ownCloudTex = true;
    }

    // 건물 (넷째 묶음 건물은 짓기 전 흐리게 + 빈 부지 표식, 지으면 주인이 선다)
    for (const id of Object.keys(BUILDING_SPOTS) as BuildingId[]) {
      const at = BUILDING_SPOTS[id];
      const parts: { node: ArtNode; prop: Prop; key: string }[] = [];
      const put = (key: string, p: Pt, k: number, flat: boolean, ph: { w: number; h: number; color: number }, flip = false): void => {
        const node = new ArtNode({ k, anchor: 'bottom', placeholder: ph });
        node.setArt('map', key);
        node.position.set(p.x, p.y);
        node.zIndex = flat ? FLAT_Z : p.y;
        if (flip) node.scale.x = -1;
        this.floorOf(flat).addChild(node);
        parts.push({ node, prop: this.addProp(node, p), key });
      };
      if (id === 'workyard') {
        for (const f of WORK_FACILITIES) {
          const fs = WORK_YARD.facilities[f];
          put(fs.art, fs.at, fs.k, fs.flat, FACILITY_PH[fs.art] ?? BUILDING_PH);
        }
        for (const pr of WORK_YARD.props) put(pr.key, pr.at, pr.k, false, PROP_PH[pr.key] ?? { w: 400, h: 300, color: 0xa0703f }, pr.flip === true);
      } else {
        put(id, at, BUILDING_K[id] ?? ART_SCALE.building, false, BUILDING_PH);
      }
      const first = parts[0] as { node: ArtNode; prop: Prop; key: string };
      let lot: ArtNode | null = null;
      if (BUILD_HALL[id] !== undefined) {
        lot = new ArtNode({ k: ART_SCALE.prop, anchor: 'bottom', placeholder: PROP_PH.lot_sign });
        lot.setArt('map', 'lot_sign');
        lot.position.set(at.x, at.y + 30);
        lot.zIndex = at.y + 30;
        lot.visible = false;
        layers.objects.addChild(lot);
        this.addProp(lot, at);
      }
      const npc = this.npcSlot(id);
      const hit = emptyBox();
      this.buildingHit(parts, lot, hit);
      const patrol: Patrol | null =
        id === 'workyard' && npc !== null ? { x: npc.at.x, y: npc.at.y, leg: 0, pause: 1, flip: npc.flip, walk: 0, phase: 0, homing: true, visit: null } : null;
      this.buildings.push({ id, node: first.node, prop: first.prop, parts, lot, npc, patrol, hit, district: districtAt(at.x, at.y), level: -1 });
    }

    // 놀이부스: 건물, 빈 부지 표식, 상금 항아리, 진행자
    for (const id of BOOTH_IDS) {
      const spot = BOOTH_SPOTS[id];
      const flat = spot.flat === true;
      const building = new ArtNode({ k: spot.buildingK ?? ART_SCALE.booth, anchor: 'bottom', placeholder: flat ? FLAT_PH : BUILDING_PH });
      building.setArt('map', BOOTHS[id].building);
      building.position.set(spot.base.x, spot.base.y);
      building.zIndex = flat ? FLAT_Z : spot.base.y;
      const lot = new ArtNode({ k: ART_SCALE.prop, anchor: 'bottom', placeholder: PROP_PH.lot_sign });
      lot.setArt('map', 'lot_sign');
      lot.position.set(spot.base.x, spot.base.y + 30);
      lot.zIndex = spot.base.y + 30;
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
      layers.objects.addChild(lot, pot);
      const buildingProp = this.addProp(building, spot.base);
      this.addProp(lot, spot.base);
      this.addProp(pot, spot.pot);
      // 진행자 자리마다 한 사람 (경주장은 셋).
      const hosts: HostSlot[] = BOOTHS[id].roles.map((_, role) => {
        const hs = hostSpot(spot, role);
        const node = new ArtNode({ k: ART_SCALE.villager, anchor: 'bottom', placeholder: PERSON_PH });
        node.position.set(hs.at.x, hs.at.y);
        node.zIndex = hs.at.y;
        node.scale.x = hs.flip;
        node.visible = false;
        layers.objects.addChild(node);
        return { node, prop: this.addProp(node, hs.at), at: hs.at, flip: hs.flip, art: '', breath: Math.random() * 6, hopT: -1, hopK: 1 };
      });
      // 같이 놓는 그림 (경주장 출발대·결승선). 출발대는 칸 색이 레인 순서와 맞게 뒤집기도 한다 (mapUtil RACE_GATE_FLIP).
      const extras = (spot.props ?? []).map((p) => {
        const node = new ArtNode({ k: p.k, anchor: 'bottom', placeholder: p.flat === true ? { w: 500, h: 220, color: 0xb88a5a } : { w: 600, h: 500, color: 0xa0703f } });
        node.setArt('map', p.key);
        node.position.set(p.at.x, p.at.y);
        node.zIndex = p.flat === true ? FLAT_Z : p.at.y;
        if (p.key === 'race_gate' && RACE_GATE_FLIP) node.scale.x = -1;
        this.floorOf(p.flat === true).addChild(node);
        this.addProp(node, p.at);
        return node;
      });
      const view: BoothView = {
        id, spot, district: districtAt(spot.base.x, spot.base.y), building, lot, pot, hosts, extras, buildingProp, hit: emptyBox(), potBox: emptyBox(),
        unlocked: false, level: 0, potShown: -1, potScale: 1, potJiggle: 0, potOnCounter,
      };
      this.booths.push(view);
      this.boothHit(view);
    }

    // 촌장
    this.chief = new ArtNode({ k: ART_SCALE.villager, anchor: 'bottom', placeholder: PERSON_PH });
    this.chief.setArt('characters', 'chief');
    this.chief.position.set(CHIEF_AT.x, CHIEF_AT.y);
    this.chief.zIndex = CHIEF_AT.y;
    layers.objects.addChild(this.chief);
    this.addProp(this.chief, CHIEF_AT);

    // 장식 소품, 숲, 빈 부지
    for (const d of DECOR) this.addDecor(d.key, d.at, d.flip === true);
    this.scatterForest();
    for (const l of SPARE_LOTS) this.addDecor('lot_sign', l.at, false);

    this.sync();
    this.initialized = true;
  }

  /** 넷째 묶음 건물의 주인 (전당포 주인·은행원: 계산대를 본다, 일터 반장: 밭을 본다). 없으면 null. */
  private npcSlot(id: BuildingId): HostSlot | null {
    let at: Pt;
    let look: Pt;
    let art: string;
    if (id === 'pawnshop' || id === 'bank') {
      const sh = SHOP_SPOTS[id];
      at = sh.npc;
      look = sh.counter[0] ?? BUILDING_SPOTS[id];
      art = sh.art;
    } else if (id === 'workyard') {
      at = WORK_YARD.foreman;
      look = WORK_YARD.facilities.farm.face;
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
    return { node, prop: this.addProp(node, at), at, flip, art, breath: Math.random() * 6, hopT: -1, hopK: 1 };
  }

  /** 건물 누르기 상자: 그림들(과 빈 부지 표식)을 합친 상자. */
  private buildingHit(parts: readonly { readonly node: ArtNode }[], lot: ArtNode | null, out: Box): void {
    let first = true;
    for (const p of parts) {
      const b = nodeBox(p.node, emptyBox(), 0.08);
      if (first) Object.assign(out, b);
      else unionBox(out, b);
      first = false;
    }
    if (lot !== null) unionBox(out, nodeBox(lot, emptyBox()));
  }

  /** 바닥에 깔리는 그림은 바닥층에 (없으면 물체층 맨 아래). */
  private floorOf(flat: boolean): Container {
    return flat ? (this.layers.floor ?? this.layers.objects) : this.layers.objects;
  }

  private addProp(node: Container, at: Pt): Prop {
    // 손으로 가려 내지만(culled), Pixi CullerPlugin이 붙어 있어도 같은 답이 나오게 cullable도 켠다.
    node.cullable = true;
    node.cullableChildren = false;
    const p: Prop = { node, box: nodeBox(node, emptyBox(), 0, CULL_PAD), district: districtAt(at.x, at.y), sx: node.scale.x, sy: node.scale.y };
    this.props.push(p);
    return p;
  }

  private addDecor(key: string, at: Pt, flip: boolean): void {
    const node = new ArtNode({ k: ART_SCALE.prop, anchor: 'bottom', placeholder: PROP_PH[key] ?? { w: 400, h: 400 } });
    node.setArt('map', key);
    node.position.set(at.x, at.y);
    node.zIndex = at.y;
    if (flip) node.scale.x = -1;
    this.layers.objects.addChild(node);
    this.addProp(node, at);
  }

  /** 숲 동네에 나무를 씨앗 난수로 더 흩뿌린다 (map.ts 머리말). 길·부지·다른 소품을 피한다. */
  private scatterForest(): void {
    const forest = (DISTRICTS as Partial<Record<string, District>>)[FOREST_DISTRICT];
    if (forest === undefined) return;
    const r = forest.rect;
    const rng = new Rng(0x5eed7);
    const placed: Pt[] = DECOR.map((d) => d.at).concat(SPARE_LOTS.map((l) => l.at));
    // 놀이부스 둘레도 비운다 (부스 그림 폭 약 420, 높이 약 380 + 자리·줄·진행자·항아리).
    for (const id of BOOTH_IDS) {
      const s = BOOTH_SPOTS[id];
      for (let dx = -220; dx <= 220; dx += 110) for (let dy = -360; dy <= 0; dy += 90) placed.push({ x: s.base.x + dx, y: s.base.y + dy });
      placed.push(...s.seats, ...s.queue, ...s.hosts, s.pot, ...(s.props ?? []).map((p) => p.at));
    }
    const want = Math.round((r.w * r.h) / 70000);
    let made = 0;
    for (let tries = 0; tries < want * 8 && made < want; tries++) {
      const x = r.x + 50 + rng.next() * (r.w - 100);
      const y = r.y + 60 + rng.next() * (r.h - 80);
      if (!onGrass(x, y, 50)) continue;
      let ok = true;
      for (const p of placed) {
        const dx = p.x - x;
        const dy = p.y - y;
        if (dx * dx + dy * dy < 120 * 120) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      placed.push({ x, y });
      this.addDecor(rng.chance(0.65) ? 'tree_pine' : 'tree_round', { x, y }, rng.chance(0.5));
      made++;
    }
  }

  private boothHit(b: BoothView): void {
    nodeBox(b.building, b.hit, 0.08);
    nodeBox(b.pot, b.potBox);
    unionBox(b.hit, b.potBox);
    unionBox(b.hit, nodeBox(b.lot, emptyBox()));
  }

  // ── 구름 ──

  private buildClouds(id: DistrictId): CloudGroup {
    const rect = DISTRICTS[id].rect;
    const node = new Container();
    node.eventMode = 'none';
    node.zIndex = rect.y + rect.h;
    const M = CLOUD_OVERHANG;
    // 구름 사이로 땅이 비치지 않게 구름 덩어리마다 그 밑에 구름 색 타원을 깐다 (덩어리보다 작아서 곧은 모서리가 밖으로 나오지 않는다).
    const fill = new Graphics();
    node.addChild(fill);
    const tex = this.cloudTex;
    const aspect = tex.height / Math.max(1, tex.width);
    // 구름 폭: 구역의 짧은 변 + 양쪽 삐짐 (ART_SCALE.cloud 크기와 1100이 상한).
    const cw = clamp(Math.min(rect.w, rect.h) + 2 * M, 360, Math.min(1100, tex.width * ART_SCALE.cloud * 2));
    const ch = cw * aspect;
    const rangeX = rect.w + 2 * M - cw;
    const rangeY = rect.h + 2 * M - ch;
    const cols = rangeX <= 0 ? 1 : Math.ceil(rangeX / (cw * 0.5)) + 1;
    const rows = rangeY <= 0 ? 1 : Math.ceil(rangeY / (ch * 0.42)) + 1;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const rng = new Rng((0xc10d ^ Math.round(rect.x * 7 + rect.y * 13 + rect.w)) | 0);
    const clouds: Cloud[] = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        let fx = cols === 1 ? 0.5 : i / (cols - 1);
        const fy = rows === 1 ? 0.5 : j / (rows - 1);
        if (cols > 1 && j % 2 === 1) fx = clamp(fx + 0.5 / (cols - 1), 0, 1);
        const jx = (rng.next() - 0.5) * Math.min(40, cw * 0.06);
        const jy = (rng.next() - 0.5) * ch * 0.15;
        const bx = rangeX <= 0 ? cx + jx : rect.x - M + cw / 2 + rangeX * fx + jx;
        const by = rangeY <= 0 ? cy + jy : rect.y - M + ch / 2 + rangeY * fy + jy;
        const sp = new Sprite(tex);
        sp.anchor.set(0.5);
        sp.cullable = true;
        fill.ellipse(bx, by, cw * 0.36, ch * 0.3).fill(CLOUD_FILL);
        const s = (cw / tex.width) * (0.92 + rng.next() * 0.08);
        const flip = rng.chance(0.5) ? -1 : 1;
        sp.scale.set(flip * s, s);
        sp.position.set(bx, by);
        node.addChild(sp);
        let dx = bx - cx;
        let dy = by - cy;
        if (dx * dx + dy * dy < 1) {
          dx = rng.next() - 0.5;
          dy = -0.5;
        }
        const len = Math.sqrt(dx * dx + dy * dy);
        const hw = (tex.width * s) / 2 + 30;
        const hh = (tex.height * s) / 2 + 30;
        clouds.push({ sp, bx, by, ph: rng.next() * Math.PI * 2, s, flip, dx: dx / len, dy: dy / len, delay: rng.next() * 0.45, box: { x0: bx - hw, y0: by - hh, x1: bx + hw, y1: by + hh } });
      }
    }
    this.layers.objects.addChild(node);
    return { id, node, fill, fillBox: { x0: rect.x, y0: rect.y, x1: rect.x + rect.w, y1: rect.y + rect.h }, clouds, opening: false, openT: 0, dead: false };
  }

  private cloudGroup(id: DistrictId): CloudGroup | undefined {
    for (const g of this.cloudGroups) if (g.id === id && !g.dead) return g;
    return undefined;
  }

  private dropCloudGroup(g: CloudGroup): void {
    g.dead = true;
    g.node.destroy({ children: true });
    const i = this.cloudGroups.indexOf(g);
    if (i >= 0) this.cloudGroups.splice(i, 1);
  }

  private setDistrict(id: DistrictId, open: boolean, animate: boolean): void {
    this.districtOpen.set(id, open);
    const group = this.cloudGroup(id);
    if (!open) {
      if (group !== undefined && group.opening) this.dropCloudGroup(group);
      if (group === undefined || group.opening) this.cloudGroups.push(this.buildClouds(id));
    } else if (group !== undefined) {
      if (animate) {
        group.opening = true;
        group.openT = 0;
      } else {
        this.dropCloudGroup(group);
      }
    }
    // 그 구역 소품: 열리면 보이고(구름이 걷힐 즈음 톡), 닫히면 숨긴다.
    let n = 0;
    for (const p of this.props) {
      if (p.district !== id) continue;
      if (!open) p.node.visible = false;
      else if (animate) this.popIn(p, 0.6 + n++ * 0.035);
      else p.node.visible = this.visibleByState(p.node);
    }
  }

  private popIn(p: Prop, delay: number): void {
    const node = p.node;
    if (!this.visibleByState(node)) return;
    node.visible = true;
    node.scale.set(0.001);
    this.tweenScale(node, 0.45, delay, (t) => node.scale.set(p.sx * t, p.sy * t), ease.outBack, p.sx, p.sy);
  }

  /** 상태 때문에 숨겨 둔 것(닫힌 부스의 항아리, 진행자 없음)은 구역이 열려도 숨긴 채로. */
  private visibleByState(node: Container): boolean {
    for (const bv of this.buildings) {
      if (node === bv.lot) return bv.level < 1;
      if (bv.npc !== null && node === bv.npc.node) return bv.level >= 1;
    }
    for (const b of this.booths) {
      if (node === b.pot) return b.unlocked;
      if (node === b.lot) return !b.unlocked;
      for (const h of b.hosts) if (node === h.node) return h.art !== '' && b.unlocked;
    }
    return true;
  }

  private isOpen(d: DistrictId | null): boolean {
    return d === null || this.districtOpen.get(d) !== false;
  }

  private tweenScale(node: Container, sec: number, delay: number, step: (t: number) => void, e: (t: number) => number, sx: number, sy: number): void {
    tweens.cancel(node);
    const gen = ++this.tweenGen;
    this.busy.set(node, gen);
    void tweens.run(sec, step, { ease: e, delay, owner: node }).then(() => {
      // 멈춘 트윈(cancel)도 여기로 온다: 더 새 트윈이 쥐고 있으면 손대지 않는다.
      if (this.busy.get(node) !== gen) return;
      this.busy.delete(node);
      node.scale.set(sx, sy);
    });
  }

  /** 트윈을 멈추고 배율을 바로 정한다. */
  private setScaleNow(node: Container, sx: number, sy: number): void {
    tweens.cancel(node);
    this.busy.delete(node);
    node.scale.set(sx, sy);
  }

  // ── 상태 맞추기 ──

  private sync(): void {
    const st = this.sim.state;
    const animate = this.initialized;
    for (let i = 0; i < DISTRICT_IDS.length; i++) {
      const d = DISTRICT_IDS[i] as DistrictId;
      const open = st.districts.includes(d);
      if (this.districtOpen.get(d) !== open) this.setDistrict(d, open, animate && open);
    }
    for (let i = 0; i < this.buildings.length; i++) {
      const bv = this.buildings[i] as BuildingView;
      const lvl = st.buildings[bv.id]?.level ?? 1;
      if (lvl === bv.level) continue;
      // 지었다 (0 → 1) 또는 레벨이 올랐다.
      const built = animate && bv.level === 0 && lvl >= 1;
      const up = animate && bv.level > 0 && lvl > bv.level;
      bv.level = lvl;
      const open = this.isOpen(bv.district);
      // 짓기 전: 흐린 그림 + 빈 부지 표식, 주인은 없다.
      for (const p of bv.parts) p.node.alpha = lvl >= 1 ? 1 : LOCKED_ALPHA;
      if (bv.lot !== null) bv.lot.visible = lvl < 1 && open;
      if (bv.npc !== null && !this.busy.has(bv.npc.node)) bv.npc.node.visible = lvl >= 1 && open;
      // 레벨마다 조금 커진다 (일터는 시설이 여럿이라 그대로).
      const s = bv.id === 'workyard' ? 1 : 1 + 0.04 * Math.max(0, lvl - 1);
      if (bv.id !== 'workyard') {
        this.setScaleNow(bv.node, s, s);
        bv.prop.sx = s;
        bv.prop.sy = s;
        nodeBox(bv.node, bv.prop.box, 0, CULL_PAD);
      }
      this.buildingHit(bv.parts, bv.level < 1 ? bv.lot : null, bv.hit);
      if (built) {
        for (const p of bv.parts) this.celebrate(p.node, p.prop.sx, p.prop.sy, null);
        this.fx.confetti(BUILDING_SPOTS[bv.id].x, BUILDING_SPOTS[bv.id].y - 160, 24);
        this.fx.puff(BUILDING_SPOTS[bv.id].x, BUILDING_SPOTS[bv.id].y, 9, 160);
        if (bv.npc !== null && open) {
          bv.npc.node.visible = true;
          this.celebrate(bv.npc.node, bv.npc.flip, 1, null);
        }
      } else if (up) this.celebrate(bv.node, s, s, BUILDING_SPOTS[bv.id]);
    }
    this.syncBooths(animate);
  }

  private syncBooths(animate: boolean): void {
    const st = this.sim.state;
    for (let i = 0; i < this.booths.length; i++) {
      const b = this.booths[i] as BoothView;
      const bs = st.booths[b.id];
      if (bs === undefined) continue;
      const open = this.isOpen(b.district);
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
      b.lot.visible = !b.unlocked && open;
      b.pot.visible = b.unlocked && open;

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
        const show = art !== '' && b.unlocked && open;
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

  // ── 바깥에서 부르는 것 ──

  /** WebGL 문맥을 되찾은 뒤: 코드로 구운 구름(그림이 없을 때)을 다시 굽는다. 그림 텍스처는 Pixi가 다시 올린다. */
  restoreTextures(): void {
    if (!this.ownCloudTex) return;
    const g = drawCloud();
    const tex = this.renderer.generateTexture({ target: g, resolution: 1, antialias: true });
    g.destroy();
    for (const grp of this.cloudGroups) for (const c of grp.clouds) c.sp.texture = tex;
    this.cloudTex.destroy(true);
    this.cloudTex = tex;
  }

  /** 상태가 바뀌었다는 이벤트 (업그레이드·해금·진행자·구역): 바로 맞춘다. */
  refresh(): void {
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

  /** 부스 그림 (단체 놀이 화면이 흔들거나 숨길 때: 보물상자 뚜껑 등은 자기 그림으로). */
  boothNode(booth: BoothId): ArtNode | null {
    return this.booths.find((b) => b.id === booth)?.building ?? null;
  }

  /** 진행자 자리 role의 그림과 서는 점 (단체 놀이 화면이 진행자 연출을 더할 때, 없으면 null). 진행자가 없으면 node.visible = false. */
  hostNode(booth: BoothId, role: number): { node: ArtNode; at: Pt } | null {
    const hv = this.booths.find((b) => b.id === booth)?.hosts[role];
    return hv === undefined ? null : { node: hv.node, at: hv.at };
  }

  /** 넷째 묶음 건물의 주인 그림과 서는 점 (전당포 주인·은행원·일터 반장, 없는 건물은 null). 짓기 전엔 node.visible = false. */
  npcNode(id: BuildingId): { node: ArtNode; at: Pt } | null {
    const hv = this.buildings.find((b) => b.id === id)?.npc ?? null;
    return hv === null ? null : { node: hv.node, at: hv.at };
  }

  /** 넷째 묶음 건물의 주인을 통통 (맡기기·갚기·재료가 나올 때). 짓기 전이면 아무것도 안 한다. */
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
    const at = BUILDING_SPOTS[id];
    const m = artMeta('map', id);
    if (bv === undefined || m === undefined) {
      out.x = at.x;
      out.y = at.y - 90;
      return;
    }
    const p = SHOP_PORT[id];
    const k = BUILDING_K[id] ?? ART_SCALE.building;
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

  /** 일터 반장이 호루라기를 분다 (통통 + 소리 선 + '삑!'). big = 빚 걸기 판을 부를 때. 짓기 전이면 아무것도 안 한다. */
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
   * 반장이 없거나 (짓기 전) 너무 멀면 run을 바로 부른다.
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
    const p = BOOTH_SPOTS[booth].pot;
    out.x = p.x;
    out.y = p.y - 40;
    for (const b of this.booths) if (b.id === booth) out.y = p.y - (p.y - b.potBox.y0) * 0.8 * b.potScale;
  }

  hitTest(wx: number, wy: number): MapHit | null {
    let best: MapHit | null = null;
    let bestY = -Infinity;
    for (const b of this.booths) {
      if (!this.isOpen(b.district)) continue;
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
      if (!this.isOpen(bv.district)) continue;
      const h = bv.hit;
      const y = BUILDING_SPOTS[bv.id].y;
      if (wx >= h.x0 && wx <= h.x1 && wy >= h.y0 && wy <= h.y1 && y > bestY) {
        best = { kind: 'building', id: bv.id };
        bestY = y;
      }
    }
    return best;
  }

  /** 구름에 덮인 곳인가 (닫힌 구역). */
  covered(wx: number, wy: number): boolean {
    return !this.isOpen(districtAt(wx, wy));
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

  /** 반장 한 걸음: 일하는 손님이 있으면 FOREMAN_ROUTE를 돌고 (닿으면 쉬며 가끔 호루라기), 없으면 집으로 가서 선다. */
  private walkForeman(pt: Patrol, busy: boolean, dt: number): void {
    const home = WORK_YARD.foreman;
    if (!busy && !pt.homing) {
      pt.homing = true;
      pt.pause = 0;
    } else if (busy && pt.homing) {
      pt.homing = false;
      pt.pause = Math.max(pt.pause, 0.8);
    }
    const visit = pt.visit;
    const stop = visit !== null || pt.homing ? null : (FOREMAN_ROUTE[pt.leg % FOREMAN_ROUTE.length] ?? null);
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
          pt.leg = (pt.leg + 1) % FOREMAN_ROUTE.length;
          pt.flip = stop.look.x <= pt.x ? 1 : -1;
          if (Math.random() < stop.whistle) this.foremanWhistle(false);
        } else {
          pt.pause = 1;
          pt.flip = WORK_YARD.facilities.farm.face.x <= pt.x ? 1 : -1;
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
    if (!this.busy.has(this.chief)) {
      let dy = 0;
      if (this.chiefHopT >= 0) {
        this.chiefHopT += dt;
        const u = this.chiefHopT / 0.9;
        if (u >= 1) this.chiefHopT = -1;
        else dy = -Math.abs(Math.sin(Math.PI * 2 * u)) * 16;
      }
      const br = Math.sin(t * 1.9) * 0.012;
      this.chief.scale.set(1 - br * 0.5, 1 + br);
      this.chief.y = CHIEF_AT.y + dy;
    }

    // 구름: 느리게 일렁이고, 구역이 열리면 바깥으로 흩어지며 사라진다.
    for (let gi = this.cloudGroups.length - 1; gi >= 0; gi--) {
      const g = this.cloudGroups[gi] as CloudGroup;
      if (g.opening) {
        g.openT += dt;
        g.fill.alpha = 1 - clamp(g.openT / 0.9, 0, 1);
        let alive = false;
        for (let ci = 0; ci < g.clouds.length; ci++) {
          const c = g.clouds[ci] as Cloud;
          const u = clamp((g.openT - c.delay) / 1.8, 0, 1);
          if (u < 1) alive = true;
          const e = 1 - (1 - u) ** 3;
          c.sp.position.set(c.bx + c.dx * 520 * e, c.by + c.dy * 520 * e);
          c.sp.alpha = 1 - u;
          const s = c.s * (1 + 0.2 * e);
          c.sp.scale.set(c.flip * s, s);
          c.sp.culled = false;
        }
        if (!alive) this.dropCloudGroup(g);
        continue;
      }
      g.fill.culled = !boxHits(g.fillBox, view);
      for (let ci = 0; ci < g.clouds.length; ci++) {
        const c = g.clouds[ci] as Cloud;
        const vis = boxHits(c.box, view);
        c.sp.culled = !vis;
        if (vis) c.sp.position.set(c.bx + Math.sin(t * 0.12 + c.ph) * 14, c.by + Math.cos(t * 0.09 + c.ph) * 8);
      }
    }

    // 화면 밖 소품은 그리지 않는다.
    for (let i = 0; i < this.props.length; i++) {
      const p = this.props[i] as Prop;
      p.node.culled = !boxHits(p.box, view);
    }
  }

  destroy(): void {
    for (const p of this.props) tweens.cancel(p.node);
    for (const g of this.cloudGroups) g.node.destroy({ children: true });
    this.cloudGroups.length = 0;
    for (const p of this.props) p.node.destroy({ children: true });
    this.props.length = 0;
    this.busy.clear();
    if (this.ownCloudTex) this.cloudTex.destroy(true);
  }
}
