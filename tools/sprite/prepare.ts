// 투명 원본 PNG → Seedance 입력 그림 (마젠타 #FF00FF 바탕, Seedance가 받는 비율·크기) + 캔버스 대응 기록(JSON).
//   node tools/sprite/prepare.ts <원본.png | 그룹/key> [옵션]
//   예) node tools/sprite/prepare.ts monsters/dragon_base
//       node tools/sprite/prepare.ts tools/art-raw/characters/chief.png --resolution 1080p
//
// 쓰는 곳 (기본): tools/anim-raw/prep/<key>.png 와 <key>.json
//
// 비율: Seedance 2.5의 첫 프레임 모드는 ratio=adaptive만 받고, 영상 비율을 첫 프레임 그림에 맞춘다 (공식 문서).
//   그래서 그림을 지원 비율(1:1, 3:4, 4:3, 9:16, 16:9, 21:9) 가운데 가장 가까운 것으로 '덧대어'(자르지 않고) 맞추고,
//   크기도 그 해상도의 영상 크기(720p 1:1 = 960×960, 720p 3:4 = 834×1112 …)로 맞춘다: 모델이 다시 줄이거나 늘리지 않게.
//   몬스터(1:1)는 그대로, 주민(1024×1536 = 2:3)은 양옆을 덧대 3:4로.
//
// 캔버스 대응 (extract.ts가 발 기준점을 되살릴 때 쓴다):
//   캔버스 = art-kit의 '요청 캔버스' (몬스터 1024×1024, 주민 1024×1536; meta.json trim의 ow·oh).
//   출력 px = 캔버스 px × s + o  (canvasToOut: { sx, sy, ox, oy }).
//   발 기준점 (캔버스): 몬스터는 view/art.ts의 monsterFoot와 같다 = (캔버스 가운데, <종>_base의 trim 아래 끝).
//                      그 밖(주민 등)은 ArtNode의 'bottom'과 같다 = trim의 아래 가운데. meta.json이 없으면 원본 알파에서 잰다.
//
// 처리: 원본 알파를 art-kit처럼 다듬는다 (알파 < 8은 0, ≥ 240은 255: Codex 그림에 깔린 옅은 잡티를 지운다).
//   그다음 ffmpeg가 합친다: color 소스(마젠타) + 원본(rawvideo) → premultiply → scale(area) → overlay(premultiplied) → PNG.
//
// 옵션:
//   --out FILE.png      출력 그림 (JSON은 같은 이름 .json). 기본 tools/anim-raw/prep/<key>.png
//   --resolution R      480p | 720p | 1080p (기본 720p). Seedance 2.5 공식 크기 표를 따른다.
//   --ratio R           비율을 정해 준다 (1:1, 3:4, 4:3, 9:16, 16:9, 21:9). 기본: 가장 가까운 비율로 덧대기.
//   --zoom Z            그림을 출력 안에서 이만큼 줄인다 (기본 1). 점프·드러눕기 자리가 모자랄 때 0.85 등.
//   --canvas WxH        캔버스 크기 (meta.json에 없을 때). 기본: monsters 1024x1024, characters 1024x1536, 그 밖 원본 크기.
//   --foot X,Y          발 기준점 (캔버스 좌표)을 정해 준다.
//   --outline #rrggbb   외곽선 색을 정해 준다 (기본: 원본 가장자리에서 잰다).

import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import {
  ANIM_RAW,
  ART_META,
  ART_RAW,
  clamp01,
  ensureDir,
  fail,
  fileExists,
  ffmpeg,
  median,
  parseArgs,
  parseHex,
  readImage,
  readJson,
  rel,
  round,
  run,
  splitKey,
  toHex,
  writeJson,
  type Rgba,
} from './common.ts';

/** Seedance 2.5 출력 크기 (공식 문서: 火山方舟 创建视频生成任务 API, resolution × ratio 표). */
export const SEEDANCE_SIZES: Readonly<Record<string, Readonly<Record<string, readonly [number, number]>>>> = {
  '480p': { '16:9': [854, 480], '4:3': [752, 560], '1:1': [640, 640], '3:4': [560, 752], '9:16': [480, 854], '21:9': [992, 432] },
  '720p': { '16:9': [1280, 720], '4:3': [1112, 834], '1:1': [960, 960], '3:4': [834, 1112], '9:16': [720, 1280], '21:9': [1470, 630] },
  '1080p': { '16:9': [1920, 1080], '4:3': [1664, 1248], '1:1': [1440, 1440], '3:4': [1248, 1664], '9:16': [1080, 1920], '21:9': [2206, 946] },
};

const KEY_RGB: readonly [number, number, number] = [255, 0, 255];
const DEFAULT_OUTLINE = '#21120d';
/** art-kit process.ts와 같은 알파 레벨. */
const ALPHA_CUT = 8;
const ALPHA_SOLID = 240;

/** prepare가 쓰는 기록 (extract.ts가 읽는다). */
export interface PrepSidecar {
  readonly version: 1;
  readonly source: string;
  readonly group: string;
  readonly key: string;
  readonly species: string;
  readonly pose: string;
  readonly image: string;
  readonly raw: { readonly w: number; readonly h: number };
  readonly canvas: { readonly w: number; readonly h: number };
  readonly out: { readonly w: number; readonly h: number; readonly ratio: string; readonly resolution: string };
  /** 원본 그림이 놓인 자리 (출력 px). */
  readonly place: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** 출력 px = 캔버스 px × s + o */
  readonly canvasToOut: { readonly sx: number; readonly sy: number; readonly ox: number; readonly oy: number };
  readonly foot: { readonly canvas: { readonly x: number; readonly y: number }; readonly out: { readonly x: number; readonly y: number }; readonly from: string };
  /** 원본 알파의 사각형 (출력 px) */
  readonly bbox: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly outline: string;
  readonly background: string;
}

interface MetaEntry {
  trim: { x: number; y: number; w: number; h: number; ow: number; oh: number };
}
type Meta = Record<string, Record<string, MetaEntry>>;

function loadMeta(): Meta {
  try {
    return fileExists(ART_META) ? readJson<Meta>(ART_META) : {};
  } catch {
    return {};
  }
}

/** 알파 다듬기 (art-kit과 같은 규칙). 제자리에서 바꾼다. */
function levelAlpha(img: Rgba): void {
  const d = img.data;
  for (let p = 3; p < d.length; p += 4) {
    const a = d[p] ?? 0;
    d[p] = a < ALPHA_CUT ? 0 : a >= ALPHA_SOLID ? 255 : Math.round(((a - ALPHA_CUT) / (ALPHA_SOLID - ALPHA_CUT)) * 255);
  }
}

/** 알파 > 0의 사각형 (원본 px). */
function alphaBox(img: Rgba): { x: number; y: number; w: number; h: number } | null {
  let x0 = img.w;
  let y0 = img.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if ((img.data[(y * img.w + x) * 4 + 3] ?? 0) === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 외곽선 색: 투명 경계에서 1~3px 안쪽의 불투명한 어두운 픽셀의 중앙값. */
export function measureOutline(img: Rgba): string | null {
  const { w, h, data: d } = img;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const R = 3;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 600));
  for (let y = R; y < h - R; y += step) {
    for (let x = R; x < w - R; x += step) {
      const p = (y * w + x) * 4;
      if ((d[p + 3] ?? 0) < 250) continue;
      let near = false;
      for (let dy = -R; dy <= R && !near; dy++) for (let dx = -R; dx <= R; dx++) if ((d[((y + dy) * w + x + dx) * 4 + 3] ?? 0) < 128) {
        near = true;
        break;
      }
      if (!near) continue;
      const r = d[p] ?? 0;
      const g = d[p + 1] ?? 0;
      const b = d[p + 2] ?? 0;
      if (0.299 * r + 0.587 * g + 0.114 * b > 110) continue;
      rs.push(r);
      gs.push(g);
      bs.push(b);
    }
  }
  if (rs.length < 30) return null;
  return toHex([median(rs), median(gs), median(bs)]);
}

/** 마젠타 쪽으로 기운 불투명 픽셀의 비율 (몬스터 색에 마젠타가 있으면 키잉이 먹는다). */
function magentaShare(img: Rgba): number {
  let n = 0;
  let m = 0;
  const d = img.data;
  for (let p = 0; p < d.length; p += 4 * 3) {
    if ((d[p + 3] ?? 0) < 250) continue;
    n++;
    const r = d[p] ?? 0;
    const g = d[p + 1] ?? 0;
    const b = d[p + 2] ?? 0;
    if (r - g > 90 && b - g > 90 && Math.abs(r - b) < 90) m++;
  }
  return n === 0 ? 0 : m / n;
}

export function pickRatio(w: number, h: number): string {
  const a = w / h;
  let best = '1:1';
  let bestD = Infinity;
  for (const r of Object.keys(SEEDANCE_SIZES['720p'] ?? {})) {
    const [rw, rh] = r.split(':').map(Number) as [number, number];
    const d = Math.abs(Math.log(a / (rw / rh)));
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

export interface PrepareOptions {
  readonly input: string;
  readonly out?: string;
  readonly resolution?: string;
  readonly ratio?: string;
  readonly zoom?: number;
  readonly canvas?: { w: number; h: number };
  readonly foot?: { x: number; y: number };
  readonly outline?: string;
  readonly quiet?: boolean;
}

/** '그룹/key' 또는 경로 → 원본 경로, 그룹, key. */
export function resolveInput(input: string): { path: string; group: string; key: string } {
  let path = input;
  if (!/\.(png|webp)$/i.test(input) && !isAbsolute(input) && input.includes('/')) path = join(ART_RAW, `${input}.png`);
  path = resolve(path);
  const key = basename(path, extname(path));
  const group = basename(dirname(path));
  return { path, group, key };
}

export async function prepare(o: PrepareOptions): Promise<{ png: string; json: string; sidecar: PrepSidecar }> {
  const { path, group, key } = resolveInput(o.input);
  const isMonster = group === 'monsters';
  const { species, pose } = isMonster ? splitKey(key) : { species: key, pose: 'base' };
  const resolution = o.resolution ?? '720p';
  const sizes = SEEDANCE_SIZES[resolution];
  if (sizes === undefined) fail(`--resolution은 ${Object.keys(SEEDANCE_SIZES).join(', ')} 가운데 하나`);

  const img = await readImage(path);
  levelAlpha(img);
  const box = alphaBox(img);
  if (box === null) fail(`그림이 모두 투명하다: ${rel(path)}`);

  // 캔버스 (요청 크기 단위).
  const meta = loadMeta();
  const own = meta[group]?.[key];
  let canvas = o.canvas ?? (own !== undefined ? { w: own.trim.ow, h: own.trim.oh } : undefined);
  if (canvas === undefined) {
    if (isMonster) canvas = { w: 1024, h: 1024 };
    else if (group === 'characters') canvas = { w: 1024, h: 1536 };
    else canvas = { w: img.w, h: img.h };
  }
  if (Math.abs(canvas.w / canvas.h - img.w / img.h) > 0.01) console.warn(`  경고: 원본 비율(${img.w}x${img.h})이 캔버스(${canvas.w}x${canvas.h})와 다르다`);
  const rawToCanvas = canvas.w / img.w;

  // 발 기준점 (캔버스).
  let foot = o.foot;
  let footFrom = '--foot';
  if (foot === undefined) {
    if (isMonster) {
      const base = meta.monsters?.[`${species}_base`];
      if (base !== undefined) {
        foot = { x: canvas.w / 2, y: base.trim.y + base.trim.h };
        footFrom = `meta.json monsters/${species}_base (monsterFoot와 같다)`;
      } else {
        const basePath = join(dirname(path), `${species}_base.png`);
        let bb = box;
        if (basePath !== path && fileExists(basePath)) {
          const bi = await readImage(basePath);
          levelAlpha(bi);
          bb = alphaBox(bi) ?? box;
        }
        foot = { x: canvas.w / 2, y: (bb.y + bb.h) * rawToCanvas };
        footFrom = `원본 알파 (${species}_base 아래 끝)`;
      }
    } else if (own !== undefined) {
      foot = { x: own.trim.x + own.trim.w / 2, y: own.trim.y + own.trim.h };
      footFrom = `meta.json ${group}/${key} (trim 아래 가운데)`;
    } else {
      foot = { x: (box.x + box.w / 2) * rawToCanvas, y: (box.y + box.h) * rawToCanvas };
      footFrom = '원본 알파 (아래 가운데)';
    }
  }

  // 출력 크기와 놓을 자리.
  const ratio = o.ratio ?? pickRatio(img.w, img.h);
  const size = sizes[ratio];
  if (size === undefined) fail(`--ratio는 ${Object.keys(sizes).join(', ')} 가운데 하나`);
  const [ow, oh] = size;
  const zoom = o.zoom ?? 1;
  const f = Math.min(ow / img.w, oh / img.h) * zoom;
  const sw = Math.round(img.w * f);
  const sh = Math.round(img.h * f);
  const px = Math.round((ow - sw) / 2);
  const py = Math.round((oh - sh) / 2);
  const sx = sw / canvas.w;
  const sy = sh / canvas.h;

  const outline = o.outline ?? measureOutline(img) ?? DEFAULT_OUTLINE;
  const mag = magentaShare(img);
  if (mag > 0.002) console.warn(`  경고: 그림의 ${(mag * 100).toFixed(1)}%가 마젠타에 가깝다. 키잉이 그 부분을 지울 수 있다.`);

  const png = resolve(o.out ?? join(ANIM_RAW, 'prep', `${key}.png`));
  const json = png.replace(/\.png$/i, '') + '.json';
  ensureDir(dirname(png));

  // ffmpeg: 마젠타 바탕 + (다듬은) 원본. 미리 곱한 알파로 줄여야 가장자리에 엉뚱한 색이 끼지 않는다.
  const kc = `0x${KEY_RGB.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const graph = [
    `[1:v]format=rgba,premultiply=inplace=1,scale=${sw}:${sh}:flags=area[fg]`,
    `[0:v]format=rgba[bg]`,
    `[bg][fg]overlay=x=${px}:y=${py}:alpha=premultiplied:format=rgb,format=rgb24[out]`,
  ].join(';');
  await run(
    ffmpeg(),
    [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=${kc}:s=${ow}x${oh}:d=1,format=rgba`,
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${img.w}x${img.h}`, '-i', 'pipe:0',
      '-filter_complex', graph, '-map', '[out]', '-frames:v', '1', '-c:v', 'png', '-f', 'image2', '-update', '1', png,
    ],
    img.data,
  );

  const sidecar: PrepSidecar = {
    version: 1,
    source: rel(path),
    group,
    key,
    species,
    pose,
    image: basename(png),
    raw: { w: img.w, h: img.h },
    canvas,
    out: { w: ow, h: oh, ratio, resolution },
    place: { x: px, y: py, w: sw, h: sh },
    canvasToOut: { sx: round(sx, 6), sy: round(sy, 6), ox: px, oy: py },
    foot: { canvas: { x: round(foot.x, 2), y: round(foot.y, 2) }, out: { x: round(foot.x * sx + px, 2), y: round(foot.y * sy + py, 2) }, from: footFrom },
    bbox: { x: round(box.x * f + px, 1), y: round(box.y * f + py, 1), w: round(box.w * f, 1), h: round(box.h * f, 1) },
    outline,
    background: toHex(KEY_RGB),
  };
  writeJson(json, sidecar);
  if (o.quiet !== true) {
    console.log(`준비: ${rel(path)} (${img.w}x${img.h}, 캔버스 ${canvas.w}x${canvas.h}) → ${rel(png)} (${ow}x${oh}, ${ratio} ${resolution})`);
    console.log(`  놓은 자리 ${px},${py} ${sw}x${sh}  발 캔버스 (${sidecar.foot.canvas.x}, ${sidecar.foot.canvas.y}) → 출력 (${sidecar.foot.out.x}, ${sidecar.foot.out.y})  [${footFrom}]`);
    console.log(`  외곽선 ${outline}  여유: 위 ${Math.round(sidecar.bbox.y)}px, 아래 ${Math.round(oh - sidecar.bbox.y - sidecar.bbox.h)}px`);
    const top = sidecar.bbox.y / oh;
    if (top < 0.1) console.warn('  경고: 그림 위쪽 여유가 10%보다 적다. 점프가 화면 밖으로 나갈 수 있다 (--zoom 0.85).');
  }
  return { png, json, sidecar };
}

function parsePair(s: string | undefined, sep: string): { a: number; b: number } | undefined {
  if (s === undefined) return undefined;
  const [a, b] = s.split(sep).map(Number);
  if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) fail(`숫자 둘이 필요하다: ${s}`);
  return { a, b };
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2), { valued: ['out', 'resolution', 'ratio', 'zoom', 'canvas', 'foot', 'outline'], switches: [] });
  const input = args.positional[0];
  if (input === undefined) {
    console.log('node tools/sprite/prepare.ts <원본.png | 그룹/key> [--out FILE.png] [--resolution 720p] [--ratio 1:1] [--zoom 1] [--canvas 1024x1024] [--foot 512,849] [--outline #21120d]');
    process.exit(1);
  }
  const canvas = parsePair(args.get('canvas'), 'x');
  const foot = parsePair(args.get('foot'), ',');
  const outline = args.get('outline');
  if (outline !== undefined) parseHex(outline);
  await prepare({
    input,
    out: args.get('out'),
    resolution: args.get('resolution'),
    ratio: args.get('ratio'),
    zoom: clamp01(args.num('zoom', 1)) || 1,
    canvas: canvas === undefined ? undefined : { w: canvas.a, h: canvas.b },
    foot: foot === undefined ? undefined : { x: foot.a, y: foot.b },
    outline,
  });
}
