// 지도 위 연날리기 대회. 부스 표식(이정표)과 진행자는 buildings.ts. 연 넷(objects/kite_red·blue·yellow·green)과 연줄은 하늘 층(모든 것 위):
// 하늘에 떠 있어 지도 어디서나 보인다 (마을 북쪽 건물·구름 위로도). 바닥층에는 날리는 자리를 품은 낮은 풀 언덕(KITE_GEO.hill: 밝은 위,
// 그늘진 앞 비탈, 풀 포기·작은 꽃)과 날리는 자리마다 얼레를 꽂은 말뚝 (잠긴 부스라도 지도에 놓였으면 언덕은 그대로, 말뚝은 흐리게).
// 배치형 마을: 모양은 만들 때 놓인 자리 (sim.village().kite()), 옮기면 world.ts가 새로 만든다.
//   연 k는 날리는 자리 k(catalog.ts KITE_GEO.flyers) 위에서 높이 play.tracks[2k](0~1)·좌우 play.tracks[2k+1](sway px 단위)를 목표로
//   용수철처럼 따라가며(조금 넘쳤다 돌아온다) 바람에 살랑인다. 움직이는 쪽으로 기울어 꼬리가 흔들린다 (연줄 매는 점이 기준점).
//   연줄: 손(날리는 손님이 없으면 말뚝)에서 연까지 바람 쪽으로 휘는 가는 선. 연싸움(tangle) 동안 두 연이 떨고 줄이 팽팽해지며,
//   두 줄이 엇갈린 곳에서 비벼지는 작은 반짝이. 판 중에는 하늘에 바람 자국이 더 지나간다.
//   끊긴 연(play.cutAt[k])은 빙글빙글 바람에 날아가 화면 밖으로 (짧은 줄을 매단 채), 손에 남은 줄은 늘어지며 떨어진다.
//   이긴 연은 끝(finish)에 한 바퀴 재주. 쉬는 동안은 낮게 둥실, 끊겼던 연은 손에서 다시 떠오른다.
// 날리는 손님(몸 맡기기): 자기 연 쪽을 보며 뒤로 살짝 버틴다. 줄이 끊기면 뒤로 휘청 + 괴로움 → 슬픔, 이기면 기쁨으로 통통.
// 구경 손님(자리 4·5)은 건 연 쪽을 본다. 결과 반응(done)은 sim의 반응 그대로.

import { Container, Graphics, Sprite } from 'pixi.js';
import { KITE } from '../../data/defs.ts';
import type { KiteGeo, Rect } from '../../data/catalog.ts';
import { GROUND_STYLE } from '../../data/map.ts';
import { Rng } from '../../core/rng.ts';
import { trackAt } from '../../sim/group/core.ts';
import type { GroupPlay, GroupState, MonsterId } from '../../sim/types.ts';
import { ArtNode, artMeta, artTexture, type ArtAnchor } from '../art.ts';
import { clamp, ellipseK, follow, type ViewRect } from '../mapUtil.ts';
import { GroupMapBase, type GroupMapCtx } from './base.ts';

type KitePlay = Extract<GroupPlay, { kind: 'kite' }>;

const OUTLINE = 0x402c1c;
const STRING = 0xfffaf0;
/** 카메라 확대가 이보다 작으면(멀리서 보면) 연을 키우기 시작한다 (폰 기본 확대 0.26이면 약 1.2배, 0.12면 약 1.8배), 가장 크게. */
const FAR_ZOOM = 0.4;
const FAR_MAX = 1.9;
/** 연 그림자 색 (어두운 풀빛). */
const SHADOW = 0x24361a;
/** 연 그림 배율 (세계 px / 캔버스 px): 연 몸 약 80px 폭, 꼬리까지 약 155px. */
const KITE_K = 0.17;
/** 연줄 매는 점 = 살이 엇갈리는 곳 (그림 높이의 비율, 가로 살이 가장 넓은 줄). */
const BRIDLE: Readonly<Record<string, number>> = { kite_red: 0.273, kite_blue: 0.273, kite_yellow: 0.266, kite_green: 0.297 };
/** 쉬는 동안의 높이 (0~1)와 좌우 (sway 단위). */
const IDLE_H = 0.24;
/** 용수철 (세기, 감쇠비): 위치·기울기. */
const SPRING_K = 14;
const SPRING_Z = 0.45;
const ROT_K = 26;
const ROT_Z = 0.32;
/** 끊긴 연이 날아가 사라지는 초. */
const FLY_SEC = 4.6;
/** 손에 남은 줄이 떨어져 사라지는 초. */
const DROP_SEC = 1.9;
/** 다시 떠오르기 (초). */
const BACK_SEC = 1.4;
/** 이긴 연의 재주 (초). */
const LOOP_SEC = 0.9;
/** 출발 몇 초 전부터 숫자를 띄우나. */
const COUNT_FROM = 3;
/** 바람 자국 수. */
const STREAKS = 4;
/** 잠긴 부스의 말뚝 (buildings.ts 닫힌 부스와 같은 흐림). */
const LOCKED_ALPHA = 0.35;
/** 언덕 색: 위(볕 드는 풀빛, 풀밭보다 밝게)·앞 비탈(그늘)·볕 얼룩, 꽃 색. */
const HILL_TOP = 0xa3c274;
const HILL_SIDE = 0x7b9a52;
const HILL_SUN = 0xc4dc92;
const HILL_FLOWERS = [0xfff6e2, 0xf6d36b, 0xf2b5a8] as const;
/** 언덕 위 풀 포기·꽃 수와 한 포기 폭 (세계 px, 바닥 풀과 같게). */
const HILL_TUFTS = 11;
const HILL_BLOOMS = 7;
const HILL_TUFT_W = 38;

/** 연 그림의 기준점 (연줄 매는 점, 캔버스 좌표). 그림 정보가 없으면 가운데. */
function bridleAnchor(key: string): ArtAnchor {
  const m = artMeta('objects', key);
  if (m === undefined) return 'center';
  return { x: m.trim.x + m.trim.w / 2, y: m.trim.y + m.trim.h * (BRIDLE[key] ?? 0.28) };
}

/** 하늘이 넘지 않는 지도 위 끝 (세계 y: 연줄 매는 점 위로 연 머리가 지도 안에 남는 여유, 카메라는 지도 위 끝까지만 본다). */
const SKY_TOP = 34;

/**
 * 연이 나는 높이 (세계 y: low = 높이 0, high = 높이 1)와 바람 자국이 지나는 하늘. 보통은 KITE_GEO 그대로,
 * 언덕이 지도 위 끝 가까이 놓여 하늘이 지도 밖으로 나가면 날리는 자리에서 SKY_TOP까지로 눌러 담는다 (연은 낮게 난다).
 */
function skyOf(F: KiteGeo): { low: number; high: number; rect: Rect } {
  const base = F.flyers[0]?.y ?? F.center.y;
  const span = base - F.skyHigh;
  const room = base - SKY_TOP;
  const k = span > room ? clamp(room / span, 0.15, 1) : 1;
  const low = base - (base - F.skyLow) * k;
  const high = base - span * k;
  // 바람 자국은 연 높이 위아래로 (KITE_GEO.sky와 같은 여유).
  const top = high - (F.skyHigh - F.sky.y);
  return { low, high, rect: { x: F.sky.x, y: top, w: F.sky.w, h: low - top + (F.sky.y + F.sky.h - F.skyLow) } };
}

/** 0 → 1 → 0 (u 0~1). */
function bump(u: number): number {
  return u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u);
}

function smooth(u: number): number {
  const v = clamp(u, 0, 1);
  return v * v * (3 - 2 * v);
}

interface Kite {
  readonly index: number;
  /** 하늘 층. 위치 = 연줄 매는 점. */
  readonly node: Container;
  readonly art: ArtNode;
  readonly seed: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  /** 연줄 끝 (손이나 말뚝, 부드럽게 옮긴다). */
  hx: number;
  hy: number;
  /** 날아가기 시작한 곳과 빠르기·기울기 (끊긴 판에서). lost = 이 판(play)에서 끊겨 날아갔다. */
  lost: KitePlay | null;
  lx: number;
  ly: number;
  lvx: number;
  lrot: number;
  /** 다시 떠오르기 (0 → 1, 1 = 보통). */
  back: number;
}

/** 끊겨 손에 남은 줄 (손 → 끊긴 곳, 아래로 늘어지며 떨어진다). */
interface Dropped {
  readonly kite: number;
  readonly cx: number;
  readonly cy: number;
  age: number;
}

export class KiteMapView extends GroupMapBase {
  /** 연날리기 언덕 (세계 좌표, 만들 때 놓인 자리). */
  private readonly F: KiteGeo = this.ctx.sim.village().kite();
  /** 연이 나는 높이와 하늘 (지도 위 끝에 붙은 언덕이면 지도 안으로 눌러 담는다). */
  private readonly sky = skyOf(this.F);
  /** 풀 언덕 (바닥층 맨 아래: 말뚝·손님 그림자가 그 위에). */
  private readonly hill = new Container();
  private readonly pegs = new Graphics();
  private readonly wind = new Graphics();
  private readonly strings = new Graphics();
  private readonly kites: Kite[] = [];
  private readonly drops: Dropped[] = [];
  /** 손님이 바라보는 쪽 (흔들리지 않게 조금 버틴다). */
  private readonly looks = new Map<MonsterId, -1 | 1>();
  /** 사건 연출을 낸 화면 시계 (지난 프레임). */
  private lastClock = 0;
  private lastCount = 0;
  /** 연싸움 줄 비비기 반짝이 간격 (초). */
  private rubT = 0;
  /** 멀리서 볼 때 연·줄 배율 (1 ~ FAR_MAX). */
  private far = 1;

  constructor(ctx: GroupMapCtx) {
    super(ctx);
    this.own(ctx.layers.floor, this.hill);
    this.own(ctx.layers.floor, this.pegs);
    this.own(ctx.layers.sky, this.wind);
    this.own(ctx.layers.sky, this.strings);
    this.drawHill();
    this.drawPegs();
    KITE.kites.forEach((k, i) => {
      const node = new Container();
      const art = new ArtNode({ k: KITE_K, anchor: bridleAnchor(k.key), placeholder: { w: 480, h: 600, color: k.color } });
      art.setArt('objects', k.key);
      // 연 그림자 (같은 그림을 어둡게, 조금 아래로): 하늘에 떠 보이고, 풀빛과 비슷한 초록 연도 풀밭 위에서 또렷하게.
      const shadow = new ArtNode({ k: KITE_K, anchor: bridleAnchor(k.key), placeholder: { w: 480, h: 600, color: 0x000000 } });
      shadow.setArt('objects', k.key);
      shadow.tint = SHADOW;
      shadow.alpha = 0.26;
      shadow.position.set(16, 26);
      node.addChild(shadow, art);
      this.own(ctx.layers.sky, node);
      const spot = this.F.flyers[i] ?? this.F.center;
      const y = this.sky.low + (this.sky.high - this.sky.low) * IDLE_H;
      this.kites.push({
        index: i, node, art, seed: i * 2.17 + 0.6, x: spot.x, y, vx: 0, vy: 0, rot: 0, vr: 0,
        hx: spot.x + 24, hy: spot.y - 26, lost: null, lx: 0, ly: 0, lvx: 0, lrot: 0, back: 1,
      });
    });
  }

  /**
   * 풀 언덕: 앞 비탈(위 타원을 rise만큼 내린 그늘진 타원, 진한 테두리) 위에 밝은 위 타원, 볕 드는 왼쪽 위 얼룩.
   * 풀 포기(바닥 풀 그림)와 작은 꽃은 언덕마다 같은 무작위로, 손님 자리·말뚝·이정표·진행자·항아리를 비켜서.
   */
  private drawHill(): void {
    const H = this.F.hill;
    const { c, rx, ry, rise } = H;
    const g = new Graphics();
    g.ellipse(c.x, c.y + rise, rx, ry).fill(HILL_SIDE).stroke({ width: 5, color: OUTLINE, alpha: 0.55 });
    g.ellipse(c.x, c.y, rx, ry).fill(HILL_TOP).stroke({ width: 3, color: OUTLINE, alpha: 0.16 });
    g.ellipse(c.x - rx * 0.3, c.y - ry * 0.32, rx * 0.42, ry * 0.36).fill({ color: HILL_SUN, alpha: 0.4 });
    this.hill.addChild(g);
    // 비킬 곳 (세계 px, 반지름).
    const keep: { x: number; y: number; r: number }[] = [
      ...this.F.flyers.map((s) => ({ x: s.x + 10, y: s.y - 10, r: 62 })),
      ...this.F.bettors.map((s) => ({ x: s.x, y: s.y - 10, r: 56 })),
      ...this.spot.hosts.map((s) => ({ x: s.x, y: s.y - 10, r: 56 })),
      { x: this.spot.base.x, y: this.spot.base.y, r: 80 },
      { x: this.spot.pot.x, y: this.spot.pot.y, r: 48 },
    ];
    const free = (x: number, y: number): boolean => ellipseK(x, y, c.x, c.y, rx * 0.9, ry * 0.8) < 1 && keep.every((k) => Math.hypot(x - k.x, (y - k.y) * 1.3) > k.r);
    const rng = new Rng(0x6b17e);
    const tex = artTexture('map', 'tuft');
    let tufts = 0;
    let blooms = 0;
    for (let n = 0; n < 160 && (tufts < HILL_TUFTS || blooms < HILL_BLOOMS); n++) {
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next());
      const x = c.x + Math.cos(a) * rx * r;
      const y = c.y + Math.sin(a) * ry * r;
      const s = 0.8 + rng.next() * 0.35;
      const flip = rng.next() < 0.5 ? -1 : 1;
      const bloom = rng.next() < 0.45;
      const col = HILL_FLOWERS[Math.floor(rng.next() * HILL_FLOWERS.length)] ?? 0xfff6e2;
      if (!free(x, y)) continue;
      if (bloom && blooms < HILL_BLOOMS) {
        blooms++;
        // 작은 꽃: 잎 다섯 + 노란 가운데.
        for (let k = 0; k < 5; k++) {
          const t = (k / 5) * Math.PI * 2 + a;
          g.circle(x + Math.cos(t) * 5 * s, y + Math.sin(t) * 4 * s, 4 * s).fill(col);
        }
        g.circle(x, y, 3 * s).fill(0xe8a33d);
      } else if (!bloom && tufts < HILL_TUFTS) {
        tufts++;
        if (tex !== undefined) {
          const sp = new Sprite(tex);
          sp.anchor.set(0.5, 1);
          const k = (HILL_TUFT_W * s) / Math.max(1, tex.width);
          sp.scale.set(k * flip, k);
          sp.position.set(x, y);
          this.hill.addChild(sp);
        } else {
          g.moveTo(x - 9 * s * flip, y).lineTo(x - 15 * s * flip, y - 14 * s).moveTo(x, y - s).lineTo(x + s * flip, y - 20 * s).moveTo(x + 9 * s * flip, y).lineTo(x + 14 * s * flip, y - 15 * s);
          g.stroke({ width: 5.5 * s, color: GROUND_STYLE.tuft, cap: 'round' });
        }
      }
    }
  }

  /** 날리는 자리마다 얼레를 꽂은 말뚝 (날리는 손님이 없으면 연줄이 여기 묶인다). */
  private drawPegs(): void {
    const g = this.pegs;
    for (const s of this.F.flyers) {
      const p = pegTop(s);
      g.ellipse(p.x, s.y + 2, 13, 5).fill({ color: 0x000000, alpha: 0.12 });
      g.roundRect(p.x - 4, p.y, 8, s.y - p.y + 2, 3).fill(0xa0703f).stroke({ color: OUTLINE, width: 3 });
      // 얼레: 줄을 감은 작은 통.
      g.roundRect(p.x - 11, p.y - 4, 22, 14, 5).fill(0xd9b27a).stroke({ color: OUTLINE, width: 3 });
      g.rect(p.x - 6, p.y - 1, 12, 8).fill(STRING);
    }
  }

  // ── 판 따라가기 ──

  protected override onShown(show: boolean): void {
    super.onShown(show);
    this.drops.length = 0;
  }

  protected override onPlay(p: GroupPlay | null): void {
    this.lastClock = this.clock;
    // 끊겼던 연은 손에서 다시 떠오른다.
    const play = p !== null && p.kind === 'kite' ? p : null;
    for (const k of this.kites) {
      if (k.lost === null || k.lost === play) continue;
      k.lost = null;
      k.back = 0;
      k.x = k.hx;
      k.y = k.hy - 30;
      k.vx = 0;
      k.vy = -120;
      k.rot = 0;
      k.vr = 0;
    }
  }

  protected draw(dt: number): void {
    const g = this.group;
    const play = this.play !== null && this.play.kind === 'kite' ? this.play : null;
    const t = this.clock;
    this.countdown(g);
    if (play !== null) this.fireEvents(play);
    this.lastClock = t;

    this.strings.clear();
    for (const k of this.kites) this.hand(k, g, play, dt);
    for (const k of this.kites) this.fly(k, play, dt);
    if (play !== null) this.rub(play, dt);
    this.drawDrops(dt);
    this.drawWind(play !== null && g?.phase === 'running');
    this.puppets(g, play);
  }

  /** 출발 숫자 3·2·1 (날리는 줄 위). */
  private countdown(g: GroupState | null): void {
    if (g !== null && g.phase === 'gathering') {
      const c = Math.ceil(g.countdown - 1e-6);
      if (c >= 1 && c <= COUNT_FROM && c !== this.lastCount) {
        this.ctx.fx.floatText(this.F.center.x, this.F.center.y - 40, `${c}`, 'win', c === 1);
        this.ctx.buildings.hostHop('kite', 1, 0.6);
      }
      this.lastCount = c;
    } else {
      this.lastCount = 0;
    }
  }

  /** 지난 프레임 뒤에 지난 사건의 연출 (불러온 저장처럼 한참 지난 사건은 조용히). */
  private fireEvents(play: KitePlay): void {
    const t0 = this.lastClock;
    const t1 = this.clock;
    for (const e of play.events) {
      if (e.t <= t0 || e.t > t1 || t1 - e.t > 0.5) continue;
      const a = this.kites[e.actor];
      if (a === undefined) continue;
      if (e.type === 'tangle') {
        const b = this.kites[e.other ?? -1];
        if (b !== undefined) this.ctx.fx.sparkles((a.x + b.x) / 2, (a.y + b.y) / 2 + 30, 5, 40);
      } else if (e.type === 'cut') {
        // 끊긴 곳: 연 바로 아래 줄.
        const cx = a.x + (a.hx - a.x) * 0.1;
        const cy = a.y + (a.hy - a.y) * 0.1;
        this.drops.push({ kite: a.index, cx, cy, age: 0 });
        this.ctx.fx.sparkles(cx, cy, 7, 36);
        this.ctx.fx.puff(cx, cy + 10, 4, 34);
        this.ctx.buildings.hostHop('kite', 0, 1.1);
      } else if (e.type === 'brink') {
        this.ctx.fx.sparkles(a.x, a.y + 40, 4, 30);
      } else if (e.type === 'finish') {
        this.ctx.fx.confetti(a.x, a.y + 60, 26);
        this.ctx.fx.sparkles(a.x, a.y, 8, 60);
        this.ctx.buildings.hostHop('kite', 0, 1.5);
        this.ctx.buildings.hostHop('kite', 1, 1.5);
      }
    }
  }

  /** 연 k의 연줄 끝: 이번 판의 날리는 손님 손 (판 밖이면 그 자리에 와 있는 손님), 없으면 말뚝. */
  private hand(k: Kite, g: GroupState | null, play: KitePlay | null, dt: number): void {
    const spot = this.F.flyers[k.index];
    if (spot === undefined) return;
    let id: MonsterId | null = null;
    if (play !== null && g !== null) id = g.participants.find((e) => e.role === 'player' && e.pick === k.index)?.monster ?? null;
    else id = this.bs.seats[k.index] ?? null;
    const m = id === null ? undefined : this.monster(id);
    const v = m === undefined || m.phase === 'toSeat' || m.path.length > 0 ? undefined : this.view(m.id);
    let tx: number;
    let ty: number;
    if (v !== undefined) {
      const look = this.looks.get(v.id) ?? v.facing;
      tx = v.x + look * v.halfW * 0.5;
      ty = v.headY() + v.headH * 0.5;
    } else {
      const p = pegTop(spot);
      tx = p.x;
      ty = p.y;
    }
    const f = follow(10, dt);
    k.hx += (tx - k.hx) * f;
    k.hy += (ty - k.hy) * f;
  }

  /** 연 하나: 목표를 용수철로 따라가거나 (날아가는 중이면) 바람에 날려 보낸다. 연줄도 그린다. */
  private fly(k: Kite, play: KitePlay | null, dt: number): void {
    const time = this.time;
    const t = this.clock;
    const cut = play !== null ? (play.cutAt[k.index] ?? -1) : -1;
    if (play !== null && cut >= 0 && t >= cut) {
      if (k.lost !== play) {
        // 막 끊겼다 (중간에 열었으면 지금 자리에서).
        k.lost = play;
        k.lx = k.x;
        k.ly = k.y;
        k.lvx = clamp(k.vx, -200, 200);
        k.lrot = k.rot;
      }
      this.flyAway(k, t - cut);
      return;
    }
    // 목표 자리.
    let h = IDLE_H + Math.sin(time * 0.5 + k.seed) * 0.05;
    let s = Math.sin(time * 0.37 + k.seed * 2) * 0.35;
    let shake = 0;
    let dip = 0;
    let loop = 0;
    if (play !== null) {
      const th = trackAt(play.tracks[k.index * 2] ?? [], t);
      // 쉬던 높이에서 이어서 떠오른다 (판의 높이는 0에서 시작).
      h = Math.max(th, h * (1 - smooth(t / 1.8)));
      s = trackAt(play.tracks[k.index * 2 + 1] ?? [], t);
      for (const e of play.events) {
        if (e.type === 'tangle' && (e.actor === k.index || e.other === k.index)) {
          const end = play.cutAt[e.actor] ?? e.t;
          if (t >= e.t && t < end + 0.15) shake = Math.max(shake, smooth((t - e.t) / 0.3));
        } else if (e.type === 'brink' && e.actor === k.index) {
          const u = (t - e.t) / 0.9;
          dip = Math.max(dip, bump(u));
          if (u > 0 && u < 1) shake = 1;
        } else if (e.type === 'finish' && e.actor === k.index) {
          loop = smooth((t - e.t) / LOOP_SEC);
        }
      }
    }
    // 바람: 느린 너울과 잔떨림.
    const gx = Math.sin(time * 0.83 + k.seed) * 14 + Math.sin(time * 2.1 + k.seed * 3) * 6;
    const gy = Math.sin(time * 1.13 + k.seed * 2) * 10;
    const tx = (this.F.flyers[k.index]?.x ?? this.F.center.x) + s * this.F.sway + gx;
    const ty = this.sky.low + (this.sky.high - this.sky.low) * h + gy + dip * 80;
    // 용수철 (작게 나눠 적분: 프레임이 길어도 안정).
    k.back = Math.min(1, k.back + dt / BACK_SEC);
    const K = SPRING_K * (0.3 + 0.7 * k.back);
    const D = 2 * SPRING_Z * Math.sqrt(K);
    const n = Math.max(1, Math.ceil(dt / 0.02));
    const h1 = dt / n;
    const rotTarget = clamp(k.vx * 0.0024, -0.5, 0.5) + Math.sin(time * 1.7 + k.seed) * 0.07;
    const RD = 2 * ROT_Z * Math.sqrt(ROT_K);
    for (let i = 0; i < n; i++) {
      k.vx += ((tx - k.x) * K - k.vx * D) * h1;
      k.vy += ((ty - k.y) * K - k.vy * D) * h1;
      k.x += k.vx * h1;
      k.y += k.vy * h1;
      k.vr += ((rotTarget - k.rot) * ROT_K - k.vr * RD) * h1;
      k.rot += k.vr * h1;
    }
    // 연싸움 떨림 (그림만, 용수철과 따로).
    const jx = shake * (Math.sin(time * 31 + k.seed) * 5 + Math.sin(time * 17) * 3);
    const jy = shake * Math.cos(time * 27 + k.seed) * 4;
    const x = k.x + jx;
    const y = k.y + jy;
    const pop = 0.45 + 0.55 * smooth(k.back / 0.6);
    k.node.position.set(x, y);
    k.node.rotation = k.rot + shake * Math.sin(time * 23 + k.seed) * 0.16 + loop * Math.PI * 2;
    k.node.scale.set(pop * this.far);
    k.node.alpha = smooth(k.back / 0.35);
    k.node.visible = true;
    // 연줄: 바람 쪽(오른쪽)으로 휘고 처진다. 연싸움 중에는 팽팽하게.
    const dx = x - k.hx;
    const dy = y - k.hy;
    const L = Math.hypot(dx, dy);
    const slack = (1 - 0.7 * shake) * (0.3 + 0.7 * k.back);
    const mx = (k.hx + x) / 2 + L * 0.07 * slack + Math.sin(time * 2.3 + k.seed) * 3;
    const my = (k.hy + y) / 2 + L * 0.04 * slack;
    this.stringPath(k.hx, k.hy, mx, my, x, y, k.node.alpha);
  }

  /** 끊긴 연: 짧은 줄을 매단 채 빙글빙글 바람에 날려 화면 밖으로. u = 끊기고 지난 초. */
  private flyAway(k: Kite, u: number): void {
    if (u >= FLY_SEC) {
      k.node.visible = false;
      return;
    }
    const x = k.lx + k.lvx * 0.6 * (1 - Math.exp(-u)) + 150 * u + 55 * u * u;
    const y = k.ly - 50 * u - 22 * u * u + Math.sin(u * 4.2 + k.seed) * 22;
    k.x = x;
    k.y = y;
    k.node.position.set(x, y);
    k.node.rotation = k.lrot + (k.index % 2 === 0 ? 1 : -1) * (6.5 * u - 0.4 * u * u);
    k.node.scale.set((1 - 0.3 * smooth(u / FLY_SEC)) * this.far);
    k.node.alpha = 1 - smooth((u - (FLY_SEC - 1.2)) / 1.2);
    k.node.visible = true;
    // 연에 매달린 끊긴 줄 (뒤로 나부낀다).
    const wv = Math.sin(this.time * 9 + k.seed) * 10;
    this.stringPath(x, y, x - 30 + wv, y + 45, x - 55 - wv * 0.6, y + 95, k.node.alpha * 0.9);
  }

  /** 연싸움 중인 두 줄이 엇갈린 곳에서 비벼지며 작은 반짝이 (줄이 아직 안 엇갈렸으면 두 연 사이 아래). */
  private rub(play: KitePlay, dt: number): void {
    this.rubT -= dt;
    if (this.rubT > 0) return;
    const t = this.clock;
    for (const e of play.events) {
      if (e.type !== 'tangle' || t < e.t || t >= (play.cutAt[e.actor] ?? e.t)) continue;
      const a = this.kites[e.actor];
      const b = this.kites[e.other ?? -1];
      if (a === undefined || b === undefined) continue;
      const p = crossing(a.hx, a.hy, a.x, a.y, b.hx, b.hy, b.x, b.y) ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 45 };
      this.ctx.fx.sparkles(p.x, p.y, 2, 14);
      this.rubT = 0.22;
    }
  }

  /** 손에 남은 줄: 끊긴 끝이 떨어지며 늘어지다 사라진다. */
  private drawDrops(dt: number): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i] as Dropped;
      d.age += dt;
      const u = d.age;
      const k = this.kites[d.kite];
      if (u >= DROP_SEC || k === undefined) {
        this.drops.splice(i, 1);
        continue;
      }
      const ground = k.hy + 34;
      const ex = d.cx + 70 * u;
      const ey = Math.min(ground, d.cy + 0.5 * 1100 * u * u);
      const sag = 40 + 260 * u;
      const mx = (k.hx + ex) / 2 + 30;
      const my = Math.min(ground + 20, (k.hy + ey) / 2 + sag);
      this.stringPath(k.hx, k.hy, mx, my, ex, ey, 1 - smooth((u - (DROP_SEC - 0.6)) / 0.6));
    }
  }

  /** 가는 연줄 (어두운 테두리를 옅게 깔아 풀밭·길 어디서나 보이게). */
  private stringPath(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, alpha: number): void {
    if (alpha <= 0.01) return;
    const g = this.strings;
    g.moveTo(x0, y0).quadraticCurveTo(cx, cy, x1, y1).stroke({ width: 4.5 * this.far, color: OUTLINE, alpha: 0.22 * alpha, cap: 'round' });
    g.moveTo(x0, y0).quadraticCurveTo(cx, cy, x1, y1).stroke({ width: 2.2 * this.far, color: STRING, alpha: 0.95 * alpha, cap: 'round' });
  }

  /** 바람 자국: 연이 나는 하늘을 가로지르는 옅은 물결 선 (판 중에는 더 많이). */
  private drawWind(running: boolean): void {
    const g = this.wind;
    g.clear();
    const sky = this.sky.rect;
    const span = sky.w + 400;
    const n = running ? STREAKS : 2;
    for (let i = 0; i < n; i++) {
      const sp = 210 + i * 37;
      const u = ((this.time * sp + i * 523) % span) / span;
      const x = sky.x - 200 + u * span;
      const y = sky.y + 120 + ((i * 0.37 + Math.floor((this.time * sp + i * 523) / span) * 0.61) % 1) * (sky.h - 260);
      const a = bump(u) * 0.5;
      const len = 110;
      g.moveTo(x - len, y);
      g.bezierCurveTo(x - len * 0.6, y - 12, x - len * 0.3, y + 12, x, y).stroke({ width: 3, color: STRING, alpha: a, cap: 'round' });
    }
  }

  /** 손님 몸: 날리는 손님은 연을 보며 뒤로 버티고, 끊기면 휘청 → 괴로움·슬픔, 이기면 기쁨. 구경 손님은 건 연을 본다. */
  private puppets(g: GroupState | null, play: KitePlay | null): void {
    const t = this.clock;
    const time = this.time;
    const seen = new Set<MonsterId>();
    const running = g !== null && g.phase === 'running';
    // 판 중에는 참가자, 쉬는 동안은 날리는 자리에 와 있는 손님.
    const holders: { id: MonsterId; kite: number; player: boolean }[] = [];
    if (play !== null && g !== null) {
      for (const e of g.participants) holders.push({ id: e.monster, kite: e.pick, player: e.role === 'player' });
    } else {
      for (let i = 0; i < this.F.flyers.length; i++) {
        const id = this.bs.seats[i] ?? null;
        if (id !== null) holders.push({ id, kite: i, player: true });
      }
    }
    const finish = play?.events.find((e) => e.type === 'finish');
    for (const hd of holders) {
      const m = this.monster(hd.id);
      const v = this.view(hd.id);
      const k = this.kites[hd.kite];
      if (m === undefined || v === undefined || k === undefined || m.phase === 'toSeat' || m.path.length > 0) continue;
      seen.add(hd.id);
      // 연 쪽을 본다 (끊겨 날아간 연은 따라보지 않는다).
      const dx = k.x - v.x;
      let look = this.looks.get(hd.id) ?? v.facing;
      if (k.node.visible && dx > 70) look = 1;
      else if (k.node.visible && dx < -70) look = -1;
      this.looks.set(hd.id, look);
      if (!hd.player) {
        this.puppet(hd.id, { facing: look });
        continue;
      }
      const cut = play !== null ? (play.cutAt[hd.kite] ?? -1) : -1;
      const ph = k.seed;
      if (running && play !== null && cut >= 0 && t >= cut) {
        // 줄이 끊겼다: 뒤로 휘청, 괴로움 → 슬픔.
        const u = t - cut;
        const wob = bump(u / 0.7);
        this.puppet(hd.id, { facing: look, rot: -look * 0.45 * wob, dx: -look * 14 * wob, pose: u < 1.6 ? 'agony' : 'sad' });
      } else if (running && play !== null && finish !== undefined && finish.actor === hd.kite && t >= finish.t) {
        const u = t - finish.t;
        this.puppet(hd.id, { facing: look, pose: 'joy', lift: Math.abs(Math.sin(u * 7.5)) * 14 * clamp(1 - u / 3, 0, 1) });
      } else if (g === null || g.phase !== 'done') {
        // 줄을 쥐고 뒤로 살짝 버틴다 (연싸움 중에는 세게 당긴다).
        const tense = play !== null && running ? this.tension(play, hd.kite, t) : 0;
        const rot = -look * (0.06 + 0.03 * Math.sin(time * 2.4 + ph) + tense * (0.1 + 0.06 * Math.sin(time * 16 + ph)));
        this.puppet(hd.id, { facing: look, rot, dx: -look * tense * 6 });
      } else {
        this.puppet(hd.id, { facing: look });
      }
    }
    for (const id of this.looks.keys()) if (!seen.has(id)) this.looks.delete(id);
  }

  /** 연 k가 연싸움 중이면 0~1. */
  private tension(play: KitePlay, k: number, t: number): number {
    let v = 0;
    for (const e of play.events) {
      if (e.type === 'tangle' && (e.actor === k || e.other === k)) {
        const end = play.cutAt[e.actor] ?? e.t;
        if (t >= e.t && t < end) v = Math.max(v, smooth((t - e.t) / 0.3));
      } else if (e.type === 'brink' && e.actor === k && t >= e.t && t < e.t + 0.9) v = 1;
    }
    return v;
  }

  /** 잠겨 있어도 구역이 열렸으면 말뚝은 흐리게 보인다. */
  override update(dt: number, view: ViewRect): void {
    // 멀리서 볼수록(카메라 확대 = 화면 폭 / 보이는 세계 폭) 연과 줄을 조금 키운다: 지도를 넓게 봐도 하늘의 연이 보이게.
    const vw = view.x1 - view.x0;
    const zoom = vw > 0 ? (globalThis.innerWidth || 390) / vw : 1;
    this.far = clamp(Math.sqrt(FAR_ZOOM / zoom), 1, FAR_MAX);
    super.update(dt, view);
    this.hill.visible = this.placed;
    this.pegs.visible = this.placed;
    this.pegs.alpha = this.shown ? 1 : LOCKED_ALPHA;
  }

  override hitTest(wx: number, wy: number): boolean {
    for (const k of this.kites) if (k.node.visible && k.node.alpha > 0.3 && Math.abs(wx - k.x) < 55 * this.far && wy > k.y - 60 * this.far && wy < k.y + 110 * this.far) return true;
    // 언덕 (위 + 앞 비탈).
    const H = this.F.hill;
    return this.placed && ellipseK(wx, wy, H.c.x, H.c.y + H.rise / 2, H.rx, H.ry + H.rise / 2) < 1;
  }
}

/** 선분 (a0→a1)과 (b0→b1)이 만나는 점 (안 만나면 null). */
function crossing(ax0: number, ay0: number, ax1: number, ay1: number, bx0: number, by0: number, bx1: number, by1: number): { x: number; y: number } | null {
  const rx = ax1 - ax0;
  const ry = ay1 - ay0;
  const sx = bx1 - bx0;
  const sy = by1 - by0;
  const d = rx * sy - ry * sx;
  if (Math.abs(d) < 1e-6) return null;
  const u = ((bx0 - ax0) * sy - (by0 - ay0) * sx) / d;
  const v = ((bx0 - ax0) * ry - (by0 - ay0) * rx) / d;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? { x: ax0 + rx * u, y: ay0 + ry * u } : null;
}

/** 날리는 자리의 말뚝 위 (얼레). 손님 발 옆 뒤쪽. */
function pegTop(s: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return { x: s.x + 34, y: s.y - 30 };
}
