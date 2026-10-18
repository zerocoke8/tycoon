// 짓기 탭 = 마을 꾸미기 목록 (DESIGN 6.1 배치형 마을). 위 묶음 줄 (두 줄): 놀이부스 · 큰 시설 · 가게 · 놀이기구 / 건물 · 장식 · 길 · 땅.
//  - 가게·놀이기구 (다섯째 묶음, DESIGN 3.8): 가게는 먹거리·꾸미기·쉼·재미·기념·선물로 나눠, 놀이기구(회전목마·관람차)는 따로.
//    카드마다 차지하는 칸·파는 것·값·효과·가게 주인·잠긴 까닭·짓기 또는 업그레이드·자리 버튼, 그림을 누르면 가게 시트 (ui/panels/shop.ts).
//  - 놀이부스·큰 시설·가게·건물: 카드마다 차지하는 칸(5×5칸)·입구 앞 길·값·잠긴 까닭·보관함·레벨. 보관함에 있는 것이 맨 위, 잠긴 것은 맨 아래.
//    가지지 않았으면 [열고 놓기]·[짓고 놓기], 보관함이면 [지도에 놓기] = 지도 짓기 모드 (✓로 놓을 때 산다).
//    놓였으면 업그레이드 + [옮기기]·[보관하기] (입구 앞 길이 끊겼으면 알림 + [길 잇기]).
//  - 장식: 작은 칸 판 (값·보관함 수·둘레 기분), 누르면 놓기 (✓ 뒤에도 이어서 놓는다).
//  - 길: 길 깔기·지우기와 입구가 길에 닿지 않은 건물 목록 ([길 잇기]). 땅: 가진 땅·살 수 있는 땅·가장 싼 값과 [땅 넓히기].
// 묶음 줄 배지 = 그 묶음 보관함 수 (길은 끊긴 곳 수). 고른 묶음은 이 기기에 기억한다 (localStorage, 없어도 된다).
// 그리고 건물 하나만 보는 시트, 닫힌 부스 시트, 놓인 것 하나(장식) 시트, 다른 패널이 쓰는 자리 버튼 줄(placeRow).

import { catalogKind, catalogName, footprint, storable, type CatalogKey } from '../../data/catalog.ts';
import { BOOTH_IDS, BOOTHS, boothDef, BUILD_HALL, BUILDINGS, DECOR, isGroupBooth, SHOP_CATEGORIES, SHOP_IDS, SHOPS, type BoothId, type BuildingId, type DecorId, type ShopCategory, type ShopId } from '../../data/defs.ts';
import { SHOP_LAYOUT } from '../../data/catalog.ts';
import { isRide, shopIdleReason, shopOwner, shopPriceRange } from '../../sim/shops.ts';
import type { CatalogEntry, Cost, Result } from '../../sim/api.ts';
import { boothIdleReason } from '../../sim/booths.ts';
import { CELL, CHUNKS, GRID, cellCenter, type Pt } from '../../data/map.ts';
import { josa } from '../../sim/text.ts';
import { btn, fmt, h, revealInSheet } from '../dom.ts';
import { icon, type IconName } from '../icons.ts';
import { boothEffect, boothLockText, boothRolesText, boothRule, BUILDING_IDS, buildingEffect, buildingMaxLevel, hallUnlocks } from '../labels.ts';
import { BasePanel, type TabId, type UiCtx } from '../panel.ts';
import { mapPic, pic, placeholder } from '../pics.ts';
import { shopEffectText, shopStayText } from '../shopText.ts';
import { costChips, secHead, type Live } from '../widgets.ts';

/** 넷째 묶음 건물 (전당포·은행·일터, DESIGN 3.7): 처음엔 없고, 누르면 자기 시트 (ui/panels/debt.ts). */
export const DEBT_BUILDINGS: readonly BuildingId[] = Object.keys(BUILD_HALL) as BuildingId[];
export const isDebtBuilding = (id: BuildingId): boolean => DEBT_BUILDINGS.includes(id);

/** 건물 그림 key (map/<key>): 일터는 따로 그림이 없어 광산 입구로. */
export const buildingArt = (id: BuildingId): string => (id === 'workyard' ? 'mine_entrance' : id);

/** 놓을 수 있는 것의 그림 key (map/<key>). 가게는 대표 그림 (트럭 차고는 이정표: 트럭 그림은 racers/, catalogPic을 쓴다). */
export function catalogArt(key: CatalogKey): string {
  switch (catalogKind(key)) {
    case 'booth':
      return BOOTHS[key as BoothId].building;
    case 'building':
      return buildingArt(key as BuildingId);
    case 'shop': {
      const p = SHOP_LAYOUT[key as ShopId].parts[0];
      return p !== undefined && p.group === 'map' ? p.key : 'signpost';
    }
    default:
      return key;
  }
}

/** 놓을 수 있는 것의 작은 그림 (가게는 그 그림 묶음 그대로: 트럭 = racers/icecream_truck). */
export function catalogPic(key: CatalogKey, name: string, cls = ''): HTMLSpanElement {
  if (key === 'icecream_truck') return pic('racers', ['icecream_truck'], () => placeholder(name.slice(0, 2), 'var(--dd-paper)', true), cls);
  return mapPic(catalogArt(key), name, cls);
}

// ── 묶음 ──

/** 묶음: store = 다섯째 묶음 가게 (먹거리·꾸미기 …), ride = 놀이기구 (회전목마·관람차), shop = 마을 건물 (회관·공방·전당포 …: 옛 '가게·건물'). */
export type BuildCat = 'booth' | 'big' | 'store' | 'ride' | 'shop' | 'decor' | 'road' | 'land';
const CATS: readonly { readonly id: BuildCat; readonly name: string; readonly icon: IconName }[] = [
  { id: 'booth', name: '놀이부스', icon: 'booth' },
  { id: 'big', name: '큰 시설', icon: 'facility' },
  { id: 'store', name: '가게', icon: 'shop' },
  { id: 'ride', name: '놀이기구', icon: 'ride' },
  { id: 'shop', name: '건물', icon: 'village' },
  { id: 'decor', name: '장식', icon: 'decor' },
  { id: 'road', name: '길', icon: 'road' },
  { id: 'land', name: '땅', icon: 'land' },
];
const CAT_KEY = 'mpv-build-cat';

export function isBuildCat(v: string | null | undefined): v is BuildCat {
  return CATS.some((c) => c.id === v);
}

/** 이 열쇠가 든 묶음: 단체 놀이 부스·일터 = 큰 시설, 그 밖 부스 = 놀이부스, 가게 (다섯째 묶음) = 가게 (회전목마·관람차 = 놀이기구), 장식, 나머지 건물 = 건물. */
export function catOf(key: CatalogKey): BuildCat {
  switch (catalogKind(key)) {
    case 'booth':
      return isGroupBooth(key as BoothId) ? 'big' : 'booth';
    case 'shop':
      return isRide(key as ShopId) ? 'ride' : 'store';
    case 'decor':
      return 'decor';
    default:
      return key === 'workyard' ? 'big' : 'shop';
  }
}

/** 효과 줄: [지금] … / [다음] … */
export function effLine(tag: string, text: string, next = false): HTMLElement {
  return h('div', 'mpv-eff', h('span', next ? 'mpv-tag next' : 'mpv-tag', tag), h('span', null, text));
}

/** 비용 칩 + 버튼 (살 수 없으면 흐리게, 그래도 누르면 이유가 토스트로). locked = 비용과 상관없이 아직 못 하는 까닭이 있다. */
export function costAction(ctx: UiCtx, live: Live, cost: Cost | null, label: string, run: () => Result, maxText = '최고 레벨이에요', locked = false, cls = 'small'): HTMLElement {
  if (cost === null) return h('div', 'mpv-act', h('span', 'mpv-max', maxText));
  const b = btn(cls, label, () => ctx.act(run()));
  live.add(() => b.classList.toggle('dim', locked || !ctx.sim.canAfford(cost)));
  return h('div', 'mpv-act', costChips(ctx.sim, cost, live), b);
}

/**
 * 사서 놓기 (부스 열기·건물 짓기·장식): 못 사면 (회관 레벨·코인) 이유를 토스트로, 살 수 있으면 지도 짓기 모드로 (✓로 놓을 때 산다).
 * 보관함에 있으면 그대로 놓기.
 */
export function startPlace(ctx: UiCtx, key: CatalogKey): Result {
  const sim = ctx.sim;
  if (catalogKind(key) !== 'decor' && sim.village().placed(key) !== undefined) return { ok: false, reason: '이미 지도에 있어요. 옮기기로 자리를 바꿔요.' };
  if (sim.stored(key) <= 0) {
    const lock = sim.buyLockReason(key);
    if (lock !== null) return { ok: false, reason: lock };
    const cost = sim.buyCost(key);
    const short = cost === null ? null : sim.missingReason(cost);
    if (short !== null) return { ok: false, reason: short };
  }
  ctx.startBuild({ kind: 'place', key });
  return { ok: true };
}

/** 길 깔기 모드의 카메라: 입구(entry)와 가장 가까운 마을 입구와 이어진 길 칸이 같이 보이게 (어디로 칠할지 보이게). */
export function focusJoin(ctx: UiCtx, entry: Pt): void {
  const v = ctx.sim.village();
  const i = v.nearestWalkable(entry);
  let x0 = entry.x;
  let x1 = entry.x;
  let y0 = entry.y;
  let y1 = entry.y;
  if (i >= 0) {
    const c = cellCenter(i % GRID.w, Math.floor(i / GRID.w));
    x0 = Math.min(x0, c.x);
    x1 = Math.max(x1, c.x);
    y0 = Math.min(y0, c.y);
    y1 = Math.max(y1, c.y);
  }
  const pad = CELL * 1.6;
  const ins = ctx.insets();
  // 보이는 띠: 위 HUD·아래 탭과 짓기 띠 (약 120px) 사이.
  const bandH = Math.max(160, window.innerHeight - ins.top - ins.bottom - 190);
  const z = Math.min(0.55, Math.max(0.24, Math.min(window.innerWidth / (x1 - x0 + 2 * pad), bandH / (y1 - y0 + 2 * pad))));
  ctx.hooks.world.focusOn({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, z);
}

/** 입구 앞 길 잇기: 길 깔기 모드로 그 입구와 이을 길을 보여 준다. */
export function joinRoad(ctx: UiCtx, key: CatalogKey): void {
  const e = ctx.sim.village().entryPt(key);
  ctx.startBuild({ kind: 'road' });
  if (e !== null) focusJoin(ctx, e);
}

/** 보관하기 (묻고 나서). */
export function askStore(ctx: UiCtx, id: number, key: CatalogKey, after?: () => void): void {
  // 손님이 들르는 곳만 '안에 있던 손님은…'.
  const guests = footprint(key).entry !== undefined ? ' 안에 있던 손님은 다른 곳으로 가요.' : '';
  ctx.menu.confirm(`${josa(catalogName(key), '을', '를')} 보관함에 넣을까요?${guests}`, '보관하기', () => {
    after?.();
    ctx.act(ctx.sim.store(id));
  });
}

/**
 * 놓인 건물의 입구가 왜 마을 입구와 이어지지 않았나: 'none' = 입구 앞 칸에 길이 없다, 'cut' = 길은 있는데 마을 입구까지 끊겼다.
 * 이어졌거나 입구가 없거나 놓이지 않았으면 null.
 */
export function roadIssue(ctx: UiCtx, key: CatalogKey): 'none' | 'cut' | null {
  const v = ctx.sim.village();
  const p = v.placed(key);
  if (p === undefined || footprint(key).entry === undefined || v.connected(key)) return null;
  const e = v.entryCellIndex(p);
  return e >= 0 && v.road[e] === 1 ? 'cut' : 'none';
}

/** 길 문제 한 줄 ('입구가 길에 닿지 않아 …' / '입구 앞 길이 마을 입구와 끊겨 …'). */
export function roadIssueText(issue: 'none' | 'cut'): string {
  return issue === 'cut' ? '입구 앞 길이 마을 입구와 끊겨 손님이 못 와요' : '입구가 길에 닿지 않아 손님이 못 와요';
}

/**
 * 놓인 것·보관함에 있는 것의 자리 버튼: 놓였으면 [옮기기]·[보관하기] (길이 끊겼으면 알림 + [길 잇기]), 보관함이면 [지도에 놓기].
 * note = 까닭 한 줄도 (부르는 쪽이 맨 위에 따로 알리면 false).
 */
export function placeRow(ctx: UiCtx, key: CatalogKey, note = true): HTMLElement | null {
  const sim = ctx.sim;
  const v = sim.village();
  const p = v.placed(key);
  if (p === undefined) {
    if (sim.stored(key) <= 0) return null;
    const guests = footprint(key).entry !== undefined;
    return h(
      'div',
      'mpv-place',
      note ? h('div', 'mpv-store-note', guests ? '보관함에 있어요. 지도에 놓으면 손님이 와요' : '보관함에 있어요. 지도에 놓아 주세요') : null,
      h('div', 'mpv-act', btn('green small', [icon('pin'), '지도에 놓기'], () => ctx.act(startPlace(ctx, key)))),
    );
  }
  const fixed = footprint(key).fixed === true;
  const keep = !storable(key);
  const issue = roadIssue(ctx, key);
  if (fixed && issue === null) return null;
  return h(
    'div',
    'mpv-place',
    issue !== null && note ? h('div', 'mpv-warn', roadIssueText(issue)) : null,
    h(
      'div',
      'mpv-act wrap',
      issue !== null ? btn('butter small', [icon('road'), '길 잇기'], () => joinRoad(ctx, key)) : null,
      fixed ? null : btn('sub small', [icon('move'), '옮기기'], () => ctx.startBuild({ kind: 'move', id: p.id })),
      fixed || keep ? null : btn('sub small', [icon('box'), '보관하기'], () => askStore(ctx, p.id, key)),
    ),
  );
}

/** 단체 놀이 꼬리표: 손님 여럿이 한 판을 같이 하고, 지도에서도 판이 보인다. */
function groupTag(): HTMLElement {
  return h('span', 'mpv-tag group', '여럿이 한판');
}

/** 열린 부스가 쉬는 까닭: 보관함 / 길 / '진행자가 없어 …' / 경주장은 비어 있는 꼭 필요한 자리 ('출발 신호·해설자 자리가 비어 …'). */
function idleText(ctx: UiCtx, b: BoothId): string {
  const why = boothIdleReason(ctx.sim.state, b);
  if (why === 'stored') return '보관함에 있어요. 지도에 놓으면 손님이 와요';
  if (why === 'road') return roadIssueText(roadIssue(ctx, b) ?? 'none');
  const bs = ctx.sim.state.booths[b];
  const roles = boothDef(b).roles;
  const miss = roles.filter((r, i) => r.optional !== true && (bs.staff[i] ?? null) === null).map((r) => r.name);
  return roles.length > 1 && miss.length > 0 ? `${miss.join('·')} 자리가 비어 쉬는 중이에요` : '진행자가 없어 쉬는 중이에요';
}

/** 차지하는 칸·입구 꼬리표: [5×5칸] [입구에 길 필요]. */
export function fpTags(key: CatalogKey): HTMLElement {
  const fp = footprint(key);
  return h('span', 'mpv-fp', h('span', 'mpv-tag', `${fp.w}×${fp.h}칸`), fp.entry !== undefined ? h('span', 'mpv-tag', '입구에 길 필요') : null);
}

/** 입구가 마을 입구까지 길로 이어지지 않은 건물 (손님이 들르는 곳만, 마을 입구 빼고). */
function cutPlaced(ctx: UiCtx): CatalogKey[] {
  const v = ctx.sim.village();
  return v.state.placed.filter((p) => catalogKind(p.key) !== 'decor' && p.key !== 'gate' && footprint(p.key).entry !== undefined && !v.linkedId(p.id)).map((p) => p.key);
}

export class BuildPanel extends BasePanel {
  /** 고른 묶음. */
  cat: BuildCat = 'booth';
  /** 다음 그리기 뒤 굴려 보여 주고 반짝일 카드 (목표 칩 '간식 노점을 지어 보세요' 등). */
  focus: CatalogKey | null = null;

  constructor(ctx: UiCtx) {
    super(ctx, 'mpv-build');
    try {
      const v = localStorage.getItem(CAT_KEY);
      if (isBuildCat(v)) this.cat = v;
    } catch {
      // 기억 못 해도 괜찮다.
    }
  }

  /** 묶음을 고른다 (기억하고 다시 그린다). */
  pick(cat: BuildCat): void {
    this.cat = cat;
    try {
      localStorage.setItem(CAT_KEY, cat);
    } catch {
      // 기억 못 해도 괜찮다.
    }
    this.refresh(true);
    const body = this.el.closest('.mpv-sheet-body');
    if (body instanceof HTMLElement) body.scrollTop = 0;
  }

  sig(): string {
    const s = this.st;
    const v = this.sim.village();
    return [
      this.cat,
      this.sim.hallLevel(),
      v.stamp.place,
      v.stamp.road,
      v.stamp.land,
      JSON.stringify(s.village.decor),
      ...BUILDING_IDS.map((id) => s.buildings[id].level),
      ...BOOTH_IDS.map((b) => `${s.booths[b].unlocked ? 1 : 0}${s.booths[b].level}${s.booths[b].staff.map((x) => (x === null ? 0 : 1)).join('')}`),
      ...SHOP_IDS.map((k) => `${s.shops[k].level}${s.shops[k].owner === null ? 0 : 1}`),
    ].join(',');
  }

  protected build(): void {
    const entries = this.sim.catalog();
    this.el.append(this.catBar(entries));
    const focus = this.focus;
    this.focus = null;
    if (focus !== null) {
      requestAnimationFrame(() => {
        const card = this.el.querySelector(`[data-key="${focus}"]`);
        if (!(card instanceof HTMLElement)) return;
        // 묶음 줄이 위에 붙어 있으니 그 아래로.
        const bar = this.el.querySelector('.mpv-cats');
        revealInSheet(card, (bar instanceof HTMLElement ? bar.offsetHeight : 0) + 4, true, false);
        card.classList.remove('flash');
        void card.offsetWidth;
        card.classList.add('flash');
      });
    }
    switch (this.cat) {
      case 'road':
        this.buildRoad();
        break;
      case 'land':
        this.buildLand();
        break;
      case 'decor':
        this.buildDecor(entries);
        break;
      default:
        this.buildList(entries);
    }
  }

  /** 묶음 줄 (여섯 칸, 배지 = 보관함 수 / 길이 끊긴 곳). */
  private catBar(entries: readonly CatalogEntry[]): HTMLElement {
    const bar = h('div', 'mpv-cats');
    bar.setAttribute('role', 'tablist');
    const cut = cutPlaced(this.ctx).length;
    for (const c of CATS) {
      const n = c.id === 'road' ? cut : entries.filter((e) => catOf(e.key) === c.id).reduce((a, e) => a + e.stored, 0);
      const b = h('button', c.id === this.cat ? 'mpv-cat on' : 'mpv-cat', icon(c.icon), h('span', 'nm', c.name), n > 0 ? h('span', c.id === 'road' ? 'mpv-cat-badge warn' : 'mpv-cat-badge', String(n)) : null);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(c.id === this.cat));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (c.id !== this.cat) this.pick(c.id);
      });
      bar.append(b);
    }
    return bar;
  }

  /** 놀이부스·큰 시설·가게·건물: 보관함 → 놓인 것·살 수 있는 것 → 잠긴 것. */
  private buildList(entries: readonly CatalogEntry[]): void {
    const list = entries.filter((e) => catOf(e.key) === this.cat);
    const rank = (e: CatalogEntry): number => (e.stored > 0 ? 0 : e.owned > 0 || e.lock === null ? 1 : 2);
    const sorted = list.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i);
    const owned = list.filter((e) => e.owned > 0).length;
    if (this.cat === 'store') {
      this.buildStores(list);
      return;
    }
    if (this.cat === 'ride') {
      this.el.append(secHead('놀이기구', `${owned} / ${list.length} · 이긴 손님이 신나게 타요`), h('div', 'mpv-hint', '손님 여럿이 같이 타고 한 바퀴를 돌아요. 첫 손님이 타면 곧 출발해요.'));
      for (const { e } of sorted) this.el.append(this.shopCard(e));
      return;
    }
    const title = this.cat === 'booth' ? '놀이부스' : this.cat === 'big' ? '큰 시설' : '건물';
    this.el.append(secHead(title, this.cat === 'shop' ? '[짓고 놓기]로 지도에 자리를 골라요' : this.cat === 'big' ? `${owned} / ${list.length}` : `${owned} / ${list.length} 열림`));
    if (this.cat === 'big') this.el.append(h('div', 'mpv-hint', '손님 여럿이 같이 노는 큰 마당이에요. 땅을 넉넉히 넓혀 두면 놓기 쉬워요.'));
    for (const { e } of sorted) this.el.append(catalogKind(e.key) === 'booth' ? this.boothCard(e.key as BoothId) : e.key in BUILDINGS ? this.buildingCard(e.key as BuildingId) : this.genericCard(e));
  }

  /** 가게 (다섯째 묶음): 묶음(먹거리·꾸미기·쉼·재미·기념·선물)마다 카드. 보관함 → 가진 것·지을 수 있는 것 → 잠긴 것. */
  private buildStores(list: readonly CatalogEntry[]): void {
    const owned = list.filter((e) => e.owned > 0).length;
    this.el.append(secHead('가게', `${owned} / ${list.length} · 손님이 놀이 말고도 코인을 써요`));
    const rank = (e: CatalogEntry): number => (e.stored > 0 ? 0 : e.owned > 0 || e.lock === null ? 1 : 2);
    for (const cat of Object.keys(SHOP_CATEGORIES) as ShopCategory[]) {
      const rows = list.filter((e) => SHOPS[e.key as ShopId].category === cat);
      if (rows.length === 0) continue;
      this.el.append(h('div', 'mpv-note', SHOP_CATEGORIES[cat].name));
      for (const e of rows.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i)) this.el.append(this.shopCard(e.x));
    }
  }

  /**
   * 가게·놀이기구 카드: 이름·칸·하는 일, 값·효과 (놀이기구는 한 바퀴 초·자리), 가게 주인, 잠긴 까닭과 짓기 (주인이 같이 와요) 또는 업그레이드·자리 버튼.
   * 그림을 누르면 가게 시트 (지은 뒤: 이번 매상·지금 손님·메뉴).
   */
  private shopCard(e: CatalogEntry): HTMLElement {
    const s = e.key as ShopId;
    const d = SHOPS[s];
    const lv = this.st.shops[s].level;
    const owned = lv >= 1;
    const stored = e.stored > 0;
    const badge = !owned ? h('span', 'mpv-lv off', '아직 없어요') : stored ? h('span', 'mpv-lv store', '보관함') : h('span', 'mpv-lv', `Lv.${lv}/${d.upgrade.length + 1}`);
    const body = h('div', 'mpv-grow', h('div', 'mpv-title', d.name, badge), h('div', 'mpv-desc', d.desc), fpTags(s));
    const [lo, hi] = shopPriceRange(this.st, s);
    if (hi > 0) body.append(effLine('값', lo === hi ? `${lo}코인` : `${lo}~${hi}코인`));
    body.append(effLine('효과', shopEffectText(s)));
    if (isRide(s)) {
      const stay = shopStayText(s);
      if (stay !== null) body.append(effLine('타기', `${stay} · 자리 ${d.slots.join('→')}`));
    }
    const owner = shopOwner(this.st, s);
    body.append(effLine('주인', owned ? (owner !== null ? owner.name : '비어 있어요 (진행자를 세우면 열어요)') : `${d.owner.name} (지으면 같이 와요)`));
    if (!owned) {
      if (e.lock !== null) body.append(h('div', 'mpv-lock', e.lock));
      body.append(costAction(this.ctx, this.live, e.cost, '짓고 놓기', () => startPlace(this.ctx, s), '지을 수 없어요', e.lock !== null, 'green small'));
    } else {
      const row = placeRow(this.ctx, s);
      if (stored && row !== null) body.append(row);
      if (!stored && shopIdleReason(this.st, s) === 'owner') body.append(h('div', 'mpv-warn', '가게 주인이 없어 쉬는 중이에요'));
      body.append(costAction(this.ctx, this.live, this.sim.shopUpgradeCost(s), '업그레이드', () => this.sim.upgradeShop(s)));
      if (!stored && row !== null) body.append(row);
    }
    const thumb = h('button', 'mpv-thumb', catalogPic(s, d.name));
    thumb.type = 'button';
    thumb.setAttribute('aria-label', `${d.name} 보기`);
    thumb.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.ctx.showShop(s);
    });
    const card = h('div', !owned ? (e.lock !== null ? 'mpv-card dim locked' : 'mpv-card dim') : stored ? 'mpv-card stored' : 'mpv-card', thumb, body);
    card.dataset.key = s;
    return card;
  }

  /** 레벨이 없는 놓을 것 (새로 더해진 가게 등): 이름·칸·값·잠긴 까닭과 자리 버튼만. */
  private genericCard(e: CatalogEntry): HTMLElement {
    const key = e.key;
    const name = catalogName(key);
    const owned = e.owned > 0;
    const stored = e.stored > 0;
    const badge = !owned ? h('span', 'mpv-lv off', '아직 없어요') : stored ? h('span', 'mpv-lv store', '보관함') : null;
    const body = h('div', 'mpv-grow', h('div', 'mpv-title', name, badge), fpTags(key));
    if (!owned) {
      if (e.lock !== null) body.append(h('div', 'mpv-lock', e.lock));
      body.append(costAction(this.ctx, this.live, e.cost, '짓고 놓기', () => startPlace(this.ctx, key), '지을 수 없어요', e.lock !== null, 'green small'));
    } else {
      const row = placeRow(this.ctx, key);
      if (row !== null) body.append(row);
    }
    return h('div', !owned ? (e.lock !== null ? 'mpv-card dim locked' : 'mpv-card dim') : stored ? 'mpv-card stored' : 'mpv-card', h('span', 'mpv-thumb', catalogPic(key, name)), body);
  }

  /** 장식: 작은 칸 판. */
  private buildDecor(entries: readonly CatalogEntry[]): void {
    this.el.append(secHead('장식', '둘레를 지나는 손님 기분이 올라요'));
    const grid = h('div', 'mpv-decor');
    for (const e of entries) {
      if (catOf(e.key) !== 'decor') continue;
      const k = e.key as DecorId;
      const d = DECOR[k];
      const tile = h(
        'button',
        'mpv-decor-tile',
        h('span', 'mpv-thumb', mapPic(k, d.name)),
        h('span', 'nm', d.name),
        h('span', 'sub', `기분 +${d.aura}`, e.placed > 0 ? h('span', 'n', ` · 놓임 ${e.placed}`) : null),
        e.stored > 0 ? h('span', 'mpv-cost', h('span', 'mpv-chip stored', `보관함 ${e.stored}`)) : costChips(this.sim, { coins: d.cost }, this.live),
      );
      tile.type = 'button';
      tile.setAttribute('aria-label', `${d.name} 놓기`);
      tile.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.ctx.act(startPlace(this.ctx, k));
      });
      if (e.stored <= 0) this.live.add(() => tile.classList.toggle('short', this.st.coins < d.cost));
      grid.append(tile);
    }
    this.el.append(grid);
  }

  /** 길: 깔기·지우기, 입구가 길에 닿지 않은 곳. */
  private buildRoad(): void {
    const cut = cutPlaced(this.ctx);
    this.el.append(
      secHead('길', '길은 공짜예요'),
      h(
        'div',
        'mpv-card col mpv-tool-card',
        h('div', 'mpv-desc', '손님은 길 위로만 걸어요. 건물 입구 앞 칸이 마을 입구까지 길로 이어져야 손님이 와요. 지도에서 주황 빗금은 마을 입구와 끊긴 길이에요.'),
        h(
          'div',
          'mpv-act',
          btn('sky grow', [icon('road'), '길 깔기'], () => this.ctx.startBuild({ kind: 'road' })),
          btn('sub grow', [icon('eraser'), '길 지우기'], () => this.ctx.startBuild({ kind: 'erase' })),
        ),
      ),
      secHead('마을 입구까지 길이 이어지지 않은 곳', cut.length > 0 ? `${cut.length}곳` : undefined),
    );
    if (cut.length === 0) {
      this.el.append(h('div', 'mpv-empty ok', '모든 건물이 길로 이어져 있어요'));
      return;
    }
    for (const key of cut) {
      this.el.append(
        h(
          'div',
          'mpv-card mpv-cut',
          h('span', 'mpv-thumb sm', catalogPic(key, catalogName(key))),
          h('div', 'mpv-grow', h('div', 'mpv-title sm', catalogName(key)), h('div', 'mpv-warn', roadIssue(this.ctx, key) === 'cut' ? '길이 마을 입구와 끊겼어요' : '입구 앞에 길이 없어요')),
          btn('butter small', [icon('road'), '길 잇기'], () => joinRoad(this.ctx, key)),
        ),
      );
    }
  }

  /** 땅: 가진 땅, 살 수 있는 땅, 가장 싼 값. */
  private buildLand(): void {
    const sim = this.sim;
    const n = this.st.village.chunks.length;
    let open = 0;
    let cheapest = Infinity;
    let lockHall = Infinity;
    for (let i = 0; i < CHUNKS.w * CHUNKS.h; i++) {
      const info = sim.chunk(i);
      if (info.owned || !info.adjacent) continue;
      if (sim.chunkLockReason(i) === null) {
        open++;
        cheapest = Math.min(cheapest, info.price);
      } else lockHall = Math.min(lockHall, info.hall);
    }
    const lines: HTMLElement[] = [h('div', 'mpv-title sm', `가진 땅 ${n}조각`)];
    lines.push(h('div', 'mpv-desc', open > 0 ? `지금 살 수 있는 땅 ${open}곳 · 가장 싼 땅 ${fmt(cheapest)}코인` : '지금 살 수 있는 땅이 없어요'));
    if (Number.isFinite(lockHall)) lines.push(h('div', 'mpv-lock', `마을회관 Lv.${lockHall}부터 더 먼 땅도 살 수 있어요`));
    this.el.append(
      secHead('땅', '땅을 넓혀 건물을 더 놓아요'),
      h('div', 'mpv-card col mpv-tool-card', h('div', 'mpv-desc', '가진 땅에 붙은 구름 땅을 사면 구름이 걷혀요. 살수록 값이 조금씩 올라요.'), ...lines, h('div', 'mpv-act', btn('butter grow', [icon('land'), '땅 넓히기'], () => this.ctx.startBuild({ kind: 'land' })))),
    );
  }

  private buildingCard(id: BuildingId): HTMLElement {
    const d = BUILDINGS[id];
    const lv = this.st.buildings[id].level;
    const max = buildingMaxLevel(id);
    const thumb = h('button', 'mpv-thumb', mapPic(buildingArt(id), d.name));
    thumb.type = 'button';
    const inside = isDebtBuilding(id);
    thumb.setAttribute('aria-label', inside ? `${d.name} 보기` : `${d.name} 지도에서 보기`);
    thumb.addEventListener('click', (e) => {
      e.stopPropagation();
      if (inside) {
        this.ctx.showBuilding(id);
        return;
      }
      const v = this.sim.village();
      if (v.placed(id) === undefined) return;
      this.ctx.closeAll();
      this.ctx.hooks.world.focusOn(v.art(id));
    });
    // 넷째 묶음 건물은 처음엔 없다 (레벨 0): '짓고 놓기' = 지도에 놓을 때 짓는다, 마을회관 레벨이 모자라면 잠긴 까닭.
    const unbuilt = lv < 1;
    const stored = !unbuilt && this.sim.stored(id) > 0;
    const lock = this.sim.buildingLockReason(id);
    const next = lv < max ? buildingEffect(id, lv + 1) : null;
    const extra = id === 'hall' && lv < max ? hallUnlocks(lv + 1) : [];
    const badge = unbuilt ? h('span', 'mpv-lv off', '아직 없어요') : stored ? h('span', 'mpv-lv store', '보관함') : h('span', 'mpv-lv', `Lv.${lv}/${max}`);
    const body = h('div', 'mpv-grow', h('div', 'mpv-title', d.name, badge), h('div', 'mpv-desc', d.desc), fpTags(id));
    if (unbuilt) {
      if (lock !== null) body.append(h('div', 'mpv-lock', lock));
      if (next) body.append(effLine('지으면', next, true));
      body.append(costAction(this.ctx, this.live, this.sim.buildingUpgradeCost(id), '짓고 놓기', () => startPlace(this.ctx, id), '최고 레벨이에요', lock !== null, 'green small'));
    } else {
      // 보관함이면 놓기가 먼저, 놓였으면 업그레이드 다음에 옮기기·보관하기.
      const row = placeRow(this.ctx, id);
      if (stored && row !== null) body.append(row);
      if (next) body.append(effLine('다음', next, true));
      for (const t of extra) body.append(effLine('열림', t, true));
      body.append(costAction(this.ctx, this.live, this.sim.buildingUpgradeCost(id), '업그레이드', () => this.sim.upgradeBuilding(id), '최고 레벨이에요', lock !== null));
      if (!stored && row !== null) body.append(row);
    }
    const card = h('div', unbuilt ? (lock !== null ? 'mpv-card dim locked' : 'mpv-card dim') : stored ? 'mpv-card stored' : 'mpv-card', thumb, body);
    card.dataset.key = id;
    return card;
  }

  private boothCard(b: BoothId): HTMLElement {
    const d = BOOTHS[b];
    const bs = this.st.booths[b];
    const max = d.fee.length;
    const thumb = h('button', 'mpv-thumb', mapPic(d.building, d.name));
    thumb.type = 'button';
    thumb.setAttribute('aria-label', `${d.name} 보기`);
    thumb.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ctx.showBooth(b);
    });
    const group = isGroupBooth(b);
    const stored = bs.unlocked && this.sim.stored(b) > 0;
    const badge = !bs.unlocked ? h('span', 'mpv-lv off', '닫힘') : stored ? h('span', 'mpv-lv store', '보관함') : h('span', 'mpv-lv', `Lv.${bs.level}/${max}`);
    const body = h('div', 'mpv-grow', h('div', 'mpv-title', d.name, badge, group ? groupTag() : null), h('div', 'mpv-desc', d.desc), fpTags(b));
    const roles = boothRolesText(b);
    const rule = boothRule(b);
    let lock: string | null = null;
    if (!bs.unlocked) {
      lock = boothLockText(b, this.sim.hallLevel());
      if (lock !== null) body.append(h('div', 'mpv-lock', lock));
      const first = boothEffect(b, 1);
      if (first) body.append(effLine('열면', first, true));
      // 단체 놀이는 진행자 자리와 놀이 규칙을 같이 (어떤 판인지 열기 전에 알게).
      if (roles !== null) body.append(effLine('진행자', roles));
      if (rule !== null && (roles === null || group)) body.append(effLine(group ? '놀이' : '규칙', rule));
      body.append(costAction(this.ctx, this.live, this.sim.boothUnlockCost(b), '열고 놓기', () => startPlace(this.ctx, b), '열 수 없어요', lock !== null, 'green small'));
    } else {
      const row = placeRow(this.ctx, b);
      if (stored && row !== null) body.append(row);
      const next = bs.level < max ? boothEffect(b, bs.level + 1) : null;
      if (next) body.append(effLine('다음', next, true));
      // 길이 끊긴 것은 자리 줄(placeRow)이 [길 잇기]와 같이 알린다.
      const why = boothIdleReason(this.st, b);
      if (!stored && why !== null && why !== 'road' && why !== 'stored') body.append(h('div', 'mpv-warn', idleText(this.ctx, b)));
      body.append(costAction(this.ctx, this.live, this.sim.boothUpgradeCost(b), '업그레이드', () => this.sim.upgradeBooth(b)));
      if (!stored && row !== null) body.append(row);
    }
    const card = h('div', bs.unlocked ? (stored ? 'mpv-card stored' : 'mpv-card') : lock !== null ? 'mpv-card dim locked' : 'mpv-card dim', thumb, body);
    card.dataset.key = b;
    return card;
  }
}

/** 건물 하나 (지도에서 건물을 눌렀을 때). */
export class BuildingPanel extends BasePanel {
  id: BuildingId = 'hall';

  override head(): readonly [string, string] {
    const lv = this.st.buildings[this.id].level;
    return [BUILDINGS[this.id].name, lv < 1 ? '아직 없어요' : `Lv.${lv}`];
  }

  sig(): string {
    const v = this.sim.village();
    return `${this.id}|${this.st.buildings[this.id].level}|${v.stamp.place}|${v.stamp.road}`;
  }

  protected build(): void {
    const id = this.id;
    const d = BUILDINGS[id];
    const lv = this.st.buildings[id].level;
    const max = buildingMaxLevel(id);
    const now = buildingEffect(id, lv);
    this.el.append(h('div', 'mpv-card', h('span', 'mpv-thumb lg', mapPic(buildingArt(id), d.name)), h('div', 'mpv-grow', h('div', 'mpv-desc', d.desc), now ? effLine('지금', now) : null, h('div', 'mpv-note', `레벨 ${lv} / ${max}`))));

    if (lv < max) {
      const next = buildingEffect(id, lv + 1);
      const extra = id === 'hall' ? hallUnlocks(lv + 1) : [];
      const lock = this.sim.buildingLockReason(id);
      this.el.append(
        secHead(lv < 1 ? '짓기' : `다음 레벨 (Lv.${lv + 1})`),
        h(
          'div',
          'mpv-card col',
          lock !== null ? h('div', 'mpv-lock', lock) : null,
          next ? effLine(lv < 1 ? '지으면' : '다음', next, true) : null,
          ...extra.map((t) => effLine('열림', t, true)),
          lv < 1
            ? costAction(this.ctx, this.live, this.sim.buildingUpgradeCost(id), '짓고 놓기', () => startPlace(this.ctx, id), '최고 레벨이에요', lock !== null)
            : costAction(this.ctx, this.live, this.sim.buildingUpgradeCost(id), '업그레이드', () => this.sim.upgradeBuilding(id), '최고 레벨이에요', lock !== null),
        ),
      );
    } else {
      this.el.append(h('div', 'mpv-empty', '최고 레벨이에요'));
    }

    const go: [string, TabId | 'bag'] | null = id === 'workshop' ? ['공방 열기', 'workshop'] : id === 'office' ? ['주민 보기', 'staff'] : id === 'warehouse' ? ['가방 보기', 'bag'] : id === 'hall' ? ['짓기 보기', 'build'] : null;
    const row = h('div', 'mpv-act');
    if (go !== null) {
      const [label, tab] = go;
      // 짓기 보기는 가게·건물 묶음으로 (마지막에 본 묶음이 장식·길·땅이어도).
      row.append(btn('sky wide', label, () => (tab === 'bag' ? this.ctx.openBag() : tab === 'build' ? this.ctx.openBuild('shop') : this.ctx.openTab(tab))));
    }
    const v = this.sim.village();
    if (v.placed(id) !== undefined) {
      row.append(
        btn('sub wide', [icon('pin'), '지도에서 보기'], () => {
          this.ctx.closeAll();
          this.ctx.hooks.world.focusOn(v.art(id));
        }),
      );
    }
    this.el.append(row);
    if (lv >= 1) {
      const place = placeRow(this.ctx, id);
      if (place !== null) this.el.append(secHead('자리'), place);
    }
  }
}

/** 아직 닫힌 놀이부스 (열면 지도에 놓는다). */
export class LockedBoothPanel extends BasePanel {
  booth: BoothId = 'cups';

  override head(): readonly [string, string] {
    return [BOOTHS[this.booth].name, '닫힘'];
  }

  sig(): string {
    return `${this.booth}|${this.st.booths[this.booth].unlocked}|${this.sim.hallLevel()}`;
  }

  protected build(): void {
    const b = this.booth;
    const d = BOOTHS[b];
    const first = boothEffect(b, 1);
    const lock = boothLockText(b, this.sim.hallLevel());
    const roles = boothRolesText(b);
    const rule = boothRule(b);
    const fp = footprint(b);
    this.el.append(
      h(
        'div',
        'mpv-card',
        h('span', 'mpv-thumb lg', mapPic(d.building, d.name)),
        h(
          'div',
          'mpv-grow',
          h('div', 'mpv-title sm', d.desc, isGroupBooth(b) ? groupTag() : null),
          lock !== null ? h('div', 'mpv-lock', lock) : h('div', 'mpv-desc', `아직 닫혀 있어요. 열어서 지도에 놓고 입구 앞을 길로 이으면, ${roles !== null ? '진행자 자리를 채웠을 때' : '진행자를 세웠을 때'} 손님이 찾아와요. (${fp.w}×${fp.h}칸)`),
          first ? effLine('열면', first, true) : null,
          roles !== null ? effLine('진행자', roles) : null,
          rule !== null ? effLine(isGroupBooth(b) ? '놀이' : '규칙', rule) : null,
        ),
      ),
      secHead('열기'),
      h('div', 'mpv-card col', costAction(this.ctx, this.live, this.sim.boothUnlockCost(b), '열고 놓기', () => startPlace(this.ctx, b), '열 수 없어요', lock !== null)),
    );
  }
}

/** 놓인 것 하나 (지도에서 장식을 눌렀을 때): 옮기기·보관하기. 가게는 ui.ts가 가게 시트 (ui/panels/shop.ts)로 연다. */
export class PlacedPanel extends BasePanel {
  id = 0;

  override head(): readonly [string, string] {
    const p = this.sim.village().byId.get(this.id);
    return [p === undefined ? '' : catalogName(p.key), '장식'];
  }

  sig(): string {
    return `${this.id}|${this.sim.village().stamp.place}|${this.sim.village().stamp.road}`;
  }

  protected build(): void {
    const sim = this.sim;
    const p = sim.village().byId.get(this.id);
    if (p === undefined) {
      this.el.append(h('div', 'mpv-empty', '보관함으로 들어갔어요'));
      return;
    }
    const kind = catalogKind(p.key);
    const desc = kind === 'decor' ? `둘레 2칸을 지나는 손님 기분이 조금 올라요 (+${DECOR[p.key as DecorId].aura}/분)` : '';
    const more = kind === 'decor' ? sim.stored(p.key) : 0;
    this.el.append(
      h('div', 'mpv-card', h('span', 'mpv-thumb', mapPic(catalogArt(p.key), catalogName(p.key))), h('div', 'mpv-grow', h('div', 'mpv-desc', desc), more > 0 ? h('div', 'mpv-note', `보관함에 ${more}개 더 있어요`) : null)),
      h(
        'div',
        'mpv-act',
        btn('sub grow', [icon('move'), '옮기기'], () => this.ctx.startBuild({ kind: 'move', id: p.id })),
        btn('sub grow', [icon('box'), '보관하기'], () => {
          // 장식은 바로 (손님이 들르지 않는다), 다른 것은 묻고.
          if (kind !== 'decor') askStore(this.ctx, p.id, p.key);
          else if (this.ctx.act(sim.store(p.id))) this.ctx.closeAll();
        }),
      ),
    );
  }
}
