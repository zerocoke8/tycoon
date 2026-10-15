// 길 찾기: data/map.ts의 NODES/EDGES 그래프에서 최단 경로 (Dijkstra). 닫힌 구역의 노드는 지나지 않는다.
// 결과는 세계 좌표 점들: 가까운 노드 → … → 목적지 노드 → 정확한 목적지 점 (자리·줄·쉼터).

import { BOOTH_SPOTS, DISTRICTS, EDGES, NODES, type DistrictId, type NodeId, type Pt } from '../data/map.ts';

export const NODE_IDS = Object.keys(NODES) as NodeId[];

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const ADJ = new Map<NodeId, { to: NodeId; w: number }[]>();
for (const id of NODE_IDS) ADJ.set(id, []);
for (const [a, b] of EDGES) {
  const w = dist(NODES[a], NODES[b]);
  ADJ.get(a)?.push({ to: b, w });
  ADJ.get(b)?.push({ to: a, w });
}

/** 점이 속한 구역 (구역 사각형 안). 여러 곳에 걸치면 가장 늦게 열리는 구역, 어디에도 없으면 null (늘 열림). */
export function districtAt(p: Pt): DistrictId | null {
  let found: DistrictId | null = null;
  for (const [did, d] of Object.entries(DISTRICTS) as [DistrictId, (typeof DISTRICTS)[DistrictId]][]) {
    const r = d.rect;
    if (p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) continue;
    if (found === null || d.hall > DISTRICTS[found].hall) found = did;
  }
  return found;
}

const NODE_DISTRICT = new Map<NodeId, DistrictId | null>();
for (const id of NODE_IDS) NODE_DISTRICT.set(id, districtAt(NODES[id]));

export function pointOpen(p: Pt, open: readonly DistrictId[]): boolean {
  const d = districtAt(p);
  return d === null || open.includes(d);
}

export function nodeOpen(id: NodeId, open: readonly DistrictId[]): boolean {
  const d = NODE_DISTRICT.get(id) ?? null;
  return d === null || open.includes(d);
}

export function openNodes(open: readonly DistrictId[]): NodeId[] {
  return NODE_IDS.filter((id) => nodeOpen(id, open));
}

/** p에서 가까운 열린 노드 k개. */
export function nearestNodes(p: Pt, open: readonly DistrictId[], k: number): NodeId[] {
  return openNodes(open)
    .map((id) => ({ id, d: dist(p, NODES[id]) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map((e) => e.id);
}

interface Search {
  d: Map<NodeId, number>;
  prev: Map<NodeId, NodeId | null>;
}

/** 여러 출발점(처음 비용 포함)에서 Dijkstra. 노드가 적어 단순한 배열 탐색으로 충분하다. */
function dijkstra(sources: readonly { id: NodeId; cost: number }[], open: readonly DistrictId[]): Search {
  const d = new Map<NodeId, number>();
  const prev = new Map<NodeId, NodeId | null>();
  const done = new Set<NodeId>();
  for (const s of sources) {
    if (!nodeOpen(s.id, open)) continue;
    if (s.cost < (d.get(s.id) ?? Infinity)) {
      d.set(s.id, s.cost);
      prev.set(s.id, null);
    }
  }
  for (;;) {
    let cur: NodeId | null = null;
    let best = Infinity;
    for (const [id, v] of d) {
      if (!done.has(id) && v < best) {
        best = v;
        cur = id;
      }
    }
    if (cur === null) break;
    done.add(cur);
    for (const e of ADJ.get(cur) ?? []) {
      if (done.has(e.to) || !nodeOpen(e.to, open)) continue;
      const nd = best + e.w;
      if (nd < (d.get(e.to) ?? Infinity)) {
        d.set(e.to, nd);
        prev.set(e.to, cur);
      }
    }
  }
  return { d, prev };
}

/** 노드에서 다른 열린 노드까지 길 거리. */
export function distancesFrom(id: NodeId, open: readonly DistrictId[]): Map<NodeId, number> {
  return dijkstra([{ id, cost: 0 }], open).d;
}

/** 이보다 가까우면 그래프를 타지 않고 곧장 걷는다. */
const DIRECT_PX = 180;

/**
 * 부스 그림이 서 있는 땅 (BOOTH_SPOTS.base = 그림 아래 가운데, 부스 그림 폭 약 400px·높이 약 350px의 안쪽).
 * 그 위를 걷는 손님은 그림 뒤로 숨으므로, 길의 첫 직선(지금 자리 → 첫 노드)과 마지막 직선(노드 → 목적지)이 가로지르지 않게 고른다.
 * 바닥에 깔리는 부스 그림(BoothSpot.flat: 씨름 모래판·오리배 선착장)은 그 위를 걸어도 되니 뺀다.
 */
const BOOTH_BODY = { halfW: 175, top: 300, bottom: 12 } as const;
const BODIES = Object.values(BOOTH_SPOTS)
  .filter((s) => s.flat !== true)
  .map((s) => ({ x0: s.base.x - BOOTH_BODY.halfW, x1: s.base.x + BOOTH_BODY.halfW, y0: s.base.y - BOOTH_BODY.top, y1: s.base.y - BOOTH_BODY.bottom }));
type Rect = (typeof BODIES)[number];

function inRect(p: Pt, r: Rect): boolean {
  return p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
}

/** 선분 a→b가 사각형을 지나나 (Liang–Barsky). */
function segHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, a.x - r.x0) && clip(dx, r.x1 - a.x) && clip(-dy, a.y - r.y0) && clip(dy, r.y1 - a.y);
}

/** a에서 b로 곧장 걸으면 부스 그림 뒤를 지나나 (a나 b가 그 땅 안이면 그 부스는 빼고). */
export function crossesBooth(a: Pt, b: Pt): boolean {
  return BODIES.some((r) => !inRect(a, r) && !inRect(b, r) && segHitsRect(a, b, r));
}

/** 가까운 노드 k개 가운데 그 노드까지(또는 그 노드에서) 곧장 걸어도 부스 그림 뒤를 지나지 않는 것. 하나도 없으면 가까운 k개 그대로. */
function clearNodes(p: Pt, open: readonly DistrictId[], k: number, toward: boolean): NodeId[] {
  const near = nearestNodes(p, open, k + 3);
  const ok = near.filter((id) => !(toward ? crossesBooth(p, NODES[id]) : crossesBooth(NODES[id], p))).slice(0, k);
  return ok.length > 0 ? ok : near.slice(0, k);
}

/**
 * from에서 to까지 걷는 점들. via를 주면 그 노드를 마지막으로 거쳐 to로 간다 (부스 앞 노드 등).
 * 길이 없으면 곧장 to로 (손님이 멈춰 버리지 않게).
 */
export function route(from: Pt, to: Pt, open: readonly DistrictId[], via?: NodeId): Pt[] {
  const target = { x: to.x, y: to.y };
  const direct = dist(from, to);
  const clear = !crossesBooth(from, target);
  if (direct < DIRECT_PX && clear) return [target];
  const sources = clearNodes(from, open, 3, true).map((id) => ({ id, cost: dist(from, NODES[id]) }));
  if (sources.length === 0) return [target];
  const { d, prev } = dijkstra(sources, open);
  const ends = via !== undefined ? [via] : clearNodes(target, open, 3, false);
  let end: NodeId | null = null;
  let endCost = Infinity;
  for (const e of ends) {
    const c = (d.get(e) ?? Infinity) + dist(NODES[e], to);
    if (c < endCost) {
      endCost = c;
      end = e;
    }
  }
  if (end === null || !Number.isFinite(endCost)) return [target];
  // 그래프가 크게 돌아가고 목적지가 가까우면 풀밭을 가로질러 곧장.
  if (via === undefined && clear && direct < 520 && direct <= endCost * 0.7) return [target];
  const ids: NodeId[] = [];
  for (let n: NodeId | null = end; n !== null; n = prev.get(n) ?? null) ids.unshift(n);
  const pts: Pt[] = ids.map((id) => ({ x: NODES[id].x, y: NODES[id].y }));
  const first = pts[0];
  if (first !== undefined && dist(first, from) < 8) pts.shift();
  const last = pts[pts.length - 1];
  if (last === undefined || dist(last, target) > 1) pts.push(target);
  return pts;
}
