// 공방 탭: 만드는 중인 가공(진행 막대), 레시피(재료 → 가공품), 가진 가공품.

import { BUILDINGS, GOODS, RECIPES, type GoodId, type MaterialId } from '../../data/defs.ts';
import { btn, fmt, fmtSec, h, setText } from '../dom.ts';
import { BasePanel } from '../panel.ts';
import { itemIcon } from '../pics.ts';
import { chipLabel, makeBar, secHead } from '../widgets.ts';

export const GOOD_IDS = Object.keys(GOODS) as GoodId[];

export class WorkshopPanel extends BasePanel {
  sig(): string {
    const s = this.st;
    return [s.buildings.workshop.level, this.sim.hallLevel(), s.crafting.map((j) => `${j.out}:${j.total}`).join(','), this.sim.availableRecipes().map((r) => r.index).join(',')].join('|');
  }

  protected build(): void {
    const s = this.st;
    const wl = s.buildings.workshop.level;
    const W = BUILDINGS.workshop.levels[wl - 1] ?? BUILDINGS.workshop.levels[0];
    const slots = W.slots;
    const speed = W.speed;

    this.el.append(h('div', 'mpv-note', `공방 Lv.${wl} · 동시에 ${slots}개 · 속도 ×${speed}`));

    // 만드는 중
    this.el.append(secHead('만드는 중', `${s.crafting.length} / ${slots}`));
    s.crafting.forEach((job, i) => {
      const bar = makeBar();
      const t = h('span', 't');
      this.live.add(() => {
        const j = this.st.crafting[i];
        if (j === undefined) return;
        bar.set(j.total > 0 ? 1 - j.left / j.total : 1, 'var(--dd-sky)');
        setText(t, fmtSec(j.left));
      });
      this.el.append(h('div', 'mpv-job', itemIcon(job.out), h('div', 'mpv-grow', h('div', 'mpv-title sm', GOODS[job.out].name), bar.el), t));
    });
    for (let i = s.crafting.length; i < slots; i++) this.el.append(h('div', 'mpv-job empty', '빈 자리'));

    // 레시피
    this.el.append(secHead('레시피'));
    const avail = new Map(this.sim.availableRecipes().map((r) => [r.index, r] as const));
    const hall = this.sim.hallLevel();
    RECIPES.forEach((r, i) => {
      const g = GOODS[r.out];
      const open = avail.has(i);
      const ins = h('div', 'mpv-recipe');
      if (r.coins > 0) ins.append(this.need('coin', r.coins, () => this.st.coins));
      for (const [k, n] of Object.entries(r.mats) as [MaterialId, number | undefined][]) {
        if (n) ins.append(this.need(k, n, () => this.st.materials[k] ?? 0));
      }
      // 화살표와 만든 것은 한 덩어리 (줄이 바뀌어도 화살표만 혼자 남지 않게).
      ins.append(h('span', 'mpv-out', h('span', 'mpv-arrow', '→'), itemIcon(r.out, { cls: 'ico' })));
      const card = h('div', open ? 'mpv-card col' : 'mpv-card col dim', h('div', 'mpv-title sm', itemIcon(r.out, { cls: 'ico' }), g.name, h('span', 'mpv-lv', fmtSec(r.sec / speed))), h('div', 'mpv-desc', g.desc));
      if (open) {
        const b = btn('small', '만들기', () => this.ctx.act(this.sim.craft(i)));
        this.live.add(() => b.classList.toggle('dim', !(this.sim.availableRecipes().find((x) => x.index === i)?.affordable ?? false)));
        card.append(h('div', 'mpv-act', ins, b));
      } else {
        card.append(h('div', 'mpv-act', ins), h('div', 'mpv-max', r.hall > hall ? `마을회관 Lv.${r.hall}에서 열려요` : '아직 만들 수 없어요'));
      }
      this.el.append(card);
    });

    // 가진 가공품
    this.el.append(secHead('가진 가공품'));
    const grid = h('div', 'mpv-grid');
    for (const k of GOOD_IDS) {
      const num = h('span', 'num');
      const tile = h('div', 'mpv-tile', itemIcon(k), h('span', 'name', GOODS[k].name), num);
      this.live.add(() => {
        const n = this.st.goods[k] ?? 0;
        setText(num, fmt(n));
        tile.classList.toggle('zero', n <= 0);
      });
      grid.append(tile);
    }
    this.el.append(grid);
  }

  /** 재료 칩 (가진 수 / 필요한 수, 모자라면 붉게). */
  private need(key: string, n: number, have: () => number): HTMLElement {
    const chip = h('span', 'mpv-chip', ...chipLabel(key));
    const txt = h('span');
    chip.append(txt);
    this.live.add(() => {
      const v = have();
      setText(txt, key === 'coin' ? fmt(n) : `${fmt(Math.min(v, 999))}/${n}`);
      chip.classList.toggle('short', v < n);
    });
    return chip;
  }
}
