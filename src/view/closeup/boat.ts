// 오리배 경주 확대 화면: 옆에서 본 연못 물길. 하늘·건너편 둑은 closeup/bg_boat를 크게 깔고, 물길(물·레인 부표 줄·출발선·결승 부표)은 코드로 그린다.
// 배 넷(racers/boat_*, 옆모습, 왼쪽으로 간다)이 레인 넷(뒤 0 오리배 → 앞 3 고래배)에서 오른쪽 출발선부터 왼쪽 결승선으로 간다.
// 자리는 sim 경주(play.race)의 키프레임(raceProgress)대로 (경주장 race.ts와 같은 규칙·연출: 위 가운데 순위판, 1등 메달, 사진 판정 멈춤 '찰칵').
// 배마다 젓는 모양이 다르고 (오리 통통·백조 미끄럼·개구리 폴짝·고래 출렁), 뒤로 물결 자국과 물방울이 튄다 (빠를수록 많이).
// 앞쪽 선착장(코드: 나무 바닥과 밧줄 난간)에 손님 여섯이 서서 자기 배(난간 위 표)를 응원한다: 앞서면 들썩, 꼴찌면 땀, 결승 직전엔 다 같이 일어서고
// 1등이 들어오는 순간 다 같이 반응한다. 진행자: 출발 신호(오른쪽 둑, 출발 때 깃발을 휙 '출발!'), 구조 요원(왼쪽 둑, 결승 쪽: 해설·튜브 번쩍.
// 없으면 출발 신호가 해설). 모이는 중엔 마지막 3초를 크게 센다. 결과가 끝나면 배들이 돌아서 출발선으로 저어 간다.
// 상태만으로 맞춘다 (경주 중에 열어도 그 시각의 모습): GroupScene의 this.play(play.race)와 this.clock.

import { Container, Graphics, Text } from 'pixi.js';
import { BOAT, type OutcomeTier } from '../../data/defs.ts';
import { ease } from '../../core/tween.ts';
import type { SimApi } from '../../sim/api.ts';
import { raceOf } from '../../sim/group/core.ts';
import { raceProgress, raceStandings, raceTier, RACERS } from '../../sim/race.ts';
import type { ActiveRound, GroupPlay, GroupState, MonsterId, Pose, RaceResult, RacerIndex, Reaction } from '../../sim/types.ts';
import { type ArtAnchor, type ArtNode, artMeta, artSprite, hasArt } from '../art.ts';
import { type Box, fitHost, HostTalk, pickBadge } from './boat_kite_shared.ts';
import { clamp01, confetti, dismiss, FONT, INK, lerp, popCaption, span } from './fx.ts';
import { GroupScene, type GroupHostSpot, type GroupSeat, type GroupStage } from './group.ts';
import type { Layout } from './layout.ts';

/** closeup/bg_boat에서 잰 값 (배경 높이의 비율): 건너편 물가 선 (그 아래는 코드 물). 하늘·물 색. */
const BG_BOAT = { shore: 0.446, sky: 0xcfe6f4, grass: 0x9bbb79 } as const;
/** 코드 물 색 (배경 그림의 물 색에 맞춤)과 물결·부표 색. */
const WATER = { base: 0x8cc4ea, deep: 0x7fbae4, foam: 0xffffff, drop: 0x5aa7d8, buoyA: 0xe0705a, buoyB: 0xfff6e6, rope: 0xf3e3c3 } as const;
/** 선착장 나무 색. */
const WOOD = { top: 0xb37b4d, seam: 0x8a5634, post: 0x8f5a36, postTop: 0xc89366, rope: 0xe9d2a6 } as const;
/** 배경을 패널보다 이만큼 크게 깔고 물가 선이 패널 높이의 SHORE_AT에 오게 (물길을 넓게). */
const BG_ZOOM = 1.25;
const SHORE_AT = 0.27;
/** 결승선을 지난 배가 더 가는 거리 (물길 길이의 비율). */
const OVERRUN = 0.07;
/** 사진 판정: 1등이 결승선에 닿기 slowFrom초 전부터 느리게, 닿는 순간 freeze초 멈춤, 그다음 catch배로 따라잡는다. */
const PHOTO = { slowFrom: 0.3, slow: 0.45, freeze: 0.9, catch: 4 } as const;
/** 선착장 손님 배율 (확대 화면 손님 크기 대비). */
const SEAT_SCALE = 0.52;
/** 진행자 배율 (L.kHost 대비: 건너편 둑에 멀리). */
const HOST_SCALE = 0.48;
/** 자리 i의 가로 자리 (무대 폭 비율: 가운데부터 바깥으로, 왼쪽 끝은 상금 항아리). */
const SEAT_X = [0.52, 0.655, 0.385, 0.79, 0.25, 0.925];
/** 물방울 최대 수. */
const MAX_DROPS = 180;

/** 배마다 젓는 모양: 경주 한 번에 몇 번 젓나와 움직임. */
const STROKE: readonly { strokes: number; kind: 'paddle' | 'glide' | 'hop' | 'roll' }[] = [
  { strokes: 16, kind: 'paddle' },
  { strokes: 9, kind: 'glide' },
  { strokes: 8, kind: 'hop' },
  { strokes: 6, kind: 'roll' },
];

/** 결승 순간 선착장 손님 반응 (sim 반응 이벤트가 오기 전에 다 같이). */
const FINISH_POSE: Record<OutcomeTier, { pose: Pose; motion: Reaction['motion'] }> = {
  jackpot: { pose: 'joy', motion: 'bigHop' },
  win: { pose: 'joy', motion: 'hop' },
  nearMiss: { pose: 'agony', motion: 'tremble' },
  lose: { pose: 'sad', motion: 'slump' },
};

const boatName = (r: number): string => BOAT.boats[r]?.name ?? '';
const boatFlag = (r: number): number => BOAT.boats[r]?.flag ?? 0xffffff;
const boatKey = (r: number): string => BOAT.boats[r]?.key ?? 'boat_duck';

/** 장면 배치 (패널 px). layout()은 GroupScene 생성자 안에서 불리므로 L만으로 계산한다. */
interface Geom {
  readonly bg: { readonly x: number; readonly y: number; readonly size: number };
  /** 건너편 물가 선 (물이 시작하는 곳). */
  readonly shoreY: number;
  /** 선착장 손님 몸 높이. */
  readonly seatH: number;
  /** 선착장 바닥 위 끝, 밧줄 난간 높이. */
  readonly deckTop: number;
  readonly ropeY: number;
  /** 레인마다 물 높이 (배 바닥), 배율 (뒤 레인은 조금 작게). */
  readonly laneY: readonly number[];
  readonly laneS: readonly number[];
  readonly gap: number;
  /** 배 키 (앞 레인 배율 1 기준 px)와 그림 배율. */
  readonly boatH: number;
  readonly kBoat: number;
  readonly startX: number;
  readonly finishX: number;
  readonly seats: readonly GroupSeat[];
  readonly hosts: readonly GroupHostSpot[];
}

function boatGeom(L: Layout): Geom {
  const { w, h, sw, sx } = L;
  const size = Math.max(w, h) * BG_ZOOM;
  const by = Math.min(0, h * SHORE_AT - BG_BOAT.shore * size);
  const shoreY = by + BG_BOAT.shore * size;
  const seatH = L.bodyH * SEAT_SCALE;
  // 맨 앞 레인 물높이: 선착장 손님 머리보다 위 (머리가 앞 레인 배를 가리지 않게).
  const front = h - seatH * 1.04;
  const boatH = 0.3 * (front - shoreY);
  const gap = (front - shoreY - boatH * 0.8) / 3;
  const laneY = [0, 1, 2, 3].map((r) => shoreY + boatH * 0.8 + gap * r);
  const laneS = [0, 1, 2, 3].map((r) => 0.86 + r * 0.045);
  return {
    bg: { x: (w - size) / 2, y: by, size },
    shoreY,
    seatH,
    deckTop: h - seatH * 0.5,
    ropeY: h - seatH * 0.2,
    laneY,
    laneS,
    gap,
    boatH,
    kBoat: boatH / 380,
    startX: sx + sw * 0.68,
    finishX: sx + sw * 0.17,
    seats: SEAT_X.map((f, i) => ({ x: sx + sw * f, y: h + seatH * 0.07, scale: SEAT_SCALE, z: 40 + (i % 2) * 0.5, face: 1 as const })),
    hosts: [
      { x: sx + sw * 0.9, y: shoreY + 1, face: -1 },
      { x: sx + sw * 0.07, y: shoreY + 1, face: 1 },
    ],
  };
}

/** 지금 보여 주는 경주 하나 (판마다). */
interface Show {
  readonly play: GroupPlay;
  readonly result: RaceResult;
  /** 보여 주는 시계 (사진 판정 때 멈췄다 따라잡는다). */
  tau: number;
  photo: 'pre' | 'slow' | 'freeze' | 'catch' | 'sync';
  freezeLeft: number;
  /** 한 번만 하는 연출들. */
  readonly fired: Set<string>;
  leader: RacerIndex | null;
  /** 자리마다 지난 프레임의 자기 배 순위. */
  readonly ranks: Map<number, number>;
  winnerWasLast: boolean;
}

interface Boat {
  readonly node: ArtNode;
  /** 그림 폭 (배율 1, 패널 px). */
  readonly w: number;
  /** 왼쪽 끝 x (경주 밖: 돌아가기·기다리기). */
  x: number;
  /** 1 = 왼쪽(결승 쪽)을 봄, -1 = 오른쪽. */
  face: 1 | -1;
  /** 젓기 위상 (거리로 센다). */
  step: number;
  /** 개구리배: 지난 프레임의 뜀 높이 (내려앉을 때 물 튀기기). */
  hopK: number;
  /** 결승선을 지났나 (지나는 순간 물 튀기기). */
  done: boolean;
}

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** 이 아래로 떨어지면 사라진다 (물 높이). */
  floor: number;
  life: number;
}

export class BoatScene extends GroupScene {
  private readonly G: Geom;
  private readonly boats: Boat[] = [];
  private readonly ropes: Graphics[] = [];
  private readonly wake = new Graphics();
  private readonly spray = new Graphics();
  private readonly drops: Drop[] = [];
  private readonly medal = new Container();
  private readonly board = new Container();
  private readonly boardIcons: ArtNode[] = [];
  private readonly boardX: number[] = [];
  private readonly boardBox: Box;
  private readonly capY: number;
  private readonly count: Text;
  private countShown = '';
  private readonly flash = new Graphics();
  private readonly photoFrame = new Graphics();
  private readonly talk: HostTalk;
  private readonly betBadges: Container[] = [];
  private readonly badgeShown: number[];
  private readonly lastEmote: number[];
  private bigCap: Text | null = null;
  private show: Show | null = null;
  /** 단위 길이 (무대 폭 360px 기준 1). */
  private readonly u: number;

  constructor(sim: SimApi, w: number, h: number, onTap: (id: MonsterId) => void) {
    super(sim, 'boat', w, h, onTap);
    const L = this.L;
    const G = boatGeom(L);
    this.G = G;
    this.u = L.sw / 360;
    this.buildWater();
    this.buildCourse();
    this.buildDock();
    this.stage.sortableChildren = true;
    this.wake.zIndex = 18;
    this.spray.zIndex = 40;
    this.stage.addChild(this.wake, this.spray);

    // 배 넷 (기준점 = 뱃머리 물 높이: 그림 왼쪽 아래, 물결 무늬 위)
    for (const r of RACERS) {
      const key = boatKey(r);
      const m = artMeta('racers', key);
      const anchor: ArtAnchor = m !== undefined ? { x: m.trim.x + m.trim.w * 0.02, y: m.trim.y + m.trim.h * 0.9 } : 'bottom';
      const node = artSprite('racers', key, { k: G.kBoat, anchor, placeholder: { w: 520, h: 340, color: boatFlag(r) } });
      node.zIndex = 20 + r * 2;
      this.stage.addChild(node);
      const bw = (m !== undefined ? m.trim.w : 520) * G.kBoat;
      this.boats.push({ node, w: bw, x: G.startX, face: 1, step: 0, hopK: 0, done: false });
    }
    // 1등 메달 (1등 배 뱃머리 앞)
    const mr = Math.max(9, L.sw * 0.03);
    const medalText = new Text({ text: '1', style: { fontFamily: FONT, fontSize: mr * 1.3, fill: INK } });
    medalText.anchor.set(0.5);
    this.medal.addChild(new Graphics().circle(0, 0, mr).fill({ color: 0xffd54a }).stroke({ color: INK, width: Math.max(2, mr * 0.18) }), medalText);
    this.medal.visible = false;
    this.medal.zIndex = 41;
    this.stage.addChild(this.medal);

    // 순위판 (위 가운데, 경주 중에만)
    const slot = Math.max(34, L.sw * 0.125);
    const bw = slot * 4.3;
    const bh = slot * 0.82;
    this.board.position.set(L.w / 2, Math.max(14, L.h * 0.035) + bh / 2);
    this.boardBox = { x0: L.w / 2 - bw / 2, x1: L.w / 2 + bw / 2, bottom: this.board.y + bh / 2 };
    this.board.visible = false;
    this.board.addChild(new Graphics().roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2).fill({ color: 0xfff6e6, alpha: 0.93 }).stroke({ color: INK, width: 2 }));
    const fs = Math.max(11, slot * 0.34);
    for (let i = 0; i < 4; i++) {
      const x = -bw / 2 + slot * 0.15 + slot * (i + 0.5);
      this.boardX.push(x + slot * 0.12);
      const t = new Text({ text: `${i + 1}`, style: { fontFamily: FONT, fontSize: fs, fill: i === 0 ? 0xe0a526 : 0x8a6a50 } });
      t.anchor.set(0.5);
      t.position.set(x - slot * 0.3, 0);
      this.board.addChild(t);
    }
    for (const r of RACERS) {
      const icon = artSprite('racers', boatKey(r), { k: (slot * 0.56) / 560, anchor: 'center', placeholder: { w: 520, h: 340, color: boatFlag(r) } });
      icon.position.set(this.boardX[r] ?? 0, 0);
      this.boardIcons.push(icon);
      this.board.addChild(icon);
    }
    this.ui.addChild(this.board);
    // 큰 결과 글자는 물 위 (둑 위는 진행자 말풍선 자리).
    this.capY = Math.max(this.boardBox.bottom + L.caption.size * 0.55, (G.laneY[0]! + G.laneY[1]!) / 2);

    // 마지막 3초 세기 (물 가운데)
    const cFont = Math.max(36, L.sw * 0.2);
    this.count = new Text({ text: '', style: { fontFamily: FONT, fontSize: cFont, fill: 0xffd54a, stroke: { color: INK, width: Math.max(5, cFont * 0.14), join: 'round' } } });
    this.count.anchor.set(0.5);
    this.count.position.set(L.w / 2, (G.laneY[0]! + G.laneY[2]!) / 2);
    this.ui.addChild(this.count);

    this.flash.rect(0, 0, L.w, L.h).fill({ color: 0xffffff });
    this.flash.alpha = 0;
    this.flash.zIndex = 70;
    this.photoFrame.visible = false;
    this.photoFrame.zIndex = 57;
    this.root.addChild(this.flash, this.photoFrame);

    this.talk = new HostTalk(this.ui, this.anim, L.w, Math.max(13, L.sw * 0.042));
    const n = this.actors.length;
    this.badgeShown = Array.from({ length: n }, () => -1);
    this.lastEmote = Array.from({ length: n }, () => -9);
    for (let i = 0; i < n; i++) {
      const b = new Container();
      const at = G.seats[i];
      const r = Math.max(9, L.sw * 0.034);
      if (at !== undefined) b.position.set(at.x - G.seatH * 0.14, Math.min(G.ropeY, L.h - r - 7));
      b.zIndex = 52;
      this.betBadges.push(b);
      this.root.addChild(b);
    }
    this.update(0);
  }

  protected layout(L: Layout): GroupStage {
    const G = boatGeom(L);
    return { seats: G.seats, hosts: G.hosts };
  }

  // ── 그리기 준비 ────────────────────────────────────────────────────────

  /** 하늘·둑(배경 그림을 크게) 위에 코드 물: 물가 선 아래 전부 (배경의 선착장 모퉁이는 가린다). */
  private buildWater(): void {
    const L = this.L;
    const G = this.G;
    const back = new Container();
    back.zIndex = 1;
    if (hasArt('closeup', 'bg_boat')) {
      const bg = artSprite('closeup', 'bg_boat', { k: G.bg.size / 1024, anchor: 'center' });
      bg.position.set(G.bg.x + G.bg.size / 2, G.bg.y + G.bg.size / 2);
      back.addChild(bg);
    } else {
      back.addChild(new Graphics().rect(0, 0, L.w, G.shoreY).fill({ color: BG_BOAT.sky }).rect(0, G.shoreY - L.h * 0.05, L.w, L.h * 0.05).fill({ color: BG_BOAT.grass }));
    }
    const g = new Graphics();
    const top = G.shoreY + 1;
    g.rect(0, top, L.w, L.h - top).fill({ color: WATER.base });
    // 레인마다 조금 짙은 띠 (물길이 보이게)
    for (let r = 0; r < 4; r += 2) {
      const y0 = r === 0 ? top + (G.laneY[0]! - top) * 0.45 : (G.laneY[r - 1]! + G.laneY[r]!) / 2 + G.gap * 0.12;
      const y1 = (G.laneY[r]! + G.laneY[r + 1]!) / 2 + G.gap * 0.12;
      g.rect(0, y0, L.w, y1 - y0).fill({ color: WATER.deep, alpha: 0.45 });
    }
    // 잔물결 (배경 그림의 물결 무늬처럼)
    const u = L.sw / 360;
    const marks = [
      [0.12, 0.5], [0.7, 0.35], [0.42, 0.62], [0.88, 0.7], [0.2, 0.85], [0.6, 0.92], [0.33, 0.2], [0.95, 0.15],
    ] as const;
    for (const [fx, fy] of marks) {
      const x = L.sx + L.sw * fx;
      const y = top + (G.laneY[3]! + G.gap * 0.4 - top) * fy;
      const a = 7 * u;
      g.moveTo(x - a * 2, y).quadraticCurveTo(x - a, y - a * 0.8, x, y).quadraticCurveTo(x + a, y - a * 0.8, x + a * 2, y).stroke({ color: WATER.foam, width: Math.max(1.5, 2.2 * u), alpha: 0.7, cap: 'round' });
    }
    g.moveTo(0, top).lineTo(L.w, top).stroke({ color: INK, width: Math.max(1.5, 2 * u), alpha: 0.6 });
    back.addChild(g);
    this.root.addChild(back);
  }

  /** 레인 사이 부표 줄 다섯 (흔들리게 따로), 출발선(흰 부표 줄), 결승(바둑판 띠와 둑 위 깃대). */
  private buildCourse(): void {
    const L = this.L;
    const G = this.G;
    const u = this.u;
    const top = G.shoreY + (G.laneY[0]! - G.shoreY) * 0.42;
    const bottom = G.laneY[3]! + G.gap * 0.42;
    for (let i = 0; i <= 4; i++) {
      const y = i === 0 ? top : i === 4 ? bottom : (G.laneY[i - 1]! + G.laneY[i]!) / 2 + G.gap * 0.14;
      const s = G.laneS[Math.min(3, i)] ?? 1;
      const g = new Graphics();
      g.moveTo(0, 0).lineTo(L.w, 0).stroke({ color: WATER.rope, width: Math.max(1, 1.4 * u), alpha: 0.9 });
      const step = L.sw * 0.055;
      for (let x = -step * 0.5, k = 0; x < L.w + step; x += step, k++) {
        g.ellipse(x, 0, 4.2 * u * s, 3 * u * s).fill({ color: k % 2 === 0 ? WATER.buoyA : WATER.buoyB }).stroke({ color: INK, width: Math.max(1, 1.2 * u) });
      }
      g.position.set(0, y);
      g.zIndex = 19 + i * 2;
      this.ropes.push(g);
      this.stage.addChild(g);
    }
    const lines = new Graphics();
    // 출발선: 흰 점선
    for (let y = top; y < bottom; y += 9 * u) lines.rect(G.startX - 1.5 * u, y, 3 * u, 5 * u).fill({ color: 0xfff6e6, alpha: 0.9 });
    // 결승선: 바둑판 띠 두 줄 (물 위에 뜬 판)
    const cw = Math.max(5, L.sw * 0.017);
    const rows = Math.ceil((bottom - top) / cw);
    for (let i = 0; i < rows; i++) {
      for (let c = 0; c < 2; c++) lines.rect(G.finishX - cw + c * cw, top + i * cw, cw, Math.min(cw, bottom - top - i * cw)).fill({ color: (i + c) % 2 === 0 ? 0x4a3a30 : 0xfff6e6 });
    }
    lines.rect(G.finishX - cw, top, cw * 2, bottom - top).stroke({ color: INK, width: 1.5 });
    lines.zIndex = 17;
    this.stage.addChild(lines);
    // 결승 깃대 (건너편 둑)
    const pole = new Graphics();
    const poleTop = G.shoreY - (L.h - G.shoreY) * 0.36;
    const pw = Math.max(3, L.sw * 0.01);
    pole.roundRect(G.finishX - pw / 2, poleTop, pw, top - poleTop, pw / 2).fill({ color: 0xf6ebd5 }).stroke({ color: INK, width: 2 });
    const fw = L.sw * 0.09;
    const fh = fw * 0.62;
    const cs = fw / 4;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) pole.rect(G.finishX + i * cs, poleTop + j * (fh / 3), cs, fh / 3).fill({ color: (i + j) % 2 === 0 ? 0x4a3a30 : 0xfff6e6 });
    pole.rect(G.finishX, poleTop, fw, fh).stroke({ color: INK, width: 2 });
    pole.circle(G.finishX, poleTop, pw * 0.9).fill({ color: 0xffd54a }).stroke({ color: INK, width: 1.5 });
    pole.zIndex = 4;
    this.root.addChild(pole);
  }

  /** 앞쪽 선착장: 나무 바닥(손님 뒤)과 기둥·밧줄 난간(손님 앞). */
  private buildDock(): void {
    const L = this.L;
    const G = this.G;
    const u = this.u;
    const deck = new Graphics();
    deck.rect(-4, G.deckTop, L.w + 8, L.h - G.deckTop + 4).fill({ color: WOOD.top });
    for (let x = -L.sw * 0.04; x < L.w + L.sw * 0.1; x += L.sw * 0.075) deck.moveTo(x, G.deckTop).lineTo(x - L.sw * 0.05, L.h).stroke({ color: WOOD.seam, width: Math.max(1.5, 2 * u), alpha: 0.7 });
    deck.moveTo(-4, G.deckTop).lineTo(L.w + 4, G.deckTop).stroke({ color: INK, width: Math.max(2, 2.5 * u) });
    deck.zIndex = 30;
    this.root.addChild(deck);
    const rail = new Graphics();
    const postW = Math.max(7, L.sw * 0.03);
    const postTop = G.ropeY - G.seatH * 0.1;
    const xs: number[] = [];
    for (let x = L.sx + L.sw * 0.05; x < L.w + postW; x += L.sw * 0.225) xs.push(x);
    const thick = Math.max(3, G.seatH * 0.07);
    for (let i = 0; i + 1 < xs.length; i++) {
      const a = xs[i]!;
      const b = xs[i + 1]!;
      rail.moveTo(a, postTop + thick).quadraticCurveTo((a + b) / 2, postTop + thick + G.seatH * 0.16, b, postTop + thick).stroke({ color: INK, width: thick + 2.5, cap: 'round' });
      rail.moveTo(a, postTop + thick).quadraticCurveTo((a + b) / 2, postTop + thick + G.seatH * 0.16, b, postTop + thick).stroke({ color: WOOD.rope, width: thick, cap: 'round' });
    }
    for (const x of xs) {
      rail.roundRect(x - postW / 2, postTop, postW, L.h - postTop + 4, postW * 0.3).fill({ color: WOOD.post }).stroke({ color: INK, width: 2 });
      rail.ellipse(x, postTop, postW / 2, postW * 0.22).fill({ color: WOOD.postTop }).stroke({ color: INK, width: 1.5 });
    }
    this.front.addChild(rail);
  }

  // ── 매 프레임 ───────────────────────────────────────────────────────────

  protected drawPlay(play: GroupPlay | null, t: number, dt: number): void {
    const G = this.G;
    this.hosts.forEach((h, i) => {
      const at = G.hosts[i];
      if (h !== null && at !== undefined) fitHost(h, at, HOST_SCALE, this.L.w);
    });
    const g = this.group;
    this.syncBadges();
    this.drawCount(g);
    this.ropes.forEach((r, i) => {
      r.x = Math.sin(this.time * 0.8 + i) * this.L.sw * 0.006;
      r.y = this.ropeBaseY(i) + Math.sin(this.time * 1.9 + i * 1.3) * 1.2 * this.u;
    });
    const race = raceOf(play);
    if (play !== null && race !== null) {
      if (this.show === null || this.show.play !== play) this.startShow(play, race, t);
      const sh = this.show;
      if (sh !== null) {
        this.advance(sh, dt, t, g !== null && g.phase === 'done');
        this.drawRace(sh, dt);
      }
    } else {
      if (this.show !== null) this.clearShow();
      this.board.visible = false;
      this.medal.visible = false;
      this.drawWaiting(dt, g);
    }
    this.drawSpray(dt);
    this.talk.update(this.time);
  }

  private ropeBaseY(i: number): number {
    const G = this.G;
    if (i === 0) return G.shoreY + (G.laneY[0]! - G.shoreY) * 0.42;
    if (i === 4) return G.laneY[3]! + G.gap * 0.42;
    return (G.laneY[i - 1]! + G.laneY[i]!) / 2 + G.gap * 0.14;
  }

  /** 난간의 건 배 표 (참가자만). */
  private syncBadges(): void {
    for (let i = 0; i < this.betBadges.length; i++) {
      const e = this.actor(i) !== null ? this.entryAt(i) : undefined;
      const want = e === undefined ? -1 : e.pick;
      const b = this.betBadges[i];
      if (b === undefined || this.badgeShown[i] === want) continue;
      this.badgeShown[i] = want;
      for (const c of b.removeChildren()) c.destroy({ children: true });
      if (want === -1) continue;
      b.addChild(pickBadge(this.anim, Math.max(9, this.L.sw * 0.034), boatFlag(want), 'racers', boatKey(want), 560));
    }
  }

  /** 모이는 중: 출발까지 마지막 3초는 크게 센다. */
  private drawCount(g: GroupState | null): void {
    const gathering = g !== null && g.phase === 'gathering';
    const cd = gathering ? Math.ceil(g.countdown) : 0;
    const text = gathering && g.countdown <= 3 && cd > 0 ? `${cd}` : '';
    if (text !== this.countShown) {
      this.countShown = text;
      this.count.text = text;
    }
    if (text !== '' && g !== null) this.count.scale.set(1 + (g.countdown % 1) * 0.35);
  }

  private startShow(play: GroupPlay, result: RaceResult, t: number): void {
    const F = result.finishAt[result.finishOrder[0] ?? 0] ?? 0;
    const photo = result.photoFinish && t < F - PHOTO.slowFrom ? 'pre' : 'sync';
    this.show = { play, result, tau: t, photo, freezeLeft: 0, fired: new Set(), leader: null, ranks: new Map(), winnerWasLast: false };
    if (t > 0.5) this.show.fired.add('start');
    if (t > F) this.show.fired.add('finish');
    for (const r of RACERS) {
      const b = this.boats[r];
      if (b !== undefined) b.done = t >= (result.finishAt[r] ?? Infinity);
    }
    if (this.bigCap !== null) dismiss(this.anim, this.bigCap);
    this.bigCap = null;
    this.photoFrame.visible = false;
    raceStandings(result, Math.max(0, t)).forEach((r, rank) => {
      const icon = this.boardIcons[r];
      if (icon !== undefined) icon.x = this.boardX[rank] ?? 0;
    });
  }

  private clearShow(): void {
    const sh = this.show;
    if (sh === null) return;
    this.show = null;
    this.photoFrame.visible = false;
    // 결승선 너머에 있던 자리에서 돌아간다.
    for (const r of RACERS) {
      const b = this.boats[r];
      if (b !== undefined) b.x = lerp(this.G.startX, this.G.finishX, this.boatP(sh.result, r, sh.tau));
    }
  }

  /** 보여 주는 시계(사진 판정 멈춤)를 sim 시계 t에 맞춰 굴린다. */
  private advance(sh: Show, dt: number, t: number, done: boolean): void {
    const F = sh.result.finishAt[sh.result.finishOrder[0] ?? 0] ?? 0;
    switch (sh.photo) {
      case 'pre':
        sh.tau = t;
        if (t >= F - PHOTO.slowFrom) {
          sh.photo = 'slow';
          sh.tau = F - PHOTO.slowFrom;
        }
        break;
      case 'slow':
        sh.tau = Math.min(F, sh.tau + dt * (PHOTO.slowFrom / PHOTO.slow));
        if (sh.tau >= F) {
          sh.photo = 'freeze';
          sh.freezeLeft = PHOTO.freeze;
          this.photoMoment(sh);
        }
        break;
      case 'freeze':
        sh.freezeLeft -= dt * (done ? 2 : 1);
        if (sh.freezeLeft <= 0) {
          sh.photo = 'catch';
          this.photoFrame.visible = false;
        }
        break;
      case 'catch':
        sh.tau = Math.min(t, sh.tau + dt * PHOTO.catch * (done ? 2 : 1));
        if (sh.tau >= t) sh.photo = 'sync';
        break;
      case 'sync':
        sh.tau = t;
        break;
    }
  }

  /** 사진 판정: 번쩍 + 결승선 둘레 사진 틀 + '사진 판정!'. 1·2등 배에 건 손님은 숨을 멈춘다. */
  private photoMoment(sh: Show): void {
    const L = this.L;
    const G = this.G;
    void this.anim.run(0.45, (u) => {
      this.flash.alpha = 0.85 * (1 - u);
    }, { ease: ease.outQuad });
    const x0 = G.finishX - L.sw * 0.1;
    const x1 = G.finishX + L.sw * 0.3;
    const y0 = G.shoreY - (G.laneY[0]! - G.shoreY) * 0.1;
    const y1 = G.laneY[3]! + G.gap * 0.15;
    const line = Math.max(4, L.sw * 0.014);
    this.photoFrame.clear().roundRect(x0, y0, x1 - x0, y1 - y0, line).stroke({ color: 0xffffff, width: line }).roundRect(x0 - line / 2, y0 - line / 2, x1 - x0 + line, y1 - y0 + line, line).stroke({ color: INK, width: 1.5 });
    this.photoFrame.visible = true;
    if (this.bigCap !== null) dismiss(this.anim, this.bigCap);
    this.bigCap = popCaption(this.ui, this.anim, '사진 판정!', L.w / 2, this.capY, L.caption.size * 0.7, 0xffffff, PHOTO.freeze);
    this.say(1, '찰칵!', PHOTO.freeze);
    const top = sh.result.finishOrder.slice(0, 2);
    for (const [seat, pick] of this.bets()) {
      const a = this.actor(seat);
      if (a !== null && top.includes(pick)) a.emote('shock', 0.9);
    }
  }

  /** 이번 판 참가자: 자리 → 건 배. */
  private bets(): Map<number, RacerIndex> {
    return new Map((this.group?.participants ?? []).map((e) => [e.seat, e.pick as RacerIndex]));
  }

  private boatP(res: RaceResult, r: RacerIndex, tau: number): number {
    const fin = res.finishAt[r] ?? Infinity;
    if (tau <= fin) return raceProgress(res, r, tau);
    return 1 + OVERRUN * (1 - Math.exp(-(tau - fin) * 2.2));
  }

  // ── 경주 그리기 ─────────────────────────────────────────────────────────

  private drawRace(sh: Show, dt: number): void {
    const G = this.G;
    const res = sh.result;
    const tau = sh.tau;
    const winner = res.finishOrder[0] ?? 0;
    const F = res.finishAt[winner] ?? 0;
    const frozen = sh.photo === 'freeze';
    const suspense = sh.photo === 'slow' || frozen;
    this.board.visible = !suspense;
    this.wake.clear();
    for (const r of RACERS) {
      const b = this.boats[r];
      if (b === undefined) continue;
      const p = this.boatP(res, r, tau);
      const before = this.boatP(res, r, Math.max(0, tau - 0.08));
      const fin = res.finishAt[r] ?? 1;
      const speed = frozen ? 0 : clamp01(((p - before) / 0.08) * fin * 0.9);
      const x = lerp(G.startX, G.finishX, p);
      b.step = p * (STROKE[r]?.strokes ?? 10);
      b.face = 1;
      b.x = x;
      this.placeBoat(r, x, speed, dt);
      // 출발·결승 순간 물 튀기기
      if (!b.done && tau >= fin) {
        b.done = true;
        this.splash(x, G.laneY[r]!, 14, 1.2, G.laneS[r] ?? 1);
      }
    }
    if (!sh.fired.has('start') && tau >= 0) {
      for (const r of RACERS) this.splash(G.startX + (this.boats[r]?.w ?? 0) * (G.laneS[r] ?? 1), G.laneY[r]!, 10, 1, G.laneS[r] ?? 1);
    }
    const order = raceStandings(res, tau);
    order.forEach((r, rank) => {
      const icon = this.boardIcons[r];
      if (icon !== undefined && !frozen) icon.x = lerp(icon.x, this.boardX[rank] ?? 0, Math.min(1, dt * 10));
    });
    const won = tau >= F && !suspense;
    this.medal.visible = won;
    if (won) {
      const b = this.boats[winner];
      const s = G.laneS[winner] ?? 1;
      if (b !== undefined) this.medal.position.set(b.node.x - G.boatH * s * 0.3, b.node.y - G.boatH * s * 0.55);
    }
    this.cheerLive(sh, order, tau, F);
    this.hostMoves(sh, tau, F);
    this.moments(sh, order, tau, F);
  }

  /** 배 하나 (x = 왼쪽 끝, 빠르기 speed 0~1만큼 젓는다). 물결 자국·물방울도. */
  private placeBoat(r: RacerIndex, x: number, speed: number, dt: number): void {
    const G = this.G;
    const b = this.boats[r];
    if (b === undefined) return;
    const s = G.laneS[r] ?? 1;
    const H = G.boatH * s;
    const ph = b.step * Math.PI * 2;
    // 가만히 있어도 물 위에서 둥실
    let dy = Math.sin(this.time * 2.3 + r * 1.7) * H * 0.025;
    let rot = Math.sin(this.time * 1.6 + r) * 0.025;
    let sx = 1;
    let hop = 0;
    switch (STROKE[r]?.kind) {
      case 'paddle':
        dy -= Math.abs(Math.sin(ph)) * H * 0.05 * speed;
        rot += Math.sin(ph) * 0.035 * speed;
        break;
      case 'glide':
        sx = 1 + Math.sin(ph) * 0.03 * speed;
        rot += 0.03 * speed;
        break;
      case 'hop': {
        hop = Math.abs(Math.sin(ph / 2));
        dy -= hop * hop * H * 0.3 * speed;
        rot += -Math.cos(ph / 2) * 0.12 * speed;
        break;
      }
      case 'roll':
        rot += Math.sin(ph) * 0.07 * speed;
        dy -= Math.sin(ph) * H * 0.03 * speed;
        break;
    }
    const n = b.node;
    const wy = G.laneY[r] ?? 0;
    const bw = b.w * s;
    n.position.set(b.face === 1 ? x : x + bw, wy + dy);
    n.rotation = rot * b.face;
    n.scale.set(s * sx * b.face, s);
    // 개구리배: 뛰었다 내려앉으면 첨벙
    if (hop < 0.25 && b.hopK >= 0.25 && speed > 0.3) this.splash(x + bw * 0.5, wy, 7, 0.8, s);
    b.hopK = hop * (speed > 0.3 ? 1 : 0);
    // 물결 자국: 배 꼬리 뒤로 흰 거품이 흘러간다.
    if (speed > 0.04) {
      const dir = b.face;
      const stern = b.face === 1 ? x + bw * 0.96 : x + bw * 0.04;
      const len = bw * (0.3 + 0.7 * speed);
      const a = Math.min(1, speed * 2);
      for (let k = 0; k < 4; k++) {
        const v = (k + ((this.time * 2.2 + r * 0.3) % 1)) / 4;
        const cx = stern + dir * len * v;
        this.wake.ellipse(cx, wy - H * 0.02, bw * 0.16 * (1 - v * 0.5), Math.max(1.2, H * 0.035 * (1 - v * 0.6))).fill({ color: WATER.foam, alpha: 0.8 * (1 - v) * a });
      }
      const bow = b.face === 1 ? x + bw * 0.02 : x + bw * 0.98;
      this.wake.ellipse(bow, wy - H * 0.01, bw * 0.12, Math.max(1.2, H * 0.04)).fill({ color: WATER.foam, alpha: 0.7 * a });
      // 물방울: 빠를수록 많이
      const rate = 26 * speed * speed * dt;
      if (Math.random() < rate) this.splash(stern, wy - H * 0.04, 1, 0.55, s, dir);
    }
  }

  /** 물방울 n개를 (x, y)에서 튀긴다 (power 0~1.2, dir = 뒤쪽 방향: 0이면 사방). */
  private splash(x: number, y: number, n: number, power: number, s: number, dir = 0): void {
    const u = this.u * s;
    for (let i = 0; i < n && this.drops.length < MAX_DROPS; i++) {
      const side = dir !== 0 ? dir : Math.random() < 0.5 ? -1 : 1;
      this.drops.push({
        x: x + (Math.random() - 0.5) * 8 * u,
        y,
        vx: side * (20 + Math.random() * 70) * u * power,
        vy: -(70 + Math.random() * 110) * u * power,
        r: (1.4 + Math.random() * 1.8) * u,
        floor: y + 2 * u,
        life: 1.2,
      });
    }
  }

  private drawSpray(dt: number): void {
    const g = this.spray;
    g.clear();
    const grav = 420 * this.u;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      d.vy += grav * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.life -= dt;
      if (d.life <= 0 || (d.vy > 0 && d.y > d.floor)) {
        this.drops.splice(i, 1);
        continue;
      }
      g.circle(d.x, d.y, d.r).fill({ color: WATER.foam }).stroke({ color: WATER.drop, width: Math.max(0.8, d.r * 0.45) });
    }
  }

  /** 경주가 없을 때: 출발선으로 돌아서 저어 가 (오른쪽을 보고) 기다린다. 모이는 중이면 출발선에서 꼼지락. */
  private drawWaiting(dt: number, g: GroupState | null): void {
    const G = this.G;
    const gathering = g !== null && g.phase === 'gathering';
    const countdown = gathering ? g.countdown : Infinity;
    this.wake.clear();
    for (const r of RACERS) {
      const b = this.boats[r];
      if (b === undefined) continue;
      const d = G.startX - b.x;
      if (Math.abs(d) > 1) {
        // 다음 경주가 곧 출발하면 서둘러 돌아간다.
        const v = Math.max(this.L.sw * 0.3, Math.abs(d) / Math.max(0.4, countdown - 0.6)) * dt;
        const step = Math.min(Math.abs(d), v);
        b.x += Math.sign(d) * step;
        b.face = d > 0 ? -1 : 1;
        b.step += (step / (G.startX - G.finishX)) * (STROKE[r]?.strokes ?? 10);
        this.placeBoat(r, b.x, 0.55, dt);
      } else {
        b.x = G.startX;
        b.face = 1;
        b.step += dt * (gathering ? 1.1 : 0.35);
        this.placeBoat(r, b.x, gathering ? 0.2 : 0.06, dt);
      }
    }
    // 출발 직전: 출발 신호가 깃발을 든다.
    const starter = this.hosts[0] ?? null;
    if (starter !== null && gathering && countdown < 3) starter.rig.rot = -0.12 * span(3 - countdown, 0, 0.4);
  }

  /** 경주 중 선착장: 자기 배가 1등이면 들썩, 꼴찌면 땀, 결승 직전엔 다 같이 일어선다. */
  private cheerLive(sh: Show, order: readonly RacerIndex[], tau: number, F: number): void {
    if (tau < 0.2 || tau >= F) return;
    const finalStretch = span(tau, F - 1.4, F - 0.2);
    for (const [seat, pick] of this.bets()) {
      const a = this.actor(seat);
      if (a === null) continue;
      const rank = order.indexOf(pick);
      const prev = sh.ranks.get(seat);
      sh.ranks.set(seat, rank);
      const H = a.bodyH;
      if (rank === 0) a.eager = 1;
      else if (rank === order.length - 1) {
        a.rig.dx = Math.sin(this.time * 55) * H * 0.012;
        a.rig.sy = 0.97;
      } else {
        a.eager = 0.3;
        a.rig.rot = -0.05;
      }
      if (finalStretch > 0) {
        a.rig.dy = -H * 0.08 * finalStretch;
        a.rig.sy *= 1 + 0.05 * finalStretch;
      }
      if (prev === undefined || prev === rank || tau < 1 || this.time - (this.lastEmote[seat] ?? -9) < 1.4) continue;
      if (rank === 0) {
        this.lastEmote[seat] = this.time;
        a.emote(Math.random() < 0.5 ? 'note' : 'heart', 0.9);
      } else if (rank === order.length - 1) {
        this.lastEmote[seat] = this.time;
        a.emote('sweat', 0.9);
      }
    }
  }

  /** 진행자: 출발 신호는 출발 때 깃발을 휙 내리고, 구조 요원은 마지막 물길에서 몸을 내밀고 튜브를 든다. 결승 때 다 같이 폴짝. */
  private hostMoves(sh: Show, tau: number, F: number): void {
    const starter = this.hosts[0] ?? null;
    if (starter !== null && tau < 0.7) {
      const chop = Math.sin(Math.PI * span(tau, 0, 0.45));
      starter.rig.rot = 0.3 * chop;
      starter.rig.dy = -starter.height * 0.03 * chop;
    }
    const guard = this.hosts[1] ?? null;
    if (guard !== null && tau < F) {
      const lean = span(tau, F - 1.6, F - 0.4);
      guard.rig.rot = 0.1 * lean + Math.sin(this.time * 2.2) * 0.02 * (1 - lean);
      guard.rig.dy = -guard.height * 0.02 * lean * Math.abs(Math.sin(this.time * 8));
    }
    if (!sh.fired.has('hostCheer') && tau >= F && sh.photo !== 'slow' && sh.photo !== 'freeze') {
      sh.fired.add('hostCheer');
      for (const h of this.hosts) h?.cheer(sh.result.comeback);
    }
  }

  /** 한 번씩: 출발, 선두 바뀜 해설, 역전, 마지막 물길, 결승 (선착장 전체 반응, 큰 글자). */
  private moments(sh: Show, order: readonly RacerIndex[], tau: number, F: number): void {
    const res = sh.result;
    const winner = res.finishOrder[0] ?? 0;
    if (!sh.fired.has('start') && tau >= 0) {
      sh.fired.add('start');
      this.say(0, '출발!', 1);
    }
    if (tau < F) {
      if (order[order.length - 1] === winner && tau > 0.8) sh.winnerWasLast = true;
      const lead = order[0] ?? null;
      if (lead !== null && lead !== sh.leader) {
        const first = sh.leader === null;
        sh.leader = lead;
        if (!first && tau > 1.2 && tau < F - 0.6) {
          if (lead === winner && res.comeback && sh.winnerWasLast && !sh.fired.has('comeback')) {
            sh.fired.add('comeback');
            this.say(1, '대역전이다!', 1.4);
          } else this.say(1, `${boatName(lead)} 앞으로!`, 1.1);
        }
      }
      if (!sh.fired.has('stretch') && tau >= F - 1.5 && tau > 1) {
        sh.fired.add('stretch');
        if (!this.talk.busy(this.time)) this.say(1, '마지막 물길!', 1);
      }
      return;
    }
    if (sh.fired.has('finish') || sh.photo === 'slow' || sh.photo === 'freeze') return;
    sh.fired.add('finish');
    for (const [seat, pick] of this.bets()) {
      const a = this.actor(seat);
      if (a === null) continue;
      const tier = raceTier(res, pick);
      const fp = FINISH_POSE[tier];
      a.showPose(fp.pose, 1.6);
      a.playMotion(fp.motion, tier === 'jackpot' ? 1.2 : 1, 1.4);
      if (tier === 'jackpot') a.emote('sparkle', 1.1);
      a.holdUntil = Math.max(a.holdUntil, this.time + 3);
    }
    const L = this.L;
    const name = boatName(winner);
    if (this.bigCap !== null) dismiss(this.anim, this.bigCap);
    this.bigCap = popCaption(this.ui, this.anim, res.comeback ? '대역전!' : `${name} 1등!`, L.w / 2, this.capY, L.caption.size * (res.comeback ? 1 : 0.75), res.comeback ? 0xffc83d : 0xffffff, 1.4);
    this.say(1, `${name} 골인!`, 1.3);
    const winners = [...this.bets().values()].filter((r) => r === winner).length;
    confetti(this.fx, this.anim, L.w, L.h, res.comeback && winners > 0 ? 50 : winners > 0 ? 24 : 12);
  }

  /** 진행자 말풍선 (who = 0 출발 신호, 1 구조 요원). 없으면 다른 진행자가 대신. */
  private say(who: number, text: string, sec: number): void {
    const h = this.hosts[who] ?? this.hosts[who === 1 ? 0 : 1] ?? null;
    this.talk.say(h, text, sec, this.time, this.board.visible ? this.boardBox : null);
  }

  // ── sim 이벤트 ─────────────────────────────────────────────────────────

  /** 결과 글자는 맞힌 손님·아깝게 놓친 손님만 (선착장 자리가 가까워 꽝 글자는 겹친다: 꽝은 반응으로). */
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
