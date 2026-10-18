// UI가 쓰는 그림 (<img>): public/assets/art/<그룹>/<key>.webp. meta.json으로 있는 그림을 알고,
// 없는 그림은 처음부터 글자 자리 표시로 (404를 덜 낸다). 못 읽은 그림은 두 번 다시 받아 보고, 그래도 안 되면 자리 표시로 바뀐다.

import type { AccessoryId, AccessorySlot, SpeciesId } from '../data/defs.ts';
import type { Pose } from '../sim/types.ts';
import { accessoryPortrait } from '../view/accessory.ts';
import { artMeta } from '../view/art.ts';
import { h } from './dom.ts';
import { itemColor, itemName, SPECIES_COLOR } from './labels.ts';

const BASE = `${import.meta.env.BASE_URL}assets/art/`;
let known: Set<string> | null = null;

/** meta.json을 읽어 있는 그림 목록을 안다. 실패하면 모든 그림을 시도해 본다. */
export async function loadPicIndex(): Promise<void> {
  try {
    const res = await fetch(`${BASE}meta.json`, { cache: 'no-cache' });
    if (!res.ok) return;
    const meta = (await res.json()) as Record<string, Record<string, unknown>>;
    const s = new Set<string>();
    for (const [g, rows] of Object.entries(meta)) for (const k of Object.keys(rows)) s.add(`${g}/${k}`);
    known = s;
  } catch {
    // 목록 없이 그림마다 시도한다.
  }
}

export const picUrl = (group: string, key: string): string => `${BASE}${group}/${key}.webp`;
/** 그림을 다시 받아 보는 횟수. */
const PIC_RETRIES = 2;

/** keys 가운데 있는 첫 그림 (목록을 모르면 첫째). */
function pickKey(group: string, keys: readonly string[]): string | null {
  if (known === null) return keys[0] ?? null;
  for (const k of keys) if (known.has(`${group}/${k}`)) return k;
  return null;
}

/** box 안을 그림(또는 자리 표시)으로 채운다. 같은 그림이면 그대로 둔다. */
export function setPic(box: HTMLElement, group: string, keys: readonly string[], fallback: () => Node): void {
  const key = pickKey(group, keys);
  const id = key === null ? `-${keys[0] ?? ''}` : `${group}/${key}`;
  if (box.dataset.pic === id) return;
  box.dataset.pic = id;
  if (key === null) {
    box.replaceChildren(fallback());
    return;
  }
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  img.decoding = 'async';
  // 못 읽으면 조금 뒤 두 번까지 다시 받아 보고 (느린 망·한꺼번에 많이 받을 때), 그래도 안 되면 자리 표시.
  let tries = 0;
  img.addEventListener('error', () => {
    if (box.dataset.pic !== id) return;
    if (tries < PIC_RETRIES) {
      tries++;
      window.setTimeout(() => {
        if (box.dataset.pic === id) img.src = `${picUrl(group, key)}?r=${tries}`;
      }, 700 * tries);
      return;
    }
    box.replaceChildren(fallback());
  });
  img.src = picUrl(group, key);
  box.replaceChildren(img);
}

export function pic(group: string, keys: readonly string[], fallback: () => Node, cls = ''): HTMLSpanElement {
  const box = h('span', `mpv-pic ${cls}`.trim());
  setPic(box, group, keys, fallback);
  return box;
}

/** 동그란 글자 자리 표시. */
export function placeholder(text: string, color: string, big = false): HTMLSpanElement {
  const s = h('span', big ? 'mpv-ph big' : 'mpv-ph', text);
  s.style.setProperty('--ph', color);
  return s;
}

/**
 * 아이템 그림 (items/<key>). named면 그림이 없을 때 이름 글자를, 아니면 첫 글자 동그라미를.
 */
export function itemIcon(key: string, opts: { named?: boolean; cls?: string } = {}): HTMLSpanElement {
  const name = itemName(key);
  const fb = (): Node => (opts.named ? h('span', 'mpv-ph-name', name) : placeholder(key === 'coin' ? '₵' : name.slice(0, 1), itemColor(key)));
  const box = pic('items', [key], fb, opts.cls ?? '');
  if (opts.named) box.classList.add('named');
  box.title = name;
  return box;
}

export function monsterPic(species: SpeciesId, pose: Pose, name: string, cls = ''): HTMLSpanElement {
  const box = h('span', `mpv-pic ${cls}`.trim());
  setMonsterPic(box, species, pose, name);
  return box;
}

/** 포즈 그림이 아직 없으면 기본 그림으로. */
export function setMonsterPic(box: HTMLElement, species: SpeciesId, pose: Pose, name: string): void {
  setPic(box, 'monsters', [`${species}_${pose}`, `${species}_base`], () => placeholder(name.slice(0, 1), SPECIES_COLOR[species], true));
}

/**
 * 손님 그림 위에 몸에 단 장신구 (<img>)를 겹친다 (view/accessory.ts accessoryPortrait: 지도·확대 화면과 같은 붙는 점).
 * box = 몸 그림 상자(.mpv-pic)의 그림 칸을 덮는 겹침 층 (CSS .mpv-dress). 몸 그림 비율의 틀을 가운데에 두고 장신구를 그 안 비율로 놓는다.
 * 몸 뒤에 그릴 장신구(behind)는 그림 상자 바탕에 가려지니 뺀다. 그림 정보가 없으면 비운다.
 */
export function dressPic(box: HTMLElement, species: SpeciesId, pose: Pose, list: readonly { readonly key: AccessoryId; readonly slot: AccessorySlot }[]): void {
  const pieces = list.length === 0 ? [] : accessoryPortrait(species, pose, list).filter((p) => !p.behind);
  const usePose: Pose = artMeta('monsters', `${species}_${pose}`) !== undefined ? pose : 'base';
  const t = artMeta('monsters', `${species}_${usePose}`)?.trim;
  if (pieces.length === 0 || t === undefined) {
    box.replaceChildren();
    return;
  }
  const frame = h('span', t.h > t.w ? 'frame tall' : 'frame');
  frame.style.aspectRatio = `${t.w} / ${t.h}`;
  for (const p of pieces) {
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.src = picUrl('items', p.key);
    const s = img.style;
    s.left = `${(p.left * 100).toFixed(2)}%`;
    s.top = `${(p.top * 100).toFixed(2)}%`;
    s.width = `${(p.width * 100).toFixed(2)}%`;
    s.transformOrigin = `${(p.ax * 100).toFixed(1)}% ${(p.ay * 100).toFixed(1)}%`;
    s.transform = `translate(${(-p.ax * 100).toFixed(1)}%, ${(-p.ay * 100).toFixed(1)}%) rotate(${p.rot.toFixed(3)}rad)`;
    frame.append(img);
  }
  box.replaceChildren(frame);
}

export function staffPic(art: string, name: string, cls = ''): HTMLSpanElement {
  return pic('characters', [art], () => placeholder(name.slice(0, 1), 'var(--dd-sky)', true), cls);
}

export function mapPic(key: string, name: string, cls = ''): HTMLSpanElement {
  return pic('map', [key], () => placeholder(name.slice(0, 2), 'var(--dd-paper)', true), cls);
}

/** 인형 뽑기 상품 인형 (objects/plush_<종>). */
export function plushPic(species: SpeciesId, name: string, cls = ''): HTMLSpanElement {
  return pic('objects', [`plush_${species}`], () => placeholder(name.slice(0, 1), SPECIES_COLOR[species], true), cls);
}

/** 경주 선수 (racers/<key>, 옆모습). */
export function racerPic(key: string, name: string, color: string, cls = ''): HTMLSpanElement {
  return pic('racers', [key], () => placeholder(name.slice(0, 1), color, true), cls);
}
