// 게임 데이터 (밸런스 숫자는 모두 여기). 그림 key는 tools/art-assets.ts의 key와 같다.
// 낱말: 게임 안에서는 '놀이', '놀이부스', '한판'. '도박·겜블'은 쓰지 않는다.

// ── 재화 ────────────────────────────────────────────────────────────────

export const MATERIALS = {
  mat_ember: { name: '불씨 조각' },
  mat_shell: { name: '조개껍데기' },
  mat_spoon: { name: '낡은 숟가락' },
  mat_fluff: { name: '솜털' },
  mat_mist: { name: '안개솜' },
  mat_bangmangi: { name: '방망이 조각' },
  mat_shinycoin: { name: '반짝 동전' },
  // 둘째 묶음 손님 20종의 특산 재료 (DESIGN 2.1.1 순서)
  mat_ore: { name: '광석 조각' },
  mat_lotus: { name: '연잎' },
  mat_cloudpuff: { name: '구름 조각' },
  mat_ricecake: { name: '달떡' },
  mat_foxbead: { name: '여우 구슬' },
  mat_bell: { name: '해태 방울' },
  mat_caramel: { name: '캐러멜' },
  mat_wool: { name: '양털 뭉치' },
  mat_mugwort: { name: '쑥' },
  mat_squash: { name: '단호박 조각' },
  mat_radishgreen: { name: '무청' },
  mat_moss: { name: '이끼돌' },
  mat_pearl: { name: '진주' },
  mat_feather: { name: '깃털' },
  mat_pebble: { name: '반짝 조약돌' },
  mat_ink: { name: '먹물 병' },
  mat_jelly: { name: '젤리 방울' },
  mat_dew: { name: '이슬 방울' },
  mat_seaweed: { name: '물풀' },
  mat_cactusflower: { name: '선인장 꽃' },
  // 넷째 묶음: 일터 밭에서 나오는 재료 (손님 종의 특산 재료가 아니다: LABOR.facilities). 광산은 광석 조각(mat_ore).
  mat_veggie: { name: '채소' },
} as const;
export type MaterialId = keyof typeof MATERIALS;

export const PRECIOUS = {
  gem: { name: '보석' },
  golden_acorn: { name: '황금 도토리' },
  star_piece: { name: '별 조각' },
} as const;
export type PreciousId = keyof typeof PRECIOUS;

/** 가공품 (공방에서 만든다): 간식은 몬스터에게 주고, 응원 도구는 놀이부스에 건다. */
export const GOODS = {
  snack_cookie: { name: '위로 쿠키', kind: 'snack', mood: 30, patience: 2, desc: '슬픈 손님도 다시 웃게 한다.' },
  snack_ricecake: { name: '꿀떡', kind: 'snack', mood: 45, patience: 3, desc: '기분이 크게 오르고 한참 더 논다.' },
  cheer_flag: { name: '응원 깃발', kind: 'cheer', moodPerRound: 3, reactionBoost: 1.3, durationSec: 180, desc: '부스에 걸면 손님 반응이 커진다.' },
  lucky_charm: { name: '행운 부적', kind: 'cheer', moodPerRound: 2, luck: 0.04, durationSec: 180, desc: '부스에 걸면 손님이 조금 더 잘 맞힌다.' },
} as const;
export type GoodId = keyof typeof GOODS;

/** 가공 레시피 (공방). 앞 다섯 줄의 순서(index)는 바꾸지 않는다 (시험이 index로 부른다). */
export const RECIPES: readonly { readonly out: GoodId; readonly coins: number; readonly mats: Partial<Record<MaterialId, number>>; readonly sec: number; readonly hall: number }[] = [
  { out: 'snack_cookie', coins: 5, mats: { mat_ember: 1, mat_spoon: 1 }, sec: 30, hall: 1 },
  { out: 'snack_cookie', coins: 5, mats: { mat_shell: 2 }, sec: 30, hall: 1 },
  { out: 'cheer_flag', coins: 15, mats: { mat_fluff: 2, mat_spoon: 1 }, sec: 60, hall: 2 },
  { out: 'snack_ricecake', coins: 12, mats: { mat_mist: 1, mat_shell: 1, mat_ember: 1 }, sec: 45, hall: 2 },
  { out: 'lucky_charm', coins: 25, mats: { mat_bangmangi: 1, mat_shinycoin: 1 }, sec: 90, hall: 3 },
  // 둘째 묶음 재료로 만드는 다른 방법 (새 재료가 모두 어딘가에 쓰이게).
  { out: 'snack_cookie', coins: 5, mats: { mat_caramel: 1, mat_radishgreen: 1 }, sec: 30, hall: 1 },
  { out: 'snack_cookie', coins: 5, mats: { mat_squash: 2 }, sec: 30, hall: 1 },
  { out: 'snack_ricecake', coins: 12, mats: { mat_jelly: 1, mat_lotus: 1, mat_seaweed: 1 }, sec: 45, hall: 2 },
  { out: 'cheer_flag', coins: 15, mats: { mat_ink: 2, mat_seaweed: 1 }, sec: 60, hall: 2 },
  { out: 'snack_cookie', coins: 5, mats: { mat_cloudpuff: 2 }, sec: 30, hall: 3 },
  { out: 'snack_ricecake', coins: 12, mats: { mat_ricecake: 2 }, sec: 45, hall: 3 },
  { out: 'cheer_flag', coins: 15, mats: { mat_wool: 2, mat_feather: 1 }, sec: 60, hall: 3 },
  { out: 'lucky_charm', coins: 25, mats: { mat_ore: 1, mat_moss: 1, mat_pearl: 1 }, sec: 90, hall: 3 },
  { out: 'snack_ricecake', coins: 12, mats: { mat_mugwort: 2, mat_dew: 1 }, sec: 45, hall: 4 },
  { out: 'cheer_flag', coins: 15, mats: { mat_cactusflower: 2, mat_pebble: 1 }, sec: 60, hall: 4 },
  { out: 'lucky_charm', coins: 25, mats: { mat_foxbead: 1, mat_bell: 1 }, sec: 90, hall: 4 },
  // 넷째 묶음: 일터(밭·광산)에서 나온 재료로 (채소 간식은 일하는 채무자를 달래는 데도 쓴다).
  { out: 'snack_cookie', coins: 5, mats: { mat_veggie: 2 }, sec: 30, hall: 2 },
  { out: 'snack_ricecake', coins: 12, mats: { mat_veggie: 2, mat_ore: 1 }, sec: 45, hall: 2 },
];

// ── 몬스터 손님 ─────────────────────────────────────────────────────────

export type BoothId = 'slot' | 'oddeven' | 'cups' | 'darts' | 'wheel' | 'ssireum' | 'duck' | 'ring' | 'boat' | 'race' | 'kite' | 'claw' | 'pouch' | 'tug' | 'dig';
/** 열리는 순서 (중앙 → 연못 동네 → 북쪽 언덕 → 숲 동네 → 축제 들판). 화면·목록이 이 순서로 보여 준다. */
export const BOOTH_IDS: readonly BoothId[] = ['slot', 'oddeven', 'cups', 'darts', 'wheel', 'ssireum', 'duck', 'ring', 'boat', 'race', 'kite', 'claw', 'pouch', 'tug', 'dig'];

/**
 * 손님 종. hall = 마을회관 레벨이 이 이상이면 온다 (회관 1~4마다 새 손님 6·7·7·7종, 구역 주제와 맞춘다:
 * 회관 2 = 연못 동네(물가 손님), 회관 3 = 북쪽 언덕(언덕·하늘 손님), 회관 4 = 숲 동네(숲 손님)).
 * color = 그림이 없을 때 자리 표시 색 (기획서의 종 색). material = 특산 재료 (떠날 때 팁, 복주머니 참가비).
 * favorite = 좋아하는 부스 (고르기 무게 ×3). 셋째 묶음 단체 놀이도 종마다 하나씩 (힘센 종 밀어내기, 물가 종 오리배, 하늘·떠다니는 종 연날리기, 땅·보물 종 보물찾기, 그 밖 줄다리기).
 */
export const SPECIES = {
  dragon: { name: '꼬마 용', material: 'mat_ember', floats: false, hall: 1, favorite: ['slot', 'darts', 'wheel', 'ssireum'], wallet: [40, 90], traits: ['cheerful', 'bold'], color: 0xe8875a },
  crab: { name: '동글게', material: 'mat_shell', floats: false, hall: 1, favorite: ['cups', 'oddeven', 'duck', 'boat'], wallet: [30, 70], traits: ['coward', 'watcher'], color: 0x8ec8ee },
  goblin: { name: '냄비 고블린', material: 'mat_spoon', floats: false, hall: 1, favorite: ['oddeven', 'slot', 'pouch', 'tug'], wallet: [25, 60], traits: ['crybaby', 'bold'], color: 0xa8c47e },
  pudding: { name: '푸딩 몬스터', material: 'mat_caramel', floats: false, hall: 1, favorite: ['wheel', 'slot', 'tug'], wallet: [30, 70], traits: ['foodie', 'cheerful'], color: 0xf3d58a },
  radish: { name: '무 꼬마', material: 'mat_radishgreen', floats: false, hall: 1, favorite: ['oddeven', 'ring', 'dig'], wallet: [25, 60], traits: ['cheerful', 'coward'], color: 0xf7f3ea },
  kabocha: { name: '단호박 꼬마', material: 'mat_squash', floats: false, hall: 1, favorite: ['cups', 'wheel', 'ssireum'], wallet: [35, 80], traits: ['foodie', 'bold'], color: 0x5f7f55 },
  bat: { name: '통통박쥐', material: 'mat_fluff', floats: true, hall: 2, favorite: ['darts', 'slot', 'race', 'kite'], wallet: [35, 80], traits: ['cheerful', 'watcher'], color: 0xb8a5d8 },
  ghost: { name: '꼬마 유령', material: 'mat_mist', floats: true, hall: 2, favorite: ['cups', 'oddeven', 'claw', 'kite'], wallet: [30, 75], traits: ['crybaby', 'coward'], color: 0xf6ebd5 },
  turtle: { name: '연못 거북', material: 'mat_lotus', floats: false, hall: 2, favorite: ['duck', 'race', 'boat'], wallet: [40, 90], traits: ['coward', 'watcher'], color: 0xa9c3cc },
  otter: { name: '꼬마 수달', material: 'mat_seaweed', floats: false, hall: 2, favorite: ['duck', 'ring', 'boat'], wallet: [35, 85], traits: ['cheerful', 'bold'], color: 0xa0785a },
  octopus: { name: '꼬마 문어', material: 'mat_ink', floats: false, hall: 2, favorite: ['cups', 'claw', 'tug'], wallet: [35, 80], traits: ['crybaby', 'lucky'], color: 0xef9a7a },
  jellyfish: { name: '꼬마 해파리', material: 'mat_jelly', floats: true, hall: 2, favorite: ['duck', 'wheel', 'boat'], wallet: [30, 70], traits: ['coward', 'crybaby'], color: 0xf6c7a8 },
  whale: { name: '구름고래', material: 'mat_pearl', floats: true, hall: 2, favorite: ['race', 'wheel', 'boat'], wallet: [60, 130], traits: ['cheerful', 'watcher'], color: 0x9db8cc },
  dokkaebi: { name: '꼬마 도깨비', material: 'mat_bangmangi', floats: false, hall: 3, favorite: ['oddeven', 'cups', 'race', 'ssireum'], wallet: [80, 160], traits: ['bold', 'lucky'], color: 0xf0c45a },
  mole: { name: '두더지 광부', material: 'mat_ore', floats: false, hall: 3, favorite: ['claw', 'darts', 'dig'], wallet: [60, 140], traits: ['bold', 'crybaby'], color: 0xc9995f },
  golem: { name: '조약돌 골렘', material: 'mat_moss', floats: false, hall: 3, favorite: ['ring', 'darts', 'ssireum'], wallet: [50, 120], traits: ['coward', 'watcher'], color: 0xb3aea8 },
  cloud: { name: '뭉게 정령', material: 'mat_cloudpuff', floats: true, hall: 3, favorite: ['wheel', 'race', 'kite'], wallet: [50, 120], traits: ['cheerful', 'crybaby'], color: 0xcfeadb },
  owl: { name: '졸린 부엉이', material: 'mat_feather', floats: false, hall: 3, favorite: ['oddeven', 'race', 'kite'], wallet: [60, 140], traits: ['watcher', 'lucky'], color: 0xa0705a },
  sheep: { name: '솜뭉치 양', material: 'mat_wool', floats: false, hall: 3, favorite: ['duck', 'wheel', 'tug'], wallet: [50, 110], traits: ['coward', 'foodie'], color: 0xf6efe2 },
  moonrabbit: { name: '달토끼', material: 'mat_ricecake', floats: false, hall: 3, favorite: ['race', 'ring', 'kite'], wallet: [70, 150], traits: ['cheerful', 'lucky'], color: 0xf7f3ea },
  mimic: { name: '꼬마 미믹', material: 'mat_shinycoin', floats: false, hall: 4, favorite: ['slot', 'pouch', 'claw', 'dig'], wallet: [120, 250], traits: ['foodie', 'bold'], color: 0xb07a4f },
  gumiho: { name: '아기 구미호', material: 'mat_foxbead', floats: false, hall: 4, favorite: ['cups', 'pouch', 'kite'], wallet: [100, 220], traits: ['lucky', 'bold'], color: 0xf3dfa0 },
  haetae: { name: '꼬마 해태', material: 'mat_bell', floats: false, hall: 4, favorite: ['race', 'oddeven', 'ssireum'], wallet: [100, 220], traits: ['bold', 'watcher'], color: 0xf3e6c8 },
  ssukddeok: { name: '쑥떡 요정', material: 'mat_mugwort', floats: false, hall: 4, favorite: ['pouch', 'slot', 'tug'], wallet: [80, 180], traits: ['foodie', 'crybaby'], color: 0xa9c48a },
  raccoon: { name: '꼬마 너구리', material: 'mat_pebble', floats: false, hall: 4, favorite: ['claw', 'pouch', 'dig'], wallet: [90, 200], traits: ['bold', 'foodie'], color: 0xa8a29a },
  sprout: { name: '새싹 정령', material: 'mat_dew', floats: false, hall: 4, favorite: ['duck', 'ring', 'dig'], wallet: [80, 170], traits: ['coward', 'cheerful'], color: 0xc3dc8a },
  cactus: { name: '말랑 선인장', material: 'mat_cactusflower', floats: false, hall: 4, favorite: ['ring', 'claw', 'tug'], wallet: [80, 180], traits: ['crybaby', 'coward'], color: 0x8fbf7a },
} as const satisfies Record<string, {
  name: string; material: MaterialId; floats: boolean; hall: number; favorite: readonly BoothId[]; wallet: readonly [number, number]; traits: readonly TraitId[]; color: number;
}>;
export type SpeciesId = keyof typeof SPECIES;
export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];

/** 성격. 종마다 둘 가운데 하나가 잘 붙고, 무작위로 하나 더 붙기도 한다. */
export const TRAITS = {
  coward: { name: '겁쟁이', desc: '조금씩만 건다.' },
  bold: { name: '대담이', desc: '크게 건다.' },
  crybaby: { name: '울보', desc: '지면 크게 슬퍼한다.' },
  cheerful: { name: '흥부자', desc: '이기면 크게 기뻐한다.' },
  foodie: { name: '미식가', desc: '간식에 약하다.' },
  watcher: { name: '구경꾼', desc: '남의 판을 구경하며 따라 반응한다.' },
  lucky: { name: '행운아', desc: '아주 조금 더 잘 맞힌다.' },
} as const;
export type TraitId = keyof typeof TRAITS;

/** 손님 이름 (종 이름 앞에 붙는 별명). */
export const NICKNAMES = ['콩', '말랑', '포동', '몽실', '쪼꼬', '보리', '두부', '꼬물', '방울', '솜사탕', '찹쌀', '호떡', '감자', '누룽지', '도토', '깨비', '모찌', '쿠키', '젤리', '구름'] as const;

/** 손님이 들고 오는 자기 종 특산 재료 수 [최소, 최대] (복주머니 참가비로 쓴다). */
export const GUEST_MATS = [1, 2] as const;

// ── 놀이부스 ───────────────────────────────────────────────────────────

/**
 * 진행자 자리 하나. stat = 이 자리에서 쓰는 능력치 (부스에 그 능력치 자리가 없으면 0번 자리 진행자의 능력치를 쓴다).
 * optional = 비어 있어도 부스가 열린다 (있으면 좋은 자리).
 */
export interface BoothRole {
  readonly key: string;
  readonly name: string;
  readonly stat: keyof StaffStats;
  readonly optional?: boolean;
}

/** 보통 부스의 진행자 자리 (하나). */
const HOST_ROLE = [{ key: 'host', name: '진행자', stat: 'pace' }] as const satisfies readonly BoothRole[];

/** 부스 한 줄의 모양 (BOOTHS[b]를 이 모양으로 읽을 때: boothDef). */
export interface BoothDef {
  readonly name: string;
  readonly desc: string;
  /** 지도 그림 map/<building>. */
  readonly building: string;
  /** 레벨 1~3 값은 [L1, L2, L3]. */
  readonly fee: readonly number[];
  readonly seats: readonly number[];
  readonly roundSec: readonly number[];
  readonly potSeed: number;
  readonly potCap: readonly number[];
  /** 해금 비용과 조건: hall = 이 마을회관 레벨부터 (그 구역이 열리는 레벨). */
  readonly unlock: { readonly coins: number; readonly precious: Partial<Record<PreciousId, number>>; readonly mats?: Partial<Record<MaterialId, number>>; readonly hall: number };
  readonly upgrade: readonly { readonly coins: number; readonly precious?: Partial<Record<PreciousId, number>> }[];
  /** 진행자 자리 (BoothState.staff와 같은 순서). */
  readonly roles: readonly BoothRole[];
  /** 한판 참가비로 내는 손님의 특산 재료 수 (복주머니). 있으면 코인 참가비(fee)는 0. */
  readonly matFee?: number;
  /** 건 코인 배수 (복주머니는 작게 건다). */
  readonly betScale?: number;
  /** 한판마다 기분 + (결과와 상관없이, 오리 낚시). */
  readonly moodPerRound?: number;
  /** 지거나 아깝게 졌을 때 기분이 내려가는 배수 (오리 낚시는 작게). */
  readonly moodLossScale?: number;
}

export const BOOTHS = {
  slot: {
    name: '슬롯 부스', desc: '그림 세 개를 맞추는 한판', building: 'booth_slot',
    fee: [2, 3, 5], seats: [1, 1, 2], roundSec: [4.5, 4, 3.5], potSeed: 60, potCap: [300, 600, 1200],
    unlock: { coins: 0, precious: {}, hall: 1 }, upgrade: [{ coins: 120 }, { coins: 400, precious: { gem: 1 } }],
    roles: HOST_ROLE,
  },
  oddeven: {
    name: '홀짝 부스', desc: '진행자 손 안 조약돌이 홀일까 짝일까', building: 'booth_oddeven',
    fee: [1, 2, 3], seats: [1, 2, 2], roundSec: [3.5, 3.2, 3], potSeed: 40, potCap: [200, 400, 800],
    unlock: { coins: 0, precious: {}, hall: 1 }, upgrade: [{ coins: 100 }, { coins: 350, precious: { golden_acorn: 1 } }],
    roles: HOST_ROLE,
  },
  cups: {
    name: '구슬 찾기 부스', desc: '컵 셋 가운데 구슬이 든 컵 찾기', building: 'booth_cups',
    fee: [2, 3, 4], seats: [1, 1, 2], roundSec: [5, 4.5, 4], potSeed: 50, potCap: [250, 500, 1000],
    unlock: { coins: 120, precious: { golden_acorn: 1 }, hall: 1 }, upgrade: [{ coins: 200 }, { coins: 500, precious: { star_piece: 1 } }],
    roles: HOST_ROLE,
  },
  darts: {
    name: '다트 부스', desc: '가운데에 가까울수록 크게', building: 'booth_darts',
    fee: [2, 4, 6], seats: [1, 2, 2], roundSec: [4, 3.6, 3.2], potSeed: 60, potCap: [300, 600, 1200],
    unlock: { coins: 110, precious: {}, mats: { mat_radishgreen: 1 }, hall: 1 }, upgrade: [{ coins: 250 }, { coins: 600, precious: { gem: 2 } }],
    roles: HOST_ROLE,
  },
  wheel: {
    name: '돌림판 부스', desc: '칸 하나를 찜하고 큰 바퀴를 돌린다', building: 'booth_wheel',
    fee: [2, 3, 5], seats: [1, 2, 2], roundSec: [5.5, 5, 4.5], potSeed: 60, potCap: [300, 600, 1200],
    unlock: { coins: 140, precious: {}, mats: { mat_caramel: 1 }, hall: 1 }, upgrade: [{ coins: 220 }, { coins: 550, precious: { golden_acorn: 1 } }],
    roles: HOST_ROLE,
  },
  duck: {
    name: '오리 낚시 부스', desc: '느긋하게 오리를 낚는다. 잃어도 반은 돌려받는다', building: 'booth_duck',
    fee: [1, 2, 3], seats: [1, 2, 2], roundSec: [5, 4.6, 4.2], potSeed: 120, potCap: [250, 500, 1000],
    unlock: { coins: 160, precious: {}, mats: { mat_lotus: 1 }, hall: 2 }, upgrade: [{ coins: 200 }, { coins: 480, precious: { golden_acorn: 1 } }],
    roles: HOST_ROLE, moodPerRound: 2, moodLossScale: 0.5,
  },
  ring: {
    name: '고리 던지기 부스', desc: '고리 셋을 던져 둘 이상 걸면 이긴다', building: 'booth_ring',
    fee: [2, 3, 4], seats: [1, 2, 2], roundSec: [5, 4.5, 4], potSeed: 50, potCap: [250, 500, 1000],
    unlock: { coins: 200, precious: {}, mats: { mat_seaweed: 1 }, hall: 2 }, upgrade: [{ coins: 240 }, { coins: 560, precious: { star_piece: 1 } }],
    roles: HOST_ROLE,
  },
  // 경주장 해금은 코인만: 진행자 둘(셋)을 고용하는 것이 진짜 값이고, 귀한 물건을 기다리면 북쪽 언덕이 열리고도 한참 비어 있다.
  race: {
    name: '몬스터 경주장', desc: '손님 여럿이 한 경주에 같이 걸고 같이 본다', building: 'race_stand',
    fee: [2, 3, 4], seats: [6, 6, 6], roundSec: [10, 9.5, 9], potSeed: 120, potCap: [500, 1000, 2000],
    unlock: { coins: 250, precious: {}, hall: 3 }, upgrade: [{ coins: 500 }, { coins: 1200, precious: { gem: 2 } }],
    roles: [
      { key: 'starter', name: '출발 신호', stat: 'pace' },
      { key: 'caster', name: '해설자', stat: 'charm' },
      { key: 'keeper', name: '사육사', stat: 'welcome', optional: true },
    ],
  },
  claw: {
    name: '인형 뽑기 부스', desc: '집게로 손님 인형을 뽑는다', building: 'booth_claw',
    fee: [3, 4, 6], seats: [1, 1, 2], roundSec: [6, 5.5, 5], potSeed: 80, potCap: [400, 800, 1600],
    unlock: { coins: 500, precious: { gem: 1 }, hall: 4 }, upgrade: [{ coins: 450 }, { coins: 1000, precious: { star_piece: 1 } }],
    roles: HOST_ROLE,
  },
  pouch: {
    name: '복주머니 부스', desc: '특산 재료를 내고 주머니 하나를 고른다', building: 'booth_pouch',
    fee: [0, 0, 0], seats: [1, 2, 2], roundSec: [5, 4.5, 4], potSeed: 150, potCap: [300, 600, 1200],
    unlock: { coins: 450, precious: { golden_acorn: 1 }, hall: 4 }, upgrade: [{ coins: 400 }, { coins: 900, precious: { gem: 1 } }],
    roles: HOST_ROLE, matFee: 1, betScale: 0.4,
  },
  // ── 셋째 묶음: 밖에서 봐도 재미있는 단체 놀이 (DESIGN 3.6). 흐름은 경주장과 같은 단체 놀이 엔진 (sim/group). ──
  // 해금은 코인 + 그 구역 손님 재료 하나: 진행자 둘을 고용하는 것이 진짜 값이다 (경주장과 같이). 처음 구역의 밀어내기는 회관 2보다 먼저 열 수 있게 싸게,
  // 해설자 자리는 있으면 좋은 자리 (심판만 있으면 열린다).
  // 밀어내기 대결장 (key ssireum, DESIGN 3.6: 한국 요소를 억지로 넣지 않아 씨름장에서 이름을 바꿨다): 자리 0·1 = 홍·청 선수 (모래판 안),
  // 2~5 = 구경하며 거는 손님. 선수 둘이 다 와야 시작한다.
  ssireum: {
    name: '밀어내기 대결장', desc: '손님 둘이 모래판에서 밀어내기 대결, 구경 손님은 홍·청에 건다', building: 'ssireum_ring',
    fee: [2, 3, 4], seats: [6, 6, 6], roundSec: [8, 7.5, 7], potSeed: 150, potCap: [500, 1000, 2000],
    unlock: { coins: 180, precious: {}, mats: { mat_squash: 1 }, hall: 1 }, upgrade: [{ coins: 450 }, { coins: 1000, precious: { golden_acorn: 1 } }],
    roles: [
      { key: 'referee', name: '심판', stat: 'pace' },
      { key: 'caster', name: '해설자', stat: 'charm', optional: true },
    ],
  },
  // 오리배 경주: 경주장과 같은 규칙을 연못 위에서. 선착장 자리 6.
  boat: {
    name: '오리배 경주', desc: '배 넷 가운데 1등을 맞히는 연못 경주', building: 'boat_dock',
    fee: [2, 3, 4], seats: [6, 6, 6], roundSec: [11, 10.5, 10], potSeed: 120, potCap: [500, 1000, 2000],
    unlock: { coins: 220, precious: {}, mats: { mat_shell: 1 }, hall: 2 }, upgrade: [{ coins: 550 }, { coins: 1200, precious: { star_piece: 1 } }],
    roles: [
      { key: 'starter', name: '출발 신호', stat: 'pace' },
      { key: 'lifeguard', name: '구조 요원', stat: 'welcome', optional: true },
    ],
  },
  // 연날리기 대회: 자리 0~3 = 연 날리는 손님 (자기 연 = 자리 번호, 빈 자리의 연은 말뚝에 묶여 난다), 4·5 = 구경하며 거는 손님.
  // 지도 그림이 따로 없어 부스 표식은 이정표(map/signpost), 연은 objects/kite_*를 하늘 층에 그린다.
  kite: {
    name: '연날리기 대회', desc: '연 넷이 하늘에서 연싸움, 마지막까지 남은 연이 이긴다', building: 'signpost',
    fee: [3, 4, 5], seats: [6, 6, 6], roundSec: [14, 13, 12], potSeed: 120, potCap: [500, 1000, 2000],
    unlock: { coins: 200, precious: {}, mats: { mat_cloudpuff: 1 }, hall: 3 }, upgrade: [{ coins: 650 }, { coins: 1400, precious: { gem: 1 } }],
    roles: [
      { key: 'master', name: '연 장인', stat: 'charm' },
      { key: 'wind', name: '바람지기', stat: 'pace' },
    ],
  },
  // 줄다리기: 자리 짝수 = 홍, 홀수 = 청 (편마다 2~4). 편 인원을 맞춰 시작한다 (남는 손님은 다음 판).
  tug: {
    name: '줄다리기', desc: '홍·청 두 편이 밧줄을 당긴다', building: 'tug_stand',
    fee: [2, 3, 4], seats: [6, 8, 8], roundSec: [9, 8.5, 8], potSeed: 150, potCap: [600, 1200, 2400],
    unlock: { coins: 600, precious: { star_piece: 1 }, hall: 5 }, upgrade: [{ coins: 800 }, { coins: 1600, precious: { gem: 2 } }],
    roles: [
      { key: 'referee', name: '심판', stat: 'pace' },
      { key: 'cheer', name: '응원단장', stat: 'charm' },
    ],
  },
  // 보물찾기 마당: 손님마다 땅 한 곳(자리 = 판 자리 0~5)을 판다.
  dig: {
    name: '보물찾기 마당', desc: '손님마다 땅을 파서 보물을 찾는다', building: 'dig_sign',
    fee: [3, 4, 6], seats: [6, 6, 6], roundSec: [10, 9.5, 9], potSeed: 150, potCap: [600, 1200, 2400],
    unlock: { coins: 650, precious: { gem: 1 }, hall: 5 }, upgrade: [{ coins: 850 }, { coins: 1700, precious: { star_piece: 2 } }],
    roles: [
      { key: 'grandpa', name: '보물 안내', stat: 'welcome' },
      { key: 'lender', name: '삽 대여', stat: 'pace' },
    ],
  },
} as const satisfies Record<BoothId, BoothDef>;

/** 부스 한 줄 (선택 칸까지 한 모양으로). */
export function boothDef(b: BoothId): BoothDef {
  return BOOTHS[b];
}

/**
 * 놀이 결과 표. 결과 등급별 확률과 배당(건 코인의 몇 배를 돌려받나, 건 코인 포함).
 * 기대 환급률은 0.9 안팎: 손님은 천천히 잃고, 가끔 크게 딴다. 항아리에서 나간다.
 * 예외: 오리 낚시(잃어도 반은 돌려받는다, 1.2)와 복주머니(참가비가 재료, 1.3)는 1을 넘는다 (DESIGN 3.5). 항아리가 천천히 줄어서 potSeed를 크게 잡았다.
 * 경주(race)는 경주 하나의 결과로 손님마다 정한다: 확률은 대략의 값이고, 배당만 쓴다 (sim/race.ts).
 * 단체 놀이(씨름·오리배·연날리기·줄다리기·보물찾기)도 판 하나로 손님마다 정한다 (sim/group/<booth>.ts): 확률은 생성기가 내는 값과 맞춰 둔 것 (selftest가 잰다).
 * 씨름·줄다리기는 편 대 편이라 이긴 편 1.9 + 뒤집기 대박 3이 1을 조금 넘는다 (1.005): potSeed를 크게.
 */
export const ODDS = {
  slot: { jackpot: [0.05, 9], win: [0.16, 3], nearMiss: [0.26, 0], lose: [0.53, 0] },
  oddeven: { win: [0.48, 1.9], nearMiss: [0, 0], lose: [0.52, 0] },
  cups: { win: [0.31, 2.8], nearMiss: [0.2, 0], lose: [0.49, 0] },
  darts: { jackpot: [0.05, 8], win: [0.25, 2], nearMiss: [0.25, 0], lose: [0.45, 0] },
  wheel: { jackpot: [0.03, 10], win: [0.14, 4], nearMiss: [0.3, 0], lose: [0.53, 0] },
  duck: { jackpot: [0.05, 6], win: [0.25, 2.2], nearMiss: [0.15, 0.5], lose: [0.55, 0.5] },
  ring: { jackpot: [0.04, 7], win: [0.22, 2.5], nearMiss: [0.25, 0], lose: [0.49, 0] },
  race: { jackpot: [0.025, 6], win: [0.225, 3.5], nearMiss: [0.08, 0], lose: [0.67, 0] },
  claw: { jackpot: [0.03, 8], win: [0.17, 3], nearMiss: [0.35, 0], lose: [0.45, 0] },
  pouch: { jackpot: [0.04, 10], win: [0.2, 3], nearMiss: [0.3, 1], lose: [0.46, 0] },
  ssireum: { jackpot: [0.05, 3], win: [0.45, 1.9], nearMiss: [0.15, 0], lose: [0.35, 0] },
  boat: { jackpot: [0.025, 6], win: [0.225, 3.5], nearMiss: [0.08, 0], lose: [0.67, 0] },
  kite: { jackpot: [0.05, 5], win: [0.2, 3.2], nearMiss: [0.1, 0], lose: [0.65, 0] },
  tug: { jackpot: [0.05, 3], win: [0.45, 1.9], nearMiss: [0.15, 0], lose: [0.35, 0] },
  dig: { jackpot: [0.017, 8], win: [0.302, 2.5], nearMiss: [0.064, 0], lose: [0.617, 0] },
} as const satisfies Record<BoothId, Partial<Record<OutcomeTier, readonly [number, number]>>>;

export type OutcomeTier = 'jackpot' | 'win' | 'nearMiss' | 'lose';

/** 슬롯 심볼 (그림 icons/<key>). 마지막이 대박. 돌림판의 여섯 칸도 이 순서 (칸 i = SLOT_SYMBOLS[i], 종 = 5번 칸). */
export const SLOT_SYMBOLS = ['sym_apple', 'sym_mushroom', 'sym_star', 'sym_gem', 'sym_acorn', 'sym_bell'] as const;
export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];

/** 돌림판 칸 수와 대박 칸 (종). */
export const WHEEL = { slices: 6, bell: 5, turns: [3, 5] } as const;

/** 오리 낚시: 통 속 오리 수. */
export const DUCK = { ducks: 5 } as const;

/** 고리 던지기: 병 3×3, 한판에 고리 셋. */
export const RING = { bottles: 9, throws: 3 } as const;

/** 복주머니: 빨강·파랑·노랑 (노랑 = 대박 주머니, 2번). 대박이면 떠날 때 귀한 물건 확정. */
export const POUCH = { pouches: ['pouch_red', 'pouch_blue', 'pouch_gold'], gold: 2 } as const;

/** 인형 뽑기: 상품 인형 objects/plush_<종>. 자기 종 인형을 노릴 확률. */
export const CLAW = { ownChance: 0.4 } as const;

/**
 * 몬스터 경주장 (대형 놀이). 선수 넷은 racers/<key> (옆모습, 왼쪽으로 달린다), 조끼 색은 빨강·파랑·노랑·민트.
 * 결과는 경주 하나로 정한다 (sim/race.ts generateRace): 1등 = win, 꼴찌에서 1등으로 역전 = jackpot,
 * 2등이 사진 판정 차이(photoMargin 초 이하)면 nearMiss, 나머지 lose. 배당은 ODDS.race.
 */
export const RACE = {
  racers: [
    { key: 'racer_snail', name: '달팽이', bib: 0xe0705a },
    { key: 'racer_turtle', name: '거북', bib: 0x6f9fd8 },
    { key: 'racer_frog', name: '개구리', bib: 0xf3d36a },
    { key: 'racer_ladybug', name: '무당벌레', bib: 0x9ed9bf },
  ],
  /** 첫 손님이 앉고 출발까지 초 (출발 신호 진행 3 기준). 진행 1점마다 이 비율만큼 짧게. */
  gatherSec: 20,
  gatherPacePerPoint: 0.12,
  /** 이만큼 모이면 startSoonSec 뒤 출발. */
  minRunners: 2,
  startSoonSec: 4,
  /** 경주 하나가 '꼴찌에서 1등' 역전일 확률, 1·2등 사진 판정일 확률. */
  comebackChance: 0.1,
  photoChance: 0.3,
  /** 1등이 결승에 닿는 때 (경주 시간의 비율 사이). */
  winnerAt: [0.8, 0.86],
  /** 사진 판정: 1·2등 결승 시각 차이 (초) 이하. */
  photoMargin: 0.1,
  /** 역전을 재는 지점: 1등 결승 시각의 이 비율 때 순위 (이때 꼴찌였으면 역전). */
  comebackAt: 0.7,
  /** 출발·출발 임박 대기는 이 비율보다 짧아지지 않는다 (진행이 아주 높아도). */
  gatherMinFrac: 0.5,
  /** 자리가 다 차면 이 초 안에 출발. */
  fullStartSec: 2,
  /** 모든 선수가 들어오고 결과를 보여 주는 초 (그동안 새 참가는 다음 경주로). */
  resultSec: 3,
  /** 좋아하는 선수: 이 종 손님은 fanChance로 이 선수를 고른다 (나머지는 고르게). */
  fans: { turtle: 1, otter: 2, sprout: 3, ssukddeok: 0 },
  fanChance: 0.5,
} as const;

// ── 단체 놀이 (손님 여럿이 한 판, DESIGN 3.6) ────────────────────────────

/**
 * 단체 놀이 부스: 손님 여럿이 한 판을 같이 걸고 같이 본다 (경주장과 셋째 묶음). 흐름은 모두 같은 엔진(sim.ts 단체 놀이 묶음):
 * 쉬기(idle) → 모이기(gathering, 자리에 앉은 손님이 고르고 건다) → 진행(running, 생성기가 정한 타임라인) → 결과(done) → 쉬기.
 * 놀이마다의 규칙(고르기·출발 조건·생성기)은 sim/group/<booth>.ts.
 */
export const GROUP_BOOTHS = ['ssireum', 'boat', 'race', 'kite', 'tug', 'dig'] as const satisfies readonly BoothId[];
export type GroupBoothId = (typeof GROUP_BOOTHS)[number];
export function isGroupBooth(b: BoothId): b is GroupBoothId {
  return (GROUP_BOOTHS as readonly BoothId[]).includes(b);
}

/**
 * 단체 놀이의 흐름 숫자. 첫 손님이 앉고 gatherSec(진행 3 기준, 진행 1점마다 gatherPacePerPoint만큼 짧게, gatherMinFrac까지) 뒤 출발,
 * 출발 조건이 '곧'(경주: 둘 이상)이면 startSoonSec 안에, 자리가 다 차면 fullStartSec 안에. 결과를 resultSec 보여 주고 쉰다.
 * 출발 조건이 안 맞은 채(씨름 상대가 없음 등) maxWaitSec이 지나면 접는다 (건 코인을 돌려주고 손님은 다른 걸 하러 간다).
 */
export interface GroupRules {
  readonly gatherSec: number;
  readonly gatherPacePerPoint: number;
  readonly gatherMinFrac: number;
  readonly startSoonSec: number;
  readonly fullStartSec: number;
  readonly resultSec: number;
  readonly maxWaitSec: number;
}
const RACE_RULES: GroupRules = {
  gatherSec: RACE.gatherSec,
  gatherPacePerPoint: RACE.gatherPacePerPoint,
  gatherMinFrac: RACE.gatherMinFrac,
  startSoonSec: RACE.startSoonSec,
  fullStartSec: RACE.fullStartSec,
  resultSec: RACE.resultSec,
  maxWaitSec: 60,
};
export const GROUP_RULES: Record<GroupBoothId, GroupRules> = {
  race: RACE_RULES,
  // 오리배: 경주장과 같이.
  boat: RACE_RULES,
  // 씨름: 선수 둘이 다 오면 곧 (구경 손님을 조금 기다린다). 상대가 오지 않으면 maxWaitSec 뒤 접는다.
  ssireum: { gatherSec: 14, gatherPacePerPoint: 0.12, gatherMinFrac: 0.5, startSoonSec: 6, fullStartSec: 2, resultSec: 3.5, maxWaitSec: 50 },
  kite: { gatherSec: 20, gatherPacePerPoint: 0.12, gatherMinFrac: 0.5, startSoonSec: 5, fullStartSec: 2, resultSec: 3.5, maxWaitSec: 60 },
  // 줄다리기: 편마다 둘이 모이면 곧 (더 오면 같이). 편이 안 차면 maxWaitSec 뒤 접는다.
  tug: { gatherSec: 16, gatherPacePerPoint: 0.12, gatherMinFrac: 0.5, startSoonSec: 6, fullStartSec: 2, resultSec: 3.5, maxWaitSec: 60 },
  dig: { gatherSec: 18, gatherPacePerPoint: 0.12, gatherMinFrac: 0.5, startSoonSec: 5, fullStartSec: 2, resultSec: 3.5, maxWaitSec: 60 },
};

/** 오리배 경주: 배 넷 (racers/<key>, 옆모습, 왼쪽으로 간다), 깃발 색은 경주장 조끼와 같은 빨강·파랑·노랑·민트. 경주 규칙·확률은 RACE 그대로. */
export const BOAT = {
  boats: [
    { key: 'boat_duck', name: '오리배', flag: 0xe0705a },
    { key: 'boat_swan', name: '백조배', flag: 0x6f9fd8 },
    { key: 'boat_frog', name: '개구리배', flag: 0xf3d36a },
    { key: 'boat_whale', name: '고래배', flag: 0x9ed9bf },
  ],
  /** 좋아하는 배: 이 종 손님은 fanChance로 이 배를 고른다. */
  fans: { otter: 0, jellyfish: 1, turtle: 2, whale: 3 },
  fanChance: 0.5,
} as const;

/** 편 (씨름·줄다리기): 0 = 홍, 1 = 청. */
export const SIDES = [
  { name: '홍', color: 0xe0705a },
  { name: '청', color: 0x6f9fd8 },
] as const;

/**
 * 밀어내기 대결 (key ssireum): 미는 힘 p(t) (-1~1, +1 = 홍이 넘어뜨림). throwAt(판 길이의 비율)에 ±1로 끝난다 (넘어뜨리기), 그 뒤는 쓰러짐·기쁨.
 * flipChance = 이긴 판 가운데 뒤집기(이긴 편이 막판 brink까지 밀렸다가 뒤집음, jackpot) 비율,
 * closeChance = 진 편이 closeFrom(넘어뜨리기 시각의 비율) 뒤에 앞서 있던 판 비율 (뒤집기 판 포함, 진 편 nearMiss).
 * wrestle = 빈 자리에 앉는 손님이 선수(모래판)로 나설 확률: base + 성격 + 떠다니는 종, 상대가 이미 모래판에 있으면 + waiting (sim/group/ssireum.ts seatFor).
 * stepInSec = 모이기 시작하고 이만큼 선수 둘이 안 차면 구경 손님이 모래판으로 나선다.
 */
export const SSIREUM = {
  throwAt: [0.8, 0.88],
  flipChance: 0.1,
  closeChance: 0.3,
  closeFrom: 0.7,
  brink: 0.8,
  wrestle: { base: 0.5, bold: 0.3, coward: -0.3, watcher: -0.2, floats: -0.25, waiting: 0.45 },
  stepInSec: 12,
} as const;

/**
 * 줄다리기: 밧줄 가운데 c(t) (-1~1, +1 = 홍 쪽 선을 넘음 = 홍 승리). 편마다 minSide~maxSide (모이기 시작하고 soloAfterSec이 지나도 안 차면 한 명씩이라도).
 * 나머지는 씨름과 같은 뜻 (closeFrom = 마지막 20%).
 */
export const TUG = { crossAt: [0.82, 0.9], comebackChance: 0.1, closeChance: 0.3, closeFrom: 0.8, brink: 0.8, minSide: 2, maxSide: 4, soloAfterSec: 35 } as const;

/**
 * 연날리기: 연 넷 (objects/<key>, 앞모습 마름모 연), 늘 넷이 난다 (날리는 손님이 없는 연은 말뚝에 묶여 난다).
 * 연이 하나씩 연싸움 끝에 끊어지고 마지막 연이 이긴다. closeChance = 이긴 연이 끊길 뻔한 판 (jackpot),
 * lateChance = 마지막에서 두 번째 연이 lateFrom(판 길이의 비율) 뒤에 끊긴 판 (그 연 nearMiss). 끊기는 때는 cutFrom~cutTo.
 */
export const KITE = {
  kites: [
    { key: 'kite_red', name: '빨강 연', color: 0xe0705a },
    { key: 'kite_blue', name: '파랑 연', color: 0x6f9fd8 },
    { key: 'kite_yellow', name: '노랑 연', color: 0xf3d36a },
    { key: 'kite_green', name: '초록 연', color: 0x8fc77a },
  ],
  /** 날리는 손님 자리 수 (자리 0~3). */
  flyers: 4,
  /** 이만큼 모이면 곧 출발 (GROUP_RULES.kite.startSoonSec), 그보다 적으면 모이는 시간(gatherSec)을 다 기다린다. */
  soonAt: 3,
  /** 빈 자리에 앉는 손님이 연을 날리러 나설 확률 (나머지는 구경하며 건다): base + 성격 + 떠다니는 종 (sim/group/kite.ts seatFor). */
  fly: { base: 0.7, bold: 0.15, coward: -0.3, watcher: -0.3, floats: 0.1 },
  closeChance: 0.2,
  lateChance: 0.4,
  lateFrom: 0.84,
  cutFrom: 0.28,
  cutTo: 0.9,
} as const;

/**
 * 보물찾기: 판 자리 6 (map.ts DIG_FIELD.spots). 판의 chestChance에만 상자가 묻힌다 (DIG_FIELD.chests 가운데 하나, 앞 여섯은 판 자리).
 * 상자를 판 손님 jackpot, 상자 자리 바로 옆(nearPx 안)을 판 손님 nearMiss, 나머지는 winChance로 작은 보물(win), 아니면 헌 장화·조약돌(lose).
 * soonAt = 이만큼 모이면 곧 출발 (그보다 적으면 모이는 시간을 다 기다린다: 여럿이 같이 파게).
 */
export const DIG = { chestChance: 0.15, winChance: 0.33, nearPx: 260, soonAt: 3 } as const;
/** 보물찾기에서 나온 것 (groupEvent 'find'의 value = 이 순서). 그림: chest = map/treasure_chest(_open), coins = items/coin_pile, gem = items/gem, boot = items/old_boot, pebble = objects/pebble. */
export const DIG_FINDS = ['none', 'chest', 'coins', 'gem', 'boot', 'pebble'] as const;

// ── 건물 ────────────────────────────────────────────────────────────────

export type BuildingId = 'hall' | 'gate' | 'workshop' | 'office' | 'warehouse' | 'fountain' | 'pawnshop' | 'bank' | 'workyard';

/**
 * 처음에는 없는 건물 (레벨 0 = 빈 부지, levels[0]이 짓는 비용)과 지을 수 있는 마을회관 레벨 (넷째 묶음, DESIGN 3.7).
 * 여기에 없는 건물은 처음부터 레벨 1.
 */
export const BUILD_HALL: Partial<Record<BuildingId, number>> = { pawnshop: 1, bank: 2, workyard: 2 };

/** 레벨마다 비용과 효과. 레벨 1은 처음부터 있다(비용 없음). */
/**
 * 마을회관 재료: 그 레벨 전에 오는 손님의 재료를 적게씩 (손님 종이 27종으로 늘어 한 종이 오는 비율이 낮아졌다).
 * 새 구역 손님의 재료는 하나씩만 (회관 3 = 솜털, 회관 4 = 광석·양털, 회관 5 = 여우 구슬 + 북쪽 언덕 깃털): 손님이 와서 놀고 떠날 때까지 10분쯤 걸린다.
 * 손님 수(visitors)는 열리는 부스 수를 따라 6·9·13·16·22 (단체 놀이는 한 판에 손님이 여럿 모여야 재미있다. 회관 5는 부스가 15개).
 * 목표 (scripts/sim-check.ts --auto --seeds 24 --minutes 100 중간, 2026-10-19 배치형 마을 다듬기): 밀어내기 ≈ 4.5분, 회관 2 ≈ 8.5분,
 * 오리배 ≈ 14분, 회관 3 ≈ 25분, 경주장 ≈ 28분, 연날리기 ≈ 38분, 회관 4 ≈ 50분, 회관 5 ≈ 70분, 줄다리기 ≈ 74분.
 * 배치형 마을에서 손님이 가까운 부스를 골라 걷는 시간이 줄어 수입이 올라 회관 코인을 올렸다 (200·350·700·900 → 270·330·1000·1300, 땅 값 LAND도 같이).
 */
export const BUILDINGS = {
  hall: {
    name: '마을회관', desc: '마을 레벨. 새 손님이 오고 더 먼 땅을 살 수 있다.',
    levels: [
      { coins: 0, visitors: 6 },
      { coins: 270, mats: { mat_ember: 2, mat_shell: 2 }, visitors: 9 },
      { coins: 330, mats: { mat_spoon: 2, mat_fluff: 1 }, precious: { gem: 1 }, visitors: 13 },
      { coins: 1000, mats: { mat_ore: 1, mat_wool: 1, mat_pearl: 1 }, precious: { star_piece: 1, golden_acorn: 1 }, visitors: 16 },
      // 회관 5 = 축제 들판 (줄다리기·보물찾기). 숲 동네 손님 재료 하나와 북쪽 언덕 손님 재료 하나.
      { coins: 1300, mats: { mat_foxbead: 1, mat_feather: 1 }, precious: { gem: 1, star_piece: 1 }, visitors: 22 },
    ],
  },
  gate: {
    name: '마을 입구', desc: '손님이 더 자주 온다.',
    levels: [{ coins: 0, spawnSec: 14 }, { coins: 150, spawnSec: 10 }, { coins: 450, mats: { mat_shell: 4 }, spawnSec: 7 }],
  },
  workshop: {
    name: '공방', desc: '재료로 간식과 응원 도구를 만든다.',
    levels: [{ coins: 0, slots: 1, speed: 1 }, { coins: 180, mats: { mat_spoon: 3 }, slots: 2, speed: 1.25 }, { coins: 500, mats: { mat_ember: 5 }, slots: 3, speed: 1.5 }],
  },
  office: {
    name: '주민 사무소', desc: '진행자를 고용한다. 후보가 늘어난다.',
    levels: [{ coins: 0, candidates: 2 }, { coins: 160, candidates: 3 }, { coins: 420, mats: { mat_mist: 3 }, candidates: 4 }],
  },
  warehouse: {
    name: '창고', desc: '재료를 더 많이 둘 수 있다.',
    levels: [{ coins: 0, cap: 20 }, { coins: 120, cap: 50 }, { coins: 380, mats: { mat_fluff: 3 }, cap: 120 }],
  },
  fountain: {
    name: '광장 분수', desc: '광장의 분위기. 손님 기분이 천천히 오른다.',
    levels: [{ coins: 0, moodPerMin: 1 }, { coins: 250, precious: { golden_acorn: 1 }, moodPerMin: 3 }],
  },
  // ── 넷째 묶음 (DESIGN 3.7): 처음엔 빈 부지 (BUILD_HALL), levels[0] = 짓는 비용. ──
  // 전당포: 레벨이 오르면 같은 장신구에 조금 더 빌려준다 (pawnRatio, PAWN.loanRatio에 곱한다).
  pawnshop: {
    name: '전당포', desc: '돈이 떨어진 손님이 장신구를 맡기고 코인을 빌린다. 못 찾아간 장신구는 진열장에 모인다.',
    levels: [{ coins: 120, pawnRatio: 1 }, { coins: 260, pawnRatio: 1.1 }, { coins: 520, mats: { mat_shell: 3 }, pawnRatio: 1.2 }],
  },
  // 은행: 빌려주는 코인 = BANK.base + 레벨 × BANK.perLevel (레벨 표에는 비용만).
  bank: {
    name: '은행', desc: '맡길 장신구도 없는 손님에게 코인을 빌려준다. 떠날 때 못 갚으면 일터에서 일해 갚는다.',
    levels: [{ coins: 200 }, { coins: 420, mats: { mat_pearl: 1 } }, { coins: 800, precious: { gem: 1 } }],
  },
  // 일터 (밭·광산): workers = 시설마다 일하는 자리 수 (지도 자리 4까지), pace = 빚 갚는 빠르기 배수 (반장).
  workyard: {
    name: '일터', desc: '파산한 손님이 밭과 광산에서 일해 빚을 갚는다. 일한 만큼 채소·광석이 나온다.',
    levels: [{ coins: 140, workers: 2, pace: 1 }, { coins: 320, mats: { mat_veggie: 4 }, workers: 3, pace: 1.25 }, { coins: 650, mats: { mat_ore: 4 }, workers: 4, pace: 1.5 }],
  },
} as const;

// ── 장신구·전당포·은행·파산·일터 (넷째 묶음, DESIGN 3.7) ───────────────────────

/** 장신구가 붙는 몸 자리: 머리 위, 목, 옆구리. 붙는 점은 data/accessoryAnchors.ts (종·포즈마다). */
export type AccessorySlot = 'head' | 'neck' | 'side';
export const ACCESSORY_SLOTS: readonly AccessorySlot[] = ['head', 'neck', 'side'];

/**
 * 장신구 (그림 items/<key>, 몸 그림 위에 코드로 붙인다). value = 전당포가 빌려주는 코인 범위 (손님이 올 때 정한다),
 * weight = 나오는 무게 (귀한 것은 드물게), exclude = 이 종에게는 달지 않는다 (고블린+돈주머니는 비하 고정관념: DESIGN 2.1.1).
 */
export interface AccessoryDef {
  readonly name: string;
  readonly slot: AccessorySlot;
  readonly rare: boolean;
  readonly value: readonly [number, number];
  readonly weight: number;
  readonly exclude?: readonly SpeciesId[];
}
export const ACCESSORIES = {
  acc_flower_crown: { name: '꽃관', slot: 'head', rare: false, value: [20, 35], weight: 10 },
  acc_ribbon: { name: '리본', slot: 'head', rare: false, value: [20, 30], weight: 10 },
  acc_straw_hat: { name: '밀짚모자', slot: 'head', rare: false, value: [25, 40], weight: 8 },
  acc_star_pin: { name: '별 머리핀', slot: 'head', rare: false, value: [20, 30], weight: 9 },
  acc_tophat: { name: '작은 실크햇', slot: 'head', rare: true, value: [50, 70], weight: 3.5 },
  acc_mini_crown: { name: '작은 왕관', slot: 'head', rare: true, value: [90, 130], weight: 1.2 },
  acc_scarf: { name: '목도리', slot: 'neck', rare: false, value: [25, 40], weight: 9 },
  acc_bell_collar: { name: '방울 목걸이', slot: 'neck', rare: false, value: [20, 35], weight: 9 },
  acc_pearl_necklace: { name: '진주 목걸이', slot: 'neck', rare: true, value: [80, 110], weight: 1.6 },
  acc_coin_pouch: { name: '돈주머니', slot: 'side', rare: false, value: [30, 40], weight: 8, exclude: ['goblin'] },
} as const satisfies Record<string, AccessoryDef>;
export type AccessoryId = keyof typeof ACCESSORIES;
export const ACCESSORY_IDS = Object.keys(ACCESSORIES) as AccessoryId[];
export function accessoryDef(k: AccessoryId): AccessoryDef {
  return ACCESSORIES[k];
}

/** 들어오는 손님의 장신구: one = 하나 단 손님 비율, two = 둘 단 손님 비율 (자리가 다른 것끼리). 나머지는 없다. */
export const ACCESSORY_SPAWN = { one: 0.35, two: 0.08 } as const;

/**
 * 마을 금고 (전당포·은행이 빌려주는 코인은 마을 코인에서 나간다). 빌려준 뒤에도 reserve는 남아야 하고, 한 번에 마을 코인의 maxShare까지만 빌려준다
 * (마을이 가난할 때 금고가 바닥나지 않게: 아니면 '금고가 비었어요'). emptyToastSec = 그 토스트 간격 (촌장이 코인을 다 쓴 뒤라 자주 날 수 있다).
 */
export const VAULT = { reserve: 25, maxShare: 1, emptyToastSec: 150 } as const;

/**
 * 더 놀고 싶은 마음 (돈이 떨어졌을 때 전당포·은행에 갈 확률, sim/debt.ts wantMore):
 * base + (기분 - 50) × perMood + 남은 끈기 × perPatience + 성격마다 (대담이·흥부자는 더, 겁쟁이는 덜), lo~hi 사이로.
 * 돈이 떨어질 때마다 두 번 묻는다 (거의 다 잃었을 때 한 번, 정말 못 놀 때 한 번: 싫다고 하면 그 단계에서는 다시 묻지 않는다).
 */
export interface WantTable {
  readonly base: number;
  readonly perMood: number;
  readonly perPatience: number;
  readonly traits: Partial<Record<TraitId, number>>;
  readonly lo: number;
  readonly hi: number;
}

/**
 * 전당포: 돈이 떨어진 손님이 더 놀고 싶으면(기분 wantMood 이상, 끈기가 남음, want 확률) 몸에 단 장신구 하나(값이 가장 큰 것)를 맡긴다.
 * 돈이 떨어짐 = 지갑이 가장 싼 한판보다 적거나, 처음 지갑(지갑 + 쓴 코인 - 받은 코인)의 lowFrac보다 적다 (거의 다 잃었다).
 * 빌리는 코인 = 값 × loanRatio × 전당포 레벨 pawnRatio. 되찾는 값 = 빌린 코인 × redeemMarkup.
 * 그 방문 안에 지갑이 되찾는 값 + 다음 판 redeemRounds번 분량(가장 싼 한판 비용 × 이 수)을 넘으면 전당포에 가서 되찾는다. 떠나기 전에 낼 수 있으면 되찾고 떠난다.
 * 못 찾고 떠나면 전당포 컬렉션(GameState.pawnCollection)에 영구히. counterSec = 계산대에서 머무는 초.
 * 아끼는 장신구라 겁쟁이도 맡기기는 한다 (대출보다 마음이 편하다).
 */
export const PAWN = {
  loanRatio: 1,
  redeemMarkup: 1.25,
  redeemRounds: 2,
  wantMood: 15,
  counterSec: 2.6,
  lowFrac: 0.35,
  want: { base: 0.45, perMood: 0.003, perPatience: 0.02, traits: { bold: 0.15, cheerful: 0.05, coward: -0.05, crybaby: 0.05 }, lo: 0.2, hi: 0.95 },
} as const satisfies { want: WantTable; [k: string]: unknown };

/**
 * 은행: 맡길 장신구도 없는 손님이 더 놀고 싶으면 대출 (빚이 없을 때만, 한 방문에 maxLoans번). 빌리는 코인 = base + 은행 레벨 × perLevel, 갚을 돈 = 빌린 코인 × interest.
 * 지갑이 빚 + 다음 판 repayRounds번 분량을 넘으면 은행에 들러 갚는다. 떠날 때 지갑으로 갚을 수 있으면 갚고 떠난다. 못 갚으면 파산 (지갑을 다 내고 남은 빚은 일터에서).
 * 일터가 없으면 빌려주지 않는다 (못 갚은 빚을 갚을 곳이 없다). 빚을 지는 일이라 겁쟁이는 잘 안 빌린다.
 */
export const BANK = {
  base: 30,
  perLevel: 10,
  interest: 1.3,
  maxLoans: 1,
  wantMood: 15,
  repayRounds: 2,
  counterSec: 2.6,
  want: { base: 0.35, perMood: 0.003, perPatience: 0.02, traits: { bold: 0.25, cheerful: 0.05, lucky: 0.1, coward: -0.3 }, lo: 0.05, hi: 0.85 },
  /** 빚이 있는데 갚을 만큼 없으면 끈기가 다 돼도 '갚으려고 한판만 더' (chance, 한 방문에 max판까지). */
  chase: { chance: 0.7, max: 4 },
  /** 일터에서 일하는 채무자 한 명마다 빌리고 싶은 마음이 이만큼 준다 (want에서 뺀다: 큰 마을에서 파산이 몰리지 않게). */
  wary: 0.08,
} as const satisfies { want: WantTable; [k: string]: unknown };

/** 일터의 시설: 밭 (괭이, 채소)과 광산 (곡괭이, 광석 조각). 지도 배치는 map.ts WORK_YARD. */
export type WorkFacility = 'farm' | 'mine';
export const WORK_FACILITIES: readonly WorkFacility[] = ['farm', 'mine'];

/**
 * 파산과 일터. 일하는 동안 secPerCoin초에 빚 1코인을 갚는다 (일터 레벨 pace 배수, 응원·간식으로 잠깐 더 빨리).
 * coinsPerMat코인을 갚을 때마다 그 시설의 재료 하나가 마을 창고로 (그때 한숨·영차 반응). 자리가 없으면 옆에 쪼그리고 기다린다 (오래 기다린 손님부터 자리로).
 * 파산한 손님은 느리게 걷는다 (walkMult). 응원 톡 = cheerMult배 cheerSec초, 간식 = snackMult배 snackSec초.
 * 반장(foreman)은 foreman.everySec마다 일하는 채무자 하나를 다독인다 (mult배 sec초, 게이지가 가장 덜 찬 손님 먼저).
 * 다 갚으면 reliefSec 동안 어둠이 걷히고 기뻐한 뒤 떠나 단골이 된다. mood = 파산했을 때의 기분 (축 처짐).
 * forgiveSec = 파산하고 이만큼 지나도 (빚 걸기 판에서 빚이 늘었거나 자리를 오래 기다렸다) 일터에 있으면 반장이 남은 빚을 덜어 준다 (일이 끝없이 길어지지 않게).
 * waitMutter = 기다리는 채무자가 1초마다 한숨 반응을 낼 확률. prefer = 이 종은 이 시설을 고른다 (자리가 있으면).
 */
export const LABOR = {
  secPerCoin: 4,
  coinsPerMat: 8,
  walkMult: 0.9,
  cheerMult: 1.5,
  cheerSec: 8,
  snackMult: 1.5,
  snackSec: 60,
  foreman: { everySec: 25, mult: 1.3, sec: 6 },
  reliefSec: 1.5,
  mood: 8,
  forgiveSec: 480,
  /** 일터가 보관함에 들어갔거나 길이 끊겨 갈 수 없는 채무자: 길에서 이만큼 기다려도 못 가면 반장이 남은 빚을 덜어 준다 (초). */
  noYardSec: 90,
  waitMutter: 0.05,
  facilities: {
    farm: { name: '밭', tool: 'hoe', material: 'mat_veggie' },
    mine: { name: '광산', tool: 'pickaxe', material: 'mat_ore' },
  },
  prefer: { mole: 'mine', golem: 'mine', dragon: 'mine', radish: 'farm', sprout: 'farm', kabocha: 'farm', sheep: 'farm' },
} as const satisfies {
  facilities: Record<WorkFacility, { name: string; tool: string; material: MaterialId }>;
  prefer: Partial<Record<SpeciesId, WorkFacility>>;
  [k: string]: unknown;
};

/**
 * 빚 걸린 힘겨루기 (줄다리기·밀어내기 대결장의 '빚 걸기 판'): 부를 수 있는 채무자가 minDebtors 이상이면 checkSec마다 chance로 반장이 부스 하나를 고른다
 * (부스마다 cooldownSec에 한 번). 부스가 쉬는 중이면 바로 열고, 아니면 예약해서 지금 판이 끝나면 선수 자리를 비워 두었다가 연다 (holdSec 안에 못 열면 그만).
 * 부를 수 있는 채무자 = 일터로 가는·일하는·기다리는 채무자 가운데 빚이 minStake 이상이고 이번 파산에 빚 걸기 판을 maxPerStint번보다 적게 한 손님.
 * 짝은 빚이 비슷한 채무자끼리 (빚 순서로 늘어놓고 이웃끼리: 지면 상대 빚만큼 늘어나니 공평하게).
 * 선수는 채무자만, 코인 대신 자기 빚을 건다 (참가비·건 코인 0).
 * 구경 손님은 평소처럼 편에 코인을 건다 (밀어내기 구경 자리. 줄다리기는 자리가 모두 선수라 구경만).
 * 이기면 빚 × winKeep (뒤집기·역전 대박이면 0), 지면 상대 빚만큼 더 (밀어내기 = 상대 선수, 줄다리기 = 짝지은 상대 편 선수: 자리 2k ↔ 2k+1).
 * 빚은 maxDebt보다 커지지 않는다 (반장이 봐준다: 일이 끝없이 길어지지 않게).
 * 줄다리기는 편마다 tugSide명까지 (채무자 수를 반으로), 부를 수 있는 채무자가 tugMin명 이상일 때만 (축제 들판은 일터에서 멀다). 채무자가 다 오지 않은 채 maxWaitSec이 지나면 판을 접고 일터로 돌아간다.
 * 부스가 쉬는 중 = 판이 쉬고(idle) 채무자가 설 선수 자리가 비었다 (밀어내기 = 모래판 자리 0·1, 줄다리기 = 모든 자리).
 * watchOnly = 구경하며 거는 자리가 없는 부스 (빚 걸기 판 동안 다른 손님을 앉히지 않는다).
 */
export const DEBT_MATCH = {
  booths: ['ssireum', 'tug'],
  watchOnly: ['tug'],
  minDebtors: 2,
  checkSec: 10,
  chance: 0.6,
  cooldownSec: 90,
  holdSec: 75,
  maxDebt: 120,
  minStake: 8,
  maxPerStint: 1,
  winKeep: 0.5,
  tugSide: 2,
  tugMin: 4,
  maxWaitSec: 150,
} as const satisfies { booths: readonly GroupBoothId[]; watchOnly: readonly GroupBoothId[]; [k: string]: unknown };

// ── 주민 (진행자) ───────────────────────────────────────────────────────

/** 진행자 능력치 1~5: 진행(한판이 빨라진다), 입담(한판마다 기분 +), 손님맞이(그 부스로 오는 손님 +). */
export interface StaffStats {
  readonly pace: number;
  readonly charm: number;
  readonly welcome: number;
}
export const STAFF_STAT_NAMES: Record<keyof StaffStats, string> = { pace: '진행', charm: '입담', welcome: '손님맞이' };

/**
 * 그림이 있는 진행자. 그 부스를 열 수 있는 회관 레벨이 되면 고용 후보로 나온다. art = characters/<key>.
 * booth·role = 어울리는 자리 (BOOTHS[booth].roles의 index): 고용·해금 때 그 자리를 먼저 맡는다.
 */
export const HOST_PRESETS = [
  { art: 'host_slot', name: '방글 아저씨', booth: 'slot', role: 0, stats: { pace: 3, charm: 3, welcome: 2 }, cost: 0 },
  { art: 'host_oddeven', name: '조약돌 할머니', booth: 'oddeven', role: 0, stats: { pace: 2, charm: 3, welcome: 3 }, cost: 0 },
  { art: 'host_cups', name: '찡긋 청년', booth: 'cups', role: 0, stats: { pace: 4, charm: 2, welcome: 2 }, cost: 80 },
  { art: 'host_darts', name: '쏙쏙 언니', booth: 'darts', role: 0, stats: { pace: 3, charm: 2, welcome: 4 }, cost: 120 },
  { art: 'host_wheel', name: '반짝 언니', booth: 'wheel', role: 0, stats: { pace: 3, charm: 4, welcome: 3 }, cost: 150 },
  { art: 'host_duck', name: '낚시 할아버지', booth: 'duck', role: 0, stats: { pace: 2, charm: 4, welcome: 3 }, cost: 140 },
  { art: 'host_ring', name: '휘휘 청년', booth: 'ring', role: 0, stats: { pace: 4, charm: 2, welcome: 3 }, cost: 160 },
  { art: 'race_starter', name: '깃발 소녀', booth: 'race', role: 0, stats: { pace: 4, charm: 2, welcome: 3 }, cost: 160 },
  { art: 'race_caster', name: '확성기 아저씨', booth: 'race', role: 1, stats: { pace: 2, charm: 5, welcome: 3 }, cost: 200 },
  { art: 'race_keeper', name: '달팽이 사육사', booth: 'race', role: 2, stats: { pace: 3, charm: 2, welcome: 4 }, cost: 160 },
  { art: 'host_claw', name: '수줍 소년', booth: 'claw', role: 0, stats: { pace: 4, charm: 2, welcome: 3 }, cost: 240 },
  { art: 'host_pouch', name: '복 아주머니', booth: 'pouch', role: 0, stats: { pace: 2, charm: 4, welcome: 4 }, cost: 260 },
  // 셋째 묶음 단체 놀이 (DESIGN 3.6)
  { art: 'ssireum_referee', name: '홍청 깃발 심판', booth: 'ssireum', role: 0, stats: { pace: 4, charm: 2, welcome: 3 }, cost: 110 },
  { art: 'ssireum_caster', name: '마이크 할머니', booth: 'ssireum', role: 1, stats: { pace: 2, charm: 5, welcome: 3 }, cost: 150 },
  { art: 'boat_starter', name: '세일러 꼬마', booth: 'boat', role: 0, stats: { pace: 4, charm: 3, welcome: 2 }, cost: 160 },
  { art: 'boat_lifeguard', name: '튜브 청년', booth: 'boat', role: 1, stats: { pace: 2, charm: 3, welcome: 4 }, cost: 160 },
  { art: 'kite_master', name: '얼레 할머니', booth: 'kite', role: 0, stats: { pace: 2, charm: 5, welcome: 3 }, cost: 140 },
  { art: 'kite_wind', name: '바람개비 꼬마', booth: 'kite', role: 1, stats: { pace: 4, charm: 2, welcome: 3 }, cost: 130 },
  { art: 'tug_referee', name: '호루라기 청년', booth: 'tug', role: 0, stats: { pace: 4, charm: 2, welcome: 3 }, cost: 220 },
  { art: 'tug_cheer', name: '폼폼 단장', booth: 'tug', role: 1, stats: { pace: 2, charm: 5, welcome: 3 }, cost: 240 },
  { art: 'dig_grandpa', name: '보물 지도 할아버지', booth: 'dig', role: 0, stats: { pace: 2, charm: 3, welcome: 5 }, cost: 240 },
  { art: 'dig_lender', name: '삽 대여 언니', booth: 'dig', role: 1, stats: { pace: 4, charm: 3, welcome: 2 }, cost: 220 },
] as const satisfies readonly { art: string; name: string; booth: BoothId; role: number; stats: StaffStats; cost: number }[];

// ── 배치형 마을 (DESIGN 6.1): 장식·땅 조각 ─────────────────────────────────

/** 장식 (그림 map/<key>, 칸 하나). cost = 코인, aura = 둘레(DECOR_AURA.radius 칸 안)를 지나는 손님 기분 +/분. */
export type DecorId = 'tree_round' | 'tree_pine' | 'bush' | 'flowers' | 'lamp' | 'bench' | 'fence' | 'planter' | 'balloons' | 'rocks' | 'crates' | 'signpost';
export const DECOR = {
  tree_round: { name: '둥근 나무', cost: 30, aura: 1 },
  tree_pine: { name: '뾰족 나무', cost: 30, aura: 1 },
  bush: { name: '덤불', cost: 15, aura: 0.6 },
  flowers: { name: '꽃밭', cost: 20, aura: 1 },
  lamp: { name: '가로등', cost: 25, aura: 0.8 },
  bench: { name: '벤치', cost: 35, aura: 1.2 },
  fence: { name: '울타리', cost: 10, aura: 0.3 },
  planter: { name: '화분', cost: 20, aura: 0.8 },
  balloons: { name: '풍선', cost: 40, aura: 1.5 },
  rocks: { name: '바위', cost: 10, aura: 0.4 },
  crates: { name: '나무 상자', cost: 15, aura: 0.3 },
  signpost: { name: '이정표', cost: 20, aura: 0.5 },
} as const satisfies Record<DecorId, { name: string; cost: number; aura: number }>;
export const DECOR_IDS = Object.keys(DECOR) as DecorId[];
/** 장식 둘레 기분: 손님이 선 칸에서 radius 칸 안(가로·세로 모두)의 장식 aura를 더한다 (cap/분까지). */
export const DECOR_AURA = { radius: 2, cap: 4 } as const;

/**
 * 땅 조각 (map.ts CHUNK × CHUNK 칸): 가진 땅에 이웃한 조각만 산다. 값 = (base + perBought × 산 조각 수) × (1 + ringMult × (고리 - 1)),
 * 고리 = 처음 땅에서 떨어진 조각 수 (map.ts chunkRing). hall[고리] = 그 고리를 사는 데 필요한 마을회관 레벨 (먼 땅일수록 늦게).
 */
export const LAND = { base: 40, perBought: 8, ringMult: 0.3, hall: [1, 1, 2, 3, 4, 5] } as const;

/** 마을회관 레벨마다 새로 오는 손님·부스의 이름표 (옛 구역 이름: 짓기·도감 목록을 묶는 데만 쓴다). */
export const HALL_THEME: Readonly<Record<number, string>> = { 1: '중앙 광장', 2: '연못 동네', 3: '북쪽 언덕', 4: '숲 동네', 5: '축제 들판' };

// ── 손님 기분 ───────────────────────────────────────────────────────────

export const MOOD = {
  start: [55, 75],
  cheerTap: 6,
  cheerCooldownSec: 8,
  leaveBelow: 12,
  /** 결과마다 기분 변화 (성격 배수 전). */
  delta: { jackpot: 35, win: 15, nearMiss: -10, lose: -7, broke: -25 },
  /** 떠날 때 팁: 코인 = 기분 × 비율 × (1 + 딴 판 수 × 0.2). */
  tipPerMood: 0.18,
  /** 떠날 때 특산 재료 확률 (기분 0~100 → 0.25~0.9). */
  materialChance: [0.25, 0.9],
  /** 대박을 낸 손님이 기분 80 이상으로 떠나면 귀한 물건 확률. */
  preciousChance: 0.85,
} as const;

export const SIM = {
  /** 고정 틱 (초). */
  dt: 0.1,
  walkSpeed: 125,
  floatSpeed: 105,
  /** 탭이 숨겨졌다 돌아올 때 몰아서 계산하는 최대 시간 (초). */
  catchUpMaxSec: 300,
  autosaveSec: 10,
  startCoins: 80,
} as const;
