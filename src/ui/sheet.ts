// 아래에서 올라오는 시트: 손잡이·제목·닫기 + 스크롤되는 몸통. 손잡이를 아래로 끌면 닫힌다.

import { h, setText } from './dom.ts';
import { icon } from './icons.ts';

export function closeButton(onTap: () => void): HTMLButtonElement {
  const x = h('button', 'mpv-x', icon('close'));
  x.type = 'button';
  x.setAttribute('aria-label', '닫기');
  x.addEventListener('click', (e) => {
    e.stopPropagation();
    onTap();
  });
  return x;
}

export class Sheet {
  readonly el: HTMLDivElement;
  readonly body: HTMLDivElement;
  private readonly titleEl: HTMLHeadingElement;
  private readonly badgeEl: HTMLSpanElement;
  /** 닫기를 바랄 때 (닫기 버튼, 끌어내리기). 실제로 닫는 것은 UI 본체. */
  onClose: () => void = () => {};

  constructor(parent: HTMLElement, cls = '') {
    this.titleEl = h('h2');
    this.badgeEl = h('span', 'mpv-lv');
    this.badgeEl.hidden = true;
    const head = h('div', 'mpv-sheet-head', this.titleEl, this.badgeEl, h('span', 'grow'), closeButton(() => this.onClose()));
    const drag = h('div', 'mpv-sheet-drag', h('div', 'mpv-sheet-grip', h('span')), head);
    this.body = h('div', 'mpv-sheet-body');
    this.el = h('div', `mpv-sheet ${cls}`.trim(), drag, this.body);
    this.el.addEventListener('click', (e) => e.stopPropagation());
    parent.append(this.el);
    this.bindDrag(drag);
  }

  get isOpen(): boolean {
    return this.el.classList.contains('open');
  }

  setTitle(title: string, badge = ''): void {
    setText(this.titleEl, title);
    setText(this.badgeEl, badge);
    this.badgeEl.hidden = badge === '';
  }

  open(): void {
    this.el.style.transform = '';
    this.el.classList.add('open');
  }

  close(): void {
    this.el.classList.remove('open', 'dragging');
    this.el.style.transform = '';
  }

  private bindDrag(zone: HTMLElement): void {
    let pid = -1;
    let y0 = 0;
    let dy = 0;
    let lastY = 0;
    let lastT = 0;
    let vel = 0;
    zone.addEventListener('pointerdown', (e) => {
      if (pid !== -1 || (e.target as Element).closest('button') !== null) return;
      pid = e.pointerId;
      y0 = lastY = e.clientY;
      lastT = e.timeStamp;
      dy = 0;
      vel = 0;
      zone.setPointerCapture(pid);
      this.el.classList.add('dragging');
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      dy = Math.max(0, e.clientY - y0);
      const dt = Math.max(1, e.timeStamp - lastT);
      vel = (e.clientY - lastY) / dt;
      lastY = e.clientY;
      lastT = e.timeStamp;
      this.el.style.transform = `translateY(${dy}px)`;
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== pid) return;
      pid = -1;
      this.el.classList.remove('dragging');
      this.el.style.transform = '';
      if (dy > 90 || (dy > 24 && vel > 0.5)) this.onClose();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }
}
