// 그림 불러오기: art-kit의 process.ts가 쓴 public/assets/art/meta.json과 <그룹>/<key>.webp.
// 그림이 아직 없으면 자리 표시(둥근 네모 + 이름)를 대신 그린다: 게임은 그림 없이도 돈다.
//
// 놓는 법 (중요): 그림은 투명 여백을 잘라 낸 것이라, '요청 캔버스' 좌표로 기준점을 잡는다.
//   - trim = 캔버스(ow×oh, 요청 크기 단위) 안에서 남긴 사각형, scale = 결과 px / 캔버스 px.
//   - 화면 크기는 세트마다 하나의 배율 k (세계 px / 캔버스 px)로 정한다: sprite.scale = k / scale.
//     그림마다 따로 맞추지 않아야 포즈끼리 크기가 튀지 않는다 (키트 안내서 6.4).
//   - 기준점 = 캔버스 좌표의 한 점 (예: 손님 몬스터의 발 (512, 870)). anchor = ((px - trim.x) / trim.w, (py - trim.y) / trim.h).

import { Assets, Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { BOOTH_IDS, boothDef, HOST_PRESETS, SPECIES, type BoothId } from '../data/defs.ts';

export interface ArtTrim {
  x: number;
  y: number;
  w: number;
  h: number;
  ow: number;
  oh: number;
}
export interface ArtMetaEntry {
  w: number;
  h: number;
  scale: number;
  alpha: boolean;
  trim: ArtTrim;
  raw?: { w: number; h: number };
}
type ArtMeta = Record<string, Record<string, ArtMetaEntry>>;

const BASE = `${import.meta.env.BASE_URL}assets/art/`;
let meta: ArtMeta = {};
const textures = new Map<string, Texture>();

const id = (group: string, key: string): string => `${group}/${key}`;

/**
 * 확대 화면 장치 그림 (objects/<key>) → 그 그림을 쓰는 부스. 부스를 열 수 있는 회관 레벨이 되면 불러온다.
 * 새 장치 그림을 쓰면 여기에 더한다 (빠지면 그림이 있어도 자리 표시가 나온다). prize_pot은 늘, plush_<종>은 인형 뽑기와 그 종을 따른다.
 */
const OBJECT_BOOTHS: Readonly<Record<string, readonly BoothId[]>> = {
  slot_machine: ['slot'],
  table: ['cups', 'oddeven', 'pouch'],
  cup: ['cups'],
  ball: ['cups'],
  dartboard: ['darts'],
  dart: ['darts'],
  pebble_bowl: ['oddeven'],
  pebble: ['oddeven'],
  wheel_disc: ['wheel'],
  wheel_stand: ['wheel'],
  wheel_pointer: ['wheel'],
  duck_tub: ['duck'],
  rubber_duck: ['duck'],
  fishing_rod: ['duck'],
  bottle: ['ring'],
  toss_ring: ['ring'],
  claw_machine: ['claw'],
  claw: ['claw'],
  pouch_red: ['pouch'],
  pouch_blue: ['pouch'],
  pouch_gold: ['pouch'],
  // 셋째 묶음: 연날리기 연 (지도 하늘 층과 확대 화면)
  kite_red: ['kite'],
  kite_blue: ['kite'],
  kite_yellow: ['kite'],
  kite_green: ['kite'],
};

const boothReady = (b: BoothId, hall: number): boolean => boothDef(b).unlock.hall <= hall;
const speciesHall = (s: string): number | undefined => (SPECIES as Readonly<Record<string, { readonly hall: number } | undefined>>)[s]?.hall;

/**
 * 마을회관 레벨 hall에서 게임이 Pixi로 그릴 수 있는 그림인가. 손님 그림은 그 종이 올 수 있는 레벨부터,
 * 확대 화면 그림(배경·장치·경주 선수·인형)은 그 부스를 열 수 있는 레벨부터 불러온다 (RAM·GPU를 아끼려고).
 * 지도 그림·진행자·아이콘·효과·아이템은 늘. UI 전용 그림은 UI가 <img>로 따로 읽는다.
 * 회관이 오르면 loadArtForHall로 더 불러온다 (main.ts). 그동안 자리 표시였던 그림은 불러오는 대로 바뀐다.
 */
function wanted(group: string, key: string, hall: number): boolean {
  switch (group) {
    case 'monsters': {
      const h = speciesHall(key.slice(0, key.lastIndexOf('_')));
      return h !== undefined && h <= hall;
    }
    case 'characters':
      return key === 'chief' || HOST_PRESETS.some((h) => h.art === key);
    case 'map':
      return key !== 'ground';
    case 'closeup':
      return BOOTH_IDS.some((b) => key === `bg_${b}` && boothReady(b, hall));
    case 'objects': {
      if (key === 'prize_pot') return true;
      if (key.startsWith('plush_')) {
        const h = speciesHall(key.slice('plush_'.length));
        return h !== undefined && h <= hall && boothReady('claw', hall);
      }
      return (OBJECT_BOOTHS[key] ?? []).some((b) => boothReady(b, hall));
    }
    case 'racers':
      // 오리배(boat_*)는 오리배 경주, 그 밖(racer_*)은 경주장.
      return key.startsWith('boat_') ? boothReady('boat', hall) : boothReady('race', hall);
    case 'icons':
    case 'fx':
    case 'items':
      return true;
    default:
      return false;
  }
}

/** 작게 줄여 그리는 그림만 mipmap (지도 위 건물·손님·주민·효과·코인·경주 선수). 확대 화면에서 거의 1:1로 그리는 그림은 끈다 (메모리 1/3 아낌). */
const MIPMAP_GROUPS = new Set(['map', 'monsters', 'characters', 'fx', 'items', 'racers']);
/** 그 밖에 지도 위에 작게 그리는 그림 (연날리기 연은 지도 하늘 층에 작게). */
const MIPMAP_KEYS = new Set(['objects/kite_red', 'objects/kite_blue', 'objects/kite_yellow', 'objects/kite_green']);

/** 그림 하나를 다시 받아 보는 횟수. */
const LOAD_RETRIES = 3;
/** 불러온 회관 레벨 (loadArtForHall이 이보다 높을 때만 더 불러온다). */
let loadedHall = 0;
/** 그림이 아직 없어 자리 표시를 그리는 노드 (그림이 오면 다시 그린다). key = group/key. */
const waiting = new Map<string, Set<ArtNode>>();

async function loadList(list: readonly { group: string; key: string }[], onProgress?: (p: number) => void): Promise<void> {
  let done = 0;
  await Promise.all(
    list.map(async ({ group, key }) => {
      try {
        // 한꺼번에 많이 받다가 하나가 실패해도(느린 폰 망, 동시 요청이 많을 때) 몇 번 다시 받는다. 끝내 실패하면 자리 표시.
        const tex = await Assets.load<Texture>(`${BASE}${group}/${key}.webp`, { strategy: 'retry', retryCount: LOAD_RETRIES, retryDelay: 600 });
        tex.source.scaleMode = 'linear';
        if (MIPMAP_GROUPS.has(group) || MIPMAP_KEYS.has(id(group, key))) {
          tex.source.autoGenerateMipmaps = true;
          tex.source.updateMipmaps();
        }
        textures.set(id(group, key), tex);
        const nodes = waiting.get(id(group, key));
        waiting.delete(id(group, key));
        if (nodes !== undefined) for (const n of nodes) n.retry();
      } catch (e) {
        // 자리 표시로 남긴다.
        console.warn(`그림을 못 불러왔어요: ${group}/${key}`, e);
      }
      done++;
      onProgress?.(list.length === 0 ? 1 : done / list.length);
    }),
  );
  onProgress?.(1);
}

function missing(hall: number): { group: string; key: string }[] {
  const list: { group: string; key: string }[] = [];
  for (const [group, rows] of Object.entries(meta)) for (const key of Object.keys(rows)) if (!textures.has(id(group, key)) && wanted(group, key, hall)) list.push({ group, key });
  return list;
}

/** meta.json을 읽고 회관 레벨 hall에서 쓰는 그림을 불러온다. onProgress(0~1). 실패한 그림은 자리 표시로 남는다. */
export async function loadArt(onProgress?: (p: number) => void, hall = 1): Promise<void> {
  try {
    const res = await fetch(`${BASE}meta.json`, { cache: 'no-cache' });
    meta = res.ok ? ((await res.json()) as ArtMeta) : {};
  } catch {
    meta = {};
  }
  loadedHall = Math.max(loadedHall, hall);
  await loadList(missing(loadedHall), onProgress);
}

/** 회관 레벨이 올랐을 때: 새로 올 수 있는 손님·열 수 있는 부스의 그림을 더 불러온다 (이미 있으면 아무것도 안 한다). */
export async function loadArtForHall(hall: number): Promise<void> {
  if (hall <= loadedHall) return;
  loadedHall = hall;
  await loadList(missing(hall));
}

export function artMeta(group: string, key: string): ArtMetaEntry | undefined {
  return meta[group]?.[key];
}

export function hasArt(group: string, key: string): boolean {
  return textures.has(id(group, key));
}

export function artTexture(group: string, key: string): Texture | undefined {
  return textures.get(id(group, key));
}

/** 기준점: 'bottom' = 잘라 낸 그림의 아래 가운데, 'center' = 가운데, 또는 캔버스 좌표의 점. */
export type ArtAnchor = 'bottom' | 'center' | { readonly x: number; readonly y: number };

export interface ArtSpriteOptions {
  /** 세계 px / 캔버스 px. 세트마다 하나. */
  readonly k: number;
  readonly anchor?: ArtAnchor;
  /** 그림이 없을 때 자리 표시의 캔버스 크기와 색. */
  readonly placeholder?: { readonly w: number; readonly h: number; readonly color?: number };
}

/**
 * 그림 하나를 기준점에 맞춰 놓은 Container를 만든다 (Container의 (0,0) = 기준점).
 * 그림을 바꿀 때(포즈 바꾸기)는 setArt를 쓴다: 같은 기준점·배율이 유지된다.
 */
export function artSprite(group: string, key: string, opts: ArtSpriteOptions): ArtNode {
  const node = new ArtNode(opts);
  node.setArt(group, key);
  return node;
}

export class ArtNode extends Container {
  private sprite: Sprite | null = null;
  private placeholderGfx: Container | null = null;
  private readonly opts: ArtSpriteOptions;
  current = '';
  /** 마지막으로 그리라고 한 그림 (그림이 늦게 오면 retry가 다시 그린다). */
  private last: { group: string; key: string; anchor: ArtAnchor | undefined } | null = null;

  constructor(opts: ArtSpriteOptions) {
    super();
    this.opts = opts;
  }

  /** 그림이 막 불러와졌다: 아직 그 그림을 그리라는 중이면 다시 그린다 (자리 표시 → 그림). */
  retry(): void {
    const l = this.last;
    if (this.destroyed || l === null) return;
    this.current = '';
    this.setArt(l.group, l.key, l.anchor);
  }

  /** 그림을 바꾼다. anchor를 주면 이 그림만 그 기준점으로 (포즈마다 발 높이가 다른 손님 그림). */
  setArt(group: string, key: string, anchor?: ArtAnchor): void {
    const a = anchor ?? this.opts.anchor ?? 'bottom';
    const full = typeof a === 'string' ? `${id(group, key)}@${a}` : `${id(group, key)}@${a.x},${a.y}`;
    if (full === this.current) return;
    this.current = full;
    this.last = { group, key, anchor };
    const tex = textures.get(id(group, key));
    const m = meta[group]?.[key];
    if (tex === undefined && m !== undefined) {
      // 그림은 있는데 아직 안 불러왔다 (회관 레벨에 따라 나중에 불러온다): 오면 다시 그린다.
      let set = waiting.get(id(group, key));
      if (set === undefined) waiting.set(id(group, key), (set = new Set()));
      set.add(this);
    }
    if (tex !== undefined && m !== undefined) {
      this.placeholderGfx?.destroy({ children: true });
      this.placeholderGfx = null;
      if (this.sprite === null) {
        this.sprite = new Sprite(tex);
        this.addChild(this.sprite);
      } else {
        this.sprite.texture = tex;
      }
      const t = m.trim;
      if (a === 'bottom') this.sprite.anchor.set(0.5, 1);
      else if (a === 'center') this.sprite.anchor.set(0.5, 0.5);
      else this.sprite.anchor.set((a.x - t.x) / t.w, (a.y - t.y) / t.h);
      this.sprite.scale.set(this.opts.k / m.scale);
      return;
    }
    // 자리 표시
    this.sprite?.destroy();
    this.sprite = null;
    this.placeholderGfx?.destroy({ children: true });
    const ph = this.opts.placeholder ?? { w: 400, h: 400 };
    const w = ph.w * this.opts.k;
    const h = ph.h * this.opts.k;
    const c = new Container();
    const g = new Graphics().roundRect(-w / 2, -h, w, h, Math.min(w, h) * 0.2).fill({ color: ph.color ?? 0xd9c7a6 }).stroke({ color: 0x402c1c, width: 3 });
    const label = new Text({ text: key, style: { fontSize: Math.max(10, Math.min(22, w / 6)), fill: 0x402c1c, fontFamily: 'sans-serif' } });
    label.anchor.set(0.5);
    label.position.set(0, -h / 2);
    c.addChild(g, label);
    if (a === 'center') c.position.set(0, h / 2);
    this.placeholderGfx = c;
    this.addChild(c);
  }
}

// ── 세트별 배율과 기준점 (세계 px / 캔버스 px) ───────────────────────────
// 바꾸면 지도 위 크기가 바뀐다. 손님 몬스터 몸(캔버스 약 500px)이 약 105px, 주민(약 1000px)이 약 130px,
// 건물(약 800px 폭)이 약 560px 폭 (주민이 문보다 너무 크지 않게), 놀이부스(약 800px 폭)는 약 400px 폭 (손님이 계산대 높이).

export const ART_SCALE = {
  monster: 0.21,
  villager: 0.13,
  building: 0.7,
  booth: 0.5,
  prop: 0.28,
  potOnMap: 0.12,
  cloud: 1.4,
} as const;

/** 손님 몬스터 발의 캔버스 좌표 (art-assets.ts GUEST_FRAME: 아래에서 15% 위 선). 그림이 없을 때의 기본값. */
export const MONSTER_FOOT = { x: 512, y: 870 } as const;

/** 떠다니는 종인가 (defs.ts SPECIES.floats). */
const floats = (species: string): boolean => (SPECIES as Readonly<Record<string, { readonly floats: boolean } | undefined>>)[species]?.floats === true;

/**
 * 종의 발 기준점 (캔버스 좌표): 그 포즈 그림(<species>_<pose>)의 잘라 낸 아래 끝.
 * Codex가 그린 발 높이는 종마다, 포즈마다 조금씩 다르다 (기본 그림과 ±15~33px). 포즈마다 자기 발끝을 기준으로 놓아야
 * 포즈를 바꿔도 발이 그림자에 붙어 있다. 떠다니는 종은 기본 그림의 아래 끝을 모든 포즈에 쓴다 (둥실 높이가 그대로).
 * 포즈 그림이 없으면 기본 그림, 그것도 없으면 MONSTER_FOOT.
 */
export function monsterFoot(species: string, pose = 'base'): { x: number; y: number } {
  const own = floats(species) ? undefined : meta.monsters?.[`${species}_${pose}`];
  const m = own ?? meta.monsters?.[`${species}_base`];
  return m === undefined ? MONSTER_FOOT : { x: 512, y: m.trim.y + m.trim.h };
}
