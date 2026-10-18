// 지도 위 씨름장 (밀어내기 대결장). 모래판 그림(map/ssireum_ring)은 buildings.ts가 바닥에 깐다.
// 바닥: 가운데 출발선 둘, 선수 발밑의 홍·청 원 (선수를 따라 미끄러진다).
// 모이는 중: 선수(자리 0 홍·1 청)는 제자리에서 다리를 번갈아 들며 몸을 풀고, 출발 직전에는 웅크려 마주 본다 (모래판 위에 3·2·1).
// 판 중: 둘이 가운데로 뛰어들어 맞붙고(먼지), 미는 힘 p(t)(play.tracks[0])만큼 같이 밀리며 앞으로 기울어 버틴다.
//   팽팽하면 부들부들, 밀리는 쪽은 발밑에 먼지가 일고 끝까지 밀리면 괴로운 얼굴. 사건(앞섬·위기·뒤집기)마다 해설자가 들썩.
// throwAt에 넘어뜨리기: 진 손님은 뒤로 날아가 벌러덩 (슬픔 포즈를 90° 눕혀 통통, 모래 먼지), 이긴 손님은 기쁨 포즈로 폴짝,
//   심판이 깃발을 든다(통통). 판이 끝나 쉬면 진 손님은 툭 털고 일어난다 (ssireumPuppets.ts PuppetSet).
// 모두 화면 시계(this.clock)의 함수: 판 중간에 열어도, 저장을 불러와도 그 순간 모습. 프레임마다 새 객체를 만들지 않는다.

import { Graphics } from 'pixi.js';
import { SIDES } from '../../data/defs.ts';
import type { RingGeo } from '../../data/catalog.ts';
import type { Pt } from '../../data/map.ts';
import { ease } from '../../core/tween.ts';
import { trackAt } from '../../sim/group/core.ts';
import type { GroupEntry, GroupPlay, GroupState } from '../../sim/types.ts';
import type { ViewRect } from '../mapUtil.ts';
import { GroupMapBase, inEllipse, type GroupMapCtx } from './base.ts';
import { clamp01, crossed, LieShadows, NO_KEYS, PuppetSet, seated, smooth } from './ssireumPuppets.ts';

const OUTLINE = 0x402c1c;
const CHALK = 0xfff6e2;
/** 판 시작 뒤 맞붙기까지 (초). */
const CHARGE = 0.42;
/** 맞붙었을 때 발에서 상대 쪽 몸 끝까지 (몸 반폭의 배수). */
const GAP = 0.88;
/** 넘어뜨린 뒤 날아가 땅에 닿기까지 (초). */
const FLY = 0.42;
/** 진 손님이 뒤로 밀려나는 거리 (몸 가운데, 세계 px). 몸 가운데를 축으로 눕혀 모래판 밧줄 기둥·옆 구경 자리까지 가지 않게. */
const FLY_BACK = 6;
/** 이긴 손님이 밀어붙인 뒤 물러서는 거리 (누운 손님 발과 겹치지 않게). */
const WIN_STEP_BACK = 26;
/** 진행자 자리. */
const REFEREE = 0;
const CASTER = 1;

/** 한 프레임에 쓰는 선수 정보 (고쳐 쓴다). */
interface Player {
  e: GroupEntry | null;
  /** 바라보는 쪽 (홍 +1 오른쪽, 청 -1). */
  readonly f: 1 | -1;
  /** 발 x (원·먼지 자리). */
  x: number;
  y: number;
}

export class SsireumMapView extends GroupMapBase {
  /** 모래판 (세계 좌표, 만들 때 놓인 자리). */
  private readonly R: RingGeo = this.ctx.sim.village().ring();
  private readonly bodies: PuppetSet;
  private readonly lie = new LieShadows();
  private readonly lines = new Graphics();
  /** 홍·청 발밑 원. */
  private readonly rings: [Graphics, Graphics];
  private readonly players: [Player, Player] = [
    { e: null, f: 1, x: 0, y: 0 },
    { e: null, f: -1, x: 0, y: 0 },
  ];
  /** 지난 프레임의 화면 시계 (사건·효과를 한 번만). */
  private prevClock = 0;
  /** 다음에 볼 사건 (play.events index). */
  private evi = 0;
  /** 다음 미끄럼 먼지 (누적 초). */
  private dustAt = 0;

  constructor(ctx: GroupMapCtx) {
    super(ctx);
    this.bodies = new PuppetSet(ctx.monsters);
    this.own(ctx.layers.floor, this.lines);
    const c = this.R.center;
    // 가운데 출발선 둘 (세로로 짧게).
    for (const s of [-1, 1]) this.lines.roundRect(c.x + s * 26 - 3, c.y - 10, 6, 30, 3).fill({ color: CHALK, alpha: 0.85 });
    this.rings = [this.ring(0), this.ring(1)];
    this.own(ctx.layers.shadows, this.lie.node);
  }

  private ring(side: 0 | 1): Graphics {
    const g = new Graphics()
      .ellipse(0, 0, 40, 15)
      .fill({ color: SIDES[side].color, alpha: 0.6 })
      .stroke({ color: OUTLINE, width: 3.5, alpha: 0.55 });
    const s = this.seatPt(side);
    g.position.set(s.x, s.y);
    return this.own(this.ctx.layers.floor, g);
  }

  private seatPt(seat: number): Pt {
    return this.spot.seats[seat] ?? this.R.center;
  }

  protected override onShown(show: boolean): void {
    super.onShown(show);
    if (!show) this.bodies.clear();
  }

  protected override onPlay(p: GroupPlay | null): void {
    // 중간에 열었으면 지난 사건·효과는 다시 내지 않는다.
    this.prevClock = this.clock;
    this.evi = 0;
    if (p === null) return;
    while (this.evi < p.events.length && (p.events[this.evi]?.t ?? Infinity) <= this.clock) this.evi++;
  }

  protected draw(dt: number, _view: ViewRect): void {
    const g = this.group;
    const play = this.play;
    const t = this.clock;
    const prev = this.prevClock;
    this.prevClock = t;
    // 시작 숫자 3·2·1 (모래판 위, 선수 머리 위로).
    this.startCount(this.R.center.x, this.R.center.y - 150, REFEREE);
    // 선수 찾기 (자리 0 홍·1 청).
    for (let side = 0; side < 2; side++) {
      const pl = this.players[side] as Player;
      const s = this.seatPt(side);
      pl.e = null;
      pl.x = s.x;
      pl.y = s.y;
    }
    if (g !== null) {
      for (let i = 0; i < g.participants.length; i++) {
        const e = g.participants[i] as GroupEntry;
        if (e.role !== 'player' || (e.pick !== 0 && e.pick !== 1)) continue;
        const pl = this.players[e.pick as 0 | 1];
        pl.e = e;
        const s = this.seatPt(e.seat);
        pl.x = s.x;
        pl.y = s.y;
      }
    }
    this.lie.begin();
    if (g !== null && play !== null && play.kind === 'ssireum') {
      this.bout(play, t, prev);
      this.events(play, t);
    } else if (g !== null && g.phase === 'gathering') {
      this.warmup(g, dt);
    }
    this.lie.end();
    this.bodies.flush(dt);
    for (let side = 0; side < 2; side++) {
      const pl = this.players[side] as Player;
      const r = this.rings[side] as Graphics;
      r.position.set(pl.x, pl.y);
      r.alpha = pl.e !== null ? 1 : 0.55;
    }
  }

  /** 모이는 중: 선수가 다리를 번갈아 들며 몸을 풀고, 둘 다 와서 출발이 가까우면 웅크린다. */
  private warmup(g: GroupState, dt: number): void {
    const both = this.players[0].e !== null && this.players[1].e !== null;
    const ready = both ? smooth((1.4 - g.countdown) / 0.6) : 0;
    for (let i = 0; i < 2; i++) {
      const pl = this.players[i] as Player;
      const e = pl.e;
      if (e === null) continue;
      const m = this.monster(e.monster);
      if (!seated(m, this.booth, e.seat)) continue;
      const b = this.bodies.take(e.monster);
      b.facing = pl.f;
      // 다리 들기: 2.2초마다 한 번, 번갈아 왼쪽·오른쪽으로 기울며 들었다가 쿵.
      const period = 2.2;
      const ph = this.time + e.seat * 1.1;
      const u = (ph % period) / 0.55;
      const n = Math.floor(ph / period);
      const lift = u < 1 ? Math.sin(u * Math.PI) : 0;
      const stomp = (1 - ready) * lift;
      b.rot = (n % 2 === 0 ? 1 : -1) * 0.13 * stomp + pl.f * 0.2 * ready;
      b.lift = 7 * stomp;
      b.sx = 1 + 0.04 * ready;
      b.sy = 1 - 0.06 * ready;
      b.dx = pl.f * 10 * ready;
      pl.x += b.dx;
      // 쿵: 발밑에 작은 먼지.
      const prevU = ((ph - dt) % period) / 0.55;
      if (ready < 0.5 && prevU < 1 && u >= 1) this.ctx.fx.puff(pl.x, pl.y, 2, 22);
    }
  }

  /** 판 중·결과: 맞붙어 밀고 밀리다가 넘어뜨리기. */
  private bout(play: Extract<GroupPlay, { kind: 'ssireum' }>, t: number, prev: number): void {
    const keys = play.tracks[0] ?? NO_KEYS;
    const c = this.R.center;
    const R = this.R.reach;
    const thrown = t >= play.throwAt;
    const p = thrown ? (play.winner === 0 ? 1 : -1) : trackAt(keys, t);
    const pv = thrown ? 0 : (p - trackAt(keys, t - 0.12)) / 0.12;
    const k = ease.inOutQuad(clamp01(t / CHARGE));
    const fx = this.ctx.fx;
    let dust = false;
    if (!thrown && Math.abs(pv) > 0.22 && this.time >= this.dustAt) {
      dust = true;
      this.dustAt = this.time + 0.15;
    }
    for (let i = 0; i < 2; i++) {
      const pl = this.players[i] as Player;
      const e = pl.e;
      if (e === null) continue;
      const m = this.monster(e.monster);
      const v = this.view(e.monster);
      if (!seated(m, this.booth, e.seat) || v === undefined) continue;
      const f = pl.f;
      const seatX = pl.x;
      const contact = c.x + p * R - f * v.halfW * GAP;
      const b = this.bodies.take(e.monster);
      b.facing = f;
      if (!thrown) {
        const adv = f * p;
        const fwd = f * pv;
        const x = seatX + (contact - seatX) * k;
        b.dx = x - seatX;
        // 앞으로 기울어 버틴다: 앞설수록 더, 밀려 물러날 때는 덜. 팽팽하면 부들부들.
        const lean = 0.16 + 0.12 * clamp01(adv) - 0.08 * clamp01(-fwd * 1.5);
        const tremble = (1 - clamp01(Math.abs(pv) * 1.6)) * Math.sin(this.time * 41 + e.seat * 2.1) * 0.03;
        b.rot = f * (lean + tremble) * k;
        b.lift = Math.abs(Math.sin(this.time * 13 + e.seat)) * 3 * clamp01(Math.abs(pv) * 2) * k;
        b.sx = 1 + 0.05 * k;
        b.sy = 1 - 0.05 * k;
        if (adv < -0.45) b.pose = 'agony';
        pl.x = x;
        // 밀려나는 쪽 발밑에 먼지.
        if (dust && fwd < 0) fx.puff(x - f * 6, pl.y + 2, 2, 22);
        // 맞붙는 순간.
        if (crossed(prev, t, CHARGE) && f === 1) fx.puff(c.x + p * R, pl.y - 18, 6, 46);
        continue;
      }
      const u = t - play.throwAt;
      const won = e.pick === play.winner;
      if (won) {
        // 이긴 손님: 끝까지 밀어붙이고(조금 따라 나감) 한 걸음 물러서 몸을 펴며 폴짝폴짝.
        const x = contact + f * 12 * smooth(u / 0.3) - f * WIN_STEP_BACK * smooth((u - 0.35) / 0.45);
        b.dx = x - seatX;
        pl.x = x;
        if (t >= play.end) {
          // 결과 반응(sim monsterReact)의 연출을 그대로 보인다.
          b.still = false;
          continue;
        }
        b.rot = f * 0.3 * (1 - smooth(u / 0.45));
        const hop = u < 0.3 ? 0 : u < 0.75 ? Math.sin(((u - 0.3) / 0.45) * Math.PI) * 20 : Math.abs(Math.sin((u - 0.75) * 7.5)) * 13 * Math.max(0, 1 - (u - 0.75) / 2.2);
        b.lift = hop;
        if (u > 0.2) b.pose = 'joy';
        continue;
      }
      // 진 손님: 뒤로 넘어가 벌러덩, 등으로 통통. 몸은 발을 축으로 돈다: 몸 가운데(mid)가 제자리에 남게 발을 이긴 쪽으로 반 키만큼 민다
      // (발을 축으로 그냥 눕히면 머리가 키만큼 바깥으로 나가 모래판 밧줄 기둥과 옆 구경 손님 위에 눕는다. 확대 화면과 같이).
      const s = clamp01(u / FLY);
      const fall = s < 1 ? ease.inOutQuad(s) : 1;
      const mid = contact - f * FLY_BACK * ease.outQuad(s);
      const x = mid + f * v.headH * 0.5 * Math.sin(fall * (Math.PI / 2));
      b.dx = x - seatX;
      pl.x = contact;
      const lieLift = v.halfW * 0.85;
      if (s < 1) {
        b.rot = f * 0.22 * (1 - s) + -f * (Math.PI / 2) * fall;
        b.lift = lieLift * s + Math.sin(s * Math.PI) * 30;
        b.pose = 'agony';
      } else {
        const u2 = u - FLY;
        const decay = Math.exp(-u2 * 3.2);
        b.rot = -f * (Math.PI / 2) + Math.sin(u2 * 8) * 0.08 * Math.exp(-u2 * 2.4);
        b.lift = lieLift + Math.abs(Math.sin(u2 * 10)) * 13 * decay;
        b.sy = 1 - 0.07 * decay * Math.abs(Math.cos(u2 * 10));
        const mp = m.pose;
        b.pose = t >= play.end && (mp === 'agony' || mp === 'sad') ? mp : 'sad';
      }
      // 누운 몸 아래 그림자 (머리는 상대 반대쪽).
      const lieA = smooth((s - 0.4) / 0.6);
      if (lieA > 0) this.lie.add(mid, pl.y + 2, v.headH * 0.55, v.halfW * 0.38, lieA);
      if (crossed(prev, t, play.throwAt + FLY)) {
        fx.puff(mid - f * v.headH * 0.1, pl.y + 4, 8, 64);
        this.ctx.buildings.hostHop(this.booth, REFEREE, 1.3);
      }
    }
    // 넘어뜨리는 순간: 맞닿은 자리에 먼지.
    if (crossed(prev, t, play.throwAt)) fx.puff(c.x + p * R, c.y + 8, 8, 60);
  }

  /** 타임라인 사건 (시각대로 한 번씩): 해설자 들썩, 위기·뒤집기 먼지. 오래 지난 사건(따라잡기)은 넘긴다. */
  private events(play: GroupPlay, t: number): void {
    const fx = this.ctx.fx;
    while (this.evi < play.events.length) {
      const ev = play.events[this.evi];
      if (ev === undefined || ev.t > t) break;
      this.evi++;
      if (t - ev.t > 0.5) continue;
      switch (ev.type) {
        case 'lead':
          this.ctx.buildings.hostHop(this.booth, CASTER, 0.7);
          break;
        case 'brink': {
          // 끝까지 밀린 쪽 발밑 먼지.
          const pl = this.players[ev.actor === 1 ? 1 : 0];
          fx.puff(pl.x, pl.y, 4, 34);
          this.ctx.buildings.hostHop(this.booth, CASTER, 1);
          break;
        }
        case 'flip': {
          // 뒤집기: 둘 사이 발밑에 먼지 (선수 몸을 가리지 않게 작게), 머리 위 반짝이, 진행자 둘 다 들썩.
          const a = this.players[0];
          const b = this.players[1];
          fx.puff((a.x + b.x) / 2, a.y + 4, 6, 45);
          fx.sparkles((a.x + b.x) / 2, a.y - 70, 5, 50);
          this.ctx.buildings.hostHop(this.booth, CASTER, 1.5);
          this.ctx.buildings.hostHop(this.booth, REFEREE, 0.9);
          break;
        }
        default:
          break;
      }
    }
  }

  override hitTest(wx: number, wy: number): boolean {
    const c = this.R.center;
    return inEllipse(wx, wy, c.x, c.y, this.R.rx + 20, this.R.ry + 30);
  }

  override destroy(): void {
    this.bodies.clear();
    super.destroy();
    this.lie.destroy();
  }
}
