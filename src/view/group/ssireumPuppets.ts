// 손님 몸 맡기기 도구 (씨름·줄다리기·보물찾기 지도 화면이 같이 쓴다. 이름만 씨름 것: 맡은 파일 접두어).
//   - PuppetSet: 매 프레임 take(id)로 몸을 받아 값을 채우고, 끝에 flush(dt)로 MonstersView에 넘긴다.
//     처음 맡는 몸은 RAMP_IN초 동안 스며들고, 더 맡지 않는 몸(판이 끝나 쉼, 손님이 자리를 뜸)은 마지막 모습에서
//     RAMP_OUT초 동안 제자리로 돌아온다 (벌러덩 → 툭툭 털고 일어나기). 몸 객체는 손님마다 하나를 고쳐 쓴다.
//   - LieShadows: 누운 몸 아래 길쭉한 그림자 (손님 그림자는 발밑에만 있다).
//   - 작은 도구: 시각을 지났나(crossed), 자리에 그대로 있나(seated), 0~1 자르기.

import { Container, Graphics, GraphicsContext } from 'pixi.js';
import type { BoothId } from '../../data/defs.ts';
import type { GroupKey, Monster, MonsterId, Pose } from '../../sim/types.ts';
import type { MonstersView } from '../monsterView.ts';

/** 맡긴 몸 한 프레임 (MonsterPuppet과 같은 칸, 고쳐 쓴다). */
export interface Body {
  dx: number;
  dy: number;
  lift: number;
  rot: number;
  sx: number;
  sy: number;
  pose: Pose | undefined;
  facing: -1 | 1 | undefined;
  still: boolean;
  alpha: number;
}

const RAMP_IN = 0.22;
const RAMP_OUT = 0.5;

interface Slot {
  id: MonsterId;
  live: boolean;
  seen: boolean;
  /** 0~1: 맡은 정도. */
  w: number;
  readonly body: Body;
  readonly out: Body;
}

const blank = (): Body => ({ dx: 0, dy: 0, lift: 0, rot: 0, sx: 1, sy: 1, pose: undefined, facing: undefined, still: true, alpha: 1 });

function reset(b: Body): Body {
  b.dx = 0;
  b.dy = 0;
  b.lift = 0;
  b.rot = 0;
  b.sx = 1;
  b.sy = 1;
  b.pose = undefined;
  b.facing = undefined;
  b.still = true;
  b.alpha = 1;
  return b;
}

/** 손님 몸 맡기기 (스며들기·돌아오기 포함). */
export class PuppetSet {
  private readonly monsters: MonstersView;
  private readonly slots: Slot[] = [];

  constructor(monsters: MonstersView) {
    this.monsters = monsters;
  }

  /** 이 프레임에 손님 id의 몸 (기본값으로 비워 준다: 몸을 통째로 맡음 still). snap = 스며들지 않고 바로. */
  take(id: MonsterId, snap = false): Body {
    let free: Slot | undefined;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i] as Slot;
      if (s.live && s.id === id) {
        s.seen = true;
        if (snap) s.w = 1;
        return reset(s.body);
      }
      if (!s.live && free === undefined) free = s;
    }
    if (free === undefined) {
      free = { id, live: false, seen: false, w: 0, body: blank(), out: blank() };
      this.slots.push(free);
    }
    free.id = id;
    free.live = true;
    free.seen = true;
    free.w = snap ? 1 : 0;
    return reset(free.body);
  }

  /** 지금 맡은(또는 돌아오는 중인) 손님인가. */
  holds(id: MonsterId): boolean {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i] as Slot;
      if (s.live && s.id === id) return true;
    }
    return false;
  }

  /** 프레임 끝: 맡긴 몸을 넘긴다. 이번에 take하지 않은 몸은 마지막 모습에서 천천히 돌아온다. */
  flush(dt: number): void {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i] as Slot;
      if (!s.live) continue;
      s.w = s.seen ? Math.min(1, s.w + dt / RAMP_IN) : s.w - dt / RAMP_OUT;
      s.seen = false;
      if (s.w <= 0) {
        s.live = false;
        continue;
      }
      // 부드럽게 (0·1 근처에서 천천히).
      const w = s.w * s.w * (3 - 2 * s.w);
      const b = s.body;
      const o = s.out;
      o.dx = b.dx * w;
      o.dy = b.dy * w;
      o.lift = b.lift * w;
      o.rot = b.rot * w;
      o.sx = 1 + (b.sx - 1) * w;
      o.sy = 1 + (b.sy - 1) * w;
      o.alpha = 1 + (b.alpha - 1) * w;
      o.pose = w > 0.45 ? b.pose : undefined;
      o.facing = w > 0.45 ? b.facing : undefined;
      o.still = b.still && w > 0.1;
      this.monsters.puppet(s.id, o);
    }
  }

  /** 모두 바로 놓는다 (숨길 때). */
  clear(): void {
    for (const s of this.slots) s.live = false;
  }
}

/** 누운 몸 아래 길쭉한 그림자 (그림자층, 같은 도형을 나눠 쓴다). */
export class LieShadows {
  private readonly ctx = new GraphicsContext().ellipse(0, 0, 1, 1).fill({ color: 0x000000, alpha: 0.12 });
  private readonly nodes: Graphics[] = [];
  private used = 0;
  readonly node = new Container();

  /** 프레임 처음. */
  begin(): void {
    this.used = 0;
  }

  /** 가운데 (x, y), 반지름 rx·ry, 진하기 a (0~1). */
  add(x: number, y: number, rx: number, ry: number, a: number): void {
    let g = this.nodes[this.used];
    if (g === undefined) {
      g = new Graphics(this.ctx);
      g.eventMode = 'none';
      this.nodes.push(g);
      this.node.addChild(g);
    }
    this.used++;
    g.visible = true;
    g.position.set(x, y);
    g.scale.set(Math.max(1, rx), Math.max(1, ry));
    g.alpha = a;
  }

  /** 프레임 끝: 이번에 안 쓴 그림자는 숨긴다. */
  end(): void {
    for (let i = this.used; i < this.nodes.length; i++) (this.nodes[i] as Graphics).visible = false;
  }

  /** 그릇(node)이 이미 지워졌어도 된다 (GroupMapBase.own으로 붙였으면 바탕이 지운다). */
  destroy(): void {
    if (!this.node.destroyed) this.node.destroy({ children: true });
    this.ctx.destroy();
  }
}

/** 키프레임이 없을 때 (trackAt → 0, 새 배열을 만들지 않게). */
export const NO_KEYS: readonly GroupKey[] = [];

/** prev < at ≤ now (이번 프레임에 그 시각을 지났나). */
export function crossed(prev: number, now: number, at: number): boolean {
  return prev < at && at <= now;
}

/** 손님이 그 부스 자리에 그대로 서 있나 (걸어가기 시작하면 몸을 놓는다). */
export function seated(m: Monster | undefined, booth: BoothId, seat: number): m is Monster {
  return m !== undefined && m.booth === booth && m.seat === seat && m.path.length === 0 && (m.phase === 'playing' || m.phase === 'reacting');
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 0~1 → 0~1 부드럽게. */
export function smooth(v: number): number {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}
