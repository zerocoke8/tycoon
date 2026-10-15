// UI DOM 도구: 요소 만들기, 글자 쓰기, 숫자·시간 꼴, 글꼴 넣기, 안전 영역 재기.

export type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  append(el, children);
  return el;
}

export function append(el: Element, children: readonly Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
}

/** 글자가 바뀔 때만 쓴다 (4Hz 갱신에서 DOM을 덜 건드리게). */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** 누르면 onTap. 누르기가 아래 캔버스·뒤판으로 새지 않게 막는다. */
export function btn(cls: string, children: Child | readonly Child[], onTap: (el: HTMLButtonElement) => void): HTMLButtonElement {
  const b = h('button', `mpv-btn ${cls}`.trim());
  b.type = 'button';
  append(b, Array.isArray(children) ? (children as readonly Child[]) : [children as Child]);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onTap(b);
  });
  return b;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * el이 보이게 가장 가까운 시트 몸통만 굴린다. scrollIntoView는 overflow: hidden인 UI 바탕까지 굴려
 * 오버레이 전체가 밀려 올라가므로 쓰지 않는다.
 */
export function revealInSheet(el: HTMLElement, margin = 12, top = false, smooth = true): void {
  const body = el.closest('.mpv-sheet-body');
  if (!(body instanceof HTMLElement)) return;
  const r = el.getBoundingClientRect();
  const br = body.getBoundingClientRect();
  let dy = 0;
  // top = el을 몸통 맨 위로 (그 아래 내용이 이어서 보이게).
  if (top) dy = r.top - br.top - margin;
  else if (r.bottom > br.bottom - margin) dy = Math.min(r.bottom - br.bottom + margin, r.top - br.top - margin);
  else if (r.top < br.top + margin) dy = r.top - br.top - margin;
  if (dy !== 0) body.scrollTo({ top: body.scrollTop + dy, behavior: smooth ? 'smooth' : 'instant' });
}

/** 1234 → '1,234' */
export const fmt = (n: number): string => Math.floor(n).toLocaleString('ko-KR');

/** 초 → '45초' / '2:05' */
export function fmtSec(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  if (s < 60) return `${s}초`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const FONT_URL = 'https://fonts.googleapis.com/css2?family=Gowun+Dodum&family=Jua&display=swap';

/** 글꼴 링크(Jua, Gowun Dodum)와 모바일 viewport가 없으면 <head>에 넣는다. */
export function injectHead(): void {
  const head = document.head;
  if (head.querySelector('link[href*="fonts.googleapis.com"][href*="Jua"]') === null) {
    for (const [href, cross] of [
      ['https://fonts.googleapis.com', false],
      ['https://fonts.gstatic.com', true],
    ] as const) {
      const l = document.createElement('link');
      l.rel = 'preconnect';
      l.href = href;
      if (cross) l.crossOrigin = 'anonymous';
      head.append(l);
    }
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = FONT_URL;
    head.append(css);
  }
  if (head.querySelector('meta[name="viewport"]') === null) {
    const m = document.createElement('meta');
    m.name = 'viewport';
    m.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
    head.append(m);
  }
  // iOS Safari: :active가 먹으려면 touchstart 듣는 이가 하나 있어야 한다.
  document.addEventListener('touchstart', () => {}, { passive: true });
}

/** env(safe-area-inset-*)를 px 숫자로 (재는 요소를 하나 둔다). */
export function makeInsetProbe(parent: HTMLElement): () => { top: number; bottom: number } {
  const probe = h('div', 'mpv-safe-probe');
  parent.append(probe);
  return () => {
    const cs = getComputedStyle(probe);
    return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  };
}
