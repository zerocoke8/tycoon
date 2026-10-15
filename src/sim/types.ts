// 시뮬레이션 상태와 이벤트. sim은 화면을 모른다: 상태를 바꾸고 이벤트를 낸다.
// GameState는 그대로 JSON으로 저장된다 (함수·클래스 인스턴스·Map을 넣지 않는다).

import type { Emitter } from '../core/events.ts';
import type { BoothId, BuildingId, GoodId, MaterialId, OutcomeTier, PreciousId, SlotSymbol, SpeciesId, StaffStats, TraitId } from '../data/defs.ts';
import type { DistrictId, NodeId, Pt } from '../data/map.ts';

export type MonsterId = number;
export type StaffId = number;

/** 손님의 지금 할 일. */
export type MonsterPhase =
  | 'arriving' // 입구에서 광장으로
  | 'wandering' // 광장을 걷는다 (다음 할 일을 고른다)
  | 'toBooth' // 부스 앞으로
  | 'queued' // 줄 서 있다
  | 'toSeat' // 자리로
  | 'playing' // 한판 중 (결과를 기다린다)
  | 'reacting' // 결과에 반응 중
  | 'resting' // 분수 옆에서 쉰다
  | 'spectating' // 남의 판을 구경
  | 'leaving'; // 입구로 나간다

/** 몸 그림 (monsters/<species>_<pose>). 애니메이션이 붙으면 같은 이름의 클립을 쓴다. */
export type Pose = 'base' | 'joy' | 'agony' | 'sad';

/** 머리 위 이모트 (fx/emote_<kind>). */
export type EmoteKind = 'heart' | 'sweat' | 'tear' | 'sparkle' | 'storm' | 'note' | 'anger' | 'shock';

/** 코드 연출 (화면 쪽이 트윈으로). */
export type Motion = 'none' | 'hop' | 'bigHop' | 'shake' | 'squash' | 'spin' | 'slump' | 'tremble' | 'bounceLoop';

export interface Monster {
  id: MonsterId;
  species: SpeciesId;
  nickname: string;
  traits: TraitId[];
  wallet: number;
  /** 0~100 */
  mood: number;
  /** 남은 한판 수 (0이면 떠날 생각). */
  patience: number;
  phase: MonsterPhase;
  pos: Pt;
  /** 바라보는 쪽 (그림은 왼쪽을 본다: facing 1 = 오른쪽이면 화면이 좌우로 뒤집는다). */
  facing: -1 | 1;
  /** 따라 걷는 세계 좌표 점들 (앞에서부터). */
  path: Pt[];
  booth: BoothId | null;
  seat: number | null;
  pose: Pose;
  /** 이번 방문 기록. */
  stats: { rounds: number; wins: number; jackpots: number; nearMisses: number; spent: number; won: number };
  /** 남은 시간(초): 반응·쉬기·구경이 끝나는 때. */
  timer: number;
  cheerCooldown: number;
  /** 대박 손님은 떠날 때 귀한 물건을 줄 수 있다. */
  hadJackpot: boolean;
  /** 들고 온 자기 종 특산 재료 수 (복주머니 참가비로 낸다, defs.ts GUEST_MATS). */
  mats: number;
  // ── 아래는 sim이 쓰는 덧붙은 칸 (없어도 된다: 옛 저장·화면 쪽 시험용 손님) ──
  /** 마을에 온 때 (state.time). */
  born?: number;
  /** 첫 한판을 시작한 때 (state.time). 머무는 시간(TUNE.maxVisitSec)은 여기부터 잰다. */
  firstPlay?: number;
  /** 지금 phase가 된 지 몇 초. */
  phaseTime?: number;
  /** 반응 포즈를 보여 주는 남은 초 (0이 되면 pose가 'base'로). */
  poseTime?: number;
  /** 빈털터리가 되어 떠나는 중. */
  broke?: boolean;
  /** 촌장에게 간식을 받았다. */
  snacked?: boolean;
  /** 쉬는 자리 (REST_SPOTS index). */
  spot?: number;
  /** 다시 찾아온 단골. */
  regular?: boolean;
  /** 떠날 때 귀한 물건을 꼭 남긴다 (복주머니 대박). */
  surePrecious?: boolean;
}

/** 다시 찾아올 단골 (빈털터리 때 간식을 받고 웃으며 떠난 손님). */
export interface Regular {
  species: SpeciesId;
  nickname: string;
  traits: TraitId[];
}

export interface Staff {
  id: StaffId;
  name: string;
  /** characters/<art> 그림. */
  art: string;
  stats: StaffStats;
  level: number;
  /** 맡은 자리 (부스와 BOOTHS[booth].roles의 index). null = 쉬는 중. */
  post: StaffPost | null;
}

/** 진행자 자리: 부스 하나의 역할 하나. */
export interface StaffPost {
  booth: BoothId;
  role: number;
}

export interface Candidate {
  name: string;
  art: string;
  stats: StaffStats;
  cost: number;
}

export interface BoothState {
  unlocked: boolean;
  level: number; // 1~3
  pot: number;
  /** 진행자 자리마다 맡은 진행자 (BOOTHS[b].roles와 같은 순서·같은 길이). */
  staff: (StaffId | null)[];
  /** 자리마다 앉은 손님. */
  seats: (MonsterId | null)[];
  queue: MonsterId[];
  /** 자리마다 진행 중인 한판 (없으면 null). */
  rounds: (ActiveRound | null)[];
  /** 걸어 둔 응원 도구와 남은 초. */
  cheer: { good: GoodId; left: number } | null;
  /** 몬스터 경주장의 경주 (다른 부스는 null). */
  race: RaceState | null;
}

/** 경주 선수 번호 = 레인 (0 달팽이·1 거북·2 개구리·3 무당벌레, defs.ts RACE.racers). */
export type RacerIndex = 0 | 1 | 2 | 3;

/** 선수 하나의 진행 키프레임: 출발 뒤 t초에 진행 p (0~1, 1 = 결승선). t는 오름차순, 마지막 키는 결승 시각 (p = 1). */
export interface RaceKey {
  t: number;
  p: number;
}

/** 경주 하나의 결과 (출발할 때 정한다: sim/race.ts generateRace). 화면은 raceProgress(result, 선수, 초)로 자리를 읽는다. */
export interface RaceResult {
  /** 선수마다 키프레임 (선수 번호 순서). 중간 키에서 순위가 몇 번 바뀐다. */
  keys: RaceKey[][];
  /** 들어온 순서 (1등부터 선수 번호). */
  finishOrder: RacerIndex[];
  /** 선수마다 결승에 닿는 초 (선수 번호 순서). */
  finishAt: number[];
  /** 1등이 RACE.comebackAt 지점에서 꼴찌였다 (꼴찌에서 1등 역전: 그 선수에 건 손님은 jackpot). */
  comeback: boolean;
  /** 1·2등 차이가 RACE.photoMargin 초 이하 (사진 판정: 2등에 건 손님은 nearMiss). */
  photoFinish: boolean;
  /** 1·2등 결승 시각 차이 (초). */
  margin: number;
}

/** 경주에 건 손님 하나. */
export interface RaceEntry {
  monster: MonsterId;
  /** 관중석 자리 (BoothState.seats index). */
  seat: number;
  racer: RacerIndex;
  bet: number;
  fee: number;
}

/**
 * 경주장 상태 (BoothState.race). idle → (첫 손님이 관중석에 앉아 선수를 고르면) gathering → (countdown 0) running → (elapsed ≥ duration) done → idle.
 * - gathering: 손님이 앉을 때마다 참가 (참가비는 마을로, 건 코인은 항아리로). 첫 손님부터 RACE.gatherSec, 둘 이상이면 RACE.startSoonSec 안에 출발
 *   (출발 신호의 진행이 높을수록 짧게). 자리 6이 다 차면 곧 출발.
 * - running: 결과(result)를 이때 정한다. 참가자마다 BoothState.rounds[자리]에 한판(outcome = raceOutcome(result, 선수))이 생기고 roundStarted가 난다.
 *   1등이 바뀌면 raceProgress (참가자 응원 반응 포함).
 * - done: 모든 선수가 들어왔다. 참가자마다 roundFinished·monsterReact가 한꺼번에, 경주로 근처 손님은 monsterSpectate. countdown(RACE.resultSec) 뒤 idle.
 * running·done 동안 새로 앉은 손님은 다음 경주를 기다린다 (phase 'playing', 참가자 목록에 없음).
 * 손님마다의 등급은 sim/race.ts raceOutcome(result, racer).
 */
export interface RaceState {
  phase: 'idle' | 'gathering' | 'running' | 'done';
  /** gathering: 출발까지 남은 초. done: 다음 경주를 받을 때까지 남은 초. */
  countdown: number;
  /** gathering: 첫 손님이 참가하고 지난 초. running: 출발 뒤 지난 초. */
  elapsed: number;
  /** running: 경주 시간 (마지막 선수가 들어오고 조금 뒤). */
  duration: number;
  participants: RaceEntry[];
  /** running·done: 이번 경주. */
  result: RaceResult | null;
  /** running: 마지막으로 알린 1등 선수 (raceProgress, 없으면 아직 안 알림). */
  leader?: RacerIndex | null;
  /** running: 마지막 raceProgress를 낸 때 (elapsed). */
  cheerAt?: number;
}

/** 경주 중 참가자 하나의 응원 반응 (raceProgress.cheers): lead = 자기 선수가 1등으로, behind = 1등을 뺏기거나 꼴찌. */
export interface RaceCheer {
  id: MonsterId;
  racer: RacerIndex;
  /** 지금 등수 (1~4). */
  place: number;
  kind: 'lead' | 'behind';
  reaction: Reaction;
}

export interface ActiveRound {
  monster: MonsterId;
  bet: number;
  fee: number;
  /** 결과는 시작할 때 정한다 (화면이 연출을 미리 안다). */
  outcome: RoundOutcome;
  elapsed: number;
  duration: number;
}

/** 부스별 결과 세부 (연출용). */
export type RoundDetail =
  | { kind: 'slot'; reels: [SlotSymbol, SlotSymbol, SlotSymbol] }
  | { kind: 'oddeven'; pebbles: number; guess: 'odd' | 'even' }
  | { kind: 'cups'; ballAt: 0 | 1 | 2; picked: 0 | 1 | 2; swaps: [number, number][] }
  | { kind: 'darts'; /** 과녁 중심에서의 거리 0~1 (1 = 테두리 밖), 각도 rad. */ dist: number; angle: number }
  /** 돌림판: 찜한 칸·멈춘 칸 0~5 (칸 i = SLOT_SYMBOLS[i], 5 = 종), 바퀴 수 3~5. nearMiss는 멈춘 칸이 찜한 칸 바로 옆 (±1). */
  | { kind: 'wheel'; picked: number; landed: number; turns: number }
  /** 오리 낚시: 낚은 오리 0~4와 바닥 표식. slipped = 걸었다가 놓침 (nearMiss, 놓친 오리의 표식은 금·은). */
  | { kind: 'duck'; duck: number; mark: DuckMark; slipped: boolean }
  /** 고리 던지기: 세 번 (병 0~8 = 3×3, 걸림, 병목을 돌며 흔들림). nearMiss = 하나 걸고 마지막 고리가 흔들리다 떨어짐. */
  | { kind: 'ring'; throws: RingThrow[] }
  /**
   * 인형 뽑기: x = 집게 가로 자리 0~1, target = 노린 인형 (objects/plush_<종>), target2 = 대박 때 같이 딸려 온 인형 (그 밖에는 null).
   * result: miss = 헛집기(lose), slip = 들어 올렸다가 slipAt(0~1, 구멍까지 간 비율)에서 떨어뜨림(nearMiss), win = 하나, double = 둘(jackpot).
   */
  | { kind: 'claw'; x: number; target: SpeciesId; target2: SpeciesId | null; result: ClawResult; slipAt: number }
  /** 복주머니: 고른 주머니 0~2 (빨강·파랑·노랑) 와 속. jackpot은 늘 노랑(2). */
  | { kind: 'pouch'; pick: number; content: PouchContent }
  /** 경주: 이 손님이 건 선수와 등수 (1~4), 경주의 역전·사진 판정. 경주 자체는 BoothState.race.result. */
  | { kind: 'race'; racer: RacerIndex; place: number; comeback: boolean; photoFinish: boolean };

export type DuckMark = 'gold' | 'silver' | 'none';
export interface RingThrow {
  bottle: number;
  hit: boolean;
  wobble: boolean;
}
export type ClawResult = 'miss' | 'slip' | 'win' | 'double';
export type PouchContent = 'jackpot' | 'coins' | 'one' | 'empty';

export interface RoundOutcome {
  tier: OutcomeTier;
  /** 건 코인의 몇 배를 받나 (건 코인 포함, 0이면 잃음). */
  multiplier: number;
  detail: RoundDetail;
}

export interface CraftJob {
  out: GoodId;
  left: number;
  total: number;
}

export interface GameState {
  version: 2;
  /** 시뮬레이션 누적 초. */
  time: number;
  rng: number;
  nextId: number;
  coins: number;
  materials: Record<MaterialId, number>;
  precious: Record<PreciousId, number>;
  goods: Record<GoodId, number>;
  buildings: Record<BuildingId, { level: number }>;
  booths: Record<BoothId, BoothState>;
  staff: Staff[];
  candidates: Candidate[];
  /** 다음 후보 새로고침까지 초. */
  candidateRefresh: number;
  monsters: Monster[];
  spawnTimer: number;
  crafting: CraftJob[];
  /** 도감: 종마다 온 횟수, 본 반응, 인형 뽑기로 모은 인형 수 (plush, 없으면 0). */
  dex: Partial<Record<SpeciesId, DexEntry>>;
  totals: { visitors: number; rounds: number; jackpots: number; coinsEarned: number };
  /** 열린 구역. */
  districts: DistrictId[];
  savedAt: number;
  /** 다시 찾아올 단골 (덧붙은 칸, 없으면 빈 목록). */
  regulars?: Regular[];
}

export interface DexEntry {
  visits: number;
  reactions: string[];
  /** 인형 뽑기로 모은 이 종의 인형 수. */
  plush?: number;
}

/** 반응 묶음 (sim이 고르고 화면이 보여 준다). */
export interface Reaction {
  pose: Pose;
  emote: EmoteKind | null;
  motion: Motion;
  /** 1 = 보통, 클수록 크게 (성격·응원 도구). */
  intensity: number;
  /** 반응을 보여 주는 초. */
  duration: number;
  /** 도감에 남는 반응 이름 (예: '대박 만세', '아깝다!', '털썩'). */
  label: string;
}

/** sim → 화면/UI 이벤트. */
export interface SimEvents extends Record<string, unknown> {
  monsterSpawned: { id: MonsterId };
  monsterLeft: { id: MonsterId; tip: number; material: MaterialId | null; precious: PreciousId | null };
  monsterReact: { id: MonsterId; reaction: Reaction };
  /** 구경꾼이 다른 손님의 결과에 따라 반응. */
  monsterSpectate: { id: MonsterId; target: MonsterId; reaction: Reaction };
  monsterCheered: { id: MonsterId; by: 'tap' | GoodId };
  roundStarted: { booth: BoothId; seat: number; round: ActiveRound };
  roundFinished: { booth: BoothId; seat: number; round: ActiveRound; payout: number };
  potFestival: { booth: BoothId; monster: MonsterId; amount: number };
  /**
   * 경주장: 출발(race.phase = 'running', result가 정해지고 참가자마다 BoothState.rounds[자리]가 열린 뒤, 그다음 참가자마다 roundStarted)과 끝(모든 선수 결승, race.phase = 'done',
   * 그다음 참가자마다 roundFinished·monsterReact, 경주로 근처 구경꾼 monsterSpectate). race는 상태 그 자체 (복사본 아님).
   */
  raceStarted: { booth: BoothId; race: RaceState };
  raceFinished: { booth: BoothId; race: RaceState };
  /** 손님이 관중석에 앉아 선수를 골랐다 (gathering에 참가). */
  raceJoined: { booth: BoothId; monster: MonsterId; seat: number; racer: RacerIndex; bet: number };
  /**
   * 경주 중 1등이 바뀌었다 (너무 잦지 않게 TUNE.raceCheerGapSec 간격). standings = 지금 순위 (앞선 선수부터).
   * cheers = 참가자 응원 반응 (sim이 손님 pose도 잠깐 바꾼다). 화면은 monsterSpectate처럼 작게 보여 주면 된다.
   */
  raceProgress: { booth: BoothId; race: RaceState; elapsed: number; standings: RacerIndex[]; leader: RacerIndex; cheers: RaceCheer[] };
  coinsChanged: { coins: number; delta: number; at: Pt | null };
  itemsChanged: Record<string, never>;
  buildingUpgraded: { id: BuildingId | BoothId; level: number };
  boothUnlocked: { booth: BoothId };
  districtOpened: { district: DistrictId };
  staffChanged: Record<string, never>;
  craftDone: { good: GoodId };
  toast: { text: string; kind: 'info' | 'good' | 'warn' };
}

export type SimBus = Emitter<SimEvents>;

/** 길 그래프 노드 이름 (data/map.ts)과 좌표를 함께 쓸 때. */
export type { NodeId };
