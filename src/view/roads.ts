// 길 칸 그리기 (DESIGN 6.1 배치형 마을, 바닥 그림 map/ground 화풍). ground.ts가 땅 조각마다 굽고, 짓기 모드 미리보기도 같은 모양을 쓴다.
//  - 그리는 순서: 모든 테두리(속 모양을 GROUND_STYLE.edge만큼 키운 것) 먼저, 속 나중 → 이어진 칸 사이·땅 조각 사이에 선이 생기지 않는다.
//  - 바깥 모서리(두 변이 다 열린 모서리)는 둥글게 (GROUND_STYLE.roadRound).
//  - 꺾임·갈림길의 안쪽 모서리(꼭짓점 둘레 네 칸 중 셋이 길)는 빈 칸 쪽으로 부드럽게 휘어 들어간다 (ROAD_FILLET, 바닥 그림의 갈림길처럼).
//  - 2×2 이상 뭉친 길 칸 = 광장: 모래가 넓게 이어지고, 안쪽 꼭짓점(네 칸이 다 길)에 납작한 돌을 드문드문 깐다.
//  - 조약돌 점: 길 칸마다 씨앗 난수로 0~2개 (열린 변에서 떨어지게). 칸마다 같은 씨앗이라 어느 조각에서 굽든 같은 자리.

import type { Graphics } from 'pixi.js';
import { CELL, GROUND_STYLE } from '../data/map.ts';
import { Rng } from '../core/rng.ts';
import { hash2 } from './mapUtil.ts';

/** 칸 (x, y)가 길(포장)인가. 지도 밖은 false. */
export type RoadTest = (x: number, y: number) => boolean;

/** 안쪽 모서리 휨 반지름 (세계 px). 테두리(edge)보다 커야 한다. */
export const ROAD_FILLET = 34;
/** 광장 돌 색 (모래보다 조금 밝게)과 그 테두리. */
const SLAB = 0xf5dcae;
const SLAB_EDGE = 0xcf9f63;
const SLAB_CHANCE = 0.4;
/** 길 칸마다 조약돌 시도 수와 한 번에 놓일 확률. */
const PEBBLE_TRIES = 2;
const PEBBLE_CHANCE = 0.5;
const SEED_PEBBLE = 0x51ab;
const SEED_SLAB = 0x7a11;
/** 휨 둥근 선을 몇 조각으로 (90도). */
const ARC_STEPS = 8;

const rng = new Rng(1);

/** 길 칸 (cx, cy) 하나의 모양 (바깥 모서리만 둥글게). grow = 테두리만큼 키우기. */
export function roadCellPath(g: Graphics, road: RoadTest, cx: number, cy: number, grow: number): Graphics {
  const n = road(cx, cy - 1);
  const e = road(cx + 1, cy);
  const s = road(cx, cy + 1);
  const w = road(cx - 1, cy);
  const r = GROUND_STYLE.roadRound + grow;
  const x0 = cx * CELL - grow;
  const y0 = cy * CELL - grow;
  const x1 = (cx + 1) * CELL + grow;
  const y1 = (cy + 1) * CELL + grow;
  if (n || e || s || w) {
    // 이웃이 있으면 둥근 모서리는 많아야 둘: roundShape로.
    return g.roundShape(
      [
        { x: x0, y: y0, radius: !n && !w ? r : 0 },
        { x: x1, y: y0, radius: !n && !e ? r : 0 },
        { x: x1, y: y1, radius: !s && !e ? r : 0 },
        { x: x0, y: y1, radius: !s && !w ? r : 0 },
      ],
      0,
    );
  }
  // 홀로 있는 칸: 둥근 네모.
  return g.roundRect(x0, y0, x1 - x0, y1 - y0, r);
}

/**
 * 꼭짓점 (vx, vy)(칸 금이 만나는 점, 칸 좌표)의 안쪽 모서리 휨. 둘레 네 칸 중 셋이 길이면 빈 칸 쪽으로 휘어 들어가는 모양을 그리고 true.
 * grow = 테두리만큼 키우기 (휜 선이 빈 칸 쪽으로 grow만큼 더 들어온다).
 */
export function roadFilletPath(g: Graphics, road: RoadTest, vx: number, vy: number, grow: number): boolean {
  const nw = road(vx - 1, vy - 1);
  const ne = road(vx, vy - 1);
  const sw = road(vx - 1, vy);
  const se = road(vx, vy);
  if (+nw + +ne + +sw + +se !== 3) return false;
  // 빈 칸 쪽 (sx, sy).
  const sx = !ne || !se ? 1 : -1;
  const sy = !sw || !se ? 1 : -1;
  const R = ROAD_FILLET;
  const rho = R - grow;
  const X = vx * CELL;
  const Y = vy * CELL;
  // 원 가운데 C = V + (sx, sy)·R. 휜 선은 C에서 -uy 쪽 점부터 -ux 쪽 점까지 (V에 가까운 90도).
  const cx = X + sx * R;
  const cy = Y + sy * R;
  const a1 = Math.atan2(-sy, 0);
  const mid = Math.atan2(-sy, -sx);
  let d = mid - a1;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const pts: number[] = [];
  // 길 쪽으로 1px 겹친다 (이웃 칸 속과 맞닿는 곳에 틈이 없게).
  pts.push(X - sx, Y - sy, X + sx * R, Y - sy);
  for (let k = 0; k <= ARC_STEPS; k++) {
    const a = a1 + (2 * d * k) / ARC_STEPS;
    pts.push(cx + Math.cos(a) * rho, cy + Math.sin(a) * rho);
  }
  pts.push(X - sx, Y + sy * R);
  g.poly(pts, true);
  return true;
}

/** 칸 번호 목록 → 꼭짓점 (칸 좌표) 목록 (겹치지 않게). gw = 지도 칸 폭. */
export function cellVertices(cells: readonly number[], gw: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  const vw = gw + 1;
  for (const i of cells) {
    const x = i % gw;
    const y = (i - x) / gw;
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const k = (y + dy) * vw + (x + dx);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(x + dx, y + dy);
      }
    }
  }
  return out;
}

/**
 * 길 칸들의 한 겹: pass 'edge' = 테두리 (키운 모양, roadEdge 색), 'fill' = 속 (road 색). 두 겹을 다른 바닥 모양과 같은 순서로 그린다.
 * cells = 칸 번호 (gw로 나눠 좌표), verts = cellVertices(cells).
 */
export function drawRoadPass(g: Graphics, road: RoadTest, cells: readonly number[], verts: readonly number[], gw: number, pass: 'edge' | 'fill'): void {
  if (cells.length === 0) return;
  const S = GROUND_STYLE;
  const grow = pass === 'edge' ? S.edge : 0;
  const color = pass === 'edge' ? S.roadEdge : S.road;
  for (const i of cells) {
    const x = i % gw;
    roadCellPath(g, road, x, (i - x) / gw, grow).fill(color);
  }
  for (let k = 0; k < verts.length; k += 2) {
    if (roadFilletPath(g, road, verts[k] as number, verts[k + 1] as number, grow)) g.fill(color);
  }
}

/** 광장 돌: 네 칸이 다 길인 꼭짓점마다 (씨앗 난수로 드문드문) 납작한 돌 한두 개. */
export function drawPlazaSlabs(g: Graphics, road: RoadTest, verts: readonly number[]): void {
  for (let k = 0; k < verts.length; k += 2) {
    const vx = verts[k] as number;
    const vy = verts[k + 1] as number;
    if (!(road(vx - 1, vy - 1) && road(vx, vy - 1) && road(vx - 1, vy) && road(vx, vy))) continue;
    rng.state = hash2(vx, vy, SEED_SLAB);
    if (rng.next() >= SLAB_CHANCE) continue;
    const roll = rng.next();
    const n = roll < 0.15 ? 3 : roll < 0.55 ? 2 : 1;
    const X = vx * CELL + (rng.next() - 0.5) * 26;
    const Y = vy * CELL + (rng.next() - 0.5) * 20;
    for (let s = 0; s < n; s++) {
      const r = (s === 0 ? 20 : 13) + rng.next() * 6;
      // 둘째·셋째 돌은 첫 돌 둘레에 (서로 겹치지 않게 반대쪽으로).
      const side = s === 1 ? (rng.next() < 0.5 ? -1 : 1) : 0;
      const ox = s === 0 ? 0 : s === 1 ? side * (31 + rng.next() * 8) : (rng.next() - 0.5) * 20;
      const oy = s === 0 ? 0 : s === 1 ? (rng.next() - 0.5) * 18 : (rng.next() < 0.5 ? -1 : 1) * (26 + rng.next() * 6);
      slab(g, X + ox, Y + oy, r, r * (0.66 + rng.next() * 0.14));
    }
  }
}

/** 납작한 돌 하나 (울퉁불퉁한 둥근 덩어리, 얇은 테두리). */
function slab(g: Graphics, x: number, y: number, rx: number, ry: number): void {
  const n = 7;
  const pts: number[] = [];
  const p0 = rng.next() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = p0 + (i / n) * Math.PI * 2;
    const k = 0.84 + rng.next() * 0.22;
    pts.push(x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k);
  }
  smoothPoly(g, pts);
  g.fill(SLAB).stroke({ width: 4, color: SLAB_EDGE, join: 'round' });
}

/** 점들을 지나는 매끈한 닫힌 곡선 (중점 사이를 2차 곡선으로). */
export function smoothPoly(g: Graphics, pts: readonly number[]): Graphics {
  const n = pts.length / 2;
  const px = (i: number): number => pts[((i + n) % n) * 2] as number;
  const py = (i: number): number => pts[((i + n) % n) * 2 + 1] as number;
  g.moveTo((px(-1) + px(0)) / 2, (py(-1) + py(0)) / 2);
  for (let i = 0; i < n; i++) g.quadraticCurveTo(px(i), py(i), (px(i) + px(i + 1)) / 2, (py(i) + py(i + 1)) / 2);
  return g.closePath();
}

/** 길 칸 (cx, cy)의 조약돌 점 (열린 변에서 inset px 떨어지게). */
export function drawRoadPebbles(g: Graphics, road: RoadTest, cx: number, cy: number): void {
  rng.state = hash2(cx, cy, SEED_PEBBLE);
  const inset = 18;
  const lx = road(cx - 1, cy) ? 6 : inset;
  const rx0 = road(cx + 1, cy) ? 6 : inset;
  const ty = road(cx, cy - 1) ? 6 : inset;
  const by = road(cx, cy + 1) ? 6 : inset;
  for (let k = 0; k < PEBBLE_TRIES; k++) {
    // 받아들이든 말든 난수를 같은 수만큼 쓴다 (그래야 이웃이 바뀌어도 자리가 늘 같다).
    const ok = rng.next() < PEBBLE_CHANCE;
    const fx = rng.next();
    const fy = rng.next();
    const rx = 6 + rng.next() * 4;
    const ry = rx * (0.62 + rng.next() * 0.15);
    if (!ok) continue;
    const x = cx * CELL + lx + fx * (CELL - lx - rx0);
    const y = cy * CELL + ty + fy * (CELL - ty - by);
    g.ellipse(x, y, rx, ry).fill(GROUND_STYLE.pebble);
  }
}

/** 칸 사각형 하나 안 아무 데나 조약돌 (광장 바닥 모양 안 등, 이미 고른 칸). */
export function drawCellPebbles(g: Graphics, cx: number, cy: number, inset: number): void {
  rng.state = hash2(cx, cy, SEED_PEBBLE ^ 0x33);
  for (let k = 0; k < PEBBLE_TRIES; k++) {
    const ok = rng.next() < PEBBLE_CHANCE * 0.8;
    const fx = rng.next();
    const fy = rng.next();
    const rx = 6 + rng.next() * 4;
    const ry = rx * (0.62 + rng.next() * 0.15);
    if (!ok) continue;
    g.ellipse(cx * CELL + inset + fx * (CELL - 2 * inset), cy * CELL + inset + fy * (CELL - 2 * inset), rx, ry).fill(GROUND_STYLE.pebble);
  }
}
