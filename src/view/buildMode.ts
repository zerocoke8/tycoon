// 짓기 모드 (DESIGN 6.1): 지도 위 미리보기(유령)·길 칠하기·땅 고르기. VillageView(world.ts)가 손가락 입력을 넘겨주고, UI가 모드를 바꾸고 ✓/✕를 누른다.
//   place = 새로 놓기 (보관함에서, 없으면 ✓ 때 산다), move = 놓인 것 옮기기 (원래 그림은 숨기고 유령으로):
//     유령 = 그림 70% + 발자국 칸(놓을 수 있으면 초록, 없으면 빨강, 막힌 칸은 진하게) + 입구 칸 (길이면 초록, 아니면 노랑) + 큰 시설의 바닥(연못·경주로·마당).
//     유령을 잡고 끌면 칸에 붙어 따라온다 (잡은 자리 그대로). 유령 밖을 끌면 지도 이동, 누르면 유령이 그리로 온다.
//     ✓로 놓으면 위에서 톡 떨어져 출렁 + 먼지 (장식은 이어서 다음 칸에 하나 더).
//   road = 길 깔기, erase = 길 지우기: 한 손가락으로 칸을 칠하고 손을 떼면 바뀐다 (붓 1칸, 칠한 붓질은 되돌리기 undo).
//     길 모드에서는 건물마다 입구 칸 표시 (이어졌으면 초록 점, 아니면 노란 칸이 깜박), 마을 입구와 끊긴 길 칸은 주황 빗금.
//   land = 땅 사기: 살 수 있는 조각(가진 땅에 붙은 구름)마다 테두리와 값 (회관 레벨이 모자라면 자물쇠 글), 눌러 고르고 ✓로 산다.
// 칸 금은 바닥(ground.ts setGrid, 건물 아래)이 그리고, 칠하는 길은 바닥 미리보기(onPreview → ground.ts previewRoads: 진짜 길 모양)로 보인다.
// 두 손가락은 언제나 지도 이동·확대 (world.ts). 칠하던 길은 두 손가락이 닿으면 버린다. 손가락이 화면 가장자리에 닿으면 지도가 그쪽으로 (world.ts edgePan).
// 숫자·검사는 sim (SimApi.canPlace·place·move·paintRoad·eraseRoad·buyChunk), 여기는 보여 주기와 입력만.

import { Container, Graphics, Text } from 'pixi.js';
import { BOOTH_LAYOUT, BUILDING_LAYOUT, FLOORS, KITE_GEO, RACE_GEO, YARD_GEO, artBase, catalogKind, footprint, type CatalogKey } from '../data/catalog.ts';
import { BOOTHS, type BoothId, type BuildingId } from '../data/defs.ts';
import { CELL, CHUNK, CHUNKS, GRID, GROUND_STYLE, cellIndex, type Cell, type Pt } from '../data/map.ts';
import type { Result, SimApi } from '../sim/api.ts';
import { underRoof, type PlaceCheck, type Village } from '../sim/village.ts';
import { ART_SCALE, ArtNode, artMeta } from './art.ts';
import type { BuildingsView } from './buildings.ts';
import type { FxLayer } from './fx.ts';
import { clamp, trackBand } from './mapUtil.ts';

export type BuildMode =
  | { readonly kind: 'none' }
  | { readonly kind: 'place'; readonly key: CatalogKey }
  | { readonly kind: 'move'; readonly id: number }
  | { readonly kind: 'road' }
  | { readonly kind: 'erase' }
  /** chunk = 처음 고를 조각 (지도에서 구름을 눌렀을 때). */
  | { readonly kind: 'land'; readonly chunk?: number };

/** 짓기 모드의 지금 모습 (UI가 ✓/✕·띠에 보여 준다). */
export interface BuildState {
  readonly mode: BuildMode;
  /** place·move: 유령 칸 (왼쪽 위)과 그 자리 검사. */
  readonly cell: Cell | null;
  readonly check: PlaceCheck | null;
  /** land: 고른 조각 (map.ts chunkIndex, -1 = 없음). */
  readonly chunk: number;
  /** road·erase: 되돌릴 수 있는 붓질 수. */
  readonly undo: number;
  /** place·move: 손가락으로 유령을 끄는 중. */
  readonly dragging: boolean;
  /** place·move: 둘레에 놓을 자리가 있다 (false = 땅을 넓혀야 놓을 수 있다). */
  readonly roomy: boolean;
}

/** 세계 좌표 사각형 (UI가 ✓/✕를 그 둘레에 띄운다). */
export interface WorldBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const OK_FILL = 0x7fd27a;
const BAD_FILL = 0xe0614c;
const ENTRY_OK = 0x2e9e4f;
const ENTRY_NEED = 0xf0b43c;
const OUTLINE = 0x402c1c;
const ERASE = 0xd94040;
const CUT = 0xf08a3c;
const GOLD = 0xf6c945;
const PAPER = 0xfff8ea;
const SAND = 0xe8c98f;
/** 되돌리기 붓질을 기억하는 수. */
const UNDO_MAX = 40;
/** 떨어지는 연출 (초): 떨어지기 → 출렁. */
const DROP_FALL = 0.16;
const DROP_END = 0.62;
/** 땅 값 글자: 화면에서 보이는 글자 크기 (px) / 세계 글자 크기. */
const LABEL_FONT = 40;
const LABEL_SCREEN = 16;

const NONE: BuildMode = { kind: 'none' };

/** 유령 그림 한 조각 (건물 기준 상대 자리, 배율 k = 세계 px / 캔버스 px). */
interface GhostPart {
  readonly art: string;
  readonly at: Pt;
  readonly k: number;
}

/** 지도에 서는 그림 그대로 (buildings.ts와 같은 그림·배율): 부스 = 부스 그림 + 소품, 일터 = 밭·광산·소품, 그 밖 = 하나. */
function ghostParts(key: CatalogKey): GhostPart[] {
  switch (catalogKind(key)) {
    case 'booth': {
      const b = key as BoothId;
      const s = BOOTH_LAYOUT[b].spot;
      const out: GhostPart[] = [{ art: BOOTHS[b].building, at: s.base, k: s.buildingK ?? ART_SCALE.booth }];
      for (const p of s.props ?? []) out.push({ art: p.key, at: p.at, k: p.k });
      return out;
    }
    case 'building': {
      if (key === 'workyard') {
        const out: GhostPart[] = [];
        for (const f of Object.values(YARD_GEO.facilities)) out.push({ art: f.art, at: f.at, k: f.k });
        for (const p of YARD_GEO.props) out.push({ art: p.key, at: p.at, k: p.k });
        return out;
      }
      const L = BUILDING_LAYOUT[key as BuildingId] as (typeof BUILDING_LAYOUT)[BuildingId] | undefined;
      return [{ art: key, at: L?.base ?? artBase(key), k: L?.k ?? ART_SCALE.building }];
    }
    default:
      return [{ art: key, at: artBase(key), k: ART_SCALE.prop }];
  }
}

/** 칸 a에서 b까지 가로·세로로 이은 칸들 (끊기지 않는 길이 되게, a 빼고 b 포함). */
function gridLine(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const sx = Math.sign(b.x - a.x);
  const sy = Math.sign(b.y - a.y);
  let ex = 0;
  let ey = 0;
  for (let n = 0; n < dx + dy; n++) {
    // 덜 나아간 쪽으로 한 칸 (비율을 맞춰 대각선은 계단으로).
    const fx = dx === 0 ? Infinity : (ex + 0.5) / dx;
    const fy = dy === 0 ? Infinity : (ey + 0.5) / dy;
    if (fx <= fy) {
      x += sx;
      ex++;
    } else {
      y += sy;
      ey++;
    }
    out.push({ x, y });
  }
  return out;
}

/** 땅 값 이름표 하나 (둥근 종이 + 코인 + 글). w = 이름표 폭 (글자 단위, 배율 전). */
interface LandLabel {
  readonly node: Container;
  readonly bg: Graphics;
  readonly text: Text;
  chunk: number;
  key: string;
  w: number;
}

/** 땅 이름표가 조각 폭에서 차지해도 되는 몫 (이웃 조각 이름표와 겹치지 않게). */
const LABEL_FIT = 0.86;

/** 유령 (그림 조각들 + 바닥 모양). 아래 가운데(첫 그림 자리)를 축으로 출렁인다. */
interface Ghost {
  readonly node: Container;
  readonly parts: ArtNode[];
  readonly key: CatalogKey;
  /** 칸에 붙은 자리 (그림은 여기로 미끄러진다). placed = 한 번이라도 자리를 잡았다. */
  tx: number;
  ty: number;
  placed: boolean;
  /** 첫 그림 자리 (건물 기준). */
  readonly base: Pt;
}

export class BuildModeView {
  /** 지도 맨 위층 (카메라 안 세계 좌표). */
  readonly node = new Container();
  /** 모드·유령·고른 땅이 바뀔 때 (UI가 ✓/✕와 띠를 고친다). */
  onChange: (s: BuildState) => void = () => {};
  /** 행동이 안 됐을 때 이유 (UI가 토스트로). */
  onFail: (reason: string) => void = () => {};
  /** 칠하는 중인 길 미리보기 (바닥이 진짜 길 모양으로 그린다: add = 깔 칸, erase = 지울 칸, 둘 다 null = 지우기). */
  onPreview: (add: ReadonlySet<number> | null, erase: ReadonlySet<number> | null) => void = () => {};

  private readonly sim: SimApi;
  private readonly buildings: BuildingsView;
  private readonly fx: FxLayer;
  private mode: BuildMode = NONE;
  private cell: Cell | null = null;
  private check: PlaceCheck | null = null;
  private chunk = -1;
  /** 층 (아래에서 위): 땅 테두리 → 입구 표시 → 지우는 길 → 유령 바닥 → 발자국 → 유령 그림 → 붓 → 땅 값 → 떨어지는 그림. */
  private readonly land = new Graphics();
  private readonly marks = new Graphics();
  private readonly warn = new Graphics();
  private readonly paint = new Graphics();
  private readonly floor = new Graphics();
  private readonly cells = new Graphics();
  private readonly ghostLayer = new Container();
  private readonly cursor = new Graphics();
  private readonly labels = new Container();
  private readonly dropLayer = new Container();
  private ghost: Ghost | null = null;
  /** 칠하는 중인 길 칸 (손을 떼면 sim으로). */
  private readonly pending = new Set<number>();
  private last: Cell | null = null;
  private stroking = false;
  /** 손을 뗀 붓질의 미리보기를 몇 프레임 더 둔다 (바닥 타일을 다시 굽는 동안 길이 깜박이지 않게). */
  private hold: { readonly cells: ReadonlySet<number>; readonly erase: boolean; frames: number } | null = null;
  /** 칠한 붓질 (되돌리기: erase = 지운 붓질이었다). */
  private readonly strokes: { readonly erase: boolean; readonly cells: Cell[] }[] = [];
  /** 유령을 잡고 끄는 중: 잡은 점과 유령 왼쪽 위의 차이 (세계 px). */
  private grabbing = false;
  /** 처음 자리를 찾을 때 둘레에 놓을 자리가 있었나. */
  private roomy = true;
  private grabDX = 0;
  private grabDY = 0;
  private time = 0;
  private zoom = 0.5;
  /** 다시 그릴 때를 아는 마을 도장 (place·road·land). */
  private seen = { place: -1, road: -1, land: -1, hall: -1 };
  private readonly landLabels: LandLabel[] = [];
  private labelTick = 0;
  /** 떨어지는 연출 중인 그림 (놓은 건물·장식). */
  private drop: { g: Ghost; t: number; id: number; at: Pt; spread: number; landed: boolean } | null = null;

  constructor(sim: SimApi, buildings: BuildingsView, fx: FxLayer) {
    this.sim = sim;
    this.buildings = buildings;
    this.fx = fx;
    this.node.eventMode = 'none';
    this.node.interactiveChildren = false;
    this.node.addChild(this.land, this.marks, this.warn, this.paint, this.floor, this.cells, this.ghostLayer, this.cursor, this.labels, this.dropLayer);
    this.node.visible = false;
  }

  get current(): BuildMode {
    return this.mode;
  }

  /** 손가락 하나를 이 모드가 바로 받나 (길 칠하기). 놓기·옮기기는 유령을 잡았을 때만 (hitGhost). */
  get paintMode(): boolean {
    const k = this.mode.kind;
    return k === 'road' || k === 'erase';
  }

  /** 유령이 있는 모드 (놓기·옮기기). */
  get ghostMode(): boolean {
    const k = this.mode.kind;
    return k === 'place' || k === 'move';
  }

  state(): BuildState {
    return { mode: this.mode, cell: this.cell, check: this.check, chunk: this.chunk, undo: this.strokes.length, dragging: this.grabbing, roomy: this.roomy };
  }

  /** 모드를 바꾼다. at = 유령을 처음 둘 세계 점 (보통 화면 가운데, 옮기기는 지금 자리). 길 ↔ 지우개는 되돌리기를 이어 간다. */
  set(mode: BuildMode, at?: Pt): void {
    // 이미 지도에 있는 부스·건물을 '놓기'로 고르면 옮기기로.
    if (mode.kind === 'place' && catalogKind(mode.key) !== 'decor') {
      const p = this.sim.village().placed(mode.key);
      if (p !== undefined) mode = { kind: 'move', id: p.id };
    }
    if (mode.kind === 'move') {
      const p = this.sim.village().byId.get(mode.id);
      if (p === undefined || footprint(p.key).fixed === true) {
        if (p !== undefined) this.onFail('마을 입구는 옮길 수 없어요.');
        mode = NONE;
      }
    }
    const prev = this.mode.kind;
    const roadish = (k: BuildMode['kind']): boolean => k === 'road' || k === 'erase';
    if (!(roadish(prev) && roadish(mode.kind))) this.strokes.length = 0;
    // 떨어지는 연출은 이어 간다 (옮기기를 시작하면 숨길 그림이 겹치니 끝낸다).
    if (mode.kind === 'move') this.finishDrop();
    this.clearGhost();
    this.pending.clear();
    this.hold = null;
    this.stroking = false;
    this.grabbing = false;
    this.mode = mode;
    this.cell = null;
    this.check = null;
    this.chunk = -1;
    this.buildings.setHidden(mode.kind === 'move' ? mode.id : (this.drop?.id ?? 0));
    const key = this.ghostKey();
    if (key !== null) {
      this.ghost = this.makeGhost(key, 0.72);
      this.ghostLayer.addChild(this.ghost.node);
      if (mode.kind === 'move') {
        const p = this.sim.village().byId.get(mode.id);
        if (p !== undefined) this.cell = { x: p.x, y: p.y };
      }
      if (this.cell === null && at !== undefined) this.cell = this.nearestFree(key, this.cellFor(key, at));
      this.recheck();
      this.roomy = this.placeable();
    }
    if (mode.kind === 'land' && mode.chunk !== undefined && mode.chunk >= 0 && this.sim.chunk(mode.chunk).adjacent) this.chunk = mode.chunk;
    this.node.visible = mode.kind !== 'none' || this.drop !== null;
    this.seen = { place: -1, road: -1, land: -1, hall: -1 };
    this.redrawAll();
    this.onChange(this.state());
  }

  /** ✓: 놓기·옮기기·땅 사기 (길은 손을 뗄 때 바뀌어서 모드만 끝낸다). 된 뒤에는 모드를 끝낸다 (장식은 이어서 다음 칸에). */
  confirm(): Result {
    const m = this.mode;
    let r: Result = { ok: true };
    if (m.kind === 'place' || m.kind === 'move') {
      const key = this.ghostKey();
      if (this.cell === null || key === null) r = { ok: false, reason: '놓을 자리를 골라요.' };
      else {
        const before = new Set(this.sim.village().byId.keys());
        r = m.kind === 'place' ? this.sim.place(m.key, this.cell) : this.sim.move(m.id, this.cell);
        if (r.ok) {
          // 놓인 것 (새 id, 옮기기는 그 id)에 떨어지는 연출.
          const v = this.sim.village();
          let id = m.kind === 'move' ? m.id : 0;
          if (id === 0) for (const k of v.byId.keys()) if (!before.has(k)) id = k;
          this.startDrop(id, key);
          if (m.kind === 'place' && catalogKind(m.key) === 'decor') {
            // 장식은 이어서: 새 유령을 가까운 빈 칸에.
            this.ghost = this.makeGhost(key, 0.72);
            this.ghostLayer.addChild(this.ghost.node);
            this.cell = this.nearestFree(key, this.cell);
            this.recheck();
            this.redrawAll();
            this.onChange(this.state());
            return r;
          }
        }
      }
    } else if (m.kind === 'land') {
      r = this.chunk < 0 ? { ok: false, reason: '살 땅을 골라요. 값이 적힌 구름을 눌러요.' } : this.sim.buyChunk(this.chunk);
      if (r.ok) {
        const S = CHUNK * CELL;
        const info = this.sim.chunk(this.chunk);
        this.fx.sparkles((info.cx + 0.5) * S, (info.cy + 0.5) * S, 16, S * 0.4);
        this.chunk = -1;
        this.redrawAll();
        this.onChange(this.state());
        return r;
      }
    }
    if (!r.ok) {
      this.onFail(r.reason);
      return r;
    }
    this.set(NONE);
    return r;
  }

  /** ✕: 그만 (칠하던 길은 버린다). */
  cancel(): void {
    this.set(NONE);
  }

  /** 마지막 붓질을 되돌린다 (깐 길은 지우고, 지운 길은 다시 깐다). */
  undo(): Result {
    const s = this.strokes.pop();
    if (s === undefined) return { ok: false, reason: '되돌릴 길이 없어요.' };
    const r = s.erase ? this.sim.paintRoad(s.cells) : this.sim.eraseRoad(s.cells);
    this.redrawAll();
    this.onChange(this.state());
    return r;
  }

  /** 유령이 차지한 칸 (land는 고른 조각, 세계 px). 없으면 null. */
  anchor(): WorldBox | null {
    const key = this.ghostKey();
    if (key !== null && this.cell !== null) {
      // 입구 칸까지 (✓/✕가 입구 표시를 가리지 않게).
      const fp = footprint(key);
      const e = fp.entry;
      const x0 = this.cell.x + Math.min(0, e?.x ?? 0);
      const y0 = this.cell.y + Math.min(0, e?.y ?? 0);
      const x1 = this.cell.x + Math.max(fp.w, (e?.x ?? 0) + 1);
      const y1 = this.cell.y + Math.max(fp.h, (e?.y ?? 0) + 1);
      return { x0: x0 * CELL, y0: y0 * CELL, x1: x1 * CELL, y1: y1 * CELL };
    }
    if (this.mode.kind === 'land' && this.chunk >= 0) {
      const S = CHUNK * CELL;
      const cx = this.chunk % CHUNKS.w;
      const cy = Math.floor(this.chunk / CHUNKS.w);
      return { x0: cx * S, y0: cy * S, x1: (cx + 1) * S, y1: (cy + 1) * S };
    }
    return null;
  }

  // ── 손가락 (세계 좌표) ──

  /** 세계 점이 유령 위인가 (발자국 + 그림, 손가락 크기만큼 넉넉히). */
  hitGhost(wx: number, wy: number): boolean {
    const key = this.ghostKey();
    if (key === null || this.cell === null || this.ghost === null) return false;
    const fp = footprint(key);
    const pad = Math.max(30, 24 / this.zoom);
    const x0 = this.cell.x * CELL;
    const y0 = this.cell.y * CELL;
    if (wx >= x0 - pad && wx <= x0 + fp.w * CELL + pad && wy >= y0 - pad && wy <= y0 + fp.h * CELL + pad) return true;
    // 그림 (발자국 위로 삐져나간 지붕).
    const p = ghostParts(key)[0];
    const m = p === undefined ? undefined : artMeta('map', p.art);
    if (p === undefined || m === undefined) return false;
    const w = m.trim.w * p.k;
    const h = m.trim.h * p.k;
    const bx = x0 + p.at.x;
    const by = y0 + p.at.y;
    return wx >= bx - w / 2 - pad && wx <= bx + w / 2 + pad && wy >= by - h - pad && wy <= by + pad;
  }

  /** 유령을 잡는다 (place·move) 또는 칠하기 시작 (road·erase). */
  down(wx: number, wy: number): void {
    if (this.ghostMode) {
      if (this.cell === null) return;
      this.grabbing = true;
      this.grabDX = wx - this.cell.x * CELL;
      this.grabDY = wy - this.cell.y * CELL;
      this.onChange(this.state());
    } else if (this.paintMode) {
      this.stroking = true;
      this.pending.clear();
      this.last = null;
      this.addPaint(wx, wy);
    }
  }

  move(wx: number, wy: number): void {
    if (this.ghostMode && this.grabbing) {
      this.moveGhostTo({ x: Math.round((wx - this.grabDX) / CELL), y: Math.round((wy - this.grabDY) / CELL) });
    } else if (this.stroking) this.addPaint(wx, wy);
  }

  up(): void {
    if (this.grabbing) {
      this.grabbing = false;
      this.onChange(this.state());
      return;
    }
    if (!this.stroking) return;
    this.stroking = false;
    this.last = null;
    const cells = [...this.pending].map((i) => ({ x: i % GRID.w, y: Math.floor(i / GRID.w) }));
    this.hold = cells.length > 0 ? { cells: new Set(this.pending), erase: this.mode.kind === 'erase', frames: 4 } : null;
    this.pending.clear();
    this.drawPaint();
    if (cells.length === 0) return;
    const erase = this.mode.kind === 'erase';
    const cut = erase ? [] : this.cutIds();
    const r = erase ? this.sim.eraseRoad(cells) : this.sim.paintRoad(cells);
    if (!r.ok) {
      this.hold = null;
      this.onFail(r.reason);
    } else {
      this.strokes.push({ erase, cells });
      if (this.strokes.length > UNDO_MAX) this.strokes.shift();
      // 길이 이어진 건물: 입구에 반짝 (알림은 sim.paintRoad가 토스트로).
      const v = this.sim.village();
      for (const id of cut) {
        const p = v.byId.get(id);
        if (p === undefined || !v.linkedId(id)) continue;
        const e = footprint(p.key).entry;
        if (e === undefined) continue;
        this.fx.sparkles((p.x + e.x + 0.5) * CELL, (p.y + e.y + 0.5) * CELL - 30, 12, 70);
      }
    }
    this.recheck();
    this.redrawAll();
    this.onChange(this.state());
  }

  /** 입구가 마을 입구와 이어지지 않은 건물 id (장식·마을 입구 빼고). */
  private cutIds(): number[] {
    const v = this.sim.village();
    return v.state.placed.filter((p) => catalogKind(p.key) !== 'decor' && p.key !== 'gate' && footprint(p.key).entry !== undefined && !v.linkedId(p.id)).map((p) => p.id);
  }

  /** 칠하던 길을 버린다 (두 손가락이 닿았을 때). 끌던 유령은 그 자리에 둔다. */
  cancelStroke(): void {
    this.stroking = false;
    this.last = null;
    this.pending.clear();
    if (this.grabbing) {
      this.grabbing = false;
      this.onChange(this.state());
    }
    this.drawPaint();
  }

  /** 누르기: place·move = 유령을 그리로, land = 조각 고르기. 받았으면 true. */
  tap(wx: number, wy: number): boolean {
    const key = this.ghostKey();
    if (key !== null) {
      this.moveGhostTo(this.cellFor(key, { x: wx, y: wy }));
      return true;
    }
    if (this.mode.kind !== 'land') return false;
    const S = CHUNK * CELL;
    const cx = Math.floor(wx / S);
    const cy = Math.floor(wy / S);
    const c = cx >= 0 && cy >= 0 && cx < CHUNKS.w && cy < CHUNKS.h ? cy * CHUNKS.w + cx : -1;
    const info = c >= 0 ? this.sim.chunk(c) : null;
    if (info !== null && !info.owned && info.adjacent) this.chunk = c;
    else {
      this.chunk = -1;
      if (info !== null && !info.owned) this.onFail('가진 땅에 붙은 땅만 살 수 있어요.');
    }
    this.drawLand();
    this.onChange(this.state());
    return true;
  }

  update(dt: number, zoom: number): void {
    this.time += dt;
    this.zoom = zoom;
    this.updateDrop(dt);
    if (this.hold !== null && --this.hold.frames <= 0) {
      this.hold = null;
      this.drawPaint();
    }
    if (this.mode.kind === 'none') return;
    const v = this.sim.village();
    const hall = this.sim.hallLevel();
    // 마을이 바뀌었으면 (땅을 샀다, 길을 깔았다 …) 다시 그리고 유령 검사도 다시.
    if (v.stamp.place !== this.seen.place || v.stamp.road !== this.seen.road || v.stamp.land !== this.seen.land || hall !== this.seen.hall) {
      const was = this.check;
      const landed = v.stamp.land !== this.seen.land && this.seen.land >= 0;
      this.recheck();
      // 땅을 넓혔는데 유령 자리가 아직 안 되면 새 땅까지 둘레에서 자리를 다시 찾는다.
      const key = this.ghostKey();
      if (landed && key !== null && this.cell !== null && !this.placeable()) {
        this.cell = this.nearestFree(key, this.cell);
        this.recheck();
        this.roomy = this.placeable();
        this.onChange(this.state());
      }
      this.redrawAll();
      if (was?.ok !== this.check?.ok || was?.entryRoad !== this.check?.entryRoad) this.onChange(this.state());
    }
    // 유령이 살짝 숨쉬고, 길이 없는 입구가 깜박인다.
    if (this.ghost !== null) {
      const ok = this.check?.ok !== false;
      const n = this.ghost.node;
      n.alpha = this.grabbing ? 0.82 : 0.66 + Math.sin(this.time * 4) * 0.1;
      n.tint = ok ? 0xffffff : 0xffa89a;
      // 칸 사이를 미끄러지고, 잡으면 살짝 들린다.
      const f = 1 - Math.exp(-28 * Math.min(dt, 0.1));
      n.x += (this.ghost.tx - n.x) * f;
      n.y += (this.ghost.ty - n.y) * f;
      const lift = this.grabbing ? 1.06 : 1;
      n.scale.set(n.scale.x + (lift - n.scale.x) * f);
    }
    this.warn.alpha = 0.55 + Math.sin(this.time * 5) * 0.35;
    // 땅 값 글자는 화면에서 늘 같은 크기로 (멀리 줄여 조각보다 커지면 조각 폭에 맞춰 줄인다), 코인이 모자라면 붉게 (4Hz).
    if (this.mode.kind === 'land') {
      const s = clamp(LABEL_SCREEN / LABEL_FONT / zoom, 0.4, 6);
      const S = CHUNK * CELL;
      for (const l of this.landLabels) if (l.node.visible) l.node.scale.set(Math.min(s, (S * LABEL_FIT) / Math.max(1, l.w)));
      this.labelTick -= dt;
      if (this.labelTick <= 0) {
        this.labelTick = 0.25;
        this.syncLabels();
      }
    }
  }

  destroy(): void {
    this.finishDrop();
    this.clearGhost();
    this.node.destroy({ children: true });
  }

  // ── 안쪽 ──

  private ghostKey(): CatalogKey | null {
    const m = this.mode;
    if (m.kind === 'place') return m.key;
    if (m.kind === 'move') return this.sim.village().byId.get(m.id)?.key ?? null;
    return null;
  }

  /** 세계 점에 발자국 가운데가 오는 칸 (왼쪽 위). */
  private cellFor(key: CatalogKey, p: Pt): Cell {
    const fp = footprint(key);
    return { x: Math.round(p.x / CELL - fp.w / 2), y: Math.round(p.y / CELL - fp.h / 2) };
  }

  /**
   * c 둘레(가까운 칸부터, 12칸 안)에서 놓을 수 있는 자리 (입구가 길에 닿는 자리를 먼저). 없으면 c 그대로.
   * 장식은 아래 건물 지붕에 가리는 줄(village.ts underRoof)을 뒤로 미룬다 (놓고 나면 안 보인다).
   */
  private nearestFree(key: CatalogKey, c: Cell): Cell {
    const moving = this.mode.kind === 'move' ? this.mode.id : 0;
    const decor = catalogKind(key) === 'decor';
    const v = this.sim.village();
    let ok: Cell | null = null;
    let roofed: Cell | null = null;
    for (let r = 0; r <= 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const p = { x: c.x + dx, y: c.y + dy };
          const chk = this.sim.canPlace(key, p, moving);
          if (!chk.ok) continue;
          if (decor && underRoof(v, p.x, p.y)) {
            roofed ??= p;
            continue;
          }
          if (chk.entry === null || chk.entryRoad) return p;
          ok ??= p;
        }
      }
      if (ok !== null && r >= 4) return ok;
    }
    return ok ?? roofed ?? c;
  }

  private moveGhostTo(c: Cell): void {
    // 지도 밖으로 나가지 않게 (발자국이 다 들어오게).
    const key = this.ghostKey();
    if (key === null) return;
    const fp = footprint(key);
    const x = clamp(c.x, 0, GRID.w - fp.w);
    const y = clamp(c.y, 0, GRID.h - fp.h);
    if (this.cell !== null && this.cell.x === x && this.cell.y === y) return;
    this.cell = { x, y };
    this.recheck();
    this.drawGhost();
    this.onChange(this.state());
  }

  /** 지금 유령 자리에 놓을 수 있나. */
  private placeable(): boolean {
    return this.check?.ok === true;
  }

  private recheck(): void {
    const key = this.ghostKey();
    this.check = key === null || this.cell === null ? null : this.sim.canPlace(key, this.cell, this.mode.kind === 'move' ? this.mode.id : 0);
  }

  private addPaint(wx: number, wy: number): void {
    const c = { x: Math.floor(wx / CELL), y: Math.floor(wy / CELL) };
    const steps = this.last === null ? [c] : gridLine(this.last, c);
    this.last = c;
    const v = this.sim.village();
    // 지우개: 마을 입구 앞 길 칸은 지울 수 없다 (sim.eraseRoad가 건너뛴다: 미리보기에도 칠하지 않는다).
    const g = v.placed('gate');
    const ge = g === undefined ? -1 : v.entryCellIndex(g);
    for (const s of steps) {
      const i = cellIndex(s.x, s.y);
      if (i < 0 || this.pending.has(i)) continue;
      const ok = this.mode.kind === 'road' ? v.isOwned(s.x, s.y) && v.at(s.x, s.y) === undefined && !v.isRoad(s.x, s.y) : v.isRoad(s.x, s.y) && i !== ge;
      if (ok) this.pending.add(i);
    }
    this.drawPaint();
  }

  private makeGhost(key: CatalogKey, alpha: number): Ghost {
    const node = new Container();
    const fp = footprint(key);
    const parts: ArtNode[] = [];
    const list = ghostParts(key);
    for (const p of list) {
      const a = new ArtNode({ k: p.k, anchor: 'bottom', placeholder: { w: (fp.w * CELL * 0.8) / p.k, h: (fp.h * CELL * 0.9) / p.k, color: 0xd9c7a6 } });
      a.setArt('map', p.art);
      a.position.set(p.at.x, p.at.y);
      node.addChild(a);
      parts.push(a);
    }
    const base = list[0]?.at ?? { x: (fp.w * CELL) / 2, y: fp.h * CELL };
    node.pivot.set(base.x, base.y);
    node.alpha = alpha;
    return { node, parts, key, base, tx: 0, ty: 0, placed: false };
  }

  private clearGhost(): void {
    if (this.ghost !== null) {
      this.ghost.node.destroy({ children: true });
      this.ghost = null;
    }
  }

  // ── 놓았을 때: 위에서 톡 떨어져 출렁 + 먼지 ──

  private startDrop(id: number, key: CatalogKey): void {
    this.finishDrop();
    const g = this.ghost;
    this.ghost = null;
    const p = this.sim.village().byId.get(id);
    if (g === null || p === undefined) {
      g?.node.destroy({ children: true });
      return;
    }
    const fp = footprint(key);
    const at = { x: p.x * CELL + g.base.x, y: p.y * CELL + g.base.y };
    this.dropLayer.addChild(g.node);
    g.node.alpha = 1;
    g.node.tint = 0xffffff;
    g.node.position.set(at.x, at.y - 90);
    this.drop = { g, t: 0, id, at, spread: Math.min(260, fp.w * CELL * 0.32 + 40), landed: false };
    // 진짜 그림은 내려앉을 때까지 숨긴다.
    this.buildings.setHidden(id);
    this.node.visible = true;
  }

  private updateDrop(dt: number): void {
    const d = this.drop;
    if (d === null) return;
    d.t += dt;
    const n = d.g.node;
    if (d.t < DROP_FALL) {
      const u = d.t / DROP_FALL;
      n.position.set(d.at.x, d.at.y - 90 * (1 - u * u));
      n.scale.set(0.94, 1.06);
      return;
    }
    if (!d.landed) {
      d.landed = true;
      n.position.set(d.at.x, d.at.y);
      this.fx.puff(d.at.x, d.at.y, 10, d.spread);
      this.fx.sparkles(d.at.x, d.at.y - d.spread * 0.8, 6, d.spread * 0.8);
    }
    const u = (d.t - DROP_FALL) / (DROP_END - DROP_FALL);
    if (u >= 1) {
      this.finishDrop();
      return;
    }
    const a = Math.sin(u * Math.PI * 2.5) * (1 - u) * 0.16;
    n.scale.set(1 + a * 0.7, 1 - a);
  }

  /** 떨어지는 연출을 끝낸다 (진짜 그림을 다시 보인다: 옮기기 모드가 숨긴 것은 그대로). */
  private finishDrop(): void {
    const d = this.drop;
    if (d === null) return;
    this.drop = null;
    d.g.node.destroy({ children: true });
    if (this.mode.kind !== 'move') this.buildings.setHidden(0);
    if (this.mode.kind === 'none') this.node.visible = false;
  }

  // ── 그리기 ──

  private redrawAll(): void {
    const v = this.sim.village();
    const hall = this.sim.hallLevel();
    const k = this.mode.kind;
    if (v.stamp.place !== this.seen.place || v.stamp.road !== this.seen.road || v.stamp.land !== this.seen.land) this.drawMarks(v);
    if (k === 'land' || this.seen.hall !== hall || v.stamp.land !== this.seen.land) this.drawLand();
    this.seen = { place: v.stamp.place, road: v.stamp.road, land: v.stamp.land, hall };
    this.marks.visible = this.warn.visible = k === 'road' || k === 'erase';
    this.land.visible = this.labels.visible = k === 'land';
    this.drawGhost();
    this.drawPaint();
  }

  /** 길 모드: 건물 입구 칸 (이어졌으면 초록 점, 아니면 노란 칸이 깜박), 마을 입구와 끊긴 길 칸은 주황. */
  private drawMarks(v: Village): void {
    const g = this.marks;
    const w = this.warn;
    g.clear();
    w.clear();
    // 마을 입구와 끊긴 길: 주황 칸 + 빗금 (채우기를 다 하고 빗금은 한 번에 긋는다).
    const cut = v.state.roads.filter((i) => !(v.gateComp >= 0 && v.comp[i] === v.gateComp));
    for (const i of cut) {
      const x = (i % GRID.w) * CELL;
      const y = Math.floor(i / GRID.w) * CELL;
      g.roundRect(x + 4, y + 4, CELL - 8, CELL - 8, 16).fill({ color: CUT, alpha: 0.4 });
    }
    for (const i of cut) {
      const x = (i % GRID.w) * CELL;
      const y = Math.floor(i / GRID.w) * CELL;
      for (const k of [0.3, 0.65, 1]) g.moveTo(x + 10, y + CELL * k).lineTo(x + CELL * k, y + 10);
    }
    if (cut.length > 0) g.stroke({ width: 5, color: CUT, alpha: 0.85, cap: 'round' });
    for (const p of v.state.placed) {
      const fp = footprint(p.key);
      if (fp.entry === undefined) continue;
      const ex = (p.x + fp.entry.x) * CELL;
      const ey = (p.y + fp.entry.y) * CELL;
      const cx = ex + CELL / 2;
      const cy = ey + CELL / 2;
      if (v.linkedId(p.id) || p.key === 'gate') {
        g.circle(cx, cy, 20).fill({ color: ENTRY_OK }).stroke({ width: 5, color: 0xffffff });
        g.moveTo(cx - 9, cy).lineTo(cx - 2, cy + 7).lineTo(cx + 10, cy - 7).stroke({ width: 5, color: 0xffffff, cap: 'round', join: 'round' });
      } else {
        w.roundRect(ex + 8, ey + 8, CELL - 16, CELL - 16, 18).fill({ color: ENTRY_NEED, alpha: 0.6 }).stroke({ width: 7, color: ENTRY_NEED });
        // 느낌표.
        w.roundRect(cx - 5, cy - 26, 10, 32, 5).fill(OUTLINE);
        w.circle(cx, cy + 18, 6).fill(OUTLINE);
      }
    }
  }

  /** 유령: 바닥 모양 + 발자국 (초록·빨강, 막힌 칸) + 입구 칸 + 그림 자리. */
  private drawGhost(): void {
    const g = this.cells;
    const f = this.floor;
    g.clear();
    f.clear();
    const key = this.ghostKey();
    if (key === null || this.cell === null || this.check === null || this.ghost === null) return;
    const fp = footprint(key);
    const x0 = this.cell.x * CELL;
    const y0 = this.cell.y * CELL;
    const W = fp.w * CELL;
    const H = fp.h * CELL;
    const ok = this.check.ok;
    const col = ok ? OK_FILL : BAD_FILL;
    // 큰 시설의 바닥 (연못·경주로·마당·길): 놓으면 어떻게 보일지.
    for (const s of FLOORS[key] ?? []) {
      if (s.kind === 'plaza') f.ellipse(x0 + s.c.x, y0 + s.c.y, s.rx, s.ry).fill({ color: SAND, alpha: 0.6 });
      else if (s.kind === 'pond') f.ellipse(x0 + s.shape.c.x, y0 + s.shape.c.y, s.shape.rx, s.shape.ry).fill({ color: GROUND_STYLE.pond, alpha: 0.65 });
      else if (s.kind === 'road') f.rect(x0 + s.rect.x, y0 + s.rect.y, s.rect.w, s.rect.h).fill({ color: GROUND_STYLE.road, alpha: 0.7 });
      else if (s.kind === 'walk') {
        // 디딤돌 (바닥 ground.ts drawWalk를 옅게).
        const vertical = s.rect.h >= s.rect.w;
        const len = vertical ? s.rect.h : s.rect.w;
        const n = Math.max(1, Math.round(len / (CELL / 2)));
        for (let k = 0; k < n; k++) {
          const t = ((k + 0.5) / n) * len;
          const cx = x0 + s.rect.x + (vertical ? s.rect.w / 2 : t);
          const cy = y0 + s.rect.y + (vertical ? t : s.rect.h / 2);
          f.ellipse(cx, cy, vertical ? 28 : 20, vertical ? 17 : 25).fill({ color: 0xeee3cf, alpha: 0.75 });
        }
      }
      else {
        const B = trackBand(RACE_GEO);
        f.ellipse(x0 + B.cx, y0 + B.cy, B.rxOut, B.ryOut).fill({ color: SAND, alpha: 0.6 });
        f.ellipse(x0 + B.cx, y0 + B.cy, B.rxIn, B.ryIn).cut();
      }
    }
    // 연날리기 언덕 (바닥층에 그리는 낮은 풀 언덕: view/group/kite.ts).
    if (key === 'kite') {
      const h = KITE_GEO.hill;
      f.ellipse(x0 + h.c.x, y0 + h.c.y + h.rise, h.rx, h.ry).fill({ color: 0x6f9a4a, alpha: 0.6 });
      f.ellipse(x0 + h.c.x, y0 + h.c.y, h.rx, h.ry).fill({ color: 0xa8d47a, alpha: 0.7 });
    }
    g.roundRect(x0, y0, W, H, 18).fill({ color: col, alpha: 0.3 }).stroke({ width: 7, color: col, alpha: 0.95 });
    // 칸 금.
    for (let x = 1; x < fp.w; x++) g.moveTo(x0 + x * CELL, y0 + 8).lineTo(x0 + x * CELL, y0 + H - 8);
    for (let y = 1; y < fp.h; y++) g.moveTo(x0 + 8, y0 + y * CELL).lineTo(x0 + W - 8, y0 + y * CELL);
    g.stroke({ width: 3, color: 0xffffff, alpha: 0.45 });
    // 막힌 칸: 진한 빨강 + ×.
    for (const b of this.check.bad) g.roundRect(b.x * CELL + 6, b.y * CELL + 6, CELL - 12, CELL - 12, 12).fill({ color: BAD_FILL, alpha: 0.55 });
    // × 표시는 막힌 칸이 몇 개일 때만 (큰 시설이 다 막히면 칸마다 ×가 어지럽다).
    if (this.check.bad.length <= 12) {
      for (const b of this.check.bad) {
        const bx = b.x * CELL;
        const by = b.y * CELL;
        g.moveTo(bx + 30, by + 30).lineTo(bx + CELL - 30, by + CELL - 30).moveTo(bx + CELL - 30, by + 30).lineTo(bx + 30, by + CELL - 30);
      }
      if (this.check.bad.length > 0) g.stroke({ width: 7, color: 0xffffff, alpha: 0.85, cap: 'round' });
    }
    const e = this.check.entry;
    if (e !== null && fp.entry !== undefined) {
      // 입구 칸: 길로 이어졌으면 초록, 아니면 노랑 (길을 깔아야 손님이 온다). 건물 쪽을 가리키는 화살표.
      const bad = this.check.bad.some((b) => b.x === e.x && b.y === e.y);
      const ec = bad ? BAD_FILL : this.check.entryRoad ? ENTRY_OK : ENTRY_NEED;
      const ex = e.x * CELL + CELL / 2;
      const ey = e.y * CELL + CELL / 2;
      g.roundRect(e.x * CELL + 8, e.y * CELL + 8, CELL - 16, CELL - 16, 20).fill({ color: ec, alpha: 0.5 }).stroke({ width: 6, color: ec });
      // 화살표 방향: 입구 칸에서 건물 쪽으로.
      const dx = fp.entry.x < 0 ? 1 : fp.entry.x >= fp.w ? -1 : 0;
      const dy = fp.entry.y < 0 ? 1 : fp.entry.y >= fp.h ? -1 : 0;
      const L = 24;
      const tip = { x: ex + dx * L, y: ey + dy * L };
      const back = { x: ex - dx * L * 0.6, y: ey - dy * L * 0.6 };
      const nx = -dy * 20;
      const ny = dx * 20;
      g.poly([tip.x, tip.y, back.x + nx, back.y + ny, back.x - nx, back.y - ny]).fill(0xffffff).stroke({ width: 4, color: OUTLINE, join: 'round' });
    }
    // 그림은 새 칸으로 미끄러진다 (발자국은 바로): 처음 자리는 그대로.
    const gh = this.ghost;
    gh.tx = x0 + gh.base.x;
    gh.ty = y0 + gh.base.y;
    if (!gh.placed) {
      gh.placed = true;
      gh.node.position.set(gh.tx, gh.ty);
    }
  }

  /** 칠하는 중인 길 (깔기 = 바닥이 진짜 길 모양으로, 지우기 = 바닥 붉은 칸 + 여기 빨간 테두리)과 붓 칸. */
  private drawPaint(): void {
    const p = this.paint;
    const c = this.cursor;
    p.clear();
    c.clear();
    const k = this.mode.kind;
    const any = this.pending.size > 0;
    const h = !any && k !== 'none' ? this.hold : null;
    if (h !== null) this.onPreview(h.erase ? null : h.cells, h.erase ? h.cells : null);
    else this.onPreview(any && k === 'road' ? this.pending : null, any && k === 'erase' ? this.pending : null);
    if (k === 'erase') {
      for (const i of this.pending) {
        const x = (i % GRID.w) * CELL;
        const y = Math.floor(i / GRID.w) * CELL;
        p.roundRect(x + 8, y + 8, CELL - 16, CELL - 16, 14).stroke({ width: 6, color: ERASE });
      }
    }
    if (this.stroking && this.last !== null) {
      // 붓 칸: 칠할 수 있으면 하양, 아니면 빨강 (건물·사지 않은 땅·이미 길).
      const i = cellIndex(this.last.x, this.last.y);
      const ok = this.pending.has(i);
      c.roundRect(this.last.x * CELL - 4, this.last.y * CELL - 4, CELL + 8, CELL + 8, 22).stroke({ width: 8, color: ok ? 0xffffff : BAD_FILL, alpha: 0.95 });
    }
  }

  /** 땅: 살 수 있는 조각마다 테두리 + 값, 고른 조각은 금빛. */
  private drawLand(): void {
    const g = this.land;
    g.clear();
    const S = CHUNK * CELL;
    let used = 0;
    if (this.mode.kind === 'land') {
      for (let i = 0; i < CHUNKS.w * CHUNKS.h; i++) {
        const info = this.sim.chunk(i);
        if (info.owned || !info.adjacent) continue;
        const sel = i === this.chunk;
        const locked = this.sim.chunkLockReason(i) !== null;
        const x = info.cx * S;
        const y = info.cy * S;
        const r = g.roundRect(x + 20, y + 20, S - 40, S - 40, 48);
        if (sel) r.fill({ color: GOLD, alpha: 0.3 });
        else r.fill({ color: locked ? 0x6b625a : 0xffffff, alpha: locked ? 0.18 : 0.12 });
        r.stroke({ width: sel ? 22 : 12, color: sel ? GOLD : locked ? 0x8a8078 : OUTLINE, alpha: sel ? 1 : 0.8 });
        const l = this.labelAt(used++);
        l.chunk = i;
        l.node.position.set(x + S / 2, y + S / 2);
        l.node.visible = true;
      }
    }
    for (let j = used; j < this.landLabels.length; j++) {
      const l = this.landLabels[j] as LandLabel;
      l.node.visible = false;
      l.chunk = -1;
    }
    this.syncLabels();
  }

  private labelAt(i: number): LandLabel {
    let l = this.landLabels[i];
    if (l === undefined) {
      const node = new Container();
      const bg = new Graphics();
      const text = new Text({ text: '', style: { fontFamily: 'Jua, sans-serif', fontSize: LABEL_FONT, fill: OUTLINE, align: 'center' } });
      text.anchor.set(0, 0.5);
      node.addChild(bg, text);
      this.labels.addChild(node);
      l = { node, bg, text, chunk: -1, key: '', w: 1 };
      this.landLabels.push(l);
    }
    return l;
  }

  /** 이름표 글과 색 (값 / 회관 레벨 / 코인 모자람 / 고른 조각). 회관 레벨 글이 지금 확대에서 조각 폭을 넘으면 짧게 ('Lv.3부터'). */
  private syncLabels(): void {
    const coins = this.sim.state.coins;
    const S = CHUNK * CELL;
    const scale = clamp(LABEL_SCREEN / LABEL_FONT / this.zoom, 0.4, 6);
    for (const l of this.landLabels) {
      if (l.chunk < 0) continue;
      const info = this.sim.chunk(l.chunk);
      const lock = this.sim.chunkLockReason(l.chunk);
      const sel = l.chunk === this.chunk;
      const locked = lock !== null;
      const short = !locked && coins < info.price;
      // 긴 글 '마을회관 Lv.3부터' (약 9자) × 글자 폭이 조각 폭을 넘으면 짧게.
      const compact = locked && (46 + 12 + 9 * LABEL_FONT * 0.95 + 36) * scale > S * LABEL_FIT;
      const text = locked ? (compact ? `Lv.${info.hall}부터` : `마을회관 Lv.${info.hall}부터`) : `${info.price}`;
      const key = `${text}|${sel}|${short}|${locked}`;
      if (key === l.key) continue;
      l.key = key;
      l.text.text = text;
      l.text.style.fill = short ? 0xc0392b : locked ? 0x6b625a : OUTLINE;
      const icon = 46;
      const tw = l.text.width;
      const w = icon + 12 + tw + 36;
      l.w = w;
      const h = 70;
      const g = l.bg;
      g.clear();
      g.roundRect(-w / 2, -h / 2 + 5, w, h, h / 2).fill(OUTLINE);
      g.roundRect(-w / 2, -h / 2, w, h, h / 2).fill(sel ? GOLD : locked ? 0xe6e0d8 : PAPER).stroke({ width: 5, color: OUTLINE });
      const ix = -w / 2 + 18 + icon / 2;
      if (locked) {
        // 자물쇠.
        g.moveTo(ix - 10, -6).lineTo(ix - 10, -12).arc(ix, -12, 10, Math.PI, 0).lineTo(ix + 10, -6).stroke({ width: 5, color: OUTLINE, cap: 'round' });
        g.roundRect(ix - 16, -6, 32, 24, 6).fill(0x8a8078).stroke({ width: 4, color: OUTLINE });
      } else {
        // 코인.
        g.circle(ix, 0, icon / 2 - 2).fill(GOLD).stroke({ width: 4, color: OUTLINE });
        g.circle(ix, 0, icon / 2 - 11).stroke({ width: 3, color: 0xc99a2e });
      }
      l.text.position.set(ix + icon / 2 + 10, 2);
    }
  }
}
