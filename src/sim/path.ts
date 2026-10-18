// 길 찾기 (배치형 마을, DESIGN 6.1): 손님은 길 칸 위로만 걷는다. 결과는 세계 좌표 점들.
//   건물 안(발자국 안)에서 나가는 손님: 문(door) → 입구 앞 길 칸 → 길 칸들 (village.ts cellPath: 너비 우선, 꺾임이 적게) → 목적지 건물의 입구 앞 길 칸 → 문 → 안쪽 자리.
//   같은 건물 안이면 곧장. 길 칸끼리는 칸 가운데를 잇고, 손님마다 조금 비켜 걷는다 (lane: 한 줄로 겹치지 않게).
//   큰 시설 안에서 곧장 가면 경주로·연못을 가로지르는 길은 발자국 안쪽 둘레를 따라 돌아간다 (innerWay).
//   길 밖에 남은 손님 (지운 길·옮기거나 치운 건물·끊긴 길 조각): 되돌아가기 지도 (village.ts rescueCells: 끊긴 길을 따라 걷고 풀밭은 짧게,
//   건물은 지나지 않는다)로 걸을 수 있는 길에 돌아온 뒤 걷는다.
//   길로 이어지지 않은 목적지 (sim은 보내지 않는다: 안전망): 목적지에 가장 가까운 걸을 수 있는 길 칸까지만 (길 밖으로 나가지 않는다).

import type { CatalogKey } from '../data/catalog.ts';
import { footprint } from '../data/catalog.ts';
import { CELL, GRID, cellAt, cellIndex, type Pt } from '../data/map.ts';
import type { GameState, Placed } from './types.ts';
import { villageOf, type Village } from './village.ts';

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 점들을 따라 걷는 거리 (from에서 시작). */
export function pathLength(from: Pt, pts: readonly Pt[]): number {
  let d = 0;
  let at = from;
  for (const p of pts) {
    d += dist(at, p);
    at = p;
  }
  return d;
}

/** 손님마다 길 위에서 비켜 걷는 정도 (세계 px, 칸 가운데에서). */
const LANE_MAX = 22;
/** 큰 시설 안에서 돌아가는 둘레 길: 발자국 가장자리에서 이만큼 안쪽 (세계 px). */
const INSET = 36;

/** 손님 id → 길 위에서 비켜 걷는 자리 (가로·세로 따로, -LANE_MAX ~ LANE_MAX). */
export function laneOffset(id: number): Pt {
  const a = ((id * 2654435761) >>> 0) % 1000;
  const b = ((id * 40503 + 17) >>> 0) % 1000;
  return { x: (a / 999 - 0.5) * 2 * LANE_MAX, y: (b / 999 - 0.5) * 2 * LANE_MAX * 0.7 };
}

/** 점이 서 있는 건물 (발자국 안, 입구가 있는 것만: 손님이 드나드는 곳). 없으면 undefined. */
function buildingAt(v: Village, p: Pt): Placed | undefined {
  const c = cellAt(p);
  const q = v.at(c.x, c.y);
  return q !== undefined && footprint(q.key).entry !== undefined ? q : undefined;
}

/** 점이 선 칸 번호 (지도 밖이면 -1). */
function cellOf(p: Pt): number {
  const c = cellAt(p);
  return cellIndex(c.x, c.y);
}

/** 칸 번호 → 가운데 + 비켜 걷기. */
function laneAt(i: number, lane: Pt): Pt {
  const x = i % GRID.w;
  const y = Math.floor(i / GRID.w);
  return { x: x * CELL + CELL / 2 + lane.x, y: y * CELL + CELL / 2 + lane.y };
}

/** 꺾이는 칸만 남긴다 (곧은 길 가운데 칸은 뺀다). */
function corners(cells: readonly number[]): number[] {
  if (cells.length <= 2) return cells.slice();
  const out = [cells[0] as number];
  for (let k = 1; k < cells.length - 1; k++) {
    const a = cells[k - 1] as number;
    const b = cells[k] as number;
    const c = cells[k + 1] as number;
    if (b - a !== c - b) out.push(b);
  }
  out.push(cells[cells.length - 1] as number);
  return out;
}

// ── 큰 시설 안쪽 (경주로·연못을 가로지르지 않게) ──

interface Ellipse {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
}

/** 건물 안에서 손님이 가로지르면 안 되는 바닥 (경주로 띠 바깥 끝, 오리배 연못). 세계 좌표. */
function obstacles(v: Village, p: Placed): Ellipse[] {
  if (p.key === 'race') {
    const T = v.race();
    // 바깥 레인 바깥 끝까지 (레인 선 반 폭 + 조금).
    const o = ((T.lanes - 1) / 2 + 0.5) * T.laneWidth + 8;
    return [{ cx: T.center.x, cy: T.center.y, rx: T.rx + o, ry: T.ry + o * T.squash }];
  }
  if (p.key === 'boat') {
    const P = v.boat().pond;
    return [{ cx: P.c.x, cy: P.c.y, rx: P.rx * (1 + P.wobble * 0.15), ry: P.ry * (1 + P.wobble * 0.15) }];
  }
  return [];
}

/** 선분 a-b가 타원 e를 지나나 (타원을 단위원으로 펴서 원점까지의 거리). */
function crosses(e: Ellipse, a: Pt, b: Pt): boolean {
  const ax = (a.x - e.cx) / e.rx;
  const ay = (a.y - e.cy) / e.ry;
  const bx = (b.x - e.cx) / e.rx;
  const by = (b.y - e.cy) / e.ry;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  const px = ax + dx * t;
  const py = ay + dy * t;
  return px * px + py * py < 1;
}

/**
 * 건물 p 안에서 a → b로 가는 점들 (b 포함, a는 빼고). 곧장 가면 경주로·연못을 가로지르면 발자국 안쪽 둘레(INSET)를 따라 가까운 쪽으로 돌아간다.
 */
function innerWay(v: Village, p: Placed, a: Pt, b: Pt): Pt[] {
  const obs = obstacles(v, p);
  if (obs.length === 0 || !obs.some((e) => crosses(e, a, b))) return [{ x: b.x, y: b.y }];
  const fp = footprint(p.key);
  const x0 = p.x * CELL + INSET;
  const y0 = p.y * CELL + INSET;
  const x1 = (p.x + fp.w) * CELL - INSET;
  const y1 = (p.y + fp.h) * CELL - INSET;
  const W = x1 - x0;
  const H = y1 - y0;
  const per = 2 * (W + H);
  // 둘레 위치 s (0 = 왼쪽 위에서 시계 방향) ↔ 점.
  const at = (s: number): Pt => {
    const t = ((s % per) + per) % per;
    if (t < W) return { x: x0 + t, y: y0 };
    if (t < W + H) return { x: x1, y: y0 + (t - W) };
    if (t < 2 * W + H) return { x: x1 - (t - W - H), y: y1 };
    return { x: x0, y: y1 - (t - 2 * W - H) };
  };
  const proj = (q: Pt): number => {
    const cx = Math.max(x0, Math.min(x1, q.x));
    const cy = Math.max(y0, Math.min(y1, q.y));
    const d = [cy - y0, x1 - cx, y1 - cy, cx - x0];
    const k = d.indexOf(Math.min(...d));
    return k === 0 ? cx - x0 : k === 1 ? W + (cy - y0) : k === 2 ? W + H + (x1 - cx) : 2 * W + H + (y1 - cy);
  };
  const sa = proj(a);
  const sb = proj(b);
  const cw = (((sb - sa) % per) + per) % per;
  const dir = cw <= per - cw ? 1 : -1;
  const span = dir === 1 ? cw : per - cw;
  const out: Pt[] = [at(sa)];
  // 지나는 모서리.
  const cornersAt = [0, W, W + H, 2 * W + H];
  const passed: { s: number; k: number }[] = [];
  for (const c of cornersAt) {
    const k = dir === 1 ? (((c - sa) % per) + per) % per : (((sa - c) % per) + per) % per;
    if (k > 1e-6 && k < span - 1e-6) passed.push({ s: c, k });
  }
  passed.sort((x, y) => x.k - y.k);
  for (const c of passed) out.push(at(c.s));
  out.push(at(sb), { x: b.x, y: b.y });
  return out;
}

// ── 길 찾기 ──

/** 칸들 (되돌아가기)을 점으로: 첫 칸(지금 선 칸)은 빼고 꺾이는 칸 가운데만. 마지막 칸(걸을 수 있는 길)도 뺀다 (길 걷기가 이어 받는다). */
function rescuePts(cells: readonly number[]): Pt[] {
  if (cells.length <= 2) return [];
  return corners(cells.slice(1, -1)).map((c) => laneAt(c, { x: 0, y: 0 }));
}

/**
 * from에서 to까지 걷는 점들. via = to가 있는 건물 (부스·건물 key: 그 입구로 들어간다). 없으면 to가 선 칸으로 알아낸다
 * (건물 발자국 안이면 그 건물, 길 칸이면 그 칸). lane = 비켜 걷기 (laneOffset(손님 id)).
 * 길 밖에 선 손님은 먼저 걸을 수 있는 길로 돌아오고 (rescueCells), 이어지지 않은 목적지면 그 가까운 길 칸까지만 간다.
 */
export function route(state: GameState, from: Pt, to: Pt, via: CatalogKey | null = null, lane: Pt = { x: 0, y: 0 }): Pt[] {
  const v = villageOf(state);
  const target = { x: to.x, y: to.y };
  const fromB = buildingAt(v, from);
  const toB = via !== null ? v.placed(via) : buildingAt(v, to);
  // 같은 건물 안: 곧장 (경주로·연못은 돌아서).
  if (fromB !== undefined && toB !== undefined && fromB.id === toB.id) return innerWay(v, fromB, from, target);
  const pts: Pt[] = [];
  // 출발 길 칸.
  let start = -1;
  const fi = cellOf(from);
  if (v.isWalkable(fi)) start = fi;
  else {
    let cells: number[] | null = null;
    if (fromB !== undefined) {
      // 건물 안: 문으로 나가서 입구 칸 (입구가 끊겼으면 거기서 되돌아가기).
      const door = v.door(fromB.key);
      pts.push(...innerWay(v, fromB, from, door));
      const e = v.entryCellIndex(fromB);
      cells = v.rescueCells(e);
      if (cells !== null) cells = [fi, ...cells];
    } else cells = v.rescueCells(fi);
    if (cells !== null) {
      pts.push(...rescuePts(cells));
      start = cells[cells.length - 1] as number;
    } else {
      // 돌아갈 길이 없다 (안전망): 가장 가까운 길 칸으로 곧장.
      start = v.nearestWalkable(from);
    }
  }
  if (start < 0) return pts.length > 0 ? pts : [target];
  // 도착 길 칸.
  let end = -1;
  let tail: Pt[] = [target];
  if (toB !== undefined) {
    const e = v.entryCellIndex(toB);
    if (v.isWalkable(e)) {
      end = e;
      tail = innerWay(v, toB, v.door(toB.key), target);
      tail.unshift(v.door(toB.key));
    } else {
      // 이어지지 않은 건물: 그 입구에 가장 가까운 걸을 수 있는 길 칸까지만.
      const r = v.rescueCells(e >= 0 ? e : cellOf(target));
      end = r !== null ? (r[r.length - 1] as number) : v.nearestWalkable(target);
      tail = [];
    }
  } else {
    const ti = cellOf(to);
    if (v.isWalkable(ti)) end = ti;
    else {
      const r = v.rescueCells(ti);
      end = r !== null ? (r[r.length - 1] as number) : v.nearestWalkable(to);
      tail = [];
    }
  }
  if (end < 0) return pts.length > 0 ? pts : [target];
  const cells = v.cellPath(start, end);
  if (cells === null) return pts.length > 0 ? pts : [target];
  for (const c of corners(cells)) pts.push(laneAt(c, lane));
  // 길 칸 가운데에 서는 목적지 (돌아다니기)는 비켜 걷기 자리 대신 그 점으로.
  if (toB === undefined && tail.length === 1 && cellOf(to) === end) pts.pop();
  pts.push(...tail);
  // 지금 자리와 겹치는 첫 점은 뺀다.
  const first = pts[0];
  if (first !== undefined && dist(first, from) < 4 && pts.length > 1) pts.shift();
  return pts;
}

/**
 * 점 p에서 걸어 나설 걸을 수 있는 길 칸과 거기까지 더 걷는 칸 수 (건물 안이면 입구 칸 + 1, 길 밖이면 되돌아가기 칸 수). 길이 없으면 null.
 * 손님의 부스 고르기가 걷는 거리를 잴 때 쓴다 (길 칸 거리 = village.fieldTo).
 */
export function roadAnchor(state: GameState, p: Pt): { cell: number; extra: number } | null {
  const v = villageOf(state);
  const i = cellOf(p);
  if (v.isWalkable(i)) return { cell: i, extra: 0 };
  const b = buildingAt(v, p);
  if (b !== undefined) {
    const e = v.entryCellIndex(b);
    if (v.isWalkable(e)) return { cell: e, extra: 1 };
  }
  const r = v.rescueCells(i);
  return r === null ? null : { cell: r[r.length - 1] as number, extra: r.length - 1 };
}

/** 점 p(손님)에서 key 건물 입구까지 길 칸 수 (이어지지 않았으면 -1). */
export function walkCells(state: GameState, p: Pt, key: CatalogKey): number {
  const v = villageOf(state);
  const a = roadAnchor(state, p);
  const pl = v.placed(key);
  if (a === null || pl === undefined) return -1;
  const e = v.entryCellIndex(pl);
  if (!v.isWalkable(e)) return -1;
  const d = v.fieldTo(e)[a.cell] ?? -1;
  return d < 0 ? -1 : d + a.extra;
}

/** 손님이 서 있어도 되는 곳인가: 걸을 수 있는 길 칸이나 입구가 있는 건물 발자국 안 (길로만 걷기 검사·되돌아가기). */
export function onRoad(state: GameState, p: Pt): boolean {
  const v = villageOf(state);
  return v.isWalkable(cellOf(p)) || buildingAt(v, p) !== undefined;
}

/** 길 칸 i의 세계 사각형 안 무작위 점 (r = 0~1 난수 둘, 가운데에서 ±spread px). */
export function roadPoint(i: number, rx: number, ry: number, spread = 30): Pt {
  const x = i % GRID.w;
  const y = Math.floor(i / GRID.w);
  return { x: x * CELL + CELL / 2 + (rx - 0.5) * 2 * spread, y: y * CELL + CELL / 2 + (ry - 0.5) * 2 * spread * 0.7 };
}

/** 마을 입구 길 칸에서 길 칸 i까지 칸 거리 (닿지 못하면 -1). */
export function gateDistance(state: GameState, i: number): number {
  const v = villageOf(state);
  const g = v.placed('gate');
  const e = g === undefined ? -1 : v.entryCellIndex(g);
  if (e < 0 || !v.isWalkable(e)) return -1;
  return v.fieldTo(e)[i] ?? -1;
}

/** 건물 key의 발자국 안으로 점을 당긴다 (margin px 안쪽: 줄·계산대·기다리는 자리가 목록보다 많을 때 발자국 밖으로 나가지 않게). 놓이지 않았으면 그대로. */
export function clampInto(state: GameState, key: CatalogKey, p: Pt, margin = 24): Pt {
  const pl = villageOf(state).placed(key);
  if (pl === undefined) return p;
  const fp = footprint(key);
  const x0 = pl.x * CELL + margin;
  const y0 = pl.y * CELL + margin;
  const x1 = (pl.x + fp.w) * CELL - margin;
  const y1 = (pl.y + fp.h) * CELL - margin;
  return { x: Math.max(x0, Math.min(x1, p.x)), y: Math.max(y0, Math.min(y1, p.y)) };
}
