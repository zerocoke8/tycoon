// 부스 패널: 위쪽은 확대 화면(CloseupView, 캔버스), 아래는 HTML 부스 정보 시트.
// 열려 있는 동안 지도 입력을 막고, 확대 화면 둘레(그늘)를 누르면 닫힌다. 확대 화면 자리는 캔버스가 그대로 누르기를 받는다.

import { BOOTHS, boothDef, GOODS, RACE, SPECIES, STAFF_STAT_NAMES, type BoothId, type GoodId } from '../data/defs.ts';
import { RACERS, racePlace, raceStandings } from '../sim/race.ts';
import { josa } from '../sim/text.ts';
import type { BoothState, MonsterId, RaceResult, RaceState, RacerIndex } from '../sim/types.ts';
import { closeupRadius, type Rect } from '../view/contracts.ts';
import { btn, fmt, fmtSec, h, revealInSheet, setText } from './dom.ts';
import { icon } from './icons.ts';
import { boothEffect, boothPotCap, boothRule, RACER_COLOR, roleHelp, roleStat, seatWord } from './labels.ts';
import type { MenuItem } from './menu.ts';
import { BasePanel, type UiCtx } from './panel.ts';
import { itemIcon, monsterPic, pic, placeholder, racerPic, staffPic } from './pics.ts';
import { Sheet } from './sheet.ts';
import { openRoleMenu } from './staffMenu.ts';
import { costChips, makeBar, secHead, statBlock } from './widgets.ts';

const CHEERS = (Object.keys(GOODS) as GoodId[]).filter((g) => GOODS[g].kind === 'cheer');

function cheerSec(g: GoodId): number {
  const d = GOODS[g];
  return 'durationSec' in d ? d.durationSec : 0;
}

/**
 * 확대 화면 자리 (CSS px): HUD 아래, 좌우 12px. 넓은 화면에서는 가운데 600px까지.
 * 키가 작은 폰(720px 아래)은 높이를 화면의 40%로 줄여 아래 부스 정보(진행자·응원 도구·업그레이드)가 더 보이게,
 * 가로 화면에서는 폭을 높이의 1.6배까지만 (가로로 긴 띠가 되면 배경 소품만 커 보인다).
 */
export function closeupRect(safeTop: number): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const full = Math.max(160, Math.min(vw - 24, 600));
  const hh = Math.round(Math.min(full * 0.95, vh * (vh < 720 ? 0.4 : 0.48)));
  const w = Math.max(160, Math.min(full, Math.round(hh * 1.6)));
  const x = Math.round((vw - w) / 2);
  const y = Math.round(safeTop + 64);
  return { x, y, w, h: hh };
}

export class BoothPanel {
  private readonly ctx: UiCtx;
  private readonly root: HTMLElement;
  private readonly sheet: Sheet;
  private readonly shades: HTMLDivElement[];
  /** 둥근 구멍 그늘 (확대 화면 둘레를 어둡게, 모서리가 패널처럼 둥글다). 누르기는 네 shade가 받는다. */
  private readonly hole: HTMLDivElement;
  private readonly info: BoothInfo;
  booth: BoothId | null = null;

  constructor(ctx: UiCtx, parent: HTMLElement) {
    this.ctx = ctx;
    this.root = parent;
    this.shades = [0, 1, 2, 3].map(() => {
      const d = h('div', 'mpv-shade');
      d.addEventListener('click', (e) => {
        e.stopPropagation();
        ctx.closeAll();
      });
      parent.append(d);
      return d;
    });
    this.hole = h('div', 'mpv-shade-hole');
    parent.append(this.hole);
    this.sheet = new Sheet(parent, 'booth');
    this.sheet.onClose = () => ctx.closeAll();
    this.info = new BoothInfo(ctx);
    this.sheet.body.append(this.info.el);
  }

  get isOpen(): boolean {
    return this.booth !== null;
  }

  show(b: BoothId): void {
    const rect = closeupRect(this.ctx.insets().top);
    this.booth = b;
    this.info.booth = b;
    this.ctx.hooks.closeup.open(b, rect);
    this.ctx.hooks.world.setInputEnabled(false);
    this.place(rect);
    this.info.refresh(true);
    this.updateTitle();
    this.sheet.body.scrollTop = 0;
    this.sheet.open();
    for (const s of this.shades) s.classList.add('open');
    this.hole.classList.add('open');
    this.root.classList.add('booth-open');
  }

  close(): void {
    if (this.booth === null) return;
    this.booth = null;
    this.ctx.hooks.closeup.close();
    this.ctx.hooks.world.setInputEnabled(true);
    this.sheet.close();
    for (const s of this.shades) s.classList.remove('open');
    this.hole.classList.remove('open');
    this.root.classList.remove('booth-open');
  }

  /** 화면 크기가 바뀌었을 때. */
  layout(): void {
    if (this.booth === null) return;
    const rect = closeupRect(this.ctx.insets().top);
    this.ctx.hooks.closeup.layout(rect);
    this.place(rect);
  }

  refresh(): void {
    if (this.booth === null) return;
    this.info.refresh();
    this.updateTitle();
  }

  redraw(): void {
    if (this.booth === null) return;
    this.info.refresh(true);
  }

  /** 시트가 다 올라오면 진행자 자리 role을 시트 맨 위로 굴려 보여 주고 세울 사람 고르기를 연다 (다음 목표 칩). */
  focusRole(role: number): void {
    const b = this.booth;
    const row = this.info.roleRow(role);
    if (b === null || row === undefined) return;
    let done = false;
    const go = (): void => {
      if (done) return;
      done = true;
      if (this.booth !== b || !row.btn.isConnected) return;
      revealInSheet(row.el, 8, true, false);
      // 굴린 뒤의 버튼 자리에 판이 뜨게 한 프레임 뒤에.
      requestAnimationFrame(() => {
        if (this.booth === b && row.btn.isConnected && !this.ctx.menu.isOpen) openRoleMenu(this.ctx, row.btn, b, role);
      });
    };
    // 시트가 올라오는 움직임(0.26초)이 끝나면. 이미 열려 있어 움직임이 없으면 잠깐 뒤에.
    this.sheet.el.addEventListener('transitionend', go, { once: true });
    window.setTimeout(go, 600);
  }

  private updateTitle(): void {
    if (this.booth === null) return;
    const bs = this.ctx.sim.state.booths[this.booth];
    this.sheet.setTitle(BOOTHS[this.booth].name, `Lv.${bs.level}/${BOOTHS[this.booth].fee.length}`);
  }

  private place(r: Rect): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const boxes: [number, number, number, number][] = [
      [0, 0, vw, r.y],
      [0, r.y, r.x, r.h],
      [r.x + r.w, r.y, vw - r.x - r.w, r.h],
      [0, r.y + r.h, vw, vh - r.y - r.h],
    ];
    boxes.forEach(([x, y, w, hh], i) => {
      const s = this.shades[i];
      if (s === undefined) return;
      s.style.left = `${x}px`;
      s.style.top = `${y}px`;
      s.style.width = `${Math.max(0, w)}px`;
      s.style.height = `${Math.max(0, hh)}px`;
    });
    const hs = this.hole.style;
    hs.left = `${r.x}px`;
    hs.top = `${r.y}px`;
    hs.width = `${r.w}px`;
    hs.height = `${r.h}px`;
    hs.borderRadius = `${closeupRadius(r.w, r.h)}px`;
    this.sheet.el.style.setProperty('--booth-top', `${r.y + r.h + 10}px`);
  }
}

/** 경주에 건 손님 하나 (경주 상태가 없을 때는 자리마다의 한판에서). */
interface RaceSeat {
  readonly monster: MonsterId;
  readonly racer: RacerIndex;
  readonly bet: number;
}

/** 경주장 참가자: 경주 상태(BoothState.race)의 참가자, 없으면 지금 한판 중인 자리의 선수. */
function raceSeats(bs: BoothState): RaceSeat[] {
  const r = bs.race;
  if (r !== null && r.participants.length > 0) return r.participants;
  const out: RaceSeat[] = [];
  for (const rd of bs.rounds) {
    if (rd !== null && rd.outcome.detail.kind === 'race') out.push({ monster: rd.monster, racer: rd.outcome.detail.racer, bet: rd.bet });
  }
  return out;
}

/** 선수 순서: 달리는 중이면 지금 순위, 끝났으면 들어온 순서, 아니면 번호 순서. */
function racerOrder(race: RaceState | null): readonly RacerIndex[] {
  if (race === null || race.result === null) return RACERS;
  if (race.phase === 'running') return raceStandings(race.result, race.elapsed);
  if (race.phase === 'done') return race.result.finishOrder;
  return RACERS;
}

/** 손님 하나의 경주 결과 글: '역전 대박!' / '1등!' / '아깝다! 사진 판정' / '3등'. */
function raceResultTag(result: RaceResult, racer: RacerIndex): { text: string; cls: string } {
  const place = racePlace(result, racer);
  if (place === 1) return result.comeback ? { text: '역전 대박!', cls: 'gold' } : { text: '1등!', cls: 'win' };
  if (place === 2 && result.photoFinish) return { text: '아깝다! 사진 판정', cls: 'near' };
  return { text: `${place}등`, cls: '' };
}

/** 부스 정보 (시트 몸통). */
class BoothInfo extends BasePanel {
  booth: BoothId = 'slot';
  /** 진행자 자리 줄과 그 버튼 (BoothPanel.focusRole). */
  private readonly roleRows = new Map<number, { el: HTMLElement; btn: HTMLElement }>();
  /** 막 끝난 경주의 1등 (다음 경주를 모으는 처음 몇 초 동안 보여 준다: 확대 화면은 아직 결과를 보이는 중). */
  private lastWin: { text: string; at: number } | null = null;

  roleRow(role: number): { el: HTMLElement; btn: HTMLElement } | undefined {
    return this.roleRows.get(role);
  }

  sig(): string {
    const s = this.st;
    const bs = s.booths[this.booth];
    const race = this.booth === 'race' ? `${bs.race?.phase ?? '-'}:${raceSeats(bs).map((e) => `${e.monster}.${e.racer}`).join(',')}:${bs.seats.join('/')}` : '-';
    return [this.booth, bs.unlocked, bs.level, bs.staff.join('/'), bs.cheer?.good ?? '-', race, s.staff.map((st) => `${st.id}:${st.level}:${st.post === null ? '-' : `${st.post.booth}.${st.post.role}`}`).join(',')].join('|');
  }

  protected build(): void {
    const b = this.booth;
    const s = this.st;
    const bs = s.booths[b];
    const def = boothDef(b);

    this.roleRows.clear();
    const roles = this.buildRoles();
    // 열렸는데 꼭 있어야 하는 진행자가 없으면 맨 위에 알리고, 진행자 자리를 바로 아래에 (세우기 버튼이 먼저 보이게).
    const closed = bs.unlocked && !this.sim.boothOpen(b);
    if (closed) {
      const missing = def.roles.filter((r, i) => r.optional !== true && (bs.staff[i] ?? null) === null).map((r) => r.name);
      this.el.append(h('div', 'mpv-alert', def.roles.length > 1 ? `${missing.join('·')} 자리가 비어 쉬는 중이에요` : '진행자가 없어 쉬는 중이에요'), ...roles);
    }

    // 참가비 · 자리 · 줄
    const seatsV = h('span');
    const queueV = h('span');
    this.live.add(() => {
      const cur = this.st.booths[b];
      setText(seatsV, `${cur.seats.filter((x) => x !== null).length}/${this.sim.boothSeats(b)}`);
      setText(queueV, `${cur.queue.length}명`);
    });
    const matFee = def.matFee ?? 0;
    this.el.append(
      h(
        'div',
        'mpv-boxes',
        h('div', 'mpv-box', h('small', null, '참가비'), matFee > 0 ? h('b', 'txt', `특산 재료 ${matFee}개`) : h('b', null, itemIcon('coin'), fmt(this.sim.boothFee(b)))),
        h('div', 'mpv-box', h('small', null, seatWord(b)), h('b', null, seatsV)),
        h('div', 'mpv-box', h('small', null, '줄'), h('b', null, queueV)),
      ),
    );

    // 부스만의 규칙 (오리 낚시 반 돌려받기, 복주머니 재료 참가비 …)
    const rule = boothRule(b);
    if (rule !== null && b !== 'race') {
      const go = b === 'claw' ? btn('sub small', '인형 보기', () => this.ctx.openDex('plush')) : null;
      this.el.append(h('div', 'mpv-rule', h('span', 'mpv-grow', rule), go));
    }

    // 경주장: 다음 경주, 선수, 참가자
    if (b === 'race') this.buildRace();

    // 상금 항아리
    const pot = makeBar();
    const potV = h('span', 'v');
    this.live.add(() => {
      const cur = this.st.booths[b];
      const cap = boothPotCap(b, cur.level);
      pot.set(cur.pot / cap);
      setText(potV, `${fmt(cur.pot)} / ${fmt(cap)}`);
    });
    this.el.append(
      h(
        'div',
        'mpv-pot',
        pic('objects', ['prize_pot'], () => placeholder('항', 'var(--dd-gold)')),
        h('div', 'mpv-grow', h('div', 'mpv-title sm', '상금 항아리', h('span', 'mpv-note', '가득 차면 다음 승자가 통째로!')), pot.el),
        potV,
      ),
    );

    if (!closed) this.el.append(...roles);

    // 응원 도구
    const cheer = bs.cheer;
    const cheerBtn = btn('butter small', [icon('flag'), cheer === null ? '응원 도구 걸기 ▾' : '걸기 ▾'], () => this.openCheerMenu(cheerBtn));
    if (cheer !== null) {
      const left = h('span');
      this.live.add(() => setText(left, `${fmtSec(this.st.booths[b].cheer?.left ?? 0)} 남음`));
      this.el.append(h('div', 'mpv-row', itemIcon(cheer.good, { cls: 'ico' }), h('div', 'mpv-grow', h('div', 'mpv-title sm', GOODS[cheer.good].name), h('div', 'mpv-note', left)), cheerBtn));
    } else {
      this.el.append(h('div', 'mpv-row', h('div', 'mpv-grow mpv-note', '응원 도구를 걸어 두면 손님 반응이 커지고 기분이 올라요'), cheerBtn));
    }

    // 업그레이드
    const cost = this.sim.boothUpgradeCost(b);
    if (cost === null) {
      this.el.append(h('div', 'mpv-row', h('span', 'mpv-max', '최고 레벨이에요')));
    } else {
      const next = boothEffect(b, bs.level + 1);
      const up = btn('small', '업그레이드', () => this.ctx.act(this.sim.upgradeBooth(b)));
      this.live.add(() => up.classList.toggle('dim', !this.sim.canAfford(cost)));
      this.el.append(
        h('div', 'mpv-row', h('div', 'mpv-grow', h('div', 'mpv-eff', h('span', 'mpv-tag next', `Lv.${bs.level + 1}`), h('span', null, next ?? '')), h('div', 'mpv-act', costChips(this.sim, cost, this.live), up))),
      );
    }
  }

  /** 진행자 (자리마다 한 줄: 보통 부스는 하나, 경주장은 출발 신호·해설자·사육사). */
  private buildRoles(): HTMLElement[] {
    const b = this.booth;
    const s = this.st;
    const bs = s.booths[b];
    const def = boothDef(b);
    const out: HTMLElement[] = [];
    const multi = def.roles.length > 1;
    if (multi) {
      const need = def.roles.filter((r) => r.optional !== true).map((r) => r.name);
      out.push(secHead('진행자 자리', `${need.join('·')} 자리를 채우면 열려요`));
    }
    def.roles.forEach((r, role) => {
      const id = bs.staff[role] ?? null;
      const host = id === null ? undefined : s.staff.find((st) => st.id === id);
      const optional = r.optional === true;
      const stat = roleStat(b, role);
      const hostBtn = btn('sub small', host ? '바꾸기 ▾' : '세우기 ▾', () => openRoleMenu(this.ctx, hostBtn, b, role));
      const head = multi
        ? h('div', 'mpv-role', h('span', 'mpv-tag', stat !== null ? `${r.name} · ${STAFF_STAT_NAMES[stat]}` : r.name), h('span', optional ? 'mpv-tag opt' : 'mpv-tag req', optional ? '있으면 좋아요' : '꼭 필요'))
        : null;
      // 자리 이름이 사람이 아닌 것('출발 신호')도 있어 자리가 여럿인 부스는 '… 자리가 비었어요'.
      const missing = multi ? `${r.name} 자리가 비었어요` : `${josa(r.name, '이', '가')} 없어요`;
      const row = h(
        'div',
        'mpv-row',
        host ? h('span', 'mpv-thumb sm', staffPic(host.art, host.name)) : h('span', 'mpv-thumb sm empty', '+'),
        host
          ? h('div', 'mpv-grow', head, h('div', 'mpv-title sm', multi ? null : h('span', 'mpv-note', r.name), host.name, h('span', 'mpv-lv', `Lv.${host.level}`)), statBlock(host.stats, stat))
          : h(
              'div',
              'mpv-grow',
              head,
              h('div', optional ? 'mpv-note strong' : 'mpv-warn', missing),
              h('div', 'mpv-note', optional ? `${roleHelp(b, role)} (없어도 열려요)` : multi ? roleHelp(b, role) : `${josa(r.name, '을', '를')} 세워야 부스가 돌아가요`),
            ),
        hostBtn,
      );
      this.roleRows.set(role, { el: row, btn: hostBtn });
      out.push(row);
    });
    return out;
  }

  /** 경주장: 다음 경주까지 남은 때, 선수 넷(지금 순위·응원하는 손님 수), 관중석 참가자와 고른 선수. */
  private buildRace(): void {
    const b = this.booth;
    const bs = this.st.booths[b];
    const race = bs.race;
    const phase = race?.phase ?? 'idle';
    const seats = raceSeats(bs);
    const result = race?.result ?? null;

    // 상태 줄 (남은 초는 4Hz로)
    const title = h('b');
    const sub = h('small');
    this.live.add(() => {
      const cur = this.st.booths[b];
      const r = cur.race;
      const n = raceSeats(cur).length;
      const cd = Math.max(0, Math.ceil(r?.countdown ?? 0));
      const ph = r?.phase ?? 'idle';
      // 출발 신호·해설자가 빠졌으면 (달리던 경주는 끝까지 달린다) 손님을 받지 않는다.
      if (!this.sim.boothOpen(b) && (ph === 'idle' || ph === 'gathering')) {
        const need = boothDef(b).roles.filter((x, i) => x.optional !== true && (cur.staff[i] ?? null) === null).map((x) => x.name);
        setText(title, '쉬는 중');
        setText(sub, `${need.join('·')} 자리를 채우면 손님이 와요`);
        return;
      }
      // 막 끝난 경주의 1등 (처음 몇 초)
      const last = this.lastWin !== null && performance.now() - this.lastWin.at < 6000 ? `${this.lastWin.text} · ` : '';
      switch (ph) {
        case 'idle':
          setText(title, n > 0 ? '한판 중' : '손님을 기다려요');
          setText(sub, `${last}관중석에 손님이 앉으면 출발을 준비해요 · ${RACE.minRunners}명 이상 모이면 곧 출발`);
          break;
        case 'gathering':
          // 0초가 되어도 관중석으로 걸어오는 손님이 있으면 sim이 조금 더 기다려 준다.
          setText(title, cd > 0 ? `출발까지 ${cd}초` : '곧 출발!');
          setText(sub, last + (cd <= 0 ? `${n}명이 응원해요 · 오는 손님을 기다려요` : n >= RACE.minRunners ? `${n}명이 응원해요 · 곧 출발!` : `${n}명이 응원해요 · ${RACE.minRunners}명이 모이면 곧 출발`));
          break;
        case 'running':
          setText(title, '달리는 중!');
          setText(sub, `${n}명이 응원해요`);
          break;
        case 'done': {
          const res = r?.result ?? null;
          const win = res === null ? undefined : RACE.racers[res.finishOrder[0] ?? 0];
          const flags = [res?.comeback === true ? '꼴찌에서 역전' : '', res?.photoFinish === true ? '사진 판정' : ''].filter((x) => x !== '');
          setText(title, win === undefined ? '결승!' : [`${josa(win.name, '이', '가')} 1등!`, ...flags].join(' · '));
          if (win !== undefined) this.lastWin = { text: `지난 경주: ${win.name} 1등`, at: performance.now() };
          setText(sub, cd > 0 ? `다음 경주 준비 ${cd}초` : '다음 경주를 준비해요');
          break;
        }
      }
    });
    this.el.append(h('div', `mpv-race-st ${phase}`, h('span', 'flag', phase === 'running' ? '달려라' : phase === 'done' ? '결승' : '경주'), h('div', 'mpv-grow', title, sub)));

    // 선수 넷: 지금 순위(달리는 중·끝남), 응원하는 손님 수
    const grid = h('div', 'mpv-racers');
    const cards = RACE.racers.map((rc, i) => {
      const fans = seats.filter((e) => e.racer === i).length;
      const place = h('span', 'place');
      const color = RACER_COLOR[i] ?? 'var(--dd-paper)';
      const card = h('div', 'mpv-racer', place, racerPic(rc.key, rc.name, color), h('span', 'name', rc.name), h('span', 'fans', fans > 0 ? `응원 ${fans}` : '응원 0'));
      card.classList.toggle('nofans', fans === 0);
      card.style.setProperty('--bib', color);
      return { card, place };
    });
    let lastOrder = '';
    this.live.add(() => {
      const r = this.st.booths[b].race;
      const order = racerOrder(r);
      const ranked = r !== null && (r.phase === 'running' || r.phase === 'done') && r.result !== null;
      const key = `${ranked}:${order.join('')}`;
      if (key === lastOrder) return;
      lastOrder = key;
      order.forEach((ri, k) => {
        const c = cards[ri];
        if (c === undefined) return;
        grid.append(c.card);
        setText(c.place, ranked ? `${k + 1}` : '');
        c.place.hidden = !ranked;
        c.card.classList.toggle('first', ranked && k === 0);
      });
    });
    this.el.append(grid);

    // 관중석: 이번 경주 참가자(고른 선수·건 코인, 끝나면 결과), 그리고 다음 경주를 기다리는 손님. 누르면 손님 카드.
    const inRace = new Set(seats.map((e) => e.monster));
    const waiting = bs.seats.filter((id): id is MonsterId => id !== null && !inRace.has(id));
    this.el.append(secHead('관중석', `${seats.length}명 응원 중${waiting.length > 0 ? ` · ${waiting.length}명 다음 경주` : ''}`));
    if (seats.length === 0 && waiting.length === 0) {
      this.el.append(h('div', 'mpv-empty sm', '손님이 앉으면 고른 선수가 여기에 보여요'));
      return;
    }
    const list = h('div', 'mpv-entries');
    const row = (id: MonsterId, ...right: HTMLElement[]): void => {
      const m = this.sim.monster(id);
      if (m === undefined) return;
      const sp = SPECIES[m.species];
      const el = h('button', 'mpv-entry', monsterPic(m.species, m.pose, sp.name), h('span', 'who', h('b', null, m.nickname), h('small', null, sp.name)), ...right);
      el.type = 'button';
      el.setAttribute('aria-label', `${m.nickname} 손님 보기`);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.ctx.showMonster(m.id);
      });
      list.append(el);
    };
    for (const e of seats) {
      const rc = RACE.racers[e.racer];
      const color = RACER_COLOR[e.racer] ?? 'var(--dd-paper)';
      const racerChip = h('span', 'mpv-racer-chip', racerPic(rc?.key ?? '', rc?.name ?? '?', color), rc?.name ?? '?');
      racerChip.style.setProperty('--bib', color);
      const tag = phase === 'done' && result !== null ? raceResultTag(result, e.racer) : null;
      row(e.monster, racerChip, tag !== null ? h('span', `mpv-res ${tag.cls}`.trim(), tag.text) : h('span', 'mpv-chip bet', itemIcon('coin'), fmt(e.bet)));
    }
    for (const id of waiting) {
      // 걸어오던 손님이 앉으면 '다음 경주'로 (손님 걸음은 sig에 없어 4Hz로 고친다).
      const tag = h('span', 'mpv-res wait');
      const set = (): void => setText(tag, this.sim.monster(id)?.phase === 'toSeat' ? '오는 중' : '다음 경주');
      set();
      this.live.add(set);
      row(id, tag);
    }
    this.el.append(list);
  }

  private openCheerMenu(anchor: HTMLElement): void {
    const b = this.booth;
    const goods = this.st.goods;
    const now = this.st.booths[b].cheer;
    // 걸려 있는 도구와 같은 것은 시간이 더해지고, 다른 것은 지금 것이 끝나야 걸 수 있다 (sim이 덮어쓰지 않는다).
    const items: MenuItem[] = CHEERS.filter((g) => (goods[g] ?? 0) > 0).map((g) => ({
      icon: itemIcon(g),
      label: GOODS[g].name,
      sub:
        now === null || now.left <= 0
          ? `${GOODS[g].desc} (${fmtSec(cheerSec(g))})`
          : now.good === g
            ? `남은 시간에 ${fmtSec(cheerSec(g))} 더해져요`
            : `${GOODS[now.good].name} 효과가 끝나면 걸 수 있어요 (${fmtSec(now.left)} 남음)`,
      right: `×${fmt(goods[g] ?? 0)}`,
      onPick: () => this.ctx.act(this.sim.placeCheer(b, g)),
    }));
    const empty = h(
      'div',
      'mpv-menu-empty',
      '가진 응원 도구가 없어요.',
      btn('sky small', '공방에서 만들기', () => {
        this.ctx.menu.close();
        this.ctx.openTab('workshop');
      }),
    );
    this.ctx.menu.open(anchor, '응원 도구 걸기', items, empty);
  }
}
