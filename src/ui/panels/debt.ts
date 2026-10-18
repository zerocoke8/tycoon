// 넷째 묶음 시트 (DESIGN 3.7): 지도·짓기 탭에서 전당포·은행·일터를 누르면 열린다.
// 전당포 = 맡긴 장신구(주인·되찾는 값)와 진열장(못 찾고 떠난 장신구 컬렉션), 은행 = 마을 금고와 빚이 있는 손님,
// 일터 = 일꾼마다 빚 게이지·응원·간식, 자리를 기다리는 손님, 지금까지 나온 재료, 빚 걸기 판. 맨 아래는 건물 레벨(업그레이드).
// 아직 짓지 않았으면 무엇을 하는 곳인지와 짓기 칸만.

import { ACCESSORIES, ACCESSORY_IDS, BANK, BOOTHS, BUILDINGS, DEBT_MATCH, LABOR, PAWN, VAULT, WORK_FACILITIES, type AccessoryId, type GroupBoothId, type MaterialId, type WorkFacility } from '../../data/defs.ts';
import type { SimApi } from '../../sim/api.ts';
import { bankLoan, debtEligible, laborGauge, laborSecLeft, loanDebt, pawnPrice, redeemCost, workSlots } from '../../sim/debt.ts';
import { josa } from '../../sim/text.ts';
import type { GameState, Monster, MonsterId, PawnTicket } from '../../sim/types.ts';
import { btn, fmt, fmtSec, h, setText, type Child } from '../dom.ts';
import { icon } from '../icons.ts';
import { accessoryInfo, buildingEffect, buildingMaxLevel, facilityName, facilityTool, itemName, monsterStatus, SLOT_NAME } from '../labels.ts';
import { openSnackMenu } from '../monsterCard.ts';
import { BasePanel, type UiCtx } from '../panel.ts';
import { itemIcon, mapPic, monsterPic, staffPic } from '../pics.ts';
import { makeBar, secHead } from '../widgets.ts';
import { buildingArt, costAction, effLine, placeRow, startPlace } from './build.ts';

export type DebtBuildingId = 'pawnshop' | 'bank' | 'workyard';

/** 건물마다 주인 (characters/<art>)과 한마디. */
const NPC: Record<DebtBuildingId, { readonly art: string; readonly name: string; readonly line: string }> = {
  pawnshop: { art: 'pawnbroker', name: '전당포 주인', line: '“맡긴 물건은 잘 닦아 둘게. 꼭 찾으러 오렴.”' },
  bank: { art: 'banker', name: '은행원', line: '“빌린 코인은 떠나기 전에 꼭 갚아 주세요.”' },
  workyard: { art: 'foreman', name: '일터 반장', line: '“천천히, 꾸준히! 다 갚으면 홀가분해질 거야.”' },
};

/** 짓기 전에 보여 주는 '이런 곳이에요' 줄. */
const HOW: Record<DebtBuildingId, readonly string[]> = {
  pawnshop: [
    '돈이 떨어진 손님이 몸에 단 장신구를 맡기고 코인을 빌려요 (마을 금고에서 나가요).',
    `따서 지갑이 넉넉해지면 빌린 코인의 ${PAWN.redeemMarkup}배를 내고 되찾아 가요.`,
    '못 찾고 떠난 장신구는 진열장에 모여요.',
  ],
  bank: [
    '맡길 장신구도 없는 손님에게 코인을 빌려줘요.',
    `갚을 돈은 빌린 코인의 ${BANK.interest}배. 떠날 때 못 갚으면 일터에서 일해 갚아요.`,
    '일터가 있어야 빌려줄 수 있어요.',
  ],
  workyard: [
    '떠날 때 빚을 못 갚은 손님이 밭과 광산에서 일해 빚을 갚아요.',
    '일한 만큼 채소·광석이 마을 창고로 들어와요.',
    '응원과 간식으로 빨리 일하게 도와줄 수 있어요. 다 갚으면 홀가분하게 떠나 단골이 돼요.',
  ],
};

/** 금고가 지금 한 번에 빌려줄 수 있는 코인 (sim/debt.ts canLend와 같은 규칙). */
function lendLimit(coins: number): number {
  return Math.max(0, Math.floor(Math.min(coins - VAULT.reserve, coins * VAULT.maxShare)));
}

/** amount를 빌려주려면 있어야 하는 마을 코인. */
function coinsToLend(amount: number): number {
  return Math.ceil(Math.max(amount + VAULT.reserve, amount / VAULT.maxShare));
}

/** 일꾼마다 낸 재료 (화면을 연 뒤 sim laborOutput을 센다). 시설마다 모두는 sim debtTotals.laborBy. */
export class DebtLog {
  private readonly byMonster = new Map<MonsterId, number>();

  constructor(sim: SimApi) {
    sim.bus.on('laborOutput', (e) => {
      this.byMonster.set(e.id, (this.byMonster.get(e.id) ?? 0) + 1);
    });
  }

  made(id: MonsterId): number {
    return this.byMonster.get(id) ?? 0;
  }
}

/** 빚 걸기 판 부스의 짧은 이름 (일꾼 줄 상태가 좁은 폰에서 잘리지 않게). */
const MATCH_SHORT: Record<GroupBoothId, string> = { ssireum: '밀어내기', tug: '줄다리기', race: '경주장', boat: '오리배', kite: '연날리기', dig: '보물찾기' };

/** 일터 손님의 지금 모습: 일함·오는 중·자리 기다림·빚 걸기 판·다 갚음. */
type WorkerKind = 'work' | 'coming' | 'wait' | 'match' | 'done';

function workerKind(m: Monster): WorkerKind | null {
  if (m.bankrupt !== true) return m.phase === 'relieved' && m.wasBankrupt === true ? 'done' : null;
  if ((m.labor?.match ?? null) !== null) return 'match';
  if (m.phase === 'working') return 'work';
  if (m.phase === 'waitWork') return 'wait';
  return 'coming';
}

/** 마을에 있는 손님이 맡긴 장신구 (손님 순서, 맡긴 차례). */
function pawnedNow(st: GameState): { m: Monster; t: PawnTicket }[] {
  return st.monsters.flatMap((m) => m.pawned.map((t) => ({ m, t })));
}

/** 맡긴 장신구 주인의 지금 (되찾으러 오는 중, 떠나는 중, 지갑). */
function ticketStatus(m: Monster | undefined, t: PawnTicket): string {
  if (m === undefined) return '떠났어요';
  if (m.errand === 'redeem' && (m.phase === 'toPawnshop' || m.phase === 'atPawnshop')) return '되찾으러 오는 중!';
  if (m.phase === 'leaving') return '집에 가는 중… 못 찾으면 진열장으로';
  if (m.bankrupt === true) return '파산해서 못 찾아요';
  return m.wallet >= redeemCost(t) ? `지갑 ${fmt(m.wallet)} · 되찾을 만큼 있어요` : `지갑 ${fmt(m.wallet)}`;
}

/** 전당포·은행·일터 시트의 바탕: 짓기 전 = 설명과 짓기, 지은 뒤 = 내용 + 레벨 칸 + 지도에서 보기. */
abstract class DebtSheet extends BasePanel {
  protected readonly id: DebtBuildingId;

  constructor(ctx: UiCtx, id: DebtBuildingId) {
    super(ctx, `mpv-debt ${id}`);
    this.id = id;
  }

  override head(): readonly [string, string] {
    const lv = this.st.buildings[this.id].level;
    return [BUILDINGS[this.id].name, lv < 1 ? '빈 부지' : `Lv.${lv}`];
  }

  sig(): string {
    const lv = this.st.buildings[this.id].level;
    return lv < 1 ? `${this.id}|0|${this.sim.hallLevel()}` : `${this.id}|${lv}|${this.contentSig()}`;
  }

  /** 지은 뒤 내용의 구조 서명 (목록이 바뀌면 다시 짓는다). */
  protected abstract contentSig(): string;
  protected abstract content(): void;

  protected build(): void {
    if (this.st.buildings[this.id].level < 1) {
      this.unbuilt();
      return;
    }
    this.content();
    this.levelCard();
  }

  /** 주인 카드: 그림, 이름, 한마디, 누적 기록 셋. */
  protected npcHead(stats: readonly (readonly [string, () => number])[]): HTMLElement {
    const n = NPC[this.id];
    const totals = h('div', 'mpv-totals three');
    for (const [label, get] of stats) {
      const b = h('b');
      this.live.add(() => setText(b, fmt(get())));
      totals.append(h('div', 'mpv-total', b, h('small', null, label)));
    }
    return h('div', 'mpv-card mpv-npc', h('span', 'mpv-thumb npc', staffPic(n.art, n.name)), h('div', 'mpv-grow', h('div', 'mpv-title sm', n.name), h('div', 'mpv-npc-line', n.line), totals));
  }

  private unbuilt(): void {
    const id = this.id;
    const d = BUILDINGS[id];
    const lock = this.sim.buildingLockReason(id);
    const first = buildingEffect(id, 1);
    const npc = NPC[id];
    // 짓기 버튼이 짧은 폰에서도 첫 화면에 보이게: 머리 카드(작은 그림) → 짓기 → 이런 곳이에요.
    this.el.append(
      h(
        'div',
        'mpv-card dim',
        h('span', 'mpv-thumb', mapPic(buildingArt(id), d.name)),
        h('div', 'mpv-grow', h('div', 'mpv-desc', d.desc), lock !== null ? h('div', 'mpv-lock', lock) : h('div', 'mpv-note strong', `아직 빈 부지예요. 지으면 ${josa(npc.name, '이', '가')} 와요.`)),
      ),
      h('div', 'mpv-card col', first !== null ? effLine('지으면', first, true) : null, costAction(this.ctx, this.live, this.sim.buildingUpgradeCost(id), '짓고 놓기', () => startPlace(this.ctx, id), '최고 레벨이에요', lock !== null)),
      secHead('이런 곳이에요'),
      h('ul', 'mpv-how', ...HOW[id].map((t) => h('li', null, t))),
      this.mapButton(),
    );
  }

  /** 건물 레벨: 지금 효과 + 다음 레벨 비용과 업그레이드. */
  private levelCard(): void {
    const id = this.id;
    const lv = this.st.buildings[id].level;
    const max = buildingMaxLevel(id);
    const now = buildingEffect(id, lv);
    const next = lv < max ? buildingEffect(id, lv + 1) : null;
    this.el.append(
      secHead(`${BUILDINGS[id].name} 레벨`, `Lv.${lv} / ${max}`),
      h(
        'div',
        'mpv-card col',
        now !== null ? effLine('지금', now) : null,
        next !== null ? effLine('다음', next, true) : null,
        costAction(this.ctx, this.live, this.sim.buildingUpgradeCost(id), '업그레이드', () => this.sim.upgradeBuilding(id)),
      ),
      this.mapButton(),
    );
  }

  private mapButton(): HTMLElement {
    const v = this.sim.village();
    if (v.placed(this.id) === undefined) return placeRow(this.ctx, this.id) ?? h('div');
    return h(
      'div',
      'mpv-col',
      h(
        'div',
        'mpv-act',
        btn('sub wide', [icon('pin'), '지도에서 보기'], () => {
          this.ctx.closeAll();
          this.ctx.hooks.world.focusOn(v.art(this.id));
        }),
      ),
      placeRow(this.ctx, this.id),
    );
  }

  /** 금고 한 줄 (amount = 이 가게가 한 번에 빌려주는 코인, minAmount = 가장 적은 것). 모자라면 붉게. */
  protected vaultLine(amount: () => number, minAmount: () => number = amount): HTMLElement {
    const text = h('span', 'mpv-grow');
    const el = h('div', 'mpv-vault', itemIcon('coin'), text);
    this.live.add(() => {
      const coins = this.st.coins;
      const limit = lendLimit(coins);
      const a = amount();
      const lo = minAmount();
      const short = limit < lo;
      const some = !short && limit < a;
      // 넉넉하면 숫자 없이 (한 번에 빌려주는 것보다 훨씬 커서 숫자가 뜻이 없다): 모자라거나 일부만 될 때만 숫자.
      el.classList.toggle('warn', short);
      el.classList.toggle('some', some);
      setText(
        text,
        short
          ? `마을 금고가 모자라 빌려주지 못해요. 마을 코인이 ${fmt(coinsToLend(lo))} 이상이어야 해요.`
          : some
            ? `금고: 한 번에 ${fmt(limit)}코인까지 (큰 것은 마을 코인이 ${fmt(coinsToLend(a))} 이상이어야 해요)`
            : `금고 넉넉해요 (마을 코인에서 빌려줘요, ${fmt(VAULT.reserve)}코인은 남겨요)`,
      );
    });
    return el;
  }

  /** 손님 한 줄 버튼 (누르면 손님 카드): 그림, 이름, 작은 글(live), 오른쪽 것들. */
  protected guestRow(m: Monster, sub: () => string, cls: string, ...right: Child[]): HTMLElement {
    const id = m.id;
    const small = h('small');
    const face = monsterPic(m.species, m.pose, m.nickname);
    const el = h('button', `mpv-entry ${cls}`.trim(), face, h('span', 'who', h('b', null, m.nickname), small), ...right);
    el.type = 'button';
    el.setAttribute('aria-label', `${m.nickname} 손님 보기`);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.sim.monster(id) !== undefined) this.ctx.showMonster(id);
      else this.ctx.toast(`${m.nickname} 손님은 벌써 집에 갔어요`);
    });
    this.live.add(() => setText(small, sub()));
    return el;
  }
}

// ── 전당포 ──

export class PawnshopPanel extends DebtSheet {
  constructor(ctx: UiCtx) {
    super(ctx, 'pawnshop');
  }

  protected contentSig(): string {
    const st = this.st;
    const col = ACCESSORY_IDS.map((k) => st.pawnCollection[k] ?? 0).join(',');
    return `${col}|${pawnedNow(st)
      .map(({ m, t }) => `${m.id}.${t.key}`)
      .join(',')}`;
  }

  protected content(): void {
    const st = this.st;
    const tot = st.debtTotals;
    this.el.append(
      this.npcHead([
        ['맡김', () => tot.pawned],
        ['되찾음', () => tot.redeemed],
        ['진열장', () => tot.forfeited],
      ]),
      this.vaultLine(
        () => pawnPrice(this.st, { value: ACCESSORIES.acc_mini_crown.value[1] }),
        () => pawnPrice(this.st, { value: Math.min(...ACCESSORY_IDS.map((k) => ACCESSORIES[k].value[0])) }),
      ),
    );

    // 맡긴 장신구: 주인과 되찾는 값 (따서 지갑이 넉넉해지면 되찾으러 온다).
    const tickets = pawnedNow(st);
    this.el.append(secHead('맡긴 장신구', tickets.length > 0 ? `${tickets.length}개 · 따면 되찾아 가요` : '손님이 따면 되찾아 가요'));
    if (tickets.length === 0) this.el.append(h('div', 'mpv-empty sm', '지금 맡겨진 장신구가 없어요'));
    else {
      const list = h('div', 'mpv-entries');
      for (const { m, t } of tickets) list.append(this.ticketRow(m, t));
      this.el.append(list);
    }

    // 진열장: 못 찾고 떠난 장신구 (도감처럼, 못 모은 것은 그림자).
    const col = st.pawnCollection;
    const kinds = ACCESSORY_IDS.filter((k) => (col[k] ?? 0) > 0).length;
    const total = ACCESSORY_IDS.reduce((n, k) => n + (col[k] ?? 0), 0);
    this.el.append(secHead('진열장', `${kinds} / ${ACCESSORY_IDS.length}종 · 모두 ${fmt(total)}개`), h('div', 'mpv-note src', '못 찾고 떠난 장신구가 여기 모여요. 귀한 것은 드물게 와요.'));
    const grid = h('div', 'mpv-acc');
    for (const k of ACCESSORY_IDS) grid.append(this.shelfCell(k, col[k] ?? 0));
    this.el.append(grid);
  }

  private ticketRow(m: Monster, t: PawnTicket): HTMLElement {
    const id = m.id;
    const d = ACCESSORIES[t.key];
    const status = h('small');
    const el = h(
      'button',
      d.rare ? 'mpv-entry mpv-ticket rare' : 'mpv-entry mpv-ticket',
      itemIcon(t.key, { cls: 'acc' }),
      h('span', 'who', h('b', null, d.name, h('small', 'lent', ` ${fmt(t.price)}코인 빌려줌`)), h('span', 'owner', monsterPic(m.species, 'base', m.nickname), h('span', 'nm', m.nickname)), status),
      h('span', 'mpv-redeem', h('small', null, '되찾는 값'), h('b', null, itemIcon('coin'), fmt(redeemCost(t)))),
    );
    el.type = 'button';
    el.setAttribute('aria-label', `${d.name} · ${m.nickname} 손님 보기`);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.sim.monster(id) !== undefined) this.ctx.showMonster(id);
    });
    this.live.add(() => {
      const c = this.sim.monster(id);
      setText(status, ticketStatus(c, t));
      el.classList.toggle('coming', c?.errand === 'redeem');
    });
    return el;
  }

  private shelfCell(k: AccessoryId, n: number): HTMLElement {
    const d = ACCESSORIES[k];
    const known = n > 0;
    const cell = h(
      'button',
      `mpv-acc-cell${known ? '' : ' none'}${d.rare ? ' rare' : ''}`,
      itemIcon(k),
      h('span', 'name', known ? d.name : '???'),
      h('span', 'slot', SLOT_NAME[d.slot]),
      known ? h('span', 'n', `×${fmt(n)}`) : null,
      d.rare ? h('span', 'rare-tag', '귀함') : null,
    );
    cell.type = 'button';
    cell.setAttribute('aria-label', known ? `${d.name} ${n}개` : '아직 없는 장신구');
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ctx.toast(known ? `${d.name} ×${fmt(n)} · ${accessoryInfo(k)}` : `아직 진열장에 없어요 · ${accessoryInfo(k)}`);
    });
    return cell;
  }
}

// ── 은행 ──

export class BankPanel extends DebtSheet {
  constructor(ctx: UiCtx) {
    super(ctx, 'bank');
  }

  protected contentSig(): string {
    const st = this.st;
    const owing = st.monsters.filter((m) => m.debt > 0 && m.bankrupt !== true).map((m) => m.id);
    const workers = st.monsters.filter((m) => m.bankrupt === true).length;
    return `${st.buildings.workyard.level}|${owing.join(',')}|${workers > 0 ? 1 : 0}`;
  }

  protected content(): void {
    const st = this.st;
    const tot = st.debtTotals;
    this.el.append(
      this.npcHead([
        ['대출', () => tot.loans],
        ['갚음', () => tot.repaid],
        ['파산', () => tot.bankrupt],
      ]),
    );
    // 일터가 없으면 빌려주지 않는다 (못 갚은 빚을 갚을 곳이 없다).
    if (!this.sim.buildingBuilt('workyard')) {
      this.el.append(h('div', 'mpv-rule warn', h('span', 'mpv-grow', '일터가 있어야 빌려줄 수 있어요 (떠날 때 못 갚은 빚을 일터에서 갚아요).'), btn('sub small', '일터 보기', () => this.ctx.showBuilding('workyard'))));
    }

    // 대출 조건과 마을 금고
    const amount = bankLoan(st);
    this.el.append(
      secHead('대출', `한 방문에 ${BANK.maxLoans}번까지`),
      h('div', 'mpv-card col', effLine('빌려줌', `한 번에 ${fmt(amount)}코인 · 갚을 돈 ${fmt(loanDebt(amount))} (×${BANK.interest})`), this.vaultLine(() => bankLoan(this.st))),
    );

    // 빚이 있는 손님 (아직 마을에서 노는 중)
    const owing = st.monsters.filter((m) => m.debt > 0 && m.bankrupt !== true);
    this.el.append(secHead('빚이 있는 손님', owing.length > 0 ? `${owing.length}명 · 따면 갚으러 와요` : '떠나기 전에 갚아요'));
    if (owing.length === 0) this.el.append(h('div', 'mpv-empty sm', '지금 빚이 있는 손님이 없어요'));
    else {
      const list = h('div', 'mpv-entries');
      for (const m of owing) {
        const id = m.id;
        const chip = h('span', 'mpv-chip debt');
        list.append(
          this.guestRow(
            m,
            () => {
              const c = this.sim.monster(id);
              if (c === undefined) return '';
              const busy = c.errand === 'repay' ? monsterStatus(c) : `지갑 ${fmt(c.wallet)} · ${c.wallet >= c.debt ? '갚을 만큼 있어요' : `${fmt(c.debt - c.wallet)} 모자라요`}`;
              return busy;
            },
            '',
            chip,
          ),
        );
        this.live.add(() => {
          const c = this.sim.monster(id);
          setText(chip, `빚 ${fmt(c?.debt ?? 0)}`);
          chip.classList.toggle('ok', c !== undefined && c.wallet >= c.debt);
        });
      }
      this.el.append(list);
    }

    // 파산해서 일터에서 갚는 손님
    if (st.monsters.some((m) => m.bankrupt === true)) {
      const text = h('span', 'mpv-grow');
      this.live.add(() => {
        const ws = this.st.monsters.filter((m) => m.bankrupt === true);
        setText(text, `일터에서 빚을 갚는 손님 ${ws.length}명 · 남은 빚 ${fmt(ws.reduce((n, m) => n + m.debt, 0))}`);
      });
      this.el.append(h('div', 'mpv-rule', text, btn('sub small', '일터 보기', () => this.ctx.showBuilding('workyard'))));
    }
  }
}

// ── 일터 ──

export class WorkyardPanel extends DebtSheet {
  private readonly log: DebtLog;

  constructor(ctx: UiCtx, log: DebtLog) {
    super(ctx, 'workyard');
    this.log = log;
  }

  /** 빚 걸기 판이 열린 부스와 다음 판이 빚 걸기 판으로 예약된 부스. */
  private matchBooths(): { on: GroupBoothId[]; next: GroupBoothId[] } {
    const on: GroupBoothId[] = [];
    const next: GroupBoothId[] = [];
    for (const b of DEBT_MATCH.booths) {
      const g = this.st.booths[b].group;
      if (g?.mode === 'debt') on.push(b);
      else if (g?.debtNext === true) next.push(b);
    }
    return { on, next };
  }

  protected contentSig(): string {
    const rows = this.st.monsters
      .map((m) => {
        const k = workerKind(m);
        return k === null ? '' : `${m.id}:${k}:${m.labor?.facility ?? '-'}`;
      })
      .filter((x) => x !== '');
    const mb = this.matchBooths();
    return `${rows.join(',')}|${mb.on.join('.')}+${mb.next.join('.')}`;
  }

  protected content(): void {
    const st = this.st;
    const tot = st.debtTotals;
    this.el.append(
      this.npcHead([
        ['파산', () => tot.bankrupt],
        ['다 갚음', () => tot.relieved],
        ['빚 걸기 판', () => tot.matches],
      ]),
    );

    const all = st.monsters.map((m) => ({ m, k: workerKind(m) })).filter((x): x is { m: Monster; k: WorkerKind } => x.k !== null);
    const order: Record<WorkerKind, number> = { done: 0, work: 1, match: 2, coming: 3, wait: 4 };
    all.sort((a, b) => order[a.k] - order[b.k] || (a.m.labor?.facility ?? '').localeCompare(b.m.labor?.facility ?? ''));
    const busy = all.filter((x) => x.k !== 'wait');
    const waiting = all.filter((x) => x.k === 'wait');

    // 일꾼: 자리마다 빚 게이지, 응원·간식
    const seats = h('small');
    this.live.add(() => setText(seats, WORK_FACILITIES.map((f) => `${facilityName(f)} ${this.usedSlots(f)}/${workSlots(this.st, f)}`).join(' · ')));
    this.el.append(h('div', 'mpv-sec', h('span', null, '일꾼'), seats));
    if (busy.length === 0 && waiting.length === 0) {
      this.el.append(h('div', 'mpv-empty sm', '일터가 조용해요. 떠날 때 빚을 못 갚은 손님이 여기서 일해요.'));
    } else {
      this.el.append(h('div', 'mpv-note src', `응원 톡 = ${LABOR.cheerSec}초 동안 ×${LABOR.cheerMult} · 간식 = ${LABOR.snackSec}초 동안 ×${LABOR.snackMult} 빨리 일해요`));
      if (busy.length > 0) {
        const list = h('div', 'mpv-workers');
        for (const x of busy) list.append(this.workerRow(x.m, x.k));
        this.el.append(list);
      }
    }
    if (waiting.length > 0) {
      this.el.append(secHead('자리를 기다리는 손님', `${waiting.length}명 · 일터를 올리면 자리가 늘어요`));
      const list = h('div', 'mpv-workers');
      for (const x of waiting) list.append(this.workerRow(x.m, x.k));
      this.el.append(list);
    }

    // 지금까지 나온 재료 (시설마다, 창고에 있는 수도)
    const allMats = h('span');
    this.live.add(() => setText(allMats, `지금까지 모두 ${fmt(this.st.debtTotals.laborMats)}개`));
    this.el.append(secHead('나온 재료', allMats));
    const grid = h('div', 'mpv-grid compact');
    for (const f of WORK_FACILITIES) {
      const mat: MaterialId = LABOR.facilities[f].material;
      const num = h('span', 'num');
      const src = h('span', 'src');
      const tile = h('div', 'mpv-tile', itemIcon(mat), h('span', 'name', `${facilityName(f)}: ${itemName(mat)}`), num, src);
      this.live.add(() => {
        const n = this.st.debtTotals.laborBy[f] ?? 0;
        setText(num, `+${fmt(n)}`);
        setText(src, `창고 ${fmt(this.st.materials[mat] ?? 0)}`);
        tile.classList.toggle('zero', n <= 0);
      });
      grid.append(tile);
    }
    this.el.append(grid);

    // 빚 걸기 판: 열린 판(보러 가기)과 예약된 판, 없으면 여는 조건.
    const mb = this.matchBooths();
    const go = mb.on[0] ?? mb.next[0] ?? null;
    const pool = h('span', 'mpv-grow');
    this.live.add(() => {
      // sim이 부를 수 있는 손님과 같은 규칙 (빚 DEBT_MATCH.minStake 이상, 이번 파산에 아직 안 겨룸).
      const n = this.st.monsters.filter(debtEligible).length;
      const cur = this.matchBooths();
      const parts = [
        ...cur.on.map((b) => `${BOOTHS[b].name}에서 빚 걸기 판이 열렸어요!`),
        ...cur.next.map((b) => `${BOOTHS[b].name}의 다음 판은 빚 걸기 판이에요.`),
      ];
      setText(pool, parts.length > 0 ? parts.join(' ') : `겨룰 빚진 손님이 ${DEBT_MATCH.minDebtors}명 이상이면 반장이 가끔 밀어내기에서, ${DEBT_MATCH.tugMin}명 이상이면 줄다리기에서도 빚 걸기 판을 열어요 (지금 ${n}명, 한 번 겨룬 손님은 다시 안 불러요).`);
    });
    this.el.append(
      secHead('빚 걸기 판', '이기면 빚 반 · 지면 상대 빚만큼 더'),
      h('div', go !== null ? 'mpv-rule debt on' : 'mpv-rule debt', pool, go !== null ? btn('small', '보러 가기', () => this.ctx.showBooth(go)) : null),
    );
  }

  /** 시설 f에서 일하는 자리를 쓰는 채무자 수. */
  private usedSlots(f: WorkFacility): number {
    return this.st.monsters.filter((m) => m.bankrupt === true && m.labor?.facility === f && m.labor.spot >= 0 && m.labor.match === null).length;
  }

  /** 일꾼 한 줄: [그림·이름·지금 모습] [응원][간식] / 빚 게이지와 남은 빚·시간·빨라짐. */
  private workerRow(m: Monster, kind: WorkerKind): HTMLElement {
    const id = m.id;
    const sim = this.sim;
    const face = monsterPic(m.species, 'sad', m.nickname);
    face.classList.add('debt');
    const status = h('small');
    const who = h('button', 'who tap', face, h('span', 'nm', h('b', null, m.nickname), status));
    who.type = 'button';
    who.setAttribute('aria-label', `${m.nickname} 손님 보기`);
    who.addEventListener('click', (e) => {
      e.stopPropagation();
      if (sim.monster(id) !== undefined) this.ctx.showMonster(id);
    });
    const f = m.labor?.facility ?? 'farm';
    const tool = kind === 'work' || kind === 'wait' ? h('span', 'mpv-fac', itemIcon(facilityTool(f)), facilityName(f)) : null;

    const bar = makeBar('labor');
    const left = h('small', 'left');
    const boost = h('span', 'boost');
    const gauge = h('div', 'gauge', bar.el, left, boost);

    const cd = h('span', 'cd');
    const cheer = btn('icon cheer', [icon('heart'), cd], () => {
      if (this.ctx.act(sim.cheer(id))) {
        cheer.classList.remove('pop');
        void cheer.offsetWidth;
        cheer.classList.add('pop');
      }
    });
    cheer.setAttribute('aria-label', `${m.nickname} 응원하기`);
    const snack = btn('icon butter', icon('cookie'), () => openSnackMenu(this.ctx, snack, id));
    snack.setAttribute('aria-label', `${m.nickname}에게 간식 주기`);
    const acts = kind === 'done' ? h('div', 'acts', h('span', 'mpv-res win', '다 갚았다!')) : h('div', 'acts', cheer, snack);

    const row = h('div', `mpv-worker ${kind}`, who, tool, acts, gauge);
    this.live.add(() => {
      const c = sim.monster(id);
      if (c === undefined) return;
      const k = workerKind(c) ?? kind;
      setText(status, this.workerStatus(c, k));
      bar.set(k === 'done' ? 1 : laborGauge(c), k === 'done' ? 'var(--dd-green)' : 'var(--dd-sky)');
      const lab = c.labor;
      const made = this.log.made(id);
      if (k === 'done') setText(left, '빚 0 · 홀가분하게 떠나요');
      else setText(left, `빚 ${fmt(c.debt)} 남음${k === 'work' ? ` · 약 ${fmtSec(laborSecLeft(this.st, c))}` : ''}${made > 0 ? ` · 재료 ${made}개` : ''}`);
      const on = lab !== null && lab !== undefined && lab.boostSec > 0 && k === 'work';
      setText(boost, on ? `×${lab.boostMult} ${Math.ceil(lab.boostSec)}초` : '');
      boost.hidden = !on;
      const cool = c.cheerCooldown;
      cheer.classList.toggle('cool', cool > 0);
      setText(cd, cool > 0 ? `${Math.ceil(cool)}` : '');
      cd.hidden = cool <= 0;
    });
    return row;
  }

  private workerStatus(m: Monster, k: WorkerKind): string {
    switch (k) {
      case 'work':
        return m.labor?.facility === 'mine' ? '곡괭이질 중… 영차' : '괭이질 중… 영차';
      case 'wait':
        return '자리 기다리는 중';
      case 'coming':
        return m.phase === 'reacting' ? '빚을 못 갚아 털썩…' : '고개 푹 숙이고 오는 중';
      case 'match': {
        const b = m.labor?.match ?? null;
        return b === null ? '빚 걸기 판 중' : `${MATCH_SHORT[b]}에서 빚 걸기 판`;
      }
      case 'done':
        return '빚을 다 갚았어요!';
    }
  }
}
