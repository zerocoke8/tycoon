// 바닥 (풀밭·길·광장·경주로·연못): 코드로 그리고 RenderTexture 타일로 굽는다. map.ts 머리말과 GROUND_STYLE 그대로:
// 모든 길·광장의 테두리를 먼저, 속을 나중에 (둥근 끝·이음) → 길이 만나는 곳에 선이 생기지 않는다.
// 연못은 씨앗 난수로 울퉁불퉁한 덩어리, 길 위 조약돌 점과 풀밭의 풀 한 포기는 칸마다 씨앗 난수로 흩뿌린다.
//
// 굽는 해상도 (텍셀 / 세계 px) 고르기:
//   - 타일 한 변 256 세계 px. 해상도는 지금 확대 × 기기 배율(dpr)에 맞춰 0.25·0.5·0.75·1·1.5·2 가운데 하나
//     (화면 화소당 텍셀이 0.8 이상이 되는 가장 작은 단계). 그래서 어느 확대에서도 또렷하고, 텍셀 수는 화면 화소의 약 1.5배 안쪽.
//   - 최대 2: 확대 1.6 × dpr 2 (= 3.2)에서는 1.6배로 늘려 보이지만, 바닥은 납작한 색과 두꺼운 선이라 충분히 또렷하다.
//     2보다 올리면 타일 하나가 4배 커진다.
//   - 타일은 보일 때 굽고, 확대 단계가 올라가면 그 타일만 다시 굽는다. 필요한 것보다 2배 넘게 고운 타일은
//     (멀리 줄였을 때) 프레임마다 조금씩 낮춰 굽는다. 텍셀이 상한(화면 화소의 약 3배, 최소 4M)을 넘으면 오래 안 본 타일부터 버린다.
//     지도가 아무리 커져도 메모리는 화면 크기에 묶인다.
//   - 테두리 선이 계단지지 않게 MSAA 굽기 판 하나(지금 쓰는 단계 크기)에 그린 다음 타일로 옮긴다 (타일마다 MSAA 버퍼를 들고 있지 않게).
//   - WebGL 문맥을 잃었다 되찾으면(폰에서 앱을 오가면 흔하다) 구운 타일이 비므로 invalidate()로 모두 다시 굽는다.

import { Container, Graphics, Matrix, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js';
import { GROUND_STYLE, PLAZAS, PONDS, RACE_TRACK, ROADS, WORLD, trackPoint, type Pt } from '../data/map.ts';
import { Rng } from '../core/rng.ts';
import { artTexture } from './art.ts';
import { RACE_START_P, TRACK_BAND, hash2, inPlaza, inPond, onGrass, onTrack, roadSignedDist, type ViewRect } from './mapUtil.ts';

/** 타일 한 변 (세계 px). */
export const GROUND_TILE = 256;
const T = GROUND_TILE;
/** 굽는 해상도 단계. */
const LEVELS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;
/** 들고 있을 타일 텍셀 상한: 화면 기기 화소 × 이 배수 (최소 MIN_TEXELS, RGBA 4바이트). */
const TEXEL_SCREENS = 3;
const MIN_TEXELS = 4_000_000;
const SEED = 0x6b0d;
/** 칸(타일)마다 조약돌·풀 시도 수. */
const PEBBLE_TRIES = 3;
const TUFT_CHANCE = 0.38;
const TUFT_PAIR_CHANCE = 0.35;
/** 풀 한 포기 크기 (세계 px, 폭). */
const TUFT_W = 38;
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

function levelFor(s: number): number {
  for (const r of LEVELS) if (r >= s * 0.8) return r;
  return LEVELS[LEVELS.length - 1] as number;
}

interface Tile {
  readonly i: number;
  readonly j: number;
  readonly sprite: Sprite;
  rt: RenderTexture | null;
  res: number;
  seen: number;
  /** 굽기 순서 점수 (작을수록 먼저). */
  score: number;
}

/** 연못 둘레 점 (씨앗 난수로 울퉁불퉁). */
function pondOutline(c: Pt, rx: number, ry: number, seed: number, wobble = 1): number[] {
  const rng = new Rng(seed);
  const p1 = rng.next() * Math.PI * 2;
  const p2 = rng.next() * Math.PI * 2;
  const p3 = rng.next() * Math.PI * 2;
  const a1 = (0.07 + rng.next() * 0.05) * wobble;
  const a2 = (0.05 + rng.next() * 0.04) * wobble;
  const a3 = (0.02 + rng.next() * 0.03) * wobble;
  const n = 44;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const r = 1 + a1 * Math.sin(2 * t + p1) + a2 * Math.sin(3 * t + p2) + a3 * Math.sin(5 * t + p3);
    pts.push(c.x + Math.cos(t) * rx * r, c.y + Math.sin(t) * ry * r);
  }
  return pts;
}

/** 점들을 지나는 매끈한 닫힌 곡선 (중점 사이를 2차 곡선으로). */
function smoothClosed(g: Graphics, pts: readonly number[]): Graphics {
  const n = pts.length / 2;
  const px = (i: number): number => pts[((i + n) % n) * 2] as number;
  const py = (i: number): number => pts[((i + n) % n) * 2 + 1] as number;
  g.moveTo((px(-1) + px(0)) / 2, (py(-1) + py(0)) / 2);
  for (let i = 0; i < n; i++) g.quadraticCurveTo(px(i), py(i), (px(i) + px(i + 1)) / 2, (py(i) + py(i + 1)) / 2);
  return g.closePath();
}

function roadPath(g: Graphics, pts: readonly Pt[]): Graphics {
  const first = pts[0];
  if (first === undefined) return g;
  g.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i] as Pt;
    g.lineTo(p.x, p.y);
  }
  return g;
}

// ── 경주로 (몬스터 경주장, map.ts RACE_TRACK) ──
// 길과 같은 모래·테두리로 타원 띠를 그리고 (길 테두리를 다 그린 뒤 속을 그리므로 닿는 길과 자연스럽게 이어진다),
// 띠 안쪽은 테두리 + 풀밭, 레인 사이에 크림색 선, 출발선(크림 띠)과 결승선(바둑판 두 줄)을 바닥에 그린다.

/** 레인 선·출발선 색과 굵기 (세계 px). */
const LANE_LINE = 0xfff6e2;
const LANE_LINE_W = 5;
const START_LINE_W = 11;
/** 결승선 바둑판 한 칸 (세계 px, 대략: 띠 폭을 나눠 떨어지게 맞춘다). */
const CHECKER = 16;

/** 경주로 각도 a의 안쪽 가장자리 → 바깥 가장자리 점 (띠를 가로지르는 선). */
function bandSpan(a: number): { ix: number; iy: number; ox: number; oy: number } {
  const B = TRACK_BAND;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { ix: B.cx + c * B.rxIn, iy: B.cy + s * B.ryIn, ox: B.cx + c * B.rxOut, oy: B.cy + s * B.ryOut };
}

/** 경주로 p의 각도 (map.ts trackPoint와 같은 식). */
function trackAngle(p: number): number {
  return RACE_TRACK.startAngle + (RACE_TRACK.endAngle - RACE_TRACK.startAngle) * p;
}

/** 띠 속 위의 표시: 레인 선, 출발선, 결승선 바둑판. */
function drawTrackMarks(g: Graphics): void {
  const T = RACE_TRACK;
  const B = TRACK_BAND;
  // 레인 사이 선 (레인 가운데 선에서 반 레인씩 바깥).
  for (let i = 1; i < T.lanes; i++) {
    const o = (i - T.lanes / 2) * T.laneWidth;
    g.ellipse(B.cx, B.cy, T.rx + o, T.ry + o * T.squash).stroke({ width: LANE_LINE_W, color: LANE_LINE, alpha: 0.85 });
  }
  // 출발선: 출발대 바로 앞 (mapUtil RACE_START_P).
  const st = bandSpan(trackAngle(RACE_START_P));
  g.moveTo(st.ix, st.iy).lineTo(st.ox, st.oy).stroke({ width: START_LINE_W, color: LANE_LINE, cap: 'butt' });
  // 결승선: 띠를 가로지르는 바둑판 두 줄 (달리는 쪽으로 한 칸씩 앞뒤).
  const fa = trackAngle(1);
  const fs = bandSpan(fa);
  const dir = trackPoint(0, 1);
  const len = Math.hypot(fs.ox - fs.ix, fs.oy - fs.iy);
  const n = Math.max(2, Math.round(len / CHECKER));
  const ux = (fs.ox - fs.ix) / n;
  const uy = (fs.oy - fs.iy) / n;
  const cw = CHECKER * 0.9;
  const tx = dir.dx * cw;
  const ty = dir.dy * cw;
  for (let i = 0; i < n; i++) {
    for (let j = -1; j < 1; j++) {
      const x0 = fs.ix + ux * i + tx * j;
      const y0 = fs.iy + uy * i + ty * j;
      g.poly([x0, y0, x0 + ux, y0 + uy, x0 + ux + tx, y0 + uy + ty, x0 + tx, y0 + ty]).fill((i + j) % 2 === 0 ? GROUND_STYLE.roadEdge : LANE_LINE);
    }
  }
}

/** 바닥 전체 (한 번 만든다): 풀밭, 길·광장·경주로 테두리 → 속, 경주로 안쪽 풀밭과 표시, 연못. */
function buildBase(): Graphics {
  const S = GROUND_STYLE;
  const B = TRACK_BAND;
  const g = new Graphics();
  g.rect(0, 0, WORLD.w, WORLD.h).fill(S.grass);
  for (const r of ROADS) roadPath(g, r.pts).stroke({ width: r.w + S.edge * 2, color: S.roadEdge, cap: 'round', join: 'round' });
  for (const p of PLAZAS) g.ellipse(p.c.x, p.c.y, p.rx + S.edge, p.ry + S.edge).fill(S.roadEdge);
  g.ellipse(B.cx, B.cy, B.rxOut + S.edge, B.ryOut + S.edge).fill(S.roadEdge);
  for (const r of ROADS) roadPath(g, r.pts).stroke({ width: r.w, color: S.road, cap: 'round', join: 'round' });
  for (const p of PLAZAS) g.ellipse(p.c.x, p.c.y, p.rx, p.ry).fill(S.road);
  g.ellipse(B.cx, B.cy, B.rxOut, B.ryOut).fill(S.road);
  g.ellipse(B.cx, B.cy, B.rxIn, B.ryIn).fill(S.roadEdge);
  g.ellipse(B.cx, B.cy, B.rxIn - S.edge, B.ryIn - S.edge).fill(S.grass);
  drawTrackMarks(g);
  PONDS.forEach((p, i) => {
    const pts = pondOutline(p.c, p.rx, p.ry, hash2(i, 77, SEED), p.wobble ?? 1);
    smoothClosed(g, pts).stroke({ width: S.edge * 2, color: S.roadEdge, join: 'round' });
    smoothClosed(g, pts).fill(S.pond);
  });
  return g;
}

export class GroundView {
  /** 카메라 안에 넣는다 (세계 좌표). */
  readonly node = new Container();
  private readonly renderer: Renderer;
  private readonly cols: number;
  private readonly rows: number;
  private readonly tiles: (Tile | null)[];
  private readonly tileLayer = new Container();
  /** 굽는 무대: 바닥 전체 + 이번 타일의 조약돌·풀. */
  private readonly bakeRoot = new Container();
  private readonly scatter = new Graphics();
  private readonly tuftLayer = new Container();
  private readonly tuftPool: Sprite[] = [];
  private tuftUsed = 0;
  private readonly tuftTex: Texture | undefined;
  /** MSAA 굽기 판 하나와 그 해상도. */
  private bakeRt: RenderTexture | null = null;
  private bakeRes = 0;
  /** 텍셀 상한 (화면 크기로 정한다). */
  private maxTexels = MIN_TEXELS;
  private readonly copySprite = new Sprite();
  private readonly m = new Matrix();
  private readonly identity = new Matrix();
  private readonly rng = new Rng(1);
  private shown: Tile[] = [];
  private nextShown: Tile[] = [];
  private readonly queue: Tile[] = [];
  private texels = 0;
  private frame = 0;
  private first = true;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.cols = Math.ceil(WORLD.w / T);
    this.rows = Math.ceil(WORLD.h / T);
    this.tiles = new Array<Tile | null>(this.cols * this.rows).fill(null);
    this.tuftTex = artTexture('map', 'tuft');

    // 타일이 구워지기 전에 비치는 풀밭.
    const under = new Graphics().rect(0, 0, WORLD.w, WORLD.h).fill(GROUND_STYLE.grass);
    this.node.addChild(under, this.tileLayer);
    this.node.eventMode = 'none';
    this.tileLayer.eventMode = 'none';

    this.bakeRoot.addChild(buildBase(), this.scatter, this.tuftLayer);
  }

  /** WebGL 문맥을 되찾은 뒤: 구운 타일을 모두 잊고 다음 프레임에 보이는 것부터 다시 굽는다. */
  invalidate(): void {
    for (const t of this.tiles) {
      if (t === null) continue;
      t.rt?.destroy(true);
      t.rt = null;
      t.res = 0;
      t.sprite.texture = Texture.EMPTY;
      t.sprite.visible = false;
    }
    this.texels = 0;
    this.bakeRt?.destroy(true);
    this.bakeRt = null;
    this.bakeRes = 0;
    this.first = true;
  }

  /** 보이는 타일을 보이게 하고, 필요한 만큼 굽는다. view = 세계 좌표 사각형, scale = 확대 × dpr. */
  update(view: ViewRect, scale: number): void {
    const frame = ++this.frame;
    const want = levelFor(scale);
    // 화면 기기 화소 = (보이는 세계 폭 × 높이) × scale².
    const screenTexels = (view.x1 - view.x0) * (view.y1 - view.y0) * scale * scale;
    this.maxTexels = Math.max(MIN_TEXELS, screenTexels * TEXEL_SCREENS);
    const pad = T * 0.5;
    const i0 = Math.max(0, Math.floor((view.x0 - pad) / T));
    const i1 = Math.min(this.cols - 1, Math.floor((view.x1 + pad) / T));
    const j0 = Math.max(0, Math.floor((view.y0 - pad) / T));
    const j1 = Math.min(this.rows - 1, Math.floor((view.y1 + pad) / T));
    const cx = (view.x0 + view.x1) / 2;
    const cy = (view.y0 + view.y1) / 2;
    const over = this.texels > this.maxTexels;

    const next = this.nextShown;
    next.length = 0;
    const q = this.queue;
    q.length = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const idx = i + j * this.cols;
        let tile = this.tiles[idx] ?? null;
        if (tile === null) {
          const sprite = new Sprite();
          sprite.cullable = true;
          sprite.position.set(i * T, j * T);
          sprite.visible = false;
          sprite.eventMode = 'none';
          this.tileLayer.addChild(sprite);
          tile = { i, j, sprite, rt: null, res: 0, seen: 0, score: 0 };
          this.tiles[idx] = tile;
        }
        tile.seen = frame;
        next.push(tile);
        if (tile.rt !== null) tile.sprite.visible = true;
        // 굽기 순서: 없는 타일 → 흐린 타일 → 너무 고운 타일 (2배 넘게, 또는 메모리가 넘칠 때). 같은 무리 안에서는 화면 가운데부터.
        const dx = (i + 0.5) * T - cx;
        const dy = (j + 0.5) * T - cy;
        const d = Math.sqrt(dx * dx + dy * dy) / T;
        if (tile.rt === null) tile.score = d;
        else if (tile.res < want) tile.score = 1000 + d;
        else if (tile.res >= want * 2 || (over && tile.res > want)) tile.score = 2000 + d;
        else continue;
        q.push(tile);
      }
    }
    // 이번에 안 보이는 타일은 숨긴다.
    const old = this.shown;
    for (let k = 0; k < old.length; k++) {
      const t = old[k] as Tile;
      if (t.seen !== frame) t.sprite.visible = false;
    }
    this.nextShown = this.shown;
    this.shown = next;

    if (q.length > 0) {
      q.sort(byScore);
      // 처음 한 번은 보이는 것을 모두 (풀밭만 보이는 순간이 없게), 그다음은 프레임마다 조금씩.
      // 흐린 단계(작은 타일)는 굽는 값이 싸니 더 많이.
      let missing = this.first ? 1e9 : want <= 0.5 ? 16 : 6;
      let other = 2;
      for (let k = 0; k < q.length; k++) {
        const t = q[k] as Tile;
        if (t.rt === null) {
          if (missing-- <= 0) continue;
        } else if (other-- <= 0) break;
        this.bake(t, want);
        t.sprite.visible = true;
      }
    }
    this.first = false;
    if (this.texels > this.maxTexels) this.evict(frame);
  }

  /** MSAA 굽기 판: 하나만 들고 있고, 단계가 바뀌면 그 크기로 새로 만든다 (단계마다 판을 쌓아 두지 않게). */
  private bakeTarget(res: number): RenderTexture {
    if (this.bakeRt !== null && this.bakeRes === res) return this.bakeRt;
    this.bakeRt?.destroy(true);
    this.bakeRt = RenderTexture.create({ width: T, height: T, resolution: res, antialias: true });
    this.bakeRes = res;
    return this.bakeRt;
  }

  private bake(tile: Tile, res: number): void {
    const x0 = tile.i * T;
    const y0 = tile.j * T;
    this.drawScatter(tile.i, tile.j);
    // 1) MSAA 판에 그리고 2) 타일 텍스처로 옮긴다.
    const work = this.bakeTarget(res);
    this.m.set(1, 0, 0, 1, -x0, -y0);
    this.renderer.render({ container: this.bakeRoot, target: work, clear: true, clearColor: CLEAR, transform: this.m });
    let rt = tile.rt;
    if (rt === null || tile.res !== res) {
      rt = RenderTexture.create({ width: T, height: T, resolution: res });
      if (tile.rt !== null) {
        this.texels -= (T * tile.res) ** 2;
        tile.rt.destroy(true);
      }
      tile.rt = rt;
      tile.res = res;
      this.texels += (T * res) ** 2;
    }
    this.copySprite.texture = work;
    this.renderer.render({ container: this.copySprite, target: rt, clear: true, clearColor: CLEAR, transform: this.identity });
    tile.sprite.texture = rt;
  }

  /** 오래 안 본 타일부터 버린다. */
  private evict(frame: number): void {
    while (this.texels > this.maxTexels) {
      let oldest: Tile | null = null;
      for (const t of this.tiles) {
        if (t === null || t.rt === null || t.seen === frame) continue;
        if (oldest === null || t.seen < oldest.seen) oldest = t;
      }
      if (oldest === null || oldest.rt === null) return;
      this.texels -= (T * oldest.res) ** 2;
      oldest.sprite.visible = false;
      oldest.sprite.texture = Texture.EMPTY;
      oldest.rt.destroy(true);
      oldest.rt = null;
      oldest.res = 0;
    }
  }

  // ── 조약돌·풀 (칸마다 같은 씨앗 → 이웃 타일과 이어진다) ──

  private drawScatter(ti: number, tj: number): void {
    const g = this.scatter;
    g.clear();
    this.tuftUsed = 0;
    for (let cj = tj - 1; cj <= tj + 1; cj++) for (let ci = ti - 1; ci <= ti + 1; ci++) this.scatterCell(g, ci, cj);
    for (let k = this.tuftUsed; k < this.tuftPool.length; k++) (this.tuftPool[k] as Sprite).visible = false;
  }

  private scatterCell(g: Graphics, ci: number, cj: number): void {
    if (ci < 0 || cj < 0 || ci >= this.cols || cj >= this.rows) return;
    const S = GROUND_STYLE;
    const rng = this.rng;
    rng.state = hash2(ci, cj, SEED);
    const ox = ci * T;
    const oy = cj * T;
    // 길 위 조약돌 점. 받아들이든 말든 난수를 같은 수만큼 쓴다 (그래야 칸 모양이 늘 같다).
    for (let k = 0; k < PEBBLE_TRIES; k++) {
      const x = ox + rng.next() * T;
      const y = oy + rng.next() * T;
      const rx = 7 + rng.next() * 4;
      const ry = rx * (0.62 + rng.next() * 0.15);
      // 경주로는 고른 모래 (레인 선 위에 조약돌이 얹히지 않게).
      if ((roadSignedDist(x, y) < -16 || inPlaza(x, y, -26)) && !inPond(x, y, 10) && !onTrack(x, y, 14)) g.ellipse(x, y, rx, ry).fill(S.pebble);
    }
    // 풀밭의 풀 한 포기 (가끔 둘).
    const tx = ox + rng.next() * T;
    const ty = oy + rng.next() * T;
    const s = 0.85 + rng.next() * 0.3;
    const flip = rng.next() < 0.5 ? -1 : 1;
    const ok = rng.next() < TUFT_CHANCE;
    const pair = rng.next() < TUFT_PAIR_CHANCE;
    const px = tx + (rng.next() < 0.5 ? -1 : 1) * (26 + rng.next() * 16);
    const py = ty + (rng.next() - 0.5) * 18;
    if (ok && onGrass(tx, ty, 26)) {
      this.tuft(g, tx, ty, s, flip);
      if (pair && onGrass(px, py, 26)) this.tuft(g, px, py, s * 0.85, -flip);
    }
  }

  private tuft(g: Graphics, x: number, y: number, s: number, flip: number): void {
    const tex = this.tuftTex;
    if (tex !== undefined) {
      let sp = this.tuftPool[this.tuftUsed];
      if (sp === undefined) {
        sp = new Sprite(tex);
        sp.anchor.set(0.5, 1);
        this.tuftPool.push(sp);
        this.tuftLayer.addChild(sp);
      }
      this.tuftUsed++;
      sp.visible = true;
      sp.position.set(x, y);
      const k = (TUFT_W * s) / Math.max(1, tex.width);
      sp.scale.set(k * flip, k);
      return;
    }
    // 짧은 획 셋 (가운데는 곧게, 양옆은 바깥으로).
    const f = flip;
    g.moveTo(x - 9 * s * f, y)
      .lineTo(x - 15 * s * f, y - 14 * s)
      .moveTo(x, y - 1 * s)
      .lineTo(x + 1 * s * f, y - 20 * s)
      .moveTo(x + 9 * s * f, y)
      .lineTo(x + 14 * s * f, y - 15 * s)
      .stroke({ width: 5.5 * s, color: GROUND_STYLE.tuft, cap: 'round' });
  }

  destroy(): void {
    for (const t of this.tiles) t?.rt?.destroy(true);
    this.bakeRt?.destroy(true);
    this.bakeRt = null;
    this.bakeRoot.destroy({ children: true });
    this.copySprite.destroy();
    this.node.destroy({ children: true });
  }
}

function byScore(a: Tile, b: Tile): number {
  return a.score - b.score;
}
