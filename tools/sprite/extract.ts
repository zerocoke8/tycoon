// Seedance 영상(MP4, 마젠타 바탕) → 투명 프레임 → 스프라이트 시트(WebP/PNG) + PixiJS v8 스프라이트시트 JSON.
//   node tools/sprite/extract.ts <영상.mp4> [옵션]
//   예) node tools/sprite/extract.ts tools/anim-raw/dragon/idle.mp4
//       (종·클립은 옆의 idle.task.json 또는 폴더/파일 이름에서, 캔버스 대응은 prepare의 JSON에서 찾는다)
//
// 쓰는 곳: <out-root>/<species>/<clip>.webp, <clip>.json, 그리고 <out-root>/index.json (게임의 view/anim.ts가 읽는 목록).
//   out-root 기본 public/assets/anim.
//
// 차례:
//   1) ffmpeg: fps 필터로 프레임을 고르고 (기본 12) yuv444p 전 범위로 풀어 Node로 흘린다 (rawvideo 파이프).
//   2) key.ts: 마젠타 빼기 (밝기 알파 + 외곽선 색으로 가장자리 정리 + 바탕 빼기·마젠타 기운 빼기 + 잡티 섬 지우기).
//   3) 되풀이 클립이면 첫 프레임과 가장 닮은 뒤쪽 프레임을 찾아 거기서 자른다 (이음매).
//   4) 남은 모든 프레임의 알파 사각형을 합친 '클립 공통 상자'로 자른다 → 프레임끼리 흔들리지 않는다.
//   5) 칸 높이(--cell-h)에 맞춰 넓이 평균으로 줄이고 (미리 곱한 알파), 격자로 붙여 ffmpeg로 인코딩.
//   6) JSON: frames(이름 <species>_<clip>_000…, anchor = 발), animations { <clip>: [...] }, meta.image/size/scale,
//      meta.clip { fps, loop, anchor, … }.
//      meta.scale = 칸 px / 캔버스 px. Pixi는 이것을 텍스처 해상도로 쓰므로 텍스처 크기가 '캔버스 단위'가 된다:
//      게임에서 sprite.scale = ART_SCALE.monster (정지 그림과 같은 k) 하나로 크기가 맞는다.
//
// 옵션:
//   --prep FILE.json   prepare의 기록 (발 기준점·캔버스 대응). 기본: <영상>.task.json의 prep → tools/anim-raw/prep/<species>_<pose>.json
//   --species S --clip C
//   --fps N            시트 프레임 속도 (기본: 프리셋, 없으면 12). 0이면 영상 그대로.
//   --cell-h N         칸 높이 px (여백 포함, 기본 320)
//   --scale S          칸 px / 캔버스 px로 크기를 정한다 (--cell-h 대신; 종의 클립끼리 선명도를 맞출 때)
//   --pad N            칸 둘레 투명 여백 px (기본 6: 밉맵이 이웃 칸을 끌어오지 않게)
//   --loop auto|on|off 이음매 자르기 (기본 auto = 프리셋의 loop)
//   --trim A:B         프레임 A부터 B 앞까지만 (fps 적용 뒤 번호). 되풀이 자르기보다 먼저.
//   --out-root DIR     (기본 public/assets/anim)
//   --format webp|png  (기본 webp)   --quality Q (WebP, 기본 90)
//   --max-atlas N      시트 한 변 최대 px (기본 4096). 넘으면 칸을 줄인다.
//   --matrix auto|601|709|2020   YCbCr 행렬 (기본 auto: 영상 태그, 없으면 601 = ffmpeg 기본)
//   --outline auto|#rrggbb       외곽선 색 (기본 auto: 첫 프레임에서 잰다)
//   --band N --dkey N --dfg N --min-island N   키잉 세부 (key.ts)
//   --debug            <clip>.preview.png (체크 무늬 위 시트 + 발 기준점 십자)도 쓴다
//   --no-index         index.json을 고치지 않는다

import { basename, dirname, extname, join, resolve } from 'node:path';
import {
  ANIM_OUT,
  ANIM_RAW,
  ensureDir,
  fail,
  fileExists,
  fillTransparent,
  parseArgs,
  parseHex,
  probe,
  readJson,
  rel,
  resampleArea,
  round,
  streamFrames,
  writeImage,
  writeJson,
  type Rgba,
} from './common.ts';
import { DEFAULT_KEY, Keyer, type KeyParams, type Matrix } from './key.ts';
import type { PrepSidecar } from './prepare.ts';
import { clipPreset } from './presets.ts';

export interface ExtractOptions {
  readonly video: string;
  readonly prep?: string;
  readonly species?: string;
  readonly clip?: string;
  readonly fps?: number;
  readonly cellH?: number;
  readonly scale?: number;
  readonly pad?: number;
  readonly loop?: 'auto' | 'on' | 'off';
  readonly trim?: readonly [number, number];
  readonly outRoot?: string;
  readonly format?: 'webp' | 'png';
  readonly quality?: number;
  readonly maxAtlas?: number;
  readonly matrix?: Matrix | 'auto';
  readonly outline?: string;
  readonly key?: Partial<KeyParams>;
  readonly debug?: boolean;
  readonly index?: boolean;
  readonly quiet?: boolean;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Frame {
  readonly box: Box | null;
  readonly crop: Buffer;
  readonly thumb: Float32Array;
}

/** 시트 JSON의 meta.clip (view/anim.ts가 읽는다). */
export interface ClipMeta {
  readonly species: string;
  readonly name: string;
  readonly fps: number;
  readonly loop: boolean;
  readonly frames: number;
  /** 발 기준점 (칸 안의 비율). */
  readonly anchor: { readonly x: number; readonly y: number };
  readonly cell: { readonly w: number; readonly h: number };
  /** 칸 px / 캔버스 px (= meta.scale). */
  readonly scale: number;
  readonly canvas: { readonly w: number; readonly h: number } | null;
  readonly foot: { readonly x: number; readonly y: number } | null;
  readonly source: {
    readonly video: string;
    readonly prep: string | null;
    readonly range: readonly [number, number];
    readonly videoSize: readonly [number, number];
    /** 클립 공통 상자 (영상 px)와 배율 (칸 px / 영상 px) */
    readonly crop: { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly s: number; readonly pad: number };
  };
}

export interface AnimIndexEntry {
  readonly json: string;
  readonly image: string;
  readonly fps: number;
  readonly loop: boolean;
  readonly frames: number;
}

export interface ExtractResult {
  readonly image: string;
  readonly json: string;
  readonly preview: string | null;
  readonly meta: ClipMeta;
  readonly atlas: { readonly w: number; readonly h: number; readonly cols: number; readonly rows: number };
  readonly outlineRgb: readonly number[];
  readonly warnings: readonly string[];
}

const THUMB = 48;

function boxOf(rgba: Buffer, w: number, h: number): Box | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if ((rgba[(row + x) * 4 + 3] ?? 0) === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function cropOf(rgba: Buffer, w: number, b: Box): Buffer {
  const out = Buffer.alloc(b.w * b.h * 4);
  for (let y = 0; y < b.h; y++) rgba.copy(out, y * b.w * 4, ((b.y + y) * w + b.x) * 4, ((b.y + y) * w + b.x + b.w) * 4);
  return out;
}

/** 미리 곱한 RGBA 작은 그림 (0~1). 되풀이 이음매 찾기에 쓴다. */
function thumbOf(img: Rgba): Float32Array {
  const small = resampleArea(img, 0, 0, img.w, img.h, THUMB, THUMB);
  const t = new Float32Array(THUMB * THUMB * 4);
  for (let i = 0; i < THUMB * THUMB; i++) {
    const a = (small[i * 4 + 3] ?? 0) / 255;
    t[i * 4] = ((small[i * 4] ?? 0) / 255) * a;
    t[i * 4 + 1] = ((small[i * 4 + 1] ?? 0) / 255) * a;
    t[i * 4 + 2] = ((small[i * 4 + 2] ?? 0) / 255) * a;
    t[i * 4 + 3] = a;
  }
  return t;
}

function thumbDiff(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return s / a.length;
}

/**
 * 되풀이 이음매: 시작 s(앞 25% 안)와 끝 e(s보다 절반 이상 뒤)의 짝 가운데 두 프레임(과 그 이웃 프레임)이 가장 닮은 짝을 찾는다
 * → [s, e)를 쓴다 (e는 s와 겹치므로 뺀다). Seedance 첫·끝 프레임 모드로 만든 영상이면 보통 s = 0, e = 마지막.
 * 거의 같은 짝이 여럿이면 (느린 대기 동작) 가장 긴 것: 동작을 다 보여 준다.
 */
export function findLoop(thumbs: readonly Float32Array[]): { start: number; end: number; seam: number; step: number } {
  const n = thumbs.length;
  if (n < 4) return { start: 0, end: n, seam: 0, step: 0 };
  const at = (i: number): Float32Array => thumbs[i] as Float32Array;
  const steps: number[] = [];
  for (let i = 1; i < n; i++) steps.push(thumbDiff(at(i - 1), at(i)));
  steps.sort((x, y) => x - y);
  // 한 걸음 = 이웃 프레임 차이의 75번째 백분위 (멈춘 프레임이 많은 클립에서 너무 작게 잡히지 않게).
  const step = steps[Math.floor(steps.length * 0.75)] ?? 0;
  const minLen = Math.max(2, Math.floor(n * 0.5));
  const sMax = Math.floor(n * 0.25);
  const pairs: { s: number; e: number; d: number }[] = [];
  let best = { s: 0, e: n - 1, d: Infinity };
  for (let st = 0; st <= sMax; st++) {
    for (let e = st + minLen; e < n; e++) {
      // 자리뿐 아니라 움직이는 방향도 맞아야 이음매가 안 보인다: 다음(또는 앞) 프레임끼리도 견준다.
      const d0 = thumbDiff(at(e), at(st));
      const dv = e + 1 < n ? thumbDiff(at(e + 1), at(st + 1)) : st >= 1 ? thumbDiff(at(e - 1), at(st - 1)) : d0;
      const q = { s: st, e, d: d0 + 0.5 * dv };
      pairs.push(q);
      if (q.d < best.d) best = q;
    }
  }
  const tol = best.d * 1.25 + step * 0.05 + 1e-4;
  let pick = best;
  for (const q of pairs) {
    if (q.d > tol) continue;
    const len = q.e - q.s;
    const plen = pick.e - pick.s;
    if (len > plen || (len === plen && q.s < pick.s)) pick = q;
  }
  return { start: pick.s, end: pick.e, seam: pick.d, step };
}

/** 격자: 가장 긴 변이 가장 짧게 (같으면 넓이가 작게). */
function packGrid(n: number, cw: number, ch: number): { cols: number; rows: number; w: number; h: number } {
  let best = { cols: n, rows: 1, w: n * cw, h: ch };
  let bestKey = Infinity;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = cols * cw;
    const h = rows * ch;
    const key = Math.max(w, h) * 1e6 + w * h / 1e3;
    if (key < bestKey) {
      bestKey = key;
      best = { cols, rows, w, h };
    }
  }
  return best;
}

function findTask(video: string): Record<string, unknown> | null {
  const p = video.replace(/\.[^.\\/]+$/, '') + '.task.json';
  if (!fileExists(p)) return null;
  try {
    return readJson<Record<string, unknown>>(p);
  } catch {
    return null;
  }
}

function resolvePrep(o: ExtractOptions, species: string, clip: string, task: Record<string, unknown> | null): string | null {
  if (o.prep !== undefined) return resolve(o.prep);
  const tp = task?.prep;
  if (typeof tp === 'string') {
    const abs = resolve(tp);
    if (fileExists(abs)) return abs;
  }
  const pose = clipPreset(clip)?.pose ?? 'base';
  for (const k of [`${species}_${pose}`, `${species}_base`, species]) {
    const p = join(ANIM_RAW, 'prep', `${k}.json`);
    if (fileExists(p)) return p;
  }
  return null;
}

export async function extract(o: ExtractOptions): Promise<ExtractResult> {
  const video = resolve(o.video);
  if (!fileExists(video)) fail(`영상이 없다: ${rel(video)}`);
  const task = findTask(video);
  const species = o.species ?? (typeof task?.species === 'string' ? task.species : basename(dirname(video)));
  const clip = o.clip ?? (typeof task?.clip === 'string' ? task.clip : basename(video, extname(video)));
  const preset = clipPreset(clip);
  const fps = o.fps ?? preset?.fps ?? 12;
  const warnings: string[] = [];
  const warn = (m: string): void => {
    warnings.push(m);
    if (o.quiet !== true) console.warn(`  경고: ${m}`);
  };

  const prepPath = resolvePrep(o, species, clip, task);
  const prep = prepPath === null ? null : readJson<PrepSidecar>(prepPath);
  if (prep === null) warn('prepare 기록(JSON)을 찾지 못했다: 발 기준점 = 첫 프레임 그림의 아래 가운데, 크기 = 영상 px 기준.');

  const info = await probe(video);
  const W = info.width;
  const H = info.height;
  let matrix: Matrix;
  if (o.matrix !== undefined && o.matrix !== 'auto') matrix = o.matrix;
  else if (info.colorSpace === 'bt709') matrix = '709';
  else if (info.colorSpace.startsWith('bt2020')) matrix = '2020';
  else matrix = '601';
  if (prep !== null && Math.abs(W / H - prep.out.w / prep.out.h) > 0.01) warn(`영상 비율 ${W}x${H}가 입력 그림 ${prep.out.w}x${prep.out.h}와 다르다 (모델이 잘랐을 수 있다).`);

  const outline = o.outline === undefined || o.outline === 'auto' ? null : parseHex(o.outline);
  const fallback = prep !== null ? parseHex(prep.outline) : DEFAULT_KEY.outlineFallback;
  const params: KeyParams = { ...DEFAULT_KEY, ...o.key, matrix, outline, outlineFallback: fallback };
  const keyer = new Keyer(W, H, params);

  if (o.quiet !== true) {
    console.log(`풀기: ${rel(video)} (${W}x${H} ${info.codec} ${info.pixFmt} ${info.fps.toFixed(2)}fps ${info.duration.toFixed(2)}s, 색 ${info.colorSpace}/${info.colorRange} → 행렬 ${matrix})`);
  }
  const vf = [...(fps > 0 ? [`fps=${fps}`] : []), 'scale=out_range=full', 'format=yuv444p'].join(',');
  const frames: Frame[] = [];
  let keyWarned = false;
  let edgeWarned = false;
  let worstNoise = 0;
  let minCoverage = 1;
  await streamFrames(['-v', 'error', '-i', video, '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'yuv444p', 'pipe:1'], W * H * 3, (buf) => {
    const { rgba, stats } = keyer.process(buf);
    if (!keyWarned && (stats.key.cb < 30 || stats.key.cr < 30)) {
      keyWarned = true;
      warn(`바탕이 마젠타 같지 않다 (Y ${stats.key.y.toFixed(0)}, Cb ${stats.key.cb.toFixed(0)}, Cr ${stats.key.cr.toFixed(0)}).`);
    }
    if (!edgeWarned && stats.touchesEdge) {
      edgeWarned = true;
      warn(`프레임 ${frames.length}: 그림이 화면 가장자리에 닿는다 (잘렸을 수 있다).`);
    }
    worstNoise = Math.max(worstNoise, stats.ringNoise);
    minCoverage = Math.min(minCoverage, stats.plateCoverage);
    const box = boxOf(rgba, W, H);
    frames.push({ box, crop: box === null ? Buffer.alloc(0) : cropOf(rgba, W, box), thumb: thumbOf({ w: W, h: H, data: rgba }) });
  });
  if (frames.length === 0) fail('프레임을 하나도 읽지 못했다');
  if (worstNoise > 10) warn(`바탕이 고르지 않다 (둘레 잡음 ${worstNoise.toFixed(1)}). 바탕판이 받아 주지만 가장자리를 꼭 확인한다.`);

  // 범위: --trim, 그다음 되풀이 이음매.
  let start = 0;
  let end = frames.length;
  if (o.trim !== undefined) {
    start = Math.max(0, Math.min(frames.length - 1, o.trim[0]));
    end = Math.max(start + 1, Math.min(frames.length, o.trim[1]));
  }
  const loopMode = o.loop ?? 'auto';
  const loop = loopMode === 'on' || (loopMode === 'auto' && (preset?.loop ?? false));
  let seamInfo = '';
  if (loop) {
    const thumbs = frames.slice(start, end).map((f) => f.thumb);
    const r = findLoop(thumbs);
    end = start + r.end;
    seamInfo = `이음매: 프레임 ${start + r.end}이 프레임 ${start + r.start}과 가장 닮음 (차이 ${(r.seam * 1000).toFixed(2)}, 보통 한 걸음 ${(r.step * 1000).toFixed(2)})`;
    start += r.start;
    // 압축 잡음(첫 프레임은 I 프레임이라 뒤 프레임과 조금 다르다)은 넘긴다: 0.002 아래는 눈에 안 보인다.
    if (r.seam > Math.max(r.step * 2.5, 0.002)) warn(`되풀이 이음매가 보일 수 있다 (${seamInfo}). --loop off 또는 --trim으로 고른다.`);
  }
  const used = frames.slice(start, end);

  // 클립 공통 상자.
  let U: Box | null = null;
  for (const f of used) {
    if (f.box === null) continue;
    if (U === null) U = { ...f.box };
    else {
      const x1 = Math.max(U.x + U.w, f.box.x + f.box.w);
      const y1 = Math.max(U.y + U.h, f.box.y + f.box.h);
      U.x = Math.min(U.x, f.box.x);
      U.y = Math.min(U.y, f.box.y);
      U.w = x1 - U.x;
      U.h = y1 - U.y;
    }
  }
  if (U === null) fail('모든 프레임이 투명하다 (바탕만 있다?)');

  // 영상 px ↔ 캔버스 px.
  const vidPerOutX = prep === null ? 1 : W / prep.out.w;
  const vidPerOutY = prep === null ? 1 : H / prep.out.h;
  const vidPerCanvas = prep === null ? 1 : ((prep.canvasToOut.sx * vidPerOutX + prep.canvasToOut.sy * vidPerOutY) / 2);
  let footV: { x: number; y: number };
  if (prep !== null) footV = { x: prep.foot.out.x * vidPerOutX, y: prep.foot.out.y * vidPerOutY };
  else {
    const b = used.find((f) => f.box !== null)?.box ?? U;
    footV = { x: b.x + b.w / 2, y: b.y + b.h };
  }

  const pad = Math.max(0, Math.round(o.pad ?? 6));
  const maxAtlas = o.maxAtlas ?? 4096;
  let s = o.scale !== undefined ? o.scale / vidPerCanvas : (Math.max(16, o.cellH ?? 320) - 2 * pad) / U.h;
  if (s > 1) {
    warn(`칸이 영상보다 크다 (배율 ${s.toFixed(3)}): 영상 해상도 그대로(1)로 둔다.`);
    s = 1;
  }
  let cw = 0;
  let ch = 0;
  let grid = { cols: 1, rows: 1, w: 0, h: 0 };
  for (let tries = 0; tries < 20; tries++) {
    cw = Math.ceil(U.w * s) + 2 * pad;
    ch = Math.ceil(U.h * s) + 2 * pad;
    grid = packGrid(used.length, cw, ch);
    const big = Math.max(grid.w, grid.h);
    if (big <= maxAtlas) break;
    const k = (maxAtlas / big) * 0.995;
    if (tries === 0) warn(`시트가 ${grid.w}x${grid.h}로 ${maxAtlas}를 넘어 칸을 줄인다 (×${k.toFixed(3)}). fps를 낮추거나 --cell-h를 줄여도 된다.`);
    s *= k;
  }

  // 칸마다 줄여 붙이기.
  const atlas = Buffer.alloc(grid.w * grid.h * 4);
  const union: Rgba = { w: U.w, h: U.h, data: Buffer.alloc(U.w * U.h * 4) };
  used.forEach((f, i) => {
    union.data.fill(0);
    if (f.box !== null) {
      const b = f.box;
      for (let y = 0; y < b.h; y++) f.crop.copy(union.data, ((b.y - U.y + y) * U.w + (b.x - U.x)) * 4, y * b.w * 4, (y + 1) * b.w * 4);
    }
    const cell = resampleArea(union, -pad / s, -pad / s, cw / s, ch / s, cw, ch);
    const cx = (i % grid.cols) * cw;
    const cy = Math.floor(i / grid.cols) * ch;
    for (let y = 0; y < ch; y++) cell.copy(atlas, ((cy + y) * grid.w + cx) * 4, y * cw * 4, (y + 1) * cw * 4);
  });
  fillTransparent(atlas, keyer.outlineRgb);

  const footCell = { x: (footV.x - U.x) * s + pad, y: (footV.y - U.y) * s + pad };
  const anchor = { x: round(footCell.x / cw, 5), y: round(footCell.y / ch, 5) };
  const cellPerCanvas = s * vidPerCanvas;

  const outRoot = resolve(o.outRoot ?? ANIM_OUT);
  const dir = join(outRoot, species);
  ensureDir(dir);
  const fmt = o.format ?? 'webp';
  const imageName = `${clip}.${fmt}`;
  const image = join(dir, imageName);
  const json = join(dir, `${clip}.json`);
  await writeImage(image, { w: grid.w, h: grid.h, data: atlas }, { quality: o.quality ?? 90 });

  const names = used.map((_, i) => `${species}_${clip}_${String(i).padStart(3, '0')}`);
  const framesJson: Record<string, unknown> = {};
  names.forEach((name, i) => {
    const x = (i % grid.cols) * cw;
    const y = Math.floor(i / grid.cols) * ch;
    framesJson[name] = {
      frame: { x, y, w: cw, h: ch },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: cw, h: ch },
      sourceSize: { w: cw, h: ch },
      anchor,
    };
  });
  const meta: ClipMeta = {
    species,
    name: clip,
    fps: fps > 0 ? fps : round(info.fps, 3),
    loop,
    frames: used.length,
    anchor,
    cell: { w: cw, h: ch },
    scale: round(cellPerCanvas, 6),
    canvas: prep?.canvas ?? null,
    foot: prep?.foot.canvas ?? null,
    source: { video: rel(video), prep: prepPath === null ? null : rel(prepPath), range: [start, end], videoSize: [W, H], crop: { x: U.x, y: U.y, w: U.w, h: U.h, s: round(s, 6), pad } },
  };
  writeJson(json, {
    frames: framesJson,
    animations: { [clip]: names },
    meta: {
      app: 'tools/sprite/extract.ts',
      version: '1',
      image: imageName,
      format: 'RGBA8888',
      size: { w: grid.w, h: grid.h },
      scale: String(round(cellPerCanvas, 6)),
      clip: meta,
    },
  });

  let preview: string | null = null;
  if (o.debug === true) {
    preview = join(dir, `${clip}.preview.png`);
    await writeImage(preview, { w: grid.w, h: grid.h, data: previewOf(atlas, grid.w, grid.h, cw, ch, footCell) }, { channels: 3 });
  }

  if (o.index !== false) {
    const idxPath = join(outRoot, 'index.json');
    let idx: { version: number; clips: Record<string, Record<string, AnimIndexEntry>> } = { version: 1, clips: {} };
    try {
      if (fileExists(idxPath)) idx = readJson(idxPath);
    } catch {
      warn('index.json을 읽지 못해 새로 쓴다.');
    }
    idx.clips ??= {};
    const bySpecies = (idx.clips[species] ??= {});
    bySpecies[clip] = { json: `${species}/${clip}.json`, image: `${species}/${imageName}`, fps: meta.fps, loop, frames: used.length };
    writeJson(idxPath, idx);
  }

  if (o.quiet !== true) {
    console.log(`  키: 외곽선 ${keyer.outlineFrom} rgb(${keyer.outlineRgb.join(',')}), 바탕판 최소 ${(minCoverage * 100).toFixed(0)}%, 둘레 잡음 최대 ${worstNoise.toFixed(1)}`);
    console.log(`  프레임 ${frames.length}개 중 ${start}~${end - 1} (${used.length}개)${seamInfo === '' ? '' : `  ${seamInfo}`}`);
    console.log(`  공통 상자 ${U.x},${U.y} ${U.w}x${U.h} → 칸 ${cw}x${ch} (×${s.toFixed(4)}, 칸 px/캔버스 px ${cellPerCanvas.toFixed(4)}), 시트 ${grid.cols}x${grid.rows} = ${grid.w}x${grid.h}`);
    console.log(`  발 기준점 칸 (${footCell.x.toFixed(1)}, ${footCell.y.toFixed(1)}) = anchor (${anchor.x}, ${anchor.y})`);
    console.log(`  → ${rel(image)}, ${rel(json)}${preview === null ? '' : `, ${rel(preview)}`}`);
  }
  return { image, json, preview, meta, atlas: { w: grid.w, h: grid.h, cols: grid.cols, rows: grid.rows }, outlineRgb: keyer.outlineRgb, warnings };
}

/** 확인용: 체크 무늬 위에 시트를 얹고 칸 경계(옅은 선)와 발 기준점(빨간 십자)을 그린다. */
export function previewOf(atlas: Buffer, w: number, h: number, cw: number, ch: number, foot: { x: number; y: number }): Buffer {
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const checker = ((x >> 4) + (y >> 4)) % 2 === 0 ? 236 : 200;
      const a = (atlas[i * 4 + 3] ?? 0) / 255;
      let r = (atlas[i * 4] ?? 0) * a + checker * (1 - a);
      let g = (atlas[i * 4 + 1] ?? 0) * a + checker * (1 - a);
      let b = (atlas[i * 4 + 2] ?? 0) * a + checker * (1 - a);
      const lx = x % cw;
      const ly = y % ch;
      if (lx === 0 || ly === 0) {
        r = r * 0.6 + 60 * 0.4;
        g = g * 0.6 + 120 * 0.4;
        b = b * 0.6 + 220 * 0.4;
      }
      const fx = Math.round(foot.x);
      const fy = Math.round(foot.y);
      if ((ly === fy && Math.abs(lx - fx) <= 10) || (lx === fx && Math.abs(ly - fy) <= 10)) {
        r = 255;
        g = 0;
        b = 0;
      }
      out[i * 3] = r;
      out[i * 3 + 1] = g;
      out[i * 3 + 2] = b;
    }
  }
  return out;
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2), {
    valued: ['prep', 'species', 'clip', 'fps', 'cell-h', 'scale', 'pad', 'loop', 'trim', 'out-root', 'format', 'quality', 'max-atlas', 'matrix', 'outline', 'band', 'dkey', 'dfg', 'min-island'],
    switches: ['debug', 'no-index'],
  });
  const video = args.positional[0];
  if (video === undefined) {
    console.log('node tools/sprite/extract.ts <영상.mp4> [--species S] [--clip C] [--prep FILE.json] [--fps 12] [--cell-h 320 | --scale S] [--loop auto|on|off] [--trim A:B] [--out-root DIR] [--format webp|png] [--debug]');
    process.exit(1);
  }
  const loop = args.get('loop');
  if (loop !== undefined && !['auto', 'on', 'off'].includes(loop)) fail('--loop은 auto, on, off');
  const fmt = args.get('format');
  if (fmt !== undefined && fmt !== 'webp' && fmt !== 'png') fail('--format은 webp 또는 png');
  const matrix = args.get('matrix');
  if (matrix !== undefined && !['auto', '601', '709', '2020'].includes(matrix)) fail('--matrix는 auto, 601, 709, 2020');
  const trimS = args.get('trim');
  let trim: [number, number] | undefined;
  if (trimS !== undefined) {
    const [a, b] = trimS.split(':').map(Number);
    if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) fail('--trim은 A:B');
    trim = [a, b];
  }
  const key: Partial<{ -readonly [K in keyof KeyParams]: KeyParams[K] }> = {};
  if (args.get('band') !== undefined) key.band = args.num('band', DEFAULT_KEY.band);
  if (args.get('dkey') !== undefined) key.dKey = args.num('dkey', DEFAULT_KEY.dKey);
  if (args.get('dfg') !== undefined) key.dFg = args.num('dfg', DEFAULT_KEY.dFg);
  if (args.get('min-island') !== undefined) key.minIsland = args.num('min-island', DEFAULT_KEY.minIsland);
  await extract({
    video,
    prep: args.get('prep'),
    species: args.get('species'),
    clip: args.get('clip'),
    fps: args.get('fps') === undefined ? undefined : args.num('fps', 12),
    cellH: args.get('cell-h') === undefined ? undefined : args.num('cell-h', 320),
    scale: args.get('scale') === undefined ? undefined : args.num('scale', 0.4),
    pad: args.get('pad') === undefined ? undefined : args.num('pad', 6),
    loop: loop as ExtractOptions['loop'],
    trim,
    outRoot: args.get('out-root'),
    format: fmt as ExtractOptions['format'],
    quality: args.get('quality') === undefined ? undefined : args.num('quality', 90),
    maxAtlas: args.get('max-atlas') === undefined ? undefined : args.num('max-atlas', 4096),
    matrix: matrix as ExtractOptions['matrix'],
    outline: args.get('outline'),
    key,
    debug: args.has('debug'),
    index: !args.has('no-index'),
  });
}
