// 아이스크림 트럭 (다섯째 묶음, DESIGN 3.8): 길 위를 천천히 다니는 탈것. sim 트럭 (ShopState.truck: x·y·path·stop·facing·parked)을 부드럽게 따라간다.
//  - 달릴 때: 통통 튀는 차체·살랑 기울기, 뒤에서 작은 배기 먼지, 위로 음표가 하나씩 (노래를 틀고 다닌다). 방향을 바꾸면 좌우로 뒤집힌다 (그림은 왼쪽을 본다).
//  - 설 때: 앞으로 꾸벅했다 서고 (스프링), 머리 위에 음표 말풍선 (딩동댕), 아저씨가 창에서 쏙 나온다 (창 모양으로 가린 주인 그림). 출발할 때는 엉덩이가 살짝 앉는다.
//  - 팔면 (shopServed): 아저씨가 창에서 톡, 아이스크림이 창에서 손님 손으로 날아간다 (그동안 손님 손에 든 것은 숨긴다).
//  - 차고에 서 있으면 (길이 없음) 아저씨가 창에서 꾸벅꾸벅 졸며 가끔 졸음 표시.
//  - 차고 (3×3): 트럭이 서는 주차판 (바닥에 연한 판 + 양 끝 분홍 줄무늬)과 표지판 위 아이스크림 그림 (트럭이 나가 있어도 트럭 자리로 읽히게).
//  - 트럭을 따라가는 손님 (toShop)은 통통 종종걸음 (몸 맡기기 puppet). 트럭 앞에 줄 선·사는 손님은 그림만 조금 아래·옆으로 (트럭 창과 아저씨를 가리지 않게,
//    sim 자리는 길 칸 안 그대로). 손님을 그리기 전에 돌린다 (world.ts → shopsFood.ts).
// 누르기는 hitTest (world.ts → shopsFood.ts ShopLifeView.hitTest). sim은 읽기만 한다.

import { Container, Graphics, Sprite } from 'pixi.js';
import { TRUCK_GEO } from '../data/catalog.ts';
import type { SimApi } from '../sim/api.ts';
import type { MonsterId } from '../sim/types.ts';
import { ArtNode, artTexture } from './art.ts';
import type { FxLayer } from './fx.ts';
import { clamp, follow, type ViewRect } from './mapUtil.ts';
import type { MonstersView } from './monsterView.ts';
import type { Bits, Flights } from './shopsFx.ts';

const OUTLINE = 0x402c1c;
/** 트럭 그림 자리 표시 (캔버스 px). */
const TRUCK_PH = { w: 640, h: 560, color: 0xf2c6d0 };
/**
 * 그림 안 판매 창 (트럭 아래 가운데에서 세계 px, 왼쪽을 보는 그림): 창 안쪽 상자 x0~x1 · y0~y1 (어두운 안쪽, 차양 아래·선반 위).
 * 그림 racers/icecream_truck (256×231 처리본)에서 잰 값 × TRUCK_GEO.k.
 */
const WIN = { x0: -4, x1: 62, y0: -94, y1: -60 } as const;
/** 창 속 아저씨 (characters/clerk_icecream): 배율, 나왔을 때 발이 선반 아래로 내려간 만큼 (머리·어깨만 보이게), 숨었을 때 더 내려가는 만큼 (세계 px). */
const CLERK_K = 0.062;
const CLERK_FEET = 38;
const CLERK_DOWN = 40;
/** 배기 먼지 사이 (초), 음표 사이 (초, 범위). */
const EXHAUST_EVERY = 0.32;
const NOTE_EVERY: readonly [number, number] = [0.7, 1.3];
/** 음표 말풍선 보이는 초. */
const BUBBLE_SEC = 2.6;
/** 손님 따라가기 종종걸음 높이 (세계 px)와 빠르기. */
const TROT_LIFT = 7;
const TROT_RATE = 12;
/** 트럭 앞줄(트럭보다 아래에 선) 손님 그림을 내리는 만큼·옆으로 벌리는 배율 (세계 px, 머리가 창 아래로 오게), 들고 나는 초. */
const FRONT_DROP = 24;
const FRONT_SPREAD = 0.6;
const FRONT_EASE = 0.35;
/** 트럭 뒤 (트럭보다 위에 선) 줄 손님은 옆으로 더 벌린다 (트럭 몸통 뒤에 숨어 겹쳐 보이지 않게, 양옆으로 빼꼼). */
const BACK_SPREAD = 1.5;

/** 차고 주차판 (트럭 자리 아래 가운데에서, 세계 px): 폭·높이·줄무늬. 표지판 위 아이스크림 그림 크기 (세계 px)와 표지판 그림 기준점에서 판 가운데까지. */
const PAD = { w: 232, h: 78, dy: -8, stripe: 0xf3b8c4 } as const;
const SIGN_ICON = 40;
const SIGN_BOARD = { dx: -8, dy: -80 } as const;

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

function backOut(t: number): number {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

export interface TruckCtx {
  readonly sim: SimApi;
  readonly objects: Container;
  readonly shadows: Container;
  readonly effects: Container;
  readonly fx: FxLayer;
  readonly monsters: MonstersView;
  readonly flights: Flights;
  readonly bits: Bits;
}

export class TruckView {
  private readonly ctx: TruckCtx;
  /** 물체층: 트럭 자리 (아래 가운데). */
  private readonly root = new Container();
  /** 좌우 뒤집기. */
  private readonly flipBox = new Container();
  /** 통통·기울기 (아래 가운데 기준). */
  private readonly bodyBox = new Container();
  private readonly art: ArtNode;
  /** 창 속 아저씨 (창 모양으로 가린다). */
  private readonly clerkBox = new Container();
  private readonly clerk: ArtNode;
  private readonly shadow = new Graphics();
  /** 음표 말풍선 (효과층). */
  private readonly bubble = new Container();
  private readonly notes: Sprite[] = [];
  private bubbleT = -1;
  private x = 0;
  private y = 0;
  private flip = 1;
  private seen = false;
  private time = 0;
  /** 앞뒤 기울기 스프링 (rad, + = 엉덩이가 앉음). */
  private lean = 0;
  private leanV = 0;
  private moving = false;
  private exhaustT = 0;
  private noteT = 0;
  /** 창 속 아저씨: 나온 정도 0~1, 톡 (팔 때), 졸음 시계. */
  private clerkUp = 0;
  private clerkHop = 0;
  private dozeT = 2;
  private readonly tmp = { x: 0, y: 0 };
  private readonly offs: (() => void)[] = [];
  /** 트럭 둘레 줄에 선 손님 → 그림을 옮긴 정도 0~1 (앞줄은 아래·옆으로, 뒷줄은 옆으로). */
  private readonly front = new Map<MonsterId, number>();
  /** 차고: 주차판 (바닥층)·표지판 위 아이스크림 (물체층), 놓인 자리가 바뀌면 다시 그린다. */
  private readonly pad = new Graphics();
  private readonly signIcon: Sprite;
  private padStamp = -1;
  private iconReady = false;

  constructor(ctx: TruckCtx) {
    this.ctx = ctx;
    this.art = new ArtNode({ k: TRUCK_GEO.k, anchor: 'bottom', placeholder: TRUCK_PH });
    this.art.setArt('racers', 'icecream_truck');
    // 창 속 아저씨: 창 안쪽 상자 모양 가림막.
    this.clerk = new ArtNode({ k: CLERK_K, anchor: 'bottom', placeholder: { w: 560, h: 980, color: 0xf2d0a9 } });
    this.clerk.setArt('characters', 'clerk_icecream');
    const mask = new Graphics().rect(WIN.x0, WIN.y0, WIN.x1 - WIN.x0, WIN.y1 - WIN.y0).fill(0xffffff);
    this.clerkBox.addChild(this.clerk, mask);
    this.clerkBox.mask = mask;
    this.bodyBox.addChild(this.art, this.clerkBox);
    this.flipBox.addChild(this.bodyBox);
    this.root.addChild(this.flipBox);
    this.root.eventMode = 'none';
    this.root.visible = false;
    ctx.objects.addChild(this.root);
    this.shadow.ellipse(0, 0, 1, 1).fill({ color: 0x000000, alpha: 0.13 });
    this.shadow.visible = false;
    this.shadow.eventMode = 'none';
    ctx.shadows.addChild(this.shadow);
    // 음표 말풍선: 둥근 말풍선 + 꼬리 + 음표 둘.
    const g = new Graphics()
      .roundRect(-46, -40, 92, 52, 22)
      .fill(0xfffaf0)
      .stroke({ color: OUTLINE, width: 4 })
      .poly([-8, 10, 6, 10, -4, 24])
      .fill(0xfffaf0);
    g.moveTo(-8, 11).lineTo(-4, 24).lineTo(6, 11).stroke({ color: OUTLINE, width: 4, join: 'round', cap: 'round' });
    this.bubble.addChild(g);
    const noteTex = ctx.fx.tex.emote('note');
    for (let i = 0; i < 2; i++) {
      const sp = new Sprite(noteTex);
      sp.anchor.set(0.5);
      sp.scale.set(30 / Math.max(1, noteTex.width, noteTex.height));
      sp.position.set(i === 0 ? -18 : 18, -14);
      this.bubble.addChild(sp);
      this.notes.push(sp);
    }
    this.bubble.visible = false;
    this.bubble.eventMode = 'none';
    ctx.effects.addChild(this.bubble);
    this.pad.eventMode = 'none';
    this.pad.visible = false;
    ctx.shadows.addChild(this.pad);
    this.signIcon = new Sprite();
    this.signIcon.anchor.set(0.5, 0.5);
    this.signIcon.eventMode = 'none';
    this.signIcon.visible = false;
    ctx.objects.addChild(this.signIcon);
    const bus = ctx.sim.bus;
    this.offs.push(
      bus.on('truckStopped', () => this.stopped()),
      bus.on('shopServed', (e) => {
        if (e.shop === 'icecream_truck') this.served(e.id, e.item);
      }),
    );
  }

  /** 트럭이 섰다: 앞으로 꾸벅, 음표 말풍선, 반짝. */
  private stopped(): void {
    if (!this.root.visible) return;
    this.leanV -= 1.1;
    this.bubbleT = 0;
    this.ctx.fx.sparkles(this.x, this.y - 120, 4, 70);
  }

  /** 팔았다: 아저씨가 창에서 톡, 아이스크림이 창에서 손님 손으로. */
  private served(id: MonsterId, item: string | null): void {
    this.clerkHop = 1;
    const v = this.ctx.monsters.get(id);
    if (v === undefined || !this.root.visible) return;
    const slash = item === null ? -1 : item.indexOf('/');
    const tex = item === null || slash < 0 ? artTexture('items', 'food_icecream') : artTexture(item.slice(0, slash), item.slice(slash + 1));
    const dur = 0.55;
    v.holdHeld(dur + 0.05);
    this.windowAt(this.tmp);
    this.ctx.flights.fly(tex, {
      from: { x: this.tmp.x, y: this.tmp.y },
      to: (out) => {
        const w = this.ctx.monsters.get(id);
        if (w === undefined) return false;
        w.heldAt(out);
        return true;
      },
      size: 26,
      sizeEnd: 30,
      dur,
      arc: 46,
      onLand: (x, y) => this.ctx.fx.sparkles(x, y - 6, 2, 14),
    });
  }

  /** 누른 곳이 트럭인가 (차체 상자, 세계 좌표). */
  hitTest(wx: number, wy: number): boolean {
    return this.root.visible && Math.abs(wx - this.x) < 90 && wy < this.y + 14 && wy > this.y - 130;
  }

  /** 판매 창 가운데 (세계 좌표). */
  private windowAt(out: { x: number; y: number }): void {
    const s = this.flip < 0 ? -1 : 1;
    out.x = this.x + ((WIN.x0 + WIN.x1) / 2) * s;
    out.y = this.y + (WIN.y0 + WIN.y1) / 2 + this.bodyBox.y;
  }

  update(dt: number, view: ViewRect, zoom: number): void {
    this.time += dt;
    const { sim } = this.ctx;
    const st = sim.state;
    const ss = st.shops.icecream_truck;
    const t = ss.truck;
    const v = sim.village();
    const placed = v.placed('icecream_truck') !== undefined && ss.level >= 1;
    if (t === null || !placed) {
      this.root.visible = false;
      this.shadow.visible = false;
      this.bubble.visible = false;
      this.pad.visible = false;
      this.signIcon.visible = false;
      this.seen = false;
      return;
    }
    const home = v.truckHome();
    this.drawGarage(v.stamp.place, home, v.shopSpot('icecream_truck').parts[0]?.at ?? null, view);
    const tx = t.parked ? home.x : t.x;
    const ty = t.parked ? home.y : t.y;
    if (!this.seen || Math.hypot(tx - this.x, ty - this.y) > 400) {
      this.x = tx;
      this.y = ty;
    } else {
      const k = follow(10, dt);
      this.x += (tx - this.x) * k;
      this.y += (ty - this.y) * k;
    }
    this.seen = true;
    const moving = !t.parked && t.stop <= 0 && t.path.length > 0;
    if (moving !== this.moving) {
      // 출발: 엉덩이가 살짝 앉는다. 서기는 truckStopped가 꾸벅.
      if (moving) this.leanV += 0.8;
      this.moving = moving;
    }
    // 좌우 (그림은 왼쪽을 본다: 오른쪽으로 가면 뒤집는다). 0을 지나는 동안 살짝 들썩.
    const want = t.facing === 1 ? -1 : 1;
    this.flip += (want - this.flip) * follow(9, dt);
    // 앞뒤 기울기 스프링.
    this.leanV += (-60 * this.lean - 7 * this.leanV) * dt;
    this.lean += this.leanV * dt;
    const turning = 1 - Math.min(1, Math.abs(this.flip));
    const bob = moving ? Math.abs(Math.sin(this.time * 9)) * 3 : 0;
    const sway = moving ? Math.sin(this.time * 4.6) * 0.014 : 0;
    this.root.visible = true;
    this.root.position.set(this.x, this.y);
    this.root.zIndex = Math.round(this.y) + 6;
    this.flipBox.scale.set(Math.abs(this.flip) < 0.04 ? 0.04 * Math.sign(this.flip || 1) : this.flip, 1);
    this.bodyBox.position.set(0, -bob - turning * 8);
    this.bodyBox.rotation = sway + clamp(this.lean, -0.12, 0.12) * 0.6;
    this.bodyBox.scale.set(1 + 0.02 * Math.sin(this.time * 18) * (moving ? 1 : 0), 1 - (moving ? 0.015 * Math.abs(Math.sin(this.time * 9 + 1)) : 0));
    const culled = this.x + 220 < view.x0 || this.x - 220 > view.x1 || this.y + 60 < view.y0 || this.y - 280 > view.y1;
    this.root.culled = culled;
    this.shadow.visible = !culled;
    this.shadow.position.set(this.x, this.y + 2);
    this.shadow.scale.set(86 * (1 - bob * 0.01), 15);

    // 창 속 아저씨: 서 있으면 나오고 달리면 숨는다 (가게 주인이 없으면 늘 숨음).
    const hasOwner = ss.owner !== null;
    const upWant = hasOwner && !moving ? 1 : 0;
    this.clerkUp += (upWant - this.clerkUp) * follow(upWant > this.clerkUp ? 7 : 12, dt);
    this.clerkHop = Math.max(0, this.clerkHop - dt / 0.45);
    const hop = Math.sin(this.clerkHop * Math.PI) * 10;
    // 차고에서 (길이 없다) 꾸벅꾸벅.
    const doze = t.parked && hasOwner;
    const nod = doze ? Math.max(0, Math.sin(this.time * 1.3)) * 5 : 0;
    this.clerk.position.set(WIN.x0 + (WIN.x1 - WIN.x0) * 0.42, WIN.y1 + CLERK_FEET + (1 - this.clerkUp) * CLERK_DOWN - hop + nod);
    this.clerk.rotation = doze ? Math.sin(this.time * 1.3) * 0.08 : Math.sin(this.time * 2.4) * 0.04;
    this.clerkBox.visible = this.clerkUp > 0.02;

    const scale = clamp(0.7 / zoom, 1, 1.6);
    if (!culled) {
      if (moving) {
        // 배기 먼지 (뒤쪽 아래), 음표.
        this.exhaustT -= dt;
        if (this.exhaustT <= 0) {
          this.exhaustT = EXHAUST_EVERY;
          const s = this.flip < 0 ? -1 : 1;
          this.ctx.fx.puff(this.x + 92 * s, this.y - 16, 2, 26, 0xece6dc);
        }
        this.noteT -= dt;
        if (this.noteT <= 0) {
          this.noteT = rand(NOTE_EVERY[0], NOTE_EVERY[1]);
          const s = this.flip < 0 ? -1 : 1;
          this.ctx.bits.add(this.ctx.fx.tex.emote('note'), this.x + rand(-20, 30) * s, this.y - 150, { vx: rand(-14, 14), vy: -rand(40, 60), size0: rand(20, 26), life: 1.5, sway: 6, spin: 0.2 });
        }
      } else if (doze) {
        this.dozeT -= dt;
        if (this.dozeT <= 0) {
          this.dozeT = rand(3, 5);
          this.windowAt(this.tmp);
          this.ctx.bits.add(this.ctx.fx.tex.emote('sleep'), this.tmp.x + 12, this.tmp.y - 34, { vx: 10, vy: -26, size0: 30, life: 2.2, sway: 6, spin: 0.2 });
        }
      }
    }
    this.updateBubble(dt, scale, culled);
    this.trot(dt, tx, ty);
  }

  /** 차고 주차판·표지판 아이스크림 (놓인 자리가 바뀌면 다시 그린다). */
  private drawGarage(stamp: number, home: { x: number; y: number }, sign: { x: number; y: number } | null, view: ViewRect): void {
    if (stamp !== this.padStamp) {
      this.padStamp = stamp;
      const g = this.pad.clear();
      const x0 = home.x - PAD.w / 2;
      const y0 = home.y + PAD.dy - PAD.h / 2;
      g.roundRect(x0, y0, PAD.w, PAD.h, 26).fill({ color: 0xf4ead9, alpha: 0.95 }).stroke({ color: 0xcdb999, width: 4 });
      // 양 끝 줄무늬 (차가 서는 칸 표시).
      for (const side of [0, 1]) {
        const sx = side === 0 ? x0 + 16 : x0 + PAD.w - 40;
        for (let k = 0; k < 3; k++) {
          const yy = y0 + 14 + k * 18;
          g.poly([sx, yy + 10, sx + 10, yy, sx + 24, yy, sx + 14, yy + 10]).fill(PAD.stripe);
        }
      }
      if (sign !== null) {
        this.signIcon.position.set(sign.x + SIGN_BOARD.dx, sign.y + SIGN_BOARD.dy);
        this.signIcon.zIndex = Math.round(sign.y) + 1;
      }
    }
    if (!this.iconReady) {
      // 그림은 회관 레벨마다 늦게 들어온다: 들어오면 그때 단다.
      const ice = artTexture('items', 'food_icecream');
      if (ice !== undefined) {
        this.signIcon.texture = ice;
        this.signIcon.scale.set(SIGN_ICON / Math.max(1, ice.width, ice.height));
        this.iconReady = true;
      }
    }
    const culled = home.x + 160 < view.x0 || home.x - 160 > view.x1 || home.y + 80 < view.y0 || home.y - 220 > view.y1;
    this.pad.visible = !culled;
    this.signIcon.visible = !culled && sign !== null && this.iconReady;
    // 살랑 (바람에 흔들리는 표지판 그림).
    this.signIcon.rotation = Math.sin(this.time * 1.6) * 0.06;
  }

  /** 음표 말풍선: 톡 나타나 흔들리다 사라진다 (트럭 위, 지도를 넓게 보면 조금 크게). */
  private updateBubble(dt: number, scale: number, culled: boolean): void {
    if (this.bubbleT < 0) {
      this.bubble.visible = false;
      return;
    }
    this.bubbleT += dt;
    const e = this.bubbleT;
    if (e >= BUBBLE_SEC) {
      this.bubbleT = -1;
      this.bubble.visible = false;
      return;
    }
    const p = e < 0.3 ? backOut(e / 0.3) : 1;
    const s = this.flip < 0 ? -1 : 1;
    this.bubble.visible = !culled;
    this.bubble.position.set(this.x - 34 * s, this.y - 196 + Math.sin(e * 3) * 3);
    this.bubble.scale.set(p * scale);
    this.bubble.rotation = Math.sin(e * 5) * 0.05;
    this.bubble.alpha = e > BUBBLE_SEC - 0.4 ? (BUBBLE_SEC - e) / 0.4 : 1;
    this.notes.forEach((n, i) => {
      n.y = -14 - Math.abs(Math.sin(e * 7 + i * 1.6)) * 6;
      n.rotation = Math.sin(e * 6 + i) * 0.25;
    });
  }

  /**
   * 트럭을 따라가는 손님은 통통 종종걸음 (몸 맡기기). 트럭 앞 (트럭보다 아래)에 줄 선·사는 손님은 그림만 조금 아래·옆으로:
   * sim 자리 (TRUCK_GEO.serve·queue)는 길 칸 안이라 트럭에 바싹 붙어, 그대로 그리면 머리가 판매 창을 가린다. (tx, ty) = sim 트럭 자리.
   */
  private trot(dt: number, tx: number, ty: number): void {
    const { sim, monsters } = this.ctx;
    const step = dt / FRONT_EASE;
    for (const [id, k] of this.front) {
      const m = sim.monster(id);
      if (m === undefined || m.shop !== 'icecream_truck' || (m.phase !== 'shopQueue' && m.phase !== 'buying')) {
        if (k - step <= 0) this.front.delete(id);
        else this.front.set(id, k - step);
      }
    }
    for (const m of sim.state.monsters) {
      if (m.shop !== 'icecream_truck') continue;
      const v = monsters.get(m.id);
      if (v === undefined) continue;
      if (m.phase === 'toShop') {
        if (v.walking) monsters.puppet(m.id, { lift: Math.abs(Math.sin(this.time * TROT_RATE + m.id * 1.3)) * TROT_LIFT });
        continue;
      }
      if (m.phase !== 'shopQueue' && m.phase !== 'buying') continue;
      const k = Math.min(1, (this.front.get(m.id) ?? 0) + (v.walking ? 0 : step));
      this.front.set(m.id, k);
    }
    for (const [id, k] of this.front) {
      const m = sim.monster(id);
      if (m === undefined || k <= 0) continue;
      const e = k * k * (3 - 2 * k);
      if (m.pos.y > ty) monsters.puppet(id, { dx: (m.pos.x - tx) * FRONT_SPREAD * e, dy: FRONT_DROP * e });
      else monsters.puppet(id, { dx: (m.pos.x - tx) * BACK_SPREAD * e });
    }
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.front.clear();
    this.root.destroy({ children: true });
    this.shadow.destroy();
    this.pad.destroy();
    this.signIcon.destroy();
    this.bubble.destroy({ children: true });
  }
}
