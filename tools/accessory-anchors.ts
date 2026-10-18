// 장신구 붙는 점 재기 (넷째 묶음, DESIGN 3.7): 원본 손님 그림(tools/art-raw/monsters/<종>_<포즈>.png)의 알파에서
// 머리 꼭대기·목·옆구리 점과 머리·목 폭을 재서 src/data/accessoryAnchors.ts의 MEASURED 칸(@generated-begin ~ @generated-end)을 다시 쓴다.
// 손으로 고친 값(FIXES)은 그 칸 밖이라 남는다. npm 패키지 없이 ffmpeg로 PNG를 날 RGBA로 푼다.
//
// 쓰는 법 (프로젝트 폴더에서):
//   node tools/accessory-anchors.ts                 27종을 재서 표를 다시 쓴다
//   node tools/accessory-anchors.ts --dry           재기만 (표는 그대로, 결과를 찍는다). --only 종,종 이면 그 종만 재서 찍는다 (표는 그대로)
//   node tools/accessory-anchors.ts --sheet <out.png> [--only 종,종] [--cell 256] [--grid] [--measure]
//                                                   표(고친 값까지 합친 것)의 점을 그림 위에 찍은 대조표 PNG (행 = 종, 열 = 포즈).
//                                                   --grid = 캔버스 100px 격자 (500마다 보라), --measure = 먼저 다시 재서 표를 쓴다.
// 진짜 장신구 그림을 단 대조표는 개발 서버의 src/view/closeup/_dev/accessory_preview.html.
// ffmpeg: 환경 변수 FFMPEG, 없으면 아래 FFMPEG_DEFAULT.
//
// 재는 법 (512² 로 줄여서, 캔버스 1024 단위로 옮겨 적는다):
//   1. 알파 ≥ 128 의 가장 큰 덩어리 (떨어진 눈물·여우 구슬은 뺀다).
//   2. 열기(깎았다가 다시 불리기, 반지름 = 몸 높이 5%): 가는 뿔 끝·눈자루·꽃대·연장 자루를 떼어 내고 다시 가장 큰 덩어리.
//   3. 머리 축 x = 위에서 12~38% 높이 줄들의 가운데 값 (귀·잎 아래, 꼬리 위). 머리 꼭대기 = 그 축에서 맨 위 + 머리 폭 4%.
//   4. 목 높이 = base 포즈에서 머리 꼭대기 → 몸 바닥 비율 하나 (앞(왼쪽) 윤곽이 턱 밑에서 들어간 곳, 없으면 가로 폭이 좁은 곳, 없으면 45%)를
//      모든 포즈에 쓴다 (포즈마다 머리 꼭대기·바닥이 달라 목도 따라 움직인다). 목 x = 그 줄 가운데와 머리 축 가운데 왼쪽에서 앞으로 머리 폭 5%.
//   5. 머리 폭 = 꼭대기와 목 사이 40~75% 줄 가운데 가장 넓은 폭, 목 폭 = 목 줄 폭 (머리 폭 90%까지). 둘 다 base 포즈 값을 종 크기로.
//   6. 머리 기울기 = 목 → 머리 꼭대기 축이 base 포즈보다 기운 만큼의 절반 (±0.35 rad).
//   7. 옆구리 = 목과 바닥 사이 50%, 머리 축에서 머리 폭 28% 등 쪽(오른쪽), 그 줄 몸 안으로.
// 잰 값이 어긋나는 종(모자·잎·꼭지·체리가 머리 위에 있는 종, 넓적한 게·거북·양, 입에 걸린 목)은 accessoryAnchors.ts FIXES에서 고친다.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPECIES_IDS, type SpeciesId } from '../src/data/defs.ts';

const FFMPEG_DEFAULT = 'C:\\Users\\민철\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.2-full_build\\bin\\ffmpeg.exe';
const FFMPEG = process.env['FFMPEG'] ?? FFMPEG_DEFAULT;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'tools', 'art-raw', 'monsters');
const TABLE = join(ROOT, 'src', 'data', 'accessoryAnchors.ts');
const POSES = ['base', 'joy', 'agony', 'sad'] as const;
type Pose = (typeof POSES)[number];

/** 재는 해상도 (정사각). 캔버스(1024) 단위 = × CANVAS / N. */
const N = 512;
const CANVAS = 1024;
const TO_CANVAS = CANVAS / N;

interface Img {
  readonly rgba: Buffer;
  readonly mask: Uint8Array;
}

/** PNG → N×N 날 RGBA (ffmpeg). */
function decode(file: string): Buffer {
  return execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-vf', `scale=${N}:${N}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 });
}

function load(file: string): Img {
  const rgba = decode(file);
  const mask = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) mask[i] = (rgba[i * 4 + 3] ?? 0) >= 128 ? 1 : 0;
  return { rgba, mask };
}

/** 가장 큰 4-이웃 덩어리만 남긴다. */
function largest(mask: Uint8Array): Uint8Array {
  const label = new Int32Array(N * N);
  const stack = new Int32Array(N * N);
  let best = 0;
  let bestSize = 0;
  let next = 0;
  for (let s = 0; s < N * N; s++) {
    if (mask[s] !== 1 || label[s] !== 0) continue;
    next++;
    let size = 0;
    let top = 0;
    stack[top++] = s;
    label[s] = next;
    while (top > 0) {
      const p = stack[--top] ?? 0;
      size++;
      const x = p % N;
      const nb = [x > 0 ? p - 1 : -1, x < N - 1 ? p + 1 : -1, p - N, p + N];
      for (const q of nb) {
        if (q < 0 || q >= N * N || mask[q] !== 1 || label[q] !== 0) continue;
        label[q] = next;
        stack[top++] = q;
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
  }
  const out = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) out[i] = label[i] === best && best !== 0 ? 1 : 0;
  return out;
}

/** 각 칸에서 target = 1 인 가장 가까운 칸까지 거리 (모따기 3-4, px). 그림 밖은 target으로 본다 (outsideIsTarget). */
function distTo(target: Uint8Array, outsideIsTarget: boolean): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) d[i] = target[i] === 1 ? 0 : INF;
  const edge = outsideIsTarget ? 0 : INF;
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= N || y >= N ? edge : (d[y * N + x] ?? INF));
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const v = Math.min(d[i] ?? INF, at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
      d[i] = v;
    }
  for (let y = N - 1; y >= 0; y--)
    for (let x = N - 1; x >= 0; x--) {
      const i = y * N + x;
      const v = Math.min(d[i] ?? INF, at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
      d[i] = v;
    }
  for (let i = 0; i < N * N; i++) d[i] = (d[i] ?? INF) / 3;
  return d;
}

/** 열기 (반지름 r px): r보다 가는 돌기를 떼어 낸다. */
function open(mask: Uint8Array, r: number): Uint8Array {
  const bg = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) bg[i] = mask[i] === 1 ? 0 : 1;
  const din = distTo(bg, true);
  const eroded = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) eroded[i] = (din[i] ?? 0) > r ? 1 : 0;
  const dout = distTo(eroded, false);
  const out = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) out[i] = mask[i] === 1 && (dout[i] ?? 1e9) <= r ? 1 : 0;
  return out;
}

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function bbox(mask: Uint8Array): Box | null {
  let x0 = N;
  let y0 = N;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (mask[y * N + x] !== 1) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** 줄 y에서 x를 지나는 (없으면 x에 가장 가까운) 가로 덩어리 [왼, 오른]. 줄이 비면 null. */
function runAt(mask: Uint8Array, y: number, x: number): [number, number] | null {
  const row = Math.round(y) * N;
  let cx = Math.round(x);
  if (mask[row + cx] !== 1) {
    let found = -1;
    for (let d = 1; d < N && found < 0; d++) {
      if (cx - d >= 0 && mask[row + cx - d] === 1) found = cx - d;
      else if (cx + d < N && mask[row + cx + d] === 1) found = cx + d;
    }
    if (found < 0) return null;
    cx = found;
  }
  let l = cx;
  let r = cx;
  while (l > 0 && mask[row + l - 1] === 1) l--;
  while (r < N - 1 && mask[row + r + 1] === 1) r++;
  return [l, r];
}

/** 열 x에서 맨 위 칸 (없으면 null). */
function topAt(mask: Uint8Array, x: number): number | null {
  const cx = Math.round(x);
  if (cx < 0 || cx >= N) return null;
  for (let y = 0; y < N; y++) if (mask[y * N + cx] === 1) return y;
  return null;
}

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/** 열어 낸 몸 덩어리와 머리 축 x, 머리 꼭대기 y, 바닥 y (N 단위). */
interface Shape {
  readonly m: Uint8Array;
  readonly cx: number;
  readonly ty: number;
  readonly by: number;
}

function shape(img: Img): Shape {
  const comp = largest(img.mask);
  const b0 = bbox(comp);
  if (b0 === null) throw new Error('빈 그림');
  const r = Math.max(3, Math.round((b0.y1 - b0.y0) * 0.05));
  let m = largest(open(comp, r));
  let b = bbox(m);
  if (b === null) {
    m = comp;
    b = b0;
  }
  const H = b.y1 - b.y0 + 1;
  // 머리 축: 위에서 12~38% 줄들의 가로 가운데 값.
  const xs: number[] = [];
  for (let y = Math.round(b.y0 + H * 0.12); y <= b.y0 + H * 0.38; y++) {
    let l = -1;
    let rr = -1;
    for (let x = 0; x < N; x++)
      if (m[y * N + x] === 1) {
        if (l < 0) l = x;
        rr = x;
      }
    if (l >= 0) xs.push((l + rr) / 2);
  }
  const cx = xs.length > 0 ? median(xs) : (b.x0 + b.x1) / 2;
  // 머리 꼭대기: 축 ±2열의 맨 위.
  const tops: number[] = [];
  for (let d = -2; d <= 2; d++) {
    const t = topAt(m, cx + d);
    if (t !== null) tops.push(t);
  }
  const ty = tops.length > 0 ? median(tops) : b.y0;
  return { m, cx, ty, by: b.y1 };
}

const runWidth = (s: Shape, y: number): number => {
  const run = runAt(s.m, y, s.cx);
  return run === null ? 0 : run[1] - run[0] + 1;
};

/**
 * 목 높이 (머리 꼭대기 → 바닥 비율, base 포즈에서): 1) 앞(왼쪽) 윤곽이 턱 밑에서 안으로 들어간 곳 (얼굴·팔이 앞으로 나와 있다),
 * 2) 가로 폭이 위·아래보다 10% 좁은 곳, 3) 아니면 NECK_DEFAULT.
 */
const NECK_DEFAULT = 0.45;
function neckFrac(s: Shape): number {
  const { m, ty, by } = s;
  const span = by - ty;
  const leftX = (y: number): number => {
    const row = Math.round(y) * N;
    for (let x = 0; x < N; x++) if (m[row + x] === 1) return x;
    return N;
  };
  const y0 = Math.round(ty + span * 0.28);
  const y1 = Math.round(ty + span * 0.58);
  let best = span * 0.012;
  let ny = -1;
  for (let y = y0; y <= y1; y++) {
    const lx = leftX(y);
    let above = N;
    for (let k = Math.round(ty + span * 0.1); k < y; k++) above = Math.min(above, leftX(k));
    let below = N;
    for (let k = y + 1; k <= Math.min(by, y + span * 0.3); k++) below = Math.min(below, leftX(k));
    const depth = Math.min(lx - above, lx - below);
    if (depth > best) {
      best = depth;
      ny = y;
    }
  }
  if (ny < 0) {
    let minY = -1;
    let minW = Infinity;
    for (let y = y0; y <= y1; y++) {
      // 세 줄 평균 (잡티를 줄인다).
      const w = (runWidth(s, y - 1) + runWidth(s, y) + runWidth(s, y + 1)) / 3;
      if (w < minW) {
        minW = w;
        minY = y;
      }
    }
    if (minY >= 0) {
      let above = 0;
      let below = 0;
      for (let y = ty; y < minY; y++) above = Math.max(above, runWidth(s, y));
      for (let y = minY + 1; y <= by; y++) below = Math.max(below, runWidth(s, y));
      if (minW < above * 0.9 && minW < below * 0.9) ny = minY;
    }
  }
  return ny < 0 ? NECK_DEFAULT : Math.max(0.3, Math.min(0.58, (ny - ty) / span));
}

interface Measure {
  /** 머리 x, y, 기울기(rad), 목 x, y, 옆구리 x, y, 바닥 y (N 단위). */
  readonly head: { x: number; y: number; rot: number };
  readonly neck: { x: number; y: number };
  readonly side: { x: number; y: number };
  readonly bottom: number;
  readonly headW: number;
  readonly neckW: number;
}

/** 목 높이 비율 frac (종마다 하나)로 한 포즈의 점들. */
function finish(s: Shape, frac: number): Measure {
  const { m, cx, ty, by } = s;
  const ny = ty + (by - ty) * frac;
  // 머리 폭: 꼭대기와 목 사이 40~75% 줄 가운데 가장 넓은 폭 (귀·뿔 아래, 어깨 위).
  let headW = 0;
  for (let y = Math.round(ty + (ny - ty) * 0.4); y <= ty + (ny - ty) * 0.75; y++) headW = Math.max(headW, runWidth(s, y));
  if (headW === 0) headW = (by - ty) * 0.6;
  const head = { x: cx, y: ty + headW * 0.04, rot: 0 };
  const nrun = runAt(m, ny, cx) ?? [cx - headW / 2, cx + headW / 2];
  const neckW = Math.min(nrun[1] - nrun[0] + 1, headW * 0.9);
  const neck = { x: Math.min((nrun[0] + nrun[1]) / 2, cx) - headW * 0.05, y: ny };
  // 옆구리: 목과 바닥 사이 50%, 축에서 등 쪽으로 (그 줄 몸 안).
  const sy = ny + (by - ny) * 0.5;
  const srun = runAt(m, sy, cx) ?? [cx - headW / 2, cx + headW / 2];
  const sw = srun[1] - srun[0];
  const sx = Math.max(srun[0] + sw * 0.15, Math.min(srun[1] - sw * 0.14, cx + headW * 0.28));
  return { head, neck, side: { x: sx, y: sy }, bottom: by, headW, neckW };
}

const c = (v: number): number => Math.round(v * TO_CANVAS);

function measureAll(only: readonly SpeciesId[]): Map<SpeciesId, Record<Pose, Measure>> {
  const out = new Map<SpeciesId, Record<Pose, Measure>>();
  for (const sp of only) {
    const shapes = {} as Record<Pose, Shape>;
    for (const pose of POSES) shapes[pose] = shape(load(join(RAW, `${sp}_${pose}.png`)));
    const frac = neckFrac(shapes.base);
    const row = {} as Record<Pose, Measure>;
    for (const pose of POSES) row[pose] = finish(shapes[pose], frac);
    // 머리 기울기: 목 → 머리 꼭대기 축의 각도가 base 포즈보다 얼마나 다른가 (반만, ±0.35).
    const axis = (v: Measure): number => Math.atan2(v.head.x - v.neck.x, v.neck.y - v.head.y);
    for (const pose of POSES) {
      const v = row[pose];
      const rot = pose === 'base' ? 0 : Math.max(-0.35, Math.min(0.35, (axis(v) - axis(row.base)) * 0.5));
      row[pose] = { ...v, head: { ...v.head, rot } };
    }
    out.set(sp, row);
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  return out;
}

function tableText(all: Map<SpeciesId, Record<Pose, Measure>>): string {
  const lines = ['const MEASURED: Partial<Record<SpeciesId, Measured>> = {'];
  for (const [sp, row] of all) {
    const p = POSES.map((pose) => {
      const v = row[pose];
      return `${pose}: [${[c(v.head.x), c(v.head.y), Math.round(v.head.rot * 1000), c(v.neck.x), c(v.neck.y), c(v.side.x), c(v.side.y), c(v.bottom)].join(', ')}]`;
    });
    lines.push(`  ${sp}: { w: [${c(row.base.headW)}, ${c(row.base.neckW)}], p: { ${p.join(', ')} } },`);
  }
  lines.push('};');
  return lines.join('\n');
}

function writeTable(text: string): void {
  const src = readFileSync(TABLE, 'utf8');
  const a = src.indexOf('// @generated-begin');
  const bEnd = src.indexOf('// @generated-end');
  if (a < 0 || bEnd < 0) throw new Error('accessoryAnchors.ts에 @generated-begin/@generated-end 표시가 없다');
  const head = src.slice(0, src.indexOf('\n', a) + 1);
  writeFileSync(TABLE, `${head}${text}\n${src.slice(bEnd)}`);
}

// ── 대조표 PNG ──────────────────────────────────────────────────────────

const DOT: Record<'head' | 'neck' | 'side', [number, number, number]> = { head: [230, 40, 40], neck: [40, 90, 230], side: [20, 160, 60] };

async function sheet(out: string, only: readonly SpeciesId[], cell: number, grid: boolean): Promise<void> {
  const { ACCESSORY_ANCHORS } = (await import(`../src/data/accessoryAnchors.ts?t=${Date.now()}`)) as typeof import('../src/data/accessoryAnchors.ts');
  const cols = POSES.length * Math.max(1, Math.min(3, Math.floor(2400 / (cell * POSES.length))));
  const perRow = cols / POSES.length;
  const rows = Math.ceil(only.length / perRow);
  const W = cols * cell;
  const H = rows * cell;
  const buf = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) buf.set([232, 226, 214, 255], i * 4);
  const put = (x: number, y: number, col: readonly number[]): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    buf.set([col[0] ?? 0, col[1] ?? 0, col[2] ?? 0, 255], (Math.round(y) * W + Math.round(x)) * 4);
  };
  const dot = (x: number, y: number, col: readonly number[], rad: number): void => {
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) if (dx * dx + dy * dy <= rad * rad) put(x + dx, y + dy, col);
  };
  const s = cell / CANVAS;
  /** 칸 안 px p와 p-1 사이에 캔버스 step 눈금이 지나가나 (격자 선). */
  const crosses = (p: number, step: number): boolean => Math.floor(p / s / step) !== Math.floor((p - 1) / s / step);
  only.forEach((sp, si) => {
    const anchors = ACCESSORY_ANCHORS[sp];
    POSES.forEach((pose, pi) => {
      const idx = si * POSES.length + pi;
      const ox = (idx % cols) * cell;
      const oy = Math.floor(idx / cols) * cell;
      const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', join(RAW, `${sp}_${pose}.png`), '-vf', `scale=${cell}:${cell}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 });
      for (let y = 0; y < cell; y++)
        for (let x = 0; x < cell; x++) {
          const si4 = (y * cell + x) * 4;
          const di = ((oy + y) * W + ox + x) * 4;
          const a = (raw[si4 + 3] ?? 0) / 255;
          for (let k = 0; k < 3; k++) buf[di + k] = Math.round((raw[si4 + k] ?? 0) * a + (buf[di + k] ?? 0) * (1 - a));
          if (x === 0 || y === 0) buf.set([160, 160, 160], di);
          else if (grid && (crosses(x, 100) || crosses(y, 100))) buf.set(crosses(x, 500) || crosses(y, 500) ? [150, 110, 200] : [205, 200, 190], di);
        }
      if (anchors === undefined) return;
      const row = anchors.poses[pose];
      for (const slot of ['head', 'neck', 'side'] as const) {
        const a = row[slot];
        const col = DOT[slot];
        // 기준 폭 선 (머리·목), 기울기를 따라.
        const half = (slot === 'side' ? anchors.size.head * 0.18 : anchors.size[slot] / 2) * s;
        const rot = a.rot ?? 0;
        for (let t = -half; t <= half; t += 0.5) put(ox + a.x * s + t * Math.cos(rot), oy + a.y * s + t * Math.sin(rot), col);
        dot(ox + a.x * s, oy + a.y * s, col, Math.max(2, Math.round(cell / 64)));
      }
    });
  });
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', '-', out], { input: buf });
  console.log(`대조표: ${out} (${W}×${H}, 행마다 ${perRow}종 × ${POSES.join('·')})`);
}

// ── 명령줄 ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const onlyArg = flag('--only');
const only: SpeciesId[] = onlyArg === undefined ? [...SPECIES_IDS] : onlyArg.split(',').filter((s): s is SpeciesId => (SPECIES_IDS as readonly string[]).includes(s));
const sheetOut = flag('--sheet');
const dry = args.includes('--dry');

if (sheetOut === undefined || args.includes('--measure')) {
  const all = measureAll(onlyArg === undefined ? [...SPECIES_IDS] : only);
  const text = tableText(all);
  if (dry || onlyArg !== undefined) console.log(text);
  else {
    writeTable(text);
    console.log(`표를 다시 썼다: ${TABLE} (${all.size}종)`);
  }
}
if (sheetOut !== undefined) await sheet(sheetOut, only, Number(flag('--cell') ?? '256'), args.includes('--grid'));
