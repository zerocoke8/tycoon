// HTML 오버레이 본체: HUD, 아래 탭, 시트(짓기·주민·공방·도감·가방·설정·건물), 손님 카드, 부스 패널, 토스트.
// sim은 SimApi로만 쓰고, 화면 쪽은 UiHooks로만 부른다. main.ts가 매 프레임 update(dt)를 부른다.

import './ui.css';
import { isGroupBooth, type BoothId, type BuildingId } from '../data/defs.ts';
import type { Result, SimApi } from '../sim/api.ts';
import type { MonsterId } from '../sim/types.ts';
import type { UiApi, UiHooks } from '../view/contracts.ts';
import { BoothPanel } from './boothPanel.ts';
import { h, injectHead, makeInsetProbe } from './dom.ts';
import { Hud, Nav, Toasts } from './hud.ts';
import { Menu } from './menu.ts';
import { MonsterCard } from './monsterCard.ts';
import type { BasePanel, DexView, TabId, ToastKind, UiCtx } from './panel.ts';
import { BuildingPanel, BuildPanel, LockedBoothPanel } from './panels/build.ts';
import { BankPanel, DebtLog, PawnshopPanel, WorkyardPanel, type DebtBuildingId } from './panels/debt.ts';
import { GoalChip } from './goal.ts';
import { DexPanel } from './panels/dex.ts';
import { BagPanel, SettingsPanel } from './panels/misc.ts';
import { StaffPanel } from './panels/staff.ts';
import { WorkshopPanel } from './panels/workshop.ts';
import { loadPicIndex } from './pics.ts';
import { Sheet } from './sheet.ts';

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
  private readonly staffPanel: StaffPanel;
  private readonly dex: DexPanel;
  private readonly bag: BagPanel;
  private readonly settings: SettingsPanel;
  private readonly building: BuildingPanel;
  private readonly lockedBooth: LockedBoothPanel;
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
    this.toasts = new Toasts(root);

    this.dex = new DexPanel(this);
    this.staffPanel = new StaffPanel(this);
    this.tabs = { build: new BuildPanel(this), staff: this.staffPanel, workshop: new WorkshopPanel(this), dex: this.dex };
    this.bag = new BagPanel(this);
    this.settings = new SettingsPanel(this);
    this.building = new BuildingPanel(this);
    this.lockedBooth = new LockedBoothPanel(this);
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
    for (const k of ['itemsChanged', 'buildingUpgraded', 'boothUnlocked', 'staffChanged', 'craftDone', 'districtOpened', 'pawned', 'redeemed', 'bankrupt', 'debtCleared', 'debtMatchCalled', 'debtSettled'] as const) bus.on(k, () => this.markDirty());

    window.addEventListener('resize', () => {
      this.menu.close();
      this.booth.layout();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeAll();
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
    const bottom = this.card.isOpen ? h - this.card.el.offsetTop + 8 : this.nav.el.offsetHeight;
    this.hooks.world.setViewInset(top, Math.max(0, bottom));
  }

  // ── UiApi ──

  update(dt: number): void {
    this.hud.update(dt);
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
    if (tab === 'village') {
      this.closeAll();
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
