// 지도 화면이 같이 쓰는 작은 도구: 보이는 사각형, 구역 찾기, 길·광장·연못·경주로 안인지 재기, 경주로 출발선, 씨앗 해시.
// 지도 크기·배치는 data/map.ts만 본다 (세계가 커져도 그대로 돈다).

import { DISTRICTS, PLAZAS, PONDS, RACE_TRACK, ROADS, WORLD, trackPoint, type DistrictId, type Pt } from '../data/map.ts';

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

export const DISTRICT_IDS = Object.keys(DISTRICTS) as DistrictId[];

/** 점이 속한 구역 (DISTRICTS 순서로 처음 맞는 것). 어느 구역에도 없으면 null. */
export function districtAt(x: number, y: number): DistrictId | null {
  for (const id of DISTRICT_IDS) {
    const r = DISTRICTS[id].rect;
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return id;
  }
  return null;
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

/** 가장 가까운 길 속 가장자리까지 거리 (음수 = 길 안). 테두리는 빼고 잰다. */
export function roadSignedDist(x: number, y: number): number {
  let best = Infinity;
  for (const r of ROADS) {
    const pts = r.pts;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i] as Pt;
      const b = pts[i + 1] as Pt;
      const d = segDist(x, y, a.x, a.y, b.x, b.y) - r.w / 2;
      if (d < best) best = d;
    }
  }
  return best;
}

/** 타원 안 정도 (1 = 가장자리, 1보다 작으면 안). pad만큼 반지름을 키워서 잰다. */
function ellipseK(x: number, y: number, cx: number, cy: number, rx: number, ry: number): number {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy;
}

export function inPlaza(x: number, y: number, pad: number): boolean {
  for (const p of PLAZAS) if (ellipseK(x, y, p.c.x, p.c.y, p.rx + pad, p.ry + pad) < 1) return true;
  return false;
}

export function inPond(x: number, y: number, pad: number): boolean {
  // 연못은 울퉁불퉁하게 그려서 반지름보다 조금 커질 수 있다 (약 12%).
  for (const p of PONDS) if (ellipseK(x, y, p.c.x, p.c.y, p.rx * 1.14 + pad, p.ry * 1.14 + pad) < 1) return true;
  return false;
}

// ── 몬스터 경주장 경주로 (map.ts RACE_TRACK) ──

/** 경주로 모래 띠의 안쪽·바깥 가장자리 타원 (레인 가운데 선은 map.ts trackPoint, 띠 = 레인 넷의 폭). */
export const TRACK_BAND = (() => {
  const T = RACE_TRACK;
  const half = (T.lanes / 2) * T.laneWidth;
  return { cx: T.center.x, cy: T.center.y, rxIn: T.rx - half, ryIn: T.ry - half * T.squash, rxOut: T.rx + half, ryOut: T.ry + half * T.squash };
})();

/** 경주로 모래 띠 안인가 (pad만큼 띠를 양쪽으로 넓혀서 잰다). */
export function onTrack(x: number, y: number, pad: number): boolean {
  const B = TRACK_BAND;
  if (ellipseK(x, y, B.cx, B.cy, B.rxOut + pad, B.ryOut + pad) >= 1) return false;
  return ellipseK(x, y, B.cx, B.cy, Math.max(1, B.rxIn - pad), Math.max(1, B.ryIn - pad)) > 1;
}

/** 출발대 그림 아래 끝에서 출발선까지 띄우는 거리 (세계 px): 선수가 출발대 앞(y가 더 큼)에 서야 그림에 가리지 않는다. */
const GATE_CLEAR = 6;

/**
 * 출발선의 경주로 p (trackPoint의 p): 모든 레인 점이 출발대 그림(RACE_TRACK.gate) 아래 끝보다 GATE_CLEAR 아래로 내려온 첫 p.
 * 출발대는 경주로 왼쪽 끝(p = 0)에 서 있어서, 선수는 p = 0이 아니라 출발대 바로 앞의 이 선에서 출발한다.
 */
export const RACE_START_P = (() => {
  const need = RACE_TRACK.gate.y + GATE_CLEAR;
  for (let p = 0; p < 0.25; p += 0.001) {
    let ok = true;
    for (let lane = 0; lane < RACE_TRACK.lanes; lane++) if (trackPoint(lane, p).y < need) ok = false;
    if (ok) return p;
  }
  return 0;
})();

/** 경주로 한 바퀴의 p 길이 (출발 각에서 같은 각까지). */
export const RACE_LAP_P = (Math.PI * 2) / Math.abs(RACE_TRACK.endAngle - RACE_TRACK.startAngle);

/** sim 경주 진행(0 = 출발, 1 = 결승, 넘어도 된다) → 지도 경주로의 p (출발선 RACE_START_P ~ 결승선 1). */
export function raceTrackP(progress: number): number {
  return RACE_START_P + (1 - RACE_START_P) * progress;
}

/**
 * 출발대 그림(map/race_gate)을 좌우로 뒤집나: 그림의 칸은 왼쪽(뒤)부터 빨강·파랑·노랑·민트 = 선수 0~3 = 레인 0~3.
 * 출발점에서 레인 0(안쪽)이 레인 3보다 오른쪽이면 뒤집어야 선수가 자기 색 칸 앞에 선다.
 */
export const RACE_GATE_FLIP = trackPoint(0, 0).x > trackPoint(RACE_TRACK.lanes - 1, 0).x;

/** 길·광장·연못·경주로가 아닌 풀밭인가 (margin만큼 떨어져야). */
export function onGrass(x: number, y: number, margin: number): boolean {
  if (x < 0 || y < 0 || x > WORLD.w || y > WORLD.h) return false;
  if (roadSignedDist(x, y) < margin) return false;
  if (inPlaza(x, y, margin)) return false;
  if (inPond(x, y, margin)) return false;
  if (onTrack(x, y, margin)) return false;
  return true;
}

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
