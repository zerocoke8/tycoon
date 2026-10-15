// 버튼 옆에 뜨는 고르기 판(간식·응원 도구·진행자)과 확인 창. 바깥을 누르면 닫힌다.

import { btn, clamp, h } from './dom.ts';

export interface MenuItem {
  readonly icon?: Node;
  readonly label: string;
  readonly sub?: string;
  readonly right?: string;
  readonly active?: boolean;
  readonly onPick: () => void;
}

export class Menu {
  private readonly layer: HTMLDivElement;
  private readonly box: HTMLDivElement;
  private readonly dlgLayer: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.box = h('div', 'mpv-menu');
    this.layer = h('div', 'mpv-menu-layer', this.box);
    this.layer.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target === this.layer) this.close();
    });
    this.dlgLayer = h('div', 'mpv-dialog-layer');
    this.dlgLayer.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target === this.dlgLayer) this.closeDialog();
    });
    parent.append(this.layer, this.dlgLayer);
  }

  get isOpen(): boolean {
    return this.layer.classList.contains('open');
  }

  /** anchor 위(판이 다 들어가지 않고 아래가 더 넓으면 아래)에 고르기 판. items가 비면 empty를 보여 준다. */
  open(anchor: HTMLElement, title: string, items: readonly MenuItem[], empty?: Node): void {
    const rows: Node[] = items.map((it) => {
      const b = h(
        'button',
        `mpv-menu-item${it.active ? ' on' : ''}`,
        it.icon ?? null,
        h('span', 'l', h('b', null, it.label), it.sub ? h('small', null, it.sub) : null),
        it.right ? h('span', 'r', it.right) : null,
      );
      b.type = 'button';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
        it.onPick();
      });
      return b;
    });
    if (rows.length === 0) rows.push(empty ?? h('div', 'mpv-menu-empty', '고를 것이 없어요'));
    this.box.replaceChildren(h('div', 'mpv-menu-title', title), ...rows);
    this.layer.classList.add('open');

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // 버튼이 화면 밖(올라오는 중인 시트 등)이어도 판은 화면 안에.
    const a = anchor.getBoundingClientRect();
    const r = { left: a.left, width: a.width, top: clamp(a.top, 0, vh), bottom: clamp(a.bottom, 0, vh) };
    const w = Math.min(320, vw - 24);
    this.box.style.width = `${w}px`;
    this.box.style.left = `${clamp(r.left + r.width / 2 - w / 2, 12, vw - 12 - w)}px`;
    const above = r.top - 16;
    const below = vh - r.bottom - 16;
    // 판 높이 어림 (줄마다 약 58px + 제목): 위에 다 들어가거나 위가 더 넓으면 위로.
    const want = Math.min(Math.max(1, items.length) * 58 + 50, 360);
    if (above >= want || above >= below) {
      this.box.style.top = '';
      this.box.style.bottom = `${vh - r.top + 6}px`;
      this.box.style.maxHeight = `${Math.max(120, above)}px`;
    } else {
      this.box.style.bottom = '';
      this.box.style.top = `${r.bottom + 6}px`;
      this.box.style.maxHeight = `${Math.max(120, below)}px`;
    }
  }

  close(): void {
    this.layer.classList.remove('open');
  }

  /** 확인 창: [그만두기] [okLabel]. */
  confirm(text: string, okLabel: string, onOk: () => void): void {
    const cancel = btn('sub', '그만두기', () => this.closeDialog());
    const ok = btn('danger', okLabel, () => {
      this.closeDialog();
      onOk();
    });
    this.dlgLayer.replaceChildren(h('div', 'mpv-dialog', h('p', null, text), h('div', 'btns', cancel, ok)));
    this.dlgLayer.classList.add('open');
  }

  closeDialog(): void {
    this.dlgLayer.classList.remove('open');
  }
}
