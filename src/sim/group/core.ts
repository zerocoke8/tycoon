// 단체 놀이 엔진의 약속과 공용 도구 (순수: Rng만, 화면·DOM을 모른다).
// 흐름(모이기 → 출발 대기 → 진행 → 결과 → 쉬기)은 sim.ts의 '단체 놀이' 묶음이 모든 단체 놀이에 똑같이 돌린다.
// 놀이마다 다른 것(자리 고르기, 고르기, 출발 조건, 나서기, 판 만들기, 사건, 응원, 진행 중 구경꾼 들썩임, 결과 뒤 구경)은
// 놀이 모듈(GroupGame, sim/group/<booth>.ts)이 준다.
// 등록은 sim/group/index.ts GROUP_GAMES.

import type { Rng } from '../../core/rng.ts';
import { GROUP_RULES, ODDS, type GroupBoothId, type OutcomeTier } from '../../data/defs.ts';
import type { Pt } from '../../data/map.ts';
import type { GameState, GroupBuzz, GroupEntry, GroupEvent, GroupKey, GroupPlay, GroupRole, GroupState, Monster, RaceResult, RoundDetail, RoundOutcome } from '../types.ts';

/** 손님 하나가 자리에 앉으며 고르는 것. */
export interface GroupJoin {
  readonly pick: number;
  readonly role: GroupRole;
}

/** 참가자 하나가 다른 자리로 나서기 (GroupGame.stepIn). */
export interface GroupStepIn {
  /** 옮길 참가자 (entries index). */
  readonly index: number;
  readonly seat: number;
  readonly pick: number;
  readonly role: GroupRole;
}

/** 지금 참가자로 출발할 수 있나: none = 아직 (씨름 상대가 없음), ok = 대기 시간이 끝나면 출발, soon = 곧 출발 (GROUP_RULES.startSoonSec). */
export type GroupReadiness = 'none' | 'ok' | 'soon';

/** 판 만들기에 주는 것. */
export interface GroupGenCtx {
  /** 판 길이 (초, 부스 레벨의 roundSec). 생성기는 이 안에서 끝낸다 (play.end ≤ duration). */
  readonly duration: number;
  /** 부스 레벨 1~3. */
  readonly level: number;
  /** 진행 능력치 1~5 (진행 자리 진행자). */
  readonly pace: number;
  /** 행운이 붙은 참가자 (entries index, 없으면 -1): 그 손님 쪽이 이긴다 (보물찾기는 작은 보물 이상). */
  readonly lucky: number;
  /** 자리 수. */
  readonly seats: number;
}

/** 놀이 모듈 하나 (sim/group/<booth>.ts). sim.ts는 이 약속만 안다. */
export interface GroupGame {
  readonly booth: GroupBoothId;
  /** pick의 가짓수 (경주·오리배 4, 씨름·줄다리기 2, 연 4, 보물찾기 6). */
  readonly picks: number;
  /** 결과 뒤 구경 반응을 재는 가운데 (세계 좌표: 놓인 자리, 반경 TUNE.groupSpectateRadius). */
  center(state: GameState): Pt;
  /** 자리 seat에 앉은 손님이 바라보는 점 (세계 좌표, -1 = 근처에서 구경하는 손님). */
  face(state: GameState, seat: number): Pt;
  /** 구경 손님이 서서 보는 곳 (세계 좌표, 시설 발자국 안: 입구로 들어가 선다). */
  watchPoint(state: GameState, rng: Rng): Pt;
  /**
   * 줄 맨 앞 손님이 앉을 자리 (free = 빈 자리, 오름차순, 하나 이상). seated[자리] = 그 자리 손님 (걸어오는 손님 포함, 빈 자리 null).
   * 씨름 선수·구경, 연 날리기·구경, 줄다리기 적은 편, 보물찾기 판 자리. 없으면 free[0] (앞자리부터). free 밖의 값이면 free[0].
   */
  seatFor?(rng: Rng, m: Monster, free: readonly number[], seated: readonly (Monster | null)[]): number;
  /** 자리 seat에 앉은 손님이 참가하며 고르는 것과 역할 (건 코인을 정한 다음에 부른다). entries = 이미 참가한 손님, who(id) = 그 손님 (없으면 undefined). */
  join(rng: Rng, seat: number, m: Monster, entries: readonly GroupEntry[], who?: (id: number) => Monster | undefined): GroupJoin;
  /** 지금 참가자로 출발할 수 있나. waited = 모이기 시작하고 지난 초 (오래 기다리면 조건을 낮추는 놀이: 줄다리기 1:1). */
  readiness(entries: readonly GroupEntry[], waited: number): GroupReadiness;
  /**
   * 출발 조건이 안 맞은 채(readiness none) 기다릴 때 참가자 하나가 다른 자리로 나서기 (씨름: 상대가 오지 않으면 구경 손님이 모래판으로).
   * free = 빈 자리 (걸어오는 손님이 맡은 자리는 빈 자리가 아니다), who(id) = 그 손님. 옮길 참가자(entries index)·자리·새 고르기·역할, 없으면 null.
   * sim이 자리를 옮기고 (그 손님은 걸어간다) 출발을 조금 기다린다 (groupStartSoonSec), groupJoined를 다시 낸다.
   */
  stepIn?(entries: readonly GroupEntry[], waited: number, free: readonly number[], who: (id: number) => Monster | undefined): GroupStepIn | null;
  /**
   * 출발 때 이번 판에 뛸 참가자 (줄다리기: 편 인원 맞추기). 빠진 손님은 건 코인을 돌려받고 자리에서 다음 판을 기다린다.
   * entries는 오래 기다린 손님부터 (sim이 정렬해 준다: 앞에서부터 고르면 된다). 없으면 모두.
   */
  lineup?(entries: readonly GroupEntry[]): GroupEntry[];
  /** 판 하나 (순수: rng만). play.outcomes는 entries와 같은 순서·같은 길이. */
  generate(rng: Rng, entries: readonly GroupEntry[], ctx: GroupGenCtx): GroupPlay;
  /**
   * 진행 중 매 틱: 지금 알릴 사건 (없으면 null). 받아들이면 sim이 g.mark = 사건 actor, g.markAt = t,
   * 그 사건이 타임라인의 g.cursor번째였으면 cursor를 하나 넘긴다. 보통은 pollTimeline (타임라인 사건을 시각대로).
   */
  poll(play: GroupPlay, g: GroupState, t: number): GroupEvent | null;
  /** 이 사건에 참가자 기분 + 입담 × TUNE.groupCommentMood를 주나 (없으면 모든 사건). */
  moodOn?(ev: GroupEvent): boolean;
  /** 사건에 참가자 e가 들썩(lead)·조마조마(behind)하나 (null = 반응 없음). */
  cheer(play: GroupPlay, e: GroupEntry, ev: GroupEvent): 'lead' | 'behind' | null;
  /** 자기 일인 사건의 응원 열쇠에 붙일 세부 (reactions.ts cheerKey, 보물찾기: 자기 땅에서 나온 것 'find:boot'). 없으면 null. */
  cheerDetail?(play: GroupPlay, ev: GroupEvent): string | null;
  /** 결과 뒤 근처 구경꾼이 보는 판의 등급 (jackpot = 역전·뒤집기, nearMiss = 아슬아슬, win = 그 밖)과 주인공 (entries index, 없으면 -1). */
  crowd(play: GroupPlay, entries: readonly GroupEntry[]): { tier: OutcomeTier; star: number };
  /**
   * 진행 중 사건에 근처 구경꾼(참가하지 않은 손님)이 들썩이나: 모양(GroupBuzz)과 주인공 (entries index, -1 = 없음). null = 구경 반응 없음.
   * 큰 사건만 (뒤집기·질 뻔함·연줄 끊김·보물·막판 역전). 없으면 진행 중 구경 반응이 없다.
   */
  buzz?(play: GroupPlay, ev: GroupEvent, entries: readonly GroupEntry[]): { kind: GroupBuzz; star: number } | null;
}

/** pick을 고른 참가자 수. */
export function backers(entries: readonly GroupEntry[], pick: number): number {
  let n = 0;
  for (const e of entries) if (e.pick === pick) n++;
  return n;
}

/**
 * 구경하며 거는 손님(bettor)의 고르기 (씨름 편·연·오리배): 같은 종 선수가 있으면 그쪽 (sameKind), 구경꾼 성격은 사람이 많은 쪽 (따라 하기),
 * 대담이는 사람이 적은 쪽 (응원이 적은 쪽), 그 밖은 고르게. options = 고를 수 있는 것, own(pick) = 그 pick의 선수 (없으면 undefined).
 */
export function crowdPick(rng: Rng, m: Monster, entries: readonly GroupEntry[], options: readonly number[], own: (pick: number) => Monster | undefined, sameKind = 0.8): number {
  const kin = options.filter((p) => own(p)?.species === m.species);
  if (kin.length > 0 && rng.chance(sameKind)) return rng.pick(kin);
  const count = options.map((p) => backers(entries, p));
  const most = Math.max(...count);
  const least = Math.min(...count);
  if (most !== least) {
    if (m.traits.includes('watcher') && rng.chance(0.7)) return rng.pick(options.filter((_, i) => count[i] === most));
    if (m.traits.includes('bold') && rng.chance(0.6)) return rng.pick(options.filter((_, i) => count[i] === least));
  }
  return rng.pick(options);
}

/** 이 자리 고르기에서 나설 확률 (씨름 선수·연 날리기): base에 성격·떠다니는 종을 더한다 (0.05~0.95). */
export function eagerness(m: Monster, base: number, k: { readonly bold: number; readonly coward: number; readonly watcher: number; readonly floats: number }, floats: boolean): number {
  let p = base;
  if (m.traits.includes('bold')) p += k.bold;
  if (m.traits.includes('coward')) p += k.coward;
  if (m.traits.includes('watcher')) p += k.watcher;
  if (floats) p += k.floats;
  return Math.max(0.05, Math.min(0.95, p));
}

/** 쉬는 단체 놀이 (BoothState.group의 처음 값). */
export function idleGroup(): GroupState {
  return { phase: 'idle', countdown: 0, elapsed: 0, duration: 0, participants: [], play: null };
}

/** 진행(1~5)으로 줄어드는 대기 배수 (진행 3 = 1, 1점마다 gatherPacePerPoint, gatherMinFrac까지). */
function paceFactor(b: GroupBoothId, pace: number): number {
  const r = GROUP_RULES[b];
  return Math.max(r.gatherMinFrac, 1 - (pace - 3) * r.gatherPacePerPoint);
}

/** 첫 손님이 앉고 출발까지 초. */
export function groupGatherSec(b: GroupBoothId, pace: number): number {
  return GROUP_RULES[b].gatherSec * paceFactor(b, pace);
}

/** 출발 조건이 '곧'일 때 출발까지 초 (이보다 많이 남았으면 줄인다). */
export function groupStartSoonSec(b: GroupBoothId, pace: number): number {
  return GROUP_RULES[b].startSoonSec * paceFactor(b, pace);
}

/** 타임라인 사건을 시각대로 하나씩 (g.cursor번째가 시각이 되었으면 그것). */
export function pollTimeline(play: GroupPlay, g: GroupState, t: number): GroupEvent | null {
  const ev = play.events[g.cursor ?? 0];
  return ev !== undefined && ev.t <= t ? ev : null;
}

/**
 * 키프레임 keys의 t초 값. 키 사이는 넘치지 않는 3차 보간 (Fritsch–Carlson: 오르내림이 바뀌는 키에서 멈칫, 두 키 값 밖으로 나가지 않는다).
 * 첫 키 앞은 첫 값, 마지막 키 뒤는 마지막 값. 키가 없으면 0. 늘 오르는 키(경주 진행)면 sim/race.ts raceProgress와 같은 값.
 */
export function trackAt(keys: readonly GroupKey[], t: number): number {
  const n = keys.length;
  if (n === 0) return 0;
  const first = keys[0] as GroupKey;
  const last = keys[n - 1] as GroupKey;
  if (t <= first.t) return first.p;
  if (t >= last.t) return last.p;
  let i = 0;
  while (i < n - 2 && t > (keys[i + 1] as GroupKey).t) i++;
  const a = keys[i] as GroupKey;
  const b = keys[i + 1] as GroupKey;
  const h = b.t - a.t;
  if (h <= 0) return b.p;
  const m0 = slopeAt(keys, i);
  const m1 = slopeAt(keys, i + 1);
  const s = (t - a.t) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  const v = (2 * s3 - 3 * s2 + 1) * a.p + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * b.p + (s3 - s2) * h * m1;
  return Math.max(Math.min(a.p, b.p), Math.min(Math.max(a.p, b.p), v));
}

function slopeAt(keys: readonly GroupKey[], i: number): number {
  const sec = (j: number): number => {
    const a = keys[j] as GroupKey;
    const b = keys[j + 1] as GroupKey;
    return (b.p - a.p) / Math.max(1e-6, b.t - a.t);
  };
  const n = keys.length;
  if (i === 0) return sec(0);
  if (i === n - 1) return sec(n - 2);
  const d0 = sec(i - 1);
  const d1 = sec(i);
  if (d0 * d1 <= 0) return 0;
  return (2 * d0 * d1) / (d0 + d1);
}

/** 그 부스·등급의 배당 (defs.ts ODDS). */
export function groupMultiplier(b: GroupBoothId, tier: OutcomeTier): number {
  return (ODDS[b] as Partial<Record<OutcomeTier, readonly [number, number]>>)[tier]?.[1] ?? 0;
}

/** 등급과 세부로 한판 결과 (배당은 ODDS). */
export function groupOutcome(b: GroupBoothId, tier: OutcomeTier, detail: RoundDetail): RoundOutcome {
  return { tier, multiplier: groupMultiplier(b, tier), detail };
}

/** 경주·오리배의 경주 (그 밖·아직 없으면 null). */
export function raceOf(play: GroupPlay | null | undefined): RaceResult | null {
  return play !== null && play !== undefined && (play.kind === 'race' || play.kind === 'boat') ? play.race : null;
}

/** 지금 판 (running·done일 때만, 아니면 null). */
export function livePlay(g: GroupState | null | undefined): GroupPlay | null {
  return g !== null && g !== undefined && (g.phase === 'running' || g.phase === 'done') ? g.play : null;
}

/** 손님 id의 참가 (없으면 undefined). */
export function entryOf(g: GroupState | null | undefined, id: number): GroupEntry | undefined {
  return g?.participants.find((e) => e.monster === id);
}

/** 손님 id의 이번 판 결과 (참가자이고 판이 정해졌으면). */
export function outcomeOf(g: GroupState | null | undefined, id: number): RoundOutcome | undefined {
  const play = livePlay(g);
  if (g === null || g === undefined || play === null) return undefined;
  const i = g.participants.findIndex((e) => e.monster === id);
  return i >= 0 ? play.outcomes[i] : undefined;
}

/** 0~1 사이로. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
