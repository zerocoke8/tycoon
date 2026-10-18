// 인형 뽑기 부스: 기계 그림(objects/claw_machine)의 빈 창 안에 상품 인형(objects/plush_<종>)을 작게 쌓고(창 모양으로 마스크),
// 창 위 레일의 집게(objects/claw + 코드로 그린 줄)가 detail.x로 가서 내려가 집는다. 창 왼쪽 아래가 출구 통(코드로 그림).
//   win/double: 들어 올려 출구로 옮기고 벌리면 인형이 통으로 떨어져 기계 아래 문으로 톡 튀어나온다 (double은 둘).
//   slip: 출구로 가다 slipAt(구멍까지 간 비율)에서 인형이 미끄러져 출구 바로 앞 더미 위로 떨어진다 ('아깝다').
//   miss: 인형 옆을 집어 허공에서 닫힌다 (인형만 들썩).
// 집게는 진자: 레일 위 수레가 가속하면 뒤로 흔들리고 멈추면 흔들리다 선다 (같은 t면 같은 모습이 되게 0부터 다시 계산).

import { Container, Graphics } from 'pixi.js';
import { type OutcomeTier, SPECIES, SPECIES_IDS, type SpeciesId } from '../../data/defs.ts';
import { ease } from '../../core/tween.ts';
import type { ClawResult } from '../../sim/types.ts';
import { type ArtNode, artSprite } from '../art.ts';
import { INK, lerp, span } from './fx.ts';
import { type Play, type Rig, type RigCtx, SETTLE } from './rig.ts';

/** objects/claw_machine에서 잰 값 (캔버스 px): 기준점(아래 가운데), 빈 창 속, 상품 문 구멍, 위 간판. */
const MACHINE = {
  anchor: { x: 512.5, y: 945 },
  h: 863,
  window: { x: 287, y: 283, w: 447, h: 348, r: 24 },
  door: { x: 298, y: 781, w: 134, h: 95 },
  sign: { x: 322, y: 156, w: 384, h: 64 },
} as const;
/** objects/claw: 굴대 가운데(돌림 중심)와 거기서 아래로 인형을 쥐는 자리·발톱 끝까지, 폭 (캔버스 px). */
const CLAW_ART = { hub: { x: 511, y: 562 }, grip: 168, tips: 257, w: 446 } as const;
/** plush_<종> 그림의 대략 폭 (캔버스 px): 인형 배율의 기준. */
const PLUSH_W = 540;
/** 쌓는 줄마다 인형 수 (아래부터). */
const ROWS = [4, 3, 2] as const;

// 한판 시각 (D 비율)
const MOVE = [0.06, 0.27, 0.31] as const; // 수레가 x로 (조금 지나쳤다 돌아옴)
const DROP = [0.33, 0.47] as const; // 내려가기
const CLOSE = [0.48, 0.52] as const; // 집기
const RISE = [0.53, 0.63] as const; // 들어 올리기
const BACK = [0.64, 0.79] as const; // 출구로
const OPEN = [0.8, 0.83] as const; // 벌리기
const POP = [0.845, 0.915] as const; // 문으로 튀어나옴

interface Slot {
  node: ArtNode;
  species: SpeciesId;
  x: number;
  y: number;
  rot: number;
  flip: number;
  row: number;
  present: boolean;
  /** 더미 안 제자리 (미끄러져 떨어진 인형은 쉬는 동안 여기로 굴러 돌아간다). */
  home: { x: number; y: number; rot: number; row: number };
}

interface Plan {
  result: ClawResult;
  slot: Slot;
  slot2: Slot | null;
  /** 수레가 가는 x와 지나치는 양 (창 기준 px). */
  cx: number;
  over: number;
  /** 집을 때 굴대 y. */
  hubDrop: number;
  /** 미끄러지는 시각과 떨어져 앉는 자리. */
  slipT: number;
  land: { x: number; y: number };
  /** 진자 계산 저장 (시각, 각, 각속도). */
  sw: { t: number; th: number; om: number };
}

export class ClawRig implements Rig {
  readonly root = new Container();
  private readonly ctx: RigCtx;
  private readonly machine = new Container();
  private readonly inside = new Container();
  private readonly pile = new Container();
  private readonly rod = new Graphics();
  private readonly carriage = new Graphics();
  private readonly claw: ArtNode;
  /** 집게에 매달린 인형 (그림만 빌려 쓴다: 더미의 인형은 숨긴다). */
  private readonly held: ArtNode[];
  /** 문으로 나온 인형. */
  private readonly prizes: ArtNode[];
  private readonly sign = new Graphics();
  private readonly slots: Slot[] = [];
  private readonly kPlush: number;
  private readonly kClaw: number;
  /** 창 (기계 기준 px). */
  private readonly win: { x: number; y: number; w: number; h: number };
  private readonly chute: { x: number; w: number; top: number };
  private readonly pileX: [number, number];
  private readonly ph: number;
  private readonly railY: number;
  private readonly home: { x: number; y: number };
  private readonly gripOff: number;
  private readonly door: { x: number; y: number };
  private plan: Plan | null = null;
  private hold = 0;
  private bounce = 0;
  private signFlash = 0;
  /** 끝난 뒤 문 앞 인형이 손님에게 가는 중. */
  private prizeOut = false;
  private idleTh = 0;
  private seat = 0;
  /** 미끄러져 더미 밖에 앉은 인형 (쉬는 동안 제자리로). */
  private strayed: Slot | null = null;

  constructor(ctx: RigCtx) {
    this.ctx = ctx;
    const L = ctx.L;
    this.root.zIndex = 20;
    const k = (L.bodyH * 1.95) / MACHINE.h;
    const A = MACHINE.anchor;
    const W = MACHINE.window;
    this.win = { x: (W.x - A.x) * k, y: (W.y - A.y) * k, w: W.w * k, h: W.h * k };
    const win = this.win;
    const art = artSprite('objects', 'claw_machine', { k, anchor: A, placeholder: { w: 573, h: 863, color: 0xe0705a } });
    this.machine.addChild(art);
    const S = MACHINE.sign;
    this.sign.roundRect((S.x - A.x) * k, (S.y - A.y) * k, S.w * k, S.h * k, S.h * k * 0.45).fill({ color: 0xffe27a });
    this.sign.alpha = 0;
    this.machine.addChild(this.sign);

    // 창 속: 더미 → 레일·수레 → 줄·집게·매달린 인형 → 출구 통 앞판 → 유리 반짝임. 창 모양으로 마스크.
    const mask = new Graphics().roundRect(win.x, win.y, win.w, win.h, W.r * k).fill({ color: 0xffffff });
    this.inside.mask = mask;
    this.machine.addChild(this.inside, mask);

    this.kPlush = (win.w * 0.26) / PLUSH_W;
    this.ph = PLUSH_W * this.kPlush * 0.92;
    const chuteW = win.w * 0.27;
    this.chute = { x: win.x + win.w * 0.02, w: chuteW, top: win.y + win.h * 0.56 };
    this.pileX = [win.x + chuteW + win.w * 0.05, win.x + win.w * 0.98];
    this.railY = win.y + win.h * 0.05;
    this.kClaw = (PLUSH_W * this.kPlush * 1.35) / CLAW_ART.w;
    this.gripOff = CLAW_ART.grip * this.kClaw;
    this.home = { x: this.chute.x + chuteW * 0.5, y: win.y + win.h * 0.2 };
    const D = MACHINE.door;
    this.door = { x: (D.x + D.w / 2 - A.x) * k, y: (D.y + D.h * 0.55 - A.y) * k };

    this.buildPile();
    this.inside.addChild(this.pile);
    const rail = new Graphics()
      .rect(win.x - 4, this.railY - win.h * 0.018, win.w + 8, win.h * 0.036)
      .fill({ color: 0xa9b1bb })
      .stroke({ color: INK, width: Math.max(1.5, win.h * 0.012) });
    const cw = win.w * 0.11;
    const ch = win.h * 0.06;
    this.carriage.roundRect(-cw / 2, -ch / 2, cw, ch, ch * 0.35).fill({ color: 0xe0705a }).stroke({ color: INK, width: Math.max(1.5, ch * 0.18) });
    this.held = [0, 1].map(() => {
      const n = artSprite('objects', 'plush_dragon', { k: this.kPlush, anchor: 'center', placeholder: { w: PLUSH_W, h: 500, color: 0xe8875a } });
      n.visible = false;
      return n;
    });
    this.claw = artSprite('objects', 'claw', { k: this.kClaw, anchor: CLAW_ART.hub, placeholder: { w: CLAW_ART.w, h: 645, color: 0xb9b4ad } });
    this.inside.addChild(rail, this.rod, ...this.held, this.claw, this.carriage);

    // 출구 통 앞판 (떨어지는 인형이 이 뒤로 사라진다)
    const c = this.chute;
    const panelH = win.y + win.h - c.top + 4;
    const lw = Math.max(1.5, win.h * 0.014);
    const chute = new Graphics()
      .rect(c.x, c.top, c.w, panelH)
      .fill({ color: 0xbfe0f0 })
      .stroke({ color: INK, width: lw })
      .rect(c.x, c.top, c.w, win.h * 0.045)
      .fill({ color: 0xe9f6ff })
      .stroke({ color: INK, width: lw })
      .moveTo(c.x + c.w * 0.2, c.top + panelH * 0.75)
      .lineTo(c.x + c.w * 0.45, c.top + panelH * 0.3)
      .stroke({ color: 0xffffff, width: lw * 1.6, alpha: 0.8, cap: 'round' })
      .moveTo(c.x + c.w * 0.42, c.top + panelH * 0.8)
      .lineTo(c.x + c.w * 0.58, c.top + panelH * 0.5)
      .stroke({ color: 0xffffff, width: lw * 1.2, alpha: 0.6, cap: 'round' });
    // 유리 반짝임
    const glass = new Graphics()
      .poly([win.x + win.w * 0.62, win.y, win.x + win.w * 0.74, win.y, win.x + win.w * 0.44, win.y + win.h, win.x + win.w * 0.32, win.y + win.h])
      .fill({ color: 0xffffff, alpha: 0.16 })
      .poly([win.x + win.w * 0.79, win.y, win.x + win.w * 0.83, win.y, win.x + win.w * 0.53, win.y + win.h, win.x + win.w * 0.49, win.y + win.h])
      .fill({ color: 0xffffff, alpha: 0.13 });
    this.inside.addChild(chute, glass);

    // 문으로 나온 인형 (기계 앞)
    this.prizes = [0, 1].map(() => {
      const n = artSprite('objects', 'plush_dragon', { k: this.kPlush, anchor: 'bottom', placeholder: { w: PLUSH_W, h: 500, color: 0xe8875a } });
      n.visible = false;
      return n;
    });
    this.machine.addChild(...this.prizes);

    this.machine.position.set(L.sx + L.sw * 0.5, L.rig.y);
    this.root.addChild(this.machine);
    this.drawArm(this.home.x, this.home.y, 0, 1);
  }

  // ── 더미 ──────────────────────────────────────────────────────────────

  private buildPile(): void {
    const [x0, x1] = this.pileX;
    const sp = (x1 - x0) / ROWS[0];
    const bottom = this.win.y + this.win.h;
    // 상품은 도감에서 본 종의 인형 (sim도 그 종에서 고른다). 본 종이 더미보다 적으면 다른 종으로 채운다.
    const seen = shuffled(this.ctx.plushPool?.() ?? []);
    const species = seen.length >= ROWS[0] + ROWS[1] + ROWS[2] ? seen : [...seen, ...shuffled(SPECIES_IDS.filter((s) => !seen.includes(s)))];
    let n = 0;
    ROWS.forEach((count, row) => {
      for (let i = 0; i < count; i++) {
        const s = species[n++ % species.length] ?? 'dragon';
        const node = artSprite('objects', `plush_${s}`, { k: this.kPlush, anchor: 'center', placeholder: { w: PLUSH_W, h: 500, color: SPECIES[s].color } });
        const slot: Slot = {
          node,
          species: s,
          x: x0 + sp * (i + 0.5 + row * 0.5) + (Math.random() - 0.5) * sp * 0.16,
          y: bottom - this.ph * (0.4 + row * 0.48) + (Math.random() - 0.5) * this.ph * 0.08,
          rot: (Math.random() - 0.5) * 0.6,
          flip: Math.random() < 0.5 ? -1 : 1,
          row,
          present: true,
          home: { x: 0, y: 0, rot: 0, row },
        };
        slot.home = { x: slot.x, y: slot.y, rot: slot.rot, row };
        this.placeSlot(slot);
        this.slots.push(slot);
        this.pile.addChild(node);
      }
    });
  }

  private placeSlot(s: Slot): void {
    s.node.visible = s.present;
    s.node.position.set(s.x, s.y);
    s.node.rotation = s.rot;
    s.node.scale.set(s.flip, 1);
  }

  private setSpecies(s: Slot, sp: SpeciesId): void {
    s.species = sp;
    s.node.setArt('objects', `plush_${sp}`);
  }

  /** x 근처 더미 꼭대기 (인형 가운데가 앉을 y). */
  private surfaceAt(x: number, except: Slot | null): number {
    let y = this.win.y + this.win.h - this.ph * 0.4;
    const reach = this.ph * 0.75;
    for (const s of this.slots) {
      if (!s.present || s === except || Math.abs(s.x - x) > reach) continue;
      y = Math.min(y, s.y - this.ph * 0.6 * (1 - Math.abs(s.x - x) / (reach * 1.6)));
    }
    return y;
  }

  // ── 집게 ──────────────────────────────────────────────────────────────

  /** 수레 x (창 기준). */
  private carX(pl: Plan, t: number, D: number): number {
    const hx = this.home.x;
    if (t < MOVE[0] * D) return hx;
    if (t < MOVE[1] * D) return lerp(hx, pl.cx + pl.over, ease.inOutQuad(span(t, MOVE[0] * D, MOVE[1] * D)));
    if (t < MOVE[2] * D) return lerp(pl.cx + pl.over, pl.cx, ease.outQuad(span(t, MOVE[1] * D, MOVE[2] * D)));
    if (t < BACK[0] * D) return pl.cx;
    if (t < BACK[1] * D) return lerp(pl.cx, hx, ease.inOutQuad(span(t, BACK[0] * D, BACK[1] * D)));
    return hx;
  }

  /** 굴대 y (줄 길이). */
  private hubY(pl: Plan, t: number, D: number): number {
    const top = this.home.y;
    if (t < DROP[0] * D) return top;
    if (t < DROP[1] * D) return lerp(top, pl.hubDrop, ease.inOutQuad(span(t, DROP[0] * D, DROP[1] * D)));
    if (t < RISE[0] * D) return pl.hubDrop;
    if (t < RISE[1] * D) return lerp(pl.hubDrop, top, ease.inOutQuad(span(t, RISE[0] * D, RISE[1] * D)));
    return top;
  }

  /** 집게 벌림 (1 = 벌림, 작을수록 닫힘). */
  private openAt(pl: Plan, t: number, D: number): number {
    const closed = pl.result === 'miss' ? 0.5 : 0.66;
    if (t < CLOSE[0] * D) return 1;
    if (t < CLOSE[1] * D) return lerp(1, closed, span(t, CLOSE[0] * D, CLOSE[1] * D));
    if (t < OPEN[0] * D) return closed;
    return lerp(closed, 1, span(t, OPEN[0] * D, OPEN[1] * D));
  }

  /** 진자 각 (수레 가속에 끌려 흔들린다). 0부터 1/120초씩 계산하고, 앞으로만 가면 이어서 계산한다. */
  private swing(pl: Plan, t: number, D: number): number {
    const h = 1 / 120;
    if (t < pl.sw.t) pl.sw = { t: 0, th: 0, om: 0 };
    const w0 = 8.5;
    const zeta = 0.16;
    const gain = 0.19 / this.win.w;
    let { t: s, th, om } = pl.sw;
    while (s + h <= t) {
      const acc = (this.carX(pl, s + h, D) - 2 * this.carX(pl, s, D) + this.carX(pl, s - h, D)) / (h * h);
      const a = -w0 * w0 * th - 2 * zeta * w0 * om - gain * acc * w0 * w0 * 0.12;
      om += a * h;
      th += om * h;
      s += h;
    }
    pl.sw = { t: s, th, om };
    return Math.max(-0.45, Math.min(0.45, th));
  }

  private drawArm(x: number, hubY: number, th: number, open: number): { x: number; y: number } {
    const len = hubY - this.railY;
    const hx = x - Math.sin(th) * len;
    const hy = this.railY + Math.cos(th) * len;
    const lw = Math.max(2, this.win.w * 0.028);
    this.rod.clear().moveTo(x, this.railY).lineTo(hx, hy).stroke({ color: INK, width: lw + 2.5, cap: 'round' }).moveTo(x, this.railY).lineTo(hx, hy).stroke({ color: 0x8d8a86, width: lw, cap: 'round' });
    this.carriage.position.set(x, this.railY);
    this.claw.position.set(hx, hy);
    this.claw.rotation = th;
    this.claw.scale.set(open, 1);
    return { x: hx, y: hy };
  }

  /** 굴대에서 th로 기운 줄을 따라 d만큼 아래 점. */
  private below(hub: { x: number; y: number }, th: number, d: number): { x: number; y: number } {
    return { x: hub.x - Math.sin(th) * d, y: hub.y + Math.cos(th) * d };
  }

  // ── Rig ────────────────────────────────────────────────────────────────

  begin(play: Play): void {
    const d = play.round.outcome.detail;
    if (d.kind !== 'claw') return;
    this.restock(true);
    this.settle(true);
    this.seat = play.seat;
    for (const p of this.prizes) p.visible = false;
    this.prizeOut = false;
    const [x0, x1] = this.pileX;
    const sp = (x1 - x0) / ROWS[0];
    const want = x0 + Math.max(0, Math.min(1, d.x)) * (x1 - x0);
    // 꼭대기에 가까운 인형을 노린다.
    let best: Slot | null = null;
    let score = Infinity;
    for (const s of this.slots) {
      if (!s.present) continue;
      const v = Math.abs(s.x - want) + (ROWS.length - 1 - s.row) * sp * 0.45;
      if (v < score) {
        score = v;
        best = s;
      }
    }
    const slot = best ?? this.slots[0];
    if (slot === undefined) return;
    this.setSpecies(slot, d.target);
    let slot2: Slot | null = null;
    if (d.result === 'double') {
      let dist = Infinity;
      for (const s of this.slots) {
        if (!s.present || s === slot) continue;
        const v = Math.hypot(s.x - slot.x, (s.y - slot.y) * 1.5);
        if (v < dist) {
          dist = v;
          slot2 = s;
        }
      }
      if (slot2 !== null) this.setSpecies(slot2, d.target2 ?? d.target);
    }
    // 헛집기: 인형 옆 빈 곳을 집는다 (더미 안쪽으로).
    const side = slot.x - x0 < x1 - slot.x ? 1 : -1;
    const miss = d.result === 'miss';
    const cx = miss ? Math.max(x0, Math.min(x1, slot.x + side * sp * 0.6)) : slot.x;
    const hubDrop = miss ? slot.y - this.ph * 0.25 - this.gripOff : slot.y - this.ph * 0.05 - this.gripOff;
    // 미끄러짐: 출구까지 간 비율 slipAt이 되는 시각 (수레 움직임의 ease를 거꾸로).
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2;
      if (ease.inOutQuad(m) < d.slipAt) lo = m;
      else hi = m;
    }
    const slipT = lerp(BACK[0], BACK[1], lo) * play.D;
    const landX = lerp(cx, this.home.x, d.slipAt);
    const lx = Math.max(this.chute.x + this.chute.w + this.ph * 0.35, landX);
    this.plan = {
      result: d.result,
      slot,
      slot2,
      cx,
      over: (cx > this.home.x ? 1 : -1) * this.win.w * 0.05,
      hubDrop,
      slipT,
      land: { x: lx, y: this.surfaceAt(lx, slot) },
      sw: { t: 0, th: 0, om: 0 },
    };
    this.hold = 0;
    this.held[0]?.setArt('objects', `plush_${slot.species}`);
    if (slot2 !== null) this.held[1]?.setArt('objects', `plush_${slot2.species}`);
  }

  render(play: Play): void {
    const pl = this.plan;
    if (pl === null) return;
    const D = play.D;
    const t = Math.min(play.t, SETTLE * D);
    const x = this.carX(pl, t, D);
    const th = this.swing(pl, t, D);
    const hub = this.drawArm(x, this.hubY(pl, t, D), th, this.openAt(pl, t, D));
    const grabbed = pl.result !== 'miss' && t >= CLOSE[1] * D;

    // 더미의 인형: 집히면 숨기고, 헛집기면 들썩
    for (const s of this.slots) {
      const nudge = pl.result === 'miss' && s === pl.slot ? Math.sin(span(t, CLOSE[0] * D, CLOSE[0] * D + 0.5) * Math.PI * 3) * 0.18 * (1 - span(t, CLOSE[0] * D, CLOSE[0] * D + 0.5)) : 0;
      const taken = grabbed && (s === pl.slot || s === pl.slot2);
      s.node.visible = s.present && !taken;
      if (s.node.visible) {
        s.node.position.set(s.x, s.y - (nudge !== 0 ? Math.abs(nudge) * this.ph * 0.3 : 0));
        s.node.rotation = s.rot + nudge;
      }
    }

    // 매달린 인형
    const [h0, h1] = this.held;
    if (h0 === undefined || h1 === undefined) return;
    h0.visible = false;
    h1.visible = false;
    const releaseT = pl.result === 'slip' ? pl.slipT : OPEN[0] * D;
    if (grabbed) {
      const s0 = pl.slot;
      if (t < releaseT) {
        // 미끄러지기 직전: 발톱 사이에서 스르륵 내려가며 꿈틀
        const slide = pl.result === 'slip' ? span(t, releaseT - 0.08 * D, releaseT) : 0;
        const p = this.below(hub, th, this.gripOff + this.ph * (0.05 + slide * 0.3));
        this.showHeld(h0, s0, p.x, p.y, th + Math.sin(t * 40) * 0.12 * slide);
        if (pl.slot2 !== null) {
          const q = this.below(hub, th, this.gripOff + this.ph * 0.5);
          this.showHeld(h1, pl.slot2, q.x + this.ph * 0.35, q.y, th + 0.45);
        }
      } else if (pl.result === 'slip') {
        this.showHeld(h0, s0, ...this.slipFall(pl, t, D));
      } else {
        // 출구 통으로 떨어진다 (앞판 뒤로 사라짐)
        // 벌릴 때 집게는 출구 위 집 자리에 거의 멈춰 있다: 거기서 곧장 아래로.
        const top = { x: this.home.x, y: this.home.y + this.gripOff + this.ph * 0.05 };
        const u = t - releaseT;
        const g = this.win.h * 9;
        if (u < 0.6) {
          this.showHeld(h0, s0, top.x, top.y + 0.5 * g * u * u, th);
          if (pl.slot2 !== null && u > 0.05) this.showHeld(h1, pl.slot2, top.x + this.ph * 0.2, top.y + this.ph * 0.4 + 0.5 * g * (u - 0.05) ** 2, 0.45);
        }
      }
    }

    // 문으로 톡
    this.showPrizes(pl, t, D);

    // 손님: 손잡이를 움직이듯 수레를 따라 몸이 기울고, 버튼을 누를 때 꾹, 들어 올리는 동안 조마조마
    const a = this.ctx.actor(play.seat);
    if (a !== null) {
      const v = (x - this.carX(pl, t - 1 / 30, D)) * 30;
      const steer = t < MOVE[2] * D ? 1 : 0;
      const press = Math.sin(Math.PI * span(t, DROP[0] * D - 0.12, DROP[0] * D + 0.12));
      const tense = span(t, RISE[0] * D, RISE[1] * D) * (1 - span(t, OPEN[1] * D, POP[1] * D));
      a.rig.dx = a.bodyH * (-0.04 * (steer + tense) + steer * Math.max(-0.05, Math.min(0.05, (v / this.win.w) * 0.04)));
      a.rig.rot = -0.04 * steer - 0.05 * tense;
      a.rig.sy = 1 - press * 0.07 + Math.sin(play.t * 36) * 0.007 * tense;
      a.rig.sx = 1 + press * 0.05;
    }
  }

  /** 미끄러진 인형: 떨어져 출구 앞 더미 위로 통 튀고 앉는다. [x, y, 회전] */
  private slipFall(pl: Plan, t: number, D: number): [number, number, number] {
    const T = pl.slipT;
    const x0 = this.carX(pl, T, D);
    const y0 = this.hubY(pl, T, D) + this.gripOff + this.ph * 0.35;
    const g = this.win.h * 9;
    const fall = Math.max(0.05, Math.sqrt((2 * Math.max(1, pl.land.y - y0)) / g));
    const u = t - T;
    if (u < fall) {
      const k = u / fall;
      return [lerp(x0, pl.land.x, k), y0 + 0.5 * g * u * u, k * 1.3];
    }
    const b = u - fall;
    const hop = this.ph * 0.18 * Math.abs(Math.sin(Math.min(1, b / 0.3) * Math.PI)) * (b < 0.3 ? 1 : 0);
    return [pl.land.x, pl.land.y - hop, 1.3 + Math.min(1, b / 0.3) * 0.25];
  }

  private showHeld(n: ArtNode, s: Slot, x: number, y: number, rot: number): void {
    n.visible = true;
    n.position.set(x, y);
    n.rotation = rot;
    n.scale.set(s.flip, 1);
  }

  private showPrizes(pl: Plan, t: number, D: number): void {
    const wins = pl.result === 'win' || pl.result === 'double';
    const list = [pl.slot, pl.slot2];
    this.prizes.forEach((p, i) => {
      const s = list[i] ?? null;
      const t0 = POP[0] * D + i * 0.12;
      if (!wins || s === null || t < t0) {
        if (!this.prizeOut) p.visible = false;
        return;
      }
      p.setArt('objects', `plush_${s.species}`);
      const u = span(t, t0, Math.max(t0 + 0.2, POP[1] * D));
      const from = this.door;
      const to = { x: this.door.x + (i === 0 ? -0.15 : 0.55) * this.ph, y: this.ctx.L.bodyH * 0.06 };
      p.visible = true;
      p.position.set(lerp(from.x, to.x, u), lerp(from.y, to.y, u) - Math.sin(Math.PI * u) * this.ph * 1.1);
      p.scale.set(lerp(0.4, 1.25, ease.outBack(Math.min(1, u * 1.4))) * s.flip, lerp(0.4, 1.25, ease.outBack(Math.min(1, u * 1.4))));
      p.rotation = (1 - u) * -0.8;
    });
  }

  finish(play: Play): void {
    const pl = this.plan;
    play.t = Math.max(play.t, SETTLE * play.D);
    if (pl !== null) {
      this.render(play);
      if (pl.result === 'slip') {
        // 떨어진 자리에 그대로 앉는다.
        const s = pl.slot;
        s.x = pl.land.x;
        s.y = pl.land.y;
        s.rot = 1.55;
        s.row = ROWS.length - 1;
        this.pile.addChild(s.node);
        this.placeSlot(s);
        this.strayed = s;
      } else if (pl.result === 'win' || pl.result === 'double') {
        pl.slot.present = false;
        if (pl.slot2 !== null) pl.slot2.present = false;
        this.prizeOut = true;
      }
      for (const n of this.held) n.visible = false;
      for (const s of this.slots) this.placeSlot(s);
    }
    this.hold = 1.6;
    this.plan = null;
  }

  /** 비어 있는 자리에 새 인형 (now = 바로, 아니면 위에서 톡 떨어진다). */
  private restock(now: boolean): void {
    for (const s of this.slots) {
      if (s.present) continue;
      s.present = true;
      this.setSpecies(s, SPECIES_IDS[Math.floor(Math.random() * SPECIES_IDS.length)] ?? 'dragon');
      this.placeSlot(s);
      if (now) continue;
      const node = s.node;
      const y1 = s.y;
      const y0 = this.win.y - this.ph;
      void this.ctx.anim.run(0.45, (u) => {
        if (!node.destroyed) node.y = lerp(y0, y1, u);
      }, { ease: ease.outBounce });
    }
  }

  /** 미끄러진 인형을 더미 제자리로 (now = 바로, 아니면 통통 굴러서). */
  private settle(now: boolean): void {
    const s = this.strayed;
    if (s === null) return;
    this.strayed = null;
    const from = { x: s.x, y: s.y, rot: s.rot };
    s.x = s.home.x;
    s.y = s.home.y;
    s.rot = s.home.rot;
    s.row = s.home.row;
    // 그리는 순서도 제 줄 자리로 (아래 줄이 먼저).
    this.pile.removeChild(s.node);
    this.pile.addChildAt(s.node, Math.min(this.pile.children.length, this.slots.filter((o) => o !== s && o.home.row <= s.home.row).length));
    this.placeSlot(s);
    if (now) return;
    const node = s.node;
    void this.ctx.anim.run(0.6, (u) => {
      if (node.destroyed || this.plan !== null) return;
      node.position.set(lerp(from.x, s.x, u), lerp(from.y, s.y, u) - Math.abs(Math.sin(u * Math.PI * 2)) * this.ph * 0.25);
      node.rotation = lerp(from.rot, s.rot, u);
    }, { ease: ease.linear });
  }

  idle(dt: number, time: number): void {
    // 집게는 집 자리에서 살짝 흔들
    this.idleTh = Math.sin(time * 1.3) * 0.03;
    if (this.plan === null) this.drawArm(this.home.x, this.home.y, this.idleTh, 1);
    if (this.hold > 0) {
      this.hold -= dt;
      if (this.hold <= 0) {
        this.restock(false);
        this.settle(false);
        if (this.prizeOut) this.sendPrizes();
      }
    }
    if (this.bounce > 0) {
      this.bounce = Math.max(0, this.bounce - dt);
      const u = this.bounce;
      const s = Math.abs(Math.sin(u * Math.PI * 4)) * Math.min(1, u);
      this.machine.scale.set(1 + s * 0.05, 1 - s * 0.06);
    } else this.machine.scale.set(1);
    if (this.signFlash > 0) {
      this.signFlash = Math.max(0, this.signFlash - dt);
      this.sign.alpha = this.signFlash > 0 ? 0.35 + 0.35 * Math.sin(time * 18) : 0;
    }
  }

  /** 문 앞 인형이 손님 쪽으로 통통 가며 사라진다 (손님이 받아 감). */
  private sendPrizes(): void {
    this.prizeOut = false;
    const L = this.ctx.L;
    const a = this.ctx.actor(this.seat);
    const tx = (a?.root.x ?? L.seats[this.seat]?.x ?? L.sx + L.sw * 0.8) - this.machine.x;
    this.prizes.forEach((p, i) => {
      if (!p.visible) return;
      const x0 = p.x;
      const y0 = p.y;
      void this.ctx.anim.run(0.6, (u) => {
        if (p.destroyed) return;
        p.position.set(lerp(x0, tx - L.bodyH * 0.25, u), y0 - Math.abs(Math.sin(u * Math.PI * 2)) * this.ph * 0.5);
        p.alpha = 1 - span(u, 0.6, 1);
      }, { ease: ease.linear, delay: i * 0.1 }).then(() => {
        if (p.destroyed) return;
        p.visible = false;
        p.alpha = 1;
      });
    });
  }

  celebrate(tier: OutcomeTier): void {
    if (tier === 'jackpot') {
      this.bounce = 1.6;
      this.signFlash = 2;
    } else if (tier === 'win') {
      this.bounce = 0.5;
      this.signFlash = 1;
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

function shuffled<T>(list: readonly T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}
