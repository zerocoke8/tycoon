// 움직이는 그림 (Seedance 영상 → tools/sprite → public/assets/anim/<종>/<클립>.webp·json, 목록은 index.json).
// 클립이 없으면 null: 게임은 정지 그림(ArtNode)으로 돈다. 지금은 클립이 하나도 없어도 된다.
//
// 시트 JSON은 PixiJS v8 스프라이트시트 (tools/sprite/extract.ts가 쓴다):
//   - meta.scale = 칸 px / 캔버스 px. Pixi가 이것을 텍스처 해상도로 쓰므로 텍스처 크기가 '캔버스 단위'다
//     → sprite.scale = k (정지 그림과 같은 세트 배율, 예: ART_SCALE.monster) 하나로 정지 그림과 같은 크기.
//   - 프레임마다 anchor = 발 기준점 (몬스터는 monsterFoot(종)와 같은 캔버스 점) → 같은 자리 (0,0)에 두면 발이 붙는다.
//   - meta.clip = { fps, loop, anchor, frames, … }.
//
// MonsterView에서 정지 그림을 움직이는 그림으로 바꾸는 법 (지금 MonsterView는 this.body(뒤집기·트윈) 안에 this.art(ArtNode)):
//   const clip = await loadClip(species, 'idle');           // 없으면 null → 그대로 정지 그림
//   if (clip !== null) {
//     const s = clipSprite(clip, ART_SCALE.monster);        // anchor = 발, scale = k (양수)
//     this.body.addChild(s);                                // ArtNode와 같은 부모, 같은 (0,0)
//     this.art.visible = false;                             // 정지 그림은 숨겨 둔다 (클립이 끝나면 다시 보이기)
//     s.play();
//   }
//   - 좌우 뒤집기(오른쪽을 볼 때 scale.x = −1)와 hop·shake 같은 트윈은 지금처럼 부모(this.body)에 건다: 스프라이트는 건드리지 않는다.
//   - 되풀이 아닌 클립(cry_lie 등)은 s.onComplete에서 마지막 프레임을 두거나 정지 그림으로 돌아간다.
//   - 화면 밖 손님은 정지 그림으로 둔다 (클립 한 장이 GPU 수 MB). 다 쓴 클립은 unloadClip.
//   - 손님 반응의 포즈(joy·agony·sad)와 클립 이름이 같다: Reaction.pose → loadClip(species, pose).

import { AnimatedSprite, Assets, type Spritesheet, type Texture } from 'pixi.js';

export interface AnimClip {
  readonly textures: Texture[];
  readonly fps: number;
  /** 발 기준점 (프레임 안의 비율, 0~1). */
  readonly anchor: { x: number; y: number };
  readonly loop: boolean;
}

interface AnimIndexEntry {
  readonly json: string;
  readonly fps: number;
  readonly loop: boolean;
  readonly frames: number;
}

interface AnimIndex {
  readonly version: number;
  readonly clips: Readonly<Record<string, Readonly<Record<string, AnimIndexEntry>>>>;
}

/** 시트 JSON의 meta.clip (extract.ts의 ClipMeta 가운데 쓰는 것만). */
interface ClipMeta {
  readonly fps?: number;
  readonly loop?: boolean;
  readonly anchor?: { readonly x: number; readonly y: number };
}

const BASE = `${import.meta.env.BASE_URL}assets/anim/`;
let indexPromise: Promise<AnimIndex | null> | null = null;
let index: AnimIndex | null = null;
const clips = new Map<string, Promise<AnimClip | null>>();

/** index.json을 한 번 읽는다. 없거나 깨졌으면 null (Vite 개발 서버는 없는 파일에 index.html을 줄 수 있어 JSON인지 본다). */
export function loadAnimIndex(): Promise<AnimIndex | null> {
  indexPromise ??= (async () => {
    try {
      const res = await fetch(`${BASE}index.json`, { cache: 'no-cache' });
      if (!res.ok) return null;
      const j = JSON.parse(await res.text()) as Partial<AnimIndex> | null;
      if (j === null || typeof j !== 'object' || typeof j.clips !== 'object' || j.clips === null) return null;
      index = j as AnimIndex;
      return index;
    } catch {
      return null;
    }
  })();
  return indexPromise;
}

/** 목록에 그 클립이 있는가 (loadAnimIndex가 끝난 뒤에만 참이 될 수 있다). */
export function hasClip(species: string, clip: string): boolean {
  return index?.clips[species]?.[clip] !== undefined;
}

/** 클립 하나를 불러온다 (같은 클립은 한 번만). 없거나 실패하면 null. */
export function loadClip(species: string, clip: string): Promise<AnimClip | null> {
  const id = `${species}/${clip}`;
  let p = clips.get(id);
  if (p === undefined) {
    p = load(species, clip);
    clips.set(id, p);
  }
  return p;
}

async function load(species: string, clip: string): Promise<AnimClip | null> {
  const idx = await loadAnimIndex();
  const entry = idx?.clips[species]?.[clip];
  if (entry === undefined) return null;
  try {
    const sheet = await Assets.load<Spritesheet>(`${BASE}${entry.json}`);
    const textures = sheet.animations[clip] ?? [];
    const first = textures[0];
    if (first === undefined) return null;
    // 지도에서 작게 볼 때 외곽선이 깨지지 않게 (art.ts와 같다).
    const src = sheet.textureSource;
    src.scaleMode = 'linear';
    src.autoGenerateMipmaps = true;
    src.updateMipmaps();
    const meta = (sheet.data.meta as { clip?: ClipMeta }).clip;
    const a = meta?.anchor ?? first.defaultAnchor ?? { x: 0.5, y: 1 };
    return { textures, fps: meta?.fps ?? entry.fps, anchor: { x: a.x, y: a.y }, loop: meta?.loop ?? entry.loop };
  } catch {
    return null;
  }
}

/** 클립을 내려놓는다 (텍스처를 GPU에서 뺀다). 그 텍스처를 쓰는 스프라이트는 먼저 치운다. */
export async function unloadClip(species: string, clip: string): Promise<void> {
  const id = `${species}/${clip}`;
  if (!clips.has(id)) return;
  clips.delete(id);
  const entry = index?.clips[species]?.[clip];
  if (entry !== undefined) await Assets.unload(`${BASE}${entry.json}`);
}

/**
 * 클립 → AnimatedSprite. anchor = 발 기준점, scale = k (정지 그림과 같은 세트 배율), 속도 = fps.
 * 공용 Ticker로 돈다 (autoUpdate). 직접 돌리려면 autoUpdate = false로 두고 gotoAndStop(Math.floor(t * clip.fps) % n).
 */
export function clipSprite(clip: AnimClip, k: number): AnimatedSprite {
  const s = new AnimatedSprite({ textures: clip.textures, autoUpdate: true, loop: clip.loop, animationSpeed: clip.fps / 60 });
  s.anchor.set(clip.anchor.x, clip.anchor.y);
  s.scale.set(k);
  return s;
}
