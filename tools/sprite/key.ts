// 마젠타 바탕 빼기 (크로마 키). extract.ts가 프레임마다 부른다. 입력은 ffmpeg가 낸 yuv444p (전 범위 0~255) 한 프레임.
//
// 왜 YCbCr에서 하나: H.264 4:2:0은 색(Cb·Cr)을 가로세로 반 해상도로 저장하고 블록 경계에서 번지게 한다.
//   밝기(Y)는 제 해상도 그대로라 가장자리가 날카롭다. 그래서
//   1) 바탕인지 아닌지는 색까지 넣은 거리로 크게 가르고 (색은 흐리지만 마젠타와 그림 색은 멀다),
//   2) 가장자리 띠 안에서는 알파를 밝기로 정한다: 그림의 바깥 둘레는 언제나 짙은 외곽선이고,
//      외곽선(어둡다)과 마젠타(중간 밝기)가 섞인 픽셀은 Y가 둘 사이에 놓인다 → α = (Y_K − Y) / (Y_K − Y_O).
//      색이 번져도 외곽선과 마젠타 사이의 선분 위에서 번지므로(잔차가 작다) 이 길을 쓴다. 잔차가 크면(외곽선이 아닌 색) 쓰지 않는다.
//   3) 띠 안의 픽셀 색은 외곽선 색으로 바꾼다: 반투명 가장자리와 색이 번진 외곽선 안쪽에 분홍 테가 남지 않는다.
//   4) 외곽선 길로 가지 않는 반투명 픽셀(밝은 색의 흐림 등)은 바탕 색을 빼서(unmix) 제 색을 되살리고 마젠타 기운을 뺀다(despill).
//   5) 작은 섬(압축 잡티)을 지운다.
// 바탕 색은 프레임마다 거친 격자(바탕판)로 잰다: 모델이 바탕에 옅은 그러데이션·밝기 흔들림을 넣어도 버틴다.

import { median } from './common.ts';

export type Matrix = '601' | '709' | '2020';

const COEF: Readonly<Record<Matrix, { kr: number; kb: number }>> = {
  '601': { kr: 0.299, kb: 0.114 },
  '709': { kr: 0.2126, kb: 0.0722 },
  '2020': { kr: 0.2627, kb: 0.0593 },
};

export interface KeyParams {
  readonly matrix: Matrix;
  /** 바탕 색과의 거리가 이보다 작으면 바탕 (Y·Cb·Cr 0~255 단위, Y에 lumaWeight를 곱한 거리). */
  readonly dKey: number;
  /** 이보다 크면 그림. 사이는 가장자리. */
  readonly dFg: number;
  readonly lumaWeight: number;
  /** 가장자리 띠 폭 (px): 바탕에서 이만큼 안쪽까지 외곽선 처리를 한다 (색 번짐 폭). */
  readonly band: number;
  /** 외곽선–마젠타 선분에서 이만큼(Cb·Cr 거리) 벗어난 색은 밝기 알파를 쓰지 않는다. */
  readonly residual: number;
  /** 밝기 알파의 죽은 구간 (Y 단위): 바탕 밝기의 작은 흔들림을 알파로 보지 않는다. */
  readonly deadZone: number;
  /** 이 넓이(알파 합, px)보다 작은 섬은 지운다. */
  readonly minIsland: number;
  /** 외곽선 색 (RGB). null이면 첫 프레임에서 잰다. */
  readonly outline: readonly [number, number, number] | null;
  /** 잴 수 없을 때 쓸 외곽선 색. */
  readonly outlineFallback: readonly [number, number, number];
}

export const DEFAULT_KEY: KeyParams = {
  matrix: '601',
  dKey: 26,
  dFg: 70,
  lumaWeight: 0.5,
  band: 3,
  residual: 26,
  deadZone: 4,
  minIsland: 40,
  outline: null,
  outlineFallback: [0x21, 0x12, 0x0d],
};

export interface Ycc {
  y: number;
  cb: number;
  cr: number;
}

export function rgbToYcc(rgb: readonly number[], m: Matrix): Ycc {
  const { kr, kb } = COEF[m];
  const kg = 1 - kr - kb;
  const r = rgb[0] ?? 0;
  const g = rgb[1] ?? 0;
  const b = rgb[2] ?? 0;
  const y = kr * r + kg * g + kb * b;
  return { y, cb: (b - y) / (2 * (1 - kb)), cr: (r - y) / (2 * (1 - kr)) };
}

export function yccToRgb(y: number, cb: number, cr: number, m: Matrix, out: number[] = [0, 0, 0]): number[] {
  const { kr, kb } = COEF[m];
  const kg = 1 - kr - kb;
  const r = y + 2 * (1 - kr) * cr;
  const b = y + 2 * (1 - kb) * cb;
  const g = (y - kr * r - kb * b) / kg;
  out[0] = r < 0 ? 0 : r > 255 ? 255 : r;
  out[1] = g < 0 ? 0 : g > 255 ? 255 : g;
  out[2] = b < 0 ? 0 : b > 255 ? 255 : b;
  return out;
}

export interface FrameStats {
  /** 바탕 색 (가장자리 둘레의 중앙값, YCbCr) */
  readonly key: Ycc;
  /** 바탕판 칸 가운데 바탕을 잴 수 있었던 비율 */
  readonly plateCoverage: number;
  /** 둘레 픽셀이 바탕 색에서 벗어난 정도 (중앙 거리) */
  readonly ringNoise: number;
  readonly transparent: number;
  readonly partial: number;
  readonly islandsRemoved: number;
  /** 그림이 프레임 가장자리에 닿았나 (잘렸을 수 있다) */
  readonly touchesEdge: boolean;
}

const GRID = 12;

export class Keyer {
  readonly w: number;
  readonly h: number;
  readonly p: KeyParams;
  /** 외곽선 색 (첫 프레임에서 정한다) */
  outline: Ycc | null = null;
  outlineRgb: [number, number, number] = [0, 0, 0];
  outlineFrom = '';
  private readonly n: number;
  private readonly kY: Float32Array;
  private readonly kCb: Float32Array;
  private readonly kCr: Float32Array;
  private readonly dist: Float32Array;
  private readonly cls: Uint8Array;
  private readonly near: Uint16Array;
  private readonly alpha: Float32Array;
  private readonly label: Int32Array;

  constructor(w: number, h: number, p: KeyParams) {
    this.w = w;
    this.h = h;
    this.p = p;
    this.n = w * h;
    this.kY = new Float32Array(this.n);
    this.kCb = new Float32Array(this.n);
    this.kCr = new Float32Array(this.n);
    this.dist = new Float32Array(this.n);
    this.cls = new Uint8Array(this.n);
    this.near = new Uint16Array(this.n);
    this.alpha = new Float32Array(this.n);
    this.label = new Int32Array(this.n);
  }

  /** 둘레(폭 4px)의 중앙값 = 이 프레임의 바탕 색. */
  private ringKey(f: Buffer): { key: Ycc; noise: number } {
    const { w, h, n } = this;
    const ys: number[] = [];
    const cbs: number[] = [];
    const crs: number[] = [];
    const add = (x: number, y: number): void => {
      const i = y * w + x;
      ys.push(f[i] ?? 0);
      cbs.push((f[n + i] ?? 128) - 128);
      crs.push((f[2 * n + i] ?? 128) - 128);
    };
    for (let r = 0; r < 4; r++) {
      for (let x = 0; x < w; x += 2) {
        add(x, r);
        add(x, h - 1 - r);
      }
      for (let y = 4; y < h - 4; y += 2) {
        add(r, y);
        add(w - 1 - r, y);
      }
    }
    const key = { y: median(ys.slice()), cb: median(cbs.slice()), cr: median(crs.slice()) };
    const ds: number[] = [];
    for (let i = 0; i < ys.length; i += 3) ds.push(Math.hypot((ys[i] ?? 0) - key.y, (cbs[i] ?? 0) - key.cb, (crs[i] ?? 0) - key.cr));
    return { key, noise: median(ds) };
  }

  /** 바탕판: 거친 격자 칸마다 바탕다운 픽셀의 중앙값, 빈 칸은 이웃으로 메우고, 픽셀마다 쌍선형으로 편다. */
  private buildPlate(f: Buffer, key: Ycc): number {
    const { w, h, n } = this;
    const gw = GRID;
    const gh = GRID;
    const cy = new Float32Array(gw * gh);
    const ccb = new Float32Array(gw * gh);
    const ccr = new Float32Array(gw * gh);
    const ok = new Uint8Array(gw * gh);
    // 바탕다운 픽셀 = 색의 '방향'(색상)이 둘레 바탕과 15° 안이고 채도가 그 30% 이상. 밝기는 보지 않는다:
    // 그러데이션·비네트로 어두워진 마젠타도 바탕으로 잡힌다 (색의 크기는 밝기 따라 줄지만 방향은 그대로).
    const kmag = Math.hypot(key.cb, key.cr) || 1;
    const kdx = key.cb / kmag;
    const kdy = key.cr / kmag;
    const COS = Math.cos((15 * Math.PI) / 180);
    let valid = 0;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const x0 = Math.floor((gx * w) / gw);
        const x1 = Math.floor(((gx + 1) * w) / gw);
        const y0 = Math.floor((gy * h) / gh);
        const y1 = Math.floor(((gy + 1) * h) / gh);
        const ys: number[] = [];
        const cbs: number[] = [];
        const crs: number[] = [];
        let total = 0;
        for (let y = y0; y < y1; y += 2) {
          for (let x = x0; x < x1; x += 2) {
            total++;
            const i = y * w + x;
            const Y = f[i] ?? 0;
            const cb = (f[n + i] ?? 128) - 128;
            const cr = (f[2 * n + i] ?? 128) - 128;
            const m = Math.hypot(cb, cr);
            if (m < kmag * 0.3 || (cb * kdx + cr * kdy) < m * COS) continue;
            ys.push(Y);
            cbs.push(cb);
            crs.push(cr);
          }
        }
        const c = gy * gw + gx;
        if (ys.length >= Math.max(8, total * 0.25)) {
          cy[c] = median(ys);
          ccb[c] = median(cbs);
          ccr[c] = median(crs);
          ok[c] = 1;
          valid++;
        }
      }
    }
    // 빈 칸 메우기 (이웃 평균을 되풀이). 하나도 없으면 둘레 값.
    if (valid === 0) {
      cy.fill(key.y);
      ccb.fill(key.cb);
      ccr.fill(key.cr);
    } else {
      let missing = gw * gh - valid;
      while (missing > 0) {
        const next = ok.slice();
        for (let gy = 0; gy < gh; gy++) {
          for (let gx = 0; gx < gw; gx++) {
            const c = gy * gw + gx;
            if (ok[c] === 1) continue;
            let s = 0;
            let a = 0;
            let b = 0;
            let k = 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
              const x = gx + dx;
              const y = gy + dy;
              if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
              const q = y * gw + x;
              if (ok[q] !== 1) continue;
              s += cy[q] ?? 0;
              a += ccb[q] ?? 0;
              b += ccr[q] ?? 0;
              k++;
            }
            if (k > 0) {
              cy[c] = s / k;
              ccb[c] = a / k;
              ccr[c] = b / k;
              next[c] = 1;
              missing--;
            }
          }
        }
        ok.set(next);
      }
    }
    // 픽셀마다 쌍선형 (칸 가운데 기준).
    for (let y = 0; y < h; y++) {
      const fy = Math.min(gh - 1, Math.max(0, ((y + 0.5) * gh) / h - 0.5));
      const y0 = Math.floor(fy);
      const y1 = Math.min(gh - 1, y0 + 1);
      const ty = fy - y0;
      for (let x = 0; x < w; x++) {
        const fx = Math.min(gw - 1, Math.max(0, ((x + 0.5) * gw) / w - 0.5));
        const x0 = Math.floor(fx);
        const x1 = Math.min(gw - 1, x0 + 1);
        const tx = fx - x0;
        const a = y0 * gw + x0;
        const b = y0 * gw + x1;
        const c = y1 * gw + x0;
        const d = y1 * gw + x1;
        const i = y * w + x;
        const w00 = (1 - tx) * (1 - ty);
        const w10 = tx * (1 - ty);
        const w01 = (1 - tx) * ty;
        const w11 = tx * ty;
        this.kY[i] = (cy[a] ?? 0) * w00 + (cy[b] ?? 0) * w10 + (cy[c] ?? 0) * w01 + (cy[d] ?? 0) * w11;
        this.kCb[i] = (ccb[a] ?? 0) * w00 + (ccb[b] ?? 0) * w10 + (ccb[c] ?? 0) * w01 + (ccb[d] ?? 0) * w11;
        this.kCr[i] = (ccr[a] ?? 0) * w00 + (ccr[b] ?? 0) * w10 + (ccr[c] ?? 0) * w01 + (ccr[d] ?? 0) * w11;
      }
    }
    return valid / (gw * gh);
  }

  /** 거리, 분류 (0 바탕, 1 가장자리, 2 그림), 그림이 아닌 곳(cls 0·1)까지의 거리(px, 체임퍼). */
  private classify(f: Buffer): void {
    const { w, h, n } = this;
    const lw = this.p.lumaWeight;
    for (let i = 0; i < n; i++) {
      const Y = f[i] ?? 0;
      const cb = (f[n + i] ?? 128) - 128;
      const cr = (f[2 * n + i] ?? 128) - 128;
      const d = Math.sqrt(lw * (Y - (this.kY[i] ?? 0)) ** 2 + (cb - (this.kCb[i] ?? 0)) ** 2 + (cr - (this.kCr[i] ?? 0)) ** 2);
      this.dist[i] = d;
      this.cls[i] = d < this.p.dKey ? 0 : d > this.p.dFg ? 2 : 1;
    }
    // 체임퍼 거리 (가로세로 3, 대각 4) → px ×3. 그림이 아닌 곳(cls 0·1)에서 잰다: 오목한 모서리 끝의 가장자리 픽셀도 띠를 만든다.
    const INF = 65535;
    const D = this.near;
    for (let i = 0; i < n; i++) D[i] = this.cls[i] === 2 ? INF : 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let v = D[i] ?? INF;
        if (v === 0) continue;
        if (x > 0) v = Math.min(v, (D[i - 1] ?? INF) + 3);
        if (y > 0) {
          v = Math.min(v, (D[i - w] ?? INF) + 3);
          if (x > 0) v = Math.min(v, (D[i - w - 1] ?? INF) + 4);
          if (x < w - 1) v = Math.min(v, (D[i - w + 1] ?? INF) + 4);
        }
        D[i] = v;
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        let v = D[i] ?? INF;
        if (v === 0) continue;
        if (x < w - 1) v = Math.min(v, (D[i + 1] ?? INF) + 3);
        if (y < h - 1) {
          v = Math.min(v, (D[i + w] ?? INF) + 3);
          if (x < w - 1) v = Math.min(v, (D[i + w + 1] ?? INF) + 4);
          if (x > 0) v = Math.min(v, (D[i + w - 1] ?? INF) + 4);
        }
        D[i] = v;
      }
    }
  }

  /** 외곽선 색 재기: 그림 쪽, 바탕에서 band+1 ~ band+4 px 안쪽의 어두운 픽셀 (색 번짐이 덜한 곳)의 중앙값. */
  private measureOutline(f: Buffer): Ycc | null {
    const { n } = this;
    const lo = (this.p.band + 1) * 3;
    const hi = (this.p.band + 4) * 3;
    const ys: number[] = [];
    const cbs: number[] = [];
    const crs: number[] = [];
    for (let i = 0; i < n; i++) {
      if (this.cls[i] !== 2) continue;
      const d = this.near[i] ?? 0;
      if (d < lo || d > hi) continue;
      const Y = f[i] ?? 0;
      if (Y > (this.kY[i] ?? 0) * 0.75) continue;
      ys.push(Y);
      cbs.push((f[n + i] ?? 128) - 128);
      crs.push((f[2 * n + i] ?? 128) - 128);
    }
    if (ys.length < 60) return null;
    return { y: median(ys), cb: median(cbs), cr: median(crs) };
  }

  /** 한 프레임 → RGBA (곧은 알파). 투명한 픽셀의 색은 외곽선 색. */
  process(f: Buffer, out: Buffer = Buffer.alloc(this.n * 4)): { rgba: Buffer; stats: FrameStats } {
    const { w, h, n, p } = this;
    const ring = this.ringKey(f);
    const coverage = this.buildPlate(f, ring.key);
    this.classify(f);

    if (this.outline === null) {
      if (p.outline !== null) {
        this.outline = rgbToYcc(p.outline, p.matrix);
        this.outlineFrom = '정해 준 색';
      } else {
        const m = this.measureOutline(f);
        this.outline = m ?? rgbToYcc(p.outlineFallback, p.matrix);
        this.outlineFrom = m === null ? '기본값 (잴 수 없었다)' : '첫 프레임에서 잼';
      }
      const o = this.outline;
      const rgb = yccToRgb(o.y, o.cb, o.cr, p.matrix);
      this.outlineRgb = [Math.round(rgb[0] ?? 0), Math.round(rgb[1] ?? 0), Math.round(rgb[2] ?? 0)];
    }
    const O = this.outline;
    const band3 = p.band * 3;
    const alpha = this.alpha;
    const rgb: number[] = [0, 0, 0];
    const or = this.outlineRgb[0];
    const og = this.outlineRgb[1];
    const ob = this.outlineRgb[2];
    const dz = p.deadZone;
    const wide = (p.band + 3) * 3;

    for (let i = 0; i < n; i++) {
      const c = this.cls[i] ?? 0;
      const o4 = i * 4;
      const near = this.near[i] ?? 0;
      const inBand = c === 1 || (c === 2 && near <= band3);
      if (!inBand) {
        if (c === 0) {
          alpha[i] = 0;
        } else {
          alpha[i] = 1;
          // 띠 바로 안쪽(band+3 px까지)의 어두운 외곽선 픽셀이 마젠타 쪽으로 물들었으면 외곽선 색으로 (오목한 모서리 끝).
          if (near <= wide && this.tinted(f, i, O)) {
            out[o4] = or;
            out[o4 + 1] = og;
            out[o4 + 2] = ob;
            continue;
          }
          yccToRgb(f[i] ?? 0, (f[n + i] ?? 128) - 128, (f[2 * n + i] ?? 128) - 128, p.matrix, rgb);
          out[o4] = rgb[0] ?? 0;
          out[o4 + 1] = rgb[1] ?? 0;
          out[o4 + 2] = rgb[2] ?? 0;
        }
        continue;
      }
      const Y = f[i] ?? 0;
      const cb = (f[n + i] ?? 128) - 128;
      const cr = (f[2 * n + i] ?? 128) - 128;
      const KY = this.kY[i] ?? 0;
      const kcb = this.kCb[i] ?? 0;
      const kcr = this.kCr[i] ?? 0;
      // 외곽선–바탕 선분에서의 색 잔차.
      const sx = kcb - O.cb;
      const sy = kcr - O.cr;
      const len2 = sx * sx + sy * sy || 1;
      let t = ((cb - O.cb) * sx + (cr - O.cr) * sy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const res = Math.hypot(cb - (O.cb + t * sx), cr - (O.cr + t * sy));
      const span = KY - dz - O.y;
      if (span > 12 && Y <= KY + 8 && res <= p.residual) {
        // 외곽선 길: 밝기로 알파, 색은 외곽선.
        let a = (KY - dz - Y) / span;
        a = a < 0 ? 0 : a > 1 ? 1 : a;
        alpha[i] = a;
        out[o4] = or;
        out[o4 + 1] = og;
        out[o4 + 2] = ob;
        continue;
      }
      // 그 밖: 거리로 알파 (부드럽게), 바탕을 빼서 제 색 되살리기, 마젠타 기운 빼기.
      const d = this.dist[i] ?? 0;
      let a = (d - p.dKey) / (p.dFg - p.dKey);
      a = a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a);
      alpha[i] = a;
      if (a <= 0) continue;
      let fy = Y;
      let fcb = cb;
      let fcr = cr;
      if (a < 1) {
        fy = (Y - (1 - a) * KY) / a;
        fcb = (cb - (1 - a) * kcb) / a;
        fcr = (cr - (1 - a) * kcr) / a;
      }
      const k2 = kcb * kcb + kcr * kcr || 1;
      const kc = (fcb * kcb + fcr * kcr) / k2;
      if (kc > 0.15) {
        fcb -= (kc - 0.15) * kcb;
        fcr -= (kc - 0.15) * kcr;
      }
      yccToRgb(fy, fcb, fcr, p.matrix, rgb);
      out[o4] = rgb[0] ?? 0;
      out[o4 + 1] = rgb[1] ?? 0;
      out[o4 + 2] = rgb[2] ?? 0;
    }

    // 정리: 아주 옅은 알파는 0, 거의 불투명은 1.
    for (let i = 0; i < n; i++) {
      const a = alpha[i] ?? 0;
      if (a < 0.03) alpha[i] = 0;
      else if (a > 0.97) alpha[i] = 1;
    }
    const removed = this.removeIslands();

    let transparent = 0;
    let partial = 0;
    let touches = false;
    for (let i = 0; i < n; i++) {
      const a = alpha[i] ?? 0;
      const o4 = i * 4;
      if (a === 0) {
        transparent++;
        out[o4] = or;
        out[o4 + 1] = og;
        out[o4 + 2] = ob;
        out[o4 + 3] = 0;
        continue;
      }
      if (a < 1) partial++;
      out[o4 + 3] = Math.round(a * 255);
      if (!touches) {
        const x = i % w;
        const y = (i - x) / w;
        if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && a > 0.5) touches = true;
      }
    }
    return {
      rgba: out,
      stats: { key: ring.key, plateCoverage: coverage, ringNoise: ring.noise, transparent, partial, islandsRemoved: removed, touchesEdge: touches },
    };
  }

  /** 어두운(외곽선 쪽) 픽셀의 색이 외곽선–바탕 선분 위에서 바탕 쪽으로 기울었나. */
  private tinted(f: Buffer, i: number, O: Ycc): boolean {
    const n = this.n;
    const Y = f[i] ?? 0;
    const KY = this.kY[i] ?? 0;
    if (Y > O.y + 0.5 * (KY - O.y)) return false;
    const cb = (f[n + i] ?? 128) - 128;
    const cr = (f[2 * n + i] ?? 128) - 128;
    const sx = (this.kCb[i] ?? 0) - O.cb;
    const sy = (this.kCr[i] ?? 0) - O.cr;
    const len2 = sx * sx + sy * sy || 1;
    const t = ((cb - O.cb) * sx + (cr - O.cr) * sy) / len2;
    if (t < 0.02) return false;
    const tc = t > 1 ? 1 : t;
    return Math.hypot(cb - (O.cb + tc * sx), cr - (O.cr + tc * sy)) <= this.p.residual;
  }

  /** 알파 > 0인 픽셀을 8방향으로 이어 덩어리를 만들고, 알파 합이 minIsland보다 작은 덩어리를 지운다. */
  private removeIslands(): number {
    const { w, h, n } = this;
    const alpha = this.alpha;
    const label = this.label;
    label.fill(0);
    const stack = new Int32Array(n);
    let next = 0;
    let removed = 0;
    const members: number[] = [];
    for (let s = 0; s < n; s++) {
      if ((alpha[s] ?? 0) === 0 || label[s] !== 0) continue;
      next++;
      let sp = 0;
      stack[sp++] = s;
      label[s] = next;
      let area = 0;
      members.length = 0;
      while (sp > 0) {
        const i = stack[--sp] ?? 0;
        members.push(i);
        area += alpha[i] ?? 0;
        const x = i % w;
        const y = (i - x) / w;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w || (dx === 0 && dy === 0)) continue;
            const j = yy * w + xx;
            if ((alpha[j] ?? 0) === 0 || label[j] !== 0) continue;
            label[j] = next;
            stack[sp++] = j;
          }
        }
      }
      if (area < this.p.minIsland) {
        removed++;
        for (const i of members) alpha[i] = 0;
      }
    }
    return removed;
  }
}
