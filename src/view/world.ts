// 마을 지도 화면 (VillageView): 카메라·층·입력, sim 이벤트를 연출로 잇는다.
// 층 (카메라 안, 세계 좌표): 바닥(구운 타일, 경주로 포함) → 바닥 그림(모래판·선착장·흙더미, 단체 놀이 표시) → 그림자(+ 경주장 방석)
//   → 물체(건물·소품·주민·손님·경주 선수·배, y로 정렬) → 효과(이모트·입자·숫자) → 하늘(연, 모든 것 위) → 디버그.
// 닫힌 구역의 구름은 물체층 안에서 구역 아래 변의 y로 정렬한다 (buildings.ts): 구역 바로 아래 키 큰 건물이 구름 앞에 선다.
// 조작: 한 손가락 끌기 = 이동(관성), 두 손가락 = 확대·축소(두 손가락 가운데 기준), 휠 = 확대·축소(커서 기준).
//       짧게 누르기(8px 안, 350ms 안) = 누르기: 손님 → 부스 → 건물 → 단체 놀이 마당(경주로·모래판·밧줄·연…) → 빈 땅.
// 단체 놀이 화면(경주장 racetrack.ts, 씨름·오리배·연·줄다리기·보물찾기 view/group/<booth>.ts)은 view/group/registry.ts가 부스마다 만든다.
// 손님을 그리기 전에 단체 놀이 화면을 먼저 돌린다 (손님 몸을 그 프레임에 맡길 수 있게).
// sim은 읽기만 한다 (sim.state를 매 프레임 읽고, sim.bus 이벤트로 연출). 세계 크기는 map.ts WORLD를 따른다.

import { Container, Graphics, Rectangle, type Application, type FederatedPointerEvent, type FederatedWheelEvent } from 'pixi.js';
import type { BoothId, BuildingId, GroupBoothId } from '../data/defs.ts';
import { ART_SCALE, artMeta } from './art.ts';
import { BOOTH_IDS, BOOTHS, GROUP_BOOTHS } from '../data/defs.ts';
import { BOOTH_SPOTS, PLAZAS, WORLD, type Pt } from '../data/map.ts';
import type { SimApi } from '../sim/api.ts';
import type { ActiveRound, GroupState, MonsterId } from '../sim/types.ts';
import { BuildingsView } from './buildings.ts';
import type { VillageViewApi } from './contracts.ts';
import { buildDebugOverlay } from './debug.ts';
import { FxLayer } from './fx.ts';
import { GroundView } from './ground.ts';
import { clamp, follow, makeViewRect, type ViewRect } from './mapUtil.ts';
import { GROUP_MAP, type GroupMapRenderer } from './group/registry.ts';
import { MonstersView } from './monsterView.ts';

export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 1.6;
export const ZOOM_START = 0.8;
/** 좁은 화면(폰)은 지도 폭이 다 들어올 때까지 ZOOM_MIN보다 더 줄일 수 있다 (폭 6400을 390px 폰에 다 담는 약 0.06). 그래도 이 아래로는 안 간다. */
const ZOOM_FLOOR = 0.06;
/** 처음 화면: 열린 놀이부스(건물·자리·진행자·항아리)가 다 들어오게 맞춘다. 상자 둘레 여유 (화면 px)와 가장 작은 확대. */
const START_PAD = 10;
const START_ZOOM_MIN = 0.24;
/** UI가 알려 주기 전의 위(HUD)·아래(탭) 덮인 높이 (CSS px). */
const DEFAULT_INSET_TOP = 64;
const DEFAULT_INSET_BOTTOM = 76;
/** 누르기로 보는 움직임(화면 px)과 시간(ms). */
const TAP_SLOP = 8;
const TAP_MS = 350;
/** 세계 가장자리 밖으로 조금 더 보여 주는 여유 (세계 px). */
const EDGE_PAD = 60;
/** 끌 때 가장자리 밖으로 늘어나는 고무줄 (화면 px). */
const RUBBER = 140;
/** 관성 줄어드는 빠르기 (1/초). */
const FRICTION = 4.5;
/** 세계 밖 바탕색 (풀밭보다 조금 어둡게). */
const BACKDROP = 0x82a05a;
/** 단체 놀이 승자 코인 글자: 같은 줄로 치는 자리 y 폭과 바싹 붙었다고 치는 x 거리 (세계 px, groupFinished). */
const PAY_BAND = 90;
const PAY_NEAR = 230;

const NONE = 0;
const PENDING = 1;
const PAN = 2;
const PINCH = 3;

interface PointerPos {
  x: number;
  y: number;
}

export class VillageView implements VillageViewApi {
  readonly root = new Container();
  onTapMonster: (id: MonsterId) => void = () => {};
  onTapBooth: (booth: BoothId) => void = () => {};
  onTapBuilding: (id: BuildingId) => void = () => {};
  onTapEmpty: () => void = () => {};

  private readonly app: Application;
  private readonly sim: SimApi;
  private readonly backdrop = new Graphics();
  private readonly camera = new Container();
  private readonly floorLayer = new Container();
  private readonly shadowLayer = new Container();
  private readonly objectLayer = new Container();
  private readonly effectLayer = new Container();
  private readonly emoteLayer = new Container();
  private readonly skyLayer = new Container();
  private readonly debugLayer = new Container();
  private readonly ground: GroundView;
  private readonly buildings: BuildingsView;
  private readonly monsters: MonstersView;
  /** 단체 놀이 화면 (부스마다 하나, view/group/registry.ts). */
  private readonly groups: { readonly booth: GroupBoothId; readonly r: GroupMapRenderer }[];
  private readonly fx: FxLayer;
  private debugNode: Container | null = null;
  private readonly hitRect = new Rectangle(0, 0, 1, 1);

  // 카메라: (camX, camY) = 화면 가운데의 세계 좌표.
  private camX: number;
  private camY: number;
  private zoom = ZOOM_START;
  private sw = 1;
  private sh = 1;
  private velX = 0;
  private velY = 0;
  private focusing = false;
  private focusX = 0;
  private focusY = 0;
  private focusZoom = ZOOM_START;
  private followId: MonsterId | null = null;
  /** 화면 위·아래를 덮은 UI 높이 (CSS px): 카메라는 그 사이 띠의 가운데를 맞춘다. */
  private insetTop = DEFAULT_INSET_TOP;
  private insetBottom = DEFAULT_INSET_BOTTOM;
  private bx0 = 0;
  private bx1 = 0;
  private by0 = 0;
  private by1 = 0;
  private readonly view: ViewRect = makeViewRect();

  // 입력
  private inputOn = true;
  private readonly pointers = new Map<number, PointerPos>();
  private mode = NONE;
  private downX = 0;
  private downY = 0;
  private downT = 0;
  private lastX = 0;
  private lastY = 0;
  private lastMoveT = 0;
  private pinchD0 = 1;
  private pinchZ0 = 1;
  private pinchWX = 0;
  private pinchWY = 0;

  private time = 0;
  private readonly offs: (() => void)[] = [];
  private readonly tmp = { x: 0, y: 0 };
  /** 단체 놀이 승자 → 받은 코인 글자 단 0~2 (groupFinished). */
  private readonly payRows = new Map<MonsterId, number>();
  private readonly onKey: (e: KeyboardEvent) => void;
  private readonly onCancel: (e: PointerEvent) => void;
  private readonly onRestored: () => void;

  constructor(app: Application, sim: SimApi) {
    this.app = app;
    this.sim = sim;
    const start = PLAZAS[0]?.c ?? { x: WORLD.w / 2, y: WORLD.h / 2 };
    this.camX = start.x;
    this.camY = start.y;

    const renderer = app.renderer;
    this.ground = new GroundView(renderer);
    this.fx = new FxLayer(renderer);
    this.objectLayer.sortableChildren = true;
    for (const l of [this.floorLayer, this.shadowLayer, this.objectLayer, this.effectLayer, this.emoteLayer, this.skyLayer, this.debugLayer]) {
      l.eventMode = 'none';
      l.interactiveChildren = false;
    }
    this.effectLayer.addChild(this.emoteLayer, this.fx.node);
    this.camera.addChild(this.ground.node, this.floorLayer, this.shadowLayer, this.objectLayer, this.effectLayer, this.skyLayer, this.debugLayer);
    this.camera.eventMode = 'none';
    this.camera.interactiveChildren = false;
    this.root.addChild(this.backdrop, this.camera);
    this.root.label = 'VillageView';

    this.buildings = new BuildingsView(sim, { objects: this.objectLayer, floor: this.floorLayer }, this.fx, renderer);
    this.monsters = new MonstersView(sim, { objects: this.objectLayer, shadows: this.shadowLayer, effects: this.emoteLayer }, this.fx);
    const layers = { floor: this.floorLayer, shadows: this.shadowLayer, objects: this.objectLayer, effects: this.effectLayer, sky: this.skyLayer };
    this.groups = GROUP_BOOTHS.map((booth) => ({ booth, r: GROUP_MAP[booth]({ sim, booth, layers, fx: this.fx, buildings: this.buildings, monsters: this.monsters }) }));

    // 입력: 화면 전체를 받는 root 하나. 지도 안 물체는 직접 재서 고른다 (Pixi 히트 테스트를 물체마다 돌리지 않게).
    this.root.eventMode = 'static';
    this.root.interactiveChildren = false;
    this.root.hitArea = this.hitRect;
    this.root.on('pointerdown', this.onDown);
    this.root.on('globalpointermove', this.onMove);
    this.root.on('pointerup', this.onUp);
    this.root.on('pointerupoutside', this.onUp);
    this.root.on('wheel', this.onWheel);
    // Pixi는 브라우저 pointercancel을 넘겨주지 않는다: 직접 받아 손가락을 잊는다.
    this.onCancel = (e: PointerEvent) => this.dropPointer(e.pointerId);
    app.canvas.addEventListener('pointercancel', this.onCancel);
    this.onKey = (e: KeyboardEvent) => {
      if (e.key !== 'd' && e.key !== 'D') return;
      const t = e.target as HTMLElement | null;
      if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      this.setDebug(this.debugNode === null || !this.debugNode.visible);
    };
    window.addEventListener('keydown', this.onKey);
    // WebGL 문맥을 되찾으면(폰에서 앱을 오가면 흔하다) 코드로 구운 텍스처가 비어 있다: 바닥 타일·효과·구름을 다시 굽는다.
    // Pixi가 먼저 단 리스너(문맥 다시 잡기) 뒤에 불린다.
    this.onRestored = () => {
      this.ground.invalidate();
      this.fx.tex.reset();
      this.buildings.restoreTextures();
      for (const g of this.groups) g.r.restoreTextures?.();
    };
    app.canvas.addEventListener('webglcontextrestored', this.onRestored);

    // sim 이벤트 → 연출
    const bus = sim.bus;
    this.offs.push(
      bus.on('monsterSpawned', (e) => this.monsters.spawned(e.id)),
      bus.on('monsterLeft', (e) => this.monsters.left(e.id)),
      bus.on('monsterReact', (e) => this.monsters.react(e.id, e.reaction, false)),
      bus.on('monsterSpectate', (e) => this.monsters.react(e.id, e.reaction, true)),
      bus.on('monsterCheered', (e) => this.monsters.cheered(e.id, e.by)),
      // 단체 놀이 사건(경주 1등 바뀜 등)마다 참가자 응원 반응 (구경꾼처럼 작게).
      bus.on('groupEvent', (e) => {
        for (const c of e.cheers) this.monsters.react(c.id, c.reaction, true);
      }),
      bus.on('groupFinished', (e) => this.groupFinished(e.booth, e.group)),
      bus.on('roundFinished', (e) => this.roundFinished(e.booth, e.round, e.payout)),
      bus.on('potFestival', (e) => this.potFestival(e.booth, e.monster)),
      bus.on('coinsChanged', (e) => {
        if (e.at === null || e.delta === 0) return;
        this.fx.floatText(e.at.x, e.at.y - 70, e.delta > 0 ? `+${e.delta}` : `${e.delta}`, e.delta > 0 ? 'gain' : 'loss');
      }),
      bus.on('buildingUpgraded', () => this.buildings.refresh()),
      bus.on('boothUnlocked', () => this.buildings.refresh()),
      bus.on('districtOpened', () => this.buildings.refresh()),
      bus.on('staffChanged', () => this.buildings.refresh()),
    );

    // VillageView는 무대 맨 아래 (확대 화면·다른 층이 위에 온다).
    app.stage.addChildAt(this.root, 0);
    this.resize(app.screen.width, app.screen.height);
    this.frameOpenBooths();
    this.clampHard();
    this.applyCamera();
  }

  /** 처음 카메라: 열린 놀이부스가 HUD와 아래 탭 사이에 다 들어오게 (넓은 화면은 ZOOM_START까지만 가까이). */
  private frameOpenBooths(): void {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const add = (x: number, y: number): void => {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    };
    for (const b of BOOTH_IDS) {
      if (!this.sim.state.booths[b].unlocked) continue;
      const s = BOOTH_SPOTS[b];
      // 부스 그림 크기 (그림이 없으면 대략).
      const m = artMeta('map', BOOTHS[b].building);
      const hw = m !== undefined ? (m.trim.w * ART_SCALE.booth) / 2 : 210;
      const hh = m !== undefined ? m.trim.h * ART_SCALE.booth : 360;
      add(s.base.x - hw, s.base.y - hh);
      add(s.base.x + hw, s.base.y);
      for (const p of [...s.seats, ...s.hosts]) {
        add(p.x - 60, p.y - 120);
        add(p.x + 60, p.y + 30);
      }
      add(s.pot.x - 35, s.pot.y);
      add(s.pot.x + 35, s.pot.y);
    }
    if (!Number.isFinite(x0)) {
      const c = PLAZAS[0]?.c ?? { x: WORLD.w / 2, y: WORLD.h / 2 };
      add(c.x - 500, c.y - 400);
      add(c.x + 500, c.y + 400);
    }
    const bandH = Math.max(1, this.sh - this.insetTop - this.insetBottom);
    const z = Math.min((this.sw - START_PAD * 2) / (x1 - x0), (bandH - START_PAD * 2) / (y1 - y0));
    this.zoom = this.focusZoom = clamp(z, Math.max(this.minZoom(), START_ZOOM_MIN), ZOOM_START);
    this.camX = (x0 + x1) / 2;
    this.camY = (y0 + y1) / 2 + this.bandShift(this.zoom);
  }

  /** 보이는 띠(위·아래 UI 사이)의 가운데에 세계 점이 오게 하는 카메라 y 보정 (세계 px). */
  private bandShift(z: number): number {
    return (this.insetBottom - this.insetTop) / (2 * z);
  }

  // ── VillageViewApi ──

  update(dt: number): void {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;
    const scr = this.app.screen;
    if (scr.width !== this.sw || scr.height !== this.sh) this.resize(scr.width, scr.height);
    this.updateCamera(dt);
    const dpr = this.app.renderer.resolution;
    this.ground.update(this.view, this.zoom * dpr);
    this.buildings.update(dt, this.view);
    // 단체 놀이 화면 먼저 (그 프레임의 손님 몸을 맡긴다), 그다음 손님.
    for (const g of this.groups) g.r.update(dt, this.view);
    this.monsters.update(dt, this.time, this.view, this.zoom);
    this.fx.update(dt, this.zoom);
  }

  resize(w: number, h: number): void {
    this.sw = Math.max(1, w);
    this.sh = Math.max(1, h);
    this.hitRect.width = this.sw;
    this.hitRect.height = this.sh;
    this.backdrop.clear().rect(0, 0, this.sw, this.sh).fill(BACKDROP);
    this.zoom = clamp(this.zoom, this.minZoom(), ZOOM_MAX);
    this.applyCamera();
  }

  focusOn(pt: Pt, zoom?: number): void {
    this.followId = null;
    this.focusing = true;
    this.focusX = pt.x;
    this.focusY = pt.y;
    this.focusZoom = clamp(zoom ?? this.zoom, this.minZoom(), ZOOM_MAX);
    this.velX = this.velY = 0;
  }

  follow(id: MonsterId | null): void {
    this.followId = id;
    this.focusing = false;
    if (id !== null) {
      this.velX = this.velY = 0;
      // 아주 멀리서 따라가면 손님이 안 보이니 조금 다가간다.
      this.focusZoom = Math.max(this.zoom, 0.7);
    }
  }

  debugVisible(): boolean {
    return this.debugNode !== null && this.debugNode.visible;
  }

  setViewInset(top: number, bottom: number): void {
    this.insetTop = Math.max(0, top);
    this.insetBottom = Math.max(0, bottom);
  }

  setDebug(on: boolean): void {
    if (on && this.debugNode === null) {
      this.debugNode = buildDebugOverlay();
      this.debugLayer.addChild(this.debugNode);
    }
    if (this.debugNode !== null) this.debugNode.visible = on;
  }

  setInputEnabled(on: boolean): void {
    this.inputOn = on;
    if (!on) {
      this.pointers.clear();
      this.mode = NONE;
      this.velX = this.velY = 0;
    }
  }

  // ── 덤 (계약 밖, 있으면 편한 것) ──

  /** 세계 좌표 → 화면(CSS px). out을 주면 거기에 쓴다. */
  worldToScreen(pt: Pt, out: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
    out.x = (pt.x - this.camX) * this.zoom + this.sw / 2;
    out.y = (pt.y - this.camY) * this.zoom + this.sh / 2;
    return out;
  }

  /** 화면(CSS px) → 세계 좌표. */
  screenToWorld(x: number, y: number, out: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
    out.x = this.camX + (x - this.sw / 2) / this.zoom;
    out.y = this.camY + (y - this.sh / 2) / this.zoom;
    return out;
  }

  get currentZoom(): number {
    return this.zoom;
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    window.removeEventListener('keydown', this.onKey);
    this.app.canvas.removeEventListener('pointercancel', this.onCancel);
    this.app.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.root.removeAllListeners();
    for (const g of this.groups) g.r.destroy();
    this.monsters.destroy();
    this.buildings.destroy();
    this.ground.destroy();
    this.fx.destroy();
    this.root.destroy({ children: true });
  }

  // ── sim 이벤트 연출 ──

  /**
   * 단체 놀이 판이 끝났다 (곧 승자마다 roundFinished가 잇달아 온다): 받은 코인 글자를 띄울 단(0~2)을 정한다.
   * 왼쪽 승자부터, 바싹 붙어 선 승자(자리가 x PAY_NEAR·y PAY_BAND 안)가 쓰지 않은 가장 낮은 단에 (셋 다 쓰면 가장 먼 승자의 단):
   * 줄다리기 한 편처럼 나란히 선 승자들의 글자가 한 줄로 붙어 읽히지 않게. 떨어져 선 승자(보물찾기 판 자리)는 그대로 0단.
   */
  private groupFinished(booth: GroupBoothId, g: GroupState): void {
    this.payRows.clear();
    const outs = g.play?.outcomes ?? [];
    const seats = BOOTH_SPOTS[booth].seats;
    const at = (seat: number): Pt => seats[seat] ?? { x: 0, y: 0 };
    const won = g.participants.filter((_, i) => (outs[i]?.multiplier ?? 0) > 0).map((e) => ({ id: e.monster, p: at(e.seat), row: 0 }));
    won.sort((a, b) => a.p.x - b.p.x);
    won.forEach((w, i) => {
      const near = won.slice(0, i).filter((o) => Math.abs(o.p.x - w.p.x) < PAY_NEAR && Math.abs(o.p.y - w.p.y) < PAY_BAND);
      const free = [0, 1, 2].find((r) => !near.some((o) => o.row === r));
      w.row = free ?? near[0]?.row ?? 0;
      this.payRows.set(w.id, w.row);
    });
  }

  private roundFinished(booth: BoothId, round: ActiveRound, payout: number): void {
    const tier = round.outcome.tier;
    this.buildings.hostReact(booth, tier);
    const v = this.monsters.get(round.monster);
    if (v === undefined) return;
    if (payout > 0) {
      this.buildings.potTop(booth, this.tmp);
      const n = clamp(Math.round(payout / 4), 3, tier === 'jackpot' ? 26 : 12);
      this.fx.coinArc(this.tmp.x, this.tmp.y, v.x, v.y - v.headH * 0.45, n);
      // 단체 놀이 승자: 단마다 글자 한 줄 높이씩 올리고 조금씩 늦게 (groupFinished).
      const row = this.payRows.get(round.monster) ?? 0;
      this.payRows.delete(round.monster);
      const big = tier === 'jackpot';
      this.fx.floatText(v.x, v.y - v.headH - 78, `+${payout}`, 'win', big, row * 0.12, row * (big ? 58 : 40));
    }
    if (tier === 'jackpot') {
      this.fx.confetti(v.x, v.y - 30, 40);
      this.fx.sparkles(v.x, v.y - v.headH * 0.6, 10, v.halfW + 50);
    }
  }

  private potFestival(booth: BoothId, monster: MonsterId): void {
    this.buildings.potTop(booth, this.tmp);
    this.fx.coinSpray(this.tmp.x, this.tmp.y, 30);
    this.fx.confetti(this.tmp.x, this.tmp.y, 70);
    this.fx.sparkles(this.tmp.x, this.tmp.y - 40, 14, 140);
    this.fx.floatText(this.tmp.x, this.tmp.y - 50, '항아리 축제!', 'win', true);
    this.buildings.hostReact(booth, 'jackpot');
    const v = this.monsters.get(monster);
    if (v !== undefined) this.fx.coinArc(this.tmp.x, this.tmp.y, v.x, v.y - v.headH * 0.45, 20);
  }

  // ── 카메라 ──

  /** 가장 작은 확대: 지도 폭이 화면에 다 들어오는 만큼 (ZOOM_FLOOR~ZOOM_MIN). */
  private minZoom(): number {
    return clamp(this.sw / WORLD.w, ZOOM_FLOOR, ZOOM_MIN);
  }

  /** 확대 z에서 카메라 가운데가 갈 수 있는 범위 (세계가 화면보다 작으면 가운데에 고정). */
  private computeBounds(z: number): void {
    const hw = this.sw / (2 * z);
    const hh = this.sh / (2 * z);
    this.bx0 = hw - EDGE_PAD;
    this.bx1 = WORLD.w - hw + EDGE_PAD;
    if (this.bx0 > this.bx1) this.bx0 = this.bx1 = WORLD.w / 2;
    this.by0 = hh - EDGE_PAD;
    this.by1 = WORLD.h - hh + EDGE_PAD;
    if (this.by0 > this.by1) this.by0 = this.by1 = WORLD.h / 2;
  }

  private clampHard(): void {
    this.computeBounds(this.zoom);
    this.camX = clamp(this.camX, this.bx0, this.bx1);
    this.camY = clamp(this.camY, this.by0, this.by1);
  }

  private updateCamera(dt: number): void {
    const dragging = this.mode === PAN || this.mode === PINCH;
    if (!dragging) {
      if (this.followId !== null) {
        const v = this.monsters.get(this.followId);
        if (v === undefined || v.leaving) {
          this.followId = null;
        } else {
          const f = follow(5, dt);
          this.zoom += (this.focusZoom - this.zoom) * f;
          this.computeBounds(this.zoom);
          this.camX += (clamp(v.x, this.bx0, this.bx1) - this.camX) * f;
          // 손님(몸 가운데)이 보이는 띠의 가운데에 (카드가 열리면 카드 위).
          this.camY += (clamp(v.y - v.headH * 0.5 + this.bandShift(this.zoom), this.by0, this.by1) - this.camY) * f;
        }
      } else if (this.focusing) {
        const f = follow(6, dt);
        this.zoom += (this.focusZoom - this.zoom) * f;
        this.computeBounds(this.zoom);
        const tx = clamp(this.focusX, this.bx0, this.bx1);
        const ty = clamp(this.focusY + this.bandShift(this.zoom), this.by0, this.by1);
        this.camX += (tx - this.camX) * f;
        this.camY += (ty - this.camY) * f;
        if (Math.abs(tx - this.camX) < 0.5 && Math.abs(ty - this.camY) < 0.5 && Math.abs(this.focusZoom - this.zoom) < 0.002) this.focusing = false;
      }
      // 관성
      if (this.velX !== 0 || this.velY !== 0) {
        this.camX += this.velX * dt;
        this.camY += this.velY * dt;
        const k = Math.exp(-FRICTION * dt);
        this.velX *= k;
        this.velY *= k;
        if (this.velX * this.velX + this.velY * this.velY < 64) this.velX = this.velY = 0;
      }
      // 고무줄: 가장자리 밖이면 부드럽게 돌아온다 (밖으로 가던 관성은 빨리 죽인다).
      this.computeBounds(this.zoom);
      const f = follow(12, dt);
      if (this.camX < this.bx0) {
        this.camX += (this.bx0 - this.camX) * f;
        if (this.velX < 0) this.velX *= Math.exp(-25 * dt);
      } else if (this.camX > this.bx1) {
        this.camX += (this.bx1 - this.camX) * f;
        if (this.velX > 0) this.velX *= Math.exp(-25 * dt);
      }
      if (this.camY < this.by0) {
        this.camY += (this.by0 - this.camY) * f;
        if (this.velY < 0) this.velY *= Math.exp(-25 * dt);
      } else if (this.camY > this.by1) {
        this.camY += (this.by1 - this.camY) * f;
        if (this.velY > 0) this.velY *= Math.exp(-25 * dt);
      }
    }
    this.applyCamera();
  }

  private applyCamera(): void {
    const z = this.zoom;
    const dpr = this.app.renderer.resolution;
    // 기기 화소에 맞춰 반올림 (천천히 움직일 때 바닥 타일이 반짝이지 않게).
    const px = Math.round((this.sw / 2 - this.camX * z) * dpr) / dpr;
    const py = Math.round((this.sh / 2 - this.camY * z) * dpr) / dpr;
    this.camera.scale.set(z);
    this.camera.position.set(px, py);
    const hw = this.sw / (2 * z);
    const hh = this.sh / (2 * z);
    const v = this.view;
    v.x0 = this.camX - hw;
    v.x1 = this.camX + hw;
    v.y0 = this.camY - hh;
    v.y1 = this.camY + hh;
  }

  /** 화면 px만큼 끌기 (가장자리 밖에서는 고무줄처럼 버틴다). */
  private panBy(dxs: number, dys: number): void {
    const z = this.zoom;
    this.computeBounds(z);
    this.camX = this.rubberMove(this.camX, -dxs / z, this.bx0, this.bx1, z);
    this.camY = this.rubberMove(this.camY, -dys / z, this.by0, this.by1, z);
  }

  private rubberMove(c: number, d: number, lo: number, hi: number, z: number): number {
    let over = 0;
    if (d < 0 && c < lo) over = lo - c;
    else if (d > 0 && c > hi) over = c - hi;
    const k = over > 0 ? 1 / (1 + ((over * z) / RUBBER) * 2) : 1;
    const max = RUBBER / z;
    return clamp(c + d * k, lo - max, hi + max);
  }

  /** 화면 점 (sx, sy) 아래의 세계 점이 그대로 있게 확대를 바꾼다. */
  private zoomAt(sx: number, sy: number, z: number): void {
    const wx = this.camX + (sx - this.sw / 2) / this.zoom;
    const wy = this.camY + (sy - this.sh / 2) / this.zoom;
    this.zoom = clamp(z, this.minZoom(), ZOOM_MAX);
    this.camX = wx - (sx - this.sw / 2) / this.zoom;
    this.camY = wy - (sy - this.sh / 2) / this.zoom;
  }

  // ── 입력 ──

  private readonly onDown = (e: FederatedPointerEvent): void => {
    if (!this.inputOn) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const x = e.global.x;
    const y = e.global.y;
    this.pointers.set(e.pointerId, { x, y });
    if (this.pointers.size === 1) {
      this.mode = PENDING;
      this.downX = this.lastX = x;
      this.downY = this.lastY = y;
      this.downT = this.lastMoveT = performance.now();
      this.velX = this.velY = 0;
    } else if (this.pointers.size === 2) {
      this.startPinch();
    }
  };

  private startPinch(): void {
    const [a, b] = this.firstTwo();
    if (a === undefined || b === undefined) return;
    this.mode = PINCH;
    this.followId = null;
    this.focusing = false;
    this.velX = this.velY = 0;
    this.pinchD0 = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
    this.pinchZ0 = this.zoom;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    this.pinchWX = this.camX + (mx - this.sw / 2) / this.zoom;
    this.pinchWY = this.camY + (my - this.sh / 2) / this.zoom;
  }

  private firstTwo(): [PointerPos | undefined, PointerPos | undefined] {
    const it = this.pointers.values();
    return [it.next().value, it.next().value];
  }

  private readonly onMove = (e: FederatedPointerEvent): void => {
    if (!this.inputOn) return;
    const p = this.pointers.get(e.pointerId);
    if (p === undefined) return;
    p.x = e.global.x;
    p.y = e.global.y;
    if (this.mode === PINCH) {
      const [a, b] = this.firstTwo();
      if (a === undefined || b === undefined) return;
      const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.zoom = clamp((this.pinchZ0 * d) / this.pinchD0, this.minZoom(), ZOOM_MAX);
      // 잡은 세계 점이 두 손가락 가운데에 붙어 있게 (두 손가락으로 옮기기도 된다).
      this.camX = this.pinchWX - (mx - this.sw / 2) / this.zoom;
      this.camY = this.pinchWY - (my - this.sh / 2) / this.zoom;
      return;
    }
    if (this.mode === PENDING) {
      if (Math.hypot(p.x - this.downX, p.y - this.downY) <= TAP_SLOP) return;
      // 끌기 시작: 따라가기·맞추기를 멈추고 손가락을 따른다.
      this.mode = PAN;
      this.followId = null;
      this.focusing = false;
    }
    if (this.mode === PAN) {
      const now = performance.now();
      const dx = p.x - this.lastX;
      const dy = p.y - this.lastY;
      this.panBy(dx, dy);
      const dts = (now - this.lastMoveT) / 1000;
      if (dts > 0.001) {
        const k = Math.min(1, dts / 0.05);
        this.velX += (-dx / this.zoom / dts - this.velX) * k;
        this.velY += (-dy / this.zoom / dts - this.velY) * k;
      }
      this.lastX = p.x;
      this.lastY = p.y;
      this.lastMoveT = now;
    }
  };

  private readonly onUp = (e: FederatedPointerEvent): void => {
    if (!this.inputOn) return;
    const p = this.pointers.get(e.pointerId);
    if (p === undefined) return;
    const x = e.global.x;
    const y = e.global.y;
    this.pointers.delete(e.pointerId);
    const now = performance.now();
    if (this.mode === PENDING && this.pointers.size === 0) {
      this.mode = NONE;
      if (now - this.downT <= TAP_MS && Math.hypot(x - this.downX, y - this.downY) <= TAP_SLOP) this.tap(x, y);
      return;
    }
    if (this.mode === PINCH) {
      if (this.pointers.size === 1) {
        // 한 손가락이 남으면 그 손가락으로 계속 끈다 (누르기는 아니다).
        const [a] = this.firstTwo();
        if (a !== undefined) {
          this.mode = PAN;
          this.lastX = a.x;
          this.lastY = a.y;
          this.lastMoveT = now;
          this.velX = this.velY = 0;
        }
      } else if (this.pointers.size === 0) {
        this.mode = NONE;
      } else {
        this.startPinch();
      }
      return;
    }
    if (this.pointers.size === 0) {
      this.mode = NONE;
      // 손을 뗄 때 막 움직이고 있었으면 관성.
      if (now - this.lastMoveT > 90) this.velX = this.velY = 0;
      const max = 3200 / this.zoom;
      const sp = Math.hypot(this.velX, this.velY);
      if (sp > max) {
        this.velX *= max / sp;
        this.velY *= max / sp;
      }
    }
  };

  private readonly onWheel = (e: FederatedWheelEvent): void => {
    if (!this.inputOn) return;
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    const dy = clamp(e.deltaY * unit, -400, 400);
    this.focusing = false;
    this.zoomAt(e.global.x, e.global.y, this.zoom * Math.exp(-dy * 0.0015));
  };

  private dropPointer(id: number): void {
    if (!this.pointers.delete(id)) return;
    if (this.pointers.size === 0) this.mode = NONE;
    else if (this.pointers.size === 1 && this.mode === PINCH) {
      const [a] = this.firstTwo();
      if (a !== undefined) {
        this.mode = PAN;
        this.lastX = a.x;
        this.lastY = a.y;
        this.lastMoveT = performance.now();
      }
    }
  }

  /** 누르기: 손님(앞쪽) → 부스 → 건물 → 단체 놀이 마당 → 빈 땅. 구름 덮인 곳은 빈 땅. */
  private tap(sx: number, sy: number): void {
    const w = this.screenToWorld(sx, sy, this.tmp);
    const wx = w.x;
    const wy = w.y;
    const m = this.monsters.hitTest(wx, wy);
    if (m !== null) {
      this.onTapMonster(m);
      return;
    }
    if (!this.buildings.covered(wx, wy)) {
      const hit = this.buildings.hitTest(wx, wy);
      if (hit !== null) {
        this.buildings.poke(hit);
        if (hit.kind === 'booth') this.onTapBooth(hit.id);
        else this.onTapBuilding(hit.id);
        return;
      }
      // 단체 놀이 마당(경주로·모래판·밧줄·연·물길…)을 누르면 그 부스.
      for (const g of this.groups) {
        if (g.r.hitTest(wx, wy)) {
          this.onTapBooth(g.booth);
          return;
        }
      }
    }
    this.onTapEmpty();
  }
}
