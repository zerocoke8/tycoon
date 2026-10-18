// 단체 놀이(경주장·씨름장·오리배·연날리기·줄다리기·보물찾기) UI 글자와 계산 (DOM 없음).
// 부스 패널의 상태 줄·고른 것 판·참가자 결과·지난 판, 손님 카드, 다음 목표 칩이 같이 쓴다.

import { BOAT, DIG, GROUP_RULES, KITE, RACE, SIDES, TUG, type GroupBoothId, type OutcomeTier } from '../data/defs.ts';
import { DIG_GEO } from '../data/catalog.ts';
import type { Pt } from '../data/map.ts';
import type { Village } from '../sim/village.ts';
import { groupGame, raceOf, trackAt } from '../sim/group/index.ts';
import { racePlace, raceStandings } from '../sim/race.ts';
import { josa } from '../sim/text.ts';
import type { DigFind, GroupEntry, GroupPlay, GroupRole, GroupState, RacerIndex, RoundOutcome } from '../sim/types.ts';

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** 고를 수 있는 것 하나: 이름, 색(CSS), 그림 (보물찾기 판 자리는 흙더미). */
export interface PickInfo {
  readonly name: string;
  readonly color: string;
  readonly art: { readonly group: string; readonly key: string } | null;
}

const RACE_PICKS: readonly PickInfo[] = RACE.racers.map((r) => ({ name: r.name, color: hex(r.bib), art: { group: 'racers', key: r.key } }));
const BOAT_PICKS: readonly PickInfo[] = BOAT.boats.map((r) => ({ name: r.name, color: hex(r.flag), art: { group: 'racers', key: r.key } }));
const SIDE_PICKS: readonly PickInfo[] = SIDES.map((s) => ({ name: s.name, color: hex(s.color), art: null }));
const KITE_PICKS: readonly PickInfo[] = KITE.kites.map((k) => ({ name: k.name, color: hex(k.color), art: { group: 'objects', key: k.key } }));
const DIG_PICKS: readonly PickInfo[] = DIG_GEO.spots.map((_, i) => ({ name: `${i + 1}번`, color: '#c9995f', art: { group: 'map', key: 'dirt_mound' } }));

/** 그 놀이에서 고를 수 있는 것 (pick 순서): 선수 넷·배 넷·홍청·연 넷·판 자리 여섯. */
export function groupPicks(b: GroupBoothId): readonly PickInfo[] {
  switch (b) {
    case 'race':
      return RACE_PICKS;
    case 'boat':
      return BOAT_PICKS;
    case 'ssireum':
    case 'tug':
      return SIDE_PICKS;
    case 'kite':
      return KITE_PICKS;
    case 'dig':
      return DIG_PICKS;
  }
}

/** 고른 것 하나 (없으면 '?'). */
export function pickInfo(b: GroupBoothId, pick: number): PickInfo {
  return groupPicks(b)[pick] ?? { name: '?', color: 'var(--dd-paper)', art: null };
}

/** 참가자 칩 글: '달팽이', '홍', '청 편', '빨강 연', '3번 땅'. */
export function pickShort(b: GroupBoothId, pick: number): string {
  const p = pickInfo(b, pick);
  if (b === 'tug') return `${p.name} 편`;
  if (b === 'dig') return `${p.name} 땅`;
  return p.name;
}

/** 참가자가 하는 일: '응원' / '선수' / '구경' / '연 날리기' / '줄 잡기' / '땅 파기'. */
export function roleWord(b: GroupBoothId, role: GroupRole): string {
  switch (b) {
    case 'race':
    case 'boat':
      return '응원';
    case 'ssireum':
      return role === 'player' ? '선수' : '구경';
    case 'kite':
      return role === 'player' ? '연 날리기' : '구경';
    case 'tug':
      return '줄 잡기';
    case 'dig':
      return '땅 파기';
  }
}

/** 판 하나를 부르는 말: 경주장·오리배 '경주', 그 밖 '판'. */
export const roundWord = (b: GroupBoothId): string => (b === 'race' || b === 'boat' ? '경주' : '판');
/** 시작을 부르는 말: 경주장·오리배 '출발', 그 밖 '시작'. */
export const startWord = (b: GroupBoothId): string => (b === 'race' || b === 'boat' ? '출발' : '시작');

// ── 보물찾기에서 나온 것 ──

export const DIG_FIND_INFO: Readonly<Record<DigFind, { readonly name: string; readonly group: string; readonly key: string; readonly good: boolean }>> = {
  none: { name: '빈 땅', group: 'map', key: 'dirt_mound', good: false },
  chest: { name: '보물상자', group: 'map', key: 'treasure_chest_open', good: true },
  coins: { name: '동전 주머니', group: 'items', key: 'coin_pile', good: true },
  gem: { name: '보석', group: 'items', key: 'gem', good: true },
  boot: { name: '헌 장화', group: 'items', key: 'old_boot', good: false },
  pebble: { name: '조약돌', group: 'objects', key: 'pebble', good: false },
};

/** 상자가 묻혔던 곳 글: '2번 땅' / '3·6번 땅 사이' / '1·2·4·5번 땅 가운데' (DIG_GEO.chests 뒤 셋은 판 자리 사이). */
export function chestPlace(c: number): string {
  const p = DIG_GEO.chests[c];
  if (p === undefined) return '어딘가';
  const spot = DIG_GEO.spots.findIndex((s) => s.x === p.x && s.y === p.y);
  if (spot >= 0) return `${spot + 1}번 땅`;
  // 가장 가까운 판 자리들 (판 자리 사이의 상자는 둘레 넷이 같은 거리: 다 말한다)
  const ds = DIG_GEO.spots.map((s, i) => ({ i, d: Math.hypot(s.x - p.x, s.y - p.y) }));
  const min = Math.min(...ds.map((x) => x.d));
  const near = ds.filter((x) => x.d <= min + 1).map((x) => x.i + 1);
  return near.length > 2 ? `${near.join('·')}번 땅 가운데` : `${near.join('·')}번 땅 사이`;
}

// ── 결과 ──

/** 판 하나의 결과 머리글과 꼬리표: { title: '홍 승리!', flags: ['뒤집기!'] }. */
export function playHeadline(play: GroupPlay): { title: string; flags: string[] } {
  switch (play.kind) {
    case 'race':
    case 'boat': {
      const res = play.race;
      const first = res.finishOrder[0] ?? 0;
      const name = (play.kind === 'race' ? RACE_PICKS : BOAT_PICKS)[first]?.name ?? '?';
      const flags = [res.comeback ? '꼴찌에서 역전' : '', res.photoFinish ? '사진 판정' : ''].filter((x) => x !== '');
      return { title: `${josa(name, '이', '가')} 1등!`, flags };
    }
    case 'ssireum':
      return { title: `${SIDES[play.winner].name} 승리!`, flags: play.flip ? ['뒤집기!'] : play.close ? ['막판 역전'] : [] };
    case 'tug': {
      const [r, bl] = play.sizes;
      return { title: `${SIDES[play.winner].name} 편 승리!`, flags: [play.comeback ? '역전승!' : play.close ? '막판 역전' : '', `${r} 대 ${bl}`].filter((x) => x !== '') };
    }
    case 'kite': {
      const w = play.order[play.order.length - 1] ?? 0;
      return { title: `${KITE_PICKS[w]?.name ?? '?'} 우승!`, flags: [play.close ? '끊길 뻔했는데!' : '', play.late ? '끝까지 접전' : ''].filter((x) => x !== '') };
    }
    case 'dig': {
      const small = play.finds.filter((f) => f === 'coins' || f === 'gem').length;
      const extra = small > 0 ? [`작은 보물 ${small}개`] : [];
      if (play.found) return { title: '보물상자 발견!', flags: extra };
      if (play.chest >= 0) return { title: '상자를 못 찾았어요', flags: [`${chestPlace(play.chest)}에 있었어요`, ...extra] };
      return { title: small > 0 ? '작은 보물이 나왔어요' : '이번엔 꽝이에요', flags: ['이번 판엔 상자가 없었어요'] };
    }
  }
}

/** 손님 하나의 결과 글과 색 이름 (gold = 대박, win, near = 아깝다, '' = 짐). */
export function outcomeTag(play: GroupPlay, e: Pick<GroupEntry, 'pick'>, o: RoundOutcome): { text: string; cls: string } {
  const cls = TIER_CLS[o.tier];
  switch (play.kind) {
    case 'race':
    case 'boat': {
      const place = racePlace(play.race, e.pick as RacerIndex);
      if (place === 1) return play.race.comeback ? { text: '역전 대박!', cls: 'gold' } : { text: '1등!', cls: 'win' };
      if (place === 2 && play.race.photoFinish) return { text: '아깝다! 사진 판정', cls: 'near' };
      return { text: `${place}등`, cls: '' };
    }
    case 'ssireum':
    case 'tug':
      return { text: o.tier === 'jackpot' ? (play.kind === 'ssireum' ? '뒤집기 대박!' : '역전승 대박!') : o.tier === 'win' ? '이겼다!' : o.tier === 'nearMiss' ? '아깝다! 막판에 뒤집혔어요' : '졌어요', cls };
    case 'kite': {
      const d = o.detail;
      const place = d.kind === 'kite' ? d.place : 0;
      return { text: o.tier === 'jackpot' ? '버텨서 대박!' : o.tier === 'win' ? '우승!' : o.tier === 'nearMiss' ? '아깝다! 끝에 끊김' : `${place}등`, cls };
    }
    case 'dig': {
      const d = o.detail;
      const find: DigFind = d.kind === 'dig' ? d.find : 'none';
      if (o.tier === 'nearMiss') return { text: '바로 옆이었는데!', cls };
      return { text: find === 'chest' ? '보물상자!' : DIG_FIND_INFO[find].name, cls };
    }
  }
}

const TIER_CLS: Record<OutcomeTier, string> = { jackpot: 'gold', win: 'win', nearMiss: 'near', lose: '' };

// ── 상태 줄 ──

/** 상태 줄 세 글: flag(왼쪽 작은 깃발), title(큰 글), sub(작은 글). */
export interface PhaseText {
  readonly flag: string;
  readonly title: string;
  readonly sub: string;
}

/**
 * 지금 판의 상태 줄. open = 부스가 손님을 받는 중 (꼭 있어야 하는 진행자 자리가 다 참), missing = 빈 꼭 필요한 자리 이름.
 * 빚 걸기 판(넷째 묶음, GroupState.mode 'debt')은 깃발이 '빚 걸기'이고 모이는 동안 불린 채무자를 기다린다. 다음 판이 예약됐으면 작은 글에 알린다.
 */
export function phaseText(b: GroupBoothId, g: GroupState | null, open: boolean, missing: readonly string[], idle: 'stored' | 'road' | 'staff' | null = null): PhaseText {
  const t = basePhaseText(b, g, open, missing, idle);
  if (g === null || !open) return t;
  if (g.mode === 'debt') {
    const ph = g.phase;
    if (ph === 'idle' || ph === 'gathering') {
      const ds = g.debtors ?? [];
      const came = ds.filter((id) => g.participants.some((e) => e.monster === id)).length;
      const all = ds.length > 0 && came >= ds.length;
      const cd = Math.max(0, Math.ceil(g.countdown));
      const S = startWord(b);
      return {
        flag: '빚 걸기',
        title: all ? (cd > 0 ? `${S}까지 ${cd}초` : `곧 ${S}!`) : '빚진 선수를 기다려요',
        sub: `일터 반장이 연 판 · ${came === 0 ? `빚진 손님 ${ds.length}명이 오는 중` : `${ds.length}명 가운데 ${came}명 도착`} · 이기면 빚 반, 지면 상대 빚만큼 더`,
      };
    }
    return { ...t, flag: '빚 걸기' };
  }
  if (g.debtNext === true) return { ...t, sub: `${t.sub} · 다음 판은 빚 걸기 판` };
  return t;
}

function basePhaseText(b: GroupBoothId, g: GroupState | null, open: boolean, missing: readonly string[], idle: 'stored' | 'road' | 'staff' | null): PhaseText {
  const ph = g?.phase ?? 'idle';
  const es = g?.participants ?? [];
  const n = es.length;
  const cd = Math.max(0, Math.ceil(g?.countdown ?? 0));
  const R = roundWord(b);
  const S = startWord(b);
  // 닫혔으면 (진행 중인 판은 끝까지 간다) 손님을 받지 않는다: 보관함 → 입구 앞 길 → 꼭 있어야 하는 진행자.
  if (!open && (ph === 'idle' || ph === 'gathering')) {
    if (idle === 'stored') return { flag: '쉬어요', title: '보관함에 있어요', sub: '지도에 놓으면 손님이 와요' };
    if (idle === 'road' || missing.length === 0) return { flag: '쉬어요', title: '길이 이어지지 않았어요', sub: '입구에서 마을 입구까지 길을 이어 주세요' };
    return { flag: '쉬어요', title: '쉬는 중', sub: `${missing.join('·')} 자리를 채우면 손님이 와요` };
  }
  const play = g === null ? null : g.play;
  switch (ph) {
    case 'idle':
      return { flag: '모여요', title: idleTitle(b), sub: idleSub(b) };
    case 'gathering': {
      const ready = groupGame(b).readiness(es, g?.elapsed ?? 0);
      if (ready === 'none') return { flag: '모여요', title: waitTitle(b, es), sub: waitSub(b, es, g?.elapsed ?? 0) };
      return { flag: '모여요', title: cd > 0 ? `${S}까지 ${cd}초` : `곧 ${S}!`, sub: gatherSub(b, es, ready === 'soon', cd) };
    }
    case 'running': {
      const flag = b === 'race' ? '달려라' : '한창';
      if (play === null) return { flag, title: runTitle(b), sub: `${n}명이 함께해요` };
      const t = g?.elapsed ?? 0;
      // 승부가 난 뒤 (결승·넘어뜨리기·선 넘음·마지막 연) 판이 끝날 때까지는 결과를 먼저 보여 준다 (확대 화면과 같이).
      if (t >= decidedAt(play)) {
        const head = playHeadline(play);
        return { flag, title: head.title, sub: [...head.flags, b === 'race' || b === 'boat' ? `${n}명이 응원했어요` : `${n}명이 함께했어요`].join(' · ') };
      }
      return { flag, title: runTitle(b), sub: runSub(b, play, t, n) };
    }
    case 'done': {
      const head = play === null ? { title: '결과!', flags: [] } : playHeadline(play);
      const next = cd > 0 ? `다음 ${R} 준비 ${cd}초` : `다음 ${josa(R, '을', '를')} 준비해요`;
      return { flag: '결과', title: head.title, sub: [...head.flags, next].join(' · ') };
    }
  }
}

function idleTitle(b: GroupBoothId): string {
  switch (b) {
    case 'ssireum':
      return '선수를 기다려요';
    case 'tug':
      return '두 편을 기다려요';
    case 'kite':
      return '연 날릴 손님을 기다려요';
    case 'dig':
      return '보물 찾을 손님을 기다려요';
    default:
      return '손님을 기다려요';
  }
}

function idleSub(b: GroupBoothId): string {
  switch (b) {
    case 'race':
      return `관중석에 손님이 앉으면 출발을 준비해요 · ${RACE.minRunners}명 이상 모이면 곧 출발`;
    case 'boat':
      return `선착장에 손님이 앉으면 출발을 준비해요 · ${RACE.minRunners}명 이상 모이면 곧 출발`;
    case 'ssireum':
      return '홍·청 선수 둘이 오면 시작해요 · 구경 손님은 한 편에 걸어요';
    case 'tug':
      return `편마다 ${TUG.minSide}명이 모이면 곧 시작해요`;
    case 'kite':
      return `손님이 앉으면 시작을 준비해요 · ${KITE.soonAt}명이 모이면 곧 시작`;
    case 'dig':
      return `손님마다 땅 한 곳을 파요 · ${DIG.soonAt}명이 모이면 곧 시작`;
  }
}

/** 출발 조건이 아직 안 맞을 때 (씨름 상대가 없음, 줄다리기 편이 덜 참). */
function waitTitle(b: GroupBoothId, es: readonly GroupEntry[]): string {
  if (b === 'ssireum') return es.some((e) => e.role === 'player') ? '상대 선수를 기다려요' : '선수를 기다려요';
  if (b === 'tug') return '편을 모으는 중';
  return '손님을 기다려요';
}

function waitSub(b: GroupBoothId, es: readonly GroupEntry[], waited: number): string {
  const left = Math.max(0, Math.ceil(GROUP_RULES[b].maxWaitSec - waited));
  const giveUp = left <= 20 ? ` · ${left}초 더 안 오면 접어요` : '';
  if (b === 'ssireum') {
    const miss = SIDES.filter((_, s) => !es.some((e) => e.role === 'player' && e.pick === s)).map((s) => s.name);
    const watch = es.filter((e) => e.role !== 'player').length;
    return `${miss.join('·')} 선수가 오면 시작해요${watch > 0 ? ` · 구경 ${watch}명` : ''}${giveUp}`;
  }
  if (b === 'tug') {
    const [r, bl] = sideCounts(es);
    return `홍 ${r}명 · 청 ${bl}명 · 편마다 ${TUG.minSide}명이면 곧 시작${giveUp}`;
  }
  return `${es.length}명 참가${giveUp}`;
}

function gatherSub(b: GroupBoothId, es: readonly GroupEntry[], soon: boolean, cd: number): string {
  const n = es.length;
  // 연·보물찾기: soonAt명이 모이면 곧 시작 (그보다 적으면 모이는 시간을 다 기다린다).
  const need = b === 'kite' ? KITE.soonAt : b === 'dig' ? DIG.soonAt : n + 1;
  const more = soon ? `곧 ${startWord(b)}!` : `${Math.max(1, need - n)}명 더 오면 곧 시작`;
  const coming = cd <= 0 ? '오는 손님을 기다려요' : null;
  switch (b) {
    case 'race':
    case 'boat':
      return `${n}명이 응원해요 · ${coming ?? (soon ? `곧 출발!` : `${RACE.minRunners}명이 모이면 곧 출발`)}`;
    case 'ssireum': {
      const watch = es.filter((e) => e.role !== 'player').length;
      return `선수 둘이 다 왔어요${watch > 0 ? ` · 구경 ${watch}명` : ''} · ${coming ?? '구경 손님을 조금 더 기다려요'}`;
    }
    case 'tug': {
      const [r, bl] = sideCounts(es);
      const even = r === bl ? '' : ' · 남는 손님은 다음 판에 해요';
      return `홍 ${r}명 · 청 ${bl}명${soon ? '' : ' · 1 대 1로라도 곧 시작해요'}${even}`;
    }
    case 'kite': {
      const fly = es.filter((e) => e.role === 'player').length;
      const watch = n - fly;
      return `연 날리기 ${fly}명${watch > 0 ? ` · 구경 ${watch}명` : ''} · ${coming ?? more}`;
    }
    case 'dig':
      return `${n}명이 땅을 골랐어요 · ${coming ?? more}`;
  }
}

function runTitle(b: GroupBoothId): string {
  switch (b) {
    case 'race':
      return '달리는 중!';
    case 'boat':
      return '물살을 가르는 중!';
    case 'ssireum':
      return '밀고 밀리는 중!';
    case 'tug':
      return '영차, 영차!';
    case 'kite':
      return '연싸움 중!';
    case 'dig':
      return '삽질 중!';
  }
}

/** 승부가 나는 시각 (초): 경주 1등 결승, 씨름 넘어뜨리기, 줄다리기 선 넘음, 마지막 연, 보물찾기 마지막 발견·할아버지가 파 보임. */
export function decidedAt(play: GroupPlay): number {
  switch (play.kind) {
    case 'race':
    case 'boat':
      return play.race.finishAt[play.race.finishOrder[0] ?? 0] ?? play.end;
    case 'ssireum':
      return play.throwAt;
    case 'tug':
      return play.crossAt;
    case 'kite':
      return play.events.find((e) => e.type === 'finish')?.t ?? play.end;
    case 'dig':
      return Math.max(0, ...play.findAt, ...play.events.filter((e) => e.type === 'reveal').map((e) => e.t));
  }
}

/** 진행 중 작은 글 (지금 시각 t의 판 모습). */
function runSub(b: GroupBoothId, play: GroupPlay, t: number, n: number): string {
  switch (play.kind) {
    case 'race':
    case 'boat': {
      const lead = raceStandings(play.race, t)[0];
      const name = lead === undefined ? null : pickInfo(b, lead).name;
      return `${n}명이 응원해요${name === null ? '' : ` · 지금 1등 ${name}`}`;
    }
    case 'ssireum': {
      const p = trackAt(play.tracks[0] ?? [], t);
      if (t >= play.throwAt) return `${josa(SIDES[play.winner].name, '이', '가')} 넘어뜨렸어요!`;
      return duelSub(p, (s) => `${josa(s, '이', '가')} 모래판 끝까지 밀어붙여요!`, (s) => `${josa(s, '이', '가')} 밀어붙여요`, '팽팽하게 버텨요');
    }
    case 'tug': {
      const c = trackAt(play.tracks[0] ?? [], t);
      if (t >= play.crossAt) return `${SIDES[play.winner].name} 편이 끌어당겼어요!`;
      return duelSub(c, (s) => `${s} 편이 선 바로 앞까지 끌어당겨요!`, (s) => `${s} 편이 끌어당겨요`, '줄이 팽팽해요');
    }
    case 'kite': {
      const alive = play.cutAt.filter((c) => c < 0 || c > t).length;
      const cut = recentCut(play, t);
      const tangle = tangledPair(play, t);
      const nm = (k: number): string => KITE_PICKS[k]?.name ?? '연';
      const what = cut !== null ? ` · ${josa(nm(cut), '이', '가')} 끊어졌어요!` : tangle !== null ? ` · ${josa(nm(tangle[0]), '과', '와')} ${josa(nm(tangle[1]), '이', '가')} 얽혔어요!` : '';
      return `남은 연 ${alive}개${what}`;
    }
    case 'dig': {
      const found = play.findAt.filter((at) => at >= 0 && at <= t).length;
      const chestUp = play.found && play.findAt[play.chest] !== undefined && (play.findAt[play.chest] ?? Infinity) <= t;
      if (chestUp) return '보물상자가 나왔어요!';
      if (play.events.some((e) => e.type === 'reveal' && e.t <= t)) return `할아버지가 ${josa(chestPlace(play.chest), '을', '를')} 파 보여 줘요`;
      return found > 0 ? `${found}곳에서 무언가 나왔어요` : `${n}명이 땅을 파요`;
    }
  }
}

/** 씨름·줄다리기의 앞선 편 글 (v > 0 = 홍). */
function duelSub(v: number, brink: (side: string) => string, push: (side: string) => string, even: string): string {
  const a = Math.abs(v);
  if (a < 0.18) return even;
  const side = SIDES[v > 0 ? 0 : 1].name;
  return a > 0.68 ? brink(side) : push(side);
}

/** 편 인원 (홍, 청). */
export function sideCounts(es: readonly Pick<GroupEntry, 'pick'>[]): [number, number] {
  let r = 0;
  let bl = 0;
  for (const e of es) {
    if (e.pick === 1) bl++;
    else r++;
  }
  return [r, bl];
}

/** 막 끊긴 연 (2.5초 안, 없으면 null). */
export function recentCut(play: Extract<GroupPlay, { kind: 'kite' }>, t: number): number | null {
  let best: number | null = null;
  play.cutAt.forEach((c, k) => {
    if (c >= 0 && c <= t && t - c < 2.5 && (best === null || c > (play.cutAt[best] ?? -1))) best = k;
  });
  return best;
}

/** 지금 줄이 얽혀 있는 연 둘 (없으면 null): tangle 사건부터 그 연이 끊길 때까지. */
export function tangledPair(play: Extract<GroupPlay, { kind: 'kite' }>, t: number): [number, number] | null {
  for (const ev of play.events) {
    if (ev.type !== 'tangle' || ev.t > t || ev.other === undefined) continue;
    const cut = play.cutAt[ev.actor] ?? -1;
    if (cut < 0 || t < cut) return [ev.actor, ev.other];
  }
  return null;
}

/** 보물찾기 판 자리 spot의 t초 모습: idle = 아직, dig = 파는 중, found = 나왔다 (find). */
export function digSpotAt(play: Extract<GroupPlay, { kind: 'dig' }>, spot: number, t: number): 'idle' | 'dig' | 'found' {
  const at = play.findAt[spot] ?? -1;
  if (at < 0) return 'idle';
  if (t >= at) return 'found';
  return trackAt(play.tracks[spot] ?? [], t) > 0.02 ? 'dig' : 'idle';
}

/** 연 k의 t초 모습: fly = 나는 중, tangle = 얽힘, cut = 끊김, win = 마지막까지 남음 (끝났을 때만). */
export function kiteAt(play: Extract<GroupPlay, { kind: 'kite' }>, k: number, t: number, done: boolean): 'fly' | 'tangle' | 'cut' | 'win' {
  const cut = play.cutAt[k] ?? -1;
  if (cut >= 0 && t >= cut) return 'cut';
  if (done && play.order[play.order.length - 1] === k) return 'win';
  const pair = tangledPair(play, t);
  return pair !== null && (pair[0] === k || pair[1] === k) ? 'tangle' : 'fly';
}

/** 씨름 미는 힘 p / 줄다리기 밧줄 c (-1~1, + = 홍 쪽이 이김). 그 밖은 0. */
export function duelValue(play: GroupPlay, t: number): number {
  return play.kind === 'ssireum' || play.kind === 'tug' ? trackAt(play.tracks[0] ?? [], t) : 0;
}

/** 경주·오리배 순서: 달리는 중이면 지금 순위, 끝났으면 들어온 순서, 아니면 null (번호 순서). */
export function raceOrderAt(g: GroupState | null): RacerIndex[] | null {
  const res = raceOf(g?.play);
  if (g === null || res === null) return null;
  if (g.phase === 'running') return raceStandings(res, g.elapsed);
  if (g.phase === 'done') return res.finishOrder;
  return null;
}

// ── 지도에서 보기 ──

/** 놀이가 보이는 지도 사각형 (세계 좌표, 놓인 자리 v = sim.village()): 가운데와 폭·높이. 연은 하늘까지. */
export function groupWatchBox(v: Village, b: GroupBoothId): { c: Pt; w: number; h: number } {
  switch (b) {
    case 'race': {
      const T = v.race();
      return { c: { x: T.center.x, y: T.center.y + 60 }, w: T.rx * 2 + 380, h: T.ry * 2 + 520 };
    }
    case 'boat': {
      const dock = v.booth('boat').base;
      const C = v.boat().course;
      const top = C.center.y - C.ry - 160;
      return { c: { x: C.center.x, y: (top + dock.y + 60) / 2 }, w: C.rx * 2 + 420, h: dock.y + 60 - top };
    }
    case 'ssireum': {
      const R = v.ring();
      return { c: { x: R.center.x, y: R.center.y - 30 }, w: R.rx * 2 + 520, h: R.ry * 2 + 420 };
    }
    case 'kite': {
      const K = v.kite();
      const s = K.sky;
      const bottom = K.center.y + 200;
      return { c: { x: s.x + s.w / 2, y: (s.y + bottom) / 2 }, w: s.w + 160, h: bottom - s.y };
    }
    case 'tug': {
      const T = v.tug();
      const [a, z] = T.flags;
      const w = a !== undefined && z !== undefined ? Math.abs(z.x - a.x) + 260 : 1300;
      return { c: { x: T.center.x, y: T.center.y - 40 }, w, h: 560 };
    }
    case 'dig': {
      const D = v.dig();
      return { c: { x: D.center.x, y: D.center.y - 60 }, w: 860, h: 760 };
    }
  }
}

/** 화면 크기(CSS px)에 그 놀이가 다 들어오는 확대 (위·아래 UI를 뺀 높이). */
export function groupWatchZoom(v: Village, b: GroupBoothId, vw: number, vh: number): number {
  const box = groupWatchBox(v, b);
  const z = Math.min(vw / box.w, Math.max(200, vh - 230) / box.h);
  return Math.max(0.12, Math.min(0.9, z));
}
