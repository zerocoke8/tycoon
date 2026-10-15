// 반응 고르기: 등급 × 성격 × 기분 → Reaction (포즈, 이모트, 연출, 세기, 시간, 이름).
// 등급마다 후보 3~5개를 무게로 뽑는다. 이름(label)은 도감에 남는다.
// 처음 네 부스는 공통 표(TABLE), 둘째 묶음 부스(돌림판·오리 낚시·고리 던지기·경주장·인형 뽑기·복주머니)는 부스마다 자기 표(BOOTH_TABLE).
// 경주장은 경주 중 응원(raceCheerReaction)과 경주로 근처 구경꾼(raceSpectateReaction)도 따로.

import type { Rng } from '../core/rng.ts';
import { MOOD, type BoothId, type OutcomeTier, type TraitId } from '../data/defs.ts';
import { TUNE } from './tuning.ts';
import type { EmoteKind, Monster, Motion, Pose, Reaction } from './types.ts';

/** 반응 등급: 놀이 결과 + 빈털터리. */
export type ReactTier = OutcomeTier | 'broke';

/** 후보 꼬리표: 성격·기분이 무게를 바꾼다. main = 그 등급의 대표 반응 (2배 자주). */
type Tag = 'main' | 'loud' | 'calm' | 'tear' | 'bright' | 'gloom' | 'angry';

interface Cand {
  readonly pose: Pose;
  readonly emote: EmoteKind | null;
  readonly motion: Motion;
  readonly label: string;
  /** 기본 세기 배수. */
  readonly k: number;
  /** 기본 시간 (초). */
  readonly sec: number;
  readonly tags: readonly Tag[];
}

const c = (pose: Pose, emote: EmoteKind | null, motion: Motion, label: string, k: number, sec: number, ...tags: Tag[]): Cand => ({ pose, emote, motion, label, k, sec, tags });

const TABLE: Record<ReactTier, readonly Cand[]> = {
  jackpot: [
    c('joy', 'sparkle', 'bigHop', '대박 만세', 1.2, 3.4, 'main', 'loud'),
    c('joy', 'heart', 'spin', '빙글빙글', 1.1, 3.2, 'loud'),
    c('joy', 'note', 'bounceLoop', '신나는 춤', 1.1, 3.6, 'loud', 'bright'),
    c('joy', 'shock', 'bigHop', '눈이 휘둥그레', 1.0, 3.0, 'calm'),
    c('joy', 'tear', 'tremble', '감격의 눈물', 1.0, 3.4, 'tear'),
  ],
  win: [
    c('joy', 'note', 'hop', '룰루랄라', 1.0, 2.2, 'bright'),
    c('joy', 'heart', 'hop', '야호', 1.0, 2.2, 'loud'),
    c('joy', 'sparkle', 'squash', '앗싸', 1.05, 2.0, 'loud'),
    c('base', 'note', 'bounceLoop', '콧노래', 0.85, 2.4, 'calm'),
  ],
  nearMiss: [
    c('agony', 'shock', 'tremble', '아깝다!', 1.1, 2.4, 'main'),
    c('agony', 'anger', 'shake', '으아악', 1.15, 2.4, 'loud', 'angry'),
    c('agony', 'sweat', 'squash', '조금만 더…', 0.95, 2.2, 'calm'),
    c('agony', 'shock', 'slump', '머리 감싸기', 1.0, 2.6, 'gloom'),
    c('agony', 'tear', 'tremble', '분해서 글썽', 1.0, 2.6, 'tear'),
  ],
  lose: [
    c('sad', 'tear', 'slump', '털썩', 1.0, 2.2, 'main', 'tear', 'gloom'),
    c('sad', 'storm', 'none', '먹구름', 0.95, 2.4, 'gloom'),
    c('sad', 'tear', 'tremble', '훌쩍', 1.0, 2.2, 'tear'),
    c('base', 'sweat', 'shake', '괜찮아, 괜찮아', 0.85, 1.8, 'bright', 'calm'),
    c('base', 'note', 'hop', '다음엔 꼭!', 0.9, 1.8, 'bright', 'loud'),
  ],
  broke: [
    c('sad', 'tear', 'slump', '빈털터리', 1.6, 3.6, 'main', 'tear'),
    c('sad', 'storm', 'slump', '텅 빈 지갑', 1.5, 3.6, 'gloom'),
    c('sad', 'tear', 'tremble', '엉엉', 1.6, 3.8, 'tear', 'loud'),
  ],
};

/** 둘째 묶음 부스의 결과 반응 (빈털터리는 공통 표). 오리 낚시는 느긋하게 (세기 작게, 지면 대개 기본 포즈). */
const BOOTH_TABLE: Partial<Record<BoothId, Record<OutcomeTier, readonly Cand[]>>> = {
  wheel: {
    jackpot: [
      c('joy', 'sparkle', 'bigHop', '종이다 종!', 1.2, 3.4, 'main', 'loud'),
      c('joy', 'note', 'bounceLoop', '딩동댕 만세', 1.1, 3.6, 'loud', 'bright'),
      c('joy', 'heart', 'spin', '바퀴 따라 빙그르르', 1.1, 3.2, 'loud'),
      c('joy', 'shock', 'tremble', '두 눈을 의심', 1.0, 3.0, 'calm'),
      c('joy', 'tear', 'tremble', '종소리에 울컥', 1.0, 3.4, 'tear'),
    ],
    win: [
      c('joy', 'sparkle', 'hop', '찜한 칸이다!', 1.05, 2.2, 'main', 'loud'),
      c('joy', 'note', 'squash', '딱 멈췄다', 1.0, 2.0, 'bright'),
      c('joy', 'heart', 'hop', '바퀴야 고마워', 1.0, 2.2, 'bright'),
      c('base', 'note', 'bounceLoop', '흥얼흥얼', 0.85, 2.4, 'calm'),
    ],
    nearMiss: [
      c('agony', 'shock', 'tremble', '한 칸 차이!', 1.1, 2.4, 'main'),
      c('agony', 'anger', 'shake', '멈춰라 멈춰!', 1.15, 2.4, 'loud', 'angry'),
      c('agony', 'sweat', 'squash', '넘어가지 마…', 0.95, 2.2, 'calm'),
      c('agony', 'tear', 'tremble', '바늘이 미워', 1.0, 2.6, 'tear'),
      c('agony', 'shock', 'slump', '눈앞이 빙글', 1.0, 2.6, 'gloom'),
    ],
    lose: [
      c('sad', 'tear', 'slump', '휙 지나갔다', 1.0, 2.2, 'main', 'tear', 'gloom'),
      c('sad', 'storm', 'none', '바퀴만 빙글빙글', 0.95, 2.4, 'gloom'),
      c('base', 'sweat', 'tremble', '어질어질', 0.9, 2.0, 'calm'),
      c('base', 'note', 'hop', '한 번 더 돌려요!', 0.9, 1.8, 'bright', 'loud'),
    ],
  },
  duck: {
    jackpot: [
      c('joy', 'sparkle', 'bigHop', '금빛 오리다!', 1.1, 3.4, 'main', 'loud'),
      c('joy', 'note', 'bounceLoop', '꽥꽥 춤', 1.0, 3.4, 'bright', 'loud'),
      c('joy', 'heart', 'hop', '오리 꼭 안기', 0.95, 3.2, 'calm'),
      c('joy', 'tear', 'tremble', '물빛에 울컥', 0.95, 3.2, 'tear'),
    ],
    win: [
      c('joy', 'sparkle', 'hop', '은빛 반짝', 0.95, 2.2, 'main'),
      c('base', 'heart', 'none', '느긋한 미소', 0.8, 2.4, 'calm'),
      c('joy', 'note', 'bounceLoop', '살랑살랑', 0.9, 2.4, 'bright'),
      c('joy', 'heart', 'squash', '오리야 반가워', 0.9, 2.2, 'loud'),
    ],
    nearMiss: [
      c('agony', 'shock', 'tremble', '퐁당 놓쳤다', 0.95, 2.2, 'main'),
      c('agony', 'sweat', 'squash', '미끌미끌', 0.85, 2.0, 'calm'),
      c('agony', 'anger', 'shake', '오리가 도망가', 0.95, 2.2, 'loud', 'angry'),
      c('base', 'sweat', 'none', '물결만 출렁', 0.8, 2.0, 'calm', 'gloom'),
    ],
    lose: [
      c('base', 'sweat', 'none', '표식이 없네', 0.8, 1.8, 'main', 'calm'),
      c('base', 'note', 'hop', '그래도 즐거워', 0.85, 1.8, 'bright'),
      c('base', 'heart', 'none', '물놀이 기분', 0.8, 2.0, 'calm', 'bright'),
      c('sad', 'tear', 'slump', '살짝 시무룩', 0.85, 2.0, 'tear', 'gloom'),
    ],
  },
  ring: {
    jackpot: [
      c('joy', 'sparkle', 'bigHop', '셋 다 쏙쏙!', 1.2, 3.4, 'main', 'loud'),
      c('joy', 'note', 'spin', '고리 장인', 1.1, 3.2, 'loud'),
      c('joy', 'heart', 'bounceLoop', '어깨춤 덩실', 1.1, 3.6, 'bright', 'loud'),
      c('joy', 'shock', 'bigHop', '내가 던진 거 맞아?', 1.0, 3.0, 'calm'),
      c('joy', 'tear', 'tremble', '감동의 고리', 1.0, 3.4, 'tear'),
    ],
    win: [
      c('joy', 'sparkle', 'hop', '쏙 걸렸다', 1.0, 2.2, 'main'),
      c('joy', 'note', 'squash', '두 개면 충분', 1.0, 2.0, 'loud'),
      c('joy', 'heart', 'hop', '휘익 쏙', 1.0, 2.2, 'bright'),
      c('base', 'note', 'bounceLoop', '어깨 으쓱', 0.85, 2.4, 'calm'),
    ],
    nearMiss: [
      c('agony', 'shock', 'tremble', '빙글빙글 아깝다', 1.1, 2.4, 'main'),
      c('agony', 'anger', 'shake', '돌다가 툭!', 1.15, 2.4, 'loud', 'angry'),
      c('agony', 'sweat', 'squash', '병목에서 데굴', 0.95, 2.2, 'calm'),
      c('agony', 'tear', 'tremble', '고리가 야속해', 1.0, 2.6, 'tear'),
    ],
    lose: [
      c('sad', 'tear', 'slump', '고리만 데굴데굴', 1.0, 2.2, 'main', 'tear', 'gloom'),
      c('sad', 'storm', 'none', '병이 너무 멀어', 0.95, 2.4, 'gloom'),
      c('base', 'sweat', 'shake', '팔이 후들', 0.9, 2.0, 'calm'),
      c('base', 'note', 'hop', '다음엔 쏙!', 0.9, 1.8, 'bright', 'loud'),
    ],
  },
  race: {
    jackpot: [
      c('joy', 'sparkle', 'bigHop', '역전이다!', 1.3, 3.6, 'main', 'loud'),
      c('joy', 'shock', 'bigHop', '꼴찌가 1등!', 1.15, 3.2, 'calm'),
      c('joy', 'note', 'bounceLoop', '깃발 흔들기', 1.15, 3.6, 'loud', 'bright'),
      c('joy', 'heart', 'spin', '관중석이 들썩', 1.15, 3.4, 'loud'),
      c('joy', 'tear', 'tremble', '믿고 있었어', 1.1, 3.4, 'tear'),
    ],
    win: [
      c('joy', 'sparkle', 'hop', '1등이다!', 1.05, 2.4, 'main', 'loud'),
      c('joy', 'heart', 'hop', '내 선수 최고', 1.0, 2.4, 'loud'),
      c('joy', 'note', 'bounceLoop', '응원가 흥얼', 1.0, 2.6, 'bright'),
      c('base', 'heart', 'squash', '뿌듯한 미소', 0.85, 2.4, 'calm'),
    ],
    nearMiss: [
      c('agony', 'shock', 'tremble', '코끝 차이!', 1.15, 2.6, 'main'),
      c('agony', 'anger', 'shake', '사진 다시 봐요!', 1.15, 2.4, 'loud', 'angry'),
      c('agony', 'sweat', 'squash', '한 뼘만 더…', 0.95, 2.2, 'calm'),
      c('agony', 'tear', 'tremble', '결승선이 얄미워', 1.0, 2.6, 'tear'),
    ],
    lose: [
      c('sad', 'tear', 'slump', '털썩 주저앉기', 1.0, 2.2, 'main', 'tear', 'gloom'),
      c('sad', 'storm', 'none', '느림보야…', 0.95, 2.4, 'gloom'),
      c('base', 'sweat', 'shake', '그래도 잘 달렸어', 0.85, 2.0, 'calm', 'bright'),
      c('base', 'note', 'hop', '다음 경주는 꼭!', 0.9, 1.8, 'bright', 'loud'),
    ],
  },
  claw: {
    jackpot: [
      c('joy', 'sparkle', 'bigHop', '두 마리 한꺼번에!', 1.2, 3.4, 'main', 'loud'),
      c('joy', 'heart', 'spin', '인형 부자', 1.1, 3.2, 'loud'),
      c('joy', 'heart', 'bounceLoop', '꼭 안아 줄래', 1.05, 3.6, 'bright'),
      c('joy', 'shock', 'bigHop', '집게의 기적', 1.0, 3.0, 'calm'),
      c('joy', 'tear', 'tremble', '인형 품고 울컥', 1.0, 3.4, 'tear'),
    ],
    win: [
      c('joy', 'sparkle', 'hop', '쏙 뽑았다', 1.0, 2.2, 'main'),
      c('joy', 'heart', 'squash', '인형 꼬옥', 1.0, 2.2, 'bright'),
      c('joy', 'note', 'hop', '집게 최고', 1.0, 2.0, 'loud'),
      c('base', 'heart', 'bounceLoop', '수줍은 미소', 0.85, 2.4, 'calm'),
    ],
    nearMiss: [
      c('agony', 'shock', 'tremble', '구멍 앞에서 툭', 1.15, 2.6, 'main'),
      c('agony', 'anger', 'shake', '거의 다 왔는데!', 1.2, 2.4, 'loud', 'angry'),
      c('agony', 'sweat', 'squash', '집게가 미끄러워', 0.95, 2.2, 'calm'),
      c('agony', 'tear', 'tremble', '유리창에 글썽', 1.0, 2.6, 'tear'),
      c('agony', 'shock', 'slump', '털썩 무릎', 1.0, 2.6, 'gloom'),
    ],
    lose: [
      c('sad', 'sweat', 'none', '헛집기', 0.95, 2.0, 'main', 'calm'),
      c('sad', 'storm', 'none', '집게만 덜렁', 0.95, 2.4, 'gloom'),
      c('sad', 'tear', 'slump', '인형이 멀어', 1.0, 2.2, 'tear', 'gloom'),
      c('base', 'note', 'hop', '한 번만 더!', 0.9, 1.8, 'bright', 'loud'),
    ],
  },
  pouch: {
    jackpot: [
      c('joy', 'sparkle', 'bigHop', '복이 터졌다!', 1.2, 3.4, 'main', 'loud'),
      c('joy', 'note', 'bounceLoop', '복주머니 춤', 1.1, 3.6, 'loud', 'bright'),
      c('joy', 'heart', 'spin', '복 받았어요', 1.1, 3.2, 'bright'),
      c('joy', 'shock', 'bigHop', '번쩍번쩍', 1.0, 3.0, 'calm'),
      c('joy', 'tear', 'tremble', '주머니 꼭 안기', 1.0, 3.4, 'tear'),
    ],
    win: [
      c('joy', 'note', 'hop', '짤랑짤랑', 1.0, 2.2, 'main', 'bright'),
      c('joy', 'heart', 'hop', '복이 왔네', 1.0, 2.2, 'loud'),
      c('joy', 'sparkle', 'squash', '주머니 흔들흔들', 1.0, 2.0, 'loud'),
      c('base', 'heart', 'bounceLoop', '빙그레', 0.85, 2.4, 'calm'),
    ],
    nearMiss: [
      c('agony', 'shock', 'tremble', '동전 하나뿐', 1.05, 2.4, 'main'),
      c('agony', 'sweat', 'squash', '에게, 한 닢?', 0.95, 2.2, 'calm'),
      c('agony', 'anger', 'shake', '주머니 탈탈', 1.1, 2.4, 'loud', 'angry'),
      c('agony', 'tear', 'tremble', '아까운 한 닢', 1.0, 2.6, 'tear'),
    ],
    lose: [
      c('sad', 'storm', 'none', '먼지만 폴폴', 1.0, 2.4, 'main', 'gloom'),
      c('sad', 'sweat', 'shake', '콜록콜록', 0.95, 2.0, 'calm'),
      c('sad', 'tear', 'slump', '텅 빈 주머니', 1.0, 2.2, 'tear', 'gloom'),
      c('base', 'note', 'hop', '다음 복은 내 거', 0.9, 1.8, 'bright', 'loud'),
    ],
  },
};

const POSITIVE: ReadonlySet<ReactTier> = new Set(['jackpot', 'win']);

function weightOf(cand: Cand, traits: readonly TraitId[], mood: number, positive: boolean): number {
  let w = 1;
  const has = (t: TraitId) => traits.includes(t);
  for (const tag of cand.tags) {
    if (tag === 'main') w *= 2;
    if (tag === 'loud' && (has('cheerful') || has('bold'))) w *= has('cheerful') ? 2 : 1.4;
    if (tag === 'calm' && has('coward')) w *= 2;
    if (tag === 'tear' && has('crybaby')) w *= 2.5;
    if (tag === 'bright' && !positive) w *= mood >= 65 ? 2.5 : mood < 35 ? 0.3 : 1;
    if (tag === 'gloom') w *= mood < 35 ? 2 : mood >= 65 ? 0.5 : 1;
    if (tag === 'angry' && has('bold')) w *= 1.5;
  }
  return w;
}

function intensityOf(cand: Cand, traits: readonly TraitId[], mood: number, positive: boolean, boost: number): number {
  let k = cand.k * boost;
  if (positive && traits.includes('cheerful')) k *= 1.4;
  if (!positive && traits.includes('crybaby')) k *= 1.4;
  if (traits.includes('coward')) k *= 0.85;
  k *= mood >= 80 || mood < 20 ? 1.1 : 1;
  return Math.max(0.6, Math.min(2.2, k));
}

function build(cand: Cand, intensity: number): Reaction {
  return { pose: cand.pose, emote: cand.emote, motion: cand.motion, intensity, duration: cand.sec * (0.85 + 0.15 * intensity), label: cand.label };
}

function choose(rng: Rng, cands: readonly Cand[], m: Monster, positive: boolean): Cand {
  return rng.weighted(cands.map((x) => [x, weightOf(x, m.traits, m.mood, positive)] as const));
}

/** 이 부스·등급의 결과 반응 후보 (둘째 묶음 부스는 자기 표, 그 밖과 빈털터리는 공통 표). */
function candidates(tier: ReactTier, booth: BoothId | null): readonly Cand[] {
  if (tier === 'broke' || booth === null) return TABLE[tier];
  return BOOTH_TABLE[booth]?.[tier] ?? TABLE[tier];
}

/** 한판 결과 반응. boost = 응원 도구의 반응 배수 (없으면 1). booth를 주면 그 부스의 반응 표. */
export function pickReaction(rng: Rng, tier: ReactTier, m: Monster, boost = 1, booth: BoothId | null = null): Reaction {
  const positive = POSITIVE.has(tier);
  const cand = choose(rng, candidates(tier, booth), m, positive);
  return build(cand, intensityOf(cand, m.traits, m.mood, positive, boost));
}

/** 이 부스·등급에서 나올 수 있는 반응 이름 (도감·시험용). */
export function reactionLabels(tier: ReactTier, booth: BoothId | null = null): string[] {
  return candidates(tier, booth).map((x) => x.label);
}

const SPECTATE: Record<OutcomeTier, readonly Cand[]> = {
  jackpot: [
    c('joy', 'heart', 'hop', '부러워라', 0.9, 2.0, 'bright'),
    c('base', 'sparkle', 'hop', '우와!', 0.9, 1.8, 'loud'),
    c('joy', 'note', 'bounceLoop', '박수 짝짝', 0.9, 2.2, 'loud'),
  ],
  win: [
    c('base', 'note', 'hop', '좋겠다', 0.8, 1.6, 'bright'),
    c('joy', 'heart', 'none', '같이 신나', 0.8, 1.6, 'loud'),
  ],
  nearMiss: [
    c('agony', 'shock', 'hop', '어머나', 0.85, 1.8, 'loud'),
    c('base', 'sweat', 'none', '아이고', 0.8, 1.6, 'calm'),
    c('agony', 'sweat', 'tremble', '내가 다 아깝네', 0.85, 1.8, 'tear'),
  ],
  lose: [c('base', 'sweat', 'none', '토닥토닥', 0.8, 1.4, 'calm')],
};

/** 구경꾼 반응 (다른 손님의 결과를 보고). */
export function spectateReaction(rng: Rng, tier: OutcomeTier, m: Monster): Reaction {
  const positive = POSITIVE.has(tier);
  const cand = choose(rng, SPECTATE[tier], m, positive);
  return build(cand, intensityOf(cand, m.traits, m.mood, true, 1));
}

/** 경주로 근처 구경꾼: 경주 하나를 보고 (jackpot = 역전 경주, nearMiss = 사진 판정, win = 그 밖의 결승). */
const RACE_SPECTATE: Record<OutcomeTier, readonly Cand[]> = {
  jackpot: [
    c('joy', 'sparkle', 'hop', '대역전에 박수', 0.95, 2.2, 'loud'),
    c('base', 'shock', 'hop', '우와 역전!', 0.9, 1.8, 'calm'),
    c('joy', 'note', 'bounceLoop', '같이 들썩', 0.9, 2.2, 'bright'),
  ],
  win: [
    c('base', 'note', 'hop', '와아 결승!', 0.85, 1.8, 'bright'),
    c('joy', 'heart', 'hop', '선수들 최고', 0.85, 1.8, 'loud'),
    c('base', 'sparkle', 'none', '구경 잘했다', 0.8, 1.6, 'calm'),
  ],
  nearMiss: [
    c('agony', 'shock', 'hop', '사진 판정이래', 0.9, 2.0, 'loud'),
    c('base', 'sweat', 'none', '코앞이었는데', 0.8, 1.8, 'calm'),
    c('agony', 'sweat', 'tremble', '손에 땀이 나', 0.85, 1.8, 'tear'),
  ],
  lose: [c('base', 'note', 'hop', '재밌는 경주', 0.8, 1.6, 'bright')],
};

export function raceSpectateReaction(rng: Rng, tier: OutcomeTier, m: Monster): Reaction {
  const cand = choose(rng, RACE_SPECTATE[tier], m, POSITIVE.has(tier));
  return build(cand, intensityOf(cand, m.traits, m.mood, true, 1));
}

/** 경주 중 참가자 응원: lead = 자기 선수가 1등으로 (들썩), behind = 1등을 뺏기거나 꼴찌 (땀). 짧고 작게. */
const RACE_CHEER: Record<'lead' | 'behind', readonly Cand[]> = {
  lead: [
    c('joy', 'note', 'hop', '달려라 달려!', 0.85, 1.3, 'main', 'loud'),
    c('joy', 'heart', 'hop', '선두다!', 0.85, 1.2, 'bright'),
    c('base', 'sparkle', 'squash', '그대로 그대로', 0.8, 1.2, 'calm'),
  ],
  behind: [
    c('agony', 'sweat', 'tremble', '힘내 힘내', 0.85, 1.3, 'main'),
    c('agony', 'shock', 'shake', '앗, 따라잡혔다', 0.9, 1.2, 'loud'),
    c('base', 'sweat', 'squash', '조마조마', 0.8, 1.3, 'calm', 'tear'),
  ],
};

export function raceCheerReaction(rng: Rng, kind: 'lead' | 'behind', m: Monster, boost = 1): Reaction {
  const positive = kind === 'lead';
  const cand = choose(rng, RACE_CHEER[kind], m, positive);
  return build(cand, Math.min(1.3, intensityOf(cand, m.traits, m.mood, positive, boost)));
}

/** 간식을 받았을 때. 빈털터리였으면 웃으며 떠나는 큰 반응. */
export function snackReaction(rng: Rng, m: Monster): Reaction {
  if (m.broke === true) return build(c('joy', 'heart', 'bigHop', '웃으며 안녕', 1.3, 3.0), 1.3);
  const cands = [c('joy', 'heart', 'hop', '냠냠 행복', 1.0, 2.2), c('joy', 'note', 'bounceLoop', '간식 춤', 1.0, 2.4), c('joy', 'sparkle', 'squash', '꿀맛!', 1.0, 2.0)];
  const cand = rng.pick(cands);
  return build(cand, m.traits.includes('foodie') ? 1.4 : 1);
}

/**
 * 한판 뒤 기분 변화: MOOD.delta × 성격(흥부자 기쁨 1.6배, 울보 슬픔 1.6배) + 진행자 입담 + 응원 도구.
 * broke면 결과 변화에 빈털터리 변화를 더한다. lossScale = 내려가는 변화의 배수 (오리 낚시는 작게, 빈털터리는 그대로).
 */
export function moodDelta(tier: OutcomeTier, broke: boolean, m: Monster, charm: number, cheerMood: number, lossScale = 1): number {
  let d: number = MOOD.delta[tier];
  if (d > 0 && m.traits.includes('cheerful')) d *= TUNE.cheerfulJoy;
  if (d < 0 && m.traits.includes('crybaby')) d *= TUNE.crybabySad;
  if (d < 0) d *= lossScale;
  if (broke) d += MOOD.delta.broke * (m.traits.includes('crybaby') ? TUNE.crybabySad : 1);
  return d + charm * TUNE.charmMood + cheerMood;
}
