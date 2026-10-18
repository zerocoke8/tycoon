// 부스 패널: 위쪽은 확대 화면(CloseupView, 캔버스), 아래는 HTML 부스 정보 시트.
// 열려 있는 동안 지도 입력을 막고, 확대 화면 둘레(그늘)를 누르면 닫힌다. 확대 화면 자리는 캔버스가 그대로 누르기를 받는다.

import { BOOTHS, boothDef, DEBT_MATCH, GOODS, isGroupBooth, STAFF_STAT_NAMES, type BoothId, type GoodId } from '../data/defs.ts';
import { boothIdleReason } from '../sim/booths.ts';
import { josa } from '../sim/text.ts';
import { closeupRadius, type Rect } from '../view/contracts.ts';
import { placeRow, roadIssue, roadIssueText } from './panels/build.ts';
import { btn, fmt, fmtSec, h, revealInSheet, setText } from './dom.ts';
import { GroupResults, GroupSection } from './groupBoard.ts';
import { icon } from './icons.ts';
import { boothEffect, boothPotCap, boothRule, roleHelp, roleStat, seatWord } from './labels.ts';
import type { MenuItem } from './menu.ts';
import { BasePanel, type UiCtx } from './panel.ts';
import { itemIcon, pic, placeholder, staffPic } from './pics.ts';
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
    this.info = new BoothInfo(ctx, new GroupResults(ctx.sim));
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

/** 부스 정보 (시트 몸통). */
class BoothInfo extends BasePanel {
  booth: BoothId = 'slot';
  /** 진행자 자리 줄과 그 버튼 (BoothPanel.focusRole). */
  private readonly roleRows = new Map<number, { el: HTMLElement; btn: HTMLElement }>();
  /** 단체 놀이의 지난 판 (부스마다, 패널이 닫혀 있어도 sim 이벤트로 모은다). */
  private readonly results: GroupResults;

  constructor(ctx: UiCtx, results: GroupResults) {
    super(ctx);
    this.results = results;
  }

  roleRow(role: number): { el: HTMLElement; btn: HTMLElement } | undefined {
    return this.roleRows.get(role);
  }

  sig(): string {
    const s = this.st;
    const bs = s.booths[this.booth];
    // 단체 놀이: 단계·참가자(고른 것)·자리가 바뀌면 다시 짓는다 (순위·막대·연·보물은 live로).
    const race = bs.group !== null ? `${bs.group.phase}:${bs.group.mode ?? ''}${bs.group.debtNext === true ? '+' : ''}:${bs.group.participants.map((e) => `${e.monster}.${e.pick}`).join(',')}:${bs.seats.join('/')}` : '-';
    const v = this.sim.village();
    return [this.booth, bs.unlocked, bs.level, bs.staff.join('/'), bs.cheer?.good ?? '-', race, s.staff.map((st) => `${st.id}:${st.level}:${st.post === null ? '-' : `${st.post.booth}.${st.post.role}`}`).join(','), v.stamp.place, v.stamp.road].join('|');
  }

  protected build(): void {
    const b = this.booth;
    const s = this.st;
    const bs = s.booths[b];
    const def = boothDef(b);

    this.roleRows.clear();
    const roles = this.buildRoles();
    // 열렸는데 쉬는 부스: 까닭을 맨 위에 (보관함 → 입구 앞 길 → 진행자). 보관함·길은 자리 줄([지도에 놓기]·[길 잇기])을, 진행자는 진행자 자리를 바로 아래에.
    const why = boothIdleReason(s, b);
    const closed = why === 'staff';
    const placeTop = why === 'stored' || why === 'road';
    if (closed) {
      const missing = def.roles.filter((r, i) => r.optional !== true && (bs.staff[i] ?? null) === null).map((r) => r.name);
      this.el.append(h('div', 'mpv-alert', def.roles.length > 1 ? `${missing.join('·')} 자리가 비어 쉬는 중이에요` : '진행자가 없어 쉬는 중이에요'), ...roles);
    } else if (placeTop) {
      const issue = roadIssue(this.ctx, b);
      this.el.append(h('div', 'mpv-alert', why === 'stored' ? '보관함에 있어요. 지도에 놓으면 손님이 와요' : roadIssueText(issue ?? 'none')));
      const place = placeRow(this.ctx, b, false);
      if (place !== null) this.el.append(place);
    }

    // 단체 놀이: 지금 판(상태 줄·고른 것 판)을 맨 위에 (확대 화면 바로 아래, 짧은 폰에서도 먼저 보이게).
    const group = isGroupBooth(b) ? new GroupSection(this.ctx, this.live, b, this.results) : null;
    if (group !== null) this.el.append(...group.top());

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

    // 부스만의 규칙 (오리 낚시 반 돌려받기, 복주머니 재료 참가비, 단체 놀이 규칙 …)
    // 단체 놀이의 시작 조건은 상태 줄이 말한다 (경주장·오리배는 규칙 전부가 상태 줄과 겹친다: 작은 화면에서 참가자 목록이 밀리지 않게).
    const rule = boothRule(b, false);
    if (rule !== null && b !== 'race' && b !== 'boat') {
      const go = b === 'claw' ? btn('sub small', '인형 보기', () => this.ctx.openDex('plush')) : null;
      this.el.append(h('div', 'mpv-rule', h('span', 'mpv-grow', rule), go));
    }

    // 빚 걸기 판 (넷째 묶음, 줄다리기·밀어내기): 이번 판 또는 예약된 다음 판의 규칙.
    const g = bs.group;
    if (g !== null && (g.mode === 'debt' || g.debtNext === true)) {
      const watch = (DEBT_MATCH.watchOnly as readonly BoothId[]).includes(b) ? '다른 손님은 구경만' : '구경 손님은 평소처럼 한 편에 코인을 걸어요';
      const head = g.mode === 'debt' ? '빚 걸기 판' : '다음 판은 빚 걸기 판';
      this.el.append(h('div', 'mpv-rule debt', h('span', 'mpv-grow', `${head}: 빚진 손님이 코인 대신 자기 빚을 걸어요 · 이기면 빚 반 (${b === 'tug' ? '역전승' : '뒤집기'} 대박이면 빚이 사라져요) · 지면 상대 빚만큼 더 · ${watch}`)));
    }

    // 단체 놀이: 지난 판과 참가자 (고른 것·하는 일·건 코인, 끝나면 결과와 받은 코인).
    if (group !== null) this.el.append(...group.list());

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
    // 배치형 마을: 옮기기·보관하기 (보관함·길이 끊긴 부스는 맨 위에 두었다).
    if (!placeTop) {
      const place = placeRow(this.ctx, b);
      if (place !== null) this.el.append(place);
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
