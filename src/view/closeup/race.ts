// 몬스터 경주장 확대 화면: 옆에서 본 경주로 (closeup/bg_race를 크게 깔아 모래 길을 넓게).
// 선수 넷(racers/racer_*, 옆모습)이 레인 넷(뒤 0 달팽이 → 앞 3 무당벌레)에서 오른쪽 출발선부터 왼쪽 결승선으로 달린다.
// 자리는 경주 키프레임(sim/race.ts raceProgress)을 실제 시간으로 따른다. 앞줄 난간 뒤에 관중석 손님(자리 6),
// 난간에는 손님마다 건 선수 표(조끼 색)를 단다. 경주 중 손님은 자기 선수가 앞서면 들썩, 꼴찌면 땀, 결승 직전엔 다 같이 일어서고
// 1등이 들어오는 순간 관중석 전체가 한꺼번에 반응한다. 진행자: 출발 신호(오른쪽, 출발 때 깃발을 휙), 해설자(왼쪽, 확성기 말풍선),
// 사육사(가운데 오른쪽). 상금 항아리는 경주로 옆 풀밭. 사진 판정 경주는 1등이 결승선에 닿는 순간 화면이 멈추고 '찰칵' (보여 주는 시계만 멈췄다 따라잡는다).
//
// 경주를 어디서 읽나 (상태만으로 맞춘다: 경주 중에 열어도, 이벤트를 놓쳐도 그 시각의 모습):
//   - 함께 경주: sim.state.booths.race.group (단체 놀이 GroupState: gathering → running → done, play.race, participants). 모이는 중엔 카운트다운.
//   - 혼자 경주 (경주 상태가 없을 때, 예: _dev/preview.html): 자리마다의 한판 (round.outcome.detail.kind = 'race'). 경주 결과가
//     상태에 없으니 세부(건 선수·등수·역전·사진 판정)에 맞는 경주를 화면에서 만든다 (그 한판으로 정해지는 씨앗이라 다시 지어도 같은 경주).
// 손님마다의 결과(roundFinished)는 sim이 경주가 끝난 뒤 한꺼번에 낸다: 머리 위 글자(꽝은 빼고)와 항아리 → 손님 코인.
// 보통 부스 장면(scene.ts BoothScene)과 같은 CloseupScene 약속을 따른다 (registry.ts가 만든다).

import { Container, Graphics, Text } from 'pixi.js';
import { type BoothId, boothDef, type OutcomeTier, RACE } from '../../data/defs.ts';
import { Rng } from '../../core/rng.ts';
import { ease } from '../../core/tween.ts';
import type { SimApi } from '../../sim/api.ts';
import { generateRace, raceProgress, raceStandings, raceTier, RACERS } from '../../sim/race.ts';
import { raceOf } from '../../sim/group/core.ts';
import type { ActiveRound, BoothState, MonsterId, Pose, RaceResult, RacerIndex, Reaction } from '../../sim/types.ts';
import { type ArtAnchor, type ArtNode, artMeta, artSprite, hasArt } from '../art.ts';
import { HostActor, MonsterActor, neutralPose } from './actor.ts';
import { Anim, bubbleNode, clamp01, confetti, dismiss, FONT, floatText, flyCoins, INK, lerp, popCaption, span } from './fx.ts';
import { computeLayout, type Layout, WALL_COLOR } from './layout.ts';
import type { CloseupScene } from './registry.ts';

/** closeup/bg_race에서 잰 값 (배경 높이의 비율): 울타리 위, 풀 띠 아래 = 모래 길이 시작하는 선. 모래 색. */
const BG_RACE = { fence: 0.55, sand: 0.705, sandColor: 0xebc388 } as const;
/**
 * 배경을 패널보다 이만큼 크게 깔고 모래 길 위 끝이 패널 높이의 SAND_AT에 오게 올린다 (레인 넷을 넓게).
 * 배경 아래 끝이 패널 위로 올라오면 그 밑은 모래 색으로 채운다 (관중석·난간이 가리는 자리).
 */
const BG_ZOOM = 1.25;
const SAND_AT = 0.39;
/** 결승선을 지난 선수가 더 달려가는 거리 (경주 거리의 비율). */
const OVERRUN = 0.07;
/** 경주가 끝나고 선수들이 결승선 너머에 머무는 초 (그다음 출발선으로 걸어 돌아간다). */
const AFTER_HOLD = 2.6;
/** 사진 판정: 1등이 결승선에 닿기 SLOW_FROM초 전부터 느리게, 닿는 순간 FREEZE초 멈춤, 그다음 CATCH배로 따라잡는다. */
const PHOTO = { slowFrom: 0.3, slow: 0.45, freeze: 0.9, catch: 4 } as const;
/** 관중석 손님 배율 (확대 화면 손님 크기 대비). */
const SEAT_SCALE = 0.52;

/** 선수마다 달리는 모양: 보폭 수(경주 한 번에 몇 걸음)와 움직임. */
const GAIT: readonly { strides: number; kind: 'glide' | 'waddle' | 'hop' | 'scuttle' }[] = [
  { strides: 14, kind: 'glide' },
  { strides: 18, kind: 'waddle' },
  { strides: 9, kind: 'hop' },
  { strides: 28, kind: 'scuttle' },
];

const RESULT_CAPTION: Record<OutcomeTier, { text: string; color: number }> = {
  jackpot: { text: '대역전!', color: 0xffc83d },
  win: { text: '1등!', color: 0x9ad66f },
  nearMiss: { text: '아깝다!', color: 0xff9a5c },
  lose: { text: '다음엔…', color: 0xc3cbd8 },
};

/** 결승 순간의 관중 반응 (sim 반응 이벤트가 오기 전에 다 같이). */
const FINISH_POSE: Record<OutcomeTier, { pose: Pose; motion: Reaction['motion'] }> = {
  jackpot: { pose: 'joy', motion: 'bigHop' },
  win: { pose: 'joy', motion: 'hop' },
  nearMiss: { pose: 'agony', motion: 'tremble' },
  lose: { pose: 'sad', motion: 'slump' },
};

const racerName = (r: RacerIndex): string => RACE.racers[r]?.name ?? '';
const racerBib = (r: RacerIndex): number => RACE.racers[r]?.bib ?? 0xffffff;

/** 지금 보여 주는 경주 하나. */
interface Show {
  /** 같은 경주인지 알아보는 열쇠. */
  readonly key: string;
  readonly result: RaceResult;
  readonly shared: boolean;
  /** 혼자 경주: 그 한판의 자리. */
  readonly soloSeat: number;
  /** 자리 → 건 선수. */
  bets: Map<number, RacerIndex>;
  /** 진짜 시계 (출발 뒤 초, sim에 맞춘다). */
  t: number;
  /** 보여 주는 시계 (사진 판정 때 멈췄다 따라잡는다). */
  tau: number;
  photo: 'pre' | 'slow' | 'freeze' | 'catch' | 'sync';
  freezeLeft: number;
  /** sim 쪽에서 경주가 끝났다 (결과가 났다). */
  done: boolean;
  doneAt: number;
  /** 한 번만 하는 연출들. */
  readonly fired: Set<string>;
  leader: RacerIndex | null;
  /** 자리마다 지난 프레임의 자기 선수 순위. */
  readonly ranks: Map<number, number>;
  /** 1등 선수가 꼴찌였던 적이 있다 (역전 해설용). */
  winnerWasLast: boolean;
}

interface Racer {
  readonly node: ArtNode;
  /** 출발선 밖에서의 자리 (돌아가기·기다리기). */
  x: number;
  /** 1 = 왼쪽(결승 쪽)을 봄, -1 = 오른쪽. */
  face: number;
  /** 걸음 위상 (거리로 센다). */
  step: number;
  /** 마지막으로 그린 x (경주가 끝나면 여기서 돌아간다). */
  lastX: number;
}

export class RaceScene implements CloseupScene {
  readonly booth: BoothId = 'race';
  readonly root = new Container();
  private readonly sim: SimApi;
  private readonly L: Layout;
  private readonly anim = new Anim();
  private readonly fx = new Container();
  private readonly ui = new Container();
  private readonly unlocked: boolean;
  private readonly onTap: (id: MonsterId) => void;
  private time = 0;
  /** 지을 때 배경 그림이 있었나. */
  private readonly bgReady: boolean;

  // 경주로
  private readonly sandTop: number;
  private readonly laneY: number[] = [];
  private readonly laneS: number[] = [];
  private readonly startX: number;
  private readonly finishX: number;
  private readonly kRacer: number;
  private readonly racers: Racer[] = [];
  private readonly medal = new Container();

  // 사람들
  private readonly hosts: (HostActor | null)[] = [null, null, null];
  private readonly hostAt: readonly { x: number; y: number; face: number }[];
  private readonly kHost: number;
  private bubble: { node: Container; until: number; who: number } | null = null;
  private readonly actors: (MonsterActor | null)[];
  private readonly seatAt: readonly { x: number; y: number }[];
  private readonly badges: Container[] = [];
  private readonly badgeShown: (RacerIndex | -1)[];
  private readonly lastEmote: number[];

  // 표시
  private readonly board = new Container();
  private readonly boardIcons: ArtNode[] = [];
  private readonly boardX: number[] = [];
  private readonly boardSlot: number;
  /** 순위판 자리 (패널 px): 말풍선이 피한다. */
  private boardBox = { x0: 0, x1: 0, bottom: 0 };
  private readonly pot: Container;
  private readonly potLabel: Text;
  private readonly potH: number;
  private potShown = -1;
  private readonly queueBadge = new Container();
  private readonly queueBg = new Graphics();
  private readonly queueText: Text;
  private queueShown = -1;
  private readonly note: Text;
  private readonly count: Text;
  private countShown = '';
  private readonly flash = new Graphics();
  private readonly photoFrame = new Graphics();
  private caption: Text | null = null;
  /** 큰 결과 글자 자리 (순위판 아래). */
  private readonly capY: number;

  private show: Show | null = null;

  constructor(sim: SimApi, w: number, h: number, onTap: (id: MonsterId) => void) {
    this.sim = sim;
    this.onTap = onTap;
    const bs = this.state;
    this.unlocked = bs.unlocked;
    const L = computeLayout('race', w, h, 1);
    this.L = L;
    const sw = L.sw;
    this.root.sortableChildren = true;

    // 배경: 크게 깔아 모래 길이 패널 아래쪽 반쯤을 차지하게 (위로는 하늘·울타리·풀 띠).
    const size = Math.max(w, h) * BG_ZOOM;
    const by = Math.min(0, h * SAND_AT - BG_RACE.sand * size);
    const bx = (w - size) / 2;
    this.sandTop = by + BG_RACE.sand * size;
    // 그림이 아직 없으면 자리 표시 (needsRebuild가 그림이 오면 다시 짓게 한다).
    this.bgReady = hasArt('closeup', 'bg_race');
    if (this.bgReady) {
      const bg = artSprite('closeup', 'bg_race', { k: size / 1024, anchor: 'center' });
      bg.position.set(bx + size / 2, by + size / 2);
      bg.zIndex = 0;
      this.root.addChild(bg);
      if (by + size < h) {
        const fill = new Graphics().rect(0, by + size - 2, w, h - (by + size) + 2).fill({ color: BG_RACE.sandColor });
        fill.zIndex = 0;
        this.root.addChild(fill);
      }
    } else {
      const g = new Graphics().rect(0, 0, w, h).fill({ color: WALL_COLOR.race });
      g.rect(0, by + BG_RACE.fence * size, w, this.sandTop - (by + BG_RACE.fence * size)).fill({ color: 0x9bc27a });
      g.rect(0, this.sandTop, w, h - this.sandTop).fill({ color: 0xebc68e });
      g.moveTo(0, this.sandTop).lineTo(w, this.sandTop).stroke({ color: INK, width: 3 });
      g.zIndex = 0;
      this.root.addChild(g);
    }

    // 앞줄 관중석: 패널 아래 끝 난간 뒤에 자리 6 (가운데부터 바깥으로). 손님은 가슴께까지 보인다.
    const seatH = L.bodyH * SEAT_SCALE;
    const railTop = h - seatH * 0.2;
    const n = Math.max(1, bs.seats.length);
    const order = [0.5, 0.66, 0.34, 0.82, 0.18, 0.97, 0.03];
    this.seatAt = Array.from({ length: n }, (_, i) => ({ x: L.sx + sw * (0.06 + 0.88 * (order[i] ?? (i + 0.5) / n)), y: h + seatH * 0.02 }));
    this.actors = Array.from({ length: n }, () => null);
    this.badgeShown = Array.from({ length: n }, () => -1);
    this.lastEmote = Array.from({ length: n }, () => -9);

    // 레인 넷 (발 자리): 뒤 레인 선수 머리가 풀 띠에 조금 걸치고, 앞 레인 선수 발이 관중 머리께에 오게 (가려지지 않게). 뒤 레인은 조금 작게.
    const front = h - seatH * 0.88;
    const racerH = 0.34 * (front - this.sandTop);
    const gap = (front - this.sandTop - racerH * 0.75) / 3;
    for (let r = 0; r < 4; r++) {
      this.laneY.push(this.sandTop + racerH * 0.75 + gap * r);
      this.laneS.push(0.88 + r * 0.04);
    }
    this.kRacer = racerH / 330;
    this.startX = L.sx + sw * 0.78;
    this.finishX = L.sx + sw * 0.21;
    this.drawTrack(w, h, gap);

    // 선수 넷 (코끝 = 그림 왼쪽 아래)
    for (const r of RACERS) {
      const key = RACE.racers[r]?.key ?? 'racer_snail';
      const m = artMeta('racers', key);
      const anchor: ArtAnchor = m !== undefined ? { x: m.trim.x, y: m.trim.y + m.trim.h * 0.96 } : 'bottom';
      const node = artSprite('racers', key, { k: this.kRacer, anchor, placeholder: { w: 420, h: 300, color: racerBib(r) } });
      node.zIndex = 20 + r * 2;
      this.root.addChild(node);
      this.racers.push({ node, x: this.startX, face: 1, step: 0, lastX: this.startX });
    }
    // 1등 메달 (1등 선수 코끝 앞)
    const mr = Math.max(9, sw * 0.03);
    const medalText = new Text({ text: '1', style: { fontFamily: FONT, fontSize: mr * 1.3, fill: INK } });
    medalText.anchor.set(0.5);
    this.medal.addChild(new Graphics().circle(0, 0, mr).fill({ color: 0xffd54a }).stroke({ color: INK, width: Math.max(2, mr * 0.18) }), medalText);
    this.medal.visible = false;
    this.medal.zIndex = 30;
    this.root.addChild(this.medal);

    // 진행자 셋: 출발 신호(오른쪽, 출발선 쪽, 왼쪽을 봄), 해설자(왼쪽 끝, 결승선 쪽, 오른쪽을 봄), 사육사(가운데 오른쪽, 출발 쪽을 봄). 풀 띠에 선다.
    this.kHost = L.kHost * 0.48;
    const back = this.sandTop + (h - this.sandTop) * 0.01;
    this.hostAt = [
      { x: L.sx + sw * 0.9, y: back, face: -1 },
      { x: L.sx, y: back, face: 1 },
      { x: L.sx + sw * 0.62, y: back - (h - this.sandTop) * 0.015, face: -1 },
    ];

    // 난간 (손님 앞)과 건 선수 표
    const rail = new Graphics();
    const postW = Math.max(6, sw * 0.022);
    const railH = Math.max(7, seatH * 0.13);
    for (let x = L.sx - sw * 0.2; x < w + postW; x += sw * 0.16) rail.roundRect(x, railTop + railH * 0.4, postW, h - railTop, postW * 0.3).fill({ color: 0xa8703f }).stroke({ color: INK, width: 2 });
    rail.roundRect(-10, railTop, w + 20, railH, railH * 0.4).fill({ color: 0xc58a52 }).stroke({ color: INK, width: Math.max(2, railH * 0.2) });
    rail.roundRect(-10, railTop + railH * 2.2, w + 20, railH * 0.8, railH * 0.3).fill({ color: 0xc58a52 }).stroke({ color: INK, width: Math.max(2, railH * 0.18) });
    rail.zIndex = 50;
    this.root.addChild(rail);
    this.seatAt.forEach((at) => {
      const b = new Container();
      // 난간 가운데에 걸되 패널 아래 테두리에 잘리지 않게 (동그라미 반지름 + 테두리 여유만큼 위로).
      const r = Math.max(9, sw * 0.034);
      b.position.set(at.x - L.bodyH * SEAT_SCALE * 0.12, Math.min(railTop + railH * 0.5, h - r - 7));
      b.zIndex = 52;
      b.visible = false;
      this.badges.push(b);
      this.root.addChild(b);
    });

    // 상금 항아리는 경주로 옆 풀밭 (가운데), 위에는 순위판(가운데)과 줄(오른쪽).
    const potW = sw * 0.12;
    const kPot = potW / 668;
    this.potH = 617 * kPot;
    this.pot = artSprite('objects', 'prize_pot', { k: kPot, anchor: 'bottom', placeholder: { w: 668, h: 617, color: 0xc98a4f } });
    this.pot.position.set(L.sx + sw * 0.47, this.sandTop + (h - this.sandTop) * 0.015);
    this.pot.zIndex = 7;
    const potFont = Math.max(11, potW * 0.26);
    this.potLabel = new Text({ text: '', style: { fontFamily: FONT, fontSize: potFont, fill: 0xffffff, stroke: { color: INK, width: Math.max(3, potFont * 0.22), join: 'round' } } });
    this.potLabel.anchor.set(0.5);
    this.potLabel.position.set(0, -this.potH * 0.36);
    this.pot.addChild(this.potLabel);
    this.root.addChild(this.pot);

    this.boardSlot = Math.max(34, sw * 0.125);
    this.buildBoard(w, h);
    this.capY = Math.max(L.caption.y, this.board.y + this.boardSlot * 0.41 + L.caption.size * 0.45);

    this.fx.zIndex = 58;
    this.ui.zIndex = 60;
    this.flash.zIndex = 70;
    this.photoFrame.zIndex = 57;
    this.flash.rect(0, 0, w, h).fill({ color: 0xffffff });
    this.flash.alpha = 0;
    this.photoFrame.visible = false;
    this.root.addChild(this.fx, this.ui, this.flash, this.photoFrame);

    const qFont = Math.max(12, sw * 0.042);
    this.queueText = new Text({ text: '', style: { fontFamily: FONT, fontSize: qFont, fill: INK } });
    this.queueText.anchor.set(1, 0.5);
    this.queueBadge.addChild(this.queueBg, this.queueText);
    this.queueBadge.position.set(w - Math.max(10, w * 0.03), Math.max(16, h * 0.045) + qFont * 0.5);
    this.ui.addChild(this.queueBadge);

    const nFont = Math.max(14, sw * 0.05);
    this.note = new Text({ text: '', style: { fontFamily: FONT, fontSize: nFont, fill: 0xffffff, stroke: { color: INK, width: Math.max(3, nFont * 0.2), join: 'round' }, align: 'center' } });
    // 안내 글자는 위 가운데 (순위판 자리: 순위판은 경주 중에만 보인다).
    this.note.anchor.set(0.5, 0);
    this.note.position.set(w / 2, Math.max(14, h * 0.035));
    this.ui.addChild(this.note);
    const cFont = Math.max(36, sw * 0.2);
    this.count = new Text({ text: '', style: { fontFamily: FONT, fontSize: cFont, fill: 0xffd54a, stroke: { color: INK, width: Math.max(5, cFont * 0.14), join: 'round' } } });
    this.count.anchor.set(0.5);
    this.count.position.set(w / 2, (this.sandTop + this.laneY[3]!) / 2 - cFont * 0.2);
    this.ui.addChild(this.count);

    this.update(0);
  }

  private get state(): BoothState {
    return this.sim.state.booths.race;
  }

  // ── 그리기 준비 ────────────────────────────────────────────────────────

  /** 모래 위 레인 선, 출발선(오른쪽 흰 선), 결승선(왼쪽 바둑판 띠와 깃대). */
  private drawTrack(w: number, h: number, gap: number): void {
    const sw = this.L.sw;
    const g = new Graphics();
    const top = this.sandTop + (this.laneY[0]! - this.sandTop) * 0.25;
    const bottom = this.laneY[3]! + gap * 0.45;
    // 레인 선 (점선)
    for (let r = 0; r <= 4; r++) {
      const y = r === 0 ? top : r === 4 ? bottom : (this.laneY[r - 1]! + this.laneY[r]!) / 2 + gap * 0.05;
      for (let x = 0; x < w; x += sw * 0.07) g.rect(x, y - 1, sw * 0.04, Math.max(2, sw * 0.006)).fill({ color: 0xfff6e6, alpha: 0.55 });
    }
    // 출발선
    g.rect(this.startX - sw * 0.006, top, sw * 0.012, bottom - top).fill({ color: 0xfff6e6, alpha: 0.9 });
    // 결승선: 바둑판 띠 두 줄
    const cw = Math.max(5, sw * 0.017);
    const rows = Math.ceil((bottom - top) / cw);
    for (let i = 0; i < rows; i++) {
      for (let c = 0; c < 2; c++) {
        const dark = (i + c) % 2 === 0;
        g.rect(this.finishX - cw + c * cw, top + i * cw, cw, Math.min(cw, bottom - top - i * cw)).fill({ color: dark ? 0x4a3a30 : 0xfff6e6 });
      }
    }
    g.rect(this.finishX - cw, top, cw * 2, bottom - top).stroke({ color: INK, width: 1.5 });
    g.zIndex = 5;
    // 결승 깃대 (뒤쪽 풀 띠에) 와 바둑판 깃발
    const pole = new Graphics();
    const poleTop = this.sandTop - (h - this.sandTop) * 0.42;
    const pw = Math.max(3, sw * 0.01);
    pole.roundRect(this.finishX - pw / 2, poleTop, pw, top - poleTop + gap * 0.1, pw / 2).fill({ color: 0xf6ebd5 }).stroke({ color: INK, width: 2 });
    const fw = sw * 0.09;
    const fh = fw * 0.62;
    const cs = fw / 4;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) pole.rect(this.finishX + i * cs, poleTop + j * (fh / 3), cs, fh / 3).fill({ color: (i + j) % 2 === 0 ? 0x4a3a30 : 0xfff6e6 });
    pole.rect(this.finishX, poleTop, fw, fh).stroke({ color: INK, width: 2 });
    pole.circle(this.finishX, poleTop, pw * 0.9).fill({ color: 0xffd54a }).stroke({ color: INK, width: 1.5 });
    pole.zIndex = 4;
    this.root.addChild(g, pole);
  }

  /** 순위판: 위 가운데 둥근 판에 자리 넷 (1~4 글자 고정, 선수 그림이 순위대로 움직인다). */
  private buildBoard(w: number, h: number): void {
    const s = this.boardSlot;
    const bw = s * 4 + s * 0.3;
    const bh = s * 0.82;
    this.board.position.set(w / 2, Math.max(14, h * 0.035) + bh / 2);
    this.boardBox = { x0: w / 2 - bw / 2, x1: w / 2 + bw / 2, bottom: this.board.y + bh / 2 };
    this.board.zIndex = 56;
    this.board.visible = false;
    this.board.addChild(new Graphics().roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2).fill({ color: 0xfff6e6, alpha: 0.93 }).stroke({ color: INK, width: 2 }));
    const fs = Math.max(11, s * 0.34);
    for (let i = 0; i < 4; i++) {
      const x = -bw / 2 + s * 0.15 + s * (i + 0.5);
      // 선수 그림 자리 (글자 오른쪽).
      this.boardX.push(x + s * 0.12);
      const t = new Text({ text: `${i + 1}`, style: { fontFamily: FONT, fontSize: fs, fill: i === 0 ? 0xe0a526 : 0x8a6a50 } });
      t.anchor.set(0.5);
      t.position.set(x - s * 0.3, 0);
      this.board.addChild(t);
    }
    for (const r of RACERS) {
      const key = RACE.racers[r]?.key ?? 'racer_snail';
      const icon = artSprite('racers', key, { k: (s * 0.52) / 420, anchor: 'center', placeholder: { w: 420, h: 300, color: racerBib(r) } });
      icon.position.set(this.boardX[r] ?? 0, 0);
      this.boardIcons.push(icon);
      this.board.addChild(icon);
    }
    this.ui.addChild(this.board);
  }

  /** 난간의 건 선수 표 (조끼 색 동그라미 + 작은 선수 그림). */
  private setBadge(seat: number, racer: RacerIndex | -1): void {
    const b = this.badges[seat];
    if (b === undefined || this.badgeShown[seat] === racer) return;
    this.badgeShown[seat] = racer;
    for (const c of b.removeChildren()) c.destroy({ children: true });
    b.visible = racer !== -1;
    if (racer === -1) return;
    const r = Math.max(9, this.L.sw * 0.034);
    b.addChild(new Graphics().circle(0, 0, r).fill({ color: racerBib(racer) }).stroke({ color: INK, width: Math.max(2, r * 0.16) }));
    const key = RACE.racers[racer]?.key ?? 'racer_snail';
    b.addChild(artSprite('racers', key, { k: (r * 1.55) / 420, anchor: 'center', placeholder: { w: 420, h: 300, color: 0xffffff } }));
    b.scale.set(0.3);
    void this.anim.run(0.3, (u) => {
      if (!b.destroyed) b.scale.set(lerp(0.3, 1, u));
    }, { ease: ease.outBack });
  }

  // ── 매 프레임 ───────────────────────────────────────────────────────────

  needsRebuild(): boolean {
    const bs = this.state;
    return bs.unlocked !== this.unlocked || bs.seats.length !== this.actors.length || (!this.bgReady && hasArt('closeup', 'bg_race'));
  }

  update(dt: number): void {
    this.time += dt;
    const bs = this.state;
    this.syncHosts(bs);
    this.syncCast(bs);
    this.syncShow(bs, dt);
    for (const a of this.actors) {
      if (a === null) continue;
      neutralPose(a.rig);
      a.eager = 0;
    }
    this.drawRace(bs, dt);
    for (const a of this.actors) a?.update(dt, this.time);
    for (const h of this.hosts) h?.update(this.time);
    if (this.bubble !== null && this.time >= this.bubble.until) {
      this.bubble.node.destroy({ children: true });
      this.bubble = null;
    }
    this.syncLabels(bs);
  }

  private syncHosts(bs: BoothState): void {
    for (let role = 0; role < this.hosts.length; role++) {
      const id = bs.staff[role] ?? null;
      const staff = id === null ? undefined : this.sim.state.staff.find((s) => s.id === id);
      const cur = this.hosts[role] ?? null;
      if (staff === undefined) {
        if (cur !== null) {
          cur.destroy();
          this.hosts[role] = null;
        }
        continue;
      }
      if (cur === null) {
        const h = new HostActor(staff.art, this.kHost, this.anim);
        const at = this.hostAt[role] ?? { x: this.L.w / 2, y: this.sandTop, face: 1 };
        // 그림 폭은 진행자마다 다르다: 패널 끝에 잘리지 않게.
        h.root.position.set(Math.max(6 + h.halfW, Math.min(this.L.w - 6 - h.halfW, at.x)), at.y);
        // HostActor는 오른쪽을 보게 뒤집혀 있다: 왼쪽을 볼 자리는 한 번 더 뒤집는다.
        h.root.scale.x = at.face;
        h.root.zIndex = 8 + role;
        this.root.addChild(h.root);
        this.hosts[role] = h;
      } else cur.setArt(staff.art);
    }
  }

  private syncCast(bs: BoothState): void {
    for (let i = 0; i < this.actors.length; i++) {
      const want = bs.seats[i] ?? null;
      const cur = this.actors[i] ?? null;
      if (cur !== null && cur.id === want) continue;
      if (cur !== null) {
        // 결과 반응을 보여 주는 동안은 자리가 비어도 남는다.
        if (want === null && this.sim.monster(cur.id) !== undefined && this.time < cur.holdUntil) continue;
        cur.leave(this.L.sw * 0.3);
        this.actors[i] = null;
        this.setBadge(i, -1);
      }
      if (want === null) continue;
      const m = this.sim.monster(want);
      const at = this.seatAt[i];
      if (m === undefined || at === undefined) continue;
      const a = new MonsterActor(m.id, m.species, this.L.kMon, this.L.bodyH, this.anim, (id) => this.onTap(id));
      a.root.position.set(at.x, at.y);
      a.root.scale.set(SEAT_SCALE);
      a.root.zIndex = 40 + (i % 2);
      this.root.addChild(a.root);
      this.actors[i] = a;
      if (this.time > 0) a.enter(this.L.sw * 0.2);
      if (m.pose !== 'base' && m.phase === 'reacting') a.showPose(m.pose, m.timer);
    }
  }

  /** 보여 줄 경주를 sim 상태에서 고른다 (함께 경주가 먼저, 없으면 혼자 경주 한판). */
  private syncShow(bs: BoothState, dt: number): void {
    const race = bs.group;
    const sh = this.show;
    const result = raceOf(race?.play);
    if (race !== null && result !== null && (race.phase === 'running' || race.phase === 'done')) {
      const key = `shared:${result.finishAt.join(',')}`;
      const t = race.phase === 'done' ? Math.max(race.elapsed, race.duration) : race.elapsed;
      if (sh === null || sh.key !== key) this.startShow(key, result, true, -1, t);
      const cur = this.show;
      if (cur === null) return;
      if (cur.bets.size !== race.participants.length) cur.bets = new Map(race.participants.map((p) => [p.seat, p.pick as RacerIndex]));
      for (let i = 0; i < this.actors.length; i++) this.setBadge(i, this.actors[i] !== null ? (cur.bets.get(i) ?? -1) : -1);
      this.advance(cur, dt, t);
      if (race.phase === 'done' && !cur.done) this.endShow(cur);
      return;
    }
    if (race !== null && race.phase !== 'idle') {
      // 모이는 중 (함께 경주): 지난 경주는 보여 줄 만큼 보여 주고 치운다.
      if (sh !== null && !sh.done) this.endShow(sh);
      if (sh !== null && this.time - sh.doneAt > AFTER_HOLD) this.clearShow();
      const bets = new Map(race.participants.map((p) => [p.seat, p.pick as RacerIndex]));
      for (let i = 0; i < this.actors.length; i++) this.setBadge(i, this.actors[i] !== null ? (bets.get(i) ?? -1) : -1);
      return;
    }
    // 혼자 경주 (경주 상태가 없을 때: 미리보기 등): 자리마다의 한판.
    if (sh !== null && !sh.shared && !sh.done) {
      const r = bs.rounds[sh.soloSeat] ?? null;
      if (r === null || this.soloKey(sh.soloSeat, r) !== sh.key) this.endShow(sh);
      else this.advance(sh, dt, r.elapsed);
    }
    const cur = this.show;
    if (cur === null || (cur.done && this.time - cur.doneAt > 0.9)) {
      const i = bs.rounds.findIndex((r) => r !== null && r.outcome.detail.kind === 'race' && r.elapsed < r.duration);
      const r = bs.rounds[i] ?? null;
      if (r !== null && (cur === null || cur.key !== this.soloKey(i, r))) this.startShow(this.soloKey(i, r), this.soloRace(r), false, i, r.elapsed);
      else if (cur !== null && cur.done && this.time - cur.doneAt > AFTER_HOLD) this.clearShow();
    }
    // 혼자 경주의 표: 자리마다 자기 한판의 선수.
    for (let i = 0; i < this.actors.length; i++) {
      const d = bs.rounds[i]?.outcome.detail;
      const keep = this.show !== null && !this.show.shared ? this.show.bets.get(i) : undefined;
      this.setBadge(i, this.actors[i] === null ? -1 : d !== undefined && d.kind === 'race' ? d.racer : (keep ?? -1));
    }
  }

  private soloKey(seat: number, r: ActiveRound): string {
    return `solo:${seat}:${r.monster}:${r.bet}:${r.duration.toFixed(3)}`;
  }

  /** 혼자 경주: 세부(건 선수·등수·역전·사진 판정)에 맞는 경주를 만든다 (그 한판으로 정해지는 씨앗). */
  private soloRace(r: ActiveRound): RaceResult {
    const d = r.outcome.detail;
    const seed = (r.monster * 7919 + r.bet * 104729 + Math.round(r.duration * 1000)) | 0;
    const want = d.kind === 'race' ? d : { racer: 0 as RacerIndex, place: 1, comeback: false, photoFinish: false };
    const res = generateRace(new Rng(seed), r.duration, { comeback: want.comeback, photo: want.photoFinish });
    // 그 등수로 들어온 선수와 건 선수를 맞바꾼다.
    const other = res.finishOrder[Math.max(0, Math.min(3, want.place - 1))] ?? want.racer;
    const swap = (x: RacerIndex): RacerIndex => (x === other ? want.racer : x === want.racer ? other : x);
    const keys = [...res.keys];
    const finishAt = [...res.finishAt];
    keys[want.racer] = res.keys[other] ?? [];
    keys[other] = res.keys[want.racer] ?? [];
    finishAt[want.racer] = res.finishAt[other] ?? 0;
    finishAt[other] = res.finishAt[want.racer] ?? 0;
    return { ...res, keys, finishAt, finishOrder: res.finishOrder.map(swap) };
  }

  private startShow(key: string, result: RaceResult, shared: boolean, soloSeat: number, t: number): void {
    const winner = result.finishOrder[0] ?? 0;
    const F = result.finishAt[winner] ?? 0;
    // 사진 판정 순간을 이미 지나서 열었으면 멈추지 않는다.
    const photo = result.photoFinish && t < F - PHOTO.slowFrom ? 'pre' : 'sync';
    const bets = new Map<number, RacerIndex>();
    if (!shared) {
      const d = this.state.rounds[soloSeat]?.outcome.detail;
      if (d !== undefined && d.kind === 'race') bets.set(soloSeat, d.racer);
    }
    this.show = { key, result, shared, soloSeat, bets, t, tau: t, photo, freezeLeft: 0, done: false, doneAt: 0, fired: new Set(), leader: null, ranks: new Map(), winnerWasLast: false };
    if (t > 0.5) this.show.fired.add('start');
    if (t > F) this.show.fired.add('finish');
    if (this.caption !== null) dismiss(this.anim, this.caption);
    this.caption = null;
    this.photoFrame.visible = false;
    // 순위판은 지금 순위로 바로 (다음 프레임부터 미끄러지듯 바뀐다).
    raceStandings(result, Math.max(0, t)).forEach((r, rank) => {
      const icon = this.boardIcons[r];
      if (icon !== undefined) icon.x = this.boardX[rank] ?? 0;
    });
  }

  private endShow(sh: Show): void {
    sh.done = true;
    sh.doneAt = this.time;
  }

  private clearShow(): void {
    const sh = this.show;
    if (sh === null) return;
    this.show = null;
    this.medal.visible = false;
    this.photoFrame.visible = false;
    for (const r of this.racers) r.x = r.lastX;
  }

  /** 진짜 시계를 sim에 맞추고, 보여 주는 시계(사진 판정 멈춤)를 굴린다. */
  private advance(sh: Show, dt: number, simT: number): void {
    sh.t += dt;
    if (Math.abs(sh.t - simT) > 0.3) sh.t = simT;
    const F = sh.result.finishAt[sh.result.finishOrder[0] ?? 0] ?? 0;
    switch (sh.photo) {
      case 'pre':
        sh.tau = sh.t;
        if (sh.t >= F - PHOTO.slowFrom) {
          sh.photo = 'slow';
          sh.tau = F - PHOTO.slowFrom;
        }
        break;
      case 'slow':
        sh.tau = Math.min(F, sh.tau + dt * (PHOTO.slowFrom / PHOTO.slow));
        if (sh.tau >= F) {
          sh.photo = 'freeze';
          sh.freezeLeft = PHOTO.freeze;
          this.photoMoment();
        }
        break;
      case 'freeze':
        sh.freezeLeft -= dt * (sh.done ? 2 : 1);
        if (sh.freezeLeft <= 0) {
          sh.photo = 'catch';
          this.photoFrame.visible = false;
        }
        break;
      case 'catch':
        sh.tau = Math.min(sh.t, sh.tau + dt * PHOTO.catch * (sh.done ? 2 : 1));
        if (sh.tau >= sh.t) sh.photo = 'sync';
        break;
      case 'sync':
        sh.tau = sh.t;
        break;
    }
  }

  /** 사진 판정: 번쩍 + 결승선 둘레 사진 틀 + '사진 판정!'. */
  private photoMoment(): void {
    const L = this.L;
    const sw = L.sw;
    void this.anim.run(0.45, (u) => {
      this.flash.alpha = 0.85 * (1 - u);
    }, { ease: ease.outQuad });
    const x0 = this.finishX - sw * 0.1;
    const x1 = this.finishX + sw * 0.26;
    const y0 = this.sandTop - (L.h - this.sandTop) * 0.12;
    const y1 = this.laneY[3]! + (L.h - this.sandTop) * 0.06;
    const line = Math.max(4, sw * 0.014);
    this.photoFrame.clear().roundRect(x0, y0, x1 - x0, y1 - y0, line).stroke({ color: 0xffffff, width: line }).roundRect(x0 - line / 2, y0 - line / 2, x1 - x0 + line, y1 - y0 + line, line).stroke({ color: INK, width: 1.5 });
    this.photoFrame.visible = true;
    if (this.caption !== null) dismiss(this.anim, this.caption);
    this.caption = popCaption(this.ui, this.anim, '사진 판정!', L.w / 2, this.capY, L.caption.size * 0.7, 0xffffff, PHOTO.freeze);
    this.say(1, '찰칵!', PHOTO.freeze);
    // 1·2등 선수에 건 손님은 숨을 멈춘다.
    const sh = this.show;
    if (sh === null) return;
    const top = sh.result.finishOrder.slice(0, 2);
    for (const [seat, racer] of sh.bets) {
      const a = this.actors[seat] ?? null;
      if (a !== null && !a.leaving && top.includes(racer)) a.emote('shock', 0.9);
    }
  }

  // ── 경주 그리기 ─────────────────────────────────────────────────────────

  private racerP(res: RaceResult, r: RacerIndex, tau: number): number {
    const fin = res.finishAt[r] ?? Infinity;
    if (tau <= fin) return raceProgress(res, r, tau);
    return 1 + OVERRUN * (1 - Math.exp(-(tau - fin) * 2.2));
  }

  private drawRace(bs: BoothState, dt: number): void {
    const sh = this.show;
    const race = bs.group;
    const gathering = race !== null && race.phase === 'gathering';
    // 모이는 중: 출발까지 마지막 3초는 크게 센다.
    const cd = gathering ? Math.ceil(race.countdown) : 0;
    const countText = gathering && race.countdown <= 3 && cd > 0 ? `${cd}` : '';
    if (countText !== this.countShown) {
      this.countShown = countText;
      this.count.text = countText;
    }
    if (countText !== '') this.count.scale.set(1 + (race !== null ? (race.countdown % 1) * 0.35 : 0));
    // 사진 판정으로 멈추는 동안은 순위판·메달을 감춘다 (누가 1등인지 멈춤이 풀릴 때 알린다).
    const suspense = sh !== null && (sh.photo === 'slow' || sh.photo === 'freeze');
    this.board.visible = sh !== null && !suspense;
    if (sh === null) {
      this.medal.visible = false;
      this.drawWaiting(dt, gathering, gathering ? race.countdown : Infinity);
      return;
    }
    const res = sh.result;
    const tau = sh.tau;
    const winner = res.finishOrder[0] ?? 0;
    const F = res.finishAt[winner] ?? 0;
    const frozen = sh.photo === 'freeze';
    // 선수
    for (const r of RACERS) {
      const rc = this.racers[r];
      if (rc === undefined) continue;
      const p = this.racerP(res, r, tau);
      const before = this.racerP(res, r, Math.max(0, tau - 0.08));
      const fin = res.finishAt[r] ?? 1;
      const speed = clamp01(((p - before) / 0.08) * fin * 0.9);
      const x = lerp(this.startX, this.finishX, p);
      rc.step = p * (GAIT[r]?.strides ?? 12);
      rc.face = 1;
      rc.lastX = x;
      this.placeRacer(r, x, frozen ? 0 : speed);
    }
    // 순위판과 1등 메달
    const order = raceStandings(res, tau);
    order.forEach((r, rank) => {
      const icon = this.boardIcons[r];
      const tx = this.boardX[rank] ?? 0;
      if (icon !== undefined) icon.x = frozen ? icon.x : lerp(icon.x, tx, Math.min(1, dt * 10));
    });
    const won = tau >= F && !suspense;
    this.medal.visible = won;
    if (won) {
      const rc = this.racers[winner];
      // 코끝 앞 (위에 두면 뒤 레인 선수와 겹쳐 헷갈린다).
      const ls = this.laneS[winner] ?? 1;
      if (rc !== undefined) this.medal.position.set(rc.node.x - this.kRacer * 330 * ls * 0.32, rc.node.y - this.kRacer * 330 * ls * 0.55);
    }
    this.cheerLive(sh, order, tau, F);
    this.hostMoves(sh, tau, F);
    this.moments(sh, order, tau, F);
  }

  /** 선수 하나를 x에 (걸음 모양은 빠르기 speed 0~1 만큼). */
  private placeRacer(r: RacerIndex, x: number, speed: number): void {
    const rc = this.racers[r];
    if (rc === undefined) return;
    const n = rc.node;
    const s = this.laneS[r] ?? 1;
    const H = this.kRacer * 330 * s;
    const ph = rc.step * Math.PI * 2;
    let dy = 0;
    let rot = 0;
    let sx = 1;
    let sy = 1;
    switch (GAIT[r]?.kind) {
      case 'glide':
        sx = 1 + Math.sin(ph) * 0.07 * speed;
        sy = 1 - Math.sin(ph) * 0.05 * speed;
        break;
      case 'waddle':
        rot = Math.sin(ph) * 0.07 * speed;
        dy = -Math.abs(Math.sin(ph)) * H * 0.04 * speed;
        break;
      case 'hop': {
        const k = Math.abs(Math.sin(ph / 2));
        dy = -k * H * 0.38 * speed;
        rot = -Math.cos(ph / 2) * 0.16 * speed;
        break;
      }
      case 'scuttle':
        dy = -Math.abs(Math.sin(ph)) * H * 0.05 * speed;
        rot = Math.sin(ph * 0.5) * 0.03 * speed;
        break;
    }
    // 코끝이 기준점이라, 오른쪽을 볼 때(돌아갈 때)는 몸 폭만큼 옮긴다.
    const bodyW = this.kRacer * 420 * s;
    n.position.set(rc.face === 1 ? x : x + bodyW, (this.laneY[r] ?? 0) + dy);
    n.rotation = rot * rc.face;
    n.scale.set(s * sx * rc.face, s * sy);
  }

  /** 경주가 없을 때: 출발선으로 걸어 돌아가 (오른쪽을 보고) 기다린다. 모이는 중이면 출발선에서 꼼지락. */
  private drawWaiting(dt: number, gathering: boolean, countdown: number): void {
    const sw = this.L.sw;
    for (const r of RACERS) {
      const rc = this.racers[r];
      if (rc === undefined) continue;
      const d = this.startX - rc.x;
      if (Math.abs(d) > 1) {
        // 다음 경주가 곧 출발하면 서둘러 돌아간다.
        const v = Math.max(sw * 0.38, Math.abs(d) / Math.max(0.4, countdown - 0.6)) * dt;
        rc.x += Math.sign(d) * Math.min(Math.abs(d), v);
        rc.face = d > 0 ? -1 : 1;
        rc.step += (Math.min(Math.abs(d), v) / (this.startX - this.finishX)) * (GAIT[r]?.strides ?? 12);
        rc.lastX = rc.x;
        this.placeRacer(r, rc.x, 0.7);
      } else {
        rc.x = this.startX;
        rc.face = 1;
        rc.lastX = rc.x;
        // 출발선에서 꼼지락 (모이는 중이면 조금 더).
        rc.step += dt * (gathering ? 1.2 : 0.4);
        this.placeRacer(r, rc.x, gathering ? 0.25 : 0.1);
      }
    }
  }

  /** 경주 중 관중석: 자기 선수가 1등이면 들썩, 꼴찌면 땀, 결승 직전엔 다 같이 일어선다. */
  private cheerLive(sh: Show, order: readonly RacerIndex[], tau: number, F: number): void {
    if (sh.done && tau >= F) return;
    const finalStretch = span(tau, F - 1.4, F - 0.2) * (tau < F + 0.2 ? 1 : 0);
    for (const [seat, racer] of sh.bets) {
      const a = this.actors[seat] ?? null;
      if (a === null || a.leaving) continue;
      if (tau < 0.2 || tau >= F) continue;
      const rank = order.indexOf(racer);
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
      // 일어서기 (다 같이 숨죽이고)
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

  /** 진행자 동작: 출발 신호는 출발 때 깃발을 휙 내리고, 결승 때 다 같이 폴짝. */
  private hostMoves(sh: Show, tau: number, F: number): void {
    const starter = this.hosts[0] ?? null;
    if (starter !== null && tau < 0.7) {
      const u = span(tau, 0, 0.45);
      const chop = Math.sin(Math.PI * u);
      starter.rig.rot = 0.28 * chop;
      starter.rig.dy = -starter.height * 0.03 * chop;
    }
    const caster = this.hosts[1] ?? null;
    if (caster !== null && tau > 0.3 && tau < F) caster.rig.rot = Math.sin(this.time * 9) * 0.02;
    if (!sh.fired.has('hostCheer') && tau >= F && sh.photo !== 'slow' && sh.photo !== 'freeze') {
      sh.fired.add('hostCheer');
      for (const h of this.hosts) h?.cheer(sh.result.comeback);
    }
  }

  /** 한 번씩: 출발, 선두 바뀜 해설, 역전, 마지막 직선, 결승 (관중 전체 반응, 큰 글자). */
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
          } else this.say(1, `${racerName(lead)} 앞으로!`, 1.1);
        }
      }
      if (!sh.fired.has('stretch') && tau >= F - 1.5 && tau > 1) {
        sh.fired.add('stretch');
        if (this.bubble === null || this.time > this.bubble.until - 0.3) this.say(1, '마지막 직선!', 1);
      }
      return;
    }
    if (sh.fired.has('finish') || sh.photo === 'slow' || sh.photo === 'freeze') return;
    sh.fired.add('finish');
    // 결승: 관중석 전체가 한꺼번에 일어났다 주저앉는다 (sim 반응 이벤트는 조금 뒤 결과와 함께 온다).
    for (const [seat, racer] of sh.bets) {
      const a = this.actors[seat] ?? null;
      if (a === null || a.leaving) continue;
      const tier = raceTier(res, racer);
      const fp = FINISH_POSE[tier];
      a.showPose(fp.pose, 1.6);
      a.playMotion(fp.motion, tier === 'jackpot' ? 1.2 : 1, 1.4);
      if (tier === 'jackpot') a.emote('sparkle', 1.1);
      a.holdUntil = Math.max(a.holdUntil, this.time + 3);
    }
    const L = this.L;
    this.announce(sh);
    const winners = [...sh.bets.values()].filter((r) => r === winner).length;
    confetti(this.fx, this.anim, L.w, L.h, res.comeback && winners > 0 ? 50 : winners > 0 ? 24 : 12);
  }

  /** 1등 발표: 큰 글자와 해설. */
  private announce(sh: Show): void {
    const L = this.L;
    const res = sh.result;
    const name = racerName(res.finishOrder[0] ?? 0);
    if (this.caption !== null) dismiss(this.anim, this.caption);
    this.caption = popCaption(this.ui, this.anim, res.comeback ? '대역전!' : `${name} 1등!`, L.w / 2, this.capY, L.caption.size * (res.comeback ? 1 : 0.75), res.comeback ? 0xffc83d : 0xffffff, 1.4);
    this.say(1, `${name} 골인!`, 1.3);
  }

  /** 진행자 머리 위 말풍선 (who = 자리: 0 출발 신호, 1 해설자). 해설자가 없으면 출발 신호가 대신. */
  private say(who: number, text: string, sec: number): void {
    const h = this.hosts[who] ?? this.hosts[who === 1 ? 0 : 1] ?? null;
    if (h === null) return;
    this.bubble?.node.destroy({ children: true });
    const fs = Math.max(13, this.L.sw * 0.042);
    const b = bubbleNode(text, fs);
    // 말풍선은 머리 위, 진행자가 보는 쪽으로 (해설자는 확성기 끝 쪽). 얼굴을 가리지 않게 꼬리 끝이 머리 꼭대기에 오게.
    // 위 가운데 순위판과 겹치면 순위판 아래로 내리고 머리 옆으로 비킨다. 패널 밖으로 나가지 않게.
    const side = h.root.scale.x < 0 ? -1 : 1;
    const half = b.width / 2 + 4;
    const bh = b.height;
    const meta = artMeta('characters', h.art);
    const headTop = h.root.y - (meta !== undefined && hasArt('characters', h.art) ? meta.trim.h * h.k : h.height * 0.9) * 0.97;
    const clampX = (v: number): number => Math.max(half, Math.min(this.L.w - half, v));
    let x = clampX(h.root.x + side * half * 0.55);
    let y = Math.max(headTop, bh + 4);
    const box = this.boardBox;
    if (this.board.visible && x + half > box.x0 && x - half < box.x1 && y - bh < box.bottom + 4) {
      y = box.bottom + 4 + bh;
      x = clampX(h.root.x + side * (h.halfW + half * 0.9));
    }
    b.position.set(x, y);
    b.scale.set(0.3);
    this.ui.addChild(b);
    this.bubble = { node: b, until: this.time + sec, who };
    void this.anim.run(0.22, (u) => {
      if (!b.destroyed) b.scale.set(lerp(0.3, 1, u));
    }, { ease: ease.outBack });
  }

  private syncLabels(bs: BoothState): void {
    if (bs.pot !== this.potShown) {
      this.potShown = bs.pot;
      this.potLabel.text = `${Math.floor(bs.pot)}`;
    }
    const q = bs.queue.length;
    if (q !== this.queueShown) {
      this.queueShown = q;
      this.queueBadge.visible = q > 0;
      this.queueText.text = `줄 ${q}`;
      const fs = this.queueText.style.fontSize;
      const pad = fs * 0.55;
      const bw = this.queueText.width + pad * 2;
      const bh = fs * 1.5;
      this.queueText.position.set(-pad, 0);
      this.queueBg.clear().roundRect(-bw, -bh / 2, bw, bh, bh / 2).fill({ color: 0xfff6e6, alpha: 0.92 }).stroke({ color: INK, width: 2 });
    }
    const r = bs.group;
    const note = !bs.unlocked
      ? '아직 열지 않은 놀이부스'
      : !boothDef('race').roles.every((role, i) => role.optional === true || (bs.staff[i] ?? null) !== null)
        ? '출발 신호와 해설자가\n있어야 열려요'
        : r !== null && r.phase === 'gathering' && r.countdown > 3
          ? `출발까지 ${Math.ceil(r.countdown)}초`
          : '';
    if (this.note.text !== note) this.note.text = note;
  }

  private actorOf(id: MonsterId): MonsterActor | null {
    return this.actors.find((a): a is MonsterActor => a !== null && a.id === id && !a.leaving) ?? null;
  }

  // ── sim 이벤트 ─────────────────────────────────────────────────────────

  onRoundStarted(_seat: number, _round: ActiveRound): void {
    // 경주는 상태(sim.state.booths.race.group)를 매 프레임 읽어 맞춘다.
  }

  onRoundFinished(seat: number, round: ActiveRound, payout: number): void {
    const sh = this.show;
    if (sh !== null && !sh.shared && sh.soloSeat === seat && !sh.done) this.endShow(sh);
    const a = this.actors[seat] ?? null;
    const L = this.L;
    const tier = round.outcome.tier;
    if (a !== null) {
      // 관중석은 자리가 가까워 글자가 겹친다: 맞힌 손님·아깝게 놓친 손님만 머리 위에 (꽝은 반응으로).
      const s = a.root.scale.x;
      const cap = RESULT_CAPTION[tier];
      if (tier !== 'lose') popCaption(this.ui, this.anim, cap.text, a.root.x, a.root.y + a.headY * s - L.bodyH * 0.12, L.caption.size * 0.42, cap.color);
      a.holdUntil = Math.max(a.holdUntil, this.time + 2.4);
    }
    if (payout > 0) {
      const from = { x: this.pot.x, y: this.pot.y - this.potH * 0.8 };
      const s = a?.root.scale.x ?? SEAT_SCALE;
      const to = a !== null ? { x: a.root.x, y: a.root.y + a.headY * s * 0.6 } : { x: L.w / 2, y: L.h * 0.85 };
      const n = Math.max(3, Math.min(14, Math.round(3 + payout / 4)));
      flyCoins(this.fx, this.anim, from, to, n, L.sw * 0.045, () => {
        floatText(this.fx, this.anim, `+${payout}`, to.x, to.y - L.bodyH * 0.25, Math.max(16, L.sw * 0.06));
      });
      const pot = this.pot;
      void this.anim.run(0.5, (t) => {
        pot.rotation = Math.sin(t * Math.PI * 8) * 0.09 * (1 - t);
      }, { ease: ease.linear });
    }
  }

  onReact(id: MonsterId, r: Reaction): void {
    this.actorOf(id)?.react(r, this.time);
  }

  onSpectate(id: MonsterId, r: Reaction): void {
    const a = this.actorOf(id);
    if (a === null) return;
    if (r.emote !== null) a.emote(r.emote, 0.9);
    a.playMotion(r.motion === 'none' ? 'hop' : r.motion, Math.min(1, r.intensity), r.duration);
  }

  onCheer(id: MonsterId): void {
    const a = this.actorOf(id);
    if (a === null) return;
    a.emote('heart', 1.1);
    a.playMotion('hop', 0.8, 0.7);
  }

  onLeft(id: MonsterId): void {
    const i = this.actors.findIndex((a) => a !== null && a.id === id);
    const a = this.actors[i];
    if (i < 0 || a === null || a === undefined) return;
    a.leave(this.L.sw * 0.3);
    this.actors[i] = null;
    this.setBadge(i, -1);
  }

  onPotFestival(_amount: number): void {
    const L = this.L;
    this.anim.after(0.55, () => {
      popCaption(this.ui, this.anim, '항아리 축제!', L.w / 2, this.capY + L.caption.size, L.caption.size * 0.7, 0xffd54a, 1.6);
      confetti(this.fx, this.anim, L.w, L.h, 40);
    });
  }

  destroy(): void {
    this.anim.kill();
    for (const h of this.hosts) h?.destroy();
    for (const a of this.actors) a?.destroy();
    this.root.destroy({ children: true });
  }
}
