// 지도 위 보물찾기 마당. 표식(부스 그림 map/dig_sign)과 흙더미(props map/dirt_mound, 바닥층)는 buildings.ts.
// 쉬는 동안: 흙더미마다 삽(items/shovel)이 꽂혀 있다.
// 판 중: 손님이 자기 흙더미의 삽을 뽑아 들고 (삽 대여 언니가 들썩), 깊이 play.tracks[자리]가 1이 될 때까지 통통 삽질:
//   들어 올렸다 → 푹 (몸을 숙이고 흙더미에 흙먼지 fx_puff) → 흙을 뒤로 휙. 흙더미 앞 구덩이가 깊이만큼 커진다.
//   findAt에 무언가 튀어 올라 손님 머리 위에 떠 있다 (동전 주머니·보석은 반짝·코인, 헌 장화·조약돌은 축 처져 흔들). 삽은 다시 흙더미에.
//   상자를 판 손님: 구덩이에서 보물상자(map/treasure_chest)가 솟아올라 덜컹덜컹 → 뚜껑이 열리며(treasure_chest_open) 반짝이·코인·색종이, 뒤에 빛살.
//   아무도 못 찾은 상자: 보물 지도 할아버지(진행자 0)가 미리 그 자리로 걸어가 삽질해 꺼내 보여 준다 ('reveal'). 끝나면 제자리로 걸어 돌아간다.
// 판이 끝나 쉬면 나온 것·상자·구덩이는 스르르 사라진다. 모두 화면 시계(this.clock)의 함수, 노드는 미리 만들어 고쳐 쓴다.

import { Container, Graphics } from 'pixi.js';
import type { DigGeo } from '../../data/catalog.ts';
import type { Pt } from '../../data/map.ts';
import { ease } from '../../core/tween.ts';
import { trackAt } from '../../sim/group/core.ts';
import type { DigFind, GroupEntry, GroupPlay, GroupState } from '../../sim/types.ts';
import { ArtNode } from '../art.ts';
import type { ViewRect } from '../mapUtil.ts';
import { GroupMapBase, inEllipse, type GroupMapCtx } from './base.ts';
import { clamp01, crossed, NO_KEYS, PuppetSet, seated, smooth } from './ssireumPuppets.ts';

type DigPlay = Extract<GroupPlay, { kind: 'dig' }>;

const OUTLINE = 0x402c1c;
/** 삽 그림 배율 (손님 키의 반쯤). */
const SHOVEL_K = 0.085;
/** 머리 위에 뜨는 것의 기본 배율 (그림마다 FIND_ART.k / ITEM_K를 노드 배율로). */
const ITEM_K = 0.08;
const CHEST_K = 0.18;
/** 머리 위에 떠 있는 것 (그룹, key, 배율, 좋은 것인가). 상자는 따로. */
const FIND_ART: Record<Exclude<DigFind, 'none' | 'chest'>, { group: string; key: string; k: number; good: boolean; color: number }> = {
  coins: { group: 'items', key: 'coin_pile', k: 0.11, good: true, color: 0xf3d36a },
  gem: { group: 'items', key: 'gem', k: 0.1, good: true, color: 0x8ec8ee },
  boot: { group: 'items', key: 'old_boot', k: 0.1, good: false, color: 0x8a6a50 },
  pebble: { group: 'objects', key: 'pebble', k: 0.14, good: false, color: 0xb3aea8 },
};
/** 삽질 한 번 (초). */
const DIG_PERIOD = 0.56;
/** 흙더미에서 삽을 뽑아 들기·다시 꽂기 (초). */
const GRAB = 0.3;
/** 솟아오른 것이 머리 위에 닿기까지 (초). */
const POP = 0.5;
/** 상자가 솟아오르기·뚜껑 열기 (나온 때부터 초). */
const CHEST_RISE = 0.45;
const CHEST_OPEN = 1.05;
/** 할아버지: 걷는 빠르기 (세계 px/초), 상자를 파는 시간. */
const WALK_SPEED = 240;
const GRANDPA_DIG = 0.9;
/** 판이 끝난 뒤 나온 것들이 사라지는 시간. */
const FADE = 0.5;
/** 진행자 자리. */
const GRANDPA = 0;
const LENDER = 1;

/** 판 자리 하나 (흙더미). */
interface Spot {
  readonly at: Pt;
  readonly shovel: ArtNode;
  readonly item: ArtNode;
  /** 그림마다 배율 (FIND_ART.k / ITEM_K). */
  itemK: number;
  good: boolean;
}

/** 할아버지 걸음 계획 (판마다, 상자를 아무도 못 찾았을 때만). */
interface Walk {
  active: boolean;
  /** 서서 팔 자리. */
  tx: number;
  ty: number;
  /** 걷기 시작·파기 시작·꺼내는 때 (화면 시계). */
  t0: number;
  t1: number;
  t2: number;
  /** 돌아가기: 시작한 누적 초 (-1 = 아님)와 출발점. */
  backAt: number;
  bx: number;
  by: number;
  /** 할아버지를 움직이는 중 (원래 자리로 돌려놓아야 한다). */
  moved: boolean;
}

export class DigMapView extends GroupMapBase {
  /** 보물찾기 마당 (세계 좌표, 만들 때 놓인 자리). */
  private readonly D: DigGeo = this.ctx.sim.village().dig();
  private readonly bodies: PuppetSet;
  private readonly spots: Spot[] = [];
  /** 구덩이 (상자가 묻힐 수 있는 곳마다: 앞 여섯 = 판 자리). */
  private readonly holes: Graphics[] = [];
  /** 구덩이 가운데와 상자 자리 (this.D.chests 순서, 미리 잰다). */
  private readonly holePts: Pt[];
  private readonly chestPts: Pt[];
  /** 이번 판에 할아버지가 상자를 꺼내는 때 (-1 = 없음). */
  private revealAt = -1;
  private readonly chest: ArtNode;
  private readonly rays: Graphics;
  private readonly grandShovel: ArtNode;
  private chestOpen = false;
  private prevClock = 0;
  /** 판이 끝나고 지난 초 (판 중 = -1). */
  private fadeT = -1;
  /** 끝난 판 (사라지는 동안 보여 준다)과 끝날 때의 화면 시계. */
  private last: DigPlay | null = null;
  private lastEnd = 0;
  private readonly walk: Walk = { active: false, tx: 0, ty: 0, t0: 0, t1: 0, t2: 0, backAt: -1, bx: 0, by: 0, moved: false };

  constructor(ctx: GroupMapCtx) {
    super(ctx);
    this.bodies = new PuppetSet(ctx.monsters);
    const L = ctx.layers;
    this.holePts = this.D.chests.map((c, i) => (i < this.D.spots.length ? { x: c.x - 8, y: c.y - 16 } : { x: c.x, y: c.y - 2 }));
    this.chestPts = this.D.chests.map((c, i) => (i < this.D.spots.length ? { x: c.x - 22, y: c.y + 14 } : { x: c.x, y: c.y + 10 }));
    // 구덩이: 바닥층 (흙더미 그림 위). 원점 = 구덩이 가운데.
    for (let i = 0; i < this.D.chests.length; i++) {
      const p = this.holeAt(i);
      const h = new Graphics()
        .ellipse(0, 3, 30, 12)
        .fill({ color: 0x8a5a34, alpha: 0.55 })
        .ellipse(0, 0, 22, 9)
        .fill(0x5a3a22)
        .stroke({ color: OUTLINE, width: 2.5 })
        .ellipse(0, 2, 13, 5)
        .fill(0x3a2414);
      h.position.set(p.x, p.y);
      h.visible = false;
      this.holes.push(this.own(L.floor, h));
    }
    // 상자 뒤 빛살 (바닥층, 천천히 돈다).
    this.rays = new Graphics();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const w = 0.16;
      this.rays.poly([0, 0, Math.cos(a - w) * 120, Math.sin(a - w) * 120, Math.cos(a + w) * 120, Math.sin(a + w) * 120]).fill({ color: 0xffe27a, alpha: 0.55 });
    }
    this.rays.visible = false;
    this.own(L.floor, this.rays);
    // 판 자리마다 삽과 나온 것 (나온 것은 효과층: 손님 위).
    for (let i = 0; i < this.D.spots.length; i++) {
      const at = this.D.spots[i] as Pt;
      const shovel = new ArtNode({ k: SHOVEL_K, anchor: 'center', placeholder: { w: 560, h: 560, color: 0xb0aaa0 } });
      shovel.setArt('items', 'shovel');
      this.own(L.objects, shovel);
      const item = new ArtNode({ k: ITEM_K, anchor: 'center', placeholder: { w: 420, h: 380, color: 0xd9a441 } });
      this.own(L.effects, item);
      item.visible = false;
      const s: Spot = { at, shovel, item, itemK: 1, good: false };
      this.spots.push(s);
      this.plant(s);
    }
    this.chest = new ArtNode({ k: CHEST_K, anchor: 'bottom', placeholder: { w: 480, h: 400, color: 0xb07a40 } });
    this.chest.setArt('map', 'treasure_chest');
    this.chest.visible = false;
    this.own(L.objects, this.chest);
    this.grandShovel = new ArtNode({ k: SHOVEL_K, anchor: 'center', placeholder: { w: 560, h: 560, color: 0xb0aaa0 } });
    this.grandShovel.setArt('items', 'shovel');
    this.grandShovel.visible = false;
    this.own(L.objects, this.grandShovel);
  }

  /** 구덩이 가운데 (판 자리는 흙더미 앞쪽 비탈, 그 밖은 땅). */
  private holeAt(i: number): Pt {
    return this.holePts[i] ?? this.D.center;
  }

  /** 상자가 놓이는 곳 (발 = 아래 가운데). */
  private chestAt(i: number): Pt {
    return this.chestPts[i] ?? this.D.center;
  }

  protected override onShown(show: boolean): void {
    super.onShown(show);
    if (!show) {
      this.bodies.clear();
      this.homeGrandpa();
    }
    // 판 사이에 숨는 것은 숨긴 채로.
    this.chest.visible = false;
    this.rays.visible = false;
    this.grandShovel.visible = false;
    for (const h of this.holes) h.visible = false;
    for (const s of this.spots) s.item.visible = false;
  }

  protected override onPlay(p: GroupPlay | null, prev: GroupPlay | null): void {
    if (p === null) {
      // 끝난 판은 마지막 화면 시계에서 이어 흐르며 사라진다.
      this.lastEnd = this.prevClock;
      this.prevClock = this.lastEnd;
      this.last = prev !== null && prev.kind === 'dig' ? prev : null;
      this.fadeT = 0;
      if (this.walk.active) this.startBack();
      return;
    }
    this.prevClock = this.clock;
    this.fadeT = -1;
    this.last = null;
    if (p.kind !== 'dig') return;
    // 나온 것 그림을 판마다 한 번 정한다.
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i] as Spot;
      const f = p.finds[i] ?? 'none';
      if (f === 'none' || f === 'chest') continue;
      const a = FIND_ART[f];
      s.good = a.good;
      s.itemK = a.k / ITEM_K;
      s.item.setArt(a.group, a.key);
    }
    this.revealAt = p.found || p.chest < 0 ? -1 : (p.events.find((e) => e.type === 'reveal')?.t ?? -1);
    this.chestOpen = false;
    this.chest.setArt('map', 'treasure_chest');
    this.planWalk(p);
  }

  /** 아무도 못 찾은 상자: 할아버지가 걸어가서 판다 (reveal 시각에 꺼낸다). */
  private planWalk(p: DigPlay): void {
    const w = this.walk;
    w.active = false;
    const host = this.ctx.buildings.hostNode(this.booth, GRANDPA);
    if (this.revealAt < 0 || host === null) return;
    const c = this.chestAt(p.chest);
    w.tx = c.x + 50;
    w.ty = c.y - 4;
    const from = w.moved ? { x: host.node.x, y: w.ty } : host.at;
    const dur = Math.min(3, Math.max(0.6, Math.hypot(w.tx - from.x, w.ty - from.y) / WALK_SPEED));
    w.t2 = this.revealAt;
    w.t1 = this.revealAt - GRANDPA_DIG;
    w.t0 = Math.max(0.2, w.t1 - dur);
    w.backAt = -1;
    w.active = true;
  }

  private startBack(): void {
    const host = this.ctx.buildings.hostNode(this.booth, GRANDPA);
    const w = this.walk;
    w.active = false;
    if (host === null || !w.moved) return;
    w.backAt = this.time;
    w.bx = host.node.x;
    w.by = w.ty;
  }

  protected draw(dt: number, _view: ViewRect): void {
    const g = this.group;
    const live = this.play !== null && this.play.kind === 'dig' ? this.play : null;
    const play = live ?? this.last;
    const t = live !== null ? this.clock : play !== null ? this.lastEnd + Math.max(0, this.fadeT) : 0;
    const prev = this.prevClock;
    this.prevClock = t;
    // 시작 숫자 3·2·1 (보물찾기 표식 위, 삽 대여 통통).
    this.startCount(this.spot.base.x, this.spot.base.y - 240, LENDER);
    if (this.fadeT >= 0) this.fadeT += dt;
    const fade = this.fadeT < 0 ? 1 : 1 - smooth(this.fadeT / FADE);
    if (fade <= 0 && this.last !== null) this.last = null;
    // 삽: 기본은 흙더미에 꽂혀 있다.
    for (let i = 0; i < this.spots.length; i++) this.plant(this.spots[i] as Spot);
    if (live !== null && g !== null) this.diggers(g, live, t, prev);
    if (play !== null && fade > 0) {
      this.drawHoles(play, t, fade);
      this.drawFinds(play, t, prev, fade);
      this.drawChest(play, t, prev, fade);
    } else {
      for (let i = 0; i < this.holes.length; i++) (this.holes[i] as Graphics).visible = false;
      for (let i = 0; i < this.spots.length; i++) (this.spots[i] as Spot).item.visible = false;
      this.chest.visible = false;
      this.rays.visible = false;
    }
    this.bodies.flush(dt);
    this.grandpa(live, t, prev);
    if (crossed(prev, t, 0.1) && live !== null) this.ctx.buildings.hostHop(this.booth, LENDER, 1);
  }

  /** 흙더미 꼭대기에 꽂힌 삽. */
  private plant(s: Spot): void {
    const sh = s.shovel;
    sh.visible = true;
    sh.scale.set(-1, 1);
    sh.position.set(s.at.x + 10, s.at.y - 44);
    sh.rotation = -0.5;
    sh.zIndex = s.at.y - 2;
  }

  /** 삽질하는 손님 (몸과 삽). */
  private diggers(g: GroupState, play: DigPlay, t: number, prev: number): void {
    for (let i = 0; i < g.participants.length; i++) {
      const e = g.participants[i] as GroupEntry;
      const s = this.spots[e.pick];
      const m = this.monster(e.monster);
      const v = this.view(e.monster);
      if (s === undefined || v === undefined || !seated(m, this.booth, e.seat)) continue;
      const keys = play.tracks[e.pick] ?? NO_KEYS;
      const start = keys[1]?.t ?? 0.35;
      const at = play.findAt[e.pick] ?? play.end;
      // 삽을 뽑기 전·다시 꽂은 뒤에는 몸을 맡기지 않는다 (응원 반응이 그대로 보인다).
      const grab = clamp01((t - (start - GRAB)) / GRAB);
      const back = clamp01((t - at) / GRAB);
      if (grab <= 0 || back >= 1) continue;
      const b = this.bodies.take(e.monster);
      b.facing = -1;
      const seat = this.spot.seats[e.seat] ?? s.at;
      let shRot = -0.15;
      let shX = 0;
      let shY = 0;
      if (t >= start && t < at) {
        // 삽질 한 번: 들어 올림(0~0.35) → 푹(0.35~0.55) → 흙을 뒤로 휙(0.55~1).
        const ph = ((t - start) / DIG_PERIOD + e.pick * 0.37) % 1;
        if (ph < 0.35) {
          const u = ph / 0.35;
          b.rot = 0.08 * u;
          b.lift = 2 * u;
          shRot = 0.1 + 0.25 * u;
          shY = -10 * u;
        } else if (ph < 0.55) {
          const u = ease.inQuad((ph - 0.35) / 0.2);
          b.rot = 0.08 - 0.32 * u;
          b.sy = 1 - 0.07 * u;
          b.sx = 1 + 0.04 * u;
          shRot = 0.35 - 0.95 * u;
          shX = -14 * u;
          shY = -10 + 26 * u;
        } else {
          const u = ease.outQuad((ph - 0.55) / 0.45);
          b.rot = -0.24 + 0.24 * u;
          b.sy = 0.93 + 0.07 * u;
          b.sx = 1.04 - 0.04 * u;
          b.lift = Math.sin(u * Math.PI) * 5;
          shRot = -0.6 + 0.7 * u;
          shX = -14 + 14 * u;
          shY = 16 - 16 * u;
        }
        // 푹: 흙먼지.
        const pph = ((prev - start) / DIG_PERIOD + e.pick * 0.37) % 1;
        if (prev >= start && pph < 0.55 && ph >= 0.55) {
          const h = this.holeAt(e.pick);
          this.ctx.fx.puff(h.x - 4, h.y + 2, 3, 30);
        }
      }
      // 삽: 손에 (뽑을 때·꽂을 때는 흙더미와 손 사이).
      const hx = seat.x + b.dx;
      const hy = seat.y;
      const lx = -v.halfW * 0.5;
      const ly = -v.headH * 0.4;
      const cs = Math.cos(b.rot);
      const sn = Math.sin(b.rot);
      const handX = hx + lx * cs - ly * sn + shX;
      const handY = hy + lx * sn + ly * cs - b.lift + shY;
      const k = back > 0 ? 1 - back : smooth(grab);
      const sh = s.shovel;
      const px = sh.x;
      const py = sh.y;
      sh.position.set(px + (handX - 6 - px) * k, py + (handY + 8 - py) * k);
      sh.rotation = -0.5 + (shRot + 0.5) * k;
      sh.zIndex = k > 0.5 ? seat.y + 1 : s.at.y - 2;
      // 막 뽑은 삽: 흙 조금.
      if (crossed(prev, t, start - GRAB)) this.ctx.fx.puff(s.at.x + 6, s.at.y - 30, 2, 18);
    }
  }

  /** 구덩이: 판 깊이만큼 (상자 자리는 할아버지가 판 만큼). */
  private drawHoles(play: DigPlay, t: number, fade: number): void {
    for (let i = 0; i < this.holes.length; i++) {
      const h = this.holes[i] as Graphics;
      let d = 0;
      if (i < this.spots.length) d = trackAt(play.tracks[i] ?? NO_KEYS, t);
      if (i === play.chest && this.revealAt >= 0) d = Math.max(d, clamp01((t - (this.revealAt - GRANDPA_DIG)) / GRANDPA_DIG));
      h.visible = d > 0.02;
      if (!h.visible) continue;
      const s = (0.3 + 0.7 * d) * (0.6 + 0.4 * fade);
      h.scale.set(s, s);
      h.alpha = fade;
    }
  }

  /** 나온 것: 구덩이에서 머리 위로 톡, 그 뒤 둥실 (손님을 따라간다). */
  private drawFinds(play: DigPlay, t: number, prev: number, fade: number): void {
    const fx = this.ctx.fx;
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i] as Spot;
      const f = play.finds[i] ?? 'none';
      const at = play.findAt[i] ?? -1;
      const node = s.item;
      if (f === 'none' || f === 'chest' || at < 0 || t < at) {
        node.visible = false;
        continue;
      }
      // 판 손님 (떠났으면 그 자리 위에서 사라진다).
      const e = this.digger(i);
      const v = e === undefined ? undefined : this.view(e.monster);
      const m = e === undefined ? undefined : this.monster(e.monster);
      const here = e !== undefined && seated(m, this.booth, e.seat);
      const seat = this.spot.seats[i] ?? s.at;
      const gx = v !== undefined && here ? v.x : seat.x;
      const gy = (v !== undefined && here ? v.y - v.headH : seat.y - 100) - 22;
      const hole = this.holeAt(i);
      const u = t - at;
      node.visible = true;
      node.alpha = fade * (here || u < POP ? 1 : 0.6);
      if (u < POP) {
        const k = u / POP;
        node.position.set(hole.x + (gx - hole.x) * k, hole.y + (gy - hole.y) * k - Math.sin(k * Math.PI) * 60);
        node.scale.set((0.35 + 0.65 * ease.outBack(k)) * s.itemK);
        node.rotation = (1 - k) * (s.good ? 6.3 : 4);
      } else {
        const w = u - POP;
        node.position.set(gx, gy - Math.sin(this.time * 3 + i) * 4 - 6 * (1 - fade));
        node.scale.set((1 + 0.12 * Math.max(0, 1 - w / 0.25)) * s.itemK);
        // 좋은 것은 반듯이 반짝, 헌 장화·조약돌은 축 처져 흔들.
        node.rotation = s.good ? Math.sin(this.time * 2.4 + i) * 0.08 : 0.35 + Math.sin(this.time * 1.6 + i) * 0.12;
      }
      if (crossed(prev, t, at)) fx.puff(hole.x, hole.y, 4, 34);
      if (crossed(prev, t, at + POP)) {
        if (s.good) {
          fx.sparkles(gx, gy, 6, 36);
          if (f === 'coins') fx.coinSpray(gx, gy, 5);
        } else {
          fx.puff(gx, gy + 6, 3, 22);
        }
      }
    }
  }

  /** 상자: 판 손님이 찾았으면 그 흙더미에서, 아니면 할아버지가 판 자리에서 솟아올라 열린다. */
  private drawChest(play: DigPlay, t: number, prev: number, fade: number): void {
    const c = this.chest;
    const r = play.found ? play.findAt[play.chest] : this.revealAt;
    if (play.chest < 0 || r === undefined || r < 0 || t < r) {
      c.visible = false;
      this.rays.visible = false;
      return;
    }
    const fx = this.ctx.fx;
    const at = this.chestAt(play.chest);
    const u = t - r;
    c.visible = true;
    c.alpha = fade;
    c.zIndex = at.y;
    if (u < CHEST_RISE) {
      const k = u / CHEST_RISE;
      c.position.set(at.x, at.y + 14 * (1 - k));
      c.scale.set(ease.outBack(k));
      c.rotation = Math.sin(u * 40) * 0.08 * (1 - k);
    } else if (u < CHEST_OPEN) {
      // 덜컹덜컹.
      c.position.set(at.x, at.y);
      c.rotation = Math.sin(this.time * 32) * 0.06;
      c.scale.set(1 + 0.04 * Math.sin(this.time * 24), 1 - 0.04 * Math.sin(this.time * 24));
    } else {
      const w = u - CHEST_OPEN;
      c.position.set(at.x, at.y);
      c.rotation = 0;
      const pop = Math.max(0, 1 - w / 0.3);
      c.scale.set(1 + 0.12 * pop, 1 - 0.08 * pop + 0.1 * Math.sin(Math.min(1, w / 0.3) * Math.PI));
    }
    const open = u >= CHEST_OPEN;
    if (open !== this.chestOpen) {
      this.chestOpen = open;
      c.setArt('map', open ? 'treasure_chest_open' : 'treasure_chest');
    }
    // 빛살: 열린 뒤 천천히 돈다.
    this.rays.visible = open;
    if (open) {
      const w = u - CHEST_OPEN;
      this.rays.position.set(at.x, at.y - 30);
      this.rays.rotation = this.time * 0.6;
      this.rays.scale.set((0.7 + 0.3 * smooth(w / 0.4)) * (1 + 0.05 * Math.sin(this.time * 5)), 0.55 * (0.7 + 0.3 * smooth(w / 0.4)));
      this.rays.alpha = fade * smooth(w / 0.3);
    }
    if (crossed(prev, t, r)) fx.puff(at.x, at.y - 6, 10, 70);
    if (crossed(prev, t, r + CHEST_OPEN)) {
      fx.sparkles(at.x, at.y - 50, 14, 70);
      fx.coinSpray(at.x, at.y - 40, 10);
      fx.confetti(at.x, at.y - 40, 22);
      this.ctx.buildings.hostHop(this.booth, GRANDPA, 1.4);
      this.ctx.buildings.hostHop(this.booth, LENDER, 1);
    }
  }

  /** 판 자리 i를 판 참가자. */
  private digger(i: number): GroupEntry | undefined {
    const g = this.group;
    if (g === null) return undefined;
    for (let k = 0; k < g.participants.length; k++) {
      const e = g.participants[k] as GroupEntry;
      if (e.pick === i) return e;
    }
    return undefined;
  }

  // ── 할아버지 ──

  /** 할아버지: 상자 자리로 걸어가 파고, 끝나면 돌아간다. */
  private grandpa(live: DigPlay | null, t: number, prev: number): void {
    const host = this.ctx.buildings.hostNode(this.booth, GRANDPA);
    const w = this.walk;
    const sh = this.grandShovel;
    sh.visible = false;
    if (host === null || !host.node.visible) {
      if (w.moved) this.homeGrandpa();
      return;
    }
    const n = host.node;
    const home = host.at;
    if (w.backAt >= 0) {
      // 제자리로 걸어 돌아간다.
      const dist = Math.hypot(home.x - w.bx, home.y - w.by);
      const dur = Math.max(0.5, dist / WALK_SPEED);
      const k = (this.time - w.backAt) / dur;
      if (k >= 1) {
        this.homeGrandpa();
        return;
      }
      this.placeGrandpa(n, w.bx + (home.x - w.bx) * k, w.by + (home.y - w.by) * k, home.x >= w.bx ? 1 : -1, this.time * 9);
      return;
    }
    if (!w.active || live === null || t < w.t0) return;
    if (t < w.t1) {
      const k = smooth((t - w.t0) / (w.t1 - w.t0));
      this.placeGrandpa(n, home.x + (w.tx - home.x) * k, home.y + (w.ty - home.y) * k, w.tx >= home.x ? 1 : -1, t * 9);
      return;
    }
    // 파기 → 꺼낸 뒤 두 번 폴짝.
    let y = w.ty;
    let rot = 0;
    if (t < w.t2) {
      const ph = ((t - w.t1) / 0.45) % 1;
      rot = ph < 0.5 ? -0.18 * Math.sin(ph * 2 * Math.PI) : 0;
      sh.visible = true;
      sh.scale.set(-1, 1);
      sh.position.set(w.tx - 30 - 8 * Math.sin(ph * Math.PI), w.ty - 46 + 14 * Math.sin(ph * Math.PI));
      sh.rotation = -0.2 - 0.6 * Math.sin(ph * Math.PI);
      sh.zIndex = w.ty + 1;
      const pph = ((prev - w.t1) / 0.45) % 1;
      if (prev >= w.t1 && pph < 0.5 && ph >= 0.5) this.ctx.fx.puff(w.tx - 50, w.ty - 4, 3, 30);
    } else {
      const u = t - w.t2 - CHEST_OPEN;
      // 두 번 폴짝 (0.9초).
      if (u > 0 && u < 0.9) y -= Math.abs(Math.sin((u / 0.9) * 2 * Math.PI)) * 16;
    }
    this.placeGrandpa(n, w.tx, y, -1, -1, rot);
  }

  /** 할아버지 그림을 (x, y)에. face = 1 오른쪽을 본다. stepPhase ≥ 0이면 걷는 통통. */
  private placeGrandpa(n: Container, x: number, y: number, face: 1 | -1, stepPhase: number, rot = 0): void {
    this.walk.moved = true;
    const bob = stepPhase >= 0 ? Math.abs(Math.sin(stepPhase)) * 5 : 0;
    n.x = x;
    n.y = y - bob;
    n.zIndex = Math.round(y);
    n.rotation = rot + (stepPhase >= 0 ? Math.sin(stepPhase) * 0.05 : 0);
    // buildings.ts가 매 프레임 배율(숨쉬기)을 정한다: 바라보는 쪽만 고친다 (그림은 왼쪽을 본다).
    n.scale.x = Math.abs(n.scale.x) * (face === 1 ? -1 : 1);
    n.culled = false;
  }

  /** 할아버지를 제자리로 (buildings.ts가 다시 맡는다). */
  private homeGrandpa(): void {
    const w = this.walk;
    w.backAt = -1;
    w.active = false;
    if (!w.moved) return;
    w.moved = false;
    const host = this.ctx.buildings.hostNode(this.booth, GRANDPA);
    if (host === null) return;
    host.node.x = host.at.x;
    host.node.zIndex = host.at.y;
    host.node.rotation = 0;
  }

  override hitTest(wx: number, wy: number): boolean {
    const c = this.D.center;
    return inEllipse(wx, wy, c.x, c.y, 430, 250);
  }

  override destroy(): void {
    this.bodies.clear();
    this.homeGrandpa();
    super.destroy();
  }
}
