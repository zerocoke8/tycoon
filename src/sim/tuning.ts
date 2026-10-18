// 시뮬레이션 안쪽의 작은 규칙 숫자 (defs.ts 표에 아직 자리가 없는 것들).
// 밸런스를 만질 때 같이 본다. 나중에 defs.ts로 옮긴다.

export const TUNE = {
  /** 건 코인 = 지갑 × 비율 (성격). */
  betFrac: { coward: [0.08, 0.12], normal: [0.15, 0.25], bold: [0.3, 0.45] },
  /** 행운아 성격이 이길 확률에 더하는 값. */
  luckTrait: 0.03,
  /** 막 열린 종(지금 회관 레벨에 새로 오는 종)이 오는 무게 (다른 종은 1). 새 구역 재료가 너무 늦지 않게. */
  newSpeciesWeight: 2.5,
  /** 다음 마을회관 레벨에 모자란 재료를 가져오는 종이 오는 무게 배수 (재료 하나 때문에 오래 막히지 않게). */
  neededSpeciesWeight: 2,
  /** 종 성격 하나에 더해 무작위 성격이 하나 더 붙을 확률. */
  extraTraitChance: 0.3,
  /** 끈기 (한판 수) 범위. */
  patience: [4, 9],
  /** 손님이 오는 간격의 흔들림 (±). */
  spawnJitter: 0.3,
  /** 새 게임에서 첫 손님까지 초. */
  firstSpawnSec: 2,
  /** 손님이 가득일 때 다시 볼 때까지 초. */
  spawnRetrySec: 1.5,
  /** 마을이 거의 비었으면 (손님 below명 미만) 오는 간격 × mult. */
  fillFast: { below: 2, mult: 0.4 },
  /** 새 게임에서 처음부터 광장을 걷고 있는 손님 수와, 그 손님이 서 있는 곳 (분수에서 가까운 길 노드 몇 개 가운데). */
  openingGuests: 2,
  openingNodes: 6,
  /** 새 손님이 입구에서 걸어 들어와 처음 서는 곳: 입구 → 광장 길 거리의 이 비율 사이에 있는 노드 (지도 크기를 따른다). */
  arriveFrac: [0.2, 0.6],
  /** 아직 한판도 안 한 손님이 첫 결정에서 부스로 갈 확률. */
  newcomerBooth: 0.95,

  /** 진행: 한판 시간 = roundSec / (1 + (진행 - 3) × 이 값). */
  pacePerPoint: 0.08,
  /** 입담: 한판마다 기분 + 입담 × 이 값. */
  charmMood: 0.6,
  /** 손님맞이: 부스 고르기 가중치 × (1 + (손님맞이 - 3) × 이 값). */
  welcomePerPoint: 0.2,
  /** 좋아하는 부스 가중치. */
  favoriteWeight: 3,
  /** 줄 한 명마다 가중치를 나누는 값 (1 + 줄 × 이 값). */
  queuePenalty: 0.6,
  /** 배치형 마을: 부스까지 걷는 길 칸 수 d만큼 가중치를 나눈다 (1 + d / 이 값: 이만큼 멀면 반). 가까운 부스를 더 자주 고른다. */
  boothNearCells: 24,
  /** 단체 놀이는 boothNearCells × 이 값 (멀어도 덜 줄인다). */
  groupNearMult: 2,
  /** 길 칸 위에서는 이만큼 빨리 걷는다 (건물 안 자리로 걸어 들어갈 때는 1). */
  roadSpeed: 1.2,

  /** 흥부자 기쁨, 울보 슬픔 배수. */
  cheerfulJoy: 1.6,
  crybabySad: 1.6,
  /** 미식가가 간식에서 받는 기분 배수. */
  foodieSnack: 1.5,

  /** 같은 자리에서 다시 한판 할 확률 (기본, 아깝다 뒤 +, 줄이 있으면 -, 단체 놀이는 다음 판도 그 자리에서 +). */
  playAgain: { base: 0.55, afterNearMiss: 0.2, queue: -0.3, bold: 0.1, group: 0.25 },
  /** 줄에서 이만큼 기다리면 포기하고 다른 걸 한다. */
  queueGiveUpSec: 75,
  queueGiveUpMood: -4,
  /** 한 손님이 마을에 머무는 최대 초 (그 뒤엔 집에 간다). 첫 한판부터 잰다: 입구에서 걸어오는 시간은 빼서 지도가 커져도 노는 시간이 그대로. */
  maxVisitSec: 480,
  /** 온 때부터 세는 최대 초 (한판을 늦게 시작한 손님도 이 뒤엔 집에 간다). */
  maxStaySec: 720,

  /** 쉬기 (분수 옆). */
  restSec: [6, 12],
  restMoodPerSec: 0.8,
  /** 광장 걷기 뒤 멈춰서 둘러보는 초. */
  wanderPauseSec: [1.5, 4],
  /** 구경꾼이 부스 옆에서 구경하는 초. */
  watchSec: [6, 10],

  /** 구경 반경 (세계 px)과 확률. */
  spectateRadius: 450,
  spectateChance: 0.25,
  watcherSpectateChance: 0.9,
  spectateMood: { jackpot: 2, win: 1, nearMiss: 0, lose: 0 },

  /** 팁 = 기분 × tipPerMood × (1 + 딴 판 수 × 이 값). */
  tipWinBonus: 0.2,
  /** 이 기분 이상으로 떠나는 대박 손님이 귀한 물건을 줄 수 있다. */
  preciousMood: 80,
  /** 기분이 이 이상이면 특산 재료를 하나 더. */
  bonusMaterialMood: 85,
  /** 창고가 가득 찼다는 토스트 간격 (초). */
  capToastSec: 30,

  /** 진행자 후보 새로고침 간격 (초). */
  candidateRefreshSec: 150,
  /** 진행자 레벨업 비용 = base + 레벨 × perLevel. */
  staffLevelCost: { base: 30, perLevel: 50 },
  /** 무작위 후보 몸값 = base + 능력치 합 × perPoint. */
  candidateCost: { base: 30, perPoint: 12 },

  /** 다시 찾아오는 단골 (빈털터리 때 간식을 받은 손님) 목록 크기와 다시 올 확률. */
  regularMax: 6,
  regularChance: 0.35,
  regularMoodBonus: 10,

  /** 손님맞이 자리가 비어 있을 때의 손님맞이 값 (경주장 사육사가 없으면 손님이 조금 덜 온다). */
  emptyWelcome: 2,

  // ── 단체 놀이 (경주장과 셋째 묶음, 값은 경주장에서 맞췄다) ──
  /**
   * 모이는 중인 판에 손님이 끌리는 정도: 부스 고르기 가중치 × (1 + 참가자 수 × 이 값). 출발 조건이 아직 안 맞으면 (밀어내기 상대·줄다리기 편) × groupNeedPull 더.
   * 많아야 × groupPullMax (줄다리기처럼 자리가 많은 판이 마을 손님을 다 데려가지 않게).
   */
  groupGatherPull: 1.5,
  groupNeedPull: 2.5,
  groupPullMax: 4,
  /** 모이는 시간(gatherSec)이 지나도 이 초 안에 자리에 닿는 손님은 기다려 준다 (첫 손님이 앉고 gatherSec + groupWaitExtraSec까지). */
  groupWaitWalkSec: 12,
  groupWaitExtraSec: 20,
  /** 판에 끼지 못하고(편 맞추기) 자리에서 이만큼 기다리면 다른 걸 하러 간다 (초). */
  groupBenchGiveUpSec: 75,
  /** 출발 뒤 이 초부터 1등을 알린다 (출발선에서는 순위가 없다). */
  raceCheerStartSec: 1,
  /** 경주·오리배 1등 바뀜(groupEvent lead) 사이 최소 초. */
  raceCheerGapSec: 0.8,
  /** 사건(1등 바뀜 등)마다 참가자 기분 + 입담 × 이 값. */
  groupCommentMood: 0.25,
  /** 결과 뒤 놀이 가운데(GroupGame.center)에서 이 반경 안 손님이 구경 반응. */
  groupSpectateRadius: 950,
  groupSpectateChance: 0.6,
  groupWatcherSpectateChance: 0.95,
  /** 구경꾼 기분 + 입담 × 이 값 (TUNE.spectateMood에 더해). */
  groupCasterSpectate: 0.5,
  /**
   * 진행 중 큰 사건(GroupGame.buzz: 뒤집기·질 뻔함·연줄 끊김·보물·막판 역전)에 놀이 가운데에서 groupSpectateRadius 안의 손님(참가자 말고)이 들썩일 확률.
   * 구경꾼 성격은 watcher 값, 입담 1점마다 + buzzPerCharm. 이미 반응 중인 손님(pose를 보여 주는 중)은 넘어간다.
   */
  groupBuzzChance: 0.4,
  groupWatcherBuzzChance: 0.85,
  groupBuzzPerCharm: 0.04,
  /** 들썩일 때 기분 +. */
  groupBuzzMood: { wow: 2, gasp: 0.5, cheer: 1, laugh: 1 },
  /** 경주·오리배: 1등 결승 시각의 이 비율 뒤에 1등이 바뀌어야 구경꾼이 들썩인다 (막판). */
  raceBuzzFrom: 0.55,
  /**
   * 판이 시작할 때 근처(groupDrawRadius)를 걷던 손님이 발을 멈추고 구경하러 갈 확률 (구경꾼 성격은 watcher 값).
   * 손님맞이(그 부스의 손님맞이 자리, 없으면 0번 자리) 1점마다 × (1 + drawPerWelcome). 구경은 판이 끝나고 결과를 볼 때까지.
   */
  groupDrawRadius: 1200,
  groupDrawChance: 0.2,
  groupWatcherDrawChance: 0.6,
  groupDrawPerWelcome: 0.15,
  /** 구경꾼 성격이 구경할 부스를 고를 때 진행 중인 단체 놀이의 무게 (다른 부스는 1). */
  groupWatchWeight: 3,
  /** 진행(심판·바람지기·삽 대여): 경주장·오리배 밖의 단체 놀이 판 길이 = roundSec / (1 + (진행 - 3) × 이 값). */
  groupPacePerPoint: 0.05,
} as const;
