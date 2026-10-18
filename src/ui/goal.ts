// 다음 목표 칩 (HUD 아래)과 아래 탭의 점 배지: 처음 하는 사람이 무엇을 할지 알게.
// 목표 차례: 보관함의 부스·건물 놓기 → 길이 이어지지 않은 건물에 길 잇기 (둘 다 촌장이 한 일 뒤에만) → (옛 저장) 짓기 모드 알림 → 손님 응원하기 → 부스 구경하기 → 진행자 자리가 비어 쉬는 부스 →
// 처음 열린 빚 걸기 판 보러 가기 → 처음 생긴 일터 채무자 응원하러 가기 (넷째 묶음) →
// 아직 구경하지 않은 단체 놀이의 판이 모이거나 한창이면 지도에서 구경하기 →
// 첫 가게 둘 (다섯째 묶음: 처음 부스 다음에 새 부스를 하나 연 뒤, 지을 수 있는 가장 싼 가게, 둘째는 다른 묶음 먼저) →
// 전당포(회관 1)·일터·은행(회관 2)을 지을 수 있으면 짓기 (빈털터리 손님을 본 뒤나 밀어내기를 연 뒤에만: 그 전엔 할 일이 없다) → 지금 살 수 있는 가장 싼 짓기 →
// 다음 부스(귀한 물건은 이미 모았을 때)·아직 안 지은 전당포·일터·은행·첫 가게 → 다음 마을회관까지 모은 정도.
// 가게 주인이 없는 놓인 가게는 진행자 자리가 빈 부스 다음에 (주인 세우기).
// 칩을 누르면 그 화면을 연다. 처음 두 단계와 구경한 단체 놀이는 이 브라우저에 기억한다 (게임 저장과 따로, 없어도 된다).

import { catalogKind, catalogName, footprint, type CatalogKey } from '../data/catalog.ts';
import { BOOTH_IDS, BOOTHS, boothDef, BUILDINGS, DEBT_MATCH, GROUP_BOOTHS, SHOP_IDS, SHOP_OWNER_ROLE, SHOPS, type BoothId, type BuildingId, type GroupBoothId, type MaterialId, type PreciousId, type ShopId } from '../data/defs.ts';
import type { Cost } from '../sim/api.ts';
import { shopIdleReason, shopOwned } from '../sim/shops.ts';
import { isIdle } from '../sim/staff.ts';
import { josa } from '../sim/text.ts';
import { fmt, h, setText } from './dom.ts';
import { groupGame } from '../sim/group/index.ts';
import { groupWatchBox, groupWatchZoom, roundWord, startWord } from './groupText.ts';
import { AREAS, boothShort, boothTiny, BUILDING_IDS, districtAtHall, itemName } from './labels.ts';
import type { TabId, UiCtx } from './panel.ts';
import { catOf, joinRoad } from './panels/build.ts';
import { itemIcon } from './pics.ts';
import { SHOP_PITCH } from './shopText.ts';

const HINT_KEY = 'mpv-hints-v1';
/** 첫 가게를 권하는 때: 열린 부스가 이만큼 (처음 둘 + 새로 하나) 된 뒤. 권하는 가게 수 (그다음은 '지금 지을 수 있어요'로). */
const SHOP_AFTER_BOOTHS = 3;
const FIRST_SHOPS = 2;

interface Seen {
  cheer: boolean;
  booth: boolean;
  /** 짓기 모드를 써 보았다 (옮기기·길 깔기: 옛 저장으로 이어 하는 사람에게 한 번 알린다). */
  place: boolean;
  /** 일터 시트를 열어 채무자를 보았다 (넷째 묶음). */
  yard: boolean;
  /** 빚 걸기 판을 부스 패널로 보았다. */
  debtMatch: boolean;
  /** 돈이 떨어진 손님을 처음 보았다 (그때부터 전당포·일터·은행 짓기를 권한다). */
  broke: boolean;
  /** 구경한 단체 놀이 (부스 패널을 열었거나 목표 칩으로 지도에서 보았다). */
  watched: string[];
  /** 주인이 없는 가게 칩을 눌러 보았다 (가게마다 한 번: 일부러 닫아 둔 가게를 계속 조르지 않게). */
  shopOwner: string[];
}

/** 한 번 보면 끝나는 목표. */
export type SeenKey = 'cheer' | 'booth' | 'place' | 'yard' | 'debtMatch';

function loadSeen(): Seen {
  try {
    const raw = JSON.parse(localStorage.getItem(HINT_KEY) ?? '{}') as Partial<Seen>;
    return {
      cheer: raw.cheer === true,
      booth: raw.booth === true,
      place: raw.place === true,
      yard: raw.yard === true,
      debtMatch: raw.debtMatch === true,
      broke: raw.broke === true,
      watched: Array.isArray(raw.watched) ? raw.watched.filter((x): x is string => typeof x === 'string') : [],
      shopOwner: Array.isArray(raw.shopOwner) ? raw.shopOwner.filter((x): x is string => typeof x === 'string') : [],
    };
  } catch {
    return { cheer: false, booth: false, place: false, yard: false, debtMatch: false, broke: false, watched: [], shopOwner: [] };
  }
}

/** 넷째 묶음 건물을 짓는 차례 (은행은 일터가 있어야 빌려준다)와 칩 글. */
const DEBT_BUILD: readonly { readonly id: BuildingId; readonly why: string }[] = [
  { id: 'pawnshop', why: '돈이 떨어진 손님이 장신구를 맡겨요' },
  { id: 'workyard', why: '못 갚은 빚을 일해서 갚는 곳' },
  { id: 'bank', why: '맡길 장신구도 없는 손님에게 빌려줘요' },
];

/** 지금 살 수 있는 것 하나 (가장 싼 것): 짓기 탭의 그 묶음을 연다. */
interface Buyable {
  readonly label: string;
  readonly coins: number;
  readonly key: CatalogKey;
}

export class GoalChip {
  readonly el: HTMLButtonElement;
  private readonly ctx: UiCtx;
  private readonly text: HTMLSpanElement;
  private readonly items: HTMLSpanElement;
  private readonly seen: Seen = loadSeen();
  private action: () => void = () => {};
  private sig = '';

  constructor(ctx: UiCtx, parent: HTMLElement) {
    this.ctx = ctx;
    this.text = h('span', 'txt');
    this.items = h('span', 'items');
    this.el = h('button', 'mpv-goal', h('span', 'tag', '다음'), this.text, this.items);
    this.el.type = 'button';
    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.action();
    });
    parent.append(this.el);
    ctx.sim.bus.on('monsterCheered', (e) => {
      if (e.by === 'tap') this.mark('cheer');
    });
  }

  /** 한 번 보면 끝나는 목표를 했다 (응원·부스 구경·일터·빚 걸기 판). */
  mark(k: SeenKey): void {
    if (this.seen[k]) return;
    this.seen[k] = true;
    this.store();
  }

  /** 단체 놀이 하나를 구경했다 (부스 패널을 열었다). */
  markWatched(b: BoothId): void {
    if (this.seen.watched.includes(b)) return;
    this.seen.watched.push(b);
    this.store();
  }

  /** 주인 없는 가게 칩을 눌렀다 (그 가게는 다시 조르지 않는다). */
  private markShopOwner(s: ShopId): void {
    if (this.seen.shopOwner.includes(s)) return;
    this.seen.shopOwner.push(s);
    this.store();
  }

  private store(): void {
    try {
      localStorage.setItem(HINT_KEY, JSON.stringify(this.seen));
    } catch {
      // 기억 못 해도 괜찮다.
    }
    this.ctx.markDirty();
  }

  /** 4Hz: 목표 글과 탭 배지. */
  update(setBadge: (tab: TabId, on: boolean) => void): void {
    const sim = this.ctx.sim;
    const st = sim.state;
    if (!this.seen.broke && st.monsters.some((m) => m.broke === true || (m.declined ?? null) !== null || m.pawned.length > 0 || m.debt > 0)) {
      this.seen.broke = true;
      this.store();
    }
    setBadge('build', this.cheapest() !== null);
    const village = sim.village();
    const needHost = BOOTH_IDS.some((b) => st.booths[b].unlocked && village.connected(b) && !sim.boothOpen(b));
    setBadge('staff', needHost && (st.staff.some((s) => isIdle(s)) || st.candidates.some((c) => c.cost <= st.coins)));
    setBadge('workshop', st.crafting.length < sim.craftSlots() && sim.availableRecipes().some((r) => r.affordable));

    // 이미 마을을 키운 사람 (회관 2 이상이거나 부스가 셋 넘게 열림: 옛 저장으로 이어 하는 사람)에게는 처음 두 단계를 건너뛴다.
    const veteran = sim.hallLevel() > 1 || BOOTH_IDS.filter((b) => st.booths[b].unlocked).length > 2;
    if (veteran && (!this.seen.cheer || !this.seen.booth)) {
      this.seen.cheer = true;
      this.seen.booth = true;
      this.store();
    }
    if (!this.seen.place && this.ctx.hooks.world.buildState().mode.kind !== 'none') this.mark('place');
    // 배치형 마을: 보관함에 있는 부스·건물 (열거나 지은 뒤 아직 안 놓음) → 짓기 모드로 놓기. 촌장이 한 일 뒤에만 생겨서 처음 두 단계보다 먼저.
    const stored = sim.storage().find((x) => catalogKind(x.key) !== 'decor');
    if (stored !== undefined) {
      this.show(`store:${stored.key}`, `${josa(catalogName(stored.key), '을', '를')} 지도에 놓아 주세요`, null, () => {
        this.ctx.startBuild({ kind: 'place', key: stored.key });
      });
      return;
    }
    // 입구가 길로 이어지지 않은 건물 (손님이 못 온다) → 길 깔기.
    const cut = village.state.placed.find((p) => catalogKind(p.key) !== 'decor' && footprint(p.key).entry !== undefined && !village.linkedId(p.id));
    if (cut !== undefined) {
      this.show(`road:${cut.key}`, `${catalogName(cut.key)} 입구 앞에 길을 이어 주세요`, null, () => joinRoad(this.ctx, cut.key));
      return;
    }
    // 옛 저장으로 이어 하는 사람: 이제 건물을 옮기고 길을 깔 수 있다 (한 번).
    if (veteran && !this.seen.place) {
      this.show('place', '이제 짓기 탭에서 건물을 옮기고 길을 깔 수 있어요', null, () => {
        this.mark('place');
        this.ctx.openBuild('road');
      });
      return;
    }
    if (!this.seen.cheer) {
      this.show('cheer', '손님을 눌러 응원해 보세요', null, () => {
        const m = st.monsters.find((x) => x.phase !== 'leaving' && x.phase !== 'arriving') ?? st.monsters[0];
        if (m !== undefined) this.ctx.showMonster(m.id);
      });
      return;
    }
    if (!this.seen.booth) {
      const b = BOOTH_IDS.find((x) => sim.boothOpen(x)) ?? 'slot';
      this.show('booth', '부스를 눌러 한판을 구경해 보세요', null, () => this.ctx.showBooth(b));
      return;
    }

    // 열렸는데 꼭 있어야 하는 진행자 자리가 빈 부스 (경주장은 출발 신호·해설자 둘)
    const idle = BOOTH_IDS.find((b) => st.booths[b].unlocked && village.connected(b) && !sim.boothOpen(b));
    if (idle !== undefined) {
      const roles = boothDef(idle).roles;
      const role = roles.findIndex((r, i) => r.optional !== true && (st.booths[idle].staff[i] ?? null) === null);
      const name = roles[role]?.name ?? '진행자';
      const where = roles.length > 1 ? `${boothTiny(idle)} ${name}` : boothShort(idle);
      if (st.staff.some((x) => isIdle(x))) {
        // 부스 패널을 열고 그 자리의 '세우기' 고르기를 바로 연다.
        this.show(`host:${idle}.${role}`, `${where} 자리에 진행자를 세워 주세요`, null, () => this.ctx.showBooth(idle, role));
        return;
      }
      const cheapest = st.candidates.reduce<number | null>((m, c) => (m === null || c.cost < m ? c.cost : m), null);
      // 주민 탭을 고용 후보 칸으로 굴려 연다. 자리 이름('출발 신호')은 사람이 아니라 자리로 말한다.
      this.show(`hire:${idle}.${role}`, `진행자를 고용해 주세요 (${roles.length > 1 ? `${where} 자리` : BOOTHS[idle].name})`, cheapest === null ? null : { coins: cheapest }, () => this.ctx.openHire());
      return;
    }

    // 다섯째 묶음: 놓여 길로 이어졌는데 가게 주인이 없는 가게 (주인을 부스에 세웠을 때). 쉬는 주민이 있으면 가게 시트 (주인 세우기),
    // 없으면 고용 (부스를 멈추거나 다른 가게를 닫는 바꾸기만 남지 않게). 가게마다 한 번 누르면 다시 조르지 않는다 (일부러 닫아 둔 가게).
    const ownerless = SHOP_IDS.find((s) => shopIdleReason(st, s) === 'owner' && !this.seen.shopOwner.includes(s));
    if (ownerless !== undefined) {
      const name = SHOPS[ownerless].name;
      if (st.staff.some((x) => isIdle(x))) {
        this.show(`shopOwner:${ownerless}`, `${name}에 ${josa(SHOP_OWNER_ROLE, '을', '를')} 세워 주세요`, null, () => {
          this.markShopOwner(ownerless);
          this.ctx.showShop(ownerless);
        });
        return;
      }
      const cheapest = st.candidates.reduce<number | null>((m, c) => (m === null || c.cost < m ? c.cost : m), null);
      this.show(`shopHire:${ownerless}`, `진행자를 고용해 주세요 (${name} ${SHOP_OWNER_ROLE})`, cheapest === null ? null : { coins: cheapest }, () => {
        this.markShopOwner(ownerless);
        this.ctx.openHire();
      });
      return;
    }

    // 넷째 묶음: 처음 열린 빚 걸기 판, 처음 생긴 일터 채무자 (지나치기 쉬운 장면을 한 번은 보여 준다).
    if (!this.seen.debtMatch) {
      const dm = DEBT_MATCH.booths.find((b) => {
        const g = st.booths[b].group;
        return g?.mode === 'debt' && (g.phase === 'gathering' || g.phase === 'running');
      });
      if (dm !== undefined) {
        this.show(`debtMatch:${dm}`, `${BOOTHS[dm].name}에 빚 걸기 판이 열렸어요! 보러 가기`, null, () => this.ctx.showBooth(dm));
        return;
      }
    }
    if (!this.seen.yard && sim.buildingBuilt('workyard') && st.monsters.some((m) => m.bankrupt === true && (m.phase === 'working' || m.phase === 'waitWork'))) {
      this.show('yard', '일터에서 빚을 갚는 손님이 있어요: 응원하러 가기', null, () => this.ctx.showBuilding('workyard'));
      return;
    }

    // 아직 구경하지 않은 단체 놀이의 판이 모이거나 한창이면: 지도에서 구경하기 (밖에서 보는 재미).
    const watch = this.toWatch();
    if (watch !== null) {
      const g = st.booths[watch].group;
      const ph = g?.phase;
      const name = BOOTHS[watch].name;
      const R = roundWord(watch);
      // '오리배 경주'처럼 이름이 판 말로 끝나면 한 번만 ('오리배 경주가 곧 출발해요!').
      const what = name.endsWith(R) ? name : `${name} ${R}`;
      // 곧 시작은 출발 조건이 맞을 때만 (밀어내기 선수가 하나뿐이면 '손님이 모여요').
      const soon = g !== null && g !== undefined && ph === 'gathering' && groupGame(watch).readiness(g.participants, g.elapsed) === 'soon';
      const text = ph === 'running' ? `${josa(what, '이', '가')} 한창이에요! 보러 가기` : soon ? `${josa(what, '이', '가')} 곧 ${startWord(watch)}해요! 보러 가기` : `${name}에 손님이 모여요! 보러 가기`;
      this.show(`watch:${watch}:${ph}:${soon ? 1 : 0}`, text, null, () => {
        this.markWatched(watch);
        this.ctx.closeAll();
        this.ctx.hooks.world.focusOn(groupWatchBox(village, watch).c, groupWatchZoom(village, watch, window.innerWidth, window.innerHeight));
      });
      return;
    }

    // 다섯째 묶음: 첫 부스들 다음에 첫 가게 둘 (손님이 놀이 말고도 코인을 쓴다). 지을 수 있으면 그 카드로.
    const shop = this.firstShop();
    if (shop !== null && sim.canAfford(shop.cost)) {
      const name = SHOPS[shop.id].name;
      this.show(`firstShop:${shop.id}`, `${josa(name, '을', '를')} 지어 보세요: ${SHOP_PITCH[shop.id]}`, null, () => this.ctx.openBuild(catOf(shop.id), shop.id));
      return;
    }

    // 전당포(회관 1)·일터·은행(회관 2): 지을 수 있으면 다른 짓기보다 먼저 (돈이 떨어진 손님의 이야기가 시작된다).
    // 단, 돈이 떨어진 손님을 본 뒤나 첫 단체 놀이(밀어내기)를 연 뒤에만 (그 전엔 맡길 손님이 없어 첫 부스가 늦어질 뿐).
    const debt = this.debtMatters() ? this.debtBuild() : null;
    if (debt !== null && sim.canAfford(debt.cost)) {
      const name = BUILDINGS[debt.id].name;
      this.show(`debtBuild:${debt.id}`, `${josa(name, '을', '를')} 지어 보세요: ${debt.why}`, null, () => this.ctx.showBuilding(debt.id));
      return;
    }

    const buy = this.cheapest();
    if (buy !== null) {
      // 그 카드가 든 묶음으로 (마지막에 본 묶음이 장식·길·땅이어도).
      this.show(`buy:${buy.label}`, buy.label, null, () => this.ctx.openBuild(catOf(buy.key), buy.key));
      return;
    }

    // 열린 구역의 다음 부스(귀한 물건은 이미 모았을 때)·아직 안 지은 전당포·일터·은행과 다음 마을회관 가운데 코인이 덜 드는 쪽
    const next = this.nextBooth();
    const hallCost = sim.buildingUpgradeCost('hall');
    if (debt !== null && (next === null || debt.cost.coins <= next.cost.coins) && (hallCost === null || debt.cost.coins <= hallCost.coins)) {
      this.show(`debtNext:${debt.id}`, `${BUILDINGS[debt.id].name} 짓기까지`, debt.cost, () => this.ctx.showBuilding(debt.id));
      return;
    }
    if (shop !== null && (next === null || shop.cost.coins <= next.cost.coins) && (hallCost === null || shop.cost.coins <= hallCost.coins)) {
      this.show(`shopNext:${shop.id}`, `${SHOPS[shop.id].name} 짓기까지`, shop.cost, () => this.ctx.openBuild(catOf(shop.id), shop.id));
      return;
    }
    if (next !== null && (hallCost === null || next.cost.coins <= hallCost.coins)) {
      this.show(`booth:${next.booth}`, `${BOOTHS[next.booth].name} 열기까지`, next.cost, () => this.ctx.showBooth(next.booth));
      return;
    }
    if (hallCost !== null) {
      const lv = sim.hallLevel() + 1;
      const d = districtAtHall(lv);
      const A = d !== null ? AREAS[d] : undefined;
      this.show(`hall:${lv}`, A !== undefined ? `마을회관 Lv.${lv}: ${A.name} 손님과 놀이부스가 와요` : `마을회관 Lv.${lv}까지`, hallCost, () => this.ctx.showBuilding('hall'));
      return;
    }
    this.hide();
  }

  /**
   * 열려 손님을 받는 단체 놀이 가운데 아직 구경하지 않았고 지금 판이 모이거나 한창인 것 (없으면 null).
   * 경주장은 셋째 묶음 전부터 있던 놀이라 뺀다 (이미 하던 사람에게 다시 권하지 않게).
   */
  private toWatch(): GroupBoothId | null {
    const sim = this.ctx.sim;
    const st = sim.state;
    for (const b of GROUP_BOOTHS) {
      if (b === 'race' || this.seen.watched.includes(b) || !sim.boothOpen(b)) continue;
      const ph = st.booths[b].group?.phase;
      if (ph === 'running' || (ph === 'gathering' && (st.booths[b].group?.participants.length ?? 0) > 0)) return b;
    }
    return null;
  }

  /**
   * 권할 첫 가게 (다섯째 묶음, 없으면 null): 열린 부스가 SHOP_AFTER_BOOTHS 이상이고 가진 가게가 FIRST_SHOPS보다 적을 때,
   * 지금 마을회관 레벨로 지을 수 있는 가장 싼 가게 (둘째는 가진 가게와 다른 묶음을 먼저: 간식 노점 다음 점집 …).
   */
  private firstShop(): { id: ShopId; cost: Cost } | null {
    const sim = this.ctx.sim;
    const st = sim.state;
    const owned = SHOP_IDS.filter((s) => shopOwned(st, s));
    if (owned.length >= FIRST_SHOPS || BOOTH_IDS.filter((b) => st.booths[b].unlocked).length < SHOP_AFTER_BOOTHS) return null;
    const cats = new Set(owned.map((s) => SHOPS[s].category));
    let best: { id: ShopId; cost: Cost; rank: number } | null = null;
    for (const s of SHOP_IDS) {
      if (shopOwned(st, s) || sim.shopLockReason(s) !== null) continue;
      const cost = sim.shopBuyCost(s);
      if (cost === null) continue;
      const rank = cost.coins + (cats.has(SHOPS[s].category) ? 1000 : 0);
      if (best === null || rank < best.rank) best = { id: s, cost, rank };
    }
    return best === null ? null : { id: best.id, cost: best.cost };
  }

  /** 전당포·일터·은행을 권할 때인가: 돈이 떨어진 손님을 보았거나 밀어내기 대결장을 열었다. */
  private debtMatters(): boolean {
    return this.seen.broke || this.ctx.sim.state.booths.ssireum.unlocked;
  }

  /** 아직 안 지었고 지금 마을회관 레벨로 지을 수 있는 넷째 묶음 건물 (DEBT_BUILD 차례, 없으면 null). */
  private debtBuild(): { id: BuildingId; why: string; cost: Cost } | null {
    const sim = this.ctx.sim;
    for (const d of DEBT_BUILD) {
      if (sim.buildingBuilt(d.id) || sim.buildingLockReason(d.id) !== null) continue;
      const cost = sim.buildingUpgradeCost(d.id);
      if (cost !== null) return { id: d.id, why: d.why, cost };
    }
    return null;
  }

  /** 열린 구역에서 아직 닫힌 부스 가운데, 귀한 물건은 다 있는 가장 싼 것 (없으면 null). */
  private nextBooth(): { booth: BoothId; cost: Cost } | null {
    const sim = this.ctx.sim;
    const st = sim.state;
    let best: { booth: BoothId; cost: Cost } | null = null;
    for (const b of BOOTH_IDS) {
      if (st.booths[b].unlocked || sim.boothLockReason(b) !== null) continue;
      const cost = sim.boothUnlockCost(b);
      if (cost === null) continue;
      const precious = Object.entries(cost.precious ?? {}) as [PreciousId, number | undefined][];
      if (precious.some(([k, n]) => (st.precious[k] ?? 0) < (n ?? 0))) continue;
      if (best === null || cost.coins < best.cost.coins) best = { booth: b, cost };
    }
    return best;
  }

  private show(key: string, text: string, cost: Cost | null, action: () => void): void {
    this.action = action;
    this.el.hidden = false;
    setText(this.text, text);
    if (key !== this.sig) {
      this.sig = key;
      this.items.replaceChildren();
      if (cost !== null) {
        const add = (k: string, need: number): void => {
          const v = h('span', 'n');
          const chip = h('span', 'it', itemIcon(k), v);
          chip.dataset.k = k;
          chip.dataset.need = String(need);
          chip.title = itemName(k);
          this.items.append(chip);
        };
        if (cost.coins > 0) add('coin', cost.coins);
        for (const [k, n] of Object.entries(cost.mats ?? {}) as [MaterialId, number | undefined][]) if (n) add(k, n);
        for (const [k, n] of Object.entries(cost.precious ?? {}) as [PreciousId, number | undefined][]) if (n) add(k, n);
      }
    }
    // 모은 수 / 필요한 수
    const st = this.ctx.sim.state;
    for (const chip of Array.from(this.items.children) as HTMLElement[]) {
      const k = chip.dataset.k ?? '';
      const need = Number(chip.dataset.need ?? 0);
      const have = k === 'coin' ? st.coins : (st.materials as Record<string, number>)[k] ?? (st.precious as Record<string, number>)[k] ?? 0;
      const v = chip.querySelector('.n');
      if (v !== null) setText(v, `${fmt(Math.min(have, need))}/${fmt(need)}`);
      chip.classList.toggle('ok', have >= need);
    }
  }

  private hide(): void {
    this.el.hidden = true;
    this.sig = '';
  }

  /** 지금 살 수 있는 짓기 가운데 가장 싼 것 (없으면 null). */
  private cheapest(): Buyable | null {
    const sim = this.ctx.sim;
    const st = sim.state;
    let best: Buyable | null = null;
    const consider = (cost: Cost | null, label: string, key: CatalogKey): void => {
      if (cost === null || !sim.canAfford(cost)) return;
      if (best === null || cost.coins < best.coins) best = { label, coins: cost.coins, key };
    };
    const debtOk = this.debtMatters();
    for (const id of BUILDING_IDS as BuildingId[]) {
      if (sim.buildingLockReason(id) !== null) continue;
      const lv = st.buildings[id].level;
      // 아직 안 지은 전당포·일터·은행은 권할 때가 되어야 (debtMatters).
      if (lv < 1 && !debtOk && DEBT_BUILD.some((d) => d.id === id)) continue;
      consider(sim.buildingUpgradeCost(id), lv < 1 ? `지금 지을 수 있어요: ${BUILDINGS[id].name}` : `지금 올릴 수 있어요: ${BUILDINGS[id].name} Lv.${lv + 1}`, id);
    }
    for (const b of BOOTH_IDS as readonly BoothId[]) {
      if (st.booths[b].unlocked) consider(sim.boothUpgradeCost(b), `지금 올릴 수 있어요: ${BOOTHS[b].name} Lv.${st.booths[b].level + 1}`, b);
      else if (sim.boothLockReason(b) === null) consider(sim.boothUnlockCost(b), `지금 열 수 있어요: ${BOOTHS[b].name}`, b);
    }
    // 가게 (다섯째 묶음): 첫 가게를 지은 뒤부터 (그 전엔 firstShop이 따로 권한다).
    if (SHOP_IDS.some((s) => shopOwned(st, s))) {
      for (const s of SHOP_IDS) {
        const lv = st.shops[s].level;
        if (lv >= 1) consider(sim.shopUpgradeCost(s), `지금 올릴 수 있어요: ${SHOPS[s].name} Lv.${lv + 1}`, s);
        else if (sim.shopLockReason(s) === null) consider(sim.shopBuyCost(s), `지금 지을 수 있어요: ${SHOPS[s].name}`, s);
      }
    }
    return best;
  }
}
