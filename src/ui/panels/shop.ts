// 가게 시트 (다섯째 묶음, DESIGN 3.8): 지도·짓기 탭에서 가게를 누르면 열린다.
// 위 = 가게 그림·하는 일·지금 모습 (손님 맞는 중 / 쉬는 까닭), 이번 매상·손님 (이번에 마을을 연 뒤), 가게 주인 ([바꾸기 ▾]).
// 가게마다: 자리 (식당 테이블·여관 방·온천 탕·미용실 의자·사진관 배경판), 놀이기구 한 바퀴와 목마·곤돌라, 아이스크림 트럭의 길과 정류장 (작은 지도),
// 사진관 사진첩, 꽃집 최근 선물, 장신구 가게 진열. 그다음 메뉴 (값·효과·좋아하는 손님), 지금 손님 (누르면 손님 카드), 레벨·업그레이드, 자리 (옮기기·보관하기·길 잇기).
// 아직 짓지 않았으면 하는 일·잠긴 까닭·짓기 칸.

import '../shops.css';
import { catalogKind, footprint } from '../../data/catalog.ts';
import { ACCESSORIES, ACCESSORY_IDS, ACCESSORY_SHOP, boothDef, RIDE, SHOP_ITEMS, SHOP_OWNER_ROLE, SHOPS, SPECIES, SPECIES_IDS, shopDef, TRUCK, type AccessoryId, type ShopId } from '../../data/defs.ts';
import { CELL, GRID } from '../../data/map.ts';
import { accessoryMid, accessoryPrice, accessoryStock, isRide, rideProgress, shopIdleReason, shopOwner, shopPrice, shopServiceSec, shopSlots, truckPos } from '../../sim/shops.ts';
import { isIdle } from '../../sim/staff.ts';
import { josa } from '../../sim/text.ts';
import type { GameState, Monster, MonsterPhase, Staff } from '../../sim/types.ts';
import type { Village } from '../../sim/village.ts';
import { artMeta } from '../../view/art.ts';
import { append, btn, fmt, h, setText, type Child } from '../dom.ts';
import { icon } from '../icons.ts';
import { accessoryInfo, boothShort, monsterStatus, SLOT_NAME, staffWhere } from '../labels.ts';
import type { MenuItem } from '../menu.ts';
import { BasePanel, type UiCtx } from '../panel.ts';
import { artPic, itemIcon, monsterPic, pic, picUrl, placeholder, plushPic, staffPic } from '../pics.ts';
import { fansOf, SHOP_SEAT, SHOP_SERVICE, SHOP_WHO, seatsAt, shopEffectText, shopIdleText, shopItemName, shopLevelText, shopNextText, shopStayText } from '../shopText.ts';
import { makeBar, secHead, statBlock, type Live } from '../widgets.ts';
import { albumCount, latestPhotos, photoFrame } from './album.ts';
import { catalogPic, costAction, effLine, fpTags, placeRow, roadIssue, startPlace } from './build.ts';

const SVG = 'http://www.w3.org/2000/svg';

/** 가게 볼일 차례 (자리 → 계산대 → 줄 → 오는 중). */
const PHASE_ORDER: Partial<Record<MonsterPhase, number>> = { atShop: 0, toShopSeat: 1, buying: 2, shopQueue: 3, toShop: 4 };

/** 지금 이 가게 볼일을 보는 손님 (자리·계산대·줄·오는 중 차례). */
export function shopGuests(st: GameState, s: ShopId): Monster[] {
  return st.monsters.filter((m) => m.shop === s && PHASE_ORDER[m.phase] !== undefined).sort((a, b) => (PHASE_ORDER[a.phase] ?? 9) - (PHASE_ORDER[b.phase] ?? 9));
}

/** 몇 초 전 ('방금' · '42초 전' · '3분 전'). */
function ago(st: GameState, t: number): string {
  const d = Math.max(0, st.time - t);
  if (d < 10) return '방금';
  if (d < 60) return `${Math.floor(d)}초 전`;
  return `${Math.floor(d / 60)}분 전`;
}

/** 목록 상자: 구조(sig)가 바뀌면 다시 만들고, 아니면 숫자만 (tick, 4Hz). */
function liveBox(live: Live, el: HTMLElement, sig: () => string, make: (tick: (fn: () => void) => void) => Child[]): HTMLElement {
  let last: string | null = null;
  let ticks: (() => void)[] = [];
  live.add(() => {
    const s = sig();
    if (s !== last) {
      last = s;
      const next: (() => void)[] = [];
      el.replaceChildren();
      append(el, make((fn) => next.push(fn)));
      ticks = next;
    }
    for (const f of ticks) f();
  });
  return el;
}

/** 코인 값 칩 (그림 + 수). */
function priceChip(n: number, cls = ''): HTMLElement {
  return h('span', `mpv-chip price ${cls}`.trim(), itemIcon('coin'), fmt(n));
}

/**
 * 가게 주인 고르기 판 (가게 시트·주민 탭): 지금 주인 → 쉬는 진행자 → 아무것도 멈추지 않는 바꾸기 → 부스를 멈추거나 다른 가게를 닫는 사람 (각각 손님맞이 순).
 * 다른 가게 주인이면 서로 바꾼다 (api.ts assignShop).
 */
export function openShopOwnerMenu(ctx: UiCtx, anchor: HTMLElement, s: ShopId): void {
  const st = ctx.sim.state;
  const owner = shopOwner(st, s);
  const name = SHOPS[s].name;
  const stopsBooth = (x: Staff): boolean => x.post !== null && boothDef(x.post.booth).roles[x.post.role]?.optional !== true;
  const closesShop = (x: Staff): boolean => (x.shop ?? null) !== null && owner === null;
  const score = (x: Staff): number =>
    (x.id === owner?.id ? 1000 : 0) + (isIdle(x) ? 100 : 0) - (x.id !== owner?.id && (stopsBooth(x) || closesShop(x)) ? 50 : 0) + x.stats.welcome * 3 + x.stats.charm + x.stats.pace;
  const items: MenuItem[] = [...st.staff]
    .sort((a, b) => score(b) - score(a))
    .map((x) => {
      const notes = [staffWhere(x)];
      if (x.id !== owner?.id) {
        const from = x.shop ?? null;
        if (from !== null) notes.push(owner !== null ? `${SHOPS[from].name} 주인과 자리를 바꿔요` : `${josa(SHOPS[from].name, '이', '가')} 쉬어요`);
        else if (owner !== null) notes.push(`${josa(owner.name, '은', '는')} 쉬어요`);
        const p = x.post;
        if (p !== null && boothDef(p.booth).roles[p.role]?.optional !== true) notes.push(`${josa(boothShort(p.booth), '이', '가')} 멈춰요`);
      }
      return {
        icon: staffPic(x.art, x.name),
        label: `${x.name} Lv.${x.level}`,
        sub: `${notes.join(' · ')} · 진행 ${x.stats.pace} · 입담 ${x.stats.charm}`,
        right: `손님맞이 ${x.stats.welcome}`,
        active: x.id === owner?.id,
        onPick: () => {
          if (x.id !== owner?.id) ctx.act(ctx.sim.assignShop(x.id, s));
        },
      };
    });
  if (owner !== null) items.push({ label: '쉬게 하기', sub: `${josa(owner.name, '이', '가')} 쉬어요 (${josa(name, '이', '가')} 문을 닫아요)`, onPick: () => ctx.act(ctx.sim.assignShop(owner.id, null)) });
  if (st.staff.length > 0) {
    const cheapest = st.candidates.reduce<number | null>((m, c) => (m === null || c.cost < m ? c.cost : m), null);
    items.push({ label: '새 진행자 고용하기', sub: cheapest === null ? '지금은 후보가 없어요 · 주민 탭에서 기다려요' : `후보 ${st.candidates.length}명 · ${fmt(cheapest)} 코인부터`, onPick: () => ctx.openHire() });
  }
  const empty = h(
    'div',
    'mpv-menu-empty',
    '고용한 진행자가 없어요.',
    btn('sky small', '고용하러 가기', () => {
      ctx.menu.close();
      ctx.openHire();
    }),
  );
  ctx.menu.open(anchor, `${name} 주인 고르기 (손님맞이)`, st.staff.length === 0 ? [] : items, empty);
}

export class ShopPanel extends BasePanel {
  shop: ShopId = 'snack_stall';

  override head(): readonly [string, string] {
    const s = this.shop;
    const lv = this.st.shops[s].level;
    if (lv < 1) return [SHOPS[s].name, '아직 없어요'];
    return [SHOPS[s].name, this.sim.stored(s) > 0 ? `보관함 · Lv.${lv}` : `Lv.${lv}`];
  }

  sig(): string {
    const s = this.shop;
    const ss = this.st.shops[s];
    const v = this.sim.village();
    const o = shopOwner(this.st, s);
    return [s, ss.level, o === null ? '-' : `${o.id}.${o.level}`, v.stamp.place, v.stamp.road, this.sim.hallLevel(), this.sim.stored(s), this.st.staff.length].join('|');
  }

  protected build(): void {
    this.el.classList.add('mpv-shoppanel');
    if (this.st.shops[this.shop].level < 1) this.unbuilt();
    else this.built();
  }

  // ── 아직 짓지 않은 가게 ──

  private unbuilt(): void {
    const s = this.shop;
    const d = SHOPS[s];
    const lock = this.sim.shopLockReason(s);
    const stay = shopStayText(s);
    this.el.append(
      h(
        'div',
        'mpv-card dim',
        h('span', 'mpv-thumb', catalogPic(s, d.name)),
        h('div', 'mpv-grow', h('div', 'mpv-desc', d.desc), fpTags(s), lock !== null ? h('div', 'mpv-lock', lock) : h('div', 'mpv-note strong', `지으면 ${josa(d.owner.name, '이', '가')} ${SHOP_OWNER_ROLE}으로 와요`)),
      ),
      h('div', 'mpv-card col', effLine('효과', shopEffectText(s)), stay !== null ? effLine('머묾', stay) : null, costAction(this.ctx, this.live, this.sim.shopBuyCost(s), '짓고 놓기', () => startPlace(this.ctx, s), '지을 수 없어요', lock !== null, 'green')),
      secHead('이런 가게예요'),
      h('ul', 'mpv-how', h('li', null, SHOP_WHO[s]), h('li', null, `${SHOP_OWNER_ROLE}: ${d.owner.name} (진행 ${d.owner.stats.pace} · 입담 ${d.owner.stats.charm} · 손님맞이 ${d.owner.stats.welcome})`), h('li', null, '입구 앞이 길로 마을 입구와 이어져야 손님이 와요')),
    );
    this.menuSection();
  }

  // ── 지은 가게 ──

  private built(): void {
    const s = this.shop;
    const d = SHOPS[s];
    const stay = shopStayText(s);
    const stored = this.sim.stored(s) > 0;
    const issue = roadIssue(this.ctx, s);

    // 지금 모습 (4Hz)
    const status = h('div', 'mpv-shop-st', h('i', 'dot'), h('span', null));
    const statusText = status.lastChild as HTMLElement;
    this.live.add(() => {
      const why = shopIdleReason(this.st, s);
      status.classList.toggle('idle', why !== null);
      setText(statusText, why !== null ? shopIdleText(why, issue === 'cut') : this.openText());
    });
    this.el.append(
      h(
        'div',
        'mpv-card mpv-shop-head',
        h('span', 'mpv-thumb', catalogPic(s, d.name)),
        h('div', 'mpv-grow', h('div', 'mpv-desc', d.desc), status, fpTags(s)),
      ),
    );
    // 보관함·길이 끊김: 놓기·길 잇기를 맨 위에 (까닭은 지금 모습 줄이 말한다).
    if (stored || issue !== null) {
      const row = placeRow(this.ctx, s, false);
      if (row !== null) this.el.append(row);
    }

    this.todayCard();
    this.ownerSection();

    switch (s) {
      case 'carousel':
      case 'ferris_wheel':
        this.rideSection();
        break;
      case 'icecream_truck':
        this.truckSection();
        break;
      case 'accessory_shop':
        this.stockSection();
        break;
      case 'flower_shop':
        this.giftSection();
        break;
      default:
        if (SHOP_SEAT[s] !== undefined) this.seatSection();
    }
    if (s === 'photo_studio') this.albumSection();

    this.menuSection(stay);
    this.guestSection();
    this.levelSection();
    this.placeSection();
  }

  /** 문을 연 가게의 지금 모습 한 줄. */
  private openText(): string {
    const s = this.shop;
    const n = shopGuests(this.st, s).length;
    if (s === 'icecream_truck') return `${this.truckText()}${n > 0 ? ` · 손님 ${n}명` : ''}`;
    // 지금 손님 수는 바로 아래 칸에 있다 (세 번 쓰지 않게).
    return n > 0 ? '손님 맞는 중' : '문 열고 손님을 기다려요';
  }

  /** 이번 매상·이번 손님 (이번에 마을을 연 뒤)·지금 손님, 지금까지. */
  private todayCard(): void {
    const s = this.shop;
    const log = this.ctx.shopLog;
    const box = (label: string, get: () => string): HTMLElement => {
      const b = h('b');
      this.live.add(() => setText(b, get()));
      return h('div', 'mpv-total', b, h('small', null, label));
    };
    const total = h('span');
    this.live.add(() => {
      const ss = this.st.shops[s];
      setText(total, `지금까지 손님 ${fmt(ss.served)}명 · 매상 ${fmt(ss.revenue)}코인`);
    });
    this.el.append(
      h(
        'div',
        'mpv-totals three mpv-shop-today',
        box('이번 매상', () => fmt(log.today(s).revenue)),
        box('이번 손님', () => fmt(log.today(s).served)),
        box('지금 손님', () => fmt(shopGuests(this.st, s).length)),
      ),
      h('div', 'mpv-note mpv-shop-sum', total),
    );
  }

  /** 가게 주인: 그림·이름·능력치·이 가게에서 하는 일, [바꾸기 ▾]. 없으면 세우기. */
  private ownerSection(): void {
    const s = this.shop;
    const owner = shopOwner(this.st, s);
    this.el.append(secHead(SHOP_OWNER_ROLE, '진행자 한 명이 맡아요'));
    if (owner === null) {
      const b = btn('butter small', '주인 세우기 ▾', () => openShopOwnerMenu(this.ctx, b, s));
      this.el.append(h('div', 'mpv-card mpv-owner none', h('span', 'mpv-thumb sm', h('span', 'mpv-pic plus', '+')), h('div', 'mpv-grow', h('div', 'mpv-warn', '가게 주인이 없어 쉬는 중이에요'), h('div', 'mpv-act', b))));
      return;
    }
    const charm = owner.stats.charm - 3;
    const what = h('div', 'mpv-desc');
    this.live.add(() => setText(what, `계산 ${shopServiceSec(this.st, s).toFixed(1)}초${charm !== 0 ? ` · 효과 기분 ${charm > 0 ? '+' : ''}${charm}` : ''}`));
    const b = btn('sub small', '바꾸기 ▾', () => openShopOwnerMenu(this.ctx, b, s));
    this.el.append(
      h(
        'div',
        'mpv-card mpv-owner',
        h('span', 'mpv-thumb sm', staffPic(owner.art, owner.name)),
        h(
          'div',
          'mpv-grow',
          h('div', 'mpv-owner-top', h('div', 'mpv-title sm', owner.name, h('span', 'mpv-lv', `Lv.${owner.level}`)), b),
          what,
          statBlock(owner.stats),
          h('div', 'mpv-note', '진행: 계산이 빨라요 · 입담: 효과 기분 + · 손님맞이: 손님이 더 와요'),
        ),
      ),
    );
  }

  // ── 자리 (식당·미용실·여관·온천·사진관) ──

  private seatSection(): void {
    const s = this.shop;
    const w = SHOP_SEAT[s];
    if (w === undefined) return;
    const right = h('small');
    const head = h('div', 'mpv-sec', h('span', null, w.seat), right);
    const max = seatsAt(s, shopDef(s).upgrade.length + 1);
    this.live.add(() => {
      const n = shopSlots(this.st, s);
      const used = this.st.shops[s].slots.slice(0, n).filter((x) => x !== null).length;
      // 놀이기구는 머무는 초를 위 놀이기구 머리줄에 이미 쓴다 (두 번 쓰지 않게).
      setText(right, isRide(s) ? `${used} / ${n}` : `${used} / ${n} · ${shopStayText(s) ?? ''}`);
    });
    const grid = h('div', 'mpv-seats');
    liveBox(
      this.live,
      grid,
      () => {
        const ss = this.st.shops[s];
        const n = shopSlots(this.st, s);
        return `${n}|${ss.slots.map((id) => (id === null ? '-' : `${id}.${this.sim.monster(id)?.phase ?? ''}`)).join(',')}`;
      },
      (tick) => {
        const n = shopSlots(this.st, s);
        const out: HTMLElement[] = [];
        for (let i = 0; i < max; i++) out.push(i < n ? this.seatCell(s, i, tick) : this.lockedSeat(s, i));
        return out;
      },
    );
    this.el.append(head, grid);
  }

  /** 자리 한 칸: 손님 (그림·이름·하는 일·남은 초) 또는 빈 자리. */
  private seatCell(s: ShopId, i: number, tick: (fn: () => void) => void): HTMLElement {
    const w = SHOP_SEAT[s];
    const id = this.st.shops[s].slots[i] ?? null;
    const m = id === null ? undefined : this.sim.monster(id);
    if (m === undefined || w === undefined) return h('div', 'mpv-seat empty', h('span', 'mpv-pic plus', '+'), h('span', 'l', h('b', null, '빈 자리'), h('small', null, `${w?.seat ?? '자리'} ${i + 1}`)));
    const here = m.phase === 'atShop';
    const doing = h('small');
    const face = h('span', 'face', monsterPic(m.species, here && s !== 'photo_studio' ? 'base' : m.pose, m.nickname));
    // 여관 = 쿨쿨, 미용실 = 반짝 (지도에서는 안 보이는 손님), 온천 = 물, 식당 = 먹는 것.
    if (here && s === 'inn') face.append(pic('fx', ['emote_sleep'], () => placeholder('z', 'var(--dd-sky)'), 'emote'));
    if (here && s === 'beauty_salon') face.append(pic('fx', ['emote_sparkle'], () => placeholder('✦', 'var(--dd-butter)'), 'emote'));
    if (here && s === 'restaurant' && m.order?.item) face.append(artPic(m.order.item, shopItemName(m.order.item), 'food'));
    const cell = h('button', `mpv-seat on${here ? '' : ' coming'}${here && s === 'hot_spring' ? ' soak' : ''}`, face, h('span', 'l', h('b', null, m.nickname), doing));
    cell.type = 'button';
    cell.setAttribute('aria-label', `${m.nickname} 손님 보기`);
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.sim.monster(m.id) !== undefined) this.ctx.showMonster(m.id);
    });
    tick(() => {
      const c = this.sim.monster(m.id);
      if (c === undefined) return;
      if (c.phase === 'atShop' && (s === 'carousel' || s === 'ferris_wheel')) {
        // 놀이기구: 한 바퀴는 다 같이 (남은 초는 위 한 바퀴 줄에).
        const r = this.st.shops[s].ride;
        setText(doing, r !== null && r.phase === 'running' && r.riders.includes(c.id) ? w.doing : '출발 기다리는 중');
      } else if (c.phase === 'atShop') {
        const food = s === 'restaurant' ? shopItemName(c.order?.item ?? null) : '';
        setText(doing, `${food !== '' ? `${food} ` : ''}${w.doing} · ${Math.max(0, Math.ceil(c.timer))}초`);
      } else setText(doing, c.phase === 'buying' ? '계산하는 중' : w.going);
    });
    return cell;
  }

  /** 아직 잠긴 자리 (레벨이 오르면 열린다). */
  private lockedSeat(s: ShopId, i: number): HTMLElement {
    const d = shopDef(s);
    let lv = 1;
    while (lv <= d.upgrade.length + 1 && seatsAt(s, lv) <= i) lv++;
    return h('div', 'mpv-seat locked', h('span', 'mpv-pic plus', '+'), h('span', 'l', h('b', null, `Lv.${lv}부터`), h('small', null, `${SHOP_SEAT[s]?.seat ?? '자리'} ${i + 1}`)));
  }

  // ── 놀이기구 (회전목마·관람차) ──

  private rideSection(): void {
    const s = this.shop;
    const w = SHOP_SEAT[s];
    const bar = makeBar('ride');
    const text = h('span', 'mpv-grow');
    const card = h('div', 'mpv-ride', h('span', 'flag', icon('ride')), h('div', 'mpv-grow', text, bar.el));
    this.live.add(() => {
      const r = this.st.shops[s].ride;
      const phase = r?.phase ?? 'idle';
      card.dataset.phase = phase;
      if (r === null || phase === 'idle') {
        setText(text, '손님을 기다려요 · 첫 손님이 타면 곧 출발');
        bar.set(0);
      } else if (phase === 'boarding') {
        // 자리가 다 찼으면 곧 출발, 기다린 시간이 지났으면 자리로 오는 손님을 기다린다 (sim이 조금 더 기다린다: 0초에 멈춰 보이지 않게).
        const n = shopSlots(this.st, s);
        const full = this.st.shops[s].slots.slice(0, n).every((x) => x !== null);
        const left = Math.ceil(RIDE.boardSec - r.t);
        setText(text, full ? '태우는 중 · 곧 출발!' : left > 0 ? `태우는 중 · 곧 출발 (${left}초)` : '태우는 중 · 탈 손님을 기다려요');
        bar.set(full ? 1 : Math.min(1, r.t / RIDE.boardSec), 'var(--dd-butter)');
      } else {
        setText(text, `${s === 'carousel' ? '빙글빙글 도는 중' : '천천히 도는 중'} · ${r.riders.length}명 · ${Math.max(0, Math.ceil(r.duration - r.t))}초 남음`);
        bar.set(rideProgress(this.st.shops[s]), 'var(--dd-green)');
      }
    });
    this.el.append(secHead(s === 'carousel' ? '회전목마' : '관람차', shopStayText(s) ?? undefined), card);
    if (w !== undefined) this.seatSection();
  }

  // ── 아이스크림 트럭 ──

  /** 트럭 한 줄: 차고 · 길로 나가는 중 · 서서 파는 중 · 다음 정류장으로. */
  private truckText(): string {
    const t = this.st.shops.icecream_truck.truck;
    if (t === null || t.parked) return '차고에서 쉬는 중';
    if (t.stop > 0) {
      const q = this.st.shops.icecream_truck.queue.length;
      return `길에 서서 파는 중 · ${Math.max(1, Math.ceil(t.stop))}초 더${q > 0 ? ` · 줄 ${q}명` : ''}`;
    }
    let len = 0;
    let at = { x: t.x, y: t.y };
    for (const p of t.path) {
      len += Math.hypot(p.x - at.x, p.y - at.y);
      at = p;
    }
    return len > 0 ? `다음 정류장으로 달리는 중 · ${Math.max(1, Math.round(len / CELL))}칸` : '어디 설지 고르는 중';
  }

  private truckSection(): void {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'mpv-truckmap');
    const base = document.createElementNS(SVG, 'g');
    const route = document.createElementNS(SVG, 'polyline');
    route.setAttribute('class', 'route');
    const stop = document.createElementNS(SVG, 'g');
    stop.setAttribute('class', 'stop');
    const stopPole = document.createElementNS(SVG, 'path');
    stopPole.setAttribute('d', 'M0 0 V-1.3 M0 -1.3 H0.9 L0.6 -1.0 L0.9 -0.7 H0');
    stop.append(stopPole);
    const truck = document.createElementNS(SVG, 'g');
    truck.setAttribute('class', 'truck');
    const ring = document.createElementNS(SVG, 'circle');
    ring.setAttribute('class', 'sell');
    ring.setAttribute('r', '1.5');
    ring.setAttribute('cy', '-0.6');
    const img = document.createElementNS(SVG, 'image');
    const tm = artMeta('racers', 'icecream_truck');
    const tw = 2.4;
    const th = tm !== undefined ? (tw * tm.h) / tm.w : 2.2;
    img.setAttribute('href', picUrl('racers', 'icecream_truck'));
    img.setAttribute('width', String(tw));
    img.setAttribute('height', th.toFixed(2));
    img.setAttribute('x', String(-tw / 2));
    img.setAttribute('y', (-th + 0.35).toFixed(2));
    const flip = document.createElementNS(SVG, 'g');
    flip.append(img);
    truck.append(ring, flip);
    svg.append(base, route, stop, truck);

    const text = h('span', 'mpv-grow');
    let stamp = '';
    this.live.add(() => {
      const v = this.sim.village();
      const key = `${v.stamp.place}|${v.stamp.road}|${v.stamp.land}`;
      if (key !== stamp) {
        stamp = key;
        drawTruckBase(svg, base, v);
      }
      const t = this.st.shops.icecream_truck.truck;
      const p = truckPos(this.st);
      const x = p.x / CELL;
      const y = p.y / CELL;
      truck.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
      flip.setAttribute('transform', t !== null && t.facing === 1 ? 'scale(-1 1)' : '');
      const selling = t !== null && !t.parked && t.stop > 0;
      truck.classList.toggle('selling', selling);
      const pts = t === null || t.parked ? [] : t.path;
      const last = pts[pts.length - 1];
      route.setAttribute('points', pts.length > 0 ? [`${x.toFixed(2)},${y.toFixed(2)}`, ...pts.map((q) => `${(q.x / CELL).toFixed(2)},${(q.y / CELL).toFixed(2)}`)].join(' ') : '');
      stop.style.display = last === undefined ? 'none' : '';
      if (last !== undefined) stop.setAttribute('transform', `translate(${(last.x / CELL).toFixed(2)} ${(last.y / CELL).toFixed(2)})`);
      setText(text, shopIdleReason(this.st, 'icecream_truck') !== null ? '가게가 쉬어서 트럭이 차고에 있어요' : this.truckText());
    });
    const go = btn('sky small', [icon('pin'), '트럭 보기'], () => {
      this.ctx.closeAll();
      const p = truckPos(this.st);
      this.ctx.hooks.world.focusOn({ x: p.x, y: p.y - 60 }, 0.7);
    });
    this.el.append(
      secHead('트럭 길', '길 위를 다니다 서면 손님이 졸졸'),
      h('div', 'mpv-card col mpv-truck', svg, h('div', 'mpv-truck-st', text, go), h('div', 'mpv-note', `서면 ${TRUCK.stopSec[0]}~${TRUCK.stopSec[1]}초 동안 팔고, 줄이 있으면 ${TRUCK.holdMax}초까지 더 서요. 길 끝이 마을 입구와 끊기면 차고로 돌아와요.`)),
    );
  }

  // ── 장신구 가게 진열 ──

  private stockSection(): void {
    const st = this.st;
    const stock = new Set(accessoryStock(st));
    const lv = st.shops.accessory_shop.level;
    this.el.append(secHead('진열장', `${stock.size}가지 · 팔린 장신구 ${fmt(st.shopTotals.accessories)}개`), h('div', 'mpv-note src', '이긴 손님이 비어 있는 머리·목·옆구리에 달 것을 사요. 귀한 것은 가게 레벨이 오르면 팔아요.'));
    const grid = h('div', 'mpv-acc mpv-stock');
    for (const k of ACCESSORY_IDS) grid.append(this.stockCell(k, stock.has(k), lv));
    this.el.append(grid);
  }

  private stockCell(k: AccessoryId, on: boolean, lv: number): HTMLElement {
    const d = ACCESSORIES[k];
    const need = ACCESSORY_SHOP.rareFrom[k] ?? 1;
    const cell = h(
      'button',
      `mpv-acc-cell${on ? '' : ' none'}${d.rare ? ' rare' : ''}`,
      itemIcon(k),
      h('span', 'name', d.name),
      on ? h('span', 'slot', h('b', null, `${fmt(accessoryPrice(this.st, k))}코인`)) : h('span', 'slot', `Lv.${need}부터`),
      d.rare ? h('span', 'rare-tag', '귀함') : null,
    );
    cell.type = 'button';
    cell.setAttribute('aria-label', on ? `${d.name} ${accessoryPrice(this.st, k)}코인` : `${d.name} 가게 레벨 ${need}부터`);
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ctx.toast(on ? `${d.name} · ${SLOT_NAME[d.slot]} · ${fmt(accessoryPrice(this.st, k))}코인 (전당포에 맡기면 ${fmt(accessoryMid(k))}코인)` : `${d.name}: 가게 Lv.${need}부터 팔아요 (지금 Lv.${lv}) · ${accessoryInfo(k)}`);
    });
    return cell;
  }

  // ── 꽃집: 최근 선물 ──

  private giftSection(): void {
    const log = this.ctx.shopLog;
    const right = h('small');
    this.live.add(() => setText(right, `모두 ${fmt(this.st.shopTotals.gifts)}번`));
    const list = h('div', 'mpv-gifts');
    liveBox(
      this.live,
      list,
      () => `${log.gifts.length}|${log.gifts[0]?.at ?? 0}`,
      (tick) => {
        if (log.gifts.length === 0) return [h('div', 'mpv-empty sm', '아직 건넨 꽃이 없어요. 같은 판에서 논 손님끼리 친해지면 꽃다발을 사서 건네요.')];
        return log.gifts.map((g) => {
          const when = h('small', 'when');
          tick(() => setText(when, ago(this.st, g.at)));
          const who = (id: number, sp: (typeof g)['fromSpecies'], name: string): HTMLElement => {
            const b = h('button', 'who', monsterPic(sp, 'joy', name), h('span', 'nm', name));
            b.type = 'button';
            b.setAttribute('aria-label', `${name} 손님 보기`);
            b.addEventListener('click', (e) => {
              e.stopPropagation();
              if (this.sim.monster(id) !== undefined) this.ctx.showMonster(id);
              else this.ctx.toast(`${name} 손님은 벌써 집에 갔어요`);
            });
            return b;
          };
          return h('div', 'mpv-gift', who(g.from, g.fromSpecies, g.fromName), h('span', 'arrow', itemIcon('bouquet')), who(g.to, g.toSpecies, g.toName), when);
        });
      },
    );
    this.el.append(h('div', 'mpv-sec', h('span', null, '최근 꽃 선물'), right), list);
  }

  // ── 사진관: 사진첩 ──

  private albumSection(): void {
    const right = h('small');
    const strip = h('div', 'mpv-album-strip');
    liveBox(
      this.live,
      strip,
      () => String(albumCount(this.st)),
      () => {
        const list = latestPhotos(this.st, 4);
        if (list.length === 0) return [h('span', 'mpv-note', '아직 찍은 사진이 없어요. 손님이 배경판 앞에서 찰칵!')];
        return list.map((sp, i) => photoFrame(sp, true, true, 'mini', i % 2 === 0 ? -2 : 2));
      },
    );
    this.live.add(() => setText(right, `${albumCount(this.st)} / ${SPECIES_IDS.length}종`));
    this.el.append(
      h('div', 'mpv-sec', h('span', null, '사진첩'), right),
      h('div', 'mpv-card col mpv-album-card', strip, h('div', 'mpv-act', h('span', 'mpv-note mpv-grow', '종마다 처음 찍은 사진이 모여요'), btn('sky small', [icon('camera'), '사진첩 보기'], () => this.ctx.openDex('photo')))),
    );
  }

  // ── 메뉴 ──

  /** 파는 것과 값 (레벨 값), 좋아하는 손님 (만난 종만), 효과. */
  private menuSection(stay: string | null = shopStayText(this.shop)): void {
    const s = this.shop;
    const st = this.st;
    const d = shopDef(s);
    const rows: HTMLElement[] = [];
    const row = (art: Node, name: string, sub: string | null, price: number): HTMLElement => h('div', 'mpv-menu-row', h('span', 'pic', art), h('span', 'l', h('b', null, name), sub !== null && sub !== '' ? h('small', null, sub) : null), priceChip(price));
    if (s === 'accessory_shop') {
      const [lo, hi] = [Math.min(...accessoryStock(st).map((k) => accessoryPrice(st, k))), Math.max(...accessoryStock(st).map((k) => accessoryPrice(st, k)))];
      rows.push(h('div', 'mpv-menu-row', h('span', 'pic', itemIcon('acc_ribbon')), h('span', 'l', h('b', null, '장신구'), h('small', null, `전당포 값의 ${ACCESSORY_SHOP.markup[Math.max(0, st.shops[s].level - 1)] ?? 1.4}배`)), h('span', 'mpv-chip price', itemIcon('coin'), `${fmt(lo)}~${fmt(hi)}`)));
    } else if (d.menu.length > 0) {
      for (const it of d.menu) {
        const fans = fansOf(it.item).filter((sp) => st.dex[sp] !== undefined);
        const names = fans.slice(0, 3).map((sp) => SPECIES[sp].name);
        const sub = fans.length > 0 ? `좋아해요: ${names.join('·')}${fans.length > 3 ? ` 외 ${fans.length - 3}` : ''}` : null;
        rows.push(row(itemIcon(it.item), SHOP_ITEMS[it.item].name, sub, shopPrice(st, s, it.k)));
      }
    } else if (s === 'souvenir_shop') {
      rows.push(row(plushPic('dragon', '인형'), '손님 인형', '떠나는 손님이 자기 종 인형을 사 가요', shopPrice(st, s)));
    } else {
      rows.push(row(catalogPic(s, SHOPS[s].name), SHOP_SERVICE[s], stay, shopPrice(st, s)));
    }
    // 한 덩이로 (짧은 폰에서는 shops.css가 머리 카드 바로 아래로 올린다: 첫 화면에 이 가게만의 것이 보이게).
    this.el.append(h('div', 'mpv-shop-menu', secHead('메뉴', st.shops[s].level >= 1 ? `Lv.${st.shops[s].level} 값` : 'Lv.1 값'), h('div', 'mpv-card col mpv-menu-card', ...rows, effLine('효과', shopEffectText(s)), st.shops[s].level >= 1 ? effLine('손님', SHOP_WHO[s]) : null)));
  }

  // ── 지금 손님 ──

  private guestSection(): void {
    const s = this.shop;
    const right = h('small');
    this.live.add(() => setText(right, `${shopGuests(this.st, s).length}명 · 누르면 손님 카드`));
    const list = h('div', 'mpv-entries');
    liveBox(
      this.live,
      list,
      () =>
        shopGuests(this.st, s)
          .map((m) => `${m.id}.${m.phase}`)
          .join(','),
      (tick) => {
        const gs = shopGuests(this.st, s);
        if (gs.length === 0) return [h('div', 'mpv-empty sm', shopIdleReason(this.st, s) !== null ? '가게가 쉬는 동안은 손님이 오지 않아요' : '지금은 손님이 없어요')];
        return gs.map((m) => this.guestRow(m, tick));
      },
    );
    const recent = h('div', 'mpv-recent');
    const log = this.ctx.shopLog;
    liveBox(
      this.live,
      recent,
      () => `${log.recent(s).length}|${log.recent(s)[0]?.at ?? 0}`,
      (tick) => {
        const rs = log.recent(s).slice(0, 4);
        if (rs.length === 0) return [];
        const out: Child[] = [h('span', 'lab', '최근')];
        for (const r of rs) {
          const when = h('small');
          tick(() => setText(when, ago(this.st, r.at)));
          const name = shopItemName(r.item) || SHOP_SERVICE[s];
          out.push(h('span', 'mpv-chip sale', r.item !== null ? artPic(r.item, name) : monsterPic(r.species, 'joy', r.name), h('span', 'nm', `${r.name} · ${name}`), h('b', null, fmt(r.price)), when));
        }
        return out;
      },
    );
    this.el.append(h('div', 'mpv-sec', h('span', null, '지금 손님'), right), list, recent);
  }

  private guestRow(m: Monster, tick: (fn: () => void) => void): HTMLElement {
    const id = m.id;
    const small = h('small');
    const o = m.order ?? null;
    const name = shopItemName(o?.item ?? null);
    const el = h(
      'button',
      'mpv-entry mpv-guest',
      monsterPic(m.species, m.pose, m.nickname),
      h('span', 'who', h('b', null, m.nickname), small),
      o !== null && o.item !== null ? artPic(o.item, name, 'buy') : null,
      o !== null ? priceChip(o.price, 'sm') : null,
    );
    el.type = 'button';
    el.setAttribute('aria-label', `${m.nickname} 손님 보기`);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.sim.monster(id) !== undefined) this.ctx.showMonster(id);
      else this.ctx.toast(`${m.nickname} 손님은 벌써 집에 갔어요`);
    });
    tick(() => {
      const c = this.sim.monster(id);
      if (c !== undefined) setText(small, monsterStatus(c, this.st));
    });
    return el;
  }

  // ── 레벨 ──

  private levelSection(): void {
    const s = this.shop;
    const lv = this.st.shops[s].level;
    const max = shopDef(s).upgrade.length + 1;
    const next = shopNextText(s, lv);
    this.el.append(
      secHead('가게 레벨', `Lv.${lv} / ${max}`),
      h('div', 'mpv-card col', effLine('지금', shopLevelText(s, lv)), next !== null ? effLine('다음', next, true) : null, costAction(this.ctx, this.live, this.sim.shopUpgradeCost(s), '업그레이드', () => this.sim.upgradeShop(s))),
    );
  }

  // ── 자리 (지도) ──

  private placeSection(): void {
    const s = this.shop;
    const v = this.sim.village();
    const row = h('div', 'mpv-act');
    if (v.placed(s) !== undefined) {
      row.append(
        // 트럭은 트럭 칸의 '트럭 보기'가 따로 있어 이것은 차고로 (이름으로 다르게).
        btn('sub wide', [icon('pin'), s === 'icecream_truck' ? '차고 보기' : '지도에서 보기'], () => {
          this.ctx.closeAll();
          const a = v.art(s);
          this.ctx.hooks.world.focusOn({ x: a.x, y: a.y - footprint(s).h * CELL * 0.35 }, 0.6);
        }),
      );
    }
    const place = this.sim.stored(s) > 0 || roadIssue(this.ctx, s) !== null ? null : placeRow(this.ctx, s);
    if (row.childElementCount > 0 || place !== null) append(this.el, [secHead('자리'), row, place]);
  }
}

/** 트럭 작은 지도의 바탕: 길 칸 (걸을 수 있는 길·끊긴 길), 건물 발자국, 마을 입구·차고. 보이는 곳 = 길 칸 둘레 + 한 칸. */
function drawTruckBase(svg: SVGSVGElement, g: SVGGElement, v: Village): void {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number): void => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + 1);
    y1 = Math.max(y1, y + 1);
  };
  for (let i = 0; i < v.road.length; i++) if (v.road[i] === 1) add(i % GRID.w, Math.floor(i / GRID.w));
  const home = v.placed('icecream_truck');
  if (home !== undefined) {
    const fp = footprint('icecream_truck');
    add(home.x, home.y);
    add(home.x + fp.w - 1, home.y + fp.h - 1);
  }
  if (!Number.isFinite(x0)) {
    x0 = 0;
    y0 = 0;
    x1 = 8;
    y1 = 6;
  }
  x0 -= 1;
  y0 -= 1.6;
  x1 += 1;
  y1 += 1;
  svg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
  svg.style.aspectRatio = `${x1 - x0} / ${y1 - y0}`;
  const kids: SVGElement[] = [];
  const rect = (x: number, y: number, w: number, hh: number, cls: string, r = 0): void => {
    const e = document.createElementNS(SVG, 'rect');
    e.setAttribute('x', String(x));
    e.setAttribute('y', String(y));
    e.setAttribute('width', String(w));
    e.setAttribute('height', String(hh));
    if (r > 0) e.setAttribute('rx', String(r));
    e.setAttribute('class', cls);
    kids.push(e);
  };
  rect(x0, y0, x1 - x0, y1 - y0, 'bg');
  for (const p of v.state.placed) {
    const kind = catalogKind(p.key);
    if (kind === 'decor') continue;
    const fp = footprint(p.key);
    rect(p.x + 0.12, p.y + 0.12, fp.w - 0.24, fp.h - 0.24, p.key === 'icecream_truck' ? 'home' : p.key === 'gate' ? 'gate' : 'bld', 0.4);
  }
  for (let i = 0; i < v.road.length; i++) {
    if (v.road[i] !== 1) continue;
    rect(i % GRID.w, Math.floor(i / GRID.w), 1.02, 1.02, v.isWalkable(i) ? 'road' : 'road cut');
  }
  g.replaceChildren(...kids);
}
