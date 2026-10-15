// 화면 모듈끼리의 약속 (main.ts가 이어 붙인다). 구현: view/world.ts(VillageView), view/closeup/(CloseupView), ui/(Ui).
// 좌표: Pixi Application은 autoDensity라 무대 좌표 = CSS px. 확대 화면의 rect도 CSS px.

import type { Container } from 'pixi.js';
import type { BoothId, BuildingId } from '../data/defs.ts';
import type { Pt } from '../data/map.ts';
import type { MonsterId } from '../sim/types.ts';

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
  /** 확대 화면이 열려 있으면 지도 입력을 막는다. */
  setInputEnabled(on: boolean): void;
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
  /** 열린 카드·시트를 닫는다. */
  closeAll(): void;
}

/** Ui가 화면 쪽에 바라는 것. */
export interface UiHooks {
  readonly world: Pick<VillageViewApi, 'focusOn' | 'follow' | 'setInputEnabled' | 'setDebug' | 'debugVisible' | 'setViewInset'>;
  readonly closeup: Pick<CloseupViewApi, 'open' | 'close' | 'layout' | 'booth'>;
}
