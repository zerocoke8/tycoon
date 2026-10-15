// 복주머니 부스: 가로대(bg_pouch의 나무 막대)에 주머니 셋(빨강·파랑·노랑)이 끈으로 걸려 있고, 아래에 탁자.
// 한판: 손님이 특산 재료(items/<재료>)를 진행자에게 건넨다 → 주머니 사이를 고민하다 하나를 고른다 (말풍선 '노랑!')
// → 진행자가 그 주머니를 떼어 탁자에 놓고 흔들다 연다: 대박 = 금빛 햇살 + 코인 분수 + 반짝이, 코인 = 코인 비,
// 하나 = 동전 하나가 톡 튀어 통통 구르다 멈춤, 빈 주머니 = 먼지 뭉치(fx/fx_puff)가 퐁, 주머니가 쭈그러들고 손님은 시무룩.
// 세부: { kind: 'pouch', pick (0~2), content }. 대박은 늘 노랑(2). 탁자 위 코인은 연출일 뿐 (받는 코인은 장면이 항아리에서 보낸다).

import { Container, Graphics } from 'pixi.js';
import { type OutcomeTier, POUCH, SPECIES } from '../../data/defs.ts';
import { ease } from '../../core/tween.ts';
import type { PouchContent } from '../../sim/types.ts';
import { type ArtNode, artSprite } from '../art.ts';
import { clamp01, coinNode, emoteNode, INK, lerp, span } from './fx.ts';
import { AWNING_LINE, TABLE_TOP } from './layout.ts';
import { type Play, type Rig, type RigCtx, SETTLE } from './rig.ts';

/** closeup/bg_pouch의 가로대 (배경 높이의 비율): 위·아래 끝. */
const RAIL = { top: 0.142, bottom: 0.182 } as const;
/** objects/pouch_*에서 잰 값 (캔버스 px): 끈을 거는 주머니 위 가운데(기준점), 그 아래로 주머니 끝까지, 폭. */
const POUCH_ART = { hook: { x: 512, y: 292 }, below: 504, w: 523 } as const;
/** 진행자 손 자리 (characters/<그림>에서 잰 값: 발에서 캔버스 px, 왼쪽을 보는 그림 기준). 없으면 키의 45% 높이 앞. */
const HOST_HANDS: Readonly<Record<string, { x: number; y: number }>> = { host_pouch: { x: -136, y: -431 } };
const PICK_WORD = ['빨강!', '파랑!', '노랑!'];

/** 한판 시간표 (한판 길이의 비율). */
const T = {
  give: [0.03, 0.2],
  ponder: [0.22, 0.38],
  lift: [0.44, 0.56],
  open: 0.68,
} as const;

interface Coin {
  at: number;
  vx: number;
  vy: number;
  spin: number;
  /** 처음 닿는 바닥: 탁자 위(true)인가 바닥인가. */
  table: boolean;
}

interface Plan {
  pick: number;
  content: PouchContent;
  /** 고민하며 들여다보는 주머니 순서 (마지막 = 고른 주머니). */
  hovers: number[];
  mat: string;
  coins: Coin[];
  sparkles: { angle: number; dist: number; delay: number }[];
  sadShown: boolean;
}

/** 던진 물체의 s초 뒤 자리: 바닥(groundY)에 닿으면 e 비율로 튕긴다 (최대 bounces번), 그 뒤엔 바닥에 머문다. */
function toss(s: number, x0: number, y0: number, vx: number, vy: number, g: number, groundY: number, e: number, bounces: number): { x: number; y: number; rest: boolean } {
  let x = x0;
  let y = Math.min(y0, groundY);
  let u = vx;
  let v = vy;
  let left = s;
  for (let b = 0; b <= bounces; b++) {
    const disc = v * v + 2 * g * (groundY - y);
    const hit = disc <= 0 ? 0 : (-v + Math.sqrt(disc)) / g;
    if (left <= hit) return { x: x + u * left, y: y + v * left + 0.5 * g * left * left, rest: false };
    left -= hit;
    x += u * hit;
    y = groundY;
    v = -(v + g * hit) * e;
    u *= 0.6;
  }
  return { x, y: groundY, rest: true };
}

export class PouchRig implements Rig {
  readonly root = new Container();
  private readonly ctx: RigCtx;
  private readonly pouches: ArtNode[] = [];
  private readonly strings: Graphics[] = [];
  private readonly hang: { x: number; y: number }[] = [];
  private readonly table: { x: number; surface: number; half: number };
  /** 탁자 위에 놓인 주머니의 기준점 (매듭 위). */
  private readonly onTable: { x: number; y: number };
  private readonly rays = new Graphics();
  private readonly mat: ArtNode;
  private readonly coins: Container[] = [];
  private readonly sparkles: Container[] = [];
  private readonly puffs: ArtNode[] = [];
  private readonly ph: number;
  private readonly g: number;
  private plan: Plan | null = null;
  /** 끝난 한판의 열린 주머니를 탁자에 두는 시간, 그다음 제자리로 돌아오는 정도 (0~1). */
  private hold = 0;
  private back = 1;
  private lastPick = -1;

  constructor(ctx: RigCtx) {
    this.ctx = ctx;
    const L = ctx.L;
    const sw = L.sw;
    this.root.zIndex = 20;
    this.root.sortableChildren = true;
    this.g = sw * 3.2;

    // 가로대: 배경의 막대가 차양 띠에 가리면 (넓적한 패널) 코드로 막대를 그린다.
    const size = L.bg.size;
    const awning = AWNING_LINE.pouch * size;
    const artTop = L.bg.y + RAIL.top * size;
    let railBottom = L.bg.y + RAIL.bottom * size;
    if (artTop < awning + 2) {
      const th = Math.max(8, size * 0.035);
      const y0 = awning + size * 0.03;
      const rail = new Graphics()
        .roundRect(L.sx + sw * 0.04, y0, sw * 0.92, th, th * 0.45)
        .fill({ color: 0xb5835a })
        .stroke({ color: INK, width: Math.max(2, th * 0.18) });
      rail.zIndex = -1;
      this.root.addChild(rail);
      railBottom = y0 + th;
    }

    // 탁자 (가운데, 진행자와 손님 사이)
    const cx = L.sx + sw * 0.46;
    const kTable = (sw * 0.4) / 848;
    const tableH = 367 * kTable;
    const table = artSprite('objects', 'table', { k: kTable, anchor: 'bottom', placeholder: { w: 848, h: 367, color: 0xc98a5a } });
    table.position.set(cx, L.rig.y);
    table.zIndex = 0;
    this.root.addChild(table);
    const surface = L.rig.y - tableH * (1 - TABLE_TOP);
    this.table = { x: cx, surface, half: sw * 0.18 };

    // 주머니 셋: 끈에 걸려 흔들린다.
    const kP = (sw * 0.15) / POUCH_ART.w;
    this.ph = POUCH_ART.below * kP;
    const hangY = railBottom + Math.max(10, L.h * 0.06);
    this.onTable = { x: cx, y: surface - this.ph * 0.95 };
    this.rays.zIndex = 2;
    this.rays.visible = false;
    this.root.addChild(this.rays);
    POUCH.pouches.forEach((key, i) => {
      const x = cx + (i - 1) * sw * 0.2;
      this.hang.push({ x, y: hangY });
      const s = new Graphics()
        .moveTo(x, railBottom - 2)
        .lineTo(x, hangY + this.ph * 0.05)
        .stroke({ color: 0x7a4a2a, width: Math.max(2, sw * 0.007) });
      s.zIndex = 1;
      this.strings.push(s);
      const p = artSprite('objects', key, { k: kP, anchor: POUCH_ART.hook, placeholder: { w: 523, h: 532, color: [0xe0705a, 0x6f9fd8, 0xf3d36a][i] ?? 0xe0705a } });
      p.position.set(x, hangY);
      p.zIndex = 3;
      this.pouches.push(p);
      this.root.addChild(s, p);
    });

    // 앞 층 (손님보다 앞): 건네는 재료, 코인, 반짝이, 먼지
    this.mat = artSprite('items', 'mat_ember', { k: (sw * 0.085) / 460, anchor: 'center', placeholder: { w: 420, h: 420, color: 0xf3c06a } });
    this.mat.visible = false;
    ctx.front.addChild(this.mat);
    for (let i = 0; i < 14; i++) {
      const c = coinNode(sw * 0.05);
      c.visible = false;
      this.coins.push(c);
      ctx.front.addChild(c);
    }
    for (let i = 0; i < 9; i++) {
      const s = emoteNode('sparkle', sw * 0.075);
      s.visible = false;
      this.sparkles.push(s);
      ctx.front.addChild(s);
    }
    for (let i = 0; i < 3; i++) {
      const p = artSprite('fx', 'fx_puff', { k: (sw * 0.22) / 800, anchor: 'center', placeholder: { w: 800, h: 620, color: 0xe8e0d4 } });
      p.visible = false;
      this.puffs.push(p);
      ctx.front.addChild(p);
    }
  }

  /** 진행자 손 자리 (패널 px). 진행자가 없으면 탁자 왼쪽 위. */
  private hostHand(): { x: number; y: number } {
    const host = this.ctx.host();
    if (host === null) return { x: this.table.x - this.table.half, y: this.table.surface - this.ctx.L.sw * 0.12 };
    const m = HOST_HANDS[host.art];
    // 진행자는 뒤집혀 오른쪽을 본다: 그림의 앞(왼쪽)이 오른쪽으로.
    if (m !== undefined) return { x: host.root.x - m.x * host.k, y: host.root.y + m.y * host.k };
    return { x: host.root.x + host.halfW * 0.6, y: host.root.y - host.height * 0.45 };
  }

  private guestHand(seat: number): { x: number; y: number } {
    const a = this.ctx.actor(seat);
    const L = this.ctx.L;
    if (a === null) return { x: L.sx + L.sw * 0.75, y: L.feetY - L.bodyH * 0.6 };
    const h = a.hand();
    const s = a.root.scale.x;
    return { x: a.root.x + h.x * s, y: a.root.y + h.y * s };
  }

  begin(play: Play): void {
    const d = play.round.outcome.detail;
    if (d.kind !== 'pouch') return;
    const n = POUCH.pouches.length;
    const pick = Math.max(0, Math.min(n - 1, d.pick));
    const others = [0, 1, 2].filter((i) => i !== pick);
    const first = others[Math.floor(Math.random() * others.length)] ?? 0;
    const hovers = [first, (first + 1 + Math.floor(Math.random() * 2)) % n, pick];
    const a = this.ctx.actor(play.seat);
    const mat = a !== null ? SPECIES[a.species].material : 'mat_ember';
    const sw = this.ctx.L.sw;
    const big = d.content === 'jackpot';
    const count = big ? 14 : d.content === 'coins' ? 7 : d.content === 'one' ? 1 : 0;
    const mouthY = this.onTable.y + this.ph * 0.12;
    const coins: Coin[] = Array.from({ length: count }, (_, j) => {
      const one = d.content === 'one';
      const side = one ? (Math.random() < 0.5 ? -1 : 1) : j % 2 === 0 ? 1 : -1;
      const vx = one ? side * sw * 0.11 : side * sw * (0.15 + Math.random() * 0.5) * (big ? 1.3 : 1);
      const vy = -sw * (big ? 1.25 + Math.random() * 0.5 : one ? 0.9 : 1 + Math.random() * 0.35);
      // 탁자 윗면에 처음 닿는 자리로 바닥을 정한다 (날아가는 중에 바닥이 바뀌지 않게).
      const drop = this.table.surface + sw * 0.01 - mouthY;
      const hit = (-vy + Math.sqrt(vy * vy + 2 * this.g * Math.max(0, drop))) / this.g;
      const table = Math.abs(this.onTable.x + vx * hit - this.table.x) < this.table.half * 0.92;
      return { at: j * (big ? 0.035 : 0.05), vx, vy, spin: (Math.random() - 0.5) * 14, table };
    });
    const sparkles = big ? Array.from({ length: this.sparkles.length }, (_, j) => ({ angle: -Math.PI / 2 + ((j - 4) / 4) * 1.4 + (Math.random() - 0.5) * 0.3, dist: sw * (0.14 + Math.random() * 0.12), delay: Math.random() * 0.12 })) : [];
    this.plan = { pick, content: d.content, hovers, mat, coins, sparkles, sadShown: false };
    this.mat.setArt('items', mat);
    this.hold = 0;
    this.back = 1;
    this.lastPick = pick;
    this.resetPouches();
  }

  private resetPouches(): void {
    this.pouches.forEach((p, i) => {
      const h = this.hang[i];
      if (h === undefined) return;
      p.position.set(h.x, h.y);
      p.scale.set(1);
      p.rotation = 0;
      p.alpha = 1;
      const s = this.strings[i];
      if (s !== undefined) s.alpha = 1;
    });
    this.rays.visible = false;
    for (const c of this.coins) c.visible = false;
    for (const s of this.sparkles) s.visible = false;
    for (const p of this.puffs) p.visible = false;
  }

  render(play: Play): void {
    const pl = this.plan;
    if (pl === null) return;
    const { D } = play;
    const t = Math.min(play.t, SETTLE * D);
    const L = this.ctx.L;
    const sw = L.sw;
    const a = this.ctx.actor(play.seat);
    const host = this.ctx.host();

    // 1) 재료 건네기: 손님 손 → 진행자 손 (작은 포물선), 닿으면 쏙.
    const g0 = T.give[0] * D;
    const g1 = T.give[1] * D;
    const from = this.guestHand(play.seat);
    const to = this.hostHand();
    if (t >= g0 && t < g1 + 0.06 * D) {
      const u = span(t, g0, g1);
      this.mat.visible = true;
      this.mat.position.set(lerp(from.x, to.x, u), lerp(from.y, to.y, u) - Math.sin(Math.PI * u) * sw * 0.16);
      this.mat.rotation = u * 4;
      const gone = span(t, g1, g1 + 0.06 * D);
      this.mat.scale.set(lerp(1, 0.3, gone));
      this.mat.alpha = 1 - gone;
    } else this.mat.visible = false;
    if (a !== null) {
      // 건넬 때 몸을 내밀었다가, 고를 때는 주머니 쪽으로 기웃.
      const reach = span(t, 0, g0 + 0.04 * D) * (1 - span(t, g0 + 0.06 * D, g1));
      const peek = span(t, T.ponder[0] * D, T.ponder[0] * D + 0.05 * D) * (1 - span(t, T.lift[0] * D, T.lift[1] * D));
      a.rig.rot = -0.1 * reach - 0.06 * peek + (peek > 0 ? Math.sin(play.t * 9) * 0.02 * peek : 0);
      a.rig.dx = -a.bodyH * 0.06 * reach;
      a.setBubble(t >= T.ponder[1] * D && t < T.open * D ? (PICK_WORD[pl.pick] ?? null) : null);
    }
    if (host !== null) {
      // 받으며 까딱, 열 때는 주머니 쪽으로 몸을 숙인다.
      const take = span(t, g1, g1 + 0.04 * D) * (1 - span(t, g1 + 0.04 * D, g1 + 0.1 * D));
      const lean = span(t, T.lift[1] * D, T.open * D - 0.04 * D) * (1 - span(t, T.open * D + 0.1 * D, 0.86 * D));
      host.rig.dy = take * host.height * 0.02;
      host.rig.rot = 0.09 * lean + (lean > 0.5 && t < T.open * D ? Math.sin(play.t * 30) * 0.01 : 0);
    }

    // 2) 주머니: 고민 (들여다보는 주머니가 흔들), 고른 주머니를 떼어 탁자로, 흔들흔들 → 열기
    const p0 = T.ponder[0] * D;
    const p1 = T.ponder[1] * D;
    const hoverAt = t >= p0 && t < T.lift[0] * D ? (pl.hovers[Math.min(pl.hovers.length - 1, Math.floor(span(t, p0, p1) * pl.hovers.length))] ?? -1) : -1;
    this.pouches.forEach((p, i) => {
      const h = this.hang[i];
      if (h === undefined) return;
      const sway = Math.sin(play.t * 1.3 + i * 1.7) * 0.03;
      if (i !== pl.pick || t < T.lift[0] * D) {
        const hov = i === hoverAt ? 1 : 0;
        p.position.set(h.x, h.y);
        p.rotation = sway + hov * Math.sin(play.t * 12) * 0.12;
        p.scale.set(1 + hov * 0.08);
        p.alpha = 1;
        const s = this.strings[i];
        if (s !== undefined) s.alpha = 1;
        return;
      }
      this.placeOpened(p, pl, t, D, play.t);
      const s = this.strings[i];
      if (s !== undefined) s.alpha = 1 - span(t, T.lift[0] * D, T.lift[0] * D + 0.04 * D);
    });

    // 3) 연 뒤의 볼거리
    this.renderOpen(pl, t, D, play.seat);
  }

  /** 고른 주머니: 가로대에서 떼어 → 탁자로 → 흔들흔들 → 열림 (빈 주머니는 쭈그러든다). */
  private placeOpened(p: ArtNode, pl: Plan, t: number, D: number, clock: number): void {
    const h = this.hang[pl.pick];
    if (h === undefined) return;
    const l0 = T.lift[0] * D;
    const l1 = T.lift[1] * D;
    const op = T.open * D;
    const end = this.onTable;
    if (t < l1) {
      const u = span(t, l0, l1);
      const e = ease.inOutQuad(u);
      p.position.set(lerp(h.x, end.x, e), lerp(h.y, end.y, e) - Math.sin(Math.PI * u) * this.ph * 0.5 - span(t, l0, l0 + 0.03 * D) * this.ph * 0.1 * (1 - u));
      p.rotation = Math.sin(u * Math.PI * 2) * 0.15;
      p.scale.set(1);
      return;
    }
    p.position.set(end.x, end.y);
    // 닿을 때 찌그러짐
    const land = Math.max(0, 1 - (t - l1) / (0.05 * D));
    // 열기 전 흔들 (점점 빨리)
    const shake = span(t, l1 + 0.03 * D, op);
    const wob = t < op ? Math.sin(clock * (14 + shake * 26)) * 0.09 * shake : 0;
    // 열기: 톡 늘었다 돌아온다. 빈 주머니는 쭈그러든다.
    const pop = t >= op ? Math.max(0, 1 - (t - op) / (0.08 * D)) : 0;
    const empty = pl.content === 'empty' ? span(t, op, op + 0.1 * D) : 0;
    p.rotation = wob;
    p.scale.set(1 + land * 0.12 - pop * 0.08 + empty * 0.1, 1 - land * 0.14 + pop * 0.16 - empty * 0.2);
    // 기준점이 매듭 위라 줄어든 만큼 내려 바닥에 붙인다.
    p.y = end.y + this.ph * (1 - p.scale.y) * 0.95;
  }

  private renderOpen(pl: Plan, t: number, D: number, seat: number): void {
    const op = T.open * D;
    const sw = this.ctx.L.sw;
    const mouth = { x: this.onTable.x, y: this.onTable.y + this.ph * 0.12 };
    const s = t - op;
    // 금빛 햇살 (대박)
    const rays = pl.content === 'jackpot' && t >= op - 0.03 * D;
    this.rays.visible = rays;
    if (rays) {
      const k = clamp01((t - op + 0.03 * D) / (0.12 * D));
      this.drawRays(mouth.x, this.onTable.y + this.ph * 0.5, sw * 0.2 * ease.outBack(k), s * 0.8);
      this.rays.alpha = 0.7;
    }
    // 코인
    const floorY = this.ctx.L.feetY + this.ctx.L.bodyH * 0.12;
    this.coins.forEach((c, j) => {
      const coin = pl.coins[j];
      if (coin === undefined || s < coin.at) {
        c.visible = false;
        return;
      }
      const tau = s - coin.at;
      // 탁자 위에 떨어지는 코인은 탁자에서 (가장자리 밖으로 굴러가지 않게), 바깥은 바닥에서 튕긴다.
      const ground = coin.table ? this.table.surface + sw * 0.01 : floorY;
      const pos = toss(tau, mouth.x, mouth.y, coin.vx, coin.vy, this.g, ground, pl.content === 'one' ? 0.45 : 0.3, pl.content === 'one' ? 3 : 1);
      const edge = this.table.half * 0.92;
      const x = coin.table ? Math.max(this.table.x - edge, Math.min(this.table.x + edge, pos.x)) : pos.x;
      c.visible = true;
      c.position.set(x, pos.y - sw * 0.02);
      c.rotation = pos.rest ? 0 : tau * coin.spin;
      // 동전 하나: 처음엔 작게 톡, 내려오며 제 크기.
      c.scale.set(pl.content === 'one' ? lerp(0.6, 1, clamp01(tau / 0.25)) : 1);
      c.alpha = 1;
    });
    // 반짝이 (대박)
    this.sparkles.forEach((n, j) => {
      const sp = pl.sparkles[j];
      if (sp === undefined || s < sp.delay) {
        n.visible = false;
        return;
      }
      const u = clamp01((s - sp.delay) / (0.22 * D));
      n.visible = u < 1;
      n.position.set(mouth.x + Math.cos(sp.angle) * sp.dist * ease.outCubic(u), mouth.y + Math.sin(sp.angle) * sp.dist * ease.outCubic(u));
      n.scale.set(u < 0.3 ? u / 0.3 : 1 - (u - 0.3) * 0.6);
      n.alpha = u > 0.7 ? (1 - u) / 0.3 : 1;
      n.rotation = u * 2;
    });
    // 먼지 뭉치 (빈 주머니)
    this.puffs.forEach((p, j) => {
      if (pl.content !== 'empty' || s < j * 0.05 * D) {
        p.visible = false;
        return;
      }
      const u = clamp01((s - j * 0.05 * D) / (0.2 * D));
      p.visible = u < 1;
      const dir = j - 1;
      p.position.set(mouth.x + dir * sw * 0.06 * u, mouth.y - sw * (0.04 + 0.1 * ease.outCubic(u)));
      p.scale.set(lerp(0.35, 1.05 - j * 0.15, ease.outCubic(u)));
      p.alpha = u > 0.55 ? (1 - u) / 0.45 : 1;
    });
    // 빈 주머니: 손님 얼굴이 시무룩 (반응 이벤트가 오기 전에 바로).
    if (pl.content === 'empty' && s >= 0.04 * D && !pl.sadShown) {
      pl.sadShown = true;
      this.ctx.actor(seat)?.showPose('sad', Math.max(0.8, (1 - T.open) * D + 0.4));
    }
  }

  private drawRays(x: number, y: number, r: number, rot: number): void {
    const g = this.rays.clear();
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a0 = rot + (i / n) * Math.PI * 2;
      const a1 = a0 + Math.PI / n;
      g.poly([x, y, x + Math.cos(a0) * r, y + Math.sin(a0) * r, x + Math.cos(a1) * r, y + Math.sin(a1) * r]).fill({ color: i % 2 === 0 ? 0xffe27a : 0xfff3c2, alpha: 0.75 });
    }
    g.circle(x, y, r * 0.35).fill({ color: 0xfff6d8, alpha: 0.8 });
  }

  finish(play: Play): void {
    play.t = Math.max(play.t, SETTLE * play.D);
    this.render(play);
    this.mat.visible = false;
    this.ctx.actor(play.seat)?.setBubble(null);
    this.plan = null;
    this.hold = 1.6;
    this.back = 0;
  }

  idle(dt: number, time: number): void {
    // 끝난 한판: 열린 주머니와 코인을 잠깐 두었다가, 주머니는 가로대로 돌아오고 코인은 사라진다.
    if (this.hold > 0) {
      this.hold -= dt;
      if (this.rays.visible) this.rays.alpha = Math.max(0, this.rays.alpha - dt * 0.8);
    } else if (this.back < 1) {
      this.back = Math.min(1, this.back + dt / 0.5);
      const f = 1 - this.back;
      const p = this.pouches[this.lastPick];
      if (p !== undefined) p.alpha = f;
      for (const c of this.coins) if (c.visible) c.alpha = f;
      this.rays.alpha = Math.min(this.rays.alpha, f);
      if (this.back >= 1) {
        this.resetPouches();
        const p2 = this.pouches[this.lastPick];
        if (p2 !== undefined) {
          p2.alpha = 0;
          p2.scale.set(0.6);
        }
      }
      return;
    }
    // 가만히 흔들 (돌아온 주머니는 톡 나타난다).
    this.pouches.forEach((p, i) => {
      if (this.hold > 0 && i === this.lastPick) return;
      p.rotation = Math.sin(time * 1.3 + i * 1.7) * 0.03;
      if (p.alpha < 1) {
        p.alpha = Math.min(1, p.alpha + dt * 3);
        p.scale.set(Math.min(1, p.scale.x + dt * 1.5));
        const s = this.strings[i];
        if (s !== undefined) s.alpha = 1;
      }
    });
  }

  celebrate(tier: OutcomeTier): void {
    if (tier !== 'jackpot') return;
    // 대박: 가로대의 주머니들이 같이 통통.
    const hs = this.hang;
    void this.ctx.anim.run(0.7, (u) => {
      this.pouches.forEach((p, i) => {
        if (i === this.lastPick) return;
        const h = hs[i];
        if (h !== undefined) p.y = h.y - Math.abs(Math.sin(u * Math.PI * 3 + i)) * this.ph * 0.12 * (1 - u);
      });
    }, { ease: ease.linear });
  }

  destroy(): void {
    this.mat.destroy({ children: true });
    for (const c of this.coins) c.destroy({ children: true });
    for (const s of this.sparkles) s.destroy({ children: true });
    for (const p of this.puffs) p.destroy({ children: true });
    this.root.destroy({ children: true });
  }
}
