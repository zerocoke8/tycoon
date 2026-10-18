// 지도 위 놀이기구 (다섯째 묶음, DESIGN 3.8): 회전목마 (carousel)·관람차 (ferris_wheel). 손님을 그리기 전에 돌린다 (world.ts, shops.ts 다음).
// 가게 주인 (표 파는 사람)은 shops.ts ShopsView가 세우고, 여기는 놀이기구 그림·탄 손님만. sim은 읽기만 한다.
//
// 회전목마: 판 그림(map/carousel_base) 하나를 물체층의 여러 겹으로 나눠 그린다 (같은 텍스처의 네모 조각, ridesKit.sliceSprite).
//   통째 그림 (판·뒤 기둥) → 뒤쪽 목마 → 가운데 기둥 (판 가운데 y) → 옆 기둥 → 앞쪽 목마 → 앞 기둥 → 지붕 (판 앞 끝 y: 뒤쪽 탄 손님 머리는 지붕 밑으로).
//   목마 (racers/carousel_horse, 왼쪽을 본다)는 타원을 돌며 (sim/shops.ts carouselAngle) 위아래로 오르내리고 (이웃 목마는 엇갈려), 옆으로 돌 때는 좁아진다.
//   목마 막대는 판에서 지붕 끝까지 코드로 이어 그린다 (목마가 오르내려도 막대는 그대로). 탄 손님 = 자리 i의 목마 위 안장 (몸 맡기기 puppet: 올라탈 때 톡, 내릴 때 사뿐).
//   도는 동안 지붕 꼭대기에서 음표가 퐁퐁, 출발하면 주인이 종을 치듯 통통.
// 관람차: 바퀴 (objects/ferris_wheel, 돌린다) → 다리 (map/ferris_frame: 앞 버팀대·축 뚜껑·표 파는 집이 바퀴 앞) → 탄 손님 → 곤돌라 (objects/ferris_gondola, 늘 똑바로 매달려 살랑).
//   곤돌라 창은 그림에서 비어 있어 (알파 0) 탄 손님이 곤돌라 뒤에서 창으로 보인다 (몸이 작게, 머리·어깨만 창에). 타면 땅에서 퐁 사라져 곤돌라에서 톡 나타나고, 내리면 거꾸로.
//   꼭대기를 지나는 손님은 한 바퀴에 한 번 반짝·하트 (마을이 한눈에).

import { Container, Graphics, type Sprite } from 'pixi.js';
import type { CarouselGeo, FerrisGeo } from '../data/catalog.ts';
import type { ShopId } from '../data/defs.ts';
import type { Pt } from '../data/map.ts';
import type { SimApi } from '../sim/api.ts';
import { carouselAngle, ferrisAngle, rideProgress } from '../sim/shops.ts';
import type { Monster, MonsterId, ShopState } from '../sim/types.ts';
import { ArtNode } from './art.ts';
import type { FxLayer } from './fx.ts';
import { boxHits, type Box, type ViewRect } from './mapUtil.ts';
import type { MonstersView } from './monsterView.ts';
import { Borrow, artFrame, backOut, destroySlice, framePt, sliceSprite, smooth, type ArtFrame, type PxRect } from './ridesKit.ts';
import { Bits } from './shopsFx.ts';
import type { ShopsView } from './shops.ts';

const OUTLINE = 0x201109;
/** 목마 막대 색 (그림 racers/carousel_horse의 막대에서 잰 것). */
const POLE_YELLOW = 0xf3c868;
/** 막대 굵기 (세계 px): 테두리 포함·속. */
const POLE_W = 7.2;
const POLE_IN = 3.2;

// ── 회전목마 (map/carousel_base 그림 px, 552×720) ──

/** 목마 그림 기준점 (캔버스): 막대 아래 끝 (그림 racers/carousel_horse의 막대 가운데). */
const HORSE_FOOT: Pt = { x: 507, y: 830 };
/** 목마 그림 막대 위 끝 (캔버스 y). */
const HORSE_TOP = 205;
/** 안장 (막대 아래 끝에서, 목마 그림이 왼쪽을 볼 때, 캔버스 px): 탄 손님 발이 앉는 점. */
const HORSE_SADDLE: Pt = { x: 57, y: -290 };
/** 탄 손님 몸 배율 (폰 배율 0.4에서도 누가 탔는지 보이게). */
const CAROUSEL_RIDER = 0.7;
/** 올라탈 때·내릴 때 초. */
const MOUNT_SEC = 0.32;
/** 옆으로 돌 때 가장 좁은 폭 (목마·탄 손님 scale.x). */
const SIDE_SQUASH = 0.62;
/**
 * 판 그림을 겹으로 나누는 네모 (그림 px)와 앞뒤 (z = 판 가운데 y + dz, 세계 px). 그림에서 잰 것:
 * 지붕 = 위에서 기둥 머리까지, 가운데 기둥, 앞 기둥 둘 (아래 끝 구슬 위까지), 옆 기둥 둘. 뒤 기둥·판·구슬은 통째 그림 (맨 뒤).
 */
const CAROUSEL_SLICES: readonly { readonly r: PxRect; readonly dz: number }[] = [
  { r: { x: 0, y: 0, w: 552, h: 394 }, dz: 54 },
  { r: { x: 247, y: 392, w: 54, h: 124 }, dz: 0 },
  { r: { x: 131, y: 392, w: 30, h: 202 }, dz: 45 },
  { r: { x: 396, y: 392, w: 29, h: 202 }, dz: 45 },
  { r: { x: 43, y: 344, w: 34, h: 172 }, dz: 30 },
  { r: { x: 479, y: 344, w: 34, h: 172 }, dz: 30 },
];
/** 지붕 아래 끝 (그림 px): 가운데 x·y, 반폭·가장자리에서 올라가는 높이 (목마 막대가 지붕 밑으로 들어가는 선). */
const CANOPY_EDGE = { cx: 276, y: 392, half: 250, rise: 60 } as const;
/** 음표가 뜨는 지붕 꼭대기 (그림 px). */
const CAROUSEL_TOP: Pt = { x: 276, y: 110 };

// ── 관람차 ──

/**
 * 다리 그림 (map/ferris_frame, 720×624)의 표 파는 집: 곤돌라보다 앞에 따로 그린다 (맨 아래 곤돌라가 집 안에 매달린 것처럼 보이지 않게).
 * 깃발, 세모 지붕은 띠 셋 (옆 다리를 덜 잘라 오게), 몸통. 그림에서 잰 것 (겹치지 않게: 겹치면 테두리가 두 번 그려진다).
 */
const FERRIS_BOOTH: readonly PxRect[] = [
  { x: 342, y: 288, w: 96, h: 64 },
  { x: 305, y: 352, w: 110, h: 34 },
  { x: 262, y: 386, w: 196, h: 29 },
  { x: 237, y: 415, w: 250, h: 28 },
  { x: 247, y: 443, w: 228, h: 181 },
];
/** 곤돌라 창 (곤돌라 그림 고리 FERRIS_GEO.hook에서, 캔버스 px): 가운데 x, 위 끝 y, 높이. */
const GONDOLA_WINDOW = { dx: -26, top: 318, h: 190 } as const;
/** 곤돌라에 탄 손님: 몸 높이 = 창 높이 × 이만큼 (머리가 창을 채우고, 아래는 곤돌라 아래판 뒤: 폰 배율에서도 빈 곤돌라와 다르게). */
const FERRIS_RIDER_H = 2.05;
const FERRIS_RIDER_MAX = 0.76;
/** 떠다니는 종의 둥실 높이 (monsterView HOVER와 같게: still 몸 맡기기가 올린다). */
const HOVER = 16;
/** 꼭대기 (각도 -π/2) 둘레 이만큼 안에서 한 바퀴에 한 번 반짝. */
const TOP_ARC = 0.3;
const POP_SEC = 0.28;

interface Horse {
  readonly c: Container;
  readonly pole: Graphics;
  readonly art: ArtNode;
  x: number;
  y: number;
  flip: number;
  sq: number;
  bob: number;
}

interface CarouselView {
  readonly placedId: number;
  readonly geo: CarouselGeo;
  readonly frame: ArtFrame | null;
  readonly base: ArtNode;
  readonly slices: Sprite[];
  readonly horses: Horse[];
  readonly box: Box;
  readonly hit: Box;
  /** 지붕 아래 끝 (세계 x → y). */
  readonly edgeY: (x: number) => number;
}

interface Gondola {
  readonly node: ArtNode;
  x: number;
  y: number;
}

interface FerrisView {
  readonly placedId: number;
  readonly geo: FerrisGeo;
  /** 다리 그림 아래 끝 y (곤돌라·탄 손님 앞뒤 기준). */
  readonly base: number;
  readonly wheel: ArtNode;
  readonly frame: ArtNode;
  /** 표 파는 집 조각 (곤돌라 앞). */
  readonly booth: Sprite[];
  readonly gondolas: Gondola[];
  readonly box: Box;
  readonly hit: Box;
}

/** 탄 손님 하나 (올라타기·내리기 연출 시계). */
interface Rider {
  readonly shop: 'carousel' | 'ferris_wheel';
  readonly slot: number;
  t: number;
  /** 이번 프레임에 봤나 (안 보이면 내림 연출 뒤 지운다). */
  seen: boolean;
  /** 내리는 중 (초, 0 이상이면). */
  off: number;
  /** 마지막으로 탄 자리 (세계 좌표: 목마 안장·곤돌라 고리). */
  lx: number;
  ly: number;
  /** 이번 바퀴에 꼭대기 반짝을 했나. */
  top: boolean;
}

export interface RideLayers {
  readonly objects: Container;
  readonly effects: Container;
}

export class RidesView {
  private readonly sim: SimApi;
  private readonly layers: RideLayers;
  private readonly fx: FxLayer;
  private readonly monsters: MonstersView;
  private readonly shops: ShopsView;
  private readonly borrow: Borrow;
  private readonly notes = new Bits(16);
  private carousel: CarouselView | null = null;
  private ferris: FerrisView | null = null;
  private readonly riders = new Map<MonsterId, Rider>();
  private placeStamp = -1;
  private time = 0;
  private noteT = 0;
  /** 주인 통통 (출발 신호, 남은 초). */
  private readonly ownerHop: Record<'carousel' | 'ferris_wheel', number> = { carousel: 0, ferris_wheel: 0 };
  private readonly offs: (() => void)[] = [];

  constructor(sim: SimApi, layers: RideLayers, fx: FxLayer, monsters: MonstersView, shops: ShopsView) {
    this.sim = sim;
    this.layers = layers;
    this.fx = fx;
    this.monsters = monsters;
    this.shops = shops;
    this.borrow = new Borrow(monsters);
    layers.effects.addChild(this.notes.node);
    this.offs.push(sim.bus.on('rideStarted', (e) => this.rideStarted(e.shop)));
    this.sync();
  }

  // ── 세우기 ──

  private clear(): void {
    const c = this.carousel;
    if (c !== null) {
      c.base.destroy({ children: true });
      for (const s of c.slices) destroySlice(s);
      for (const h of c.horses) h.c.destroy({ children: true });
    }
    const f = this.ferris;
    if (f !== null) {
      f.wheel.destroy({ children: true });
      f.frame.destroy({ children: true });
      for (const g of f.gondolas) g.node.destroy({ children: true });
      for (const b of f.booth) destroySlice(b);
    }
    this.carousel = null;
    this.ferris = null;
  }

  /** 놓인 자리가 바뀌었으면 다시 세운다. */
  private sync(): void {
    const v = this.sim.village();
    if (v.stamp.place === this.placeStamp) return;
    this.placeStamp = v.stamp.place;
    this.clear();
    const pc = v.placed('carousel');
    if (pc !== undefined) this.carousel = this.buildCarousel(pc.id);
    const pf = v.placed('ferris_wheel');
    if (pf !== undefined) this.ferris = this.buildFerris(pf.id);
  }

  private add<T extends Container>(n: T, z: number): T {
    n.zIndex = z;
    n.eventMode = 'none';
    this.layers.objects.addChild(n);
    return n;
  }

  private buildCarousel(placedId: number): CarouselView | null {
    const v = this.sim.village();
    const part = v.shopSpot('carousel').parts[0];
    if (part === undefined) return null;
    const g = v.carousel();
    const base = this.add(new ArtNode({ k: part.k, anchor: 'bottom', placeholder: { w: 600, h: 780, color: 0xe8b4a0 } }), g.center.y - g.ry - 4);
    base.setArt(part.group, part.key);
    base.position.set(part.at.x, part.at.y);
    const frame = artFrame(part.group, part.key, part.at, part.k);
    const slices: Sprite[] = [];
    if (frame !== null) {
      for (const s of CAROUSEL_SLICES) {
        const sp = sliceSprite(part.group, part.key, frame, s.r);
        if (sp !== null) slices.push(this.add(sp, g.center.y + s.dz));
      }
    }
    const horses: Horse[] = [];
    for (let i = 0; i < g.horses; i++) {
      const c = this.add(new Container(), g.center.y);
      const pole = new Graphics();
      const art = new ArtNode({ k: g.horseK, anchor: HORSE_FOOT, placeholder: { w: 520, h: 600, color: 0xf3e6c8 } });
      art.setArt('racers', 'carousel_horse');
      c.addChild(pole, art);
      horses.push({ c, pole, art, x: g.center.x, y: g.center.y, flip: 1, sq: 1, bob: 0 });
    }
    // 지붕 아래 끝: 그림 px 곡선 → 세계 (그림이 없으면 판 가운데 위 대강).
    const edgeY = (x: number): number => {
      if (frame === null) return g.center.y - 96;
      const tx = (x - frame.x0) / frame.s;
      const u = (tx - CANOPY_EDGE.cx) / CANOPY_EDGE.half;
      const ty = CANOPY_EDGE.y - CANOPY_EDGE.rise * (1 - Math.sqrt(Math.max(0, 1 - u * u)));
      return frame.y0 + ty * frame.s;
    };
    const x0 = frame?.x0 ?? part.at.x - 200;
    const y0 = frame?.y0 ?? part.at.y - 480;
    const x1 = frame === null ? part.at.x + 200 : frame.x0 + frame.w * frame.s;
    const y1 = part.at.y;
    return {
      placedId,
      geo: g,
      frame,
      base,
      slices,
      horses,
      box: { x0: x0 - 80, y0: y0 - 80, x1: x1 + 80, y1: y1 + 40 },
      hit: { x0, y0, x1, y1 },
      edgeY,
    };
  }

  private buildFerris(placedId: number): FerrisView | null {
    const v = this.sim.village();
    const sp = v.shopSpot('ferris_wheel');
    const fp = sp.parts[0];
    const wp = sp.parts[1];
    if (fp === undefined || wp === undefined) return null;
    const f = v.ferris();
    const base = fp.at.y;
    const wheel = this.add(new ArtNode({ k: wp.k, anchor: wp.anchor ?? 'center', placeholder: { w: 920, h: 920, color: 0xe8a090 } }), base - 3);
    wheel.setArt(wp.group, wp.key);
    wheel.position.set(wp.at.x, wp.at.y);
    const frame = this.add(new ArtNode({ k: fp.k, anchor: 'bottom', placeholder: { w: 800, h: 700, color: 0xb07e52 } }), base - 2);
    frame.setArt(fp.group, fp.key);
    frame.position.set(fp.at.x, fp.at.y);
    const gondolas: Gondola[] = [];
    for (let j = 0; j < f.gondolas; j++) {
      // 곤돌라는 탄 손님 (다리 그림 바로 앞, base - 1)보다 앞, 땅에 선 주인·줄 (base 아래)보다 뒤.
      const node = this.add(new ArtNode({ k: f.gondolaK, anchor: f.hook, placeholder: { w: 520, h: 640, color: 0x9dc4e8 } }), base - 0.5);
      node.setArt('objects', 'ferris_gondola');
      gondolas.push({ node, x: f.hub.x, y: f.hub.y });
    }
    const reach = f.radius + 560 * f.gondolaK;
    const fr = artFrame(fp.group, fp.key, fp.at, fp.k);
    // 표 파는 집은 곤돌라 앞 (땅에 선 주인·줄보다는 뒤).
    const booth: Sprite[] = [];
    if (fr !== null) {
      for (const r of FERRIS_BOOTH) {
        const b = sliceSprite(fp.group, fp.key, fr, r);
        if (b !== null) booth.push(this.add(b, base - 0.25));
      }
    }
    const hit: Box = {
      x0: Math.min(f.hub.x - reach, fr?.x0 ?? fp.at.x - 220),
      y0: f.hub.y - f.radius - 60,
      x1: Math.max(f.hub.x + reach, fr === null ? fp.at.x + 220 : fr.x0 + fr.w * fr.s),
      y1: base,
    };
    return { placedId, geo: f, base, wheel, frame, booth, gondolas, box: { x0: hit.x0 - 60, y0: hit.y0 - 80, x1: hit.x1 + 60, y1: hit.y1 + 40 }, hit };
  }

  // ── 바깥에서 부르는 것 ──

  /** 누른 곳의 놀이기구 (Placed.id, 없으면 0). */
  hitTest(wx: number, wy: number): number {
    const inBox = (b: Box): boolean => wx >= b.x0 && wx <= b.x1 && wy >= b.y0 && wy <= b.y1;
    const c = this.carousel;
    if (c !== null && inBox(c.hit)) return c.placedId;
    const f = this.ferris;
    if (f !== null && inBox(f.hit)) return f.placedId;
    return 0;
  }

  // ── sim 이벤트 ──

  private rideStarted(s: ShopId): void {
    if (s !== 'carousel' && s !== 'ferris_wheel') return;
    this.ownerHop[s] = 0.9;
    if (s === 'carousel' && this.carousel !== null && this.carousel.frame !== null) {
      // 출발 종: 지붕 꼭대기에서 음표 셋.
      const p = framePt(this.carousel.frame, CAROUSEL_TOP.x, CAROUSEL_TOP.y);
      const tex = this.fx.tex.emote('note');
      for (let i = 0; i < 3; i++) this.notes.add(tex, p.x + (i - 1) * 34, p.y - i * 6, { vx: (i - 1) * 14, vy: -48, size0: 18, size1: 26, life: 1.6, sway: 6 });
    }
  }

  // ── 매 프레임 ──

  update(dt: number, view: ViewRect): void {
    this.time += dt;
    this.sync();
    for (const r of this.riders.values()) r.seen = false;
    const c = this.carousel;
    if (c !== null) this.updateCarousel(c, dt, view);
    const f = this.ferris;
    if (f !== null) this.updateFerris(f, dt, view);
    // 내린 손님: 짧게 내리는 연출 뒤 잊는다.
    for (const [id, r] of this.riders) {
      if (r.seen) continue;
      if (r.off < 0) {
        r.off = 0;
        if (r.shop === 'ferris_wheel') {
          // 곤돌라에서 퐁 사라져 땅 자리에 톡 (sim 자리는 늘 땅).
          this.fx.puff(r.lx, r.ly + 70, 4, 34);
          const mv = this.monsters.get(id);
          if (mv !== undefined) this.fx.puff(mv.x, mv.y, 4, 40);
        }
      }
      r.off += dt;
      const mv = this.monsters.get(id);
      if (r.shop === 'carousel' && mv !== undefined && r.off < MOUNT_SEC) {
        // 안장에서 사뿐 내려온다.
        const u = r.off / MOUNT_SEC;
        const g = c?.geo;
        const e = smooth(u);
        const lift = this.saddleUp(g) * (1 - e) + Math.sin(Math.PI * u) * 10;
        const k = CAROUSEL_RIDER + (1 - CAROUSEL_RIDER) * e;
        this.monsters.puppet(id, { lift, sx: k, sy: k });
      }
      if (r.off >= MOUNT_SEC || mv === undefined) this.riders.delete(id);
    }
    this.updateOwners(dt);
    this.notes.update(dt);
    this.borrow.end();
  }

  /** 안장 높이 (세계 px, 막대 아래 끝에서). */
  private saddleUp(g: CarouselGeo | undefined): number {
    return -HORSE_SADDLE.y * (g?.horseK ?? 0.15);
  }

  /** 자리 i에 지금 타 있는 손님 (atShop, 그 가게). */
  private riderAt(ss: ShopState, s: ShopId, i: number): Monster | undefined {
    const id = ss.slots[i] ?? null;
    if (id === null) return undefined;
    const m = this.sim.monster(id);
    return m !== undefined && m.phase === 'atShop' && m.shop === s ? m : undefined;
  }

  private rider(m: Monster, shop: 'carousel' | 'ferris_wheel', slot: number): Rider {
    let r = this.riders.get(m.id);
    if (r === undefined || r.shop !== shop || r.off >= 0) {
      r = { shop, slot, t: 0, seen: true, off: -1, lx: m.pos.x, ly: m.pos.y, top: false };
      this.riders.set(m.id, r);
    }
    r.seen = true;
    return r;
  }

  private updateCarousel(c: CarouselView, dt: number, view: ViewRect): void {
    const st = this.sim.state;
    const ss = st.shops.carousel;
    const g = c.geo;
    const prog = rideProgress(ss);
    const running = ss.ride?.phase === 'running';
    const visible = boxHits(c.box, view);
    c.base.culled = !visible;
    for (const s of c.slices) s.culled = !visible;
    // 빠르기 (0 ~ 1: 출발·멈출 때 느리게): 오르내림의 세기.
    const pace = running ? Math.min(1, 6 * prog * (1 - prog) * 1.3) : 0;
    const k = g.horseK;
    const poleTop = (HORSE_FOOT.y - HORSE_TOP) * k;
    c.horses.forEach((h, i) => {
      const a = carouselAngle(i, g.horses, prog);
      const sin = Math.sin(a);
      h.x = g.center.x + Math.cos(a) * g.rx;
      h.y = g.center.y + sin * g.ry;
      // 이웃 목마는 엇갈려 오르내린다.
      h.bob = (0.5 + 0.5 * Math.sin(this.time * 4.2 + i * Math.PI)) * g.bob * pace;
      // 그림은 왼쪽을 본다: 앞쪽 (sin > 0)은 왼쪽으로 가니 그대로, 뒤쪽은 뒤집는다. 옆으로 돌 때는 좁아진다.
      h.flip = sin >= 0 ? 1 : -1;
      h.sq = SIDE_SQUASH + (1 - SIDE_SQUASH) * Math.sqrt(Math.abs(sin));
      h.c.position.set(h.x, h.y);
      h.c.zIndex = Math.round(h.y);
      h.c.culled = !visible;
      h.art.position.set(0, -h.bob);
      h.art.scale.set(h.flip * h.sq, 1);
      // 막대: 판에서 지붕 아래 끝까지 (지붕이 앞에 그려지니 조금 더 올려 그린다). 목마 그림 막대 위로만.
      const top = Math.min(-poleTop - h.bob, c.edgeY(h.x) + 3 - h.y);
      h.pole.clear();
      if (visible) {
        h.pole.moveTo(0, 0).lineTo(0, top).stroke({ color: OUTLINE, width: POLE_W, cap: 'round' });
        h.pole.moveTo(0, -1).lineTo(0, top + 1).stroke({ color: POLE_YELLOW, width: POLE_IN });
      }
    });
    // 탄 손님: 자리 i의 목마 안장 위.
    const up = this.saddleUp(g);
    const n = ss.slots.length;
    for (let i = 0; i < n; i++) {
      const m = this.riderAt(ss, 'carousel', i);
      const h = c.horses[i];
      if (m === undefined || h === undefined) continue;
      const mv = this.monsters.get(m.id);
      if (mv === undefined) continue;
      const r = this.rider(m, 'carousel', i);
      r.t += dt;
      // 올라탈 때 톡 뛰어오른다.
      const u = Math.min(1, r.t / MOUNT_SEC);
      const hop = u < 1 ? Math.sin(Math.PI * u) * 16 : 0;
      const rk = 1 + (CAROUSEL_RIDER - 1) * smooth(u);
      const sx = h.x + HORSE_SADDLE.x * k * h.flip * h.sq;
      const sy = h.y - h.bob;
      const fy = Math.round(h.y) + 1;
      r.lx = sx;
      r.ly = sy - up;
      this.monsters.puppet(m.id, {
        dx: sx - mv.x,
        dy: fy - mv.y,
        lift: fy - sy + up * smooth(u) + hop,
        sx: rk * h.sq,
        sy: rk,
        facing: h.flip > 0 ? -1 : 1,
      });
      this.borrow.take(mv, 0, null);
    }
    // 도는 동안 지붕 꼭대기에서 음표.
    if (running && visible && c.frame !== null) {
      this.noteT -= dt;
      if (this.noteT <= 0) {
        this.noteT = 0.55 + Math.random() * 0.4;
        const p = framePt(c.frame, CAROUSEL_TOP.x, CAROUSEL_TOP.y);
        const side = Math.random() < 0.5 ? -1 : 1;
        this.notes.add(this.fx.tex.emote('note'), p.x + side * (20 + Math.random() * 60), p.y + 10, { vx: side * 16, vy: -42, size0: 16, size1: 24, life: 1.5, sway: 5 });
      }
    }
  }

  private updateFerris(f: FerrisView, dt: number, view: ViewRect): void {
    const st = this.sim.state;
    const ss = st.shops.ferris_wheel;
    const g = f.geo;
    const prog = rideProgress(ss);
    const running = ss.ride?.phase === 'running';
    const visible = boxHits(f.box, view);
    f.wheel.culled = !visible;
    f.frame.culled = !visible;
    for (const b of f.booth) b.culled = !visible;
    f.wheel.rotation = ferrisAngle(0, g.gondolas, prog) - Math.PI / 2;
    const pace = running ? Math.min(1, 6 * prog * (1 - prog)) : 0;
    f.gondolas.forEach((gd, j) => {
      const a = ferrisAngle(j, g.gondolas, prog);
      gd.x = g.hub.x + Math.cos(a) * g.radius;
      gd.y = g.hub.y + Math.sin(a) * g.radius;
      gd.node.position.set(gd.x, gd.y);
      // 늘 똑바로 매달려, 돌 때는 살랑 (빨라지고 느려질 때 조금 더).
      gd.node.rotation = Math.sin(this.time * 1.7 + j * 1.3) * (0.025 + 0.05 * pace);
      gd.node.culled = !visible;
    });
    // 탄 손님: 곤돌라 창 안 (곤돌라 바로 뒤, 다리 그림 앞).
    const k = g.gondolaK;
    const winTop = GONDOLA_WINDOW.top * k;
    const winH = GONDOLA_WINDOW.h * k;
    const fy = f.base - 1;
    for (let i = 0; i < ss.slots.length; i++) {
      const m = this.riderAt(ss, 'ferris_wheel', i);
      if (m === undefined) continue;
      const gd = f.gondolas[g.seats[i] ?? i];
      const mv = this.monsters.get(m.id);
      if (gd === undefined || mv === undefined) continue;
      const r = this.rider(m, 'ferris_wheel', i);
      if (r.t === 0) {
        // 땅에서 퐁 사라져 곤돌라에 톡.
        this.fx.puff(mv.x, mv.y, 4, 40);
        this.fx.puff(gd.x, gd.y + winTop + winH * 0.6, 3, 30);
      }
      r.t += dt;
      r.lx = gd.x;
      r.ly = gd.y;
      const scale = Math.min(FERRIS_RIDER_MAX, (winH * FERRIS_RIDER_H) / Math.max(30, mv.headH));
      const pop = r.t < POP_SEC ? backOut(r.t / POP_SEC) : 1;
      const footY = gd.y + winTop + 2 + mv.headH * scale;
      const sway = gd.node.rotation;
      this.monsters.puppet(m.id, {
        dx: gd.x + GONDOLA_WINDOW.dx * k - Math.sin(sway) * (footY - gd.y) - mv.x,
        dy: fy - mv.y,
        lift: fy - footY - (mv.floats ? HOVER : 0),
        sx: scale * pop,
        sy: scale * pop,
        rot: sway,
        still: true,
        facing: gd.x >= g.hub.x ? 1 : -1,
      });
      this.borrow.take(mv, 0, null);
      // 꼭대기를 지나면 한 바퀴에 한 번 반짝 (마을이 한눈에).
      if (running && !r.top && prog > 0.1 && prog < 0.97) {
        const a = ferrisAngle(g.seats[i] ?? i, g.gondolas, prog);
        const d = Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2));
        if (Math.abs(d) < TOP_ARC) {
          r.top = true;
          if (!mv.emoteBusy) mv.showEmote(this.fx.tex.emote(Math.random() < 0.5 ? 'sparkle' : 'heart'), 1.8);
          this.fx.sparkles(gd.x, gd.y + winTop, 4, 50);
        }
      }
    }
  }

  /** 출발 신호: 표 파는 주인이 통통 (shops.ts 주인 그림의 y만 잠깐 올린다). */
  private updateOwners(dt: number): void {
    for (const s of ['carousel', 'ferris_wheel'] as const) {
      const left = this.ownerHop[s];
      if (left <= 0) continue;
      const o = this.shops.ownerNode(s);
      this.ownerHop[s] = Math.max(0, left - dt);
      if (o === null) continue;
      const u = 1 - this.ownerHop[s] / 0.9;
      // 두 번 통통.
      const hop = Math.abs(Math.sin(u * Math.PI * 2)) * 14 * (1 - u * 0.4);
      o.node.y = this.ownerHop[s] > 0 ? o.at.y - hop : o.at.y;
    }
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.borrow.release();
    this.clear();
    this.notes.destroy();
    this.riders.clear();
  }
}
