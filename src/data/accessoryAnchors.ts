// 장신구가 손님 몸 그림에 붙는 점 (넷째 묶음, DESIGN 3.7). 종·포즈마다, 몬스터 캔버스 좌표 (1024², 왼쪽을 보는 그림).
// MEASURED는 tools/accessory-anchors.ts가 원본 그림(tools/art-raw/monsters)의 알파에서 재서 쓴다 (손으로 고치지 않는다: 다시 재면 덮인다).
// 잰 값이 어긋난 종은 FIXES에 손으로 고친다 (재도 남는다). 둘을 합친 것이 ACCESSORY_ANCHORS.
//   머리 = 머리 꼭대기 (모자 테두리가 앉는 곳, 머리 안으로 조금), 목 = 머리와 몸이 만나는 곳의 앞쪽 (왼쪽을 보는 몸이라 가운데보다 왼쪽),
//   옆구리 = 보는 사람 쪽 옆구리 (가운데보다 오른쪽 아래). 모자·냄비·헬멧을 쓴 종은 머리 장신구가 그 위에 얹힌다.
// 크기: 장신구 폭 = 자리 기준 폭 (size: 머리 = 머리 폭, 목 = 목 폭, 옆구리 = 머리 폭, base 포즈에서 잰다) × ACCESSORY_FIT[장신구].w × 붙는 점 scale.
// 포즈가 바뀌어도 크기는 그대로다 (세트마다 한 배율: 키트 안내서 6.4).

import type { AccessoryId, AccessorySlot, SpeciesId } from './defs.ts';

/** 몸 그림 포즈 (sim/types.ts Pose와 같다: data는 sim을 모른다). */
export type AnchorPose = 'base' | 'joy' | 'agony' | 'sad';
export const ANCHOR_POSES: readonly AnchorPose[] = ['base', 'joy', 'agony', 'sad'];

/**
 * 붙는 점 하나. x·y = 캔버스 좌표 (장신구 그림의 붙는 점 ACCESSORY_FIT ax·ay가 여기에 온다),
 * rot = 기울기 (rad, + = 시계 방향, 왼쪽을 보는 그림 기준), scale = 크기 배수, behind = 몸 그림 뒤에.
 */
export interface AccessoryAnchor {
  readonly x: number;
  readonly y: number;
  readonly rot?: number;
  readonly scale?: number;
  readonly behind?: boolean;
}

/** 종 하나의 붙는 점: 자리마다 기준 폭 (캔버스 px)과 포즈·자리마다 붙는 점. */
export interface SpeciesAnchors {
  readonly size: Readonly<Record<AccessorySlot, number>>;
  readonly poses: Readonly<Record<AnchorPose, Readonly<Record<AccessorySlot, AccessoryAnchor>>>>;
}

/**
 * 장신구 그림마다 붙이는 법. ax·ay = 그림(잘라 낸 상자) 안의 붙는 점 비율 (머리 = 테두리 아래쪽, 목 = 걸리는 위쪽, 옆구리 = 끈 묶은 곳),
 * w = 그림 폭 / 자리 기준 폭, dx·dy = 붙는 점에서 옮기는 양 (자리 기준 폭 비율, + = 오른쪽(등 쪽)·아래, 붙는 점 기울기를 따라 돈다), rot = 더 기울이기 (rad).
 */
export interface AccessoryFit {
  readonly ax: number;
  readonly ay: number;
  readonly w: number;
  readonly dx?: number;
  readonly dy?: number;
  readonly rot?: number;
}

export const ACCESSORY_FIT: Readonly<Record<AccessoryId, AccessoryFit>> = {
  // 머리: 모자·왕관은 꼭대기 가운데, 리본·머리핀은 머리 위 등 쪽(오른쪽)으로 비스듬히.
  acc_flower_crown: { ax: 0.5, ay: 0.6, w: 0.68 },
  acc_ribbon: { ax: 0.5, ay: 0.55, w: 0.42, dx: 0.22, dy: 0.06, rot: 0.3 },
  acc_tophat: { ax: 0.5, ay: 0.86, w: 0.42 },
  acc_straw_hat: { ax: 0.5, ay: 0.72, w: 0.82 },
  acc_star_pin: { ax: 0.62, ay: 0.5, w: 0.32, dx: 0.26, dy: 0.14, rot: 0.45 },
  acc_mini_crown: { ax: 0.5, ay: 0.88, w: 0.38 },
  // 목: 위쪽 가운데가 턱 밑에 걸린다.
  acc_scarf: { ax: 0.48, ay: 0.14, w: 0.44 },
  acc_pearl_necklace: { ax: 0.5, ay: 0.12, w: 0.6 },
  acc_bell_collar: { ax: 0.5, ay: 0.22, w: 0.62 },
  // 옆구리: 끈 묶은 곳.
  acc_coin_pouch: { ax: 0.5, ay: 0.15, w: 0.28 },
}

/**
 * 장신구 폭의 대강 (자리마다, 몸 그림(잘라 낸) 폭에 곱한다): 장신구가 무엇인지 모르고 자리만 아는 곳 (날아가는 장신구 효과 등)이 쓴다.
 * 몸에 그린 장신구와 꼭 맞추려면 view/accessory.ts accessoryPlacement(종, 포즈, 장신구, 자리)의 width (캔버스 px).
 */
export const ACCESSORY_SIZE: Readonly<Record<AccessorySlot, number>> = { head: 0.42, neck: 0.42, side: 0.26 };

/** 잰 값 한 줄: w = [머리 폭, 목 폭], p = 포즈마다 [머리 x, 머리 y, 머리 기울기(밀리라디안), 목 x, 목 y, 옆구리 x, 옆구리 y, 몸 바닥 y]. */
interface Measured {
  readonly w: readonly [number, number];
  readonly p: Readonly<Record<AnchorPose, readonly [number, number, number, number, number, number, number, number]>>;
}

// @generated-begin (tools/accessory-anchors.ts)
const MEASURED: Partial<Record<SpeciesId, Measured>> = {
  dragon: { w: [420, 378], p: { base: [492, 405, 0, 471, 574, 610, 709, 844], joy: [492, 319, 66, 439, 522, 594, 680, 838], agony: [500, 340, -16, 482, 532, 599, 681, 830], sad: [481, 460, 1, 462, 614, 590, 737, 860] } },
  crab: { w: [348, 313], p: { base: [536, 536, 0, 461, 626, 633, 725, 824], joy: [421, 585, -159, 394, 652, 570, 736, 820], agony: [489, 421, -274, 471, 544, 592, 675, 806], sad: [528, 534, -274, 513, 633, 611, 738, 844] } },
  goblin: { w: [334, 184], p: { base: [554, 339, 0, 512, 576, 630, 695, 814], joy: [511, 340, -43, 490, 575, 577, 695, 814], agony: [537, 365, -45, 518, 587, 574, 699, 812], sad: [514, 322, -23, 481, 579, 627, 708, 838] } },
  pudding: { w: [320, 288], p: { base: [513, 389, 0, 489, 572, 603, 692, 812], joy: [512, 391, -14, 494, 572, 616, 692, 812], agony: [517, 416, 7, 494, 576, 614, 682, 788], sad: [512, 379, -23, 496, 567, 600, 689, 812] } },
  radish: { w: [302, 210], p: { base: [539, 340, 0, 524, 500, 621, 665, 830], joy: [538, 338, 0, 523, 499, 612, 666, 832], agony: [538, 340, 0, 523, 497, 611, 660, 822], sad: [487, 340, 25, 464, 496, 574, 657, 818] } },
  kabocha: { w: [378, 340], p: { base: [516, 413, 0, 497, 614, 622, 713, 812], joy: [513, 414, -1, 495, 613, 614, 710, 808], agony: [520, 423, 2, 502, 607, 622, 699, 790], sad: [519, 366, -7, 501, 593, 620, 704, 814] } },
  bat: { w: [336, 302], p: { base: [530, 447, 0, 500, 608, 614, 714, 820], joy: [532, 453, 13, 499, 608, 614, 714, 820], agony: [557, 443, 70, 504, 601, 600, 707, 814], sad: [490, 423, -43, 473, 594, 584, 706, 818] } },
  ghost: { w: [328, 290], p: { base: [503, 385, 0, 482, 586, 595, 695, 804], joy: [488, 373, 19, 460, 567, 578, 673, 778], agony: [498, 383, 25, 466, 585, 592, 694, 804], sad: [493, 395, -13, 478, 585, 572, 688, 790] } },
  turtle: { w: [316, 284], p: { base: [590, 379, 0, 506, 560, 678, 679, 798], joy: [556, 377, -132, 527, 550, 660, 665, 780], agony: [541, 388, -35, 473, 567, 680, 688, 810], sad: [589, 378, -153, 567, 554, 670, 669, 784] } },
  otter: { w: [332, 272], p: { base: [488, 397, 0, 471, 566, 581, 711, 856], joy: [496, 377, 8, 477, 542, 601, 686, 830], agony: [510, 399, 11, 490, 567, 596, 712, 856], sad: [480, 399, -4, 465, 566, 559, 708, 850] } },
  octopus: { w: [350, 308], p: { base: [543, 350, 0, 504, 586, 638, 685, 784], joy: [544, 350, 23, 494, 582, 625, 679, 776], agony: [561, 344, 25, 509, 582, 613, 682, 782], sad: [531, 361, 1, 492, 590, 619, 686, 782] } },
  jellyfish: { w: [360, 324], p: { base: [514, 388, 0, 496, 564, 606, 681, 798], joy: [511, 388, 8, 490, 561, 576, 678, 794], agony: [522, 386, 20, 498, 553, 578, 665, 776], sad: [506, 400, -2, 491, 559, 593, 665, 770] } },
  whale: { w: [368, 331], p: { base: [484, 475, 0, 466, 640, 587, 739, 838], joy: [466, 474, -1, 448, 640, 567, 739, 838], agony: [493, 456, -1, 475, 621, 594, 720, 818], sad: [489, 479, 24, 463, 640, 583, 736, 832] } },
  dokkaebi: { w: [406, 365], p: { base: [523, 338, 0, 503, 566, 576, 696, 826], joy: [582, 357, 182, 476, 574, 581, 700, 826], agony: [526, 334, 1, 505, 563, 563, 693, 824], sad: [494, 343, 47, 454, 561, 585, 685, 808] } },
  mole: { w: [344, 310], p: { base: [514, 346, 0, 497, 578, 610, 710, 842], joy: [497, 354, 6, 478, 581, 606, 712, 842], agony: [509, 341, -1, 492, 574, 603, 706, 838], sad: [453, 372, -4, 438, 592, 535, 716, 840] } },
  golem: { w: [272, 245], p: { base: [486, 375, 0, 472, 544, 562, 689, 834], joy: [507, 364, 12, 489, 534, 607, 682, 830], agony: [490, 380, 8, 475, 540, 576, 679, 818], sad: [461, 399, 5, 447, 554, 539, 688, 822] } },
  cloud: { w: [362, 326], p: { base: [518, 410, 0, 499, 608, 619, 712, 816], joy: [476, 427, 8, 455, 617, 596, 718, 820], agony: [529, 405, 13, 506, 596, 637, 697, 798], sad: [493, 399, -6, 476, 596, 586, 699, 802] } },
  owl: { w: [356, 314], p: { base: [536, 342, 0, 486, 590, 636, 709, 828], joy: [545, 346, 10, 491, 590, 625, 709, 828], agony: [572, 372, 84, 485, 598, 620, 708, 818], sad: [531, 352, 2, 480, 599, 646, 719, 838] } },
  sheep: { w: [428, 385], p: { base: [509, 405, 0, 488, 566, 629, 675, 784], joy: [490, 398, 3, 467, 561, 617, 671, 782], agony: [515, 401, -10, 497, 563, 617, 672, 780], sad: [516, 403, -1, 493, 580, 646, 700, 820] } },
  moonrabbit: { w: [434, 278], p: { base: [534, 395, 0, 496, 604, 607, 714, 824], joy: [530, 255, 25, 465, 535, 602, 676, 818], agony: [537, 313, -30, 508, 553, 593, 678, 802], sad: [466, 424, -51, 451, 619, 551, 719, 820] } },
  mimic: { w: [426, 383], p: { base: [529, 385, 0, 508, 528, 648, 663, 798], joy: [527, 387, 3, 506, 526, 647, 657, 788], agony: [526, 399, 3, 505, 538, 646, 669, 800], sad: [507, 409, 3, 488, 532, 614, 649, 766] } },
  gumiho: { w: [452, 407], p: { base: [529, 408, 0, 506, 598, 656, 721, 844], joy: [530, 409, 2, 507, 598, 661, 721, 844], agony: [507, 425, 5, 485, 595, 629, 705, 816], sad: [452, 445, 3, 431, 615, 572, 725, 836] } },
  haetae: { w: [342, 308], p: { base: [469, 332, 0, 452, 470, 565, 638, 806], joy: [482, 288, 1, 461, 453, 581, 650, 848], agony: [513, 306, 12, 491, 453, 570, 630, 808], sad: [453, 387, 17, 434, 508, 555, 659, 810] } },
  ssukddeok: { w: [360, 324], p: { base: [517, 372, 0, 499, 616, 618, 709, 802], joy: [521, 373, 2, 502, 614, 627, 707, 800], agony: [561, 338, 43, 518, 602, 648, 703, 804], sad: [509, 399, -1, 493, 627, 601, 715, 802] } },
  raccoon: { w: [354, 280], p: { base: [478, 388, 0, 460, 586, 577, 710, 834], joy: [451, 361, 4, 430, 574, 567, 708, 842], agony: [495, 362, 59, 450, 576, 610, 710, 844], sad: [463, 378, 2, 444, 580, 558, 706, 832] } },
  sprout: { w: [274, 247], p: { base: [553, 399, 0, 499, 602, 612, 692, 782], joy: [564, 398, 89, 469, 602, 596, 693, 784], agony: [573, 402, 46, 494, 619, 601, 716, 812], sad: [517, 448, -42, 482, 649, 598, 738, 828] } },
  cactus: { w: [334, 301], p: { base: [519, 383, 0, 502, 614, 613, 741, 868], joy: [515, 384, 4, 497, 612, 616, 738, 864], agony: [546, 388, 27, 517, 612, 622, 736, 860], sad: [498, 370, -4, 483, 600, 582, 726, 852] } },
};
// @generated-end

/** 손으로 고치는 값 하나: x·y = 그 자리로 (잰 값 대신), dx·dy = 잰 값에서 옮기기, rot = 기울기 (잰 값 대신), scale = 크기 배수, behind = 몸 뒤에. */
interface SlotFix {
  readonly x?: number;
  readonly y?: number;
  readonly dx?: number;
  readonly dy?: number;
  readonly rot?: number;
  readonly scale?: number;
  readonly behind?: boolean;
}
type PoseFix = Partial<Record<AccessorySlot, SlotFix>>;
/**
 * 종 하나 고치기: size = 자리 기준 폭 (잰 값 대신), neckAt·sideAt = 목·옆구리 높이를 머리 꼭대기 → 몸 바닥 비율로 (모든 포즈, 잰 값 대신),
 * all = 모든 포즈에 먼저, 그다음 포즈마다.
 */
interface SpeciesFix extends Partial<Record<AnchorPose, PoseFix>> {
  readonly size?: Partial<Record<AccessorySlot, number>>;
  readonly neckAt?: number;
  readonly sideAt?: number;
  readonly all?: PoseFix;
}

/** 잰 값이 어긋난 종 (개발용 미리보기 src/view/closeup/_dev/accessory_preview.html로 보며 맞춘다). */
const FIXES: Partial<Record<SpeciesId, SpeciesFix>> = {
  // 목 높이 (neckAt): 잰 턱선이 입에 걸린 종이 많다 (장신구가 입을 가린다). 입 아래 턱선으로 내린다.
  dragon: { neckAt: 0.5 },
  goblin: { neckAt: 0.5 },
  bat: { neckAt: 0.54 },
  ghost: { neckAt: 0.58 },
  otter: { neckAt: 0.53 },
  octopus: { neckAt: 0.6 },
  whale: { neckAt: 0.55 },
  dokkaebi: { neckAt: 0.53 },
  mole: { neckAt: 0.54 },
  golem: { neckAt: 0.45 },
  cloud: { neckAt: 0.62 },
  owl: { neckAt: 0.55 },
  // 달토끼: 잰 머리 꼭대기가 기쁨·괴로움 포즈에서 선 귀 끝으로 올라간다. 모든 포즈에서 두 귀 사이 머리 꼭대기에 (포즈가 바뀌어도 모자가 튀지 않게).
  moonrabbit: { neckAt: 0.55, joy: { head: { x: 548, y: 320 } }, agony: { head: { x: 548, y: 358 } } },
  mimic: { neckAt: 0.46 },
  gumiho: { neckAt: 0.5 },
  // 해태는 그림에 방울 목걸이가 있다: 그 자리에.
  haetae: { neckAt: 0.45 },
  ssukddeok: { neckAt: 0.6 },
  raccoon: { neckAt: 0.5 },
  sprout: { neckAt: 0.63 },
  // 선인장: 머리 장신구는 꽃 위가 아니라 꽃 뒤 몸 꼭대기에 (꽃이 앞에 조금 보인다).
  cactus: { neckAt: 0.46, all: { head: { dx: -12, dy: 26 } } },
  // 푸딩: 머리 장신구는 체리 왼쪽 캐러멜 위, 목은 얼굴 아래.
  pudding: { neckAt: 0.62, all: { head: { dx: -40, dy: 20 } } },
  // 무: 모자는 잎 위에 (잎이 머리카락), 조금 잎 안으로. 목은 얼굴 아래.
  radish: { neckAt: 0.62, all: { head: { dy: 30 } } },
  // 단호박: 꼭지가 남아 있어 호박 위 앞쪽으로.
  kabocha: { neckAt: 0.58, all: { head: { dx: -28, dy: 42 } } },
  // 게: 머리 = 등딱지 위 (집게를 든 포즈는 잰 축이 집게로 끌려간다), 목 = 앞쪽 배 띠 위.
  crab: {
    size: { head: 330, neck: 300 },
    base: { neck: { x: 520, y: 705 } },
    joy: { head: { x: 538, y: 560, rot: 0 }, neck: { x: 520, y: 700 } },
    agony: { head: { x: 530, y: 500, rot: 0 }, neck: { x: 500, y: 665 } },
    sad: { head: { x: 556, y: 562, rot: 0 }, neck: { x: 520, y: 718 } },
  },
  // 거북: 머리 = 왼쪽 앞으로 내민 머리 (등딱지 위 개구리가 아니라), 목 = 머리와 등딱지 사이.
  turtle: {
    size: { head: 230, neck: 200 },
    base: { head: { x: 320, y: 548, rot: 0 }, neck: { x: 440, y: 660, rot: -0.3 } },
    joy: { head: { x: 318, y: 540, rot: -0.1 }, neck: { x: 425, y: 645, rot: -0.3 } },
    agony: { head: { x: 360, y: 482, rot: -0.25 }, neck: { x: 480, y: 655, rot: -0.3 } },
    sad: { head: { x: 362, y: 584, rot: 0.2 }, neck: { x: 495, y: 690, rot: -0.2 } },
  },
  // 양: 머리 = 얼굴(왼쪽) 위 양털, 목 = 얼굴 아래.
  sheep: {
    size: { head: 320, neck: 260 },
    base: { head: { x: 452, y: 395, rot: 0 }, neck: { x: 440, y: 630 } },
    joy: { head: { x: 440, y: 386, rot: 0 }, neck: { x: 420, y: 615 } },
    agony: { head: { x: 455, y: 386, rot: 0 }, neck: { x: 430, y: 620 } },
    sad: { head: { x: 410, y: 460, rot: -0.3 }, neck: { x: 390, y: 700 } },
  },
};

function fixSlot(a: AccessoryAnchor, f: SlotFix | undefined): AccessoryAnchor {
  if (f === undefined) return a;
  return {
    x: (f.x ?? a.x) + (f.dx ?? 0),
    y: (f.y ?? a.y) + (f.dy ?? 0),
    rot: f.rot ?? a.rot,
    scale: (a.scale ?? 1) * (f.scale ?? 1),
    behind: f.behind ?? a.behind,
  };
}

function build(): Partial<Record<SpeciesId, SpeciesAnchors>> {
  const out: Partial<Record<SpeciesId, SpeciesAnchors>> = {};
  for (const [sp, m] of Object.entries(MEASURED) as [SpeciesId, Measured][]) {
    const fix = FIXES[sp];
    const poses = {} as Record<AnchorPose, Record<AccessorySlot, AccessoryAnchor>>;
    for (const pose of ANCHOR_POSES) {
      const v = m.p[pose];
      const span = v[7] - v[1];
      const row: Record<AccessorySlot, AccessoryAnchor> = {
        head: { x: v[0], y: v[1], rot: v[2] / 1000 },
        neck: { x: v[3], y: fix?.neckAt === undefined ? v[4] : v[1] + span * fix.neckAt },
        side: { x: v[5], y: fix?.sideAt === undefined ? v[6] : v[1] + span * fix.sideAt },
      };
      for (const slot of ['head', 'neck', 'side'] as const) row[slot] = fixSlot(fixSlot(row[slot], fix?.all?.[slot]), fix?.[pose]?.[slot]);
      poses[pose] = row;
    }
    const size = { head: m.w[0], neck: m.w[1], side: m.w[0], ...fix?.size };
    out[sp] = { size, poses };
  }
  return out;
}

/** 종 → 자리 기준 폭·포즈마다 붙는 점 (잰 값 + 손으로 고친 값). 없는 종은 화면(view/accessory.ts)이 몸 그림 상자로 대략 정한다. */
export const ACCESSORY_ANCHORS: Readonly<Partial<Record<SpeciesId, SpeciesAnchors>>> = build();
