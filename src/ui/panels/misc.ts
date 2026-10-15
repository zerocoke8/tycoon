// 가방(재료·귀한 물건·가공품)과 설정(저장, 처음부터, 디버그) 시트.

import { GOODS, MATERIALS, PRECIOUS, SIM, SPECIES, type GoodId, type PreciousId } from '../../data/defs.ts';
import { DISTRICTS } from '../../data/map.ts';
import { btn, fmt, h, setText } from '../dom.ts';
import { DISTRICT_ORDER, MAT_IDS, MATERIAL_SPECIES, speciesDistrict } from '../labels.ts';
import { BasePanel } from '../panel.ts';
import { itemIcon } from '../pics.ts';
import { secHead } from '../widgets.ts';

const PRECIOUS_IDS = Object.keys(PRECIOUS) as PreciousId[];
const GOOD_IDS = Object.keys(GOODS) as GoodId[];

export class BagPanel extends BasePanel {
  sig(): string {
    return `bag|${this.sim.hallLevel()}|${Object.keys(this.st.dex).length}`;
  }

  protected build(): void {
    const capNote = h('small');
    this.live.add(() => setText(capNote, `종류마다 ${fmt(this.sim.materialCap())}개까지 (창고)`));
    this.el.append(h('div', 'mpv-sec', h('span', null, '재료'), capNote));
    this.el.append(h('div', 'mpv-note src', '손님이 기분 좋게 떠날수록 자주 남겨요. 종마다 남기는 재료가 달라요. 복주머니 부스에서도 들어와요.'));
    // 재료를 가져오는 손님의 구역마다 (그 구역이 열려야 그 손님이 온다)
    const hall = this.sim.hallLevel();
    for (const d of DISTRICT_ORDER) {
      const mats = MAT_IDS.filter((m) => speciesDistrict(MATERIAL_SPECIES[m]) === d);
      if (mats.length === 0) continue;
      const D = DISTRICTS[d];
      const later = D.hall > hall;
      this.el.append(h('div', 'mpv-sub', h('span', null, `${D.name} 손님`), h('small', null, later ? `마을회관 Lv.${D.hall}부터 와요` : `${mats.length}종`)));
      const g = this.grid(mats, (k) => this.st.materials[k] ?? 0, (k) => MATERIALS[k].name, true, (k) => {
        const sp = MATERIAL_SPECIES[k];
        return this.st.dex[sp] !== undefined ? SPECIES[sp].name : '???';
      });
      g.classList.add('compact');
      if (later) g.classList.add('later');
      this.el.append(g);
    }
    this.el.append(secHead('귀한 물건', '놀이부스 열기·큰 업그레이드에'));
    this.el.append(h('div', 'mpv-note src', '대박 난 손님을 기분 좋게(80 이상) 보내면 가끔 남겨요. 응원과 간식으로 기분을 올려 주세요.'));
    this.el.append(this.grid(PRECIOUS_IDS, (k) => this.st.precious[k] ?? 0, (k) => PRECIOUS[k].name, false));
    this.el.append(secHead('가공품', '공방에서 만들어요'));
    this.el.append(this.grid(GOOD_IDS, (k) => this.st.goods[k] ?? 0, (k) => GOODS[k].name, false));
  }

  /** 아이템 칸. src = 이름 아래 작은 글 (재료를 가져오는 손님). withCap이면 창고가 가득 찬 칸을 표시한다. */
  private grid<K extends string>(keys: readonly K[], count: (k: K) => number, name: (k: K) => string, withCap: boolean, src?: (k: K) => string): HTMLElement {
    const g = h('div', 'mpv-grid');
    for (const k of keys) {
      const num = h('span', 'num');
      const tile = h('div', 'mpv-tile', itemIcon(k), h('span', 'name', name(k)), src !== undefined ? h('span', 'src', src(k)) : null, num);
      this.live.add(() => {
        const n = count(k);
        const text = fmt(n);
        if (withCap) {
          const full = n >= this.sim.materialCap();
          if (num.dataset.v !== `${text}/${full}`) {
            num.dataset.v = `${text}/${full}`;
            num.replaceChildren(text, full ? h('small', null, ' 가득') : '');
          }
          tile.classList.toggle('full', full);
        } else setText(num, text);
        tile.classList.toggle('zero', n <= 0);
      });
      g.append(tile);
    }
    return g;
  }
}

export class SettingsPanel extends BasePanel {
  sig(): string {
    return `settings|${this.ctx.hooks.world.debugVisible()}`;
  }

  protected build(): void {
    const debug = this.ctx.hooks.world.debugVisible();
    this.el.append(
      h(
        'div',
        'mpv-rows',
        btn('green wide', '저장하기', () => {
          this.sim.save();
          this.ctx.toast('저장했어요', 'good');
        }),
        h('div', 'mpv-note', `마을은 ${SIM.autosaveSec}초마다, 그리고 화면을 떠날 때 저절로 저장돼요.`),
        // 개발용 (배포판에는 없다). 지도의 D 키·?debug=1과 같은 상태를 보여 준다.
        import.meta.env.DEV
          ? btn('sub wide', debug ? '디버그 보기: 켬' : '디버그 보기: 끔', () => {
              this.ctx.hooks.world.setDebug(!debug);
              this.refresh(true);
            })
          : null,
        btn('danger wide', '처음부터', () => {
          this.ctx.menu.confirm('처음부터 다시 할까요?\n마을과 코인이 모두 사라져요.', '처음부터', () => {
            this.sim.reset();
            location.reload();
          });
        }),
      ),
    );
  }
}
