// 다섯째 묶음 가게 기록 (UI 메모리, 저장하지 않는다): sim 이벤트를 듣고 화면이 보여 줄 것만 모아 둔다.
//  - 오늘 매상: 이번에 마을을 연 때의 가게 누적 (ShopState.revenue·served)을 바탕으로 (오늘 = 이번에 켠 뒤).
//  - 손님마다 산 것 (shopServed: 가게·그림·값), 진행자에게 준 팁 (tip), 점괘 결과 (fortuneGood·fortuneBad 반응).
//  - 가게마다 최근 판 것, 꽃집의 최근 선물 (giftGiven: 떠난 손님도 이름이 남게).

import { SHOP_IDS, type BoothId, type ShopId, type SpeciesId } from '../data/defs.ts';
import type { SimApi } from '../sim/api.ts';
import { shopReactionLabels } from '../sim/reactions.ts';
import type { MonsterId } from '../sim/types.ts';

/** 손님이 산 것 하나. at = state.time. */
export interface Purchase {
  readonly shop: ShopId;
  readonly item: string | null;
  readonly price: number;
  readonly at: number;
}

/** 가게가 판 것 하나 (손님 이름·종도 남긴다). */
export interface Sale extends Purchase {
  readonly id: MonsterId;
  readonly name: string;
  readonly species: SpeciesId;
}

/** 꽃 선물 하나. */
export interface GiftNote {
  readonly from: MonsterId;
  readonly to: MonsterId;
  readonly fromName: string;
  readonly toName: string;
  readonly fromSpecies: SpeciesId;
  readonly toSpecies: SpeciesId;
  readonly at: number;
}

/** 손님마다 남기는 산 것 수, 가게마다 최근 판 것 수, 최근 선물 수. */
const KEEP_BUYS = 6;
const KEEP_SALES = 8;
const KEEP_GIFTS = 8;

/** 점괘 등급. */
export type FortuneGrade = 'great' | 'good' | 'bad';
/** 등급 이름. */
export const FORTUNE_NAME: Readonly<Record<FortuneGrade, string>> = { great: '대길', good: '길', bad: '흉' };

const FORTUNE_GOOD: ReadonlySet<string> = new Set(shopReactionLabels('fortuneGood'));
const FORTUNE_BAD: ReadonlySet<string> = new Set(shopReactionLabels('fortuneBad'));

export class ShopLog {
  private readonly sim: SimApi;
  /** 이번에 켠 때의 누적 (오늘 = 지금 - 이것). */
  private readonly base = {} as Record<ShopId, { revenue: number; served: number }>;
  private readonly buys = new Map<MonsterId, Purchase[]>();
  private readonly tipped = new Map<MonsterId, { n: number; coins: number; booth: BoothId }>();
  /** 점괘 등급 (대길·길·흉: 운이 끝난 뒤에도 카드가 '점괘가 대길이었어요'라고 말하게). */
  private readonly fortune = new Map<MonsterId, FortuneGrade>();
  private readonly sales = {} as Record<ShopId, Sale[]>;
  readonly gifts: GiftNote[] = [];
  /** 오늘 받은 진행자 팁 (횟수·코인). */
  tipsToday = { n: 0, coins: 0 };

  constructor(sim: SimApi) {
    this.sim = sim;
    for (const s of SHOP_IDS) {
      const ss = sim.state.shops[s];
      this.base[s] = { revenue: ss.revenue, served: ss.served };
      this.sales[s] = [];
    }
    const bus = sim.bus;
    bus.on('shopServed', (e) => {
      const t = sim.state.time;
      const p: Purchase = { shop: e.shop, item: e.item, price: e.price, at: t };
      const list = this.buys.get(e.id) ?? [];
      list.push(p);
      if (list.length > KEEP_BUYS) list.shift();
      this.buys.set(e.id, list);
      const m = sim.monster(e.id);
      if (m !== undefined) {
        const s = this.sales[e.shop];
        s.unshift({ ...p, id: e.id, name: m.nickname, species: m.species });
        if (s.length > KEEP_SALES) s.length = KEEP_SALES;
      }
    });
    bus.on('tip', (e) => {
      const cur = this.tipped.get(e.id) ?? { n: 0, coins: 0, booth: e.booth };
      this.tipped.set(e.id, { n: cur.n + 1, coins: cur.coins + e.amount, booth: e.booth });
      this.tipsToday = { n: this.tipsToday.n + 1, coins: this.tipsToday.coins + e.amount };
    });
    bus.on('monsterReact', (e) => {
      const l = e.reaction.label;
      if (!FORTUNE_GOOD.has(l) && !FORTUNE_BAD.has(l)) return;
      // 반응을 낼 때 sim은 등급을 이미 손님에게 달았다 (Monster.buffs.fortune).
      const g = sim.monster(e.id)?.buffs?.fortune;
      this.fortune.set(e.id, g ?? (FORTUNE_BAD.has(l) ? 'bad' : 'good'));
    });
    bus.on('giftGiven', (e) => {
      const a = sim.monster(e.from);
      const b = sim.monster(e.to);
      if (a === undefined || b === undefined) return;
      this.gifts.unshift({ from: e.from, to: e.to, fromName: a.nickname, toName: b.nickname, fromSpecies: a.species, toSpecies: b.species, at: sim.state.time });
      if (this.gifts.length > KEEP_GIFTS) this.gifts.length = KEEP_GIFTS;
    });
    bus.on('monsterLeft', (e) => {
      this.buys.delete(e.id);
      this.tipped.delete(e.id);
      this.fortune.delete(e.id);
    });
  }

  /** 오늘 (이번에 켠 뒤) 매상과 손님 수. 새 게임으로 누적이 줄었으면 바탕을 0으로. */
  today(s: ShopId): { revenue: number; served: number } {
    const ss = this.sim.state.shops[s];
    const b = this.base[s];
    if (ss.revenue < b.revenue || ss.served < b.served) {
      b.revenue = 0;
      b.served = 0;
    }
    return { revenue: ss.revenue - b.revenue, served: ss.served - b.served };
  }

  /** 오늘 모든 가게 매상. */
  todayAll(): number {
    return SHOP_IDS.reduce((n, s) => n + this.today(s).revenue, 0);
  }

  /** 이 손님이 이번 방문에 산 것 (오래된 것부터, 이 화면을 연 뒤만). */
  purchases(id: MonsterId): readonly Purchase[] {
    return this.buys.get(id) ?? [];
  }

  /** 이 손님이 진행자에게 준 팁 (없으면 null). */
  tips(id: MonsterId): { n: number; coins: number; booth: BoothId } | null {
    return this.tipped.get(id) ?? null;
  }

  /** 점괘 결과 (true = 좋음, 보지 않았으면 null). */
  fortuneOf(id: MonsterId): FortuneGrade | null {
    return this.fortune.get(id) ?? null;
  }

  /** 가게가 최근 판 것 (새것부터). */
  recent(s: ShopId): readonly Sale[] {
    return this.sales[s];
  }
}
