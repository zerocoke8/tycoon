// 시트·카드가 같이 쓰는 조각: 살아 있는 숫자(Live), 비용 칩, 능력치 점, 막대, 칸 제목.

import { STAFF_STAT_NAMES, type MaterialId, type PreciousId, type StaffStats } from '../data/defs.ts';
import type { Cost, SimApi } from '../sim/api.ts';
import { append, clamp, fmt, h, type Child } from './dom.ts';
import { itemName } from './labels.ts';
import { itemIcon } from './pics.ts';

/** 그릴 때 숫자 갱신 함수를 모아 두고 4Hz마다 돌린다 (DOM은 다시 만들지 않는다). */
export class Live {
  private fns: (() => void)[] = [];

  /** 갱신 함수를 더하고 한 번 곧바로 부른다. */
  add(fn: () => void): void {
    this.fns.push(fn);
    fn();
  }

  run(): void {
    for (const fn of this.fns) fn();
  }

  reset(): void {
    this.fns = [];
  }
}

/** 아이템 칩 속 그림과 이름 (코인은 그림만). 폰에는 hover가 없으니 이름을 글자로 보여 준다. */
export function chipLabel(key: string): Child[] {
  return key === 'coin' ? [itemIcon('coin')] : [itemIcon(key), h('span', 'nm', itemName(key))];
}

/** 비용 칩 줄: 코인·재료·귀한 물건 (이름과 수). 모자란 칩은 붉게 (live로 갱신). */
export function costChips(sim: SimApi, cost: Cost, live: Live): HTMLElement {
  const row = h('span', 'mpv-cost');
  const add = (key: string, need: number, have: () => number): void => {
    const chip = h('span', 'mpv-chip', ...chipLabel(key), fmt(need));
    row.append(chip);
    live.add(() => chip.classList.toggle('short', have() < need));
  };
  if (cost.coins > 0) add('coin', cost.coins, () => sim.state.coins);
  for (const [k, n] of Object.entries(cost.mats ?? {}) as [MaterialId, number | undefined][]) {
    if (n) add(k, n, () => sim.state.materials[k] ?? 0);
  }
  for (const [k, n] of Object.entries(cost.precious ?? {}) as [PreciousId, number | undefined][]) {
    if (n) add(k, n, () => sim.state.precious[k] ?? 0);
  }
  if (row.childElementCount === 0) row.append(h('span', 'mpv-chip free', '무료'));
  return row;
}

/** 1~5 점. */
export function statDots(v: number): HTMLElement {
  const n = clamp(Math.round(v), 0, 5);
  const el = h('span', 'mpv-dots');
  for (let i = 0; i < 5; i++) el.append(h('i', i < n ? 'on' : null));
  return el;
}

/** 진행·입담·손님맞이 세 줄. focus = 그 자리에서 쓰는 능력치 (도드라지게). */
export function statBlock(stats: StaffStats, focus: keyof StaffStats | null = null): HTMLElement {
  const el = h('div', focus === null ? 'mpv-stats' : 'mpv-stats focused');
  for (const k of ['pace', 'charm', 'welcome'] as const) {
    el.append(h('span', k === focus ? 'mpv-stat focus' : 'mpv-stat', STAFF_STAT_NAMES[k], statDots(stats[k])));
  }
  return el;
}

/** 작은 막대 단추 줄 (도감 손님/인형 같은 보기 바꾸기). 누르면 onPick(key). */
export function segmented<K extends string>(items: readonly { readonly key: K; readonly label: Child | readonly Child[] }[], active: K, onPick: (key: K) => void): HTMLElement {
  const el = h('div', 'mpv-seg');
  el.setAttribute('role', 'tablist');
  for (const it of items) {
    const b = h('button', it.key === active ? 'on' : null);
    append(b, Array.isArray(it.label) ? (it.label as readonly Child[]) : [it.label as Child]);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(it.key === active));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (it.key !== active) onPick(it.key);
    });
    el.append(b);
  }
  return el;
}

export interface Bar {
  readonly el: HTMLElement;
  set(ratio: number, color?: string): void;
}

export function makeBar(cls = ''): Bar {
  const fill = h('i');
  const el = h('span', `mpv-bar ${cls}`.trim(), fill);
  let lastW = '';
  let lastC = '';
  return {
    el,
    set(ratio, color) {
      const r = clamp(ratio, 0, 1);
      const w = `${(r * 100).toFixed(1)}%`;
      if (w !== lastW) {
        fill.style.width = w;
        el.classList.toggle('full', r >= 0.999);
        lastW = w;
      }
      if (color !== undefined && color !== lastC) {
        el.style.setProperty('--bar', color);
        lastC = color;
      }
    },
  };
}

/** 칸 제목 (오른쪽에 작은 글). */
export function secHead(title: string, right?: Child): HTMLElement {
  return h('div', 'mpv-sec', h('span', null, title), right === undefined ? null : h('small', null, right));
}
