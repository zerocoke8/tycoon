// HTML 오버레이 본체: HUD, 아래 탭, 시트(짓기·주민·공방·도감·가방·설정·건물·가게), 손님 카드, 부스 패널, 토스트.
// 가게 시트(다섯째 묶음)가 열리면 지도 카메라는 시트 위 띠에 그 가게를 맞춘다 (손님 카드처럼).
// sim은 SimApi로만 쓰고, 화면 쪽은 UiHooks로만 부른다. main.ts가 매 프레임 update(dt)를 부른다.

import './ui.css';
import { catalogKind, footprint, type CatalogKey } from '../data/catalog.ts';
import { isGroupBooth, type BoothId, type BuildingId, type ShopId } from '../data/defs.ts';
import { CELL } from '../data/map.ts';
import { truckPos } from '../sim/shops.ts';
import type { Result, SimApi } from '../sim/api.ts';
import type { MonsterId } from '../sim/types.ts';
import type { BuildMode, BuildState, UiApi, UiHooks } from '../view/contracts.ts';
import { BoothPanel } from './boothPanel.ts';
import { BuildBar } from './buildBar.ts';
import { h, injectHead, makeInsetProbe } from './dom.ts';
import { Hud, Nav, Toasts } from './hud.ts';
import { Menu } from './menu.ts';
import { MonsterCard } from './monsterCard.ts';
import type { BasePanel, DexView, TabId, ToastKind, UiCtx } from './panel.ts';
import { BuildingPanel, BuildPanel, isBuildCat, LockedBoothPanel, PlacedPanel } from './panels/build.ts';
import { BankPanel, DebtLog, PawnshopPanel, WorkyardPanel, type DebtBuildingId } from './panels/debt.ts';
import { GoalChip } from './goal.ts';
import { DexPanel } from './panels/dex.ts';
import { ShopPanel } from './panels/shop.ts';
import { BagPanel, SettingsPanel } from './panels/misc.ts';
import { StaffPanel } from './panels/staff.ts';
import { WorkshopPanel } from './panels/workshop.ts';
import { loadPicIndex } from './pics.ts';
import { Sheet } from './sheet.ts';
import { ShopLog } from './shopLog.ts';

/** 숫자 갱신 간격 (초): 4Hz. */
const REFRESH_SEC = 0.25;
/** 파산·다 갚음 알림(topic 'debt') 사이의 가장 짧은 간격 (초). */
const DEBT_TOAST_GAP = 20;

const TAB_TITLE: Record<Exclude<TabId, 'village'>, string> = {
  build: '짓기',
  staff: '주민',
  workshop: '공방',
  dex: '도감',
};

export function createUi(root: HTMLElement, sim: SimApi, hooks: UiHooks): UiApi {
  return new Ui(root, sim, hooks);
}

export class Ui implements UiApi, UiCtx {
  readonly sim: SimApi;
  readonly hooks: UiHooks;
  readonly menu: Menu;
  readonly shopLog: ShopLog;
  private readonly root: HTMLElement;
  private readonly readInsets: () => { top: number; bottom: number };
  private readonly hud: Hud;
  private readonly nav: Nav;
  private readonly toasts: Toasts;
  private readonly goal: GoalChip;
  private readonly backdrop: HTMLDivElement;
  private readonly sheet: Sheet;
  private readonly card: MonsterCard;
  private readonly booth: BoothPanel;
  private readonly tabs: Record<Exclude<TabId, 'village'>, BasePanel>;
  /** 짓기 탭 (묶음 고르기). */
  private readonly buildPanel: BuildPanel;
  private readonly staffPanel: StaffPanel;
  private readonly dex: DexPanel;
  private readonly bag: BagPanel;
  private readonly settings: SettingsPanel;
  private readonly building: BuildingPanel;
  private readonly lockedBooth: LockedBoothPanel;
  private readonly placedPanel: PlacedPanel;
  /** 가게 시트 (다섯째 묶음). */
  private readonly shopPanel: ShopPanel;
  /** 짓기 모드 ✓/✕ 띠. */
  private readonly buildBar: BuildBar;
  /** 넷째 묶음 건물 시트 (전당포 진열장·은행 대출·일터 일꾼). */
  private readonly debtSheets: Record<DebtBuildingId, BasePanel>;
  /** 지금 시트에 든 내용과 그 이름 ('tab:build', 'bag', 'building:hall' …). */
  private sheetPanel: BasePanel | null = null;
  private sheetKey = '';
  private acc = 0;
  private dirty = false;
  /** 마지막 파산·다 갚음 알림을 띄운 때 (performance.now, ms). */
  private debtToastAt = -Infinity;

  constructor(root: HTMLElement, sim: SimApi, hooks: UiHooks) {
    this.root = root;
    this.sim = sim;
    this.hooks = hooks;
    this.shopLog = new ShopLog(sim);
    injectHead();
    root.classList.add('mpv-ui');
    root.replaceChildren();
    // UI 위의 누르기·휠은 창(window)에 붙은 지도 조작으로 새지 않게 (UI가 없는 곳은 root가 pointer-events: none이라 캔버스로 간다).
    for (const type of ['pointerdown', 'wheel', 'touchstart'] as const) root.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
    this.readInsets = makeInsetProbe(root);

    // 아래에서 위 순서 (z-index는 ui.css)
    this.backdrop = h('div', 'mpv-backdrop');
    this.backdrop.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeAll();
    });
    root.append(this.backdrop);
    this.sheet = new Sheet(root);
    this.sheet.onClose = () => this.closeSheet();
    this.nav = new Nav(root, (t) => this.openTab(t));
    this.menu = new Menu(root);
    this.booth = new BoothPanel(this, root);
    this.card = new MonsterCard(this, root);
    this.hud = new Hud(
      this,
      root,
      () => this.openBag(),
      () => this.openSettings(),
    );
    this.goal = new GoalChip(this, root);
    this.buildBar = new BuildBar(this, root);
    this.toasts = new Toasts(root);

    this.dex = new DexPanel(this);
    this.staffPanel = new StaffPanel(this);
    this.buildPanel = new BuildPanel(this);
    this.tabs = { build: this.buildPanel, staff: this.staffPanel, workshop: new WorkshopPanel(this), dex: this.dex };
    this.bag = new BagPanel(this);
    this.settings = new SettingsPanel(this);
    this.building = new BuildingPanel(this);
    this.lockedBooth = new LockedBoothPanel(this);
    this.placedPanel = new PlacedPanel(this);
    this.shopPanel = new ShopPanel(this);
    this.debtSheets = { pawnshop: new PawnshopPanel(this), bank: new BankPanel(this), workyard: new WorkyardPanel(this, new DebtLog(sim)) };

    const bus = sim.bus;
    bus.on('toast', (e) => {
      // 부스 이야기 (빚 걸기 판 결과): 그 부스 패널이 열려 있으면 결과판에 다 보이니 건너뛴다.
      if (e.booth !== undefined && this.booth.booth === e.booth) return;
      // 파산·다 갚음 알림은 큰 마을에서 1분에 한두 번씩 온다: DEBT_TOAST_GAP초 안에 또 오면 건너뛴다 (지도 연출·일터 시트에는 그대로 보인다).
      if (e.topic === 'debt') {
        const now = performance.now();
        if (now - this.debtToastAt < DEBT_TOAST_GAP * 1000) return;
        this.debtToastAt = now;
      }
      this.toast(e.text, e.kind);
    });
    bus.on('coinsChanged', (e) => this.hud.bump(e.delta));
    bus.on('monsterLeft', (e) => {
      if (this.card.id === e.id) this.card.close();
    });
    for (const k of ['itemsChanged', 'buildingUpgraded', 'boothUnlocked', 'staffChanged', 'craftDone', 'villageChanged', 'landBought', 'pawned', 'redeemed', 'bankrupt', 'debtCleared', 'debtMatchCalled', 'debtSettled'] as const) bus.on(k, () => this.markDirty());

    window.addEventListener('resize', () => {
      this.menu.close();
      this.booth.layout();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      // 시트·카드가 열려 있으면 그것부터, 아니면 짓기 모드를 끝낸다.
      if (!this.sheet.isOpen && this.hooks.world.buildState().mode.kind !== 'none') this.hooks.world.cancelBuild();
      else this.closeAll();
    });

    void loadPicIndex().then(() => this.redrawAll());
    this.hud.tick();
    this.goal.update((t, on) => this.nav.setBadge(t, on));
    this.syncInsets();
  }

  /** 지도 카메라에 위·아래 UI 높이를 알린다: 손님 카드가 열려 있으면 카드 위의 띠 가운데에 손님이 오게. */
  private syncInsets(): void {
    const hud = this.hud.el.getBoundingClientRect().bottom;
    const goal = this.goal.el.hidden ? 0 : this.goal.el.getBoundingClientRect().bottom;
    const top = Math.max(hud, goal) + 4;
    // 토스트는 HUD·다음 목표 칩 바로 아래에 (칩의 비용 줄을 가리지 않게).
    this.root.style.setProperty('--toast-top', `${Math.round(top + 4)}px`);
    const h = this.root.clientHeight;
    // 짓기 모드 띠가 떠 있으면 그 위까지 (유령·✓/✕가 띠에 가리지 않게), 가게 시트가 열려 있으면 시트 위까지 (그 가게가 시트 위에 보이게).
    const bottom = this.card.isOpen
      ? h - this.card.el.offsetTop + 8
      : this.buildBar.visible
        ? h - this.buildBar.el.offsetTop + 6
        : this.shopSheetOpen()
          ? h - this.sheet.el.offsetTop + 6
          : this.nav.el.offsetHeight;
    this.hooks.world.setViewInset(top, Math.max(0, bottom));
    this.buildBar.setBand(top, h - Math.max(0, bottom));
  }

  // ── UiApi ──

  update(dt: number): void {
    this.hud.update(dt);
    // 짓기 모드 ✓/✕는 매 프레임 유령을 따라간다.
    this.buildBar.follow();
    this.acc += dt;
    if (!this.dirty && this.acc < REFRESH_SEC) return;
    this.acc = 0;
    this.dirty = false;
    this.hud.tick();
    this.goal.update((t, on) => this.nav.setBadge(t, on));
    this.syncInsets();
    if (this.sheetPanel !== null && this.sheet.isOpen) {
      this.sheetPanel.refresh();
      this.syncSheetHead();
    }
    this.card.refresh();
    this.booth.refresh();
    this.buildBar.refresh();
  }

  showMonster(id: MonsterId): void {
    if (this.sim.monster(id) === undefined) return;
    this.menu.close();
    this.closeSheet();
    this.card.show(id);
    this.syncInsets();
  }

  showBooth(b: BoothId, role?: number): void {
    this.menu.close();
    this.card.close();
    if (!this.sim.state.booths[b].unlocked) {
      this.lockedBooth.booth = b;
      this.openSheet(this.lockedBooth, `booth:${b}`, null, true);
      return;
    }
    this.closeSheet();
    this.booth.show(b);
    if (role !== undefined) this.booth.focusRole(role);
    this.goal.mark('booth');
    if (isGroupBooth(b)) this.goal.markWatched(b);
    if (this.sim.state.booths[b].group?.mode === 'debt') this.goal.mark('debtMatch');
  }

  openHire(): void {
    const key = 'tab:staff';
    if (!(this.sheetKey === key && this.sheet.isOpen)) this.openSheet(this.staffPanel, key, 'staff', false, TAB_TITLE.staff);
    this.staffPanel.revealHire();
  }

  showBuilding(id: BuildingId): void {
    if (id === 'pawnshop' || id === 'bank' || id === 'workyard') {
      // 지은 뒤에는 목록이 늘고 줄어도 시트 높이가 튀지 않게 (fit은 짓기 전 설명만).
      this.openSheet(this.debtSheets[id], `building:${id}`, null, !this.sim.buildingBuilt(id));
      if (id === 'workyard' && this.sim.buildingBuilt(id)) this.goal.mark('yard');
      return;
    }
    this.building.id = id;
    this.openSheet(this.building, `building:${id}`, null, true);
  }

  closeAll(): void {
    this.menu.close();
    this.menu.closeDialog();
    this.closeSheet();
    this.card.close();
    this.booth.close();
  }

  showPlaced(id: number): void {
    const p = this.sim.village().byId.get(id);
    if (p === undefined) return;
    if (catalogKind(p.key) === 'shop') {
      this.showShop(p.key as ShopId);
      return;
    }
    this.placedPanel.id = id;
    this.openSheet(this.placedPanel, `placed:${id}`, null, true);
  }

  showShop(s: ShopId): void {
    this.shopPanel.shop = s;
    this.openSheet(this.shopPanel, `shop:${s}`, null, false);
    // 놓인 가게: 시트를 조금 낮게 (위 띠에 가게가 보이게, 짧은 폰은 더: shops.css .mpv-shopsheet).
    const v = this.sim.village();
    this.sheet.el.classList.toggle('mpv-shopsheet', v.placed(s) !== undefined);
    this.syncInsets();
    // 놓인 가게면 시트 위 띠에 맞춘다 (트럭은 길에 나가 있으면 트럭).
    if (v.placed(s) === undefined) return;
    const fp = footprint(s);
    const o = v.origin(s);
    const out = s === 'icecream_truck' && this.sim.state.shops.icecream_truck.truck?.parked === false;
    // 그림이 발자국 위로 1~2칸 삐져나오니 가운데를 조금 위로, 가게 전체 (+ 지붕)가 띠에 들어오게.
    const at = out ? truckPos(this.sim.state) : { x: o.x + (fp.w * CELL) / 2, y: o.y + fp.h * CELL * 0.3 };
    const band = Math.max(120, this.root.clientHeight - this.sheet.el.offsetHeight - this.hud.el.getBoundingClientRect().bottom);
    // 너무 멀리 빼면 마을 가장자리 가게는 카메라 울타리에 걸려 띠에 오지 못한다 (0.42 아래로는 빼지 않는다).
    const z = out ? 0.6 : Math.min(0.6, Math.max(0.42, Math.min(band / (fp.h * CELL + 60), (this.root.clientWidth * 0.95) / (fp.w * CELL))));
    this.hooks.world.focusOn(out ? { x: at.x, y: at.y - 40 } : at, z);
  }

  /** 가게 시트가 열려 있나. */
  private shopSheetOpen(): boolean {
    return this.sheet.isOpen && this.sheetPanel === this.shopPanel;
  }

  showLand(chunk: number): void {
    this.closeAll();
    this.hooks.world.setBuildMode({ kind: 'land', chunk });
  }

  onBuildChange(s: BuildState): void {
    const was = this.buildBar.visible;
    this.buildBar.show(s);
    // 띠가 나타나거나 사라지면 지도 카메라 아래 여백을 곧바로 (유령이 띠 뒤로 가지 않게).
    if (was !== this.buildBar.visible) this.syncInsets();
    this.markDirty();
  }

  openBuild(category?: string, focus?: CatalogKey): void {
    if (isBuildCat(category)) this.buildPanel.cat = category;
    this.buildPanel.focus = focus ?? null;
    const key = 'tab:build';
    if (this.sheetKey === key && this.sheet.isOpen) {
      this.buildPanel.refresh(true);
      return;
    }
    this.openSheet(this.buildPanel, key, 'build', false, TAB_TITLE.build);
  }

  startBuild(mode: BuildMode): void {
    this.closeAll();
    this.hooks.world.setBuildMode(mode);
  }

  // ── UiCtx ──

  act(r: Result): boolean {
    if (!r.ok) this.toast(r.reason, 'warn');
    this.markDirty();
    return r.ok;
  }

  toast(text: string, kind: ToastKind = 'info'): void {
    this.toasts.show(text, kind);
  }

  openTab(tab: TabId): void {
    // 다른 탭을 열면 짓기 모드는 끝낸다 (짓기 탭은 이어서 고를 수 있게 그대로).
    if (tab !== 'build' && this.hooks.world.buildState().mode.kind !== 'none') this.hooks.world.cancelBuild();
    if (tab === 'village') {
      // 아무것도 열려 있지 않은데 마을 탭을 또 누르면 마을 가운데로 (멀리 굴려 마을을 잃었을 때).
      const open = this.sheet.isOpen || this.card.isOpen || this.booth.isOpen;
      this.closeAll();
      if (!open && this.hooks.world.buildState().mode.kind === 'none') this.hooks.world.focusVillage();
      return;
    }
    const key = `tab:${tab}`;
    if (this.sheetKey === key && this.sheet.isOpen) {
      this.closeAll();
      return;
    }
    this.openSheet(this.tabs[tab], key, tab, false, TAB_TITLE[tab]);
  }

  openBag(): void {
    if (this.sheetKey === 'bag' && this.sheet.isOpen) {
      this.closeAll();
      return;
    }
    this.openSheet(this.bag, 'bag', null, false, '가방');
  }

  openDex(view: DexView): void {
    this.dex.view = view;
    const key = 'tab:dex';
    if (this.sheetKey === key && this.sheet.isOpen) {
      this.dex.refresh(true);
      return;
    }
    this.openSheet(this.dex, key, 'dex', false, TAB_TITLE.dex);
  }

  markDirty(): void {
    this.dirty = true;
  }

  insets(): { top: number; bottom: number } {
    return this.readInsets();
  }

  // ── 시트 ──

  private openSettings(): void {
    if (this.sheetKey === 'settings' && this.sheet.isOpen) {
      this.closeAll();
      return;
    }
    this.openSheet(this.settings, 'settings', null, true, '설정');
  }

  /** 시트 하나를 돌려 쓴다: 다른 카드·패널은 닫는다. fit = 내용 높이만큼. */
  private openSheet(panel: BasePanel, key: string, tab: TabId | null, fit: boolean, title = ''): void {
    this.menu.close();
    this.card.close();
    this.booth.close();
    const same = this.sheetPanel === panel && this.sheetKey === key && this.sheet.isOpen;
    this.sheetPanel = panel;
    this.sheetKey = key;
    this.sheet.setTitle(title);
    this.sheet.el.classList.toggle('fit', fit);
    this.sheet.el.classList.remove('mpv-shopsheet');
    if (!same) {
      this.sheet.body.replaceChildren(panel.el);
      this.sheet.body.scrollTop = 0;
    }
    panel.refresh(true);
    this.syncSheetHead();
    this.sheet.open();
    this.backdrop.classList.add('open');
    this.root.classList.add('sheet-open');
    this.nav.setActive(tab);
  }

  private syncSheetHead(): void {
    const head = this.sheetPanel?.head() ?? null;
    if (head !== null) this.sheet.setTitle(head[0], head[1]);
  }

  private closeSheet(): void {
    if (this.sheetPanel === null && !this.sheet.isOpen) return;
    this.sheet.close();
    this.backdrop.classList.remove('open');
    this.root.classList.remove('sheet-open');
    this.sheetPanel = null;
    this.sheetKey = '';
    this.nav.setActive('village');
  }

  /** 그림 목록을 늦게 알았을 때 열린 것을 다시 그린다. */
  private redrawAll(): void {
    this.sheetPanel?.refresh(true);
    this.booth.redraw();
    this.card.redraw();
  }
}
