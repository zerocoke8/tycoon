// 다섯째 묶음 가게 글자 (DOM 없음, DESIGN 3.8): 파는 것 이름, 효과 한 줄, 자리 말, 다음 레벨, 손님의 가게 볼일 한 줄, 손에 든 것.
// 숫자는 defs.ts (SHOPS·FLOWER·FOOD_LIKE·FORTUNE·SALON·SPRING·ACCESSORY_SHOP), 값은 sim/shops.ts가 정한 대로.

import { ACCESSORIES, ACCESSORY_IDS, ACCESSORY_SHOP, FLOWER, FOOD_LIKE, FORTUNE, RIDE, SALON, SHOP_ITEMS, SHOPS, SPECIES, SPECIES_FOOD, SPECIES_IDS, shopDef, type AccessoryId, type ShopId, type ShopItemId, type SpeciesId } from '../data/defs.ts';
import { SHOP_LAYOUT } from '../data/catalog.ts';
import { isRide, orderItemKey } from '../sim/shops.ts';
import { josa } from '../sim/text.ts';
import type { GameState, HeldItem, Monster } from '../sim/types.ts';

/** 메뉴가 없는 가게가 파는 것 (서비스) 이름. 메뉴가 있으면 그 이름들. */
export const SHOP_SERVICE: Readonly<Record<ShopId, string>> = {
  snack_stall: '간식',
  drink_stand: '음료',
  bakery: '빵',
  restaurant: '한 끼',
  icecream_truck: '아이스크림',
  accessory_shop: '장신구',
  beauty_salon: '털·머리 다듬기',
  inn: '하룻밤',
  hot_spring: '몸 담그기',
  fortune_teller: '점괘 한 장',
  carousel: '한 바퀴',
  ferris_wheel: '한 바퀴',
  photo_studio: '기념사진',
  souvenir_shop: '손님 인형',
  flower_shop: '꽃다발',
};

/** 계산대에 선 손님 말 (물건이 아니라 머무는 것·보는 것을 사는 가게: '여관에서 하룻밤을 사는 중'처럼 어색하지 않게). 없으면 '…을 사는 중'. */
const SHOP_BUYING: Partial<Record<ShopId, string>> = {
  restaurant: '식당에서 주문하는 중',
  beauty_salon: '미용실 접수하는 중',
  inn: '여관에서 방 잡는 중',
  hot_spring: '온천 표 사는 중',
  fortune_teller: '점집에서 점 보는 중',
  photo_studio: '사진관에서 계산하는 중',
};

/** 머무는·타는 가게의 자리 말: 자리 이름, 머무는 손님이 하는 일, 자리로 가는 손님. */
export interface SeatWords {
  readonly seat: string;
  readonly doing: string;
  readonly going: string;
}
export const SHOP_SEAT: Readonly<Partial<Record<ShopId, SeatWords>>> = {
  restaurant: { seat: '테이블 자리', doing: '먹는 중', going: '테이블로 가는 중' },
  beauty_salon: { seat: '의자', doing: '다듬는 중', going: '의자로 가는 중' },
  inn: { seat: '방', doing: '쿨쿨 자는 중', going: '방으로 가는 중' },
  hot_spring: { seat: '탕 자리', doing: '몸 담그는 중', going: '탕으로 가는 중' },
  photo_studio: { seat: '배경판', doing: '포즈 잡는 중', going: '배경판 앞으로 가는 중' },
  carousel: { seat: '목마', doing: '빙글빙글 타는 중', going: '목마로 가는 중' },
  ferris_wheel: { seat: '곤돌라', doing: '천천히 위로 도는 중', going: '곤돌라로 가는 중' },
};

/** 파는 것 그림 이름 ('items/food_waffle' · 'objects/plush_dragon' · 'items/acc_ribbon') → 이름. 없으면 ''. */
export function shopItemName(art: string | null | undefined): string {
  if (art === null || art === undefined) return '';
  const k = orderItemKey(art);
  if (k !== null) return SHOP_ITEMS[k].name;
  if (art.startsWith('objects/plush_')) {
    const sp = art.slice('objects/plush_'.length) as SpeciesId;
    return SPECIES[sp] !== undefined ? `${SPECIES[sp].name} 인형` : '인형';
  }
  if (art.startsWith('items/')) {
    const a = art.slice('items/'.length) as AccessoryId;
    if (a in ACCESSORIES) return ACCESSORIES[a].name;
  }
  return '';
}

/** 마시는 것 (먹는 중 대신 '마시는 중'). */
const DRINKS: ReadonlySet<ShopItemId> = new Set(['food_lemonade', 'food_cocoa']);

/** 손에 든 것 한 줄: '솜사탕 먹는 중' · '레모네이드 마시는 중' · '꽃다발 들고 있어요' · (친구가 준 꽃) '받은 꽃다발'. */
export function heldText(h: HeldItem): string {
  const name = shopItemName(h.item) || '산 것';
  if (h.shop === null && h.item.endsWith('bouquet')) return '선물 받은 꽃다발';
  if (h.eat) {
    const k = orderItemKey(h.item);
    return `${name} ${k !== null && DRINKS.has(k) ? '마시는 중' : '먹는 중'}`;
  }
  return `${name} 들고 있어요`;
}

/** 머무는 초 한 줄 ('테이블에서 9~13초' · '한 바퀴 14초'). 들고 가는 가게는 null. */
export function shopStayText(s: ShopId): string | null {
  const st = shopDef(s).stay;
  if (st === undefined) return null;
  const sec = st[0] === st[1] ? `${st[0]}초` : `${st[0]}~${st[1]}초`;
  // 회전목마는 한 번 타면 RIDE.carouselLaps 바퀴 (보이는 것과 맞게).
  if (s === 'carousel') return `한 번 타기 ${sec} (${RIDE.carouselLaps === 2 ? '두' : RIDE.carouselLaps} 바퀴)`;
  if (isRide(s)) return `한 바퀴 ${sec}`;
  const w = SHOP_SEAT[s];
  return w !== undefined ? `${w.seat}에서 ${sec}` : sec;
}

/** 가게가 손님에게 주는 것 한 줄 ('기분 +8 · 계속 진 손님은 끈기 +1'). 주인 입담은 기분에 더한다. sim/sim.ts applyShopEffect를 글로. */
export function shopEffectText(s: ShopId): string {
  const d = shopDef(s);
  const e = d.effect;
  const out: string[] = [];
  const pct = (x: number): string => `${Math.round(x * 100)}%`;
  if (s === 'flower_shop') out.push(`친한 손님에게 건네면 둘 다 기분 +${FLOWER.mood} (시무룩한 친구는 +${FLOWER.comfortMood})`);
  else if (s === 'fortune_teller') {
    const bad = 1 - FORTUNE.great.chance - FORTUNE.good.chance;
    // 묶음 안에서는 줄을 바꾸지 않는다 ('30%' 뒤 '↓'만 다음 줄로 가지 않게: 띄어쓰기 대신 붙는 빈칸).
    const nb = (t: string): string => t.replace(/ /g, '\u00a0');
    out.push(`${e.luck?.sec ?? 0}초 동안 운: ${nb(`대길 ${pct(FORTUNE.great.chance)}·길 ${pct(FORTUNE.good.chance)} ↑`)}, ${nb(`흉 ${pct(bad)} ↓`)}`);
    out.push(nb(`기분 대길 +${FORTUNE.great.mood}·길 +${FORTUNE.good.mood}·흉 −${Math.abs(FORTUNE.bad.mood)}`));
  } else if (s === 'hot_spring') out.push(`기분 +${e.mood} (처진 손님일수록 더)`);
  else out.push(`기분 +${e.mood}`);
  // 간식·온천의 끈기는 계속 진 손님만 (흐름 −2 이하).
  if (s === 'snack_stall' || s === 'hot_spring') out.push('계속 진 손님은 끈기 +1');
  else if (e.patience !== undefined && e.patience > 0) out.push(`끈기 +${e.patience}`);
  if (e.speed !== undefined) out.push(`${e.speed.sec}초 동안 걸음 ×${e.speed.mult}`);
  if (s === 'beauty_salon') out.push(`${SALON.sparkleSec.join('·')}초 (레벨) 반짝반짝, 그동안 져도 덜 속상해요`);
  if (e.wallet !== undefined) out.push(`지갑 ${pct(e.wallet)} 회복 (${e.walletMax ?? 0}코인까지)`);
  if (e.visitSec !== undefined) out.push(`${e.visitSec}초 더 머물러요`);
  if (s === 'restaurant') out.push(`좋아하는 메뉴면 기분 +${FOOD_LIKE.favoriteMood} 더, 가끔 배 터지게 먹고 드러누워요`);
  if (s === 'accessory_shop') out.push('몸에 달아요 (나중에 전당포에 맡길 수도…)');
  if (s === 'photo_studio') out.push('처음 찍은 종은 사진첩에');
  if (s === 'souvenir_shop') out.push('떠나는 길에 인형을 안고 가요');
  return out.join(' · ');
}

/** 이 가게에 오는 손님 한 줄 (손님이 가게를 고르는 마음, sim/shops.ts shopWant·urgeOf·hungerOf를 글로). */
export const SHOP_WHO: Readonly<Record<ShopId, string>> = {
  snack_stall: '배고픈 손님, 계속 진 손님, 아깝게 놓쳐 단 게 당기는 손님이 와요',
  drink_stand: '배고픈 손님, 오래 논 손님이 목을 축이러 와요 (아깝게 놓치면 코코아)',
  bakery: '끈기가 바닥난 손님, 배고픈 손님이 기운을 내러 와요',
  restaurant: '여러 판 논 배고픈 손님, 크게 딴 손님이 한턱 먹으러 와요',
  icecream_truck: '트럭이 서면 가까운 손님이 졸졸 따라와요',
  accessory_shop: '이긴 손님이 빈 머리·목·옆구리를 꾸미러 와요 (크게 따면 더)',
  beauty_salon: '기분이 그럭저럭인 손님, 크게 딴 손님이 와요 (한 방문에 한 번)',
  inn: '오래 논 지친 손님이 자러 와요 (한 방문에 한 번)',
  hot_spring: '기분이 처진 손님, 계속 진 손님이 녹으러 와요 (한 방문에 한 번)',
  fortune_teller: '막 놀기 시작한 손님, 계속 진 손님이 점을 보러 와요 (한 방문에 한 번)',
  carousel: '이긴 손님, 기분 좋은 손님이 타러 와요 (크게 따면 더)',
  ferris_wheel: '이긴 손님, 기분 좋은 손님이 타러 와요 (한 방문에 한 번)',
  photo_studio: '사진첩에 아직 없는 종, 크게 딴 손님이 더 자주 와요 (한 방문에 한 번)',
  souvenir_shop: '떠나는 길에 들러요: 이긴 손님, 지갑이 넉넉한 손님',
  flower_shop: '같이 논 친구가 마을에 있으면 와요 (친구가 시무룩하면 더)',
};

/** 이 메뉴를 좋아하는 종 (SPECIES_FOOD). */
export function fansOf(item: ShopItemId): SpeciesId[] {
  return SPECIES_IDS.filter((sp) => SPECIES_FOOD[sp] === item);
}

/** 레벨 lv의 자리 수 (지도 자리 수까지). */
export function seatsAt(s: ShopId, lv: number): number {
  const d = shopDef(s);
  if (d.service !== 'stay' && d.service !== 'ride') return 0;
  return Math.max(1, Math.min(d.slots[Math.max(0, lv - 1)] ?? d.slots[d.slots.length - 1] ?? 1, SHOP_LAYOUT[s].slots.length));
}

/** 레벨 lv의 값 범위 (장신구 가게는 그 레벨에 파는 장신구 값). */
function priceRangeAt(s: ShopId, lv: number): [number, number] {
  const d = shopDef(s);
  const i = Math.max(0, lv - 1);
  if (s === 'accessory_shop') {
    const mk = ACCESSORY_SHOP.markup[i] ?? ACCESSORY_SHOP.markup[ACCESSORY_SHOP.markup.length - 1] ?? 1;
    const ps = ACCESSORY_IDS.filter((k) => !ACCESSORIES[k].rare || (ACCESSORY_SHOP.rareFrom[k] ?? 99) <= lv).map((k) => {
      const [a, b] = ACCESSORIES[k].value;
      return Math.max(1, Math.round(Math.round((a + b) / 2) * mk));
    });
    return ps.length === 0 ? [0, 0] : [Math.min(...ps), Math.max(...ps)];
  }
  const base = d.price[i] ?? d.price[d.price.length - 1] ?? 0;
  const ks = d.menu.length === 0 ? [1] : d.menu.map((x) => x.k);
  const ps = ks.map((k) => Math.max(1, Math.round(base * k)));
  return [Math.min(...ps), Math.max(...ps)];
}

const range = ([a, b]: [number, number]): string => (a === b ? `${a}` : `${a}~${b}`);

/** 지금 레벨 lv 한 줄 ('값 6~8코인 · 계산 2.4초 · 자리 2'). */
export function shopLevelText(s: ShopId, lv: number): string {
  const d = shopDef(s);
  const i = Math.max(0, lv - 1);
  const out = [`값 ${range(priceRangeAt(s, lv))}코인`, `계산 ${d.serviceSec[i] ?? 0}초`];
  const seats = seatsAt(s, lv);
  if (seats > 0) out.push(`${SHOP_SEAT[s]?.seat ?? '자리'} ${seats}`);
  return out.join(' · ');
}

/** 다음 레벨에서 바뀌는 것 ('값 6~8 → 7~9코인 · 계산 2.4 → 2.1초 · 자리 2 → 3'). 최고 레벨이면 null. */
export function shopNextText(s: ShopId, lv: number): string | null {
  const d = shopDef(s);
  if (lv < 1 || lv > d.upgrade.length) return null;
  const out: string[] = [];
  const p0 = priceRangeAt(s, lv);
  const p1 = priceRangeAt(s, lv + 1);
  if (p0[0] !== p1[0] || p0[1] !== p1[1]) out.push(`값 ${range(p0)} → ${range(p1)}코인`);
  const a = d.serviceSec[lv - 1] ?? 0;
  const b = d.serviceSec[lv] ?? a;
  if (a !== b) out.push(`계산 ${a} → ${b}초`);
  const s0 = seatsAt(s, lv);
  const s1 = seatsAt(s, lv + 1);
  if (s1 > s0) out.push(`${SHOP_SEAT[s]?.seat ?? '자리'} ${s0} → ${s1}`);
  if (s === 'accessory_shop') {
    const fresh = ACCESSORY_IDS.filter((k) => ACCESSORY_SHOP.rareFrom[k] === lv + 1).map((k) => ACCESSORIES[k].name);
    if (fresh.length > 0) out.push(`새로 팔아요: ${fresh.join('·')}`);
  }
  return out.length > 0 ? out.join(' · ') : '조금 더 빨라져요';
}

/** 가게가 쉬는 까닭 한 줄 (shops.ts shopIdleReason). */
export function shopIdleText(why: 'stored' | 'road' | 'owner', cut: boolean): string {
  if (why === 'stored') return '보관함에 있어요. 지도에 놓으면 손님이 와요';
  if (why === 'road') return cut ? '입구 앞 길이 마을 입구와 끊겨 손님이 못 와요' : '입구가 길에 닿지 않아 손님이 못 와요';
  return '가게 주인이 없어 쉬는 중이에요';
}

/**
 * 손님의 가게 볼일 한 줄 (labels.ts monsterStatus가 부른다): '간식 노점에 가는 중' · '식당에서 파스타 먹는 중' · '여관에서 쿨쿨 자는 중' …
 * st가 있으면 놀이기구가 도는지 본다. friend = 꽃을 건넬 손님 이름. 가게 볼일이 아니면 null.
 */
export function shopPhaseText(m: Monster, st?: GameState, friend?: string): string | null {
  if (m.phase === 'toFriend') return friend !== undefined ? `${friend}에게 꽃을 주러 가는 중` : '친한 손님에게 꽃을 주러 가는 중';
  const s = m.shop ?? null;
  if (s === null) return null;
  const name = SHOPS[s].name;
  const w = SHOP_SEAT[s];
  switch (m.phase) {
    case 'toShop':
      return s === 'icecream_truck' ? '아이스크림 트럭을 졸졸 따라가는 중' : `${name}에 가는 중`;
    case 'shopQueue':
      return `${name} 줄 서는 중`;
    case 'buying':
      return isRide(s) ? `${name} 표 사는 중` : (SHOP_BUYING[s] ?? `${name}에서 ${josa(SHOP_SERVICE[s], '을', '를')} 사는 중`);
    case 'toShopSeat':
      return w !== undefined ? `${name} ${w.going}` : `${name}에 가는 중`;
    case 'atShop': {
      if (isRide(s)) {
        const r = st?.shops[s].ride ?? null;
        if (r !== null && r.phase === 'running' && r.riders.includes(m.id)) return `${name} ${w?.doing ?? '타는 중'}`;
        return st === undefined ? `${name} 타는 중` : `${name} 출발을 기다리는 중`;
      }
      if (s === 'restaurant') {
        const food = shopItemName(m.order?.item ?? null);
        return food !== '' ? `${name}에서 ${food} 먹는 중` : `${name}에서 먹는 중`;
      }
      if (s === 'hot_spring') return '온천에 몸 담그고 녹는 중';
      return w !== undefined ? `${name}에서 ${w.doing}` : `${name}에 있어요`;
    }
    default:
      return null;
  }
}

/** 짓기 권유 한마디 (목표 칩 '간식 노점을 지어 보세요: …'). */
export const SHOP_PITCH: Readonly<Record<ShopId, string>> = {
  snack_stall: '진 손님이 사 먹고 기운을 차려요',
  drink_stand: '마시면 걸음이 빨라져요',
  bakery: '지친 손님이 빵을 먹고 끈기를 내요',
  restaurant: '여러 판 논 손님이 든든히 먹어요',
  icecream_truck: '트럭이 길을 돌면 손님이 졸졸 모여요',
  accessory_shop: '이긴 손님이 장신구를 사서 달아요',
  beauty_salon: '손님이 반짝이며 나와요',
  inn: '지친 손님이 하룻밤 자고 더 머물러요',
  hot_spring: '기분이 처진 손님이 녹아내려요',
  fortune_teller: '점괘 한 장에 운이 오르락내리락',
  carousel: '이긴 손님이 신나게 빙글빙글',
  ferris_wheel: '손님이 마을을 한눈에 내려다봐요',
  photo_studio: '손님 사진이 사진첩에 모여요',
  souvenir_shop: '떠나는 손님이 인형을 안고 가요',
  flower_shop: '친한 손님끼리 꽃을 건네요',
};
