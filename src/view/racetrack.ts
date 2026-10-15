// 지도 위 몬스터 경주장: 경주 선수 넷(racers/<key>)과 관중석 방석. 경주로 바닥은 ground.ts가 굽고, 출발대·관중석·결승선 그림은 buildings.ts.
// sim의 경주 상태(BoothState.race)를 매 프레임 읽는다 (이벤트를 놓쳐도, 저장을 불러와도 맞는다):
//   idle·gathering: 선수는 출발대 앞 자기 레인의 출발선(mapUtil RACE_START_P)에 선다. 모이는 중이면 가끔 들썩,
//                   출발 3초 전부터 웅크리고 출발대 위에 3·2·1.
//   running: sim/race.ts raceProgress(result, 선수, 초)로 자기 레인을 달린다 (레인 = 선수 번호). 화면 시계가 sim 시계(0.1초 틱)를
//            부드럽게 따라가서 움직임이 매끈하다. 결승을 지나면 조금 미끄러지며 선다.
//            (관중의 응원 반응은 sim의 raceProgress 이벤트로 world.ts가 작게 보여 준다.)
//   done: 결승선 너머에 서고, 1등 선수가 통통 (결승선에 색종이). 다음 경주를 받으면(idle·gathering) 레인을 따라
//         남은 반 바퀴를 돌아 출발선으로 돌아간다 (출발이 가까우면 서두른다).
// 선수 그림은 왼쪽을 본다: 오른쪽으로 달리면 좌우로 뒤집는다 (몸을 돌리듯 납작해지며). 걸음은 선수마다 (달팽이 미끄럼, 개구리 깡충).
// 닫힌 경주장에는 선수가 없다 (열리면 하나씩 톡). 관중석 자리마다 방석 (닫혀 있으면 흐리게). 경주로나 선수를 누르면 경주장.

import { Container, Graphics, GraphicsContext } from 'pixi.js';
import { RACE } from '../data/defs.ts';
import { BOOTH_SPOTS, RACE_TRACK, trackPoint } from '../data/map.ts';
import type { SimApi } from '../sim/api.ts';
import { raceProgress } from '../sim/race.ts';
import type { RaceResult, RaceState, RacerIndex } from '../sim/types.ts';
import { ArtNode, artMeta } from './art.ts';
import type { BuildingsView } from './buildings.ts';
import type { FxLayer } from './fx.ts';
import { RACE_LAP_P, RACE_START_P, boxHits, clamp, districtAt, follow, onTrack, raceTrackP, type Box, type ViewRect } from './mapUtil.ts';

/** 선수 그림 배율 (세계 px / 캔버스 px): 손님(약 105px)보다 작게 약 60~80px 폭 (레인 46px보다 조금 커서 출발선에서는 살짝 겹친다). */
const RACER_K = 0.15;
const OUTLINE = 0x402c1c;
/** 닫힌 경주장의 방석 (buildings.ts 닫힌 부스와 같은 흐림). */
const LOCKED_ALPHA = 0.35;
/** 경주가 끝나고 출발선으로 돌아가는 빠르기 (세계 px/초)와 가장 빠를 때. */
const RETURN_SPEED = 170;
const RETURN_MAX = 700;
/** 결승 뒤 미끄러지며 서는 시간 상수 (초). */
const COAST_TAU = 0.35;
/** 이만큼 빨리 움직이면 달리는 걸음 (세계 px/초, 걸음 세기 1). */
const RUN_FULL = 160;
/** 몸을 돌리는 빠르기 (뒤집기 배율 / 초). */
const TURN_RATE = 9;
/** 달릴 때 발밑 모래 먼지 간격 (초). */
const DUST_SEC = 0.24;
/** 1등 선수가 결승 뒤 통통 뛰는 시간 (초). */
const WIN_HOP_SEC = 2.6;
/** 출발 몇 초 전부터 숫자를 띄우고 웅크리나. */
const COUNT_FROM = 3;
/** 방석 크기 (세계 px)와 색 (관중석 차양의 주황·크림을 번갈아). */
const CUSHION_W = 74;
const CUSHION_H = 34;
const CUSHION_COLORS = [0xeba066, 0xf6e3c4] as const;

/** 선수마다 걸음: stride = 반 걸음 (세계 px), amp = 들썩 높이, squash = 늘었다 줄었다, rock = 좌우 흔들 (rad). */
interface Gait {
  readonly stride: number;
  readonly amp: number;
  readonly squash: number;
  readonly rock: number;
}
const GAITS: Readonly<Record<string, Gait>> = {
  racer_snail: { stride: 30, amp: 1.5, squash: 0.09, rock: 0 },
  racer_turtle: { stride: 18, amp: 3.5, squash: 0.03, rock: 0.07 },
  racer_frog: { stride: 48, amp: 16, squash: 0.13, rock: 0.05 },
  racer_ladybug: { stride: 12, amp: 3, squash: 0.03, rock: 0.05 },
};
const DEFAULT_GAIT: Gait = { stride: 24, amp: 5, squash: 0.05, rock: 0.04 };

interface Racer {
  readonly index: RacerIndex;
  readonly lane: number;
  /** 물체층 (y 정렬). 위치 = 발. */
  readonly node: Container;
  readonly body: Container;
  readonly art: ArtNode;
  readonly shadow: Graphics;
  readonly gait: Gait;
  readonly halfW: number;
  readonly seed: number;
  /** 경주로 p (map.ts trackPoint). */
  p: number;
  x: number;
  y: number;
  /** 결승 때 빠르기 (진행 / 초, 미끄러지기용). */
  endV: number;
  /** 지금 배율 x 부호 (1 = 그림 그대로 왼쪽, -1 = 오른쪽)와 바라볼 쪽. */
  flip: number;
  face: 1 | -1;
  /** 걸음 위상과 달리기 세기 (0~1). */
  phase: number;
  run: number;
  /** 한 번 통통 (초, -1 = 없음)과 세기. */
  hopT: number;
  hopK: number;
  /** 다음 제자리 들썩까지 (초). */
  idleHopIn: number;
  /** 1등 통통이 남은 초. */
  winT: number;
  dustT: number;
  /** 나타나기 (0 → 1)와 늦춤. */
  appear: number;
  appearDelay: number;
}

function backOut(t: number): number {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

/** 레인 lane의 p 자리에서 p 한 단위당 세계 px (경주로 위 빠르기 바꾸기). */
function trackSpeed(lane: number, p: number): number {
  const a = trackPoint(lane, p);
  const b = trackPoint(lane, p + 0.002);
  return Math.max(1, Math.hypot(b.x - a.x, b.y - a.y) / 0.002);
}

export interface RaceTrackLayers {
  readonly objects: Container;
  readonly shadows: Container;
}

export class RaceTrackView {
  private readonly sim: SimApi;
  private readonly fx: FxLayer;
  private readonly buildings: BuildingsView;
  private readonly racers: Racer[] = [];
  private readonly shadowCtx: GraphicsContext;
  private readonly cushions = new Graphics();
  private readonly cushionBox: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  private readonly district = districtAt(RACE_TRACK.center.x, RACE_TRACK.center.y);
  private shown = false;
  private initialized = false;
  /** 지금 화면이 따라가는 경주 (sim RaceState.result와 같은 객체). */
  private result: RaceResult | null = null;
  /** 화면 시계 (출발 뒤 초). */
  private clock = 0;
  private finished = false;
  private lastCount = 0;
  private time = 0;

  constructor(sim: SimApi, layers: RaceTrackLayers, fx: FxLayer, buildings: BuildingsView) {
    this.sim = sim;
    this.fx = fx;
    this.buildings = buildings;
    this.shadowCtx = new GraphicsContext().ellipse(0, 0, 1, 1).fill({ color: 0x000000, alpha: 0.13 });

    // 관중석 방석 (바닥에 깔리는 것이라 그림자층 맨 아래: 손님 그림자가 방석 위에).
    this.drawCushions();
    this.cushions.eventMode = 'none';
    this.cushions.cullable = true;
    layers.shadows.addChildAt(this.cushions, 0);

    RACE.racers.forEach((def, i) => {
      const index = i as RacerIndex;
      const art = new ArtNode({ k: RACER_K, anchor: 'bottom', placeholder: { w: 440, h: 320, color: def.bib } });
      art.setArt('racers', def.key);
      const body = new Container();
      body.addChild(art);
      const node = new Container();
      node.addChild(body);
      node.eventMode = 'none';
      node.cullable = true;
      node.cullableChildren = false;
      node.visible = false;
      const shadow = new Graphics(this.shadowCtx);
      shadow.eventMode = 'none';
      shadow.cullable = true;
      shadow.visible = false;
      layers.objects.addChild(node);
      layers.shadows.addChild(shadow);
      const m = artMeta('racers', def.key);
      const start = trackPoint(i, RACE_START_P);
      const face: 1 | -1 = start.dx > 0 ? -1 : 1;
      this.racers.push({
        index, lane: i, node, body, art, shadow, gait: GAITS[def.key] ?? DEFAULT_GAIT,
        halfW: m !== undefined ? (m.trim.w * RACER_K) / 2 : 26, seed: i * 1.7,
        p: RACE_START_P, x: start.x, y: start.y, endV: 0, flip: face, face, phase: i * 0.8, run: 0,
        hopT: -1, hopK: 1, idleHopIn: 1 + i * 0.9, winT: 0, dustT: i * 0.06, appear: 1, appearDelay: 0,
      });
    });
    this.update(0, { x0: 0, y0: 0, x1: 0, y1: 0 });
    this.initialized = true;
  }

  private drawCushions(): void {
    const g = this.cushions;
    const seats = BOOTH_SPOTS.race.seats;
    seats.forEach((s, i) => {
      const x = s.x - CUSHION_W / 2;
      const y = s.y - CUSHION_H * 0.62;
      // 방석: 도톰한 네모 (바느질 선과 가운데 단추).
      g.roundRect(x, y, CUSHION_W, CUSHION_H, 14).fill(CUSHION_COLORS[i % 2] ?? 0xeba066).stroke({ width: 4, color: OUTLINE });
      g.roundRect(x + 10, y + 7, CUSHION_W - 20, CUSHION_H - 14, 8).stroke({ width: 2.5, color: OUTLINE, alpha: 0.28 });
      g.circle(s.x, y + CUSHION_H / 2, 3.5).fill({ color: OUTLINE, alpha: 0.45 });
      const b = this.cushionBox;
      b.x0 = Math.min(b.x0, x - 4);
      b.y0 = Math.min(b.y0, y - 4);
      b.x1 = Math.max(b.x1, x + CUSHION_W + 4);
      b.y1 = Math.max(b.y1, y + CUSHION_H + 4);
    });
  }

  /** 누른 곳이 경주로(모래 띠)나 선수인가 (구역이 열렸을 때만). 그러면 경주장을 연다. */
  hitTest(wx: number, wy: number): boolean {
    if (this.district !== null && !this.sim.state.districts.includes(this.district)) return false;
    if (onTrack(wx, wy, 10)) return true;
    if (!this.shown) return false;
    for (const r of this.racers) {
      const hw = Math.max(30, r.halfW + 10);
      if (wx >= r.x - hw && wx <= r.x + hw && wy >= r.y - 60 && wy <= r.y + 16) return true;
    }
    return false;
  }

  // ── 매 프레임 ──

  update(dt: number, view: ViewRect): void {
    this.time += dt;
    const st = this.sim.state;
    const bs = st.booths.race;
    const open = this.district === null || st.districts.includes(this.district);
    this.cushions.visible = open;
    this.cushions.alpha = bs.unlocked ? 1 : LOCKED_ALPHA;
    this.cushions.culled = !boxHits(this.cushionBox, view);

    const show = bs.unlocked && open;
    if (show !== this.shown) this.setShown(show);
    if (!show) return;

    const rs = bs.race;
    this.followRace(rs, dt);
    for (let i = 0; i < this.racers.length; i++) {
      const r = this.racers[i] as Racer;
      const moved = this.drive(r, rs, dt);
      this.draw(r, rs, moved, dt, view);
    }
  }

  private setShown(show: boolean): void {
    this.shown = show;
    const animate = this.initialized && show;
    this.racers.forEach((r, i) => {
      r.node.visible = show;
      r.shadow.visible = show;
      // 열리면 출발선에 하나씩 톡.
      r.p = RACE_START_P;
      r.appear = animate ? 0 : 1;
      r.appearDelay = animate ? 0.5 + i * 0.16 : 0;
    });
    this.result = null;
  }

  /** sim의 경주를 따라간다: 새 경주 시작·화면 시계·결승·출발 숫자. */
  private followRace(rs: RaceState | null, dt: number): void {
    const live = rs !== null && (rs.phase === 'running' || rs.phase === 'done') && rs.result !== null;
    if (live) {
      const res = rs.result as RaceResult;
      if (res !== this.result) {
        this.result = res;
        this.clock = rs.elapsed;
        this.finished = false;
        for (const r of this.racers) {
          const F = res.finishAt[r.index] ?? 1;
          r.endV = Math.max(0, (1 - raceProgress(res, r.index, F - 0.12)) / 0.12);
          // 아직 돌아오는 중이었으면 출발선으로 바로 (먼지로 가린다).
          if (Math.abs(r.p - RACE_START_P) > 0.01) {
            this.fx.puff(r.x, r.y, 3, 30);
            r.p = RACE_START_P;
          }
          r.winT = 0;
        }
        if (rs.phase === 'running' && rs.elapsed < 1) this.started();
      } else {
        this.clock += dt;
        if (rs.phase === 'running') {
          // sim 시계는 0.1초씩 간다: 가까이 붙어 있되 부드럽게 끌려간다.
          this.clock += (rs.elapsed - this.clock) * follow(3, dt);
          this.clock = clamp(this.clock, rs.elapsed - 0.2, rs.elapsed + 0.2);
        }
      }
      let first = Infinity;
      for (const f of res.finishAt) first = Math.min(first, f);
      if (!this.finished && this.clock >= first) {
        this.finished = true;
        // 불러온 저장처럼 한참 지난 결승은 조용히.
        if (this.clock - first < 1.5) this.finishedRace(res);
      }
    } else if (this.result !== null) {
      this.result = null;
    }

    // 출발 숫자 3·2·1 (출발대 위).
    if (rs !== null && rs.phase === 'gathering') {
      const c = Math.ceil(rs.countdown - 1e-6);
      if (c >= 1 && c <= COUNT_FROM && c !== this.lastCount) {
        const g = RACE_TRACK.gate;
        this.fx.floatText(g.x, g.y - 210, `${c}`, 'win', c === 1);
        this.buildings.hostHop('race', 0, 0.6);
      }
      this.lastCount = c;
    } else {
      this.lastCount = 0;
    }
  }

  /** 출발: 출발 신호 진행자가 통통, 선수 발밑에 먼지. */
  private started(): void {
    this.buildings.hostHop('race', 0, 1.5);
    for (const r of this.racers) this.fx.puff(r.x, r.y, 4, 36);
  }

  /** 1등이 결승선을 지났다: 색종이, 해설자 통통, 1등 선수 반짝. */
  private finishedRace(res: RaceResult): void {
    const f = trackPoint(1, 1);
    this.fx.confetti(f.x, f.y - 20, 34);
    this.buildings.hostHop('race', 1, 1.5);
    const w = this.racers[res.finishOrder[0] ?? 0];
    if (w !== undefined) {
      w.winT = WIN_HOP_SEC;
      this.fx.sparkles(w.x, w.y - 30, 8, 50);
    }
  }

  /** 경주 진행 + 결승 뒤 미끄러지기 (1을 넘어 조금 더 간다). */
  private progress(res: RaceResult, r: Racer, t: number): number {
    const F = res.finishAt[r.index] ?? 0;
    if (t <= F) return raceProgress(res, r.index, t);
    return 1 + r.endV * COAST_TAU * (1 - Math.exp(-(t - F) / COAST_TAU));
  }

  /** 선수 자리를 정한다 (경주로 p). 움직인 거리(세계 px)를 돌려준다. */
  private drive(r: Racer, rs: RaceState | null, dt: number): number {
    const res = this.result;
    if (res !== null) {
      r.p = raceTrackP(this.progress(res, r, this.clock));
    } else if (r.p > RACE_START_P + 1e-4) {
      // 경주가 끝났다: 달리던 쪽으로 남은 반 바퀴를 돌아 다음 바퀴의 출발선으로.
      const goal = RACE_START_P + Math.ceil((r.p - RACE_START_P) / RACE_LAP_P - 1e-6) * RACE_LAP_P;
      const per = trackSpeed(r.lane, r.p);
      let speed = RETURN_SPEED;
      if (rs !== null && rs.phase === 'gathering') speed = Math.max(speed, ((goal - r.p) * per) / Math.max(0.3, rs.countdown - 0.6));
      speed = Math.min(speed, RETURN_MAX);
      r.p = Math.min(goal, r.p + (speed * dt) / per);
      if (r.p >= goal - 1e-6) r.p = RACE_START_P;
    } else {
      r.p = RACE_START_P;
    }
    const pt = trackPoint(r.lane, r.p);
    const moved = Math.hypot(pt.x - r.x, pt.y - r.y);
    // 순간이동(돌아가다 경주가 시작됨)은 걸음으로 치지 않는다.
    const step = moved > 200 ? 0 : moved;
    r.x = pt.x;
    r.y = pt.y;
    if (dt > 0 && step / dt > 20) {
      if (pt.dx > 0.12) r.face = -1;
      else if (pt.dx < -0.12) r.face = 1;
    }
    return step;
  }

  private draw(r: Racer, rs: RaceState | null, moved: number, dt: number, view: ViewRect): void {
    const g = r.gait;
    const speed = dt > 0 ? moved / dt : 0;
    r.run += (clamp(speed / RUN_FULL, 0, 1) - r.run) * follow(10, dt);
    r.phase += (moved / g.stride) * Math.PI;
    const run = r.run;

    // 바라보는 쪽: 0을 지나며 납작해져 몸을 돌리는 것처럼.
    if (r.flip !== r.face) {
      const s = dt * TURN_RATE;
      r.flip = r.flip < r.face ? Math.min(r.face, r.flip + s) : Math.max(r.face, r.flip - s);
    }

    const s = Math.sin(r.phase);
    const hop = Math.abs(s);
    let dy = -hop * g.amp * run;
    let sy = 1 + g.squash * (hop - 0.4) * run;
    let sx = 1 - g.squash * 0.6 * (hop - 0.4) * run;
    let rot = s * g.rock * run;
    // 달리는 쪽으로 살짝 기울기 (위아래로 달릴 때).
    const pt = trackPoint(r.lane, r.p);
    const head = r.face === -1 ? Math.atan2(pt.dy, pt.dx) : Math.atan2(-pt.dy, -pt.dx);
    rot += clamp(head, -0.5, 0.5) * 0.3 * run;

    // 서 있을 때: 숨쉬기, 가끔 들썩. 모이는 중이면 더 자주, 출발 직전에는 웅크린다.
    const gathering = rs !== null && rs.phase === 'gathering';
    const ready = gathering && rs.countdown <= COUNT_FROM;
    const still = run < 0.15 && this.result === null;
    const br = Math.sin(this.time * 2.4 + r.seed) * 0.02 * (1 - run);
    sy *= 1 + br;
    sx *= 1 - br * 0.5;
    if (still && ready) {
      sy *= 0.9;
      sx *= 1.06;
    } else if (still) {
      r.idleHopIn -= dt;
      if (r.idleHopIn <= 0 && r.hopT < 0) {
        r.hopT = 0;
        r.hopK = gathering ? 0.8 : 0.45;
        r.idleHopIn = gathering ? 1 + Math.random() * 1.6 : 3 + Math.random() * 4;
      }
    }
    if (r.hopT >= 0) {
      r.hopT += dt;
      const u = r.hopT / 0.42;
      if (u >= 1) r.hopT = -1;
      else dy -= Math.sin(Math.PI * u) * 14 * r.hopK;
    }
    // 1등 통통 (결승 뒤).
    if (r.winT > 0) {
      r.winT -= dt;
      const w = Math.abs(Math.sin(this.time * 7.5));
      dy -= w * 16 * clamp(r.winT / 0.4, 0, 1);
      sy *= 1 + 0.06 * w;
    }

    // 나타나기 (열릴 때 톡).
    let pop = 1;
    if (r.appear < 1) {
      if (r.appearDelay > 0) {
        r.appearDelay -= dt;
        pop = 0;
      } else {
        if (r.appear === 0) this.fx.puff(r.x, r.y, 4, 34);
        r.appear = Math.min(1, r.appear + dt / 0.35);
        pop = backOut(r.appear);
      }
    }

    // 모래 먼지.
    if (speed > 150) {
      r.dustT -= dt;
      if (r.dustT <= 0) {
        r.dustT = DUST_SEC;
        this.fx.puff(r.x - pt.dx * r.halfW * 0.6, r.y, 1, 18);
      }
    }

    r.node.position.set(r.x, r.y);
    const z = Math.round(r.y);
    if (r.node.zIndex !== z) r.node.zIndex = z;
    r.body.position.set(0, dy);
    r.body.rotation = rot;
    r.body.scale.set(r.flip * sx * pop, sy * pop);

    const lift = -dy;
    const ss = clamp(1 - lift / 90, 0.5, 1) * pop;
    r.shadow.position.set(r.x, r.y);
    r.shadow.scale.set(r.halfW * 0.8 * ss, r.halfW * 0.24 * ss);

    const m = r.halfW + 30;
    const culled = r.x + m < view.x0 || r.x - m > view.x1 || r.y + 30 < view.y0 || r.y - 90 > view.y1;
    r.node.culled = culled;
    r.shadow.culled = culled;
  }

  destroy(): void {
    for (const r of this.racers) {
      r.node.destroy({ children: true });
      r.shadow.destroy();
    }
    this.racers.length = 0;
    this.cushions.destroy();
    this.shadowCtx.destroy();
  }
}
