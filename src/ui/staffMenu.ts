// 진행자 고르기 판 (부스 패널·주민 탭이 같이 쓴다): 자리 하나에 세울 진행자, 또는 진행자 하나가 옮겨 갈 자리.
// 자리에 다른 진행자가 있으면 sim이 서로 자리를 바꾼다 (api.ts assign).

import { BOOTH_IDS, boothDef, STAFF_STAT_NAMES, type BoothId } from '../data/defs.ts';
import { suits } from '../sim/staff.ts';
import { josa } from '../sim/text.ts';
import type { Staff } from '../sim/types.ts';
import { btn, fmt, h } from './dom.ts';
import { boothShort, postName, roleName, roleStat, staffWhere } from './labels.ts';
import type { MenuItem } from './menu.ts';
import type { UiCtx } from './panel.ts';
import { mapPic, staffPic } from './pics.ts';

/** 그림 있는 진행자가 이 자리에 어울리나 (sim의 자동 배치와 같은 규칙: sim/staff.ts suits). */
export function suitsPost(st: Pick<Staff, 'name' | 'art'>, b: BoothId, role: number): boolean {
  return suits(st, b, role);
}

function holderOf(ctx: UiCtx, b: BoothId, role: number): Staff | undefined {
  const id = ctx.sim.state.booths[b].staff[role] ?? null;
  return id === null ? undefined : ctx.sim.state.staff.find((s) => s.id === id);
}

/** 진행자 st가 지금 자리를 떠나면 그 부스가 멈추나 (꼭 있어야 하는 자리). */
function leavingStops(st: Staff): boolean {
  const p = st.post;
  return p !== null && boothDef(p.booth).roles[p.role]?.optional !== true;
}

/** 자리 (b, role)에 세울 진행자 고르기. 어울리는 사람 → 쉬는 사람 → 그 자리 능력치 순. */
export function openRoleMenu(ctx: UiCtx, anchor: HTMLElement, b: BoothId, role: number): void {
  const s = ctx.sim.state;
  const host = holderOf(ctx, b, role);
  const stat = roleStat(b, role);
  const optional = boothDef(b).roles[role]?.optional === true;
  const score = (st: Staff): number => (st.id === host?.id ? 1000 : 0) + (suitsPost(st, b, role) ? 100 : 0) + (st.post === null ? 20 : 0) + (stat === null ? st.level : st.stats[stat]);
  const staff = [...s.staff].sort((a, c) => score(c) - score(a));
  const items: MenuItem[] = staff.map((st) => {
    const notes = [staffWhere(st)];
    if (suitsPost(st, b, role)) notes.push('잘 어울려요');
    if (host !== undefined && st.id !== host.id) notes.push(st.post !== null ? '서로 자리를 바꿔요' : `${josa(host.name, '은', '는')} 쉬어요`);
    else if (host === undefined && st.post !== null && leavingStops(st)) notes.push(`옮기면 ${josa(boothShort(st.post.booth), '이', '가')} 멈춰요`);
    return {
      icon: staffPic(st.art, st.name),
      label: `${st.name} Lv.${st.level}`,
      sub: notes.filter((x) => x !== '').join(' · '),
      right: stat === null ? undefined : `${STAFF_STAT_NAMES[stat]} ${st.stats[stat]}`,
      active: st.id === host?.id,
      onPick: () => {
        if (st.id !== host?.id) ctx.act(ctx.sim.assign(st.id, b, role));
      },
    };
  });
  if (host !== undefined) items.push({ label: '쉬게 하기', sub: `${josa(host.name, '이', '가')} 쉬어요${optional ? '' : ' (부스가 멈춰요)'}`, onPick: () => ctx.act(ctx.sim.assign(host.id, null)) });
  // 다른 부스를 멈추지 않고 채울 길: 새 진행자 고용 (주민 탭 고용 후보 칸으로).
  if (s.staff.length > 0) {
    const cheapest = s.candidates.reduce<number | null>((m, c) => (m === null || c.cost < m ? c.cost : m), null);
    items.push({ label: '새 진행자 고용하기', sub: cheapest === null ? '지금은 후보가 없어요 · 주민 탭에서 기다려요' : `후보 ${s.candidates.length}명 · ${fmt(cheapest)} 코인부터`, onPick: () => ctx.openHire() });
  }
  const empty = h(
    'div',
    'mpv-menu-empty',
    '고용한 진행자가 없어요.',
    btn('sky small', '고용하러 가기', () => {
      ctx.menu.close();
      ctx.openHire();
    }),
  );
  const title = boothDef(b).roles.length > 1 ? `${roleName(b, role)} 고르기${stat === null ? '' : ` (${STAFF_STAT_NAMES[stat]})`}` : '진행자 고르기';
  ctx.menu.open(anchor, title, s.staff.length === 0 ? [] : items, empty);
}

/** 진행자 st가 옮겨 갈 자리 고르기 (열린 부스의 자리마다, 그리고 쉬기). */
export function openPostMenu(ctx: UiCtx, anchor: HTMLElement, st: Staff): void {
  const s = ctx.sim.state;
  const items: MenuItem[] = [];
  for (const b of BOOTH_IDS) {
    if (!s.booths[b].unlocked) continue;
    boothDef(b).roles.forEach((r, role) => {
      const mine = st.post !== null && st.post.booth === b && st.post.role === role;
      const holder = holderOf(ctx, b, role);
      const stat = roleStat(b, role);
      const notes: string[] = [];
      if (mine) notes.push('지금 맡은 자리');
      else if (holder !== undefined) notes.push(`지금: ${holder.name}`, st.post !== null ? '서로 바꿔요' : `${josa(holder.name, '은', '는')} 쉬어요`);
      else notes.push(r.optional === true ? '비어 있어요 (있으면 좋아요)' : '비어 있어요');
      if (suitsPost(st, b, role)) notes.push('잘 어울려요');
      items.push({
        icon: mapPic(boothDef(b).building, boothDef(b).name),
        label: postName(b, role),
        sub: notes.join(' · '),
        right: stat === null ? undefined : `${STAFF_STAT_NAMES[stat]} ${st.stats[stat]}`,
        active: mine,
        onPick: () => {
          if (!mine) ctx.act(ctx.sim.assign(st.id, b, role));
        },
      });
    });
  }
  if (st.post !== null) items.push({ label: '쉬게 하기', sub: leavingStops(st) ? `${josa(boothShort(st.post.booth), '이', '가')} 멈춰요` : '쉬는 동안 다른 자리에 세울 수 있어요', onPick: () => ctx.act(ctx.sim.assign(st.id, null)) });
  ctx.menu.open(anchor, `${st.name}의 자리`, items, h('div', 'mpv-menu-empty', '열린 놀이부스가 없어요.'));
}
