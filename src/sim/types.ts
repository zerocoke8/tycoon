// 시뮬레이션 상태와 이벤트. sim은 화면을 모른다: 상태를 바꾸고 이벤트를 낸다.
// GameState는 그대로 JSON으로 저장된다 (함수·클래스 인스턴스·Map을 넣지 않는다).

import type { Emitter } from '../core/events.ts';
import type { AccessoryId, AccessorySlot, BoothId, BuildingId, GoodId, GroupBoothId, MaterialId, OutcomeTier, PreciousId, SlotSymbol, SpeciesId, StaffStats, TraitId, WorkFacility } from '../data/defs.ts';
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
  | 'leaving' // 입구로 나간다
  // ── 넷째 묶음 (DESIGN 3.7): 볼일(Monster.errand)은 전당포·은행, 파산한 손님(Monster.bankrupt)은 일터 ──
  | 'toPawnshop' // 전당포로 (맡기기·되찾기)
  | 'atPawnshop' // 전당포 계산대 앞 (timer초 뒤 볼일이 끝난다)
  | 'toBank' // 은행으로 (빌리기·갚기)
  | 'atBank' // 은행 계산대 앞
  | 'toWork' // 파산: 일터로 (느린 걸음). 닿으면 working 또는 waitWork
  | 'working' // 일터에서 일한다 (빚이 줄고 재료가 나온다, Monster.labor)
  | 'waitWork' // 일터 자리가 없어 옆에 쪼그리고 기다린다
  | 'relieved'; // 빚을 다 갚았다: 어둠이 걷히고 기뻐한 뒤 (timer초) 떠난다

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
  // ── 넷째 묶음 (DESIGN 3.7): 장신구·전당포·은행·파산·일터 ──
  /** 몸에 단 장신구 (자리마다 하나, 맡기면 빠지고 되찾으면 다시). */
  accessories: Accessory[];
  /** 이번 방문에 전당포에 맡긴 장신구 (못 찾고 떠나면 전당포 컬렉션으로). */
  pawned: PawnTicket[];
  /** 갚을 빚 (은행 대출 × BANK.interest, 파산하면 일터에서 갚는 남은 빚). 0 = 빚 없음. */
  debt: number;
  /** 이번 방문에 은행에서 빌린 횟수. */
  loans?: number;
  /** 지금 가는·보는 볼일 (toPawnshop·atPawnshop·toBank·atBank). */
  errand?: Errand | null;
  /** 볼일이 끝나면 집에 간다 (떠나기 전에 되찾기·갚기). */
  homeward?: boolean;
  /** 볼일 자리 (SHOP_SPOTS[가게].counter index). */
  counter?: number;
  /** 파산해서 일터에서 빚을 갚는 중 (어두운 필터, 축 처진 슬픈 모습, 느린 걸음). 다 갚으면 false. */
  bankrupt?: boolean;
  /** 일터의 일 (파산한 손님만). */
  labor?: LaborState | null;
  /** 이번 방문에 파산한 적이 있다 (다 갚은 뒤에도 남는다: '다시 일어선 손님'). */
  wasBankrupt?: boolean;
  /**
   * 돈이 떨어졌을 때 더 놀고 싶은지 물어 '싫다'고 한 단계 (low = 거의 다 잃었을 때, broke = 정말 못 놀 때: sim/debt.ts wantMore).
   * 그 단계에서는 다시 묻지 않는다. 맡기거나 빌리면, 지갑이 다시 넉넉해지면 지운다.
   */
  declined?: 'low' | 'broke' | null;
  /** 빚을 갚으려고 끈기가 다 된 뒤에 더 한 판 수 (BANK.chase.max까지, 마음을 접으면 max). */
  chased?: number;
}

/** 몸에 단 장신구 하나 (defs.ts ACCESSORIES). value = 전당포가 쳐 주는 값 (손님이 올 때 정한다). */
export interface Accessory {
  key: AccessoryId;
  slot: AccessorySlot;
  value: number;
}

/** 이번 방문에 전당포에 맡긴 장신구. price = 빌린 코인 (되찾는 값 = price × PAWN.redeemMarkup, sim/debt.ts redeemCost). */
export interface PawnTicket {
  key: AccessoryId;
  slot: AccessorySlot;
  value: number;
  price: number;
}

/** 전당포·은행 볼일: 맡기기, 되찾기, 빌리기, 갚기. */
export type Errand = 'pawn' | 'redeem' | 'loan' | 'repay';

/**
 * 파산한 손님의 일 (Monster.labor). facility·spot = 일하는 자리 (map.ts WORK_YARD.facilities[facility].spots index, -1 = 자리가 없어 기다림),
 * wait = 기다리는 자리 (wait index, 일하는 중이면 -1).
 */
export interface LaborState {
  facility: WorkFacility;
  spot: number;
  wait: number;
  /** 지금 갚는 중인 1코인의 진행 (0~1). */
  progress: number;
  /** 다음 재료까지 갚은 코인 (LABOR.coinsPerMat이 되면 재료 하나). */
  made: number;
  /** 게이지 분모: 파산했을 때의 빚 (빚 걸기 판에서 빚이 늘면 그 값으로). 게이지 = 1 - debt / total. */
  total: number;
  /** 응원·간식으로 빨라진 남은 초와 배수. */
  boostSec: number;
  boostMult: number;
  /** 빚 걸기 판에 불려 가는 중·하는 중 (그 부스, 아니면 null). */
  match: GroupBoothId | null;
  /** 파산한 때 (state.time). LABOR.forgiveSec가 지나면 반장이 남은 빚을 덜어 준다. 옛 저장은 없다 (불러온 때부터). */
  since?: number;
  /** 이번 파산에 한 빚 걸기 판 수 (DEBT_MATCH.maxPerStint까지). */
  matches?: number;
}

/** 다시 찾아올 단골 (빈털터리 때 간식을 받고 웃으며 떠난 손님). */
export interface Regular {
  species: SpeciesId;
  nickname: string;
  traits: TraitId[];
  /** 파산했다가 빚을 다 갚고 떠난 손님 ('다시 일어선 단골'). */
  recovered?: boolean;
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
  /** 단체 놀이 부스(경주장·씨름장·오리배·연날리기·줄다리기·보물찾기, defs.ts GROUP_BOOTHS)의 한 판 (다른 부스는 null). */
  group: GroupState | null;
}

/** 경주 선수 번호 = 레인 (0 달팽이·1 거북·2 개구리·3 무당벌레, defs.ts RACE.racers). 오리배도 배 번호 0~3 (defs.ts BOAT.boats). */
export type RacerIndex = 0 | 1 | 2 | 3;

/**
 * 키프레임 하나: 판이 시작하고 t초에 값 p (뜻은 놀이마다, GroupPlay 주석). t는 오름차순.
 * 키 사이 값은 sim/group/core.ts trackAt(keys, t) (넘치지 않는 3차 보간: 키 사이에서 두 키 값 밖으로 나가지 않는다).
 */
export interface GroupKey {
  t: number;
  p: number;
}

/** 선수 하나의 진행 키프레임: 출발 뒤 t초에 진행 p (0~1, 1 = 결승선). t는 오름차순, 마지막 키는 결승 시각 (p = 1). */
export type RaceKey = GroupKey;

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

/** 편 (씨름·줄다리기): 0 = 홍, 1 = 청. */
export type GroupSide = 0 | 1;

/** 단체 놀이 안의 역할: player = 직접 겨루는·날리는·파는 손님 (자기에게 건다), bettor = 구경하며 거는 손님 (경주·오리배는 모두 bettor). */
export type GroupRole = 'player' | 'bettor';

/**
 * 단체 놀이에 참가한 손님 하나. pick = 고른 것 (놀이마다):
 *   race·boat = 선수·배 0~3, ssireum = 편 0 홍·1 청 (선수는 자기 편: 자리 0 = 홍, 1 = 청), tug = 편 0 홍·1 청 (자리 짝수 = 홍, 홀수 = 청),
 *   kite = 연 0~3 (날리는 손님은 자기 연 = 자리 0~3), dig = 판 자리 0~5 (= 자리, map.ts DIG_FIELD.spots).
 * 어느 자리에 앉을지는 놀이 모듈 GroupGame.seatFor가 고른다 (씨름 선수·구경, 연 날리기·구경, 줄다리기 편 맞추기, 보물찾기 판 자리).
 */
export interface GroupEntry {
  monster: MonsterId;
  /** 앉은 자리 (BoothState.seats index). */
  seat: number;
  pick: number;
  role: GroupRole;
  bet: number;
  fee: number;
  /** 빚 걸기 판의 채무자 선수: 판을 시작할 때 건 자기 빚 (참가비·건 코인은 0). 보통 판은 없다. */
  debt?: number;
}

/**
 * 타임라인의 사건 종류 (시각 순서, 생성기가 정한다. 경주·오리배의 'lead'는 sim이 달리는 중에 순위를 보고 낸다).
 * sim은 사건 시각이 되면 groupEvent를 낸다 (참가자 응원 반응 포함). 화면은 타임라인(play.events)을 직접 읽어도 되고 이벤트를 들어도 된다.
 *   lead   = 앞선 쪽이 바뀌었다. 경주·오리배: actor = 이제 1등, prev = 앞서던 선수(-1 = 처음), order = 그때 순위. 씨름·줄다리기: actor = 이제 앞선 편.
 *   brink  = 한쪽이 질 뻔했다 (씨름 모래판 끝, 줄다리기 선 바로 앞, 연이 끊길 뻔함). actor = 위태로운 편·연.
 *   flip   = 뒤집기·역전 시작 (씨름·줄다리기 jackpot 판에서 위태롭던 편이 되민다). actor = 뒤집는 편.
 *   tangle = 연싸움: 연 둘의 줄이 엇갈렸다. actor·other = 두 연.
 *   cut    = 연줄이 끊어졌다. actor = 끊긴 연, other = 끊은 연.
 *   dig    = 보물찾기: 한 자리에서 삽질을 시작했다. actor = 판 자리.
 *   find   = 보물찾기: 무언가 튀어 올랐다. actor = 판 자리, value = DIG_FINDS index (defs.ts).
 *   reveal = 보물찾기: 아무도 못 찾은 상자를 할아버지가 파서 보여 준다. actor = 상자 자리 (map.ts DIG_FIELD.chests index).
 *   finish = 승부가 났다 (씨름 넘어뜨리기, 줄다리기 선 넘음, 마지막 연). actor = 이긴 편·연.
 */
export type GroupEventType = 'lead' | 'brink' | 'flip' | 'tangle' | 'cut' | 'dig' | 'find' | 'reveal' | 'finish';

export interface GroupEvent {
  t: number;
  type: GroupEventType;
  actor: number;
  other?: number;
  value?: number;
  prev?: number;
  order?: number[];
}

/** 보물찾기에서 나온 것: chest = 보물상자 (jackpot), coins·gem = 작은 보물 (win), boot·pebble = 헌 장화·조약돌 (lose·nearMiss), none = 아무도 안 판 자리. */
export type DigFind = 'none' | 'chest' | 'coins' | 'gem' | 'boot' | 'pebble';

interface GroupPlayBase {
  /** 판 길이 (초) = GroupState.duration. 이때 결과가 난다. */
  end: number;
  /** 움직이는 것마다 키프레임 (뜻은 놀이마다, 아래). sim/group/core.ts trackAt(play.tracks[i], t). */
  tracks: GroupKey[][];
  /** 사건 (시각 순서). */
  events: GroupEvent[];
  /** 참가자마다 결과 (출발한 참가자 GroupState.participants와 같은 순서·같은 길이). */
  outcomes: RoundOutcome[];
}

/**
 * 단체 놀이 한 판 (출발할 때 생성기 sim/group/<booth>.ts가 다 정한다. 화면은 이것을 그대로 재생한다).
 * kind마다 tracks의 뜻:
 *   race·boat: tracks[선수] = 진행 0~1 (= race.keys, 읽기는 sim/race.ts raceProgress(race, 선수, t)).
 *   ssireum: tracks[0] = 미는 힘 p (-1~1, +1 = 홍이 청을 넘어뜨림, -1 = 청이 이김). throwAt에 ±1.
 *   tug: tracks[0] = 밧줄 가운데 c (-1~1, +1 = 홍 쪽 선까지 끌려감 = 홍 승리, -1 = 청 승리). crossAt에 ±1.
 *   kite: tracks[2k] = 연 k의 높이 (0 = 낮게 뜬 높이 KITE_FIELD.skyLow, 1 = 가장 높이 skyHigh: 화면은 손에서 연줄로 잇는다), tracks[2k + 1] = 연 k의 좌우 (-1~1, 자기 자리 위가 0). 끊긴 뒤의 키는 없다 (화면이 날려 보낸다).
 *   dig: tracks[자리] = 판 깊이 (0~1, findAt에 1). 아무도 안 판 자리는 빈 목록.
 */
export type GroupPlay = GroupPlayBase &
  (
    | { kind: 'race'; race: RaceResult }
    | { kind: 'boat'; race: RaceResult }
    | {
        kind: 'ssireum';
        /** 이긴 편. */
        winner: GroupSide;
        /** 뒤집기: 이긴 편이 막판에 거의 질 뻔하다 뒤집었다 (이긴 편에 건 손님 jackpot). */
        flip: boolean;
        /** 진 편이 끝나기 직전까지 이기고 있었다 (진 편에 건 손님 nearMiss). */
        close: boolean;
        /** 넘어뜨린 때 (초). */
        throwAt: number;
      }
    | {
        kind: 'tug';
        winner: GroupSide;
        /** 역전승: 이긴 편이 거의 지다가 뒤집었다 (jackpot). */
        comeback: boolean;
        /** 진 편이 마지막 20% 시간까지 이기고 있었다 (nearMiss). */
        close: boolean;
        /** 밧줄 가운데가 한 편 선을 넘은 때 (초). */
        crossAt: number;
        /** 편마다 줄을 잡은 손님 수 (홍, 청). */
        sizes: [number, number];
      }
    | {
        kind: 'kite';
        /** 끊긴 순서 (먼저 끊긴 연부터, 마지막 = 이긴 연). 길이 = 연 수 (KITE.kites). */
        order: number[];
        /** 연마다 끊긴 초 (이긴 연은 -1). */
        cutAt: number[];
        /** 이긴 연이 끊길 뻔했다 (그 연에 건 손님 jackpot). */
        close: boolean;
        /** 마지막에서 두 번째 연이 끝나기 직전에 끊겼다 (그 연에 건 손님 nearMiss). */
        late: boolean;
      }
    | {
        kind: 'dig';
        /** 판 자리마다 나온 것 (DIG_FIELD.spots 순서). */
        finds: DigFind[];
        /** 판 자리마다 무언가 튀어 오르는 때 (초, 아무도 안 판 자리는 -1). */
        findAt: number[];
        /** 상자가 묻힌 곳 (DIG_FIELD.chests index, -1 = 이번 판엔 상자가 없다). 앞 여섯은 판 자리와 같은 곳. */
        chest: number;
        /** 손님이 상자를 찾았다 (아니면 끝에 할아버지가 파서 보여 준다: 'reveal'). */
        found: boolean;
      }
  );

export type GroupKind = GroupPlay['kind'];
export type GroupPhase = 'idle' | 'gathering' | 'running' | 'done';

/**
 * 단체 놀이 상태 (BoothState.group). idle → (첫 손님이 자리에 앉아 고르면) gathering → (countdown 0, 출발 조건) running → (elapsed ≥ duration) done → idle.
 * - gathering: 손님이 앉을 때마다 참가 (참가비는 마을로, 건 코인은 항아리로). 첫 손님부터 GROUP_RULES.gatherSec, 출발 조건이 '곧'이면 startSoonSec 안에
 *   (진행 능력치가 높을수록 짧게). 자리가 다 차면 곧 출발. 모이는 중에 자리를 뜨면 건 코인을 돌려받는다.
 * - running: 판(play)을 이때 정한다. 참가자마다 BoothState.rounds[자리]에 한판(outcome = play.outcomes[i])이 생기고 roundStarted가 난다.
 *   사건마다 groupEvent (참가자 응원 반응 포함).
 * - done: 끝났다. 참가자마다 roundFinished·monsterReact가 한꺼번에, 근처 손님은 monsterSpectate. countdown(GROUP_RULES.resultSec) 뒤 idle.
 * running·done 동안 새로 앉은 손님은 다음 판을 기다린다 (phase 'playing', 참가자 목록에 없음).
 */
export interface GroupState {
  phase: GroupPhase;
  /** gathering: 출발까지 남은 초. done: 다음 판을 받을 때까지 남은 초. */
  countdown: number;
  /** gathering: 첫 손님이 참가하고 지난 초. running: 시작 뒤 지난 초. */
  elapsed: number;
  /** running: 판 길이 (= play.end). */
  duration: number;
  participants: GroupEntry[];
  /** running·done: 이번 판. */
  play: GroupPlay | null;
  /** running: 마지막으로 알린 사건의 주인공 (경주의 1등, 처음엔 null). */
  mark?: number | null;
  /** running: 마지막 사건을 알린 때 (elapsed). */
  markAt?: number;
  /** running: 다음에 알릴 타임라인 사건 (play.events index). */
  cursor?: number;
  /** 편 맞추기(줄다리기 lineup)로 판에서 빠져 참가비를 이미 낸 손님: 다음 참가 때 참가비를 다시 받지 않는다. */
  prepaid?: MonsterId[];
  /**
   * 빚 걸기 판 (DESIGN 3.7, 줄다리기·밀어내기): 반장이 일터의 채무자를 불러 연 판. debtors = 불린 채무자 (자리 순서: debtors[i]는 자리 i).
   * 채무자는 코인 대신 자기 빚을 걸고 (GroupEntry.debt), 구경 손님은 평소처럼 코인을 건다. 판이 끝나거나 접히면 지운다.
   */
  mode?: 'debt';
  debtors?: MonsterId[];
  /** 반장이 다음 판을 빚 걸기 판으로 예약했다 (지금 판이 끝나면 선수 자리를 비워 두었다가 연다, sim.ts tickDebtMatches). */
  debtNext?: boolean;
}

/**
 * 진행 중 사건에 근처 구경꾼(참가하지 않은 손님)이 들썩이는 모양 (GroupGame.buzz → monsterSpectate):
 * wow = 뒤집기·역전·보물상자 (환호), gasp = 질 뻔함·연싸움·끊김 (어머나), cheer = 앞선 쪽이 바뀜·작은 보물 (박수), laugh = 헌 장화 (킥킥).
 */
export type GroupBuzz = 'wow' | 'gasp' | 'cheer' | 'laugh';

/** 단체 놀이 사건 때 참가자 하나의 응원 반응 (groupEvent.cheers): lead = 자기 쪽이 앞서거나 좋은 일, behind = 뒤처지거나 위태로움. */
export interface GroupCheer {
  id: MonsterId;
  pick: number;
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
  /** 경주: 이 손님이 건 선수와 등수 (1~4), 경주의 역전·사진 판정. 경주 자체는 BoothState.group.play (kind 'race', play.race). */
  | { kind: 'race'; racer: RacerIndex; place: number; comeback: boolean; photoFinish: boolean }
  /** 오리배 경주: 경주와 같은 모양 (racer = 배 0~3, defs.ts BOAT.boats). */
  | { kind: 'boat'; racer: RacerIndex; place: number; comeback: boolean; photoFinish: boolean }
  /** 씨름: 이 손님의 편·역할 (player = 직접 겨룬 선수), 이겼나, 뒤집기(jackpot)·막판 역전당함(nearMiss). */
  | { kind: 'ssireum'; side: GroupSide; role: GroupRole; won: boolean; flip: boolean; close: boolean }
  /** 줄다리기: 이 손님의 편, 이겼나, 역전승(jackpot)·막판 역전당함(nearMiss). */
  | { kind: 'tug'; side: GroupSide; won: boolean; comeback: boolean; close: boolean }
  /** 연날리기: 이 손님의 연 0~3·역할, 등수 (1 = 마지막까지 남음), 끊긴 초 (-1 = 안 끊김). */
  | { kind: 'kite'; kite: number; role: GroupRole; place: number; cutAt: number }
  /** 보물찾기: 판 자리 0~5, 나온 것, 상자가 바로 옆에 묻혀 있었다 (nearMiss). */
  | { kind: 'dig'; spot: number; find: DigFind; chestNear: boolean };

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
  version: 4;
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
  /** 전당포 컬렉션: 못 찾고 떠난 장신구 종류마다 개수 (도감처럼, 처음 들어온 것은 알림). */
  pawnCollection: Partial<Record<AccessoryId, number>>;
  /** 넷째 묶음 누적 기록 (UI·시험용). */
  debtTotals: DebtTotals;
  /** 빚 걸기 판: 부스마다 마지막으로 연 때 (state.time), 다음 확인까지 초. */
  debtMatchAt: Partial<Record<GroupBoothId, number>>;
  debtCheck: number;
  /** 일터 반장이 다음에 채무자를 다독일 때까지 초 (LABOR.foreman.everySec, 없으면 그 값으로 시작). */
  foremanTimer?: number;
}

/** 넷째 묶음 누적 기록: 맡김·되찾음·못 찾음(컬렉션), 대출·갚음, 파산·다 갚음 (그 가운데 반장이 덜어 줌), 빚 걸기 판, 일터에서 나온 재료. */
export interface DebtTotals {
  pawned: number;
  redeemed: number;
  forfeited: number;
  loans: number;
  repaid: number;
  bankrupt: number;
  relieved: number;
  forgiven: number;
  matches: number;
  laborMats: number;
  /** 시설마다 일터에서 나온 재료 수 (laborMats를 나눈 것, 옛 저장은 0부터). */
  laborBy: Record<WorkFacility, number>;
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
  /**
   * 구경꾼이 다른 손님의 결과에 따라 반응. 단체 놀이는 결과 뒤(groupFinished 다음)와 진행 중 큰 사건(groupEvent 다음, buzz)에
   * 놀이 근처 손님(참가하지 않은 손님, 자리에서 다음 판을 기다리는 손님 포함)이. target = 그 판·사건의 주인공 참가자.
   */
  monsterSpectate: { id: MonsterId; target: MonsterId; reaction: Reaction };
  monsterCheered: { id: MonsterId; by: 'tap' | GoodId };
  roundStarted: { booth: BoothId; seat: number; round: ActiveRound };
  roundFinished: { booth: BoothId; seat: number; round: ActiveRound; payout: number };
  potFestival: { booth: BoothId; monster: MonsterId; amount: number };
  /** 단체 놀이: 손님이 자리에 앉아 고르고 걸었다 (gathering에 참가). */
  groupJoined: { booth: GroupBoothId; monster: MonsterId; seat: number; pick: number; role: GroupRole; bet: number };
  /**
   * 단체 놀이 시작 (group.phase = 'running', play가 정해지고 참가자마다 BoothState.rounds[자리]가 열린 뒤. 그다음 참가자마다 roundStarted).
   * group은 상태 그 자체 (복사본 아님).
   */
  groupStarted: { booth: GroupBoothId; group: GroupState };
  /**
   * 진행 중 사건 (경주 1등 바뀜, 씨름 뒤집기, 연줄 끊김, 보물 나옴 …, 너무 잦지 않게). cheers = 참가자 응원 반응 (sim이 손님 pose도 잠깐 바꾼다).
   * 화면은 monsterSpectate처럼 작게 보여 주면 된다.
   */
  groupEvent: { booth: GroupBoothId; group: GroupState; event: GroupEvent; cheers: GroupCheer[] };
  /** 단체 놀이 끝 (group.phase = 'done'). 그다음 참가자마다 roundFinished·monsterReact, 근처 구경꾼 monsterSpectate. */
  groupFinished: { booth: GroupBoothId; group: GroupState };
  /** 모이던 판을 접었다 (closed = 꼭 있어야 하는 진행자가 빠짐, timeout = 출발 조건이 안 맞은 채 오래 기다림). 건 코인은 돌려준다. */
  groupCancelled: { booth: GroupBoothId; reason: 'closed' | 'timeout' };
  coinsChanged: { coins: number; delta: number; at: Pt | null };
  itemsChanged: Record<string, never>;
  buildingUpgraded: { id: BuildingId | BoothId; level: number };
  boothUnlocked: { booth: BoothId };
  districtOpened: { district: DistrictId };
  staffChanged: Record<string, never>;
  craftDone: { good: GoodId };
  /** topic 'debt' = 파산·다 갚음처럼 큰 마을에서 자주 오는 넷째 묶음 알림 (UI가 몰아 오면 건너뛴다). */
  /** topic 'debt' = 빚 알림 (UI가 자주 띄우지 않는다), booth = 그 부스 이야기 (그 부스 패널이 열려 있으면 건너뛴다: 판에 다 보인다). */
  toast: { text: string; kind: 'info' | 'good' | 'warn'; topic?: 'debt'; booth?: BoothId };
  // ── 넷째 묶음 (DESIGN 3.7) ──
  /** 장신구를 전당포에 맡기고 코인을 빌렸다 (장신구는 몸에서 빠져 진열장으로). at = 전당포 계산대. */
  pawned: { id: MonsterId; key: AccessoryId; price: number; at: Pt };
  /** 맡긴 장신구를 되찾았다 (다시 몸에, 기쁨 반응은 monsterReact로). */
  redeemed: { id: MonsterId; key: AccessoryId; cost: number; at: Pt };
  /** 못 찾고 떠난 장신구가 전당포 컬렉션에 들어왔다 (first = 그 종류가 처음). */
  pawnCollected: { key: AccessoryId; count: number; first: boolean; from: MonsterId };
  /** 더 놀고 싶은 손님이 빌리려 했지만 마을 금고가 모자랐다 (VAULT, 그 손님은 이 단계에서는 다시 오지 않는다). 토스트는 가끔만 (VAULT.emptyToastSec). */
  vaultEmpty: { id: MonsterId; errand: 'pawn' | 'loan' };
  /** 은행에서 빌렸다 (debt = 갚을 돈 전체). */
  loanTaken: { id: MonsterId; amount: number; debt: number; at: Pt };
  /** 은행 빚을 다 갚았다. */
  loanRepaid: { id: MonsterId; amount: number; at: Pt };
  /** 떠날 때 빚을 못 갚아 파산했다 (지갑을 다 내고 남은 빚 debt를 일터에서 갚는다). 어두운 모습으로. */
  bankrupt: { id: MonsterId; debt: number; paid: number };
  /** 일하는 채무자가 빚 1코인을 갚았다 (debt = 남은 빚, total = 게이지 분모, at = 일하는 자리). 연장질 한 번·'-1' 같은 작은 연출용. */
  laborTick: { id: MonsterId; facility: WorkFacility; debt: number; total: number; at: Pt };
  /** 일터에서 일해 재료가 나왔다 (at = 일하는 자리, coinsPerMat코인마다). 그 손님의 한숨·영차 반응은 monsterReact로 같이 난다. */
  laborOutput: { id: MonsterId; facility: WorkFacility; material: MaterialId; at: Pt; stored: boolean };
  /** 반장이 일하는 채무자를 다독였다 (LABOR.foreman: 잠깐 빨라짐). 반장 통통·하트 연출용. */
  foremanCheer: { id: MonsterId; facility: WorkFacility };
  /**
   * 빚을 다 갚았다 (= 풀려남): reliefSec 동안 어둠이 걷히고 기뻐한다 ('빚 다 갚았다!'), 그 뒤 떠나 단골이 된다.
   * forgiven = 오래 일해서 반장이 남은 빚을 덜어 줬다 (LABOR.forgiveSec), 빚 걸기 판 대박으로 빚이 사라진 것은 false.
   */
  debtCleared: { id: MonsterId; forgiven: boolean };
  /** 반장이 빚 걸기 판을 열었다 (채무자들이 부스로 간다, 자리 순서: debtors[i] = 자리 i). */
  debtMatchCalled: { booth: GroupBoothId; debtors: MonsterId[] };
  /**
   * 빚 걸기 판의 빚 정산 (groupFinished·roundFinished 다음, 채무자 반응은 그 roundFinished의 monsterReact). before·after = 판 전후의 빚,
   * opponent = 짝 상대 (밀어내기 = 상대 선수, 줄다리기 = 짝지은 상대 편 선수), result = halved (이겨서 반) · cleared (대박으로 0) · added (져서 상대 빚만큼 더).
   */
  debtSettled: { booth: GroupBoothId; changes: DebtChange[] };
}

/** 빚 걸기 판에서 채무자 하나의 빚 변화 (SimEvents.debtSettled). */
export interface DebtChange {
  id: MonsterId;
  before: number;
  after: number;
  tier: OutcomeTier;
  opponent: MonsterId | null;
  result: 'halved' | 'cleared' | 'added';
}

export type SimBus = Emitter<SimEvents>;

/** 길 그래프 노드 이름 (data/map.ts)과 좌표를 함께 쓸 때. */
export type { NodeId };
