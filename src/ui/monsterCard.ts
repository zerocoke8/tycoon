// 손님 카드: 손님을 누르면 아래에 뜬다. 지금 포즈 그림, 이름, 성격, 지갑, 기분, 이번 방문 기록, [응원하기] [간식 주기 ▾].
// 열려 있는 동안 카메라가 손님을 따라가고(world.follow), 손님이 떠나면 닫힌다.

import { BOOTHS, GOODS, isGroupBooth, SPECIES, TRAITS, type GoodId } from '../data/defs.ts';
import { entryOf, livePlay } from '../sim/group/index.ts';
import type { Monster, MonsterId } from '../sim/types.ts';
import { btn, fmt, h, setText } from './dom.ts';
import { outcomeTag, pickInfo, roundWord } from './groupText.ts';
import { icon } from './icons.ts';
import { groupPickName, monsterStatus, moodInfo } from './labels.ts';
import type { MenuItem } from './menu.ts';
import type { UiCtx } from './panel.ts';
import { itemIcon, monsterPic, setMonsterPic } from './pics.ts';
import { closeButton } from './sheet.ts';
import { Live, makeBar } from './widgets.ts';

const SNACKS = (Object.keys(GOODS) as GoodId[]).filter((g) => GOODS[g].kind === 'snack');

/**
 * 단체 놀이 손님의 지금 할 일 한 줄 (아니면 null): '몬스터 경주장에서 한판 하는 중 · 달팽이 응원 · 1등!',
 * 판에 끼지 못하고 자리에서 기다리면 '밀어내기 대결장에서 다음 판 기다리는 중'.
 */
function groupStatus(sim: UiCtx['sim'], m: Monster): string | null {
  const b = m.booth;
  if (b === null || !isGroupBooth(b)) return null;
  const g = sim.state.booths[b].group;
  const e = entryOf(g, m.id);
  if (e === undefined) {
    if (m.phase === 'playing' && g !== null && (g.phase === 'running' || g.phase === 'done')) return `${BOOTHS[b].name}에서 다음 ${roundWord(b)} 기다리는 중`;
    return null;
  }
  const pick = b === 'race' || b === 'boat' ? `${pickInfo(b, e.pick).name} 응원` : groupPickName(b, e.pick, e.role);
  const play = livePlay(g);
  const i = g?.participants.indexOf(e) ?? -1;
  const o = g?.phase === 'done' && play !== null ? play.outcomes[i] : undefined;
  const res = o !== undefined && play !== null ? ` · ${outcomeTag(play, e, o).text}` : '';
  return `${monsterStatus(m)} · ${pick}${res}`;
}

export class MonsterCard {
  readonly el: HTMLDivElement;
  private readonly ctx: UiCtx;
  private readonly inner: HTMLDivElement;
  private readonly live = new Live();
  id: MonsterId | null = null;

  constructor(ctx: UiCtx, parent: HTMLElement) {
    this.ctx = ctx;
    this.inner = h('div', 'mpv-mcard-in');
    this.el = h('div', 'mpv-mcard', closeButton(() => this.close()), this.inner);
    this.el.addEventListener('click', (e) => e.stopPropagation());
    parent.append(this.el);
  }

  get isOpen(): boolean {
    return this.id !== null;
  }

  show(id: MonsterId): void {
    const m = this.ctx.sim.monster(id);
    if (m === undefined) return;
    if (this.id !== id) this.build(m);
    this.id = id;
    this.el.classList.add('open');
    this.ctx.hooks.world.follow(id);
  }

  close(): void {
    if (this.id === null) return;
    this.id = null;
    this.live.reset();
    this.el.classList.remove('open');
    this.ctx.menu.close();
    this.ctx.hooks.world.follow(null);
  }

  /** 처음부터 다시 그린다 (그림 목록을 늦게 알았을 때). */
  redraw(): void {
    const m = this.id === null ? undefined : this.ctx.sim.monster(this.id);
    if (m !== undefined) this.build(m);
  }

  /** 4Hz: 숫자·포즈 갱신. 손님이 없어졌으면 닫는다. */
  refresh(): void {
    if (this.id === null) return;
    if (this.ctx.sim.monster(this.id) === undefined) {
      this.close();
      return;
    }
    this.live.run();
  }

  private build(m: Monster): void {
    const { sim } = this.ctx;
    const id = m.id;
    const sp = SPECIES[m.species];
    const cur = (): Monster | undefined => sim.monster(id);
    this.live.reset();

    const portrait = monsterPic(m.species, m.pose, sp.name, 'mpv-mcard-pic');
    const status = h('div', 'mpv-mcard-status');
    const wallet = h('b');
    const mats = h('b');
    const matsBox = h('span', 'mats', itemIcon(sp.material), mats);
    matsBox.title = '들고 온 특산 재료 (복주머니 참가비)';
    this.live.add(() => {
      const c = cur();
      if (c === undefined) return;
      setMonsterPic(portrait, c.species, c.pose, sp.name);
      // 단체 놀이: 고른 것 ('달팽이 응원', '홍 선수', '빨강 연' …)과 끝난 판의 결과, 판에 못 낀 손님은 기다림.
      setText(status, groupStatus(sim, c) ?? monsterStatus(c));
      setText(wallet, fmt(c.wallet));
      setText(mats, `재료 ×${fmt(c.mats ?? 0)}`);
      matsBox.hidden = (c.mats ?? 0) <= 0;
    });

    const traits = h('div', 'mpv-traits', ...m.traits.map((t) => h('div', 'mpv-trait', h('b', null, TRAITS[t].name), h('span', null, TRAITS[t].desc))));

    const mood = makeBar();
    const moodV = h('span', 'v');
    this.live.add(() => {
      const c = cur();
      if (c === undefined) return;
      const mi = moodInfo(c.mood);
      mood.set(c.mood / 100, mi.color);
      setText(moodV, `${mi.label} ${Math.round(c.mood)}`);
    });

    const record = h('div', 'mpv-record');
    for (const [label, get] of [
      ['한판', (c: Monster) => c.stats.rounds],
      ['이김', (c: Monster) => c.stats.wins],
      ['대박', (c: Monster) => c.stats.jackpots],
      ['아깝다', (c: Monster) => c.stats.nearMisses],
      ['쓴 코인', (c: Monster) => c.stats.spent],
      ['받은 코인', (c: Monster) => c.stats.won],
    ] as const) {
      const b = h('b');
      record.append(h('div', null, b, label));
      this.live.add(() => {
        const c = cur();
        if (c !== undefined) setText(b, fmt(get(c)));
      });
    }

    const cheerLabel = h('span', null, '응원하기');
    const cheer = btn('', [icon('heart'), cheerLabel], () => {
      if (this.ctx.act(sim.cheer(id))) {
        cheer.classList.remove('pop');
        void cheer.offsetWidth;
        cheer.classList.add('pop');
      }
    });
    this.live.add(() => {
      const c = cur();
      const cd = c?.cheerCooldown ?? 0;
      cheer.classList.toggle('cool', cd > 0);
      setText(cheerLabel, cd > 0 ? `응원하기 ${Math.ceil(cd)}` : '응원하기');
    });

    const snack = btn('butter', [icon('cookie'), '간식 주기 ▾'], () => this.openSnacks(snack, id));

    this.inner.replaceChildren(
      h('div', 'mpv-mcard-top', portrait, h('div', 'mpv-grow', h('div', 'mpv-mcard-name', m.nickname, h('small', null, `(${sp.name})`)), status, h('div', 'mpv-mcard-wallet', itemIcon('coin'), h('span', null, '지갑'), wallet, matsBox))),
      traits,
      h('div', 'mpv-mood', h('span', null, '기분'), mood.el, moodV),
      record,
      h('div', 'mpv-mcard-actions', cheer, snack),
    );
  }

  private openSnacks(anchor: HTMLElement, id: MonsterId): void {
    const s = this.ctx.sim.state;
    const items: MenuItem[] = SNACKS.filter((g) => (s.goods[g] ?? 0) > 0).map((g) => ({
      icon: itemIcon(g),
      label: GOODS[g].name,
      sub: GOODS[g].desc,
      right: `×${fmt(s.goods[g] ?? 0)}`,
      onPick: () => this.ctx.act(this.ctx.sim.giveSnack(id, g)),
    }));
    const empty = h(
      'div',
      'mpv-menu-empty',
      '가진 간식이 없어요.',
      btn('sky small', '공방에서 만들기', () => {
        this.ctx.menu.close();
        this.ctx.openTab('workshop');
      }),
    );
    this.ctx.menu.open(anchor, '간식 주기', items, empty);
  }
}
