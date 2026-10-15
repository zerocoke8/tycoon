// 시뮬레이션 안쪽의 작은 규칙 숫자 (defs.ts 표에 아직 자리가 없는 것들).
// 밸런스를 만질 때 같이 본다. 나중에 defs.ts로 옮긴다.

export const TUNE = {
  /** 건 코인 = 지갑 × 비율 (성격). */
  betFrac: { coward: [0.08, 0.12], normal: [0.15, 0.25], bold: [0.3, 0.45] },
  /** 행운아 성격이 이길 확률에 더하는 값. */
  luckTrait: 0.03,
  /** 막 열린 종(지금 회관 레벨에 새로 오는 종)이 오는 무게 (다른 종은 1). 새 구역 재료가 너무 늦지 않게. */
  newSpeciesWeight: 2.5,
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

  /** 흥부자 기쁨, 울보 슬픔 배수. */
  cheerfulJoy: 1.6,
  crybabySad: 1.6,
  /** 미식가가 간식에서 받는 기분 배수. */
  foodieSnack: 1.5,

  /** 같은 자리에서 다시 한판 할 확률 (기본, 아깝다 뒤 +, 줄이 있으면 -, 경주장은 다음 경주도 관중석에서 +). */
  playAgain: { base: 0.55, afterNearMiss: 0.2, queue: -0.3, bold: 0.1, race: 0.25 },
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

  // ── 몬스터 경주장 ──
  /** 모이는 중인 경주에 손님이 끌리는 정도: 부스 고르기 가중치 × (1 + 참가자 수 × 이 값). */
  raceGatherPull: 0.5,
  /** 출발 뒤 이 초부터 1등을 알린다 (출발선에서는 순위가 없다). */
  raceCheerStartSec: 1,
  /** raceProgress(1등 바뀜) 사이 최소 초. */
  raceCheerGapSec: 0.8,
  /** 1등이 바뀔 때마다 참가자 기분 + 해설자 입담 × 이 값. */
  raceCommentMood: 0.25,
  /** 결승 뒤 경주로 근처(경주로 가운데에서 이 반경) 손님이 구경 반응. */
  raceSpectateRadius: 950,
  raceSpectateChance: 0.6,
  raceWatcherSpectateChance: 0.95,
  /** 구경꾼 기분 + 해설자 입담 × 이 값 (TUNE.spectateMood에 더해). */
  raceCasterSpectate: 0.5,
} as const;
