// 확대 화면의 배치 (패널 px). 패널 크기만 알면 다시 계산한다: 화면이 바뀌면 씬을 새로 짓는다.
// 그림에서 잰 숫자(캔버스 1024 기준)는 여기에 모은다. 그림을 다시 뽑으면 이 숫자도 다시 잰다.

import type { BoothId } from '../../data/defs.ts';

/**
 * 확대 배경(closeup/bg_<부스>, 1024 정사각)에서 잰 벽과 바닥의 경계 (위에서부터 비율).
 * 경주장(bg_race)은 바깥 옆모습: 울타리 아래 풀 띠 다음 모래 길이 시작하는 선 (아래 3분의 1이 모래 길).
 */
export const FLOOR_LINE: Record<BoothId, number> = {
  slot: 0.822,
  oddeven: 0.804,
  cups: 0.754,
  darts: 0.829,
  wheel: 0.825,
  duck: 0.793,
  ring: 0.84,
  race: 0.705,
  claw: 0.842,
  pouch: 0.78,
};
/** 확대 배경 위쪽 차양의 아래 끝 (위에서부터 비율, 0 = 차양 없음). 넓적한 패널에서 배경 위를 자르면 차양 띠를 패널 위에 따로 붙인다. */
export const AWNING_LINE: Record<BoothId, number> = { slot: 0.118, oddeven: 0.13, cups: 0.108, darts: 0.1, wheel: 0.098, duck: 0.115, ring: 0.105, race: 0, claw: 0.08, pouch: 0.09 };
/** 배경 그림이 없을 때 그리는 벽 색. */
export const WALL_COLOR: Record<BoothId, number> = {
  slot: 0xf6e8cf,
  oddeven: 0xd8ecdf,
  cups: 0xe2d8ec,
  darts: 0xd2e7f3,
  wheel: 0xf6e9bd,
  duck: 0xd2e8f4,
  ring: 0xdfeacf,
  race: 0xcfe6f4,
  claw: 0xdfe1f0,
  pouch: 0xf3ddd0,
};

/**
 * objects/wheel_disc: 원판 가운데 (캔버스 px)와 반지름(테 안쪽 칸 끝). 칸 6개는 위(12시)부터 시계 방향으로
 * 빨강·크림·하늘·노랑·민트·주황, 칸 i의 가운데 각도 = -90° + 60° × i (화면 좌표). 칸 i에 SLOT_SYMBOLS[i] 그림을 코드로 얹는다.
 */
export const WHEEL_ART = { center: { x: 511, y: 512 }, sliceR: 300, slices: ['red', 'cream', 'sky', 'yellow', 'mint', 'orange'] } as const;
export const FLOOR_COLOR = 0xc8955e;

/** objects/slot_machine 캔버스에서 잰 값: 기준점(몸통 가운데 아래)과 빈 창 셋의 속 (캔버스 px). */
export const SLOT_ART = {
  anchor: { x: 510, y: 889 },
  /** 몸통 폭 (레버 빼고). */
  bodyW: 630,
  windows: [
    { x: 274, y: 476, w: 131, h: 161 },
    { x: 444, y: 476, w: 132, h: 161 },
    { x: 613, y: 476, w: 132, h: 161 },
  ],
} as const;

/** objects/dartboard 캔버스에서 잰 값: 과녁 가운데와 고리 반지름 (캔버스 px). */
export const BOARD_ART = { center: { x: 511, y: 571 }, red: 69, orange: 166, cream: 258, rim: 325 } as const;

/** objects/dart: 바늘 끝 (캔버스 px). 그림은 바늘이 오른쪽. 길이는 trim 폭. */
export const DART_ART = { tip: { x: 757, y: 526 }, length: 501 } as const;

/** objects/table: 탁자 윗면 (잘라 낸 그림 높이의 위에서부터 비율). */
export const TABLE_TOP = 0.12;

/**
 * characters/host_oddeven 그림에서 잰 앞으로 내민 손(조약돌을 쥔 주먹)의 자리: 발(그림 아래 가운데)에서 캔버스 px.
 * 그림은 왼쪽을 보니 x는 음수 (확대 화면에서는 뒤집어 오른쪽).
 */
export const ODDEVEN_HAND = { x: -267, y: -505 } as const;

export interface Seat {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly z: number;
}

export interface Layout {
  readonly w: number;
  readonly h: number;
  /** 무대 폭과 왼쪽 끝 (넓은 패널이면 가운데만 쓴다). */
  readonly sw: number;
  readonly sx: number;
  /** 배경 정사각 (cover). */
  readonly bg: { readonly x: number; readonly y: number; readonly size: number };
  /** 벽과 바닥의 경계. */
  readonly floorY: number;
  /** 손님이 서는 줄 (바닥 띠 가운데). */
  readonly feetY: number;
  /** 손님 몸 높이 (px). */
  readonly bodyH: number;
  /** 손님 그림 배율 (패널 px / 캔버스 px). */
  readonly kMon: number;
  /** 진행자 그림 배율. */
  readonly kHost: number;
  readonly host: { readonly x: number; readonly y: number };
  /** 기계·탁자 가운데 아래. */
  readonly rig: { readonly x: number; readonly y: number };
  readonly seats: readonly Seat[];
  /** 상금 항아리 (아래 가운데)와 폭. */
  readonly pot: { readonly x: number; readonly y: number; readonly w: number };
  /** 결과 글자 자리. */
  readonly caption: { readonly x: number; readonly y: number; readonly size: number };
}

/** 손님 몸(캔버스 약 500px)을 기준으로 배율을 잡는다. */
const MON_CANVAS_BODY = 500;
/** 진행자 키 (캔버스 px, characters 그림의 trim 높이 평균). */
const HOST_CANVAS_H = 960;

export function computeLayout(booth: BoothId, w: number, h: number, seatCount: number): Layout {
  const sw = Math.min(w, h * 1.05);
  const sx = (w - sw) / 2;
  // 배경: 정사각을 cover로 고르게 자른다. 넓은 패널이면 바닥이 잘리지 않게 위를 더 자른다.
  const size = Math.max(w, h);
  const bx = (w - size) / 2;
  let by = (h - size) / 2;
  const frac = FLOOR_LINE[booth];
  const maxFloor = h * 0.8;
  if (by + frac * size > maxFloor) by = Math.max(h - size, maxFloor - frac * size);
  const floorY = by + frac * size;
  const bottom = Math.min(h, by + size);
  const feetY = floorY + (bottom - floorY) * 0.5;

  // 몸 높이는 패널 높이의 약 40%. 좁은 패널이면 진행자·장치·손님이 옆으로 들어가게 폭으로 줄인다.
  const bodyH = 0.4 * Math.min(h, sw * 1.08);
  const kMon = bodyH / MON_CANVAS_BODY;
  const kHost = (bodyH * 1.25) / HOST_CANVAS_H;

  // 자리 둘: 둘째 손님은 오른쪽 앞에 조금 작게 (손님 얼굴은 왼쪽이라, 뒤에 두면 첫째 몸에 가려진다).
  // 그림 폭은 종마다 달라서, 오른쪽 끝이 패널 밖으로 나가지 않게 장면(scene.ts)이 종마다 조금 왼쪽으로 당긴다.
  const seats: Seat[] =
    seatCount > 1
      ? [
          { x: sx + sw * 0.74, y: feetY - (h - feetY) * 0.12, scale: 0.92, z: 34 },
          { x: sx + sw * 0.88, y: feetY + (h - feetY) * 0.32, scale: 0.8, z: 36 },
        ]
      : [{ x: sx + sw * 0.8, y: feetY, scale: 1, z: 36 }];

  return {
    w,
    h,
    sw,
    sx,
    bg: { x: bx, y: by, size },
    floorY,
    feetY,
    bodyH,
    kMon,
    kHost,
    host: { x: sx + sw * 0.12, y: feetY - h * 0.03 },
    rig: { x: sx + sw * 0.46, y: feetY - h * 0.035 },
    seats,
    pot: { x: sx + sw * 0.09, y: h - Math.max(4, (h - feetY) * 0.15), w: sw * 0.17 },
    caption: { x: w / 2, y: Math.max(by + size * 0.2, h * 0.17), size: Math.max(28, sw * 0.13) },
  };
}
