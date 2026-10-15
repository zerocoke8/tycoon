// 클립 프리셋과 Seedance 프롬프트 틀. seedance.ts(영상 만들기)와 extract.ts(시트 만들기), make.ts가 같이 쓴다.
//
// 프롬프트는 영어로 쓴다 (Seedance는 영어 프롬프트를 1000단어까지 받는다. 중국어는 500자 권장).
// 공통 틀(STYLE_RULES)이 그림 결을 지키고, 클립마다 action만 바꾼다. 종마다 몸 쓰는 법(SPECIES_NOTES)을 덧붙인다.

export interface ClipPreset {
  /** 클립 이름 (시트의 animations 키, 파일 이름). */
  readonly name: string;
  /** 한 줄 설명 (README, 목록). */
  readonly ko: string;
  /** 첫 프레임으로 쓸 정지 그림 포즈 (<species>_<pose>.png). 없으면 base로. */
  readonly pose: 'base' | 'joy' | 'agony' | 'sad';
  /** 되풀이 클립: 끝 프레임 = 첫 프레임 그림 (Seedance 첫·끝 프레임 모드), 시트도 이음매를 맞춰 자른다. */
  readonly loop: boolean;
  /** 영상 길이 (초). Seedance 2.5는 4~30초 (공식 문서). */
  readonly duration: number;
  /** 시트 프레임 속도 (초당). */
  readonly fps: number;
  /** 동작 설명 (영어, 프롬프트에 들어간다). */
  readonly action: string;
}

export const CLIPS: Readonly<Record<string, ClipPreset>> = {
  idle: {
    name: 'idle',
    ko: '대기 (되풀이): 숨쉬기, 눈 깜빡, 살짝 흔들',
    pose: 'base',
    loop: true,
    duration: 4,
    fps: 12,
    action:
      'A calm idle loop. The character breathes gently (the body rises and falls very slightly), blinks once slowly, and sways a tiny bit. It stays exactly in place, looking slightly to the left with a relaxed, expectant face.',
  },
  walk: {
    name: 'walk',
    ko: '걷기 (제자리, 되풀이): 러닝머신처럼 제자리에서',
    pose: 'base',
    loop: true,
    duration: 4,
    fps: 12,
    action:
      'A cheerful, bouncy walk cycle IN PLACE, like walking on a treadmill, facing left. The legs step one after another and the body bobs up and down a little, but the character does NOT move across the frame: its position and size stay the same. Two full steps per second.',
  },
  joy: {
    name: 'joy',
    ko: '기쁨: 만세하며 통통 점프',
    pose: 'joy',
    loop: true,
    duration: 4,
    fps: 12,
    action:
      'Overjoyed cheering: the character throws both arms up (hurray!), does two small happy hops straight up and lands on exactly the same spot each time, with a big open-mouthed smile and sparkling eyes. Then it settles back into the starting pose.',
  },
  agony: {
    name: 'agony',
    ko: '괴로움: 머리 감싸 쥐고 아까워함 (아깝게 놓침)',
    pose: 'agony',
    loop: true,
    duration: 4,
    fps: 12,
    action:
      'Agonizing over a very near miss: the character clutches its head with both hands, squeezes its eyes shut and shakes its head left and right in cute frustration, knees slightly bent, feet staying on the ground. Then it returns to the starting pose.',
  },
  sad: {
    name: 'sad',
    ko: '슬픔: 축 처지고 눈물 한 방울',
    pose: 'sad',
    loop: true,
    duration: 4,
    fps: 12,
    action:
      'Quietly sad: the character droops its shoulders and head, sniffles, and a single small tear rolls down its cheek. Very small, slow movements; the feet stay planted. Then it returns to the starting pose.',
  },
  cry_lie: {
    name: 'cry_lie',
    ko: '드러누워 엉엉: 바닥에 벌러덩 누워 떼쓰며 울기 (한 번)',
    pose: 'sad',
    loop: false,
    duration: 6,
    fps: 12,
    action:
      'The character bursts into tears and flops down onto its back on the (invisible) ground at the same spot, then lies there wailing loudly like a small child having a tantrum: mouth wide open, big comic streams of tears, arms and legs kicking in the air. It keeps lying and crying until the end of the video; it does not get up. The ground line stays where the feet were at the start.',
  },
  clap: {
    name: 'clap',
    ko: '구경하며 박수 (되풀이)',
    pose: 'base',
    loop: true,
    duration: 4,
    fps: 12,
    action:
      'A happy spectator watching something exciting to the left: the character claps its hands (or paws, claws or wings) together quickly and bounces lightly on the spot with an excited smile. Feet stay on the same spot.',
  },
};

/** 종마다 몸 쓰는 법 (다리가 없거나 떠 있는 종). 프롬프트 끝에 붙는다. */
export const SPECIES_NOTES: Readonly<Record<string, string>> = {
  dragon: 'It is a small round baby dragon with tiny wings and a flame-tipped tail; the tail flame flickers gently. It walks on its two short legs.',
  crab: 'It is a round little crab; it moves its claws expressively and its little legs scuttle in place. It has no hands, so it uses its claws.',
  goblin: 'It is a little goblin wearing a cooking pot as a helmet; the pot stays on its head.',
  bat: 'It is a chubby little bat that floats in the air by flapping its wings; there is no ground contact, it hovers at the same height (for "walk" it flaps and bobs in place).',
  ghost: 'It is a little ghost that floats; it has no legs, the bottom of its body waves softly and it bobs gently at the same height.',
  dokkaebi: 'It is a little Korean dokkaebi (goblin) with a small horn and a club; it walks on two legs.',
  mimic: 'It is a little treasure-chest mimic; the lid opens and closes like a mouth and it hops on its tiny legs.',
};

/** 그림 결을 지키는 공통 규칙 (docs/DESIGN.md 7.1, 7.2). */
export const STYLE_RULES = [
  'Animate this exact 2D character illustration.',
  'Camera: locked-off static camera. No zoom, no pan, no tilt, no camera shake, no cuts, no transitions.',
  'Background: a flat, solid, uniform magenta (#FF00FF) from edge to edge for the whole video. Keep it perfectly flat: no shadows, no floor, no lighting changes, no gradients, no vignette, no reflections, no particles, no text.',
  'Style: keep the exact same flat cartoon art style as the input image: thick dark-brown outlines, flat colors, no shading or highlights added, same proportions, same colors, same line thickness. No motion blur.',
  'The character stays in the same place and at the same size in the frame, always fully visible, facing left as in the image. Its feet stay planted on the same spot (except during jumps, which land back on the same spot).',
  'Do not add any new objects, props, effects or other characters.',
].join(' ');

export function buildPrompt(clip: ClipPreset, species?: string, extra?: string): string {
  const parts = [STYLE_RULES, `Action: ${clip.action}`];
  const note = species === undefined ? undefined : SPECIES_NOTES[species];
  if (note !== undefined) parts.push(note);
  if (clip.loop) parts.push('The animation must loop seamlessly: the last frame returns exactly to the first pose.');
  if (extra !== undefined && extra.trim() !== '') parts.push(extra.trim());
  return parts.join('\n');
}

export function clipPreset(name: string): ClipPreset | undefined {
  return CLIPS[name];
}
