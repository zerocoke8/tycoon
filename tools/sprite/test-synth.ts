// Seedance 없이 처음부터 끝까지 시험: 진짜 원본(dragon_base)을 마젠타 바탕에 얹어 통통 점프·찌그러짐 영상(H.264 yuv420p)을
// ffmpeg로 만들고, extract.ts로 시트를 뽑아 자동으로 잰다.
//   node tools/sprite/test-synth.ts [--src monsters/dragon_base] [--crf 23] [--res 720p] [--noisy] [--untagged]
//     --noisy     바탕을 일부러 고르지 않게 (가장자리 어둡게 + 프레임마다 잡음): 모델이 바탕을 완전히 평평하게 못 낼 때
//     --untagged  색 태그 없이 ffmpeg 기본(BT.601)으로 인코딩: 태그 없는 영상을 받았을 때
// 쓰는 곳: tools/sprite/test-out/ (저장소에 넣지 않는다)
//   prep/<key>.png·json        prepare 결과
//   synth_hop.mp4              합성 영상 (2.5초, 24fps, 960×960, bt709 tv 범위)
//   anim/<species>/hop.webp·json·preview.png, anim/index.json
//   check_edges.png            첫 칸의 가장자리를 흰·검정·초록 바탕에 4배로 (분홍 테 눈으로 확인)
//   check_frames.png           모든 칸을 진한 남색 바탕에 (발 줄 맞춤 눈으로 확인)
//
// 재는 것:
//   1) 투명 바탕: 칸 네 귀퉁이가 투명, 시트의 투명 비율.
//   2) 분홍 테: 투명한 곳에서 4px 안의 가장자리 픽셀 가운데 마젠타 쪽으로 물든 것 (min(R−G, B−G) > 25).
//      첫 프레임은 정답과 자리마다 견주어 '새로' 물든 것이 없어야 하고, 시트 전체는 프레임당 수가 정답(원본 팔레트:
//      연보라 박쥐처럼 원래 그런 색)보다 늘지 않아야 한다. (그림 속 색 경계의 4:2:0 번짐은 영상 자체의 것이라 보지 않는다.)
//   3) 외곽선: 첫 프레임(= 입력 그림)을 원본에서 바로 만든 정답 칸과 견준다. 알파 IoU, 평균 |Δα|, 가장자리 띠의 부호 있는 Δα
//      (깎임·불어남), 불투명 속 색 차이.
//   4) 발: 점프가 아닌 프레임의 가장 아래 불투명 줄이 첫 프레임과 ±1px, 발 기준점이 그 바로 아래.
//   5) 되풀이 자르기, JSON 모양 (Pixi 스프라이트시트).

import { join } from 'node:path';
import { ART_RAW, ffmpeg, parseArgs, readImage, readJson, rel, resampleArea, run, SPRITE_DIR, writeImage, type Rgba } from './common.ts';
import { extract } from './extract.ts';
import { prepare } from './prepare.ts';

const args = parseArgs(process.argv.slice(2), { valued: ['src', 'crf', 'res'], switches: ['noisy', 'untagged'] });
const noisy = args.has('noisy');
const untagged = args.has('untagged');
const src = args.get('src') ?? 'monsters/dragon_base';
const crf = args.num('crf', 23);
const OUT = join(SPRITE_DIR, 'test-out');
const FPS = 24;
const DUR = 2.5;
const SHEET_FPS = 12;
/** 점프 구간 (초): 이 밖의 프레임은 발이 바닥에 있어야 한다. */
const HOP = [0.75, 1.45] as const;
const HOP_PX = 140;
const SQUASH = 0.1;

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string): void => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '통과' : '실패'}  ${name}: ${detail}`);
};

// 1) prepare
const t0 = Date.now();
const prep = await prepare({ input: src, out: join(OUT, 'prep', `${src.split('/').pop() ?? 'src'}.png`), resolution: args.get('res') ?? '720p' });
const sc = prep.sidecar;
const species = sc.species;
const footRel = { x: (sc.foot.out.x - sc.place.x) / sc.place.w, y: (sc.foot.out.y - sc.place.y) / sc.place.h };

// 2) 합성 영상: 투명 원본을 마젠타 위에, 시간에 따라 찌그러짐(scale)과 점프(y). 발 기준점이 늘 같은 자리(점프 빼고).
const S = `if(between(t,0.5,0.75),sin(PI*(t-0.5)/0.25),if(between(t,1.45,1.7),sin(PI*(t-1.45)/0.25),0))`;
const HOPX = `if(between(t,${HOP[0]},${HOP[1]}),${HOP_PX}*sin(PI*(t-${HOP[0]})/${HOP[1] - HOP[0]}),0)`;
const ow = sc.out.w;
const oh = sc.out.h;
const video = join(OUT, 'synth_hop.mp4');
const rawPath = join(ART_RAW, `${src}.png`);
const graph = [
  `[1:v]format=rgba,premultiply=inplace=1,scale=w='${sc.place.w}*(1+${SQUASH}*(${S}))':h='${sc.place.h}*(1-${SQUASH}*(${S}))':eval=frame:flags=area[fg]`,
  `[0:v]${noisy ? 'vignette=PI/4,noise=alls=7:allf=t,' : ''}format=rgba[bg]`,
  `[bg][fg]overlay=x='${sc.foot.out.x}-overlay_w*${footRel.x.toFixed(6)}':y='${sc.foot.out.y}-overlay_h*${footRel.y.toFixed(6)}-(${HOPX})':alpha=premultiplied:format=rgb:eval=frame:shortest=1,${untagged ? '' : 'scale=out_color_matrix=bt709:out_range=tv,'}format=yuv420p[v]`,
].join(';');
await run(ffmpeg(), [
  '-v', 'error', '-y',
  '-f', 'lavfi', '-i', `color=c=0xFF00FF:s=${ow}x${oh}:r=${FPS}:d=${DUR},format=rgba`,
  '-loop', '1', '-framerate', String(FPS), '-t', String(DUR), '-i', rawPath,
  '-filter_complex', graph, '-map', '[v]',
  '-c:v', 'libx264', '-crf', String(crf), '-preset', 'medium', '-pix_fmt', 'yuv420p',
  ...(untagged ? [] : ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']),
  video,
]);
console.log(`합성 영상: ${rel(video)} (${ow}x${oh}, ${DUR}s, ${FPS}fps, H.264 crf ${crf} yuv420p${untagged ? ', 태그 없음(601)' : ', bt709'}${noisy ? ', 고르지 않은 바탕' : ''})`);

// 3) extract (게임과 같은 WebP)
const res = await extract({ video, species, clip: 'hop', prep: prep.json, fps: SHEET_FPS, loop: 'on', outRoot: join(OUT, 'anim'), format: 'webp', debug: true });
const sheet = await readImage(res.image);
const meta = res.meta;
const { w: cw, h: ch } = meta.cell;
const cols = res.atlas.cols;
const cellOf = (img: Rgba, i: number): Rgba => {
  const cx = (i % cols) * cw;
  const cy = Math.floor(i / cols) * ch;
  const data = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) img.data.copy(data, y * cw * 4, ((cy + y) * img.w + cx) * 4, ((cy + y) * img.w + cx + cw) * 4);
  return { w: cw, h: ch, data };
};
const cells = Array.from({ length: meta.frames }, (_, i) => cellOf(sheet, i));

// ── 1) 투명 바탕
{
  let bad = 0;
  for (const c of cells) for (const [x, y] of [[0, 0], [cw - 1, 0], [0, ch - 1], [cw - 1, ch - 1]] as const) if ((c.data[(y * cw + x) * 4 + 3] ?? 0) !== 0) bad++;
  let clear = 0;
  for (let p = 3; p < sheet.data.length; p += 4) if (sheet.data[p] === 0) clear++;
  const share = clear / (sheet.w * sheet.h);
  check('투명 바탕', bad === 0 && share > 0.3, `귀퉁이 불투명 ${bad}개, 시트 투명 ${(share * 100).toFixed(1)}%`);
}

// ── 2) 분홍 테
/** 투명(α=0) 픽셀에서 r px 안인가 (체비셰프 거리, 칸 경계를 넘지 않는다). */
const nearClear = (img: Rgba, r: number, cellW: number, cellH: number): Uint8Array => {
  const { w, h, data } = img;
  const row = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(x - r, Math.floor(x / cellW) * cellW);
      const x1 = Math.min(x + r, Math.floor(x / cellW) * cellW + cellW - 1);
      for (let xx = x0; xx <= x1; xx++) if ((data[(y * w + xx) * 4 + 3] ?? 0) === 0) {
        row[y * w + x] = 1;
        break;
      }
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(y - r, Math.floor(y / cellH) * cellH);
    const y1 = Math.min(y + r, Math.floor(y / cellH) * cellH + cellH - 1);
    for (let x = 0; x < w; x++) for (let yy = y0; yy <= y1; yy++) if (row[yy * w + x] === 1) {
      out[y * w + x] = 1;
      break;
    }
  }
  return out;
};
const pinkCount = (img: Rgba): { n: number; worst: string } => {
  let n = 0;
  let worst = '';
  let worstV = 0;
  const near = nearClear(img, 4, cw, ch);
  for (let p = 0; p < img.data.length; p += 4) {
    const a = img.data[p + 3] ?? 0;
    if (a < 13 || near[p >> 2] !== 1) continue;
    const r = img.data[p] ?? 0;
    const g = img.data[p + 1] ?? 0;
    const b = img.data[p + 2] ?? 0;
    const v = Math.min(r - g, b - g);
    if (v > 25) {
      n++;
      if (v > worstV) {
        worstV = v;
        worst = `rgba(${r},${g},${b},${a})`;
      }
    }
  }
  return { n, worst };
};

// ── 3) 외곽선: 첫 프레임 정답과 견주기
{
  const raw = await readImage(rawPath);
  for (let p = 3; p < raw.data.length; p += 4) {
    const a = raw.data[p] ?? 0;
    raw.data[p] = a < 8 ? 0 : a >= 240 ? 255 : Math.round(((a - 8) / 232) * 255);
  }
  const frame: Rgba = { w: ow, h: oh, data: Buffer.alloc(ow * oh * 4) };
  const placed = resampleArea(raw, 0, 0, raw.w, raw.h, sc.place.w, sc.place.h);
  for (let y = 0; y < sc.place.h; y++) placed.copy(frame.data, ((sc.place.y + y) * ow + sc.place.x) * 4, y * sc.place.w * 4, (y + 1) * sc.place.w * 4);
  const cr = meta.source.crop;
  const vidPerOut = meta.source.videoSize[0] / ow;
  const gt = resampleArea(frame, cr.x / vidPerOut - cr.pad / cr.s, cr.y / vidPerOut - cr.pad / cr.s, cw / cr.s, ch / cr.s, cw, ch);
  const got = cells[0];
  if (got === undefined) throw new Error('칸이 없다');
  let inter = 0;
  let uni = 0;
  let sumDa = 0;
  let edgeN = 0;
  let edgeSigned = 0;
  let colN = 0;
  let colD = 0;
  for (let i = 0; i < cw * ch; i++) {
    const ag = (gt[i * 4 + 3] ?? 0) / 255;
    const ao = (got.data[i * 4 + 3] ?? 0) / 255;
    const mg = ag > 0.5;
    const mo = ao > 0.5;
    if (mg && mo) inter++;
    if (mg || mo) uni++;
    sumDa += Math.abs(ag - ao);
    if ((ag > 0.02 && ag < 0.98) || (ao > 0.02 && ao < 0.98)) {
      edgeN++;
      edgeSigned += ao - ag;
    }
    if (ag === 1 && ao === 1) {
      colN++;
      colD += (Math.abs((gt[i * 4] ?? 0) - (got.data[i * 4] ?? 0)) + Math.abs((gt[i * 4 + 1] ?? 0) - (got.data[i * 4 + 1] ?? 0)) + Math.abs((gt[i * 4 + 2] ?? 0) - (got.data[i * 4 + 2] ?? 0))) / 3;
    }
  }
  const iou = inter / Math.max(1, uni);
  const meanDa = sumDa / (cw * ch);
  const signed = edgeSigned / Math.max(1, edgeN);
  check('외곽선 (정답과 알파)', iou > 0.985 && meanDa < 0.01, `IoU ${iou.toFixed(4)}, 평균 |Δα| ${meanDa.toFixed(4)}`);
  check('외곽선 깎임·불어남', Math.abs(signed) < 0.12, `가장자리 ${edgeN}px의 평균 Δα ${signed >= 0 ? '+' : ''}${signed.toFixed(3)} (+ 불어남, − 깎임)`);
  // 분홍 테: 자리마다 정답과 견주기 + 시트 전체의 프레임당 수.
  const mag = (d: Buffer | Uint8Array, q: number): number => Math.min((d[q] ?? 0) - (d[q + 1] ?? 0), (d[q + 2] ?? 0) - (d[q + 1] ?? 0));
  let fresh = 0;
  let freshWorst = '';
  const nearGot = nearClear(got, 4, cw, ch);
  for (let i = 0; i < cw * ch; i++) {
    const q = i * 4;
    if ((got.data[q + 3] ?? 0) < 13 || nearGot[i] !== 1) continue;
    const m = mag(got.data, q);
    const mg = (gt[q + 3] ?? 0) > 0 ? mag(gt, q) : -999;
    if (m > 25 && m - mg > 20) {
      fresh++;
      if (freshWorst === '') freshWorst = `rgba(${got.data[q]},${got.data[q + 1]},${got.data[q + 2]},${got.data[q + 3]})`;
    }
  }
  const base = pinkCount({ w: cw, h: ch, data: gt }).n;
  const pk = pinkCount(sheet);
  const perFrame = pk.n / meta.frames;
  check('분홍 테 없음', fresh === 0 && perFrame <= base * 1.15 + 15, `첫 프레임에서 새로 물든 픽셀 ${fresh}개${freshWorst === '' ? '' : ` (예 ${freshWorst})`}, 시트 프레임당 ${perFrame.toFixed(1)}개 (원본 팔레트 ${base}개)`);
  check('속 색', colD / Math.max(1, colN) < 6, `불투명 ${colN}px의 평균 색 차이 ${(colD / Math.max(1, colN)).toFixed(2)} (H.264·WebP 손실 포함)`);
  // 정답 칸도 남긴다 (눈으로 견주기)
  await writeImage(join(OUT, 'check_gt_cell0.png'), { w: cw, h: ch, data: gt });
}

// ── 4) 발 줄
{
  const bottoms: number[] = [];
  const centers: number[] = [];
  for (const c of cells) {
    let bottom = -1;
    for (let y = ch - 1; y >= 0 && bottom < 0; y--) for (let x = 0; x < cw; x++) if ((c.data[(y * cw + x) * 4 + 3] ?? 0) > 127) {
      bottom = y;
      break;
    }
    bottoms.push(bottom);
    let sx = 0;
    let n = 0;
    for (let y = Math.max(0, bottom - 6); y <= bottom; y++) for (let x = 0; x < cw; x++) if ((c.data[(y * cw + x) * 4 + 3] ?? 0) > 127) {
      sx += x;
      n++;
    }
    centers.push(n > 0 ? sx / n : -1);
  }
  const start = meta.source.range[0];
  const ground: number[] = [];
  const air: number[] = [];
  bottoms.forEach((_, i) => {
    const t = (start + i) / SHEET_FPS;
    if (t > HOP[0] + 0.01 && t < HOP[1] - 0.01) air.push(i);
    else ground.push(i);
  });
  const b0 = bottoms[0] ?? 0;
  const c0 = centers[0] ?? 0;
  const off = ground.filter((i) => Math.abs((bottoms[i] ?? 0) - b0) > 1);
  const offX = ground.filter((i) => Math.abs((centers[i] ?? 0) - c0) > 3);
  const footY = meta.anchor.y * ch;
  check('발 줄 (점프 밖)', off.length === 0, `바닥 프레임 ${ground.length}개의 아래 끝 ${[...new Set(ground.map((i) => bottoms[i]))].join('/')}px, 어긋난 프레임 ${off.length === 0 ? '없음' : off.join(',')}`);
  check('발 가로 자리', offX.length === 0, `발 가운데 x ${Math.min(...ground.map((i) => centers[i] ?? 0)).toFixed(1)}~${Math.max(...ground.map((i) => centers[i] ?? 0)).toFixed(1)}px`);
  check('점프는 위로', air.every((i) => (bottoms[i] ?? 0) < b0 - 3), `점프 프레임 ${air.length}개의 아래 끝 ${air.map((i) => bottoms[i]).join(',')}`);
  check('발 기준점', footY - b0 >= -0.5 && footY - b0 <= 3, `anchor.y × 칸 높이 = ${footY.toFixed(2)}px, 첫 프레임 아래 끝 ${b0}px`);
}

// ── 5) 되풀이, JSON
{
  const expectEnd = Math.ceil(DUR * SHEET_FPS) - 1;
  check('되풀이 자르기', meta.source.range[1] === expectEnd && meta.loop, `쓴 범위 ${meta.source.range[0]}~${meta.source.range[1] - 1} (마지막 프레임 ${expectEnd} = 첫 프레임이라 뺌)`);
  const j = readJson<{ frames: Record<string, { frame: { w: number; h: number }; anchor: { x: number; y: number } }>; animations: Record<string, string[]>; meta: { size: { w: number; h: number }; scale: string; image: string } }>(res.json);
  const names = j.animations.hop ?? [];
  const okJson =
    names.length === meta.frames &&
    names.every((n) => j.frames[n] !== undefined) &&
    j.meta.size.w === sheet.w &&
    j.meta.size.h === sheet.h &&
    Number(j.meta.scale) > 0 &&
    j.meta.image === 'hop.webp';
  check('스프라이트시트 JSON', okJson, `프레임 ${names.length}개, 시트 ${j.meta.size.w}x${j.meta.size.h}, scale(칸 px/캔버스 px) ${j.meta.scale}, anchor (${meta.anchor.x}, ${meta.anchor.y})`);
  const idx = readJson<{ clips: Record<string, Record<string, { json: string }>> }>(join(OUT, 'anim', 'index.json'));
  check('index.json', idx.clips[species]?.hop?.json === `${species}/hop.json`, JSON.stringify(idx.clips[species]?.hop ?? null));
}

// ── 눈으로 볼 그림
{
  const c = cells[0];
  if (c !== undefined) {
    const K = 4;
    const W0 = Math.min(cw, 140);
    const H0 = Math.min(ch, 140);
    const x0 = 0;
    const y0 = Math.max(0, Math.round(meta.anchor.y * ch) - H0 + 4);
    const bgs = [[255, 255, 255], [0, 0, 0], [40, 200, 60]] as const;
    const w = W0 * K * bgs.length + 8 * (bgs.length - 1);
    const h = H0 * K;
    const o = Buffer.alloc(w * h * 3, 128);
    bgs.forEach((bg, bi) => {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < W0 * K; x++) {
          const p = ((y0 + Math.floor(y / K)) * cw + x0 + Math.floor(x / K)) * 4;
          const a = (c.data[p + 3] ?? 0) / 255;
          const q = (y * w + bi * (W0 * K + 8) + x) * 3;
          for (let k = 0; k < 3; k++) o[q + k] = Math.round((c.data[p + k] ?? 0) * a + (bg[k] ?? 0) * (1 - a));
        }
      }
    });
    await writeImage(join(OUT, 'check_edges.png'), { w, h, data: o }, { channels: 3 });
  }
  const o = Buffer.alloc(sheet.w * sheet.h * 3);
  for (let i = 0; i < sheet.w * sheet.h; i++) {
    const a = (sheet.data[i * 4 + 3] ?? 0) / 255;
    const bg = [28, 32, 70];
    for (let k = 0; k < 3; k++) o[i * 3 + k] = Math.round((sheet.data[i * 4 + k] ?? 0) * a + (bg[k] ?? 0) * (1 - a));
    const ly = Math.floor(i / sheet.w) % ch;
    if (ly === Math.round(meta.anchor.y * ch)) {
      o[i * 3] = 255;
      o[i * 3 + 1] = 210;
      o[i * 3 + 2] = 0;
    }
  }
  await writeImage(join(OUT, 'check_frames.png'), { w: sheet.w, h: sheet.h, data: o }, { channels: 3 });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? '모두 통과' : `실패 ${failed.length}개`} (${((Date.now() - t0) / 1000).toFixed(1)}초). 그림: ${rel(join(OUT, 'check_edges.png'))}, ${rel(join(OUT, 'check_frames.png'))}, ${rel(res.preview ?? '')}`);
process.exit(failed.length === 0 ? 0 : 1);
