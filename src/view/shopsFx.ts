// 가게 연출이 같이 쓰는 작은 도구 (다섯째 묶음, DESIGN 3.8): shopsFood.ts·truck.ts·rides.ts·rest.ts.
//  - 물건 날리기 (Flights: 가게 주인 → 손님 손, 식당 접시 → 테이블, 꽃다발 → 친구 손, 점괘 종이·사진 → 손님 손).
//    fx.ts itemArc와 달리 닿을 곳을 매 프레임 다시 읽고 (걷는 손님 손을 따라간다) 닿으면 부른다 (손에 든 것·장신구를 그때 보이게).
//  - 떠올라 흐려지는 작은 그림 (Bits: 트럭 음표·졸음 표시, 여관 졸음, 온천 김, 점집 반짝, 회전목마 음표). 미리 만든 Sprite를 돌려 쓴다.
// 화면 연출용 무작위라 Math.random을 쓴다.

import { Container, Sprite, type Texture } from 'pixi.js';
import type { Pt } from '../data/map.ts';

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
function backOut(t: number): number {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

// ── 물건 날리기 ──

/** 날아가는 물건 하나의 설정. */
export interface FlyOpts {
  /** 출발점 (세계 좌표). */
  readonly from: Pt;
  /** 닿을 곳을 out에 쓴다 (매 프레임, false면 마지막 자리로). */
  readonly to: (out: { x: number; y: number }) => boolean;
  /** 긴 변 (세계 px): 출발 → 도착. */
  readonly size: number;
  readonly sizeEnd?: number;
  readonly dur: number;
  /** 포물선 높이 (세계 px). */
  readonly arc: number;
  readonly delay?: number;
  /** 동전처럼 빙글 (좌우로 납작). */
  readonly spin?: boolean;
  /** 그림 안 기준점 비율 (없으면 가운데). */
  readonly ax?: number;
  readonly ay?: number;
  /** 닿았을 때 (세계 좌표). 그림이 없어도 부른다. */
  readonly onLand?: (x: number, y: number) => void;
}

interface Flight {
  readonly sp: Sprite | null;
  readonly o: FlyOpts;
  readonly from: Pt;
  t: number;
  tx: number;
  ty: number;
  readonly texSize: number;
}

/** 물건 날리기 (효과층 위): from에서 to로 포물선, 떠날 때 톡 커지고 닿으면 onLand. */
export class Flights {
  readonly node = new Container();
  private readonly list: Flight[] = [];
  private readonly tmp = { x: 0, y: 0 };

  constructor() {
    this.node.eventMode = 'none';
  }

  /** tex를 from에서 to로 날린다 (tex가 없으면 시간만 지나 onLand). */
  fly(tex: Texture | undefined, o: FlyOpts): void {
    let sp: Sprite | null = null;
    if (tex !== undefined) {
      sp = new Sprite(tex);
      sp.anchor.set(o.ax ?? 0.5, o.ay ?? 0.5);
      sp.visible = false;
      sp.eventMode = 'none';
      this.node.addChild(sp);
    }
    const ok = o.to(this.tmp);
    const from = { x: o.from.x, y: o.from.y };
    this.list.push({ sp, o, from, t: -(o.delay ?? 0), tx: ok ? this.tmp.x : from.x, ty: ok ? this.tmp.y : from.y, texSize: tex === undefined ? 1 : Math.max(1, tex.width, tex.height) });
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i] as Flight;
      f.t += dt;
      const o = f.o;
      if (f.t < 0) continue;
      if (o.to(this.tmp)) {
        f.tx = this.tmp.x;
        f.ty = this.tmp.y;
      }
      const u = Math.min(1, f.t / o.dur);
      const sp = f.sp;
      if (sp !== null) {
        // 처음에 조금 빠르게, 닿을 때 살짝 느리게.
        const e = u * (2 - u) * 0.45 + u * 0.55;
        const x = f.from.x + (f.tx - f.from.x) * e;
        const y = f.from.y + (f.ty - f.from.y) * e - Math.sin(Math.PI * u) * o.arc;
        const size = o.size + ((o.sizeEnd ?? o.size) - o.size) * smooth(u);
        // 떠날 때 톡 커진다.
        const pop = u < 0.15 ? 0.6 + 0.4 * smooth(u / 0.15) : 1;
        const s = (size / f.texSize) * pop;
        sp.visible = true;
        sp.position.set(x, y);
        sp.scale.set(o.spin === true ? s * Math.cos(f.t * 12) : s, s);
        sp.rotation = o.spin === true ? 0 : Math.sin(u * Math.PI * 2) * 0.2;
      }
      if (u >= 1) {
        sp?.destroy();
        this.list.splice(i, 1);
        o.onLand?.(f.tx, f.ty);
      }
    }
  }

  destroy(): void {
    for (const f of this.list) f.sp?.destroy();
    this.list.length = 0;
    this.node.destroy({ children: true });
  }
}

// ── 떠오르는 작은 그림 ──

/** 떠오르는 그림 하나: vx·vy = 세계 px/초, size0 → size1 = 긴 변, life = 초, alpha = 처음 투명도, tint, sway = 좌우 흔들 px, spin = 기울기 흔들 (rad). */
export interface BitOpts {
  readonly vx?: number;
  readonly vy: number;
  readonly size0: number;
  readonly size1?: number;
  readonly life: number;
  readonly alpha?: number;
  readonly tint?: number;
  readonly sway?: number;
  readonly spin?: number;
}

interface Bit {
  readonly sp: Sprite;
  t: number;
  max: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  s0: number;
  s1: number;
  a0: number;
  sway: number;
  spin: number;
  phase: number;
  texSize: number;
}

/** 떠올라 흐려지는 작은 그림. cap개까지 Sprite를 돌려 쓴다 (다 쓰고 있으면 새 것은 건너뛴다). */
export class Bits {
  readonly node = new Container();
  private readonly list: Bit[] = [];
  private readonly cap: number;
  /** 지도를 넓게 볼 때 키우는 배율 (update가 받는다). */
  private scale = 1;

  constructor(cap = 40) {
    this.cap = cap;
    this.node.eventMode = 'none';
  }

  /** tex를 (x, y)에서 띄운다. */
  add(tex: Texture, x: number, y: number, o: BitOpts): void {
    let b = this.list.find((it) => it.t >= it.max);
    if (b === undefined) {
      if (this.list.length >= this.cap) return;
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      sp.eventMode = 'none';
      this.node.addChild(sp);
      b = { sp, t: 0, max: 0, x: 0, y: 0, vx: 0, vy: 0, s0: 1, s1: 1, a0: 1, sway: 0, spin: 0, phase: 0, texSize: 1 };
      this.list.push(b);
    }
    b.sp.texture = tex;
    b.sp.tint = o.tint ?? 0xffffff;
    b.sp.visible = true;
    b.t = 0;
    b.max = o.life;
    b.x = x;
    b.y = y;
    b.vx = o.vx ?? 0;
    b.vy = o.vy;
    b.s0 = o.size0;
    b.s1 = o.size1 ?? o.size0;
    b.a0 = o.alpha ?? 1;
    b.sway = o.sway ?? 5;
    b.spin = o.spin ?? 0.18;
    b.phase = Math.random() * 6;
    b.texSize = Math.max(1, tex.width, tex.height);
    this.place(b);
  }

  private place(b: Bit): void {
    const u = b.t / b.max;
    const pop = u < 0.15 ? backOut(u / 0.15) : 1;
    const size = b.s0 + (b.s1 - b.s0) * smooth(u);
    b.sp.position.set(b.x + Math.sin(b.t * 3 + b.phase) * b.sway, b.y);
    b.sp.scale.set((size / b.texSize) * pop * this.scale);
    b.sp.rotation = Math.sin(b.t * 2.4 + b.phase) * b.spin;
    b.sp.alpha = b.a0 * (u < 0.55 ? 1 : Math.max(0, 1 - (u - 0.55) / 0.45));
  }

  /** scale = 지도를 넓게 볼 때 키우는 배율 (트럭 음표처럼 멀리서도 보여야 하는 것). */
  update(dt: number, scale = 1): void {
    this.scale = scale;
    for (const b of this.list) {
      if (b.t >= b.max) continue;
      b.t += dt;
      if (b.t >= b.max) {
        b.sp.visible = false;
        continue;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      this.place(b);
    }
  }

  destroy(): void {
    this.list.length = 0;
    this.node.destroy({ children: true });
  }
}
