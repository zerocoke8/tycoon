// 지도 위 넷째 묶음 연출 (DESIGN 3.7): 빚 게이지·빚 표, 전당포·은행 볼일, 일터의 흙먼지·돌 조각·땀·한숨·재료, 파산·다 갚음, 빚 걸기 판.
// world.ts가 만들고, 손님을 그린 뒤 update를 부른다 (손님 화면 MonsterView의 drawX·headH·struck을 읽는다). sim은 읽기만 한다 (sim.state, sim.bus 이벤트).
// 층: 효과층 안 (이모트 위, 입자 아래). 머리 위 게이지·표는 지도를 넓게 볼수록 조금 커진다 (폰 확대에서도 읽히게).
//   - 빚 게이지 (일터의 채무자): 갚은 만큼 차는 작은 막대 + 남은 빚. 응원·간식으로 빨라진 동안 반짝. 다 갚으면 꽉 차며 톡 사라진다.
//   - 빚 표 (빚 걸기 판의 채무자): '빚 42' 작은 표. 판이 끝나 빚이 바뀌면 출렁 (줄면 초록, 늘면 빨강으로 잠깐).
//   - 전당포: 맡기면 장신구가 머리(그 자리)에서 떠올라 진열창으로 날아 들어가고 코인이 손님에게, 되찾으면 코인이 가게로 가고 장신구가 날아와 다시 몸에.
//   - 은행: 빌리면 문에서 코인이 손님에게, 갚으면 손님에게서 문으로.
// 화면 연출용 무작위라 Math.random을 쓴다.

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { ACCESSORIES, type AccessoryId, type AccessorySlot, type GroupBoothId, type MaterialId, type WorkFacility } from '../data/defs.ts';
import { SHOP_GEO } from '../data/catalog.ts';
import type { SimApi } from '../sim/api.ts';
import { counterPt, laborGauge } from '../sim/debt.ts';
import type { MonsterId } from '../sim/types.ts';
import { artTexture } from './art.ts';
import type { BuildingsView } from './buildings.ts';
import type { FxLayer } from './fx.ts';
import { clamp, follow, type ViewRect } from './mapUtil.ts';
import type { MonstersView, MonsterView } from './monsterView.ts';

const OUTLINE = 0x402c1c;
/** 빚 게이지 (세계 px, 배율 1): 막대 폭·높이, 머리 위 틈, 남은 빚 글자 크기. */
const GAUGE_W = 48;
const GAUGE_H = 11;
const GAUGE_GAP = 12;
const GAUGE_FONT = 17;
/** 남은 빚 글자는 머리 위 표시 배율이 이보다 작을 때만 (지도를 넓게 보면 막대만: 이웃 게이지와 겹치지 않게). */
const LABEL_MAX_SCALE = 1.25;
/** 게이지: 바탕 = 남은 빚 (흐린 다홍), 채움 = 갚은 만큼 (노랑 → 연두 → 초록). 막 파산하면 다홍 막대가 왼쪽부터 초록으로 바뀐다. */
const GAUGE_COLORS = [0xf3d36a, 0xc9d36a, 0x93c46a] as const;
const GAUGE_BG = 0xd99a86;
/** 빚 표 (빚 걸기 판). */
const BADGE_BG = 0x6e5a86;
const BADGE_UP = 0xc9614a;
const BADGE_DOWN = 0x6f9a3f;
const BADGE_FONT = 20;
/** 머리 위 표시 배율: 확대 z에서 clamp(SCALE_AT / z, 1, SCALE_MAX). 폰 확대에서 커져도 이웃 손님 몸을 덮지 않을 만큼만. */
const SCALE_AT = 0.62;
const SCALE_MAX = 1.3;
/** 빚 걸기 판 자리에 선 선수의 빚 표는 바깥쪽(홍 = 왼쪽, 청 = 오른쪽)으로 이만큼 (세계 px × 배율): 두 표·심판과 겹치지 않게. */
const BADGE_OUT = 44;
/** 빚 걸기 판 정산 글자('빚 42→21')를 선수 바깥쪽으로 미는 만큼 (세계 px × 글자 배율): 글자 반 폭쯤이라 홍·청 글자가 가운데에서 겹치지 않는다. */
const SETTLE_OUT = 90;
/** 같은 편 정산 글자 사이 높이 (글자 배율 × px). */
const SETTLE_ROW = 44;
/** 일터: 땀방울 사이 (초), 기다리는 채무자 한숨 사이 (초). */
const SWEAT_EVERY: readonly [number, number] = [2.4, 4.4];
const SIGH_EVERY: readonly [number, number] = [4.5, 7.5];
/** 밭 흙먼지 색 (fx_puff tint). */
const DIRT_TINT = 0xd8b48a;
/** 재료가 들어가는 일터 소품 (map.ts WORK_YARD.props key). */
const BIN: Record<WorkFacility, string> = { farm: 'crop_basket', mine: 'ore_cart' };
/** 장신구 날기: 맡길 때 떠오르는 초·날아가는 초, 되찾을 때 코인이 먼저 가고 기다리는 초·진열창에서 톡 나오는 초·날아오는 초. */
const PAWN_LIFT = 0.42;
const PAWN_FLY = 0.75;
const REDEEM_WAIT = 0.6;
const REDEEM_POP = 0.22;
const REDEEM_FLY = 0.8;
/** 날아가는 장신구의 가장 작은 폭 (세계 px, 지도를 넓게 볼수록 더): 몸에 달린 작은 핀도 날 때는 보이게 커진다. */
const FLY_MIN_W = 34;
const FLY_GROW = 1.5;

/** 지도·확대 화면 글자를 미리 받는다 (한글 웹 글꼴은 글자 묶음마다 따로 받는다). */
function preloadGlyphs(text: string): void {
  try {
    if (typeof document === 'undefined' || document.fonts === undefined) return;
    void document.fonts.load('20px Jua', text).catch(() => undefined);
  } catch {
    // 글꼴을 못 받아도 대신 글꼴로 그린다.
  }
}
preloadGlyphs('빚 다 갚았다! 홀가분 걸기 판 삑! 삐익! 힘내! 0123456789→');

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const r = Math.round(ar + (((b >> 16) & 255) - ar) * t);
  const g = Math.round(ag + (((b >> 8) & 255) - ag) * t);
  const bl = Math.round(ab + ((b & 255) - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

function gaugeColor(v: number): number {
  const [a, b, c] = GAUGE_COLORS;
  return v < 0.5 ? lerpColor(a, b, v / 0.5) : lerpColor(b, c, (v - 0.5) / 0.5);
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

function backOut(t: number): number {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

/** 일터 채무자 머리 위 빚 게이지 (갚은 만큼 찬다) + 남은 빚. */
class Gauge {
  readonly node = new Container();
  private readonly fill = new Graphics();
  private readonly shine = new Graphics();
  private readonly label: Text;
  /** 그려 보이는 값 (0~1, 실제 값을 부드럽게 따라간다). */
  shown = -1;
  private drawn = -1;
  private debt = -1;
  seen = 0;
  /** 다 갚음: 꽉 차며 톡 커졌다 사라지는 중 (초, 아니면 -1). */
  doneT = -1;
  private bumpT = 0;

  constructor() {
    const bg = new Graphics()
      .roundRect(-GAUGE_W / 2, -GAUGE_H, GAUGE_W, GAUGE_H, GAUGE_H / 2)
      .fill(GAUGE_BG)
      .stroke({ color: OUTLINE, width: 3 });
    const coin = artTexture('items', 'coin');
    const icon = coin !== undefined ? new Sprite(coin) : new Graphics().circle(0, 0, 9).fill(0xf3d36a).stroke({ color: OUTLINE, width: 2.5 });
    if (icon instanceof Sprite) {
      icon.anchor.set(0.5);
      icon.scale.set(20 / Math.max(1, icon.texture.width, icon.texture.height));
    }
    icon.position.set(-GAUGE_W / 2 - 2, -GAUGE_H / 2);
    this.label = new Text({
      text: '',
      style: { fontFamily: 'Jua, sans-serif', fontSize: GAUGE_FONT, fill: OUTLINE, stroke: { color: 0xffffff, width: 5, join: 'round' } },
      resolution: 2,
    });
    this.label.anchor.set(0, 0.55);
    this.label.position.set(GAUGE_W / 2 + 4, -GAUGE_H / 2);
    this.node.addChild(bg, this.fill, this.shine, icon, this.label);
    this.node.eventMode = 'none';
  }

  /** 값 (0~1)과 남은 빚, 응원으로 빨라졌나. */
  set(value: number, debt: number, boosted: boolean, dt: number, time: number, label: boolean): void {
    this.label.visible = label;
    this.shown = this.shown < 0 ? value : this.shown + (value - this.shown) * follow(6, dt);
    if (Math.abs(this.shown - this.drawn) > 0.004) this.redraw(this.shown);
    if (debt !== this.debt) {
      this.debt = debt;
      this.label.text = `${debt}`;
    }
    this.shine.visible = boosted;
    if (boosted) this.shine.alpha = 0.35 + 0.35 * Math.abs(Math.sin(time * 5));
    this.tickBump(dt);
  }

  private redraw(v: number): void {
    this.drawn = v;
    const inner = GAUGE_W - 6;
    const w = Math.max(0, inner * clamp(v, 0, 1));
    this.fill.clear();
    this.shine.clear();
    if (w < 1) return;
    const h = GAUGE_H - 6;
    this.fill.roundRect(-GAUGE_W / 2 + 3, -GAUGE_H + 3, Math.max(h, w), h, h / 2).fill(gaugeColor(v));
    this.shine.roundRect(-GAUGE_W / 2 + 3, -GAUGE_H + 3, Math.max(h, w), h / 2, h / 4).fill({ color: 0xffffff, alpha: 1 });
  }

  /** 빚 1코인을 갚았다: 남은 빚 글자가 톡. */
  bump(): void {
    this.bumpT = 0.35;
  }

  /** 글자 톡 (매 프레임). */
  tickBump(dt: number): void {
    if (this.bumpT <= 0) return;
    this.bumpT = Math.max(0, this.bumpT - dt);
    const u = 1 - this.bumpT / 0.35;
    this.label.scale.set(1 + 0.3 * Math.sin(u * Math.PI));
  }

  /** 다 갚음: 꽉 채운다. */
  finish(): void {
    this.doneT = 0;
    this.redraw(1);
    this.label.text = '0';
    this.shine.visible = false;
  }

  destroy(): void {
    this.node.destroy({ children: true });
  }
}

/** 빚 걸기 판 채무자 머리 위 '빚 42' 표. */
class Badge {
  readonly node = new Container();
  private readonly bg = new Graphics();
  private readonly text: Text;
  private debt = -1;
  private bgW = -1;
  private bgColor = -1;
  seen = 0;
  /** 빚이 바뀌어 출렁·색이 잠깐 바뀌는 남은 초와 그 색. */
  popT = -1;
  private popColor = BADGE_BG;

  constructor() {
    this.text = new Text({
      text: '',
      style: { fontFamily: 'Jua, sans-serif', fontSize: BADGE_FONT, fill: 0xffffff },
      resolution: 2,
    });
    this.text.anchor.set(0.5, 0.55);
    this.text.position.set(0, -BADGE_FONT * 0.65);
    this.node.addChild(this.bg, this.text);
    this.node.eventMode = 'none';
  }

  set(debt: number): void {
    if (debt === this.debt) return;
    const first = this.debt < 0;
    if (!first) {
      this.popT = 1.4;
      this.popColor = debt < this.debt ? BADGE_DOWN : BADGE_UP;
    }
    this.debt = debt;
    this.text.text = `빚 ${debt}`;
  }

  update(dt: number): void {
    let color = BADGE_BG;
    let s = 1;
    if (this.popT > 0) {
      this.popT = Math.max(0, this.popT - dt);
      const u = 1 - this.popT / 1.4;
      color = this.popT > 0.3 ? this.popColor : lerpColor(BADGE_BG, this.popColor, this.popT / 0.3);
      s = u < 0.25 ? 1 + 0.35 * Math.sin((u / 0.25) * Math.PI) : 1;
    }
    this.text.scale.set(s);
    const w = Math.ceil(this.text.width / 2) * 2 + 18;
    if (w !== this.bgW || color !== this.bgColor) {
      this.bgW = w;
      this.bgColor = color;
      const h = BADGE_FONT * 1.3;
      this.bg.clear().roundRect(-w / 2, -h, w, h, h / 2).fill(color).stroke({ color: OUTLINE, width: 3 });
    }
  }

  destroy(): void {
    this.node.destroy({ children: true });
  }
}

/** 날아가는 장신구 하나 (맡기기 = 몸 → 진열창, 되찾기 = 진열창 → 몸). */
interface Flight {
  readonly sp: Sprite;
  readonly kind: 'pawn' | 'redeem';
  readonly id: MonsterId;
  readonly key: AccessoryId;
  readonly slot: AccessorySlot;
  t: number;
  /** 몸 쪽 점 (맡기기 = 떠난 곳, 되찾기 = 닿을 곳: 매 프레임 손님을 따라간다)과 가게 쪽 점. */
  bodyX: number;
  bodyY: number;
  readonly portX: number;
  readonly portY: number;
  /** 몸에 달렸을 때의 폭 (세계 px)·기울기·좌우. */
  w: number;
  rot: number;
  flip: number;
  landed: boolean;
}

/** 조금 뒤에 할 일 (재료가 바구니에 닿으면 바구니 출렁). */
interface Later {
  t: number;
  readonly run: () => void;
}

export interface DebtMapCtx {
  readonly sim: SimApi;
  /** 효과층 안의 그릇 (이모트 위). */
  readonly layer: Container;
  readonly fx: FxLayer;
  readonly buildings: BuildingsView;
  readonly monsters: MonstersView;
}

export class DebtMapView {
  private readonly sim: SimApi;
  private readonly fx: FxLayer;
  private readonly buildings: BuildingsView;
  private readonly monsters: MonstersView;
  private readonly root = new Container();
  private readonly flightLayer = new Container();
  private readonly gauges = new Map<MonsterId, Gauge>();
  private readonly badges = new Map<MonsterId, Badge>();
  private readonly flights: Flight[] = [];
  private readonly later: Later[] = [];
  /** 채무자마다 다음 땀방울·한숨까지 남은 초. */
  private readonly beat = new Map<MonsterId, number>();
  private readonly offs: (() => void)[] = [];
  private frame = 0;
  private time = 0;
  private zoom = 0.5;
  private readonly tmp = { x: 0, y: 0 };
  private readonly acc = { x: 0, y: 0, w: 0, rot: 0, flip: 1, ax: 0.5, ay: 0.5 };

  constructor(ctx: DebtMapCtx) {
    this.sim = ctx.sim;
    this.fx = ctx.fx;
    this.buildings = ctx.buildings;
    this.monsters = ctx.monsters;
    this.root.eventMode = 'none';
    // 게이지·표는 발 높이(zIndex = drawY) 차례로: 앞줄 손님의 게이지가 뒷줄 게이지 위에.
    this.root.sortableChildren = true;
    this.flightLayer.eventMode = 'none';
    this.flightLayer.zIndex = 1e6;
    this.root.addChild(this.flightLayer);
    ctx.layer.addChild(this.root);
    const bus = this.sim.bus;
    this.offs.push(
      bus.on('pawned', (e) => this.pawned(e.id, e.key, e.price)),
      bus.on('redeemed', (e) => this.redeemed(e.id, e.key, e.cost)),
      bus.on('pawnCollected', (e) => {
        if (!e.first) return;
        this.buildings.shopPort('pawnshop', this.tmp);
        this.fx.sparkles(this.tmp.x, this.tmp.y, 6, 50);
      }),
      bus.on('loanTaken', (e) => this.bank(e.id, e.amount, true)),
      bus.on('loanRepaid', (e) => this.bank(e.id, e.amount, false)),
      bus.on('bankrupt', (e) => this.bankrupt(e.id, e.debt, e.paid)),
      bus.on('laborOutput', (e) => this.output(e.id, e.facility, e.material)),
      bus.on('laborTick', (e) => this.gauges.get(e.id)?.bump()),
      bus.on('foremanCheer', (e) => this.foremanCheer(e.id)),
      bus.on('debtCleared', (e) => this.cleared(e.id, e.forgiven === true)),
      bus.on('debtMatchCalled', (e) => this.matchCalled(e.booth, e.debtors)),
      bus.on('debtSettled', (e) => this.settled(e.changes)),
    );
  }

  // ── sim 이벤트 ──

  /** 맡기기: 장신구가 그 자리에서 떠올라 진열창으로, 진열창에 닿으면 코인이 손님에게. */
  private pawned(id: MonsterId, key: AccessoryId, price: number): void {
    const v = this.liveView(id);
    if (v === undefined) return;
    const slot = ACCESSORIES[key].slot;
    v.accessoryAt(key, slot, this.acc);
    this.buildings.shopPort('pawnshop', this.tmp);
    const f = this.flight('pawn', id, key, slot, this.tmp.x, this.tmp.y);
    if (f === null) return;
    const coins = clamp(Math.round(price / 6), 3, 12);
    // 진열창에 닿을 때쯤 코인이 손님에게.
    this.after(PAWN_LIFT + PAWN_FLY, () => {
      const w = this.liveView(id);
      this.buildings.npcHop('pawnshop', 0.9);
      if (w !== undefined) this.fx.coinArc(f.portX, f.portY, w.x, w.y - w.headH * 0.45, coins);
    });
  }

  /** 되찾기: 코인이 손님에게서 가게로, 그다음 장신구가 진열창에서 톡 나와 날아와 다시 몸에 (그동안 몸에는 그리지 않는다). */
  private redeemed(id: MonsterId, key: AccessoryId, cost: number): void {
    const v = this.liveView(id);
    if (v === undefined) return;
    const slot = ACCESSORIES[key].slot;
    v.accessoryAt(key, slot, this.acc);
    this.buildings.shopPort('pawnshop', this.tmp);
    const f = this.flight('redeem', id, key, slot, this.tmp.x, this.tmp.y);
    if (f === null) return;
    v.holdAccessory(key, REDEEM_WAIT + REDEEM_POP + REDEEM_FLY + 0.5);
    this.fx.coinArc(v.x, v.y - v.headH * 0.5, f.portX, f.portY, clamp(Math.round(cost / 6), 3, 12));
    this.after(REDEEM_WAIT, () => this.buildings.npcHop('pawnshop', 1.2));
  }

  /** 은행: 빌리면 문에서 코인이 손님에게, 갚으면 손님에게서 문으로 (닿으면 반짝). */
  private bank(id: MonsterId, amount: number, borrow: boolean): void {
    const v = this.liveView(id);
    this.buildings.shopPort('bank', this.tmp);
    const px = this.tmp.x;
    const py = this.tmp.y;
    this.buildings.npcHop('bank', borrow ? 0.8 : 1.2);
    if (v === undefined) return;
    const n = clamp(Math.round(amount / 5), 4, 14);
    if (borrow) this.fx.coinArc(px, py, v.x, v.y - v.headH * 0.45, n);
    else {
      this.fx.coinArc(v.x, v.y - v.headH * 0.5, px, py, n);
      this.after(0.75, () => this.fx.sparkles(px, py - 20, 5, 40));
    }
  }

  /**
   * 파산: 빚 글자, 회색 김, 축 처짐 (어둠·먹구름·눈물은 손님 화면과 반응이).
   * 지갑에 남았던 코인(paid, 금고로)은 '빚 N' 글자 위에 조금 늦게 (먹구름·게이지와 한꺼번에 겹치지 않게: sim은 이 코인 자리를 주지 않는다).
   */
  private bankrupt(id: MonsterId, debt: number, paid: number): void {
    const v = this.liveView(id);
    if (v === undefined) return;
    this.fx.floatText(v.x, v.headY() - 40, `빚 ${debt}`, 'debt', true);
    this.fx.puff(v.x, v.y, 5, 60, 0x8f8b99);
    if (paid > 0) this.fx.floatText(v.x, v.headY() - 130, `+${paid}`, 'gain', false, 0.9);
  }

  /** 반장이 채무자를 다독인다: 반장이 곁으로 걸어가 '힘내!', 닿으면 그 손님 머리 위에 하트 (빨라진 동안 게이지가 반짝). */
  private foremanCheer(id: MonsterId): void {
    const v = this.liveView(id);
    if (v === undefined) return;
    this.buildings.foremanCheer(v.x, v.y, () => {
      const w = this.liveView(id);
      if (w === undefined) return;
      w.hop(0.6);
      this.fx.hearts(w.x, w.headY() - 20, 2);
    });
  }

  /** 일터 재료: 일하는 손님 머리 위로 톡 튀어 바구니·수레로 들어간다 (닿으면 출렁). */
  private output(id: MonsterId, facility: WorkFacility, material: MaterialId): void {
    const v = this.liveView(id);
    const bin = BIN[facility];
    if (v === undefined || !this.buildings.yardPropTop(bin, this.tmp)) return;
    const tex = artTexture('items', material);
    if (tex === undefined) return;
    const size = 34 * clamp(0.5 / this.zoom, 1, 1.8);
    this.fx.itemArc(tex, v.x, v.headY() + v.headH * 0.2, this.tmp.x, this.tmp.y, 1, size, false);
    this.after(0.62, () => this.buildings.yardPropHop(bin));
  }

  /**
   * 다 갚음: 게이지가 꽉 차며 사라지고, 색종이·반짝이·'빚 다 갚았다!' (반장이 남은 빚을 덜어 줬으면 '홀가분!').
   * 어둠은 손님 화면이 LABOR.reliefSec 동안 걷는다.
   */
  private cleared(id: MonsterId, forgiven: boolean): void {
    this.gauges.get(id)?.finish();
    this.badges.get(id)?.destroy();
    this.badges.delete(id);
    const v = this.liveView(id);
    if (v === undefined) return;
    this.fx.confetti(v.x, v.y - 30, 36);
    this.fx.sparkles(v.x, v.headY() + v.headH * 0.4, 10, v.halfW + 40);
    this.fx.floatText(v.x, v.headY() - 60, forgiven ? '홀가분!' : '빚 다 갚았다!', 'win', true, 0.25);
    if (forgiven) this.buildings.foremanWhistle(false);
  }

  /** 빚 걸기 판: 반장이 크게 호루라기, 불린 채무자들은 깜짝, 부스 위에 '빚 걸기 판!'. */
  private matchCalled(booth: GroupBoothId, debtors: readonly MonsterId[]): void {
    this.buildings.foremanWhistle(true);
    for (const id of debtors) this.liveView(id)?.showEmote(this.monsters.emoteTexture('shock'), 1.4);
    const b = this.sim.village().booth(booth).base;
    this.fx.floatText(b.x, b.y - 280, '빚 걸기 판!', 'debt', true);
  }

  /**
   * 빚 걸기 판 정산: 채무자마다 '빚 42→21' (줄면 초록, 늘면 주황). 글자는 선수의 바깥쪽(선수들 가운데보다 왼쪽 = 홍, 오른쪽 = 청)으로 밀고,
   * 같은 편 둘(줄다리기)은 단을 엇갈린다 (같은 박자로 떠서 단 사이가 그대로). 두 선수 글자가 가운데에서 겹치지 않게.
   * 빚이 0이 된 손님(뒤집기·역전 대박)은 곧 오는 debtCleared가 '빚 다 갚았다!'와 색종이로 맡는다.
   */
  private settled(changes: readonly { id: MonsterId; before: number; after: number }[]): void {
    const list = changes.flatMap((c) => {
      const v = this.liveView(c.id);
      return v === undefined ? [] : [{ c, v }];
    });
    if (list.length === 0) return;
    const cx = list.reduce((n, x) => n + x.v.x, 0) / list.length;
    // fx.floatText와 같은 글자 배율 (확대가 작으면 글자가 커진다).
    const ts = clamp(0.8 / this.zoom, 1, 2.4);
    const rows = [0, 0];
    for (const { c, v } of list) {
      if (c.after === 0) continue;
      const side = v.x < cx ? 0 : 1;
      const row = rows[side] ?? 0;
      rows[side] = row + 1;
      const out = list.length > 1 ? (side === 0 ? -1 : 1) * SETTLE_OUT * ts : 0;
      this.fx.floatText(v.x + out, v.headY() - 70, `빚 ${c.before}→${c.after}`, c.after < c.before ? 'gain' : 'loss', false, 0.3, row * SETTLE_ROW);
    }
  }

  // ── 매 프레임 ──

  /** 손님을 그린 뒤 (drawX·struck이 이 프레임 값). */
  update(dt: number, view: ViewRect, zoom: number): void {
    this.time += dt;
    this.zoom = zoom;
    const frame = ++this.frame;
    const s = clamp(SCALE_AT / zoom, 1, SCALE_MAX);
    const list = this.sim.state.monsters;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m === undefined || m.bankrupt !== true) continue;
      const v = this.monsters.get(m.id);
      if (v === undefined || v.leaving) continue;
      const lab = m.labor;
      const inMatch = lab !== null && lab !== undefined && lab.match !== null;
      const top = v.drawY + v.bodyDy - v.headH - GAUGE_GAP * s;
      const vis = v.drawX > view.x0 - 200 && v.drawX < view.x1 + 200 && v.drawY > view.y0 - 100 && top < view.y1 + 100;
      if (inMatch) {
        let b = this.badges.get(m.id);
        if (b === undefined) {
          b = new Badge();
          this.badges.set(m.id, b);
          this.root.addChildAt(b.node, 0);
        }
        b.seen = frame;
        b.set(m.debt);
        b.update(dt);
        b.node.visible = vis;
        // 자리에 선 선수: 바깥쪽으로, 높이는 선 머리 (쓰러진 선수의 표가 이긴 선수 쪽으로 미끄러지지 않게).
        const out = this.matchSide(m.phase, m.booth, lab.match, v.x);
        if (out !== 0) b.node.position.set(v.x + out * BADGE_OUT * s, v.y - v.headH - GAUGE_GAP * s);
        else b.node.position.set(v.drawX, top);
        b.node.zIndex = v.drawY;
        b.node.scale.set(s);
        v.emoteLift = (BADGE_FONT * 1.3 + 6) * s;
      } else {
        let g = this.gauges.get(m.id);
        if (g === undefined || g.doneT >= 0) {
          g?.destroy();
          g = new Gauge();
          this.gauges.set(m.id, g);
          this.root.addChildAt(g.node, 0);
        }
        g.seen = frame;
        const boosted = lab !== null && lab !== undefined && lab.boostSec > 0 && lab.boostMult > 1;
        g.set(laborGauge(m), Math.ceil(m.debt), boosted, dt, this.time, s <= LABEL_MAX_SCALE);
        g.node.visible = vis;
        g.node.position.set(v.drawX - (s <= LABEL_MAX_SCALE ? 8 * s : 0), top);
        g.node.zIndex = v.drawY;
        g.node.scale.set(s);
        v.emoteLift = (GAUGE_H + 8) * s;
      }
      // 일터: 내려찍을 때 흙먼지·돌 조각, 가끔 땀방울, 기다리면 한숨.
      if (!vis) continue;
      if (m.phase === 'working' && lab !== null && lab !== undefined) {
        if (v.struck) this.strike(v, lab.facility);
        if (this.tick(m.id, dt, SWEAT_EVERY)) {
          const side = Math.random() < 0.5 ? -1 : 1;
          this.fx.sweat(v.drawX + side * v.halfW * 0.35, v.headY() + v.headH * 0.22, side);
        }
      } else if (m.phase === 'waitWork') {
        if (this.tick(m.id, dt, SIGH_EVERY)) this.fx.sigh(v.drawX + v.facing * v.halfW * 0.6, v.headY() + v.headH * 0.45, v.facing);
      }
    }
    // 이 프레임에 보지 못한 표시는 걷는다 (다 갚은 게이지는 꽉 찬 채 톡 커졌다 사라진다).
    for (const [id, g] of this.gauges) {
      if (g.doneT >= 0) {
        g.doneT += dt;
        const u = g.doneT / 0.9;
        const v = this.monsters.get(id);
        if (v !== undefined) g.node.position.set(v.drawX - 8 * s, v.drawY + v.bodyDy - v.headH - GAUGE_GAP * s);
        const pop = u < 0.3 ? 1 + 0.3 * backOut(u / 0.3) : 1.3 + (u - 0.3) * 0.4;
        g.node.scale.set(s * pop);
        g.node.alpha = u < 0.45 ? 1 : Math.max(0, 1 - (u - 0.45) / 0.55);
        if (u >= 1) this.dropGauge(id, g);
        continue;
      }
      if (g.seen !== frame) this.dropGauge(id, g);
    }
    for (const [id, b] of this.badges) {
      if (b.seen === frame) continue;
      b.destroy();
      this.badges.delete(id);
      const v = this.monsters.get(id);
      if (v !== undefined && !this.gauges.has(id)) v.emoteLift = 0;
    }
    for (const id of this.beat.keys()) if (!this.gauges.has(id) && !this.badges.has(id)) this.beat.delete(id);
    this.updateFlights(dt);
    for (let i = this.later.length - 1; i >= 0; i--) {
      const l = this.later[i] as Later;
      l.t -= dt;
      if (l.t > 0) continue;
      this.later.splice(i, 1);
      l.run();
    }
  }

  /** 빚 걸기 판 자리에 선 선수의 바깥쪽 (-1 = 왼쪽·홍, 1 = 오른쪽·청), 아직 걸어가는 중이거나 판 밖이면 0. */
  private matchSide(phase: string, booth: string | null, match: GroupBoothId | null, x: number): -1 | 0 | 1 {
    if (match === null || booth !== match || (phase !== 'playing' && phase !== 'reacting')) return 0;
    const v = this.sim.village();
    const cx = match === 'ssireum' ? v.ring().center.x : match === 'tug' ? v.tug().center.x : x;
    return x < cx ? -1 : x > cx ? 1 : 0;
  }

  private dropGauge(id: MonsterId, g: Gauge): void {
    g.destroy();
    this.gauges.delete(id);
    const v = this.monsters.get(id);
    if (v !== undefined && !this.badges.has(id)) v.emoteLift = 0;
  }

  /** 채무자마다 박자 (땀·한숨): 남은 초를 줄이고 다 되면 true (다음은 every 사이 무작위). */
  private tick(id: MonsterId, dt: number, every: readonly [number, number]): boolean {
    const t = (this.beat.get(id) ?? rand(every[0] * 0.3, every[1])) - dt;
    if (t > 0) {
      this.beat.set(id, t);
      return false;
    }
    this.beat.set(id, rand(every[0], every[1]));
    return true;
  }

  /** 괭이·곡괭이가 땅을 찍었다: 밭은 흙덩이와 흙먼지, 광산은 돌 조각 (가끔 불똥). */
  private strike(v: MonsterView, f: WorkFacility): void {
    const dir = v.facing;
    if (f === 'farm') {
      this.fx.clods(v.strikeX, v.strikeY, 3, dir);
      this.fx.puff(v.strikeX, v.strikeY, 2, 24, DIRT_TINT);
    } else {
      this.fx.chips(v.strikeX, v.strikeY, 3 + (Math.random() < 0.5 ? 1 : 0), dir);
      if (Math.random() < 0.3) this.fx.sparkles(v.strikeX, v.strikeY - 8, 1, 6);
    }
  }

  // ── 장신구 날기 ──

  private flight(kind: 'pawn' | 'redeem', id: MonsterId, key: AccessoryId, slot: AccessorySlot, portX: number, portY: number): Flight | null {
    const tex = artTexture('items', key);
    if (tex === undefined) return null;
    const sp = new Sprite(tex);
    // 몸에 그린 장신구와 같은 붙는 점 (accessoryPlacement의 ax·ay).
    sp.anchor.set(this.acc.ax, this.acc.ay);
    sp.eventMode = 'none';
    sp.visible = false;
    this.flightLayer.addChild(sp);
    const a = this.acc;
    const f: Flight = { sp, kind, id, key, slot, t: 0, bodyX: a.x, bodyY: a.y, portX, portY, w: Math.max(12, a.w), rot: a.rot, flip: a.flip, landed: false };
    this.flights.push(f);
    return f;
  }

  private updateFlights(dt: number): void {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i] as Flight;
      f.t += dt;
      const sp = f.sp;
      const tw = Math.max(1, sp.texture.width);
      // 날 때 크기: 몸에 달린 폭보다 크게, 적어도 FLY_MIN_W (지도를 넓게 보면 더).
      const big = Math.max(f.w * FLY_GROW, FLY_MIN_W * clamp(0.6 / this.zoom, 1, 2));
      let x: number;
      let y: number;
      let w: number;
      let rot: number;
      let alpha = 1;
      let done = false;
      if (f.kind === 'pawn') {
        if (f.t < PAWN_LIFT) {
          // 몸에서 톡 떠오른다 (살짝 커지며 흔들).
          const u = f.t / PAWN_LIFT;
          const e = 1 - (1 - u) ** 3;
          x = f.bodyX;
          y = f.bodyY - 38 * e;
          w = f.w + (big - f.w) * e;
          rot = f.rot + Math.sin(u * Math.PI * 3) * 0.18 * (1 - u);
        } else {
          // 진열창으로 포물선, 작아지며 들어간다.
          const u = Math.min(1, (f.t - PAWN_LIFT) / PAWN_FLY);
          const e = u * u * (3 - 2 * u);
          const sx = f.bodyX;
          const sy = f.bodyY - 38;
          x = sx + (f.portX - sx) * e;
          y = sy + (f.portY - sy) * e - Math.sin(Math.PI * u) * (60 + Math.abs(f.portX - sx) * 0.2);
          w = big * (1 - 0.5 * e);
          rot = f.rot * (1 - u) + Math.sin(u * Math.PI * 2) * 0.25;
          alpha = u < 0.85 ? 1 : 1 - (u - 0.85) / 0.15;
          if (u >= 1) {
            done = true;
            this.fx.sparkles(f.portX, f.portY, 4, 26);
            this.fx.puff(f.portX, f.portY + 10, 2, 30);
          }
        }
      } else {
        // 되찾기: 코인이 가는 동안 기다렸다가, 진열창에서 톡 나와 손님 그 자리로 날아온다 (손님을 따라간다).
        const v = this.liveView(f.id);
        if (v !== undefined) {
          v.accessoryAt(f.key, f.slot, this.acc);
          f.bodyX = this.acc.x;
          f.bodyY = this.acc.y;
          f.w = Math.max(12, this.acc.w);
          f.rot = this.acc.rot;
          f.flip = this.acc.flip;
        }
        const t = f.t - REDEEM_WAIT;
        if (t < 0) {
          sp.visible = false;
          continue;
        }
        if (t < REDEEM_POP) {
          const u = t / REDEEM_POP;
          x = f.portX;
          y = f.portY - 10 * u;
          w = big * 0.8 * backOut(u);
          rot = 0;
        } else {
          const u = Math.min(1, (t - REDEEM_POP) / REDEEM_FLY);
          const e = u * u * (3 - 2 * u);
          const sx = f.portX;
          const sy = f.portY - 10;
          x = sx + (f.bodyX - sx) * e;
          y = sy + (f.bodyY - sy) * e - Math.sin(Math.PI * u) * (70 + Math.abs(f.bodyX - sx) * 0.2);
          w = big * 0.8 + (f.w - big * 0.8) * e * e;
          rot = f.rot * u + Math.sin(u * Math.PI * 2) * 0.2 * (1 - u);
          if (u >= 1) {
            done = true;
            v?.releaseAccessory(f.key);
            this.fx.sparkles(f.bodyX, f.bodyY, 5, 30);
          }
        }
      }
      sp.visible = true;
      sp.position.set(x, y);
      sp.rotation = rot;
      const k = w / tw;
      sp.scale.set(k * f.flip, k);
      sp.alpha = alpha;
      if (done) {
        sp.destroy();
        this.flights.splice(i, 1);
      }
    }
  }

  // ── 도구 ──

  /**
   * 점 at이 전당포·은행 계산대 둘레면 그 가게 진열창·문 위 (마을 금고 코인 글자를 띄울 곳)를 out에 쓰고 true.
   * 빌려주고 돌려받는 코인 글자가 손님 머리 위의 장신구·코인을 가리지 않게 (world.ts coinsChanged).
   */
  shopAbove(at: { readonly x: number; readonly y: number }, out: { x: number; y: number }): boolean {
    for (const shop of ['pawnshop', 'bank'] as const) {
      for (let i = 0; i < SHOP_GEO[shop].counter.length + 2; i++) {
        const c = counterPt(this.sim.state, shop, i);
        if (Math.abs(c.x - at.x) < 2 && Math.abs(c.y - at.y) < 2) {
          this.buildings.shopPort(shop, out);
          out.y -= 90;
          return true;
        }
      }
    }
    return false;
  }

  /** 보이는 (떠나지 않는) 손님 화면. */
  private liveView(id: MonsterId): MonsterView | undefined {
    const v = this.monsters.get(id);
    return v === undefined || v.leaving ? undefined : v;
  }

  private after(sec: number, run: () => void): void {
    this.later.push({ t: sec, run });
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    for (const g of this.gauges.values()) g.destroy();
    for (const b of this.badges.values()) b.destroy();
    this.gauges.clear();
    this.badges.clear();
    this.flights.length = 0;
    this.later.length = 0;
    this.root.destroy({ children: true });
  }
}
