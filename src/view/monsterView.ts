// 지도 위 손님 몬스터. 손님마다 MonsterView 하나: 몸 그림(monsters/<종>_<포즈>), 그림자(코드), 머리 위 이모트.
// sim 좌표를 부드럽게 따라가고(lerp), 걸을 때 통통, 떠다니는 종은 둥실. Motion 연출은 시간으로 계산한다 (트윈 객체를 만들지 않는다).
// 프레임마다 새 객체를 만들지 않는다: 포즈 그림 이름은 미리 만들어 두고, 계산 결과는 같은 객체에 쓴다.

import { Container, Graphics, GraphicsContext, Sprite, Texture } from 'pixi.js';
import { SPECIES, SPECIES_IDS, type GoodId, type SpeciesId } from '../data/defs.ts';
import type { SimApi } from '../sim/api.ts';
import type { EmoteKind, Monster, MonsterId, Motion, Pose, Reaction } from '../sim/types.ts';
import { ART_SCALE, ArtNode, artMeta, artTexture, hasArt, monsterFoot } from './art.ts';
import type { FxLayer } from './fx.ts';
import { clamp, follow, type ViewRect } from './mapUtil.ts';

/** 그림이 없을 때 자리 표시 색 (defs.ts SPECIES.color). */
const SPECIES_COLOR = {} as Record<SpeciesId, number>;
for (const s of SPECIES_IDS) SPECIES_COLOR[s] = SPECIES[s].color;

const POSES: readonly Pose[] = ['base', 'joy', 'agony', 'sad'];
/** 종·포즈별 그림 key (프레임마다 문자열을 만들지 않게 미리). */
const POSE_KEY = {} as Record<SpeciesId, Record<Pose, string>>;
for (const s of SPECIES_IDS) {
  const row = {} as Record<Pose, string>;
  for (const p of POSES) row[p] = `${s}_${p}`;
  POSE_KEY[s] = row;
}

/** 걷기 한 걸음 (세계 px, 반 주기). */
const STRIDE = 30;
/** 떠다니는 종이 땅에서 떠 있는 높이. */
const HOVER = 16;
/** 이모트 크기 (세계 px, 긴 변). */
const EMOTE_SIZE = 46;
/** sim 좌표를 따라가는 빠르기. 이보다 멀리 떨어지면 바로 옮긴다. */
const FOLLOW_RATE = 14;
const SNAP_DIST = 260;
const LEAVE_FADE = 0.55;
const APPEAR_SEC = 0.35;

interface MotionOut {
  dx: number;
  dy: number;
  rot: number;
  sx: number;
  sy: number;
  flip: number;
}

/** Motion 연출 한 순간 (t초, 반응 시간 dur, 세기 k). 끝났으면 false. */
function motionAt(type: Motion, t: number, dur: number, k: number, facing: number, o: MotionOut): boolean {
  o.dx = 0;
  o.dy = 0;
  o.rot = 0;
  o.sx = 1;
  o.sy = 1;
  o.flip = 1;
  // 계속되는 연출은 끝 0.3초 동안 잦아든다.
  const fade = clamp((dur - t) / 0.3, 0, 1);
  switch (type) {
    case 'hop': {
      const D = 0.5;
      if (t >= D) return false;
      const s = Math.sin((Math.PI * t) / D);
      o.dy = -s * 26 * k;
      o.sy = 1 + 0.08 * k * s;
      o.sx = 1 - 0.05 * k * s;
      return true;
    }
    case 'bigHop': {
      const D = 1.15;
      if (t >= D) return false;
      const u = t / D;
      if (u < 0.12) {
        const s = Math.sin((u / 0.12) * Math.PI);
        o.sy = 1 - 0.2 * k * s;
        o.sx = 1 + 0.14 * k * s;
      } else if (u < 0.62) {
        const v = (u - 0.12) / 0.5;
        const s = Math.sin(Math.PI * v);
        o.dy = -s * 62 * k;
        o.sy = 1 + 0.1 * k * s;
        o.sx = 1 - 0.07 * k * s;
        o.rot = Math.sin(v * Math.PI * 2) * 0.1 * k;
      } else if (u < 0.7) {
        const s = Math.sin(((u - 0.62) / 0.08) * Math.PI);
        o.sy = 1 - 0.14 * k * s;
        o.sx = 1 + 0.1 * k * s;
      } else {
        const s = Math.sin(Math.PI * ((u - 0.7) / 0.3));
        o.dy = -s * 26 * k;
        o.sy = 1 + 0.05 * k * s;
      }
      return true;
    }
    case 'shake': {
      const D = 0.75;
      if (t >= D) return false;
      const a = 1 - t / D;
      o.dx = Math.sin(t * 46) * 7 * k * a;
      o.rot = Math.sin(t * 46 + 1) * 0.07 * k * a;
      return true;
    }
    case 'squash': {
      const D = 0.7;
      if (t >= D) return false;
      const u = t / D;
      const s = Math.sin(u * Math.PI * 3) * (1 - u);
      o.sy = 1 - 0.22 * k * s;
      o.sx = 1 + 0.18 * k * s;
      return true;
    }
    case 'spin': {
      // 3/4 그림이라 제자리에서 좌우로 두 번 돌아 보인다.
      const D = 0.85;
      if (t >= D) return false;
      const u = t / D;
      o.flip = Math.cos(u * Math.PI * 4);
      o.dy = -Math.sin(Math.PI * u) * 18 * k;
      return true;
    }
    case 'slump': {
      if (t >= dur) return false;
      const e = (1 - (1 - Math.min(1, t / 0.28)) ** 2) * fade;
      o.sy = 1 - 0.17 * k * e;
      o.sx = 1 + 0.1 * k * e;
      o.rot = 0.06 * facing * e;
      o.dy = 2 * e;
      return true;
    }
    case 'tremble': {
      if (t >= dur) return false;
      const a = fade * Math.min(1, t / 0.1);
      o.dx = Math.sin(t * 75) * 2.4 * k * a;
      o.sy = 1 - 0.035 * k * a * Math.abs(Math.sin(t * 19));
      return true;
    }
    case 'bounceLoop': {
      if (t >= dur) return false;
      const s = Math.abs(Math.sin(t * Math.PI * 2.4));
      const c = (1 - s) * (1 - s);
      o.dy = -s * 18 * k * fade;
      o.sy = 1 - 0.1 * k * c * fade + 0.04 * k * s * fade;
      o.sx = 1 + 0.07 * k * c * fade;
      return true;
    }
    default:
      return false;
  }
}

function backOut(t: number): number {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

const MO: MotionOut = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, flip: 1 };

/** 손님 하나의 화면. */
export class MonsterView {
  readonly id: MonsterId;
  readonly species: SpeciesId;
  readonly floats: boolean;
  /** 물체층 (y 정렬). 위치 = 발. */
  readonly node = new Container();
  /** 그림자층. */
  readonly shadow: Graphics;
  /** 효과층의 이모트. */
  readonly emote = new Sprite(Texture.EMPTY);
  private readonly body = new Container();
  private readonly art: ArtNode;

  /** 화면 위치 (발, 세계 좌표). */
  x = 0;
  y = 0;
  private vx = 0;
  private vy = 0;
  facing: -1 | 1 = -1;
  private flip = 1;
  private walkPhase = 0;
  private walkBlend = 0;
  private readonly seed: number;
  private pose: Pose | '' = '';
  private mood = 60;
  /** 머리 꼭대기 높이 (발에서 위로, 세계 px)와 몸 반폭. */
  readonly headH: number;
  readonly halfW: number;
  private readonly shadowRx: number;
  /** 지금 몸이 들린 높이 (점프·둥실, 위가 음수). */
  bodyDy = 0;

  private motion: Motion = 'none';
  private motionT = 0;
  private motionDur = 0;
  private motionK = 1;

  private emoteT = -1;
  private emoteDur = 0;
  private emoteTexSize = 1;

  seen = 0;
  leaving = false;
  dead = false;
  private fadeT = 0;
  private appear = 1;
  private placed = false;

  constructor(m: Monster, shadowCtx: GraphicsContext, appear: boolean) {
    this.id = m.id;
    this.species = m.species;
    this.floats = SPECIES[m.species].floats;
    this.seed = (m.id * 2.399) % (Math.PI * 2);
    const k = ART_SCALE.monster;
    this.art = new ArtNode({ k, anchor: monsterFoot(m.species), placeholder: { w: 440, h: 460, color: SPECIES_COLOR[m.species] } });
    const meta = artMeta('monsters', POSE_KEY[m.species].base);
    const footY = monsterFoot(m.species).y;
    this.headH = meta !== undefined ? (footY - meta.trim.y) * k : 460 * k;
    this.halfW = meta !== undefined ? (meta.trim.w * k) / 2 : 220 * k;
    this.shadowRx = Math.max(22, this.halfW * 0.72);
    this.shadow = new Graphics(shadowCtx);
    this.shadow.eventMode = 'none';
    this.body.addChild(this.art);
    this.node.addChild(this.body);
    this.node.eventMode = 'none';
    // 손으로 가려 내지만(culled), CullerPlugin이 있어도 같은 답이 나오게.
    this.node.cullable = true;
    this.node.cullableChildren = false;
    this.shadow.cullable = true;
    this.emote.cullable = true;
    this.emote.anchor.set(0.5, 1);
    this.emote.visible = false;
    this.emote.eventMode = 'none';
    this.appear = appear ? 0 : 1;
    this.setPose(m.pose);
    this.mood = m.mood;
    this.facing = m.facing;
    this.flip = m.facing === 1 ? -1 : 1;
  }

  private setPose(p: Pose): void {
    if (p === this.pose) return;
    this.pose = p;
    const keys = POSE_KEY[this.species];
    // 포즈 그림이 아직 없으면 기본 그림 (자리 표시보다 낫다).
    const usePose = hasArt('monsters', keys[p]) || !hasArt('monsters', keys.base);
    const key = usePose ? keys[p] : keys.base;
    // 포즈마다 자기 발끝을 기준점으로 (발이 그림자에서 뜨거나 가라앉지 않게).
    this.art.setArt('monsters', key, monsterFoot(this.species, usePose ? p : 'base'));
  }

  /** sim 상태를 따라간다 (매 프레임). */
  sync(m: Monster, dt: number): void {
    const tx = m.pos.x;
    const ty = m.pos.y;
    const ox = this.x;
    const oy = this.y;
    if (!this.placed) {
      this.x = tx;
      this.y = ty;
      this.placed = true;
    } else {
      const dx = tx - this.x;
      const dy = ty - this.y;
      if (dx * dx + dy * dy > SNAP_DIST * SNAP_DIST) {
        this.x = tx;
        this.y = ty;
      } else {
        const f = follow(FOLLOW_RATE, dt);
        this.x += dx * f;
        this.y += dy * f;
      }
    }
    const mx = this.x - ox;
    const my = this.y - oy;
    const moved = Math.sqrt(mx * mx + my * my);
    if (dt > 0 && moved < SNAP_DIST) {
      this.vx = mx / dt;
      this.vy = my / dt;
      const walking = moved / dt > 14 ? 1 : 0;
      this.walkBlend += (walking - this.walkBlend) * follow(8, dt);
      this.walkPhase += (moved / STRIDE) * Math.PI;
    }
    this.facing = m.facing;
    this.mood = m.mood;
    this.setPose(m.pose);
  }

  /** 결과 반응 (구경꾼은 작게). */
  react(r: Reaction, small: boolean, emoteTex: Texture | null): void {
    if (r.motion !== 'none') {
      this.motion = r.motion;
      this.motionT = 0;
      this.motionDur = Math.max(0.5, r.duration);
      this.motionK = clamp(r.intensity, 0.5, 2) * (small ? 0.7 : 1);
    }
    if (emoteTex !== null) this.showEmote(emoteTex, Math.max(1, r.duration));
  }

  /** 작은 통통 (응원·간식). */
  hop(k: number): void {
    this.motion = 'hop';
    this.motionT = 0;
    this.motionDur = 0.5;
    this.motionK = k;
  }

  showEmote(tex: Texture, duration: number): void {
    this.emote.texture = tex;
    this.emoteTexSize = Math.max(1, tex.width, tex.height);
    this.emoteT = 0;
    this.emoteDur = duration;
    this.emote.visible = true;
    this.emote.alpha = 1;
  }

  startLeaving(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.fadeT = 0;
  }

  /** 머리 위 한 점 (효과 위치). */
  headX(): number {
    return this.x;
  }
  headY(): number {
    return this.y + this.bodyDy - this.headH;
  }

  /** 넉넉한 누르기 상자. */
  hits(wx: number, wy: number): boolean {
    if (this.leaving) return false;
    const hw = Math.max(46, this.halfW + 16);
    const top = this.y - this.headH - (this.floats ? HOVER + 10 : 0) - 26;
    return wx >= this.x - hw && wx <= this.x + hw && wy >= top && wy <= this.y + 22;
  }

  /** 그리기 (매 프레임). time = 누적 초, emoteScale = 확대가 작을 때 이모트를 조금 키우는 배율. */
  update(dt: number, time: number, view: ViewRect, emoteScale: number): void {
    if (this.leaving) {
      this.fadeT += dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.fadeT >= LEAVE_FADE) this.dead = true;
    }
    if (this.appear < 1) this.appear = Math.min(1, this.appear + dt / APPEAR_SEC);

    // 바라보는 쪽 (그림은 왼쪽을 본다). 0을 지나며 살짝 납작해져 몸을 돌리는 것처럼.
    const flipTarget = this.facing === 1 ? -1 : 1;
    if (this.flip !== flipTarget) {
      const step = dt * 12;
      this.flip = this.flip < flipTarget ? Math.min(flipTarget, this.flip + step) : Math.max(flipTarget, this.flip - step);
    }

    let dx = 0;
    let dy = 0;
    let rot = 0;
    let sx = 1;
    let sy = 1;
    const wb = this.walkBlend;
    const droop = this.mood < 25 && wb > 0.05;
    if (this.floats) {
      dy -= HOVER + Math.sin(time * 2.3 + this.seed) * 5;
      rot += 0.07 * this.facing * wb;
    } else {
      const s = Math.sin(this.walkPhase);
      const bob = Math.abs(s);
      dy -= bob * (droop ? 3 : 5.5) * wb;
      rot += s * 0.065 * wb;
      sy *= 1 - (1 - bob) * 0.04 * wb;
    }
    if (droop) {
      // 기운 없는 걸음: 살짝 납작하고 앞으로 숙인다.
      sy *= 0.95;
      sx *= 1.03;
      rot += 0.05 * this.facing * wb;
    }
    // 서 있을 때 숨쉬기.
    const breathe = Math.sin(time * 2.2 + this.seed) * 0.014 * (1 - wb);
    sy *= 1 + breathe;
    sx *= 1 - breathe * 0.5;

    let flipMul = 1;
    if (this.motion !== 'none') {
      this.motionT += dt;
      if (motionAt(this.motion, this.motionT, this.motionDur, this.motionK, this.facing, MO)) {
        dx += MO.dx;
        dy += MO.dy;
        rot += MO.rot;
        sx *= MO.sx;
        sy *= MO.sy;
        flipMul = MO.flip;
      } else {
        this.motion = 'none';
      }
    }

    // 나타날 때 톡, 떠날 때 작아지며 흐려짐.
    let a = 1;
    let pop = 1;
    if (this.appear < 1) {
      a = this.appear;
      pop = 0.6 + 0.4 * backOut(this.appear);
    }
    if (this.leaving) {
      const u = Math.min(1, this.fadeT / LEAVE_FADE);
      a *= 1 - u;
      pop *= 1 - 0.25 * u;
    }

    this.bodyDy = dy;
    this.node.position.set(this.x, this.y);
    const z = Math.round(this.y);
    if (this.node.zIndex !== z) this.node.zIndex = z;
    this.body.position.set(dx, dy);
    this.body.rotation = rot;
    this.body.scale.set(this.flip * flipMul * sx * pop, sy * pop);
    this.node.alpha = a;

    // 그림자: 몸이 높이 뜰수록 작고 옅게.
    const lift = this.floats ? -dy - HOVER : -dy;
    const ss = clamp(1 - lift / 200, 0.55, 1.05) * pop;
    this.shadow.position.set(this.x, this.y);
    this.shadow.scale.set(this.shadowRx * ss, this.shadowRx * 0.32 * ss);
    this.shadow.alpha = a * clamp(1 - lift / 260, 0.4, 1);

    // 이모트: 톡 튀어나와 떠 있다가 사라진다.
    if (this.emoteT >= 0) {
      this.emoteT += dt;
      const e = this.emoteT;
      if (e >= this.emoteDur || this.leaving) {
        this.emoteT = -1;
        this.emote.visible = false;
      } else {
        const p = e < 0.28 ? backOut(e / 0.28) : 1;
        const s = (EMOTE_SIZE / this.emoteTexSize) * p * emoteScale;
        this.emote.scale.set(s);
        this.emote.position.set(this.x + 6, this.y + dy - this.headH - 10 + Math.sin(e * 3.2) * 3);
        this.emote.alpha = e > this.emoteDur - 0.35 ? (this.emoteDur - e) / 0.35 : 1;
      }
    }

    // 화면 밖이면 그리지 않는다.
    const m = this.halfW + 40;
    const culled = this.x + m < view.x0 || this.x - m > view.x1 || this.y + 40 < view.y0 || this.y - this.headH - 140 > view.y1;
    this.node.culled = culled;
    this.shadow.culled = culled;
    this.emote.culled = culled;
  }

  destroy(): void {
    this.node.destroy({ children: true });
    this.shadow.destroy();
    this.emote.destroy();
  }
}

export interface MonsterLayers {
  readonly objects: Container;
  readonly shadows: Container;
  readonly effects: Container;
}

/** 모든 손님 화면. sim.state.monsters와 맞춘다 (이벤트를 놓쳐도 다음 프레임에 맞는다). */
export class MonstersView {
  private readonly sim: SimApi;
  private readonly layers: MonsterLayers;
  private readonly fx: FxLayer;
  private readonly views: MonsterView[] = [];
  private readonly byId = new Map<MonsterId, MonsterView>();
  private readonly flatShadow: GraphicsContext;
  private readonly softShadow: GraphicsContext;
  private frame = 0;

  constructor(sim: SimApi, layers: MonsterLayers, fx: FxLayer) {
    this.sim = sim;
    this.layers = layers;
    this.fx = fx;
    // 그림자는 코드로 (그림에 넣지 않는다). 모두 같은 도형을 나눠 쓴다.
    this.flatShadow = new GraphicsContext().ellipse(0, 0, 1, 1).fill({ color: 0x000000, alpha: 0.12 });
    this.softShadow = new GraphicsContext()
      .ellipse(0, 0, 1.15, 1.15)
      .fill({ color: 0x000000, alpha: 0.035 })
      .ellipse(0, 0, 0.85, 0.85)
      .fill({ color: 0x000000, alpha: 0.04 })
      .ellipse(0, 0, 0.55, 0.55)
      .fill({ color: 0x000000, alpha: 0.05 });
    for (const m of sim.state.monsters) this.ensure(m, false);
  }

  get(id: MonsterId): MonsterView | undefined {
    return this.byId.get(id);
  }

  private ensure(m: Monster, appear: boolean): MonsterView {
    let v = this.byId.get(m.id);
    if (v === undefined) {
      v = new MonsterView(m, SPECIES[m.species].floats ? this.softShadow : this.flatShadow, appear);
      this.byId.set(m.id, v);
      this.views.push(v);
      this.layers.shadows.addChild(v.shadow);
      this.layers.objects.addChild(v.node);
      this.layers.effects.addChild(v.emote);
      v.sync(m, 0);
    }
    return v;
  }

  // ── sim 이벤트 ──

  spawned(id: MonsterId): void {
    const m = this.sim.monster(id);
    if (m === undefined) return;
    const v = this.ensure(m, true);
    this.fx.puff(v.x, v.y, 5, 50);
  }

  left(id: MonsterId): void {
    this.byId.get(id)?.startLeaving();
  }

  react(id: MonsterId, r: Reaction, spectate: boolean): void {
    const v = this.byId.get(id);
    if (v === undefined) return;
    v.react(r, spectate, r.emote === null ? null : this.fx.tex.emote(r.emote));
    if (spectate) return;
    const hx = v.headX();
    const hy = v.headY();
    if (r.pose === 'sad' || r.emote === 'tear') this.fx.tears(hx, hy + v.headH * 0.35, v.facing, Math.round(2 + 2 * r.intensity));
    if (r.motion === 'bigHop' || r.emote === 'sparkle') this.fx.sparkles(hx, hy + v.headH * 0.4, Math.round(4 + 3 * r.intensity), v.halfW + 30);
  }

  cheered(id: MonsterId, by: 'tap' | GoodId): void {
    const v = this.byId.get(id);
    if (v === undefined) return;
    v.hop(by === 'tap' ? 0.7 : 1);
    if (by === 'tap') {
      v.showEmote(this.fx.tex.emote('heart'), 1.6);
      this.fx.hearts(v.headX(), v.headY(), 3);
    } else {
      // 간식이면 그 간식 그림을 머리 위에 (없으면 하트).
      v.showEmote(artTexture('items', by) ?? this.fx.tex.emote('heart'), 1.8);
      this.fx.sparkles(v.headX(), v.headY() + v.headH * 0.3, 6, v.halfW + 24);
      this.fx.hearts(v.headX(), v.headY(), 2);
    }
  }

  emoteTexture(kind: EmoteKind): Texture {
    return this.fx.tex.emote(kind);
  }

  // ── 매 프레임 ──

  update(dt: number, time: number, view: ViewRect, zoom: number): void {
    const frame = ++this.frame;
    const list = this.sim.state.monsters;
    for (let i = 0; i < list.length; i++) {
      const m = list[i] as Monster;
      const v = this.byId.get(m.id) ?? this.ensure(m, true);
      v.seen = frame;
      if (!v.leaving) v.sync(m, dt);
    }
    const emoteScale = clamp(0.7 / zoom, 1, 1.6);
    for (let i = this.views.length - 1; i >= 0; i--) {
      const v = this.views[i] as MonsterView;
      if (v.seen !== frame) v.startLeaving();
      v.update(dt, time, view, emoteScale);
      if (v.dead) {
        this.byId.delete(v.id);
        const last = this.views.pop() as MonsterView;
        if (last !== v) this.views[i] = last;
        v.destroy();
      }
    }
  }

  /** 누른 점의 손님 (겹치면 앞쪽 = y가 큰 쪽). */
  hitTest(wx: number, wy: number): MonsterId | null {
    let best: MonsterView | null = null;
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i] as MonsterView;
      if (v.hits(wx, wy) && (best === null || v.y > best.y)) best = v;
    }
    return best === null ? null : best.id;
  }

  destroy(): void {
    for (const v of this.views) v.destroy();
    this.views.length = 0;
    this.byId.clear();
    this.flatShadow.destroy();
    this.softShadow.destroy();
  }
}
