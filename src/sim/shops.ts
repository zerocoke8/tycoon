// 다섯째 묶음 (DESIGN 3.8: 손님이 돈을 쓰는 가게들)의 순수 도구. 숫자는 defs.ts (SHOPS·SHOP_VISIT·ACCESSORY_SHOP·TRUCK·RIDE·TIP …),
// 모양은 catalog.ts (SHOP_LAYOUT·CAROUSEL_GEO·FERRIS_GEO·TRUCK_GEO), 세계 좌표는 village.ts (shopSpot·carousel·ferris·truckHome).
//  - 가게 값·자리·열림 (shopOpen·shopIdleReason·shopPrice·shopSlots·shopServiceSec), 계산대·줄·자리 점 (트럭은 길 위의 트럭을 따라간다).
//  - 손님의 가게 고르기 (shopWant: 기분·끈기·지갑·최근 흐름 → 무게, chooseShop), 살 것 고르기 (pickOrder: 종마다 좋아하는 메뉴, 장신구 가게의 빈 몸 자리).
//  - 트럭 길 (truckPlan: 다음에 설 길 칸까지 칸 가운데 점들), 놀이기구 자리 (rideProgress·carouselAngle·ferrisAngle: 화면이 쓴다), 팁 (tipFor).
// 흐름(가게로 가기 → 줄 → 계산대 → 자리 → 효과·반응, 트럭·놀이기구 돌리기)은 sim.ts '다섯째 묶음'이 돌린다.

import type { Rng } from '../core/rng.ts';
import { ACCESSORIES, ACCESSORY_IDS, ACCESSORY_SHOP, FLOWER, FOOD_LIKE, FORTUNE, HUNGER, PAWN, PHOTO, RIDE, SALON, SHOP_IDS, SHOP_ITEMS, SHOP_URGE, SHOP_VISIT, SHOPS, SPECIES_FOOD, SPRING, TIP, TIP_TRAIT, TRUCK, URGE_MENU, URGE_SHOPS, shopDef, type AccessoryId, type OutcomeTier, type ShopId, type ShopItemId, type ShopUrge, type SpeciesId, type StaffStats, type TraitId } from '../data/defs.ts';
import { SHOP_LAYOUT, TRUCK_GEO } from '../data/catalog.ts';
import { CELL, GRID, cellAt, cellIndex, type Pt } from '../data/map.ts';
import { minPlayCost } from './booths.ts';
import { byLevel } from './economy.ts';
import { clampInto, dist, walkCells } from './path.ts';
import { TUNE } from './tuning.ts';
import type { Accessory, GameState, Monster, MonsterId, ShopOrder, ShopState, Staff, TruckState } from './types.ts';
import { isConnected, isPlaced, villageOf } from './village.ts';

/** 놀이기구인가 (한 바퀴를 같이 탄다). */
export const isRide = (s: ShopId): boolean => SHOPS[s].service === 'ride';
/** 머무는 자리가 있는 가게인가 (식당·미용실·여관·온천·사진관·놀이기구). */
export const hasSlots = (s: ShopId): boolean => SHOPS[s].service === 'stay' || SHOPS[s].service === 'ride';

/** 새 가게 상태 (아직 없다: 레벨 0). */
export function newShopState(s: ShopId): ShopState {
  return {
    level: 0,
    owner: null,
    queue: [],
    serving: null,
    slots: [],
    ride: isRide(s) ? { phase: 'idle', t: 0, duration: 0, riders: [] } : null,
    truck: s === 'icecream_truck' ? { x: 0, y: 0, path: [], stop: 0, facing: -1, parked: true, held: 0 } : null,
    served: 0,
    revenue: 0,
  };
}

/** 모든 가게의 새 상태. */
export function newShops(): Record<ShopId, ShopState> {
  const out = {} as Record<ShopId, ShopState>;
  for (const s of SHOP_IDS) out[s] = newShopState(s);
  return out;
}

/** 지었나 (레벨 1 이상: 보관함이든 지도든). */
export function shopOwned(state: GameState, s: ShopId): boolean {
  return (state.shops[s]?.level ?? 0) >= 1;
}

/** 가게 주인 (없으면 null). */
export function shopOwner(state: GameState, s: ShopId): Staff | null {
  const id = state.shops[s]?.owner ?? null;
  return id === null ? null : (state.staff.find((x) => x.id === id) ?? null);
}

/** 주인 능력치 (진행 = 계산대가 빨라진다, 입담 = 기분 +, 손님맞이 = 손님이 더 온다). 주인이 없으면 fallback. */
export function shopStat(state: GameState, s: ShopId, stat: keyof StaffStats, fallback = 2): number {
  return shopOwner(state, s)?.stats[stat] ?? fallback;
}

/** 손님을 받는다: 지었고, 주인이 있고, 놓여 입구가 길로 마을 입구와 이어졌다. */
export function shopIsOpen(state: GameState, s: ShopId): boolean {
  return shopOwned(state, s) && state.shops[s].owner !== null && isConnected(state, s);
}

/** 지은 가게가 손님을 받지 못하는 까닭 (받으면 null): 보관함 → 길 → 주인. 아직 없으면 null. */
export function shopIdleReason(state: GameState, s: ShopId): 'stored' | 'road' | 'owner' | null {
  if (!shopOwned(state, s)) return null;
  if (!isPlaced(state, s)) return 'stored';
  if (!isConnected(state, s)) return 'road';
  return state.shops[s].owner === null ? 'owner' : null;
}

/** 머무는·타는 자리 수 (레벨, 지도 자리 수까지). 들고 가는 가게는 0. */
export function shopSlots(state: GameState, s: ShopId): number {
  if (!hasSlots(s)) return 0;
  return Math.max(1, Math.min(byLevel(SHOPS[s].slots, Math.max(1, state.shops[s].level)), SHOP_LAYOUT[s].slots.length));
}

/** 자리 배열 길이를 맞춘다 (레벨이 오르면 자리가 늘어난다). */
export function fitShop(state: GameState, s: ShopId): void {
  const ss = state.shops[s];
  const n = shopSlots(state, s);
  while (ss.slots.length < n) ss.slots.push(null);
}

/** 계산대에서 사는 초 (주인 진행이 높을수록 빨리). */
export function shopServiceSec(state: GameState, s: ShopId): number {
  const pace = shopStat(state, s, 'pace');
  return byLevel(SHOPS[s].serviceSec, Math.max(1, state.shops[s].level)) / Math.max(0.5, 1 + (pace - 3) * TUNE.pacePerPoint);
}

/** 기본 값 × 메뉴 배수 k (반올림, 1코인 이상). */
export function shopPrice(state: GameState, s: ShopId, k = 1): number {
  return Math.max(1, Math.round(byLevel(SHOPS[s].price, Math.max(1, state.shops[s].level)) * k));
}

/** 이 가게의 값 범위 (UI: '4~6코인'). 장신구 가게는 파는 장신구 값의 범위. */
export function shopPriceRange(state: GameState, s: ShopId): [number, number] {
  if (s === 'accessory_shop') {
    const ps = accessoryStock(state).map((k) => accessoryPrice(state, k));
    return ps.length === 0 ? [0, 0] : [Math.min(...ps), Math.max(...ps)];
  }
  const menu = SHOPS[s].menu;
  if (menu.length === 0) {
    const p = shopPrice(state, s);
    return [p, p];
  }
  const ps = menu.map((x) => shopPrice(state, s, x.k));
  return [Math.min(...ps), Math.max(...ps)];
}

// ── 장신구 가게 ──

/** 장신구 가게가 파는 장신구 (레벨 1 = 귀하지 않은 것, 레벨이 오르면 ACCESSORY_SHOP.rareFrom). */
export function accessoryStock(state: GameState): AccessoryId[] {
  const lv = Math.max(1, state.shops.accessory_shop.level);
  return ACCESSORY_IDS.filter((k) => !ACCESSORIES[k].rare || (ACCESSORY_SHOP.rareFrom[k] ?? 99) <= lv);
}

/** 장신구 값의 가운데 (산 장신구의 value: 전당포가 그만큼 빌려준다). */
export function accessoryMid(k: AccessoryId): number {
  const [a, b] = ACCESSORIES[k].value;
  return Math.round((a + b) / 2);
}

/** 장신구 가게의 값 = 값 가운데 × ACCESSORY_SHOP.markup[레벨-1]. */
export function accessoryPrice(state: GameState, k: AccessoryId): number {
  return Math.max(1, Math.round(accessoryMid(k) * byLevel(ACCESSORY_SHOP.markup, Math.max(1, state.shops.accessory_shop.level))));
}

/** 손님이 살 수 있는 장신구 (몸 자리가 비었고 (단 것·맡긴 것 없음) 그 종에게 빠지지 않은 것). */
export function accessoryChoices(state: GameState, m: Monster): AccessoryId[] {
  const used = new Set([...m.accessories, ...m.pawned].map((a) => a.slot));
  return accessoryStock(state).filter((k) => {
    const d = ACCESSORIES[k];
    const ex: readonly SpeciesId[] = 'exclude' in d ? d.exclude : [];
    return !used.has(d.slot) && !ex.includes(m.species);
  });
}

// ── 살 것 ──

/** 처음 지갑 (지갑 + 쓴 코인 - 받은 코인: 가게에 낸 코인도 쓴 코인, 여관 지갑 회복은 받은 코인). */
export const startWallet = (m: Monster): number => m.wallet + m.stats.spent - m.stats.won;

/**
 * 낸 뒤에도 남길 코인 (떠나는 길이면 0): 가장 싼 한판 × min(남은 끈기, SHOP_VISIT.reserveRounds)과 처음 지갑 × SHOP_VISIT.reserveLow 가운데 큰 것.
 * 처음 지갑 몫은 '돈이 떨어짐' 선 (PAWN.lowFrac)보다 높다: 가게에서 쓴 코인 때문에 전당포·은행으로 가지 않는다 (딴 손님은 딴 만큼 넉넉히 쓴다).
 */
export function shopReserve(state: GameState, m: Monster, homeward: boolean): number {
  if (homeward) return 0;
  const min = minPlayCost(state);
  const rounds = Number.isFinite(min) ? min * Math.max(1, Math.min(m.patience, SHOP_VISIT.reserveRounds)) : 0;
  return Math.max(rounds, startWallet(m) * Math.max(PAWN.lowFrac, SHOP_VISIT.reserveLow));
}

/** 그림 이름 ('items/food_waffle'). */
export const itemArt = (key: ShopItemId): string => `items/${key}`;

/**
 * 손님 m이 가게 s에서 살 것 (값은 지금 값). 지갑으로 낼 수 없으면 (남길 코인 reserve) null.
 * 메뉴는 종이 좋아하는 메뉴를 FOOD_LIKE.favorite배, 지금 마음 (urgeOf)에 끌리는 메뉴를 URGE_MENU배, 장신구 가게는 비어 있는 몸 자리의 값 싼 것 쪽으로, 기념품은 그 종 인형.
 */
export function pickOrder(state: GameState, rng: Rng, m: Monster, s: ShopId, reserve: number): ShopOrder | null {
  const budget = m.wallet - reserve;
  if (s === 'accessory_shop') {
    const cands = accessoryChoices(state, m).filter((k) => accessoryPrice(state, k) <= budget);
    if (cands.length === 0) return null;
    const k = rng.weighted(cands.map((x) => [x, ACCESSORIES[x].weight] as const));
    const d = ACCESSORIES[k];
    return { item: `items/${k}`, price: accessoryPrice(state, k), accessory: { key: k, slot: d.slot, value: accessoryMid(k) } };
  }
  if (s === 'souvenir_shop') {
    const price = shopPrice(state, s);
    return price <= budget ? { item: `objects/plush_${m.species}`, price } : null;
  }
  const menu = SHOPS[s].menu;
  if (menu.length === 0) {
    const price = shopPrice(state, s);
    return price <= budget ? { item: null, price } : null;
  }
  const fav = SPECIES_FOOD[m.species];
  const ok = menu.filter((x) => shopPrice(state, s, x.k) <= budget);
  if (ok.length === 0) return null;
  const urge = urgeOf(state, m);
  const lean: Partial<Record<ShopItemId, number>> = urge === null ? {} : URGE_MENU[urge];
  const pick = rng.weighted(ok.map((x) => [x, x.w * (x.item === fav ? FOOD_LIKE.favorite : 1) * (lean[x.item] ?? 1)] as const));
  return { item: itemArt(pick.item), price: shopPrice(state, s, pick.k) };
}

/** 그림 이름 → 가게 메뉴 key ('items/food_waffle' → 'food_waffle', 아니면 null). */
export function orderItemKey(item: string | null): ShopItemId | null {
  if (item === null || !item.startsWith('items/')) return null;
  const k = item.slice('items/'.length);
  return k in SHOP_ITEMS ? (k as ShopItemId) : null;
}

// ── 손님의 가게 고르기 ──

/** 이번 방문에 이 가게에 들렀나. */
export const visited = (m: Monster, s: ShopId): boolean => (m.shopsVisited ?? []).includes(s);

/** 마을에 있는 친한 손님 (꽃 선물: 떠나지 않고 일터·숨은 자리에 있지 않은 손님). */
export function friendsHere(state: GameState, m: Monster): Monster[] {
  const ids = m.friends ?? [];
  if (ids.length === 0) return [];
  return state.monsters.filter((o) => o !== m && ids.includes(o.id) && o.phase !== 'leaving' && o.phase !== 'arriving' && o.bankrupt !== true && o.hidden !== true);
}

/** 한자리에 머무는 phase (꽃을 건네러 가면 닿기 쉽다). */
const STILL: ReadonlySet<Monster['phase']> = new Set(['playing', 'queued', 'resting', 'spectating', 'shopQueue', 'atShop', 'reacting']);

/**
 * 꽃을 건넬 친구: 시무룩한 친구 (기분 FLOWER.sadBelow 아래, 가장 처진 친구) 먼저, 그다음 단체 놀이를 같이 한 친구, 그 가운데 한자리에 있는 (STILL) 가까운 친구
 * (걸어 다니는 친구는 거리 × 2로 친다). 없으면 null.
 */
export function giftTarget(state: GameState, m: Monster): { friend: Monster; comfort: boolean } | null {
  const fs = friendsHere(state, m);
  if (fs.length === 0) return null;
  const sad = fs.filter((o) => o.mood < FLOWER.sadBelow).sort((a, b) => a.mood - b.mood)[0];
  if (sad !== undefined) return { friend: sad, comfort: true };
  const group = m.groupFriends ?? [];
  const pool = fs.some((o) => group.includes(o.id)) ? fs.filter((o) => group.includes(o.id)) : fs;
  const far = (o: Monster): number => dist(o.pos, m.pos) * (STILL.has(o.phase) && o.path.length === 0 ? 1 : 2);
  let f = pool[0] as Monster;
  for (const o of pool) if (far(o) < far(f)) f = o;
  return { friend: f, comfort: false };
}

/** 트럭이 길에 나와 있고 손님 가까이 (TRUCK.callRadius) 있나. */
export function truckNear(state: GameState, m: Monster): boolean {
  const t = state.shops.icecream_truck.truck;
  return t !== null && !t.parked && dist(m.pos, t) <= TRUCK.callRadius;
}

/** 먹거리 가게인가 (배고픔·미식가·마지막으로 먹은 때). */
export const isFood = (s: ShopId): boolean => SHOPS[s].category === 'food';

/** 지금 남아 있는 마음 (끝났으면 null). */
export function urgeOf(state: GameState, m: Monster): ShopUrge | null {
  const u = m.urge ?? null;
  return u !== null && u.until > state.time ? u.kind : null;
}

/**
 * 한판 결과가 남기는 마음 (흐름·기분은 이미 고친 뒤): 대박·항아리 축제·이기는 흐름 = celebrate, 아깝게 놓침 = sweet,
 * 지는 흐름 (SHOP_URGE.comfortStreak 이하)·지고 기분 낮음 = comfort. 아무것도 아니면 남은 마음 그대로 (끝났으면 null).
 */
export function urgeAfter(m: Monster, tier: OutcomeTier, festival: boolean, now: number): { kind: ShopUrge; until: number } | null {
  const streak = m.streak ?? 0;
  const until = now + SHOP_URGE.sec;
  if (tier === 'jackpot' || festival || streak >= SHOP_URGE.celebrateStreak) return { kind: 'celebrate', until };
  if (tier === 'nearMiss') return { kind: streak <= SHOP_URGE.comfortStreak ? 'comfort' : 'sweet', until };
  if (tier === 'lose' && (streak <= SHOP_URGE.comfortStreak || m.mood < SHOP_URGE.lowMood)) return { kind: 'comfort', until };
  const u = m.urge ?? null;
  return u !== null && u.until > now ? u : null;
}

/** 배고픔 배수 (먹거리 무게): 마지막으로 먹은 때 (없으면 온 때)부터 HUNGER.sec초면 1, HUNGER.min~max. */
export function hungerOf(state: GameState, m: Monster): number {
  const since = state.time - (m.ateAt ?? m.born ?? state.time);
  return Math.max(HUNGER.min, Math.min(HUNGER.max, since / HUNGER.sec));
}

/**
 * 손님 m이 가게 s에 가고 싶은 무게 (0 = 안 간다). 열림·자리·지갑은 chooseShop이 본다. streak = 최근 흐름, urge = 결과가 남긴 마음 (urgeOf).
 * 묶음마다: 먹거리 = 배고픔 × (지는 흐름·미식가·기분 낮음), 장신구·놀이기구·사진 = 이기는 흐름·좋은 기분, 쉼 = 기분 낮음 (온천)·지침 (여관),
 * 점집 = 막 놀기 시작했거나 계속 진 손님 ('점이라도 볼까'), 꽃 = 친한 손님 (단체 놀이 친구·시무룩한 친구면 더).
 * 기념품은 떠나는 길에만 (sim leave). once 가게·이미 들른 가게는 덜 (once면 0, 먹거리는 배고픔이 대신 본다).
 */
export function shopWant(state: GameState, m: Monster, s: ShopId, age: number): number {
  const d = shopDef(s);
  if (s === 'souvenir_shop') return 0;
  if (visited(m, s) && d.once === true) return 0;
  const streak = m.streak ?? 0;
  const win = streak > 0 || m.hadJackpot;
  const lose = streak < 0;
  const mood = m.mood;
  const foodie = m.traits.includes('foodie');
  let w = 1;
  switch (s) {
    case 'snack_stall':
    case 'drink_stand':
    case 'bakery':
    case 'restaurant':
    case 'icecream_truck':
      w = (1 + (lose ? 0.6 * Math.min(3, -streak) : 0)) * hungerOf(state, m);
      if (foodie) w *= 2;
      if (mood < 40) w *= 1.5;
      if (s === 'bakery' && m.patience <= 2) w *= 2;
      if (s === 'drink_stand' && age > 120) w *= 1.3;
      if (s === 'restaurant') w *= m.stats.rounds >= 3 ? 1.2 : 0.4;
      if (s === 'icecream_truck') w = truckNear(state, m) ? w * 3 : 0;
      break;
    case 'accessory_shop':
      w = accessoryChoices(state, m).length === 0 ? 0 : win ? ACCESSORY_SHOP.wantWin : ACCESSORY_SHOP.other;
      break;
    case 'beauty_salon':
      w = (mood >= 30 && mood <= 75 ? 1.2 : 0.7) * (win ? 1.5 : 1);
      break;
    case 'inn':
      // 오래 논 지친 손님 (끈기가 바닥이거나 아주 오래 머묾).
      w = age > 150 && m.patience <= 3 ? 2.2 : age > 300 && mood >= 40 ? 1 : 0;
      break;
    case 'hot_spring':
      w = mood < 45 ? 2.5 : mood < 65 ? 1 : 0.5;
      if (streak <= -2) w *= 1.5;
      break;
    case 'fortune_teller':
      w = m.stats.rounds < 3 ? 1.4 : streak <= -2 ? 1.2 : 0.6;
      break;
    case 'carousel':
    case 'ferris_wheel':
      w = (win ? 2 : 1) * (mood >= 60 ? 1.5 : mood < 30 ? 0.4 : 1);
      break;
    case 'photo_studio':
      w = ((state.photoAlbum[m.species] ?? -1) < 0 ? PHOTO.newSpecies : 1) * (mood >= 55 ? 1.3 : 0.7);
      break;
    case 'flower_shop': {
      const fs = friendsHere(state, m);
      const sad = fs.some((o) => o.mood < FLOWER.sadBelow);
      const group = m.groupFriends ?? [];
      w = fs.length > 0 && mood >= (sad ? FLOWER.comfortMinMood : FLOWER.minMood) ? FLOWER.want * (fs.some((o) => group.includes(o.id)) ? FLOWER.group : 1) * (sad ? FLOWER.comfort : 1) : 0;
      break;
    }
    default:
      break;
  }
  const urge = urgeOf(state, m);
  if (urge !== null && URGE_SHOPS[urge].includes(s)) w *= SHOP_URGE.weight;
  if (visited(m, s)) w *= isFood(s) ? 0.5 : 0.15;
  return Math.max(0, w);
}

/** 줄에 설 자리가 있나 (줄 SHOP_VISIT.queueCap까지, 트럭은 트럭 둘레 자리까지). */
export function shopHasRoom(state: GameState, s: ShopId): boolean {
  const cap = s === 'icecream_truck' ? TRUCK_GEO.queue.length : SHOP_VISIT.queueCap;
  return state.shops[s].queue.length < cap;
}

/**
 * 손님 m이 지금 갈 가게와 살 것 (없으면 null): 열린 가게 가운데 shopWant × 주인 손님맞이 ÷ 걷는 거리 (1 + 길 칸 / SHOP_VISIT.nearCells),
 * 줄 자리가 있고 살 것이 있는 (지갑으로 낼 수 있는) 가게만. age = 머문 초.
 */
export function chooseShop(state: GameState, rng: Rng, m: Monster, age: number): { shop: ShopId; order: ShopOrder } | null {
  const reserve = shopReserve(state, m, false);
  const cands: [ShopId, number][] = [];
  for (const s of SHOP_IDS) {
    if (!shopIsOpen(state, s) || !shopHasRoom(state, s)) continue;
    if (s === 'icecream_truck' && state.shops[s].truck?.parked !== false) continue;
    let w = shopWant(state, m, s, age);
    if (w <= 0) continue;
    w *= Math.max(0.3, 1 + (shopStat(state, s, 'welcome') - 3) * TUNE.welcomePerPoint);
    const d = s === 'icecream_truck' ? Math.round(dist(m.pos, state.shops[s].truck as Pt) / CELL) : walkCells(state, m.pos, s);
    if (d < 0) continue;
    w /= 1 + d / SHOP_VISIT.nearCells;
    cands.push([s, w]);
  }
  while (cands.length > 0) {
    const s = rng.weighted(cands);
    const order = pickOrder(state, rng, m, s, reserve);
    if (order !== null) return { shop: s, order };
    cands.splice(
      cands.findIndex((c) => c[0] === s),
      1,
    );
  }
  return null;
}

// ── 계산대·줄·자리 (세계 좌표) ──

/** 트럭 자리 (길 위면 트럭, 차고면 차고 자리). */
export function truckPos(state: GameState): Pt {
  const t = state.shops.icecream_truck.truck;
  return t === null || t.parked ? villageOf(state).truckHome() : { x: t.x, y: t.y };
}

/** 사는 손님이 서는 점 (트럭은 트럭 앞). */
export function shopCounterPt(state: GameState, s: ShopId): Pt {
  if (s === 'icecream_truck') {
    const p = truckPos(state);
    return { x: p.x + TRUCK_GEO.serve.x, y: p.y + TRUCK_GEO.serve.y };
  }
  return villageOf(state).shopSpot(s).counter;
}

/** 줄 i번째 자리 (목록보다 길면 마지막 두 점 방향으로 늘이고 발자국 안으로, 트럭은 트럭 둘레: 넷째 뒤로는 길 칸 안 네 귀퉁이로 엇갈린다). */
export function shopQueuePt(state: GameState, s: ShopId, i: number): Pt {
  if (s === 'icecream_truck') {
    const p = truckPos(state);
    const n = TRUCK_GEO.queue.length;
    const q = TRUCK_GEO.queue[i] ?? TRUCK_GEO_MORE[(i - n) % TRUCK_GEO_MORE.length] ?? TRUCK_GEO.serve;
    return { x: p.x + q.x, y: p.y + q.y };
  }
  const q = villageOf(state).shopSpot(s).queue;
  const p = q[i];
  if (p !== undefined) return p;
  const last = q[q.length - 1] ?? shopCounterPt(state, s);
  const prev = q[q.length - 2] ?? shopCounterPt(state, s);
  const k = i - (q.length - 1);
  return clampInto(state, s, { x: last.x + (last.x - prev.x) * k, y: last.y + (last.y - prev.y) * k });
}

/** 트럭 줄이 넷보다 길 때 (같은 길 칸 안, 앞 넷과 겹치지 않게 귀퉁이 쪽). */
const TRUCK_GEO_MORE: readonly Pt[] = [
  { x: -44, y: -40 },
  { x: 44, y: -40 },
  { x: -44, y: 44 },
  { x: 44, y: 44 },
  { x: -10, y: -44 },
  { x: 12, y: 46 },
];

/**
 * 들고 가는 가게에서 산 손님이 반응하러 비켜서는 점 (계산대를 다음 손님에게 비운다). 없으면 null (그 자리에서 반응).
 * 트럭은 트럭 옆 길 칸 (오른쪽·왼쪽·아래·위 가운데 걸을 수 있는 첫 칸, 줄과 같은 높이).
 */
export function shopPickupPt(state: GameState, s: ShopId): Pt | null {
  if (s !== 'icecream_truck') return villageOf(state).shopSpot(s).pickup;
  const t = state.shops.icecream_truck.truck;
  if (t === null || t.parked) return null;
  const v = villageOf(state);
  const c = cellAt(t);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const n = cellIndex(c.x + dx, c.y + dy);
    if (n >= 0 && v.isWalkable(n)) {
      const p = cellPt(n);
      return { x: p.x + dx * 6, y: p.y + (dy === 0 ? TRUCK_GEO.serve.y : dy * 10) };
    }
  }
  return null;
}

/** 머무는·타는 자리 i (세계 좌표). */
export function shopSlotPt(state: GameState, s: ShopId, i: number): Pt {
  const sp = villageOf(state).shopSpot(s);
  return sp.slots[i] ?? sp.slots[0] ?? sp.counter;
}

/** 자리 i에서 바라보는 점. */
export function shopSlotLook(state: GameState, s: ShopId, i: number): Pt {
  const sp = villageOf(state).shopSpot(s);
  return sp.slotLook[i] ?? sp.owner;
}

/** 머무는 초 (SHOPS.stay 사이, 놀이기구는 한 바퀴 = stay[0]). */
export function shopStaySec(rng: Rng, s: ShopId): number {
  const st = SHOPS[s] as { stay?: readonly [number, number] };
  const r = st.stay ?? [4, 4];
  return isRide(s) ? r[0] : rng.range(r[0], r[1]);
}

// ── 아이스크림 트럭 ──

/** 칸 번호 → 칸 가운데. */
const cellPt = (i: number): Pt => ({ x: (i % GRID.w) * CELL + CELL / 2, y: Math.floor(i / GRID.w) * CELL + CELL / 2 });

/** 트럭이 선 칸 (지도 밖이면 -1). */
export function truckCell(t: Pick<TruckState, 'x' | 'y'>): number {
  const c = cellAt(t);
  return cellIndex(c.x, c.y);
}

/**
 * 트럭의 다음 길: 지금 칸에서 TRUCK.driveCells 칸쯤 떨어진 걸을 수 있는 길 칸 하나 (마을 입구 앞 칸은 빼고, 손님이 많은 쪽이면 더),
 * 꺾이는 칸 가운데 점들 (지금 칸 빼고). 갈 데가 없으면 빈 목록.
 */
export function truckPlan(state: GameState, rng: Rng, from: number): Pt[] {
  const v = villageOf(state);
  if (!v.isWalkable(from)) return [];
  const g = v.placed('gate');
  const ge = g === undefined ? -1 : v.entryCellIndex(g);
  const [d0, d1] = TRUCK.driveCells;
  const cands: [number, number][] = [];
  // 손님 무게: 칸마다 근처 손님 수 (멀면 덜).
  const guests = state.monsters.filter((m) => m.phase !== 'leaving' && m.phase !== 'arriving' && m.bankrupt !== true).map((m) => m.pos);
  const field = v.fieldTo(from);
  // 사지 않은 땅 (구름) 가장자리 칸은 거의 안 고른다: 트럭과 모인 손님이 구름에 반쯤 묻힌다 (가로 2칸·세로 1칸 여유).
  const edgy = (i: number): boolean => {
    const cx = i % GRID.w;
    const cy = (i - cx) / GRID.w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const n = cellIndex(cx + dx, cy + dy);
        if (n < 0 || v.owned[n] !== 1) return true;
      }
    }
    return false;
  };
  for (const i of v.walkable) {
    if (i === ge || i === from) continue;
    const d = field[i] ?? -1;
    if (d < d0 || d > d1) continue;
    const p = cellPt(i);
    let n = 0;
    for (const q of guests) if (Math.abs(q.x - p.x) < 480 && Math.abs(q.y - p.y) < 480) n++;
    cands.push([i, (1 + n) * (edgy(i) ? 0.04 : 1)]);
  }
  if (cands.length === 0) {
    // 짧은 길뿐: 가장 먼 칸으로.
    let best = -1;
    let bd = 0;
    for (const i of v.walkable) {
      const d = field[i] ?? -1;
      if (i !== ge && d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) return [];
    cands.push([best, 1]);
  }
  const to = rng.weighted(cands);
  const cells = v.cellPath(from, to);
  if (cells === null || cells.length < 2) return [];
  return turnPoints(cells);
}

/** 칸 길 (첫 칸 = 지금 칸) → 꺾이는 칸 가운데 점들 (첫 칸 빼고, 곧은 길 가운데 칸은 뺀다): 칸 가운데를 잇는 선은 늘 길 칸 위를 지난다. */
function turnPoints(cells: readonly number[]): Pt[] {
  const out: Pt[] = [];
  for (let k = 1; k < cells.length; k++) {
    const a = cells[k - 1] as number;
    const b = cells[k] as number;
    const c = cells[k + 1];
    if (c === undefined || b - a !== c - b) out.push(cellPt(b));
  }
  return out;
}

/** 트럭이 지금 자리에서 path를 따라 지나는 칸이 모두 걸을 수 있는 길인가 (꺾이는 점 사이 곧은 길 칸까지, 1/4칸마다 본다). */
export function truckRouteOk(state: GameState, t: Pick<TruckState, 'x' | 'y' | 'path'>): boolean {
  const v = villageOf(state);
  let x = t.x;
  let y = t.y;
  for (const p of t.path) {
    const n = Math.max(1, Math.ceil(Math.hypot(p.x - x, p.y - y) / (CELL / 4)));
    for (let k = 1; k <= n; k++) {
      if (!v.isWalkable(truckCell({ x: x + ((p.x - x) * k) / n, y: y + ((p.y - y) * k) / n }))) return false;
    }
    x = p.x;
    y = p.y;
  }
  return true;
}

/** 가던 곳 (path 끝 칸)으로 가는 새 길 (지금 칸에서, 길이 끊겼을 때). 칸 가운데에서 비켜 있으면 칸 가운데를 먼저 지난다. 갈 수 없으면 빈 목록. */
export function truckReroute(state: GameState, t: Pick<TruckState, 'x' | 'y' | 'path'>): Pt[] {
  const last = t.path[t.path.length - 1];
  if (last === undefined) return [];
  const v = villageOf(state);
  const from = truckCell(t);
  const cells = v.cellPath(from, truckCell(last));
  if (cells === null || cells.length < 2) return [];
  const out = turnPoints(cells);
  // 첫 걸음과 엇갈린 쪽으로 비켜 있으면 (가로로 가는데 칸 가운데 위·아래) 칸 가운데로 먼저: 비스듬히 칸 모서리를 지나지 않게.
  const c0 = cellPt(from);
  const across = Math.abs((cells[1] as number) - from) === 1 ? Math.abs(t.y - c0.y) : Math.abs(t.x - c0.x);
  if (across > 0.5) out.unshift(c0);
  return out;
}

/** 트럭을 dt초만큼 path를 따라 움직인다 (TRUCK.speed). 바라보는 쪽은 가로로 움직이는 쪽. */
export function stepTruck(t: TruckState, dt: number): void {
  let budget = TRUCK.speed * dt;
  while (budget > 0 && t.path.length > 0) {
    const p = t.path[0] as Pt;
    const dx = p.x - t.x;
    const dy = p.y - t.y;
    const d = Math.hypot(dx, dy);
    if (Math.abs(dx) > 0.5) t.facing = dx > 0 ? 1 : -1;
    if (d <= budget) {
      t.x = p.x;
      t.y = p.y;
      budget -= d;
      t.path.shift();
    } else {
      t.x += (dx / d) * budget;
      t.y += (dy / d) * budget;
      budget = 0;
    }
  }
}

// ── 놀이기구 (화면이 쓴다) ──

/** 한 바퀴 진행 0~1 (달리지 않으면 0). */
export function rideProgress(ss: ShopState): number {
  const r = ss.ride;
  if (r === null || r.phase !== 'running' || !(r.duration > 0)) return 0;
  return Math.max(0, Math.min(1, r.t / r.duration));
}

/** 회전목마 목마 i의 각도 (rad, 화면 좌표: π/2 = 앞). progress = rideProgress. */
export function carouselAngle(i: number, horses: number, progress: number): number {
  const ease = progress * progress * (3 - 2 * progress);
  return Math.PI / 2 + (i * Math.PI * 2) / horses + ease * RIDE.carouselLaps * Math.PI * 2;
}

/** 관람차 곤돌라 j의 각도 (rad, π/2 = 맨 아래). */
export function ferrisAngle(j: number, gondolas: number, progress: number): number {
  const ease = progress * progress * (3 - 2 * progress);
  return Math.PI / 2 + (j * Math.PI * 2) / gondolas + ease * RIDE.ferrisLaps * Math.PI * 2;
}

// ── 팁·흐름·친구 ──

/**
 * 크게 딴 손님이 진행자에게 줄 팁 (주지 않으면 0): 받은 코인 TIP.minPayout 이상이고 건 코인의 TIP.bigMult배 이상, 또는 대박·항아리 축제일 때
 * 확률 TIP.chance (대박 jackpotChance, 성격 TIP_TRAIT배)로 받은 코인의 TIP.share (1~TIP.max). 크게 딴 때만 난수를 쓴다.
 */
export function tipFor(payout: number, bet: number, tier: OutcomeTier, festival: boolean, rng: Rng, traits: readonly TraitId[] = []): number {
  const big = tier === 'jackpot' || festival;
  if (!big && !(payout >= TIP.minPayout && payout >= bet * TIP.bigMult)) return 0;
  const k = traits.reduce((a, t) => a * (TIP_TRAIT[t] ?? 1), 1);
  if (!rng.chance(Math.min(0.95, (big ? TIP.jackpotChance : TIP.chance) * k))) return 0;
  return Math.max(1, Math.min(TIP.max, Math.round(payout * TIP.share)));
}

/** 한판 결과로 흐름을 고친다 (이기면 +1·대박 +2, 아깝게 지거나 지면 -1, ±SHOP_VISIT.streakMax). */
export function nextStreak(streak: number, tier: OutcomeTier): number {
  const s = tier === 'jackpot' ? Math.max(0, streak) + 2 : tier === 'win' ? Math.max(0, streak) + 1 : Math.min(0, streak) - 1;
  return Math.max(-SHOP_VISIT.streakMax, Math.min(SHOP_VISIT.streakMax, s));
}

/** 친한 손님을 더한다 (최근 것이 앞, FLOWER.friendsMax명까지). */
export function addFriends(m: Monster, ids: readonly MonsterId[]): void {
  const list = (m.friends ??= []);
  for (const id of ids) {
    if (id === m.id) continue;
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    list.unshift(id);
  }
  if (list.length > FLOWER.friendsMax) list.length = FLOWER.friendsMax;
}

/** 장신구 하나 (산 것: 몸에 단다). */
export function boughtAccessory(o: ShopOrder): Accessory | null {
  return o.accessory ?? null;
}

// ── 가게 효과의 결 ──

/** 점괘 하나: 대길·길·흉 (주인 입담이 높을수록 흉이 준다, defs.ts FORTUNE). */
export function rollFortune(rng: Rng, charm: number): 'great' | 'good' | 'bad' {
  const shift = (charm - 3) * FORTUNE.charmShift;
  const great = FORTUNE.great.chance;
  const good = Math.max(0, Math.min(1 - great, FORTUNE.good.chance + shift));
  const r = rng.next();
  return r < great ? 'great' : r < great + good ? 'good' : 'bad';
}

/** 미용실 반짝이 초 (레벨, 주인 입담: defs.ts SALON). */
export function salonSparkleSec(state: GameState): number {
  const lv = Math.max(1, state.shops.beauty_salon.level);
  return byLevel(SALON.sparkleSec, lv) + Math.max(0, shopStat(state, 'beauty_salon', 'charm') - 3) * SALON.perCharm;
}

/** 온천에서 더 오르는 기분 (처진 손님일수록: defs.ts SPRING). */
export const springBonus = (mood: number): number => Math.max(0, (SPRING.toward - mood) * SPRING.k);

/** 반짝이는 중인가 (미용실). */
export const sparkling = (m: Monster): boolean => (m.buffs?.sparkleSec ?? 0) > 0;

/** 지금 운 (점괘가 남은 동안 ±, 없으면 0). */
export const fortuneLuck = (m: Monster): number => ((m.buffs?.luckSec ?? 0) > 0 ? (m.buffs?.luck ?? 0) : 0);
