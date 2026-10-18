// 시트 안 내용의 바탕과 UI 조각끼리의 약속.
// 구조가 바뀌면(sig) 다시 그리고, 아니면 숫자만 고친다(live) — 4Hz 갱신에서 DOM을 새로 만들지 않게.

import type { CatalogKey } from '../data/catalog.ts';
import type { BoothId, BuildingId, ShopId } from '../data/defs.ts';
import type { Result, SimApi } from '../sim/api.ts';
import type { GameState, MonsterId } from '../sim/types.ts';
import type { BuildMode, UiHooks } from '../view/contracts.ts';
import { h } from './dom.ts';
import type { Menu } from './menu.ts';
import type { ShopLog } from './shopLog.ts';
import { Live } from './widgets.ts';

export type TabId = 'village' | 'build' | 'staff' | 'workshop' | 'dex';
export type ToastKind = 'info' | 'good' | 'warn';
/** 도감 안의 보기: 손님 종 / 인형 뽑기로 모은 인형 / 사진관 사진첩 (다섯째 묶음). */
export type DexView = 'species' | 'plush' | 'photo';

/** 조각들이 UI 본체에 바라는 것. */
export interface UiCtx {
  readonly sim: SimApi;
  readonly hooks: UiHooks;
  readonly menu: Menu;
  /** 다섯째 묶음 가게 기록 (이번 매상, 손님마다 산 것·팁·점괘, 최근 선물: 메모리만). */
  readonly shopLog: ShopLog;
  /** 행동 결과: 실패면 이유를 토스트로. 성공이면 true. */
  act(r: Result): boolean;
  toast(text: string, kind?: ToastKind): void;
  openTab(tab: TabId): void;
  openBag(): void;
  /** 도감 탭을 그 보기로 연다. */
  openDex(view: DexView): void;
  /** 부스 패널 (잠겼으면 열기 시트). role을 주면 그 진행자 자리를 보여 주고 세울 사람 고르기를 연다. */
  showBooth(b: BoothId, role?: number): void;
  /** 주민 탭을 고용 후보 칸으로 굴려 연다. */
  openHire(): void;
  showBuilding(id: BuildingId): void;
  showMonster(id: MonsterId): void;
  /** 놓인 것 하나 (장식 등: Placed.id)의 옮기기·보관하기 시트. 가게면 가게 시트. */
  showPlaced(id: number): void;
  /** 가게 시트 (다섯째 묶음: 주인·메뉴·이번 매상·지금 손님·자리·업그레이드). 아직 없으면 짓기 설명. */
  showShop(s: ShopId): void;
  /** 시트를 닫고 지도 짓기 모드로 (놓기·옮기기·길·땅, DESIGN 6.1). */
  startBuild(mode: BuildMode): void;
  /** 짓기 탭을 그 묶음으로 연다 (ui/panels/build.ts BuildCat: booth·big·store·ride·shop·decor·road·land). key = 그 카드로 굴려 반짝. */
  openBuild(category?: string, key?: CatalogKey): void;
  closeAll(): void;
  /** 다음 update에서 곧바로 다시 그린다. */
  markDirty(): void;
  /** 안전 영역 (px). */
  insets(): { top: number; bottom: number };
}

export abstract class BasePanel {
  readonly el: HTMLDivElement;
  protected readonly ctx: UiCtx;
  protected readonly live = new Live();
  private lastSig: string | null = null;

  constructor(ctx: UiCtx, cls = '') {
    this.ctx = ctx;
    this.el = h('div', `mpv-panel ${cls}`.trim());
  }

  protected get sim(): SimApi {
    return this.ctx.sim;
  }

  protected get st(): GameState {
    return this.ctx.sim.state;
  }

  /** 시트 머리 [제목, 레벨 배지] (null이면 시트가 정한 대로). */
  head(): readonly [string, string] | null {
    return null;
  }

  /** 구조 서명: 바뀌면 다시 그린다 (자주 바뀌는 숫자는 넣지 않는다). */
  abstract sig(): string;
  protected abstract build(): void;

  refresh(force = false): void {
    const s = this.sig();
    if (force || s !== this.lastSig) {
      this.lastSig = s;
      this.live.reset();
      this.el.replaceChildren();
      this.build();
    } else {
      this.live.run();
    }
  }
}
