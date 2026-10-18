// 디버그 오버레이 (지도에서 D 키): 배치형 마을 (DESIGN 6.1)의 칸 지도와 놓인 것의 안쪽 자리.
// 가진 땅 칸 격자, 땅 조각 경계, 놓인 것의 발자국·입구 칸 (초록 = 마을 입구와 이어진 길, 빨강 = 안 이어짐)·문,
// 부스 자리·줄·항아리·진행자, 경주로·오리배 물길 레인, 단체 놀이 마당 (모래판, 연 하늘, 줄다리기 선, 보물찾기 판·상자 자리),
// 쉬는 곳, 가게 계산대·주인, 일터 자리·기다리는 자리·반장. catalog.ts의 숫자를 눈으로 맞출 때 쓴다. 마을이 바뀌면 world.ts가 다시 그린다.
// 걸을 수 있는 길 칸은 옅은 파랑. GuestDebug = 걷는 손님의 자국·남은 길·지금 자리 (초록 = 길 칸이나 입구 있는 건물 안, 빨강 = 길 밖): 매 프레임.

import { Container, Graphics, Text } from 'pixi.js';
import { catalogKind, footprint } from '../data/catalog.ts';
import { BOOTH_IDS } from '../data/defs.ts';
import { CELL, CHUNK, CHUNKS, GRID, lanePoint, type Pt } from '../data/map.ts';
import { onRoad } from '../sim/path.ts';
import type { GameState } from '../sim/types.ts';
import type { Village } from '../sim/village.ts';
import { RACE_START_P } from './mapUtil.ts';

const COLORS = {
  grid: 0x2d6cdf,
  chunk: 0x1f3f9f,
  seat: 0x2e9e4f,
  queue: 0xe0a020,
  pot: 0xe07020,
  base: 0x8a3fbf,
  rest: 0x20a0a0,
  host: 0xc0398a,
  track: 0x8a5a00,
  ok: 0x2e9e4f,
  bad: 0xd94040,
} as const;

function label(text: string, at: Pt, color: number, size = 18): Text {
  const t = new Text({
    text,
    style: { fontFamily: 'sans-serif', fontSize: size, fill: color, stroke: { color: 0xffffff, width: 4, join: 'round' } },
    resolution: 2,
  });
  t.anchor.set(0.5, 1.2);
  t.position.set(at.x, at.y);
  return t;
}

function cross(g: Graphics, p: Pt, r: number, color: number): void {
  g.moveTo(p.x - r, p.y - r).lineTo(p.x + r, p.y + r).moveTo(p.x + r, p.y - r).lineTo(p.x - r, p.y + r).stroke({ width: 4, color });
}

export function buildDebugOverlay(v: Village): Container {
  const root = new Container();
  root.eventMode = 'none';
  const g = new Graphics();
  root.addChild(g);

  // 가진 땅 칸 격자와 조각 경계.
  for (let y = 0; y < GRID.h; y++) for (let x = 0; x < GRID.w; x++) if (v.isOwned(x, y)) g.rect(x * CELL, y * CELL, CELL, CELL);
  g.stroke({ width: 1.5, color: COLORS.grid, alpha: 0.35 });
  for (let cx = 0; cx <= CHUNKS.w; cx++) g.moveTo(cx * CHUNK * CELL, 0).lineTo(cx * CHUNK * CELL, GRID.h * CELL);
  for (let cy = 0; cy <= CHUNKS.h; cy++) g.moveTo(0, cy * CHUNK * CELL).lineTo(GRID.w * CELL, cy * CHUNK * CELL);
  g.stroke({ width: 5, color: COLORS.chunk, alpha: 0.6 });
  // 걸을 수 있는 길 칸 (마을 입구와 이어진 길).
  for (const i of v.walkable) g.rect((i % GRID.w) * CELL + 4, Math.floor(i / GRID.w) * CELL + 4, CELL - 8, CELL - 8);
  g.fill({ color: COLORS.grid, alpha: 0.14 });

  // 놓인 것: 발자국, 입구 칸, 문.
  for (const p of v.state.placed) {
    const fp = footprint(p.key);
    g.rect(p.x * CELL, p.y * CELL, fp.w * CELL, fp.h * CELL).stroke({ width: 4, color: COLORS.base, alpha: 0.8 });
    if (catalogKind(p.key) !== 'decor') root.addChild(label(p.key, { x: p.x * CELL + 50, y: p.y * CELL + 34 }, COLORS.base, 18));
    if (fp.entry !== undefined) {
      const ok = v.linkedId(p.id);
      const ex = (p.x + fp.entry.x) * CELL;
      const ey = (p.y + fp.entry.y) * CELL;
      g.rect(ex + 8, ey + 8, CELL - 16, CELL - 16).stroke({ width: 5, color: ok ? COLORS.ok : COLORS.bad });
      cross(g, v.door(p.key), 9, ok ? COLORS.ok : COLORS.bad);
    }
  }

  for (const id of BOOTH_IDS) {
    if (v.placed(id) === undefined) continue;
    const s = v.booth(id);
    cross(g, s.base, 14, COLORS.base);
    s.seats.forEach((p, i) => {
      g.circle(p.x, p.y, 12).stroke({ width: 3, color: COLORS.seat });
      root.addChild(label(`${i}`, p, COLORS.seat, 14));
    });
    s.queue.forEach((p, i) => {
      g.rect(p.x - 9, p.y - 9, 18, 18).stroke({ width: 3, color: COLORS.queue });
      root.addChild(label(`줄${i}`, p, COLORS.queue, 12));
    });
    s.hosts.forEach((p, i) => {
      cross(g, p, 10, COLORS.host);
      root.addChild(label(`진행${i}`, p, COLORS.host, 13));
    });
    g.circle(s.pot.x, s.pot.y, 14).stroke({ width: 3, color: COLORS.pot });
  }

  // 경주로·오리배 물길: 레인 가운데 선, 출발선·결승.
  const loops = [] as { course: Parameters<typeof lanePoint>[0]; start: number }[];
  if (v.placed('race') !== undefined) loops.push({ course: v.race(), start: RACE_START_P });
  if (v.placed('boat') !== undefined) loops.push({ course: v.boat().course, start: 0 });
  for (const { course, start } of loops) {
    for (let lane = 0; lane < course.lanes; lane++) {
      for (let i = 0; i <= 64; i++) {
        const p = lanePoint(course, lane, i / 64);
        if (i === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      }
      g.stroke({ width: 3, color: COLORS.track, alpha: 0.8 });
      const s = lanePoint(course, lane, start);
      const f = lanePoint(course, lane, 1);
      g.circle(s.x, s.y, 7).fill(COLORS.track);
      g.circle(f.x, f.y, 7).stroke({ width: 3, color: COLORS.track });
    }
  }
  if (v.placed('ssireum') !== undefined) {
    const R = v.ring();
    g.ellipse(R.center.x, R.center.y, R.rx, R.ry).stroke({ width: 3, color: COLORS.track });
  }
  if (v.placed('kite') !== undefined) {
    const K = v.kite();
    g.rect(K.sky.x, K.sky.y, K.sky.w, K.sky.h).stroke({ width: 3, color: COLORS.grid, alpha: 0.7 });
    g.moveTo(K.sky.x, K.skyLow).lineTo(K.sky.x + K.sky.w, K.skyLow).moveTo(K.sky.x, K.skyHigh).lineTo(K.sky.x + K.sky.w, K.skyHigh).stroke({ width: 2, color: COLORS.grid, alpha: 0.6 });
    g.rect(K.watch.x, K.watch.y, K.watch.w, K.watch.h).stroke({ width: 3, color: COLORS.rest });
  }
  if (v.placed('tug') !== undefined) {
    const T = v.tug();
    for (const dx of [-T.lineHalf, 0, T.lineHalf]) g.moveTo(T.center.x + dx, T.center.y - 90).lineTo(T.center.x + dx, T.center.y + 60).stroke({ width: 3, color: COLORS.track });
    g.rect(T.watch.x, T.watch.y, T.watch.w, T.watch.h).stroke({ width: 3, color: COLORS.rest });
  }
  if (v.placed('dig') !== undefined) {
    const D = v.dig();
    D.chests.forEach((p, i) => {
      g.circle(p.x, p.y, i < D.spots.length ? 16 : 10).stroke({ width: 3, color: COLORS.pot });
      root.addChild(label(i < D.spots.length ? `판${i}` : `상자${i}`, p, COLORS.pot, 14));
    });
    g.rect(D.watch.x, D.watch.y, D.watch.w, D.watch.h).stroke({ width: 3, color: COLORS.rest });
  }
  if (v.placed('boat') !== undefined) for (const w of v.boat().watch) g.rect(w.x, w.y, w.w, w.h).stroke({ width: 3, color: COLORS.rest });

  if (v.placed('fountain') !== undefined) {
    v.rest().forEach((p, i) => {
      g.circle(p.x, p.y, 10).stroke({ width: 3, color: COLORS.rest });
      root.addChild(label(`쉼${i}`, p, COLORS.rest, 14));
    });
  }
  // 넷째 묶음: 가게 계산대·주인, 일터 자리·기다리는 자리·반장.
  for (const shop of ['pawnshop', 'bank'] as const) {
    if (v.placed(shop) === undefined) continue;
    const sp = v.shop(shop);
    sp.counter.forEach((p, i) => {
      g.circle(p.x, p.y, 10).stroke({ width: 3, color: COLORS.seat });
      root.addChild(label(`${shop === 'pawnshop' ? '전당' : '은행'}${i}`, p, COLORS.seat, 14));
    });
    cross(g, sp.npc, 10, COLORS.host);
  }
  if (v.placed('workyard') !== undefined) {
    const Y = v.yard();
    for (const [f, fs] of Object.entries(Y.facilities)) {
      fs.spots.forEach((p, i) => {
        g.circle(p.x, p.y, 10).stroke({ width: 3, color: COLORS.seat });
        root.addChild(label(`${f}${i}`, p, COLORS.seat, 14));
      });
      fs.wait.forEach((p, i) => {
        g.rect(p.x - 8, p.y - 8, 16, 16).stroke({ width: 3, color: COLORS.queue });
        root.addChild(label(`${f}대기${i}`, p, COLORS.queue, 13));
      });
      cross(g, fs.face, 8, COLORS.pot);
    }
    cross(g, Y.foreman, 10, COLORS.host);
  }
  return root;
}

/** 걷는 손님 자국을 모으는 칸 수와 모으는 간격 (초). */
const TRAIL_MAX = 2400;
const TRAIL_EVERY = 0.2;

/**
 * 디버그: 걷는 손님의 자국 (지난 자리 점: 초록 = 길 칸이나 입구 있는 건물 안, 빨강 = 길 밖)과 지금 남은 길 (파란 선).
 * 점·선 굵기는 화면에서 늘 같게 (확대로 나눈다). world.ts가 디버그를 켰을 때만 매 프레임 부른다.
 */
export class GuestDebug {
  readonly g = new Graphics();
  private readonly xs = new Float32Array(TRAIL_MAX);
  private readonly ys = new Float32Array(TRAIL_MAX);
  private readonly ok = new Uint8Array(TRAIL_MAX);
  private n = 0;
  private head = 0;
  private acc = 0;
  /** 지금까지 잰 길 밖 자국 수. */
  off = 0;

  constructor() {
    this.g.eventMode = 'none';
  }

  update(state: GameState, dt: number, zoom: number): void {
    this.acc += dt;
    if (this.acc >= TRAIL_EVERY) {
      this.acc = 0;
      for (const m of state.monsters) {
        if (m.path.length === 0) continue;
        const k = this.head;
        this.xs[k] = m.pos.x;
        this.ys[k] = m.pos.y;
        const on = onRoad(state, m.pos);
        this.ok[k] = on ? 1 : 0;
        if (!on) this.off++;
        this.head = (k + 1) % TRAIL_MAX;
        this.n = Math.min(TRAIL_MAX, this.n + 1);
      }
    }
    const g = this.g;
    g.clear();
    const u = 1 / Math.max(0.05, zoom);
    for (const m of state.monsters) {
      if (m.path.length === 0) continue;
      g.moveTo(m.pos.x, m.pos.y);
      for (const p of m.path) g.lineTo(p.x, p.y);
      g.stroke({ width: 2.5 * u, color: COLORS.grid, alpha: 0.7, join: 'round' });
    }
    for (let i = 0; i < this.n; i++) if (this.ok[i] === 1) g.circle(this.xs[i] ?? 0, this.ys[i] ?? 0, 2.2 * u);
    g.fill({ color: COLORS.ok, alpha: 0.75 });
    for (let i = 0; i < this.n; i++) if (this.ok[i] === 0) g.circle(this.xs[i] ?? 0, this.ys[i] ?? 0, 3.5 * u);
    g.fill({ color: COLORS.bad });
    for (const m of state.monsters) {
      if (m.path.length === 0) continue;
      g.circle(m.pos.x, m.pos.y, 5 * u).fill(onRoad(state, m.pos) ? COLORS.ok : COLORS.bad).stroke({ width: 1.5 * u, color: 0xffffff });
    }
  }

  clear(): void {
    this.g.clear();
    this.n = this.head = 0;
    this.off = 0;
  }
}
