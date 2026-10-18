// 지도 화면이 같이 쓰는 작은 도구: 보이는 사각형, 상자, 경주로 띠·출발선, 씨앗 해시.
// 지도 크기는 data/map.ts WORLD, 놓인 건물·길의 세계 좌표 모양은 sim/village.ts (sim.village()).

import { RACE_GEO, type RaceGeo } from '../data/catalog.ts';
import { WORLD, lanePoint } from '../data/map.ts';

/** 세계 좌표 사각형 (x0,y0)~(x1,y1). 매 프레임 같은 객체를 고쳐 쓴다. */
export interface ViewRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function makeViewRect(): ViewRect {
  return { x0: 0, y0: 0, x1: WORLD.w, y1: WORLD.h };
}

/** 세계 좌표 상자. 정적인 물체의 가려 내기(culling)용. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function boxHits(b: Box, v: ViewRect): boolean {
  return b.x1 >= v.x0 && b.x0 <= v.x1 && b.y1 >= v.y0 && b.y0 <= v.y1;
}

/** 점과 선분 사이 거리. */
export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px;
  const qy = ay + dy * t - py;
  return Math.sqrt(qx * qx + qy * qy);
}

/** 타원 안 정도 (1 = 가장자리, 1보다 작으면 안). */
export function ellipseK(x: number, y: number, cx: number, cy: number, rx: number, ry: number): number {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy;
}

// ── 몬스터 경주장 경주로 (catalog.ts RACE_GEO, 세계 좌표는 sim.village().race()) ──

/** 경주로 모래 띠의 안쪽·바깥 가장자리 타원 (레인 가운데 선은 map.ts lanePoint, 띠 = 레인 넷의 폭). */
export function trackBand(T: RaceGeo): { cx: number; cy: number; rxIn: number; ryIn: number; rxOut: number; ryOut: number } {
  const half = (T.lanes / 2) * T.laneWidth;
  return { cx: T.center.x, cy: T.center.y, rxIn: T.rx - half, ryIn: T.ry - half * T.squash, rxOut: T.rx + half, ryOut: T.ry + half * T.squash };
}

/** 경주로 모래 띠 안인가 (pad만큼 띠를 양쪽으로 넓혀서 잰다). */
export function onTrack(T: RaceGeo, x: number, y: number, pad: number): boolean {
  const B = trackBand(T);
  if (ellipseK(x, y, B.cx, B.cy, B.rxOut + pad, B.ryOut + pad) >= 1) return false;
  return ellipseK(x, y, B.cx, B.cy, Math.max(1, B.rxIn - pad), Math.max(1, B.ryIn - pad)) > 1;
}

/** 출발대 그림 아래 끝에서 출발선까지 띄우는 거리 (세계 px): 선수가 출발대 앞(y가 더 큼)에 서야 그림에 가리지 않는다. */
const GATE_CLEAR = 6;

/**
 * 출발선의 경주로 p (lanePoint의 p): 모든 레인 점이 출발대 그림(RACE_GEO.gate) 아래 끝보다 GATE_CLEAR 아래로 내려온 첫 p.
 * 출발대는 경주로 왼쪽 끝(p = 0)에 서 있어서, 선수는 p = 0이 아니라 출발대 바로 앞의 이 선에서 출발한다. 경주장 안 상대 모양이라 놓인 자리와 상관없다.
 */
export const RACE_START_P = (() => {
  const need = RACE_GEO.gate.y + GATE_CLEAR;
  for (let p = 0; p < 0.25; p += 0.001) {
    let ok = true;
    for (let lane = 0; lane < RACE_GEO.lanes; lane++) if (lanePoint(RACE_GEO, lane, p).y < need) ok = false;
    if (ok) return p;
  }
  return 0;
})();

/** 경주로 한 바퀴의 p 길이 (출발 각에서 같은 각까지). */
export const RACE_LAP_P = (Math.PI * 2) / Math.abs(RACE_GEO.endAngle - RACE_GEO.startAngle);

/** sim 경주 진행(0 = 출발, 1 = 결승, 넘어도 된다) → 지도 경주로의 p (출발선 RACE_START_P ~ 결승선 1). */
export function raceTrackP(progress: number): number {
  return RACE_START_P + (1 - RACE_START_P) * progress;
}

/**
 * 출발대 그림(map/race_gate)을 좌우로 뒤집나: 그림의 칸은 왼쪽(뒤)부터 빨강·파랑·노랑·민트 = 선수 0~3 = 레인 0~3.
 * 출발점에서 레인 0(안쪽)이 레인 3보다 오른쪽이면 뒤집어야 선수가 자기 색 칸 앞에 선다.
 */
export const RACE_GATE_FLIP = lanePoint(RACE_GEO, 0, 0).x > lanePoint(RACE_GEO, RACE_GEO.lanes - 1, 0).x;

/** 정수 둘과 씨앗으로 32비트 해시 (타일·칸마다 같은 무작위를 다시 만들 때). */
export function hash2(a: number, b: number, seed: number): number {
  let h = (seed ^ Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) | 0;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 프레임 길이와 상관없이 같은 빠르기로 따라가는 lerp 비율. */
export function follow(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}
