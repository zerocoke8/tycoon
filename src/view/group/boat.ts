// 지도 위 오리배 경주. 선착장 그림(map/boat_dock, 부스 그림)과 진행자는 buildings.ts.
// 바닥층(코드): 물길 띠(밝은 물빛)·레인 점선·안팎 부표 줄, 출발선(흰 점선)·결승선(체크무늬), 연못 잔물결, 배 뒤 물결 자국, 자리마다 나무 발판.
// 물체층: 배 넷(racers/boat_*, 레인 = 배 번호, 그림은 왼쪽으로 간다)과 출발·결승 깃대 (결승 깃대 사이에 삼각 깃발 줄).
// sim의 판(BoothState.group, play.kind 'boat')을 매 프레임 읽는다 (GroupMapBase):
//   idle·gathering: 출발선 뒤에서 둥실. 출발 3초 전부터 출발선 위에 3·2·1, 출발 신호 진행자 통통.
//   running: raceProgress(play.race, 배, 화면 시계)로 물길을 돈다. 빠를수록 뱃머리를 들고 물결 자국을 길게 남긴다.
//            앞선 배가 바뀌면 그 배 둘레에 물보라. 결승 뒤 조금 미끄러진다.
//   done: 1등 배가 통통 (결승선에 색종이, 구조 요원 통통). 판이 끝나면 아래 물길을 지나 출발선으로 돌아온다
//         (선착장 그림 뒤로 숨지 않게 안쪽 물길로 비켜서).
// 잠긴 부스라도 구역이 열렸으면 물길·깃대·발판만 흐리게 보인다.
// 참가 손님은 자기 배 쪽을 바라본다 (몸 맡기기: facing만).

import { Container, Graphics } from 'pixi.js';
import { BOAT } from '../../data/defs.ts';
import { BOAT_COURSE, PONDS, boatPoint } from '../../data/map.ts';
import { raceOf } from '../../sim/group/core.ts';
import { raceProgress, raceStandings } from '../../sim/race.ts';
import type { GroupPlay, GroupState, MonsterId, RaceResult, RacerIndex } from '../../sim/types.ts';
import { ArtNode, artMeta } from '../art.ts';
import { clamp, districtAt, follow, hash2, type ViewRect } from '../mapUtil.ts';
import { GroupMapBase, inEllipse, type GroupMapCtx } from './base.ts';

const C = BOAT_COURSE;
const OUTLINE = 0x402c1c;
const FOAM = 0xffffff;
/** 배 그림 배율 (세계 px / 캔버스 px): 오리배 약 95px 폭 (손님 약 105px). */
const BOAT_K = 0.15;
/** 한 바퀴의 p (map.ts lanePoint: 출발 각에서 같은 각까지). */
const LAP_P = (Math.PI * 2) / Math.abs(C.endAngle - C.startAngle);
/** 기다리는 자리: 출발선(p 0) 조금 뒤 (뱃머리가 선에 닿게). sim 진행 0~1 → 물길 p는 boatP. */
const START_P = -0.035;
/** 안·바깥 부표 줄 (레인 번호로: 레인 가장자리 바깥). */
const INNER = -0.55;
const OUTER = C.lanes - 0.45;
/** 결승 뒤 미끄러지는 시간 상수 (초). */
const COAST_TAU = 0.45;
/** 출발선으로 돌아가는 빠르기 (세계 px/초)와 서두를 때 가장 빠르게. */
const RETURN_SPEED = 130;
const RETURN_MAX = 480;
/** 돌아오는 물길 (레인 번호, 배마다 조금씩 더 안쪽으로): 선착장 차양보다 위. */
const RETURN_LANE = -2.3;
/** 이만큼 빨리 가면 물결 자국을 가장 진하게 (세계 px/초). */
const RUN_FULL = 190;
/** 몸 돌리기 빠르기 (뒤집기 배율 / 초). */
const TURN_RATE = 6;
/** 물결 고리 간격 (초, 빠를 때)과 꼬리 점 간격·수명. */
const RING_SEC = 0.22;
const TRAIL_STEP = 0.05;
const TRAIL_LIFE = 0.9;
/** 1등 배 통통 시간 (초). */
const WIN_HOP_SEC = 2.8;
/** 출발 몇 초 전부터 숫자를 띄우나. */
const COUNT_FROM = 3;
/** 앞선 배가 바뀌는 물보라: 출발 몇 초 뒤부터, 몇 초 간격 이상. */
const LEAD_FROM_SEC = 1.5;
const LEAD_GAP_SEC = 1;
/** 잔물결 수. */
const GLINTS = 16;
const FLAG_COLORS = BOAT.boats.map((b) => b.flag);
/** 잠긴 부스의 물길·깃대·발판 (buildings.ts 닫힌 부스와 같은 흐림). */
const LOCKED_ALPHA = 0.35;
const DISTRICT = districtAt(C.center.x, C.center.y);

/** sim 경주 진행(0 = 출발, 1 = 결승, 넘어도 된다) → 물길 p. */
function boatP(progress: number): number {
  return START_P + (1 - START_P) * progress;
}

/** 레인 lane의 p 자리에서 p 한 단위당 세계 px. */
function laneSpeed(lane: number, p: number): number {
  const a = boatPoint(lane, p);
  const b = boatPoint(lane, p + 0.002);
  return Math.max(1, Math.hypot(b.x - a.x, b.y - a.y) / 0.002);
}

function smooth(u: number): number {
  const v = clamp(u, 0, 1);
  return v * v * (3 - 2 * v);
}

function backOut(t: number): number {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

interface Ring {
  x: number;
  y: number;
  age: number;
  max: number;
  r0: number;
  r1: number;
  a: number;
}

interface TrailPt {
  x: number;
  y: number;
  age: number;
  w: number;
}

interface Boat {
  readonly index: RacerIndex;
  /** 물체층 (y 정렬). 위치 = 물 닿는 곳 (그림 아래 가운데). */
  readonly node: Container;
  /** 흔들림 기준 (물 닿는 곳보다 조금 위). */
  readonly body: Container;
  readonly art: ArtNode;
  readonly halfW: number;
  readonly h: number;
  readonly seed: number;
  /** 물길 p (boatPoint). */
  p: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** 결승 때 빠르기 (진행 / 초, 미끄러지기용). */
  endV: number;
  /** 지금 배율 x 부호 (1 = 그림 그대로 왼쪽)와 바라볼 쪽. */
  flip: number;
  face: 1 | -1;
  /** 빠르기 (세계 px/초, 부드럽게)와 세기 0~1. */
  speed: number;
  run: number;
  ringT: number;
  trailT: number;
  readonly trail: TrailPt[];
  winT: number;
  appear: number;
  appearDelay: number;
  /** 돌아오기 시작한 p (-1 = 돌아오는 중 아님). */
  retFrom: number;
}

export class BoatMapView extends GroupMapBase {
  private readonly course = new Graphics();
  private readonly mats = new Graphics();
  private readonly water = new Graphics();
  private readonly poles = [new Graphics(), new Graphics(), new Graphics(), new Graphics()];
  private readonly boats: Boat[] = [];
  private readonly rings: Ring[] = [];
  /** 연못 잔물결 자리 (연못 안, 물길 띠 밖으로 고르게). */
  private readonly glints: { x: number; y: number; w: number; ph: number; sp: number }[] = [];
  /** 참가 손님이 바라보는 쪽 (흔들리지 않게 조금 버틴다). */
  private readonly looks = new Map<MonsterId, -1 | 1>();
  private finished = false;
  private lastCount = 0;
  /** 지금 앞선 배와 바뀐 때 (화면 시계): 앞선 배가 바뀌면 물보라. */
  private leader = -1;
  private leaderAt = 0;
  private everShown = false;

  constructor(ctx: GroupMapCtx) {
    super(ctx);
    this.own(ctx.layers.floor, this.course);
    this.own(ctx.layers.floor, this.mats);
    this.own(ctx.layers.floor, this.water);
    this.drawCourse();
    this.drawMats();
    this.drawPoles();
    for (const g of this.poles) this.own(ctx.layers.objects, g);
    this.pickGlints();

    BOAT.boats.forEach((def, i) => {
      const index = i as RacerIndex;
      const m = artMeta('racers', def.key);
      const w = m !== undefined ? m.trim.w * BOAT_K : 90;
      const h = m !== undefined ? m.trim.h * BOAT_K : 50;
      const art = new ArtNode({ k: BOAT_K, anchor: 'bottom', placeholder: { w: 600, h: 340, color: def.flag } });
      art.setArt('racers', def.key);
      // 흔들림은 물 닿는 곳보다 조금 위를 기준으로.
      art.y = h * 0.3;
      const body = new Container();
      body.addChild(art);
      const node = new Container();
      node.addChild(body);
      node.cullable = true;
      node.cullableChildren = false;
      this.own(ctx.layers.objects, node);
      const start = boatPoint(i, START_P);
      this.boats.push({
        index, node, body, art, halfW: w / 2, h, seed: i * 1.9 + 0.4,
        p: START_P, x: start.x, y: start.y, dx: start.dx, dy: start.dy, endV: 0, flip: 1, face: 1,
        speed: 0, run: 0, ringT: i * 0.3, trailT: 0, trail: [], winT: 0, appear: 1, appearDelay: 0, retFrom: -1,
      });
    });
  }

  // ── 처음 한 번 그리는 바닥 ──

  /** 물길: 지나는 구간(p 0~1)의 밝은 띠, 레인 사이 점선, 안·바깥 부표 줄, 출발선·결승선. */
  private drawCourse(): void {
    const g = this.course;
    const N = 72;
    // 밝은 물빛 띠 (바깥 가장자리를 따라가고 안 가장자리로 돌아온다).
    const band: number[] = [];
    for (let i = 0; i <= N; i++) {
      const p = boatPoint(OUTER, i / N);
      band.push(p.x, p.y);
    }
    for (let i = N; i >= 0; i--) {
      const p = boatPoint(INNER, i / N);
      band.push(p.x, p.y);
    }
    g.poly(band).fill({ color: 0xa9dcf5, alpha: 0.42 });
    // 레인 사이 점선 (흰색, 옅게).
    for (let lane = 0.5; lane < C.lanes - 1; lane += 1) {
      for (let i = 0; i < N; i += 2) {
        const a = boatPoint(lane, i / N);
        const b = boatPoint(lane, (i + 1) / N);
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
      g.stroke({ width: 3, color: FOAM, alpha: 0.38, cap: 'round' });
    }
    // 부표 줄: 줄(가는 선) 위에 빨강·흰 부표가 번갈아.
    for (const lane of [INNER, OUTER]) {
      const pts = this.arcPoints(lane, -0.02, 1.02, 40);
      g.moveTo(pts[0]?.x ?? 0, pts[0]?.y ?? 0);
      for (const p of pts) g.lineTo(p.x, p.y);
      g.stroke({ width: 2.5, color: 0xfff6e2, alpha: 0.75 });
      pts.forEach((p, i) => {
        g.ellipse(p.x, p.y + 2, 8, 4).fill({ color: 0x2f6f99, alpha: 0.25 });
        g.circle(p.x, p.y - 1, 6).fill(i % 2 === 0 ? 0xe0705a : FOAM).stroke({ width: 2.5, color: OUTLINE });
      });
    }
    // 출발선: 흰 점선.
    this.lineAcross(0, (a, b, k) => {
      if (k % 2 === 0) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }, 9);
    g.stroke({ width: 7, color: FOAM, alpha: 0.9, cap: 'round' });
    // 결승선: 두 줄 체크무늬.
    const s0 = boatPoint(INNER, 1);
    const s1 = boatPoint(OUTER, 1);
    const ux = s1.x - s0.x;
    const uy = s1.y - s0.y;
    const len = Math.hypot(ux, uy) || 1;
    const n = Math.max(4, Math.round(len / 12));
    const nx = s0.dx * 11;
    const ny = s0.dy * 11;
    for (let k = 0; k < n; k++) {
      for (let r = 0; r < 2; r++) {
        const ax = s0.x + (ux * k) / n + nx * (r - 1);
        const ay = s0.y + (uy * k) / n + ny * (r - 1);
        const bx = s0.x + (ux * (k + 1)) / n + nx * (r - 1);
        const by = s0.y + (uy * (k + 1)) / n + ny * (r - 1);
        g.poly([ax, ay, bx, by, bx + nx, by + ny, ax + nx, ay + ny]).fill({ color: (k + r) % 2 === 0 ? FOAM : OUTLINE, alpha: 0.85 });
      }
    }
  }

  /** 레인 lane 위 p0~p1 사이를 step(세계 px) 간격으로 고른 점들. */
  private arcPoints(lane: number, p0: number, p1: number, step: number): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    let p = p0;
    while (p <= p1 + 1e-9) {
      const pt = boatPoint(lane, p);
      out.push({ x: pt.x, y: pt.y });
      p += step / laneSpeed(lane, p);
    }
    return out;
  }

  /** 진행 p 자리의 물길을 가로지르는 선을 k조각으로 (안 → 바깥). */
  private lineAcross(p: number, piece: (a: { x: number; y: number }, b: { x: number; y: number }, k: number) => void, n: number): void {
    const a = boatPoint(INNER, p);
    const b = boatPoint(OUTER, p);
    for (let k = 0; k < n; k++) {
      const u0 = k / n;
      const u1 = (k + 1) / n;
      piece({ x: a.x + (b.x - a.x) * u0, y: a.y + (b.y - a.y) * u0 }, { x: a.x + (b.x - a.x) * u1, y: a.y + (b.y - a.y) * u1 }, k);
    }
  }

  /** 선착장 앞 자리마다 나무 발판 (손님이 그 위에 선다). */
  private drawMats(): void {
    const g = this.mats;
    const W = 78;
    const H = 30;
    for (const s of this.spot.seats) {
      const x = s.x - W / 2;
      const y = s.y - H * 0.6;
      g.roundRect(x, y + 5, W, H, 8).fill({ color: 0x000000, alpha: 0.1 });
      g.roundRect(x, y, W, H, 8).fill(0xc8955f).stroke({ width: 4, color: OUTLINE });
      // 널빤지 사이 선과 못.
      for (let k = 1; k < 3; k++) g.moveTo(x + (W * k) / 3, y + 4).lineTo(x + (W * k) / 3, y + H - 4);
      g.stroke({ width: 2.5, color: OUTLINE, alpha: 0.45 });
      for (let k = 0; k < 3; k++) g.circle(x + (W * (k + 0.5)) / 3, y + 7, 2).fill({ color: OUTLINE, alpha: 0.5 });
    }
  }

  /** 출발·결승 깃대 넷 (물에 뜬 부표 위 막대와 깃발). 결승 깃대 사이에는 배 색 삼각 깃발 줄. */
  private drawPoles(): void {
    const ends = [
      { p: 0, lane: INNER - 0.35 },
      { p: 0, lane: OUTER + 0.35 },
      { p: 1, lane: INNER - 0.35 },
      { p: 1, lane: OUTER + 0.35 },
    ];
    const H = 74;
    ends.forEach((e, i) => {
      const g = this.poles[i] as Graphics;
      const b = boatPoint(e.lane, e.p);
      const finish = e.p === 1;
      // 부표 받침.
      g.ellipse(b.x, b.y + 2, 17, 7).fill({ color: 0x2f6f99, alpha: 0.28 });
      g.ellipse(b.x, b.y - 4, 14, 9).fill(finish ? 0xe0705a : 0x8fc77a).stroke({ width: 3, color: OUTLINE });
      // 막대 (빨강·흰 줄무늬).
      g.roundRect(b.x - 3.5, b.y - H, 7, H - 4, 3).fill(FOAM).stroke({ width: 2.5, color: OUTLINE });
      for (let y = b.y - H + 8; y < b.y - 14; y += 16) g.rect(b.x - 2, y, 4, 7).fill(0xe0705a);
      g.circle(b.x, b.y - H - 2, 4.5).fill(0xf3d36a).stroke({ width: 2.5, color: OUTLINE });
      if (!finish) {
        // 출발 깃발 (초록, 물길 바깥쪽으로 나부낀다).
        const dir = i === 0 ? 1 : -1;
        g.poly([b.x, b.y - H + 2, b.x + dir * 30, b.y - H + 12, b.x, b.y - H + 24]).fill(0x8fc77a).stroke({ width: 2.5, color: OUTLINE, join: 'round' });
      }
      g.zIndex = Math.round(b.y);
    });
    // 결승 깃발 줄: 앞 깃대(바깥, y가 큼)에 같이 그린다.
    const a = boatPoint(INNER - 0.35, 1);
    const b = boatPoint(OUTER + 0.35, 1);
    const g = this.poles[3] as Graphics;
    const ay = a.y - H + 6;
    const by = b.y - H + 6;
    const sag = 16;
    const n = 7;
    const at = (u: number): { x: number; y: number } => ({ x: a.x + (b.x - a.x) * u, y: ay + (by - ay) * u + Math.sin(u * Math.PI) * sag });
    g.moveTo(a.x, ay);
    for (let k = 1; k <= 16; k++) {
      const p = at(k / 16);
      g.lineTo(p.x, p.y);
    }
    g.stroke({ width: 2.5, color: OUTLINE });
    for (let k = 0; k < n; k++) {
      const p0 = at((k + 0.2) / n);
      const p1 = at((k + 0.8) / n);
      const mx = (p0.x + p1.x) / 2;
      const my = (p0.y + p1.y) / 2 + 17;
      g.poly([p0.x, p0.y, p1.x, p1.y, mx, my]).fill(FLAG_COLORS[k % FLAG_COLORS.length] ?? 0xe0705a).stroke({ width: 2, color: OUTLINE, join: 'round' });
    }
  }

  /** 연못 잔물결 자리 (씨앗으로 늘 같게): 연못 안, 물길 띠와 선착장 쪽은 피한다. */
  private pickGlints(): void {
    const pond = PONDS[0];
    if (pond === undefined) return;
    for (let i = 0, tries = 0; this.glints.length < GLINTS && tries < 400; tries++, i++) {
      const u = (hash2(i, 3, 911) >>> 0) / 4294967296;
      const v = (hash2(i, 7, 911) >>> 0) / 4294967296;
      const a = u * Math.PI * 2;
      const r = Math.sqrt(v) * 0.86;
      const x = pond.c.x + Math.cos(a) * pond.rx * r;
      const y = pond.c.y + Math.sin(a) * pond.ry * r;
      // 물길 띠 안은 피한다 (가운데 섬 쪽과 바깥 가장자리 쪽만).
      const inBand = inEllipse(x, y, C.center.x, C.center.y, C.rx + 75, C.ry + 55) && !inEllipse(x, y, C.center.x, C.center.y, C.rx - 75, C.ry - 55);
      if (inBand || y > C.center.y + C.ry * 0.7) continue;
      this.glints.push({ x, y, w: 9 + (u * 97 % 1) * 8, ph: v * 6.28, sp: 0.6 + (u * 13 % 1) * 0.6 });
    }
  }

  // ── 판 따라가기 ──

  protected override onShown(show: boolean): void {
    super.onShown(show);
    // 처음이 아니면 (부스가 막 열렸다) 출발선에 하나씩 톡.
    const animate = show && this.everShown;
    if (show) this.everShown = true;
    this.boats.forEach((b, i) => {
      b.p = START_P;
      b.retFrom = -1;
      b.trail.length = 0;
      b.appear = animate ? 0 : 1;
      b.appearDelay = animate ? 0.4 + i * 0.16 : 0;
    });
    this.rings.length = 0;
  }

  protected override onPlay(p: GroupPlay | null): void {
    this.finished = false;
    this.leader = -1;
    this.leaderAt = this.clock;
    const race = raceOf(p);
    if (race === null) return;
    for (const b of this.boats) {
      const F = race.finishAt[b.index] ?? 1;
      b.endV = Math.max(0, (1 - raceProgress(race, b.index, F - 0.12)) / 0.12);
      b.winT = 0;
      // 아직 돌아오는 중이었으면 출발선으로 바로 (물보라로 가린다).
      if (Math.abs(b.p - START_P) > 0.01) {
        this.splash(b.x, b.y, 1.2);
        b.p = START_P;
        b.retFrom = -1;
        b.trail.length = 0;
      }
    }
    const g = this.group;
    if (g !== null && g.phase === 'running' && this.clock < 1) this.started();
  }

  /** 출발: 출발 신호 통통, 배마다 물보라. */
  private started(): void {
    this.ctx.buildings.hostHop('boat', 0, 1.5);
    for (const b of this.boats) this.splash(b.x, b.y, 1);
  }

  /** 1등 배가 결승선을 지났다: 색종이, 구조 요원 통통, 1등 배 반짝. */
  private finishedRace(race: RaceResult): void {
    const f = boatPoint(1.5, 1);
    this.ctx.fx.confetti(f.x, f.y - 30, 34);
    this.ctx.buildings.hostHop('boat', 1, 1.5);
    this.ctx.buildings.hostHop('boat', 0, 1);
    const w = this.boats[race.finishOrder[0] ?? 0];
    if (w !== undefined) {
      w.winT = WIN_HOP_SEC;
      this.ctx.fx.sparkles(w.x, w.y - 30, 9, 55);
    }
  }

  /** 출발 숫자 3·2·1 (출발선 위). */
  private countdown(g: GroupState | null): void {
    if (g !== null && g.phase === 'gathering') {
      const c = Math.ceil(g.countdown - 1e-6);
      if (c >= 1 && c <= COUNT_FROM && c !== this.lastCount) {
        const s = boatPoint(1.5, 0);
        this.ctx.fx.floatText(s.x, s.y - 110, `${c}`, 'win', c === 1);
        this.ctx.buildings.hostHop('boat', 0, 0.6);
      }
      this.lastCount = c;
    } else {
      this.lastCount = 0;
    }
  }

  protected draw(dt: number, view: ViewRect): void {
    const g = this.group;
    const race = this.play !== null && this.play.kind === 'boat' ? this.play.race : null;
    this.countdown(g);
    if (race !== null) {
      let first = Infinity;
      for (const f of race.finishAt) first = Math.min(first, f);
      if (!this.finished && this.clock >= first) {
        this.finished = true;
        // 불러온 저장처럼 한참 지난 결승은 조용히.
        if (this.clock - first < 1.5) this.finishedRace(race);
      }
      if (!this.finished) this.watchLead(race);
    }
    for (const b of this.boats) {
      const moved = this.drive(b, race, g, dt);
      this.pose(b, moved, dt, view);
    }
    this.drawWater(dt);
    this.watchers(race);
  }

  /** 앞선 배가 바뀌면 (출발 직후는 빼고, 너무 잦지 않게) 새 1등 배 둘레에 물보라와 반짝이. */
  private watchLead(race: RaceResult): void {
    const top = raceStandings(race, this.clock)[0];
    if (top === undefined || top === this.leader) return;
    if (this.clock - this.leaderAt < LEAD_GAP_SEC) return;
    const first = this.leader < 0;
    this.leader = top;
    this.leaderAt = this.clock;
    const b = this.boats[top];
    if (first || b === undefined || this.clock < LEAD_FROM_SEC) return;
    this.splash(b.x, b.y, 0.9);
    this.ctx.fx.sparkles(b.x, b.y - b.h * 0.6, 5, 36);
  }

  /** 결승 뒤 미끄러지기를 더한 진행 (1을 넘어 조금 더 간다). */
  private progress(race: RaceResult, b: Boat, t: number): number {
    const F = race.finishAt[b.index] ?? 0;
    if (t <= F) return raceProgress(race, b.index, t);
    return 1 + b.endV * COAST_TAU * (1 - Math.exp(-(t - F) / COAST_TAU));
  }

  /** 배 자리를 정한다. 움직인 거리(세계 px)를 돌려준다. */
  private drive(b: Boat, race: RaceResult | null, g: GroupState | null, dt: number): number {
    let lane = b.index;
    if (race !== null) {
      b.p = boatP(this.progress(race, b, this.clock));
      b.retFrom = -1;
    } else if (b.p > START_P + 1e-4) {
      // 판이 끝났다: 가던 쪽으로 아래 물길을 지나 다음 바퀴의 출발선으로.
      // 선착장 그림 뒤로 숨지 않게, 돌아오는 동안은 안쪽 물길(RETURN_LANE)로 비켜 간다.
      if (b.retFrom < 0) b.retFrom = b.p;
      const goal = START_P + Math.ceil((b.p - START_P) / LAP_P - 1e-6) * LAP_P;
      const per = laneSpeed(b.index, b.p);
      let speed = RETURN_SPEED;
      if (g !== null && g.phase === 'gathering') speed = Math.max(speed, ((goal - b.p) * per) / Math.max(0.3, g.countdown - 0.8));
      speed = Math.min(speed, RETURN_MAX);
      b.p = Math.min(goal, b.p + (speed * dt) / per);
      const s = Math.min(smooth((b.p - b.retFrom) / 0.09), smooth((goal - b.p) / 0.09));
      lane = b.index + (RETURN_LANE - b.index * 0.2 - b.index) * s;
      if (b.p >= goal - 1e-6) {
        b.p = START_P;
        b.retFrom = -1;
        lane = b.index;
      }
    } else {
      b.p = START_P;
    }
    const pt = boatPoint(lane, b.p);
    const moved = Math.hypot(pt.x - b.x, pt.y - b.y);
    // 순간이동(돌아오다 판이 시작됨)은 움직임으로 치지 않는다.
    const step = moved > 150 ? 0 : moved;
    b.x = pt.x;
    b.y = pt.y;
    b.dx = pt.dx;
    b.dy = pt.dy;
    if (dt > 0 && step / dt > 15) {
      if (pt.dx > 0.15) b.face = -1;
      else if (pt.dx < -0.15) b.face = 1;
    }
    return step;
  }

  private pose(b: Boat, moved: number, dt: number, view: ViewRect): void {
    const v = dt > 0 ? moved / dt : 0;
    b.speed += (v - b.speed) * follow(6, dt);
    b.run = clamp(b.speed / RUN_FULL, 0, 1);
    const run = b.run;
    if (b.flip !== b.face) {
      const s = dt * TURN_RATE;
      b.flip = b.flip < b.face ? Math.min(b.face, b.flip + s) : Math.max(b.face, b.flip - s);
    }
    const t = this.time;
    // 둥실: 위아래와 앞뒤로 흔들 (빠를수록 뱃머리를 든다).
    let dy = -unit01(Math.sin(t * 2.4 + b.seed)) * 3.5 * (1 - run * 0.5);
    let rot = Math.sin(t * 1.8 + b.seed * 1.3) * 0.05 * (1 - run * 0.6);
    rot += b.face * 0.07 * run + Math.sin(t * 14 + b.seed) * 0.015 * run;
    // 위아래로 갈 때 가는 쪽으로 조금 기울기.
    const head = b.face === -1 ? Math.atan2(b.dy, b.dx) : Math.atan2(-b.dy, -b.dx);
    rot += clamp(head, -0.6, 0.6) * 0.18 * run;
    let sx = 1;
    let sy = 1;
    // 1등 배 통통 (물보라와 함께).
    if (b.winT > 0) {
      b.winT -= dt;
      const w = Math.abs(Math.sin(this.time * 6.5));
      const k = clamp(b.winT / 0.5, 0, 1);
      dy -= w * 18 * k;
      sy *= 1 + 0.07 * w * k;
      sx *= 1 - 0.04 * w * k;
      if (w < 0.12 && k > 0.3 && b.ringT > 0.15) {
        b.ringT = 0;
        this.ring(b.x, b.y - 4, 16, 60, 0.9, 0.7);
      }
    }
    // 나타나기 (열릴 때 톡).
    let pop = 1;
    if (b.appear < 1) {
      if (b.appearDelay > 0) {
        b.appearDelay -= dt;
        pop = 0;
      } else {
        if (b.appear === 0) this.splash(b.x, b.y, 0.8);
        b.appear = Math.min(1, b.appear + dt / 0.35);
        pop = backOut(b.appear);
      }
    }
    // 물결: 빠르면 뒤로 꼬리와 고리, 서 있으면 가끔 작은 고리.
    b.ringT += dt;
    const sternX = b.x - b.dx * b.halfW * 0.75;
    const sternY = b.y - 5 - b.dy * b.halfW * 0.35;
    if (run > 0.2) {
      if (b.ringT >= RING_SEC / run) {
        b.ringT = 0;
        this.ring(sternX, sternY, 8, 34 + 16 * run, 1.1, 0.55 * run + 0.15);
      }
      b.trailT += dt;
      if (b.trailT >= TRAIL_STEP) {
        b.trailT = 0;
        b.trail.push({ x: sternX, y: sternY, age: 0, w: 3 + 7 * run });
      }
    } else if (b.ringT > 1.6 + (b.seed % 1)) {
      b.ringT = 0;
      this.ring(b.x, b.y - 3, b.halfW * 0.6, b.halfW * 1.25, 1.6, 0.35);
    }
    for (const p of b.trail) p.age += dt;
    while (b.trail.length > 0 && (b.trail[0] as TrailPt).age > TRAIL_LIFE) b.trail.shift();

    b.node.position.set(b.x, b.y);
    const z = Math.round(b.y);
    if (b.node.zIndex !== z) b.node.zIndex = z;
    b.body.position.set(0, dy - b.h * 0.3);
    b.body.rotation = rot;
    b.body.scale.set(b.flip * sx * pop, sy * pop);
    const m = b.halfW + 30;
    b.node.culled = b.x + m < view.x0 || b.x - m > view.x1 || b.y + 30 < view.y0 || b.y - 90 > view.y1;
  }

  private ring(x: number, y: number, r0: number, r1: number, max: number, a: number): void {
    if (this.rings.length >= 90) this.rings.shift();
    this.rings.push({ x, y, age: 0, max, r0, r1, a });
  }

  /** 물보라: 큰 고리 둘. */
  private splash(x: number, y: number, k: number): void {
    this.ring(x, y - 4, 14 * k, 64 * k, 0.9, 0.85);
    this.ring(x, y - 4, 6 * k, 40 * k, 0.7, 0.7);
  }

  /** 바닥층의 움직이는 물: 배 그림자, 잔물결, 꼬리, 고리. */
  private drawWater(dt: number): void {
    const g = this.water;
    g.clear();
    const t = this.time;
    // 잔물결: '‿‿' 모양이 천천히 떠올랐다 사라진다.
    for (const s of this.glints) {
      const a = Math.sin(t * s.sp + s.ph);
      if (a <= 0.05) continue;
      const ox = Math.sin(t * 0.3 + s.ph) * 6;
      const x = s.x + ox;
      for (const k of [-1, 1]) {
        const cx = x + k * s.w * 0.55;
        g.moveTo(cx - s.w * 0.5, s.y).quadraticCurveTo(cx, s.y + s.w * 0.45, cx + s.w * 0.5, s.y);
      }
      g.stroke({ width: 3, color: FOAM, alpha: 0.55 * a, cap: 'round' });
    }
    // 배 밑 물그림자 (배가 물에 떠 보이게).
    for (const b of this.boats) {
      if (b.appear < 1 && b.appearDelay > 0) continue;
      g.ellipse(b.x, b.y - 2, b.halfW * 0.92, 8).fill({ color: 0x2f6f99, alpha: 0.2 });
    }
    // 꼬리: 배 뒤로 가늘어지며 흐려지는 흰 물살.
    for (const b of this.boats) {
      const tr = b.trail;
      for (let i = 1; i < tr.length; i++) {
        const p0 = tr[i - 1] as TrailPt;
        const p1 = tr[i] as TrailPt;
        const u = p1.age / TRAIL_LIFE;
        g.moveTo(p0.x, p0.y).lineTo(p1.x, p1.y).stroke({ width: p1.w * (1 - u * 0.6), color: FOAM, alpha: 0.5 * (1 - u), cap: 'round' });
      }
      // 꼬리 끝에서 배까지.
      const last = tr[tr.length - 1];
      if (last !== undefined && b.run > 0.2) {
        const sx = b.x - b.dx * b.halfW * 0.75;
        const sy = b.y - 5 - b.dy * b.halfW * 0.35;
        g.moveTo(last.x, last.y).lineTo(sx, sy).stroke({ width: last.w, color: FOAM, alpha: 0.5, cap: 'round' });
      }
    }
    // 고리: 퍼지며 흐려진다.
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i] as Ring;
      r.age += dt;
      const u = r.age / r.max;
      if (u >= 1) {
        this.rings.splice(i, 1);
        continue;
      }
      const e = 1 - (1 - u) * (1 - u);
      const rr = r.r0 + (r.r1 - r.r0) * e;
      g.ellipse(r.x, r.y, rr, rr * 0.36).stroke({ width: 3.5 * (1 - u) + 1, color: FOAM, alpha: r.a * (1 - u) });
    }
  }

  /** 참가 손님은 자기 배 쪽을 바라본다 (판 중과 결과 동안). */
  private watchers(race: RaceResult | null): void {
    const g = this.group;
    if (race === null || g === null) {
      this.looks.clear();
      return;
    }
    for (const e of g.participants) {
      const v = this.view(e.monster);
      const m = this.monster(e.monster);
      const b = this.boats[e.pick];
      if (v === undefined || m === undefined || b === undefined || m.path.length > 0) continue;
      const dx = b.x - v.x;
      let look = this.looks.get(e.monster) ?? (dx > 0 ? 1 : -1);
      if (dx > 40) look = 1;
      else if (dx < -40) look = -1;
      this.looks.set(e.monster, look);
      this.puppet(e.monster, { facing: look });
    }
  }

  /** 잠겨 있어도 구역이 열렸으면 물길·깃대·발판은 흐리게 보인다 (경주장 방석처럼, 무엇이 생길지 미리 보이게). */
  override update(dt: number, view: ViewRect): void {
    super.update(dt, view);
    const open = DISTRICT === null || this.sim.state.districts.includes(DISTRICT);
    for (const g of [this.course, this.mats, ...this.poles]) {
      g.visible = open;
      g.alpha = this.shown ? 1 : LOCKED_ALPHA;
    }
  }

  override hitTest(wx: number, wy: number): boolean {
    if (inEllipse(wx, wy, C.center.x, C.center.y, C.rx + 110, C.ry + 90)) return true;
    for (const b of this.boats) if (Math.abs(wx - b.x) < b.halfW + 14 && wy > b.y - b.h - 20 && wy < b.y + 14) return true;
    return false;
  }
}

/** 0~1로 접은 사인 (둥실 높이). */
function unit01(s: number): number {
  return (s + 1) / 2;
}
