// 먹거리·꾸미기·선물 가게 연출 (다섯째 묶음, DESIGN 3.8): view/shops.ts (기초: 가게 그림·주인·놀이기구)가 그린 뒤, 손님을 그리기 전에 돌린다 (world.ts).
//  - 가게 주인 몸짓 (FOOD_SHOPS): 숨쉬기(shops.ts) 위에 가끔 살랑·톡·두리번, 계산대에 손님이 있으면 바쁘게 통통, 팔면 톡 하고 산 것을 손님 손으로 날린다 (손님 코인은 주인에게).
//  - 간식·음료·빵·꽃다발·인형: 주인 손에서 손님 손으로 날아간다 (그동안 손님 손에 든 것은 숨긴다: monsterView holdHeld). 먹고 마시기·안기는 held.ts.
//  - 식당: 테이블 의자에 앉아 (몸 맡기기: 뒤 의자는 테이블 뒤, 앞 의자는 테이블 앞), 주인이 접시를 테이블로 날린다, 냠냠 숙여 먹고 접시가 줄어든다,
//    배 터지게 먹으면 (shopConsumed stuffed) 테이블 옆에 벌러덩 누워 배가 들썩.
//  - 아이스크림 트럭: truck.ts (TruckView, 여기서 만든다).
//  - 장신구 가게: 새 장신구가 주인 손에서 손님 몸 그 자리로 날아와 반짝 (그동안 몸에 그리지 않는다: holdAccessory).
//  - 미용실: 문으로 들어가며 흐려지고, 안에 손님이 있으면 주인도 들어가 창에서 싹둑 반짝·털 뭉치 (손님 색), 나오면 반짝 와르르 (그 뒤 한동안 반짝이는 monsterView).
//  - 기념품 가게: 인형이 날아와 품에 쏙 (하트), 안고 떠난다. 꽃집: 꽃다발이 손님 손으로, 친구에게 건네면 (giftGiven) 꽃다발이 친구 손으로 날아가 둘 다 하트·꽃잎.
//  - 가게 둘레 작은 움직임: 식당·빵집 굴뚝 연기, 장신구 진열창·꽃집·기념품 가게 반짝 (열려 있고 화면에 보일 때만).
// sim은 읽기만 한다. 화면 연출용 무작위라 Math.random을 쓴다.

import { Container } from 'pixi.js';
import type { ShopPart } from '../data/catalog.ts';
import { ACCESSORIES, SPECIES, type AccessoryId, type ShopId } from '../data/defs.ts';
import type { SimApi } from '../sim/api.ts';
import { shopIsOpen } from '../sim/shops.ts';
import type { MonsterId } from '../sim/types.ts';
import { ArtNode, artMeta, artTexture } from './art.ts';
import type { FxLayer } from './fx.ts';
import { clamp, type ViewRect } from './mapUtil.ts';
import type { MonstersView, MonsterView } from './monsterView.ts';
import type { ShopsView } from './shops.ts';
import { Bits, Flights } from './shopsFx.ts';
import { TruckView } from './truck.ts';

/** 이 파일이 주인 몸짓·연출을 맡는 가게 (놀이기구·쉼·점집·사진관은 다른 화면 파일). 트럭 주인은 truck.ts (창 속). */
export const FOOD_SHOPS: readonly ShopId[] = ['snack_stall', 'drink_stand', 'bakery', 'restaurant', 'accessory_shop', 'beauty_salon', 'souvenir_shop', 'flower_shop'];

/**
 * 가게 둘레 작은 움직임: 대표 그림 (parts[0]) 처리본 안 비율 점 (fx, fy), 종류, 사이 초 (범위).
 * smoke = 굴뚝 연기 (위로 둥실), glint = 진열창 반짝.
 */
const AMBIENT: Partial<Record<ShopId, { readonly fx: number; readonly fy: number; readonly kind: 'smoke' | 'glint'; readonly every: readonly [number, number] }>> = {
  restaurant: { fx: 0.42, fy: 0.05, kind: 'smoke', every: [1.4, 2.2] },
  bakery: { fx: 0.785, fy: 0.07, kind: 'smoke', every: [1.6, 2.6] },
  accessory_shop: { fx: 0.32, fy: 0.62, kind: 'glint', every: [2.2, 4] },
  flower_shop: { fx: 0.36, fy: 0.72, kind: 'glint', every: [2.6, 4.6] },
  souvenir_shop: { fx: 0.3, fy: 0.62, kind: 'glint', every: [3, 5] },
  snack_stall: { fx: 0.32, fy: 0.52, kind: 'glint', every: [3.2, 5.2] },
};
/** 미용실 창 (싹둑 반짝·털 뭉치가 나오는 곳, 대표 그림 안 비율). */
const SALON_WINDOW = { fx: 0.6, fy: 0.68 } as const;
/** 미용실 손님이 문 안 자리로 들어가며 흐려지는 거리 (세계 px). */
const SALON_FADE = 46;

/**
 * 식당 테이블 그림 (map/table_set, 아래 가운데 기준 캔버스 px): 식탁보 위 가운데, 뒤(왼쪽 위) 의자 앉는 곳, 앞(오른쪽 아래) 의자 앉는 곳,
 * 뒤·앞 의자 손님의 접시 자리 (식탁보 위 가운데에서). 그림 meta(320×173, scale 0.3769)에서 잰 값.
 */
const TABLE = {
  top: { x: -13, y: -350 },
  back: { x: -300, y: -300 },
  front: { x: 292, y: -160 },
  dishBack: { x: -110, y: 6 },
  dishFront: { x: 100, y: 46 },
} as const;
/** 접시 긴 변 (세계 px), 한 입 사이 (초, 범위), 몇 입마다 냠냠. */
const DISH_SIZE = 30;
const BITE_GAP: readonly [number, number] = [0.9, 1.6];
const BITE_SEC = 0.55;
/** 배 터지게 먹고 눕기: 눕는 초·일어나는 초, 가장 오래 (초, sim은 FOOD_LIKE.stuffedSec). */
const FLOP_IN = 0.4;
const FLOP_OUT = 0.4;
const FLOP_MAX = 6;
/** 날아가는 물건 (가게 주인 → 손님): 초, 포물선 높이. */
const HAND_DUR = 0.5;
const HAND_ARC = 44;

const rand = (r: readonly [number, number]): number => r[0] + Math.random() * (r[1] - r[0]);
const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** 그림 'group/key' → 텍스처. */
function itemTex(item: string | null): ReturnType<typeof artTexture> {
  if (item === null) return undefined;
  const i = item.indexOf('/');
  return i < 0 ? undefined : artTexture(item.slice(0, i), item.slice(i + 1));
}

/** 가게 그림 조각 (아래 가운데 기준) 처리본 안 비율 점 → 세계 좌표. 그림 정보가 없으면 false. */
function artPt(p: ShopPart, fx: number, fy: number, out: { x: number; y: number }): boolean {
  const m = artMeta(p.group, p.key);
  if (m === undefined) return false;
  const w = m.trim.w * p.k;
  const h = m.trim.h * p.k;
  out.x = p.at.x + (fx - 0.5) * w;
  out.y = p.at.y - (1 - fy) * h;
  return true;
}

/** 가게 주인 몸짓 (shops.ts 숨쉬기 위에 더한다). */
interface OwnerAnim {
  hop: number;
  hopK: number;
  gesture: 'sway' | 'hop' | 'look' | 'wave' | null;
  gT: number;
  next: number;
  busy: number;
  alpha: number;
}
const GESTURE_SEC = { sway: 1.3, hop: 0.45, look: 1.7, wave: 1.0 } as const;
const GESTURES = ['sway', 'hop', 'look', 'wave'] as const;

/** 식당 테이블에 앉은 손님. */
interface Seat {
  readonly id: MonsterId;
  readonly table: ShopPart;
  /** 뒤(왼쪽 위) 의자인가 (테이블 뒤에 그린다). */
  readonly back: boolean;
  dish: ArtNode | null;
  dishOn: boolean;
  total: number;
  sit: number;
  biteT: number;
  gap: number;
  bites: number;
  yumAt: number;
}

/** 배 터지게 먹고 누운 손님. */
interface Flop {
  t: number;
  out: number;
  readonly f: number;
  landed: boolean;
}

export interface ShopLifeCtx {
  readonly sim: SimApi;
  readonly layers: { readonly objects: Container; readonly shadows: Container; readonly effects: Container };
  readonly fx: FxLayer;
  readonly shops: ShopsView;
  readonly monsters: MonstersView;
}

export class ShopLifeView {
  private readonly ctx: ShopLifeCtx;
  private readonly flights = new Flights();
  private readonly bits = new Bits(12);
  private readonly truck: TruckView;
  private readonly owners = new Map<ShopId, OwnerAnim>();
  private readonly ambientT = new Map<ShopId, number>();
  private readonly seats = new Map<MonsterId, Seat>();
  /** 식당 테이블 그림 조각 (놓인 자리 도장이 바뀌면 다시 잡는다). */
  private tables: ShopPart[] = [];
  private tablesStamp = -1;
  private readonly flops = new Map<MonsterId, Flop>();
  private salonT = 0;
  private salonPop = 0;
  private time = 0;
  private readonly tmp = { x: 0, y: 0 };
  private readonly acc = { x: 0, y: 0, w: 0, rot: 0, flip: 1, ax: 0.5, ay: 0.5 };
  private readonly offs: (() => void)[] = [];

  constructor(ctx: ShopLifeCtx) {
    this.ctx = ctx;
    ctx.layers.effects.addChild(this.bits.node, this.flights.node);
    this.truck = new TruckView({ sim: ctx.sim, objects: ctx.layers.objects, shadows: ctx.layers.shadows, effects: ctx.layers.effects, fx: ctx.fx, monsters: ctx.monsters, flights: this.flights, bits: this.bits });
    const bus = ctx.sim.bus;
    this.offs.push(
      bus.on('shopServed', (e) => this.served(e.id, e.shop, e.item, e.price)),
      bus.on('shopConsumed', (e) => this.consumed(e.id, e.shop, e.react)),
      bus.on('giftGiven', (e) => this.gift(e.from, e.to)),
    );
  }

  /** 누른 곳의 아이스크림 트럭 (Placed.id, 아니면 0). */
  hitTest(wx: number, wy: number): number {
    return this.truck.hitTest(wx, wy) ? (this.ctx.sim.village().placed('icecream_truck')?.id ?? 0) : 0;
  }

  // ── sim 이벤트 ──

  private live(id: MonsterId): MonsterView | undefined {
    const v = this.ctx.monsters.get(id);
    return v === undefined || v.leaving ? undefined : v;
  }

  /** 주인 손 (세계 좌표): 계산대 쪽 손 높이. 주인이 없으면 계산대 위. */
  private ownerHand(s: ShopId, out: { x: number; y: number }): void {
    const o = this.ctx.shops.ownerNode(s);
    const sp = this.ctx.sim.village().shopSpot(s);
    if (o === null || !o.node.visible) {
      out.x = sp.counter.x;
      out.y = sp.counter.y - 70;
      return;
    }
    const dir = Math.sign(sp.ownerLook.x - o.at.x) || -1;
    out.x = o.at.x + dir * 20;
    out.y = o.node.y - 58;
  }

  private hopOwner(s: ShopId, k = 1): void {
    const a = this.owners.get(s);
    if (a === undefined) return;
    a.hop = 1;
    a.hopK = k;
  }

  /** 계산대에서 샀다: 주인 톡, 손님 코인은 주인에게, 산 것은 손님 손 (장신구는 몸 그 자리)으로. */
  private served(id: MonsterId, s: ShopId, item: string | null, price: number): void {
    if (!FOOD_SHOPS.includes(s)) return;
    this.hopOwner(s);
    const v = this.live(id);
    if (v === undefined) return;
    const fx = this.ctx.fx;
    this.ownerHand(s, this.tmp);
    const hx = this.tmp.x;
    const hy = this.tmp.y;
    fx.coinArc(v.x, v.y - v.headH * 0.55, hx, hy + 10, clamp(Math.round(price / 6), 2, 6));
    if (s === 'restaurant' || s === 'beauty_salon' || item === null) return;
    if (s === 'accessory_shop' && item.startsWith('items/acc_')) {
      this.flyAccessory(v, item.slice('items/'.length) as AccessoryId, hx, hy);
      return;
    }
    if (s === 'snack_stall') {
      const a = AMBIENT.snack_stall;
      const part = this.ctx.sim.village().shopSpot(s).parts[0];
      if (a !== undefined && part !== undefined && artPt(part, a.fx, a.fy, this.tmp)) fx.sparkles(this.tmp.x, this.tmp.y, 3, 22);
    }
    const plush = item.startsWith('objects/plush_');
    const dur = plush ? HAND_DUR + 0.12 : HAND_DUR;
    v.holdHeld(dur + 0.05);
    this.flights.fly(itemTex(item), {
      from: { x: hx, y: hy },
      to: (out) => {
        const w = this.live(id);
        if (w === undefined) return false;
        w.heldAt(out);
        return true;
      },
      size: plush ? 36 : 26,
      sizeEnd: plush ? 50 : 31,
      dur,
      arc: HAND_ARC,
      delay: 0.12,
      onLand: (x, y) => {
        const w = this.live(id);
        if (plush && w !== undefined) {
          w.hop(0.8);
          fx.hearts(w.headX(), w.headY(), 2);
        } else fx.sparkles(x, y - 4, 2, 14);
      },
    });
  }

  /** 새 장신구: 주인 손에서 손님 몸 그 자리로 날아와 반짝 (그동안 몸에는 그리지 않는다). */
  private flyAccessory(v: MonsterView, key: AccessoryId, hx: number, hy: number): void {
    const d = ACCESSORIES[key];
    if (d === undefined) return;
    const id = v.id;
    const dur = 0.7;
    v.holdAccessory(key, dur + 0.6);
    v.accessoryAt(key, d.slot, this.acc);
    const fx = this.ctx.fx;
    this.flights.fly(artTexture('items', key), {
      from: { x: hx, y: hy },
      to: (out) => {
        const w = this.live(id);
        if (w === undefined) return false;
        w.accessoryAt(key, d.slot, this.acc);
        out.x = this.acc.x;
        out.y = this.acc.y;
        return true;
      },
      size: 34,
      sizeEnd: Math.max(14, this.acc.w),
      dur,
      arc: 70,
      delay: 0.15,
      onLand: (x, y) => {
        const w = this.live(id);
        w?.releaseAccessory(key);
        w?.hop(0.9);
        fx.sparkles(x, y, 8, 36);
      },
    });
  }

  /** 다 먹었다·다 머물렀다: 식당 접시 치우기·배 터짐, 미용실 반짝 와르르. */
  private consumed(id: MonsterId, s: ShopId, react: string | null): void {
    const v = this.live(id);
    if (s === 'restaurant') {
      const seat = this.seats.get(id);
      if (seat !== undefined) this.dropSeat(seat, true);
      if (react === 'stuffed' && v !== undefined) this.flops.set(id, { t: 0, out: -1, f: v.facing, landed: false });
      return;
    }
    if (s === 'beauty_salon' && v !== undefined) {
      const fx = this.ctx.fx;
      fx.sparkles(v.x, v.headY() + v.headH * 0.4, 12, v.halfW + 46);
      fx.hearts(v.headX(), v.headY(), 2);
      this.hopOwner(s, 1.2);
    }
  }

  /** 꽃 선물: 꽃다발이 건넨 손님 손에서 받은 손님 손으로, 닿으면 둘 다 하트·꽃잎. */
  private gift(from: MonsterId, to: MonsterId): void {
    const a = this.live(from);
    const b = this.live(to);
    const fx = this.ctx.fx;
    if (a === undefined || b === undefined) {
      for (const v of [a, b]) if (v !== undefined) fx.hearts(v.headX(), v.headY(), 3);
      return;
    }
    a.heldAt(this.tmp);
    const dur = 0.55;
    b.holdHeld(dur + 0.05);
    this.flights.fly(artTexture('items', 'bouquet'), {
      from: { x: this.tmp.x, y: this.tmp.y },
      to: (out) => {
        const w = this.live(to);
        if (w === undefined) return false;
        w.heldAt(out);
        return true;
      },
      size: 34,
      dur,
      arc: 38,
      onLand: (x, y) => {
        for (const id of [from, to]) {
          const w = this.live(id);
          if (w !== undefined) fx.hearts(w.headX(), w.headY(), 3);
        }
        fx.sparkles(x, y - 10, 5, 30);
        fx.confetti(x, y - 10, 5);
      },
    });
  }

  // ── 매 프레임 ──

  update(dt: number, view: ViewRect, zoom: number): void {
    this.time += dt;
    this.updateOwners(dt);
    this.updateAmbient(dt, view);
    this.updateRestaurant(dt);
    this.updateFlops(dt);
    this.updateSalon(dt);
    this.truck.update(dt, view, zoom);
    this.flights.update(dt);
    this.bits.update(dt, clamp(0.7 / zoom, 1, 1.6));
  }

  /** 가게 주인 몸짓: 숨쉬기(shops.ts)는 그대로 두고 위치·기울기·좌우·투명도를 더한다. */
  private updateOwners(dt: number): void {
    const st = this.ctx.sim.state;
    for (const s of FOOD_SHOPS) {
      const o = this.ctx.shops.ownerNode(s);
      if (o === null) {
        this.owners.delete(s);
        continue;
      }
      let a = this.owners.get(s);
      if (a === undefined) {
        a = { hop: 0, hopK: 1, gesture: null, gT: 0, next: 2 + Math.random() * 5, busy: 0, alpha: 1 };
        this.owners.set(s, a);
      }
      const n = o.node;
      const ss = st.shops[s];
      // 계산대에 손님이 있으면 바쁘게. 미용실은 안에 손님이 있는 동안도 (주인은 그대로 보이며 손을 바삐: 문 닫은 가게처럼 보이지 않게).
      const inside = s === 'beauty_salon' && this.salonInside() > 0;
      const busyWant = ss.serving !== null || inside ? 1 : 0;
      a.busy += (busyWant - a.busy) * Math.min(1, dt * 6);
      a.alpha += (1 - a.alpha) * Math.min(1, dt * 5);
      // 가끔 몸짓 (바쁘지 않을 때).
      if (a.gesture === null) {
        a.next -= dt;
        if (a.next <= 0 && a.busy < 0.2) {
          a.gesture = GESTURES[(Math.random() * GESTURES.length) | 0] ?? 'sway';
          a.gT = 0;
        }
      } else {
        a.gT += dt;
        if (a.gT >= GESTURE_SEC[a.gesture]) {
          a.gesture = null;
          a.next = 4 + Math.random() * 6;
        }
      }
      let y = 0;
      let rot = 0;
      let flipMul = 1;
      let sy = 1;
      if (a.gesture !== null) {
        const u = a.gT / GESTURE_SEC[a.gesture];
        switch (a.gesture) {
          case 'sway':
            rot = Math.sin(u * Math.PI * 3) * 0.07 * (1 - u);
            break;
          case 'hop':
            y = Math.sin(u * Math.PI) * 9;
            sy = 1 + 0.04 * Math.sin(u * Math.PI);
            break;
          case 'look': {
            // 두리번: 반대쪽을 잠깐 보고 돌아온다.
            const e = u < 0.25 ? smooth(u / 0.25) : u > 0.75 ? 1 - smooth((u - 0.75) / 0.25) : 1;
            flipMul = Math.cos(Math.PI * e);
            break;
          }
          case 'wave':
            rot = Math.sin(u * Math.PI * 6) * 0.05;
            y = Math.abs(Math.sin(u * Math.PI * 2)) * 4;
            break;
        }
      }
      // 바쁨: 통통 + 계산대 쪽으로 살짝 기울기.
      if (a.busy > 0.01) {
        const sp = this.ctx.sim.village().shopSpot(s);
        const dir = Math.sign(sp.ownerLook.x - o.at.x) || -1;
        y += Math.abs(Math.sin(this.time * 9 + s.length)) * 3 * a.busy;
        rot += (Math.sin(this.time * 9) * 0.035 + dir * 0.05) * a.busy;
      }
      // 팔았을 때 톡.
      if (a.hop > 0) {
        a.hop = Math.max(0, a.hop - dt / 0.42);
        const h = Math.sin((1 - a.hop) * Math.PI);
        y += h * 14 * a.hopK;
        sy *= 1 + 0.06 * h;
      }
      n.position.set(o.at.x, o.at.y - y);
      n.rotation = rot;
      n.scale.x *= flipMul;
      n.scale.y *= sy;
      n.alpha = a.alpha;
    }
  }

  /** 굴뚝 연기·진열창 반짝 (열려 있고 화면에 보이는 가게만). */
  private updateAmbient(dt: number, view: ViewRect): void {
    const st = this.ctx.sim.state;
    const v = this.ctx.sim.village();
    const fx = this.ctx.fx;
    for (const s of FOOD_SHOPS) {
      const a = AMBIENT[s];
      if (a === undefined || v.placed(s) === undefined || st.shops[s].level < 1) continue;
      let t = (this.ambientT.get(s) ?? rand(a.every)) - dt;
      if (t <= 0) {
        t = rand(a.every);
        const part = v.shopSpot(s).parts[0];
        if (part !== undefined && shopIsOpen(st, s) && artPt(part, a.fx, a.fy, this.tmp)) {
          const { x, y } = this.tmp;
          if (x > view.x0 - 100 && x < view.x1 + 100 && y > view.y0 - 100 && y < view.y1 + 200) {
            if (a.kind === 'smoke') fx.sigh(x, y, 1);
            else fx.sparkles(x, y, 1, 16);
          }
        }
      }
      this.ambientT.set(s, t);
    }
  }

  // ── 식당 ──

  /** 식당 자리 손님: 앉히기 (몸 맡기기), 접시, 냠냠. 자리를 떠난 손님은 접시를 치운다. */
  private updateRestaurant(dt: number): void {
    const { sim, monsters, fx } = this.ctx;
    const st = sim.state;
    const ss = st.shops.restaurant;
    const v = sim.village();
    const placed = v.placed('restaurant') !== undefined && ss.level >= 1;
    // 놓인 자리가 바뀌면 (옮기기) 테이블을 다시 잡고 앉은 손님도 새로 앉힌다.
    const moved = v.stamp.place !== this.tablesStamp;
    if (moved) {
      this.tablesStamp = v.stamp.place;
      this.tables = v.placed('restaurant') === undefined ? [] : v.shopSpot('restaurant').parts.filter((p) => p.key === 'table_set');
    }
    // 떠난 자리.
    for (const seat of this.seats.values()) {
      const m = sim.monster(seat.id);
      if (moved || !placed || m === undefined || m.shop !== 'restaurant' || m.phase !== 'atShop') this.dropSeat(seat, false);
    }
    const tables = this.tables;
    if (!placed || tables.length === 0) return;
    const sp = v.shopSpot('restaurant');
    for (let i = 0; i < ss.slots.length; i++) {
      const id = ss.slots[i] ?? null;
      if (id === null) continue;
      const m = sim.monster(id);
      const mv = monsters.get(id);
      if (m === undefined || mv === undefined || m.phase !== 'atShop' || m.shopSlot !== i) continue;
      let seat = this.seats.get(id);
      if (seat === undefined) {
        const slot = sp.slots[i] ?? sp.counter;
        let table = tables[0] as ShopPart;
        for (const t of tables) if (Math.abs(t.at.x - slot.x) < Math.abs(table.at.x - slot.x)) table = t;
        seat = { id, table, back: slot.x < table.at.x, dish: null, dishOn: false, total: Math.max(1, m.timer), sit: 0, biteT: -1, gap: 0.8, bites: 0, yumAt: 2 + ((Math.random() * 2) | 0) };
        this.seats.set(id, seat);
        this.serveDish(seat, m.order?.item ?? null);
      }
      const k = seat.table.k;
      const seatPt = seat.back ? TABLE.back : TABLE.front;
      const sx = seat.table.at.x + seatPt.x * k;
      const sy = seat.table.at.y + seatPt.y * k;
      // 의자로 폴짝 (처음 0.3초).
      seat.sit = Math.min(1, seat.sit + dt / 0.3);
      const e = smooth(seat.sit);
      const jump = Math.sin(seat.sit * Math.PI) * 16;
      // 한 입: 테이블 쪽으로 숙인다.
      let lean = 0;
      if (seat.biteT >= 0) {
        seat.biteT += dt;
        const u = seat.biteT / BITE_SEC;
        lean = Math.sin(Math.min(1, u) * Math.PI);
        if (seat.biteT - dt < BITE_SEC * 0.5 && seat.biteT >= BITE_SEC * 0.5) {
          seat.bites++;
          if (seat.dish !== null && seat.dishOn) fx.puff(seat.dish.x, seat.dish.y - 6, 2, 14, 0xf3dcae);
          if (seat.bites >= seat.yumAt && !mv.emoteBusy) {
            seat.bites = 0;
            seat.yumAt = 2 + ((Math.random() * 3) | 0);
            mv.showEmote(fx.tex.emote('yum'), 1.3);
          }
        }
        if (u >= 1) {
          seat.biteT = -1;
          seat.gap = rand(BITE_GAP);
        }
      } else if (seat.dishOn && seat.sit >= 1) {
        seat.gap -= dt;
        if (seat.gap <= 0) seat.biteT = 0;
      }
      const f = mv.facing;
      if (seat.back) {
        // 뒤 의자: 발을 의자 위로 (테이블 뒤에 그린다).
        monsters.puppet(id, { dx: (sx - mv.x) * e, dy: (sy - mv.y) * e - jump, rot: f * 0.13 * lean, sx: 1, sy: 1 - 0.04 * e - 0.03 * lean });
      } else {
        // 앞 의자: 발은 제자리 (테이블 앞), 몸만 의자 높이로.
        monsters.puppet(id, { dx: (sx - mv.x) * e, lift: (mv.y - sy) * e + jump, rot: f * 0.13 * lean, sx: 1, sy: 1 - 0.04 * e - 0.03 * lean });
      }
      // 접시: 먹을수록 줄어든다.
      if (seat.dish !== null && seat.dishOn) {
        const left = clamp(m.timer / seat.total, 0, 1);
        seat.dish.scale.set(0.5 + 0.5 * smooth(left));
      }
    }
  }

  /** 주인이 접시를 테이블로 날린다 (닿으면 접시가 놓인다). */
  private serveDish(seat: Seat, item: string | null): void {
    const t = seat.table;
    const k = t.k;
    const off = seat.back ? TABLE.dishBack : TABLE.dishFront;
    const x = t.at.x + (TABLE.top.x + off.x) * k;
    const y = t.at.y + (TABLE.top.y + off.y) * k;
    const key = item !== null && item.startsWith('items/') ? item.slice('items/'.length) : 'food_pasta';
    const meta = artMeta('items', key);
    const dish = new ArtNode({ k: meta === undefined ? 0.05 : DISH_SIZE / Math.max(1, meta.trim.w, meta.trim.h), anchor: meta === undefined ? 'bottom' : { x: meta.trim.x + meta.trim.w / 2, y: meta.trim.y + meta.trim.h * 0.75 }, placeholder: { w: 600, h: 400, color: 0xf3d36a } });
    dish.setArt('items', key);
    dish.position.set(x, y);
    // 테이블 그림 바로 앞 (뒤 의자 손님보다 앞, 앞 의자 손님보다 뒤).
    dish.zIndex = Math.round(t.at.y) + 1;
    dish.visible = false;
    dish.eventMode = 'none';
    this.ctx.layers.objects.addChild(dish);
    seat.dish = dish;
    this.hopOwner('restaurant');
    this.ownerHand('restaurant', this.tmp);
    const fx = this.ctx.fx;
    this.flights.fly(artTexture('items', key), {
      from: { x: this.tmp.x, y: this.tmp.y },
      to: (out) => {
        out.x = x;
        out.y = y - DISH_SIZE * 0.3;
        return true;
      },
      size: 24,
      sizeEnd: DISH_SIZE,
      dur: 0.6,
      arc: 60,
      delay: 0.2,
      onLand: () => {
        if (seat.dish === null || seat.dish.destroyed) return;
        seat.dishOn = true;
        seat.dish.visible = true;
        seat.gap = 0.5;
        fx.sparkles(x, y - 14, 3, 18);
      },
    });
  }

  /** 자리를 떠났다: 접시를 치운다 (다 먹었으면 작은 먼지). */
  private dropSeat(seat: Seat, eaten: boolean): void {
    if (seat.dish !== null && !seat.dish.destroyed) {
      if (eaten && seat.dishOn) this.ctx.fx.puff(seat.dish.x, seat.dish.y - 6, 3, 24);
      seat.dish.destroy({ children: true });
    }
    seat.dish = null;
    seat.dishOn = false;
    this.seats.delete(seat.id);
  }

  /** 배 터지게 먹은 손님: 테이블 옆에 벌러덩 (머리는 테이블 반대쪽), 배가 들썩, 반응이 끝나면 일어난다. */
  private updateFlops(dt: number): void {
    const { sim, monsters, fx } = this.ctx;
    for (const [id, fl] of this.flops) {
      const m = sim.monster(id);
      const v = monsters.get(id);
      if (m === undefined || v === undefined || v.leaving) {
        this.flops.delete(id);
        continue;
      }
      fl.t += dt;
      // sim이 눕힌 동안 (Monster.lying) 누워 있다: 일어나면 ('영차… 일어났다') 다시 선다.
      if (fl.out < 0 && (((m.lying ?? 0) <= 0 && fl.t > FLOP_IN) || m.phase !== 'reacting' || fl.t > FLOP_MAX)) fl.out = 0;
      let k = smooth(fl.t / FLOP_IN);
      if (fl.out >= 0) {
        fl.out += dt;
        k *= 1 - smooth(fl.out / FLOP_OUT);
        if (fl.out >= FLOP_OUT) {
          this.flops.delete(id);
          continue;
        }
      }
      if (!fl.landed && fl.t >= FLOP_IN) {
        fl.landed = true;
        fx.puff(v.x, v.y, 5, 50);
      }
      const after = Math.max(0, fl.t - FLOP_IN);
      const bounce = Math.abs(Math.sin(after * 9)) * 10 * Math.exp(-after * 3);
      const belly = Math.sin(after * 3.2) * 0.06;
      // 발을 축으로 눕힌다: 몸 가운데가 제자리에 남게 발을 반 키만큼 민다 (ssireum.ts 벌러덩과 같이).
      monsters.puppet(id, {
        dx: fl.f * v.headH * 0.5 * k,
        lift: (v.halfW * 0.85 + bounce) * k,
        rot: -fl.f * (Math.PI / 2) * k,
        sx: 1 + belly * 0.5 * k,
        sy: 1 + belly * k,
        pose: 'joy',
        still: true,
      });
    }
  }

  // ── 미용실 ──

  /** 미용실 안 (숨은) 손님 수. */
  private salonInside(): number {
    const { sim } = this.ctx;
    let n = 0;
    for (const id of sim.state.shops.beauty_salon.slots) {
      if (id === null) continue;
      const m = sim.monster(id);
      if (m !== undefined && m.phase === 'atShop' && m.hidden === true) n++;
    }
    return n;
  }

  /** 문으로 들어가는 손님은 흐려지고, 안에 손님이 있으면 창에서 싹둑 반짝·털 뭉치. */
  private updateSalon(dt: number): void {
    const { sim, monsters, fx } = this.ctx;
    const st = sim.state;
    const ss = st.shops.beauty_salon;
    const v = sim.village();
    if (ss.level < 1 || v.placed('beauty_salon') === undefined) return;
    const sp = v.shopSpot('beauty_salon');
    // 안에 있는 손님 종 색 (털 뭉치 tint).
    let inside: number | null = null;
    for (let i = 0; i < ss.slots.length; i++) {
      const id = ss.slots[i] ?? null;
      if (id === null) continue;
      const m = sim.monster(id);
      const mv = monsters.get(id);
      if (m === undefined || mv === undefined) continue;
      if (m.phase === 'atShop' && m.hidden === true) inside = SPECIES[m.species].color;
      if (m.phase !== 'toShopSeat') continue;
      const slot = sp.slots[i] ?? sp.counter;
      const d = Math.hypot(slot.x - mv.x, slot.y - mv.y);
      if (d < SALON_FADE) {
        const a = smooth(d / SALON_FADE);
        monsters.puppet(id, { alpha: a, sx: 0.85 + 0.15 * a, sy: 0.85 + 0.15 * a });
      }
    }
    if (inside === null) return;
    const part = sp.parts[0];
    if (part === undefined) return;
    // 지붕 위로 박자 맞춰 반짝·하트가 퐁 (멀리서 봐도 손님을 다듬는 중: Bits가 지도를 넓게 볼 때 키운다).
    this.salonPop -= dt;
    if (this.salonPop <= 0 && artPt(part, 0.52, 0.06, this.tmp)) {
      this.salonPop = 1.1;
      this.bits.add(fx.tex.emote(Math.random() < 0.7 ? 'sparkle' : 'heart'), this.tmp.x + (Math.random() - 0.5) * 40, this.tmp.y, { vy: -46, size0: 36, size1: 62, life: 1.0, spin: 0.3 });
      fx.sparkles(this.tmp.x, this.tmp.y + 10, 3, 46);
    }
    this.salonT -= dt;
    if (this.salonT > 0) return;
    this.salonT = 0.45 + Math.random() * 0.5;
    if (!artPt(part, SALON_WINDOW.fx, SALON_WINDOW.fy, this.tmp)) return;
    const x = this.tmp.x + (Math.random() - 0.5) * 34;
    const y = this.tmp.y + (Math.random() - 0.5) * 18;
    // 싹둑 (짧은 선 셋)·반짝, 가끔 손님 색 털 뭉치.
    if (Math.random() < 0.55) fx.toot(x, y, Math.random() < 0.5 ? -1 : 1);
    fx.sparkles(x, y, 2, 14);
    if (Math.random() < 0.5) fx.puff(x, y + 8, 2, 26, inside);
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    for (const seat of [...this.seats.values()]) this.dropSeat(seat, false);
    this.truck.destroy();
    this.flights.destroy();
    this.bits.destroy();
  }
}
