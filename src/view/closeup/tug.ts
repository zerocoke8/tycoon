// 줄다리기 확대 화면. 배경 closeup/bg_tug (풀밭, 지평선에 홍·청 깃발, 가운데 흰 선) 위에 코드로 그린 밧줄(굵은 갈색, 가운데 빨간 리본)과 승리 선 둘.
// 홍(자리 짝수)은 왼쪽에서 오른쪽을, 청(홀수)은 오른쪽에서 왼쪽을 보고 줄을 잡는다 (자리 k = 가운데에서 k번째, 앞뒤로 엇갈려 선다).
// 지도와 같은 타임라인: 밧줄 가운데 c(t) (play.tracks[0], +1 = 홍 쪽 승리 선)만큼 줄과 양편이 같이 끌려가고, 모두 뒤로 기울어 부들부들 버틴다.
//   끌려가는 편은 발을 동동 (흙먼지), 힘을 내는 편 머리 위에 '영차!'. 사건: lead = 응원단장 '홍 힘내!'(그 색 폼폼 털이 팡),
//   brink = 밀린 편 땀·응원단장 '버텨!', flip = 역전 시작 (불끈). crossAt = 승부: 리본이 승리 선을 넘으면 선이 반짝,
//   진 편은 앞으로 우르르 넘어지고(차례로), 이긴 편은 엉덩방아 뒤 기쁨 포즈로 폴짝, 줄은 느슨해진다. 심판이 이긴 편 색 깃발을 들고 그쪽으로.
// 결과 글자는 편마다 하나 (가운데 위 '홍 승리!'·'역전승!'), 코인은 이긴 손님마다 항아리에서.
// 진행자: 심판(자리 0, 가운데 뒤, 리본을 따라 조금 움직임, 시작 '삐익!'), 응원단장(자리 1, 오른쪽 뒤, 폼폼을 흔들며 응원 말풍선).
// 판에 끼지 못하고 다음 판을 기다리는 손님(편 인원 맞추기)은 줄을 잡지 않고 뒤에서 응원한다.
// 빚 걸기 판 (넷째 묶음): 편마다 채무자 1~2 (발밑 표 = 편 + 건 빚, 앞뒤 줄로 엇갈림), 결과 글자·표 숫자는 GroupScene.

import { Container, Graphics } from 'pixi.js';
import { SIDES, SPECIES } from '../../data/defs.ts';
import { ease } from '../../core/tween.ts';
import type { SimApi } from '../../sim/api.ts';
import { trackAt } from '../../sim/group/core.ts';
import { duelCheer } from '../../sim/group/duel.ts';
import type { ActiveRound, GroupEntry, GroupEvent, GroupPlay, GroupState, MonsterId } from '../../sim/types.ts';
import type { HostActor, MonsterActor } from './actor.ts';
import { clamp01, confetti, floatText, INK, lerp, popCaption, span } from './fx.ts';
import { GroupScene, type GroupSeat, type GroupStage } from './group.ts';
import type { Layout } from './layout.ts';
import { flagNode, placeHost, preloadGlyphs, puff, settle, sparkles, Talk, Timeline } from './ssireum_kit.ts';

/** closeup/bg_tug에서 잰 값 (배경 높이의 비율): 지평선(풀밭이 시작하는 선). */
const BG = { grass: 0.613 } as const;
/** 줄 잡는 자리 k의 앞뒤 (풀밭 띠 높이의 비율, - = 뒤)와 배율. */
const ROW = [
  { dy: 0, s: 0.6 },
  { dy: -0.1, s: 0.55 },
  { dy: 0.03, s: 0.6 },
  { dy: -0.08, s: 0.55 },
] as const;
/** 자리 k의 가운데에서 거리 (패널 폭의 비율): first + step × k, 자리가 많으면(레벨 2·3, 편마다 4) 맨 바깥이 farthest 안에 들게 좁힌다. */
const GAP = { first: 0.13, step: 0.098, farthest: 0.37 } as const;
/** 줄 잡는 줄의 발 높이 (풀밭 띠 높이의 비율). */
const LINE_Y = 0.57;
/** 리본이 승리 선까지 가는 거리 (패널 폭의 비율). */
const REACH = 0.085;
const S = { referee: 0.72, cheer: 0.66 } as const;
const ROPE = 0x9a6a3e;
const RIBBON = 0xe0503a;
/** characters/tug_referee: 높이 든 주먹 (발에서 캔버스 px, 그림은 왼쪽을 보고 주먹은 그림 왼쪽). */
const REF_FIST = { x: -264, y: -862 } as const;
/** characters/tug_cheer: 폼폼 둘 (빨강 = 그림 왼쪽, 파랑 = 오른쪽). */
const POMPOM = [
  { x: -316, y: -748 },
  { x: 322, y: -619 },
] as const;

const SIDE_NAME = (s: number): string => SIDES[s]?.name ?? '';
const SIDE_COLOR = (s: number): number => SIDES[s]?.color ?? 0xffffff;
const sideOf = (seat: number): 0 | 1 => (seat % 2 === 0 ? 0 : 1);

preloadGlyphs('홍청 삐익! 당겨! 준비~ 힘내! 끝까지! 버텨! 뒤집는다! 영차! 승리! 역전승! 대역전! 최고! 대박!');

export class TugScene extends GroupScene {
  private readonly lines = new Graphics();
  private readonly rope = new Graphics();
  private readonly flag: Container;
  private readonly refTalk: Talk;
  private readonly cheerTalk: Talk;
  private readonly tl = new Timeline();
  private readonly cx: number;
  private readonly reach: number;
  private readonly grassTop: number;
  private readonly band: number;
  private readonly posed = new Set<MonsterId>();
  private lastC = 0;
  private chantAt = 0;
  private dustAcc = 0;
  /** 이번 판 결과 글자를 띄웠다. */
  private shown: GroupPlay | null = null;
  /** 모이는 중 '준비~'를 했다. */
  private readyShown = false;
  /** 지금 깃발 그림 (색:방향). */
  private flagFor = '';

  constructor(sim: SimApi, w: number, h: number, onTap: (id: MonsterId) => void) {
    super(sim, 'tug', w, h, onTap);
    const L = this.L;
    this.cx = L.w / 2;
    this.grassTop = L.bg.y + BG.grass * L.bg.size;
    this.band = Math.max(20, Math.min(L.h, L.bg.y + L.bg.size) - this.grassTop);
    this.reach = L.w * REACH;
    this.stage.addChild(this.lines);
    this.front.addChild(this.rope);
    this.flag = flagNode(0xffffff, L.bodyH * 0.32, 1);
    this.flag.visible = false;
    this.flag.zIndex = 12;
    this.root.addChild(this.flag);
    this.refTalk = new Talk(this.ui, this.anim, L);
    this.cheerTalk = new Talk(this.ui, this.anim, L);
    this.update(0);
  }

  protected layout(L: Layout): GroupStage {
    const grassTop = L.bg.y + BG.grass * L.bg.size;
    const band = Math.max(20, Math.min(L.h, L.bg.y + L.bg.size) - grassTop);
    const cx = L.w / 2;
    const y0 = grassTop + band * LINE_Y;
    // 자리 수는 부스 레벨마다 (6·8): 바깥 손님이 패널 밖으로 나가지 않게 간격을 맞춘다.
    const kMax = Math.max(1, Math.ceil(this.sim.state.booths.tug.seats.length / 2) - 1);
    const step = Math.min(GAP.step, (GAP.farthest - GAP.first) / kMax);
    const seats: GroupSeat[] = [];
    for (let i = 0; i < 8; i++) {
      const k = Math.floor(i / 2);
      const red = i % 2 === 0;
      const row = ROW[k] ?? ROW[0];
      seats.push({ x: cx + (red ? -1 : 1) * (GAP.first + step * k) * L.w, y: y0 + row.dy * band, scale: row.s, z: (k % 2 === 1 ? 31 : 35) - k * 0.2 + (red ? 0 : 0.1), face: red ? -1 : 1 });
    }
    return {
      seats,
      hosts: [
        { x: cx, y: grassTop + band * 0.12, face: -1 },
        { x: L.w * 0.87, y: grassTop + band * 0.07, face: -1 },
      ],
    };
  }

  /** 편 인원이 덜 찼다: 지금 몇 대 몇. */
  protected override waitText(g: GroupState): string {
    let red = 0;
    for (const e of g.participants) if (e.pick === 0) red++;
    return `홍 ${red} : 청 ${g.participants.length - red}\n편이 차기를 기다려요`;
  }

  protected override pickText(e: GroupEntry): string | null {
    // 자리가 붙어 있어 짧게 (편 이름만).
    return SIDE_NAME(e.pick);
  }

  /** 빚 걸기 판 채무자 표: 자리가 붙어 있어 뒷줄(k 홀수)은 발 바로 아래, 앞줄은 조금 더 아래·바깥으로 엇갈린다. */
  protected override debtBadgeAt(seat: number, fs: number): { x: number; y: number } {
    const at = this.seatAt[seat];
    if (at === undefined) return super.debtBadgeAt(seat, fs);
    const back = Math.floor(seat / 2) % 2 === 1;
    const out = sideOf(seat) === 0 ? -1 : 1;
    return back ? { x: at.x, y: at.y + fs * 0.25 } : { x: at.x + out * fs * 0.9, y: at.y + fs * 1.55 };
  }

  protected drawPlay(play: GroupPlay | null, t: number, dt: number): void {
    const ref = this.hosts[0] ?? null;
    const cheer = this.hosts[1] ?? null;
    this.refTalk.update(this.time);
    this.cheerTalk.update(this.time);
    if (this.tl.sync(play, t)) {
      this.posed.clear();
      this.lastC = Number.NaN;
    }
    const tug = play !== null && play.kind === 'tug' ? play : null;
    const c = tug !== null ? trackAt(tug.tracks[0] ?? [], t) : 0;
    const dc = dt > 0 && tug !== null && Number.isFinite(this.lastC) ? (c - this.lastC) / dt : 0;
    this.lastC = c;
    const shift = -c * this.reach;
    const after = tug !== null ? t - tug.crossAt : -1;
    const up = tug !== null ? span(t, tug.end + 2.2, tug.end + 2.9) : 0;
    if (tug !== null) for (const ev of this.tl.due(t)) this.onEvent(tug, ev);
    this.drawLines(tug, after);
    this.drawPullers(tug, dc, shift, after, up, dt);
    this.drawRope(tug, shift, after);
    this.drawHosts(ref, cheer, tug, shift, after, up);
    if (tug !== null) {
      if (t < 1.2 && this.tl.once('start')) {
        this.refTalk.say(ref, '삐익!', 0.9, this.time);
        ref?.cheer(false);
        this.cheerTalk.say(cheer, '당겨!', 0.9, this.time);
      }
      if (after >= 0 && this.tl.once('cross')) this.onCross(tug, shift);
      this.chant(tug, dc, t, after);
    } else {
      const g = this.group;
      const gathering = g !== null && g.phase === 'gathering';
      if (gathering && g.countdown < 2.6 && g.countdown > 0.5 && !this.readyShown && !this.cheerTalk.busy(this.time)) {
        this.readyShown = true;
        this.cheerTalk.say(cheer, '준비~', 1.2, this.time);
      }
      if (!gathering) this.readyShown = false;
    }
  }

  /** 승리 선 둘 (리본이 넘으면 그 선이 반짝). */
  private drawLines(play: Extract<GroupPlay, { kind: 'tug' }> | null, after: number): void {
    const g = this.lines.clear();
    const y0 = this.grassTop + this.band * 0.18;
    const y1 = this.grassTop + this.band * 0.92;
    for (const s of [0, 1]) {
      const x = this.cx + (s === 0 ? -1 : 1) * this.reach;
      const lit = play !== null && after >= 0 && play.winner === s ? 0.5 + 0.5 * Math.abs(Math.sin(after * 10)) * Math.max(0, 1 - after / 2) : 0;
      // 원근: 아래로 갈수록 바깥으로 조금.
      const lean = (s === 0 ? -1 : 1) * this.band * 0.04;
      if (lit > 0) g.moveTo(x, y0).lineTo(x + lean, y1).stroke({ color: 0xffd54a, width: Math.max(8, this.L.sw * 0.03), alpha: lit, cap: 'round' });
      g.moveTo(x, y0).lineTo(x + lean, y1).stroke({ color: 0xfff6e2, width: Math.max(3, this.L.sw * 0.011), alpha: 0.9, cap: 'round' });
    }
  }

  /** 줄 잡은 손님 (판 중 참가자만, 다음 판을 기다리는 손님은 뒤에서 응원). */
  private drawPullers(play: Extract<GroupPlay, { kind: 'tug' }> | null, dc: number, shift: number, after: number, up: number, dt: number): void {
    const L = this.L;
    const g = this.group;
    const gathering = g !== null && g.phase === 'gathering';
    for (let seat = 0; seat < this.actors.length; seat++) {
      const a = this.actor(seat);
      if (a === null) continue;
      const e = this.entryAt(seat);
      const side = sideOf(seat);
      const fwd = side === 0 ? 1 : -1;
      const k = Math.floor(seat / 2);
      const H = L.bodyH * (this.seatAt[seat]?.scale ?? 0.55);
      if (e === undefined) {
        // 다음 판을 기다리는 손님: 한 걸음 뒤에서 들썩.
        if (play !== null) this.move(a, -fwd * H * 0.15, -this.band * 0.05, 0);
        a.eager = play !== null ? 0.35 : 0.15;
        continue;
      }
      if (play === null) {
        // 줄을 느슨히 잡고 기다린다.
        a.eager = gathering ? 0.45 : 0.1;
        this.move(a, 0, 0, -fwd * 0.08);
        continue;
      }
      if (after < 0) {
        // 뒤로 기울어 버틴다. 끌려가는 편(c가 상대 쪽으로 움직임)은 발을 동동.
        const gain = dc * fwd;
        const dragged = clamp01(-gain * 1.2);
        const quiver = Math.sin(this.time * 36 + seat * 1.7) * H * 0.012;
        const step = dragged > 0.1 ? -Math.abs(Math.sin(this.time * 14 + seat)) * H * 0.05 * dragged : 0;
        const lean = 0.3 + 0.14 * clamp01(Math.abs(dc) * 1.5) - 0.16 * dragged + 0.04 * Math.sin(this.time * 5 + seat);
        this.move(a, shift + quiver, step, -fwd * lean);
        continue;
      }
      const won = play.winner === side;
      if (!this.posed.has(a.id)) {
        this.posed.add(a.id);
        a.showPose(won ? 'joy' : 'agony', Math.max(1, play.end - play.crossAt - after + 2.4));
      }
      if (won) {
        // 엉덩방아 (0.45초) 뒤 폴짝폴짝.
        const sit = Math.sin(clamp01(after / 0.45) * Math.PI);
        const hop = after > 0.45 ? Math.abs(Math.sin((after - 0.45) * 7 + k)) * H * 0.14 * Math.max(0, 1 - (after - 0.45) / 2.2) : 0;
        this.move(a, (shift - fwd * H * 0.18 * sit) * (1 - up), -hop, -fwd * 0.35 * sit);
        a.rig.sy = 1 - 0.16 * sit;
        a.rig.sx = 1 + 0.08 * sit;
      } else {
        // 앞으로 우르르 (가운데에 가까운 손님부터 차례로). 몸 가운데를 축으로 엎어져 상대 편까지 쓰러지지 않게.
        const fall = ease.outQuad(clamp01((after - k * 0.07) / 0.3)) * (1 - up);
        const th = 1.05 * fall;
        const c = H * 0.45;
        this.move(a, shift - fwd * c * Math.sin(th) + fwd * H * 0.1 * fall, c * (1 - Math.cos(th)) - H * 0.3 * Math.sin(th), fwd * th);
      }
    }
    // 끌려가는 편 발밑 흙먼지.
    if (play !== null && after < 0 && Math.abs(dc) > 0.18) {
      this.dustAcc += dt;
      if (this.dustAcc > 0.3) {
        this.dustAcc = 0;
        const loserSide = dc > 0 ? 1 : 0;
        for (const e of g?.participants ?? []) {
          if (sideOf(e.seat) !== loserSide || Math.floor(e.seat / 2) > 1) continue;
          const a = this.actor(e.seat);
          if (a !== null) puff(this.fx, this.anim, a.root.x + shift, a.root.y, L.sw * 0.05, 2, 0.7);
        }
      }
    }
  }

  /** 밧줄: 판 중엔 팽팽(곧은 줄, 잡은 손 주먹), 모이는 중·끝난 뒤엔 느슨, 아무도 없으면 땅에. */
  private drawRope(play: Extract<GroupPlay, { kind: 'tug' }> | null, shift: number, after: number): void {
    const L = this.L;
    const g = this.rope.clear();
    // 잡은 손 자리 (손님 몸이 이미 shift만큼 끌려가 있다).
    const holders: { x: number; y: number; m: MonsterActor }[] = [];
    for (const e of this.group?.participants ?? []) {
      const a = this.actor(e.seat);
      if (a === null) continue;
      const s = Math.abs(a.root.scale.y);
      const fwd = sideOf(e.seat) === 0 ? 1 : -1;
      const H = L.bodyH * s;
      // 앞으로 내민 손 (몸이 기울면 같이).
      const rot = a.rig.rot * Math.sign(a.root.scale.x);
      const hx = fwd * H * 0.3;
      const hy = -H * 0.42;
      const x = a.root.x + a.rig.dx * a.root.scale.x + hx * Math.cos(rot) - hy * Math.sin(rot);
      const y = a.root.y + a.rig.dy * s + hx * Math.sin(rot) + hy * Math.cos(rot);
      holders.push({ x, y, m: a });
    }
    const ground = this.grassTop + this.band * (LINE_Y + 0.05);
    const restY = this.grassTop + this.band * LINE_Y - L.bodyH * 0.56 * 0.42;
    const xs = holders.map((h) => h.x);
    const pad = L.sw * 0.08;
    const mid = this.cx + shift;
    const x0 = (xs.length > 0 ? Math.min(mid - L.w * 0.16, ...xs) : this.cx - L.w * 0.36) - pad;
    const x1 = (xs.length > 0 ? Math.max(mid + L.w * 0.16, ...xs) : this.cx + L.w * 0.36) + pad;
    const taut = play !== null && after < 0;
    const ropeY = holders.length > 0 ? holders.reduce((s, h) => s + h.y, 0) / holders.length : restY;
    const W = Math.max(5, L.sw * 0.022);
    const line = (draw: (gg: Graphics) => void, width: number, color: number): void => {
      draw(g);
      g.stroke({ width, color, cap: 'round', join: 'round' });
    };
    let ribbonX = this.cx + shift;
    let ribbonY = ropeY;
    if (holders.length === 0) {
      // 땅에 놓인 줄.
      const path = (gg: Graphics): void => {
        gg.moveTo(x0, ground).quadraticCurveTo(this.cx, ground + this.band * 0.04, x1, ground);
      };
      line(path, W + 3, INK);
      line(path, W - 1, ROPE);
      ribbonY = ground + this.band * 0.02;
    } else if (taut) {
      const sx0 = x0;
      const sx1 = x1;
      const path = (gg: Graphics): void => {
        gg.moveTo(sx0, ropeY).lineTo(sx1, ropeY);
      };
      line(path, W + 3, INK);
      line(path, W - 1, ROPE);
      // 꼬임 무늬
      for (let x = sx0 + W; x < sx1 - W; x += W * 1.6) g.moveTo(x, ropeY - W * 0.3).lineTo(x + W * 0.6, ropeY + W * 0.3);
      g.stroke({ width: Math.max(1, W * 0.18), color: 0x6f4a2a, alpha: 0.7 });
    } else {
      // 느슨한 줄: 끝난 뒤엔 진 편 쪽 끝이 땅으로 떨어진다.
      const loser = play !== null ? (play.winner === 0 ? 1 : 0) : -1;
      const drop = play !== null ? clamp01(after / 0.4) : 0;
      const yl = loser === 0 ? lerp(ropeY, ground, drop) : ropeY;
      const yr = loser === 1 ? lerp(ropeY, ground, drop) : ropeY;
      const sag = this.band * (play !== null ? 0.12 : 0.08);
      const sx0 = x0;
      const sx1 = x1;
      const path = (gg: Graphics): void => {
        gg.moveTo(sx0, yl).quadraticCurveTo((sx0 + sx1) / 2, (yl + yr) / 2 + sag * 2, sx1, yr);
      };
      line(path, W + 3, INK);
      line(path, W - 1, ROPE);
      ribbonX = this.cx + shift;
      const u = (ribbonX - sx0) / Math.max(1, sx1 - sx0);
      ribbonY = (1 - u) * (1 - u) * yl + 2 * u * (1 - u) * ((yl + yr) / 2 + sag * 2) + u * u * yr;
    }
    // 가운데 빨간 리본
    const rw = Math.max(6, L.sw * 0.022);
    const rh = Math.max(14, L.sw * 0.07);
    const flutter = Math.sin(this.time * 9) * rw * 0.25;
    g.poly([ribbonX - rw / 2, ribbonY, ribbonX + rw / 2, ribbonY, ribbonX + rw * 0.7 + flutter, ribbonY + rh, ribbonX - rw * 0.2 + flutter, ribbonY + rh * 0.85]).fill({ color: RIBBON }).stroke({ color: INK, width: 2, join: 'round' });
    g.circle(ribbonX, ribbonY, rw * 0.55).fill({ color: RIBBON }).stroke({ color: INK, width: 2 });
    // 잡은 손 (종 색 주먹)
    if (play !== null && after >= 0) return;
    for (const h of holders) {
      const r = Math.max(4, L.bodyH * Math.abs(h.m.root.scale.y) * 0.07);
      g.circle(h.x, ropeY + (h.y - ropeY) * 0.15, r).fill({ color: SPECIES[h.m.species].color }).stroke({ color: INK, width: 2 });
    }
  }

  /** 심판: 리본을 따라 조금 움직이며 보고, 승부가 나면 이긴 편 색 깃발. 응원단장: 폼폼을 흔들며 통통. */
  private drawHosts(ref: HostActor | null, cheer: HostActor | null, play: Extract<GroupPlay, { kind: 'tug' }> | null, shift: number, after: number, up: number): void {
    const L = this.L;
    const h0 = this.hostAt[0];
    const h1 = this.hostAt[1];
    this.flag.visible = false;
    if (ref !== null && h0 !== undefined) {
      placeHost(ref, L, h0.x + shift * 0.35, h0.y, S.referee, h0.face);
      if (play !== null && after >= 0) {
        const u = span(after, 0, 0.25) * (1 - up);
        const k = ref.k * S.referee;
        const flip = ref.root.scale.x < 0 ? 1 : -1;
        const dir = play.winner === 0 ? -1 : 1;
        this.redrawFlag(SIDE_COLOR(play.winner), dir);
        this.flag.visible = u > 0;
        this.flag.position.set(ref.root.x + REF_FIST.x * k * flip, ref.root.y + REF_FIST.y * k + L.bodyH * 0.12);
        this.flag.scale.set(0.4 + 0.6 * ease.outBack(clamp01(u)));
        this.flag.rotation = dir * 0.25 * u;
        ref.rig.rot = dir * 0.1 * u * flip;
      } else if (play !== null) ref.rig.rot = Math.sin(this.time * 2) * 0.02;
    }
    if (cheer !== null && h1 !== undefined) {
      placeHost(cheer, L, h1.x, h1.y, S.cheer, h1.face);
      if (play !== null && after < 0) {
        cheer.rig.dy = -Math.abs(Math.sin(this.time * 6)) * cheer.height * S.cheer * 0.04;
        cheer.rig.rot = Math.sin(this.time * 3) * 0.06;
      }
    }
  }

  private redrawFlag(color: number, dir: number): void {
    const key = `${color}:${dir}`;
    if (key === this.flagFor) return;
    this.flagFor = key;
    this.flag.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.flag.addChild(flagNode(color, this.L.bodyH * 0.32, dir));
  }

  /** 폼폼 털이 팡 (응원단장 손의 그 색 폼폼에서). */
  private pompom(side: number): void {
    const cheer = this.hosts[1] ?? null;
    if (cheer === null) return;
    const k = cheer.k * Math.abs(cheer.root.scale.y);
    const flip = cheer.root.scale.x < 0 ? 1 : -1;
    // 그림이 뒤집혀 있지 않으면(얼굴이 왼쪽) 빨강 폼폼이 화면 왼쪽.
    const pp = POMPOM[side === 0 ? (flip === 1 ? 0 : 1) : flip === 1 ? 1 : 0] ?? POMPOM[0];
    const x = cheer.root.x + pp.x * k * flip;
    const y = cheer.root.y + pp.y * k;
    const n = 9;
    for (let i = 0; i < n; i++) {
      const r = this.L.sw * (0.008 + Math.random() * 0.008);
      const g = new Graphics().circle(0, 0, r).fill({ color: SIDE_COLOR(side) }).stroke({ color: INK, width: 1.5 });
      const a = (i / n) * Math.PI * 2;
      const d = this.L.sw * (0.05 + Math.random() * 0.05);
      g.position.set(x, y);
      this.fx.addChild(g);
      void this.anim
        .run(0.6, (u) => {
          g.position.set(x + Math.cos(a) * d * u, y + Math.sin(a) * d * u + this.L.sw * 0.04 * u * u);
          g.alpha = 1 - u * u;
        }, { ease: ease.outQuad })
        .then(() => g.destroy());
    }
    cheer.cheer(false);
  }

  private onEvent(play: Extract<GroupPlay, { kind: 'tug' }>, ev: GroupEvent): void {
    const g = this.group;
    const cheer = this.hosts[1] ?? null;
    const voice = cheer ?? this.hosts[0] ?? null;
    if (g !== null && ev.type !== 'finish') {
      for (const e of g.participants) {
        const a = this.actor(e.seat);
        if (a === null) continue;
        const c = duelCheer(e.pick, ev);
        if (c === 'behind' && ev.type === 'brink') a.emote('sweat', 0.9);
        if (c === 'lead' && ev.type === 'flip') a.emote('anger', 0.9);
      }
    }
    switch (ev.type) {
      case 'lead':
        this.cheerTalk.say(voice, `${SIDE_NAME(ev.actor)} 힘내!`, 1.1, this.time);
        this.pompom(ev.actor);
        break;
      case 'brink':
        this.cheerTalk.say(voice, play.comeback && ev.actor === play.winner ? '끝까지!' : '버텨!', 1.1, this.time);
        this.pompom(ev.actor);
        break;
      case 'flip':
        this.cheerTalk.say(voice, '뒤집는다!', 1.2, this.time);
        this.pompom(ev.actor);
        break;
      default:
        break;
    }
  }

  /** 힘을 내는 편 머리 위 '영차!' (1초마다). */
  private chant(play: Extract<GroupPlay, { kind: 'tug' }>, dc: number, t: number, after: number): void {
    if (after >= 0 || t < 0.8 || this.time < this.chantAt) return;
    this.chantAt = this.time + 1.3;
    const g = this.group;
    if (g === null) return;
    const sides = Math.abs(dc) < 0.05 ? [0, 1] : [dc > 0 ? 0 : 1];
    for (const side of sides) {
      const members = g.participants.filter((e) => sideOf(e.seat) === side).map((e) => this.actor(e.seat)).filter((a): a is MonsterActor => a !== null);
      if (members.length === 0) continue;
      const x = members.reduce((s, a) => s + a.root.x, 0) / members.length + -c2s(play, t) * this.reach;
      const top = Math.min(...members.map((a) => a.root.y + a.headY * Math.abs(a.root.scale.y)));
      floatText(this.fx, this.anim, '영차!', x + (Math.random() - 0.5) * this.L.sw * 0.08, top - this.L.bodyH * 0.05, Math.max(13, this.L.sw * 0.042), 0xffffff);
    }
  }

  /** 승부: 큰 글자, 이긴 편 반짝이, 역전승이면 색종이, 심판·응원단장 폴짝. */
  private onCross(play: Extract<GroupPlay, { kind: 'tug' }>, shift: number): void {
    const L = this.L;
    this.shown = play;
    const name = SIDE_NAME(play.winner);
    const text = play.comeback ? '역전승!' : `${name} 승리!`;
    popCaption(this.ui, this.anim, text, L.w / 2, Math.max(L.h * 0.09, L.caption.size * 0.45), L.caption.size * (play.comeback ? 0.8 : 0.66), play.comeback ? 0xffc83d : SIDE_COLOR(play.winner), 1.6);
    if (play.comeback) confetti(this.fx, this.anim, L.w, L.h, 40);
    const wx = this.cx + (play.winner === 0 ? -1 : 1) * L.w * 0.25 + shift;
    sparkles(this.fx, this.anim, wx, this.grassTop + this.band * 0.3, L.sw * 0.055, 8, L.sw * 0.16);
    puff(this.fx, this.anim, this.cx + shift + (play.winner === 0 ? 1 : -1) * L.w * 0.12, this.grassTop + this.band * LINE_Y, L.sw * 0.1, 6, 1.4);
    // 심판은 깃발로 (말풍선이 위 큰 글자를 가리지 않게), 응원단장이 외친다.
    this.refTalk.clear();
    this.cheerTalk.say(this.hosts[1] ?? null, play.comeback ? '대역전!' : `${name} 최고!`, 1.6, this.time);
    this.pompom(play.winner);
    this.hosts[0]?.cheer(play.comeback);
  }

  override onRoundFinished(seat: number, round: ActiveRound, payout: number): void {
    const a = this.actor(seat);
    if (a === null) return;
    // 편마다 큰 글자 하나(승부 때: '홍 승리!'·'역전승!')라 손님마다 글자는 없다 (대박은 역전승한 편 모두라 겹친다). 코인·숫자만.
    const tier = round.outcome.tier;
    settle(a, tier, payout, this.time, { ui: this.ui, fx: this.fx, anim: this.anim, L: this.L }, Math.max(13, this.L.sw * 0.045), false);
    if (payout > 0) this.shakePot();
    if (this.shown !== this.play && this.play !== null && this.play.kind === 'tug') this.onCross(this.play, 0);
    if (tier === 'win' || tier === 'jackpot') this.hosts[1]?.cheer(tier === 'jackpot');
  }

  override destroy(): void {
    this.refTalk.clear();
    this.cheerTalk.clear();
    super.destroy();
  }
}

/** 판 시각 t의 밧줄 가운데 c. */
function c2s(play: Extract<GroupPlay, { kind: 'tug' }>, t: number): number {
  return trackAt(play.tracks[0] ?? [], t);
}
