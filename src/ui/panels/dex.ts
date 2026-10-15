// 도감 탭: 마을 기록, 그리고 [손님 | 인형] 보기.
// 손님: 구역마다 종 칸(못 본 종은 그림자), 고른 종의 방문·본 반응·모은 인형 (고른 종 카드는 그 구역 칸 바로 아래에).
// 인형: 인형 뽑기 부스에서 뽑은 인형 (objects/plush_<종>, 모은 수). 못 모은 인형은 그림자.

import { BOOTHS, SPECIES, SPECIES_IDS, TRAITS, type SpeciesId } from '../../data/defs.ts';
import { DISTRICTS } from '../../data/map.ts';
import { btn, fmt, h, revealInSheet, setText } from '../dom.ts';
import { boothLockText, DISTRICT_ORDER, itemName, speciesDistrict } from '../labels.ts';
import { BasePanel, type DexView } from '../panel.ts';
import { itemIcon, monsterPic, plushPic } from '../pics.ts';
import { secHead, segmented } from '../widgets.ts';

export class DexPanel extends BasePanel {
  view: DexView = 'species';
  private selected: SpeciesId | null = null;
  /** 다음 그리기 뒤 고른 종 카드가 보이게 굴린다 (종을 눌렀을 때). */
  private reveal = false;

  sig(): string {
    const d = this.st.dex;
    return [this.view, this.selected, this.sim.hallLevel(), this.st.booths.claw.unlocked, ...SPECIES_IDS.map((s) => `${d[s]?.visits ?? -1}:${d[s]?.reactions.length ?? 0}:${d[s]?.plush ?? 0}`)].join('|');
  }

  protected build(): void {
    const s = this.st;
    const seen = SPECIES_IDS.filter((sp) => s.dex[sp] !== undefined);
    if (this.selected === null || s.dex[this.selected] === undefined) this.selected = seen[0] ?? null;

    // 마을 기록
    const totals = h('div', 'mpv-totals');
    for (const [label, get] of [
      ['손님', () => this.st.totals.visitors],
      ['한판', () => this.st.totals.rounds],
      ['대박', () => this.st.totals.jackpots],
      ['번 코인', () => this.st.totals.coinsEarned],
    ] as const) {
      const b = h('b');
      this.live.add(() => setText(b, fmt(get())));
      totals.append(h('div', 'mpv-total', b, h('small', null, label)));
    }
    this.el.append(totals);

    // 보기 바꾸기: 손님 / 인형
    const plushKinds = SPECIES_IDS.filter((sp) => (s.dex[sp]?.plush ?? 0) > 0).length;
    this.el.append(
      segmented<DexView>(
        [
          { key: 'species', label: ['손님 ', h('small', null, `${seen.length}/${SPECIES_IDS.length}`)] },
          { key: 'plush', label: ['인형 ', h('small', null, `${plushKinds}/${SPECIES_IDS.length}`)] },
        ],
        this.view,
        (v) => {
          this.view = v;
          this.refresh(true);
        },
      ),
    );

    if (this.view === 'plush') this.buildPlush();
    else this.buildSpecies();
  }

  /** 손님 종: 구역마다 칸, 고른 종 카드는 그 구역 칸 아래. */
  private buildSpecies(): void {
    const s = this.st;
    const hall = this.sim.hallLevel();
    let selCard: HTMLElement | null = null;
    for (const dist of DISTRICT_ORDER) {
      const list = SPECIES_IDS.filter((sp) => speciesDistrict(sp) === dist);
      if (list.length === 0) continue;
      const D = DISTRICTS[dist];
      const met = list.filter((sp) => s.dex[sp] !== undefined).length;
      this.el.append(secHead(`${D.name} 손님`, D.hall > hall ? `마을회관 Lv.${D.hall}부터 · ${met} / ${list.length}` : `${met} / ${list.length}종`));
      const grid = h('div', 'mpv-dex');
      for (const sp of list) {
        const d = SPECIES[sp];
        const rec = s.dex[sp];
        const known = rec !== undefined;
        const b = h(
          'button',
          known ? (sp === this.selected ? 'on' : null) : 'unseen',
          monsterPic(sp, 'base', d.name),
          h('span', 'name', known ? d.name : '???'),
          h('span', 'sub', known ? `방문 ${fmt(rec.visits)}번` : d.hall > hall ? `마을회관 Lv.${d.hall}부터` : '아직 못 만났어요'),
        );
        b.type = 'button';
        b.setAttribute('aria-label', known ? d.name : '아직 못 만난 손님');
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!known) {
            this.ctx.toast(d.hall > hall ? `마을회관 Lv.${d.hall}부터 찾아와요` : '아직 마을에 온 적이 없어요');
            return;
          }
          this.selected = sp;
          this.reveal = true;
          this.refresh(true);
        });
        grid.append(b);
      }
      this.el.append(grid);
      if (this.selected !== null && list.includes(this.selected)) {
        selCard = this.detail(this.selected);
        if (selCard !== null) this.el.append(selCard);
      }
    }
    if (this.selected === null) this.el.append(h('div', 'mpv-empty', '손님이 오면 여기에 모여요'));
    if (this.reveal && selCard !== null) {
      const el = selCard;
      requestAnimationFrame(() => revealInSheet(el));
    }
    this.reveal = false;
  }

  /** 고른 종 카드: 좋아하는 놀이, 성격, 재료, 모은 인형, 본 반응. */
  private detail(sel: SpeciesId): HTMLElement | null {
    const rec = this.st.dex[sel];
    if (rec === undefined) return null;
    const d = SPECIES[sel];
    const plush = rec.plush ?? 0;
    const favs = h('div', 'mpv-labels', ...d.favorite.map((b) => h('span', 'mpv-label sky', BOOTHS[b].name)));
    const traits = h('div', 'mpv-labels', ...d.traits.map((t) => h('span', 'mpv-label', TRAITS[t].name)));
    const reactions = rec.reactions.length > 0 ? h('div', 'mpv-labels', ...rec.reactions.map((r) => h('span', 'mpv-label green', r))) : h('div', 'mpv-note', '아직 본 반응이 없어요');
    return h(
      'div',
      'mpv-card col mpv-dex-sel',
      h('div', 'mpv-title', d.name, h('span', 'mpv-lv', `방문 ${fmt(rec.visits)}번`)),
      h(
        'div',
        'mpv-dex-sel-top',
        h('span', 'mpv-thumb lg', monsterPic(sel, 'base', d.name)),
        h(
          'div',
          'mpv-grow',
          h('div', 'mpv-desc', '좋아하는 놀이'),
          favs,
          h('div', 'mpv-desc', '잘 붙는 성격'),
          traits,
          h('div', 'mpv-desc', '가져오는 재료 · 인형'),
          h('div', 'mpv-labels', h('span', 'mpv-chip', itemIcon(d.material), itemName(d.material)), h('span', plush > 0 ? 'mpv-chip' : 'mpv-chip none', plushPic(sel, d.name), plush > 0 ? `×${fmt(plush)}` : '없음')),
        ),
      ),
      h('div', 'mpv-desc', `본 반응 ${rec.reactions.length}가지`),
      reactions,
    );
  }

  /** 인형: 모은 인형과 수. 인형 뽑기 부스가 닫혀 있으면 여는 길을 알려 준다. */
  private buildPlush(): void {
    const s = this.st;
    const hall = this.sim.hallLevel();
    const kinds = SPECIES_IDS.filter((sp) => (s.dex[sp]?.plush ?? 0) > 0).length;
    const total = SPECIES_IDS.reduce((n, sp) => n + (s.dex[sp]?.plush ?? 0), 0);
    const claw = s.booths.claw;
    if (claw.unlocked) {
      this.el.append(h('div', 'mpv-rule', h('span', 'mpv-grow', '인형 뽑기 부스에서 뽑은 인형이 모여요. 마을에 와 본 손님의 인형이 상품으로 나와요.'), btn('sub small', '부스 보기', () => this.ctx.showBooth('claw'))));
    } else {
      const lock = boothLockText('claw', hall);
      this.el.append(
        h(
          'div',
          'mpv-rule',
          h('span', 'mpv-grow', lock !== null ? `인형 뽑기 부스에서 손님 인형을 뽑아 모아요. ${lock}.` : '인형 뽑기 부스를 열면 손님 인형을 뽑아 모을 수 있어요.'),
          lock === null ? btn('sub small', '열러 가기', () => this.ctx.showBooth('claw')) : null,
        ),
      );
    }
    this.el.append(secHead('모은 인형', `${kinds} / ${SPECIES_IDS.length}종 · 모두 ${fmt(total)}개`));
    const grid = h('div', 'mpv-plush');
    for (const sp of SPECIES_IDS) {
      const d = SPECIES[sp];
      const rec = s.dex[sp];
      const n = rec?.plush ?? 0;
      grid.append(h('div', n > 0 ? 'mpv-plush-cell' : 'mpv-plush-cell none', plushPic(sp, d.name), h('span', 'name', rec !== undefined ? d.name : '???'), n > 0 ? h('span', 'n', `×${fmt(n)}`) : null));
    }
    this.el.append(grid);
  }
}
