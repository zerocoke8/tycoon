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
    name: '컵 야바위 부스', desc: '컵 셋 중 구슬 찾기', building: 'booth_cups',
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

export type BuildingId = 'hall' | 'gate' | 'workshop' | 'office' | 'warehouse' | 'fountain';

/** 레벨마다 비용과 효과. 레벨 1은 처음부터 있다(비용 없음). */
/**
 * 마을회관 재료: 그 레벨 전에 오는 손님의 재료를 적게씩 (손님 종이 27종으로 늘어 한 종이 오는 비율이 낮아졌다).
 * 새 구역 손님의 재료는 하나씩만 (회관 3 = 솜털, 회관 4 = 광석·양털, 회관 5 = 여우 구슬 + 북쪽 언덕 깃털): 손님이 와서 놀고 떠날 때까지 10분쯤 걸린다.
 * 손님 수(visitors)는 열리는 부스 수를 따라 6·9·13·16·22 (단체 놀이는 한 판에 손님이 여럿 모여야 재미있다. 회관 5는 부스가 15개).
 * 목표 (scripts/sim-check.ts --auto --seeds 24 --minutes 120 중간, 2026-10-15 셋째 묶음 다듬기): 밀어내기 ≈ 5분, 회관 2 ≈ 9분, 다트 ≈ 12분,
 * 오리배 ≈ 17분 (회관 2 구역), 회관 3 ≈ 26분, 경주장 ≈ 28분, 연날리기 ≈ 38분 (회관 3 구역), 회관 4 ≈ 48분, 회관 5 (축제 들판) ≈ 69분, 줄다리기 ≈ 73분.
 */
export const BUILDINGS = {
  hall: {
    name: '마을회관', desc: '마을 레벨. 새 손님과 새 부지가 열린다.',
    levels: [
      { coins: 0, visitors: 6 },
      { coins: 200, mats: { mat_ember: 2, mat_shell: 2 }, visitors: 9 },
      { coins: 350, mats: { mat_spoon: 2, mat_fluff: 1 }, precious: { gem: 1 }, visitors: 13 },
      { coins: 700, mats: { mat_ore: 1, mat_wool: 1, mat_pearl: 1 }, precious: { star_piece: 1, golden_acorn: 1 }, visitors: 16 },
      // 회관 5 = 축제 들판 (줄다리기·보물찾기). 숲 동네 손님 재료 하나와 북쪽 언덕 손님 재료 하나.
      { coins: 900, mats: { mat_foxbead: 1, mat_feather: 1 }, precious: { gem: 1, star_piece: 1 }, visitors: 22 },
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
} as const;

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
