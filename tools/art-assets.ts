// 이 프로젝트(몬스터 놀이마을)의 그림 목록. art-kit의 도구(gen.ts, process.ts)가 읽는다. 2026-10-15 init.ts가 만들고 고쳐 썼다.
// 키트 폴더 밖에 둔다: 키트를 새 판으로 통째로 바꿔도 이 파일과 원본 폴더는 남는다.
// 도구가 이 파일을 찾는 순서: --assets <파일> → 환경 변수 ART_ASSETS_FILE → 키트 폴더 옆의 art-assets.ts.
//
// 쓰는 법 (키트 폴더 tools/art-kit 에서):
//   node tools/gen.ts <그룹/key> [--dry]          원본 PNG → ../art-raw/<그룹>/<key>.png
//   node tools/inspect.ts ../art-raw/<그룹>/<key>.png
//   node tools/process.ts --only <그룹/key>       WebP와 meta.json → ../../public/assets/art
// 기준 그림 후보를 여러 판 뽑을 때는 --raw ../art-try/<이름> 으로 따로 뽑아 고른 것만 art-raw로 옮긴다.
//
// 키트 공통 문단에는 원래 게임(전투 RPG)의 문구가 들어 있다 ("looks at the heroes", "Holding their weapon" …).
// 이 게임은 그 문단 대신 아래의 프로젝트 문단(GUEST_*, VILLAGER_*, CLOSEUP_*)을 쓴다.
// STYLE 머리말, '드워프는 화풍 참조일 뿐' 문장, 건물·소품·아이템·아이콘 문단은 키트 것을 그대로 쓴다 (전투 문구가 없다).
//
// 애니메이션 규칙 (docs/DESIGN.md 7.1): 손님 몬스터는 모두 1024×1024 캔버스에 몸 높이 약 절반, 가운데,
// 발(떠 있으면 가장 낮은 곳)은 아래에서 15% 위 선. 감정 포즈도 같은 자리·같은 크기. 모두 왼쪽 3/4.

import {
  type ArtAsset,
  type ArtSize,
  type Entry,
  type ProjectDirs,
  ALPHA_MARGIN,
  building,
  icon,
  inGroup,
  itemIcon,
  MON_REF_NOTE,
  mapSameSet,
  para,
  prop,
  STYLE,
  STYLE_REF_ONLY,
  VIEW_FRONT,
  VIEW_MAP,
} from './art-kit/tools/manifest.ts';

/** 폴더 (이 파일이 있는 폴더 기준). 명령줄 --raw/--out과 환경 변수 ART_RAW_DIR/ART_OUT_DIR이 이보다 먼저다. */
export const PROJECT_DIRS: ProjectDirs = {
  // Codex 원본 PNG. 지우지 말고 백업한다 (같은 프롬프트로도 같은 그림은 다시 나오지 않는다).
  raw: './art-raw',
  // 다듬은 WebP와 meta.json. 게임이 바로 읽는다 (Vite public).
  out: '../public/assets/art',
};

/** 키트에 없는 그룹: 확대 화면 배경(불투명), 효과·이모트. */
export const PROJECT_GROUPS = {
  closeup: 'style',
  fx: 'style+refOnly',
  racers: 'style',
} as const;

/** 이 게임의 참조 그림 (키트 ref/ 밖). */
export const PROJECT_REFS = {
  town_view: {
    file: './art-ref/town_view_ref.png',
    note: '사용자가 준 마을 지도 예 (원래 게임의 합성 지도). 바닥 지도의 시점·색·길 선의 참조. 건물은 따라 그리지 않는다.',
  },
  villager_scale: {
    file: './art-ref/villager_scale_ref.png',
    note: '이 PC에서 hero_vail을 다시 뽑은 시험 셋 가운데 사용자가 "귀엽다"고 고른 판 (작고 동글한 2.3등신). 주민의 비례·틀 안 크기 기준.',
  },
};

// ── 프로젝트 공통 문단 ───────────────────────────────────────────────────

/** 이 게임이 무엇인지 (키트 문단의 'idle RPG' 자리). */
const GAME =
  'a cozy, healing village tycoon game (cute monsters visit a little fantasy village to play silly little games at play booths run by villagers)';

/** 손님 몬스터 공통 문단 (키트 MON_COMMON에서 전투 문구와 'ONE clear expression', 'nothing cropped' 틀을 뺐다: 틀은 GUEST_FRAME). */
const GUEST_COMMON =
  `Draw ONE monster guest for ${GAME}, full body, as one character. It faces LEFT: body and face turned three-quarters toward the LEFT edge of the image. ` +
  'Cute, silly and harmless, NOT scary: no sharp teeth, no sharp claws, no spikes, no blood, no angry or glowing eyes; round chunky shapes; a very simple face with two dot eyes (or simple line eyes) and a tiny mouth, the personality shown by the silhouette and the expression described below. ' +
  'Keep details minimal like the dwarf: a few flat color blocks, at most a few inner lines, no patterns, no texture, no ornaments beyond what is described. ' +
  'Transparent background with a real alpha channel: no backdrop, no ground, no floor shadow.';

/** 손님 몬스터의 캔버스 자리 (애니메이션을 위해 모든 손님·모든 포즈가 같다). */
const GUEST_FRAME =
  'Canvas layout (every guest monster in this game uses exactly this layout, so they can be animated later): draw the monster SMALL in the middle of the square canvas. ' +
  'Its whole body is only about HALF of the canvas height tall (a wide monster at most about 60% of the canvas width), it is centered left to right, ' +
  'and its feet (or the lowest point of its body, if it floats) rest on an invisible line about 15% of the canvas height above the bottom edge. ' +
  'Leave wide empty margins all around it; nothing touches or crosses the edges of the canvas.';

/** 기본 포즈의 표정 (다른 포즈의 출발점). */
const GUEST_BASE_FACE =
  'Pose and expression: standing still in a relaxed neutral pose, calm, curious and a little hopeful (it has just arrived at the village and looks around). ' +
  'No effects around it: no sparkles, no sweat drops, no tears, no symbols, no motion lines.';

/** 다른 종의 기본 그림: 두 번째 참조(먼저 그린 손님)는 화풍·선·틀 안 크기와 자리만. */
const GUEST_STYLE_REF =
  'The second attached image is another guest monster from the same game, drawn in the final style and canvas layout. ' +
  'Use it ONLY as a reference for the drawing style, the thick dark brown outline weight (EXACTLY the same thickness: not thinner, not thicker), the flat coloring, the small amount of detail, ' +
  'and EXACTLY how big the monster sits in the canvas and where (the same canvas layout: about half the canvas height, centered, feet on the same invisible line about 15% above the bottom edge). ' +
  'Do NOT copy its species, body, colors, horns, wings, tail or items: draw the new monster described below, in the colors described below.';

/** 감정 포즈: 두 번째 참조(그 종의 기본 그림)와 같은 몸·같은 자리, 포즈와 표정만. */
const GUEST_SAME =
  'The second attached image is THIS SAME monster in its base pose. Draw the SAME creature: the same design, body shape and proportions, the same colors, the same face style, ' +
  'the same outline weight and the same items, and EXACTLY the same size in the canvas and the same position (centered, its feet on the same invisible line about 15% above the bottom edge, just like the second image). ' +
  'Change ONLY its pose and facial expression as described below. It still faces LEFT in a three-quarter view.';

/** 감정 포즈 셋 (모든 종이 같은 문장). 점프·떨기는 게임 코드가 한다. */
const POSES = {
  joy:
    'New pose and expression: JOY, it just won a round. Both arms (or claws, or wings) thrown straight up high in a big cheer, eyes squeezed shut into happy upside-down "U" arcs, ' +
    'mouth wide open in a huge happy grin (the inside of the mouth dark brown, at most a small pink tongue). Its feet stay on the invisible line (it does not jump; the game makes it hop). ' +
    'No effects around it: no sparkles, no hearts, no motion lines.',
  agony:
    'New pose and expression: AGONY, it JUST missed a big win by a hair. Both hands (or claws, or wings) clutching the sides of its head, eyes wide open as two small round shocked circles with tiny dot pupils (still small and simple, NOT big googly eyes), ' +
    'mouth a wide wobbly zigzag line of despair, body leaning back a little in shock. Its feet stay on the invisible line. No effects around it: no sweat drops, no symbols, no motion lines.',
  sad:
    'New pose and expression: SAD, it lost its money. Shoulders slumped and body drooping forward, arms (or claws, or wings) hanging limp, head hanging low, eyes as two small downward arcs, ' +
    'ONE big tear drop (pale blue #cfe8f7 with the dark outline) on its cheek, a small wobbly frown. Its feet stay on the invisible line. No other effects around it.',
} as const;
type PoseKey = keyof typeof POSES;

/** 주민의 참조 안내: 1) 드워프는 화풍만 2) hero_vail은 비례·선·틀 안 크기만 (키트 CHAR_REF에서 'hero'를 뺐다). */
const VILLAGER_REF =
  'The first attached image is our dwarf blacksmith and is a STYLE REFERENCE ONLY: copy its drawing style exactly (same thick dark brown outline weight, same flat fills, same tiny amount of detail, same two dot eyes, same simple stick-like arms and legs and little boots), but do NOT draw the dwarf. ' +
  'The second attached image is another character from the same art set: match its proportions (about 2.3 to 2.5 heads tall, a big round head), its outline thickness, its flat fills, its small amount of detail and how large the character sits in the frame exactly, ' +
  'but do NOT draw that character (no red tunic, no ledger, no sword, no weapon). Draw only the new character described below.';

/** 주민 공통 문단 (키트 CHAR_COMMON에서 'Holding their weapon'을 평화로운 주민 문장으로 바꿨다). */
const VILLAGER_COMMON =
  "Full body from head to boots, standing, body turned slightly to the left in a front 3/4 view (body and face turned slightly toward the LEFT edge of the image, looking toward the viewer's left). " +
  'Chibi proportions about 2.3-2.5 heads tall (a big round head that is about 40% of the total height, small body). Very simple face: two dot eyes (or very simple line eyes) and a tiny mouth, the personality shown by the silhouette and ONE clear expression. ' +
  'Hair is one or two big simple blob shapes with at most two inner lines, arms and legs are simple tubes, hands are simple mitten shapes, plain clothes made of a few flat color blocks, no patterns, no stitching, no ornaments beyond what is described. ' +
  'No weapons: a peaceful villager, holding only the item described (if any). The outline is EXACTLY as thick as on the second image: not thinner, not thicker (every villager in the game has the same outline weight). Flat colors. ' +
  'The whole character fits inside the frame with wide empty margin on all sides (the character fills only the middle of the image, like the second reference), nothing cropped. ' +
  'Transparent background with a real alpha channel: no backdrop, no ground, no floor shadow. No text.';

/** 확대 화면의 기계·소품: 정면 눈높이, 투명. */
const CLOSEUP_OBJECT =
  `A single object for the close-up view of a play booth in ${GAME}, seen straight from the FRONT at eye level (a flat front view; at most a tiny bit of the top surface is visible). ` +
  'Thick dark brown outlines like the dwarf, one flat color per part, NO shading, NO gradient, NO glossy shine, very few details. ' +
  'Centered with a comfortable empty margin on every side, nothing cut off. Transparent background with a real alpha channel: no backdrop, no floor, no floor shadow. No text, no letters, no numbers.';

/** 확대 화면 소품 세트의 두 번째 참조 (먼저 그린 슬롯 기계). */
const CLOSEUP_SAME_SET =
  'The second attached image is another object from the same close-up set (a slot machine). Match its outline weight, its flat fills and muted palette, its straight front view and its small amount of detail, so they look like one set. Do NOT redraw the slot machine; draw only the new object described below.';

/** 작은 소품(컵, 구슬, 다트, 조약돌): 화면에 작게 놓이니 아이템 아이콘처럼 굵게. */
const SMALL_OBJECT =
  'It is shown small in the game, so draw it fairly SMALL in the canvas (filling only about half of it) with the same VERY fat, bold dark brown marker outline as the dwarf and a simple chunky silhouette.';

/** 확대 화면 배경 (불투명, 가운데는 비워 둔다). */
const CLOSEUP_BG =
  `The BACKGROUND of the close-up view of a play booth in ${GAME}, seen straight from the front at eye level, like a simple stage set. ` +
  'Everything flat-colored with thick dark brown outlines, NO shading, NO gradients, NO texture, very few details. ' +
  'The middle of the image must stay EMPTY: no characters, no monsters, no machine, no table, no objects in the middle (they are added separately on top later). ' +
  'Opaque image: it fills the whole square canvas edge to edge (not transparent, no white margin, no border). No text, no letters, no numbers.';

// ── 만들기 도우미 ───────────────────────────────────────────────────────

const opt = <K extends string, V>(k: K, v: V | undefined): Partial<Record<K, V>> => (v === undefined ? {} : { [k]: v }) as Partial<Record<K, V>>;

interface More {
  /** 다시 뽑을 때 끝에 더하는 'IMPORTANT ...' 문단 (앞 문단은 바꾸지 않는다). */
  readonly extra?: string;
  readonly note?: string;
}

/** 손님 몬스터 기본 그림. lead = 화풍·자리 기준 손님 ('@monsters/<key>', 첫 손님이면 null: 드워프만). */
function guest(key: string, label: string, lead: string | null, look: string, more: More = {}): Entry {
  return {
    key: `${key}_base`,
    size: '1024x1024',
    transparent: true,
    max: 512,
    label: `${label} (기본)`,
    refs: lead === null ? ['d_dwarf_idle'] : ['d_dwarf_idle', lead],
    ownStyle: true,
    ...opt('note', more.note),
    prompt: para(STYLE, MON_REF_NOTE, GUEST_COMMON, GUEST_FRAME, ...(lead === null ? [] : [GUEST_STYLE_REF]), look, GUEST_BASE_FACE, ...(more.extra === undefined ? [] : [more.extra])),
  };
}

/** 손님 몬스터의 감정 포즈 (그 종의 기본 그림을 두 번째 참조로). look = 기본 그림과 같은 생김새 문장. */
function guestPose(key: string, label: string, pose: PoseKey, look: string, more: More = {}): Entry {
  return {
    key: `${key}_${pose}`,
    size: '1024x1024',
    transparent: true,
    max: 512,
    label: `${label} (${pose})`,
    refs: ['d_dwarf_idle', `@monsters/${key}_base`],
    ownStyle: true,
    ...opt('note', more.note),
    prompt: para(STYLE, MON_REF_NOTE, GUEST_COMMON, GUEST_FRAME, GUEST_SAME, `The monster (same as the second image): ${look}`, POSES[pose], ...(more.extra === undefined ? [] : [more.extra])),
  };
}

/** 한 종의 네 장 (기본 + 기쁨·괴로움·슬픔). */
function species(key: string, label: string, lead: string | null, look: string, more: { base?: More; joy?: More; agony?: More; sad?: More } = {}): Entry[] {
  return [
    guest(key, label, lead, look, more.base),
    guestPose(key, label, 'joy', look, more.joy),
    guestPose(key, label, 'agony', look, more.agony),
    guestPose(key, label, 'sad', look, more.sad),
  ];
}

/** 주민 (드워프 + hero_vail 비례 기준). */
function villager(key: string, label: string, look: string, more: More = {}): Entry {
  return {
    key,
    size: '1024x1536',
    transparent: true,
    max: 512,
    label,
    refs: ['d_dwarf_idle', 'villager_scale'],
    ownStyle: true,
    ...opt('note', more.note),
    prompt: para(STYLE, VILLAGER_REF, `A villager of ${GAME}: ${look}`, VILLAGER_COMMON, ...(more.extra === undefined ? [] : [more.extra])),
  };
}

/** 확대 화면 기계·소품. lead = null이면 세트의 첫 그림(슬롯 기계). small = 화면에 작게 놓이는 것. */
function closeupObject(key: string, label: string, body: string, opts: More & { lead?: boolean; small?: boolean; max?: number; size?: ArtSize } = {}): Entry {
  const lead = opts.lead ?? true;
  return {
    key,
    size: opts.size ?? '1024x1024',
    transparent: true,
    max: opts.max ?? 640,
    label,
    refs: lead ? ['d_dwarf_idle', '@objects/slot_machine'] : ['d_dwarf_idle'],
    ownStyle: true,
    ...opt('note', opts.note),
    prompt: para(STYLE, STYLE_REF_ONLY, ...(lead ? [CLOSEUP_SAME_SET] : []), CLOSEUP_OBJECT, ...(opts.small === true ? [SMALL_OBJECT] : []), body, ...(opts.extra === undefined ? [] : [opts.extra])),
  };
}

/** 확대 화면 배경 (불투명 정사각). */
function closeupBg(key: string, label: string, body: string, more: More = {}): Entry {
  return {
    key,
    size: '1024x1024',
    transparent: false,
    max: 1024,
    label,
    refs: ['d_dwarf_idle'],
    ownStyle: true,
    ...opt('note', more.note),
    process: { edge: 2 },
    prompt: para(STYLE, STYLE_REF_ONLY, CLOSEUP_BG, body, ...(more.extra === undefined ? [] : [more.extra])),
  };
}

/** 이모트·효과 아이콘 (첫 이모트는 element_water를, 나머지는 첫 이모트를 두 번째 참조로). */
const fx = (key: string, label: string, lead: string, body: string, max = 128): Entry => icon(key, label, lead, body, { max });

// ── 손님 몬스터 (v1 7종 × 4포즈) ─────────────────────────────────────────
// 색 변형(속성)은 쓰지 않는다. 생김새는 키트 PROMPTS.md 7장의 원래 문장에서 전투·속성 표식을 뺐다.

const DRAGON =
  'A small chubby round baby dragon guest standing on its two short stubby legs: a big round body in soft red-orange (#e8875a), a cream belly (#f6ebd5) with three simple stripe lines, ' +
  'two short round cream horns, a short tail ending in a small flame-shaped tip (flat orange #f2a65a with a yellow #f3d36a inner flame, no glow), round stubby arms (no claws, no teeth). ' +
  'Small bat-like wings in darker red-orange (#c96a43), folded on its back and a bit too small for its round body. Not scary at all, a little shy.';

const CRAB =
  'A small chubby round crab guest, wider than tall: a big smooth dome-shaped shell like an upturned bowl in soft sky blue (#8ec8ee), a plain cream rim (#f6ebd5) along the bottom edge of the shell, ' +
  'two short eye stalks on top with dot eyes, a tiny content smile under the shell rim, three short stubby round legs on each side, and two round mitten-like claws (no sharp points): one tiny claw and one comically oversized claw. ' +
  'Its claws, eye stalks and stubby legs are the SAME sky blue as its shell (no other body color); only the shell rim is cream.';

const GOBLIN =
  'A small chubby goblin guest, a little shorter and much rounder than a villager (about 2 heads tall): a big round head with two long droopy pointed ears sticking out sideways, two dot eyes, ' +
  'a small wobbly mouth with one tiny square tooth poking up, a round potbelly, short tube arms and legs, small bare round feet. Skin: soft pale mint (#bfe6d2). ' +
  'It wears an old dented cooking pot upside down as a hat (plain grey #8e8984, one short handle sticking out to the side) and a plain cream tunic (#f6ebd5) tied with a brown rope. ' +
  'It holds a small wooden spoon up in front of it, very proud of it.';

const BAT =
  'A small round chubby bat guest that is basically one fluffy ball: the body and head are one round blob of soft lavender (#b8a5d8) fur, two big pointy ears, two dot eyes, ' +
  'a tiny mouth with ONE small cute fang, a plain cream oval belly (#f6ebd5), comically TINY bat wings in a slightly darker lavender (#9a86bd) on both sides (clearly too small to carry its round body), ' +
  'two tiny feet dangling below. It hovers just above the ground: its dangling feet are its lowest point.';

const GHOST =
  'A small floating ghost guest: one soft round blob for the head and body (like an upside-down gumdrop), the bottom tapering into a short wavy tail that curls toward the right instead of legs, ' +
  'two tiny stubby nub arms, two dot eyes and a small round "o" mouth, shy and a little curious. Its body is ONE solid flat cream-white color (#f6ebd5) with the dark outline ' +
  '(NOT see-through, no transparency, no glow, no sparkles). It floats just above the ground: the tip of its tail is its lowest point.';

const DOKKAEBI =
  'A small chubby Korean dokkaebi guest (a friendly folk goblin who loves games), about 2 heads tall: a big round head with ONE short stubby round cream horn (#f6ebd5) on top, ' +
  'a messy round blob of dark brown hair (#5a3d2b), two dot eyes, a cheeky little grin with two tiny square teeth, a round potbelly, short tube arms and legs, small bare round feet. ' +
  'Skin: warm soft yellow (#f0c45a). It wears plain short brown shorts (#8a5a3a) tied with a rope, nothing else fancy. ' +
  'It holds a small wooden dokkaebi club (bangmangi: a short brown club with a few round bumps, clearly a toy-like lucky charm, not a weapon) resting on its shoulder.';

const MIMIC =
  'A small chubby treasure-chest mimic guest: a little round-cornered wooden treasure chest (warm wood brown #b07a4f with two plain golden-yellow bands #f3d36a and a small round golden lock plate) ' +
  'walking on two short stubby legs, with two tiny stick arms. The lid is slightly open like a mouth, showing a dark brown inside with a small pink tongue (#e8a5a0) and two round gold coins peeking out; ' +
  'two dot eyes on the front of the chest above the lock. No teeth. Cute and a little greedy-looking, NOT scary.';

const MONSTERS: readonly Entry[] = [
  // 첫 손님 = 손님 세트의 기준 그림 (드워프만 참조). 다른 종의 기본 그림이 이 그림을 두 번째 참조로 받는다.
  ...species('dragon', '꼬마 용', null, DRAGON, {
    joy: {
      note: '셋째 판. 첫 두 판은 Codex 안전 검사(출력 단계, other)에 걸려 파일이 없다: 입을 크게 벌린 만세가 기존 캐릭터와 닮아 보였을 수 있다.',
      extra:
        'IMPORTANT for this pose: its mouth is only a SMALL simple open smile (not a wide open mouth, no tongue), its little wings spread out to both sides, ' +
        'both stubby arms raised up in a cheer, eyes squeezed into happy arcs, and two tiny round blush dots on its cheeks.',
    },
  }),
  ...species('crab', '동글게', '@monsters/dragon_base', CRAB),
  // 고블린 기본 그림만 따로: 꼬마 용을 두 번째 참조로 새로 그리게 한 판이 네 번 모두 Codex 안전 검사(출력 단계, other)에 걸렸다
  // (이끼 초록+돈주머니, 민트+돈주머니, 민트+숟가락). 키트 예제 불 고블린(물 고블린을 참조로 색만 바꾼 판)은 같은 날 통과했다.
  // 그래서 키트의 물 고블린을 두 번째 참조로 붙여 '같은 고블린을 민트색, 표식 없이, 작게'로 그린다.
  // 고블린을 돈·욕심과 엮는 그림·글은 쓰지 않는다 (돈주머니는 비하 고정관념과 겹친다).
  {
    ...guest('goblin', '냄비 고블린', null, GOBLIN),
    refs: ['d_dwarf_idle', 'mon_humanoid_water'],
    note: '다섯째 판. 앞의 네 판은 위 주석처럼 안전 검사에 걸렸다.',
    prompt: para(
      STYLE,
      MON_REF_NOTE,
      GUEST_COMMON,
      GUEST_FRAME,
      'The second attached image is THIS SAME pot goblin species, drawn earlier in the final style (in a sky-blue color, with a small water drop on its pot). ' +
        'Draw the SAME goblin: the same design, face, pot hat, cream tunic with the brown rope, wooden spoon, pose and outline weight, ' +
        'but with soft pale mint skin (#bfe6d2), NO water drop and no other mark on the pot, and drawn SMALLER so it follows the canvas layout above (about half the canvas height, feet on the line about 15% above the bottom edge).',
      GOBLIN,
      GUEST_BASE_FACE,
    ),
  },
  ...species('goblin', '냄비 고블린', '@monsters/dragon_base', GOBLIN).slice(1),
  ...species('bat', '통통박쥐', '@monsters/dragon_base', BAT),
  ...species('ghost', '꼬마 유령', '@monsters/dragon_base', GHOST),
  ...species('dokkaebi', '꼬마 도깨비', '@monsters/dragon_base', DOKKAEBI),
  ...species('mimic', '꼬마 미믹', '@monsters/dragon_base', MIMIC),
];

// ── 주민 (촌장, 부스 진행자) ─────────────────────────────────────────────

const CHARACTERS: readonly Entry[] = [
  villager(
    'chief',
    '촌장 (주인공)',
    'the young village chief, the main character of the game: a cheerful, slightly goofy young person with a round face, a short fluffy chestnut-brown hair blob (#8a5a3a), ' +
      'a plain cream shirt (#f6ebd5), a moss-green vest (#8fae6b) with one small plain round golden badge (#f3d36a) on the chest, brown trousers, little brown boots. ' +
      'One hand is raised in a friendly little wave, the other holds a small brass hand bell (#d9a441). A warm, proud, slightly silly smile.',
  ),
  villager(
    'host_slot',
    '슬롯 부스 진행자',
    'the host of the slot booth: a plump, jolly young man with a round bald head and a tiny round mustache, a soft orange shirt (#f2b279), a small dark red bow tie (#c9614a), ' +
      'a cream apron, brown trousers. He holds a small wooden coin box in both hands. A big friendly showman grin.',
  ),
  villager(
    'host_oddeven',
    '홀짝 부스 진행자',
    'the host of the odd-or-even booth: a calm, tiny old grandma with a round grey hair bun (#b3aea8), small round glasses, a soft mint-green blouse (#bfe6d2), a long plain brown skirt. ' +
      'She holds one closed fist out in front of her (hiding pebbles inside) and a small wooden bowl in the other hand. A sly, gentle smile with closed eyes.',
    {
      note: '둘째 판. 첫 판(host_oddeven.rejected1.png)은 외곽선 16px로 기준(20px)보다 가늘고 얼굴 주름선이 들어갔다.',
      extra:
        "IMPORTANT outline weight: use the SAME very thick, bold dark brown outline as the second image (as thick as on the second character's hair and boots) on every shape. " +
        'Keep her face VERY simple: NO wrinkle lines, no cheek lines, no eyebrow lines; only two small closed-eye arcs behind the small round glasses and a tiny smile.',
    },
  ),
  villager(
    'host_cups',
    '구슬 찾기 부스 진행자',
    'the host of the cup game booth: a skinny, playful young man with a big floppy flat cap (#8a7a6a) over messy dark hair, a lavender shirt (#c9b8e0), a brown vest, brown trousers. ' +
      'He holds one small upside-down wooden cup in one hand. A mischievous but kind wink.',
  ),
  villager(
    'host_darts',
    '다트 부스 진행자',
    'the host of the dart booth: a sporty, energetic girl with a high bouncy ponytail of red-orange hair (#c96a43), a sky-blue shirt (#8ec8ee), a cream apron, short brown trousers. ' +
      'She holds one big toy dart (round wooden body, soft cream feather tail, round blunt tip) up in one hand. A confident, cheerful grin.',
  ),
];

// ── 마을 지도 (바닥, 건물·놀이부스, 소품) ────────────────────────────────

const GROUND: Entry = {
  key: 'ground',
  size: '1024x1536',
  transparent: false,
  max: 1536,
  label: '마을 바닥 지도 (세로, 빈 땅)',
  refs: ['d_dwarf_idle', 'town_view'],
  ownStyle: true,
  prompt: para(
    STYLE,
    'The first attached image (a doodle dwarf character) is a STYLE REFERENCE ONLY: copy its drawing style exactly (same flat fills, tiny amount of detail), but do NOT draw the dwarf or any person; draw only what is asked below.',
    'The second attached image is a part of an older village map from the same game. Copy ONLY its camera angle, its flat soft green grass and light sandy dirt road colors, the soft dark-brown road edge lines and the few tiny pebble dots on the roads. ' +
      'Do NOT copy any building, house, booth, tree, bush, lamp, bench, fountain, pond shape, stall, sign, label, person or object from it.',
    VIEW_MAP,
    'An EMPTY village ground map, portrait, as one flat doodle: plain flat soft green grass (#9cc27a) and light sandy dirt roads (#e8c995). ' +
      'Use THIN dark brown ink outlines on the road edges, about 4px at 1024px width, much thinner than the outline of the reference character (this map is shown enlarged). ' +
      'Layout from top to bottom: (1) at the top, a wide flat grassy area with a road ending in a small round sandy yard (the village hall will stand there); ' +
      '(2) a little above the middle, one big round sandy PLAZA (about 45% of the map width); four short side roads leave the plaza diagonally toward four flat grass lots around it (upper left, upper right, lower left, lower right), where play booths will stand; ' +
      '(3) one small pond (flat blue #8ec8ee with a thin outline) on the right edge, between the upper right lot and the top; ' +
      '(4) one long main street going straight down from the plaza to the bottom center edge of the map (the village entrance); ' +
      '(5) near the bottom, one road going out to the left and one to the right toward two more empty grass lots. ' +
      'The grass lots are EMPTY flat grass. Only a few tiny flat grass tufts (two or three short strokes each) scattered on the grass, nothing else. ' +
      'NO buildings, NO trees, NO bushes, NO flowers, NO fences, NO lamps, NO benches, NO people, NO animals, NO text. Opaque image: it fills the whole canvas edge to edge, no border.',
  ),
};

const BUILDINGS: readonly Entry[] = [
  building(
    'hall',
    '마을회관 (촌장 집)',
    'The village hall, where the village chief lives and works: a cozy two-story cream plaster house (#f6ebd5) with warm brown timber frames (#8a5a3a), a soft red-brown tiled roof (#b5654a) drawn as a few big simple shapes, ' +
      'a small square bell tower on the roof with one round brass bell (#d9a441), a short flag pole with a plain soft orange flag (no emblem), a round arched wooden front door with two little potted plants beside it, and a few small square windows. ' +
      'A little bigger than an ordinary house, friendly and important-looking.',
  ),
  {
    ...building(
      'gate',
      '마을 입구 아치',
      'The village entrance arch where monster guests arrive: two short round stone pillars (soft grey #b3aea8) holding up a curved wooden arch (#a0703f) decorated with a simple garland of a few round green leaves and three small round flowers (cream, soft orange, soft yellow). ' +
        'A small round wooden sign hangs from the middle of the arch showing a simple smiling round monster face symbol (a round blob with two dot eyes and a smile, no letters). The ground under the arch is empty.',
    ),
    // 정면 대칭: VIEW_TOPDOWN 대신 VIEW_FRONT (키트 bld_gate와 같다).
    prompt: para(
      STYLE_REF_ONLY,
      'The second attached image is the forge building from the same village map set. Match it exactly: the same thick dark brown outline weight, the same flat fills and palette, the same small amount of detail, and the same scale (a door of the same size, so the buildings line up on one map). Do NOT redraw the forge; draw only the new object described below.',
      VIEW_FRONT,
      'The village entrance arch where monster guests arrive: two short round stone pillars (soft grey #b3aea8) holding up a curved wooden arch (#a0703f) decorated with a simple garland of a few round green leaves and three small round flowers (cream, soft orange, soft yellow). ' +
        'A small round wooden sign hangs from the middle of the arch showing a simple smiling round monster face symbol (a round blob with two dot eyes and a smile, no letters). The ground under the arch is empty. ' +
        'Transparent background with a real alpha channel. The object is centered with a comfortable empty margin on every side; nothing is cut off at the edges. Signs carry only simple picture symbols, never letters or numbers.',
    ),
  },
  building(
    'workshop',
    '가공소 (간식·응원 도구 공방)',
    'The village workshop kitchen where materials are turned into snacks and cheering goods: a small round-ish cottage with cream walls (#f6ebd5), a thatched straw roof (#e2c27a) drawn as one big soft shape, ' +
      'a short stone chimney with ONE small round cream steam puff, a wide open serving window with a little wooden counter holding a plate of three round cookies, a big round copper pot (#c9824a) on a small stand outside the door, and two small baskets. ' +
      'Signs carry only a simple cookie picture symbol.',
  ),
  building(
    'office',
    '주민 사무소 (고용)',
    'The villager office where new staff are hired: a small tidy wooden house with soft blue-grey walls (#a9c3cc), a dark slate-blue roof (#5d6f86), a round-topped door, ' +
      'a wooden notice board on two posts beside the door with three plain blank cream paper notes pinned on it (no writing), and a small bench. Signs carry only a simple smiling face symbol.',
  ),
  building(
    'warehouse',
    '창고 (재료)',
    'The village storehouse for materials: a small sturdy wooden barn (#a0703f) with a soft red-brown roof (#b5654a), a wide double door standing open showing a dark inside, ' +
      'two stacked wooden crates and one round barrel beside the door, and one small sack. Signs carry only a simple crate picture symbol.',
  ),
  building(
    'fountain',
    '광장 분수',
    'A round stone fountain for the village plaza: a wide low round basin of chunky soft grey stones (#b3aea8) filled with flat blue water (#8ec8ee), a short round pillar in the middle with a small round bowl on top, ' +
      'and one small simple splash of water shooting up from it drawn as two or three flat outlined water drops. Seen from above at the 3/4 angle so the round water surface is visible as an oval. No building around it.',
  ),
  // 놀이부스 넷: 지도에서 무엇을 하는 곳인지 그림으로 읽혀야 한다 (글자 없이).
  building(
    'booth_slot',
    '슬롯 부스',
    'A small open-front wooden play booth: the SLOT booth. A cozy little wooden stall (#a0703f) with a striped awning in cream (#f6ebd5) and soft orange (#f2b279) on top, open at the front, ' +
      'and inside it one big chunky wooden slot machine (warm red #c9614a body, three BLANK cream square windows in a row, a lever with a round ball on its right side). ' +
      'A small round clay pot full of gold coins sits on the counter. Signs carry only a simple cherry-like round fruit picture symbol.',
  ),
  building(
    'booth_oddeven',
    '홀짝 부스',
    'A small open-front wooden play booth: the ODD-OR-EVEN pebble booth. A cozy little wooden stall (#a0703f) with a striped awning in cream (#f6ebd5) and soft mint green (#bfe6d2), ' +
      'a low counter with a round wooden bowl full of small round grey pebbles, and two small round wooden boards hanging at the front: one shows ONE big dot, the other shows TWO big dots (simple picture symbols, no letters, no numbers).',
  ),
  building(
    'booth_cups',
    '구슬 찾기 부스',
    'A small play booth: the CUP game booth. A small round striped tent in cream (#f6ebd5) and soft lavender (#c9b8e0) with a pointed top and a little flag, its front flaps tied open, ' +
      'and in front of it a small round wooden table with three small upside-down brown wooden cups in a row and one small red ball (#c9614a) beside them.',
  ),
  building(
    'booth_darts',
    '다트 부스',
    'A small open-front wooden play booth: the DART booth. A cozy little wooden stall (#a0703f) with a striped awning in cream (#f6ebd5) and soft sky blue (#8ec8ee), ' +
      'and on its back wall one big round target board with three plain rings (cream, soft orange #f2b279, red #c9614a center; NO numbers) with one toy dart stuck in it, and two round balloons (soft yellow, soft blue) tied to the front post.',
  ),
];

const PROPS: readonly Entry[] = [
  prop('tree_round', '둥근 나무', 'A round leafy tree: one big puffy round crown of flat soft green (#8fae6b) made of a few round bumps, a short brown trunk (#8a5a3a).'),
  prop('tree_pine', '뾰족 나무', 'A small pine tree: three stacked simple dark green (#5f7f55) triangle layers with rounded corners, a short brown trunk.'),
  prop('bush', '덤불', 'A low round bush: one puffy round shape of flat soft green (#8fae6b) with two small round cream flowers on it.'),
  prop('flowers', '꽃밭', 'A small patch of flowers: a low round clump of green leaves with four simple round flowers (soft pink #f2b5a8, cream, soft yellow #f3d36a, soft orange #f2b279).'),
  prop('lamp', '가로등', 'A village street lamp: a thin dark brown post with a small square lantern on top glowing as a flat warm yellow (#f3d36a) square (no glow, no light rays).'),
  prop('bench', '벤치', 'A simple wooden park bench: three plain wooden boards (#a0703f) for the seat and back, short legs, turned a little toward the lower left.'),
  prop('fence', '울타리', 'A short wooden picket fence section: four rounded wooden posts (#a0703f) joined by two plain rails, seen a little from above.'),
  prop('signpost', '길 표지판', 'A wooden signpost: one post with two plain blank arrow boards pointing left and right (no writing).'),
  prop('crates', '나무 상자', 'Two stacked wooden crates (#a0703f) with simple plank lines and one round barrel (#8a5a3a) with two grey hoops beside them.'),
  prop('rocks', '바위', 'Two round soft grey rocks (#b3aea8), one big and one small, sitting together.'),
  prop('planter', '화분 상자', 'A wooden planter box (#a0703f) with a low round green bush and three small round flowers growing in it.'),
  prop('balloons', '풍선 다발', 'A small bunch of three round balloons (soft yellow #f3d36a, soft sky blue #8ec8ee, soft orange #f2b279) on thin strings tied to a small wooden peg in the ground.'),
  prop('prize_pot', '상금 항아리 (지도)', 'A round clay prize pot (soft terracotta #c9824a) with a wide mouth, filled to the top with round gold coins (#f3d36a), three coins piled on top.'),
  prop('lot_sign', '빈 부지 표식', 'An empty building lot marker: one short wooden stake with a small plain blank wooden board on top (no writing, no symbols), and two tiny pebbles at its foot.'),
  prop('tuft', '풀 한 포기', 'One tiny tuft of grass: three short thick dark green (#4f7a3f) blades fanning out from one point. Very small and simple.'),
];

/** 닫힌 구역을 덮는 구름 (지도 위에 크게 겹쳐 깐다). */
const CLOUDS: readonly Entry[] = [
  {
    key: 'cloud_puff',
    size: '1536x1024',
    transparent: true,
    max: 900,
    label: '구름 덩어리 (닫힌 구역 덮개)',
    refs: ['d_dwarf_idle'],
    ownStyle: true,
    prompt: para(
      STYLE,
      STYLE_REF_ONLY,
      'One big fluffy cartoon cloud bank seen from above, used to cover unexplored parts of a village map in a cozy tycoon game: a wide lumpy shape made of many big round bumps, ' +
        'solid flat off-white (#f4f1ea) with a few slightly greyer bumps (#e4e1da) at the bottom, thick dark brown outline around the outer edge only (no lines inside except two or three short bump curves). ' +
        'Solid and opaque, NOT see-through, no glow, no shading, no sky, no ground. It fills most of the wide canvas, centered, with a small empty margin on every side. Transparent background with a real alpha channel.',
    ),
  },
];

// ── 확대 화면 (배경, 기계, 소품) ─────────────────────────────────────────

const CLOSEUP_BGS: readonly Entry[] = [
  closeupBg(
    'bg_slot',
    '슬롯 부스 확대 배경',
    'This booth: the SLOT booth. A plain flat warm cream wall (#f6ebd5) filling most of the image, a striped awning edge in cream and soft orange (#f2b279) with a scalloped bottom edge across the very top, ' +
      'and a plain warm wooden floor strip (#c9995f) across the bottom fifth of the image with one simple floor line. Two small round clay pots of coins stand at the far left and far right corners of the floor.',
  ),
  closeupBg(
    'bg_oddeven',
    '홀짝 부스 확대 배경',
    'This booth: the ODD-OR-EVEN pebble booth. A plain flat pale mint wall (#dcefe3) filling most of the image, a striped awning edge in cream and soft mint (#bfe6d2) with a scalloped bottom edge across the very top, ' +
      'and a plain warm wooden floor strip (#c9995f) across the bottom fifth of the image with one simple floor line. One small potted round plant stands at the far left corner of the floor.',
  ),
  closeupBg(
    'bg_cups',
    '구슬 찾기 부스 확대 배경',
    'This booth: the CUP game tent. The inside of a striped tent: plain flat pale lavender (#e6ddf1) cloth walls filling most of the image with two or three soft vertical cream stripes, a scalloped tent edge across the very top, ' +
      'and a plain warm wooden floor strip (#c9995f) across the bottom fifth of the image with one simple floor line.',
  ),
  closeupBg(
    'bg_darts',
    '다트 부스 확대 배경',
    'This booth: the DART booth. A plain flat pale sky-blue wall (#d6eaf5) filling most of the image, a striped awning edge in cream and soft sky blue (#8ec8ee) with a scalloped bottom edge across the very top, ' +
      'and a plain warm wooden floor strip (#c9995f) across the bottom fifth of the image with one simple floor line. Two round balloons (soft yellow, soft orange) are tied high on the far left and far right edges of the wall.',
  ),
];

const OBJECTS: readonly Entry[] = [
  // 확대 화면 소품 세트의 기준 그림 (드워프만 참조).
  closeupObject(
    'slot_machine',
    '슬롯 기계',
    'A big chunky cute slot machine: a rounded box body in warm red (#c9614a) with a cream (#f6ebd5) front panel, a rounded top with a small round golden bell-shaped ornament (#f3d36a), ' +
      'three BLANK square windows in a row across the middle (plain flat cream-white #fbf5e8 inside, completely EMPTY: no symbols, no fruit, no numbers inside them), ' +
      'a lever sticking out on its right side with a round red ball on top, and a small open coin tray at the bottom front. Short stubby feet.',
    { lead: false, max: 720 },
  ),
  closeupObject(
    'prize_pot',
    '상금 항아리',
    'A round clay prize pot (soft terracotta #c9824a) with a wide mouth and a thick rim, filled to the top with round gold coins (#f3d36a), a few coins piled on top. No face.',
    { max: 400 },
  ),
  closeupObject('table', '부스 탁자', 'A small low round-cornered wooden table (#a0703f) seen from the front, a plain cream tablecloth (#f6ebd5) hanging over its front edge, short stubby legs. Nothing on top of the table.', { max: 640 }),
  closeupObject('cup', '구슬 찾기 컵', 'ONE small upside-down wooden cup (#a0703f), wider at the bottom, with one simple band line around it.', { small: true, max: 256 }),
  closeupObject('ball', '구슬', 'ONE small round red ball (#c9614a), a plain circle with nothing on it.', { small: true, max: 128 }),
  closeupObject('dartboard', '다트 과녁', 'A big round dart target board hanging flat: three plain rings (outer cream #f6ebd5, middle soft orange #f2b279, small red center #c9614a), a plain brown wooden rim (#8a5a3a), NO numbers, NO lines dividing it.', { max: 640 }),
  closeupObject('dart', '다트', 'ONE toy dart pointing to the right: a short round wooden body (#a0703f), a soft cream feather tail (#f6ebd5) at its left end, a round blunt metal tip (#b3aea8) at its right end.', { small: true, max: 192 }),
  closeupObject('pebble_bowl', '조약돌 그릇', 'A round wooden bowl (#a0703f) seen from the front and a little from above, filled with small round grey pebbles (#b3aea8).', { max: 384 }),
  closeupObject('pebble', '조약돌', 'ONE small round smooth grey pebble (#b3aea8), slightly flattened, with nothing on it.', { small: true, max: 96 }),
];

// ── 슬롯 심볼 (아이콘 세트) ──────────────────────────────────────────────
// 첫 심볼은 키트 element_water를 두 번째 참조로. 나머지는 첫 심볼을.

const SYM_LEAD = '@icons/sym_apple';
const ICONS: readonly Entry[] = [
  icon('sym_apple', '심볼: 사과', 'element_water', 'Slot machine symbol: one plump round red apple (#c9614a) with a short brown stem and one small green leaf (#8fae6b).', { max: 192 }),
  icon('sym_mushroom', '심볼: 버섯', SYM_LEAD, 'Slot machine symbol: one chubby mushroom with a round soft red cap (#c9614a) with three round cream spots and a short cream stem.', { max: 192 }),
  icon('sym_star', '심볼: 별', SYM_LEAD, 'Slot machine symbol: one plump five-pointed star with rounded points in warm butter yellow (#f3d36a).', { max: 192 }),
  icon('sym_gem', '심볼: 보석', SYM_LEAD, 'Slot machine symbol: one chunky faceted gem in soft sky blue (#8ec8ee) with two simple facet lines, no shine.', { max: 192 }),
  icon('sym_acorn', '심볼: 도토리', SYM_LEAD, 'Slot machine symbol: one plump acorn: a round warm brown nut (#c9995f) with a darker brown cap (#8a5a3a) and a tiny stem.', { max: 192 }),
  icon('sym_bell', '심볼: 황금 종 (대박)', SYM_LEAD, 'Slot machine symbol, the jackpot: one plump golden bell (#f3d36a) with a small round clapper at the bottom and a little red bow (#c9614a) on top.', { max: 192 }),
];

// ── 이모트·효과 ──────────────────────────────────────────────────────────

const FX_LEAD = '@fx/emote_heart';
const FX: readonly Entry[] = [
  fx('emote_heart', '이모트: 하트', 'element_water', 'Emote icon shown above a happy character: one plump rounded heart in soft red (#e0716a).'),
  fx('emote_sweat', '이모트: 땀방울', FX_LEAD, 'Emote icon for nervousness: one big plump sweat drop in pale sky blue (#cfe8f7), tilted a little.'),
  fx('emote_tear', '이모트: 눈물', FX_LEAD, 'Emote icon for crying: two plump tear drops in pale sky blue (#cfe8f7) flying out sideways from each other.'),
  fx('emote_sparkle', '이모트: 반짝', FX_LEAD, 'Emote icon for joy: one plump four-point sparkle star in warm butter yellow (#f3d36a) with one tiny four-point star beside it.'),
  fx('emote_storm', '이모트: 먹구름', FX_LEAD, 'Emote icon for gloom: one small round dark grey cloud (#7d7672) with one small zigzag lightning bolt in soft yellow below it.'),
  fx('emote_note', '이모트: 음표', FX_LEAD, 'Emote icon for a good mood: one plump eighth music note in warm brown (#8a5a3a).'),
  fx('emote_anger', '이모트: 화남 표시', FX_LEAD, 'Emote icon for frustration: the cartoon anger mark, four short thick curved red (#c9614a) strokes arranged in a cross-like popping vein shape.'),
  fx('emote_shock', '이모트: 깜짝', FX_LEAD, 'Emote icon for surprise: three short thick straight burst lines in soft orange (#f2b279), fanning out like a little surprise pop.'),
  fx('fx_confetti', '효과: 색종이', FX_LEAD, 'Effect sprite: ONE small curled ribbon of confetti in soft orange (#f2b279), a short wavy strip.', 96),
  fx('fx_puff', '효과: 먼지 뭉치', FX_LEAD, 'Effect sprite: ONE round puff of dust cloud in warm cream-grey (#e4dccf) made of three round bumps.', 128),
];

// ── 아이템 (재화, 특산 재료, 귀한 물건, 가공품) ──────────────────────────

const ITEM = (what: string): string => `${what} ${ALPHA_MARGIN}`;
const ITEMS: readonly Entry[] = [
  itemIcon('coin', '코인', ITEM('One chunky round gold coin (#f3d36a) seen a little from the front, with a simple round inner rim line and a small plain star mark in the middle (no letters, no numbers).')),
  itemIcon('coin_pile', '코인 더미', ITEM('A small pile of five chunky round gold coins (#f3d36a) stacked a little messily.')),
  // 특산 재료 (종마다 하나)
  itemIcon('mat_ember', '불씨 조각 (꼬마 용)', ITEM('One small warm ember stone: a round dark red-brown pebble (#8a4a3a) with a small flat orange flame (#f2a65a) and yellow inner flame (#f3d36a) on top, no glow.')),
  itemIcon('mat_shell', '조개껍데기 (동글게)', ITEM('One plump scallop seashell in soft sky blue (#8ec8ee) with a cream edge and three simple ridge lines.')),
  itemIcon('mat_spoon', '낡은 숟가락 (냄비 고블린)', ITEM('One small old wooden spoon (#a0703f) lying diagonally, chunky and a little bent.')),
  itemIcon('mat_fluff', '솜털 (통통박쥐)', ITEM('One round fluffy tuft of soft lavender fur (#b8a5d8) made of a few round bumps.')),
  itemIcon('mat_mist', '안개솜 (꼬마 유령)', ITEM('One small round puff of cream-white mist (#f6ebd5) shaped like a little cloud ball, solid flat color, no glow.')),
  itemIcon('mat_bangmangi', '방망이 조각 (꼬마 도깨비)', ITEM('One small chunky piece of a wooden dokkaebi club: a short brown wooden stick (#8a5a3a) with two round bumps.')),
  itemIcon('mat_shinycoin', '반짝 동전 (꼬마 미믹)', ITEM('One old round coin in soft copper (#c9824a) with a small square hole in the middle, like an old Korean coin, no letters.')),
  // 귀한 물건
  itemIcon('gem', '보석', ITEM('One chunky faceted gem in soft sky blue (#8ec8ee) with two simple facet lines, no shine.')),
  itemIcon('golden_acorn', '황금 도토리', ITEM('One plump golden acorn (#f3d36a) with a darker golden-brown cap (#c9a14a) and a tiny stem.')),
  itemIcon('star_piece', '별 조각', ITEM('One small chunky star-shaped piece in warm butter yellow (#f3d36a) with rounded points, slightly chipped on one corner.')),
  // 가공품 (간식, 응원 도구)
  itemIcon('snack_cookie', '위로 쿠키', ITEM('One round chunky cookie (#d9a066) with four darker brown chocolate chips, a small bite taken out of one side.')),
  itemIcon('snack_ricecake', '꿀떡', ITEM('Three small round Korean honey rice cakes (soft white #f6ebd5, soft pink #f2c4c0, soft green #c9e0b0) on a little wooden skewer.')),
  itemIcon('cheer_flag', '응원 깃발', ITEM('One small triangle cheering pennant flag in soft orange (#f2b279) on a short wooden stick, with one simple star mark on it (no letters).')),
  itemIcon('lucky_charm', '행운 부적', ITEM('One small rounded lucky charm pouch in soft red (#c9614a) tied at the top with a golden cord (#f3d36a) and a tiny tassel.')),
];

// ── 놀이부스 둘째 묶음 (2026-10-15): 돌림판, 인형 뽑기, 오리 낚시, 복주머니, 고리 던지기, 몬스터 경주장(대형) ──
// 경주장의 경주로는 바닥처럼 코드로 그리고, 출발대·관중석·결승선·선수만 그림이다.

const BOOTHS2: readonly Entry[] = [
  building(
    'booth_wheel',
    '돌림판 부스',
    'A small open-front wooden play booth: the PRIZE WHEEL booth. A cozy little wooden stall (#a0703f) with a striped awning in cream (#f6ebd5) and soft butter yellow (#f3d36a), ' +
      'and inside it one big upright round prize wheel divided into six plain flat colored slices (soft red, cream, soft sky blue, soft yellow, mint, soft orange; NO symbols, NO numbers) with a small red pointer at the top. ' +
      'Signs carry only a simple wheel picture symbol.',
  ),
  building(
    'booth_claw',
    '인형 뽑기 부스',
    'A small play booth: the CLAW MACHINE booth. A little wooden kiosk (#a0703f) with a soft lavender-blue roof (#9aa6d6), and in front of it one big chunky claw machine: ' +
      'a tall box with a rounded soft red top (#c9614a), a big flat pale-blue glass front (#d6eaf5, NO reflections, no glare) showing a small pile of round plush toys inside, ' +
      'a small claw hanging near the top inside, a joystick on the front panel and a prize chute at the bottom. Signs carry only a simple plush bear-face picture symbol.',
  ),
  building(
    'booth_duck',
    '오리 낚시 부스',
    'A small play booth: the DUCK FISHING booth. A low wooden stall (#a0703f) with a striped awning in cream (#f6ebd5) and soft blue-grey (#a9c3cc), ' +
      'and in front of it one big round shallow wooden tub full of flat blue water (#8ec8ee) with five small yellow rubber ducks (#f3d36a) floating on it, and two small toy fishing rods leaning against the stall. ' +
      'Signs carry only a simple duck picture symbol.',
  ),
  building(
    'booth_pouch',
    '복주머니 부스',
    'A small open-front wooden play booth: the LUCKY POUCH booth. A cozy little wooden stall (#a0703f) with a striped awning in cream (#f6ebd5) and soft red (#c9614a), ' +
      'with a row of five plump Korean lucky pouches (bokjumeoni: round silk pouches gathered and tied at the top with a cord) in soft red, soft blue, soft yellow, mint and soft orange hanging from a rail under the awning, and a low counter. ' +
      'Signs carry only a simple pouch picture symbol.',
  ),
  building(
    'booth_ring',
    '고리 던지기 부스',
    'A small open-front wooden play booth: the RING TOSS booth. A cozy little wooden stall (#a0703f) with a striped awning in cream (#f6ebd5) and soft leaf green (#8fae6b), ' +
      'and on a stepped wooden shelf inside it three rows of small round bottles in flat soft green glass (#a8c47e, NO reflections), with a few plump toy rings (soft red, soft yellow) lying on the counter. ' +
      'Signs carry only a simple ring picture symbol.',
  ),
  // 경주장 소품 (경주로는 코드)
  building(
    'race_gate',
    '경주장 출발대',
    'A small wooden starting gate for a tiny critter race: a low wooden frame (#a0703f) with four small stalls side by side, each with a little swinging gate in a different soft color (soft red, soft blue, soft yellow, mint), ' +
      'and one short pole with a small plain soft orange flag on top. No animals in it.',
  ),
  building(
    'race_stand',
    '경주장 관중석',
    'A small open wooden grandstand for spectators: three low stepped wooden benches (#a0703f) under a simple striped canopy in cream (#f6ebd5) and soft orange (#f2b279) held up by four posts. EMPTY: no people, no monsters on it.',
  ),
  prop(
    'race_finish',
    '경주장 결승선',
    'A finish line marker for a tiny critter race: two short wooden posts with a horizontal soft red ribbon (#c9614a) stretched between them and one small round soft yellow flag on top of each post.',
  ),
];

/** 경주 선수 (작은 동물, 옆에서 본 모습, 왼쪽으로 달린다). 조끼 색으로 서로 구별한다. */
const RACER_COMMON =
  `Draw ONE tiny critter racer for a little race in ${GAME}, full body, seen from the SIDE, running toward the LEFT edge of the image. ` +
  'Cute, silly and harmless: round chunky shapes, two dot eyes, a tiny determined mouth, very few details, a few flat color blocks. ' +
  'It wears one small plain racing bib (a flat colored rectangle on its back or side, NO numbers, NO letters) in the color described below. ' +
  'Draw it fairly SMALL in the canvas (the whole racer fits in the middle half of the canvas) with the same VERY fat, bold dark brown marker outline as the dwarf. ' +
  'Transparent background with a real alpha channel: no ground, no track, no floor shadow, no motion lines, no dust.';
const racer = (key: string, label: string, look: string): Entry => ({
  key,
  size: '1024x1024',
  transparent: true,
  max: 256,
  label,
  refs: ['d_dwarf_idle'],
  ownStyle: true,
  prompt: para(STYLE, MON_REF_NOTE, RACER_COMMON, look),
});
const RACERS: readonly Entry[] = [
  racer('racer_snail', '선수: 달팽이', 'A chubby little snail: a soft cream-yellow body (#f3dfa0) with two short eye stalks, a big round spiral shell in warm brown (#c9995f) with one simple spiral line. Racing bib: soft red (#c9614a).'),
  racer('racer_turtle', '선수: 거북', 'A tiny round turtle: soft green skin (#9cbf7a), a round dome shell in darker green (#6f9a55) with two simple plate lines, four stubby legs mid-stride. Racing bib: soft sky blue (#8ec8ee).'),
  racer('racer_frog', '선수: 개구리', 'A tiny chubby frog mid-hop: soft mint green (#a8d8a0) body, two big round bumps for eyes on top, a wide little smile, long back legs pushing off. Racing bib: soft yellow (#f3d36a).'),
  racer('racer_ladybug', '선수: 무당벌레', 'A tiny round ladybug scurrying: a soft red dome shell (#d0624f) with four round dark dots, a small dark head with two short antennae, six tiny stubby legs. Racing bib: mint (#bfe6d2).'),
];

const CLOSEUP_BGS2: readonly Entry[] = [
  closeupBg(
    'bg_wheel',
    '돌림판 부스 확대 배경',
    'This booth: the PRIZE WHEEL booth. A plain flat pale butter-yellow wall (#f7ecc4) filling most of the image, a striped awning edge in cream and soft yellow (#f3d36a) with a scalloped bottom edge across the very top, ' +
      'and a plain warm wooden floor strip (#c9995f) across the bottom fifth of the image with one simple floor line.',
  ),
  closeupBg(
    'bg_claw',
    '인형 뽑기 부스 확대 배경',
    'This booth: the CLAW MACHINE kiosk. A plain flat pale lavender-blue wall (#dfe3f3) filling most of the image, a plain soft lavender-blue roof edge (#9aa6d6) with a scalloped bottom edge across the very top, ' +
      'and a plain warm wooden floor strip (#c9995f) across the bottom fifth of the image with one simple floor line. Two small round plush toys sit at the far left corner of the floor.',
  ),
  closeupBg(
    'bg_duck',
    '오리 낚시 부스 확대 배경',
    'This booth: the DUCK FISHING booth by the pond. A plain flat pale sky (#d6eaf5) in the top half with one or two simple round clouds, a soft green grass strip (#9cc27a) across the middle, ' +
      'and a plain warm wooden deck (#c9995f) across the bottom fifth of the image with one simple floor line. A striped awning edge in cream and soft blue-grey (#a9c3cc) with a scalloped bottom edge across the very top.',
  ),
  closeupBg(
    'bg_pouch',
    '복주머니 부스 확대 배경',
    'This booth: the LUCKY POUCH booth. A plain flat pale warm cream wall (#f6e3d6) filling most of the image, a striped awning edge in cream and soft red (#c9614a) with a scalloped bottom edge across the very top, ' +
      'and a plain warm wooden floor strip (#c9995f) across the bottom fifth of the image with one simple floor line. A thin wooden rail runs across the upper part of the wall, EMPTY (nothing hanging on it).',
  ),
  closeupBg(
    'bg_ring',
    '고리 던지기 부스 확대 배경',
    'This booth: the RING TOSS booth. A plain flat pale green wall (#e1eed6) filling most of the image, a striped awning edge in cream and soft leaf green (#8fae6b) with a scalloped bottom edge across the very top, ' +
      'and a plain warm wooden floor strip (#c9995f) across the bottom fifth of the image with one simple floor line.',
  ),
  closeupBg(
    'bg_race',
    '몬스터 경주장 확대 배경',
    'This place: the side of a tiny outdoor critter race track. A plain flat pale sky (#d6eaf5) in the top part with two simple round clouds, a low simple wooden fence (#a0703f) running straight across the middle of the image from left to right, ' +
      'a flat soft green grass strip (#9cc27a) under the fence, and a wide flat sandy race lane (#ebc68e) across the bottom third of the image with one simple edge line on top. Opaque, no signs, no flags.',
  ),
];

/** 인형 뽑기 상품: 손님 몬스터의 인형 판 (그 종의 기본 그림을 두 번째 참조로). */
const plush = (sp: string, label: string): Entry => ({
  key: `plush_${sp}`,
  size: '1024x1024',
  transparent: true,
  max: 256,
  label: `인형: ${label}`,
  refs: ['d_dwarf_idle', `@monsters/${sp}_base`],
  ownStyle: true,
  prompt: para(
    STYLE,
    STYLE_REF_ONLY,
    'The second attached image is one of our monster guests. Draw a small soft PLUSH TOY version of it: the same colors and the same recognizable features, but rounder, squishier and simpler, sitting with its tiny legs forward, ' +
      'a slightly bigger head, two dot eyes and a tiny mouth, like a cute stuffed toy prize. NO stitches, NO seams, NO tags, no shading.',
    'Draw it fairly SMALL in the canvas (filling about half of it) with the same VERY fat, bold dark brown marker outline as the dwarf. Transparent background with a real alpha channel: no floor, no shadow.',
  ),
});

const OBJECTS2: readonly Entry[] = [
  closeupObject(
    'wheel_disc',
    '돌림판 원판',
    'ONLY the round disc of a prize wheel, seen perfectly straight from the front (a perfect circle): a thick wooden rim (#a0703f) and SIX equal pie slices in plain flat colors going around ' +
      '(soft red #c9614a, cream #f6ebd5, soft sky blue #8ec8ee, soft yellow #f3d36a, mint #bfe6d2, soft orange #f2b279), each slice EMPTY (no symbols, no numbers), thin dark lines between slices, a small round wooden hub in the exact center. No stand, no pointer.',
    { max: 640 },
  ),
  closeupObject('wheel_stand', '돌림판 받침대', 'A sturdy short wooden stand for a big prize wheel, seen from the front: two slanted wooden legs (#a0703f) joined by a crossbar, meeting at a round wooden peg at the top center. Nothing is mounted on it.', { max: 512 }),
  closeupObject('wheel_pointer', '돌림판 바늘', 'ONE small chunky red (#c9614a) triangular pointer arrow pointing straight DOWN, with a small round wooden knob at its top.', { small: true, max: 160 }),
  closeupObject(
    'claw_machine',
    '인형 뽑기 기계',
    'A big chunky claw machine seen straight from the front: a tall rounded box body in soft red (#c9614a) with a plain cream top panel (blank), one big square glass window in flat pale blue (#d6eaf5, NO reflections, no glare) that is completely EMPTY inside ' +
      '(no toys, no claw: they are added separately), a front control panel under the window with one round joystick and one round button, and a square prize chute opening at the bottom left. Short stubby feet.',
    {
      max: 720,
      note: '둘째 판. 첫 판(claw_machine.rejected1.png)은 유리창 가운데에 하얀 빛 번짐(광택)이 들어갔다.',
      extra: 'IMPORTANT: the glass window is ONE single flat pale blue color (#d6eaf5) edge to edge: no white glow, no shine spot, no glare, no light patch, no reflection lines anywhere on it.',
    },
  ),
  closeupObject('claw', '집게', 'ONE toy crane claw: a small round grey hub (#b3aea8) with three short curved rounded prongs opening downward, and a thin dark rod going straight up from the hub.', { small: true, max: 256 }),
  plush('dragon', '꼬마 용'),
  plush('crab', '동글게'),
  {
    ...plush('goblin', '냄비 고블린'),
    note: '둘째 판. 첫 판(plush_goblin.rejected1.png)은 피부를 짙은 초록으로 칠했다 (기본 그림은 연민트).',
    prompt: `${plush('goblin', '냄비 고블린').prompt}\n\nIMPORTANT color: its skin is the SAME soft pale mint (#bfe6d2) as the second image, NOT dark green, NOT sage green.`,
  },
  plush('bat', '통통박쥐'),
  plush('ghost', '꼬마 유령'),
  plush('dokkaebi', '꼬마 도깨비'),
  plush('mimic', '꼬마 미믹'),
  closeupObject('duck_tub', '오리 낚시 통', 'A round shallow wooden tub (#a0703f) seen from the front and a little from above, filled with flat blue water (#8ec8ee) with two or three simple wave lines. EMPTY water: no ducks (they are added separately).', { max: 640 }),
  closeupObject('rubber_duck', '고무 오리', 'ONE small yellow rubber duck toy (#f3d36a) with an orange beak (#f2a65a) and a dot eye, floating, seen from the side facing LEFT.', { small: true, max: 192 }),
  closeupObject('fishing_rod', '낚싯대', 'ONE short toy fishing rod lying diagonally from lower left to upper right: a short wooden stick (#a0703f) with a thin line hanging from its upper tip ending in a small round ring hook.', { small: true, max: 256 }),
  closeupObject('pouch_red', '복주머니 (빨강)', 'ONE plump Korean lucky pouch (bokjumeoni): a round silk pouch in soft red (#c9614a) gathered at the top and tied with a golden cord (#f3d36a) in a little bow, one simple round flower mark on the front (no letters).', { small: true, max: 256 }),
  closeupObject('pouch_blue', '복주머니 (파랑)', 'ONE plump Korean lucky pouch (bokjumeoni): a round silk pouch in soft blue (#7fa8d6) gathered at the top and tied with a golden cord (#f3d36a) in a little bow, one simple round flower mark on the front (no letters).', { small: true, max: 256 }),
  closeupObject('pouch_gold', '복주머니 (노랑)', 'ONE plump Korean lucky pouch (bokjumeoni): a round silk pouch in soft yellow (#f3d36a) gathered at the top and tied with a soft red cord (#c9614a) in a little bow, one simple round flower mark on the front (no letters).', { small: true, max: 256 }),
  closeupObject('bottle', '고리 던지기 병', 'ONE small round bottle with a long neck, standing upright, in flat soft green glass (#a8c47e) with NO reflections, no label.', { small: true, max: 192 }),
  closeupObject('toss_ring', '던지기 고리', 'ONE plump toy ring for a ring toss game: a round ring like a small donut in soft red (#c9614a), seen a little from above so it clearly reads as a ring with a hole.', { small: true, max: 160 }),
];

/** 둘째 묶음의 진행자 (경주장은 셋: 출발 신호, 해설자, 사육사). */
const CHARACTERS2: readonly Entry[] = [
  villager('host_wheel', '돌림판 진행자', 'the host of the prize wheel booth: a cheerful round-faced young woman with short wavy black hair (#3a2a24), a soft butter-yellow blouse (#f3d36a), a brown vest, a long plain brown skirt. One hand raised in a showy presenting gesture. A big bright smile.'),
  villager('host_claw', '인형 뽑기 진행자', 'the host of the claw machine booth: a shy, gentle teenage boy with round glasses, a soft red cap (#c9614a) worn a little crooked, a cream shirt, short brown trousers. He hugs a small round plush toy in both arms. A shy little smile.'),
  villager('host_duck', '오리 낚시 진행자', 'the host of the duck fishing booth: a sleepy, kind old grandpa with a round white beard blob and a wide straw hat (#e2c27a), a soft blue-grey shirt (#a9c3cc), brown trousers rolled up. He holds a short toy fishing rod. A calm, sleepy smile.'),
  villager('host_pouch', '복주머니 진행자', 'the host of the lucky pouch booth: a gentle middle-aged woman with a neat dark hair bun with a simple wooden hairpin, a short soft red jacket (#c9614a) tied at the front with a cream ribbon, a long cream skirt. She holds one small plump lucky pouch in both hands. A warm, kind smile.'),
  villager('host_ring', '고리 던지기 진행자', 'the host of the ring toss booth: a lanky, cheerful young man with a soft leaf-green bandana (#8fae6b) on his head, rolled-up cream sleeves, brown trousers. He holds a stack of three plump toy rings on one arm. A playful grin.'),
  villager('race_starter', '경주장 출발 신호', 'the race starter of the critter race track: a tiny energetic girl with two short round pigtails, a soft orange shirt (#f2b279), short brown trousers, a small whistle on a cord. She holds a small plain soft orange flag up high. An excited open-mouthed smile.'),
  villager('race_caster', '경주장 해설자', 'the race commentator of the critter race track: a chubby, talkative man with a round face and a small curled mustache, a cream shirt with a small dark red bow tie (#c9614a), a brown vest. He holds a simple cone-shaped wooden megaphone to his mouth. Eyebrows raised, very excited.'),
  villager(
    'race_keeper',
    '경주장 사육사',
    'the critter keeper of the race track: a calm young person with short round brown hair (#8a5a3a), a moss-green apron (#8fae6b) over a cream shirt, little brown boots. A tiny snail sits on one hand and the other holds a small watering can. A gentle smile.',
    {
      note: '둘째 판 (후보 둘 중 B: 선 21px, 촌장과 결이 가장 비슷. A는 race_keeper.try1.png). 첫 판(race_keeper.rejected1.png)은 사용자 지적: 외곽선이 옅고(18px) 그림체가 살짝 다르다 (머리가 잔 가닥으로 갈라졌다).',
      extra:
        'IMPORTANT: use the SAME very thick, bold dark brown outline as the second image on every shape (as thick as on its hair and boots), not a thin pen line. ' +
        'The hair is ONE big simple round blob shape like the second image, with at most two inner lines: NO separate strands, NO spiky or messy tufts. Keep every detail as simple and chunky as the second image.',
    },
  ),
];

// ── 손님 몬스터 둘째 묶음 (2026-10-15): 20종 × 4포즈 + 인형 + 특산 재료 ──────────────
// 디자인 규칙 (첫 묶음에서 배운 것): 유명 캐릭터를 떠올리게 하는 조합(주황 도마뱀+꼬리 불꽃, 둥근 파란 물방울 슬라임,
// 빨간 점박이 버섯 사람, 잎사귀 모자 너구리, 여러 갈래 곱슬 꼬리 여우 …)과 비하 고정관념과 겹치는 조합(고블린+돈)은 피한다.
// 기본 그림은 모두 꼬마 용(dragon_base)을 화풍·자리 기준으로 받는다.

const MOLE =
  'A small round chubby mole guest standing upright on two short legs like a little miner: warm ochre-brown fur (#c9995f), a big round soft pink nose (#e8a5a0), eyes drawn as two tiny squinting lines (it can barely see), ' +
  'a puzzled little mouth, two big round pink paws like mittens (no claws). It wears a dented yellow miner helmet (#f3d36a) with a small round headlamp drawn as a flat cream circle (no light beam, no glow) and moss-green overalls (#8fae6b). ' +
  'It carries a small brown sack of round grey ore lumps on its back with one tiny green sprout growing out of the sack.';
const TURTLE =
  'A small chubby old pond turtle guest, wider than tall, standing on four short stumpy round legs, its round head stretched forward toward the LEFT with sleepy half-closed eyes and a calm tiny smile. ' +
  'Soft blue-grey skin (#a9c3cc). Its dome shell is soft sky blue (#8ec8ee) with only a few big simple plate lines, and on top of the shell sits one round moss-green lily pad (#8fae6b) with one very small green frog on it.';
const CLOUD =
  'A small fluffy cumulus cloud spirit guest floating just above the ground, no legs: one puffy round cloud body made of a few big round bumps, pale mint (#cfeadb) with a few off-white (#f4f7f2) bumps, ' +
  'solid flat fills (NOT see-through, no glow). A small face in the middle of the cloud: two dot eyes and cheeks puffed out, two small cloud-puff arms, and a smaller cloud tail trailing behind it on the right. Its lowest bump is its lowest point.';
const MOON_RABBIT =
  'A small chubby moon rabbit guest from the Korean folk tale (the rabbit who pounds rice cakes on the moon): a round soft white body (#f7f3ea), two long upright ears with soft pink insides (#f2c4c0), two dot eyes, a tiny "x" shaped nose and mouth, ' +
  'short stubby arms and feet. It wears a small soft yellow neck scarf (#f3d36a) and holds a little wooden rice-cake mallet (a short wooden handle with a round wooden head) over its shoulder.';
const GUMIHO =
  'A small chubby baby fox spirit guest (a very young, harmless Korean gumiho): a round cream-yellow body (#f3dfa0), a round head with two big pointed ears with cream insides, two dot eyes, a tiny smile, short stubby legs, ' +
  'and THREE straight fluffy tails fanned out behind it like a soft fan, each tail cream-yellow with a soft orange tip (#f2b279). A small round pale blue bead (#bfe0f5, flat, no glow) floats just above its head.';
const HAETAE =
  'A small chubby haetae cub guest (the friendly Korean mythical guardian lion-dog): a round soft cream body (#f3e6c8), a big round head with a big curly mane made of a few round teal-green curls (#6fb3a6), ' +
  'one short round stubby horn on its forehead, two dot eyes, a big happy grin with no fangs, four short stubby legs and a small curly teal tail tuft. A tiny round brass bell (#d9a441) hangs on a red cord around its neck.';
const PUDDING =
  'A small wobbly custard pudding guest: a short round dome-shaped pudding body in soft caramel yellow (#f3d58a) with a darker caramel top (#c98a4a) dripping a little over the edge, a small dollop of cream with one red cherry on top, ' +
  'two dot eyes and a tiny smile on the front of the pudding, two tiny stubby arms and two tiny round feet. It looks soft and jiggly.';
const SHEEP =
  'A small round fluffy sheep guest: the body is one big puffy cloud of cream wool (#f6efe2) made of round bumps, a small soft brown face (#a0705a) peeking out of the wool with two dot eyes and a tiny smile, two small floppy ears, ' +
  'two tiny curled cream horns, and four short stubby brown legs. Sleepy and gentle.';
const MUGWORT_MOCHI =
  'A small round mugwort rice-cake spirit guest (ssuk-tteok): a soft squishy round mochi body in soft sage green (#a9c48a), slightly flattened like a dumpling, two dot eyes, two tiny round pink blush dots (#f2c4c0), a tiny smile, ' +
  'two tiny stubby arms and feet, and one small green leaf sitting on top of its head like a little hat.';
const KABOCHA =
  'A small chubby kabocha squash guest: a round, slightly flattened squash body in deep soft green (#5f7f55) with a few lighter green speckles drawn as flat dots, a short brown stem with one curly vine on top, ' +
  'a friendly face on the front (two dot eyes and a small smile, NOT a carved jack-o-lantern face), two tiny stubby arms and two short round feet in soft orange (#f2b279).';
const RADISH =
  'A small chubby Korean white radish guest (mu): a plump rounded white radish body (#f7f3ea) with a soft pale green top (#cfe3b0), a bunch of three big rounded green leaves (#8fae6b) sprouting from its head, ' +
  'two dot eyes and a small cheerful smile, two tiny stubby arms, and a short pointed root tip at the bottom between two tiny round feet.';
const GOLEM =
  'A small chubby pebble golem guest: a round body made of one big smooth soft grey stone (#b3aea8) and a smaller round stone head on top, short stubby stone arms and legs, two dot eyes and a tiny calm mouth carved simply, ' +
  'with a few small flat moss patches (#8fae6b) on its head and shoulders and one tiny flower growing from the moss. Heavy, slow and gentle.';
const WHALE =
  'A small chubby sky whale guest that floats in the air: a round, plump whale body in soft blue-grey (#9db8cc) with a pale cream belly (#f4efe3), a tiny tail fin curling up behind it on the right, two small side fins like little arms, ' +
  'two dot eyes and a small happy smile, and a tiny spout of water drawn as two or three flat round drops above its head. It floats just above the ground: the bottom of its belly is its lowest point.';
const OWL =
  'A small round sleepy owl guest: one round chubby body in warm brown (#a0705a) with a big pale cream face disc (#f4e6cf) and belly, two small ear tufts, two big round sleepy half-closed eyes (simple, not googly), a tiny yellow beak (#f3d36a), ' +
  'two small folded wings like arms and two tiny yellow feet. It wears a tiny soft blue nightcap (#8ec8ee) with a small pompom, tilted to one side.';
const RACCOON =
  'A small chubby raccoon guest: a round soft grey body (#a8a29a) with a pale cream belly, a round head with two small round ears, a simple dark grey mask band (#5f5a55) across its eyes with two dot eyes inside it, a tiny dark nose, ' +
  'a big fluffy tail with three plain darker grey rings, short stubby arms and legs. It holds a small shiny round pebble it found, very proudly. No leaf on its head, no apron.';
const OCTOPUS =
  'A small chubby octopus guest walking on land: a round dome head-body in soft coral orange (#ef9a7a), two dot eyes and a small round "o" mouth, four short rounded stubby tentacles as legs and two as little arms, ' +
  'and a tiny soft blue beret (#7fa8d6) on top of its head. No suckers drawn.';
const JELLYFISH =
  'A small floating jellyfish guest: a soft round bell-shaped dome in soft peach (#f6c7a8) with a slightly lighter rim, two dot eyes and a tiny smile on the front of the dome, and four short wavy soft tentacles hanging below in a lighter peach (#f8dcc8). ' +
  'Solid flat colors (NOT see-through, no glow). It floats just above the ground: the tips of its tentacles are its lowest point.';
const SPROUT =
  'A small sprout spirit guest: a round chubby body in soft yellow-green (#c3dc8a) like a seed that just woke up, two big rounded leaves growing from the top of its head with one small soft pink flower (#f2b5a8) between them, ' +
  'two dot eyes and a tiny smile, two tiny stubby arms and two tiny round feet. Fresh, shy and gentle.';

const OTTER =
  'A small chubby river otter guest standing upright on two short legs: a round soft warm brown body (#a0785a) with a pale cream face and belly (#f4e6cf), two small round ears, two dot eyes, a tiny dark nose and a small happy smile, ' +
  'short stubby arms hugging one round flat clam shell (#cfc8c0) to its chest, and a short thick rounded tail. Playful and proud of its shell.';
const CACTUS =
  'A small chubby soft cactus guest: a round squishy cactus body in soft green (#8fbf7a) with a few rounded bumps instead of spines (NO spines, NO needles, NOTHING sharp), ' +
  'one small soft pink flower (#f2b5a8) on top of its head, two dot eyes and a shy little smile, two short rounded cactus-arm nubs, and it stands in a small terracotta pot (#c9824a) with two tiny round feet poking out under the pot.';

const GUEST_LEAD = '@monsters/dragon_base';
const MONSTERS2: readonly Entry[] = [
  ...species('mole', '두더지 광부', GUEST_LEAD, MOLE),
  ...species('turtle', '연못 거북', GUEST_LEAD, TURTLE),
  ...species('cloud', '뭉게 정령', GUEST_LEAD, CLOUD),
  ...species('moonrabbit', '달토끼', GUEST_LEAD, MOON_RABBIT),
  ...species('gumiho', '아기 구미호', GUEST_LEAD, GUMIHO),
  ...species('haetae', '꼬마 해태', GUEST_LEAD, HAETAE),
  ...species('pudding', '푸딩 몬스터', GUEST_LEAD, PUDDING),
  ...species('sheep', '솜뭉치 양', GUEST_LEAD, SHEEP),
  ...species('ssukddeok', '쑥떡 요정', GUEST_LEAD, MUGWORT_MOCHI),
  ...species('kabocha', '단호박 꼬마', GUEST_LEAD, KABOCHA),
  ...species('radish', '무 꼬마', GUEST_LEAD, RADISH),
  ...species('golem', '조약돌 골렘', GUEST_LEAD, GOLEM),
  ...species('whale', '구름고래', GUEST_LEAD, WHALE),
  ...species('owl', '졸린 부엉이', GUEST_LEAD, OWL),
  ...species('raccoon', '꼬마 너구리', GUEST_LEAD, RACCOON),
  ...species('octopus', '꼬마 문어', GUEST_LEAD, OCTOPUS),
  ...species('jellyfish', '꼬마 해파리', GUEST_LEAD, JELLYFISH),
  ...species('sprout', '새싹 정령', GUEST_LEAD, SPROUT),
  ...species('otter', '꼬마 수달', GUEST_LEAD, OTTER),
  ...species('cactus', '말랑 선인장', GUEST_LEAD, CACTUS),
];

const PLUSH2: readonly Entry[] = [
  plush('mole', '두더지 광부'), plush('turtle', '연못 거북'), plush('cloud', '뭉게 정령'), plush('otter', '꼬마 수달'),
  plush('moonrabbit', '달토끼'), plush('gumiho', '아기 구미호'), plush('haetae', '꼬마 해태'), plush('pudding', '푸딩 몬스터'),
  plush('sheep', '솜뭉치 양'), plush('ssukddeok', '쑥떡 요정'), plush('cactus', '말랑 선인장'), plush('kabocha', '단호박 꼬마'),
  plush('radish', '무 꼬마'), plush('golem', '조약돌 골렘'), plush('whale', '구름고래'), plush('owl', '졸린 부엉이'),
  plush('raccoon', '꼬마 너구리'), plush('octopus', '꼬마 문어'), plush('jellyfish', '꼬마 해파리'), plush('sprout', '새싹 정령'),
];

/** 새 손님의 특산 재료 (종마다 하나). */
const MATERIALS2: readonly Entry[] = [
  itemIcon('mat_ore', '광석 조각 (두더지 광부)', ITEM('One small chunky lump of grey ore (#9a948d) with two small flat soft yellow specks (#f3d36a), a simple rounded rock shape.')),
  itemIcon('mat_lotus', '연잎 (연못 거북)', ITEM('One round flat lily pad leaf in moss green (#8fae6b) with one small notch and one simple vein line, with one tiny drop of water on it.')),
  itemIcon('mat_cloudpuff', '구름 조각 (뭉게 정령)', ITEM('One small puffy round piece of cloud in pale mint (#cfeadb) made of three round bumps, solid flat color, no glow.')),
  itemIcon('mat_ricecake', '달떡 (달토끼)', ITEM('One small round white rice cake (#f7f3ea) with a tiny yellow crescent moon mark (#f3d36a) pressed on top.')),
  itemIcon('mat_foxbead', '여우 구슬 (아기 구미호)', ITEM('One small round pale blue bead (#bfe0f5), smooth and flat-colored, no glow, no highlight dot.')),
  itemIcon('mat_bell', '해태 방울 (꼬마 해태)', ITEM('One small round brass bell (#d9a441) with a short red cord (#c9614a) tied on top.')),
  itemIcon('mat_caramel', '캐러멜 (푸딩 몬스터)', ITEM('One small square soft caramel candy in golden brown (#c98a4a), slightly rounded corners.')),
  itemIcon('mat_wool', '양털 뭉치 (솜뭉치 양)', ITEM('One round fluffy ball of cream wool (#f6efe2) made of a few round bumps, with one loose curl of yarn.')),
  itemIcon('mat_mugwort', '쑥 (쑥떡 요정)', ITEM('One small sprig of mugwort: three soft sage-green (#a9c48a) jagged-rounded leaves on a short stem.')),
  itemIcon('mat_squash', '단호박 조각 (단호박 꼬마)', ITEM('One chunky wedge slice of kabocha squash: deep green skin (#5f7f55) on the outside and bright soft orange flesh (#f2b279) inside.')),
  itemIcon('mat_radishgreen', '무청 (무 꼬마)', ITEM('One small bunch of three big rounded radish leaves in green (#8fae6b) tied with a thin white band.')),
  itemIcon('mat_moss', '이끼돌 (조약돌 골렘)', ITEM('One small round grey pebble (#b3aea8) with a flat patch of green moss (#8fae6b) on top.')),
  itemIcon('mat_pearl', '진주 (구름고래)', ITEM('One round cream-white pearl (#f4efe3) in a small open blue-grey shell (#9db8cc), no shine.')),
  itemIcon('mat_feather', '깃털 (졸린 부엉이)', ITEM('One soft rounded brown feather (#a0705a) with a cream tip and one simple center line, lying diagonally.')),
  itemIcon('mat_pebble', '반짝 조약돌 (꼬마 너구리)', ITEM('One small smooth round pebble in pale lavender-grey (#c4bccf) with one tiny four-point sparkle star (#f3d36a) beside it.')),
  itemIcon('mat_ink', '먹물 병 (꼬마 문어)', ITEM('One small round glass ink bottle with a cork, filled with flat dark blue-grey ink (#4f5868), no reflections.')),
  itemIcon('mat_jelly', '젤리 방울 (꼬마 해파리)', ITEM('One small round wobbly jelly drop in soft peach (#f6c7a8), solid flat color, no shine.')),
  itemIcon('mat_dew', '이슬 방울 (새싹 정령)', ITEM('One plump round dewdrop in pale sky blue (#cfe8f7) sitting on a small green leaf (#8fae6b).')),
  itemIcon('mat_seaweed', '물풀 (꼬마 수달)', ITEM('One small wavy strand of river weed in soft green (#7fae7a) with three rounded wavy leaves.')),
  itemIcon('mat_cactusflower', '선인장 꽃 (말랑 선인장)', ITEM('One small soft pink cactus flower (#f2b5a8) with five rounded petals and a soft yellow center (#f3d36a).')),
];

// ── 단체 놀이 셋째 묶음 (2026-10-15): 씨름장, 줄다리기, 보물찾기 마당, 오리배 경주, 연날리기 대회 ─────
// 지도에서 봐도 재미있게: 손님이 직접 겨루거나(씨름·줄다리기·보물찾기) 탈것·연이 지도 위를 움직인다. 바닥·밧줄·연줄은 코드로 그린다.

const GROUP_MAP: readonly Entry[] = [
  building(
    'ssireum_ring',
    '밀어내기 대결장',
    'A round outdoor sand ring for a friendly pushing contest (two players try to push each other out): a flat round sandy circle (#ebc68e) bordered all around by a ring of plump straw-rope sandbags (#d9b27a), ' +
      'four short wooden corner posts with small cloth banners (two soft red #c9614a, two soft blue #7fa8d6), and one low wooden bench for spectators on the side. The sand circle is EMPTY (no people).',
  ),
  building(
    'tug_stand',
    '줄다리기 심판대',
    'A small wooden referee platform for a tug-of-war field: a low square wooden deck (#a0703f) with two steps, a short railing, and one round striped parasol in cream (#f6ebd5) and soft orange (#f2b279) on top. EMPTY (no people).',
  ),
  prop('tug_flag_red', '줄다리기 홍팀 깃발', 'A team flag on a wooden pole stuck in the ground: one plain soft red (#c9614a) triangle flag with one simple round white dot (no letters).'),
  prop('tug_flag_blue', '줄다리기 청팀 깃발', 'A team flag on a wooden pole stuck in the ground: one plain soft blue (#7fa8d6) triangle flag with one simple round white dot (no letters).'),
  prop('dig_sign', '보물찾기 표지판', 'A wooden signpost for a treasure digging field: one board showing a simple picture of a small shovel and a big X mark (picture symbols only, no letters).'),
  prop('dirt_mound', '흙 둔덕', 'One small round mound of freshly dug soft brown dirt (#a0785a) with a few small pebbles, low and wide.'),
  prop('treasure_chest', '보물상자 (닫힘)', 'One small chunky treasure chest, closed: warm wood brown (#b07a4f) with two plain golden-yellow bands (#f3d36a) and a small round golden lock plate. No face.'),
  prop('treasure_chest_open', '보물상자 (열림)', 'One small chunky treasure chest with its lid wide open, full of round gold coins (#f3d36a) and one small sky-blue gem (#8ec8ee) on top: warm wood brown (#b07a4f) with two plain golden-yellow bands. No face, no glow.'),
  building(
    'boat_dock',
    '오리배 선착장',
    'A small wooden boat dock at the edge of a pond: a short wooden pier (#a0703f) on round posts sticking out over flat blue water (#8ec8ee, only a small patch of water under the pier), ' +
      'a little striped canopy in cream and soft sky blue (#8ec8ee) over a bench at the land end, and one round life ring (soft red and white) hanging on a post. No boats, no people.',
  ),
];

/** 오리배 경주의 배 넷 (옆에서 본 모습, 왼쪽으로 간다). 배마다 깃발 색이 다르다. */
const BOAT_COMMON =
  `Draw ONE cute little paddle boat for a pond boat race in ${GAME}, seen from the SIDE, moving toward the LEFT edge of the image, floating on a few short flat blue water wave lines (#8ec8ee) at its bottom. ` +
  'The boat itself has a cute simple face (two dot eyes and a tiny smile) on its front, round chunky shapes, a few flat color blocks, and one small plain flag on a short pole in the color described below (no numbers, no letters). ' +
  'Draw it fairly SMALL in the canvas (in the middle half of the canvas) with the same VERY fat, bold dark brown marker outline as the dwarf. No people in it. Transparent background with a real alpha channel: no sky, no shore, no shadow.';
const boat = (key: string, label: string, look: string): Entry => ({
  key,
  size: '1024x1024',
  transparent: true,
  max: 256,
  label,
  refs: ['d_dwarf_idle'],
  ownStyle: true,
  prompt: para(STYLE, STYLE_REF_ONLY, BOAT_COMMON, look),
});
const BOATS: readonly Entry[] = [
  boat('boat_duck', '오리배: 노랑 오리', 'A plump yellow rubber-duck shaped boat (#f3d36a) with an orange beak (#f2a65a) at the front. Flag: soft red (#c9614a).'),
  boat('boat_swan', '오리배: 하얀 백조', 'A plump white swan shaped boat (#f7f3ea) with a short curved neck and a small orange beak at the front. Flag: soft blue (#7fa8d6).'),
  boat('boat_frog', '오리배: 초록 개구리', 'A plump round green frog shaped boat (#9cbf7a) with two round eye bumps on top at the front. Flag: soft yellow (#f3d36a).'),
  boat('boat_whale', '오리배: 파란 고래', 'A plump round blue-grey whale shaped boat (#9db8cc) with a tiny tail fin at the back and a little water spout. Flag: mint (#bfe6d2).'),
];

/** 연날리기 대회의 연 넷 (정면, 하늘에 뜬다). 연줄은 코드로 그린다. 사용자 의견으로 방패연이 아닌 흔한 마름모 연. */
const KITE_COMMON =
  'A classic simple diamond-shaped kite seen straight from the front: a plump diamond of flat paper in the color described below with a cream (#f6ebd5) cross stripe, two thin wooden sticks drawn as a simple cross, ' +
  'and one long wavy tail hanging from the bottom corner with three small cream bow ties along it. No string (it is drawn by the game), no letters, no symbols, no face. ' +
  'Draw it filling about half of the canvas, centered, with the same VERY fat, bold dark brown marker outline as the dwarf. Transparent background with a real alpha channel: no sky, no clouds.';
const kite = (key: string, label: string, color: string): Entry => ({
  key,
  size: '1024x1024',
  transparent: true,
  max: 256,
  label,
  refs: ['d_dwarf_idle'],
  ownStyle: true,
  prompt: para(STYLE, STYLE_REF_ONLY, KITE_COMMON, `Color: ${color}.`),
});
const KITES: readonly Entry[] = [
  kite('kite_red', '연: 빨강', 'soft red (#c9614a)'),
  kite('kite_blue', '연: 파랑', 'soft blue (#7fa8d6)'),
  kite('kite_yellow', '연: 노랑', 'soft yellow (#f3d36a)'),
  kite('kite_green', '연: 초록', 'soft leaf green (#8fae6b)'),
];

const GROUP_ITEMS: readonly Entry[] = [
  itemIcon('old_boot', '헌 장화 (꽝)', ITEM('One old worn rubber boot in faded brown (#8a6a50) with a small patch on its side and a tiny green weed sticking out of the top. Funny and harmless.')),
  itemIcon('shovel', '삽', ITEM('One small toy garden shovel lying diagonally: a short wooden handle (#a0703f) with a round grip and a rounded grey blade (#b3aea8).')),
];

const GROUP_CLOSEUP: readonly Entry[] = [
  closeupBg(
    'bg_ssireum',
    '씨름장 확대 배경',
    'This place: an outdoor Korean ssireum wrestling ring seen from the side. A plain flat pale sky (#d6eaf5) in the top part with one simple cloud, a row of plump straw-rope sandbags (#d9b27a) across the middle as the ring edge, ' +
      'two short wooden posts at the far left and far right with small banners (soft red on the left, soft blue on the right), and a wide flat sandy floor (#ebc68e) across the bottom third with one simple edge line.',
  ),
  closeupBg(
    'bg_tug',
    '줄다리기 확대 배경',
    'This place: a tug-of-war field seen from the side. A plain flat pale sky (#d6eaf5) in the top part with two simple clouds, a soft green grassy field (#9cc27a) across the bottom half with one short straight white center line drawn on the ground in the middle, ' +
      'a small red team flag (#c9614a) on a pole at the far left and a small blue team flag (#7fa8d6) on a pole at the far right.',
  ),
  closeupBg(
    'bg_dig',
    '보물찾기 확대 배경',
    'This place: a treasure digging field seen from the side. A plain flat pale sky (#d6eaf5) in the top part with one simple cloud, a low wooden fence (#a0703f) across the middle, ' +
      'and a wide flat soft brown dirt field (#c9a07a) across the bottom half with three small round dirt mounds and a few tiny pebbles.',
  ),
  closeupBg(
    'bg_boat',
    '오리배 경주 확대 배경',
    'This place: a calm pond seen from the side for a little boat race. A plain flat pale sky (#d6eaf5) in the top part with two simple clouds, a soft green far shore strip (#9cc27a) with two small round bushes across the middle, ' +
      'and wide flat blue water (#8ec8ee) across the bottom half with a few short simple wave lines. A short wooden dock edge pokes in from the bottom right corner.',
  ),
  closeupBg(
    'bg_kite',
    '연날리기 확대 배경',
    'This place: a breezy grassy hill top for flying kites. A big plain flat pale sky (#d6eaf5) filling the upper two thirds with two or three simple round clouds, and a gentle soft green hill (#9cc27a) across the bottom third with a few tiny grass tufts. Wide open empty sky.',
  ),
];

const GROUP_STAFF: readonly Entry[] = [
  villager('ssireum_referee', '밀어내기 대결 심판', 'the referee of the push-out arena (a friendly sand-ring pushing contest): a sturdy, kind middle-aged man with a short round black hair blob, a soft grey shirt (#cfc8c0) with a black bow tie, brown trousers, a whistle on a cord, holding one small round red flag and one small round blue flag. A serious but friendly face.'),
  villager('ssireum_caster', '밀어내기 대결 해설자', 'the commentator of the push-out arena: a cheerful round grandma with a short curly grey hair blob, a soft mint cardigan (#bfe6d2), holding a small round microphone on a short stand-less handle. Mouth open, cheering.'),
  villager('tug_referee', '줄다리기 심판', 'the referee of the tug-of-war field: a tall skinny young man with neat brown hair, a plain cream shirt with a soft orange vest (#f2b279), a whistle in his mouth, one arm raised straight up. Eyes wide, very focused.'),
  villager('tug_cheer', '줄다리기 응원단장', 'the cheer leader of the tug-of-war field: an energetic little girl with a short bob of dark hair, a soft red headband (#c9614a), a cream shirt and short brown skirt, holding two round fluffy pompoms (one red, one blue) up high. A huge cheering smile.'),
  villager('dig_grandpa', '보물 지도 할아버지', 'the keeper of the treasure digging field: a cheerful old grandpa with a round white beard blob and a brown flat cap, a moss-green vest (#8fae6b), holding a rolled-up old paper treasure map in one hand. A mysterious little smile.'),
  villager('dig_lender', '삽 대여 언니', 'the shovel lender of the treasure digging field: a sturdy cheerful young woman with a short brown ponytail, a soft orange bandana (#f2b279), brown work overalls, holding two small toy shovels crossed. A confident grin.'),
  villager('boat_starter', '오리배 출발 신호', 'the starter of the pond boat race: a small cheerful boy in a round white sailor cap with a soft blue ribbon (#7fa8d6), a cream sailor shirt with a blue collar, short brown trousers, holding a small plain soft blue flag. An excited open smile.'),
  villager('boat_lifeguard', '오리배 구조 요원', 'the lifeguard of the pond boat race: a calm tall young person with short sandy hair, a soft red shirt (#c9614a), cream shorts, holding a round red-and-white life ring under one arm. A calm reassuring smile.'),
  villager('kite_master', '연 장인', 'the kite master of the kite contest: a gentle old grandma with a neat grey bun, a long soft blue jacket (#7fa8d6) over a cream skirt, holding a round wooden kite reel (eolle) with string wound on it. A wise, warm smile.'),
  villager('kite_wind', '바람지기', 'the wind watcher of the kite contest: a small dreamy child with fluffy light brown hair, a soft yellow raincoat (#f3d36a), holding up a little colorful pinwheel on a stick. Looking up at the sky with a tiny smile.'),
];

// ── 넷째 묶음 (2026-10-18): 장신구·전당포·은행·파산·일터 ───────────────────────────
// 손님이 몸에 달고 오는 장신구 (머리·목·옆구리에 코드로 붙인다: 작게 보이니 아이템 아이콘 세트처럼 굵게).
// 돈이 떨어지면 전당포에 장신구를 맡기고, 그래도 모자라면 은행 대출, 못 갚으면 파산해서 일터(밭·광산)에서 일한다.
// 고블린에게는 돈주머니를 달지 않는다 (고블린+돈 = 비하 고정관념, Codex 안전 검사에도 걸렸다).

const ACCESSORIES: readonly Entry[] = [
  itemIcon('acc_flower_crown', '장신구: 꽃관 (머리)', ITEM('One small round flower crown: a ring of green leaves (#8fae6b) with four small round flowers (soft pink #f2b5a8, cream, soft yellow #f3d36a, soft orange #f2b279), seen a little from the front.')),
  itemIcon('acc_ribbon', '장신구: 리본 (머리)', ITEM('One plump ribbon bow in soft red (#c9614a) with two short rounded tails, seen from the front.')),
  itemIcon('acc_tophat', '장신구: 작은 실크햇 (머리)', ITEM('One tiny chunky top hat in soft charcoal (#5f5a55, clearly lighter than the outline) with a soft red band (#c9614a) and a short brim, seen from the front.')),
  itemIcon('acc_straw_hat', '장신구: 밀짚모자 (머리)', ITEM('One small round straw hat (#e2c27a) with a wide brim and a soft blue band (#7fa8d6), seen a little from the front.')),
  itemIcon('acc_star_pin', '장신구: 별 머리핀 (머리)', ITEM('One small chunky hair clip with a plump five-pointed star in soft yellow (#f3d36a) on it, seen from the front.')),
  itemIcon('acc_mini_crown', '장신구: 작은 왕관 (머리, 귀함)', ITEM('One tiny chunky golden crown (#f3d36a) with three rounded points, each tipped with a small round sky-blue gem (#8ec8ee). No shine.')),
  itemIcon('acc_scarf', '장신구: 목도리 (목)', ITEM('One short cozy knitted-looking scarf in soft mint (#bfe6d2) loosely tied in a loop with two short hanging ends, drawn as flat simple shapes (no knit texture).')),
  itemIcon('acc_pearl_necklace', '장신구: 진주 목걸이 (목, 귀함)', ITEM('One short necklace of seven round cream-white pearls (#f4efe3) on a thin string, curved in a U shape, seen from the front. No shine.')),
  itemIcon('acc_bell_collar', '장신구: 방울 목걸이 (목)', ITEM('One small soft red collar band (#c9614a) curved in a U shape with one round golden bell (#d9a441) hanging in the middle.')),
  itemIcon('acc_coin_pouch', '장신구: 돈주머니 (옆구리)', ITEM('One small round cloth coin pouch in warm brown (#a0785a) tied at the top with a cord, two round gold coins (#f3d36a) peeking out of the opening.')),
];

const DEBT_MAP: readonly Entry[] = [
  building(
    'pawnshop',
    '전당포',
    'The village pawnshop: a narrow cozy two-story shop with soft lavender-grey walls (#b9b0c8), a dark plum roof (#7a5f78), a round-topped door, and one big front display window with a few small treasures inside (a tiny crown, a ribbon, a hat) on little shelves. ' +
      'Signs carry only a simple picture symbol of three small round balls hanging from a bar.',
  ),
  building(
    'bank',
    '은행',
    'The village bank: a small sturdy cream stone building (#e8dfcc) with two short round columns at the front, a low triangular roof in soft blue-grey (#8b9bb0), a heavy round-topped wooden door, and two small barred windows. ' +
      'Signs carry only a simple picture symbol of a round gold coin.',
  ),
  building(
    'farm_plot',
    '일터: 밭',
    'A small fenced vegetable field for the village work yard: a rectangle of tilled soft brown soil (#a0785a) in four simple rows with small green sprouts and a few round cabbages, a low simple wooden fence on two sides, ' +
      'and a small wooden tool rack with a hoe and a watering can at one corner. Seen in the 3/4 top-down view. No people.',
  ),
  building(
    'mine_entrance',
    '일터: 광산',
    'A small mine entrance for the village work yard: a low rounded rocky hill in soft grey (#b3aea8) with a dark tunnel opening framed by chunky wooden beams (#a0703f), a short rail track coming out of it, ' +
      'and a lantern hanging by the entrance drawn as a flat warm yellow square (no glow). No people.',
  ),
  prop('ore_cart', '광석 수레', 'A small mine cart on a short piece of rail, full of round grey ore lumps (#9a948d) with two small soft yellow specks.'),
  prop('crop_basket', '채소 바구니', 'A round woven basket (#c9995f) full of fresh vegetables: two round cabbages, a few carrots with green tops and one potato.'),
];

const DEBT_ITEMS: readonly Entry[] = [
  itemIcon('hoe', '괭이 (노동 도구)', ITEM('One small chunky garden hoe lying diagonally: a short wooden handle (#a0703f) with a flat rounded grey blade (#b3aea8) at a right angle at the end.')),
  itemIcon('pickaxe', '곡괭이 (노동 도구)', ITEM('One small chunky pickaxe lying diagonally: a short wooden handle (#a0703f) with a curved grey head (#b3aea8) with two blunt rounded ends.')),
  itemIcon('mat_veggie', '채소 (일터 밭)', ITEM('A small bunch of fresh vegetables: one round green cabbage (#9cbf7a) and two orange carrots (#f2a65a) with green tops.')),
];

const DEBT_STAFF: readonly Entry[] = [
  villager(
    'pawnbroker',
    '전당포 주인',
    'the village pawnbroker: a gentle, slightly sleepy old man with a round bald head and a small round white mustache, a jeweler loupe on a cord around his neck, a soft plum vest (#7a5f78) over a cream shirt. He holds a small ribbon up to look at it closely. A kind, curious smile.',
    {
      note: '둘째 판 (후보 둘 중 A: 얼굴이 가장 단순하고 동글하다. B는 pawnbroker.try1.png). 첫 판(pawnbroker.rejected1.png)은 사용자 지적: 그림체가 다르다 (외곽선이 옅은 갈색으로 흐리고, 주름·귀 옆 머리털 같은 잔디테일, 살짝 칠한 느낌).',
      extra:
        'IMPORTANT style: use the SAME very thick, bold, DARK brown (almost black-brown) outline as the second image on every shape, a clean solid line, NOT a faded or light brown line. ' +
        'Flat colors only, no soft shading, no painterly texture. Keep the face as simple as the second image: two dot eyes, a tiny mouth, one small round mustache blob; NO wrinkles, NO cheek or forehead lines, NO ear hair tufts, NO extra hair strands.',
    },
  ),
  villager('banker', '은행원', 'the village banker: a neat young woman with a short tidy dark bob, round glasses, a soft blue-grey jacket (#8b9bb0) over a cream blouse, holding a thick plain ledger book under one arm and a small round coin in the other hand. A polite, calm smile.'),
  villager(
    'foreman',
    '일터 반장',
    'the foreman of the village work yard: a sturdy, kind middle-aged woman with a short round brown hair blob under a yellow hard hat (#f3d36a), a moss-green work apron (#8fae6b), rolled sleeves, a whistle on a cord, holding a small clipboard. A strict but warm smile.',
    {
      note: '둘째 판 (후보 둘 중 A: 선 21px, 매끈한 덩어리 머리. B는 foreman.try1.png). 첫 판(foreman.rejected1.png)은 사용자 지적: 그림체가 다르다 (곱슬머리가 잔 가닥·질감으로 그려지고 얼굴 디테일이 많다).',
      extra:
        'IMPORTANT style: use the SAME very thick, bold, dark brown outline as the second image on every shape. The hair is ONE or two big simple smooth blob shapes like the second image, with at most two inner lines: NO curls drawn as strands, NO hair texture. ' +
        'Keep the face as simple as the second image: two dot eyes and a tiny mouth (at most two tiny round blush dots); no eyebrow lines, no extra face lines. Flat colors only, no shading.',
    },
  ),
];

// ── 다섯째 묶음 (2026-10-18): 손님이 돈을 쓰는 가게들 (DESIGN 3.8) ─────────────────────
// 가게 건물은 대장간 세트(building), 회전목마·관람차는 움직이는 부품을 따로 그려 코드로 돌린다.

/** 정면으로 보는 지도 물건 (관람차 받침·사진 배경판): 마을 입구 아치와 같은 시점. */
const mapFront = (key: string, label: string, body: string): Entry => ({
  ...building(key, label, body),
  prompt: para(
    STYLE_REF_ONLY,
    'The second attached image is the forge building from the same village map set. Match it exactly: the same thick dark brown outline weight, the same flat fills and palette, the same small amount of detail, and the same scale (a door of the same size, so the buildings line up on one map). Do NOT redraw the forge; draw only the new object described below.',
    VIEW_FRONT,
    `${body} Transparent background with a real alpha channel. The object is centered with a comfortable empty margin on every side; nothing is cut off at the edges. Signs carry only simple picture symbols, never letters or numbers.`,
  ),
});

const SHOPS: readonly Entry[] = [
  building('snack_stall', '간식 노점', 'A small open-front wooden snack stall (#a0703f) with a striped awning in cream (#f6ebd5) and soft pink-orange (#f2a68a), a counter with a big fluffy pink cotton candy on a stick, a few skewers in a cup and a stack of waffles. Signs carry only a simple cotton candy picture symbol.'),
  building('drink_stand', '음료 가판', 'A small round drink kiosk with a striped round canopy in cream (#f6ebd5) and soft lemon yellow (#f3d36a), a counter with a big glass jar of lemonade with lemon slices and a few cups. Signs carry only a simple lemon picture symbol.'),
  building('bakery', '빵집', 'A cozy small bakery with cream plaster walls (#f6ebd5) and a warm brown roof (#a0703f), a big front window showing round breads and croissants on shelves, a striped awning in cream and soft orange (#f2b279), and a small bread basket by the door. Signs carry only a simple croissant picture symbol.'),
  building('restaurant', '식당', 'A cozy village restaurant: a one-story cottage with soft green walls (#c9dcae), a red-brown tiled roof (#b5654a), a round-topped door, warm windows with little curtains, a short chimney with one round steam puff, and a flower box. Signs carry only a simple fork-and-spoon picture symbol.'),
  building('accessory_shop', '장신구 가게', 'A small cute boutique with soft lavender walls (#d8cbea), a dark plum roof (#7a5f78), a big round display window showing a few ribbons, a tiny crown and a flower crown on stands, and a striped awning in cream and lavender. Signs carry only a simple ribbon picture symbol.'),
  building('beauty_salon', '미용실', 'A small beauty salon with soft mint walls (#cfeadb), a white-and-mint striped awning, a big window with a round mirror and a fluffy chair inside, and a little striped pole by the door. Signs carry only a simple comb-and-scissors picture symbol.'),
  building('inn', '여관', 'A cozy two-story village inn with cream walls (#f6ebd5), warm brown timber frames (#8a5a3a), a soft blue roof (#5d6f86), several small windows, a wooden bench by the door and a hanging lantern drawn as a flat warm yellow square (no glow). Signs carry only a simple crescent moon picture symbol.'),
  building('hot_spring', '온천', 'A small open-air hot spring: a round pool of flat pale blue water (#bfe0f5) surrounded by big rounded soft grey stones (#b3aea8), a small wooden changing hut with a short cloth curtain beside it, and three round cream steam puffs rising from the water. No people. Signs carry only a simple steam-cloud picture symbol.'),
  building('fortune_teller', '점집', 'A small fortune teller tent in soft deep purple (#8a6aa8) and cream stripes with a pointed top and a little star flag, front flaps tied open showing a tiny round table with a crystal ball drawn as a flat pale blue circle (no glow, no shine). Signs carry only a simple star picture symbol.'),
  building('photo_studio', '사진관', 'A small photo studio with soft sky-blue walls (#cfe3ee), a flat roof with a short railing, a big front window, and an old box camera on a tripod by the door. Signs carry only a simple camera picture symbol.'),
  building('souvenir_shop', '기념품 가게', 'A small souvenir shop with soft yellow walls (#f6e3a8), a brown roof (#a0703f), a front window full of small plush toys, and a little rack of postcards (blank, no pictures, no writing) by the door. Signs carry only a simple gift-box picture symbol.'),
  building('flower_shop', '꽃집', 'A small flower shop with cream walls (#f6ebd5), a soft green roof (#8fae6b), and many buckets of colorful round flowers (pink, yellow, orange, white) on wooden steps in front. Signs carry only a simple flower picture symbol.'),
];

/** 회전목마·관람차: 받침과 도는 부품을 따로 (코드가 돌린다). */
const RIDES: readonly Entry[] = [
  building('carousel_base', '회전목마 (받침·지붕)', 'A small cute carousel WITHOUT any horses: a round wooden platform (#a0703f) with a golden center pole (#f3d36a), a round striped canopy roof in cream (#f6ebd5) and soft red (#c9614a) with a little flag on top, and eight thin golden poles hanging down from the canopy edge with NOTHING on them. No animals, no people.'),
  { ...boat('carousel_horse', '회전목마: 목마', 'A cute chubby carousel pony (cream body #f6ebd5, soft pink mane, a little saddle) pierced by a thin golden pole going straight up and down through its back.'),
    prompt: para(STYLE, STYLE_REF_ONLY, 'Draw ONE cute chubby carousel pony seen from the SIDE, facing the LEFT edge of the image, with a thin golden pole (#f3d36a) going straight up and down through its back: a round cream body (#f6ebd5), a soft pink mane and tail (#f2b5a8), a little soft red saddle (#c9614a), legs tucked as if galloping, two dot eyes, a tiny smile. Draw it fairly SMALL in the canvas (in the middle half) with the same VERY fat, bold dark brown marker outline as the dwarf. Transparent background with a real alpha channel: no ground, no shadow.') },
  mapFront('ferris_frame', '관람차 (받침)', 'The support frame of a small Ferris wheel seen straight from the front: two tall slanted wooden legs (#a0703f) on each side meeting at a round wooden hub high up, a small ticket booth hut at the base. NO wheel, NO gondolas (they are drawn separately).'),
  { ...building('ferris_wheel', '관람차 (바퀴)', ''),
    refs: ['d_dwarf_idle'],
    ownStyle: true,
    prompt: para(STYLE, STYLE_REF_ONLY, 'ONLY the wheel of a small Ferris wheel seen perfectly straight from the front: a perfect circle rim in soft red (#c9614a) with eight straight spokes to a round center hub, a small round knob at the end of each spoke where a cabin would hang. NO cabins, NO legs, NO stand. Thick dark brown outlines, flat colors, no shading. Centered, filling about 80% of the canvas. Transparent background with a real alpha channel.') },
  { ...boat('ferris_gondola', '관람차: 곤돌라', ''),
    prompt: para(STYLE, STYLE_REF_ONLY, 'ONE small cute Ferris wheel cabin seen straight from the front: a rounded box cabin in soft sky blue (#8ec8ee) with a round cream roof (#f6ebd5), a big open window (empty, no people), and a short hook on top. Draw it fairly SMALL in the canvas (filling about half) with the same VERY fat, bold dark brown marker outline as the dwarf. Transparent background with a real alpha channel.') },
  { ...boat('icecream_truck', '아이스크림 트럭', ''),
    prompt: para(STYLE, STYLE_REF_ONLY, 'Draw ONE cute small ice cream truck seen from the SIDE, driving toward the LEFT edge of the image: a chubby rounded van in soft pink-cream (#f6d8cc) and mint (#bfe6d2) with a big serving window on its side, a giant ice cream cone ornament on the roof, round wheels, a small cute face on the front (two dot eyes, a tiny smile). Draw it fairly SMALL in the canvas (in the middle half) with the same VERY fat, bold dark brown marker outline as the dwarf. No driver visible, no text. Transparent background with a real alpha channel: no road, no shadow.') },
];

const SHOP_PROPS: readonly Entry[] = [
  prop('table_set', '식당 바깥 테이블', 'A small round wooden outdoor table (#a0703f) with a cream tablecloth and two round wooden stools on each side, seen a little from above. Nothing on the table.'),
  mapFront('photo_backdrop', '사진 배경판', 'A photo backdrop board on two wooden legs, seen straight from the front: a big rounded frame with a soft sky-blue painted background (#d6eaf5), a few painted round flowers and a small rainbow arc along its top edge (no letters).'),
];

const SHOP_ITEMS: readonly Entry[] = [
  itemIcon('food_cotton_candy', '솜사탕', ITEM('One big fluffy pink cotton candy (#f6c4cc) on a short wooden stick, made of a few round bumps.')),
  itemIcon('food_skewer', '꼬치', ITEM('One short wooden skewer with three round grilled bites (warm brown #c98a4a) and one small green pepper piece.')),
  itemIcon('food_waffle', '와플', ITEM('One square waffle (#e6b56a) with a simple grid of square dents and a small dollop of cream on top.')),
  itemIcon('food_lemonade', '레모네이드', ITEM('One tall glass of pale yellow lemonade (#f6e7a0) with a lemon slice on the rim and a striped straw, no reflections.')),
  itemIcon('food_cocoa', '코코아', ITEM('One round cream mug of hot cocoa (#8a5a3a) with two small marshmallows on top and one round steam puff.')),
  itemIcon('food_croissant', '크루아상', ITEM('One plump golden croissant (#e6b56a) with three simple curved segment lines.')),
  itemIcon('food_cream_bun', '크림빵', ITEM('One round soft bun (#e6b56a) split open with white cream inside.')),
  itemIcon('food_pasta', '파스타', ITEM('One round plate of tomato pasta: a soft swirl of noodles (#f3d58a) with red sauce (#c9614a) and one green leaf.')),
  itemIcon('food_stew', '스튜', ITEM('One round bowl of warm stew (#c98a4a) with a carrot slice and a potato chunk and one round steam puff.')),
  itemIcon('food_pancakes', '팬케이크', ITEM('A stack of three fluffy pancakes (#e6b56a) with a square pat of butter and a drip of syrup.')),
  itemIcon('food_icecream', '아이스크림', ITEM('One ice cream cone (#e6b56a) with two round scoops: strawberry pink (#f2b5a8) and mint (#bfe6d2).')),
  itemIcon('bouquet', '꽃다발', ITEM('One small bouquet of round flowers (pink, yellow, white) wrapped in cream paper tied with a soft red ribbon.')),
  itemIcon('photo', '사진', ITEM('One instant photo print: a cream frame (#f6ebd5) with a thicker bottom edge and a plain soft sky-blue empty picture area (nothing in the picture).')),
  itemIcon('fortune_slip', '점괘 종이', ITEM('One small rolled-open paper slip (#f6ebd5) with one simple star symbol on it (no letters).')),
];

const SHOP_FX: readonly Entry[] = [
  fx('emote_sleep', '이모트: 졸림', FX_LEAD, 'Emote icon for sleeping: one plump soft yellow crescent moon (#f3d36a) with two tiny four-point stars beside it.'),
  fx('emote_yum', '이모트: 냠냠', FX_LEAD, 'Emote icon for tasty food: one small fork and one small spoon crossed, in soft grey (#b3aea8), with a tiny heart above them.'),
];

/** 주민 그림이 결에서 벗어났을 때 끝에 더하는 문단 (외곽선이 옅거나 가늘고, 머리가 잔 가닥으로 그려진 판: 사용자가 두 번 지적). */
const VILLAGER_STYLE_FIX =
  'IMPORTANT style: use the SAME very thick, bold, dark brown outline as the second image on every shape (a clean solid line, not thin or faded). ' +
  'The hair is ONE or two big simple smooth blob shapes like the second image with at most two inner lines: NO curls drawn as strands, NO hair texture. ' +
  'Keep the face as simple as the second image: two dot eyes and a tiny mouth (at most two tiny round blush dots), no wrinkles, no extra face lines. Flat colors only.';

const SHOP_STAFF: readonly Entry[] = [
  villager('clerk_snack', '간식 노점 주인', 'the owner of the snack stall: a cheerful round young man with a short brown hair blob, a soft pink-orange apron (#f2a68a), holding a fluffy cotton candy on a stick. A big happy grin.'),
  villager('clerk_drink', '음료 가판 주인', 'the owner of the drink stand: a bright little girl with a short yellow bob, a lemon-yellow dress (#f3d36a) with a cream apron, holding a glass of lemonade. A sunny smile.'),
  villager('clerk_bakery', '빵집 주인', 'the village baker: a plump kind middle-aged man with a tall white baker hat, a cream apron with a little flour dust drawn as two tiny white dots, holding a tray with two round breads. A warm smile.'),
  villager('clerk_restaurant', '식당 주인', 'the restaurant cook: a sturdy cheerful woman with a short round dark hair blob under a white bandana, a soft green apron (#8fae6b), holding a wooden ladle. A proud smile.', {
    note: '둘째 판 (후보 둘 중 A: 선 20px, 매끈한 머리. B는 clerk_restaurant.try1.png). 첫 판(clerk_restaurant.rejected1.png)은 외곽선 17px로 다른 주민(19~21px)보다 가늘다 (전당포 주인·일터 반장 때 사용자 지적과 같은 문제).',
    extra: VILLAGER_STYLE_FIX,
  }),
  villager('clerk_icecream', '아이스크림 트럭 아저씨', 'the ice cream truck driver: a jolly round man with a small round mustache, a pink-and-cream striped cap, a mint shirt (#bfe6d2), holding an ice cream cone up. A big friendly grin.'),
  villager('clerk_accessory', '장신구 가게 주인', 'the accessory shop owner: a stylish young woman with a neat lavender-tinted bun (#c9b8e0), a long plum cardigan (#7a5f78), holding up a small ribbon. An elegant little smile.'),
  villager('clerk_salon', '미용사', 'the village hairdresser: a lively young man with a fluffy round mint-colored hair blob (#bfe6d2), a white shirt with a black vest, holding a comb and small scissors. A playful wink.'),
  villager('clerk_inn', '여관 주인', 'the innkeeper: a gentle sleepy old woman with a grey bun and round glasses, a soft blue shawl (#7fa8d6), holding a big brass key ring. A kind sleepy smile.'),
  villager('clerk_spring', '온천지기', 'the hot spring keeper: a relaxed middle-aged man with a short round bald head, a small towel folded on top of his head, a soft blue robe (#9db8cc) tied with a sash, holding a wooden bucket. A blissful smile with closed eyes.'),
  villager('clerk_fortune', '점쟁이', 'the fortune teller: a mysterious but cute young woman with long dark wavy hair blob, a deep purple shawl (#8a6aa8) with a few tiny star dots, holding a small flat pale blue crystal ball (no glow). A knowing little smile.'),
  villager('clerk_photo', '사진사', 'the village photographer: a skinny cheerful young man with a beret (#7a5f78), round glasses, a cream shirt with a brown vest, holding an old box camera. An excited open smile.'),
  villager('clerk_souvenir', '기념품 가게 주인', 'the souvenir shop owner: a cheerful round grandma with a short round grey hair blob, a soft yellow cardigan (#f3d36a), hugging a small round plush toy. A cozy smile.', {
    note: '둘째 판 A (선 23px, 둥근 머리). 사용자가 A를 좋다고 승인 (2026-10-18) → art-qa.mjs APPROVED로 굵기 검수에서 뺀다. B(19px)는 clerk_souvenir.try2.png. 첫 판(clerk_souvenir.rejected1.png)은 외곽선 17px로 가늘고 곱슬머리가 잔 가닥으로 그려졌다 (전당포 주인·일터 반장 때 사용자 지적과 같은 문제).',
    extra: VILLAGER_STYLE_FIX,
  }),
  villager('clerk_flower', '꽃집 주인', 'the florist: a gentle young woman with a long soft brown braid, a flower tucked behind her ear, a soft green apron (#8fae6b), holding a small bouquet. A shy sweet smile.'),
  villager('ride_carousel', '회전목마 운영자', 'the carousel operator: a cheerful chubby man with a curly mustache, a red-and-cream striped vest (#c9614a), a small round hat, holding a small brass hand bell. A jolly grin.'),
  villager('ride_ferris', '관람차 운영자', 'the Ferris wheel operator: a calm tall young woman with a short sky-blue cap (#8ec8ee), a cream shirt and blue overalls, holding a small paper ticket. A friendly calm smile.'),
];

// ── 목록 ─────────────────────────────────────────────────────────────────

/**
 * 세트의 기준 그림으로 고른 원본 (copy: gen.ts가 --force 없이 다시 뽑지 않는다). 후보는 tools/art-try/에, 버린 판은 <key>.try<n>.png.
 * 2026-10-15 고름: dragon_base(후보 3장 중 3번: 선이 가장 굵고 가장 동글), chief(2장 중 2번: 선 19px로 기준과 맞고 왼쪽 3/4가 분명),
 * ground(2장 중 2번: 길과 연못이 더 자연스럽다), slot_machine(2장 중 1번: 선이 더 굵다).
 */
const LOCKED = new Set(['monsters/dragon_base', 'characters/chief', 'map/ground', 'objects/slot_machine', 'fx/emote_heart', 'icons/sym_apple', 'items/coin']);
const lockLeads = (list: readonly ArtAsset[]): ArtAsset[] => list.map((a) => (LOCKED.has(`${a.group}/${a.key}`) ? { ...a, copy: true } : a));

/**
 * 외곽선 검수(tools/art-qa.mjs)가 다시 뽑을 때 붙이는 끝 문단: 환경 변수 ART_RETRY_KEY(그룹/key)가 이 그림이면
 * ART_RETRY_EXTRA를 프롬프트 끝에 더한다 ('너무 가늘었다/굵었다'를 고치는 IMPORTANT 문단). 그 밖에는 아무것도 바꾸지 않는다.
 */
const retryExtra = (list: ArtAsset[]): ArtAsset[] => {
  const key = typeof process !== 'undefined' ? process.env.ART_RETRY_KEY : undefined;
  const extra = typeof process !== 'undefined' ? process.env.ART_RETRY_EXTRA : undefined;
  if (key === undefined || extra === undefined || extra === '') return list;
  return list.map((a) => (`${a.group}/${a.key}` === key ? { ...a, prompt: `${a.prompt}\n\n${extra}` } : a));
};

/** 이 프로젝트의 그림. 그룹: characters, monsters, objects, map, ui, icons, items, cards, closeup, fx. */
export const PROJECT_ASSETS: readonly ArtAsset[] = retryExtra(lockLeads([
  ...inGroup('characters', ...CHARACTERS),
  ...inGroup('monsters', ...MONSTERS),
  ...inGroup('map', GROUND, ...BUILDINGS),
  ...inGroup('map', ...PROPS, ...CLOUDS),
  ...inGroup('objects', ...OBJECTS),
  ...inGroup('closeup', ...CLOSEUP_BGS),
  ...inGroup('icons', ...ICONS),
  ...inGroup('fx', ...FX),
  ...inGroup('items', ...ITEMS),
  ...inGroup('map', ...BOOTHS2),
  ...inGroup('racers', ...RACERS),
  ...inGroup('closeup', ...CLOSEUP_BGS2),
  ...inGroup('objects', ...OBJECTS2),
  ...inGroup('characters', ...CHARACTERS2),
  ...inGroup('monsters', ...MONSTERS2),
  ...inGroup('objects', ...PLUSH2),
  ...inGroup('items', ...MATERIALS2),
  ...inGroup('map', ...GROUP_MAP),
  ...inGroup('racers', ...BOATS),
  ...inGroup('objects', ...KITES),
  ...inGroup('items', ...GROUP_ITEMS),
  ...inGroup('closeup', ...GROUP_CLOSEUP),
  ...inGroup('characters', ...GROUP_STAFF),
  ...inGroup('items', ...ACCESSORIES, ...DEBT_ITEMS),
  ...inGroup('map', ...DEBT_MAP),
  ...inGroup('characters', ...DEBT_STAFF),
  ...inGroup('map', ...SHOPS, ...SHOP_PROPS),
  ...inGroup('map', ...RIDES.filter((e) => e.key === 'carousel_base' || e.key === 'ferris_frame')),
  ...inGroup('objects', ...RIDES.filter((e) => e.key === 'ferris_wheel' || e.key === 'ferris_gondola')),
  ...inGroup('racers', ...RIDES.filter((e) => e.key === 'carousel_horse' || e.key === 'icecream_truck')),
  ...inGroup('items', ...SHOP_ITEMS),
  ...inGroup('fx', ...SHOP_FX),
  ...inGroup('characters', ...SHOP_STAFF),
]));

// 쓰지 않는 키트 이름 (빌드 검사에서 지우지 않게): mapSameSet은 놀이부스 다음 판에서 쓸 수 있다.
void mapSameSet;
