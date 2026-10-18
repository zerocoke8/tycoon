// 반응 고르기: 등급 × 성격 × 기분 → Reaction (포즈, 이모트, 연출, 세기, 시간, 이름).
// 등급마다 후보 3~5개를 무게로 뽑는다. 이름(label)은 도감에 남는다.
// 처음 네 부스는 공통 표(TABLE), 둘째·셋째 묶음 부스(돌림판·오리 낚시·고리 던지기·경주장·인형 뽑기·복주머니, 밀어내기·오리배·연·줄다리기·보물찾기)는
// 부스마다 자기 표(BOOTH_TABLE, 셋째 묶음은 GROUP_TABLE). 결과 세부가 후보를 좁힌다 (only: 밀어내기·연은 선수·구경 손님, 보물찾기는 나온 것).
// 단체 놀이는 진행 중 참가자 응원(groupCheerReaction, 사건마다 다른 말: on), 진행 중 근처 구경꾼(groupBuzzReaction),
// 결과 뒤 근처 구경꾼(groupSpectateReaction)도 부스마다 따로.

import type { Rng } from '../core/rng.ts';
import { MOOD, type BoothId, type GroupBoothId, type OutcomeTier, type TraitId } from '../data/defs.ts';
import { TUNE } from './tuning.ts';
import type { EmoteKind, GroupBuzz, Monster, Motion, Pose, Reaction, RoundDetail } from './types.ts';

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
  /** 결과 세부의 열쇠가 이것일 때만 (detailKeys: 'player'·'bettor', 보물찾기 'coins'·'gem'·'boot'·'pebble'). 없으면 늘. */
  readonly only?: string;
  /** 응원: 이 사건 열쇠일 때만 (cheerKey: 'lead'·'brink'·'flip'·'cut'·'find'… 남의 일이면 뒤에 ':other'). 없으면 사건 말이 없을 때. */
  readonly on?: readonly string[];
}

const c = (pose: Pose, emote: EmoteKind | null, motion: Motion, label: string, k: number, sec: number, ...tags: Tag[]): Cand => ({ pose, emote, motion, label, k, sec, tags });
/** 결과 세부 열쇠가 key일 때만 나오는 후보. */
const only = (key: string, cands: readonly Cand[]): Cand[] => cands.map((x) => ({ ...x, only: key }));
/** 응원 사건 열쇠가 keys 가운데 하나일 때만 나오는 후보. */
const on = (keys: readonly string[], cands: readonly Cand[]): Cand[] => cands.map((x) => ({ ...x, on: keys }));

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
const SECOND_TABLE: Partial<Record<BoothId, Record<OutcomeTier, readonly Cand[]>>> = {
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

/**
 * 셋째 묶음 단체 놀이의 결과 반응. 밀어내기·연은 선수(player)와 구경하며 건 손님(bettor)이 다른 말을 한다 (벌러덩은 모래판의 선수만),
 * 보물찾기는 나온 것마다 (헌 장화·조약돌·동전·보석). 줄다리기 진 편은 우르르 넘어지고, 이긴 편은 엉덩방아 뒤 만세.
 */
const GROUP_TABLE: Record<Exclude<GroupBoothId, 'race'>, Record<OutcomeTier, readonly Cand[]>> = {
  ssireum: {
    jackpot: [
      ...only('player', [
        c('joy', 'sparkle', 'bigHop', '뒤집기!', 1.3, 3.6, 'main', 'loud'),
        c('joy', 'note', 'bounceLoop', '모래판의 영웅', 1.15, 3.6, 'loud', 'bright'),
        c('joy', 'shock', 'bigHop', '이게 되네?', 1.0, 3.0, 'calm'),
        c('joy', 'tear', 'tremble', '벼랑 끝 역전승', 1.05, 3.4, 'tear'),
      ]),
      ...only('bettor', [
        c('joy', 'sparkle', 'bigHop', '뒤집기 봤어?!', 1.2, 3.4, 'main', 'loud'),
        c('joy', 'heart', 'spin', '믿고 걸었지!', 1.1, 3.2, 'bright'),
        c('joy', 'tear', 'tremble', '손에 땀이 다 났네', 1.0, 3.2, 'tear', 'calm'),
      ]),
    ],
    win: [
      ...only('player', [
        c('joy', 'sparkle', 'hop', '밀어냈다!', 1.05, 2.4, 'main', 'loud'),
        c('joy', 'heart', 'squash', '번쩍 넘겼다', 1.0, 2.2, 'loud'),
        c('joy', 'note', 'hop', '힘자랑', 1.0, 2.2, 'bright'),
        c('base', 'note', 'bounceLoop', '모래 털고 씨익', 0.85, 2.4, 'calm'),
      ]),
      ...only('bettor', [
        c('joy', 'sparkle', 'hop', '우리 편 승!', 1.05, 2.4, 'main', 'loud'),
        c('joy', 'heart', 'hop', '응원한 보람', 1.0, 2.2, 'bright'),
        c('base', 'note', 'bounceLoop', '짝짝 박수', 0.85, 2.4, 'calm'),
      ]),
    ],
    nearMiss: [
      ...only('player', [
        c('agony', 'shock', 'tremble', '다 이겼는데!', 1.15, 2.6, 'main'),
        c('agony', 'anger', 'shake', '발이 미끄러졌어!', 1.15, 2.4, 'loud', 'angry'),
        c('agony', 'sweat', 'squash', '한 끗 차이', 0.95, 2.2, 'calm'),
        c('agony', 'tear', 'tremble', '분해서 모래 쾅', 1.0, 2.6, 'tear'),
      ]),
      ...only('bettor', [
        c('agony', 'shock', 'tremble', '아까운 우리 편', 1.1, 2.4, 'main'),
        c('agony', 'anger', 'shake', '거의 이겼잖아!', 1.1, 2.4, 'loud', 'angry'),
        c('agony', 'sweat', 'squash', '심장이 쿵', 0.95, 2.2, 'calm'),
      ]),
    ],
    lose: [
      ...only('player', [
        c('sad', 'tear', 'slump', '벌러덩', 1.0, 2.4, 'main', 'tear', 'gloom'),
        c('sad', 'storm', 'none', '모래 범벅', 0.95, 2.4, 'gloom'),
        c('base', 'sweat', 'shake', '하늘이 빙글', 0.9, 2.0, 'calm'),
        c('base', 'note', 'hop', '다음엔 안 져!', 0.9, 1.8, 'bright', 'loud'),
      ]),
      ...only('bettor', [
        c('sad', 'tear', 'slump', '내 편이 졌어', 1.0, 2.2, 'main', 'tear', 'gloom'),
        c('sad', 'storm', 'none', '아이고 넘어갔네', 0.95, 2.4, 'gloom'),
        c('base', 'note', 'hop', '다음엔 저쪽!', 0.9, 1.8, 'bright', 'loud'),
      ]),
    ],
  },
  boat: {
    jackpot: [
      c('joy', 'sparkle', 'bigHop', '물보라 역전', 1.3, 3.6, 'main', 'loud'),
      c('joy', 'shock', 'bigHop', '꼴찌 배가 1등!', 1.15, 3.2, 'calm'),
      c('joy', 'note', 'bounceLoop', '노 젓기 만세', 1.15, 3.6, 'loud', 'bright'),
      c('joy', 'heart', 'spin', '첨벙 만세', 1.15, 3.4, 'loud'),
      c('joy', 'tear', 'tremble', '배 따라 울컥', 1.1, 3.4, 'tear'),
    ],
    win: [
      c('joy', 'sparkle', 'hop', '내 배가 1등!', 1.05, 2.4, 'main', 'loud'),
      c('joy', 'heart', 'hop', '첨벙첨벙 신나', 1.0, 2.4, 'loud'),
      c('joy', 'note', 'bounceLoop', '뱃노래 흥얼', 1.0, 2.6, 'bright'),
      c('base', 'heart', 'squash', '물결 따라 미소', 0.85, 2.4, 'calm'),
    ],
    nearMiss: [
      c('agony', 'shock', 'tremble', '뱃머리 하나 차이!', 1.15, 2.6, 'main'),
      c('agony', 'anger', 'shake', '노를 더 저었으면!', 1.15, 2.4, 'loud', 'angry'),
      c('agony', 'sweat', 'squash', '물결 한 뼘', 0.95, 2.2, 'calm'),
      c('agony', 'tear', 'tremble', '부표가 얄미워', 1.0, 2.6, 'tear'),
    ],
    lose: [
      c('sad', 'tear', 'slump', '퐁당 시무룩', 1.0, 2.2, 'main', 'tear', 'gloom'),
      c('sad', 'storm', 'none', '물결만 출렁', 0.95, 2.4, 'gloom'),
      c('base', 'sweat', 'shake', '그래도 시원했어', 0.85, 2.0, 'calm', 'bright'),
      c('base', 'note', 'hop', '다음 배는 꼭!', 0.9, 1.8, 'bright', 'loud'),
    ],
  },
  kite: {
    jackpot: [
      c('joy', 'sparkle', 'bigHop', '끝까지 살아남았다!', 1.3, 3.6, 'main', 'loud'),
      c('joy', 'shock', 'bigHop', '끊길 뻔했는데!', 1.05, 3.2, 'calm'),
      ...only('player', [c('joy', 'note', 'bounceLoop', '하늘의 왕', 1.15, 3.6, 'loud', 'bright'), c('joy', 'tear', 'tremble', '얼레 꼭 쥐고 울컥', 1.05, 3.4, 'tear')]),
      ...only('bettor', [c('joy', 'heart', 'spin', '연아 고마워', 1.1, 3.4, 'bright'), c('joy', 'tear', 'tremble', '눈물 나게 좋아', 1.05, 3.4, 'tear')]),
    ],
    win: [
      c('joy', 'sparkle', 'hop', '끝까지 날았다', 1.05, 2.4, 'main', 'loud'),
      c('joy', 'note', 'hop', '높이 높이', 1.0, 2.2, 'bright'),
      ...only('player', [c('joy', 'heart', 'squash', '바람 타기 장인', 1.0, 2.2, 'loud'), c('base', 'note', 'bounceLoop', '얼레 감으며 씨익', 0.85, 2.4, 'calm')]),
      ...only('bettor', [c('joy', 'heart', 'squash', '내가 고른 연!', 1.0, 2.2, 'loud'), c('base', 'note', 'bounceLoop', '연 보는 눈이 있지', 0.85, 2.4, 'calm')]),
    ],
    nearMiss: [
      c('agony', 'shock', 'tremble', '조금만 버텼으면!', 1.15, 2.6, 'main'),
      c('agony', 'anger', 'shake', '바람이 미워!', 1.15, 2.4, 'loud', 'angry'),
      c('agony', 'sweat', 'squash', '훨훨 날아가네', 0.95, 2.2, 'calm'),
      c('agony', 'tear', 'tremble', '마지막에 끊어졌어', 1.0, 2.6, 'tear'),
    ],
    lose: [
      c('sad', 'tear', 'slump', '줄이 끊겼다', 1.0, 2.2, 'main', 'tear', 'gloom'),
      c('sad', 'storm', 'none', '연이 날아갔다', 0.95, 2.4, 'gloom'),
      c('base', 'note', 'hop', '다음엔 더 높이!', 0.9, 1.8, 'bright', 'loud'),
      ...only('player', [c('base', 'sweat', 'shake', '빈 얼레만 빙글', 0.85, 2.0, 'calm')]),
      ...only('bettor', [c('base', 'sweat', 'shake', '연아 잘 가', 0.85, 2.0, 'calm')]),
    ],
  },
  tug: {
    jackpot: [
      c('joy', 'sparkle', 'bigHop', '대역전 줄다리기!', 1.3, 3.6, 'main', 'loud'),
      c('joy', 'note', 'bounceLoop', '끝까지 버텼다', 1.15, 3.6, 'loud', 'bright'),
      c('joy', 'heart', 'spin', '영차 만세', 1.15, 3.4, 'loud'),
      c('joy', 'shock', 'bigHop', '얼떨떨', 1.0, 3.0, 'calm'),
      c('joy', 'tear', 'tremble', '줄 잡고 엉엉', 1.05, 3.4, 'tear'),
    ],
    win: [
      c('joy', 'heart', 'squash', '엉덩방아 만세', 1.05, 2.4, 'main', 'bright'),
      c('joy', 'sparkle', 'hop', '우리 편 이겼다', 1.05, 2.4, 'loud'),
      c('joy', 'note', 'hop', '줄다리기 최고', 1.0, 2.2, 'loud'),
      c('base', 'sweat', 'bounceLoop', '후유 이겼다', 0.85, 2.4, 'calm'),
    ],
    nearMiss: [
      c('agony', 'shock', 'tremble', '거의 이겼는데!', 1.15, 2.6, 'main'),
      c('agony', 'anger', 'shake', '으아 끌려갔다', 1.15, 2.4, 'loud', 'angry'),
      c('agony', 'sweat', 'squash', '손이 미끄러졌어', 0.95, 2.2, 'calm'),
      c('agony', 'tear', 'tremble', '줄이 야속해', 1.0, 2.6, 'tear'),
    ],
    lose: [
      c('sad', 'tear', 'slump', '우르르', 1.0, 2.4, 'main', 'tear', 'gloom'),
      c('sad', 'storm', 'none', '손바닥 얼얼', 0.95, 2.4, 'gloom'),
      c('base', 'sweat', 'shake', '팔이 덜덜', 0.9, 2.0, 'calm'),
      c('base', 'note', 'hop', '다음엔 더 세게!', 0.9, 1.8, 'bright', 'loud'),
    ],
  },
  dig: {
    jackpot: [
      c('joy', 'sparkle', 'bigHop', '보물상자다!', 1.3, 3.6, 'main', 'loud'),
      c('joy', 'note', 'bounceLoop', '삽질의 보람', 1.15, 3.6, 'loud', 'bright'),
      c('joy', 'heart', 'spin', '반짝반짝 상자', 1.15, 3.4, 'bright'),
      c('joy', 'shock', 'bigHop', '꿈만 같아', 1.0, 3.0, 'calm'),
      c('joy', 'tear', 'tremble', '상자 안고 울컥', 1.05, 3.4, 'tear'),
    ],
    win: [
      c('joy', 'sparkle', 'hop', '흙 속의 보물', 1.05, 2.4, 'loud'),
      c('base', 'note', 'bounceLoop', '삽 들고 씨익', 0.85, 2.4, 'calm'),
      ...only('coins', [c('joy', 'heart', 'squash', '동전 주머니!', 1.0, 2.2, 'main', 'bright'), c('joy', 'note', 'hop', '짤랑짤랑', 1.0, 2.2, 'loud')]),
      ...only('gem', [c('joy', 'sparkle', 'squash', '반짝 보석!', 1.0, 2.2, 'main', 'bright'), c('joy', 'heart', 'hop', '보석이 쏙', 1.0, 2.2, 'loud')]),
    ],
    nearMiss: [
      c('agony', 'shock', 'tremble', '바로 옆이었는데!', 1.15, 2.6, 'main'),
      c('agony', 'anger', 'shake', '한 삽만 옆이었으면', 1.15, 2.4, 'loud', 'angry'),
      c('agony', 'sweat', 'squash', '흙만 한가득', 0.95, 2.2, 'calm'),
      c('agony', 'tear', 'tremble', '상자가 눈앞에', 1.0, 2.6, 'tear'),
    ],
    lose: [
      c('base', 'sweat', 'shake', '흙투성이', 0.85, 2.0, 'calm'),
      c('base', 'note', 'hop', '다음엔 꼭 찾을래', 0.9, 1.8, 'bright', 'loud'),
      ...only('boot', [c('sad', 'tear', 'slump', '헌 장화…', 1.0, 2.2, 'main', 'tear', 'gloom'), c('sad', 'storm', 'none', '장화 한 짝', 0.95, 2.4, 'gloom')]),
      ...only('pebble', [c('sad', 'tear', 'slump', '조약돌 하나', 1.0, 2.2, 'main', 'tear', 'gloom'), c('sad', 'storm', 'none', '돌멩이네', 0.95, 2.4, 'gloom')]),
    ],
  },
};

const BOOTH_TABLE: Partial<Record<BoothId, Record<OutcomeTier, readonly Cand[]>>> = { ...SECOND_TABLE, ...GROUP_TABLE };

/**
 * 결과 세부의 열쇠 (후보의 only와 맞춘다): 밀어내기 = 선수·구경 손님, 연 = 날린 손님·구경 손님, 보물찾기 = 나온 것.
 * 다른 부스는 없다 (only가 붙은 후보가 없다).
 */
export function detailKeys(d: RoundDetail | null | undefined): string[] {
  if (d === null || d === undefined) return [];
  switch (d.kind) {
    case 'ssireum':
    case 'kite':
      return [d.role];
    case 'dig':
      return [d.find];
    default:
      return [];
  }
}

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

/** 이 부스·등급의 결과 반응 후보 (둘째·셋째 묶음 부스는 자기 표, 그 밖과 빈털터리는 공통 표). keys = 결과 세부 열쇠 (only가 맞는 후보만). */
function candidates(tier: ReactTier, booth: BoothId | null, keys: readonly string[] = []): readonly Cand[] {
  if (tier === 'broke' || booth === null) return TABLE[tier];
  const all = BOOTH_TABLE[booth]?.[tier] ?? TABLE[tier];
  const fit = all.filter((x) => x.only === undefined || keys.includes(x.only));
  return fit.length > 0 ? fit : all;
}

/** 한판 결과 반응. boost = 응원 도구의 반응 배수 (없으면 1). booth를 주면 그 부스의 반응 표, detail을 주면 그 세부에 맞는 후보만. */
export function pickReaction(rng: Rng, tier: ReactTier, m: Monster, boost = 1, booth: BoothId | null = null, detail: RoundDetail | null = null): Reaction {
  const positive = POSITIVE.has(tier);
  const cand = choose(rng, candidates(tier, booth, detailKeys(detail)), m, positive);
  return build(cand, intensityOf(cand, m.traits, m.mood, positive, boost));
}

/**
 * 이 부스·등급에서 나올 수 있는 반응 이름 (도감·시험용). key를 주면 그 세부 열쇠의 손님에게 나올 수 있는 이름만
 * (only가 붙은 후보는 그 열쇠일 때만), 없으면 그 등급의 모든 이름.
 */
export function reactionLabels(tier: ReactTier, booth: BoothId | null = null, key?: string): string[] {
  const cands = key === undefined ? (tier === 'broke' || booth === null ? TABLE[tier] : (BOOTH_TABLE[booth]?.[tier] ?? TABLE[tier])) : candidates(tier, booth, [key]);
  return cands.map((x) => x.label);
}

/** 결과 세부 열쇠의 종류 (시험용: 그 부스·등급의 후보에 only로 쓰인 열쇠들, 없으면 빈 목록). */
export function reactionKeys(booth: BoothId, tier: OutcomeTier): string[] {
  const keys = new Set<string>();
  for (const x of BOOTH_TABLE[booth]?.[tier] ?? []) if (x.only !== undefined) keys.add(x.only);
  return [...keys];
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

/** 단체 놀이마다 결과 뒤 근처 구경꾼 반응 (jackpot = 역전·뒤집기, nearMiss = 아슬아슬, win = 그 밖). */
const GROUP_SPECTATE: Record<GroupBoothId, Record<OutcomeTier, readonly Cand[]>> = {
  race: RACE_SPECTATE,
  boat: {
    jackpot: [c('joy', 'sparkle', 'hop', '오리배 대역전!', 0.95, 2.2, 'loud'), c('base', 'shock', 'hop', '물 위의 역전', 0.9, 1.8, 'calm'), c('joy', 'note', 'bounceLoop', '같이 첨벙', 0.9, 2.2, 'bright')],
    win: [c('base', 'note', 'hop', '와아 골인!', 0.85, 1.8, 'bright'), c('joy', 'heart', 'hop', '배들 최고', 0.85, 1.8, 'loud'), c('base', 'sparkle', 'none', '연못 구경 잘했다', 0.8, 1.6, 'calm')],
    nearMiss: [c('agony', 'shock', 'hop', '뱃머리 판정이래', 0.9, 2.0, 'loud'), c('base', 'sweat', 'none', '코앞이었네', 0.8, 1.8, 'calm'), c('agony', 'sweat', 'tremble', '물보라에 땀이', 0.85, 1.8, 'tear')],
    lose: [c('base', 'note', 'hop', '재밌는 뱃놀이', 0.8, 1.6, 'bright')],
  },
  ssireum: {
    jackpot: [c('joy', 'sparkle', 'hop', '뒤집기에 박수', 0.95, 2.2, 'loud'), c('base', 'shock', 'hop', '우와 뒤집었다', 0.9, 1.8, 'calm'), c('joy', 'note', 'bounceLoop', '덩실덩실', 0.9, 2.2, 'bright')],
    win: [c('base', 'note', 'hop', '멋진 한판', 0.85, 1.8, 'bright'), c('joy', 'heart', 'hop', '힘이 장사네', 0.85, 1.8, 'loud'), c('base', 'sparkle', 'none', '대결 구경 잘했다', 0.8, 1.6, 'calm')],
    nearMiss: [c('agony', 'shock', 'hop', '아슬아슬했다', 0.9, 2.0, 'loud'), c('base', 'sweat', 'none', '손에 땀이', 0.8, 1.8, 'calm'), c('agony', 'sweat', 'tremble', '아이고 아까워', 0.85, 1.8, 'tear')],
    lose: [c('base', 'note', 'hop', '좋은 승부', 0.8, 1.6, 'bright')],
  },
  kite: {
    jackpot: [c('joy', 'sparkle', 'hop', '연싸움 장관', 0.95, 2.2, 'loud'), c('base', 'shock', 'hop', '와 살아남았다', 0.9, 1.8, 'calm'), c('joy', 'note', 'bounceLoop', '하늘 보며 박수', 0.9, 2.2, 'bright')],
    win: [c('base', 'note', 'hop', '연 구경 최고', 0.85, 1.8, 'bright'), c('joy', 'heart', 'hop', '높이 난다', 0.85, 1.8, 'loud'), c('base', 'sparkle', 'none', '바람 좋네', 0.8, 1.6, 'calm')],
    nearMiss: [c('agony', 'shock', 'hop', '어머 날아간다', 0.9, 2.0, 'loud'), c('base', 'sweat', 'none', '아깝게 끊겼네', 0.8, 1.8, 'calm'), c('agony', 'sweat', 'tremble', '실이 아까워', 0.85, 1.8, 'tear')],
    lose: [c('base', 'note', 'hop', '하늘이 예뻐', 0.8, 1.6, 'bright')],
  },
  tug: {
    jackpot: [c('joy', 'sparkle', 'hop', '역전 줄다리기!', 0.95, 2.2, 'loud'), c('base', 'shock', 'hop', '와 뒤집혔다', 0.9, 1.8, 'calm'), c('joy', 'note', 'bounceLoop', '들썩들썩', 0.9, 2.2, 'bright')],
    win: [c('base', 'note', 'hop', '영차 구경', 0.85, 1.8, 'bright'), c('joy', 'heart', 'hop', '힘내라 홍청', 0.85, 1.8, 'loud'), c('base', 'sparkle', 'none', '줄다리기 구경 끝', 0.8, 1.6, 'calm')],
    nearMiss: [c('agony', 'shock', 'hop', '팽팽했어', 0.9, 2.0, 'loud'), c('base', 'sweat', 'none', '아깝다 저 편', 0.8, 1.8, 'calm'), c('agony', 'sweat', 'tremble', '조마조마했네', 0.85, 1.8, 'tear')],
    lose: [c('base', 'note', 'hop', '재밌는 줄다리기', 0.8, 1.6, 'bright')],
  },
  dig: {
    jackpot: [c('joy', 'sparkle', 'hop', '상자가 나왔대', 0.95, 2.2, 'loud'), c('base', 'shock', 'hop', '우와 보물이다', 0.9, 1.8, 'calm'), c('joy', 'note', 'bounceLoop', '나도 파 볼래', 0.9, 2.2, 'bright')],
    win: [c('base', 'note', 'hop', '보물 구경', 0.85, 1.8, 'bright'), c('joy', 'heart', 'hop', '부럽다 보물', 0.85, 1.8, 'loud'), c('base', 'sparkle', 'none', '반짝반짝하네', 0.8, 1.6, 'calm')],
    nearMiss: [c('agony', 'shock', 'hop', '바로 옆이었대', 0.9, 2.0, 'loud'), c('base', 'sweat', 'none', '할아버지가 찾았네', 0.8, 1.8, 'calm'), c('agony', 'sweat', 'tremble', '아이고 아까워라', 0.85, 1.8, 'tear')],
    lose: [c('base', 'note', 'hop', '흙놀이 재밌다', 0.8, 1.6, 'bright')],
  },
};

/** 단체 놀이 근처 구경꾼: 판 하나를 보고 (등급은 GroupGame.crowd). */
export function groupSpectateReaction(rng: Rng, booth: GroupBoothId, tier: OutcomeTier, m: Monster): Reaction {
  const cand = choose(rng, GROUP_SPECTATE[booth][tier], m, POSITIVE.has(tier));
  return build(cand, intensityOf(cand, m.traits, m.mood, true, 1));
}

export function raceSpectateReaction(rng: Rng, tier: OutcomeTier, m: Monster): Reaction {
  return groupSpectateReaction(rng, 'race', tier, m);
}

/** 진행 중 큰 사건에 근처 구경꾼 (GroupBuzz): 놀이마다 없는 모양은 BUZZ. 작고 짧게. */
const BUZZ: Record<GroupBuzz, readonly Cand[]> = {
  wow: [c('joy', 'sparkle', 'hop', '우와아!', 0.9, 1.8, 'loud'), c('base', 'shock', 'hop', '눈을 의심', 0.85, 1.6, 'calm'), c('joy', 'note', 'bounceLoop', '들썩들썩!', 0.9, 2.0, 'bright')],
  gasp: [c('agony', 'shock', 'hop', '어머어머', 0.85, 1.6, 'loud'), c('base', 'sweat', 'none', '아슬아슬', 0.8, 1.5, 'calm'), c('agony', 'sweat', 'tremble', '못 보겠어', 0.8, 1.6, 'tear')],
  cheer: [c('base', 'note', 'hop', '오오!', 0.8, 1.4, 'bright'), c('joy', 'heart', 'hop', '힘내라!', 0.8, 1.4, 'loud'), c('base', 'sparkle', 'none', '재밌다', 0.75, 1.4, 'calm')],
  laugh: [c('joy', 'note', 'hop', '킥킥', 0.8, 1.4, 'bright'), c('base', 'note', 'squash', '푸핫', 0.8, 1.4, 'loud'), c('joy', 'heart', 'none', '귀여워라', 0.75, 1.4, 'calm')],
};

const GROUP_BUZZ: Record<GroupBoothId, Partial<Record<GroupBuzz, readonly Cand[]>>> = {
  race: {
    wow: [c('joy', 'sparkle', 'hop', '꼴찌가 치고 나온다!', 0.95, 1.8, 'loud'), c('base', 'shock', 'hop', '대역전 조짐!', 0.85, 1.6, 'calm'), c('joy', 'note', 'bounceLoop', '관중석이 들썩', 0.9, 2.0, 'bright')],
    cheer: [c('base', 'note', 'hop', '와 앞질렀다', 0.8, 1.4, 'bright'), c('joy', 'heart', 'hop', '달려라!', 0.8, 1.4, 'loud'), c('base', 'sweat', 'none', '막판 승부다', 0.75, 1.5, 'calm')],
  },
  boat: {
    wow: [c('joy', 'sparkle', 'hop', '물보라 대역전!', 0.95, 1.8, 'loud'), c('base', 'shock', 'hop', '꼴찌 배가 온다!', 0.85, 1.6, 'calm'), c('joy', 'note', 'bounceLoop', '물가가 들썩', 0.9, 2.0, 'bright')],
    cheer: [c('base', 'note', 'hop', '배가 앞질렀다', 0.8, 1.4, 'bright'), c('joy', 'heart', 'hop', '첨벙첨벙 힘내라', 0.8, 1.4, 'loud'), c('base', 'sweat', 'none', '뱃머리 싸움', 0.75, 1.5, 'calm')],
  },
  ssireum: {
    wow: [c('joy', 'sparkle', 'hop', '뒤집었다!', 0.95, 1.8, 'loud'), c('base', 'shock', 'hop', '우와 되밀었어', 0.85, 1.6, 'calm'), c('joy', 'note', 'bounceLoop', '모래판이 들썩', 0.9, 2.0, 'bright')],
    gasp: [c('agony', 'shock', 'hop', '어머 밀린다', 0.85, 1.6, 'loud'), c('base', 'sweat', 'none', '모래판 끝이야', 0.8, 1.5, 'calm'), c('agony', 'sweat', 'tremble', '아슬아슬해', 0.8, 1.6, 'tear')],
    cheer: [c('base', 'note', 'hop', '오오 밀어붙인다', 0.8, 1.4, 'bright'), c('joy', 'heart', 'hop', '힘내라 홍청', 0.8, 1.4, 'loud'), c('base', 'sparkle', 'none', '팽팽하다', 0.75, 1.4, 'calm')],
  },
  tug: {
    wow: [c('joy', 'sparkle', 'hop', '줄이 거꾸로 간다!', 0.95, 1.8, 'loud'), c('base', 'shock', 'hop', '역전이다 영차', 0.85, 1.6, 'calm'), c('joy', 'note', 'bounceLoop', '와아아', 0.9, 2.0, 'bright')],
    gasp: [c('agony', 'shock', 'hop', '선 앞이다!', 0.85, 1.6, 'loud'), c('base', 'sweat', 'none', '넘어간다?', 0.8, 1.5, 'calm'), c('agony', 'sweat', 'tremble', '조마조마', 0.8, 1.6, 'tear')],
    cheer: [c('base', 'note', 'hop', '영차영차!', 0.8, 1.4, 'bright'), c('joy', 'heart', 'hop', '당겨라 당겨', 0.8, 1.4, 'loud'), c('base', 'sparkle', 'none', '팽팽하네', 0.75, 1.4, 'calm')],
  },
  kite: {
    wow: [c('joy', 'sparkle', 'hop', '마지막 연싸움!', 0.95, 1.8, 'loud'), c('base', 'shock', 'hop', '와 끊었다!', 0.85, 1.6, 'calm'), c('joy', 'note', 'bounceLoop', '하늘이 들썩', 0.9, 2.0, 'bright')],
    gasp: [c('agony', 'shock', 'hop', '연이 엉켰다!', 0.85, 1.6, 'loud'), c('base', 'sweat', 'none', '끊어질라', 0.8, 1.5, 'calm'), c('agony', 'sweat', 'tremble', '하늘에서 연싸움', 0.8, 1.6, 'tear')],
    cheer: [c('base', 'note', 'hop', '연 하나 떨어졌다', 0.8, 1.4, 'bright'), c('joy', 'heart', 'hop', '연이 날아간다', 0.8, 1.4, 'loud'), c('base', 'sparkle', 'none', '바람 좋다', 0.75, 1.4, 'calm')],
  },
  dig: {
    wow: [c('joy', 'sparkle', 'hop', '상자가 나왔다!', 0.95, 1.8, 'loud'), c('base', 'shock', 'hop', '반짝반짝 보물', 0.85, 1.6, 'calm'), c('joy', 'note', 'bounceLoop', '우와 보물상자', 0.9, 2.0, 'bright')],
    gasp: [c('agony', 'shock', 'hop', '저기 있었구나', 0.85, 1.6, 'loud'), c('base', 'sweat', 'none', '할아버지가 찾았다', 0.8, 1.5, 'calm'), c('agony', 'sweat', 'tremble', '아이고 바로 옆', 0.8, 1.6, 'tear')],
    cheer: [c('base', 'note', 'hop', '뭔가 나왔다', 0.8, 1.4, 'bright'), c('joy', 'heart', 'hop', '동전이 짤랑', 0.8, 1.4, 'loud'), c('base', 'sparkle', 'none', '나도 파 볼까', 0.75, 1.4, 'calm')],
    laugh: [c('joy', 'note', 'hop', '헌 장화래', 0.8, 1.4, 'bright'), c('base', 'note', 'squash', '킥킥 장화', 0.8, 1.4, 'loud'), c('joy', 'heart', 'none', '장화도 보물이지', 0.75, 1.4, 'calm')],
  },
};

/** 진행 중 큰 사건에 근처 구경꾼 반응 (참가하지 않은 손님, 작고 짧게). */
export function groupBuzzReaction(rng: Rng, booth: GroupBoothId, kind: GroupBuzz, m: Monster): Reaction {
  const cands = GROUP_BUZZ[booth][kind] ?? BUZZ[kind];
  const cand = choose(rng, cands, m, kind !== 'gasp');
  return build(cand, Math.min(1.2, intensityOf(cand, m.traits, m.mood, true, 1)));
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

/**
 * 단체 놀이마다 진행 중 참가자 응원 (lead = 자기 쪽이 앞서거나 좋은 일, behind = 뒤처지거나 위태로움).
 * on = 그 사건 열쇠에만 나오는 말 (뒤집기 '뒤집어라!', 연줄 끊김 '앗, 끊어졌다!' …), on이 없는 후보는 맞는 말이 없을 때.
 */
const GROUP_CHEER: Record<GroupBoothId, Record<'lead' | 'behind', readonly Cand[]>> = {
  race: RACE_CHEER,
  boat: {
    lead: [c('joy', 'note', 'hop', '저어라 저어!', 0.85, 1.3, 'main', 'loud'), c('joy', 'heart', 'hop', '선두다 첨벙', 0.85, 1.2, 'bright'), c('base', 'sparkle', 'squash', '그대로 가자', 0.8, 1.2, 'calm')],
    behind: [c('agony', 'sweat', 'tremble', '힘내 오리배', 0.85, 1.3, 'main'), c('agony', 'shock', 'shake', '앗, 뒤처진다', 0.9, 1.2, 'loud'), c('base', 'sweat', 'squash', '물보라 조마조마', 0.8, 1.3, 'calm', 'tear')],
  },
  ssireum: {
    lead: [
      ...on(['lead'], [c('joy', 'note', 'hop', '밀어붙여!', 0.85, 1.3, 'main', 'loud'), c('base', 'sparkle', 'squash', '조금만 더', 0.8, 1.2, 'calm')]),
      ...on(['brink:other'], [c('joy', 'note', 'hop', '한 발만 더!', 0.85, 1.3, 'main', 'loud'), c('joy', 'heart', 'squash', '끝까지 밀어!', 0.85, 1.2, 'bright')]),
      ...on(['flip'], [c('joy', 'sparkle', 'hop', '뒤집어라!', 0.9, 1.3, 'main', 'loud'), c('joy', 'heart', 'squash', '되밀어!', 0.85, 1.2, 'bright')]),
      c('joy', 'heart', 'hop', '영차!', 0.85, 1.2, 'bright'),
    ],
    behind: [
      ...on(['lead:other'], [c('agony', 'sweat', 'tremble', '버텨라!', 0.85, 1.3, 'main'), c('agony', 'shock', 'shake', '으으 밀린다', 0.9, 1.2, 'loud')]),
      ...on(['brink'], [c('agony', 'sweat', 'tremble', '모래판 끝이야!', 0.9, 1.3, 'main'), c('agony', 'shock', 'shake', '발 버텨!', 0.9, 1.2, 'loud')]),
      ...on(['flip:other'], [c('agony', 'shock', 'shake', '어어 뒤집힌다?!', 0.9, 1.3, 'main', 'loud'), c('agony', 'sweat', 'tremble', '안 돼!', 0.85, 1.2, 'tear')]),
      c('base', 'sweat', 'squash', '조마조마', 0.8, 1.3, 'calm', 'tear'),
    ],
  },
  kite: {
    lead: [
      ...on(['cut:other'], [c('joy', 'sparkle', 'hop', '끊었다!', 0.9, 1.3, 'main', 'loud'), c('joy', 'heart', 'hop', '내 연 최고', 0.85, 1.2, 'bright')]),
      c('joy', 'note', 'hop', '높이 높이!', 0.85, 1.2, 'bright'),
      c('base', 'sparkle', 'squash', '바람 좋다', 0.8, 1.2, 'calm'),
    ],
    behind: [
      ...on(['tangle', 'tangle:other'], [c('agony', 'sweat', 'tremble', '실 감아!', 0.85, 1.3, 'main'), c('agony', 'shock', 'shake', '안 돼 엉킨다', 0.9, 1.2, 'loud'), c('base', 'sweat', 'squash', '연싸움이다!', 0.8, 1.3, 'calm', 'tear')]),
      ...on(['cut'], [c('agony', 'shock', 'shake', '앗, 끊어졌다!', 0.9, 1.3, 'main', 'loud'), c('agony', 'tear', 'tremble', '내 연이…', 0.85, 1.3, 'tear')]),
      ...on(['brink'], [c('agony', 'sweat', 'tremble', '버텨 내 연아!', 0.9, 1.3, 'main'), c('agony', 'shock', 'shake', '실이 끊어질라', 0.9, 1.2, 'loud')]),
      c('base', 'sweat', 'squash', '연싸움 조마조마', 0.8, 1.3, 'calm', 'tear'),
    ],
  },
  tug: {
    lead: [
      ...on(['lead'], [c('joy', 'note', 'hop', '영차영차', 0.85, 1.3, 'main', 'loud'), c('joy', 'heart', 'hop', '당겨라!', 0.85, 1.2, 'bright')]),
      ...on(['brink:other'], [c('joy', 'sparkle', 'hop', '조금만 더!', 0.9, 1.3, 'main', 'loud'), c('base', 'sparkle', 'squash', '거의 다 왔다', 0.8, 1.2, 'calm')]),
      ...on(['flip'], [c('joy', 'sparkle', 'hop', '지금이야, 영차!', 0.9, 1.3, 'main', 'loud'), c('joy', 'heart', 'squash', '다시 당겨!', 0.85, 1.2, 'bright')]),
      c('base', 'sparkle', 'squash', '우리가 이긴다', 0.8, 1.2, 'calm'),
    ],
    behind: [
      ...on(['lead:other'], [c('agony', 'shock', 'shake', '끌려간다!', 0.9, 1.3, 'main', 'loud'), c('base', 'sweat', 'squash', '발 버텨요', 0.8, 1.3, 'calm')]),
      ...on(['brink'], [c('agony', 'shock', 'tremble', '선 앞이야!', 0.9, 1.3, 'main'), c('agony', 'sweat', 'tremble', '버텨!', 0.85, 1.3, 'loud')]),
      ...on(['flip:other'], [c('agony', 'shock', 'shake', '어어어?', 0.9, 1.3, 'main'), c('agony', 'sweat', 'tremble', '줄이 미끄러워', 0.85, 1.3, 'tear')]),
      c('base', 'sweat', 'squash', '팔이 저려', 0.8, 1.3, 'calm', 'tear'),
    ],
  },
  dig: {
    lead: [c('joy', 'note', 'hop', '뭔가 나왔다!', 0.85, 1.3, 'main', 'loud'), c('joy', 'heart', 'hop', '반짝인다!', 0.85, 1.2, 'bright'), c('base', 'sparkle', 'squash', '내 보물', 0.8, 1.2, 'calm')],
    behind: [
      // 자기 땅에서 나온 것마다 (cheerDetail): 헌 장화, 조약돌, 둘 다.
      ...on(['find:boot'], [c('agony', 'sweat', 'tremble', '장화네…', 0.85, 1.3, 'main'), c('agony', 'shock', 'shake', '웬 장화?', 0.9, 1.2, 'loud')]),
      ...on(['find:pebble'], [c('agony', 'sweat', 'tremble', '돌멩이네…', 0.85, 1.3, 'main'), c('agony', 'shock', 'shake', '에이 돌멩이', 0.9, 1.2, 'loud')]),
      ...on(['find', 'find:boot', 'find:pebble'], [c('base', 'sweat', 'squash', '에이, 꽝이다', 0.8, 1.3, 'calm', 'tear')]),
      ...on(['find:other', 'reveal:other'], [c('agony', 'shock', 'shake', '옆을 팔걸', 0.9, 1.3, 'main', 'loud'), c('agony', 'shock', 'tremble', '저기였어?!', 0.9, 1.2, 'calm'), c('agony', 'tear', 'tremble', '바로 옆에서…', 0.85, 1.3, 'tear')]),
    ],
  },
};

/**
 * 응원 사건 열쇠: 사건 종류, 그 사건의 주인공(actor)이 손님이 고른 것이 아니면 뒤에 ':other' (상대 편이 앞섬, 남이 상자를 찾음 …).
 * 자기 일이고 detail(GroupGame.cheerDetail)이 있으면 뒤에 ':detail' (보물찾기 'find:boot').
 */
export function cheerKey(type: string, actor: number, pick: number, detail: string | null = null): string {
  if (actor !== pick) return `${type}:other`;
  return detail === null ? type : `${type}:${detail}`;
}

/** 이 응원 열쇠에 맞는 후보: 열쇠가 꼭 맞는 후보, 없으면 사건 종류만 맞는 후보, 그것도 없으면 on이 없는 후보 (그것도 없으면 모두). */
function cheerCands(cands: readonly Cand[], key: string | null): readonly Cand[] {
  if (key !== null) {
    const exact = cands.filter((x) => x.on?.includes(key) === true);
    if (exact.length > 0) return exact;
    const type = key.split(':')[0] ?? key;
    const loose = cands.filter((x) => x.on?.includes(type) === true);
    if (loose.length > 0) return loose;
  }
  const plain = cands.filter((x) => x.on === undefined);
  return plain.length > 0 ? plain : cands;
}

/** 단체 놀이 진행 중 참가자 응원 반응 (짧고 작게). key = 응원 사건 열쇠 (cheerKey, 없으면 사건 말이 없는 후보). */
export function groupCheerReaction(rng: Rng, booth: GroupBoothId, kind: 'lead' | 'behind', m: Monster, boost = 1, key: string | null = null): Reaction {
  const positive = kind === 'lead';
  const cand = choose(rng, cheerCands(GROUP_CHEER[booth][kind], key), m, positive);
  return build(cand, Math.min(1.3, intensityOf(cand, m.traits, m.mood, positive, boost)));
}

export function raceCheerReaction(rng: Rng, kind: 'lead' | 'behind', m: Monster, boost = 1): Reaction {
  return groupCheerReaction(rng, 'race', kind, m, boost);
}

/** 이 단체 놀이의 응원·구경(결과 뒤)·들썩임(진행 중) 반응 이름 (시험용). key를 주면 그 응원 열쇠에 나오는 응원만. */
export function groupReactionLabels(booth: GroupBoothId, key?: { kind: 'lead' | 'behind'; key: string }): { cheer: string[]; spectate: string[]; buzz: string[] } {
  const cheer = key === undefined ? [...GROUP_CHEER[booth].lead, ...GROUP_CHEER[booth].behind] : cheerCands(GROUP_CHEER[booth][key.kind], key.key);
  return {
    cheer: cheer.map((x) => x.label),
    spectate: (Object.values(GROUP_SPECTATE[booth]) as (readonly Cand[])[]).flat().map((x) => x.label),
    buzz: (Object.keys(BUZZ) as GroupBuzz[]).flatMap((k) => (GROUP_BUZZ[booth][k] ?? BUZZ[k]).map((x) => x.label)),
  };
}

// ── 넷째 묶음 (DESIGN 3.7): 전당포·은행 볼일, 파산, 빚 다 갚음 ──

/**
 * 넷째 묶음 반응 종류. 볼일: seekPawn·seekLoan = 돈이 떨어져 전당포·은행으로 걸어가기 시작할 때 (걸으며 작게), goRedeem·goRepay = 따서 되찾으러·갚으러 갈 때,
 * pawn·redeem·loan·repay = 계산대에서, refused = 금고가 비어 못 빌림. 파산: bankrupt, 일터: laborFarm·laborMine = 재료가 나올 때 한숨·영차, waitWork = 자리를 기다리며,
 * cheered = 반장이 다독임. 빚 걸기 판: matchCalled = 불려 갈 때, matchHalved·matchCleared·matchAdded = 정산 (이겨서 반·대박으로 0·져서 늘어남).
 * 풀려남: relieved = 다 갚음, forgiven = 오래 일해 반장이 남은 빚을 덜어 줌.
 */
export type DebtReactKind =
  | 'seekPawn'
  | 'seekLoan'
  | 'goRedeem'
  | 'goRepay'
  | 'pawn'
  | 'redeem'
  | 'loan'
  | 'repay'
  | 'refused'
  | 'bankrupt'
  | 'laborFarm'
  | 'laborMine'
  | 'waitWork'
  | 'cheered'
  | 'matchCalled'
  | 'matchHalved'
  | 'matchCleared'
  | 'matchAdded'
  | 'relieved'
  | 'forgiven';

/** 기쁜 쪽 반응 (성격 무게·세기를 기쁨으로 본다). */
const DEBT_POSITIVE: ReadonlySet<DebtReactKind> = new Set(['goRedeem', 'goRepay', 'redeem', 'repay', 'matchHalved', 'matchCleared', 'relieved', 'forgiven', 'cheered']);

const DEBT_REACT: Record<DebtReactKind, readonly Cand[]> = {
  // 걸으며 작게 (연출 없이 이모트만).
  seekPawn: [
    c('base', 'sweat', 'none', '맡겨야겠다…', 0.8, 1.6, 'main', 'calm'),
    c('agony', 'tear', 'none', '눈물을 머금고', 0.85, 1.8, 'tear', 'gloom'),
    c('base', 'note', 'none', '이걸 맡기면 한판 더!', 0.85, 1.6, 'bright', 'loud'),
  ],
  seekLoan: [
    c('base', 'sweat', 'none', '빌려야겠다…', 0.8, 1.6, 'main', 'calm'),
    c('agony', 'sweat', 'none', '조금만 빌리자', 0.85, 1.6, 'gloom'),
    c('base', 'note', 'none', '은행에 가 볼까', 0.8, 1.6, 'bright', 'loud'),
  ],
  goRedeem: [
    c('joy', 'sparkle', 'none', '되찾으러 가자!', 0.85, 1.6, 'main', 'bright'),
    c('base', 'heart', 'none', '기다려, 내 장신구!', 0.85, 1.6, 'loud'),
  ],
  goRepay: [
    c('base', 'note', 'none', '빚 갚으러 가자', 0.8, 1.6, 'main', 'calm'),
    c('joy', 'sparkle', 'none', '얼른 갚아야지!', 0.85, 1.6, 'bright', 'loud'),
  ],
  pawn: [
    c('base', 'sweat', 'hop', '맡기고 한숨', 0.8, 1.6, 'main'),
    c('agony', 'sweat', 'tremble', '아끼던 건데…', 0.9, 1.8, 'tear', 'gloom'),
    c('base', 'note', 'hop', '이걸로 한판 더!', 0.9, 1.4, 'bright', 'loud'),
  ],
  redeem: [
    c('joy', 'heart', 'bigHop', '되찾았다!', 1.2, 2.6, 'main', 'loud'),
    c('joy', 'sparkle', 'spin', '다시 내 거!', 1.1, 2.4, 'bright'),
    c('joy', 'tear', 'tremble', '안도의 눈물', 1.0, 2.4, 'tear'),
  ],
  loan: [
    c('base', 'sweat', 'hop', '빌렸다…', 0.85, 1.6, 'main'),
    c('base', 'note', 'squash', '꼭 갚을게요', 0.9, 1.6, 'bright'),
    c('agony', 'sweat', 'tremble', '두근두근', 0.9, 1.8, 'calm', 'gloom'),
  ],
  repay: [
    c('joy', 'note', 'hop', '빚 끝!', 1.0, 2.0, 'main'),
    c('joy', 'heart', 'squash', '홀가분', 1.0, 2.0, 'bright'),
    c('joy', 'sparkle', 'hop', '깔끔하게 갚았다', 1.0, 2.0, 'calm'),
  ],
  refused: [
    c('sad', 'sweat', 'slump', '금고가 텅', 1.0, 2.0, 'main'),
    c('sad', 'tear', 'none', '빌릴 데가 없어…', 1.0, 2.0, 'tear'),
  ],
  bankrupt: [
    c('sad', 'storm', 'slump', '파산…', 1.6, 3.6, 'main', 'gloom'),
    c('sad', 'tear', 'tremble', '엉엉 빚더미', 1.6, 3.8, 'tear', 'loud'),
    c('sad', 'storm', 'none', '하늘이 무너졌다', 1.5, 3.6, 'calm'),
  ],
  // 일하다가 (재료가 나올 때): 작게. 어둡지만 하찮게.
  laborFarm: [
    c('sad', 'sweat', 'none', '흙투성이 한숨', 0.7, 1.6, 'main', 'gloom'),
    c('base', 'sweat', 'squash', '영차영차', 0.7, 1.4, 'loud'),
    c('base', 'sparkle', 'hop', '채소 하나!', 0.7, 1.4, 'bright'),
    c('agony', 'sweat', 'tremble', '허리가 아파…', 0.75, 1.6, 'tear', 'calm'),
  ],
  laborMine: [
    c('base', 'sparkle', 'hop', '광석이다!', 0.7, 1.4, 'bright', 'main'),
    c('sad', 'storm', 'none', '콜록, 먼지…', 0.7, 1.6, 'gloom'),
    c('base', 'sweat', 'squash', '곡괭이질 영차', 0.7, 1.4, 'loud'),
    c('agony', 'sweat', 'tremble', '허리가 아파…', 0.75, 1.6, 'tear', 'calm'),
  ],
  waitWork: [
    c('sad', 'sweat', 'none', '언제 내 차례…', 0.7, 1.8, 'main', 'calm'),
    c('sad', 'storm', 'none', '쪼그려 한숨', 0.7, 1.8, 'gloom'),
    c('sad', 'tear', 'none', '빚 생각에 멍', 0.7, 1.8, 'tear'),
  ],
  cheered: [
    c('base', 'heart', 'hop', '반장님 응원에 힘!', 0.75, 1.4, 'main', 'bright'),
    c('base', 'sweat', 'squash', '조금만 더 힘내자', 0.75, 1.4, 'calm'),
  ],
  matchCalled: [
    c('agony', 'shock', 'tremble', '빚을 걸고 한판!', 0.9, 1.8, 'main', 'loud'),
    c('base', 'sweat', 'none', '이기면 반이다…', 0.85, 1.8, 'calm'),
    c('agony', 'sweat', 'shake', '두근두근 빚 한판', 0.9, 1.8, 'gloom'),
  ],
  matchHalved: [
    c('joy', 'sparkle', 'bigHop', '빚이 반으로!', 1.2, 3.0, 'main', 'loud'),
    c('joy', 'heart', 'hop', '살 것 같다!', 1.1, 2.8, 'bright'),
    c('joy', 'tear', 'tremble', '조금 가벼워졌어', 1.0, 2.8, 'tear', 'calm'),
  ],
  matchCleared: [
    c('joy', 'sparkle', 'spin', '빚이 사라졌다!', 1.4, 3.2, 'main', 'loud'),
    c('joy', 'heart', 'bigHop', '대역전 해방!', 1.3, 3.2, 'bright'),
  ],
  matchAdded: [
    c('sad', 'storm', 'slump', '빚이 늘었다…', 1.3, 3.2, 'main', 'gloom'),
    c('sad', 'tear', 'tremble', '더 일해야 해…', 1.3, 3.2, 'tear'),
    c('agony', 'storm', 'shake', '빚 눈덩이', 1.3, 3.0, 'loud', 'angry'),
  ],
  relieved: [
    c('joy', 'sparkle', 'bigHop', '빚 다 갚았다!', 1.4, 3.4, 'main', 'loud'),
    c('joy', 'heart', 'spin', '자유다!', 1.3, 3.2, 'bright'),
    c('joy', 'note', 'bounceLoop', '홀가분해!', 1.3, 3.2, 'calm'),
    c('joy', 'tear', 'tremble', '홀가분한 눈물', 1.2, 3.4, 'tear'),
  ],
  forgiven: [
    c('joy', 'heart', 'bigHop', '반장님 고마워요', 1.3, 3.4, 'main', 'tear'),
    c('joy', 'note', 'bounceLoop', '덕분에 홀가분', 1.2, 3.2, 'bright'),
  ],
};

/** 넷째 묶음 반응 (sim이 monsterReact로 낸다). */
export function debtReaction(rng: Rng, kind: DebtReactKind, m: Monster): Reaction {
  const positive = DEBT_POSITIVE.has(kind);
  const cand = choose(rng, DEBT_REACT[kind], m, positive);
  return build(cand, intensityOf(cand, m.traits, m.mood, positive, 1));
}

/** 넷째 묶음 반응 이름 (도감·시험용). */
export function debtReactionLabels(kind: DebtReactKind): string[] {
  return DEBT_REACT[kind].map((x) => x.label);
}

/** 넷째 묶음 반응 종류 모두 (시험용). */
export const DEBT_REACT_KINDS = Object.keys(DEBT_REACT) as DebtReactKind[];

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
