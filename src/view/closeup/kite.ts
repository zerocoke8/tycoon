// 연날리기 대회 확대 화면: closeup/bg_kite (하늘과 언덕) 위, 언덕 꼭대기에 연 날리는 손님 넷(자리 0~3, 바람 부는 오른쪽을 본다)이
// 연줄(코드, 연 색)을 쥐고, 하늘 높이 연 넷(objects/kite_*)이 난다. 빈 자리의 연은 말뚝에 묶여 난다. 앞쪽에 구경 손님 둘(자리 4·5, 옆에 건 연 표).
// 지도와 같은 타임라인: 연 k의 높이·좌우 = play.tracks[2k]·[2k+1] (좌우는 지도와 같은 비율: 연싸움 때 두 연이 두 손님 사이 가운데에서 만난다).
// 연싸움(tangle)이면 두 연이 부르르 떨고 줄이 엇갈린 자리에 불꽃, 끊기면(cut) '툭!' 하고 끊긴 연은 빙글빙글 바람(오른쪽)에 날아가 사라지고
// 남은 줄은 손에서 축 늘어져 떨어진다. 마지막까지 남은 연이 이기면 높이 솟아 반짝인다 (끊길 뻔한 brink는 크게 흔들린다).
// 날리는 손님은 연싸움 때 줄을 당기며 버티고, 끊기면 뒤로 휘청, 끊은 쪽은 폴짝. 구경 손님은 자기 연이 싸우면 땀, 끊기면 깜짝.
// 진행자: 바람지기(왼쪽, 바람개비, 출발 때 '바람 분다!'), 연 장인(오른쪽, 얼레, 해설 말풍선). 하늘에 바람 줄기가 흐른다 (판 중·연싸움 때 세게).
// 위 가운데 판(판 중에만): 연 넷, 끊긴 연은 흐리게 ×, 이긴 연은 금테.
// 상태만으로 맞춘다 (판 중에 열어도 그 시각의 모습): GroupScene의 this.play(kind 'kite')와 this.clock.

import { Container, Graphics, Text } from 'pixi.js';
import { KITE } from '../../data/defs.ts';
import { ease } from '../../core/tween.ts';
import type { SimApi } from '../../sim/api.ts';
import { trackAt } from '../../sim/group/core.ts';
import type { ActiveRound, GroupEvent, GroupPlay, GroupState, MonsterId } from '../../sim/types.ts';
import { type ArtAnchor, type ArtNode, artMeta, artSprite } from '../art.ts';
import type { MonsterActor } from './actor.ts';
import { type Box, fitHost, HostTalk, pickBadge } from './boat_kite_shared.ts';
import { clamp01, confetti, dismiss, FONT, INK, lerp, popCaption, span } from './fx.ts';
import { GroupScene, type GroupHostSpot, type GroupSeat, type GroupStage } from './group.ts';
import type { Layout } from './layout.ts';

type KitePlay = Extract<GroupPlay, { kind: 'kite' }>;

/** closeup/bg_kite에서 잰 언덕 선 (배경 높이의 비율): 가운데 꼭대기, 양끝. */
const BG_KITE = { crest: 0.7, edge: 0.765 } as const;
/** 연 그림의 연줄 매는 자리 (가운데 열십자, 캔버스 px). */
const KITE_BRIDLE: Readonly<Record<string, { x: number; y: number }>> = {
  kite_red: { x: 510, y: 321 },
  kite_blue: { x: 509, y: 358 },
  kite_yellow: { x: 511, y: 317 },
  kite_green: { x: 511, y: 365 },
};
/** 연 폭 (마름모, 캔버스 px)과 화면 폭 (무대 폭 비율). */
const KITE_ART_W = 470;
const KITE_W = 0.125;
/** 지도 sim과 같은 좌우 단위: 날리는 자리 사이 = SPOT_GAP 단위 (sim/group/kite.ts). */
const SPOT_GAP = 130 / 95;
/** 날리는 손님 가로 자리 (무대 폭 비율)와 연이 바람 쪽(오른쪽)으로 비켜 나는 거리. */
const FLYER_X = [0.28, 0.43, 0.58, 0.73];
const DOWNWIND = 0.045;
const FLYER_SCALE = 0.42;
const BETTOR_SCALE = 0.48;
const HOST_SCALE = 0.48;
/** 출발을 기다리는 연 높이 (손에 들고 머리 위로): 판은 손 높이 0에서 떠오르니, 판 첫 1초는 이 높이에서 이어 간다. */
const READY_H = 0.1;
/** 끊긴 연이 날아가 사라지는 초, 남은 줄이 떨어지는 초. */
const FLY_SEC = 2.6;
const DROP_SEC = 1.3;
/** 연줄 색: 연 색을 조금 어둡게. */
const stringColor = (c: number): number => {
  const d = (v: number): number => Math.round(v * 0.72);
  return (d((c >> 16) & 0xff) << 16) | (d((c >> 8) & 0xff) << 8) | d(c & 0xff);
};
const kiteName = (k: number): string => KITE.kites[k]?.name ?? '';
const kiteColor = (k: number): number => KITE.kites[k]?.color ?? 0xffffff;

/** 장면 배치 (패널 px). layout()은 GroupScene 생성자 안에서 불리므로 L만으로 계산한다. */
interface Geom {
  /** 언덕 선 y (가로 x에서). */
  hill(x: number): number;
  readonly seats: readonly GroupSeat[];
  readonly hosts: readonly GroupHostSpot[];
  /** 연이 가장 높이 날 때의 연줄 매는 자리 y. */
  readonly topY: number;
  /** 좌우 1단위 (px). */
  readonly sway: number;
}

/** 위 가운데 판 칸 크기와 위 끝 (판 중에만 보인다). */
const boardSlot = (L: Layout): number => Math.max(26, L.sw * 0.085);
const boardTop = (L: Layout): number => Math.max(10, L.h * 0.025);

function kiteGeom(L: Layout): Geom {
  const { sx, sw, h } = L;
  const size = L.bg.size;
  const cx = L.bg.x + size / 2;
  const hill = (x: number): number => {
    const d = (x - cx) / (size / 2);
    return L.bg.y + size * (BG_KITE.crest + (BG_KITE.edge - BG_KITE.crest) * d * d);
  };
  const flyers: GroupSeat[] = FLYER_X.map((f, i) => {
    const x = sx + sw * f;
    return { x, y: hill(x) + h * 0.025, scale: FLYER_SCALE, z: 34 + i * 0.01, face: -1 };
  });
  const bettors: GroupSeat[] = [
    // 왼쪽 구경 손님은 항아리 오른쪽에 (항아리에 가려지지 않게).
    { x: sx + sw * 0.36, y: h - 3, scale: BETTOR_SCALE, z: 38, face: -1 },
    { x: sx + sw * 0.76, y: h - 3, scale: BETTOR_SCALE, z: 38.1, face: 1 },
  ];
  const wx = sx + sw * 0.08;
  const mx = sx + sw * 0.92;
  return {
    hill,
    seats: [...flyers, ...bettors],
    hosts: [
      { x: mx, y: hill(mx) + h * 0.02, face: -1 },
      { x: wx, y: hill(wx) + h * 0.02, face: 1 },
    ],
    // 가장 높이 나는 연의 머리가 위 가운데 판 아래에 오게.
    topY: boardTop(L) + boardSlot(L) * 0.92 + L.sw * KITE_W * (900 / KITE_ART_W) * 0.3 + 6,
    sway: (sw * (FLYER_X[1]! - FLYER_X[0]!)) / SPOT_GAP,
  };
}

/** 연싸움 하나 (사건 tangle → cut). */
interface Fight {
  readonly a: number;
  readonly b: number;
  readonly t0: number;
  readonly t1: number;
}

/** 지금 보여 주는 판 하나. */
interface Show {
  readonly play: KitePlay;
  readonly fights: readonly Fight[];
  /** 다음에 볼 사건 (play.events index). */
  cursor: number;
  /** brink 사건 때 (없으면 -1), 승부가 난 때. */
  readonly brinkAt: number;
  readonly finishAt: number;
}

interface Kite {
  readonly node: ArtNode;
  /** 쉬는 동안 보여 주는 높이·좌우·투명도 (판이 끝나면 여기서 이어 간다). */
  h: number;
  s: number;
  alpha: number;
  /** 마지막으로 그린 자리 (끊긴 연이 날아가기 시작하는 곳). */
  x: number;
  y: number;
}

interface Streak {
  x: number;
  y: number;
  len: number;
  v: number;
}

export class KiteScene extends GroupScene {
  private readonly G: Geom;
  private readonly kites: Kite[] = [];
  private readonly strings = new Graphics();
  private readonly sparks = new Graphics();
  private readonly pegs = new Graphics();
  private readonly wind = new Graphics();
  private readonly streaks: Streak[] = [];
  private readonly board = new Container();
  private readonly boardIcons: ArtNode[] = [];
  private readonly boardMarks = new Graphics();
  private readonly boardX: number[] = [];
  private readonly boardBox: Box;
  private readonly boardSlot: number;
  private readonly capY: number;
  private readonly talk: HostTalk;
  private readonly betBadges: Container[] = [];
  private readonly badgeShown: number[];
  private readonly lastEmote: number[];
  private bigCap: Text | null = null;
  private show: Show | null = null;
  /** 지난 프레임에 보여 준 판 (판이 바뀌는 순간을 알려고). */
  private shownPlay: KitePlay | null = null;
  /** 단위 길이 (무대 폭 360px 기준 1). */
  private readonly u: number;
  private readonly kK: number;
  /** 바람이 세게 부는 남은 초 (연싸움·출발 때). */
  private gustLeft = 0;

  constructor(sim: SimApi, w: number, h: number, onTap: (id: MonsterId) => void) {
    super(sim, 'kite', w, h, onTap);
    const L = this.L;
    const G = kiteGeom(L);
    this.G = G;
    this.u = L.sw / 360;
    this.kK = (L.sw * KITE_W) / KITE_ART_W;
    this.stage.sortableChildren = true;
    this.wind.zIndex = 0;
    this.pegs.zIndex = 1;
    this.strings.zIndex = 2;
    this.sparks.zIndex = 20;
    this.stage.addChild(this.wind, this.pegs, this.strings, this.sparks);
    KITE.kites.forEach((k, i) => {
      const m = artMeta('objects', k.key);
      const anchor: ArtAnchor = m !== undefined ? (KITE_BRIDLE[k.key] ?? 'center') : 'center';
      const node = artSprite('objects', k.key, { k: this.kK, anchor, placeholder: { w: 480, h: 900, color: k.color } });
      node.zIndex = 10 + i;
      this.stage.addChild(node);
      this.kites.push({ node, h: 0.32, s: 0, alpha: 1, x: 0, y: 0 });
    });
    for (let i = 0; i < 7; i++) this.streaks.push(this.newStreak(true));

    // 위 가운데 판: 연 넷 (끊기면 흐리게 ×, 이긴 연은 금테)
    const slot = boardSlot(L);
    this.boardSlot = slot;
    const bw = slot * 4 + slot * 0.4;
    const bh = slot * 0.92;
    this.board.position.set(L.w / 2, boardTop(L) + bh / 2);
    this.boardBox = { x0: L.w / 2 - bw / 2, x1: L.w / 2 + bw / 2, bottom: this.board.y + bh / 2 };
    this.board.visible = false;
    this.board.addChild(new Graphics().roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2).fill({ color: 0xfff6e6, alpha: 0.93 }).stroke({ color: INK, width: 2 }));
    KITE.kites.forEach((k, i) => {
      const x = -bw / 2 + slot * 0.2 + slot * (i + 0.5);
      this.boardX.push(x);
      const icon = artSprite('objects', k.key, { k: (slot * 0.74) / 900, anchor: 'center', placeholder: { w: 480, h: 900, color: k.color } });
      icon.position.set(x, 0);
      this.boardIcons.push(icon);
      this.board.addChild(icon);
    });
    this.board.addChild(this.boardMarks);
    this.ui.addChild(this.board);
    // 큰 결과 글자는 하늘 가운데 (승부가 나면 남은 연 하나가 그 위로 솟는다).
    const handY = (G.seats[0]?.y ?? L.h * 0.7) - L.bodyH * FLYER_SCALE * 0.62;
    this.capY = Math.max(this.boardBox.bottom + L.caption.size * 0.55, lerp(G.topY, handY, 0.5));
    this.talk = new HostTalk(this.ui, this.anim, L.w, Math.max(13, L.sw * 0.042));

    const n = this.actors.length;
    this.badgeShown = Array.from({ length: n }, () => -1);
    this.lastEmote = Array.from({ length: n }, () => -9);
    for (let i = 0; i < n; i++) {
      const b = new Container();
      const at = G.seats[i];
      if (at !== undefined) b.position.set(at.x + at.face * L.bodyH * at.scale * 0.5, at.y - L.bodyH * at.scale * 0.62);
      b.zIndex = 52;
      this.betBadges.push(b);
      this.root.addChild(b);
    }
    this.update(0);
  }

  protected layout(L: Layout): GroupStage {
    const G = kiteGeom(L);
    return { seats: G.seats, hosts: G.hosts };
  }

  // ── 매 프레임 ───────────────────────────────────────────────────────────

  protected drawPlay(play: GroupPlay | null, t: number, dt: number): void {
    const G = this.G;
    this.hosts.forEach((h, i) => {
      const at = G.hosts[i];
      if (h !== null && at !== undefined) fitHost(h, at, HOST_SCALE, this.L.w);
    });
    const kp = play !== null && play.kind === 'kite' ? play : null;
    if (kp !== this.shownPlay) this.switchPlay(kp, t);
    const g = this.group;
    this.syncBadges();
    this.strings.clear();
    this.sparks.clear();
    this.pegs.clear();
    const sh = this.show;
    if (sh !== null) this.events(sh, t);
    for (let k = 0; k < this.kites.length; k++) this.drawKite(k, sh, t, dt, g);
    this.drawFights(sh, t);
    this.flyerMoves(sh, t);
    this.bettorMoves(sh, t);
    this.hostMoves(sh, t, g);
    this.drawBoard(sh, t);
    this.drawWind(dt, sh, t);
    this.talk.update(this.time);
  }

  /** 판이 바뀌었다: 새 판이면 연싸움 목록을 만들고, 판이 끝나 쉬면 끊긴 연은 손에서 새로 띄운다. */
  private switchPlay(kp: KitePlay | null, t: number): void {
    const prev = this.shownPlay;
    this.shownPlay = kp;
    if (kp === null) {
      if (prev !== null) {
        this.kites.forEach((k, i) => {
          if ((prev.cutAt[i] ?? -1) >= 0) {
            k.h = 0;
            k.s = 0;
            k.alpha = 0;
          } else {
            // 이긴 연은 높이 솟은 자리에서 내려온다.
            const h = trackAt(prev.tracks[i * 2] ?? [], prev.end);
            k.h = prev.order[prev.order.length - 1] === i ? h + (1 - h) * 0.5 : h;
            k.s = trackAt(prev.tracks[i * 2 + 1] ?? [], prev.end);
          }
        });
      }
      this.show = null;
      this.board.visible = false;
      return;
    }
    const fights: Fight[] = [];
    for (const ev of kp.events) {
      if (ev.type !== 'tangle') continue;
      const cut = kp.events.find((e) => e.type === 'cut' && e.actor === ev.actor && e.t >= ev.t);
      fights.push({ a: ev.actor, b: ev.other ?? -1, t0: ev.t, t1: cut?.t ?? ev.t + 1 });
    }
    const brink = kp.events.find((e) => e.type === 'brink');
    const fin = kp.events.find((e) => e.type === 'finish');
    // 중간에 열었으면 지난 사건은 건너뛴다 (조금 전 것은 보여 준다).
    let cursor = 0;
    while (cursor < kp.events.length && (kp.events[cursor]?.t ?? 0) < t - 0.4) cursor++;
    this.show = { play: kp, fights, cursor, brinkAt: brink?.t ?? -1, finishAt: fin?.t ?? kp.end };
    if (this.bigCap !== null) dismiss(this.anim, this.bigCap);
    this.bigCap = null;
  }

  /** 자리 k(0~3) 연줄을 쥔 손 (패널 px): 날리는 손님이 있으면 그 손, 없으면 말뚝 머리. */
  private hand(k: number): { x: number; y: number; held: boolean } {
    const at = this.seatAt[k];
    if (at === undefined) return { x: 0, y: 0, held: false };
    const a = this.actor(k);
    if (a === null) return { x: at.x + this.L.sw * 0.02, y: at.y - 10 * this.u, held: false };
    // 앞으로 든 손 (그림은 왼쪽을 본다: 앞 = 몸 기준 -x).
    const off = a.bodyOffset();
    return { x: a.root.x + (off.x - a.bodyH * 0.26) * a.root.scale.x, y: a.root.y + (off.y - a.bodyH * 0.62) * a.root.scale.y, held: true };
  }

  /** 연 k의 연줄 매는 자리 (높이 h, 좌우 s: 흔들림 없이). */
  private kitePoint(k: number, h: number, s: number): { x: number; y: number } {
    const at = this.seatAt[k];
    if (at === undefined) return { x: 0, y: 0 };
    const base = at.y - this.L.bodyH * FLYER_SCALE * 0.62;
    return { x: at.x + this.L.sw * DOWNWIND + s * this.G.sway, y: base - h * (base - this.G.topY) };
  }

  private drawKite(k: number, sh: Show | null, t: number, dt: number, g: GroupState | null): void {
    const kite = this.kites[k];
    const at = this.seatAt[k];
    if (kite === undefined || at === undefined) return;
    const hand = this.hand(k);
    if (!hand.held) {
      // 말뚝 (빈 자리)
      const pw = Math.max(4, 5 * this.u);
      this.pegs.roundRect(hand.x - pw / 2, hand.y - 2, pw, 14 * this.u, pw * 0.4).fill({ color: 0xa0703f }).stroke({ color: INK, width: 1.5 });
    }
    const kp = sh?.play ?? null;
    const node = kite.node;
    const cut = kp?.cutAt[k] ?? -1;
    const col = stringColor(kiteColor(k));
    if (kp !== null && cut >= 0 && t >= cut) {
      // 끊긴 연: 끊긴 자리에서 빙글빙글 바람(오른쪽)에 날아가 사라진다. 남은 줄은 손에서 축 늘어져 떨어진다.
      const u = t - cut;
      const p0 = this.kitePoint(k, trackAt(kp.tracks[k * 2] ?? [], cut), trackAt(kp.tracks[k * 2 + 1] ?? [], cut));
      const L = this.L;
      const x = p0.x + u * L.sw * 0.2 + u * u * L.sw * 0.04;
      const y = p0.y - Math.sin(Math.min(u, 1.4) * 1.6) * L.h * 0.08 + Math.max(0, u - 1.2) * L.h * 0.05;
      node.position.set(x, y);
      node.rotation = u * 6;
      node.scale.set(Math.max(0.5, 1 - u * 0.12));
      node.alpha = Math.max(0, 1 - u / FLY_SEC);
      kite.x = x;
      kite.y = y;
      if (node.alpha > 0.05) {
        // 연에 달린 짧은 줄 토막
        const tail = 18 * this.u;
        this.strings.moveTo(x, y).quadraticCurveTo(x - tail * 0.6, y + tail * 0.4 + Math.sin(u * 9) * 4, x - tail, y + tail).stroke({ width: 1.4, color: col, alpha: node.alpha });
      }
      if (u < DROP_SEC) {
        const f = this.fightOf(sh, k);
        const cp = f !== null ? this.crossPoint(f, cut) : p0;
        const fall = ease.inQuad(clamp01(u / DROP_SEC));
        const ex = lerp(cp.x, hand.x + L.sw * 0.1, fall);
        const ey = lerp(cp.y, at.y, fall);
        this.strings.moveTo(hand.x, hand.y).quadraticCurveTo((hand.x + ex) / 2, Math.max(hand.y, ey) + L.h * 0.06 * fall, ex, ey).stroke({ width: 1.6, color: col, alpha: 1 - u / DROP_SEC });
      }
      return;
    }
    // 나는 연
    let h: number;
    let s: number;
    if (kp !== null) {
      h = trackAt(kp.tracks[k * 2] ?? [], t);
      s = trackAt(kp.tracks[k * 2 + 1] ?? [], t);
      // 이긴 연은 승부가 나면 높이 솟는다.
      if (sh !== null && kp.order[kp.order.length - 1] === k) h += (1 - h) * 0.5 * ease.outCubic(span(t, sh.finishAt, sh.finishAt + 1.4));
      h = Math.max(h, READY_H * (1 - span(t, 0.2, 1.2)));
      kite.h = h;
      kite.s = s;
      kite.alpha = 1;
    } else {
      // 쉬는 동안: 낮게 둥실. 출발 직전엔 손으로 내려 받는다 (판은 손 높이에서 떠오른다).
      const gathering = g !== null && g.phase === 'gathering';
      const ready = gathering ? clamp01((g.countdown - 0.3) / 2) : 1;
      const th = READY_H + (0.22 + Math.sin(this.time * 0.9 + k) * 0.05) * ready;
      const ts = Math.sin(this.time * 0.7 + k * 2) * 0.25 * ready;
      const r = Math.min(1, dt * 1.6);
      kite.h += (th - kite.h) * r;
      kite.s += (ts - kite.s) * r;
      kite.alpha = Math.min(1, kite.alpha + dt * 0.9);
      h = kite.h;
      s = kite.s;
    }
    const p = this.kitePoint(k, h, s);
    const lift = clamp01(h * 3);
    let x = p.x + Math.sin(this.time * 1.7 + k) * 3 * this.u * lift;
    let y = p.y + Math.cos(this.time * 1.3 + k) * 4 * this.u * lift;
    let rot = Math.sin(this.time * 1.5 + k) * 0.12 * lift + s * 0.06;
    // 연싸움: 부르르 (끊길 뻔한 brink는 더 크게)
    const f = this.fightAt(sh, k, t);
    if (f !== null) {
      const q = span(t, f.t0, f.t0 + 0.3);
      rot += Math.sin(this.time * 38 + k) * 0.1 * q;
      x += Math.sin(this.time * 31 + k * 2) * 1.6 * this.u * q;
    }
    if (sh !== null && sh.brinkAt >= 0 && kp !== null && kp.order[kp.order.length - 1] === k) {
      const b = span(t, sh.brinkAt - 0.3, sh.brinkAt) * (1 - span(t, sh.brinkAt + 0.4, sh.brinkAt + 0.9));
      rot += Math.sin(this.time * 26) * 0.35 * b;
      y += b * 10 * this.u;
    }
    node.position.set(x, y);
    node.rotation = rot;
    node.scale.set(1);
    node.alpha = kite.alpha;
    kite.x = x;
    kite.y = y;
    // 연줄: 손에서 연까지, 조금 처지게 (높이 날수록 팽팽하게).
    const dx = x - hand.x;
    const dy = y - hand.y;
    const len = Math.hypot(dx, dy);
    const sag = len * (0.12 - 0.07 * clamp01(h)) * (f !== null ? 0.4 : 1);
    this.strings.moveTo(hand.x, hand.y).quadraticCurveTo(hand.x + dx * 0.5 + sag * 0.6, hand.y + dy * 0.5 + sag, x, y).stroke({ width: Math.max(1.3, 1.6 * this.u), color: col, alpha: 0.95 * kite.alpha });
  }

  /** t에 연 k가 싸우는 중이면 그 싸움. */
  private fightAt(sh: Show | null, k: number, t: number): Fight | null {
    if (sh === null) return null;
    return sh.fights.find((f) => (f.a === k || f.b === k) && t >= f.t0 && t < f.t1) ?? null;
  }

  /** 연 k가 끊긴 싸움. */
  private fightOf(sh: Show | null, k: number): Fight | null {
    return sh?.fights.find((f) => f.a === k) ?? null;
  }

  /** 싸움 f의 두 연줄이 엇갈린 자리 (t 기준: 두 줄의 교차점, 없으면 두 연 사이 아래). */
  private crossPoint(f: Fight, t: number): { x: number; y: number } {
    const kp = this.show?.play;
    if (kp === undefined) return { x: 0, y: 0 };
    const pa = this.kitePoint(f.a, trackAt(kp.tracks[f.a * 2] ?? [], t), trackAt(kp.tracks[f.a * 2 + 1] ?? [], t));
    const pb = this.kitePoint(f.b, trackAt(kp.tracks[f.b * 2] ?? [], t), trackAt(kp.tracks[f.b * 2 + 1] ?? [], t));
    const ha = this.hand(f.a);
    const hb = this.hand(f.b);
    const d = (pa.x - ha.x) * (pb.y - hb.y) - (pa.y - ha.y) * (pb.x - hb.x);
    if (Math.abs(d) > 1e-6) {
      const ua = ((hb.x - ha.x) * (pb.y - hb.y) - (hb.y - ha.y) * (pb.x - hb.x)) / d;
      if (ua > 0.5 && ua < 1) return { x: ha.x + (pa.x - ha.x) * ua, y: ha.y + (pa.y - ha.y) * ua };
    }
    return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 + 16 * this.u };
  }

  /** 연싸움 중인 줄이 엇갈린 자리에 반짝 불꽃. */
  private drawFights(sh: Show | null, t: number): void {
    if (sh === null) return;
    for (const f of sh.fights) {
      if (t < f.t0 || t >= f.t1 + 0.25) continue;
      const p = this.crossPoint(f, Math.min(t, f.t1));
      const flick = 0.6 + 0.4 * Math.abs(Math.sin(this.time * 23));
      const r = 7 * this.u * flick * (t >= f.t1 ? 1.8 : 1);
      this.star(p.x, p.y, r, this.time * 4, 0xfff3a8);
      this.star(p.x + 6 * this.u * Math.sin(this.time * 17), p.y - 5 * this.u, r * 0.5, -this.time * 5, 0xffffff);
    }
  }

  private star(x: number, y: number, r: number, rot: number, color: number): void {
    const pts: number[] = [];
    for (let i = 0; i < 8; i++) {
      const a = rot + (i * Math.PI) / 4;
      const rr = i % 2 === 0 ? r : r * 0.38;
      pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    this.sparks.poly(pts).fill({ color }).stroke({ color: INK, width: Math.max(1, r * 0.14), join: 'round' });
  }

  // ── 사건 (타임라인을 시각대로) ─────────────────────────────────────────

  private events(sh: Show, t: number): void {
    const evs = sh.play.events;
    while (sh.cursor < evs.length) {
      const ev = evs[sh.cursor];
      if (ev === undefined || ev.t > t) break;
      sh.cursor++;
      this.onEvent(sh, ev);
    }
    // 출발: 바람지기가 바람을 부른다.
    if (t < 0.6 && !this.talk.busy(this.time, 0) && t >= 0 && t < 0.2) this.say(1, '바람 분다!', 1.1);
  }

  private onEvent(sh: Show, ev: GroupEvent): void {
    const L = this.L;
    switch (ev.type) {
      case 'tangle': {
        this.say(0, '연싸움이다!', 1.1);
        this.gust(1.4);
        for (const k of [ev.actor, ev.other ?? -1]) {
          const a = this.actor(k);
          if (a !== null) a.emote('shock', 0.85);
        }
        this.forBettors((a, pick) => {
          if (pick === ev.actor || pick === ev.other) this.emoteOnce(a, 'sweat');
        });
        break;
      }
      case 'cut': {
        const f = this.fightOf(sh, ev.actor);
        const p = f !== null ? this.crossPoint(f, ev.t) : { x: this.kites[ev.actor]?.x ?? L.w / 2, y: this.kites[ev.actor]?.y ?? L.h / 3 };
        popCaption(this.fx, this.anim, '툭!', p.x, p.y - 10 * this.u, Math.max(18, L.sw * 0.07), 0xffffff, 0.5);
        const late = sh.play.late && sh.play.order[sh.play.order.length - 2] === ev.actor;
        this.say(0, late ? '아이고, 아깝다!' : `${kiteName(ev.actor)} 끊어졌다!`, 1.2);
        const loser = this.actor(ev.actor);
        if (loser !== null) {
          loser.showPose('agony', 1.6);
          loser.emote('shock', 1);
        }
        const cutter = this.actor(ev.other ?? -1);
        if (cutter !== null) {
          cutter.showPose('joy', 1);
          cutter.playMotion('hop', 0.8, 0.7);
        }
        this.forBettors((a, pick) => {
          if (pick === ev.actor) {
            a.emote('shock', 0.9);
            a.showPose('agony', 1.2);
          } else if (pick === ev.other) this.emoteOnce(a, 'note');
        });
        break;
      }
      case 'brink': {
        this.say(0, '아슬아슬!', 1);
        const a = this.actor(ev.actor);
        if (a !== null) a.emote('sweat', 1);
        break;
      }
      case 'finish':
        this.finish(sh, ev.actor);
        break;
      default:
        break;
    }
  }

  /** 승부가 났다: 큰 글자, 해설, 참가자 다 같이 반응, 색종이. */
  private finish(sh: Show, winner: number): void {
    const L = this.L;
    const kp = sh.play;
    if (this.bigCap !== null) dismiss(this.anim, this.bigCap);
    this.bigCap = popCaption(this.ui, this.anim, kp.close ? '버텨 냈다!' : `${kiteName(winner)} 우승!`, L.w / 2, this.capY, L.caption.size * (kp.close ? 0.9 : 0.7), kp.close ? 0xffc83d : 0xffffff, 1.4);
    this.say(0, kp.close ? `${kiteName(winner)} 우승!` : '하늘의 주인공!', 1.4);
    const g = this.group;
    let fans = 0;
    g?.participants.forEach((e, i) => {
      const a = this.actor(e.seat);
      const tier = kp.outcomes[i]?.tier ?? 'lose';
      if (tier === 'jackpot' || tier === 'win') fans++;
      if (a === null) return;
      if (tier === 'jackpot' || tier === 'win') {
        a.showPose('joy', 1.6);
        a.playMotion(tier === 'jackpot' ? 'bigHop' : 'hop', tier === 'jackpot' ? 1.2 : 1, 1.4);
        if (tier === 'jackpot') a.emote('sparkle', 1.1);
      } else if (tier === 'nearMiss') {
        a.showPose('agony', 1.6);
        a.playMotion('tremble', 1, 1.4);
      }
      a.holdUntil = Math.max(a.holdUntil, this.time + 3);
    });
    for (const h of this.hosts) h?.cheer(kp.close);
    confetti(this.fx, this.anim, L.w, L.h, kp.close && fans > 0 ? 50 : fans > 0 ? 24 : 12);
  }

  private forBettors(fn: (a: MonsterActor, pick: number) => void): void {
    for (const e of this.group?.participants ?? []) {
      if (e.role !== 'bettor') continue;
      const a = this.actor(e.seat);
      if (a !== null) fn(a, e.pick);
    }
  }

  private emoteOnce(a: MonsterActor, kind: 'sweat' | 'note' | 'heart'): void {
    const i = this.actors.indexOf(a);
    if (i < 0 || this.time - (this.lastEmote[i] ?? -9) < 1.2) return;
    this.lastEmote[i] = this.time;
    a.emote(kind, 0.85);
  }

  // ── 사람들 ─────────────────────────────────────────────────────────────

  /** 날리는 손님: 연을 올려다보며 줄을 잡고 살짝 뒤로 기댄다. 연싸움 땐 당기며 버티고, 끊기면 뒤로 휘청했다 주저앉는다. */
  private flyerMoves(sh: Show | null, t: number): void {
    const H = this.L.bodyH * FLYER_SCALE;
    for (let k = 0; k < 4; k++) {
      const a = this.actor(k);
      if (a === null) continue;
      const kp = sh?.play ?? null;
      const cut = kp?.cutAt[k] ?? -1;
      // 화면 왼쪽 = 뒤 (바람을 등지고 오른쪽 연을 본다).
      if (kp !== null && cut >= 0 && t >= cut) {
        const u = t - cut;
        const stagger = Math.sin(Math.PI * clamp01(u / 0.5));
        this.move(a, -H * 0.12 * stagger, H * 0.02 * stagger, -0.22 * stagger);
        continue;
      }
      const f = this.fightAt(sh, k, t);
      if (f !== null) {
        const q = span(t, f.t0, f.t0 + 0.25);
        const pull = Math.sin(this.time * 9 + k);
        this.move(a, (-H * 0.05 + pull * H * 0.04) * q, 0, (-0.12 + pull * 0.06) * q);
        a.eager = 0.4;
        continue;
      }
      const flying = kp !== null ? 1 : 0.5;
      this.move(a, Math.sin(this.time * 2.1 + k) * H * 0.015 * flying, 0, -0.05 * flying + Math.sin(this.time * 1.3 + k) * 0.02);
    }
  }

  /** 구경 손님: 자기 연이 날고 있으면 들썩, 싸우면 조마조마 (떨림), 끊기면 풀이 죽는다. */
  private bettorMoves(sh: Show | null, t: number): void {
    if (sh === null) return;
    const kp = sh.play;
    this.forBettors((a, pick) => {
      if (t >= sh.finishAt) return;
      const cut = kp.cutAt[pick] ?? -1;
      if (cut >= 0 && t >= cut) {
        a.rig.sy = 0.96;
        return;
      }
      if (this.fightAt(sh, pick, t) !== null) {
        a.rig.dx = Math.sin(this.time * 55) * a.bodyH * 0.012;
        return;
      }
      a.eager = t > 1 ? 0.5 : 0;
    });
  }

  /** 진행자: 바람지기는 출발 때 바람개비를 번쩍 들고 평소엔 살랑, 연 장인은 말할 때 들썩. */
  private hostMoves(sh: Show | null, t: number, g: GroupState | null): void {
    const wind = this.hosts[1] ?? null;
    if (wind !== null) {
      const start = sh !== null ? Math.sin(Math.PI * span(t, 0, 0.7)) : 0;
      const ready = g !== null && g.phase === 'gathering' && g.countdown < 2.5 ? 0.6 : 0;
      wind.rig.rot = Math.sin(this.time * 1.4) * 0.04 - 0.18 * start - 0.06 * ready;
      wind.rig.dy = -wind.height * 0.04 * start;
    }
    const master = this.hosts[0] ?? null;
    if (master !== null && this.talk.busy(this.time, 0)) master.rig.dy = -Math.abs(Math.sin(this.time * 9)) * master.height * 0.012;
  }

  /** 위 가운데 판: 끊긴 연은 흐리게 ×, 승부가 나면 이긴 연에 금테. */
  private drawBoard(sh: Show | null, t: number): void {
    this.board.visible = sh !== null;
    if (sh === null) return;
    const kp = sh.play;
    const m = this.boardMarks;
    m.clear();
    const s = this.boardSlot;
    const winner = kp.order[kp.order.length - 1] ?? -1;
    for (let k = 0; k < this.boardIcons.length; k++) {
      const icon = this.boardIcons[k];
      if (icon === undefined) continue;
      const x = this.boardX[k] ?? 0;
      const cut = kp.cutAt[k] ?? -1;
      const gone = cut >= 0 && t >= cut;
      icon.alpha = gone ? 0.35 : 1;
      icon.scale.set(1);
      if (gone) {
        const r = s * 0.22;
        m.moveTo(x - r, -r).lineTo(x + r, r).moveTo(x + r, -r).lineTo(x - r, r).stroke({ color: 0xd9534f, width: Math.max(2.5, s * 0.08), cap: 'round' });
      } else if (k === winner && t >= sh.finishAt) {
        m.circle(x, 0, s * 0.4).stroke({ color: 0xffc83d, width: Math.max(3, s * 0.09) });
        icon.scale.set(1 + 0.08 * Math.sin(this.time * 6));
      } else if (this.fightAt(sh, k, t) !== null) icon.x = x + Math.sin(this.time * 40 + k) * s * 0.03;
      else icon.x = x;
    }
  }

  /** 바람이 한바탕 세게 분다 (sec초). */
  private gust(sec: number): void {
    this.gustLeft = Math.max(this.gustLeft, sec);
  }

  private newStreak(anywhere: boolean): Streak {
    const L = this.L;
    const y = lerp(this.G.topY * 0.6, this.G.hill(L.w / 2) - L.h * 0.12, Math.random());
    const len = L.sw * (0.08 + Math.random() * 0.1);
    return { x: anywhere ? Math.random() * L.w : -len - Math.random() * L.w * 0.3, y, len, v: 0.6 + Math.random() * 0.8 };
  }

  /** 하늘의 바람 줄기 (오른쪽으로 흐른다): 판 중엔 빠르게, 연싸움·출발 때 한바탕. */
  private drawWind(dt: number, sh: Show | null, t: number): void {
    if (sh !== null && t >= 0 && t < 0.1) this.gust(1.2);
    this.gustLeft = Math.max(0, this.gustLeft - dt);
    const L = this.L;
    const speed = L.sw * (sh !== null ? 0.32 : 0.14) * (1 + (this.gustLeft > 0 ? 1.4 : 0));
    const g = this.wind;
    g.clear();
    const w = Math.max(1.5, 2 * this.u);
    for (let i = 0; i < this.streaks.length; i++) {
      const s = this.streaks[i]!;
      s.x += s.v * speed * dt;
      if (s.x > L.w + s.len) this.streaks[i] = this.newStreak(false);
      const a = 0.55 * clamp01(Math.min((s.x + s.len) / (L.w * 0.15), (L.w - s.x + s.len) / (L.w * 0.15)));
      const wob = Math.sin(this.time * 2 + i) * 3 * this.u;
      g.moveTo(s.x - s.len, s.y + wob).quadraticCurveTo(s.x - s.len * 0.4, s.y - 5 * this.u + wob, s.x, s.y + wob).stroke({ color: 0xffffff, width: w, alpha: a, cap: 'round' });
    }
  }

  // ── 표·말풍선 ──────────────────────────────────────────────────────────

  /** 구경 손님 옆의 건 연 표 (날리는 손님은 연줄 색이 곧 표). */
  private syncBadges(): void {
    for (let i = 0; i < this.betBadges.length; i++) {
      const e = this.actor(i) !== null ? this.entryAt(i) : undefined;
      const want = e === undefined || e.role !== 'bettor' ? -1 : e.pick;
      const b = this.betBadges[i];
      if (b === undefined || this.badgeShown[i] === want) continue;
      this.badgeShown[i] = want;
      for (const c of b.removeChildren()) c.destroy({ children: true });
      if (want === -1) continue;
      const key = KITE.kites[want]?.key ?? 'kite_red';
      b.addChild(pickBadge(this.anim, Math.max(8, this.L.sw * 0.03), kiteColor(want), 'objects', key, 900, 'diamond'));
    }
  }

  /** 진행자 말풍선 (who = 0 연 장인, 1 바람지기). 없으면 다른 진행자가 대신. */
  private say(who: number, text: string, sec: number): void {
    const h = this.hosts[who] ?? this.hosts[who === 1 ? 0 : 1] ?? null;
    this.talk.say(h, text, sec, this.time, this.board.visible ? this.boardBox : null);
  }

  // ── sim 이벤트 ─────────────────────────────────────────────────────────

  /** 결과 글자는 이긴 손님·아깝게 놓친 손님만 (자리가 가까워 꽝 글자는 겹친다: 꽝은 반응으로). */
  override onRoundFinished(seat: number, round: ActiveRound, payout: number): void {
    if (round.outcome.tier !== 'lose') {
      super.onRoundFinished(seat, round, payout);
      return;
    }
    const a = this.actor(seat);
    if (a === null) return;
    a.holdUntil = this.time + 2.4;
    if (this.time - a.lastReact > 0.6) a.expect = { tier: 'lose', at: this.time + 0.35 };
  }
}
