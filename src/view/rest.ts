// 지도 위 쉼·재미 가게 연출 (다섯째 묶음, DESIGN 3.8): 여관·온천·점집·사진관. 가게 그림·주인은 shops.ts ShopsView, 여기는 그 위의 연출.
// 손님을 그리기 전에 돌린다 (world.ts, shops.ts 다음: 손님 몸 맡기기). sim은 읽기만 한다. 화면 연출용 무작위라 Math.random을 쓴다.
//
// 여관: 그림을 문 앞 디딤돌 줄 뒤로 그린다 (손님이 문 앞까지 걸어가 보이게: catalog.ts 여관 자리 = 문 앞). 들어가고 나올 때 문이 잠깐 열리고 (어두운 문 안),
//   방에 손님이 자는 동안 그 방 창의 불이 꺼진다 (창유리 픽셀만 골라 밤빛으로 칠한 덮개, 천천히) · 꺼진 창에서 졸음 표시(fx/emote_sleep)가 둥실.
// 온천: 탕 둘레의 손님은 온천 그림 앞에 그리고 (몸 맡기기로 앞뒤만 올린다), 물에 들어가면 몸이 가라앉아 물낯 아래는 가리개로 가린다 (머리·어깨만).
//   담근 동안 녹아내린다 (납작·넓적, 천천히 흔들, 기쁜 얼굴, 가끔 하트·음표), 물낯에 물결 고리. 탕 위로 김이 늘 피어오른다 (손님이 있으면 더).
// 점집: 그림을 탁자 다리 줄 뒤로 그린다 (탁자 오른쪽에 손님, 왼쪽에 점쟁이: catalog.ts). 점 보는 동안 수정구슬이 은은히 빛나고 (납작한 연보라 원, 작은 반짝),
//   손님은 구슬 쪽으로 몸을 기울이고 점쟁이는 살랑. 점괘가 나오면 (shopServed) 점괘 종이(items/fortune_slip)가 구슬에서 톡 튀어나와 손님 손으로 (닿으면 대길·길 반짝, 흉 회색 김).
// 사진관: 배경판 앞 손님이 사진사 쪽을 보고 서 있다가 찍기 직전 (남은 초 m.timer) 기쁜 포즈로 톡. 찰칵 (photoTaken) = 사진기 앞 하얀 납작 별 (빛 번짐 없음)
//   + 배경판이 잠깐 하얗게, 사진(items/photo)이 사진기에서 손님 손으로, 첫 사진이면 반짝·하트. 사진사는 찍을 때 통통.

import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { footprint } from '../data/catalog.ts';
import type { ShopId } from '../data/defs.ts';
import { CELL, type Pt } from '../data/map.ts';
import type { SimApi } from '../sim/api.ts';
import type { Monster, MonsterId } from '../sim/types.ts';
import { ART_SCALE, artTexture } from './art.ts';
import type { FxLayer } from './fx.ts';
import { boxHits, clamp, ellipseK, type Box, type ViewRect } from './mapUtil.ts';
import type { MonstersView, MonsterView } from './monsterView.ts';
import { Borrow, artFrame, framePt, keyedTexture, smooth, type ArtFrame, type PxRect } from './ridesKit.ts';
import { Bits, Flights } from './shopsFx.ts';
import type { ShopsView } from './shops.ts';

const OUTLINE = 0x402c1c;

// ── 여관 (map/inn 그림 px, 720×638) ──

/** 그림을 그리는 앞뒤 줄: 그림 아래 끝에서 이만큼 위 (세계 px, 여관 그림 기준: 문 앞 디딤돌 y 250보다 위, 문 아래 끝 239보다 아래). */
const INN_Z_UP = 40;
/** 방 창 (그림 px 네모): 자리 i의 손님이 자면 창 i의 불이 꺼진다. 아래 앞 창 → 아래 옆 창 → 지붕 창 → 위 옆 창. */
const INN_WINDOWS: readonly PxRect[] = [
  { x: 358, y: 464, w: 46, h: 64 },
  { x: 586, y: 444, w: 42, h: 60 },
  { x: 284, y: 250, w: 40, h: 52 },
  { x: 590, y: 302, w: 36, h: 50 },
];
/** 꺼진 창 색 (밤빛). */
const NIGHT = 0x4d5876;
/** 문 (그림 px 다각형, 문틀 테두리는 남게 조금 안쪽). */
const INN_DOOR: readonly number[] = [208, 455, 216, 445, 230, 440, 244, 442, 256, 449, 265, 459, 266, 568, 208, 542];
/** 창 불이 꺼지고 켜지는 빠르기 (1/초). */
const LIGHT_RATE = 0.9;
/** 문이 열려 있는 초. */
const DOOR_SEC = 0.7;

// ── 온천 (map/hot_spring 그림 px, 720×541) ──

/** 물 (그림 px 타원): 가운데·반지름. 담근 손님은 이 안. */
const SPRING_WATER = { cx: 300, cy: 355, rx: 195, ry: 92 } as const;
/** 탕 둘레 (물 타원의 이 배): 앞뒤 순서를 매기는 위 끝. */
const SPRING_RIM = 1.45;
/** 몸이 가라앉는 깊이 (몸 높이 비율)와 물낯 (발에서 위로 px: 이 아래는 가린다). */
const SINK = 0.44;
const WATERLINE = 3;
/** 담글 때 녹아내림 (납작·넓적). */
const MELT_SQ = 0.12;
const MELT_WIDE = 0.1;
/** 김 (fx/fx_puff): 피어오르는 간격 (초, 손님이 없을 때·있을 때). */
const STEAM_EVERY = [0.42, 0.22] as const;
const STEAM_TINT = 0xfff8ee;

// ── 점집 (map/fortune_teller 그림 px, 591×720) ──

/** 그림을 그리는 앞뒤 줄: 그림 아래 끝에서 이만큼 위 (탁자 다리 아래 끝 231보다 아래, 계산대 252보다 위). */
const FORTUNE_Z_UP = 30;
/** 수정구슬 가운데 (그림 px)와 반지름 (세계 px). */
const CRYSTAL: Pt = { x: 207, y: 512 };
const CRYSTAL_R = 12;
const GLOW = 0xe3d8ff;

// ── 사진관 ──

/** 사진사 그림 (characters/clerk_photo, 왼쪽을 볼 때)의 사진기 렌즈 (발에서, 캔버스 px). */
const LENS: Pt = { x: -160, y: -382 };
/** 배경판 (map/photo_backdrop 그림 px)의 하늘빛 판. */
const BACKDROP_PANEL: PxRect = { x: 88, y: 112, w: 544, h: 346 };
/** 찍기 이만큼 전 (초)부터 기쁜 포즈. */
const POSE_SEC = 1.3;

interface SoakState {
  sink: number;
  t: number;
  emoteT: number;
  rippleT: number;
  readonly ring: Graphics;
  readonly mask: Graphics;
  seen: boolean;
}

interface InnView {
  readonly frame: ArtFrame;
  readonly z: number;
  readonly lights: { readonly sp: Sprite | null; readonly tex: Texture | null; dark: number; sleepT: number; readonly top: Pt }[];
  readonly door: Graphics;
  readonly box: Box;
}

interface SpringView {
  readonly frame: ArtFrame;
  readonly z: number;
  /** 온천 발자국 (세계): 이 안에서 그림 아래 끝(z)보다 위에 선 손님은 탕·돌 위 손님이라 그림 앞에 그린다. */
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  /** 물 타원 (세계). */
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly box: Box;
}

interface FortuneView {
  readonly frame: ArtFrame;
  readonly z: number;
  readonly ball: Pt;
  readonly glow: Graphics;
  glowK: number;
  readonly box: Box;
}

interface PhotoView {
  readonly panel: Graphics;
  readonly box: Box;
  /** 지금 포즈 중인 손님 (톡 한 번). */
  posing: MonsterId | null;
}

export interface RestLayers {
  readonly objects: Container;
  readonly effects: Container;
}

export class RestView {
  private readonly sim: SimApi;
  private readonly layers: RestLayers;
  private readonly fx: FxLayer;
  private readonly monsters: MonstersView;
  private readonly shops: ShopsView;
  private readonly borrow: Borrow;
  /** 가리개 (온천 물낯 위만 보이게: 세계 좌표 네모). 그려지지 않는다 (Pixi가 가리개로 쓰면 그리지 않는다). */
  private readonly masks = new Container();
  private readonly flashes = new Container();
  private readonly bits = new Bits(48);
  private readonly steam = new Bits(40);
  private readonly flights = new Flights();
  private inn: InnView | null = null;
  private spring: SpringView | null = null;
  private fortune: FortuneView | null = null;
  private photo: PhotoView | null = null;
  private placeStamp = -1;
  private time = 0;
  private steamT = 0;
  private sparkT = 0;
  private doorT = 0;
  /** 여관 방에 든 손님 (문 열림 연출: 들어가고 나올 때). */
  private readonly sleepers = new Set<MonsterId>();
  private readonly soaks = new Map<MonsterId, SoakState>();
  /** 탕에 담갔던 손님 (반응 동안 물에 그대로). */
  private readonly soaked = new Set<MonsterId>();
  /** 찰칵: 하얀 별·배경판 번쩍 (남은 초). */
  private flash: { readonly star: Graphics; t: number } | null = null;
  private panelT = 0;
  /** 주인 통통·살랑 (남은 초). */
  private photoHop = 0;
  private readonly tmp = { x: 0, y: 0 };
  private readonly offs: (() => void)[] = [];

  constructor(sim: SimApi, layers: RestLayers, fx: FxLayer, monsters: MonstersView, shops: ShopsView) {
    this.sim = sim;
    this.layers = layers;
    this.fx = fx;
    this.monsters = monsters;
    this.shops = shops;
    this.borrow = new Borrow(monsters);
    this.masks.eventMode = 'none';
    this.flashes.eventMode = 'none';
    layers.effects.addChild(this.masks, this.steam.node, this.bits.node, this.flights.node, this.flashes);
    this.offs.push(
      sim.bus.on('shopServed', (e) => {
        if (e.shop === 'fortune_teller') this.fortuneServed(e.id);
      }),
      sim.bus.on('photoTaken', (e) => this.photoTaken(e.id, e.first)),
    );
    this.sync();
  }

  // ── 세우기 ──

  private clear(): void {
    const inn = this.inn;
    if (inn !== null) {
      for (const l of inn.lights) {
        l.sp?.destroy();
        l.tex?.destroy(true);
      }
      inn.door.destroy();
    }
    this.fortune?.glow.destroy();
    this.photo?.panel.destroy();
    this.inn = null;
    this.spring = null;
    this.fortune = null;
    this.photo = null;
  }

  private sync(): void {
    const v = this.sim.village();
    if (v.stamp.place === this.placeStamp) return;
    this.placeStamp = v.stamp.place;
    this.clear();
    if (v.placed('inn') !== undefined) this.inn = this.buildInn();
    if (v.placed('hot_spring') !== undefined) this.spring = this.buildSpring();
    if (v.placed('fortune_teller') !== undefined) this.fortune = this.buildFortune();
    if (v.placed('photo_studio') !== undefined) this.photo = this.buildPhoto();
  }

  private add<T extends Container>(n: T, z: number): T {
    n.zIndex = z;
    n.eventMode = 'none';
    this.layers.objects.addChild(n);
    return n;
  }

  private partFrame(s: ShopId, i = 0): { frame: ArtFrame; at: Pt } | null {
    const p = this.sim.village().shopSpot(s).parts[i];
    if (p === undefined) return null;
    const frame = artFrame(p.group, p.key, p.at, p.k);
    return frame === null ? null : { frame, at: p.at };
  }

  private static boxOf(f: ArtFrame, pad: number): Box {
    return { x0: f.x0 - pad, y0: f.y0 - pad - 120, x1: f.x0 + f.w * f.s + pad, y1: f.y0 + f.h * f.s + pad };
  }

  private buildInn(): InnView | null {
    const pf = this.partFrame('inn');
    if (pf === null) return null;
    const { frame, at } = pf;
    const z = at.y - INN_Z_UP;
    // 창유리 (노랑·주황 불빛) 픽셀만.
    const glass = (r: number, g: number, b: number): boolean => r >= 180 && g >= 115 && b <= 150 && r - b >= 70;
    const lights = INN_WINDOWS.map((r) => {
      const tex = keyedTexture('map', 'inn', r, glass, NIGHT, 1);
      let sp: Sprite | null = null;
      if (tex !== null) {
        sp = this.add(new Sprite(tex), z + 0.2);
        sp.position.set(frame.x0 + r.x * frame.s, frame.y0 + r.y * frame.s);
        sp.scale.set(frame.s);
        sp.alpha = 0;
      }
      return { sp, tex, dark: 0, sleepT: Math.random() * 2, top: framePt(frame, r.x + r.w * 0.75, r.y) };
    });
    const pts: number[] = [];
    for (let i = 0; i < INN_DOOR.length; i += 2) {
      const p = framePt(frame, INN_DOOR[i] ?? 0, INN_DOOR[i + 1] ?? 0);
      pts.push(p.x, p.y);
    }
    const door = this.add(new Graphics().poly(pts).fill(0x3a2a24), z + 0.3);
    door.alpha = 0;
    return { frame, z, lights, door, box: RestView.boxOf(frame, 60) };
  }

  private buildSpring(): SpringView | null {
    const pf = this.partFrame('hot_spring');
    if (pf === null) return null;
    const { frame, at } = pf;
    const c = framePt(frame, SPRING_WATER.cx, SPRING_WATER.cy);
    const pl = this.sim.village().placed('hot_spring');
    const fp = footprint('hot_spring');
    const x0 = (pl?.x ?? 0) * CELL;
    const y0 = (pl?.y ?? 0) * CELL;
    return { frame, z: at.y, x0, x1: x0 + fp.w * CELL, y0, cx: c.x, cy: c.y, rx: SPRING_WATER.rx * frame.s, ry: SPRING_WATER.ry * frame.s, box: RestView.boxOf(frame, 80) };
  }

  private buildFortune(): FortuneView | null {
    const pf = this.partFrame('fortune_teller');
    if (pf === null) return null;
    const { frame, at } = pf;
    const z = at.y - FORTUNE_Z_UP;
    const ball = framePt(frame, CRYSTAL.x, CRYSTAL.y);
    const glow = this.add(new Graphics(), z + 0.2);
    glow.position.set(ball.x, ball.y);
    glow.alpha = 0;
    return { frame, z, ball, glow, glowK: 0, box: RestView.boxOf(frame, 60) };
  }

  private buildPhoto(): PhotoView | null {
    const pf = this.partFrame('photo_studio', 1);
    if (pf === null) return null;
    const { frame, at } = pf;
    const a = framePt(frame, BACKDROP_PANEL.x, BACKDROP_PANEL.y);
    const panel = this.add(new Graphics().roundRect(a.x, a.y, BACKDROP_PANEL.w * frame.s, BACKDROP_PANEL.h * frame.s, 14).fill(0xffffff), at.y + 0.5);
    panel.alpha = 0;
    const shop = this.partFrame('photo_studio', 0);
    const box = RestView.boxOf(frame, 60);
    if (shop !== null) {
      const b = RestView.boxOf(shop.frame, 60);
      box.x0 = Math.min(box.x0, b.x0);
      box.y0 = Math.min(box.y0, b.y0);
      box.x1 = Math.max(box.x1, b.x1);
      box.y1 = Math.max(box.y1, b.y1) + 120;
    }
    return { panel, box, posing: null };
  }

  // ── 매 프레임 ──

  update(dt: number, view: ViewRect): void {
    this.time += dt;
    this.sync();
    if (this.inn !== null) this.updateInn(this.inn, dt, view);
    else this.sleepers.clear();
    this.updateSpring(dt, view);
    if (this.fortune !== null) this.updateFortune(this.fortune, dt, view);
    if (this.photo !== null) this.updatePhoto(this.photo, dt, view);
    this.updateFlash(dt);
    this.bits.update(dt);
    this.steam.update(dt);
    this.flights.update(dt);
    this.borrow.end();
  }

  /** 가게 그림 (shops.ts)을 앞뒤 줄 z로 (그림이 다시 세워지면 다시). */
  private setPartZ(s: ShopId, z: number): void {
    const n = this.shops.shopParts(s)[0];
    if (n !== undefined && n.zIndex !== z) n.zIndex = z;
  }

  // ── 여관 ──

  private updateInn(inn: InnView, dt: number, view: ViewRect): void {
    this.setPartZ('inn', inn.z);
    const st = this.sim.state;
    const ss = st.shops.inn;
    const visible = boxHits(inn.box, view);
    // 들어가고 나오는 손님: 문이 잠깐 열린다.
    const now = new Set<MonsterId>();
    for (const id of ss.slots) {
      if (id === null) continue;
      const m = this.sim.monster(id);
      if (m !== undefined && m.shop === 'inn' && m.phase === 'atShop' && m.hidden === true) now.add(id);
    }
    for (const id of now) if (!this.sleepers.has(id)) this.openDoor(id);
    for (const id of this.sleepers) if (!now.has(id)) this.openDoor(id);
    this.sleepers.clear();
    for (const id of now) this.sleepers.add(id);
    this.doorT = Math.max(0, this.doorT - dt);
    inn.door.alpha = this.doorT > 0 ? Math.sin((Math.PI * this.doorT) / DOOR_SEC) ** 0.5 : 0;
    inn.door.culled = !visible;
    const sleep = this.fx.tex.emote('sleep');
    inn.lights.forEach((l, i) => {
      const id = ss.slots[i] ?? null;
      const asleep = id !== null && now.has(id);
      l.dark = clamp(l.dark + (asleep ? dt : -dt) * LIGHT_RATE, 0, 1);
      if (l.sp !== null) {
        l.sp.alpha = smooth(l.dark) * 0.92;
        l.sp.culled = !visible;
      }
      // 꺼진 창에서 졸음 표시가 둥실.
      if (asleep && l.dark > 0.6 && visible) {
        l.sleepT -= dt;
        if (l.sleepT <= 0) {
          l.sleepT = 2.4 + Math.random() * 1.2;
          this.bits.add(sleep, l.top.x, l.top.y, { vx: 10, vy: -26, size0: 22, size1: 38, life: 2.8, sway: 7, spin: 0.25 });
        }
      }
    });
  }

  /** 문이 잠깐 열린다 (어두운 문 안) + 작은 먼지. */
  private openDoor(id: MonsterId): void {
    this.doorT = DOOR_SEC;
    const m = this.sim.monster(id);
    if (m !== undefined) this.fx.puff(m.pos.x, m.pos.y, 3, 26);
  }

  // ── 온천 ──

  private updateSpring(dt: number, view: ViewRect): void {
    const sp = this.spring;
    for (const s of this.soaks.values()) s.seen = false;
    if (sp !== null) {
      const st = this.sim.state;
      const visible = boxHits(sp.box, view);
      let soaking = 0;
      const top = sp.cy - sp.ry * SPRING_RIM;
      for (const m of st.monsters) {
        if (m.phase === 'leaving') continue;
        const mv = this.monsters.get(m.id);
        if (mv === undefined) continue;
        if (mv.x < sp.x0 || mv.x > sp.x1 || mv.y < sp.y0 || mv.y >= sp.z) continue;
        const atSpring = m.shop === 'hot_spring' && (m.phase === 'toShopSeat' || m.phase === 'atShop');
        if (m.shop === 'hot_spring' && m.phase === 'atShop') this.soaked.add(m.id);
        const engaged = atSpring || (m.phase === 'reacting' && this.soaked.has(m.id));
        const k = ellipseK(mv.x, mv.y, sp.cx, sp.cy, sp.rx, sp.ry);
        const target = engaged ? clamp((1 - k) * 4, 0, 1) : 0;
        let s = this.soaks.get(m.id);
        if (s === undefined) {
          s = { sink: 0, t: 0, emoteT: 2 + Math.random() * 2, rippleT: Math.random(), ring: this.add(new Graphics(), 0), mask: new Graphics(), seen: true };
          this.masks.addChild(s.mask);
          this.soaks.set(m.id, s);
        }
        s.seen = true;
        s.sink += clamp(target - s.sink, -dt * 2.2, dt * 2.2);
        if (m.phase === 'atShop' && m.shop === 'hot_spring') s.t += dt;
        else if (!engaged) s.t = 0;
        if (s.sink > 0.5) soaking++;
        this.soakGuest(sp, m, mv, s, top, dt, visible);
      }
      // 김: 늘 조금, 담근 손님이 있으면 더.
      if (visible && this.sim.state.shops.hot_spring.level >= 1) {
        this.steamT -= dt;
        if (this.steamT <= 0) {
          this.steamT = STEAM_EVERY[soaking > 0 ? 1 : 0] * (0.8 + Math.random() * 0.4);
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * 0.8;
          this.steam.add(this.fx.tex.get('fx', 'fx_puff', 'puff'), sp.cx + Math.cos(a) * sp.rx * r, sp.cy + Math.sin(a) * sp.ry * r - 6, {
            vx: (Math.random() - 0.5) * 12,
            vy: -30 - Math.random() * 16,
            size0: 16,
            size1: 40 + Math.random() * 12,
            life: 2.2 + Math.random() * 0.7,
            alpha: 0.9,
            tint: STEAM_TINT,
            sway: 8,
            spin: 0.3,
          });
        }
      }
    }
    // 탕을 떠난 손님: 가리개·물결을 치운다.
    for (const [id, s] of this.soaks) {
      if (s.seen) continue;
      s.ring.destroy();
      s.mask.destroy();
      this.soaks.delete(id);
      const m = this.sim.monster(id);
      if (m === undefined || m.phase !== 'reacting') this.soaked.delete(id);
    }
    if (this.soaked.size > 32) this.soaked.clear();
  }

  /** 탕 둘레 손님 하나: 온천 그림 앞으로, 물에 들어가면 가라앉아 물낯 아래를 가리고 녹아내린다. */
  private soakGuest(sp: SpringView, m: Monster, mv: MonsterView, s: SoakState, top: number, dt: number, visible: boolean): void {
    // 앞뒤: 온천 그림 바로 앞 (탕 안쪽끼리는 y 순서), 탕 앞 줄 손님보다는 뒤.
    const fy = Math.round(sp.z + 2 + clamp(mv.y - top, 0, 200) * 0.1);
    const sink = smooth(s.sink);
    if (sink < 0.01) {
      this.monsters.puppet(m.id, { dy: fy - mv.y, lift: fy - mv.y });
      s.ring.visible = false;
      // 가리개를 풀면 (몸을 빌리지 않으면) 가리개 그림이 그대로 그려진다 (하얀 네모): 비워 둔다.
      s.mask.clear();
      return;
    }
    const melt = smooth(Math.min(1, s.t / 1.6)) * sink;
    const wob = Math.sin(this.time * 1.3 + m.id) * 0.5 + 0.5;
    const sx = 1 + MELT_WIDE * melt * (0.8 + 0.4 * wob);
    const sy = 1 - MELT_SQ * melt * (0.8 + 0.4 * (1 - wob));
    const deep = mv.headH * SINK * sink;
    this.monsters.puppet(m.id, {
      dy: fy - mv.y,
      lift: fy - mv.y - deep,
      sx,
      sy,
      rot: Math.sin(this.time * 0.9 + m.id * 1.7) * 0.05 * melt,
      ...(m.phase === 'atShop' && s.t > 1.1 ? { pose: 'joy' as const } : {}),
    });
    // 물낯 위만 보이게 (세계 좌표 네모).
    const wl = mv.y - WATERLINE;
    s.mask.clear().rect(mv.x - 160, wl - 400, 320, 400).fill(0xffffff);
    this.borrow.take(mv, 0, s.mask);
    // 물결 고리: 몸 바로 뒤 (뒤쪽 반은 몸에 가리고 앞쪽 반이 보인다). 물 타원 밖 (둘레 돌) 위로는 넘지 않게 그 높이의 물 폭 안으로 줄인다.
    const dyW = (wl - sp.cy) / sp.ry;
    const room = sp.rx * Math.sqrt(Math.max(0, 1 - dyW * dyW)) - Math.abs(mv.x - sp.cx) - 4;
    const rx = Math.min(Math.max(18, mv.halfW * 0.92 * sx), room);
    s.ring.zIndex = fy - 1;
    s.ring.visible = visible && sink > 0.3 && rx >= 10;
    if (s.ring.visible) {
      s.rippleT += dt / 1.7;
      const u = s.rippleT % 1;
      const ru = Math.min(rx * (1 + 0.7 * u), room);
      const g = s.ring.clear();
      g.ellipse(mv.x, wl, rx, rx * 0.28).fill({ color: 0xd6efff, alpha: 0.55 * sink });
      g.ellipse(mv.x, wl, rx, rx * 0.28).stroke({ color: 0xffffff, width: 3, alpha: 0.85 * sink });
      g.ellipse(mv.x, wl, ru, ru * 0.28).stroke({ color: 0xffffff, width: 2.5, alpha: 0.6 * (1 - u) * sink });
    }
    // 가끔 하트·음표 (녹아내린 얼굴).
    if (m.phase === 'atShop' && s.t > 1.5) {
      s.emoteT -= dt;
      if (s.emoteT <= 0) {
        s.emoteT = 3.5 + Math.random() * 2.5;
        if (!mv.emoteBusy && visible) mv.showEmote(this.fx.tex.emote(Math.random() < 0.6 ? 'heart' : 'note'), 1.6);
      }
    }
  }

  // ── 점집 ──

  private updateFortune(f: FortuneView, dt: number, view: ViewRect): void {
    this.setPartZ('fortune_teller', f.z);
    const st = this.sim.state;
    const ss = st.shops.fortune_teller;
    const visible = boxHits(f.box, view);
    const id = ss.serving;
    const m = id === null ? undefined : this.sim.monster(id);
    const reading = m !== undefined && m.phase === 'buying' && m.shop === 'fortune_teller' && m.path.length === 0;
    f.glowK = clamp(f.glowK + (reading ? dt * 2.5 : -dt * 1.5), 0, 1);
    // 수정구슬: 납작한 연보라 원 두 겹이 숨 쉬듯.
    const g = f.glow;
    g.culled = !visible;
    if (f.glowK > 0.01 && visible) {
      const p = 0.5 + 0.5 * Math.sin(this.time * 5);
      g.clear()
        .circle(0, 0, CRYSTAL_R * (1.5 + 0.35 * p))
        .fill({ color: GLOW, alpha: 0.35 })
        .circle(0, 0, CRYSTAL_R * (1.05 + 0.15 * p))
        .fill({ color: 0xffffff, alpha: 0.45 });
      g.alpha = f.glowK;
      this.sparkT -= dt;
      if (this.sparkT <= 0 && reading) {
        this.sparkT = 0.22 + Math.random() * 0.15;
        const a = Math.random() * Math.PI * 2;
        this.bits.add(this.fx.tex.emote('sparkle'), f.ball.x + Math.cos(a) * CRYSTAL_R * 1.8, f.ball.y + Math.sin(a) * CRYSTAL_R * 1.4, {
          vy: -16,
          size0: 9,
          size1: 13,
          life: 0.7,
          tint: 0xd9c6ff,
          sway: 3,
        });
      }
    } else g.alpha = 0;
    // 점 보는 손님은 구슬 쪽으로 몸을 기울이고, 점쟁이는 구슬 위로 손을 휘휘 (살랑).
    if (reading && m !== undefined) {
      const mv = this.monsters.get(m.id);
      if (mv !== undefined) this.monsters.puppet(m.id, { rot: (mv.x > f.ball.x ? -1 : 1) * 0.07 * f.glowK });
    }
    const o = this.shops.ownerNode('fortune_teller');
    if (o !== null) o.node.rotation = Math.sin(this.time * 3.2) * 0.07 * f.glowK;
  }

  /** 점괘가 나왔다: 종이가 구슬에서 톡 튀어나와 손님 손으로 (닿으면 대길·길 반짝, 흉 회색 김). */
  private fortuneServed(id: MonsterId): void {
    const f = this.fortune;
    const mv = this.monsters.get(id);
    const tex = artTexture('items', 'fortune_slip');
    if (f === null || mv === undefined || tex === undefined) return;
    f.glowK = 1;
    this.fx.sparkles(f.ball.x, f.ball.y, 4, 22);
    const dur = 0.55;
    mv.holdHeld(dur + 0.05);
    this.flights.fly(tex, {
      from: { x: f.ball.x, y: f.ball.y - 6 },
      to: (out) => {
        const v = this.monsters.get(id);
        if (v === undefined) return false;
        v.heldAt(out);
        return true;
      },
      size: 14,
      sizeEnd: 30,
      dur,
      arc: 60,
      onLand: (x, y) => {
        const m = this.sim.monster(id);
        const tier = m?.buffs?.fortune ?? ((m?.buffs?.luck ?? 0) < 0 ? 'bad' : 'good');
        if (tier === 'bad') this.fx.puff(x, y - 6, 3, 24, 0xa59fb4);
        else this.fx.sparkles(x, y - 8, tier === 'great' ? 9 : 5, tier === 'great' ? 46 : 30);
      },
    });
  }

  // ── 사진관 ──

  /** 사진사 그림의 렌즈 (세계 좌표). */
  private lens(out: { x: number; y: number }): boolean {
    const o = this.shops.ownerNode('photo_studio');
    if (o === null) return false;
    const flip = o.node.scale.x < 0 ? -1 : 1;
    out.x = o.at.x + LENS.x * ART_SCALE.villager * flip;
    out.y = o.node.y + LENS.y * ART_SCALE.villager;
    return true;
  }

  private updatePhoto(p: PhotoView, dt: number, view: ViewRect): void {
    const st = this.sim.state;
    const ss = st.shops.photo_studio;
    const visible = boxHits(p.box, view);
    p.panel.culled = !visible;
    // 배경판 앞 손님: 찍기 직전 기쁜 포즈로 톡.
    let posing: MonsterId | null = null;
    for (const id of ss.slots) {
      if (id === null) continue;
      const m = this.sim.monster(id);
      if (m === undefined || m.shop !== 'photo_studio' || m.phase !== 'atShop') continue;
      if (m.timer <= POSE_SEC) {
        posing = id;
        this.monsters.puppet(id, { pose: 'joy' });
        if (p.posing !== id) {
          const mv = this.monsters.get(id);
          mv?.hop(0.8);
          this.photoHop = Math.max(this.photoHop, 0.4);
        }
      }
    }
    p.posing = posing;
    // 사진사: 찍을 때 통통 (shops.ts 주인 그림의 y만).
    const o = this.shops.ownerNode('photo_studio');
    if (o !== null) {
      this.photoHop = Math.max(0, this.photoHop - dt);
      const u = this.photoHop / 0.4;
      o.node.y = o.at.y - Math.sin(Math.PI * u) * 10;
    }
  }

  /** 찰칵: 렌즈 앞 하얀 납작 별 + 배경판이 잠깐 하얗게, 사진이 사진기에서 손님 손으로. */
  private photoTaken(id: MonsterId, first: boolean): void {
    if (this.photo === null) return;
    const at = this.tmp;
    if (!this.lens(at)) {
      const m = this.sim.monster(id);
      if (m === undefined) return;
      at.x = m.pos.x - 40;
      at.y = m.pos.y - 60;
    }
    this.flash?.star.destroy();
    const star = new Graphics();
    const pts: number[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? 30 : 12;
      pts.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    star.poly(pts).fill(0xffffff).stroke({ color: OUTLINE, width: 2.5, join: 'round' });
    star.position.set(at.x, at.y);
    this.flashes.addChild(star);
    this.flash = { star, t: 0 };
    this.panelT = 0.3;
    this.photoHop = 0.4;
    const mv = this.monsters.get(id);
    const tex = artTexture('items', 'photo');
    if (mv !== undefined && tex !== undefined) {
      const dur = 0.6;
      mv.holdHeld(dur + 0.25);
      this.flights.fly(tex, {
        from: { x: at.x, y: at.y },
        to: (out) => {
          const v = this.monsters.get(id);
          if (v === undefined) return false;
          v.heldAt(out);
          return true;
        },
        size: 16,
        sizeEnd: 30,
        dur,
        arc: 46,
        delay: 0.22,
        onLand: (x, y) => {
          if (!first) return;
          this.fx.sparkles(x, y - 20, 8, 50);
          const v = this.monsters.get(id);
          if (v !== undefined) this.fx.hearts(v.headX(), v.headY(), 2);
        },
      });
    }
  }

  private updateFlash(dt: number): void {
    const f = this.flash;
    if (f !== null) {
      f.t += dt;
      const u = f.t / 0.32;
      if (u >= 1) {
        f.star.destroy();
        this.flash = null;
      } else {
        // 톡 커졌다가 사라진다 (빛 번짐 없이 납작하게).
        f.star.scale.set(0.35 + 0.95 * smooth(Math.min(1, u * 2.2)));
        f.star.rotation = u * 0.4;
        f.star.alpha = u < 0.5 ? 1 : 1 - (u - 0.5) / 0.5;
      }
    }
    if (this.photo !== null) {
      this.panelT = Math.max(0, this.panelT - dt);
      this.photo.panel.alpha = this.panelT > 0 ? 0.75 * (this.panelT / 0.3) : 0;
    }
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.borrow.release();
    for (const s of this.soaks.values()) {
      s.ring.destroy();
      s.mask.destroy();
    }
    this.soaks.clear();
    this.clear();
    this.flash?.star.destroy();
    this.flash = null;
    this.bits.destroy();
    this.steam.destroy();
    this.flights.destroy();
    this.masks.destroy({ children: true });
    this.flashes.destroy({ children: true });
  }
}
