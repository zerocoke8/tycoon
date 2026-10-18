// 건물·놀이부스·장식의 모양 (DESIGN 6.1 배치형 마을): 차지하는 칸(가로×세로), 입구 칸, 그리고 안쪽 자리.
// 모든 점은 건물 기준 상대 px: (0, 0) = 건물이 차지한 칸들의 왼쪽 위 모서리, 오른쪽 아래 = (w·CELL, h·CELL).
// 세계 좌표는 sim/village.ts가 놓인 자리(칸 × CELL)를 더해 만든다 (villageGeo: boothSpot·raceTrack·tugField …). 화면·sim은 그것만 쓴다.
//
// 입구 (Footprint.entry): 건물 바로 바깥 한 칸 (보통 아래 변 가운데, 경주장은 오른쪽 변, 마을 입구는 위 변). 그 칸이 길이고
// 마을 입구에서 길로 이어져 있어야 손님이 온다. 손님은 그 길 칸 가운데 → 문(door) → 안쪽 자리(줄·자리·계산대 …)로 걸어 들어간다.
// 입구가 없는 건물(마을회관·공방·사무소·창고·장식)은 손님이 들르지 않아 길이 필요 없다.
//
// 그림 기준점(base) = 그림 아래 가운데 (ArtNode 'bottom'). 그림은 발자국보다 위로 삐져나와도 된다 (비스듬히 본 지도: 지붕이 윗줄을 조금 가린다).
// 큰 시설(경주장·오리배 연못·연날리기 언덕·줄다리기 마당·보물찾기 마당·밀어내기 대결장·일터)의 안쪽 모양(경주로·물길·연 하늘·밧줄·땅 팔 자리·일터 자리)도 상대 좌표.
// 셋째·넷째 묶음 때의 고정 지도(옛 map.ts)에서 옮겨 온 숫자다: 큰 시설은 그때의 모양 그대로, 보통 부스는 부스 그림 기준 자리 그대로 5×5 칸에 맞췄다.

import type { BoothId, BuildingId, DecorId, WorkFacility } from './defs.ts';
import { BOOTHS, BOOTH_IDS, BUILDINGS, DECOR, DECOR_IDS } from './defs.ts';
import { CELL, type Cell, type LoopCourse, type Pt } from './map.ts';

/** 놓을 수 있는 것: 놀이부스, 건물, 장식. */
export type CatalogKey = BoothId | BuildingId | DecorId;
export type CatalogKind = 'booth' | 'building' | 'decor';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 차지하는 칸과 입구. */
export interface Footprint {
  readonly w: number;
  readonly h: number;
  /** 입구 앞 길 칸 (건물 기준 칸 좌표: 발자국 바로 바깥 한 칸, x ∈ -1~w, y ∈ -1~h). 없으면 손님이 오지 않는다 (길이 필요 없다). */
  readonly entry?: Cell;
  /** 문 (건물 기준 px, 발자국 안): 입구 길 칸에서 여기로 들어와 안쪽 자리로 간다. */
  readonly door?: Pt;
  /** 옮기거나 보관할 수 없다 (마을 입구: 땅 가장자리에 고정). */
  readonly fixed?: boolean;
  /** 옮기기만 되고 보관할 수 없다 (마을회관·공방·사무소·창고·분수: 효과가 레벨에서 나오는 마을의 바탕 건물, 보관해 땅만 비우지 않게). */
  readonly keep?: boolean;
}

/**
 * 놀이부스 안쪽 자리 (건물 기준 px): 부스 그림 자리, 손님이 노는 자리, 줄 서는 자리, 상금 항아리, 진행자가 서는 자리들.
 * hosts = 진행자 자리마다 서는 점 (defs.ts BOOTHS[b].roles와 같은 순서·같은 길이). 보통 부스는 하나.
 * 진행자 0은 자리 0 옆에 서서 손님을 보고, 앉은 손님은 진행자 0을 본다 (sim과 화면이 같은 점을 쓴다). 줄은 진행자 반대쪽으로, 발자국 맨 아랫줄에.
 * 항아리가 부스 그림 자리보다 위(pot.y < base.y)면 부스 그림의 계산대 위에 놓인 항아리다 (화면이 부스 앞에 그린다).
 * props = 부스 그림과 같이 놓는 그림 (map/<key>, 아래 가운데가 at, 배율 k = 세계 px / 캔버스 px). 닫혀 있으면 흐리게.
 */
export interface BoothSpot {
  readonly base: Pt;
  readonly seats: readonly Pt[];
  readonly queue: readonly Pt[];
  readonly pot: Pt;
  readonly hosts: readonly Pt[];
  /** flat = 바닥에 깔리는 그림 (손님이 그 위에 선다: 흙더미). 바닥층에 그린다. */
  readonly props?: readonly { readonly key: string; readonly at: Pt; readonly k: number; readonly flat?: boolean }[];
  /** 부스 그림이 바닥에 깔린다 (밀어내기 모래판): 바닥층에 그린다. */
  readonly flat?: boolean;
  /** 부스 그림 배율 (세계 px / 캔버스 px, 없으면 화면의 ART_SCALE.booth). */
  readonly buildingK?: number;
}

// ── 보통 놀이부스 (5×5 칸): 부스 그림은 (240, 220), 자리는 그 앞, 줄은 맨 아랫줄, 입구는 아래 가운데 ──

const BOOTH_FP: Footprint = { w: 5, h: 5, entry: { x: 2, y: 5 }, door: { x: 240, y: 472 } };
/** 보통 부스의 줄: 맨 아랫줄에 문 옆에서 진행자 반대쪽으로 (dir -1 = 왼쪽). */
const boothQueue = (dir: -1 | 1): Pt[] => [0, 1, 2, 3].map((i) => ({ x: 240 + dir * (30 + 62 * i), y: 455 }));
/** 진행자가 오른쪽 (자리 0이 왼쪽 앞, 항아리는 진행자 쪽 끝). */
const rightHost = (pot: Pt = { x: 445, y: 255 }): BoothSpot => ({
  base: { x: 240, y: 220 },
  seats: [{ x: 300, y: 350 }, { x: 180, y: 360 }],
  queue: boothQueue(-1),
  pot,
  hosts: [{ x: 405, y: 336 }],
});
/** 진행자가 왼쪽. */
const leftHost = (): BoothSpot => ({
  base: { x: 240, y: 220 },
  seats: [{ x: 180, y: 350 }, { x: 300, y: 360 }],
  queue: boothQueue(1),
  pot: { x: 35, y: 255 },
  hosts: [{ x: 75, y: 336 }],
});

/**
 * 몬스터 경주장 경주로 (17×11 칸, 입구 = 오른쪽 변 넷째 줄). 바닥과 같이 코드로 그린다: 타원 모래 길(레인 4), 안쪽 풀밭, 레인 선.
 * 선수 i는 레인 i를 달린다 (racers/<RACE.racers[i].key>). 진행 p의 각도 (map.ts lanePoint): 왼쪽 끝 출발대(앞을 보고 아래로 나온다)
 * → 아래 직선(오른쪽으로) → 오른쪽 끝(위로) → 관중석 앞 위 직선(왼쪽으로) → 결승선.
 * gate·finish = 그림(map/race_gate, map/race_finish)의 아래 가운데. 관중석(map/race_stand) = stand (= 부스 그림 자리).
 * 지도는 출발대 바로 앞(모든 레인이 gate.y 아래)을 출발선으로 그린다 (view/mapUtil.ts raceStartP).
 * watch = 지나가다 구경하는 손님이 서는 곳: 관중석 양옆 경주로 바깥 (위쪽 띠). 시설 안 길은 문에서 곧장 걸어가므로
 * 손님이 드나드는 자리(줄·자리·구경)는 모두 입구 쪽 위 띠에 둔다 (경주로 아래 직선에 두면 달리는 경주로를 가로지른다).
 */
export interface RaceGeo extends LoopCourse {
  readonly gate: Pt;
  readonly finish: Pt;
  readonly stand: Pt;
  readonly watch: readonly Rect[];
}
export const RACE_GEO: RaceGeo = {
  center: { x: 850, y: 666 },
  rx: 620,
  ry: 220,
  laneWidth: 46,
  lanes: 4,
  squash: 0.7,
  startAngle: Math.PI,
  endAngle: -0.52 * Math.PI,
  gate: { x: 230, y: 701 },
  finish: { x: 817, y: 511 },
  stand: { x: 850, y: 186 },
  watch: [
    { x: 300, y: 296, w: 200, h: 70 },
    { x: 1330, y: 336, w: 210, h: 80 },
  ],
};

/** 연못 모양 (둥근 덩어리: 화면 쪽이 씨앗 난수로 울퉁불퉁하게, wobble = 울퉁불퉁한 정도 1 = 보통). */
export interface PondShape {
  readonly c: Pt;
  readonly rx: number;
  readonly ry: number;
  readonly wobble: number;
}

/**
 * 오리배 연못 (12×10 칸, 연못을 품은 시설). 물길 course (레인 4 = 배 번호)는 연못 안, 각도가 커지는 쪽(시계 방향)으로:
 * 왼쪽 아래(출발) → 왼쪽 끝 → 위 → 오른쪽 끝(결승). 선착장(부스 그림)은 남쪽 물가. watch = 구경 손님이 서는 물가 (선착장 양옆).
 */
export const BOAT_GEO: { readonly course: LoopCourse; readonly pond: PondShape; readonly watch: readonly Rect[] } = {
  course: { center: { x: 576, y: 400 }, rx: 300, ry: 190, laneWidth: 46, lanes: 4, squash: 0.7, startAngle: 0.85 * Math.PI, endAngle: 2.02 * Math.PI },
  pond: { c: { x: 576, y: 400 }, rx: 480, ry: 330, wobble: 0.35 },
  watch: [
    { x: 130, y: 770, w: 190, h: 90 },
    { x: 830, y: 770, w: 190, h: 90 },
  ],
};

/**
 * 연날리기 언덕 (9×5 칸). flyers = 연 날리는 손님 자리 0~3 (연 k = 자리 k, 오른쪽으로 나란히), bettors = 구경하며 거는 손님 자리 4·5.
 * sky = 연이 나는 하늘 (발자국 위로 높이 삐져나간다): 연 k는 flyers[k] 위에서 높이 0(skyLow, y)~1(skyHigh, y), 좌우 -1~1(sway px)로 난다.
 * 연과 줄은 하늘 층(모든 것 위)에 그린다. center = 구경 반응 가운데, watch = 구경 손님이 서는 곳.
 * hill = 날리는 자리를 품은 낮은 풀 언덕 (화면이 바닥층에 그린다: 위 타원 c·rx·ry, 앞 비탈 두께 rise). 줄은 언덕 아래 풀밭에 선다.
 */
export interface KiteGeo {
  readonly flyers: readonly Pt[];
  readonly bettors: readonly Pt[];
  readonly sky: Rect;
  readonly skyLow: number;
  readonly skyHigh: number;
  readonly sway: number;
  readonly center: Pt;
  readonly watch: Rect;
  readonly hill: { readonly c: Pt; readonly rx: number; readonly ry: number; readonly rise: number };
}
export const KITE_GEO: KiteGeo = {
  flyers: [
    { x: 237, y: 230 },
    { x: 367, y: 230 },
    { x: 497, y: 230 },
    { x: 627, y: 230 },
  ],
  bettors: [
    { x: 302, y: 312 },
    { x: 562, y: 312 },
  ],
  sky: { x: 47, y: -780, w: 780, h: 700 },
  skyLow: -180,
  skyHigh: -660,
  sway: 95,
  center: { x: 432, y: 60 },
  watch: { x: 480, y: 360, w: 300, h: 70 },
  hill: { c: { x: 432, y: 262 }, rx: 410, ry: 140, rise: 26 },
};

/**
 * 줄다리기 마당 (12×6 칸). 밧줄은 가로: 홍(자리 짝수)이 왼쪽, 청(홀수)이 오른쪽. center = 밧줄 가운데(빨간 리본)의 처음 자리,
 * lines = 승리 선 (가운데에서 ±lineHalf), reach = c 1일 때 리본·편 전체가 끌려가는 거리. flags = 깃발 자리, ropeY = 밧줄 높이 (발에서 위로).
 */
export interface TugGeo {
  readonly center: Pt;
  readonly lineHalf: number;
  readonly reach: number;
  readonly ropeY: number;
  readonly flags: readonly Pt[];
  readonly watch: Rect;
}
export const TUG_GEO: TugGeo = {
  center: { x: 576, y: 356 },
  lineHalf: 150,
  reach: 150,
  ropeY: 44,
  flags: [
    { x: 66, y: 341 },
    { x: 1086, y: 341 },
  ],
  watch: { x: 420, y: 470, w: 580, h: 75 },
};

/**
 * 보물찾기 마당 (10×8 칸). spots = 판 자리 0~5 (흙더미, 손님은 오른쪽 옆에 서서 판다), chests = 상자가 묻힐 수 있는 곳
 * (앞 여섯 = 판 자리, 뒤 셋 = 판 자리 사이). 상자에서 DIG.nearPx 안의 판 자리 = '바로 옆'.
 */
export interface DigGeo {
  readonly spots: readonly Pt[];
  readonly chests: readonly Pt[];
  readonly center: Pt;
  readonly watch: Rect;
}
export const DIG_GEO: DigGeo = {
  spots: [
    { x: 220, y: 276 },
    { x: 470, y: 276 },
    { x: 720, y: 276 },
    { x: 220, y: 526 },
    { x: 470, y: 526 },
    { x: 720, y: 526 },
  ],
  chests: [
    { x: 220, y: 276 },
    { x: 470, y: 276 },
    { x: 720, y: 276 },
    { x: 220, y: 526 },
    { x: 470, y: 526 },
    { x: 720, y: 526 },
    { x: 345, y: 401 },
    { x: 595, y: 401 },
    { x: 845, y: 401 },
  ],
  center: { x: 480, y: 401 },
  watch: { x: 420, y: 660, w: 440, h: 60 },
};
const digSeat = (i: number): Pt => {
  const s = DIG_GEO.spots[i] ?? DIG_GEO.center;
  return { x: s.x + 48, y: s.y + 8 };
};

/** 밀어내기 대결장 모래판 (9×6 칸): 선수 둘(자리 0 홍·1 청)이 가운데에서 맞붙는다 (reach = p 1일 때 밀려나는 거리). */
export interface RingGeo {
  readonly center: Pt;
  readonly rx: number;
  readonly ry: number;
  readonly reach: number;
}
export const SSIREUM_GEO: RingGeo = { center: { x: 432, y: 255 }, rx: 190, ry: 105, reach: 70 };

export const BOOTH_LAYOUT: Record<BoothId, { readonly fp: Footprint; readonly spot: BoothSpot }> = {
  // booth_slot 그림의 계산대 위 항아리 자리 (그림에서 잰 값).
  slot: {
    fp: BOOTH_FP,
    spot: { base: { x: 240, y: 220 }, seats: [{ x: 265, y: 355 }, { x: 150, y: 380 }], queue: boothQueue(-1), pot: { x: 170, y: 104 }, hosts: [{ x: 367, y: 341 }] },
  },
  oddeven: {
    fp: BOOTH_FP,
    spot: { base: { x: 240, y: 220 }, seats: [{ x: 180, y: 370 }, { x: 300, y: 360 }], queue: boothQueue(1), pot: { x: 445, y: 260 }, hosts: [{ x: 72, y: 356 }] },
  },
  cups: { fp: BOOTH_FP, spot: { ...rightHost({ x: 445, y: 260 }), seats: [{ x: 290, y: 350 }, { x: 170, y: 360 }], hosts: [{ x: 393, y: 336 }] } },
  darts: { fp: BOOTH_FP, spot: leftHost() },
  wheel: { fp: BOOTH_FP, spot: rightHost() },
  duck: { fp: BOOTH_FP, spot: rightHost() },
  ring: { fp: BOOTH_FP, spot: rightHost() },
  claw: { fp: BOOTH_FP, spot: leftHost() },
  pouch: { fp: BOOTH_FP, spot: leftHost() },
  // 관중석(race_stand)이 경주로 위쪽에서 앞(경주로)을 본다. 자리 6 = 관중석 앞 두 줄 (앞줄 먼저, 가운데부터). 줄은 관중석 오른쪽, 입구는 오른쪽 변.
  // 진행자: 0 출발 신호 = 출발대 옆, 1 해설자 = 관중석 왼쪽, 2 사육사 = 경주로 안쪽 풀밭 (출발대 가까이).
  race: {
    fp: { w: 17, h: 11, entry: { x: 17, y: 3 }, door: { x: 1610, y: 330 } },
    spot: {
      base: RACE_GEO.stand,
      seats: [
        { x: 790, y: 298 },
        { x: 910, y: 298 },
        { x: 670, y: 298 },
        { x: 850, y: 236 },
        { x: 730, y: 236 },
        { x: 970, y: 236 },
      ],
      queue: [
        { x: 1050, y: 316 },
        { x: 1130, y: 312 },
        { x: 1210, y: 308 },
        { x: 1290, y: 304 },
      ],
      pot: { x: 1090, y: 228 },
      hosts: [
        { x: 70, y: 726 },
        { x: 550, y: 251 },
        { x: 450, y: 686 },
      ],
      props: [
        { key: 'race_gate', at: RACE_GEO.gate, k: 0.3 },
        { key: 'race_finish', at: RACE_GEO.finish, k: 0.3 },
      ],
    },
  },
  // 모래판(바닥 그림) 안에 선수 둘 (자리 0 홍 왼쪽·1 청 오른쪽, 마주 본다), 구경 손님 넷은 모래판 둘레 (2·3 양옆 조금 아래, 4·5 앞).
  // 진행자: 0 심판 = 모래판 위쪽 가운데 (선수 뒤), 1 해설자 = 왼쪽 위.
  ssireum: {
    fp: { w: 9, h: 6, entry: { x: 4, y: 6 }, door: { x: 432, y: 560 } },
    spot: {
      base: { x: 432, y: 375 },
      flat: true,
      buildingK: 0.45,
      seats: [
        { x: 370, y: 262 },
        { x: 494, y: 262 },
        { x: 167, y: 305 },
        { x: 697, y: 305 },
        { x: 247, y: 445 },
        { x: 617, y: 445 },
      ],
      queue: [
        { x: 494, y: 540 },
        { x: 556, y: 540 },
        { x: 618, y: 540 },
        { x: 680, y: 540 },
      ],
      pot: { x: 687, y: 135 },
      hosts: [
        { x: 432, y: 148 },
        { x: 182, y: 110 },
      ],
    },
  },
  // 선착장(부스 그림, 차양 달린 나무 다리)이 연못 남쪽 물가에서 물로 나간다. 자리 6 = 선착장 앞 물가 두 줄 (앞줄 가운데부터). 물길은 BOAT_GEO.
  // 진행자: 0 출발 신호 = 선착장 왼쪽 물가, 1 구조 요원 = 오른쪽 물가.
  boat: {
    fp: { w: 12, h: 10, entry: { x: 3, y: 10 }, door: { x: 336, y: 935 } },
    spot: {
      base: { x: 576, y: 838 },
      seats: [
        { x: 576, y: 868 },
        { x: 466, y: 872 },
        { x: 686, y: 872 },
        { x: 521, y: 930 },
        { x: 631, y: 930 },
        { x: 741, y: 926 },
      ],
      queue: [
        { x: 405, y: 905 },
        { x: 345, y: 912 },
        { x: 285, y: 905 },
        { x: 225, y: 912 },
      ],
      pot: { x: 896, y: 920 },
      hosts: [
        { x: 336, y: 820 },
        { x: 836, y: 812 },
      ],
    },
  },
  // 연 날리는 손님 넷이 나란히 (자리 0~3 = KITE_GEO.flyers), 구경 손님 둘은 그 앞 (4·5). 부스 표식(이정표)은 뒤에.
  // 진행자: 0 연 장인 = 왼쪽, 1 바람지기 = 오른쪽.
  kite: {
    fp: { w: 9, h: 5, entry: { x: 4, y: 5 }, door: { x: 432, y: 465 } },
    spot: {
      base: { x: 432, y: 145 },
      buildingK: 0.3,
      seats: [...KITE_GEO.flyers, ...KITE_GEO.bettors],
      queue: [
        { x: 380, y: 445 },
        { x: 318, y: 445 },
        { x: 256, y: 445 },
        { x: 194, y: 445 },
      ],
      pot: { x: 727, y: 320 },
      hosts: [
        { x: 107, y: 210 },
        { x: 757, y: 200 },
      ],
    },
  },
  // 밧줄 양쪽에 편마다 넷 (자리 짝수 = 홍 왼쪽, 홀수 = 청 오른쪽, 가운데에서 바깥으로). 심판대(부스 그림)는 밧줄 가운데 뒤.
  // 진행자: 0 심판 = 심판대 왼쪽, 1 응원단장 = 밧줄 가운데 앞.
  tug: {
    fp: { w: 12, h: 6, entry: { x: 3, y: 6 }, door: { x: 336, y: 560 } },
    spot: {
      base: { x: 576, y: 261 },
      buildingK: 0.38,
      seats: [
        { x: 436, y: 364 },
        { x: 716, y: 364 },
        { x: 336, y: 372 },
        { x: 816, y: 372 },
        { x: 236, y: 380 },
        { x: 916, y: 380 },
        { x: 136, y: 388 },
        { x: 1016, y: 388 },
      ],
      queue: [
        { x: 290, y: 535 },
        { x: 228, y: 535 },
        { x: 166, y: 535 },
        { x: 104, y: 535 },
      ],
      pot: { x: 796, y: 246 },
      hosts: [
        { x: 396, y: 278 },
        { x: 576, y: 496 },
      ],
      props: [
        { key: 'tug_flag_red', at: TUG_GEO.flags[0] as Pt, k: 0.28 },
        { key: 'tug_flag_blue', at: TUG_GEO.flags[1] as Pt, k: 0.28 },
      ],
    },
  },
  // 판 자리 여섯 (흙더미 = 바닥 그림), 손님은 흙더미 오른쪽에 서서 판다. 표식(부스 그림)은 위쪽 가운데.
  // 진행자: 0 보물 안내 (보물 지도 할아버지) = 왼쪽 위, 1 삽 대여 = 오른쪽 위.
  dig: {
    fp: { w: 10, h: 8, entry: { x: 3, y: 8 }, door: { x: 336, y: 750 } },
    spot: {
      base: { x: 470, y: 126 },
      buildingK: 0.4,
      seats: DIG_GEO.spots.map((_, i) => digSeat(i)),
      queue: [
        { x: 280, y: 725 },
        { x: 220, y: 725 },
        { x: 160, y: 725 },
        { x: 100, y: 725 },
      ],
      pot: { x: 930, y: 666 },
      hosts: [
        { x: 100, y: 156 },
        { x: 860, y: 146 },
      ],
      props: DIG_GEO.spots.map((s) => ({ key: 'dirt_mound', at: s, k: 0.22, flat: true })),
    },
  },
};

// ── 건물 ──

/**
 * 손님이 볼일을 보는 가게 (전당포·은행, 5×4 칸): counter = 계산대 앞에 서는 자리 (먼저 온 손님부터, 다 차면 마지막 자리 둘레),
 * npc = 주인이 서는 점 (characters/<art>, 계산대를 본다).
 */
export interface ShopGeo {
  readonly counter: readonly Pt[];
  readonly npc: Pt;
  readonly art: string;
}
export const SHOP_GEO: Record<'pawnshop' | 'bank', ShopGeo> = {
  pawnshop: { counter: [{ x: 225, y: 342 }, { x: 145, y: 354 }, { x: 305, y: 358 }], npc: { x: 375, y: 322 }, art: 'pawnbroker' },
  bank: { counter: [{ x: 225, y: 336 }, { x: 145, y: 342 }, { x: 300, y: 346 }], npc: { x: 385, y: 318 }, art: 'banker' },
};

/**
 * 일터 (12×8 칸): 시설 둘 (밭 = 바닥에 깔리는 그림, 광산 = 굴 입구 그림). spots = 일하는 자리 (일터 레벨의 workers만큼 앞에서부터),
 * wait = 자리가 없을 때 쪼그리고 기다리는 자리 (다 차면 마지막 자리 둘레), face = 일하는 손님이 바라보는 점 (밭 가운데·굴 입구).
 * props = 소품 (map/<key>), foreman = 반장이 서는 점, center = 구경 반응 가운데.
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
export interface YardGeo {
  readonly facilities: Record<WorkFacility, WorkFacilitySpot>;
  readonly props: readonly { readonly key: string; readonly at: Pt; readonly k: number; readonly flip?: boolean }[];
  readonly foreman: Pt;
  readonly center: Pt;
}
export const YARD_GEO: YardGeo = {
  facilities: {
    // 밭 흙 위 두 줄을 엇갈려 (앞뒤 110, 옆 75: 앞줄 게이지·괭이가 뒷줄 손님 몸에 얹히지 않게). 앞 둘(일터 레벨 1)은 멀리, 레벨이 오르면 사이를 채운다.
    farm: {
      art: 'farm_plot',
      at: { x: 320, y: 646 },
      k: 0.56,
      flat: true,
      spots: [
        { x: 220, y: 451 },
        { x: 445, y: 561 },
        { x: 370, y: 451 },
        { x: 295, y: 561 },
      ],
      wait: [
        { x: 545, y: 581 },
        { x: 670, y: 596 },
        { x: 605, y: 706 },
        { x: 730, y: 716 },
      ],
      face: { x: 330, y: 506 },
    },
    // 입구 앞에 앞뒤로 엇갈려 (곡괭이·빚 게이지가 옆 손님과 겹치지 않게).
    mine: {
      art: 'mine_entrance',
      at: { x: 890, y: 256 },
      k: 0.4,
      flat: false,
      spots: [
        { x: 755, y: 304 },
        { x: 860, y: 348 },
        { x: 965, y: 304 },
        { x: 1070, y: 348 },
      ],
      wait: [
        { x: 1030, y: 432 },
        { x: 930, y: 458 },
        { x: 830, y: 442 },
        { x: 980, y: 526 },
      ],
      face: { x: 890, y: 226 },
    },
  },
  props: [
    { key: 'ore_cart', at: { x: 682, y: 248 }, k: 0.21 },
    { key: 'crop_basket', at: { x: 182, y: 638 }, k: 0.11 },
  ],
  foreman: { x: 655, y: 411 },
  center: { x: 620, y: 436 },
};

/** 광장 분수 (5×5 칸): 손님이 쉬는 자리 (분수를 본다). */
export const FOUNTAIN_REST: readonly Pt[] = [
  { x: 58, y: 330 },
  { x: 422, y: 330 },
  { x: 110, y: 430 },
  { x: 370, y: 430 },
];

/** 마을 입구 (7×3 칸): 손님이 나타나고 떠나는 점 (아치 밑, 지도 아래 끝). 입구 칸은 위 변 가운데. */
export const GATE_SPAWN: Pt = { x: 336, y: 275 };

/** 촌장이 서 있는 곳 (마을회관 앞마당 오른쪽 끝). */
export const CHIEF_AT: Pt = { x: 478, y: 545 };

/** 건물: 차지하는 칸, 입구, 그림 자리(base, 아래 가운데)와 배율 k (없으면 화면의 ART_SCALE.building). 일터는 그림이 여럿 (YARD_GEO). */
export const BUILDING_LAYOUT: Record<BuildingId, { readonly fp: Footprint; readonly base: Pt; readonly k?: number }> = {
  hall: { fp: { w: 6, h: 6, keep: true }, base: { x: 288, y: 470 } },
  gate: { fp: { w: 7, h: 3, entry: { x: 3, y: -1 }, door: { x: 336, y: 24 }, fixed: true }, base: { x: 336, y: 250 } },
  workshop: { fp: { w: 7, h: 5, keep: true }, base: { x: 336, y: 420 } },
  office: { fp: { w: 6, h: 5, keep: true }, base: { x: 288, y: 420 } },
  warehouse: { fp: { w: 7, h: 4, keep: true }, base: { x: 336, y: 330 } },
  fountain: { fp: { w: 5, h: 5, entry: { x: 2, y: 5 }, door: { x: 240, y: 470 }, keep: true }, base: { x: 240, y: 300 } },
  pawnshop: { fp: { w: 5, h: 4, entry: { x: 2, y: 4 }, door: { x: 240, y: 372 } }, base: { x: 240, y: 280 }, k: 0.44 },
  bank: { fp: { w: 5, h: 4, entry: { x: 2, y: 4 }, door: { x: 240, y: 372 } }, base: { x: 240, y: 280 }, k: 0.44 },
  workyard: { fp: { w: 12, h: 8, entry: { x: 6, y: 8 }, door: { x: 624, y: 750 } }, base: { x: 576, y: 760 } },
};

/** 장식: 칸 하나, 그림 아래 가운데가 칸 가운데 조금 아래. */
export const DECOR_FP: Footprint = { w: 1, h: 1 };
export const DECOR_BASE: Pt = { x: 48, y: 78 };

/**
 * 바닥에 그리는 시설 모양 (건물 기준 px, 화면 ground.ts가 길과 같이 굽는다): plaza = 모래 마당 타원 (테두리 + 속),
 * pond = 연못 (울퉁불퉁), track = 경주로 (RACE_GEO), road = 길 띠 (마을 입구 아치 밑: 진짜 길과 똑같이),
 * walk = 건물 안 오솔길 (입구에서 계산대·선착장·관중석까지 디딤돌: 길 칸이 아니라서 길과 다르게 그린다).
 */
export type FloorShape =
  | { readonly kind: 'plaza'; readonly c: Pt; readonly rx: number; readonly ry: number }
  | { readonly kind: 'pond'; readonly shape: PondShape }
  | { readonly kind: 'track' }
  | { readonly kind: 'road'; readonly rect: Rect }
  | { readonly kind: 'walk'; readonly rect: Rect };
export const FLOORS: Partial<Record<CatalogKey, readonly FloorShape[]>> = {
  fountain: [{ kind: 'plaza', c: { x: 240, y: 290 }, rx: 235, ry: 185 }],
  gate: [{ kind: 'road', rect: { x: 3 * CELL, y: 0, w: CELL, h: 3 * CELL } }],
  // 경주장: 오른쪽 입구에서 관중석 옆 줄까지 오솔길 (경주로 위 띠, 경주로에 닿지 않게).
  race: [{ kind: 'track' }, { kind: 'walk', rect: { x: 10 * CELL, y: 3 * CELL, w: 7 * CELL, h: CELL } }],
  // 오리배: 입구에서 선착장 앞 물가를 따라 오솔길 (자리·줄이 그 위).
  boat: [{ kind: 'pond', shape: BOAT_GEO.pond }, { kind: 'walk', rect: { x: 3 * CELL, y: 9 * CELL, w: 6 * CELL, h: CELL } }],
  tug: [{ kind: 'plaza', c: TUG_GEO.center, rx: 560, ry: 175 }],
  dig: [{ kind: 'plaza', c: DIG_GEO.center, rx: 420, ry: 235 }],
  // 일터: 밭과 광산을 한 마당으로 묶는 흙마당 (광산 입구 아래 끝이 마당 위 가장자리에 걸친다).
  workyard: [{ kind: 'plaza', c: { x: 590, y: 452 }, rx: 535, ry: 300 }],
  // 밀어내기 대결장: 입구 길에서 모래판 아래 끝까지 오솔길 (줄은 그 오른쪽).
  ssireum: [{ kind: 'walk', rect: { x: 4 * CELL, y: 4 * CELL, w: CELL, h: 2 * CELL } }],
  // 보통 부스 (5×5): 입구 길에서 부스 계산대까지 한 칸 폭 디딤돌 오솔길 (자리·줄이 그 위와 옆): 부스가 길에서 떨어져 보이지 않게.
  ...Object.fromEntries(
    (Object.keys(BOOTH_LAYOUT) as BoothId[]).filter((b) => BOOTH_LAYOUT[b].fp === BOOTH_FP).map((b) => [b, [{ kind: 'walk', rect: { x: 2 * CELL, y: 2 * CELL, w: CELL, h: 3 * CELL } }]]),
  ),
};

// ── 고르기 ──

const BUILDING_KEYS = Object.keys(BUILDING_LAYOUT) as BuildingId[];
/** 놓을 수 있는 모든 것 (부스 → 건물 → 장식). */
export const CATALOG_KEYS: readonly CatalogKey[] = [...BOOTH_IDS, ...BUILDING_KEYS, ...DECOR_IDS];

export function catalogKind(key: CatalogKey): CatalogKind {
  if ((BOOTH_IDS as readonly string[]).includes(key)) return 'booth';
  if ((BUILDING_KEYS as readonly string[]).includes(key)) return 'building';
  return 'decor';
}

export function isCatalogKey(v: string): v is CatalogKey {
  return (CATALOG_KEYS as readonly string[]).includes(v);
}

/** 차지하는 칸과 입구. */
/** 보관함에 넣을 수 있나 (마을 입구·바탕 건물은 안 된다). */
export function storable(key: CatalogKey): boolean {
  const fp = footprint(key);
  return fp.fixed !== true && fp.keep !== true;
}

export function footprint(key: CatalogKey): Footprint {
  switch (catalogKind(key)) {
    case 'booth':
      return BOOTH_LAYOUT[key as BoothId].fp;
    case 'building':
      return BUILDING_LAYOUT[key as BuildingId].fp;
    default:
      return DECOR_FP;
  }
}

/** 그림 자리 (건물 기준 px, 아래 가운데). */
export function artBase(key: CatalogKey): Pt {
  switch (catalogKind(key)) {
    case 'booth':
      return BOOTH_LAYOUT[key as BoothId].spot.base;
    case 'building':
      return BUILDING_LAYOUT[key as BuildingId].base;
    default:
      return DECOR_BASE;
  }
}

/** 손님이 들르는 곳이라 입구가 길에 이어져야 하나. */
export function needsRoad(key: CatalogKey): boolean {
  return footprint(key).entry !== undefined;
}

/** 이름 (부스·건물·장식). */
export function catalogName(key: CatalogKey): string {
  switch (catalogKind(key)) {
    case 'booth':
      return BOOTHS[key as BoothId].name;
    case 'building':
      return BUILDINGS[key as BuildingId].name;
    default:
      return DECOR[key as DecorId].name;
  }
}
