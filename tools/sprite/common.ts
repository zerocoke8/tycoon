// tools/sprite 도구들이 같이 쓰는 것: 폴더, 인자, ffmpeg 찾기·돌리기, 그림 읽기·쓰기, .env.local, 작은 셈.
// npm 패키지 없이 Node 24로 바로 돈다 (node tools/sprite/<도구>.ts). 그림 디코딩·인코딩은 모두 ffmpeg가 한다.
//
// ffmpeg 찾는 순서: 환경 변수 FFMPEG (파일 또는 bin 폴더, tools/sprite/.env.local도 된다) → PATH
//   → %LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_*\ffmpeg-*\bin.
// ffprobe는 ffmpeg 옆에서 찾는다 (FFPROBE로 따로 줄 수도 있다).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, relative, resolve } from 'node:path';

// ── 폴더 ────────────────────────────────────────────────────────────────

/** 프로젝트 뿌리 (tools/sprite의 두 단계 위). */
export const ROOT = resolve(import.meta.dirname, '..', '..');
export const SPRITE_DIR = resolve(import.meta.dirname);
/** Codex 원본 PNG (투명). */
export const ART_RAW = join(ROOT, 'tools', 'art-raw');
/** art-kit process.ts가 쓴 meta.json (캔버스 크기·trim). */
export const ART_META = join(ROOT, 'public', 'assets', 'art', 'meta.json');
/** 마젠타 입력 그림, Seedance 영상, 작업 기록 (저장소에 넣지 않는다). */
export const ANIM_RAW = join(ROOT, 'tools', 'anim-raw');
/** 게임이 읽는 시트: <species>/<clip>.{webp,json} 와 index.json. */
export const ANIM_OUT = join(ROOT, 'public', 'assets', 'anim');

/** 화면에 찍을 경로 (프로젝트 기준 상대, / 구분). */
export function rel(p: string): string {
  const r = relative(ROOT, p);
  return (r.startsWith('..') ? p : r).split('\\').join('/');
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function writeJson(path: string, value: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

// ── 인자 ────────────────────────────────────────────────────────────────

export interface Args {
  get(name: string): string | undefined;
  num(name: string, fallback: number): number;
  has(name: string): boolean;
  readonly positional: readonly string[];
}

/**
 * valued: 값을 받는 옵션, switches: 값 없는 옵션. 모르는 옵션은 멈춘다 (오타로 --dry가 빠져 진짜 API를 부르는 일을 막는다).
 * --name=value 꼴도 받는다.
 */
export function parseArgs(argv: readonly string[], known: { valued: readonly string[]; switches: readonly string[] }): Args {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (known.switches.includes(name)) {
      if (eq > 0) fail(`--${name}는 값을 받지 않는다`);
      flags.add(name);
    } else if (known.valued.includes(name)) {
      const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
      if (v === undefined) fail(`--${name} 뒤에 값이 없다`);
      values.set(name, v);
    } else {
      fail(`모르는 옵션: ${a}\n  아는 옵션: ${[...known.valued.map((n) => `--${n} <값>`), ...known.switches.map((n) => `--${n}`)].join(' ')}`);
    }
  }
  return {
    get: (n) => values.get(n),
    num: (n, fb) => {
      const v = values.get(n);
      if (v === undefined) return fb;
      const x = Number(v);
      if (!Number.isFinite(x)) fail(`--${n}는 숫자여야 한다: ${v}`);
      return x;
    },
    has: (n) => flags.has(n),
    positional,
  };
}

export function fail(msg: string): never {
  console.error(`오류: ${msg}`);
  process.exit(1);
}

// ── .env.local ───────────────────────────────────────────────────────────

/**
 * tools/sprite/.env.local (저장소에 넣지 않는다)의 KEY=VALUE를 process.env에 넣는다. 이미 있는 환경 변수가 이긴다.
 * '#' 줄은 주석, 값의 따옴표는 벗긴다.
 */
export function loadEnvLocal(file = join(SPRITE_DIR, '.env.local')): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m === null || line.trimStart().startsWith('#')) continue;
    const key = m[1] ?? '';
    let v = m[2] ?? '';
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = v;
  }
}

// ── ffmpeg ──────────────────────────────────────────────────────────────

let ffmpegPath: string | null = null;
let ffprobePath: string | null = null;

const EXE = process.platform === 'win32' ? '.exe' : '';

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function fromDirOrFile(p: string, name: string): string | null {
  if (isFile(p)) return p;
  const f = join(p, name + EXE);
  return isFile(f) ? f : null;
}

function wingetCandidates(name: string): string[] {
  const base = process.env.LOCALAPPDATA;
  if (base === undefined) return [];
  const pk = join(base, 'Microsoft', 'WinGet', 'Packages');
  if (!existsSync(pk)) return [];
  const out: string[] = [];
  for (const d of readdirSync(pk).filter((n) => n.startsWith('Gyan.FFmpeg_'))) {
    const dir = join(pk, d);
    try {
      for (const sub of readdirSync(dir).filter((n) => n.startsWith('ffmpeg-')).sort().reverse()) {
        const f = join(dir, sub, 'bin', name + EXE);
        if (isFile(f)) out.push(f);
      }
    } catch {
      // 읽을 수 없는 폴더는 건너뛴다.
    }
  }
  return out;
}

function locate(name: 'ffmpeg' | 'ffprobe'): string {
  loadEnvLocal();
  const env = name === 'ffmpeg' ? process.env.FFMPEG : process.env.FFPROBE;
  if (env !== undefined && env !== '') {
    const f = fromDirOrFile(env, name);
    if (f !== null) return f;
    if (name === 'ffmpeg') fail(`FFMPEG=${env} 에서 ffmpeg를 찾지 못했다`);
  }
  // ffprobe는 ffmpeg 옆을 먼저 본다.
  if (name === 'ffprobe') {
    const side = join(dirname(ffmpeg()), name + EXE);
    if (isFile(side)) return side;
  }
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    const f = join(dir, name + EXE);
    if (isFile(f)) return f;
  }
  const w = wingetCandidates(name)[0];
  if (w !== undefined) return w;
  fail(`${name}를 찾지 못했다. FFMPEG 환경 변수에 ffmpeg${EXE} 경로(또는 bin 폴더)를 넣어 준다.`);
}

export function ffmpeg(): string {
  ffmpegPath ??= locate('ffmpeg');
  return ffmpegPath;
}

export function ffprobe(): string {
  ffprobePath ??= locate('ffprobe');
  return ffprobePath;
}

/** ffmpeg(또는 ffprobe)를 돌려 stdout 전체를 돌려준다. stdin에 Buffer를 넣을 수 있다. 실패하면 stderr 끝을 붙여 던진다. */
export function run(exe: string, args: readonly string[], stdin?: Buffer): Promise<Buffer> {
  return new Promise((ok, no) => {
    const child = spawn(exe, args as string[], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const out: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString();
      if (err.length > 20000) err = err.slice(-10000);
    });
    child.on('error', no);
    child.on('close', (code) => {
      if (code === 0) ok(Buffer.concat(out));
      else no(new Error(`${exe.split(/[\\/]/).pop()} 실패 (코드 ${code})\n  ${args.join(' ').slice(0, 600)}\n${err.trim().split('\n').slice(-8).join('\n')}`));
    });
    child.stdin.on('error', () => {
      // 프로세스가 먼저 끝나면 EPIPE가 난다: close에서 코드로 알린다.
    });
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

/**
 * ffmpeg의 rawvideo 출력을 프레임 크기씩 잘라 onFrame(frame, index)에 넘긴다 (메모리에 영상 전체를 올리지 않는다).
 * onFrame에 넘긴 Buffer는 다음 프레임에서 다시 쓰지 않는다 (복사해서 넘긴다).
 */
export function streamFrames(args: readonly string[], frameBytes: number, onFrame: (frame: Buffer, index: number) => void): Promise<number> {
  return new Promise((ok, no) => {
    const child = spawn(ffmpeg(), args as string[], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let pending: Buffer[] = [];
    let pendingLen = 0;
    let count = 0;
    let err = '';
    let thrown: unknown = null;
    child.stdout.on('data', (d: Buffer) => {
      if (thrown !== null) return;
      pending.push(d);
      pendingLen += d.length;
      if (pendingLen < frameBytes) return;
      let buf = Buffer.concat(pending, pendingLen);
      let off = 0;
      try {
        while (buf.length - off >= frameBytes) {
          onFrame(Buffer.from(buf.subarray(off, off + frameBytes)), count++);
          off += frameBytes;
        }
      } catch (e) {
        thrown = e;
        child.kill();
        return;
      }
      buf = buf.subarray(off);
      pending = buf.length > 0 ? [buf] : [];
      pendingLen = buf.length;
    });
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString();
      if (err.length > 20000) err = err.slice(-10000);
    });
    child.on('error', no);
    child.on('close', (code) => {
      if (thrown !== null) no(thrown);
      else if (code === 0) ok(count);
      else no(new Error(`ffmpeg 실패 (코드 ${code})\n${err.trim().split('\n').slice(-8).join('\n')}`));
    });
  });
}

export interface StreamInfo {
  readonly width: number;
  readonly height: number;
  readonly pixFmt: string;
  readonly colorSpace: string;
  readonly colorRange: string;
  readonly fps: number;
  readonly duration: number;
  readonly frames: number;
  readonly codec: string;
}

/** 첫 영상 스트림 정보 (ffprobe). */
export async function probe(file: string): Promise<StreamInfo> {
  const out = await run(ffprobe(), ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-show_format', '-of', 'json', file]);
  const j = JSON.parse(out.toString()) as { streams?: Record<string, string | number | undefined>[]; format?: { duration?: string } };
  const s = j.streams?.[0];
  if (s === undefined) throw new Error(`영상 스트림이 없다: ${file}`);
  const rate = String(s.avg_frame_rate ?? s.r_frame_rate ?? '0/1').split('/');
  const fps = Number(rate[0]) / Math.max(1, Number(rate[1] ?? 1));
  return {
    width: Number(s.width),
    height: Number(s.height),
    pixFmt: String(s.pix_fmt ?? ''),
    colorSpace: String(s.color_space ?? 'unknown'),
    colorRange: String(s.color_range ?? 'unknown'),
    fps: Number.isFinite(fps) ? fps : 0,
    duration: Number(s.duration ?? j.format?.duration ?? 0),
    frames: Number(s.nb_frames ?? 0),
    codec: String(s.codec_name ?? ''),
  };
}

// ── 그림 ────────────────────────────────────────────────────────────────

/** 곧은(straight) 알파 RGBA 8비트 그림. */
export interface Rgba {
  readonly w: number;
  readonly h: number;
  readonly data: Buffer;
}

/** 그림 파일(PNG·WebP·…) → RGBA. */
export async function readImage(file: string): Promise<Rgba> {
  if (!existsSync(file)) fail(`그림이 없다: ${rel(file)}`);
  const info = await probe(file);
  const data = await run(ffmpeg(), ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
  if (data.length !== info.width * info.height * 4) throw new Error(`디코딩 크기가 맞지 않다: ${file}`);
  return { w: info.width, h: info.height, data };
}

/**
 * RGBA(또는 RGB) 버퍼 → PNG / WebP 파일. WebP는 손실(색) + 무손실 알파 (quality 0~100).
 * channels: 4 = rgba, 3 = rgb24.
 */
export async function writeImage(file: string, img: { w: number; h: number; data: Buffer }, opts: { quality?: number; channels?: 3 | 4 } = {}): Promise<void> {
  ensureDir(dirname(file));
  const ch = opts.channels ?? 4;
  const inFmt = ch === 4 ? 'rgba' : 'rgb24';
  const ext = file.toLowerCase().split('.').pop();
  const enc =
    ext === 'webp'
      ? ['-c:v', 'libwebp', '-quality', String(opts.quality ?? 90), '-pix_fmt', ch === 4 ? 'yuva420p' : 'yuv420p', '-f', 'webp']
      : ['-c:v', 'png', '-pix_fmt', ch === 4 ? 'rgba' : 'rgb24', '-f', 'image2', '-update', '1'];
  await run(ffmpeg(), ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', inFmt, '-s', `${img.w}x${img.h}`, '-i', 'pipe:0', '-frames:v', '1', ...enc, file], img.data);
}

// ── 색 ──────────────────────────────────────────────────────────────────

export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (m === null) fail(`색은 #rrggbb 꼴: ${hex}`);
  const n = parseInt(m[1] ?? '0', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(rgb: readonly number[]): string {
  return `#${rgb
    .slice(0, 3)
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** 중앙값 (배열을 정렬한다). */
export function median(a: number[]): number {
  if (a.length === 0) return 0;
  a.sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 === 1 ? (a[m] ?? 0) : ((a[m - 1] ?? 0) + (a[m] ?? 0)) / 2;
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function round(x: number, d = 4): number {
  const k = 10 ** d;
  return Math.round(x * k) / k;
}

// ── 줄이기 (넓이 평균, 미리 곱한 알파) ─────────────────────────────────────

/**
 * RGBA(곧은 알파)의 사각형 (sx, sy, sw, sh)을 dw×dh로 줄인다. 넓이 평균(박스 필터, 소수 경계 포함)이라 울림이 없다.
 * 알파를 미리 곱해 섞으므로 투명한 픽셀의 색이 가장자리로 번지지 않는다. 결과도 곧은 알파.
 * 키우기(dw > sw)도 되지만 그때는 가장 가까운 픽셀에 가깝다 (여기서는 줄이기만 쓴다).
 */
export function resampleArea(src: Rgba, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number): Buffer {
  const fx = sw / dw;
  const fy = sh / dh;
  // 가로 먼저: 행마다 dw개의 미리 곱한 RGBA (Float32), 세로 범위는 [floor(sy), ceil(sy+sh)).
  const y0 = Math.max(0, Math.floor(sy));
  const y1 = Math.min(src.h, Math.ceil(sy + sh));
  const rows = y1 - y0;
  const tmp = new Float32Array(rows * dw * 4);
  const d = src.data;
  for (let x = 0; x < dw; x++) {
    const a = sx + x * fx;
    const b = a + fx;
    const i0 = Math.floor(a);
    const i1 = Math.ceil(b);
    for (let y = 0; y < rows; y++) {
      let r = 0;
      let g = 0;
      let bl = 0;
      let al = 0;
      let wsum = 0;
      const rowOff = (y0 + y) * src.w;
      for (let i = i0; i < i1; i++) {
        const w = Math.min(b, i + 1) - Math.max(a, i);
        if (w <= 0) continue;
        wsum += w;
        if (i < 0 || i >= src.w) continue;
        const p = (rowOff + i) * 4;
        const al1 = (d[p + 3] ?? 0) * w;
        r += (d[p] ?? 0) * al1;
        g += (d[p + 1] ?? 0) * al1;
        bl += (d[p + 2] ?? 0) * al1;
        al += al1;
      }
      const t = (y * dw + x) * 4;
      const inv = wsum > 0 ? 1 / wsum : 0;
      tmp[t] = r * inv;
      tmp[t + 1] = g * inv;
      tmp[t + 2] = bl * inv;
      tmp[t + 3] = al * inv;
    }
  }
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const a = sy + y * fy - y0;
    const b = a + fy;
    const j0 = Math.floor(a);
    const j1 = Math.ceil(b);
    for (let x = 0; x < dw; x++) {
      let r = 0;
      let g = 0;
      let bl = 0;
      let al = 0;
      let wsum = 0;
      for (let j = j0; j < j1; j++) {
        const w = Math.min(b, j + 1) - Math.max(a, j);
        if (w <= 0) continue;
        wsum += w;
        if (j < 0 || j >= rows) continue;
        const t = (j * dw + x) * 4;
        r += (tmp[t] ?? 0) * w;
        g += (tmp[t + 1] ?? 0) * w;
        bl += (tmp[t + 2] ?? 0) * w;
        al += (tmp[t + 3] ?? 0) * w;
      }
      const o = (y * dw + x) * 4;
      if (wsum <= 0 || al <= 0) continue;
      const A = al / wsum; // 0~255
      out[o] = Math.min(255, Math.round(r / al));
      out[o + 1] = Math.min(255, Math.round(g / al));
      out[o + 2] = Math.min(255, Math.round(bl / al));
      out[o + 3] = Math.min(255, Math.round(A));
    }
  }
  return out;
}

/** 투명한 픽셀(알파 0)의 색을 col로 채운다: 손실 압축·밉맵·선형 보간이 가장자리에 엉뚱한 색을 끌어오지 않게. */
export function fillTransparent(data: Buffer, col: readonly number[]): void {
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] === 0) {
      data[p] = col[0] ?? 0;
      data[p + 1] = col[1] ?? 0;
      data[p + 2] = col[2] ?? 0;
    }
  }
}

/** 파일 이름에서 종·포즈: dragon_base.png → { species: 'dragon', pose: 'base' }. */
export function splitKey(key: string): { species: string; pose: string } {
  const i = key.lastIndexOf('_');
  return i > 0 ? { species: key.slice(0, i), pose: key.slice(i + 1) } : { species: key, pose: 'base' };
}

export function fileExists(p: string): boolean {
  return existsSync(p);
}
