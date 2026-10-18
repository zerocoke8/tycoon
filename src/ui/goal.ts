// 다음 목표 칩 (HUD 아래)과 아래 탭의 점 배지: 처음 하는 사람이 무엇을 할지 알게.
// 목표 차례: 손님 응원하기 → 부스 구경하기 → 새로 열린 구역 보러 가기 → 진행자 자리가 비어 쉬는 부스 →
// 처음 열린 빚 걸기 판 보러 가기 → 처음 생긴 일터 채무자 응원하러 가기 (넷째 묶음) →
// 아직 구경하지 않은 단체 놀이의 판이 모이거나 한창이면 지도에서 구경하기 →
// 전당포(회관 1)·일터·은행(회관 2)을 지을 수 있으면 짓기 (빈털터리 손님을 본 뒤나 밀어내기를 연 뒤에만: 그 전엔 할 일이 없다) → 지금 살 수 있는 가장 싼 짓기 →
// 열린 구역의 다음 부스(귀한 물건은 이미 모았을 때)·아직 안 지은 전당포·일터·은행 → 다음 마을회관까지 모은 정도 (그 레벨에 열리는 구역).
// 칩을 누르면 그 화면을 연다. 처음 두 단계와 구경한 단체 놀이는 이 브라우저에 기억한다 (게임 저장과 따로, 없어도 된다).

import { BOOTH_IDS, BOOTHS, boothDef, BUILDINGS, DEBT_MATCH, GROUP_BOOTHS, type BoothId, type BuildingId, type GroupBoothId, type MaterialId, type PreciousId } from '../data/defs.ts';
import { BOOTH_SPOTS, DISTRICTS, type DistrictId } from '../data/map.ts';
import type { Cost } from '../sim/api.ts';
import { josa } from '../sim/text.ts';
import { fmt, h, setText } from './dom.ts';
import { groupGame } from '../sim/group/index.ts';
import { groupWatchBox, groupWatchZoom, roundWord, startWord } from './groupText.ts';
import { boothShort, boothsIn, boothTiny, BUILDING_IDS, districtAtHall, itemName } from './labels.ts';
import type { TabId, UiCtx } from './panel.ts';
import { itemIcon } from './pics.ts';

const HINT_KEY = 'mpv-hints-v1';
/** 새로 열린 구역 목표를 보여 주는 시간 (ms). */
const FRESH_MS = 90_000;

interface Seen {
  cheer: boolean;
  booth: boolean;
  /** 일터 시트를 열어 채무자를 보았다 (넷째 묶음). */
  yard: boolean;
  /** 빚 걸기 판을 부스 패널로 보았다. */
  debtMatch: boolean;
  /** 돈이 떨어진 손님을 처음 보았다 (그때부터 전당포·일터·은행 짓기를 권한다). */
  broke: boolean;
  /** 구경한 단체 놀이 (부스 패널을 열었거나 목표 칩으로 지도에서 보았다). */
  watched: string[];
}

/** 한 번 보면 끝나는 목표. */
export type SeenKey = 'cheer' | 'booth' | 'yard' | 'debtMatch';

function loadSeen(): Seen {
  try {
    const raw = JSON.parse(localStorage.getItem(HINT_KEY) ?? '{}') as Partial<Seen>;
    return {
      cheer: raw.cheer === true,
      booth: raw.booth === true,
      yard: raw.yard === true,
      debtMatch: raw.debtMatch === true,
      broke: raw.broke === true,
      watched: Array.isArray(raw.watched) ? raw.watched.filter((x): x is string => typeof x === 'string') : [],
    };
  } catch {
    return { cheer: false, booth: false, yard: false, debtMatch: false, broke: false, watched: [] };
  }
}

/** 넷째 묶음 건물을 짓는 차례 (은행은 일터가 있어야 빌려준다)와 칩 글. */
const DEBT_BUILD: readonly { readonly id: BuildingId; readonly why: string }[] = [
  { id: 'pawnshop', why: '돈이 떨어진 손님이 장신구를 맡겨요' },
  { id: 'workyard', why: '못 갚은 빚을 일해서 갚는 곳' },
  { id: 'bank', why: '맡길 장신구도 없는 손님에게 빌려줘요' },
];

/** 지금 살 수 있는 것 하나 (가장 싼 것). */
interface Buyable {
  readonly label: string;
  readonly coins: number;
}

export class GoalChip {
  readonly el: HTMLButtonElement;
  private readonly ctx: UiCtx;
  private readonly text: HTMLSpanElement;
  private readonly items: HTMLSpanElement;
  private readonly seen: Seen = loadSeen();
  private action: () => void = () => {};
  private sig = '';
  /** 막 열린 구역 (칩을 누르거나 FRESH_MS가 지나면 사라진다). */
  private fresh: { readonly id: DistrictId; readonly until: number } | null = null;

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
    ctx.sim.bus.on('districtOpened', (e) => {
      if (DISTRICTS[e.district].hall > 1) this.fresh = { id: e.district, until: performance.now() + FRESH_MS };
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
    const needHost = BOOTH_IDS.some((b) => st.booths[b].unlocked && !sim.boothOpen(b));
    setBadge('staff', needHost && (st.staff.some((s) => s.post === null) || st.candidates.some((c) => c.cost <= st.coins)));
    setBadge('workshop', st.crafting.length < sim.craftSlots() && sim.availableRecipes().some((r) => r.affordable));

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
    // 새로 열린 구역: 보러 가기 (첫 부스 자리로 카메라)
    const fresh = this.fresh;
    if (fresh !== null && performance.now() < fresh.until) {
      const D = DISTRICTS[fresh.id];
      const first = boothsIn(fresh.id)[0];
      this.show(`district:${fresh.id}`, `새 구역이 열렸어요: ${D.name} 보러 가기`, null, () => {
        this.fresh = null;
        this.ctx.closeAll();
        this.ctx.hooks.world.focusOn(first !== undefined ? BOOTH_SPOTS[first].base : { x: D.rect.x + D.rect.w / 2, y: D.rect.y + D.rect.h / 2 });
        this.ctx.markDirty();
      });
      return;
    }
    if (fresh !== null) this.fresh = null;

    // 열렸는데 꼭 있어야 하는 진행자 자리가 빈 부스 (경주장은 출발 신호·해설자 둘)
    const idle = BOOTH_IDS.find((b) => st.booths[b].unlocked && !sim.boothOpen(b));
    if (idle !== undefined) {
      const roles = boothDef(idle).roles;
      const role = roles.findIndex((r, i) => r.optional !== true && (st.booths[idle].staff[i] ?? null) === null);
      const name = roles[role]?.name ?? '진행자';
      const where = roles.length > 1 ? `${boothTiny(idle)} ${name}` : boothShort(idle);
      if (st.staff.some((x) => x.post === null)) {
        // 부스 패널을 열고 그 자리의 '세우기' 고르기를 바로 연다.
        this.show(`host:${idle}.${role}`, `${where} 자리에 진행자를 세워 주세요`, null, () => this.ctx.showBooth(idle, role));
        return;
      }
      const cheapest = st.candidates.reduce<number | null>((m, c) => (m === null || c.cost < m ? c.cost : m), null);
      // 주민 탭을 고용 후보 칸으로 굴려 연다. 자리 이름('출발 신호')은 사람이 아니라 자리로 말한다.
      this.show(`hire:${idle}.${role}`, `진행자를 고용해 주세요 (${roles.length > 1 ? `${where} 자리` : BOOTHS[idle].name})`, cheapest === null ? null : { coins: cheapest }, () => this.ctx.openHire());
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
        this.ctx.hooks.world.focusOn(groupWatchBox(watch).c, groupWatchZoom(watch, window.innerWidth, window.innerHeight));
      });
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
      this.show(`buy:${buy.label}`, buy.label, null, () => this.ctx.openTab('build'));
      return;
    }

    // 열린 구역의 다음 부스(귀한 물건은 이미 모았을 때)·아직 안 지은 전당포·일터·은행과 다음 마을회관 가운데 코인이 덜 드는 쪽
    const next = this.nextBooth();
    const hallCost = sim.buildingUpgradeCost('hall');
    if (debt !== null && (next === null || debt.cost.coins <= next.cost.coins) && (hallCost === null || debt.cost.coins <= hallCost.coins)) {
      this.show(`debtNext:${debt.id}`, `${BUILDINGS[debt.id].name} 짓기까지`, debt.cost, () => this.ctx.showBuilding(debt.id));
      return;
    }
    if (next !== null && (hallCost === null || next.cost.coins <= hallCost.coins)) {
      this.show(`booth:${next.booth}`, `${BOOTHS[next.booth].name} 열기까지`, next.cost, () => this.ctx.showBooth(next.booth));
      return;
    }
    if (hallCost !== null) {
      const lv = sim.hallLevel() + 1;
      const d = districtAtHall(lv);
      this.show(`hall:${lv}`, d !== null ? `마을회관 Lv.${lv}: ${josa(DISTRICTS[d].name, '이', '가')} 열려요` : `마을회관 Lv.${lv}까지`, hallCost, () => this.ctx.showBuilding('hall'));
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
    const consider = (cost: Cost | null, label: string): void => {
      if (cost === null || !sim.canAfford(cost)) return;
      if (best === null || cost.coins < best.coins) best = { label, coins: cost.coins };
    };
    const debtOk = this.debtMatters();
    for (const id of BUILDING_IDS as BuildingId[]) {
      if (sim.buildingLockReason(id) !== null) continue;
      const lv = st.buildings[id].level;
      // 아직 안 지은 전당포·일터·은행은 권할 때가 되어야 (debtMatters).
      if (lv < 1 && !debtOk && DEBT_BUILD.some((d) => d.id === id)) continue;
      consider(sim.buildingUpgradeCost(id), lv < 1 ? `지금 지을 수 있어요: ${BUILDINGS[id].name}` : `지금 올릴 수 있어요: ${BUILDINGS[id].name} Lv.${lv + 1}`);
    }
    for (const b of BOOTH_IDS as readonly BoothId[]) {
      if (st.booths[b].unlocked) consider(sim.boothUpgradeCost(b), `지금 올릴 수 있어요: ${BOOTHS[b].name} Lv.${st.booths[b].level + 1}`);
      else if (sim.boothLockReason(b) === null) consider(sim.boothUnlockCost(b), `지금 열 수 있어요: ${BOOTHS[b].name}`);
    }
    return best;
  }
}
