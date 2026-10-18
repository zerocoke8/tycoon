// 마을 지도: 칸(격자)·땅 조각·바닥 색, 그리고 처음 마을 배치 (DESIGN 6.1 배치형 마을).
// 바닥(풀밭·길·광장·연못·경주로)은 그림 한 장이 아니라 코드로 그린다: Codex 바닥 그림(tools/art-raw/map/ground.png)에서 잰 색과 선 굵기 그대로.
// 건물·부스·장식의 모양(차지하는 칸, 입구, 안쪽 자리)은 data/catalog.ts (건물 기준 상대 좌표). 놓인 자리는 GameState.village (sim/village.ts).
//
// 격자: 지도는 CELL px 칸으로 나뉜다 (GRID.w × GRID.h). 칸 (x, y)의 세계 사각형 = (x·CELL, y·CELL) ~ ((x+1)·CELL, (y+1)·CELL).
// 땅 조각: CHUNK × CHUNK 칸. 처음 땅(LAND_START, 조각 좌표)만 가지고 시작하고, 이웃한 조각을 사서 넓힌다 (값·회관 레벨은 defs.ts LAND).
// 사지 않은 땅은 구름이 덮는다. 마을 입구(gate)는 처음 땅 아래 가장자리(= 지도 아래 끝)에 고정이고, 손님은 거기서 들어와 길 칸으로만 다닌다.
//
// 길 그리는 법 (화면 쪽): 길 칸마다 '테두리'(roadEdge, 칸 + 2×edge)를 먼저 다 그리고, 그 위에 '속'(road)을 다 그린다.
// 그래야 이어진 길 칸 사이에 선이 생기지 않는다 (바닥 그림처럼). 바깥 모서리는 둥글게.

import type { BoothId, BuildingId, DecorId } from './defs.ts';

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** 칸 좌표 (정수). */
export interface Cell {
  readonly x: number;
  readonly y: number;
}

/** 칸 한 변 (세계 px). */
export const CELL = 96;
/** 땅 조각 한 변 (칸). */
export const CHUNK = 8;
/** 지도 전체의 땅 조각 수 (가로 × 세로). */
export const CHUNKS = { w: 9, h: 8 } as const;
/** 지도 전체 칸 수. */
export const GRID = { w: CHUNKS.w * CHUNK, h: CHUNKS.h * CHUNK } as const;
/** 세계 크기 (px). */
export const WORLD = { w: GRID.w * CELL, h: GRID.h * CELL } as const;

/** 처음 가진 땅 (조각 좌표 사각형): 지도 아래 가운데 3×3 조각. */
export const LAND_START = { x: 3, y: 5, w: 3, h: 3 } as const;

/** 조각 (cx, cy)가 처음 땅에서 몇 조각 떨어졌나 (처음 땅 = 0, 바로 둘레 = 1, …). 값과 회관 레벨이 이 고리를 따른다. */
export function chunkRing(cx: number, cy: number): number {
  const L = LAND_START;
  const dx = cx < L.x ? L.x - cx : cx >= L.x + L.w ? cx - (L.x + L.w - 1) : 0;
  const dy = cy < L.y ? L.y - cy : cy >= L.y + L.h ? cy - (L.y + L.h - 1) : 0;
  return Math.max(dx, dy);
}

/** 칸 번호 (y × GRID.w + x). 지도 밖이면 -1. */
export function cellIndex(x: number, y: number): number {
  return x < 0 || y < 0 || x >= GRID.w || y >= GRID.h ? -1 : y * GRID.w + x;
}

/** 조각 번호 (cy × CHUNKS.w + cx). 지도 밖이면 -1. */
export function chunkIndex(cx: number, cy: number): number {
  return cx < 0 || cy < 0 || cx >= CHUNKS.w || cy >= CHUNKS.h ? -1 : cy * CHUNKS.w + cx;
}

/** 칸 가운데 (세계 px). */
export function cellCenter(x: number, y: number): Pt {
  return { x: x * CELL + CELL / 2, y: y * CELL + CELL / 2 };
}

/** 세계 점이 있는 칸. */
export function cellAt(p: Pt): Cell {
  return { x: Math.floor(p.x / CELL), y: Math.floor(p.y / CELL) };
}

/** 바닥 그림에서 잰 색과 선 (세계 px, 바닥 그림의 2배 크기 기준). */
export const GROUND_STYLE = {
  grass: 0x93b468,
  road: 0xebc68e,
  roadEdge: 0x402c1c,
  /** 길 테두리 굵기 (한쪽, 세계 px). 바닥 그림의 약 4px × 2. */
  edge: 7,
  /** 길 바깥 모서리 둥글기 (세계 px). */
  roadRound: 30,
  /** 길 위 작은 조약돌 점 색. */
  pebble: 0xd9b27a,
  /** 풀 한 포기(짧은 획 셋) 색. */
  tuft: 0x4f7a3f,
  pond: 0x74bae5,
} as const;

/**
 * 고리 모양 물길·경주로 (레인 여럿). 레인 i(0 = 안쪽 ~ lanes-1 = 바깥쪽)의 가운데 선: 중심에서 가로 rx + o, 세로 ry + o × squash (o = (i - (lanes-1)/2) × laneWidth).
 * 진행 p(0~1)의 각도 = startAngle + (endAngle - startAngle) × p (화면 좌표: 0 = 오른쪽, π/2 = 아래). 경주장 catalog.ts RACE_GEO, 오리배 BOAT_GEO.
 */
export interface LoopCourse {
  readonly center: Pt;
  readonly rx: number;
  readonly ry: number;
  readonly laneWidth: number;
  readonly lanes: number;
  readonly squash: number;
  readonly startAngle: number;
  readonly endAngle: number;
}

/** 고리 길 c의 레인 lane, 진행 p 자리와 그 점에서 나아가는 방향 (단위 벡터). p가 범위를 넘어도 같은 타원을 따라 계산한다. */
export function lanePoint(c: LoopCourse, lane: number, p: number): { x: number; y: number; dx: number; dy: number } {
  const o = (lane - (c.lanes - 1) / 2) * c.laneWidth;
  const rx = c.rx + o;
  const ry = c.ry + o * c.squash;
  const span = c.endAngle - c.startAngle;
  const a = c.startAngle + span * p;
  // 방향 = d(점)/dp.
  const tx = -Math.sin(a) * rx * span;
  const ty = Math.cos(a) * ry * span;
  const len = Math.hypot(tx, ty) || 1;
  return { x: c.center.x + Math.cos(a) * rx, y: c.center.y + Math.sin(a) * ry, dx: tx / len, dy: ty / len };
}

// ── 처음 마을 (새 게임, 옛 저장 옮기기의 바탕) ─────────────────────────────
// 처음 땅 = 칸 x 24~47, y 40~63. 아래 가운데 입구 → 큰길(x 35)이 위로 마을회관까지. 가운데 가로길(y 52)에 분수·슬롯·홀짝,
// 아래 가로길(y 58)에 빈 땅 셋: 왼쪽(x 24~28)·오른쪽(x 36~40) 부스 자리 (5×5)와 전당포 자리 (x 29~33, 5×4).
// 공방·창고·사무소는 손님이 들르지 않아 길이 필요 없다. 더 놓으려면 땅을 넓힌다.

/** 처음 마을에 놓는 건물·부스 (칸 = 건물 왼쪽 위 칸). */
export const DEFAULT_PLACED: readonly { readonly key: BoothId | BuildingId; readonly x: number; readonly y: number }[] = [
  { key: 'gate', x: 32, y: 61 },
  { key: 'hall', x: 32, y: 40 },
  { key: 'workshop', x: 24, y: 40 },
  { key: 'warehouse', x: 39, y: 41 },
  { key: 'fountain', x: 28, y: 47 },
  { key: 'slot', x: 37, y: 47 },
  { key: 'oddeven', x: 42, y: 47 },
  { key: 'office', x: 41, y: 53 },
];

/** 처음 마을의 길 (칸 사각형들: x0~x1, y0~y1 모두 포함). */
export const DEFAULT_ROADS: readonly { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }[] = [
  // 입구 → 마을회관 큰길
  { x0: 35, y0: 46, x1: 35, y1: 60 },
  // 가운데 가로길 (분수·슬롯·홀짝 앞)
  { x0: 24, y0: 52, x1: 47, y1: 52 },
  // 아래 가로길 (빈 땅 셋 앞)
  { x0: 24, y0: 58, x1: 41, y1: 58 },
];

/** 처음 마을의 장식 (칸 하나씩, 빈 땅을 비워 둔다. 땅 가장자리 줄은 구름이 살짝 덮어 비운다). */
export const DEFAULT_DECOR: readonly { readonly key: DecorId; readonly x: number; readonly y: number }[] = [
  { key: 'tree_pine', x: 25, y: 46 },
  { key: 'tree_round', x: 26, y: 50 },
  { key: 'flowers', x: 34, y: 49 },
  { key: 'planter', x: 34, y: 46 },
  { key: 'lamp', x: 34, y: 53 },
  { key: 'lamp', x: 36, y: 51 },
  { key: 'bench', x: 25, y: 59 },
  { key: 'flowers', x: 36, y: 59 },
  { key: 'bush', x: 43, y: 59 },
  { key: 'tree_pine', x: 26, y: 61 },
  { key: 'tree_round', x: 45, y: 61 },
  { key: 'tree_round', x: 46, y: 59 },
];

/** 처음 마을에서 전당포를 놓을 빈 땅 (자동 배치가 먼저 본다). */
export const DEFAULT_LOTS: Partial<Record<BoothId | BuildingId, Cell>> = { pawnshop: { x: 29, y: 54 } };
