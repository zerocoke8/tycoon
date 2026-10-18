// 사진첩 (다섯째 묶음, DESIGN 3.8): 종마다 사진관에서 처음 찍은 사진 (GameState.photoAlbum). 도감 탭의 '사진' 보기와 사진관 시트가 쓴다.
// 사진 한 장 = 크림색 테두리 사진 틀 (아래가 두꺼운 즉석 사진), 안은 사진관 배경판 앞에서 기뻐하는 손님. 아직 못 찍은 종은 그림자 (못 만난 종은 '?').

import { SPECIES, SPECIES_IDS, type SpeciesId } from '../../data/defs.ts';
import type { GameState } from '../../sim/types.ts';
import { btn, fmt, h } from '../dom.ts';
import { AREAS, DISTRICT_ORDER, speciesDistrict } from '../labels.ts';
import type { UiCtx } from '../panel.ts';
import { monsterPic, picUrl, placeholder } from '../pics.ts';
import { secHead } from '../widgets.ts';

/** 찍은 차례 (1부터, 먼저 찍은 종이 1). 안 찍었으면 0. */
export function photoOrder(st: GameState, sp: SpeciesId): number {
  const t = st.photoAlbum[sp];
  if (t === undefined) return 0;
  let n = 1;
  for (const o of SPECIES_IDS) {
    const u = st.photoAlbum[o];
    if (o !== sp && u !== undefined && (u < t || (u === t && SPECIES_IDS.indexOf(o) < SPECIES_IDS.indexOf(sp)))) n++;
  }
  return n;
}

/** 사진첩에 든 종 수. */
export function albumCount(st: GameState): number {
  return SPECIES_IDS.filter((sp) => st.photoAlbum[sp] !== undefined).length;
}

/** 최근 찍은 종 (새것부터, n장까지). */
export function latestPhotos(st: GameState, n: number): SpeciesId[] {
  return SPECIES_IDS.filter((sp) => st.photoAlbum[sp] !== undefined)
    .sort((a, b) => (st.photoAlbum[b] ?? 0) - (st.photoAlbum[a] ?? 0))
    .slice(0, n);
}

/**
 * 사진 한 장 (틀): taken = 찍음 (배경판 앞에서 기뻐하는 손님), 아니면 그림자 (met = 만난 종이면 몸 그림자, 아니면 '?').
 * tilt = 살짝 기울기 (사진첩에 붙인 느낌, 종마다 번갈아).
 */
export function photoFrame(sp: SpeciesId, taken: boolean, met: boolean, cls = '', tilt = 0): HTMLElement {
  const d = SPECIES[sp];
  const shot = h('span', 'shot');
  if (taken) {
    shot.style.backgroundImage = `url("${picUrl('map', 'photo_backdrop')}")`;
    shot.append(monsterPic(sp, 'joy', d.name, 'who'));
  } else if (met) shot.append(monsterPic(sp, 'base', d.name, 'who'));
  else shot.append(placeholder('?', 'var(--dd-paper-2)', true));
  const el = h('span', `mpv-photo${taken ? '' : ' none'}${cls ? ` ${cls}` : ''}`, shot);
  if (tilt !== 0) el.style.setProperty('--tilt', `${tilt}deg`);
  return el;
}

/** 종마다 기울기 (번갈아 -1.6 ~ 1.6도). */
const tiltOf = (i: number): number => [-1.6, 1.1, -0.6, 1.6, -1.1, 0.6][i % 6] ?? 0;

/** 도감 탭 '사진' 보기: 사진관 한 줄 ([사진관 보기]·[짓기 보기]) + 회관 레벨 묶음마다 사진 칸. */
export function buildAlbum(ctx: UiCtx, el: HTMLElement): void {
  const st = ctx.sim.state;
  const studio = st.shops.photo_studio;
  const n = albumCount(st);
  if (studio.level >= 1) {
    el.append(
      h(
        'div',
        'mpv-rule',
        h('span', 'mpv-grow', '사진관에서 처음 찍은 사진이 모여요. 사진첩에 없는 종은 사진관에 더 자주 들러요.'),
        btn('sub small', '사진관 보기', () => ctx.showShop('photo_studio')),
      ),
    );
  } else {
    const lock = ctx.sim.shopLockReason('photo_studio');
    el.append(
      h(
        'div',
        'mpv-rule',
        h('span', 'mpv-grow', lock !== null ? `사진관을 지으면 손님 사진이 모여요. ${lock}` : '사진관을 지으면 손님이 배경판 앞에서 찰칵! 종마다 첫 사진이 여기에 모여요.'),
        lock === null ? btn('sub small', '짓기 보기', () => ctx.openBuild('store', 'photo_studio')) : null,
      ),
    );
  }
  // 장수는 종 수보다 작을 수 없다 (개발용 사진첩 채우기·옛 저장은 shopTotals.photos 없이 사진첩만 가진다).
  el.append(secHead('사진첩', `${n} / ${SPECIES_IDS.length}종 · 찍은 사진 모두 ${fmt(Math.max(n, st.shopTotals.photos))}장`));
  let i = 0;
  for (const dist of DISTRICT_ORDER) {
    const list = SPECIES_IDS.filter((sp) => speciesDistrict(sp) === dist);
    if (list.length === 0) continue;
    const got = list.filter((sp) => st.photoAlbum[sp] !== undefined).length;
    el.append(h('div', 'mpv-note mpv-album-sub', `${AREAS[dist]?.name ?? ''} 손님 · ${got} / ${list.length}`));
    const grid = h('div', 'mpv-album');
    for (const sp of list) {
      const d = SPECIES[sp];
      const taken = st.photoAlbum[sp] !== undefined;
      const met = st.dex[sp] !== undefined;
      const order = photoOrder(st, sp);
      const cell = h('button', taken ? 'mpv-album-cell' : 'mpv-album-cell none', photoFrame(sp, taken, met, '', tiltOf(i++)), h('span', 'name', taken || met ? d.name : '???'), h('span', 'sub', taken ? `${order}번째 사진` : met ? '아직 못 찍었어요' : '아직 못 만났어요'));
      cell.type = 'button';
      cell.setAttribute('aria-label', taken ? `${d.name} 사진` : '아직 없는 사진');
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        ctx.toast(taken ? `${d.name}: 사진첩 ${order}번째 사진이에요` : met ? `${d.name}: 사진관에서 찍으면 여기에 들어와요` : '아직 마을에 온 적 없는 손님이에요');
      });
      grid.append(cell);
    }
    el.append(grid);
  }
}
