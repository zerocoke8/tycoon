// 주민 탭: 진행자 자리(열린 부스의 자리마다 누가 맡았나), 고용한 진행자(능력치, 맡은 자리, 레벨 업), 고용 후보(어울리는 자리).

import { BOOTH_IDS, boothDef, BUILDINGS, STAFF_STAT_NAMES, type BoothId } from '../../data/defs.ts';
import { hirePost } from '../../sim/staff.ts';
import { josa } from '../../sim/text.ts';
import type { Candidate, Staff } from '../../sim/types.ts';
import { btn, fmtSec, h, revealInSheet, setText } from '../dom.ts';
import { bestStat, boothShort, boothTiny, postName, presetPostOf, roleStat, staffWhere } from '../labels.ts';
import { BasePanel } from '../panel.ts';
import { staffPic } from '../pics.ts';
import { openPostMenu, openRoleMenu } from '../staffMenu.ts';
import { costChips, secHead, statBlock } from '../widgets.ts';

interface Post {
  readonly booth: BoothId;
  readonly role: number;
  readonly optional: boolean;
}

export class StaffPanel extends BasePanel {
  /** '고용 후보' 칸 머리 (revealHire가 굴려 보여 준다). */
  private hireSec: HTMLElement | null = null;

  /** 고용 후보 칸을 시트 맨 위로 굴린다 (다음 목표 칩·진행자 고르기의 '새 진행자 고용하기'). */
  revealHire(): void {
    const el = this.hireSec;
    if (el !== null) requestAnimationFrame(() => revealInSheet(el, 8, true));
  }
  sig(): string {
    const s = this.st;
    return [
      s.staff.map((st) => `${st.id}:${st.level}:${st.post === null ? '-' : `${st.post.booth}.${st.post.role}`}:${st.stats.pace}${st.stats.charm}${st.stats.welcome}`).join(','),
      s.candidates.map((c) => `${c.name}:${c.cost}`).join(','),
      BOOTH_IDS.map((b) => `${s.booths[b].unlocked ? 1 : 0}${s.booths[b].staff.join('/')}`).join(','),
      s.buildings.office.level,
      this.sim.hallLevel(),
    ].join('|');
  }

  /** 열린 부스의 진행자 자리 (BOOTH_IDS 순서, 부스 안에서는 roles 순서). */
  private posts(): Post[] {
    const out: Post[] = [];
    for (const b of BOOTH_IDS) {
      if (!this.st.booths[b].unlocked) continue;
      boothDef(b).roles.forEach((r, role) => out.push({ booth: b, role, optional: r.optional === true }));
    }
    return out;
  }

  private holder(p: Post): Staff | undefined {
    const id = this.st.booths[p.booth].staff[p.role] ?? null;
    return id === null ? undefined : this.st.staff.find((x) => x.id === id);
  }

  protected build(): void {
    const s = this.st;
    const posts = this.posts();

    // 진행자 자리: 부스·역할마다 한 칸 (누르면 그 자리에 세울 진행자 고르기)
    const filled = posts.filter((p) => this.holder(p) !== undefined).length;
    this.el.append(secHead('진행자 자리', `${filled} / ${posts.length} · 누르면 바꿔요`));
    if (posts.length === 0) this.el.append(h('div', 'mpv-empty', '열린 놀이부스가 없어요'));
    const grid = h('div', 'mpv-posts');
    for (const p of posts) grid.append(this.postCell(p));
    this.el.append(grid);
    const closed = BOOTH_IDS.filter((b) => !s.booths[b].unlocked).length;
    if (closed > 0) this.el.append(h('div', 'mpv-note', `닫힌 놀이부스 ${closed}곳은 열면 자리가 생겨요 (짓기 탭)`));

    // 고용한 진행자
    this.el.append(secHead('진행자', `${s.staff.length}명`));
    if (s.staff.length === 0) this.el.append(h('div', 'mpv-empty', '아직 고용한 진행자가 없어요'));
    // 쉬는 진행자 먼저 (자리를 줄 사람), 그다음 자리 차례 (부스 순서·역할 순서).
    const rank = (st: Staff): number => (st.post === null ? -1 : BOOTH_IDS.indexOf(st.post.booth) * 10 + st.post.role);
    for (const st of [...s.staff].sort((x, y) => rank(x) - rank(y))) this.el.append(this.staffCard(st));

    // 고용 후보
    const refresh = h('small');
    this.live.add(() => setText(refresh, `새 후보까지 ${fmtSec(this.st.candidateRefresh)}`));
    this.hireSec = h('div', 'mpv-sec', h('span', null, '고용 후보'), refresh);
    this.el.append(this.hireSec);
    this.el.append(h('div', 'mpv-note', '진행: 한판이 빨라요 · 입담: 손님 기분 + · 손님맞이: 손님이 더 와요'));
    const anyEmpty = posts.some((p) => this.holder(p) === undefined);
    if (!anyEmpty && s.candidates.length > 0) this.el.append(h('div', 'mpv-note', '지금은 빈 자리가 없어요 (부스를 열면 바로 일해요)'));
    if (s.candidates.length === 0) this.el.append(h('div', 'mpv-empty', '지금은 후보가 없어요'));
    s.candidates.forEach((c, i) => this.el.append(this.candidateCard(c, i)));
    const office = BUILDINGS.office.levels[s.buildings.office.level - 1];
    if (office) this.el.append(h('div', 'mpv-note', `주민 사무소 Lv.${s.buildings.office.level}: 후보 ${office.candidates}명까지`));
  }

  /** 자리 한 칸: 진행자 그림(없으면 +), 부스·역할, 이름 (비어 있으면 꼭 필요한 자리는 붉게). */
  private postCell(p: Post): HTMLElement {
    const host = this.holder(p);
    const multi = boothDef(p.booth).roles.length > 1;
    const role = boothDef(p.booth).roles[p.role];
    const stat = roleStat(p.booth, p.role);
    const where = multi ? `${boothTiny(p.booth)} ${role?.name ?? ''}` : boothShort(p.booth);
    const cls = host !== undefined ? 'mpv-post' : p.optional ? 'mpv-post empty' : 'mpv-post empty need';
    const cell = h(
      'button',
      cls,
      host !== undefined ? staffPic(host.art, host.name) : h('span', 'mpv-pic plus', '+'),
      h(
        'span',
        'l',
        h('small', null, where),
        h('b', null, host !== undefined ? host.name : p.optional ? '비어 있어요' : '세워 주세요'),
        stat !== null ? h('small', 'stat', host !== undefined ? `${STAFF_STAT_NAMES[stat]} ${host.stats[stat]}` : p.optional ? `${STAFF_STAT_NAMES[stat]} · 있으면 좋아요` : `${STAFF_STAT_NAMES[stat]} · 꼭 필요`) : null,
      ),
    );
    cell.type = 'button';
    cell.setAttribute('aria-label', `${postName(p.booth, p.role)} 진행자 고르기`);
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      openRoleMenu(this.ctx, cell, p.booth, p.role);
    });
    return cell;
  }

  private staffCard(st: Staff): HTMLElement {
    const post = st.post;
    const focus = post === null ? null : roleStat(post.booth, post.role);
    const where = focus === null ? staffWhere(st) : `${staffWhere(st)} · ${STAFF_STAT_NAMES[focus]} 담당`;
    const move = btn('sub small', post === null ? '자리 주기 ▾' : '자리 ▾', () => openPostMenu(this.ctx, move, st));

    const cost = this.sim.staffLevelUpCost(st.id);
    let lvl: HTMLElement;
    if (cost === null) lvl = h('span', 'mpv-max', '최고 레벨');
    else {
      const b = btn('small', '레벨 업', () => this.ctx.act(this.sim.staffLevelUp(st.id)));
      this.live.add(() => b.classList.toggle('dim', !this.sim.canAfford(cost)));
      lvl = h('span', 'mpv-lvup', costChips(this.sim, cost, this.live), b);
    }
    return h(
      'div',
      post === null ? 'mpv-card idle' : 'mpv-card',
      h('span', 'mpv-thumb', staffPic(st.art, st.name)),
      h('div', 'mpv-grow', h('div', 'mpv-title', st.name, h('span', 'mpv-lv', `Lv.${st.level}`)), h('div', post === null ? 'mpv-desc rest' : 'mpv-desc', where), statBlock(st.stats, focus), h('div', 'mpv-act wrap', move, lvl)),
    );
  }

  /** 후보가 어울리는 자리 한 줄과, 고용하면 바로 맡을 자리 (sim hire와 같은 규칙: sim/staff.ts hirePost). */
  private suitText(c: Candidate): { suit: string; now: string | null } {
    const p = presetPostOf(c);
    let suit: string;
    if (p !== null) suit = `${postName(p.booth, p.role)}에 잘 어울려요`;
    else {
      const k = bestStat(c.stats);
      const hall = this.sim.hallLevel();
      const big = BOOTH_IDS.filter((b) => boothDef(b).roles.length > 1 && boothDef(b).unlock.hall <= hall)
        .flatMap((b) => boothDef(b).roles.map((r, i) => ({ b, r, i })))
        .find((x) => x.r.stat === k);
      suit = `${josa(STAFF_STAT_NAMES[k], '이', '가')} 좋아요 · ${big !== undefined ? `${boothTiny(big.b)} ${big.r.name}에 딱` : '어느 부스든 맡을 수 있어요'}`;
    }
    const t = hirePost(this.st, c);
    if (t === null) return { suit, now: null };
    const where = josa(postName(t.post.booth, t.post.role), '을', '를');
    return { suit, now: t.take ? `고용하면 바로 ${where} 맡아요 (지금 선 진행자와 바꿔요)` : `고용하면 바로 ${where} 맡아요` };
  }

  private candidateCard(c: Candidate, i: number): HTMLElement {
    const cost = { coins: c.cost };
    const b = btn('small green', '고용', () => {
      const before = this.st.staff.length;
      if (!this.ctx.act(this.sim.hire(i))) return;
      // 맡을 자리가 없으면 sim은 조용하다: 쉬는 중이라고 알려 준다.
      const hired = this.st.staff[before];
      if (hired !== undefined && hired.post === null) this.ctx.toast(`${josa(hired.name, '을', '를')} 고용했어요. 지금은 쉬다가 부스가 열리면 일해요.`, 'good');
    });
    this.live.add(() => b.classList.toggle('dim', !this.sim.canAfford(cost)));
    const { suit, now } = this.suitText(c);
    const p = presetPostOf(c);
    return h(
      'div',
      'mpv-card',
      h('span', 'mpv-thumb', staffPic(c.art, c.name)),
      h(
        'div',
        'mpv-grow',
        h('div', 'mpv-title', c.name),
        h('div', 'mpv-desc', suit),
        now !== null ? h('div', 'mpv-note good', now) : null,
        statBlock(c.stats, p === null ? null : roleStat(p.booth, p.role)),
        h('div', 'mpv-act', costChips(this.sim, cost, this.live), b),
      ),
    );
  }
}

