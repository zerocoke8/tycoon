// 부스 패널의 단체 놀이 칸 (경주장·씨름장·오리배·연날리기·줄다리기·보물찾기 모두 같은 틀):
// 상태 줄(단계·남은 초·지금 판 모습, [지도] 버튼) → 고른 것 판(놀이마다: 선수 넷 순위, 홍청 대결과 힘 막대, 두 편과 밧줄, 연 넷, 판 자리 여섯)
// → 지난 판 (모이는 중에) → 참가자 목록 (고른 것·하는 일·건 코인, 끝나면 결과와 받은 코인).
// 구조는 BoothInfo.sig가 바뀔 때(단계·참가자) 다시 짓고, 그 사이 움직임(순위·막대·연·보물)은 live(4Hz)로 고친다.
// 지난 판은 GroupResults가 sim 이벤트(groupFinished·roundFinished·groupCancelled)를 들어 부스마다 기억한다 (패널이 닫혀 있어도).

import { boothDef, isGroupBooth, SIDES, SPECIES, TUG, type GroupBoothId, type SpeciesId } from '../data/defs.ts';
import type { SimApi } from '../sim/api.ts';
import { livePlay } from '../sim/group/index.ts';
import { josa } from '../sim/text.ts';
import type { GroupEntry, GroupPlay, GroupRole, GroupState, Monster, MonsterId, Pose } from '../sim/types.ts';
import { btn, fmt, h, setText } from './dom.ts';
import {
  chestPlace,
  decidedAt,
  DIG_FIND_INFO,
  digSpotAt,
  duelValue,
  groupPicks,
  groupWatchBox,
  groupWatchZoom,
  kiteAt,
  outcomeTag,
  phaseText,
  pickInfo,
  pickShort,
  playHeadline,
  raceOrderAt,
  roleWord,
  roundWord,
  sideCounts,
  type PickInfo,
} from './groupText.ts';
import { icon } from './icons.ts';
import { seatWord } from './labels.ts';
import type { UiCtx } from './panel.ts';
import { itemIcon, monsterPic, pic, placeholder, setMonsterPic, setPic } from './pics.ts';
import type { Live } from './widgets.ts';

// ── 지난 판 ──

/** 지난 판 손님 하나 (손님이 떠나도 보이게 이름·종을 적어 둔다). */
export interface ResultRow {
  readonly monster: MonsterId;
  readonly nickname: string;
  readonly species: SpeciesId;
  readonly pick: number;
  readonly role: GroupRole;
  readonly text: string;
  readonly cls: string;
  /** 받은 코인 (roundFinished가 알려 준다, 모르면 null). */
  payout: number | null;
}

export interface PlayResult {
  /** sim 시각 (state.time). */
  readonly at: number;
  readonly play: GroupPlay;
  readonly rows: ResultRow[];
}

/** 부스마다 지난 판과 접힌 판 (sim 이벤트를 듣는다). */
export class GroupResults {
  private readonly plays = new Map<GroupBoothId, PlayResult>();
  private readonly cancels = new Map<GroupBoothId, { at: number; reason: 'closed' | 'timeout' }>();

  constructor(sim: SimApi) {
    const bus = sim.bus;
    bus.on('groupFinished', (e) => {
      const play = e.group.play;
      if (play === null) return;
      const rows: ResultRow[] = [];
      e.group.participants.forEach((p, i) => {
        const m = sim.monster(p.monster);
        const o = play.outcomes[i];
        if (m === undefined || o === undefined) return;
        const tag = outcomeTag(play, p, o);
        rows.push({ monster: p.monster, nickname: m.nickname, species: m.species, pick: p.pick, role: p.role, text: tag.text, cls: tag.cls, payout: null });
      });
      this.plays.set(e.booth, { at: sim.state.time, play, rows });
    });
    bus.on('roundFinished', (e) => {
      if (!isGroupBooth(e.booth)) return;
      const row = this.plays.get(e.booth)?.rows.find((r) => r.monster === e.round.monster);
      if (row !== undefined) row.payout = e.payout;
    });
    bus.on('groupCancelled', (e) => this.cancels.set(e.booth, { at: sim.state.time, reason: e.reason }));
  }

  last(b: GroupBoothId): PlayResult | undefined {
    return this.plays.get(b);
  }

  /** 이 판(play)의 손님 id가 받은 코인 (모르면 null). */
  payout(b: GroupBoothId, play: GroupPlay, id: MonsterId): number | null {
    const r = this.plays.get(b);
    return r !== undefined && r.play === play ? (r.rows.find((x) => x.monster === id)?.payout ?? null) : null;
  }

  /** 지난 판보다 나중에 접힌 판 (없으면 null). */
  cancelAfterLast(b: GroupBoothId): { at: number; reason: 'closed' | 'timeout' } | null {
    const c = this.cancels.get(b);
    if (c === undefined) return null;
    const p = this.plays.get(b);
    return p === undefined || c.at > p.at ? c : null;
  }
}

/** sim 초 → '방금' / '40초 전' / '3분 전'. */
function ago(sec: number): string {
  if (sec < 10) return '방금';
  if (sec < 60) return `${Math.floor(sec / 10) * 10}초 전`;
  return `${Math.floor(sec / 60)}분 전`;
}

// ── 단체 놀이 칸 ──

/** 고른 것 그림 (선수·배·연은 그림, 홍청은 색 동그라미, 판 자리는 흙더미). */
function pickPic(p: PickInfo, cls = ''): HTMLSpanElement {
  if (p.art === null) {
    const s = placeholder(p.name, p.color);
    s.classList.add('side');
    const box = h('span', `mpv-pic ${cls}`.trim(), s);
    return box;
  }
  return pic(p.art.group, [p.art.key], () => placeholder(p.name.slice(0, 1), p.color, true), cls);
}

/** 손님 그림 (포즈는 live로 따라간다). 손님이 없으면 null. */
function livePic(sim: SimApi, live: Live, id: MonsterId, cls = '', pose?: () => Pose | null): HTMLSpanElement | null {
  const m = sim.monster(id);
  if (m === undefined) return null;
  const name = SPECIES[m.species].name;
  const box = monsterPic(m.species, m.pose, name, cls);
  live.add(() => {
    const c = sim.monster(id);
    if (c === undefined) return;
    setMonsterPic(box, c.species, pose?.() ?? c.pose, name);
  });
  return box;
}

export class GroupSection {
  private readonly ctx: UiCtx;
  private readonly live: Live;
  private readonly b: GroupBoothId;
  private readonly results: GroupResults;

  constructor(ctx: UiCtx, live: Live, b: GroupBoothId, results: GroupResults) {
    this.ctx = ctx;
    this.live = live;
    this.b = b;
    this.results = results;
  }

  private get sim(): SimApi {
    return this.ctx.sim;
  }

  private get g(): GroupState | null {
    return this.sim.state.booths[this.b].group;
  }

  /** 지금 이 판에 뛰는 참가자 (판이 없으면 모이는 중인 참가자). */
  private get entries(): readonly GroupEntry[] {
    return this.g?.participants ?? [];
  }

  /** 상태 줄과 고른 것 판 (패널 위쪽). */
  top(): HTMLElement[] {
    return [this.strip(), ...this.board()];
  }

  /** 지난 판과 참가자 목록 (패널 가운데). */
  list(): HTMLElement[] {
    const out: HTMLElement[] = [];
    const ph = this.g?.phase ?? 'idle';
    if (ph === 'idle' || ph === 'gathering') {
      const last = this.lastCard();
      if (last !== null) out.push(last);
    }
    out.push(...this.entryList());
    return out;
  }

  // ── 상태 줄 ──

  private strip(): HTMLElement {
    const b = this.b;
    const flag = h('span', 'flag');
    const title = h('b');
    const sub = h('small');
    const watch = btn('sub small mpv-watch', [icon('pin'), '지도'], () => {
      this.ctx.closeAll();
      this.ctx.hooks.world.focusOn(groupWatchBox(b).c, groupWatchZoom(b, window.innerWidth, window.innerHeight));
    });
    watch.setAttribute('aria-label', '지도에서 구경하기');
    const el = h('div', `mpv-race-st ${this.g?.phase ?? 'idle'}`, flag, h('div', 'mpv-grow', title, sub), watch);
    this.live.add(() => {
      const cur = this.sim.state.booths[b];
      const missing = boothDef(b).roles.filter((r, i) => r.optional !== true && (cur.staff[i] ?? null) === null).map((r) => r.name);
      const t = phaseText(b, cur.group, this.sim.boothOpen(b), missing);
      setText(flag, t.flag);
      setText(title, t.title);
      setText(sub, t.sub);
    });
    return el;
  }

  // ── 고른 것 판 ──

  private board(): HTMLElement[] {
    switch (this.b) {
      case 'race':
      case 'boat':
        return [this.racersBoard()];
      case 'ssireum':
        return this.duelBoard();
      case 'tug':
        return this.tugBoard();
      case 'kite':
        return [this.kiteBoard()];
      case 'dig':
        return this.digBoard();
    }
  }

  /** 경주장·오리배: 선수(배) 넷, 응원하는 손님 수, 달리는 중·끝나면 순위대로. */
  private racersBoard(): HTMLElement {
    const b = this.b;
    const grid = h('div', 'mpv-racers');
    const cards = groupPicks(b).map((p, i) => {
      const fans = this.entries.filter((e) => e.pick === i).length;
      const place = h('span', 'place');
      const card = h('div', 'mpv-racer', place, pickPic(p), h('span', 'name', p.name), h('span', 'fans', `응원 ${fans}`));
      card.classList.toggle('nofans', fans === 0);
      card.style.setProperty('--bib', p.color);
      return { card, place };
    });
    for (const c of cards) grid.append(c.card);
    let lastKey = '';
    this.live.add(() => {
      const order = raceOrderAt(this.g);
      const key = order === null ? '-' : order.join('');
      if (key === lastKey) return;
      lastKey = key;
      (order ?? cards.map((_, i) => i)).forEach((ri, k) => {
        const c = cards[ri];
        if (c === undefined) return;
        grid.append(c.card);
        setText(c.place, order !== null ? `${k + 1}` : '');
        c.place.hidden = order === null;
        c.card.classList.toggle('first', order !== null && k === 0);
      });
    });
    return grid;
  }

  /** 씨름: 홍 선수 vs 청 선수 (구경 응원 수), 진행 중·끝나면 미는 힘 막대. 끝나면 진 선수는 벌러덩. */
  private duelBoard(): HTMLElement[] {
    const es = this.entries;
    const play = livePlay(this.g);
    const winner = play?.kind === 'ssireum' ? play.winner : -1;
    const done = this.g?.phase === 'done';
    const sides = SIDES.map((s, side) => {
      const player = es.find((e) => e.role === 'player' && e.pick === side);
      const fans = es.filter((e) => e.role !== 'player' && e.pick === side).length;
      const res = done && winner >= 0 ? (winner === side ? 'win' : 'lose') : '';
      const color = pickInfo('ssireum', side).color;
      const pose = (): Pose | null => (res === 'win' ? 'joy' : res === 'lose' ? 'sad' : null);
      const face = player === undefined ? null : livePic(this.sim, this.live, player.monster, 'mon', pose);
      const m = player === undefined ? undefined : this.sim.monster(player.monster);
      const card = h(
        'div',
        `mpv-side ${res}`.trim(),
        h('span', 'tag', `${s.name} 선수`),
        face ?? h('span', 'mpv-pic mon empty', '?'),
        h('b', null, m?.nickname ?? '기다리는 중'),
        h('small', null, `응원 ${fans}`),
        res === 'win' ? h('span', 'ribbon', play?.kind === 'ssireum' && play.flip ? '뒤집기!' : '승리!') : null,
      );
      card.style.setProperty('--side', color);
      if (m !== undefined) this.tapMonster(card, m);
      return card;
    });
    const out: HTMLElement[] = [h('div', 'mpv-duel', sides[0] ?? null, h('span', 'vs', 'VS'), sides[1] ?? null)];
    if (play !== null) out.push(this.pushMeter('밀기'));
    return out;
  }

  /** 씨름 미는 힘 / 줄다리기 밧줄: 홍(왼쪽) 몫이 클수록 홍이 이기고 있다. */
  private pushMeter(label: string): HTMLElement {
    const fill = h('i');
    const knot = h('span', 'knot');
    const el = h('div', 'mpv-push', h('span', 'l', SIDES[0].name), h('span', 'track', fill, h('span', 'mid'), knot), h('span', 'r', SIDES[1].name));
    el.setAttribute('aria-label', `${label} 막대`);
    el.style.setProperty('--red', pickInfo('ssireum', 0).color);
    el.style.setProperty('--blue', pickInfo('ssireum', 1).color);
    this.live.add(() => {
      const g = this.g;
      const play = livePlay(g);
      const v = play === null ? 0 : duelValue(play, g?.elapsed ?? 0);
      // v = +1 → 홍이 청을 다 밀어냄 (홍 몫 100%).
      const r = Math.max(0, Math.min(1, 0.5 + v * 0.5));
      fill.style.width = `${(r * 100).toFixed(1)}%`;
      knot.style.left = `${(r * 100).toFixed(1)}%`;
    });
    return el;
  }

  /** 줄다리기: 홍 편·청 편 손님 (모자란 자리는 빈칸), 진행 중·끝나면 밧줄 가운데 리본. */
  private tugBoard(): HTMLElement[] {
    const es = this.entries;
    const play = livePlay(this.g);
    const done = this.g?.phase === 'done';
    const winner = play?.kind === 'tug' ? play.winner : -1;
    const counts = sideCounts(es);
    const per = Math.max(TUG.minSide, counts[0], counts[1]);
    const teams = SIDES.map((s, side) => {
      const mine = es.filter((e) => (e.pick === 1 ? 1 : 0) === side);
      const res = done && winner >= 0 ? (winner === side ? 'win' : 'lose') : '';
      const pose = (): Pose | null => (res === 'win' ? 'joy' : res === 'lose' ? 'agony' : null);
      const faces = h('div', 'faces');
      for (const e of mine) {
        const f = livePic(this.sim, this.live, e.monster, 'mon', pose);
        const m = this.sim.monster(e.monster);
        if (f === null || m === undefined) continue;
        const cell = h('button', 'face', f);
        cell.type = 'button';
        cell.setAttribute('aria-label', `${m.nickname} 손님 보기`);
        this.tapMonster(cell, m);
        faces.append(cell);
      }
      for (let i = mine.length; i < per; i++) faces.append(h('span', 'face empty', '+'));
      const card = h('div', `mpv-team ${res}`.trim(), h('div', 'head', h('span', 'tag', `${s.name} 편`), h('small', null, `${mine.length}명`), res === 'win' ? h('span', 'ribbon', play?.kind === 'tug' && play.comeback ? '역전승!' : '승리!') : null), faces);
      card.style.setProperty('--side', pickInfo('tug', side).color);
      return card;
    });
    const out: HTMLElement[] = [h('div', 'mpv-teams', ...teams)];
    if (play !== null) out.push(this.ropeMeter());
    return out;
  }

  /** 밧줄: 가운데 리본이 c(t)만큼 끌려간다 (+1 = 홍 쪽 선을 넘음). 양쪽에 이기는 선. */
  private ropeMeter(): HTMLElement {
    const ribbon = h('span', 'ribbon');
    const el = h('div', 'mpv-rope', h('span', 'l', SIDES[0].name), h('span', 'track', h('span', 'line a'), h('span', 'line b'), ribbon), h('span', 'r', SIDES[1].name));
    el.style.setProperty('--red', pickInfo('tug', 0).color);
    el.style.setProperty('--blue', pickInfo('tug', 1).color);
    this.live.add(() => {
      const g = this.g;
      const play = livePlay(g);
      const c = play === null ? 0 : duelValue(play, g?.elapsed ?? 0);
      ribbon.style.left = `${(50 - c * 40).toFixed(1)}%`;
    });
    return el;
  }

  /** 연날리기: 연 넷 (날리는 손님 또는 말뚝, 응원 수), 진행 중 나는 중·얽힘·끊김, 끝나면 우승. */
  private kiteBoard(): HTMLElement {
    const es = this.entries;
    const grid = h('div', 'mpv-kites');
    groupPicks('kite').forEach((p, k) => {
      const flyer = es.find((e) => e.role === 'player' && e.pick === k);
      const fans = es.filter((e) => e.role !== 'player' && e.pick === k).length;
      const m = flyer === undefined ? undefined : this.sim.monster(flyer.monster);
      const state = h('span', 'state');
      const kitePic = pickPic(p, 'kite');
      const who =
        m !== undefined
          ? h('span', 'who', monsterPic(m.species, 'base', SPECIES[m.species].name), h('span', 'nm', m.nickname))
          : h('span', 'who none', h('span', 'nm', '말뚝에 묶임'));
      const card = h('div', 'mpv-kite', state, kitePic, h('span', 'name', p.name), who, h('small', 'fans', `응원 ${fans}`));
      card.style.setProperty('--kite', p.color);
      if (m !== undefined) this.tapMonster(card, m);
      grid.append(card);
      this.live.add(() => {
        const g = this.g;
        const play = livePlay(g);
        const t = g?.elapsed ?? 0;
        // 마지막 연이 남으면 (판이 끝나기 전에도) 우승.
        const st = play?.kind === 'kite' ? kiteAt(play, k, t, g?.phase === 'done' || t >= decidedAt(play)) : null;
        const text = st === null ? '' : st === 'fly' ? '나는 중' : st === 'tangle' ? '얽혔다!' : st === 'cut' ? '끊김' : play?.kind === 'kite' && play.close ? '버텼다!' : '우승!';
        setText(state, text);
        state.hidden = text === '';
        card.classList.toggle('cut', st === 'cut');
        card.classList.toggle('tangle', st === 'tangle');
        card.classList.toggle('win', st === 'win');
      });
    });
    return grid;
  }

  /** 보물찾기: 땅 여섯 (3×2, 지도·확대 화면과 같은 배치). 파는 중 → 나온 것. 끝에 상자 자리를 보여 준다. */
  private digBoard(): HTMLElement[] {
    const es = this.entries;
    const grid = h('div', 'mpv-dig');
    groupPicks('dig').forEach((p, spot) => {
      const e = es.find((x) => x.pick === spot);
      const m = e === undefined ? undefined : this.sim.monster(e.monster);
      const art = pickPic(p, 'spot');
      const state = h('span', 'state');
      // 이번 판에 아무도 없는 자리는 '빈자리' ('빈 땅'은 파서 아무것도 안 나온 결과).
      // 손님이 맡은 자리면 판 중·결과 중에는 '다음 판', 모이는 중에는 '오는 중' (4Hz).
      const emptyNm = h('span', 'nm', '빈자리');
      const who = m !== undefined ? h('span', 'who', monsterPic(m.species, 'base', SPECIES[m.species].name), h('span', 'nm', m.nickname)) : h('span', 'who none', emptyNm);
      if (m === undefined) {
        this.live.add(() => {
          const ph = this.g?.phase;
          const taken = (this.sim.state.booths.dig.seats[spot] ?? null) !== null;
          setText(emptyNm, !taken ? '빈자리' : ph === 'running' || ph === 'done' ? '다음 판' : '오는 중');
        });
      }
      const cell = h('div', m === undefined ? 'mpv-spot empty' : 'mpv-spot', h('span', 'no', `${spot + 1}`), art, state, who);
      if (m !== undefined) this.tapMonster(cell, m);
      grid.append(cell);
      this.live.add(() => {
        const g = this.g;
        const play = livePlay(g);
        const t = g?.elapsed ?? 0;
        let text = '';
        let key = 'dirt_mound';
        let group = 'map';
        let cls = '';
        if (play?.kind === 'dig') {
          const s = digSpotAt(play, spot, t);
          const revealed = play.chest === spot && play.events.some((ev) => ev.type === 'reveal' && ev.t <= t);
          if (s === 'dig') text = '파는 중';
          if (s === 'found') {
            const f = DIG_FIND_INFO[play.finds[spot] ?? 'none'];
            group = f.group;
            key = f.key;
            text = f.name;
            cls = play.finds[spot] === 'chest' ? 'gold' : f.good ? 'good' : 'meh';
            if (!f.good && e !== undefined && play.chest >= 0 && play.outcomes[es.indexOf(e)]?.tier === 'nearMiss') text = '바로 옆!';
          } else if (revealed) {
            group = 'map';
            key = 'treasure_chest';
            text = '여기 있었어요';
            cls = 'reveal';
          }
        }
        setPic(art, group, [key], () => placeholder(text.slice(0, 1) || p.name, p.color, true));
        setText(state, text);
        state.hidden = text === '';
        cell.classList.toggle('gold', cls === 'gold');
        cell.classList.toggle('good', cls === 'good');
        cell.classList.toggle('meh', cls === 'meh');
        cell.classList.toggle('reveal', cls === 'reveal');
      });
    });
    const out: HTMLElement[] = [grid];
    // 판 자리 사이에 묻혔던 상자 (할아버지가 파 보인 뒤에).
    const note = h('div', 'mpv-note mpv-dig-note');
    this.live.add(() => {
      const g = this.g;
      const play = livePlay(g);
      const t = g?.elapsed ?? 0;
      const show = play?.kind === 'dig' && play.chest >= 0 && !play.found && play.events.some((ev) => ev.type === 'reveal' && ev.t <= t);
      setText(note, show && play?.kind === 'dig' ? `보물상자는 ${chestPlace(play.chest)}에 묻혀 있었어요` : '');
      note.hidden = !show;
    });
    out.push(note);
    return out;
  }

  // ── 지난 판 ──

  private lastCard(): HTMLElement | null {
    const b = this.b;
    const r = this.results.last(b);
    const cancel = this.results.cancelAfterLast(b);
    const R = roundWord(b);
    if (cancel !== null && this.sim.state.time - cancel.at < 90) {
      const why = cancel.reason === 'timeout' ? (b === 'ssireum' ? '상대 선수가 오지 않아' : b === 'tug' ? '두 편이 차지 않아' : '손님이 모이지 않아') : '진행자 자리가 비어';
      return h('div', 'mpv-last cancel', h('div', 'head', h('span', 'mpv-tag', `지난 ${R}`), h('span', 'mpv-grow', `${why} ${josa(R, '을', '를')} 접었어요 (건 코인은 돌려줬어요)`)));
    }
    if (r === undefined) return null;
    const head = playHeadline(r.play);
    const when = h('small');
    this.live.add(() => setText(when, [...head.flags, ago(this.sim.state.time - r.at)].join(' · ')));
    const rows = h('div', 'rows');
    for (const row of r.rows) {
      const name = SPECIES[row.species].name;
      const chip = h(
        'button',
        `mpv-lastrow ${row.cls}`.trim(),
        monsterPic(row.species, row.cls === 'gold' || row.cls === 'win' ? 'joy' : row.cls === 'near' ? 'agony' : 'sad', name),
        h('span', 'nm', row.nickname),
        h('span', 'res', row.text),
        row.payout !== null && row.payout > 0 ? h('span', 'pay', itemIcon('coin'), `+${fmt(row.payout)}`) : null,
      );
      chip.type = 'button';
      chip.setAttribute('aria-label', `${row.nickname} 손님 보기`);
      chip.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (this.sim.monster(row.monster) !== undefined) this.ctx.showMonster(row.monster);
        else this.ctx.toast(`${row.nickname} 손님은 벌써 집에 갔어요`);
      });
      rows.append(chip);
    }
    return h('div', 'mpv-last', h('div', 'head', h('span', 'mpv-tag', `지난 ${R}`), h('div', 'mpv-grow', h('b', null, head.title), when)), rows);
  }

  // ── 참가자 목록 ──

  private entryList(): HTMLElement[] {
    const b = this.b;
    const bs = this.sim.state.booths[b];
    const g = this.g;
    const phase = g?.phase ?? 'idle';
    const es = this.entries;
    const play = livePlay(g);
    const inPlay = new Set(es.map((e) => e.monster));
    const waiting = bs.seats.filter((id): id is MonsterId => id !== null && !inPlay.has(id));
    const R = roundWord(b);
    // 모이는 동안 자리로 오는 손님은 이번 판에 들고, 진행 중·결과 중에 온 손님은 다음 판.
    const gathering = phase === 'idle' || phase === 'gathering';
    // 머릿글: 자리로 걸어오는 손님은 '오는 중', 앉은 손님은 모이는 중이면 '앉는 중', 아니면 '다음 판' (줄마다의 꼬리표와 같이, 4Hz).
    const count = h('small');
    const out: HTMLElement[] = [h('div', 'mpv-sec', h('span', null, seatWord(b)), count)];
    this.live.add(() => {
      const coming = waiting.filter((id) => this.sim.monster(id)?.phase === 'toSeat').length;
      const sat = waiting.length - coming;
      const parts = [`${es.length}명 참가`];
      if (sat > 0) parts.push(`${sat}명 ${gathering ? '앉는 중' : `다음 ${R}`}`);
      if (coming > 0) parts.push(`${coming}명 오는 중`);
      setText(count, parts.join(' · '));
    });
    if (es.length === 0 && waiting.length === 0) {
      out.push(h('div', 'mpv-empty sm', `손님이 앉으면 고른 것이 여기에 보여요`));
      return out;
    }
    const list = h('div', 'mpv-entries');
    const row = (m: Monster, sub: string, ...right: (HTMLElement | null)[]): void => {
      const sp = SPECIES[m.species];
      const face = livePic(this.sim, this.live, m.id) ?? monsterPic(m.species, m.pose, sp.name);
      const el = h('button', 'mpv-entry', face, h('span', 'who', h('b', null, m.nickname), h('small', null, sub)), ...right);
      el.type = 'button';
      el.setAttribute('aria-label', `${m.nickname} 손님 보기`);
      this.tapMonster(el, m);
      list.append(el);
    };
    es.forEach((e, i) => {
      const m = this.sim.monster(e.monster);
      if (m === undefined) return;
      const chip = this.pickChip(e);
      const o = phase === 'done' && play !== null ? play.outcomes[i] : undefined;
      let right: HTMLElement;
      if (o !== undefined && play !== null) {
        const tag = outcomeTag(play, e, o);
        const pay = h('span', 'pay');
        right = h('span', `mpv-res ${tag.cls}`.trim(), tag.text, pay);
        this.live.add(() => {
          const v = this.results.payout(b, play, e.monster);
          setText(pay, v !== null && v > 0 ? ` +${fmt(v)}` : '');
        });
      } else {
        right = h('span', 'mpv-chip bet', itemIcon('coin'), fmt(e.bet));
      }
      row(m, `${SPECIES[m.species].name} · ${roleWord(b, e.role)}`, chip, right);
    });
    for (const id of waiting) {
      const m = this.sim.monster(id);
      if (m === undefined) continue;
      // 걸어오던 손님이 앉으면 '다음 판'으로 (손님 걸음은 sig에 없어 4Hz로 고친다).
      const tag = h('span', 'mpv-res wait');
      this.live.add(() => setText(tag, this.sim.monster(id)?.phase === 'toSeat' ? '오는 중' : gathering ? '앉는 중' : `다음 ${R}`));
      row(m, SPECIES[m.species].name, tag);
    }
    out.push(list);
    return out;
  }

  /** 참가자가 고른 것 칩 (색·그림). */
  private pickChip(e: GroupEntry): HTMLElement {
    const p = pickInfo(this.b, e.pick);
    const chip = h('span', 'mpv-racer-chip', p.art !== null && this.b !== 'dig' ? pickPic(p) : null, pickShort(this.b, e.pick));
    chip.style.setProperty('--bib', p.color);
    if (p.art === null || this.b === 'dig') chip.classList.add('plain');
    return chip;
  }

  private tapMonster(el: HTMLElement, m: Monster): void {
    el.classList.add('tap');
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.ctx.showMonster(m.id);
    });
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', `${m.nickname} 손님 보기`);
    if (el instanceof HTMLButtonElement) return;
    // 카드(div)도 버튼처럼: 읽기 프로그램과 키보드 (Enter·Space).
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      el.click();
    });
  }
}
