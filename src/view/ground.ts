// 바닥 (풀밭·길·광장·경주로·연못): 코드로 그리고 땅 조각마다 RenderTexture 타일로 굽는다. map.ts 머리말과 GROUND_STYLE 그대로.
// 배치형 마을 (DESIGN 6.1): 길 = 놓인 길 칸 (GameState.village.roads) + 마을 입구 아치 밑 길 띠, 광장·연못·경주로 = 놓인 시설의 바닥 모양 (catalog.ts FLOORS).
//  - 길 모양은 roads.ts: 모든 테두리 먼저, 속 나중 (이어진 칸 사이·조각 사이에 선이 없다), 바깥 모서리 둥글게, 꺾임·갈림길 안쪽은 부드럽게 휜다,
//    2×2 넘게 뭉친 길은 광장 (넓은 모래 + 납작한 돌), 길 칸마다 조약돌 점. 풀밭엔 칸마다 씨앗 난수로 풀 한 포기.
//  - 땅 조각(CHUNK × CHUNK 칸)마다 바닥 그림(Graphics + 풀 스프라이트)을 따로 만든다. 조각 그림엔 둘레 한 칸까지의 길·풀이 들어 있어
//    (칸마다 같은 씨앗) 어느 조각에서 굽든 이음매가 맞는다. 길·시설 자리가 바뀌면 바뀐 칸 둘레의 조각 그림만 다시 만들고 그 타일만 다시 굽는다
//    (그동안은 옛 타일이 보인다).
//  - 타일 = 조각의 1/3 (256 세계 px, 조각 경계와 맞는다): 확대 단계마다 다시 굽는 값과 메모리를 작게. 이웃 타일과 PAD px씩 겹쳐 그려
//    MSAA 화면에서 타일 사이에 실선이 비치지 않게 한다.
//  - 짙은 구름(land.ts underFog)에 다 덮인 타일은 굽지 않는다. 땅을 사면 그 조각 타일을 바로 굽는다 (구름이 걷히는 동안).
//  - 덧그림 (타일 위, 바닥 그림·물체 아래): 짓기 모드 칸 금(setGrid), 칸 물들이기(setTint: 유령 발자국 등), 칠하는 길 미리보기(previewRoads).
//
// 굽는 해상도 (텍셀 / 세계 px) 고르기:
//   - 해상도는 지금 확대 × 기기 배율(dpr)에 맞춰 0.25·0.5·0.75·1·1.5·2 가운데 하나
//     (화면 화소당 텍셀이 0.8 이상이 되는 가장 작은 단계). 그래서 어느 확대에서도 또렷하고, 텍셀 수는 화면 화소의 약 1.5배 안쪽.
//   - 타일은 보일 때 굽고, 확대 단계가 올라가면 그 타일만 다시 굽는다. 필요한 것보다 2배 넘게 고운 타일은
//     (멀리 줄였을 때) 프레임마다 조금씩 낮춰 굽는다. 텍셀이 상한(화면 화소의 약 3배, 최소 4M)을 넘으면 오래 안 본 타일부터 버린다.
//   - 테두리 선이 계단지지 않게 MSAA 굽기 판 하나(지금 쓰는 단계 크기)에 그린 다음 타일로 옮긴다 (타일마다 MSAA 버퍼를 들고 있지 않게).
//   - WebGL 문맥을 잃었다 되찾으면(폰에서 앱을 오가면 흔하다) 구운 타일이 비므로 invalidate()로 모두 다시 굽는다.

import { Container, Graphics, Matrix, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js';
import { FLOORS, RACE_GEO, footprint, type CatalogKey, type FloorShape, type RaceGeo } from '../data/catalog.ts';
import { CELL, CHUNK, CHUNKS, GRID, GROUND_STYLE, WORLD, cellIndex, lanePoint, type Pt } from '../data/map.ts';
import { Rng } from '../core/rng.ts';
import type { Village } from '../sim/village.ts';
import { artTexture } from './art.ts';
import { underFog } from './land.ts';
import { RACE_START_P, ellipseK, hash2, trackBand, type ViewRect } from './mapUtil.ts';
import { cellVertices, drawCellPebbles, drawPlazaSlabs, drawRoadPass, drawRoadPebbles, smoothPoly, type RoadTest } from './roads.ts';

/** 타일 한 변 (세계 px): 땅 조각 한 변의 1/3. */
export const GROUND_TILE = (CHUNK * CELL) / 3;
const T = GROUND_TILE;
/** 타일끼리 겹쳐 그리는 폭 (세계 px, 한쪽). (T + 2·PAD) × 모든 단계가 정수 텍셀이 되게. */
const PAD = 2;
const TW = T + 2 * PAD;
/** 땅 조각 한 변 (세계 px)과 조각 하나의 타일 수 (한 변). */
const CS = CHUNK * CELL;
const TPC = 3;
/** 굽는 해상도 단계. */
const LEVELS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;
/** 들고 있을 타일 텍셀 상한: 화면 기기 화소 × 이 배수 (최소 MIN_TEXELS, RGBA 4바이트). */
const TEXEL_SCREENS = 3;
const MIN_TEXELS = 4_000_000;
const SEED = 0x6b0d;
/** 풀밭 칸마다 풀 한 포기 확률과 둘째 포기 확률, 크기 (세계 px, 폭). */
const TUFT_CHANCE = 0.17;
const TUFT_PAIR_CHANCE = 0.35;
const TUFT_W = 38;
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];
/** 짓기 모드 칸 금 (세계 px 굵기, 색, 진하기). 조각 경계는 조금 더 진하게. */
const GRID_W = 3;
const GRID_COLOR = 0xffffff;
const GRID_ALPHA = 0.2;
const GRID_CHUNK_ALPHA = 0.38;

function levelFor(s: number): number {
  for (const r of LEVELS) if (r >= s * 0.8) return r;
  return LEVELS[LEVELS.length - 1] as number;
}

interface Tile {
  readonly i: number;
  readonly j: number;
  /** 들어 있는 땅 조각 번호. */
  readonly chunk: number;
  readonly sprite: Sprite;
  rt: RenderTexture | null;
  res: number;
  /** 바닥 그림이 바뀌어 다시 구워야 한다 (그때까지 옛 그림을 보인다). */
  stale: boolean;
  /** 짙은 구름에 다 덮였다 (굽지 않는다). */
  hidden: boolean;
  seen: number;
  /** 굽기 순서 점수 (작을수록 먼저). */
  score: number;
}

/** 땅 조각 하나의 바닥 그림 (굽는 무대). dirty면 다음에 구울 때 다시 만든다. */
interface ChunkFloor {
  node: Container | null;
  dirty: boolean;
}

/** 칸 사각형에 물들이기 (짓기 모드 유령 발자국 등). x·y·w·h = 칸. */
export interface GroundTint {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly color: number;
  readonly alpha?: number;
}

/** 연못 둘레 점 (씨앗 난수로 울퉁불퉁). */
export function pondOutline(c: Pt, rx: number, ry: number, seed: number, wobble = 1): number[] {
  const rng = new Rng(seed);
  const p1 = rng.next() * Math.PI * 2;
  const p2 = rng.next() * Math.PI * 2;
  const p3 = rng.next() * Math.PI * 2;
  const a1 = (0.07 + rng.next() * 0.05) * wobble;
  const a2 = (0.05 + rng.next() * 0.04) * wobble;
  const a3 = (0.02 + rng.next() * 0.03) * wobble;
  const n = 44;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const r = 1 + a1 * Math.sin(2 * t + p1) + a2 * Math.sin(3 * t + p2) + a3 * Math.sin(5 * t + p3);
    pts.push(c.x + Math.cos(t) * rx * r, c.y + Math.sin(t) * ry * r);
  }
  return pts;
}

// ── 경주로 (몬스터 경주장, catalog.ts RACE_GEO) ──
// 길과 같은 모래·테두리로 타원 띠를 그리고 (길 테두리를 다 그린 뒤 속을 그리므로 닿는 길과 자연스럽게 이어진다),
// 띠 안쪽은 테두리 + 풀밭, 레인 사이에 크림색 선, 출발선(크림 띠)과 결승선(바둑판 두 줄)을 바닥에 그린다.

/** 레인 선·출발선 색과 굵기 (세계 px). */
const LANE_LINE = 0xfff6e2;
const LANE_LINE_W = 5;
const START_LINE_W = 11;
/** 결승선 바둑판 한 칸 (세계 px, 대략: 띠 폭을 나눠 떨어지게 맞춘다). */
const CHECKER = 16;

/** 경주로 각도 a의 안쪽 가장자리 → 바깥 가장자리 점 (띠를 가로지르는 선). */
function bandSpan(R: RaceGeo, a: number): { ix: number; iy: number; ox: number; oy: number } {
  const B = trackBand(R);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { ix: B.cx + c * B.rxIn, iy: B.cy + s * B.ryIn, ox: B.cx + c * B.rxOut, oy: B.cy + s * B.ryOut };
}

/** 경주로 p의 각도 (map.ts lanePoint와 같은 식). */
function trackAngle(p: number): number {
  return RACE_GEO.startAngle + (RACE_GEO.endAngle - RACE_GEO.startAngle) * p;
}

/** 띠 속 위의 표시: 레인 선, 출발선, 결승선 바둑판. */
function drawTrackMarks(g: Graphics, R: RaceGeo): void {
  const B = trackBand(R);
  // 레인 사이 선 (레인 가운데 선에서 반 레인씩 바깥).
  for (let i = 1; i < R.lanes; i++) {
    const o = (i - R.lanes / 2) * R.laneWidth;
    g.ellipse(B.cx, B.cy, R.rx + o, R.ry + o * R.squash).stroke({ width: LANE_LINE_W, color: LANE_LINE, alpha: 0.85 });
  }
  // 출발선: 출발대 바로 앞 (mapUtil RACE_START_P).
  const st = bandSpan(R, trackAngle(RACE_START_P));
  g.moveTo(st.ix, st.iy).lineTo(st.ox, st.oy).stroke({ width: START_LINE_W, color: LANE_LINE, cap: 'butt' });
  // 결승선: 띠를 가로지르는 바둑판 두 줄 (달리는 쪽으로 한 칸씩 앞뒤).
  const fs = bandSpan(R, trackAngle(1));
  const dir = lanePoint(R, 0, 1);
  const len = Math.hypot(fs.ox - fs.ix, fs.oy - fs.iy);
  const n = Math.max(2, Math.round(len / CHECKER));
  const ux = (fs.ox - fs.ix) / n;
  const uy = (fs.oy - fs.iy) / n;
  const cw = CHECKER * 0.9;
  const tx = dir.dx * cw;
  const ty = dir.dy * cw;
  for (let i = 0; i < n; i++) {
    for (let j = -1; j < 1; j++) {
      const x0 = fs.ix + ux * i + tx * j;
      const y0 = fs.iy + uy * i + ty * j;
      g.poly([x0, y0, x0 + ux, y0 + uy, x0 + ux + tx, y0 + uy + ty, x0 + tx, y0 + ty]).fill((i + j) % 2 === 0 ? GROUND_STYLE.roadEdge : LANE_LINE);
    }
  }
}

// ── 놓인 시설의 바닥 모양 ──

/** 놓인 시설의 바닥 모양 하나 (세계 좌표) 와 그 상자. 길 띠(road)는 포장 칸으로 바꿔 길과 같이 그린다 (pavedGrid). */
type WorldFloor =
  | { readonly kind: 'plaza'; readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number; readonly box: Box4 }
  | { readonly kind: 'pond'; readonly pts: readonly number[]; readonly box: Box4 }
  | { readonly kind: 'track'; readonly race: RaceGeo; readonly box: Box4 }
  | { readonly kind: 'walk'; readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly box: Box4 };

/** 건물 안 오솔길 (디딤돌): 밟혀 옅어진 풀 띠 + 납작한 돌 (길처럼 진한 테두리·조약돌 없이, 건물의 일부로 보이게). */
const WALK_WORN = 0xb3c47c;
const WALK_STONE = 0xeee3cf;
const WALK_SHADE = 0x6f8f4c;
const WALK_LINE = 0x7a6248;

function drawWalk(g: Graphics, f: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }): void {
  const w = f.x1 - f.x0;
  const h = f.y1 - f.y0;
  const vertical = h >= w;
  const len = vertical ? h : w;
  const cx = (f.x0 + f.x1) / 2;
  const cy = (f.y0 + f.y1) / 2;
  if (vertical) g.roundRect(cx - 34, f.y0 + 6, 68, h - 12, 34).fill({ color: WALK_WORN, alpha: 0.7 });
  else g.roundRect(f.x0 + 6, cy - 30, w - 12, 60, 30).fill({ color: WALK_WORN, alpha: 0.7 });
  // 반 칸마다 돌 하나, 좌우(위아래)로 조금씩 엇갈리게 (씨앗 난수: 굽는 조각이 달라도 같은 자리).
  const n = Math.max(1, Math.round(len / (CELL / 2)));
  const rng = new Rng(hash2(Math.round(f.x0), Math.round(f.y0), SEED ^ 0x3a1c) | 0);
  for (let k = 0; k < n; k++) {
    const t = ((k + 0.5) / n) * len;
    const side = (k % 2 === 0 ? -1 : 1) * (5 + rng.next() * 6);
    const rx = (vertical ? 27 : 19) + rng.next() * 4;
    const ry = (vertical ? 16 : 24) + rng.next() * 3;
    const x = vertical ? cx + side : f.x0 + t;
    const y = vertical ? f.y0 + t : cy + side * 0.6;
    g.ellipse(x, y + 4, rx, ry).fill({ color: WALK_SHADE, alpha: 0.45 });
    g.ellipse(x, y, rx, ry).fill(WALK_STONE).stroke({ width: 4, color: WALK_LINE });
  }
}

type Box4 = readonly [number, number, number, number];

function hits(b: Box4, x0: number, y0: number, x1: number, y1: number): boolean {
  return b[2] >= x0 && b[0] <= x1 && b[3] >= y0 && b[1] <= y1;
}

function worldFloors(v: Village): WorldFloor[] {
  const out: WorldFloor[] = [];
  const e = GROUND_STYLE.edge;
  for (const [key, list] of Object.entries(FLOORS) as [CatalogKey, readonly FloorShape[]][]) {
    if (v.placed(key) === undefined) continue;
    const o = v.origin(key);
    for (const sh of list) {
      if (sh.kind === 'plaza') {
        const cx = sh.c.x + o.x;
        const cy = sh.c.y + o.y;
        out.push({ kind: 'plaza', cx, cy, rx: sh.rx, ry: sh.ry, box: [cx - sh.rx - e, cy - sh.ry - e, cx + sh.rx + e, cy + sh.ry + e] });
      } else if (sh.kind === 'pond') {
        const c = { x: sh.shape.c.x + o.x, y: sh.shape.c.y + o.y };
        const pts = pondOutline(c, sh.shape.rx, sh.shape.ry, hash2(77, key.length, SEED), sh.shape.wobble);
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (let k = 0; k < pts.length; k += 2) {
          x0 = Math.min(x0, pts[k] as number);
          x1 = Math.max(x1, pts[k] as number);
          y0 = Math.min(y0, pts[k + 1] as number);
          y1 = Math.max(y1, pts[k + 1] as number);
        }
        out.push({ kind: 'pond', pts, box: [x0 - 2 * e, y0 - 2 * e, x1 + 2 * e, y1 + 2 * e] });
      } else if (sh.kind === 'track') {
        const race = v.race();
        const B = trackBand(race);
        out.push({ kind: 'track', race, box: [B.cx - B.rxOut - e, B.cy - B.ryOut - e, B.cx + B.rxOut + e, B.cy + B.ryOut + e] });
      } else if (sh.kind === 'walk') {
        const x0 = sh.rect.x + o.x;
        const y0 = sh.rect.y + o.y;
        out.push({ kind: 'walk', x0, y0, x1: x0 + sh.rect.w, y1: y0 + sh.rect.h, box: [x0 - 8, y0 - 8, x0 + sh.rect.w + 8, y0 + sh.rect.h + 12] });
      }
    }
  }
  return out;
}

/** 포장 칸 (길 칸 + 시설의 길 띠가 덮은 칸: 마을 입구 아치 밑). 길과 똑같이 그린다. */
function pavedGrid(v: Village): Uint8Array {
  const out = v.road.slice();
  for (const [key, list] of Object.entries(FLOORS) as [CatalogKey, readonly FloorShape[]][]) {
    if (v.placed(key) === undefined) continue;
    const o = v.origin(key);
    for (const sh of list) {
      if (sh.kind !== 'road') continue;
      const x0 = Math.round((sh.rect.x + o.x) / CELL);
      const y0 = Math.round((sh.rect.y + o.y) / CELL);
      const x1 = Math.round((sh.rect.x + o.x + sh.rect.w) / CELL);
      const y1 = Math.round((sh.rect.y + o.y + sh.rect.h) / CELL);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = cellIndex(x, y);
          if (i >= 0) out[i] = 1;
        }
      }
    }
  }
  return out;
}

/** 바닥 그림을 가진 시설 (옮기면 그 둘레 바닥을 다시 굽는다). */
function floorKey(key: CatalogKey): boolean {
  return FLOORS[key] !== undefined;
}

/** 풀을 심지 않는 발자국: 마당·연못·경주로를 가진 시설과 마을 입구 (보통 부스는 앞 오솔길 칸만 빼고 풀밭엔 풀). */
function bareFloor(key: CatalogKey): boolean {
  return key === 'gate' || (FLOORS[key]?.some((s) => s.kind !== 'road' && s.kind !== 'walk') ?? false);
}

/** 건물 안 오솔길(walk)이 덮은 칸 (풀을 심지 않는다). */
function walkGrid(v: Village): Uint8Array {
  const out = new Uint8Array(GRID.w * GRID.h);
  for (const [key, list] of Object.entries(FLOORS) as [CatalogKey, readonly FloorShape[]][]) {
    if (v.placed(key) === undefined) continue;
    const o = v.origin(key);
    for (const sh of list) {
      if (sh.kind !== 'walk') continue;
      const x0 = Math.round((sh.rect.x + o.x) / CELL);
      const y0 = Math.round((sh.rect.y + o.y) / CELL);
      const x1 = Math.round((sh.rect.x + o.x + sh.rect.w) / CELL);
      const y1 = Math.round((sh.rect.y + o.y + sh.rect.h) / CELL);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = cellIndex(x, y);
          if (i >= 0) out[i] = 1;
        }
      }
    }
  }
  return out;
}

export class GroundView {
  /** 카메라 안에 넣는다 (세계 좌표). */
  readonly node = new Container();
  private readonly renderer: Renderer;
  private readonly cols: number;
  private readonly rows: number;
  private readonly tiles: (Tile | null)[];
  private readonly tileLayer = new Container();
  /** 짓기 모드 덧그림: 칸 금, 물들이기, 길 미리보기. */
  private readonly overlay = new Container();
  private readonly gridG = new Graphics();
  private readonly tintG = new Graphics();
  private readonly previewG = new Graphics();
  private gridOn = false;
  private gridLand = -1;
  private readonly tuftTex: Texture | undefined;
  /** 조각마다 바닥 그림. */
  private readonly floors: ChunkFloor[] = [];
  /** MSAA 굽기 판 하나와 그 해상도. */
  private bakeRt: RenderTexture | null = null;
  private bakeRes = 0;
  /** 텍셀 상한 (화면 크기로 정한다). */
  private maxTexels = MIN_TEXELS;
  private readonly copySprite = new Sprite();
  private readonly m = new Matrix();
  private readonly identity = new Matrix();
  private readonly rng = new Rng(1);
  private shown: Tile[] = [];
  private nextShown: Tile[] = [];
  private readonly queue: Tile[] = [];
  private texels = 0;
  private frame = 0;
  private first = true;
  /** 지금 바닥 그림의 마을과 도장 (길·자리·땅이 바뀌면 맞춘다). */
  private village: Village | null = null;
  private placeStamp = -1;
  private roadStamp = -1;
  private landStamp = -1;
  /** 지금 포장 칸 (길 + 시설 길 띠)과 길 검사. */
  private paved: Uint8Array = new Uint8Array(GRID.w * GRID.h);
  private readonly road: RoadTest = (x, y) => {
    const i = cellIndex(x, y);
    return i >= 0 && this.paved[i] === 1;
  };
  private floorShapes: WorldFloor[] = [];
  /** 건물 안 오솔길 칸 (풀을 심지 않는다). */
  private walks: Uint8Array = new Uint8Array(GRID.w * GRID.h);
  /** 지난 놓인 것 (바닥 그림을 가진 시설만, id → 칸·key): 옮기면 그 둘레만 다시. */
  private lastFloorPlaced = new Map<number, string>();

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.cols = Math.ceil(WORLD.w / T);
    this.rows = Math.ceil(WORLD.h / T);
    this.tiles = new Array<Tile | null>(this.cols * this.rows).fill(null);
    for (let i = 0; i < CHUNKS.w * CHUNKS.h; i++) this.floors.push({ node: null, dirty: true });
    this.tuftTex = artTexture('map', 'tuft');

    // 타일이 구워지기 전에 비치는 풀밭.
    const under = new Graphics().rect(0, 0, WORLD.w, WORLD.h).fill(GROUND_STYLE.grass);
    this.overlay.addChild(this.gridG, this.tintG, this.previewG);
    this.gridG.visible = false;
    this.node.addChild(under, this.tileLayer, this.overlay);
    this.node.eventMode = 'none';
    this.tileLayer.eventMode = 'none';
  }

  /** WebGL 문맥을 되찾은 뒤: 구운 타일을 모두 잊고 다음 프레임에 보이는 것부터 다시 굽는다. */
  invalidate(): void {
    for (const t of this.tiles) {
      if (t === null) continue;
      this.dropTile(t);
    }
    this.texels = 0;
    this.bakeRt?.destroy(true);
    this.bakeRt = null;
    this.bakeRes = 0;
    this.first = true;
  }

  // ── 짓기 모드 덧그림 ──

  /** 칸 금 (가진 땅만, 짓기 모드에서만 켠다). */
  setGrid(on: boolean): void {
    if (on === this.gridOn) return;
    this.gridOn = on;
    this.gridG.visible = on;
    if (on && this.village !== null) this.drawGrid(this.village);
  }

  /** 칸 물들이기 (짓기 모드 유령 발자국·입구 등): 바닥 위·건물 아래에 그린다. 빈 목록 = 지우기. */
  setTint(list: readonly GroundTint[]): void {
    const g = this.tintG;
    g.clear();
    for (const t of list) g.roundRect(t.x * CELL + 3, t.y * CELL + 3, t.w * CELL - 6, t.h * CELL - 6, 14).fill({ color: t.color, alpha: t.alpha ?? 0.35 });
  }

  /**
   * 칠하는 중인 길 미리보기 (손을 떼기 전, 구운 바닥은 그대로): add = 깔 칸, erase = 지울 칸 (칸 번호).
   * 깔 칸은 진짜 길 모양으로 (이웃 길과 이어진 모습 그대로), 지울 칸은 붉게. 둘 다 null이면 지운다.
   */
  previewRoads(add: ReadonlySet<number> | null, erase: ReadonlySet<number> | null): void {
    const g = this.previewG;
    g.clear();
    if (add !== null && add.size > 0) {
      const has: RoadTest = (x, y) => {
        const i = cellIndex(x, y);
        return i >= 0 && (this.paved[i] === 1 || add.has(i));
      };
      // 깔 칸과 그 둘레 길 칸을 다시 그린다 (이어지며 바뀌는 모서리까지).
      const cells = new Set<number>();
      for (const i of add) {
        const x = i % GRID.w;
        const y = (i - x) / GRID.w;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const n = cellIndex(x + dx, y + dy);
            if (n >= 0 && (add.has(n) || this.paved[n] === 1)) cells.add(n);
          }
        }
      }
      // 그 바깥 한 겹 길 칸은 속만 다시 (다시 그린 칸의 테두리가 이웃 길 칸으로 번진 것을 덮는다. 모양은 그대로라 테두리는 구운 그대로).
      const ring = new Set<number>();
      for (const i of cells) {
        const x = i % GRID.w;
        const y = (i - x) / GRID.w;
        for (const [dx, dy] of CORNERS) {
          const n = cellIndex(x + dx, y + dy);
          if (n >= 0 && !cells.has(n) && this.paved[n] === 1) ring.add(n);
        }
        for (const [dx, dy] of SIDES) {
          const n = cellIndex(x + dx, y + dy);
          if (n >= 0 && !cells.has(n) && this.paved[n] === 1) ring.add(n);
        }
      }
      const list = [...cells];
      const verts = cellVertices(list, GRID.w);
      drawRoadPass(g, has, list, verts, GRID.w, 'edge');
      const all = [...list, ...ring];
      drawRoadPass(g, has, all, verts, GRID.w, 'fill');
      drawPlazaSlabs(g, has, cellVertices(all, GRID.w));
      for (const i of all) {
        const x = i % GRID.w;
        drawRoadPebbles(g, has, x, (i - x) / GRID.w);
      }
    }
    if (erase !== null) {
      for (const i of erase) {
        const x = i % GRID.w;
        const y = (i - x) / GRID.w;
        g.roundRect(x * CELL + 6, y * CELL + 6, CELL - 12, CELL - 12, 18).fill({ color: 0xd94040, alpha: 0.4 });
      }
    }
  }

  private drawGrid(v: Village): void {
    this.gridLand = v.stamp.land;
    const g = this.gridG;
    g.clear();
    const owned = new Set(v.state.chunks);
    const has = (cx: number, cy: number): boolean => cx >= 0 && cy >= 0 && cx < CHUNKS.w && cy < CHUNKS.h && owned.has(cy * CHUNKS.w + cx);
    for (const ci of owned) {
      const cx = ci % CHUNKS.w;
      const cy = (ci - cx) / CHUNKS.w;
      const x0 = cx * CS;
      const y0 = cy * CS;
      for (let k = 1; k < CHUNK; k++) {
        g.moveTo(x0 + k * CELL, y0).lineTo(x0 + k * CELL, y0 + CS);
        g.moveTo(x0, y0 + k * CELL).lineTo(x0 + CS, y0 + k * CELL);
      }
    }
    g.stroke({ width: GRID_W, color: GRID_COLOR, alpha: GRID_ALPHA });
    // 조각 경계 (한 번씩: 왼쪽·위는 늘, 오른쪽·아래는 이웃이 없을 때).
    for (const ci of owned) {
      const cx = ci % CHUNKS.w;
      const cy = (ci - cx) / CHUNKS.w;
      const x0 = cx * CS;
      const y0 = cy * CS;
      g.moveTo(x0, y0).lineTo(x0, y0 + CS);
      g.moveTo(x0, y0).lineTo(x0 + CS, y0);
      if (!has(cx + 1, cy)) g.moveTo(x0 + CS, y0).lineTo(x0 + CS, y0 + CS);
      if (!has(cx, cy + 1)) g.moveTo(x0, y0 + CS).lineTo(x0 + CS, y0 + CS);
    }
    g.stroke({ width: GRID_W * 1.4, color: GRID_COLOR, alpha: GRID_CHUNK_ALPHA });
  }

  // ── 마을 맞추기 ──

  /** 마을이 바뀌었으면: 바뀐 칸·시설 둘레의 조각 그림을 다시 만들게 하고 그 타일을 낡음으로, 땅이 바뀌었으면 구름 덮임을 다시. */
  private syncVillage(v: Village): void {
    if (this.village === v) return;
    const first = this.village === null;
    this.village = v;
    const placeChanged = v.stamp.place !== this.placeStamp;
    const roadChanged = v.stamp.road !== this.roadStamp;
    const landChanged = v.stamp.land !== this.landStamp;
    this.placeStamp = v.stamp.place;
    this.roadStamp = v.stamp.road;
    this.landStamp = v.stamp.land;
    if (placeChanged || roadChanged) {
      const paved = pavedGrid(v);
      if (placeChanged) {
        this.floorShapes = worldFloors(v);
        this.walks = walkGrid(v);
      }
      if (!first) {
        // 바뀐 포장 칸 둘레.
        const old = this.paved;
        for (let i = 0; i < paved.length; i++) {
          if (paved[i] === old[i]) continue;
          const x = i % GRID.w;
          const y = (i - x) / GRID.w;
          this.dirtyRect(x * CELL, y * CELL, (x + 1) * CELL, (y + 1) * CELL);
        }
      }
      this.paved = paved;
      if (placeChanged) {
        // 바닥 그림을 가진 시설이 놓이거나 옮겨지거나 빠진 곳.
        const now = new Map<number, string>();
        for (const p of v.state.placed) if (floorKey(p.key)) now.set(p.id, `${p.key}:${p.x}:${p.y}`);
        if (!first) {
          for (const [id, s] of now) if (this.lastFloorPlaced.get(id) !== s) this.dirtyPlaced(s);
          for (const [id, s] of this.lastFloorPlaced) if (now.get(id) !== s) this.dirtyPlaced(s);
        }
        this.lastFloorPlaced = now;
      }
    }
    if (landChanged) {
      for (const t of this.tiles) {
        if (t === null) continue;
        const hidden = this.tileHidden(v, t.i, t.j);
        if (hidden && !t.hidden) this.dropTile(t);
        t.hidden = hidden;
      }
      if (this.gridOn) this.drawGrid(v);
    }
    if (this.gridOn && this.gridLand !== v.stamp.land) this.drawGrid(v);
  }

  /** 'key:x:y' (lastFloorPlaced) 시설 발자국 둘레를 다시. */
  private dirtyPlaced(s: string): void {
    const [key, xs, ys] = s.split(':') as [CatalogKey, string, string];
    const fp = footprint(key);
    const x = Number(xs) * CELL;
    const y = Number(ys) * CELL;
    this.dirtyRect(x, y, x + fp.w * CELL, y + fp.h * CELL);
  }

  /** 세계 사각형의 바닥이 바뀌었다: 둘레 두 칸 안의 조각 그림을 다시 만들게, 둘레 한 칸 반 안의 구운 타일을 낡음으로. */
  private dirtyRect(x0: number, y0: number, x1: number, y1: number): void {
    const m = 2 * CELL;
    const c0x = Math.max(0, Math.floor((x0 - m) / CS));
    const c1x = Math.min(CHUNKS.w - 1, Math.floor((x1 + m) / CS));
    const c0y = Math.max(0, Math.floor((y0 - m) / CS));
    const c1y = Math.min(CHUNKS.h - 1, Math.floor((y1 + m) / CS));
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) (this.floors[cy * CHUNKS.w + cx] as ChunkFloor).dirty = true;
    const tm = CELL * 1.5;
    const i0 = Math.max(0, Math.floor((x0 - tm) / T));
    const i1 = Math.min(this.cols - 1, Math.floor((x1 + tm) / T));
    const j0 = Math.max(0, Math.floor((y0 - tm) / T));
    const j1 = Math.min(this.rows - 1, Math.floor((y1 + tm) / T));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const t = this.tiles[i + j * this.cols];
        if (t !== null && t !== undefined && t.rt !== null) t.stale = true;
      }
    }
  }

  private tileHidden(v: Village, i: number, j: number): boolean {
    return underFog(v, i * T, j * T, (i + 1) * T, (j + 1) * T);
  }

  /** 보이는 타일을 보이게 하고, 필요한 만큼 굽는다. view = 세계 좌표 사각형, scale = 확대 × dpr, village = 지금 마을 (sim.village()). */
  update(view: ViewRect, scale: number, village: Village): void {
    this.syncVillage(village);
    const frame = ++this.frame;
    const want = levelFor(scale);
    // 화면 기기 화소 = (보이는 세계 폭 × 높이) × scale².
    const screenTexels = (view.x1 - view.x0) * (view.y1 - view.y0) * scale * scale;
    this.maxTexels = Math.max(MIN_TEXELS, screenTexels * TEXEL_SCREENS);
    const pad = T * 0.5;
    const i0 = Math.max(0, Math.floor((view.x0 - pad) / T));
    const i1 = Math.min(this.cols - 1, Math.floor((view.x1 + pad) / T));
    const j0 = Math.max(0, Math.floor((view.y0 - pad) / T));
    const j1 = Math.min(this.rows - 1, Math.floor((view.y1 + pad) / T));
    const cx = (view.x0 + view.x1) / 2;
    const cy = (view.y0 + view.y1) / 2;
    const over = this.texels > this.maxTexels;

    const next = this.nextShown;
    next.length = 0;
    const q = this.queue;
    q.length = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const idx = i + j * this.cols;
        let tile = this.tiles[idx] ?? null;
        if (tile === null) {
          const sprite = new Sprite();
          sprite.position.set(i * T - PAD, j * T - PAD);
          sprite.visible = false;
          sprite.eventMode = 'none';
          this.tileLayer.addChild(sprite);
          const chunk = Math.floor(j / TPC) * CHUNKS.w + Math.floor(i / TPC);
          tile = { i, j, chunk, sprite, rt: null, res: 0, stale: false, hidden: this.tileHidden(village, i, j), seen: 0, score: 0 };
          this.tiles[idx] = tile;
        }
        tile.seen = frame;
        if (tile.hidden) continue;
        next.push(tile);
        if (tile.rt !== null) tile.sprite.visible = true;
        // 굽기 순서: 없는 타일·낡은 타일 → 흐린 타일 → 너무 고운 타일 (2배 넘게, 또는 메모리가 넘칠 때). 같은 무리 안에서는 화면 가운데부터.
        const dx = (i + 0.5) * T - cx;
        const dy = (j + 0.5) * T - cy;
        const d = Math.sqrt(dx * dx + dy * dy) / T;
        if (tile.rt === null || tile.stale) tile.score = d;
        else if (tile.res < want) tile.score = 1000 + d;
        else if (tile.res >= want * 2 || (over && tile.res > want)) tile.score = 2000 + d;
        else continue;
        q.push(tile);
      }
    }
    // 이번에 안 보이는 타일은 숨긴다.
    const old = this.shown;
    for (let k = 0; k < old.length; k++) {
      const t = old[k] as Tile;
      if (t.seen !== frame || t.hidden) t.sprite.visible = false;
    }
    this.nextShown = this.shown;
    this.shown = next;

    if (q.length > 0) {
      q.sort(byScore);
      // 처음 한 번은 보이는 것을 모두 (풀밭만 보이는 순간이 없게), 그다음은 프레임마다 조금씩.
      // 흐린 단계(작은 타일)는 굽는 값이 싸니 더 많이. 낡은 타일(길을 깔 때)은 넉넉히.
      let missing = this.first ? 1e9 : want <= 0.5 ? 16 : 8;
      let other = 2;
      for (let k = 0; k < q.length; k++) {
        const t = q[k] as Tile;
        if (t.rt === null || t.stale) {
          if (missing-- <= 0) continue;
        } else if (other-- <= 0) break;
        this.bake(t, t.stale && t.res > 0 ? Math.max(t.res, want) : want);
        t.sprite.visible = true;
      }
    }
    this.first = false;
    if (this.texels > this.maxTexels) this.evict(frame);
  }

  /** MSAA 굽기 판: 하나만 들고 있고, 단계가 바뀌면 그 크기로 새로 만든다 (단계마다 판을 쌓아 두지 않게). */
  private bakeTarget(res: number): RenderTexture {
    if (this.bakeRt !== null && this.bakeRes === res) return this.bakeRt;
    this.bakeRt?.destroy(true);
    this.bakeRt = RenderTexture.create({ width: TW, height: TW, resolution: res, antialias: true });
    this.bakeRes = res;
    return this.bakeRt;
  }

  private bake(tile: Tile, res: number): void {
    const node = this.chunkNode(tile.chunk);
    // 1) MSAA 판에 그리고 2) 타일 텍스처로 옮긴다.
    const work = this.bakeTarget(res);
    this.m.set(1, 0, 0, 1, -(tile.i * T - PAD), -(tile.j * T - PAD));
    this.renderer.render({ container: node, target: work, clear: true, clearColor: CLEAR, transform: this.m });
    let rt = tile.rt;
    if (rt === null || tile.res !== res) {
      rt = RenderTexture.create({ width: TW, height: TW, resolution: res });
      if (tile.rt !== null) {
        this.texels -= (TW * tile.res) ** 2;
        tile.rt.destroy(true);
      }
      tile.rt = rt;
      tile.res = res;
      this.texels += (TW * res) ** 2;
    }
    tile.stale = false;
    this.copySprite.texture = work;
    this.renderer.render({ container: this.copySprite, target: rt, clear: true, clearColor: CLEAR, transform: this.identity });
    tile.sprite.texture = rt;
  }

  private dropTile(t: Tile): void {
    if (t.rt !== null) {
      this.texels -= (TW * t.res) ** 2;
      t.rt.destroy(true);
    }
    t.rt = null;
    t.res = 0;
    t.stale = false;
    t.sprite.texture = Texture.EMPTY;
    t.sprite.visible = false;
  }

  /** 오래 안 본 타일부터 버린다. */
  private evict(frame: number): void {
    while (this.texels > this.maxTexels) {
      let oldest: Tile | null = null;
      for (const t of this.tiles) {
        if (t === null || t.rt === null || t.seen === frame) continue;
        if (oldest === null || t.seen < oldest.seen) oldest = t;
      }
      if (oldest === null || oldest.rt === null) return;
      this.dropTile(oldest);
    }
  }

  // ── 조각 바닥 그림 ──

  /** 조각 ci의 바닥 그림 (낡았으면 다시 만든다). */
  private chunkNode(ci: number): Container {
    const f = this.floors[ci] as ChunkFloor;
    if (f.node !== null && !f.dirty) return f.node;
    f.node?.destroy({ children: true });
    f.node = this.buildChunk(ci);
    f.dirty = false;
    return f.node;
  }

  /**
   * 조각 하나의 바닥: 풀밭 → 길·광장·경주로 테두리 → 속 → 경주로 표시 → 연못 → 광장 돌·조약돌 → 풀 한 포기.
   * 둘레 한 칸까지의 길·풀을 같이 그린다 (조각 경계를 넘는 테두리·둥근 모서리·풀이 이웃 조각 그림과 똑같이 맞물리게).
   */
  private buildChunk(ci: number): Container {
    const S = GROUND_STYLE;
    const node = new Container();
    const g = new Graphics();
    node.addChild(g);
    const ccx = ci % CHUNKS.w;
    const ccy = (ci - ccx) / CHUNKS.w;
    const wx0 = ccx * CS;
    const wy0 = ccy * CS;
    // 칸 범위 (둘레 한 칸).
    const gx0 = Math.max(0, ccx * CHUNK - 1);
    const gy0 = Math.max(0, ccy * CHUNK - 1);
    const gx1 = Math.min(GRID.w - 1, (ccx + 1) * CHUNK);
    const gy1 = Math.min(GRID.h - 1, (ccy + 1) * CHUNK);
    const road = this.road;
    const cells: number[] = [];
    for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) if (road(x, y)) cells.push(y * GRID.w + x);
    const verts = cellVertices(cells, GRID.w);
    const bx0 = wx0 - CELL;
    const by0 = wy0 - CELL;
    const bx1 = wx0 + CS + CELL;
    const by1 = wy0 + CS + CELL;
    const floors = this.floorShapes.filter((f) => hits(f.box, bx0, by0, bx1, by1));

    g.rect(bx0, by0, bx1 - bx0, by1 - by0).fill(S.grass);
    // 테두리
    drawRoadPass(g, road, cells, verts, GRID.w, 'edge');
    for (const f of floors) {
      if (f.kind === 'plaza') g.ellipse(f.cx, f.cy, f.rx + S.edge, f.ry + S.edge).fill(S.roadEdge);
      else if (f.kind === 'track') {
        const B = trackBand(f.race);
        g.ellipse(B.cx, B.cy, B.rxOut + S.edge, B.ryOut + S.edge).fill(S.roadEdge);
      }
    }
    // 속
    drawRoadPass(g, road, cells, verts, GRID.w, 'fill');
    for (const f of floors) if (f.kind === 'plaza') g.ellipse(f.cx, f.cy, f.rx, f.ry).fill(S.road);
    for (const f of floors) {
      if (f.kind !== 'track') continue;
      const B = trackBand(f.race);
      g.ellipse(B.cx, B.cy, B.rxOut, B.ryOut).fill(S.road);
      g.ellipse(B.cx, B.cy, B.rxIn, B.ryIn).fill(S.roadEdge);
      g.ellipse(B.cx, B.cy, B.rxIn - S.edge, B.ryIn - S.edge).fill(S.grass);
      drawTrackMarks(g, f.race);
    }
    for (const f of floors) {
      if (f.kind !== 'pond') continue;
      smoothPoly(g, f.pts).stroke({ width: S.edge * 2, color: S.roadEdge, join: 'round' });
      smoothPoly(g, f.pts).fill(S.pond);
    }
    // 건물 안 오솔길 (디딤돌).
    for (const f of floors) if (f.kind === 'walk') drawWalk(g, f);
    // 광장 돌, 조약돌 (길 칸, 광장 바닥 안 칸).
    drawPlazaSlabs(g, road, verts);
    for (const i of cells) {
      const x = i % GRID.w;
      drawRoadPebbles(g, road, x, (i - x) / GRID.w);
    }
    for (const f of floors) {
      if (f.kind !== 'plaza') continue;
      const x0 = Math.max(gx0, Math.floor((f.cx - f.rx) / CELL));
      const x1 = Math.min(gx1, Math.floor((f.cx + f.rx) / CELL));
      const y0 = Math.max(gy0, Math.floor((f.cy - f.ry) / CELL));
      const y1 = Math.min(gy1, Math.floor((f.cy + f.ry) / CELL));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (road(x, y)) continue;
          // 칸이 통째로 광장 타원 안 (가장자리에서 떨어져)일 때만.
          if (ellipseK(x * CELL + CELL / 2, y * CELL + CELL / 2, f.cx, f.cy, f.rx - CELL * 0.75, f.ry - CELL * 0.75) < 1) drawCellPebbles(g, x, y, 16);
        }
      }
    }
    // 풀 한 포기 (풀밭 칸만).
    for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) this.tuftCell(node, g, x, y);
    return node;
  }

  /** 칸 (x, y)가 풀을 심을 풀밭인가 (포장·바닥 그림 시설 발자국이 아니다). */
  private grassCell(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= GRID.w || y >= GRID.h) return false;
    if (this.road(x, y)) return false;
    if (this.walks[cellIndex(x, y)] === 1) return false;
    const p = this.village?.at(x, y);
    return p === undefined || !bareFloor(p.key);
  }

  /** 점이 풀밭 안인가 (가장자리 길에서 margin px 떨어져야). */
  private onGrass(px: number, py: number, margin: number): boolean {
    for (const [dx, dy] of CORNERS) {
      if (!this.grassCell(Math.floor((px + dx * margin) / CELL), Math.floor((py + dy * margin) / CELL))) return false;
    }
    return true;
  }

  private tuftCell(node: Container, g: Graphics, x: number, y: number): void {
    if (!this.grassCell(x, y)) return;
    const rng = this.rng;
    rng.state = hash2(x, y, SEED);
    const ok = rng.next() < TUFT_CHANCE;
    const tx = (x + 0.15 + rng.next() * 0.7) * CELL;
    const ty = (y + 0.25 + rng.next() * 0.7) * CELL;
    const s = 0.85 + rng.next() * 0.3;
    const flip = rng.next() < 0.5 ? -1 : 1;
    const pair = rng.next() < TUFT_PAIR_CHANCE;
    const px = tx + (rng.next() < 0.5 ? -1 : 1) * (26 + rng.next() * 16);
    const py = ty + (rng.next() - 0.5) * 18;
    if (!ok || !this.onGrass(tx, ty, 26)) return;
    this.tuft(node, g, tx, ty, s, flip);
    if (pair && this.onGrass(px, py, 26)) this.tuft(node, g, px, py, s * 0.85, -flip);
  }

  private tuft(node: Container, g: Graphics, x: number, y: number, s: number, flip: number): void {
    const tex = this.tuftTex;
    if (tex !== undefined) {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5, 1);
      sp.position.set(x, y);
      const k = (TUFT_W * s) / Math.max(1, tex.width);
      sp.scale.set(k * flip, k);
      node.addChild(sp);
      return;
    }
    // 짧은 획 셋 (가운데는 곧게, 양옆은 바깥으로).
    const f = flip;
    g.moveTo(x - 9 * s * f, y)
      .lineTo(x - 15 * s * f, y - 14 * s)
      .moveTo(x, y - 1 * s)
      .lineTo(x + 1 * s * f, y - 20 * s)
      .moveTo(x + 9 * s * f, y)
      .lineTo(x + 14 * s * f, y - 15 * s)
      .stroke({ width: 5.5 * s, color: GROUND_STYLE.tuft, cap: 'round' });
  }

  destroy(): void {
    for (const t of this.tiles) t?.rt?.destroy(true);
    for (const f of this.floors) f.node?.destroy({ children: true });
    this.bakeRt?.destroy(true);
    this.bakeRt = null;
    this.copySprite.destroy();
    this.node.destroy({ children: true });
  }
}

const CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
  [0, 0],
];

const SIDES: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function byScore(a: Tile, b: Tile): number {
  return a.score - b.score;
}
