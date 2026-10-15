// 슬롯 부스: 기계 그림의 빈 창 셋에 마스크를 씌우고 그 안에서 심볼 띠(릴)가 세로로 돈다.
// 릴 위치 p(심볼 단위)는 시간의 함수: 빨리 돌다 1·2·3 순서로 멈춰 결과 심볼이 가운데 오게 계산한다.
// 아깝다(nearMiss): 셋째 릴이 천천히 기어 오다 맞는 심볼 한 칸 앞에서 멈춘다 (맞는 심볼이 창 위에 살짝 보인다).

import { Container, Graphics, Text } from 'pixi.js';
import { type OutcomeTier, SLOT_SYMBOLS, type SlotSymbol } from '../../data/defs.ts';
import { type Ease, ease } from '../../core/tween.ts';
import { artSprite, hasArt } from '../art.ts';
import { FONT, INK } from './fx.ts';
import { SLOT_ART } from './layout.ts';
import { type Play, type Rig, type RigCtx, SETTLE } from './rig.ts';

const SYM_FALLBACK: Record<SlotSymbol, { name: string; color: number }> = {
  sym_apple: { name: '사과', color: 0xf0644b },
  sym_mushroom: { name: '버섯', color: 0xd9825b },
  sym_star: { name: '별', color: 0xffc83d },
  sym_gem: { name: '보석', color: 0x6bc4e8 },
  sym_acorn: { name: '도토리', color: 0xb07a4f },
  sym_bell: { name: '종', color: 0xf5b82e },
};

function symbolNode(sym: SlotSymbol, size: number): Container {
  if (hasArt('icons', sym)) return artSprite('icons', sym, { k: size / 730, anchor: 'center' });
  const f = SYM_FALLBACK[sym];
  const c = new Container();
  c.addChild(new Graphics().circle(0, 0, size * 0.42).fill({ color: f.color }).stroke({ color: INK, width: Math.max(1.5, size * 0.05) }));
  const t = new Text({ text: f.name, style: { fontFamily: FONT, fontSize: size * (f.name.length > 2 ? 0.24 : 0.3), fill: 0xffffff, stroke: { color: INK, width: Math.max(2, size * 0.05) } } });
  t.anchor.set(0.5);
  c.addChild(t);
  return c;
}

const N = SLOT_SYMBOLS.length;
/** 빨리 돌 때의 속도 (심볼/초). */
const SPIN_SPEED = 13;
/** 처음 빨라지는 시간 (초). */
const SPIN_UP = 0.25;

const wrap = (d: number): number => ((((d + N / 2) % N) + N) % N) - N / 2;

interface ReelPlan {
  p0: number;
  v: number;
  t1: number;
  T: number;
  stop: number;
  P: number;
  ease: Ease;
  /** 멈춘 뒤 맞는 심볼 쪽으로 움찔 (아깝다). */
  nudge: boolean;
}

class Reel {
  readonly root = new Container();
  private readonly strip = new Container();
  private readonly nodes = new Map<SlotSymbol, Container>();
  order: SlotSymbol[];
  p: number;
  plan: ReelPlan | null = null;
  private readonly cell: number;
  private readonly size: number;

  constructor(w: number, h: number) {
    this.order = shuffled();
    this.p = Math.floor(Math.random() * N);
    this.cell = h * 0.6;
    this.size = Math.min(w * 0.8, this.cell * 0.95);
    // 창 속 바탕 (그림의 창 색) → 띠 → 위아래 그늘 (둥근 통처럼).
    const bg = new Graphics().rect(-w / 2, -h / 2, w, h).fill({ color: 0xfaf2e4 });
    const shade = new Graphics();
    for (let i = 0; i < 4; i++) {
      const bh = h * 0.07;
      shade.rect(-w / 2, -h / 2 + i * bh, w, bh).fill({ color: INK, alpha: 0.13 - i * 0.03 });
      shade.rect(-w / 2, h / 2 - (i + 1) * bh, w, bh).fill({ color: INK, alpha: 0.13 - i * 0.03 });
    }
    const mask = new Graphics().roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.1).fill({ color: 0xffffff });
    for (const s of SLOT_SYMBOLS) {
      const n = symbolNode(s, this.size);
      this.nodes.set(s, n);
      this.strip.addChild(n);
    }
    const inner = new Container();
    inner.addChild(bg, this.strip, shade);
    inner.mask = mask;
    this.root.addChild(inner, mask);
    this.draw(this.p, 0);
  }

  /** p 위치로 그린다. speed가 크면 세로로 늘여 흐릿하게. */
  draw(p: number, speed: number): void {
    this.p = p;
    const blur = Math.min(0.45, Math.abs(speed) / 30);
    this.order.forEach((s, k) => {
      const n = this.nodes.get(s);
      if (n === undefined) return;
      const d = wrap(p - k);
      n.visible = Math.abs(d) < 1.7;
      n.y = d * this.cell;
      n.scale.set(1 - blur * 0.15, 1 + blur);
      n.alpha = 1 - blur * 0.5;
    });
  }

  /** 가운데 심볼. */
  center(): SlotSymbol {
    const k = ((Math.round(this.p) % N) + N) % N;
    return this.order[k] ?? SLOT_SYMBOLS[0];
  }

  posAt(t: number): number {
    const pl = this.plan;
    if (pl === null) return this.p;
    if (t <= 0) return pl.p0;
    if (t < SPIN_UP) return pl.p0 + (pl.v * t * t) / (2 * SPIN_UP);
    const pr = pl.p0 + (pl.v * SPIN_UP) / 2;
    if (t < pl.t1) return pr + pl.v * (t - SPIN_UP);
    const pA = pr + pl.v * (pl.t1 - SPIN_UP);
    if (t < pl.stop) return pA + (pl.P - pA) * pl.ease((t - pl.t1) / pl.T);
    if (pl.nudge && t < pl.stop + 0.4) return pl.P + 0.2 * Math.sin((Math.PI * (t - pl.stop)) / 0.4);
    return pl.P;
  }

  /**
   * 멈출 계획: target 심볼이 stop초에 가운데 오게. 속도가 이어지도록 v를 맞춘다.
   * slope = 멈출 때 쓰는 ease의 처음 기울기 (outBack ≈ 4.7, outCubic = 3).
   */
  planStop(target: SlotSymbol, stop: number, T: number, e: Ease, slope: number, nudge: boolean): void {
    const p0 = this.p;
    const F = this.order.indexOf(target);
    const t1 = Math.max(SPIN_UP, stop - T);
    const TT = stop - t1;
    const den = SPIN_UP / 2 + (t1 - SPIN_UP) + TT / slope;
    const base = (((F - p0) % N) + N) % N;
    const n = Math.max(1, Math.round((SPIN_SPEED * den - base) / N));
    const P = p0 + base + n * N;
    this.plan = { p0, v: (P - p0) / den, t1, T: TT, stop, P, ease: e, nudge };
  }
}

function shuffled(): SlotSymbol[] {
  const a = [...SLOT_SYMBOLS];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as SlotSymbol, a[i] as SlotSymbol];
  }
  return a;
}

export class SlotRig implements Rig {
  readonly root = new Container();
  private readonly machine = new Container();
  private readonly reels: Reel[] = [];
  private readonly flash: Graphics;
  private readonly ctx: RigCtx;
  private readonly k: number;
  private bounce = 0;

  constructor(ctx: RigCtx) {
    this.ctx = ctx;
    const L = ctx.L;
    this.root.zIndex = 20;
    this.k = (L.sw * 0.48) / SLOT_ART.bodyW;
    const k = this.k;
    const art = artSprite('objects', 'slot_machine', { k, anchor: SLOT_ART.anchor, placeholder: { w: 630, h: 754, color: 0xe06a4e } });
    this.machine.addChild(art);
    this.flash = new Graphics();
    for (const win of SLOT_ART.windows) {
      const w = win.w * k;
      const h = win.h * k;
      const reel = new Reel(w, h);
      reel.root.position.set((win.x + win.w / 2 - SLOT_ART.anchor.x) * k, (win.y + win.h / 2 - SLOT_ART.anchor.y) * k);
      this.machine.addChild(reel.root);
      this.reels.push(reel);
      this.flash.roundRect(reel.root.x - w / 2, reel.root.y - h / 2, w, h, Math.min(w, h) * 0.1).fill({ color: 0xfff3b0 });
    }
    this.flash.alpha = 0;
    this.machine.addChild(this.flash);
    this.machine.position.set(L.rig.x, L.rig.y);
    this.root.addChild(this.machine);
  }

  begin(play: Play): void {
    const d = play.round.outcome.detail;
    if (d.kind !== 'slot') return;
    const D = play.D;
    const tier = play.round.outcome.tier;
    const near = tier === 'nearMiss';
    // 아깝다: 셋째 릴에서 결과 심볼 바로 다음(위)에 맞는 심볼이 오게 띠를 다시 짠다.
    const third = this.reels[2];
    if (near && third !== undefined) third.order = nearMissOrder(third.center(), Math.round(third.p), d.reels[2], d.reels[0]);
    const stops = [0.42 * D, 0.58 * D, near ? 0.8 * D : 0.74 * D];
    this.reels.forEach((r, i) => {
      const target = d.reels[i as 0 | 1 | 2];
      const stop = stops[i] ?? D * 0.8;
      if (near && i === 2) r.planStop(target, stop, Math.min(1.1, 0.3 * D), ease.outCubic, 3, true);
      else r.planStop(target, stop, 0.32, ease.outBack, 4.7, false);
    });
    this.flash.alpha = 0;
  }

  render(play: Play): void {
    const t = Math.min(play.t, play.D * SETTLE);
    for (const r of this.reels) {
      const p = r.posAt(t);
      const v = (p - r.posAt(t - 1 / 60)) * 60;
      r.draw(p, t >= play.D * SETTLE ? 0 : v);
    }
    // 레버를 당긴 듯 처음에 기계가 '덜컥'.
    const kick = play.t < 0.25 ? Math.sin((play.t / 0.25) * Math.PI) : 0;
    this.machine.scale.set(1 + kick * 0.03, 1 - kick * 0.05);
    // 손님은 두 손 모아 들썩 (마지막 릴이 돌 때 더).
    const a = this.ctx.actor(play.seat);
    if (a !== null) {
      const tense = play.t > 0.55 * play.D && play.t < 0.85 * play.D ? 1 : 0.4;
      a.rig.sy = 1 + Math.sin(play.t * 18) * 0.012 * tense;
      a.rig.dx = -a.bodyH * 0.03 * tense;
    }
  }

  finish(play: Play): void {
    const d = play.round.outcome.detail;
    for (const r of this.reels) {
      r.plan = null;
    }
    if (d.kind === 'slot') {
      this.reels.forEach((r, i) => {
        const target = d.reels[i as 0 | 1 | 2];
        const k = r.order.indexOf(target);
        r.draw(Math.round(r.p) + wrap(k - Math.round(r.p)), 0);
      });
    }
    this.machine.scale.set(1);
  }

  idle(dt: number): void {
    if (this.bounce > 0) {
      this.bounce = Math.max(0, this.bounce - dt);
      const u = this.bounce;
      const s = Math.abs(Math.sin(u * Math.PI * 4)) * Math.min(1, u);
      this.machine.scale.set(1 + s * 0.06, 1 - s * 0.08);
    } else this.machine.scale.set(1);
    if (this.flash.alpha > 0) this.flash.alpha = Math.max(0, this.flash.alpha - dt * 0.8);
  }

  celebrate(tier: OutcomeTier): void {
    if (tier === 'jackpot') {
      this.bounce = 1.6;
      this.flash.tint = 0xffd54a;
      this.flash.alpha = 0.75;
    } else if (tier === 'win') {
      this.bounce = 0.5;
      this.flash.tint = 0xffffff;
      this.flash.alpha = 0.55;
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

/** 지금 가운데 심볼(cur, 띠 위치 pos)은 그 칸에 그대로 두고, result 다음 칸(위)에 match가 오는 띠. */
function nearMissOrder(cur: SlotSymbol, pos: number, result: SlotSymbol, match: SlotSymbol): SlotSymbol[] {
  const order: (SlotSymbol | null)[] = new Array<SlotSymbol | null>(N).fill(null);
  const c = ((pos % N) + N) % N;
  order[c] = cur;
  const place = (s: SlotSymbol, at: number): boolean => {
    const i = ((at % N) + N) % N;
    if (order[i] !== null && order[i] !== s) return false;
    order[i] = s;
    return true;
  };
  if (cur === result) place(match, c + 1);
  else if (cur === match) place(result, c - 1);
  else {
    place(result, c + 2);
    place(match, c + 3);
  }
  const rest = shuffled().filter((s) => !order.includes(s));
  for (let i = 0; i < N; i++) if (order[i] === null) order[i] = rest.shift() ?? SLOT_SYMBOLS[0];
  return order as SlotSymbol[];
}
