// 마을 지도 배치 (세계 좌표 px). 바닥(풀밭·길·광장·연못)은 그림 한 장이 아니라 코드로 그린다:
// Codex 바닥 그림(tools/art-raw/map/ground.png)에서 잰 색과 선 굵기를 그대로 써서, 지도를 얼마든지 크게, 구역을 나눠 열 수 있게.
// 건물·소품·몬스터는 Codex 그림. 디버그 오버레이(지도에서 D 키)로 노드·자리를 보고 이 파일의 숫자를 고친다.
//
// 길 그리는 법 (화면 쪽): 모든 길·광장의 '테두리'(roadEdge, 폭 + 2×edge)를 먼저 다 그리고, 그 위에 '속'(road)을 다 그린다.
// 그래야 길이 만나는 곳에 선이 생기지 않는다 (바닥 그림처럼). 끝은 둥글게(round cap/join).
//
// 큰 지도 (8000×7800): 가운데 세로띠가 중앙 구역(처음부터), 오른쪽 연못 동네(회관 2), 위쪽 북쪽 언덕(회관 3), 왼쪽 숲 동네(회관 4),
// 맨 오른쪽 축제 들판(회관 5, 셋째 묶음에서 지도를 오른쪽으로 1600 넓혔다: 앞 구역 좌표는 그대로).
// 중앙의 손님 동선(입구 → 광장 → 부스)은 예전 지도의 약 1.3배라 걷는 시간이 크게 늘지 않는다.
// 둘째 묶음 부스 (DESIGN 3.5): 돌림판 = 중앙 아래 (입구 오른쪽), 오리 낚시·고리 던지기 = 연못 동네, 몬스터 경주장 = 북쪽 언덕,
// 인형 뽑기·복주머니 = 숲 동네. 바깥 구역 부스는 구역 세로길에서 짧은 갈래길(ROADS)로 들어간다.
// 연못은 자기 구역 사각형 안쪽으로 60px 넘게 들어와 있어야 한다 (구름 가장자리 밖으로 비치지 않게).
// 셋째 묶음 단체 놀이 (DESIGN 3.6): 씨름장 = 중앙 광장 아래 왼쪽 (큰길 옆), 오리배 = 연못 동네 큰 연못 (물길 BOAT_COURSE, 선착장은 남쪽 물가),
// 연날리기 = 북쪽 언덕 경주장 오른쪽 (KITE_FIELD), 줄다리기·보물찾기 = 축제 들판 (TUG_FIELD, DIG_FIELD). 아래 가로길이 연못 동네를 지나 축제 들판까지 이어진다.
// 넷째 묶음 (DESIGN 3.7): 전당포·은행 = 큰길 오른쪽 '은행 골목' (광장 바로 아래, 다트 부스 위), 일터(밭·광산) = 중앙 오른쪽 아래 구석
// (돌림판 갈래길에서 이어진다, WORK_YARD). 그림 크기는 아직 대략 (그림이 오면 배율·자리를 다시 맞춘다).

import type { BoothId, BuildingId, WorkFacility } from './defs.ts';

export const WORLD = { w: 8000, h: 7800 } as const;

/** 바닥 그림에서 잰 색과 선 (세계 px, 바닥 그림의 2배 크기 기준). */
export const GROUND_STYLE = {
  grass: 0x93b468,
  road: 0xebc68e,
  roadEdge: 0x402c1c,
  /** 길 테두리 굵기 (한쪽, 세계 px). 바닥 그림의 약 4px × 2. */
  edge: 7,
  /** 길 위 작은 조약돌 점 색. */
  pebble: 0xd9b27a,
  /** 풀 한 포기(짧은 획 셋) 색. */
  tuft: 0x4f7a3f,
  pond: 0x74bae5,
} as const;

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** 구역: 마을회관 레벨이 hall 이상이면 열린다. 닫힌 구역은 구름이 덮는다. */
export type DistrictId = 'core' | 'east' | 'west' | 'north' | 'festival';
export interface District {
  readonly name: string;
  readonly hall: number;
  /** 구역 사각형 (구름으로 덮을 영역). */
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}
export const DISTRICTS: Record<DistrictId, District> = {
  core: { name: '중앙 광장', hall: 1, rect: { x: 1700, y: 2300, w: 3000, h: 5500 } },
  east: { name: '연못 동네', hall: 2, rect: { x: 4700, y: 2300, w: 1700, h: 5500 } },
  north: { name: '북쪽 언덕', hall: 3, rect: { x: 0, y: 0, w: 6400, h: 2300 } },
  west: { name: '숲 동네', hall: 4, rect: { x: 0, y: 2300, w: 1700, h: 5500 } },
  festival: { name: '축제 들판', hall: 5, rect: { x: 6400, y: 0, w: 1600, h: 7800 } },
};

// ── 바닥 모양 ──────────────────────────────────────────────────────────

export interface Road {
  readonly pts: readonly Pt[];
  /** 길 속 폭 (세계 px). */
  readonly w: number;
  readonly district: DistrictId;
}
export const ROADS: readonly Road[] = [
  // 지도 아래 끝(마을 밖)에서 입구를 지나 광장까지 큰길
  { pts: [{ x: 3200, y: 7800 }, { x: 3200, y: 4840 }], w: 165, district: 'core' },
  // 광장에서 마을회관 마당까지
  { pts: [{ x: 3200, y: 4170 }, { x: 3200, y: 2960 }], w: 150, district: 'core' },
  // 광장의 대각선 길 넷 (바깥 구역까지 이어진다)
  { pts: [{ x: 2822, y: 4306 }, { x: 2552, y: 4122 }, { x: 2094, y: 3809 }, { x: 1700, y: 3540 }, { x: 1250, y: 3240 }], w: 130, district: 'core' },
  { pts: [{ x: 3578, y: 4306 }, { x: 3902, y: 4122 }, { x: 4302, y: 3874 }, { x: 4700, y: 3628 }, { x: 5150, y: 3350 }], w: 130, district: 'core' },
  { pts: [{ x: 2822, y: 4738 }, { x: 2444, y: 4932 }, { x: 2094, y: 5083 }, { x: 1700, y: 5254 }, { x: 1250, y: 5420 }], w: 130, district: 'core' },
  { pts: [{ x: 3578, y: 4738 }, { x: 3956, y: 4910 }, { x: 4306, y: 5040 }, { x: 4700, y: 5190 }, { x: 5150, y: 5300 }], w: 130, district: 'core' },
  // 아래 가로길 (컵·다트 부스 앞)
  { pts: [{ x: 1200, y: 6060 }, { x: 1700, y: 6075 }, { x: 2440, y: 6092 }, { x: 3200, y: 6100 }, { x: 3960, y: 6092 }, { x: 4700, y: 6075 }, { x: 5200, y: 6060 }], w: 120, district: 'core' },
  // 연못 동네 안 세로길
  { pts: [{ x: 5150, y: 3350 }, { x: 5080, y: 4500 }, { x: 5150, y: 5300 }, { x: 5200, y: 6060 }, { x: 5150, y: 6900 }], w: 110, district: 'east' },
  // 숲 동네 안 세로길
  { pts: [{ x: 1250, y: 3240 }, { x: 1180, y: 4300 }, { x: 1250, y: 5420 }, { x: 1200, y: 6060 }, { x: 1250, y: 6900 }], w: 110, district: 'west' },
  // 북쪽 언덕으로 (회관 뒤를 지나 갈림길)
  { pts: [{ x: 3200, y: 2700 }, { x: 3200, y: 1750 }, { x: 2300, y: 1250 }], w: 120, district: 'north' },
  { pts: [{ x: 3200, y: 1750 }, { x: 4100, y: 1250 }], w: 120, district: 'north' },
  // 둘째 묶음 부스로 들어가는 갈래길 (부스 앞 자리 아래로 지나간다: 줄이 이 길 위에 선다)
  { pts: [{ x: 3200, y: 6650 }, { x: 3620, y: 6718 }, { x: 3990, y: 6765 }], w: 105, district: 'core' },
  { pts: [{ x: 5150, y: 5300 }, { x: 5240, y: 5318 }, { x: 5560, y: 5350 }], w: 100, district: 'east' },
  { pts: [{ x: 5200, y: 6060 }, { x: 5280, y: 6074 }, { x: 5600, y: 6102 }], w: 100, district: 'east' },
  { pts: [{ x: 1193, y: 4100 }, { x: 1110, y: 4104 }, { x: 760, y: 4100 }], w: 100, district: 'west' },
  { pts: [{ x: 1235, y: 5180 }, { x: 1110, y: 5188 }, { x: 760, y: 5197 }], w: 100, district: 'west' },
  // 경주장: 오른쪽 갈림길에서 경주로 오른쪽을 돌아 관중석 앞까지
  { pts: [{ x: 4100, y: 1250 }, { x: 4080, y: 820 }, { x: 3720, y: 772 }, { x: 3380, y: 790 }], w: 110, district: 'north' },
  // 셋째 묶음: 씨름장 (큰길에서 왼쪽), 오리배 선착장 (연못 동네 세로길에서 오른쪽), 연날리기 (북쪽 언덕 오른쪽 갈림길에서)
  { pts: [{ x: 3200, y: 5404 }, { x: 2950, y: 5402 }], w: 100, district: 'core' },
  { pts: [{ x: 5080, y: 4500 }, { x: 5330, y: 4480 }, { x: 5650, y: 4462 }], w: 100, district: 'east' },
  { pts: [{ x: 4100, y: 1250 }, { x: 4440, y: 1432 }, { x: 4820, y: 1452 }], w: 100, district: 'north' },
  // 넷째 묶음: 은행 골목 (큰길에서 오른쪽: 전당포 → 은행), 일터 길 (돌림판 갈래길 끝에서 아래로)
  { pts: [{ x: 3200, y: 5455 }, { x: 3600, y: 5462 }, { x: 4080, y: 5470 }, { x: 4260, y: 5472 }], w: 100, district: 'core' },
  { pts: [{ x: 3990, y: 6765 }, { x: 4060, y: 6900 }, { x: 4150, y: 7080 }], w: 100, district: 'core' },
  // 축제 들판으로: 고리 던지기 갈래길에서 오른쪽으로 이어 가고, 들판 안 세로길 (줄다리기 ↑, 보물찾기 ↓)
  { pts: [{ x: 5600, y: 6102 }, { x: 6060, y: 6130 }, { x: 6400, y: 6150 }], w: 110, district: 'east' },
  { pts: [{ x: 6400, y: 6150 }, { x: 6750, y: 6160 }], w: 110, district: 'festival' },
  { pts: [{ x: 6770, y: 4600 }, { x: 6790, y: 5420 }, { x: 6750, y: 6160 }, { x: 6775, y: 6720 }, { x: 6780, y: 7150 }], w: 120, district: 'festival' },
];

/** 광장·마당 (타원). */
export const PLAZAS: readonly { readonly c: Pt; readonly rx: number; readonly ry: number; readonly district: DistrictId }[] = [
  { c: { x: 3200, y: 4500 }, rx: 560, ry: 380, district: 'core' },
  { c: { x: 3200, y: 2830 }, rx: 340, ry: 215, district: 'core' },
  // 축제 들판: 줄다리기 모래 마당, 보물찾기 흙 마당
  { c: { x: 7350, y: 5300 }, rx: 560, ry: 175, district: 'festival' },
  { c: { x: 7310, y: 6725 }, rx: 420, ry: 235, district: 'festival' },
];

/**
 * 연못 (둥근 덩어리: 중심과 반지름, 모양은 화면 쪽이 씨앗 난수로 울퉁불퉁하게). wobble = 울퉁불퉁한 정도 (1 = 보통, 둘레가 반지름의 ±26%까지).
 * 오리배 연못(첫째)은 물길(BOAT_COURSE)이 들어가게 크게, 덜 울퉁불퉁하게 (셋째 묶음에서 위로 옮기고 키웠다: 남쪽 물가에 선착장).
 */
export const PONDS: readonly { readonly c: Pt; readonly rx: number; readonly ry: number; readonly district: DistrictId; readonly wobble?: number }[] = [
  { c: { x: 5800, y: 3880 }, rx: 480, ry: 330, district: 'east', wobble: 0.35 },
  { c: { x: 5820, y: 6750 }, rx: 210, ry: 150, district: 'east' },
  { c: { x: 4150, y: 3420 }, rx: 170, ry: 115, district: 'core' },
  { c: { x: 1250, y: 1250 }, rx: 260, ry: 180, district: 'north' },
];

// ── 건물 자리 (건물 그림의 아래 가운데가 놓이는 점) ────────────────────────

export const BUILDING_SPOTS: Record<BuildingId, Pt> = {
  hall: { x: 3200, y: 2905 },
  fountain: { x: 3200, y: 4640 },
  workshop: { x: 2200, y: 4860 },
  office: { x: 4200, y: 4860 },
  warehouse: { x: 2380, y: 6900 },
  gate: { x: 3200, y: 7150 },
  // 넷째 묶음: 전당포·은행 = 그림 아래 가운데, 일터 = 일터 가운데 (빈 부지 표식·누르기·지도에서 보기 자리, 그림은 WORK_YARD의 시설들).
  pawnshop: { x: 3600, y: 5330 },
  bank: { x: 4080, y: 5390 },
  workyard: { x: 4200, y: 7230 },
};

/** 건물 그림 배율 (세계 px / 캔버스 px, 없으면 ART_SCALE.building). 전당포·은행은 놀이부스 크기로. */
export const BUILDING_K: Partial<Record<BuildingId, number>> = { pawnshop: 0.44, bank: 0.44 };

/**
 * 손님이 볼일을 보는 가게 (전당포·은행): counter = 계산대 앞에 서는 자리 (먼저 온 손님부터, 다 차면 마지막 자리 둘레),
 * npc = 주인이 서는 점 (characters/<art>, 계산대를 본다), front = 길 노드.
 */
export interface ShopSpot {
  readonly counter: readonly Pt[];
  readonly npc: Pt;
  readonly art: string;
  readonly front: NodeId;
}
export const SHOP_SPOTS: Record<'pawnshop' | 'bank', ShopSpot> = {
  pawnshop: { counter: [{ x: 3585, y: 5392 }, { x: 3505, y: 5404 }, { x: 3665, y: 5408 }], npc: { x: 3735, y: 5372 }, art: 'pawnbroker', front: 'pawn_front' },
  bank: { counter: [{ x: 4065, y: 5446 }, { x: 3985, y: 5452 }, { x: 4140, y: 5456 }], npc: { x: 4225, y: 5428 }, art: 'banker', front: 'bank_front' },
};

/**
 * 일터 (중앙 오른쪽 아래 구석, 일터 레벨 1부터): 시설 둘 (밭 = 바닥에 깔리는 그림, 광산 = 굴 입구 그림).
 * spots = 일하는 자리 (일터 레벨의 workers만큼 앞에서부터 쓴다), wait = 자리가 없을 때 쪼그리고 기다리는 자리 (다 차면 마지막 자리 둘레),
 * face = 일하는 손님이 바라보는 점 (밭 가운데·굴 입구). props = 소품 (map/<key>), foreman = 반장이 서는 점, front = 길 노드, center = 구경 반응 가운데.
 */
export interface WorkFacilitySpot {
  readonly art: string;
  readonly at: Pt;
  readonly k: number;
  readonly flat: boolean;
  readonly spots: readonly Pt[];
  readonly wait: readonly Pt[];
  readonly face: Pt;
}
export const WORK_YARD: {
  readonly facilities: Record<WorkFacility, WorkFacilitySpot>;
  readonly props: readonly { readonly key: string; readonly at: Pt; readonly k: number; readonly flip?: boolean }[];
  readonly foreman: Pt;
  readonly front: NodeId;
  readonly center: Pt;
} = {
  facilities: {
    farm: {
      art: 'farm_plot',
      at: { x: 3900, y: 7410 },
      k: 0.56,
      flat: true,
      // 밭 흙 위 두 줄을 엇갈려 (앞뒤 110, 옆 75: 광산처럼 앞줄 게이지·괭이가 뒷줄 손님 몸에 얹히지 않게).
      // 앞 둘(일터 레벨 1)은 뒷줄 왼쪽·앞줄 오른쪽으로 멀리, 레벨이 오르면 사이를 채운다.
      spots: [
        { x: 3800, y: 7215 },
        { x: 4025, y: 7325 },
        { x: 3950, y: 7215 },
        { x: 3875, y: 7325 },
      ],
      // 밭 오른쪽 풀밭에 두 줄로 엇갈려 (쪼그린 손님의 게이지가 뒷줄 손님에 얹히지 않게).
      wait: [
        { x: 4125, y: 7345 },
        { x: 4250, y: 7360 },
        { x: 4185, y: 7470 },
        { x: 4310, y: 7480 },
      ],
      face: { x: 3910, y: 7270 },
    },
    mine: {
      art: 'mine_entrance',
      at: { x: 4470, y: 7020 },
      k: 0.4,
      flat: false,
      // 입구 앞에 앞뒤로 엇갈려 (곡괭이·빚 게이지가 옆 손님과 겹치지 않게).
      spots: [
        { x: 4335, y: 7068 },
        { x: 4440, y: 7112 },
        { x: 4545, y: 7068 },
        { x: 4650, y: 7112 },
      ],
      wait: [
        { x: 4610, y: 7196 },
        { x: 4510, y: 7222 },
        { x: 4410, y: 7206 },
        { x: 4560, y: 7290 },
      ],
      face: { x: 4470, y: 6990 },
    },
  },
  props: [
    { key: 'ore_cart', at: { x: 4262, y: 7012 }, k: 0.21 },
    { key: 'crop_basket', at: { x: 3762, y: 7402 }, k: 0.11 },
  ],
  foreman: { x: 4235, y: 7175 },
  front: 'yard_front',
  center: { x: 4200, y: 7200 },
};

/** 촌장이 서 있는 곳 (마을회관 앞마당 오른쪽 끝). */
export const CHIEF_SPOT: Pt = { x: 3390, y: 3000 };

/**
 * 놀이부스: 건물 자리, 손님이 노는 자리, 줄 서는 자리, 길 위의 앞 노드, 상금 항아리 자리, 진행자가 서는 자리들.
 * hosts = 진행자 자리마다 서는 점 (defs.ts BOOTHS[b].roles와 같은 순서·같은 길이). 보통 부스는 하나.
 * 진행자 0은 자리 0 옆에 서서 손님을 보고, 앉은 손님은 진행자 0을 본다 (sim과 화면이 같은 점을 쓴다). 줄은 진행자 반대쪽으로.
 * 항아리가 건물 자리보다 위(pot.y < base.y)면 부스 그림의 계산대 위에 놓인 항아리다 (화면이 부스 앞에 그린다).
 * props = 부스 그림과 같이 놓는 그림 (map/<key>, 아래 가운데가 at, 배율 k = 세계 px / 캔버스 px). 닫혀 있으면 흐리게.
 */
export interface BoothSpot {
  readonly base: Pt;
  readonly seats: readonly Pt[];
  readonly queue: readonly Pt[];
  readonly front: NodeId;
  readonly pot: Pt;
  readonly hosts: readonly Pt[];
  /** flat = 바닥에 깔리는 그림 (손님이 그 위에 선다: 모래판·흙더미·선착장). 그림자층에 그린다. */
  readonly props?: readonly { readonly key: string; readonly at: Pt; readonly k: number; readonly flat?: boolean }[];
  /** 부스 그림이 바닥에 깔린다 (씨름 모래판·오리배 선착장): 그림자층에 그리고, 손님 길이 그 위를 지나도 된다 (path.ts crossesBooth에서 뺀다). */
  readonly flat?: boolean;
  /** 부스 그림 배율 (세계 px / 캔버스 px, 없으면 ART_SCALE.booth). */
  readonly buildingK?: number;
}

/**
 * 고리 모양 물길·경주로 (레인 여럿). 레인 i(0 = 안쪽 ~ lanes-1 = 바깥쪽)의 가운데 선: 중심에서 가로 rx + o, 세로 ry + o × squash (o = (i - (lanes-1)/2) × laneWidth).
 * 진행 p(0~1)의 각도 = startAngle + (endAngle - startAngle) × p (화면 좌표: 0 = 오른쪽, π/2 = 아래). 경주장 RACE_TRACK, 오리배 BOAT_COURSE.
 */
export interface LoopCourse {
  readonly center: Pt;
  readonly rx: number;
  readonly ry: number;
  readonly laneWidth: number;
  readonly lanes: number;
  readonly squash: number;
  readonly startAngle: number;
  readonly endAngle: number;
}

/** 고리 길 c의 레인 lane, 진행 p 자리와 그 점에서 나아가는 방향 (단위 벡터). p가 범위를 넘어도 같은 타원을 따라 계산한다. */
export function lanePoint(c: LoopCourse, lane: number, p: number): { x: number; y: number; dx: number; dy: number } {
  const o = (lane - (c.lanes - 1) / 2) * c.laneWidth;
  const rx = c.rx + o;
  const ry = c.ry + o * c.squash;
  const span = c.endAngle - c.startAngle;
  const a = c.startAngle + span * p;
  // 방향 = d(점)/dp.
  const tx = -Math.sin(a) * rx * span;
  const ty = Math.cos(a) * ry * span;
  const len = Math.hypot(tx, ty) || 1;
  return { x: c.center.x + Math.cos(a) * rx, y: c.center.y + Math.sin(a) * ry, dx: tx / len, dy: ty / len };
}

/**
 * 몬스터 경주장 경주로 (북쪽 언덕). 바닥과 같이 코드로 그린다: 타원 모래 길(레인 4), 안쪽 풀밭, 레인 선.
 * 레인 i(0 = 안쪽 ~ 3 = 바깥쪽)의 가운데 선: 중심에서 가로 rx + o, 세로 ry + o × squash (o = (i - 1.5) × laneWidth).
 * squash = 비스듬한 시점이라 세로로 눌린 레인 폭 비율. 각도는 화면 좌표 (0 = 오른쪽, π/2 = 아래, -π/2 = 위).
 * 선수 i는 레인 i를 달린다 (racers/<RACE.racers[i].key>). 진행 p(0~1)의 각도 = startAngle + (endAngle - startAngle) × p:
 * 왼쪽 끝 출발대(앞을 보고 아래로 나온다) → 아래 직선(오른쪽으로) → 오른쪽 끝(위로) → 관중석 앞 위 직선(왼쪽으로) → 결승선.
 * gate·finish = 그림(map/race_gate, map/race_finish)의 아래 가운데. 관중석(map/race_stand)은 BOOTH_SPOTS.race.base.
 * 아래 바깥 가장자리가 북쪽 언덕 갈림길(n_mid → n_w·n_e) 테두리와 풀밭 약 20px 떨어지게 (닿으면 길이 경주로로 이어져 보인다).
 * 지도는 출발대 바로 앞(모든 레인이 gate.y 아래)을 출발선으로 그린다 (view/mapUtil.ts RACE_START_P).
 */
export const RACE_TRACK = {
  center: { x: 3200, y: 1150 },
  rx: 620,
  ry: 220,
  laneWidth: 46,
  lanes: 4,
  squash: 0.7,
  startAngle: Math.PI,
  endAngle: -0.52 * Math.PI,
  gate: { x: 2580, y: 1185 },
  finish: { x: 3167, y: 995 },
  stand: { x: 3200, y: 670 },
} as const;

/** 경주로 레인 lane(0~3)의 진행 p(0~1) 자리와 그 점에서 달리는 방향 (단위 벡터). 각도가 줄어드는 쪽으로 달린다. */
export function trackPoint(lane: number, p: number): { x: number; y: number; dx: number; dy: number } {
  return lanePoint(RACE_TRACK, lane, p);
}

/**
 * 오리배 물길 (연못 동네 큰 연못 PONDS[0] 안, 레인 4 = 배 번호). 각도가 커지는 쪽(시계 방향)으로 돈다:
 * 왼쪽 아래(출발) → 왼쪽 끝 → 위 → 오른쪽 끝(결승). 출발·결승은 선착장(남쪽 물가, 차양) 밖 양옆이라 지도에서 1등이 다 보인다.
 * 결승 뒤에는 오른쪽 아래로 조금 미끄러지고, 아래 물길(선착장 앞)은 판이 끝나 출발선으로 돌아올 때만 지난다 (선착장 쪽에서는 배가 왼쪽으로: 그림 그대로).
 * 레인 폭은 경주장과 같이 (배 그림 약 95px가 옆 레인과 겹치지 않게). 물결 자국·레인 표시는 화면(view/group/boat.ts)이 코드로 그린다.
 */
export const BOAT_COURSE = {
  center: { x: 5800, y: 3880 },
  rx: 300,
  ry: 190,
  laneWidth: 46,
  lanes: 4,
  squash: 0.7,
  startAngle: 0.85 * Math.PI,
  endAngle: 2.02 * Math.PI,
} as const satisfies LoopCourse;

/** 오리배 레인 lane(0~3)의 진행 p(0~1) 자리와 나아가는 방향. */
export function boatPoint(lane: number, p: number): { x: number; y: number; dx: number; dy: number } {
  return lanePoint(BOAT_COURSE, lane, p);
}

/**
 * 씨름장 모래판 (중앙 광장 아래 왼쪽, 큰길에서 갈래길). 부스 그림 map/ssireum_ring이 바닥에 깔리고 (BOOTH_SPOTS.ssireum.base = 모래판 아래 끝),
 * 선수 둘(자리 0 홍·1 청)이 가운데에서 맞붙는다: p(t)만큼 홍(왼쪽)·청(오른쪽)이 밀고 밀린다 (reach = p 1일 때 밀려나는 거리, 세계 px).
 */
export const SSIREUM_RING = { center: { x: 2640, y: 5205 }, rx: 190, ry: 105, reach: 70 } as const;

/**
 * 연날리기 마당 (북쪽 언덕, 경주장 오른쪽). flyers = 연 날리는 손님 자리 0~3 (연 k = 자리 k, 오른쪽으로 나란히), bettors = 구경하며 거는 손님 자리 4·5.
 * sky = 연이 나는 하늘 (세계 좌표 사각형): 연 k는 flyers[k] 위에서 높이 0(skyLow)~1(skyHigh), 좌우 -1~1(sway px)로 난다.
 * 연과 줄은 하늘 층(모든 것 위)에 그린다. center = 구경 반응 가운데.
 */
export const KITE_FIELD = {
  flyers: [
    { x: 4520, y: 1270 },
    { x: 4650, y: 1270 },
    { x: 4780, y: 1270 },
    { x: 4910, y: 1270 },
  ],
  bettors: [
    { x: 4585, y: 1352 },
    { x: 4845, y: 1352 },
  ],
  sky: { x: 4330, y: 260, w: 780, h: 700 },
  skyLow: 860,
  skyHigh: 380,
  sway: 95,
  center: { x: 4715, y: 1100 },
} as const;

/**
 * 줄다리기 마당 (축제 들판). 밧줄은 가로: 홍(자리 짝수)이 왼쪽, 청(홀수)이 오른쪽. center = 밧줄 가운데(빨간 리본)의 처음 자리,
 * lines = 승리 선 (가운데에서 ±lineHalf: 리본이 홍 쪽 선을 넘으면 홍 승리), reach = c 1일 때 리본·편 전체가 끌려가는 거리.
 * flags = 깃발(map/tug_flag_red·blue) 자리, ropeY = 밧줄 높이 (발에서 위로, 손 높이).
 */
export const TUG_FIELD = {
  center: { x: 7350, y: 5300 },
  lineHalf: 150,
  reach: 150,
  ropeY: 44,
  flags: [
    { x: 6840, y: 5285 },
    { x: 7860, y: 5285 },
  ],
} as const;

/**
 * 보물찾기 마당 (축제 들판). spots = 판 자리 0~5 (흙더미 map/dirt_mound, 손님은 오른쪽 옆 자리 BOOTH_SPOTS.dig.seats에 서서 판다),
 * chests = 상자가 묻힐 수 있는 곳 (앞 여섯 = 판 자리, 뒤 셋 = 판 자리 사이). 상자에서 DIG.nearPx 안의 판 자리 = '바로 옆'.
 */
export const DIG_FIELD = {
  spots: [
    { x: 7050, y: 6600 },
    { x: 7300, y: 6600 },
    { x: 7550, y: 6600 },
    { x: 7050, y: 6850 },
    { x: 7300, y: 6850 },
    { x: 7550, y: 6850 },
  ],
  chests: [
    { x: 7050, y: 6600 },
    { x: 7300, y: 6600 },
    { x: 7550, y: 6600 },
    { x: 7050, y: 6850 },
    { x: 7300, y: 6850 },
    { x: 7550, y: 6850 },
    { x: 7175, y: 6725 },
    { x: 7425, y: 6725 },
    { x: 7675, y: 6725 },
  ],
  center: { x: 7310, y: 6725 },
} as const;

/** 보물찾기 판 자리 i에서 손님이 서는 곳 (흙더미 오른쪽). */
const digSeat = (i: number): Pt => {
  const s = DIG_FIELD.spots[i] ?? DIG_FIELD.center;
  return { x: s.x + 48, y: s.y + 8 };
};

export const BOOTH_SPOTS: Record<BoothId, BoothSpot> = {
  slot: {
    base: { x: 2633, y: 3874 },
    seats: [{ x: 2658, y: 4009 }, { x: 2543, y: 4034 }],
    queue: [{ x: 2490, y: 4110 }, { x: 2410, y: 4055 }, { x: 2330, y: 4000 }, { x: 2250, y: 3945 }],
    front: 'slot_front',
    // booth_slot 그림의 계산대 위 항아리 자리 (그림에서 잰 값).
    pot: { x: 2563, y: 3758 },
    hosts: [{ x: 2760, y: 3995 }],
  },
  oddeven: {
    base: { x: 3583, y: 3949 },
    seats: [{ x: 3523, y: 4099 }, { x: 3643, y: 4089 }],
    queue: [{ x: 3760, y: 4173 }, { x: 3840, y: 4127 }, { x: 3920, y: 4081 }, { x: 4000, y: 4031 }],
    front: 'oddeven_front',
    pot: { x: 3808, y: 3989 },
    hosts: [{ x: 3415, y: 4085 }],
  },
  cups: {
    base: { x: 2579, y: 5848 },
    seats: [{ x: 2629, y: 5978 }, { x: 2509, y: 5988 }],
    queue: [{ x: 2429, y: 6092 }, { x: 2339, y: 6088 }, { x: 2249, y: 6080 }, { x: 2159, y: 6072 }],
    front: 'cups_front',
    pot: { x: 2809, y: 5888 },
    hosts: [{ x: 2732, y: 5964 }],
  },
  darts: {
    base: { x: 3832, y: 5848 },
    seats: [{ x: 3772, y: 5978 }, { x: 3892, y: 5988 }],
    queue: [{ x: 3962, y: 6092 }, { x: 4052, y: 6088 }, { x: 4142, y: 6080 }, { x: 4232, y: 6072 }],
    front: 'darts_front',
    pot: { x: 3562, y: 5878 },
    hosts: [{ x: 3667, y: 5964 }],
  },
  // 중앙 아래, 입구 오른쪽 (길이 왼쪽에 있어 진행자는 오른쪽, 줄은 왼쪽 갈래길 위).
  wheel: {
    base: { x: 4080, y: 6560 },
    seats: [{ x: 4140, y: 6690 }, { x: 4020, y: 6700 }],
    queue: [{ x: 3940, y: 6758 }, { x: 3860, y: 6748 }, { x: 3780, y: 6738 }, { x: 3700, y: 6728 }],
    front: 'wheel_front',
    pot: { x: 4350, y: 6590 },
    hosts: [{ x: 4245, y: 6676 }],
  },
  // 연못 동네 (구역 세로길이 왼쪽: 진행자는 오른쪽, 줄은 왼쪽 갈래길 위).
  duck: {
    base: { x: 5650, y: 5150 },
    seats: [{ x: 5710, y: 5280 }, { x: 5590, y: 5290 }],
    queue: [{ x: 5500, y: 5345 }, { x: 5420, y: 5338 }, { x: 5340, y: 5331 }, { x: 5262, y: 5323 }],
    front: 'duck_front',
    pot: { x: 5920, y: 5180 },
    hosts: [{ x: 5815, y: 5266 }],
  },
  ring: {
    base: { x: 5700, y: 5900 },
    seats: [{ x: 5760, y: 6030 }, { x: 5640, y: 6040 }],
    queue: [{ x: 5545, y: 6098 }, { x: 5465, y: 6092 }, { x: 5385, y: 6086 }, { x: 5305, y: 6080 }],
    front: 'ring_front',
    pot: { x: 5970, y: 5930 },
    hosts: [{ x: 5865, y: 6016 }],
  },
  // 북쪽 언덕: 관중석(race_stand)이 경주로 위쪽에서 앞(경주로)을 본다. 자리 6 = 관중석 앞 두 줄 (앞줄 먼저, 가운데부터).
  // 진행자: 0 출발 신호 = 출발대 옆, 1 해설자 = 관중석 왼쪽, 2 사육사 = 경주로 안쪽 풀밭 (출발대 가까이).
  race: {
    base: RACE_TRACK.stand,
    seats: [
      { x: 3140, y: 782 },
      { x: 3260, y: 782 },
      { x: 3020, y: 782 },
      { x: 3200, y: 720 },
      { x: 3080, y: 720 },
      { x: 3320, y: 720 },
    ],
    queue: [{ x: 3400, y: 800 }, { x: 3480, y: 796 }, { x: 3560, y: 792 }, { x: 3640, y: 788 }],
    front: 'race_front',
    pot: { x: 3440, y: 712 },
    hosts: [{ x: 2420, y: 1210 }, { x: 2900, y: 735 }, { x: 2800, y: 1170 }],
    props: [
      { key: 'race_gate', at: RACE_TRACK.gate, k: 0.3 },
      { key: 'race_finish', at: RACE_TRACK.finish, k: 0.3 },
    ],
  },
  // 숲 동네 (구역 세로길이 오른쪽: 진행자는 왼쪽, 줄은 오른쪽 갈래길 위).
  claw: {
    base: { x: 650, y: 3900 },
    seats: [{ x: 590, y: 4030 }, { x: 710, y: 4040 }],
    queue: [{ x: 800, y: 4098 }, { x: 880, y: 4100 }, { x: 960, y: 4102 }, { x: 1040, y: 4104 }],
    front: 'claw_front',
    pot: { x: 380, y: 3930 },
    hosts: [{ x: 485, y: 4016 }],
  },
  pouch: {
    base: { x: 650, y: 5000 },
    seats: [{ x: 590, y: 5130 }, { x: 710, y: 5140 }],
    queue: [{ x: 800, y: 5196 }, { x: 880, y: 5194 }, { x: 960, y: 5192 }, { x: 1040, y: 5190 }],
    front: 'pouch_front',
    pot: { x: 380, y: 5030 },
    hosts: [{ x: 485, y: 5116 }],
  },
  // ── 셋째 묶음 단체 놀이 ──
  // 씨름장: 모래판(바닥 그림) 안에 선수 둘 (자리 0 홍 왼쪽·1 청 오른쪽, 마주 본다), 구경 손님 넷은 모래판 둘레 (2·3 양옆 조금 아래: 벌러덩 자리를 비운다, 4·5 앞).
  // 진행자: 0 심판 = 모래판 위쪽 가운데 (선수 뒤), 1 해설자 = 왼쪽 위.
  ssireum: {
    base: { x: 2640, y: 5325 },
    flat: true,
    buildingK: 0.45,
    seats: [
      { x: 2578, y: 5212 },
      { x: 2702, y: 5212 },
      { x: 2375, y: 5255 },
      { x: 2905, y: 5255 },
      { x: 2455, y: 5395 },
      { x: 2825, y: 5395 },
    ],
    queue: [{ x: 2985, y: 5402 }, { x: 3065, y: 5404 }, { x: 3145, y: 5406 }, { x: 3225, y: 5440 }],
    front: 'ssireum_front',
    pot: { x: 2895, y: 5085 },
    hosts: [{ x: 2640, y: 5098 }, { x: 2390, y: 5060 }],
  },
  // 오리배: 선착장(부스 그림, 차양 달린 나무 다리)이 큰 연못 남쪽 물가에서 물로 나간다. 자리 6 = 선착장 앞 물가 두 줄 (앞줄 가운데부터). 물길은 BOAT_COURSE.
  // 진행자: 0 출발 신호 = 선착장 왼쪽 물가, 1 구조 요원 = 오른쪽 물가.
  boat: {
    base: { x: 5800, y: 4318 },
    seats: [
      { x: 5800, y: 4348 },
      { x: 5690, y: 4352 },
      { x: 5910, y: 4352 },
      { x: 5745, y: 4410 },
      { x: 5855, y: 4410 },
      { x: 5965, y: 4406 },
    ],
    queue: [{ x: 5560, y: 4466 }, { x: 5480, y: 4470 }, { x: 5400, y: 4475 }, { x: 5320, y: 4481 }],
    front: 'boat_front',
    pot: { x: 6120, y: 4400 },
    hosts: [{ x: 5560, y: 4300 }, { x: 6060, y: 4292 }],
  },
  // 연날리기: 연 날리는 손님 넷이 나란히 (자리 0~3 = KITE_FIELD.flyers), 구경 손님 둘은 그 앞 (4·5). 부스 표식(이정표)은 뒤에.
  // 진행자: 0 연 장인 = 왼쪽, 1 바람지기 = 오른쪽.
  kite: {
    base: { x: 4715, y: 1185 },
    buildingK: 0.3,
    seats: [...KITE_FIELD.flyers, ...KITE_FIELD.bettors],
    queue: [{ x: 4520, y: 1437 }, { x: 4440, y: 1432 }, { x: 4360, y: 1418 }, { x: 4280, y: 1390 }],
    front: 'kite_front',
    pot: { x: 5010, y: 1360 },
    hosts: [{ x: 4390, y: 1250 }, { x: 5040, y: 1240 }],
  },
  // 줄다리기: 밧줄 양쪽에 편마다 넷 (자리 짝수 = 홍 왼쪽, 홀수 = 청 오른쪽, 가운데에서 바깥으로). 심판대(부스 그림)는 밧줄 가운데 뒤.
  // 진행자: 0 심판 = 심판대 왼쪽, 1 응원단장 = 밧줄 가운데 앞.
  tug: {
    base: { x: 7350, y: 5205 },
    buildingK: 0.38,
    seats: [
      { x: 7210, y: 5308 },
      { x: 7490, y: 5308 },
      { x: 7110, y: 5316 },
      { x: 7590, y: 5316 },
      { x: 7010, y: 5324 },
      { x: 7690, y: 5324 },
      { x: 6910, y: 5332 },
      { x: 7790, y: 5332 },
    ],
    queue: [{ x: 6805, y: 5480 }, { x: 6800, y: 5560 }, { x: 6795, y: 5640 }, { x: 6790, y: 5720 }],
    front: 'tug_front',
    pot: { x: 7570, y: 5190 },
    hosts: [{ x: 7170, y: 5222 }, { x: 7350, y: 5440 }],
    props: [
      { key: 'tug_flag_red', at: TUG_FIELD.flags[0], k: 0.28 },
      { key: 'tug_flag_blue', at: TUG_FIELD.flags[1], k: 0.28 },
    ],
  },
  // 보물찾기: 판 자리 여섯 (흙더미 = 바닥 그림), 손님은 흙더미 오른쪽에 서서 판다. 표식(부스 그림)은 위쪽 가운데.
  // 진행자: 0 보물 안내 (보물 지도 할아버지) = 왼쪽 위, 1 삽 대여 = 오른쪽 위.
  dig: {
    base: { x: 7300, y: 6450 },
    buildingK: 0.4,
    seats: DIG_FIELD.spots.map((_, i) => digSeat(i)),
    queue: [{ x: 6805, y: 6780 }, { x: 6800, y: 6860 }, { x: 6795, y: 6940 }, { x: 6790, y: 7020 }],
    front: 'dig_front',
    pot: { x: 7760, y: 6990 },
    hosts: [{ x: 6930, y: 6480 }, { x: 7690, y: 6470 }],
    props: DIG_FIELD.spots.map((s) => ({ key: 'dirt_mound', at: s, k: 0.22, flat: true })),
  },
};

/** 앞으로 지을 놀이부스·건물의 빈 부지 (구역이 열리면 보인다). 셋째 묶음(윷놀이 마당·빙고 홀 등) 자리. */
export const SPARE_LOTS: readonly { readonly at: Pt; readonly district: DistrictId }[] = [
  { at: { x: 5600, y: 3150 }, district: 'east' },
  { at: { x: 700, y: 6300 }, district: 'west' },
  { at: { x: 1750, y: 1100 }, district: 'north' },
  { at: { x: 7300, y: 3900 }, district: 'festival' },
];

/** 손님이 쉬는 곳 (분수 둘레). */
export const REST_SPOTS: readonly Pt[] = [
  { x: 2915, y: 4420 },
  { x: 3485, y: 4420 },
  { x: 2925, y: 4745 },
  { x: 3475, y: 4745 },
];

// ── 길 그래프 (손님이 걷는 길) ─────────────────────────────────────────

export const NODES = {
  gate: { x: 3200, y: 7240 },
  main_low: { x: 3200, y: 6650 },
  cross: { x: 3200, y: 6098 },
  cross_l: { x: 2806, y: 6093 },
  cross_r: { x: 3594, y: 6093 },
  cups_front: { x: 2568, y: 6088 },
  darts_front: { x: 3821, y: 6088 },
  main_mid: { x: 3200, y: 5450 },
  plaza_s: { x: 3200, y: 4856 },
  plaza_sw: { x: 2817, y: 4748 },
  plaza_w: { x: 2719, y: 4500 },
  plaza_nw: { x: 2817, y: 4284 },
  plaza_n: { x: 3200, y: 4187 },
  plaza_ne: { x: 3583, y: 4284 },
  plaza_e: { x: 3681, y: 4500 },
  plaza_se: { x: 3583, y: 4748 },
  ul_mid: { x: 2525, y: 4100 },
  slot_front: { x: 2579, y: 4150 },
  ur_mid: { x: 3864, y: 4140 },
  oddeven_front: { x: 3670, y: 4245 },
  ll_mid: { x: 2460, y: 4921 },
  lr_mid: { x: 3929, y: 4898 },
  up_mid: { x: 3200, y: 3550 },
  hall_front: { x: 3200, y: 3030 },
  // 돌림판 (입구 오른쪽 갈래길)
  wheel_front: { x: 3620, y: 6718 },
  // 숲 동네
  w_n: { x: 1250, y: 3240 },
  w_claw: { x: 1193, y: 4100 },
  claw_front: { x: 1110, y: 4104 },
  w_mid: { x: 1180, y: 4300 },
  w_pouch: { x: 1235, y: 5180 },
  pouch_front: { x: 1110, y: 5188 },
  w_s: { x: 1250, y: 5420 },
  w_x: { x: 1200, y: 6060 },
  // 연못 동네
  e_n: { x: 5150, y: 3350 },
  e_mid: { x: 5080, y: 4500 },
  e_s: { x: 5150, y: 5300 },
  duck_front: { x: 5240, y: 5318 },
  e_x: { x: 5200, y: 6060 },
  ring_front: { x: 5280, y: 6074 },
  // 북쪽 언덕
  n_mid: { x: 3200, y: 1750 },
  n_w: { x: 2300, y: 1250 },
  n_e: { x: 4100, y: 1250 },
  n_race: { x: 4080, y: 820 },
  race_front: { x: 3720, y: 772 },
  // 셋째 묶음
  ssireum_front: { x: 2990, y: 5402 },
  boat_front: { x: 5600, y: 4462 },
  kite_front: { x: 4440, y: 1432 },
  e_far: { x: 6060, y: 6130 },
  // 축제 들판
  f_gate: { x: 6750, y: 6160 },
  tug_front: { x: 6790, y: 5420 },
  f_n: { x: 6772, y: 4700 },
  dig_front: { x: 6775, y: 6720 },
  f_s: { x: 6780, y: 7100 },
  // 넷째 묶음: 은행 골목, 일터
  pawn_front: { x: 3600, y: 5462 },
  bank_front: { x: 4080, y: 5470 },
  yard_turn: { x: 3990, y: 6765 },
  yard_front: { x: 4150, y: 7080 },
} as const satisfies Record<string, Pt>;
export type NodeId = keyof typeof NODES;

export const EDGES: readonly (readonly [NodeId, NodeId])[] = [
  ['gate', 'main_low'],
  ['main_low', 'cross'],
  ['cross', 'cross_l'],
  ['cross_l', 'cups_front'],
  ['cross', 'cross_r'],
  ['cross_r', 'darts_front'],
  ['cross', 'main_mid'],
  ['main_mid', 'plaza_s'],
  ['plaza_s', 'plaza_sw'],
  ['plaza_sw', 'plaza_w'],
  ['plaza_w', 'plaza_nw'],
  ['plaza_nw', 'plaza_n'],
  ['plaza_n', 'plaza_ne'],
  ['plaza_ne', 'plaza_e'],
  ['plaza_e', 'plaza_se'],
  ['plaza_se', 'plaza_s'],
  ['plaza_nw', 'ul_mid'],
  ['ul_mid', 'slot_front'],
  ['plaza_nw', 'slot_front'],
  ['plaza_ne', 'oddeven_front'],
  ['oddeven_front', 'ur_mid'],
  ['plaza_sw', 'll_mid'],
  ['plaza_se', 'lr_mid'],
  ['plaza_n', 'up_mid'],
  ['up_mid', 'hall_front'],
  // 돌림판
  ['main_low', 'wheel_front'],
  // 숲 동네
  ['ul_mid', 'w_n'],
  ['ll_mid', 'w_s'],
  ['cups_front', 'w_x'],
  ['w_n', 'w_claw'],
  ['w_claw', 'w_mid'],
  ['w_claw', 'claw_front'],
  ['w_mid', 'w_pouch'],
  ['w_pouch', 'w_s'],
  ['w_pouch', 'pouch_front'],
  ['w_s', 'w_x'],
  // 연못 동네
  ['ur_mid', 'e_n'],
  ['lr_mid', 'e_s'],
  ['darts_front', 'e_x'],
  ['e_n', 'e_mid'],
  ['e_mid', 'e_s'],
  ['e_s', 'e_x'],
  ['e_s', 'duck_front'],
  ['e_x', 'ring_front'],
  // 북쪽 언덕 (회관 뒤로), 경주장은 오른쪽 갈림길에서
  ['hall_front', 'n_mid'],
  ['n_mid', 'n_w'],
  ['n_mid', 'n_e'],
  ['n_e', 'n_race'],
  ['n_race', 'race_front'],
  // 셋째 묶음
  ['main_mid', 'ssireum_front'],
  ['e_mid', 'boat_front'],
  ['n_e', 'kite_front'],
  ['ring_front', 'e_far'],
  ['e_far', 'f_gate'],
  ['f_gate', 'tug_front'],
  ['tug_front', 'f_n'],
  ['f_gate', 'dig_front'],
  ['dig_front', 'f_s'],
  // 넷째 묶음: 은행 골목 (큰길 가운데에서), 일터 (돌림판 갈래길에서)
  ['main_mid', 'pawn_front'],
  ['pawn_front', 'bank_front'],
  ['wheel_front', 'yard_turn'],
  ['yard_turn', 'yard_front'],
];

// ── 장식 소품 (그림 map/<key>, 아래 가운데가 놓이는 점) ─────────────────────
// 닫힌 구역의 소품은 구름 아래에 있다가 구역이 열리면 보인다. 숲 동네 둘레의 나무는 화면 쪽이 씨앗 난수로 더 흩뿌린다.

export const DECOR: readonly { readonly key: string; readonly at: Pt; readonly flip?: boolean }[] = [
  // 회관 둘레와 회관 길
  { key: 'tree_pine', at: { x: 2700, y: 3100 } },
  { key: 'tree_round', at: { x: 3720, y: 3120 } },
  { key: 'tree_pine', at: { x: 1900, y: 3000 } },
  { key: 'tree_round', at: { x: 4450, y: 2760 } },
  { key: 'tree_round', at: { x: 2280, y: 2620 } },
  { key: 'bush', at: { x: 3560, y: 3420 } },
  { key: 'flowers', at: { x: 2900, y: 3380 } },
  { key: 'lamp', at: { x: 3075, y: 3300 } },
  { key: 'lamp', at: { x: 3325, y: 3300 }, flip: true },
  { key: 'flowers', at: { x: 2350, y: 3560 } },
  { key: 'tree_round', at: { x: 4520, y: 3500 } },
  // 광장
  // 광장 위쪽 등불은 회관 길 양옆에 (홀짝 진행자 자리를 가리지 않게).
  { key: 'lamp', at: { x: 3080, y: 4140 } },
  { key: 'lamp', at: { x: 3320, y: 4140 }, flip: true },
  { key: 'lamp', at: { x: 3000, y: 4920 } },
  { key: 'lamp', at: { x: 3400, y: 4920 }, flip: true },
  { key: 'bench', at: { x: 2855, y: 4408 } },
  { key: 'bench', at: { x: 3545, y: 4408 }, flip: true },
  { key: 'planter', at: { x: 2884, y: 4810 } },
  { key: 'planter', at: { x: 3516, y: 4810 } },
  { key: 'rocks', at: { x: 1880, y: 4300 } },
  { key: 'tree_pine', at: { x: 4560, y: 4420 } },
  // 광장과 가로길 사이
  { key: 'signpost', at: { x: 3400, y: 5650 } },

  { key: 'bush', at: { x: 4360, y: 5640 } },
  { key: 'flowers', at: { x: 2200, y: 5200 } },
  { key: 'tree_round', at: { x: 2230, y: 5560 } },
  { key: 'tree_round', at: { x: 4470, y: 5420 } },
  { key: 'tree_pine', at: { x: 1960, y: 5820 } },
  { key: 'rocks', at: { x: 4450, y: 5800 } },
  { key: 'flowers', at: { x: 2900, y: 5900 } },
  // 입구 둘레와 마을 밖
  { key: 'fence', at: { x: 2900, y: 6480 } },
  { key: 'fence', at: { x: 3500, y: 6480 }, flip: true },
  { key: 'crates', at: { x: 2780, y: 6990 } },
  { key: 'balloons', at: { x: 3470, y: 7010 } },
  { key: 'flowers', at: { x: 2950, y: 7100 } },
  { key: 'bush', at: { x: 3640, y: 7480 } },
  { key: 'tree_pine', at: { x: 1980, y: 6700 } },
  { key: 'tree_round', at: { x: 4560, y: 6700 } },
  { key: 'tree_round', at: { x: 2650, y: 7600 } },
  { key: 'tree_pine', at: { x: 3780, y: 7620 } },
  { key: 'bush', at: { x: 2950, y: 7700 } },
  { key: 'flowers', at: { x: 3480, y: 7660 } },
  { key: 'tree_pine', at: { x: 4500, y: 7450 } },
  { key: 'tree_round', at: { x: 1950, y: 7400 } },
  // 연못 동네
  { key: 'tree_round', at: { x: 4950, y: 2700 } },
  { key: 'flowers', at: { x: 5850, y: 2650 } },
  { key: 'tree_round', at: { x: 6150, y: 3050 } },
  { key: 'rocks', at: { x: 5300, y: 3380 } },
  { key: 'bench', at: { x: 5420, y: 4760 } },
  { key: 'flowers', at: { x: 6120, y: 5000 } },
  { key: 'tree_pine', at: { x: 6200, y: 5600 } },
  { key: 'bush', at: { x: 6150, y: 7100 } },
  { key: 'tree_round', at: { x: 5550, y: 7350 } },
  { key: 'tree_pine', at: { x: 4950, y: 7500 } },
  // 숲 동네
  { key: 'tree_pine', at: { x: 300, y: 3300 } },
  { key: 'tree_pine', at: { x: 1450, y: 4700 } },
  { key: 'rocks', at: { x: 800, y: 4500 } },
  { key: 'flowers', at: { x: 900, y: 6900 } },
  { key: 'tree_round', at: { x: 400, y: 7200 } },
  // 북쪽 언덕
  { key: 'tree_round', at: { x: 1500, y: 1750 } },
  { key: 'tree_pine', at: { x: 5150, y: 1620 } },
  { key: 'tree_pine', at: { x: 800, y: 900 } },
  { key: 'tree_round', at: { x: 5700, y: 800 } },
  { key: 'rocks', at: { x: 2600, y: 1950 } },
  { key: 'flowers', at: { x: 3800, y: 1980 } },
  { key: 'tree_round', at: { x: 1800, y: 550 } },
  { key: 'tree_pine', at: { x: 4700, y: 500 } },
  { key: 'bush', at: { x: 3720, y: 1700 } },
  { key: 'tree_pine', at: { x: 6000, y: 1800 } },
  { key: 'flowers', at: { x: 600, y: 1900 } },
  // 축제 들판
  { key: 'balloons', at: { x: 6960, y: 4980 } },
  { key: 'balloons', at: { x: 7760, y: 6280 }, flip: true },
  { key: 'lamp', at: { x: 6660, y: 5600 } },
  { key: 'lamp', at: { x: 6660, y: 6400 }, flip: true },
  { key: 'flowers', at: { x: 7900, y: 5620 } },
  { key: 'crates', at: { x: 7860, y: 7240 } },
  { key: 'fence', at: { x: 7250, y: 7330 } },
  { key: 'bush', at: { x: 6640, y: 7420 } },
  { key: 'tree_round', at: { x: 7850, y: 7650 } },
  { key: 'tree_round', at: { x: 6620, y: 3500 } },
  { key: 'tree_pine', at: { x: 7650, y: 3000 } },
  { key: 'flowers', at: { x: 7700, y: 4350 } },
  { key: 'tree_round', at: { x: 7300, y: 1500 } },
  { key: 'tree_pine', at: { x: 6700, y: 800 } },
  { key: 'tree_pine', at: { x: 7800, y: 2100 } },
  { key: 'rocks', at: { x: 6950, y: 2600 } },
];
