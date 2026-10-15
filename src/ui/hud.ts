// 위 HUD: 코인(따라 오르는 숫자), 마을 레벨(마을회관), 가방, 설정. 토스트 줄과 아래 탭도 여기.

import { fmt, h, setText } from './dom.ts';
import { icon, type IconName } from './icons.ts';
import type { TabId, ToastKind, UiCtx } from './panel.ts';
import { itemIcon } from './pics.ts';

export class Hud {
  readonly el: HTMLDivElement;
  private readonly ctx: UiCtx;
  private readonly coinBox: HTMLDivElement;
  private readonly coinNum: HTMLSpanElement;
  private readonly lvNum: HTMLElement;
  /** 화면에 보이는 코인 (실제 값을 따라 오른다). */
  private shown: number;

  constructor(ctx: UiCtx, parent: HTMLElement, onBag: () => void, onSettings: () => void) {
    this.ctx = ctx;
    this.shown = ctx.sim.state.coins;
    this.coinNum = h('span', null, fmtCoins(this.shown));
    this.coinBox = h('div', 'mpv-coins', itemIcon('coin'), this.coinNum);
    this.coinBox.setAttribute('aria-label', '코인');
    this.lvNum = h('b', null, 'Lv.1');
    const level = h('button', 'mpv-level', h('small', null, '마을회관'), this.lvNum);
    level.type = 'button';
    level.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.showBuilding('hall');
    });
    this.el = h('div', 'mpv-hud', this.coinBox, h('span', 'grow'), level, iconBtn('bag', '가방', onBag), iconBtn('gear', '설정', onSettings));
    parent.append(this.el);
  }

  /** 매 프레임: 코인 숫자가 실제 값으로 따라 오른다. */
  update(dt: number): void {
    const target = this.ctx.sim.state.coins;
    if (this.shown === target) return;
    const d = target - this.shown;
    const step = Math.sign(d) * Math.max(1, Math.abs(d) * Math.min(1, dt * 9));
    this.shown = Math.abs(step) >= Math.abs(d) ? target : this.shown + step;
    setText(this.coinNum, fmtCoins(Math.round(this.shown)));
  }

  /** 코인이 바뀔 때 통 튀기. */
  bump(delta: number): void {
    if (delta === 0) return;
    const b = this.coinBox;
    b.classList.remove('bump', 'spend');
    void b.offsetWidth;
    b.classList.add(delta > 0 ? 'bump' : 'spend');
  }

  tick(): void {
    setText(this.lvNum, `Lv.${this.ctx.sim.hallLevel()}`);
  }
}

/** HUD 코인: 만 이상은 짧게 ('1.2만'), 좁은 폰에서 HUD가 넘치지 않게. */
function fmtCoins(n: number): string {
  if (n < 10000) return fmt(n);
  const man = n / 10000;
  return `${man >= 100 ? Math.floor(man) : Math.floor(man * 10) / 10}만`;
}

function iconBtn(name: IconName, label: string, onTap: () => void): HTMLButtonElement {
  const b = h('button', 'mpv-iconbtn', icon(name));
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onTap();
  });
  return b;
}

// ── 아래 탭 ──

const TABS: readonly { readonly id: TabId; readonly label: string; readonly icon: IconName }[] = [
  { id: 'village', label: '마을', icon: 'village' },
  { id: 'build', label: '짓기', icon: 'build' },
  { id: 'staff', label: '주민', icon: 'staff' },
  { id: 'workshop', label: '공방', icon: 'workshop' },
  { id: 'dex', label: '도감', icon: 'dex' },
];

export class Nav {
  readonly el: HTMLElement;
  private readonly btns = new Map<TabId, HTMLButtonElement>();
  private readonly dots = new Map<TabId, boolean>();

  constructor(parent: HTMLElement, onTab: (t: TabId) => void) {
    this.el = h('nav', 'mpv-nav');
    for (const t of TABS) {
      const b = h('button', null, icon(t.icon), h('span', null, t.label));
      b.type = 'button';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onTab(t.id);
      });
      this.btns.set(t.id, b);
      this.el.append(b);
    }
    parent.append(this.el);
    this.setActive('village');
  }

  /** null이면 아무 탭도 켜지 않는다 (가방·건물 시트 등). */
  setActive(tab: TabId | null): void {
    for (const [id, b] of this.btns) b.classList.toggle('on', id === tab);
  }

  /** 탭 위 작은 점: 그 탭에서 지금 할 수 있는 일이 있다. */
  setBadge(tab: TabId, on: boolean): void {
    if (this.dots.get(tab) === on) return;
    this.dots.set(tab, on);
    this.btns.get(tab)?.classList.toggle('dot', on);
  }
}

// ── 토스트 ──

export class Toasts {
  private readonly el: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = h('div', 'mpv-toasts');
    this.el.setAttribute('aria-live', 'polite');
    parent.append(this.el);
  }

  show(text: string, kind: ToastKind = 'info'): void {
    // 같은 글이 막 떠 있으면 다시 띄우지 않고 시간만 늘린다.
    const last = this.el.lastElementChild as HTMLElement | null;
    if (last !== null && last.textContent === text && !last.classList.contains('out')) {
      this.arm(last);
      return;
    }
    // '처음 보는 손님이 왔어요: 두더지'가 이어서 오면 한 줄로 묶는다 ('…: 두더지, 거북').
    const m = /^(.+?): (.+)$/.exec(text);
    if (m !== null && last !== null && !last.classList.contains('out') && last.dataset.head === m[1] && last.dataset.kind === kind) {
      const items = `${last.dataset.items ?? ''}, ${m[2]}`;
      last.dataset.items = items;
      last.textContent = `${m[1]}: ${items}`;
      this.arm(last);
      return;
    }
    const t = h('div', `mpv-toast ${kind}`, text);
    t.dataset.kind = kind;
    if (m !== null) {
      t.dataset.head = m[1];
      t.dataset.items = m[2];
    }
    this.el.append(t);
    while (this.el.childElementCount > 4) this.el.firstElementChild?.remove();
    this.arm(t);
  }

  private arm(t: HTMLElement): void {
    const prev = Number(t.dataset.timer ?? 0);
    if (prev) window.clearTimeout(prev);
    const ms = 2200 + Math.min(1600, (t.textContent?.length ?? 0) * 40);
    t.dataset.timer = String(
      window.setTimeout(() => {
        t.classList.add('out');
        window.setTimeout(() => t.remove(), 260);
      }, ms),
    );
  }
}
