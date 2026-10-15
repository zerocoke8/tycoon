// 짓기 탭: 건물 업그레이드와 놀이부스 열기·업그레이드 (부스는 구역마다 묶어서). 그리고 건물 하나만 보는 시트, 닫힌 부스 시트.

import { BOOTH_IDS, BOOTHS, boothDef, BUILDINGS, type BoothId, type BuildingId } from '../../data/defs.ts';
import { BUILDING_SPOTS, DISTRICTS } from '../../data/map.ts';
import type { Cost, Result } from '../../sim/api.ts';
import { josa } from '../../sim/text.ts';
import { btn, h } from '../dom.ts';
import { icon } from '../icons.ts';
import { boothEffect, boothLockText, boothRolesText, boothRule, boothsIn, BUILDING_IDS, buildingEffect, buildingMaxLevel, DISTRICT_ORDER, hallUnlocks } from '../labels.ts';
import { BasePanel, type TabId, type UiCtx } from '../panel.ts';
import { mapPic } from '../pics.ts';
import { costChips, secHead, type Live } from '../widgets.ts';

/** 효과 줄: [지금] … / [다음] … */
function effLine(tag: string, text: string, next = false): HTMLElement {
  return h('div', 'mpv-eff', h('span', next ? 'mpv-tag next' : 'mpv-tag', tag), h('span', null, text));
}

/** 비용 칩 + 버튼 (살 수 없으면 흐리게, 그래도 누르면 이유가 토스트로). locked = 비용과 상관없이 아직 못 하는 까닭이 있다. */
function costAction(ctx: UiCtx, live: Live, cost: Cost | null, label: string, run: () => Result, maxText = '최고 레벨이에요', locked = false): HTMLElement {
  if (cost === null) return h('div', 'mpv-act', h('span', 'mpv-max', maxText));
  const b = btn('small', label, () => ctx.act(run()));
  live.add(() => b.classList.toggle('dim', locked || !ctx.sim.canAfford(cost)));
  return h('div', 'mpv-act', costChips(ctx.sim, cost, live), b);
}

/** 열린 부스가 쉬는 까닭: '진행자가 없어 …' / 경주장은 비어 있는 꼭 필요한 자리 ('출발 신호·해설자 자리가 비어 …'). */
function idleText(ctx: UiCtx, b: BoothId): string {
  const bs = ctx.sim.state.booths[b];
  const roles = boothDef(b).roles;
  const miss = roles.filter((r, i) => r.optional !== true && (bs.staff[i] ?? null) === null).map((r) => r.name);
  return roles.length > 1 && miss.length > 0 ? `${miss.join('·')} 자리가 비어 쉬는 중이에요` : '진행자가 없어 쉬는 중이에요';
}

export class BuildPanel extends BasePanel {
  sig(): string {
    const s = this.st;
    return [
      this.sim.hallLevel(),
      ...BUILDING_IDS.map((id) => s.buildings[id].level),
      ...BOOTH_IDS.map((b) => `${s.booths[b].unlocked ? 1 : 0}${s.booths[b].level}${s.booths[b].staff.map((x) => (x === null ? 0 : 1)).join('')}`),
    ].join(',');
  }

  protected build(): void {
    this.el.append(secHead('건물', '누르면 지도에서 보여요'));
    for (const id of BUILDING_IDS) this.el.append(this.buildingCard(id));

    // 놀이부스: 구역마다 (열리는 차례: 중앙 → 연못 동네 → 북쪽 언덕 → 숲 동네)
    const hall = this.sim.hallLevel();
    for (const d of DISTRICT_ORDER) {
      const list = boothsIn(d);
      if (list.length === 0) continue;
      const D = DISTRICTS[d];
      const opened = list.filter((b) => this.st.booths[b].unlocked).length;
      this.el.append(secHead(`놀이부스 · ${D.name}`, D.hall > hall ? `마을회관 Lv.${D.hall}에서 열려요` : `${opened} / ${list.length} 열림`));
      for (const b of list) this.el.append(this.boothCard(b));
    }
  }

  private buildingCard(id: BuildingId): HTMLElement {
    const d = BUILDINGS[id];
    const lv = this.st.buildings[id].level;
    const max = buildingMaxLevel(id);
    const thumb = h('button', 'mpv-thumb', mapPic(id, d.name));
    thumb.type = 'button';
    thumb.setAttribute('aria-label', `${d.name} 지도에서 보기`);
    thumb.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ctx.closeAll();
      this.ctx.hooks.world.focusOn(BUILDING_SPOTS[id]);
    });
    const now = buildingEffect(id, lv);
    const next = lv < max ? buildingEffect(id, lv + 1) : null;
    const extra = id === 'hall' && lv < max ? hallUnlocks(lv + 1) : [];
    return h(
      'div',
      'mpv-card',
      thumb,
      h(
        'div',
        'mpv-grow',
        h('div', 'mpv-title', d.name, h('span', 'mpv-lv', `Lv.${lv}/${max}`)),
        h('div', 'mpv-desc', d.desc),
        now ? effLine('지금', now) : null,
        next ? effLine('다음', next, true) : null,
        ...extra.map((t) => effLine('열림', t, true)),
        costAction(this.ctx, this.live, this.sim.buildingUpgradeCost(id), '업그레이드', () => this.sim.upgradeBuilding(id)),
      ),
    );
  }

  private boothCard(b: BoothId): HTMLElement {
    const d = BOOTHS[b];
    const bs = this.st.booths[b];
    const max = d.fee.length;
    const thumb = h('button', 'mpv-thumb', mapPic(d.building, d.name));
    thumb.type = 'button';
    thumb.setAttribute('aria-label', `${d.name} 보기`);
    thumb.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ctx.showBooth(b);
    });
    const body = h('div', 'mpv-grow', h('div', 'mpv-title', d.name, bs.unlocked ? h('span', 'mpv-lv', `Lv.${bs.level}/${max}`) : h('span', 'mpv-lv', '닫힘')), h('div', 'mpv-desc', d.desc));
    const roles = boothRolesText(b);
    const rule = boothRule(b);
    let lock: string | null = null;
    if (!bs.unlocked) {
      lock = boothLockText(b, this.sim.hallLevel());
      if (lock !== null) body.append(h('div', 'mpv-lock', lock));
      const first = boothEffect(b, 1);
      if (first) body.append(effLine('열면', first, true));
      if (roles !== null) body.append(effLine('진행자', roles));
      else if (rule !== null) body.append(effLine('규칙', rule));
      body.append(costAction(this.ctx, this.live, this.sim.boothUnlockCost(b), '열기', () => this.sim.unlockBooth(b), '열 수 없어요', lock !== null));
    } else {
      const now = boothEffect(b, bs.level);
      const next = bs.level < max ? boothEffect(b, bs.level + 1) : null;
      if (now) body.append(effLine('지금', now));
      if (next) body.append(effLine('다음', next, true));
      if (!this.sim.boothOpen(b)) body.append(h('div', 'mpv-warn', idleText(this.ctx, b)));
      body.append(costAction(this.ctx, this.live, this.sim.boothUpgradeCost(b), '업그레이드', () => this.sim.upgradeBooth(b)));
    }
    return h('div', bs.unlocked ? 'mpv-card' : lock !== null ? 'mpv-card dim locked' : 'mpv-card dim', thumb, body);
  }
}

/** 건물 하나 (지도에서 건물을 눌렀을 때). */
export class BuildingPanel extends BasePanel {
  id: BuildingId = 'hall';

  override head(): readonly [string, string] {
    return [BUILDINGS[this.id].name, `Lv.${this.st.buildings[this.id].level}`];
  }

  sig(): string {
    return `${this.id}|${this.st.buildings[this.id].level}`;
  }

  protected build(): void {
    const id = this.id;
    const d = BUILDINGS[id];
    const lv = this.st.buildings[id].level;
    const max = buildingMaxLevel(id);
    const now = buildingEffect(id, lv);
    this.el.append(h('div', 'mpv-card', h('span', 'mpv-thumb lg', mapPic(id, d.name)), h('div', 'mpv-grow', h('div', 'mpv-desc', d.desc), now ? effLine('지금', now) : null, h('div', 'mpv-note', `레벨 ${lv} / ${max}`))));

    if (lv < max) {
      const next = buildingEffect(id, lv + 1);
      const extra = id === 'hall' ? hallUnlocks(lv + 1) : [];
      this.el.append(
        secHead(`다음 레벨 (Lv.${lv + 1})`),
        h(
          'div',
          'mpv-card col',
          next ? effLine('다음', next, true) : null,
          ...extra.map((t) => effLine('열림', t, true)),
          costAction(this.ctx, this.live, this.sim.buildingUpgradeCost(id), '업그레이드', () => this.sim.upgradeBuilding(id)),
        ),
      );
    } else {
      this.el.append(h('div', 'mpv-empty', '최고 레벨이에요'));
    }

    const go: [string, TabId | 'bag'] | null = id === 'workshop' ? ['공방 열기', 'workshop'] : id === 'office' ? ['주민 보기', 'staff'] : id === 'warehouse' ? ['가방 보기', 'bag'] : id === 'hall' ? ['짓기 보기', 'build'] : null;
    const row = h('div', 'mpv-act');
    if (go !== null) {
      const [label, tab] = go;
      row.append(btn('sky wide', label, () => (tab === 'bag' ? this.ctx.openBag() : this.ctx.openTab(tab))));
    }
    row.append(
      btn('sub wide', [icon('pin'), '지도에서 보기'], () => {
        this.ctx.closeAll();
        this.ctx.hooks.world.focusOn(BUILDING_SPOTS[id]);
      }),
    );
    this.el.append(row);
  }
}

/** 아직 닫힌 놀이부스 (열면 확대 화면으로 바뀐다). */
export class LockedBoothPanel extends BasePanel {
  booth: BoothId = 'cups';

  override head(): readonly [string, string] {
    return [BOOTHS[this.booth].name, '닫힘'];
  }

  sig(): string {
    return `${this.booth}|${this.st.booths[this.booth].unlocked}|${this.sim.hallLevel()}`;
  }

  protected build(): void {
    const b = this.booth;
    const d = BOOTHS[b];
    const first = boothEffect(b, 1);
    const lock = boothLockText(b, this.sim.hallLevel());
    const roles = boothRolesText(b);
    const rule = boothRule(b);
    this.el.append(
      h(
        'div',
        'mpv-card',
        h('span', 'mpv-thumb lg', mapPic(d.building, d.name)),
        h(
          'div',
          'mpv-grow',
          h('div', 'mpv-title sm', d.desc),
          lock !== null ? h('div', 'mpv-lock', lock) : h('div', 'mpv-desc', roles !== null ? '아직 닫혀 있어요. 열고 진행자 자리를 채우면 손님이 찾아와요.' : '아직 닫혀 있어요. 열고 진행자를 세우면 손님이 찾아와요.'),
          first ? effLine('열면', first, true) : null,
          roles !== null ? effLine('진행자', roles) : null,
          rule !== null ? effLine('규칙', rule) : null,
        ),
      ),
      secHead('열기'),
      h(
        'div',
        'mpv-card col',
        costAction(
          this.ctx,
          this.live,
          this.sim.boothUnlockCost(b),
          '열기',
          () => {
            const r = this.sim.unlockBooth(b);
            if (r.ok) queueMicrotask(() => this.ctx.showBooth(b));
            return r;
          },
          '열 수 없어요',
          lock !== null,
        ),
      ),
    );
  }
}
