// 배치형 마을 (DESIGN 6.1)의 순수 도구. 상태는 GameState.village (types.ts VillageState). 화면·DOM을 모른다.
//  - villageOf(state): 칸 지도 (가진 땅·차지·길·입구), 길의 이어짐 (마을 입구에서), 세계 좌표 모양. village.rev가 바뀔 때만 다시 만든다.
//    세계 좌표 모양 = catalog.ts의 상대 좌표 + 놓인 칸 × CELL (booth·race·boat·kite·tug·dig·ring·shop·yard·rest·gateSpawn·chief·art).
//    놓이지 않은 것은 지도 밖 먼 곳(OFF)에 둔 모양을 준다 (화면은 놓였는지 placed(key)로 보고 숨긴다).
//  - 놓기 검사 checkPlace, 길 칸 검사 roadPaintable, 땅 조각 chunkInfo, 바꾸기 (addPlaced·movePlaced·removePlaced·setRoads·addChunk: rev를 올린다).
//  - 자동 배치 findSpot (자리 + 이어 줄 길): 옛 저장 옮기기·sim-check 촌장·개발용 ?all=1.
//  - 길찾기 바탕 (sim/path.ts route가 쓴다): 길 칸 사이 최단 칸 길 cellPath (너비 우선, 목적지마다 거리 지도를 길이 바뀔 때까지 둔다).
// 손님은 길 칸 위로만 걷고, 건물 입구 앞 길 칸에서 문(door)으로 들어가 안쪽 자리로 간다. 입구가 길로 마을 입구와 이어지지 않은 건물엔 손님이 오지 않는다.

import { BOOTH_LAYOUT, BUILDING_LAYOUT, CHIEF_AT, DECOR_BASE, DIG_GEO, FOUNTAIN_REST, GATE_SPAWN, KITE_GEO, RACE_GEO, SHOP_GEO, SSIREUM_GEO, TUG_GEO, YARD_GEO, BOAT_GEO, artBase, catalogKind, footprint, type BoothSpot, type CatalogKey, type DigGeo, type KiteGeo, type PondShape, type RaceGeo, type Rect, type RingGeo, type ShopGeo, type TugGeo, type WorkFacilitySpot, type YardGeo } from '../data/catalog.ts';
import { DECOR, DECOR_AURA, LAND, WORK_FACILITIES, type BoothId, type BuildingId, type DecorId, type WorkFacility } from '../data/defs.ts';
import { CELL, CHUNK, CHUNKS, DEFAULT_DECOR, DEFAULT_PLACED, DEFAULT_ROADS, GRID, LAND_START, cellCenter, cellIndex, chunkIndex, chunkRing, type Cell, type LoopCourse, type Pt } from '../data/map.ts';
import type { GameState, Placed, VillageState } from './types.ts';

/** 놓이지 않은 것의 모양을 두는 곳 (지도 밖 먼 곳: 손님·구경 반경에 걸리지 않는다). */
export const OFF: Pt = { x: -40000, y: -40000 };

const N = GRID.w * GRID.h;
/** 되돌아가기 지도에서 풀밭 한 칸의 비용 (길 칸 = 1): 끊긴 길을 따라 조금 돌더라도 풀밭은 짧게 건넌다. */
const HOP_GRASS = 4;
const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/** 화면이 다시 그릴 때를 아는 도장 (모든 마을에서 겹치지 않는 수: 새 게임·불러오기에도 바뀐다). */
let stampSeq = 0;

const sp = (p: Pt, o: Pt): Pt => ({ x: p.x + o.x, y: p.y + o.y });
const sps = (ps: readonly Pt[], o: Pt): Pt[] => ps.map((p) => sp(p, o));
const sr = (r: Rect, o: Pt): Rect => ({ x: r.x + o.x, y: r.y + o.y, w: r.w, h: r.h });

/** 세계 좌표 오리배 연못 (물길·연못·구경 자리). */
export interface BoatGeo {
  readonly course: LoopCourse;
  readonly pond: PondShape;
  readonly watch: readonly Rect[];
}

/** 놓기 검사 결과. bad = 놓을 수 없는 칸 (미리보기를 빨갛게), entry = 입구 앞 칸 (없으면 null), entryRoad = 그 칸이 마을 입구와 이어진 길. */
export interface PlaceCheck {
  readonly ok: boolean;
  readonly reason: string | null;
  readonly bad: readonly Cell[];
  readonly entry: Cell | null;
  readonly entryRoad: boolean;
}

/** 땅 조각 하나의 상태. */
export interface ChunkInfo {
  readonly index: number;
  readonly cx: number;
  readonly cy: number;
  readonly owned: boolean;
  /** 가진 땅에 이웃한다 (살 수 있는 자리). */
  readonly adjacent: boolean;
  readonly ring: number;
  /** 사는 데 필요한 마을회관 레벨. */
  readonly hall: number;
  /** 값 (코인). 가진 땅이면 0. */
  readonly price: number;
}

/**
 * 칸 지도와 세계 좌표 모양 (villageOf가 만든다, rev가 바뀌면 새로). 화면은 stamp로 다시 그릴 때를 안다:
 * place = 건물·장식 자리, road = 길, land = 땅이 바뀌면 그 수가 바뀐다.
 */
export class Village {
  readonly stamp: { readonly place: number; readonly road: number; readonly land: number };
  /** 칸마다 가진 땅 (1). */
  readonly owned = new Uint8Array(N);
  /** 칸마다 차지한 것의 id (0 = 비었다). */
  readonly occ = new Int32Array(N);
  /** 칸마다 길 (1). */
  readonly road = new Uint8Array(N);
  /** 칸마다 이 칸을 입구로 쓰는 것의 id (0 = 없다). */
  readonly entryOf = new Int32Array(N);
  /** 길 칸마다 이어진 묶음 번호 (-1 = 길이 아니다). */
  readonly comp = new Int32Array(N).fill(-1);
  /** 마을 입구 길 칸의 묶음 (-1 = 마을 입구가 길에 닿지 않았다). */
  readonly gateComp: number;
  /** 마을 입구와 이어진 길 칸 번호 (손님이 걸을 수 있는 길). */
  readonly walkable: readonly number[];
  readonly byId = new Map<number, Placed>();
  /** 부스·건물 (하나씩만 있는 것) → 놓인 것. */
  readonly byKey = new Map<CatalogKey, Placed>();
  private readonly linked = new Set<number>();
  private readonly memo = new Map<string, unknown>();
  private readonly fields = new Map<number, Int32Array>();
  private auraGrid: Float32Array | null = null;
  private hop: { cost: Int32Array; next: Int32Array } | null = null;
  readonly state: VillageState;

  constructor(v: VillageState, stamp: { place: number; road: number; land: number }) {
    this.state = v;
    this.stamp = stamp;
    for (const ci of v.chunks) {
      const cx = ci % CHUNKS.w;
      const cy = Math.floor(ci / CHUNKS.w);
      for (let y = cy * CHUNK; y < (cy + 1) * CHUNK; y++) for (let x = cx * CHUNK; x < (cx + 1) * CHUNK; x++) this.owned[y * GRID.w + x] = 1;
    }
    for (const p of v.placed) {
      this.byId.set(p.id, p);
      if (catalogKind(p.key) !== 'decor') this.byKey.set(p.key, p);
      const fp = footprint(p.key);
      for (let y = p.y; y < p.y + fp.h; y++) {
        for (let x = p.x; x < p.x + fp.w; x++) {
          const i = cellIndex(x, y);
          if (i >= 0) this.occ[i] = p.id;
        }
      }
      if (fp.entry !== undefined) {
        const i = cellIndex(p.x + fp.entry.x, p.y + fp.entry.y);
        if (i >= 0) this.entryOf[i] = p.id;
      }
    }
    for (const i of v.roads) if (i >= 0 && i < N) this.road[i] = 1;
    // 길 묶음 (가로·세로로 이어진 길 칸).
    let next = 0;
    const q: number[] = [];
    for (let s = 0; s < N; s++) {
      if (this.road[s] !== 1 || (this.comp[s] ?? -1) >= 0) continue;
      this.comp[s] = next;
      q.length = 0;
      q.push(s);
      for (let k = 0; k < q.length; k++) {
        const c = q[k] as number;
        const cx = c % GRID.w;
        const cy = (c - cx) / GRID.w;
        for (const [dx, dy] of DIRS) {
          const n = cellIndex(cx + dx, cy + dy);
          if (n >= 0 && this.road[n] === 1 && this.comp[n] === -1) {
            this.comp[n] = next;
            q.push(n);
          }
        }
      }
      next++;
    }
    const gate = this.byKey.get('gate');
    const ge = gate === undefined ? -1 : this.entryCellIndex(gate);
    this.gateComp = ge >= 0 && this.road[ge] === 1 ? (this.comp[ge] ?? -1) : -1;
    const walk: number[] = [];
    if (this.gateComp >= 0) for (let i = 0; i < N; i++) if (this.comp[i] === this.gateComp) walk.push(i);
    this.walkable = walk;
    for (const p of v.placed) {
      const e = this.entryCellIndex(p);
      if (e >= 0 && this.gateComp >= 0 && this.comp[e] === this.gateComp) this.linked.add(p.id);
    }
  }

  // ── 놓인 것 ──

  /** 부스·건물이 놓인 자리 (장식은 여럿이라 byId로). */
  placed(key: CatalogKey): Placed | undefined {
    return this.byKey.get(key);
  }

  /** 놓인 것의 왼쪽 위 모서리 (세계 px). 놓이지 않았으면 OFF. */
  origin(key: CatalogKey): Pt {
    const p = this.byKey.get(key);
    return p === undefined ? OFF : { x: p.x * CELL, y: p.y * CELL };
  }

  /** 놓였고 입구가 길로 마을 입구와 이어졌다 (입구가 없는 건물은 놓이기만 하면). 손님은 이런 곳에만 간다. */
  connected(key: CatalogKey): boolean {
    const p = this.byKey.get(key);
    if (p === undefined) return false;
    return footprint(p.key).entry === undefined || this.linked.has(p.id);
  }

  /** id로 (장식 포함): 입구가 마을 입구와 이어졌나. */
  linkedId(id: number): boolean {
    return this.linked.has(id);
  }

  /** 놓인 것의 입구 앞 칸 번호 (없으면 -1). */
  entryCellIndex(p: Placed): number {
    const e = footprint(p.key).entry;
    return e === undefined ? -1 : cellIndex(p.x + e.x, p.y + e.y);
  }

  /** 입구 앞 길 칸 가운데 (세계 px). 입구가 없거나 놓이지 않았으면 null. */
  entryPt(key: CatalogKey): Pt | null {
    const p = this.byKey.get(key);
    const e = p === undefined ? undefined : footprint(p.key).entry;
    return p === undefined || e === undefined ? null : cellCenter(p.x + e.x, p.y + e.y);
  }

  /** 문 (세계 px, 발자국 안: 길 칸에서 여기로 들어와 안쪽 자리로). 입구가 없으면 그림 자리. */
  door(key: CatalogKey): Pt {
    const o = this.origin(key);
    const d = footprint(key).door;
    return d === undefined ? sp(artBase(key), o) : sp(d, o);
  }

  /** 칸 (x, y)를 차지한 것 (없으면 undefined). */
  at(x: number, y: number): Placed | undefined {
    const i = cellIndex(x, y);
    const id = i < 0 ? 0 : (this.occ[i] ?? 0);
    return id === 0 ? undefined : this.byId.get(id);
  }

  isRoad(x: number, y: number): boolean {
    const i = cellIndex(x, y);
    return i >= 0 && this.road[i] === 1;
  }

  isOwned(x: number, y: number): boolean {
    const i = cellIndex(x, y);
    return i >= 0 && this.owned[i] === 1;
  }

  /** 길 칸이 마을 입구와 이어졌나 (손님이 걸을 수 있다). */
  isWalkable(i: number): boolean {
    return i >= 0 && this.gateComp >= 0 && this.comp[i] === this.gateComp;
  }

  // ── 세계 좌표 모양 (놓이지 않았으면 OFF 둘레) ──

  private cached<T>(key: string, make: () => T): T {
    const have = this.memo.get(key);
    if (have !== undefined) return have as T;
    const v = make();
    this.memo.set(key, v);
    return v;
  }

  /** 그림 자리 (아래 가운데, 세계 px). 장식은 byId로 artOf. */
  art(key: CatalogKey): Pt {
    return sp(artBase(key), this.origin(key));
  }

  /** 놓인 것 하나의 그림 자리 (장식 포함). */
  artOf(p: Placed): Pt {
    const b = catalogKind(p.key) === 'decor' ? DECOR_BASE : artBase(p.key);
    return { x: p.x * CELL + b.x, y: p.y * CELL + b.y };
  }

  booth(b: BoothId): BoothSpot {
    return this.cached(`booth:${b}`, () => {
      const s = BOOTH_LAYOUT[b].spot;
      const o = this.origin(b);
      const out: BoothSpot = {
        base: sp(s.base, o),
        seats: sps(s.seats, o),
        queue: sps(s.queue, o),
        pot: sp(s.pot, o),
        hosts: sps(s.hosts, o),
        ...(s.props === undefined ? {} : { props: s.props.map((p) => ({ ...p, at: sp(p.at, o) })) }),
        ...(s.flat === undefined ? {} : { flat: s.flat }),
        ...(s.buildingK === undefined ? {} : { buildingK: s.buildingK }),
      };
      return out;
    });
  }

  race(): RaceGeo {
    return this.cached('race', () => {
      const o = this.origin('race');
      return { ...RACE_GEO, center: sp(RACE_GEO.center, o), gate: sp(RACE_GEO.gate, o), finish: sp(RACE_GEO.finish, o), stand: sp(RACE_GEO.stand, o), watch: RACE_GEO.watch.map((r) => sr(r, o)) };
    });
  }

  boat(): BoatGeo {
    return this.cached('boat', () => {
      const o = this.origin('boat');
      return { course: { ...BOAT_GEO.course, center: sp(BOAT_GEO.course.center, o) }, pond: { ...BOAT_GEO.pond, c: sp(BOAT_GEO.pond.c, o) }, watch: BOAT_GEO.watch.map((r) => sr(r, o)) };
    });
  }

  kite(): KiteGeo {
    return this.cached('kite', () => {
      const o = this.origin('kite');
      const K = KITE_GEO;
      return { ...K, flyers: sps(K.flyers, o), bettors: sps(K.bettors, o), sky: sr(K.sky, o), skyLow: K.skyLow + o.y, skyHigh: K.skyHigh + o.y, center: sp(K.center, o), watch: sr(K.watch, o), hill: { ...K.hill, c: sp(K.hill.c, o) } };
    });
  }

  tug(): TugGeo {
    return this.cached('tug', () => {
      const o = this.origin('tug');
      return { ...TUG_GEO, center: sp(TUG_GEO.center, o), flags: sps(TUG_GEO.flags, o), watch: sr(TUG_GEO.watch, o) };
    });
  }

  dig(): DigGeo {
    return this.cached('dig', () => {
      const o = this.origin('dig');
      return { spots: sps(DIG_GEO.spots, o), chests: sps(DIG_GEO.chests, o), center: sp(DIG_GEO.center, o), watch: sr(DIG_GEO.watch, o) };
    });
  }

  ring(): RingGeo {
    return this.cached('ring', () => ({ ...SSIREUM_GEO, center: sp(SSIREUM_GEO.center, this.origin('ssireum')) }));
  }

  shop(s: 'pawnshop' | 'bank'): ShopGeo {
    return this.cached(`shop:${s}`, () => {
      const o = this.origin(s);
      const g = SHOP_GEO[s];
      return { counter: sps(g.counter, o), npc: sp(g.npc, o), art: g.art };
    });
  }

  yard(): YardGeo {
    return this.cached('yard', () => {
      const o = this.origin('workyard');
      const fac = {} as Record<WorkFacility, WorkFacilitySpot>;
      for (const f of WORK_FACILITIES) {
        const s = YARD_GEO.facilities[f];
        fac[f] = { ...s, at: sp(s.at, o), spots: sps(s.spots, o), wait: sps(s.wait, o), face: sp(s.face, o) };
      }
      return { facilities: fac, props: YARD_GEO.props.map((p) => ({ ...p, at: sp(p.at, o) })), foreman: sp(YARD_GEO.foreman, o), center: sp(YARD_GEO.center, o) };
    });
  }

  /** 분수 둘레 쉬는 자리. */
  rest(): readonly Pt[] {
    return this.cached('rest', () => sps(FOUNTAIN_REST, this.origin('fountain')));
  }

  /** 손님이 나타나고 떠나는 점 (마을 입구 아치 밑). */
  gateSpawn(): Pt {
    return sp(GATE_SPAWN, this.origin('gate'));
  }

  /** 촌장이 서 있는 곳 (마을회관 앞, 회관이 놓이지 않았으면 OFF). */
  chief(): Pt {
    return sp(CHIEF_AT, this.origin('hall'));
  }

  /** 건물 그림 배율 (catalog.ts BUILDING_LAYOUT.k, 없으면 undefined = 화면 기본). */
  buildingK(id: BuildingId): number | undefined {
    return BUILDING_LAYOUT[id].k;
  }

  // ── 장식 둘레 기분 ──

  /** 칸마다 장식 둘레 기분 (+/분, DECOR_AURA.cap까지). */
  auraAt(i: number): number {
    if (this.auraGrid === null) {
      const g = new Float32Array(N);
      const R = DECOR_AURA.radius;
      for (const p of this.state.placed) {
        if (catalogKind(p.key) !== 'decor') continue;
        const a = DECOR[p.key as DecorId].aura;
        for (let y = p.y - R; y <= p.y + R; y++) {
          for (let x = p.x - R; x <= p.x + R; x++) {
            const c = cellIndex(x, y);
            if (c >= 0) g[c] = Math.min(DECOR_AURA.cap, (g[c] ?? 0) + a);
          }
        }
      }
      this.auraGrid = g;
    }
    return i >= 0 ? (this.auraGrid[i] ?? 0) : 0;
  }

  // ── 길찾기 바탕 ──

  /** 길 칸 to까지의 칸 거리 지도 (마을 입구와 이어진 길만, 닿지 못하면 -1). 길이 바뀔 때까지 둔다 (목적지 64개까지). */
  fieldTo(to: number): Int32Array {
    const have = this.fields.get(to);
    if (have !== undefined) return have;
    const d = new Int32Array(N).fill(-1);
    if (to >= 0 && to < N && this.road[to] === 1) {
      const comp = this.comp[to];
      const q: number[] = [to];
      d[to] = 0;
      for (let k = 0; k < q.length; k++) {
        const c = q[k] as number;
        const cx = c % GRID.w;
        const cy = (c - cx) / GRID.w;
        const dc = (d[c] ?? 0) + 1;
        for (const [dx, dy] of DIRS) {
          const n = cellIndex(cx + dx, cy + dy);
          if (n >= 0 && d[n] === -1 && this.road[n] === 1 && this.comp[n] === comp) {
            d[n] = dc;
            q.push(n);
          }
        }
      }
    }
    if (this.fields.size >= 64) {
      const first = this.fields.keys().next().value;
      if (first !== undefined) this.fields.delete(first);
    }
    this.fields.set(to, d);
    return d;
  }

  /** 길 칸 from → to 칸 길 (from·to 포함). 이어지지 않았으면 null. 꺾임이 적게 (가던 쪽을 먼저 본다). */
  cellPath(from: number, to: number): number[] | null {
    if (from === to) return [from];
    const d = this.fieldTo(to);
    let c = from;
    let dist = d[c] ?? -1;
    if (dist < 0) return null;
    const out = [c];
    let dir = -1;
    while (dist > 0) {
      const cx = c % GRID.w;
      const cy = (c - cx) / GRID.w;
      let best = -1;
      let bestDir = -1;
      for (let k = 0; k < 4; k++) {
        const kk = dir >= 0 ? (dir + k) % 4 : k;
        const [dx, dy] = DIRS[kk] as readonly [number, number];
        const n = cellIndex(cx + dx, cy + dy);
        if (n >= 0 && d[n] === dist - 1) {
          best = n;
          bestDir = kk;
          break;
        }
      }
      if (best < 0) return null;
      c = best;
      dir = bestDir;
      dist -= 1;
      out.push(c);
    }
    return out;
  }

  /**
   * 되돌아가기 지도 (길이 끊기거나 건물을 옮기고 치워 길 밖에 남은 손님이 걸을 수 있는 길로 돌아가는 칸 길):
   * 걸을 수 있는 길 칸에서 거꾸로 번지는 가장 싼 길 (길 칸 1, 가진 땅의 빈 칸 HOP_GRASS: 끊긴 길을 따라 걷다가 풀밭은 짧게 건넌다, 건물은 지나지 않는다).
   * next[i] = 칸 i에서 한 걸음 나아갈 칸 (-1 = 이미 걸을 수 있는 길, -2 = 돌아갈 수 없다). 길·자리가 바뀔 때까지 둔다.
   */
  hopField(): { readonly cost: Int32Array; readonly next: Int32Array } {
    if (this.hop !== null) return this.hop;
    const cost = new Int32Array(N).fill(-1);
    const next = new Int32Array(N).fill(-2);
    // 칸 비용이 작은 정수라 칸 비용마다 통(bucket)으로 (다익스트라).
    const buckets: number[][] = [[]];
    for (const i of this.walkable) {
      cost[i] = 0;
      next[i] = -1;
      (buckets[0] as number[]).push(i);
    }
    const free = (i: number): boolean => this.road[i] === 1 || (this.owned[i] === 1 && (this.occ[i] ?? 0) === 0);
    for (let d = 0; d < buckets.length; d++) {
      const list = buckets[d];
      if (list === undefined) continue;
      for (let k = 0; k < list.length; k++) {
        const c = list[k] as number;
        if (cost[c] !== d) continue;
        const cx = c % GRID.w;
        const cy = (c - cx) / GRID.w;
        for (const [dx, dy] of DIRS) {
          const n = cellIndex(cx + dx, cy + dy);
          if (n < 0 || !free(n)) continue;
          const nd = d + (this.road[n] === 1 ? 1 : HOP_GRASS);
          const have = cost[n] ?? -1;
          if (have >= 0 && have <= nd) continue;
          cost[n] = nd;
          next[n] = c;
          (buckets[nd] ??= []).push(n);
        }
      }
    }
    this.hop = { cost, next };
    return this.hop;
  }

  /**
   * 칸 i(길 밖·끊긴 길·풀밭)에서 걸을 수 있는 길까지의 칸들 (i 포함, 마지막 = 걸을 수 있는 길 칸). i가 이미 걸을 수 있으면 [i].
   * 건물 발자국 안이면 그 건물의 입구 칸(없으면 둘레의 가장 가까운 빈 칸)에서 시작한다. 돌아갈 수 없으면 null.
   */
  rescueCells(i: number): number[] | null {
    if (i < 0 || i >= N) return null;
    if (this.isWalkable(i)) return [i];
    const { cost, next } = this.hopField();
    let s = i;
    const occ = this.occ[i] ?? 0;
    if (occ !== 0 && this.road[i] !== 1) {
      const p = this.byId.get(occ);
      if (p === undefined) return null;
      const e = this.entryCellIndex(p);
      if (e >= 0 && (cost[e] ?? -1) >= 0) s = e;
      else {
        // 입구가 없거나 돌아갈 수 없는 입구: 발자국 둘레에서 가장 싼 칸.
        const fp = footprint(p.key);
        let best = -1;
        for (let y = p.y - 1; y <= p.y + fp.h; y++) {
          for (let x = p.x - 1; x <= p.x + fp.w; x++) {
            if (x >= p.x && x < p.x + fp.w && y >= p.y && y < p.y + fp.h) continue;
            const c = cellIndex(x, y);
            if (c >= 0 && (cost[c] ?? -1) >= 0 && (best < 0 || (cost[c] ?? 0) < (cost[best] ?? 0))) best = c;
          }
        }
        if (best < 0) return null;
        s = best;
      }
    }
    if ((cost[s] ?? -1) < 0) return null;
    const out = [s];
    for (let c = s, guard = 0; (next[c] ?? -2) >= 0 && guard < N; guard++) {
      c = next[c] as number;
      out.push(c);
    }
    return this.isWalkable(out[out.length - 1] as number) ? out : null;
  }

  /** 점 p에서 가장 가까운 걸을 수 있는 길 칸 (없으면 -1). */
  nearestWalkable(p: Pt): number {
    let best = -1;
    let bd = Infinity;
    for (const i of this.walkable) {
      const x = (i % GRID.w) * CELL + CELL / 2;
      const y = Math.floor(i / GRID.w) * CELL + CELL / 2;
      const d = (x - p.x) ** 2 + (y - p.y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }
}

const CACHE = new WeakMap<VillageState, { rev: { place: number; road: number; land: number }; v: Village }>();

/** 마을의 칸 지도와 세계 좌표 모양 (rev가 같으면 같은 객체). */
export function villageOf(state: GameState): Village {
  const vs = state.village;
  const c = CACHE.get(vs);
  const r = vs.rev;
  if (c !== undefined && c.rev.place === r.place && c.rev.road === r.road && c.rev.land === r.land) return c.v;
  const prev = c?.v.stamp;
  const stamp = {
    place: prev !== undefined && c?.rev.place === r.place ? prev.place : ++stampSeq,
    road: prev !== undefined && c?.rev.road === r.road ? prev.road : ++stampSeq,
    land: prev !== undefined && c?.rev.land === r.land ? prev.land : ++stampSeq,
  };
  const v = new Village(vs, stamp);
  CACHE.set(vs, { rev: { ...r }, v });
  return v;
}

// ── 물어보기 (자주 쓰는 것) ──

/** 부스·건물이 놓였나. */
export function isPlaced(state: GameState, key: CatalogKey): boolean {
  return villageOf(state).placed(key) !== undefined;
}

/** 손님이 갈 수 있나 (놓였고 입구가 길로 마을 입구와 이어졌다). */
export function isConnected(state: GameState, key: CatalogKey): boolean {
  return villageOf(state).connected(key);
}

/** 세계 좌표 부스 자리 (놓이지 않았으면 OFF 둘레). */
export function boothSpot(state: GameState, b: BoothId): BoothSpot {
  return villageOf(state).booth(b);
}

// ── 놓기 검사 ──

/** key를 칸 (x, y)에 놓을 수 있나 (ignore = 옮기는 중인 자기 자신의 id). */
export function checkPlace(state: GameState, key: CatalogKey, x: number, y: number, ignore = 0): PlaceCheck {
  const v = villageOf(state);
  const fp = footprint(key);
  const bad: Cell[] = [];
  let reason: string | null = null;
  const why = (r: string): void => {
    reason ??= r;
  };
  for (let cy = y; cy < y + fp.h; cy++) {
    for (let cx = x; cx < x + fp.w; cx++) {
      const i = cellIndex(cx, cy);
      if (i < 0) {
        bad.push({ x: cx, y: cy });
        why('지도 밖이에요.');
        continue;
      }
      const occ = v.occ[i] ?? 0;
      const ent = v.entryOf[i] ?? 0;
      if (v.owned[i] !== 1) why('아직 사지 않은 땅이에요.');
      else if (occ !== 0 && occ !== ignore) why('다른 건물이 있어요.');
      else if (v.road[i] === 1) why('길 위에는 놓을 수 없어요. 길을 먼저 지워요.');
      else if (ent !== 0 && ent !== ignore) why('다른 건물의 입구를 막아요.');
      else continue;
      bad.push({ x: cx, y: cy });
    }
  }
  let entry: Cell | null = null;
  let entryRoad = false;
  if (fp.entry !== undefined) {
    entry = { x: x + fp.entry.x, y: y + fp.entry.y };
    const i = cellIndex(entry.x, entry.y);
    const occ = i < 0 ? 0 : (v.occ[i] ?? 0);
    if (i < 0 || v.owned[i] !== 1) {
      bad.push(entry);
      why('입구 앞 땅이 없어요.');
    } else if (occ !== 0 && occ !== ignore) {
      bad.push(entry);
      why('입구 앞이 막혀 있어요.');
    } else entryRoad = v.isWalkable(i);
  }
  return { ok: reason === null, reason, bad, entry, entryRoad };
}

/** 칸 (x, y)에 길을 깔 수 있나 (가진 땅, 아무것도 차지하지 않은 칸). */
export function roadPaintable(state: GameState, x: number, y: number): boolean {
  const v = villageOf(state);
  const i = cellIndex(x, y);
  return i >= 0 && v.owned[i] === 1 && (v.occ[i] ?? 0) === 0;
}

// ── 땅 조각 ──

/** 처음 땅 말고 산 조각 수. */
export function boughtChunks(state: GameState): number {
  return Math.max(0, state.village.chunks.length - LAND_START.w * LAND_START.h);
}

/** 땅 조각 하나의 상태 (값은 지금 산 조각 수로). */
export function chunkInfo(state: GameState, index: number): ChunkInfo {
  const cx = index % CHUNKS.w;
  const cy = Math.floor(index / CHUNKS.w);
  const owned = state.village.chunks.includes(index);
  const ring = chunkRing(cx, cy);
  let adjacent = false;
  for (const [dx, dy] of DIRS) {
    const n = chunkIndex(cx + dx, cy + dy);
    if (n >= 0 && state.village.chunks.includes(n)) adjacent = true;
  }
  const hall = LAND.hall[Math.min(ring, LAND.hall.length - 1)] ?? 5;
  const price = owned ? 0 : Math.round(((LAND.base + LAND.perBought * boughtChunks(state)) * (1 + LAND.ringMult * Math.max(0, ring - 1))) / 10) * 10;
  return { index, cx, cy, owned, adjacent, ring, hall, price };
}

/** 모든 조각 (조각 번호 순서). */
export function allChunks(state: GameState): ChunkInfo[] {
  return Array.from({ length: CHUNKS.w * CHUNKS.h }, (_, i) => chunkInfo(state, i));
}

// ── 바꾸기 (검사는 부르는 쪽이 먼저: sim.ts) ──

function bump(state: GameState, what: 'place' | 'road' | 'land'): void {
  state.village.rev[what] += 1;
}

export function addPlaced(state: GameState, key: CatalogKey, x: number, y: number): Placed {
  const v = state.village;
  const p: Placed = { id: v.nextId++, key, x, y };
  v.placed.push(p);
  bump(state, 'place');
  return p;
}

export function movePlaced(state: GameState, id: number, x: number, y: number): void {
  const p = state.village.placed.find((q) => q.id === id);
  if (p === undefined) return;
  p.x = x;
  p.y = y;
  bump(state, 'place');
}

export function removePlaced(state: GameState, id: number): Placed | undefined {
  const list = state.village.placed;
  const i = list.findIndex((q) => q.id === id);
  if (i < 0) return undefined;
  const [p] = list.splice(i, 1);
  bump(state, 'place');
  return p;
}

/** 길 칸을 깔거나 (on) 지운다. 바뀐 칸 수. 깔 수 없는 칸(가진 땅이 아님, 무언가 차지함)은 건너뛴다. */
export function setRoads(state: GameState, cells: readonly Cell[], on: boolean): number {
  const set = new Set(state.village.roads);
  let n = 0;
  for (const c of cells) {
    const i = cellIndex(c.x, c.y);
    if (i < 0) continue;
    if (on) {
      if (set.has(i) || !roadPaintable(state, c.x, c.y)) continue;
      set.add(i);
    } else if (!set.delete(i)) continue;
    n++;
  }
  if (n > 0) {
    state.village.roads = [...set].sort((a, b) => a - b);
    bump(state, 'road');
  }
  return n;
}

export function addChunk(state: GameState, index: number): void {
  if (state.village.chunks.includes(index)) return;
  state.village.chunks.push(index);
  state.village.chunks.sort((a, b) => a - b);
  bump(state, 'land');
}

// ── 처음 마을 ──

/** 처음 땅 조각들. */
export function startChunks(): number[] {
  const out: number[] = [];
  for (let cy = LAND_START.y; cy < LAND_START.y + LAND_START.h; cy++) for (let cx = LAND_START.x; cx < LAND_START.x + LAND_START.w; cx++) out.push(chunkIndex(cx, cy));
  return out.sort((a, b) => a - b);
}

/** 새 게임의 마을 (map.ts DEFAULT_PLACED·DEFAULT_ROADS·DEFAULT_DECOR, 처음 땅). */
export function defaultVillage(): VillageState {
  const placed: Placed[] = [];
  let id = 1;
  for (const p of DEFAULT_PLACED) placed.push({ id: id++, key: p.key, x: p.x, y: p.y });
  for (const d of DEFAULT_DECOR) placed.push({ id: id++, key: d.key, x: d.x, y: d.y });
  const roads = new Set<number>();
  for (const r of DEFAULT_ROADS) for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) roads.add(cellIndex(x, y));
  return { placed, roads: [...roads].sort((a, b) => a - b), chunks: startChunks(), decor: {}, nextId: id, rev: { place: 0, road: 0, land: 0 } };
}

// ── 자동 배치 (옛 저장 옮기기·sim-check 촌장·개발용) ──

/** 자동 배치 (spread): 위·아래로 바로 붙은 다른 건물 칸 하나의 점수 (새 길 한 칸 = 14). */
const TOUCH_COST = 8;

/**
 * key를 놓을 자리와 그 입구를 길에 잇는 새 길 칸 (가진 땅 안, 빈 칸으로). 입구가 이미 길이면 road = [].
 * 고르기: 이어 줄 길이 짧을수록, 마을 입구에서 가까울수록 (입구가 없는 건물은 길가를 비켜 길에서 한 칸 떨어진 곳). 자리가 없으면 null.
 * prefer = 먼저 보는 자리 (처음 마을의 전당포 빈 땅).
 * spread = 위·아래로 다른 건물에 딱 붙은 자리를 덜 고른다 (땅이 넉넉할 때: 옛 저장 옮기기·개발용 ?all). 땅을 아껴 쓰는 촌장(sim-check)은 끈다
 * (흩어 놓으면 빈 땅이 조각나 큰 시설이 들어갈 자리가 늦게 난다).
 */
export function findSpot(state: GameState, key: CatalogKey, prefer?: Cell, spread = false): { x: number; y: number; road: Cell[] } | null {
  if (catalogKind(key) === 'decor') {
    const c = findDecorSpot(state, key as DecorId);
    return c === null ? null : { x: c.x, y: c.y, road: [] };
  }
  const v = villageOf(state);
  const fp = footprint(key);
  const ge = (() => {
    const g = v.placed('gate');
    return g === undefined ? cellIndex(GRID.w >> 1, GRID.h - 1) : v.entryCellIndex(g);
  })();
  const gx = ge % GRID.w;
  const gy = Math.floor(ge / GRID.w);
  // 이어진 길에서 빈 칸으로 번지는 거리 (새 길을 몇 칸 깔아야 하나).
  const dist = new Int32Array(N).fill(-1);
  const q: number[] = [];
  for (const i of v.walkable) {
    dist[i] = 0;
    q.push(i);
  }
  const free = (i: number): boolean => v.owned[i] === 1 && (v.occ[i] ?? 0) === 0;
  for (let k = 0; k < q.length; k++) {
    const c = q[k] as number;
    const cx = c % GRID.w;
    const cy = (c - cx) / GRID.w;
    for (const [dx, dy] of DIRS) {
      const n = cellIndex(cx + dx, cy + dy);
      if (n >= 0 && dist[n] === -1 && free(n)) {
        dist[n] = (dist[c] ?? 0) + 1;
        q.push(n);
      }
    }
  }
  // 위·아래로 바로 붙은 다른 건물 칸 (장식 빼고): 그림은 발자국 위로 1~2칸 삐져나가서, 붙여 놓으면 아래 건물 지붕이
  // 위 건물의 바닥(줄다리기 마당·연못·부스 앞 자리)을 가린다. 붙은 칸마다 점수를 더해 한 줄 띄운 자리를 먼저 고른다.
  const touching = (x: number, y: number): number => {
    let n = 0;
    for (const cy of [y - 1, y + fp.h]) {
      for (let cx = x; cx < x + fp.w; cx++) {
        const i = cellIndex(cx, cy);
        const id = i < 0 ? 0 : (v.occ[i] ?? 0);
        if (id === 0) continue;
        const p = v.byId.get(id);
        if (p !== undefined && catalogKind(p.key) !== 'decor') n++;
      }
    }
    return n;
  };
  const tryAt = (x: number, y: number): { score: number; road: Cell[] } | null => {
    const chk = checkPlace(state, key, x, y);
    if (!chk.ok) return null;
    const touch = spread ? touching(x, y) * TOUCH_COST : 0;
    if (chk.entry === null) {
      // 길이 필요 없는 건물: 길가(손님이 들를 건물 자리)를 비켜서, 마을 가까이.
      let edge = 0;
      for (let cy = y - 1; cy <= y + fp.h; cy++) for (let cx = x - 1; cx <= x + fp.w; cx++) if (v.isRoad(cx, cy)) edge++;
      return { score: Math.abs(x + fp.w / 2 - gx) + Math.abs(y + fp.h / 2 - gy) + edge * 6 + touch, road: [] };
    }
    const ei = cellIndex(chk.entry.x, chk.entry.y);
    const d = chk.entryRoad ? 0 : (dist[ei] ?? -1);
    if (d < 0) return null;
    const road = chk.entryRoad ? [] : roadTo(state, ei, x, y, fp.w, fp.h);
    if (road === null) return null;
    return { score: road.length * 14 + Math.abs(chk.entry.x - gx) + Math.abs(chk.entry.y - gy) + touch, road };
  };
  if (prefer !== undefined) {
    const r = tryAt(prefer.x, prefer.y);
    if (r !== null) return { x: prefer.x, y: prefer.y, road: r.road };
  }
  let best: { x: number; y: number; score: number; road: Cell[] } | null = null;
  // 가진 땅의 사각형 안만 본다.
  let x0 = GRID.w;
  let y0 = GRID.h;
  let x1 = 0;
  let y1 = 0;
  for (const ci of state.village.chunks) {
    const cx = ci % CHUNKS.w;
    const cy = Math.floor(ci / CHUNKS.w);
    x0 = Math.min(x0, cx * CHUNK);
    y0 = Math.min(y0, cy * CHUNK);
    x1 = Math.max(x1, (cx + 1) * CHUNK);
    y1 = Math.max(y1, (cy + 1) * CHUNK);
  }
  for (let y = y0; y + fp.h <= y1; y++) {
    for (let x = x0; x + fp.w <= x1; x++) {
      // 빠른 걸러 내기: 왼쪽 위·오른쪽 아래 칸이 빈 땅이어야.
      const a = cellIndex(x, y);
      const b = cellIndex(x + fp.w - 1, y + fp.h - 1);
      if (a < 0 || b < 0 || !free(a) || !free(b) || v.road[a] === 1 || v.road[b] === 1) continue;
      const r = tryAt(x, y);
      if (r !== null && (best === null || r.score < best.score)) best = { x, y, score: r.score, road: r.road };
    }
  }
  return best === null ? null : { x: best.x, y: best.y, road: best.road };
}

/** 칸 (x, y)가 바로 아래 건물의 지붕에 가리는 줄인가 (건물 그림은 발자국 위로 1~2줄 삐져나온다: 장식을 거기 두면 안 보인다). */
export function underRoof(v: Village, x: number, y: number): boolean {
  for (let d = 1; d <= 2; d++) {
    const q = v.at(x, y + d);
    if (q !== undefined && catalogKind(q.key) !== 'decor') return true;
  }
  return false;
}

/**
 * 장식 자동 배치: 걸을 수 있는 길 옆 빈 칸 가운데 둘레(DECOR_AURA.radius) 길 칸에 기분을 가장 많이 더하는 칸 (건물 지붕에 가리는 줄은 덜 친다)
 * (이미 cap에 가까운 칸은 덜 친다, 같으면 마을 입구에 가까운 칸). 길 옆 빈 칸이 없으면 null.
 */
export function findDecorSpot(state: GameState, key: DecorId): Cell | null {
  const v = villageOf(state);
  const R = DECOR_AURA.radius;
  const a = DECOR[key].aura;
  const g = v.placed('gate');
  const ge = g === undefined ? -1 : v.entryCellIndex(g);
  const gx = ge >= 0 ? ge % GRID.w : GRID.w >> 1;
  const gy = ge >= 0 ? Math.floor(ge / GRID.w) : GRID.h - 1;
  const seen = new Set<number>();
  let best: { x: number; y: number; score: number } | null = null;
  for (const r of v.walkable) {
    const rx = r % GRID.w;
    const ry = Math.floor(r / GRID.w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = rx + dx;
        const y = ry + dy;
        const i = cellIndex(x, y);
        if (i < 0 || seen.has(i)) continue;
        seen.add(i);
        if (!checkPlace(state, key, x, y).ok) continue;
        let gain = 0;
        for (let yy = y - R; yy <= y + R; yy++) {
          for (let xx = x - R; xx <= x + R; xx++) {
            const c = cellIndex(xx, yy);
            if (c >= 0 && v.isWalkable(c)) gain += Math.max(0, Math.min(a, DECOR_AURA.cap - v.auraAt(c)));
          }
        }
        const score = gain * (underRoof(v, x, y) ? 0.15 : 1) - (Math.abs(x - gx) + Math.abs(y - gy)) * 0.01;
        if (best === null || score > best.score) best = { x, y, score };
      }
    }
  }
  return best === null || best.score <= 0 ? null : { x: best.x, y: best.y };
}

/**
 * 입구 칸 entry에서 이어진 길까지 새로 깔 길 칸 (빈 가진 땅으로, 놓을 건물 발자국 (x, y, w, h)은 피한다). 입구 칸 포함. 못 이으면 null.
 */
export function roadTo(state: GameState, entry: number, x: number, y: number, w: number, h: number): Cell[] | null {
  const v = villageOf(state);
  const inFoot = (i: number): boolean => {
    const cx = i % GRID.w;
    const cy = Math.floor(i / GRID.w);
    return cx >= x && cx < x + w && cy >= y && cy < y + h;
  };
  const prev = new Int32Array(N).fill(-2);
  prev[entry] = -1;
  const q = [entry];
  let hit = -1;
  for (let k = 0; k < q.length && hit < 0; k++) {
    const c = q[k] as number;
    if (v.isWalkable(c)) {
      hit = c;
      break;
    }
    const cx = c % GRID.w;
    const cy = (c - cx) / GRID.w;
    for (const [dx, dy] of DIRS) {
      const n = cellIndex(cx + dx, cy + dy);
      if (n < 0 || prev[n] !== -2 || inFoot(n)) continue;
      if (!v.isWalkable(n) && !(v.owned[n] === 1 && (v.occ[n] ?? 0) === 0)) continue;
      prev[n] = c;
      q.push(n);
    }
  }
  if (hit < 0) return null;
  const out: Cell[] = [];
  for (let c = hit; c >= 0; c = prev[c] ?? -1) if (v.road[c] !== 1) out.push({ x: c % GRID.w, y: Math.floor(c / GRID.w) });
  return out;
}
