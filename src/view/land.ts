// 사지 않은 땅을 덮는 구름 (DESIGN 6.1 땅 넓히기). world.ts가 물체층(y 정렬)에 넣는다.
//  - 안개: 가진 땅에서 떨어진 거리로 0 → 1 (FOG_RAMP px 동안 부드럽게)인 작은 텍스처 (FOG_TEXEL px마다 한 텍셀, 선형 보간).
//    가진 땅 위는 0이라 가장자리가 칼같이 끊기지 않고, 지도 밖도 구름이다.
//  - 띠: 땅 조각 한 줄마다 안개 스프라이트 하나 + 그 띠의 구름을 담은 묶음, zIndex = 띠 아래 변.
//    그래서 구름 바로 아래(남쪽) 가진 땅의 키 큰 건물·손님은 구름 앞에 서고, 구름 덩어리는 아래 변이 든 띠에 넣어 다른 띠 안개에 잘리지 않는다.
//  - 가장자리 구름 (map/cloud_puff): 가진 땅과 맞닿은 변을 따라 줄지어 살짝 일렁인다. 남쪽 변(가진 땅이 아래)은 구름 아래 끝을 변에 맞추고,
//    북·동·서 변은 가진 땅 쪽으로 조금만 (EDGE_POKE px) 삐져나온다 (구름이 더 가깝게 보이는 쪽, 끝 칸의 건물·장식은 가리지 않게).
//    그래도 가진 땅의 건물·장식·길 칸에 걸친 구름(모서리 구름 등)은 옅게 (COVER_ALPHA: 놓은 것이 구름 밑에 숨지 않게).
//  - 떠도는 구름: 띠마다 몇 개가 바람 따라 천천히 오른쪽으로 흐르고, 안개가 옅은 곳(가진 땅 둘레)에 닿으면 흐려져 사라진다.
//  - 땅을 사면: 그 조각 안개가 가운데부터 걷히고, 덮던 구름이 양옆으로 갈라지며 흩어진다. 새 가장자리 구름은 조금 뒤 피어난다.
//  - 짓기 모드(놓기·옮기기·길)에서는 가장자리 구름이 옅어진다 (setSeeThrough: 가진 땅 끝 칸이 구름에 가려 보이지 않게).
// 땅 상태는 sim.village() (stamp.land가 바뀌면 맞춘다). 바닥 타일은 짙은 구름에 다 덮인 곳을 굽지 않는다 (underFog).

import { BufferImageSource, Container, Graphics, Rectangle, Sprite, Texture, type Renderer } from 'pixi.js';
import { CELL, CHUNK, CHUNKS, WORLD } from '../data/map.ts';
import { Rng } from '../core/rng.ts';
import type { SimApi } from '../sim/api.ts';
import type { Village } from '../sim/village.ts';
import { artTexture } from './art.ts';
import type { FxLayer } from './fx.ts';
import { clamp, hash2, type ViewRect } from './mapUtil.ts';

/** 가진 땅 가장자리에서 안개가 짙어지는 거리 (세계 px). */
export const FOG_RAMP = 160;
/** 안개 텍스처 한 텍셀 (세계 px). */
const FOG_TEXEL = 32;
/** 땅 조각 한 변 (세계 px). */
const S = CHUNK * CELL;
/** 지도 밖 구름 폭 (세계 px, 조각 하나). */
const MARGIN = S;
const FW = (WORLD.w + 2 * MARGIN) / FOG_TEXEL;
const FH = (WORLD.h + 2 * MARGIN) / FOG_TEXEL;
/** 띠 (땅 조각 한 줄): 지도 위 밖 한 줄(-1)부터 지도 아래 밖 한 줄(CHUNKS.h)까지. */
const BAND_FIRST = -1;
const BAND_COUNT = CHUNKS.h + 2;
const BAND_TEXELS = S / FOG_TEXEL;
/** 구름 색 (cloud_puff 속 색에 맞춘다)과 그림이 없을 때 테두리·그늘. */
const CLOUD_FILL = 0xf4f1ea;
const OUTLINE = 0x402c1c;
const CLOUD_SHADE = 0xe4e1da;
/** 구름 그림 세로/가로 (그림이 없을 때 코드 구름과 같게). */
const PUFF_ASPECT_FALLBACK = 0.5;
/** 가장자리 구름: 변 하나에 몇 개, 폭 (세계 px). */
const EDGE_PER_SIDE = 3;
const EDGE_W: readonly [number, number] = [400, 520];
/** 떠도는 구름: 띠마다 몇 개, 폭, 빠르기 (세계 px/초). */
const DRIFT_PER_BAND = 8;
const DRIFT_W: readonly [number, number] = [520, 760];
const DRIFT_SPEED: readonly [number, number] = [7, 14];
/** 땅을 산 뒤: 안개가 걷히는 시간 (가운데 → 가장자리 늦춤 + 걷힘), 구름이 갈라지는 시간·거리. */
const PART_SPREAD = 0.6;
const PART_FADE = 0.75;
const PART_SEC = 1.7;
const PART_DIST = 460;
const IN_DELAY = 0.7;
const IN_SEC = 0.9;
/** 안개 텍스처 바깥 구름 폭 (세계 px, 가장 멀리 줄여도 넉넉히). */
const FAR = 40000;
/** 짓기 모드에서 가장자리 구름을 이만큼 옅게 (1 = 다 지움). */
const SEE_THROUGH = 0.7;
/** 가장자리 구름이 가진 땅 쪽으로 삐져나오는 폭 (세계 px, 그림 상자 기준, 이 둘레에서 조금씩 다르게). */
const EDGE_POKE = 22;
/** 가진 땅의 건물·장식·길 칸에 걸친 가장자리 구름의 진하기. */
const COVER_ALPHA = 0.35;
/** 한 번에 이만큼 넘게 늘면 (불러오기·개발용) 연출 없이 바로. */
const ANIM_MAX = 4;

/** 사각형 (세계 px)이 짙은 구름에 다 덮였나 (가진 땅에서 FOG_RAMP + 텍셀 둘 넘게 떨어졌다). 바닥 타일이 굽지 않을 곳. */
export function underFog(v: Village, x0: number, y0: number, x1: number, y1: number): boolean {
  const pad = FOG_RAMP + FOG_TEXEL * 2;
  for (const ci of v.state.chunks) {
    const cx = (ci % CHUNKS.w) * S;
    const cy = Math.floor(ci / CHUNKS.w) * S;
    const dx = Math.max(cx - x1, 0, x0 - (cx + S));
    const dy = Math.max(cy - y1, 0, y0 - (cy + S));
    if (dx * dx + dy * dy < pad * pad) return false;
  }
  return true;
}

function smooth(t: number): number {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
}

function outCubic(t: number): number {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u;
}

/** 조각 번호 목록 → 텍셀마다 안개 (0 = 맑음 ~ 1 = 짙음). */
function fogField(chunks: readonly number[], out: Float32Array): Float32Array {
  out.fill(1);
  const reach = FOG_RAMP + FOG_TEXEL;
  for (const ci of chunks) {
    const x0 = (ci % CHUNKS.w) * S;
    const y0 = Math.floor(ci / CHUNKS.w) * S;
    const x1 = x0 + S;
    const y1 = y0 + S;
    const i0 = Math.max(0, Math.floor((x0 - reach + MARGIN) / FOG_TEXEL));
    const i1 = Math.min(FW - 1, Math.ceil((x1 + reach + MARGIN) / FOG_TEXEL));
    const j0 = Math.max(0, Math.floor((y0 - reach + MARGIN) / FOG_TEXEL));
    const j1 = Math.min(FH - 1, Math.ceil((y1 + reach + MARGIN) / FOG_TEXEL));
    for (let j = j0; j <= j1; j++) {
      const py = j * FOG_TEXEL + FOG_TEXEL / 2 - MARGIN;
      const dy = Math.max(y0 - py, 0, py - y1);
      for (let i = i0; i <= i1; i++) {
        const px = i * FOG_TEXEL + FOG_TEXEL / 2 - MARGIN;
        const dx = Math.max(x0 - px, 0, px - x1);
        const f = smooth(Math.sqrt(dx * dx + dy * dy) / FOG_RAMP);
        const k = j * FW + i;
        if (f < (out[k] as number)) out[k] = f;
      }
    }
  }
  return out;
}

/** 구름 그림이 없을 때 코드로 그린 구름 (테두리 먼저, 속 나중 → 바깥 테두리만 남는다). */
function drawCloud(): Graphics {
  const g = new Graphics();
  const bumps: readonly (readonly [number, number, number])[] = [
    [0, 0, 150],
    [-150, 30, 112],
    [152, 28, 116],
    [-78, -72, 106],
    [86, -76, 110],
    [-238, 72, 78],
    [240, 70, 82],
    [0, 86, 120],
    [-120, 100, 90],
    [125, 98, 92],
  ];
  for (const [x, y, r] of bumps) g.circle(x, y, r).stroke({ color: OUTLINE, width: 16 });
  for (const [x, y, r] of bumps) g.circle(x, y, r).fill(CLOUD_FILL);
  g.circle(-150, 104, 58).fill(CLOUD_SHADE);
  g.circle(150, 102, 60).fill(CLOUD_SHADE);
  g.circle(0, 146, 60).fill(CLOUD_SHADE);
  g.arc(-60, 10, 60, Math.PI * 1.1, Math.PI * 1.6).stroke({ color: OUTLINE, width: 7, cap: 'round' });
  g.arc(120, 40, 50, Math.PI * 1.15, Math.PI * 1.55).stroke({ color: OUTLINE, width: 7, cap: 'round' });
  return g;
}

type PuffKind = 'edge' | 'drift' | 'curtain';

interface Puff {
  readonly sp: Sprite;
  readonly kind: PuffKind;
  /** 가장자리 구름 이름 (조각:변:번호). */
  readonly key: string;
  /** 아래 가운데 (세계 px, 일렁이기 전). */
  x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly flip: number;
  readonly ph: number;
  /** 떠도는 빠르기 (세계 px/초). */
  readonly speed: number;
  /** 'in' = 피어나는 중, 'on', 'out' = 갈라져 사라지는 중. */
  state: 'in' | 'on' | 'out';
  t: number;
  delay: number;
  /** 사라질 때 움직일 쪽 (단위 벡터 × 거리). */
  mx: number;
  my: number;
  /** 떠도는 구름의 지금 진하기 (안개를 따라 부드럽게). */
  a: number;
  /** 가장자리 구름이 가진 땅의 건물·장식·길 칸에 걸쳤다 (옅게). */
  covers: boolean;
}

interface Band {
  readonly node: Container;
  readonly fog: Sprite;
  readonly y0: number;
  readonly y1: number;
  readonly puffs: Puff[];
}

/** 땅을 산 연출 하나 (안개 걷힘). */
interface Part {
  t: number;
  readonly from: Float32Array;
  readonly centers: readonly { readonly x: number; readonly y: number }[];
  /** 걷히는 텍셀 사각형. */
  readonly i0: number;
  readonly i1: number;
  readonly j0: number;
  readonly j1: number;
}

export class LandView {
  private readonly sim: SimApi;
  private readonly objects: Container;
  private readonly renderer: Renderer;
  private readonly fx: FxLayer | null;
  private cloudTex: Texture;
  private readonly ownCloudTex: boolean;
  private readonly aspect: number;
  /** 안개: 목표 (지금 땅)와 보이는 것 (걷히는 중엔 둘이 다르다), 텍스처 바이트 (미리 곱한 알파). */
  private readonly target = new Float32Array(FW * FH);
  private readonly cur = new Float32Array(FW * FH);
  private readonly bytes = new Uint8Array(FW * FH * 4);
  private readonly source: BufferImageSource;
  private readonly bands: Band[] = [];
  private part: Part | null = null;
  private landStamp = -1;
  /** 가장자리 구름이 걸친 칸을 다시 잴 때 (놓인 것·길·땅 도장). */
  private coverStamp = '';
  private owned: Set<number> | null = null;
  private time = 0;
  /** 가장자리 구름 옅게 (짓기 모드): 목표와 지금 (0 = 그대로, 1 = 가장 옅게). */
  private seeGoal = 0;
  private see = 0;
  private readonly rng = new Rng(0x1a2d);
  /** 안개 텍스처 바깥 구름. */
  private readonly far = new Graphics();

  constructor(sim: SimApi, objects: Container, renderer: Renderer, fx: FxLayer | null = null) {
    this.sim = sim;
    this.objects = objects;
    this.renderer = renderer;
    this.fx = fx;
    const art = artTexture('map', 'cloud_puff');
    if (art !== undefined) {
      this.cloudTex = art;
      this.ownCloudTex = false;
    } else {
      this.cloudTex = this.makeCloudTex();
      this.ownCloudTex = true;
    }
    this.aspect = art !== undefined ? art.height / Math.max(1, art.width) : PUFF_ASPECT_FALLBACK;
    this.source = new BufferImageSource({ resource: this.bytes, width: FW, height: FH, alphaMode: 'premultiplied-alpha', scaleMode: 'linear' });
    for (let b = 0; b < BAND_COUNT; b++) {
      const band = BAND_FIRST + b;
      const node = new Container();
      node.eventMode = 'none';
      node.interactiveChildren = false;
      node.sortableChildren = true;
      node.zIndex = (band + 1) * S;
      const tex = new Texture({ source: this.source, frame: new Rectangle(0, b * BAND_TEXELS, FW, BAND_TEXELS) });
      const fog = new Sprite(tex);
      fog.position.set(-MARGIN, band * S);
      fog.scale.set(FOG_TEXEL);
      fog.zIndex = -1e9;
      node.addChild(fog);
      objects.addChild(node);
      this.bands.push({ node, fog, y0: band * S, y1: (band + 1) * S, puffs: [] });
    }
    // 안개 텍스처 바깥 (아주 멀리 줄였을 때 보이는 곳): 늘 짙은 구름. 텍스처 가장자리와 2px 겹친다.
    const fx0 = -MARGIN + 2;
    const fy0 = -MARGIN + 2;
    const fx1 = WORLD.w + MARGIN - 2;
    const fy1 = WORLD.h + MARGIN - 2;
    this.far
      .rect(fx0 - FAR, fy0 - FAR, fx1 - fx0 + 2 * FAR, FAR)
      .rect(fx0 - FAR, fy1, fx1 - fx0 + 2 * FAR, FAR)
      .rect(fx0 - FAR, fy0, FAR, fy1 - fy0)
      .rect(fx1, fy0, FAR, fy1 - fy0)
      .fill(CLOUD_FILL);
    this.far.zIndex = -1e9;
    this.far.eventMode = 'none';
    objects.addChild(this.far);
    this.makeDrift();
    this.sync(sim.village());
  }

  private makeCloudTex(): Texture {
    const g = drawCloud();
    const tex = this.renderer.generateTexture({ target: g, resolution: 1, antialias: true });
    g.destroy();
    return tex;
  }

  /** 세계 점의 안개 (0 = 맑음 ~ 1 = 짙음, 지금 보이는 것). */
  fogAt(x: number, y: number): number {
    const fx = (x + MARGIN) / FOG_TEXEL - 0.5;
    const fy = (y + MARGIN) / FOG_TEXEL - 0.5;
    const i = clamp(Math.floor(fx), 0, FW - 2);
    const j = clamp(Math.floor(fy), 0, FH - 2);
    const u = clamp(fx - i, 0, 1);
    const v = clamp(fy - j, 0, 1);
    const k = j * FW + i;
    const c = this.cur;
    const a = (c[k] as number) * (1 - u) + (c[k + 1] as number) * u;
    const b = (c[k + FW] as number) * (1 - u) + (c[k + FW + 1] as number) * u;
    return a * (1 - v) + b * v;
  }

  // ── 땅 맞추기 ──

  private sync(v: Village): void {
    this.landStamp = v.stamp.land;
    const now = new Set(v.state.chunks);
    const prev = this.owned;
    this.owned = now;
    const added: number[] = [];
    let grew = prev !== null;
    if (prev !== null) {
      for (const c of prev) if (!now.has(c)) grew = false;
      for (const c of now) if (!prev.has(c)) added.push(c);
    }
    // 하던 걷힘은 끝낸다.
    if (this.part !== null) {
      this.cur.set(this.target);
      this.part = null;
    }
    fogField(v.state.chunks, this.target);
    const animate = grew && added.length > 0 && added.length <= ANIM_MAX;
    if (animate) this.startPart(added);
    else {
      this.cur.set(this.target);
      this.upload(0, FW - 1, 0, FH - 1);
    }
    this.syncEdges(now, animate ? added : []);
  }

  private startPart(added: readonly number[]): void {
    const centers = added.map((ci) => ({ x: ((ci % CHUNKS.w) + 0.5) * S, y: (Math.floor(ci / CHUNKS.w) + 0.5) * S }));
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const c of centers) {
      x0 = Math.min(x0, c.x - S / 2);
      x1 = Math.max(x1, c.x + S / 2);
      y0 = Math.min(y0, c.y - S / 2);
      y1 = Math.max(y1, c.y + S / 2);
    }
    const reach = FOG_RAMP + FOG_TEXEL * 2;
    this.part = {
      t: 0,
      from: this.cur.slice(),
      centers,
      i0: clamp(Math.floor((x0 - reach + MARGIN) / FOG_TEXEL), 0, FW - 1),
      i1: clamp(Math.ceil((x1 + reach + MARGIN) / FOG_TEXEL), 0, FW - 1),
      j0: clamp(Math.floor((y0 - reach + MARGIN) / FOG_TEXEL), 0, FH - 1),
      j1: clamp(Math.ceil((y1 + reach + MARGIN) / FOG_TEXEL), 0, FH - 1),
    };
    // 덮던 구름: 조각 위에 구름 여섯 덩이를 띄우고 양옆으로 갈라 흩는다.
    for (const c of centers) {
      for (let r = 0; r < 2; r++) {
        for (let k = 0; k < 3; k++) {
          const w = 560 + this.rng.next() * 120;
          const h = w * this.aspect;
          const x = c.x - S / 2 + ((k + 0.5) / 3) * S + (this.rng.next() - 0.5) * 60;
          const y = c.y - S / 2 + (r === 0 ? 0.48 : 0.96) * S;
          const dx = x - c.x;
          const dy = y - h / 2 - c.y;
          const len = Math.hypot(dx * 1.6, dy * 0.6) || 1;
          const p = this.addPuff('curtain', '', x, y, w, this.rng.next() * 6.28, 0);
          p.state = 'out';
          p.delay = 0.05 + this.rng.next() * 0.25;
          p.mx = ((dx * 1.6) / len) * PART_DIST;
          p.my = ((dy * 0.6) / len) * PART_DIST;
        }
      }
      this.fx?.sparkles(c.x, c.y, 28, S * 0.42);
    }
  }

  /** 가장자리 구름을 지금 땅에 맞춘다: 없어진 변의 구름은 갈라져 사라지고, 새 변의 구름은 피어난다 (animate가 빈 목록이면 바로). */
  private syncEdges(owned: ReadonlySet<number>, added: readonly number[]): void {
    const want = new Map<string, { x: number; y: number; w: number; ph: number }>();
    const own = (cx: number, cy: number): boolean => cx >= 0 && cy >= 0 && cx < CHUNKS.w && cy < CHUNKS.h && owned.has(cy * CHUNKS.w + cx);
    const rng = this.rng;
    for (let cy = 0; cy < CHUNKS.h; cy++) {
      for (let cx = 0; cx < CHUNKS.w; cx++) {
        if (own(cx, cy)) continue;
        const ci = cy * CHUNKS.w + cx;
        const x0 = cx * S;
        const y0 = cy * S;
        // 변: 0 = 북(가진 땅이 위), 1 = 동, 2 = 남, 3 = 서.
        const sides: readonly (readonly [number, number, number])[] = [
          [0, cx, cy - 1],
          [1, cx + 1, cy],
          [2, cx, cy + 1],
          [3, cx - 1, cy],
        ];
        for (const [side, nx, ny] of sides) {
          if (!own(nx, ny)) continue;
          // 옆 변은 구름이 납작해서 더 촘촘히.
          const n = side === 1 || side === 3 ? EDGE_PER_SIDE + 1 : EDGE_PER_SIDE;
          for (let k = 0; k < n; k++) {
            rng.state = hash2(ci * 4 + side, k, 0xc10d);
            const w = EDGE_W[0] + rng.next() * (EDGE_W[1] - EDGE_W[0]);
            const h = w * this.aspect;
            const along = (k + 0.5) / n + (rng.next() - 0.5) * (0.36 / n);
            const ph = rng.next() * Math.PI * 2;
            const j = rng.next();
            let x: number;
            let y: number;
            const poke = EDGE_POKE * (0.6 + j * 0.6);
            if (side === 2) {
              // 가진 땅이 아래: 구름 아래 끝을 변에 맞춘다 (가진 땅으로 내려가지 않게).
              x = x0 + along * S;
              y = y0 + S - 4 - j * 12;
            } else if (side === 0) {
              // 가진 땅이 위: 위쪽이 가진 땅으로 조금 (poke) 삐져나온다.
              x = x0 + along * S;
              y = y0 + h - poke;
            } else {
              // 옆: 가진 땅 쪽으로 조금 (poke) 삐져나온다. 아래 끝은 이 띠 안에.
              x = side === 1 ? x0 + S + poke - w / 2 : x0 - poke + w / 2;
              y = Math.min(y0 + along * S + h / 2, y0 + S - 4);
            }
            want.set(`${ci}:${side}:${k}`, { x, y, w, ph });
          }
        }
      }
    }
    // 모서리: 조각 꼭짓점 둘레 네 조각이 가진 땅·구름으로 갈리면 (곧은 변이 지나가는 곳 빼고) 구름 하나를 더 얹어
    // 변 구름 사이로 둥글게 비치는 안개 모서리를 덮는다. 구름 쪽으로 조금 밀고, 가진 땅이 아래에 있으면 아래 끝을 꼭짓점 위로. 지도 가장자리 꼭짓점은 뺀다.
    for (let vy = 1; vy < CHUNKS.h; vy++) {
      for (let vx = 1; vx < CHUNKS.w; vx++) {
        const nw = own(vx - 1, vy - 1);
        const ne = own(vx, vy - 1);
        const sw = own(vx - 1, vy);
        const se = own(vx, vy);
        const n = +nw + +ne + +sw + +se;
        if (n === 0 || n === 4 || (n === 2 && nw === sw) || (n === 2 && nw === ne)) continue;
        let dx = 0;
        let dy = 0;
        if (!nw) (dx -= 1), (dy -= 1);
        if (!ne) (dx += 1), (dy -= 1);
        if (!sw) (dx -= 1), (dy += 1);
        if (!se) (dx += 1), (dy += 1);
        const len = Math.hypot(dx, dy) || 1;
        rng.state = hash2(vx, vy, 0xc0e2);
        const w = EDGE_W[0] + rng.next() * (EDGE_W[1] - EDGE_W[0]) * 0.6;
        const h = w * this.aspect;
        let x = vx * S + (dx / len) * w * 0.2;
        let y = vy * S + (dy / len) * w * 0.2 + h / 2;
        if (sw || se) y = Math.min(y, vy * S - 4);
        if (n === 3) {
          // 안으로 꺾인 모서리 (구름 조각 하나): 구름을 그 조각 안에 두고 가진 땅 쪽으로는 조금만 (EDGE_POKE) 삐져나오게.
          const qx = !nw || !sw ? -1 : 1;
          const qy = !nw || !ne ? -1 : 1;
          x = vx * S + qx * (w / 2 - EDGE_POKE);
          y = qy > 0 ? vy * S + h - EDGE_POKE : vy * S - 4;
        }
        want.set(`c:${vx}:${vy}`, { x, y, w, ph: rng.next() * Math.PI * 2 });
      }
    }
    const animate = added.length > 0;
    const centers = added.map((ci) => ({ x: ((ci % CHUNKS.w) + 0.5) * S, y: (Math.floor(ci / CHUNKS.w) + 0.5) * S }));
    const have = new Set<string>();
    for (const band of this.bands) {
      for (let k = band.puffs.length - 1; k >= 0; k--) {
        const p = band.puffs[k] as Puff;
        if (p.kind !== 'edge' || p.state === 'out') continue;
        if (want.has(p.key)) {
          have.add(p.key);
          continue;
        }
        if (!animate) {
          this.dropPuff(band, k);
          continue;
        }
        // 가장 가까운 산 조각에서 멀어지는 쪽으로 (옆으로 더) 갈라진다.
        let best = centers[0] ?? { x: p.x, y: p.y };
        let bd = Infinity;
        for (const c of centers) {
          const d = Math.hypot(p.x - c.x, p.y - c.y);
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
        const dx = p.x - best.x;
        const dy = p.y - p.h / 2 - best.y;
        const len = Math.hypot(dx * 1.6, dy * 0.6) || 1;
        p.state = 'out';
        p.t = 0;
        p.delay = 0.05 + Math.random() * 0.2;
        p.mx = ((dx * 1.6) / len) * PART_DIST * 0.8;
        p.my = ((dy * 0.6) / len) * PART_DIST * 0.8;
      }
    }
    for (const [key, s] of want) {
      if (have.has(key)) continue;
      const p = this.addPuff('edge', key, s.x, s.y, s.w, s.ph, 0);
      if (animate) {
        p.state = 'in';
        p.delay = IN_DELAY + Math.random() * 0.3;
        p.sp.alpha = 0;
      }
    }
  }

  /** 떠도는 구름 (띠마다 몇 개, 씨앗 난수 자리). */
  private makeDrift(): void {
    const rng = new Rng(0xd21f7);
    for (let b = 0; b < BAND_COUNT; b++) {
      const band = this.bands[b] as Band;
      for (let k = 0; k < DRIFT_PER_BAND; k++) {
        const w = DRIFT_W[0] + rng.next() * (DRIFT_W[1] - DRIFT_W[0]);
        const h = w * this.aspect;
        const x = -MARGIN + ((k + rng.next() * 0.8) / DRIFT_PER_BAND) * (WORLD.w + 2 * MARGIN);
        const y = band.y0 + h * 0.8 + rng.next() * (S - h * 0.8 - 6);
        const speed = DRIFT_SPEED[0] + rng.next() * (DRIFT_SPEED[1] - DRIFT_SPEED[0]);
        this.addPuff('drift', '', x, y, w, rng.next() * 6.28, speed);
      }
    }
  }

  /** 구름 하나를 아래 끝 y가 든 띠에 넣는다. */
  private addPuff(kind: PuffKind, key: string, x: number, y: number, w: number, ph: number, speed: number): Puff {
    const bi = clamp(Math.floor((y - 1) / S) - BAND_FIRST, 0, BAND_COUNT - 1);
    const band = this.bands[bi] as Band;
    const sp = new Sprite(this.cloudTex);
    sp.anchor.set(0.5, 1);
    const flip = hash2(Math.round(x), Math.round(y), 0x5eed) & 1 ? -1 : 1;
    const k = w / Math.max(1, this.cloudTex.width);
    sp.scale.set(k * flip, k);
    sp.position.set(x, y);
    sp.zIndex = y;
    sp.eventMode = 'none';
    band.node.addChild(sp);
    const p: Puff = { sp, kind, key, x, y, w, h: w * this.aspect, flip, ph, speed, state: 'on', t: 0, delay: 0, mx: 0, my: 0, a: kind === 'drift' ? 0 : 1, covers: false };
    band.puffs.push(p);
    return p;
  }

  private dropPuff(band: Band, k: number): void {
    const p = band.puffs[k] as Puff;
    p.sp.destroy();
    band.puffs.splice(k, 1);
  }

  /** 안개 텍셀 사각형을 바이트로 옮기고 텍스처를 다시 올린다. */
  private upload(i0: number, i1: number, j0: number, j1: number): void {
    const r = (CLOUD_FILL >> 16) & 0xff;
    const g = (CLOUD_FILL >> 8) & 0xff;
    const b = CLOUD_FILL & 0xff;
    const c = this.cur;
    const out = this.bytes;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * FW + i;
        const a = c[k] as number;
        const o = k * 4;
        out[o] = Math.round(r * a);
        out[o + 1] = Math.round(g * a);
        out[o + 2] = Math.round(b * a);
        out[o + 3] = Math.round(255 * a);
      }
    }
    this.source.update();
  }

  // ── 매 프레임 ──

  /** 짓기 모드(놓기·옮기기·길): 가장자리 구름을 옅게 해 가진 땅 끝 칸이 보이게 (world.ts). */
  setSeeThrough(on: boolean): void {
    this.seeGoal = on ? 1 : 0;
  }

  update(dt: number, view: ViewRect): void {
    this.time += dt;
    const v = this.sim.village();
    if (v.stamp.land !== this.landStamp) this.sync(v);
    const cs = `${v.stamp.place}:${v.stamp.road}:${v.stamp.land}`;
    if (cs !== this.coverStamp) {
      this.coverStamp = cs;
      this.syncCovers(v);
    }
    this.stepPart(dt);
    this.see += (this.seeGoal - this.see) * Math.min(1, dt * 6);
    if (Math.abs(this.seeGoal - this.see) < 0.002) this.see = this.seeGoal;
    const edgeAlpha = 1 - SEE_THROUGH * this.see;
    const t = this.time;
    const W = WORLD.w + 2 * MARGIN;
    for (const band of this.bands) {
      // 띠 묶음: 안개 + 구름 (구름은 위로 띠 하나쯤 삐져나온다).
      const on = band.y1 >= view.y0 && band.y0 - S <= view.y1;
      band.node.visible = on;
      for (let k = band.puffs.length - 1; k >= 0; k--) {
        const p = band.puffs[k] as Puff;
        let x = p.x;
        let y = p.y;
        let alpha = 1;
        let s = 1;
        if (p.kind === 'drift') {
          p.x += p.speed * dt;
          if (p.x - p.w / 2 > WORLD.w + MARGIN) p.x -= W + p.w;
          x = p.x;
          // 안개가 짙은 곳에서만 (구름 양끝·가운데·위를 재서 가장 옅은 곳).
          const hw = p.w * 0.45;
          const my = y - p.h * 0.5;
          const f = Math.min(this.fogAt(x - hw, my), this.fogAt(x, my), this.fogAt(x + hw, my), this.fogAt(x, y - p.h * 0.95), this.fogAt(x, y));
          const goal = clamp((f - 0.6) / 0.35, 0, 1);
          p.a += (goal - p.a) * Math.min(1, dt * 2.5);
          alpha = p.a;
        } else {
          x += Math.sin(t * 0.13 + p.ph) * 12;
          y -= (1 + Math.cos(t * 0.1 + p.ph)) * 3;
          if (p.kind === 'edge') alpha = edgeAlpha * (p.covers ? COVER_ALPHA : 1);
        }
        if (p.state === 'in') {
          p.t += dt;
          const u = clamp((p.t - p.delay) / IN_SEC, 0, 1);
          alpha *= u;
          s = 0.86 + 0.14 * outCubic(u);
          if (u >= 1) p.state = 'on';
        } else if (p.state === 'out') {
          p.t += dt;
          const u = clamp((p.t - p.delay) / PART_SEC, 0, 1);
          const e = outCubic(u);
          x += p.mx * e;
          y += p.my * e;
          alpha *= 1 - u * u;
          s = 1 + 0.14 * e;
          if (u >= 1) {
            this.dropPuff(band, k);
            continue;
          }
        }
        const vis = on && alpha > 0.01 && x + p.w * 0.6 * s >= view.x0 && x - p.w * 0.6 * s <= view.x1 && y >= view.y0 && y - p.h * s <= view.y1;
        p.sp.visible = vis;
        if (!vis) continue;
        p.sp.alpha = alpha;
        const k2 = (p.w / Math.max(1, this.cloudTex.width)) * s;
        p.sp.scale.set(k2 * p.flip, k2);
        p.sp.position.set(x, y);
      }
    }
  }

  /** 가장자리 구름마다: 가진 땅의 건물·장식·길 칸에 걸쳤나 (구름 그림의 짙은 몸통 상자로 잰다). */
  private syncCovers(v: Village): void {
    for (const band of this.bands) {
      for (const p of band.puffs) {
        if (p.kind !== 'edge') continue;
        const x0 = Math.floor((p.x - p.w * 0.4) / CELL);
        const x1 = Math.floor((p.x + p.w * 0.4) / CELL);
        const y0 = Math.floor((p.y - p.h * 0.85) / CELL);
        const y1 = Math.floor((p.y - p.h * 0.12) / CELL);
        let hit = false;
        for (let y = y0; y <= y1 && !hit; y++) {
          for (let x = x0; x <= x1 && !hit; x++) {
            if (!v.isOwned(x, y)) continue;
            if (v.at(x, y) !== undefined || v.isRoad(x, y)) hit = true;
          }
        }
        p.covers = hit;
      }
    }
  }

  /** 땅을 산 뒤 안개 걷기: 산 조각 가운데에서 가까운 텍셀부터. */
  private stepPart(dt: number): void {
    const P = this.part;
    if (P === null) return;
    P.t += dt;
    let done = true;
    const reach = S * 0.75;
    for (let j = P.j0; j <= P.j1; j++) {
      const py = j * FOG_TEXEL + FOG_TEXEL / 2 - MARGIN;
      for (let i = P.i0; i <= P.i1; i++) {
        const k = j * FW + i;
        const to = this.target[k] as number;
        const from = P.from[k] as number;
        if (from === to) {
          this.cur[k] = to;
          continue;
        }
        const px = i * FOG_TEXEL + FOG_TEXEL / 2 - MARGIN;
        let d = Infinity;
        for (const c of P.centers) d = Math.min(d, Math.hypot(px - c.x, py - c.y));
        const u = clamp((P.t - PART_SPREAD * Math.min(1.4, d / reach)) / PART_FADE, 0, 1);
        if (u < 1) done = false;
        this.cur[k] = from + (to - from) * outCubic(u);
      }
    }
    this.upload(P.i0, P.i1, P.j0, P.j1);
    if (done) {
      this.cur.set(this.target);
      this.part = null;
    }
  }

  /** WebGL 문맥을 되찾은 뒤: 코드로 구운 구름(그림이 없을 때)을 다시 굽고, 안개 텍스처를 다시 올린다. */
  restoreTextures(): void {
    this.source.update();
    if (!this.ownCloudTex) return;
    const tex = this.makeCloudTex();
    for (const b of this.bands) for (const p of b.puffs) p.sp.texture = tex;
    this.cloudTex.destroy(true);
    this.cloudTex = tex;
  }

  destroy(): void {
    this.objects.removeChild(this.far);
    this.far.destroy();
    for (const b of this.bands) {
      this.objects.removeChild(b.node);
      b.node.destroy({ children: true });
    }
    this.bands.length = 0;
    this.source.destroy();
    if (this.ownCloudTex) this.cloudTex.destroy(true);
  }
}
