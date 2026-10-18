// 화면 모듈끼리의 약속 (main.ts가 이어 붙인다). 구현: view/world.ts(VillageView), view/closeup/(CloseupView), ui/(Ui).
// 좌표: Pixi Application은 autoDensity라 무대 좌표 = CSS px. 확대 화면의 rect도 CSS px.

import type { Container } from 'pixi.js';
import type { BoothId, BuildingId } from '../data/defs.ts';
import type { Pt } from '../data/map.ts';
import type { Result } from '../sim/api.ts';
import type { MonsterId } from '../sim/types.ts';
import type { BuildMode, BuildState } from './buildMode.ts';

export type { BuildMode, BuildState } from './buildMode.ts';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 확대 화면 패널의 둥근 모서리 반지름 (CSS px). 패널(CloseupView)과 둘레 그늘(UI)이 같이 쓴다. */
export function closeupRadius(w: number, h: number): number {
  return Math.min(22, Math.min(w, h) * 0.06);
}

/** 지도 화면 (view/world.ts). */
export interface VillageViewApi {
  readonly root: Container;
  update(dt: number): void;
  resize(w: number, h: number): void;
  /** 카메라를 세계 좌표 pt로 (부드럽게). zoom을 주면 그 확대로. */
  focusOn(pt: Pt, zoom?: number): void;
  /** 마을 가운데(분수)로 카메라를 돌린다 (이미 보고 있는 마을 탭을 또 눌렀을 때). */
  focusVillage(): void;
  /** 손님을 따라가는 카메라 (null이면 그만). */
  follow(id: MonsterId | null): void;
  setDebug(on: boolean): void;
  /** 디버그 층이 켜져 있나 (D 키로도 바뀐다). */
  debugVisible(): boolean;
  /**
   * 화면 위·아래를 덮은 UI 높이 (CSS px). 카메라는 그 사이 보이는 띠의 가운데를 맞춘다
   * (손님 카드가 열리면 UI가 카드 높이만큼 늘려, 따라가는 손님이 카드 위에 보이게).
   */
  setViewInset(top: number, bottom: number): void;
  /** 누르기 콜백 (main.ts가 UI로 잇는다). */
  onTapMonster: (id: MonsterId) => void;
  onTapBooth: (booth: BoothId) => void;
  onTapBuilding: (id: BuildingId) => void;
  /** 빈 땅을 눌렀을 때 (열린 카드·패널 닫기). */
  onTapEmpty: () => void;
  /** 구름 덮인 땅(사지 않은 조각, map.ts chunkIndex)을 눌렀을 때. */
  onTapLand: (chunk: number) => void;
  /** 장식을 눌렀을 때 (Placed.id). */
  onTapPlaced: (id: number) => void;
  /** 확대 화면이 열려 있으면 지도 입력을 막는다. */
  setInputEnabled(on: boolean): void;

  // ── 짓기 모드 (DESIGN 6.1, view/buildMode.ts) ──
  /**
   * 모드: none / place (key를 놓기: 보관함에서, 없으면 ✓ 때 산다) / move (Placed.id 옮기기) / road (길 깔기) / erase (길 지우기) / land (땅 사기).
   * place·move = 유령을 잡고 끌기 (밖을 누르면 유령이 그리로), road·erase = 한 손가락으로 칠하기, 두 손가락 = 지도 이동·확대. land에서는 누르기 = 조각 고르기.
   */
  setBuildMode(mode: BuildMode): void;
  /** 지금 모드·유령 칸과 검사(PlaceCheck)·고른 땅. */
  buildState(): BuildState;
  /** ✓: 놓기·옮기기·땅 사기 (길은 손을 뗄 때 바뀐다). 된 뒤에는 모드가 끝난다 (장식은 이어서). */
  confirmBuild(): Result;
  /** ✕: 그만. */
  cancelBuild(): void;
  /** 길 깔기·지우기의 마지막 붓질을 되돌린다. */
  undoBuild(): Result;
  /** 유령이 차지한 칸 (땅 사기는 고른 조각)의 화면 사각형 (CSS px, UI가 그 옆에 ✓/✕를 띄운다). 없으면 null. */
  buildAnchor(): Rect | null;
  /** 모드·유령이 바뀔 때 (UI 띠를 고친다). 하나만 단다 (main.ts → ui). */
  onBuildChange: (s: BuildState) => void;
  /** 짓기 행동이 안 됐을 때 이유 (UI 토스트). */
  onBuildFail: (reason: string) => void;
}

/** 부스 확대 화면 (view/closeup/). */
export interface CloseupViewApi {
  readonly root: Container;
  readonly booth: BoothId | null;
  /** rect(CSS px) 안에 부스 확대 화면을 연다. */
  open(booth: BoothId, rect: Rect): void;
  close(): void;
  update(dt: number): void;
  /** 화면 크기가 바뀌어 rect가 달라졌을 때. */
  layout(rect: Rect): void;
  /** 확대 화면 속 손님을 눌렀을 때. */
  onTapMonster: (id: MonsterId) => void;
}

/** HTML 오버레이 (ui/). */
export interface UiApi {
  update(dt: number): void;
  showMonster(id: MonsterId): void;
  showBooth(booth: BoothId): void;
  showBuilding(id: BuildingId): void;
  /** 놓인 것 하나 (장식: Placed.id)의 옮기기·보관하기. */
  showPlaced(id: number): void;
  /** 구름 덮인 땅을 눌렀다: 땅 사기 모드로 그 조각을 골라 연다. */
  showLand(chunk: number): void;
  /** 지도 짓기 모드가 바뀌었다 (✓/✕ 띠). */
  onBuildChange(s: BuildState): void;
  /** 알림 한 줄 (짓기 모드 행동이 안 됐을 때 등). */
  toast(text: string, kind?: 'info' | 'good' | 'warn'): void;
  /** 열린 카드·시트를 닫는다. */
  closeAll(): void;
  /** 짓기 탭을 연다 (category = 놀이부스·큰 시설·가게·장식·길·땅 고르기, ui/panels/build.ts BuildCat). */
  openBuild(category?: string): void;
}

/** Ui가 화면 쪽에 바라는 것. */
export interface UiHooks {
  readonly world: Pick<VillageViewApi, 'focusOn' | 'focusVillage' | 'follow' | 'setInputEnabled' | 'setDebug' | 'debugVisible' | 'setViewInset' | 'setBuildMode' | 'buildState' | 'confirmBuild' | 'cancelBuild' | 'undoBuild' | 'buildAnchor'>;
  readonly closeup: Pick<CloseupViewApi, 'open' | 'close' | 'layout' | 'booth'>;
}
