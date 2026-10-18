// 밀어내기 대결장(씨름장) 확대 화면. 배경 closeup/bg_ssireum (모래 바닥, 뒤에 짚단 담) 위에 코드로 그린 모래판(밧줄 테두리·홍청 발자리).
// 선수 둘(자리 0 홍 = 왼쪽, 오른쪽을 봄 · 자리 1 청 = 오른쪽)이 지도와 같은 타임라인을 크게 재생한다:
//   미는 힘 p(t) (play.tracks[0], +1 = 홍이 청을 밀어냄)만큼 둘이 같이 밀리고, 앞으로 기울어 버티며 부들부들, 밀리는 발밑에 모래 먼지.
//   사건(play.events): lead = 해설 '홍 밀어붙여요!' · 그 편 구경 손님 들썩, brink = 밀리는 선수 땀·괴로움 · 해설 '버텨요!', flip = 뒤집기 시작 (불끈).
//   throwAt = 넘어뜨리기: 진 선수가 번쩍 들렸다가 슬픔 포즈로 벌러덩 (90° 눕혀 통통, 모래 먼지), 이긴 선수는 기쁨 포즈로 폴짝,
//   심판이 이긴 편 부채를 번쩍 들고 그쪽으로 기운다. 결과(sim roundFinished) 뒤 조금 있다 일어난다.
// 구경 손님 넷(자리 2~5, 홍·청에 건다): 뒤 왼쪽 둘·앞 오른쪽 둘, 자기 편이 앞서면 들썩·밀리면 부들부들, 넘어뜨리는 순간 다 같이 반응.
// 진행자: 심판(자리 0, 가운데 조금 왼쪽 뒤: 시작 때 부채 둘을 번쩍 '시작!', 끝에 이긴 편 부채), 해설자(자리 1, 오른쪽 뒤: 마이크 말풍선).
// 위쪽 가운데 힘 막대 (홍 ← → 청). 모이는 중 선수가 하나면 빈 발자리에 '도전자를 기다려요'.
// 빚 걸기 판 (넷째 묶음): 선수 둘이 채무자 (발밑 표 = 편 + 건 빚, 결과 글자는 GroupScene이 '빚 반으로!'·'상대 빚만큼 +N'), 표지는 힘 막대 아래 왼쪽.

import { Container, Graphics, Text } from 'pixi.js';
import { SIDES } from '../../data/defs.ts';
import { ease } from '../../core/tween.ts';
import type { SimApi } from '../../sim/api.ts';
import { trackAt } from '../../sim/group/core.ts';
import { duelCheer } from '../../sim/group/duel.ts';
import type { ActiveRound, GroupEntry, GroupEvent, GroupPlay, GroupState, MonsterId } from '../../sim/types.ts';
import type { HostActor } from './actor.ts';
import { clamp01, confetti, FONT, INK, lerp, span } from './fx.ts';
import { GroupScene, type GroupSeat, type GroupStage } from './group.ts';
import type { Layout } from './layout.ts';
import { emptySpot, paddleNode, placeHost, preloadGlyphs, puff, settle, sparkles, Talk, Timeline } from './ssireum_kit.ts';

/** closeup/bg_ssireum에서 잰 값 (배경 높이의 비율): 짚단 담 아래 끝 = 모래 바닥이 시작하는 선. */
const BG = { sand: 0.64 } as const;
/** 선수·구경 손님·진행자 배율 (확대 화면 손님 크기 대비). */
const S = { player: 0.8, back: 0.46, front: 0.5, referee: 0.66, caster: 0.7 } as const;
/**
 * characters/ssireum_referee 그림에서 잰 손 (부채 자루를 쥔 주먹)의 자리: 발(그림 아래 가운데)에서 캔버스 px.
 * 그림은 왼쪽을 보고, 빨강 부채가 그림 왼쪽 손, 파랑 부채가 오른쪽 손.
 */
const REF_HAND = [
  { x: -233, y: -351 },
  { x: 251, y: -305 },
] as const;

const SIDE_NAME = (s: number): string => SIDES[s]?.name ?? '';
const SIDE_COLOR = (s: number): number => SIDES[s]?.color ?? 0xffffff;

preloadGlyphs('홍청 선수 시작! 밀어붙여요! 되밀어요, 버텨요 버텨! 아슬아슬! 뒤집기다! 뒤집기 성공! 승! 막상막하! 도전자를 기다려요 대박! 이겼다! 아깝다!');

export class SsireumScene extends GroupScene {
  private readonly ring = new Graphics();
  private readonly bar = new Graphics();
  private readonly barLabels: Text[] = [];
  private readonly waitNote: Text;
  /** 빈 발자리 점선 (모이는 중 상대를 기다릴 때). */
  private readonly waitRing = new Graphics();
  private readonly paddles: Container[] = [];
  private readonly talk: Talk;
  private readonly tl = new Timeline();
  private readonly cx: number;
  private readonly reach: number;
  private readonly sandTop: number;
  private readonly band: number;
  /** 이번 판 넘어뜨리기 포즈를 준 손님 (판이 바뀌면 비운다). */
  private readonly posed = new Set<MonsterId>();
  private lastP = 0;
  private dustAcc = 0;

  constructor(sim: SimApi, w: number, h: number, onTap: (id: MonsterId) => void) {
    super(sim, 'ssireum', w, h, onTap);
    const L = this.L;
    this.cx = L.w / 2;
    this.sandTop = L.bg.y + BG.sand * L.bg.size;
    this.band = Math.max(20, Math.min(L.h, L.bg.y + L.bg.size) - this.sandTop);
    this.reach = Math.min(L.sw * 0.085, L.bodyH * 0.24);
    this.talk = new Talk(this.ui, this.anim, L);
    this.drawRing();
    this.stage.addChild(this.ring, this.waitRing);
    this.ui.addChild(this.bar);
    const fs = Math.max(11, L.sw * 0.036);
    for (let s = 0; s < 2; s++) {
      const t = new Text({ text: SIDE_NAME(s), style: { fontFamily: FONT, fontSize: fs, fill: 0xffffff, stroke: { color: INK, width: Math.max(3, fs * 0.22), join: 'round' } } });
      t.anchor.set(0.5);
      t.visible = false;
      this.ui.addChild(t);
      this.barLabels.push(t);
      const pd = paddleNode(SIDE_COLOR(s), SIDE_NAME(s), L.bodyH * 0.3);
      pd.visible = false;
      pd.zIndex = 33;
      this.root.addChild(pd);
      this.paddles.push(pd);
    }
    this.waitNote = new Text({ text: '도전자를\n기다려요', style: { fontFamily: FONT, fontSize: fs, fill: 0xffffff, align: 'center', stroke: { color: INK, width: Math.max(3, fs * 0.22), join: 'round' } } });
    this.waitNote.anchor.set(0.5, 1);
    this.waitNote.visible = false;
    this.waitNote.zIndex = 33;
    this.root.addChild(this.waitNote);
    this.update(0);
  }

  protected layout(L: Layout): GroupStage {
    const sandTop = L.bg.y + BG.sand * L.bg.size;
    const band = Math.max(20, Math.min(L.h, L.bg.y + L.bg.size) - sandTop);
    const cx = L.w / 2;
    const gap = L.bodyH * S.player * 0.36;
    const ringY = sandTop + band * 0.52;
    const backY = sandTop + band * 0.07;
    const frontY = L.h - band * 0.25;
    const X = (f: number): number => L.w * f;
    const seats: GroupSeat[] = [
      { x: cx - gap, y: ringY, scale: S.player, z: 34, face: -1 },
      { x: cx + gap, y: ringY, scale: S.player, z: 34.5, face: 1 },
      { x: X(0.075), y: backY, scale: S.back, z: 30, face: -1 },
      { x: X(0.2), y: backY + band * 0.02, scale: S.back, z: 30.5, face: -1 },
      // 앞 오른쪽 둘은 청 선수가 벌러덩 눕는 자리보다 바깥·아래로.
      { x: X(0.805), y: frontY + band * 0.04, scale: S.front, z: 38, face: 1 },
      { x: X(0.925), y: frontY, scale: S.front, z: 37.5, face: 1 },
    ];
    return {
      seats,
      hosts: [
        // 심판은 맞붙는 자리 바로 뒤가 아니라 조금 왼쪽 뒤에 (큰 선수에 가려지지 않게), 조금 작게.
        { x: cx - L.w * 0.13, y: sandTop + band * 0.05, face: -1 },
        { x: X(0.87), y: sandTop + band * 0.05, face: -1 },
      ],
    };
  }

  /** 빚 걸기 판 선수 표: 둘이 붙어 서 있어 가운데에서 바깥으로 펼친다 (홍 = 왼쪽, 청 = 오른쪽). */
  protected override debtBadgeAt(seat: number, fs: number): { x: number; y: number; align?: -1 | 0 | 1 } {
    const at = this.seatAt[seat];
    if (seat > 1 || at === undefined) return super.debtBadgeAt(seat, fs);
    return { x: this.cx + (seat === 0 ? -fs * 0.3 : fs * 0.3), y: at.y + fs * 1.3, align: seat === 0 ? -1 : 1 };
  }

  /** '빚 걸기 판' 표지: 위쪽 힘 막대·'홍' 글자 아래 왼쪽 (drawBar와 같은 높이 계산). */
  protected override signAt(_size: { w: number; h: number }): { x: number; y: number } {
    const L = this.L;
    const y0 = Math.max(8, L.h * 0.05);
    const bh = Math.max(10, L.sw * 0.032);
    return { x: 10, y: y0 + bh + 10 };
  }

  /** 선수가 하나면 빈 발자리에 '도전자를 기다려요'가 있으니 위 글은 비운다. */
  protected override waitText(g: GroupState): string {
    return g.participants.some((e) => e.seat < 2) ? '' : '선수를\n기다려요';
  }

  protected override pickText(e: GroupEntry): string | null {
    // 구경 손님은 자리가 붙어 있어 짧게 (편 이름만).
    return e.role === 'player' ? `${SIDE_NAME(e.pick)} 선수` : SIDE_NAME(e.pick);
  }

  /** 모래판: 조금 진한 모래 타원, 밧줄 테두리, 가운데 금, 홍·청 발자리. */
  private drawRing(): void {
    const L = this.L;
    const g = this.ring;
    const s0 = this.seatAt[0];
    const s1 = this.seatAt[1];
    if (s0 === undefined || s1 === undefined) return;
    const y = s0.y - this.band * 0.04;
    const rx = Math.min(L.w * 0.47, L.sw * 0.44);
    const ry = Math.min(this.band * 0.36, rx * 0.3);
    const rope = Math.max(4, L.sw * 0.016);
    g.ellipse(this.cx, y, rx, ry).fill({ color: 0xdcae72 });
    g.ellipse(this.cx, y, rx, ry).stroke({ color: INK, width: rope + 3 });
    g.ellipse(this.cx, y, rx, ry).stroke({ color: 0xc9935a, width: rope });
    // 밧줄 매듭 무늬
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      g.circle(this.cx + Math.cos(a) * rx, y + Math.sin(a) * ry, rope * 0.32).fill({ color: 0xa8743e });
    }
    g.moveTo(this.cx, y - ry * 0.55).lineTo(this.cx, y + ry * 0.55).stroke({ color: 0xfff3dc, width: Math.max(2, rope * 0.5), alpha: 0.85, cap: 'round' });
    for (const [i, s] of [s0, s1].entries()) {
      g.ellipse(s.x, s.y, L.bodyH * S.player * 0.32, L.bodyH * S.player * 0.1).fill({ color: SIDE_COLOR(i), alpha: 0.55 }).stroke({ color: INK, width: 2, alpha: 0.55 });
    }
  }

  protected drawPlay(play: GroupPlay | null, t: number, dt: number): void {
    const L = this.L;
    const ref = this.hosts[0] ?? null;
    const caster = this.hosts[1] ?? null;
    const h0 = this.hostAt[0];
    const h1 = this.hostAt[1];
    if (ref !== null && h0 !== undefined) placeHost(ref, L, h0.x, h0.y, S.referee, h0.face);
    if (caster !== null && h1 !== undefined) placeHost(caster, L, h1.x, h1.y, S.caster, h1.face);
    this.talk.update(this.time);
    for (const pd of this.paddles) pd.visible = false;
    const fresh = this.tl.sync(play, t);
    if (fresh) {
      this.posed.clear();
      this.lastP = Number.NaN;
    }
    if (play === null || play.kind !== 'ssireum') {
      this.drawBar(null);
      this.drawIdle();
      return;
    }
    this.waitNote.visible = false;
    this.waitRing.clear();
    const p = trackAt(play.tracks[0] ?? [], t);
    const dp = dt > 0 && Number.isFinite(this.lastP) ? (p - this.lastP) / dt : 0;
    this.lastP = p;
    this.drawBar(p);
    for (const ev of this.tl.due(t)) this.onEvent(play, ev);
    if (t < 1.2 && this.tl.once('start')) {
      this.talk.say(ref ?? caster, '시작!', 1, this.time);
      ref?.cheer(false);
    }
    const after = t - play.throwAt;
    // 일어나기: 결과가 나고 조금 뒤 (done 단계 끝 무렵).
    const up = span(t, play.end + 2.2, play.end + 2.9);
    this.drawPlayers(play, p, dp, t, after, up, dt);
    this.drawBettors(play, p, after);
    this.drawReferee(ref, play, p, t, after, up);
    if (caster !== null && this.talk.busy(this.time)) caster.rig.rot = Math.sin(this.time * 10) * 0.03;
    if (after >= 0 && this.tl.once('throw')) this.onThrow(play, p);
  }

  /** 쉬거나 모이는 중: 선수는 발자리에서 들썩, 상대가 없으면 빈 발자리에 '도전자를 기다려요'. */
  private drawIdle(): void {
    const g = this.group;
    const gathering = g !== null && g.phase === 'gathering';
    let missing = -1;
    for (let seat = 0; seat < 2; seat++) {
      const a = this.actor(seat);
      if (a !== null) {
        a.eager = gathering ? 0.6 : 0.2;
        // 준비 자세: 살짝 웅크리고 상대 쪽으로.
        const fwd = seat === 0 ? 1 : -1;
        this.move(a, 0, 0, fwd * 0.06);
        a.rig.sy = 0.97;
      } else if (gathering) missing = seat;
    }
    for (let seat = 2; seat < 6; seat++) {
      const a = this.actor(seat);
      if (a !== null && gathering) a.eager = 0.25;
    }
    const s = this.seatAt[missing];
    const other = this.actor(missing === 0 ? 1 : 0);
    const show = missing >= 0 && s !== undefined && other !== null;
    this.waitNote.visible = show;
    this.waitRing.clear();
    if (show && s !== undefined) emptySpot(this.waitRing, s.x, s.y, this.L.bodyH * S.player * (0.34 + Math.sin(this.time * 4) * 0.02), 0xfff6e6);
    if (show && s !== undefined) {
      this.waitNote.position.set(s.x, s.y - this.L.bodyH * S.player * 0.25);
      this.waitNote.alpha = 0.75 + Math.sin(this.time * 3) * 0.25;
    }
  }

  /** 위쪽 가운데 힘 막대 (p = null이면 숨김). */
  private drawBar(p: number | null): void {
    const g = this.bar.clear();
    for (const t of this.barLabels) t.visible = p !== null;
    if (p === null) return;
    const L = this.L;
    const bw = Math.min(L.sw * 0.5, L.w * 0.5);
    const bh = Math.max(10, L.sw * 0.032);
    const x0 = this.cx - bw / 2;
    const y0 = Math.max(8, L.h * 0.05);
    const k = 0.5 + p * 0.5;
    g.roundRect(x0, y0, bw, bh, bh / 2).fill({ color: SIDE_COLOR(1) });
    if (k > 0.02) g.roundRect(x0, y0, Math.max(bh, bw * k), bh, bh / 2).fill({ color: SIDE_COLOR(0) });
    g.roundRect(x0, y0, bw, bh, bh / 2).stroke({ color: INK, width: 2.5 });
    g.moveTo(this.cx, y0 - 3).lineTo(this.cx, y0 + bh + 3).stroke({ color: INK, width: 2, alpha: 0.6 });
    const danger = Math.abs(p) > 0.75;
    const r = bh * (danger ? 0.85 + Math.abs(Math.sin(this.time * 12)) * 0.15 : 0.8);
    g.circle(x0 + bw * k, y0 + bh / 2, r).fill({ color: danger ? 0xffe08a : 0xfff6e6 }).stroke({ color: INK, width: 2.5 });
    const [lt, rt] = this.barLabels;
    lt?.position.set(x0 - bh * 1.1, y0 + bh / 2);
    rt?.position.set(x0 + bw + bh * 1.1, y0 + bh / 2);
  }

  /** 선수 둘: 밀고 밀리기 → 넘어뜨리기 (진 선수 벌러덩, 이긴 선수 폴짝) → 일어나기. */
  private drawPlayers(play: Extract<GroupPlay, { kind: 'ssireum' }>, p: number, dp: number, t: number, after: number, up: number, dt: number): void {
    const L = this.L;
    const push = p * this.reach;
    const effort = clamp01(Math.abs(dp) * 0.8 + 0.35);
    for (let seat = 0; seat < 2; seat++) {
      const a = this.actor(seat);
      if (a === null) continue;
      const fwd = seat === 0 ? 1 : -1;
      const won = play.winner === seat;
      const H = L.bodyH * S.player;
      if (after < 0) {
        // 밀고 밀린다: 앞으로 기울어 버티며 부들부들. 넘어뜨리기 직전 0.25초는 이긴 쪽이 번쩍 든다.
        const lift = span(t, play.throwAt - 0.25, play.throwAt);
        const quiver = Math.sin(this.time * 38 + seat * 2) * H * 0.012 * effort;
        let rot = fwd * (0.16 + 0.12 * Math.abs(p));
        let dy = 0;
        if (won) rot += fwd * 0.12 * lift;
        else {
          rot -= fwd * 0.3 * lift;
          dy = -H * 0.12 * Math.sin(lift * Math.PI * 0.5);
        }
        this.move(a, push + quiver, dy, rot);
        continue;
      }
      if (!this.posed.has(a.id)) {
        this.posed.add(a.id);
        a.showPose(won ? 'joy' : 'sad', Math.max(1, play.end - t + 2.4));
      }
      if (won) {
        const hop = Math.abs(Math.sin(after * 7)) * H * 0.12 * Math.max(0, 1 - after / 2.2);
        this.move(a, push * (1 - up), -hop, 0);
      } else {
        // 벌러덩: 뒤로(바깥쪽) 90° 눕고 통통. 발이 아니라 몸 가운데를 축으로 눕혀 (몸이 바깥으로 멀리 날아가지 않게) 조금만 밀려난다.
        const fall = ease.outQuad(clamp01(after / 0.32)) * (1 - up);
        const th = (Math.PI / 2) * fall;
        const land = after > 0.32 ? Math.abs(Math.sin((after - 0.32) * 9)) * H * 0.06 * Math.max(0, 1 - (after - 0.32) / 1.2) : 0;
        const c = H * 0.45;
        const dx = fwd * c * Math.sin(th);
        const dy = c * (1 - Math.cos(th)) - H * 0.38 * Math.sin(th) - land;
        this.move(a, push * (1 - up) + dx, dy, -fwd * th);
      }
    }
    // 밀리는 쪽(p > 0이면 청) 발밑 모래 먼지 (세게 밀릴 때).
    if (after < 0 && Math.abs(dp) > 0.25) {
      this.dustAcc += dt;
      if (this.dustAcc > 0.28) {
        this.dustAcc = 0;
        const loser = p > 0 ? 1 : 0;
        const a = this.actor(loser);
        if (a !== null) puff(this.fx, this.anim, a.root.x + a.rig.dx * a.root.scale.x, a.root.y, L.sw * 0.06, 2, 0.8);
      }
    }
  }

  /** 구경 손님: 자기 편이 앞서면 들썩, 크게 밀리면 부들부들, 넘어뜨린 뒤엔 포즈. */
  private drawBettors(play: Extract<GroupPlay, { kind: 'ssireum' }>, p: number, after: number): void {
    const g = this.group;
    if (g === null) return;
    for (const e of g.participants) {
      if (e.role !== 'bettor') continue;
      const a = this.actor(e.seat);
      if (a === null) continue;
      const adv = p * (e.pick === 0 ? 1 : -1);
      if (after < 0) {
        a.eager = clamp01(adv * 1.6);
        const lean = (this.seatAt[e.seat]?.face ?? 1) === -1 ? 1 : -1;
        if (adv < -0.55) this.move(a, Math.sin(this.time * 40 + e.seat) * this.L.bodyH * 0.006, 0, lean * 0.05);
        else this.move(a, 0, 0, lean * 0.08 * clamp01(Math.abs(p) * 1.5));
        continue;
      }
      if (!this.posed.has(a.id)) {
        this.posed.add(a.id);
        const won = e.pick === play.winner;
        a.showPose(won ? 'joy' : play.close ? 'agony' : 'sad', 1.6);
        a.playMotion(won ? (play.flip ? 'bigHop' : 'hop') : play.close ? 'tremble' : 'slump', 1, 1.4);
        if (won && play.flip) a.emote('sparkle', 1);
      }
    }
  }

  /** 심판: 시작 때 부채 둘을 번쩍, 판 중엔 힘 쪽을 따라 살짝 기울고, 넘어뜨리면 이긴 편 부채를 높이 들고 그쪽으로. */
  private drawReferee(ref: HostActor | null, play: Extract<GroupPlay, { kind: 'ssireum' }>, p: number, t: number, after: number, up: number): void {
    if (ref === null) return;
    const L = this.L;
    const k = ref.k * Math.abs(ref.root.scale.y);
    // 그림을 뒤집지 않았으면(얼굴이 왼쪽) 손 x 그대로.
    const flip = ref.root.scale.x < 0 ? 1 : -1;
    const hand = (i: number): { x: number; y: number } => {
      const h = REF_HAND[i] ?? REF_HAND[0];
      return { x: ref.root.x + h.x * k * flip, y: ref.root.y + h.y * k };
    };
    const raise = (i: number, u: number, high: number): void => {
      const pd = this.paddles[i];
      if (pd === undefined || u <= 0) return;
      const hp = hand(i);
      const out = (i === 0 ? -1 : 1) * flip;
      pd.visible = true;
      pd.alpha = Math.min(1, u * 3);
      pd.position.set(hp.x, hp.y - L.bodyH * high * u);
      pd.rotation = out * lerp(2.2, 0.3, ease.outBack(clamp01(u)));
      pd.scale.set(0.7 + 0.3 * clamp01(u));
    };
    if (after < 0) {
      // 시작 신호 (0~1.2초)
      const u = span(t, 0, 0.3) * (1 - span(t, 1.0, 1.3));
      raise(0, u, 0.05);
      raise(1, u, 0.05);
      ref.rig.rot = p * 0.05 * flip;
      return;
    }
    const w = play.winner;
    const u = span(after, 0, 0.25) * (1 - up);
    raise(w, u, 0.12);
    ref.rig.rot = (w === 0 ? -1 : 1) * 0.12 * u * flip;
  }

  private onEvent(play: Extract<GroupPlay, { kind: 'ssireum' }>, ev: GroupEvent): void {
    const caster = this.hosts[1] ?? null;
    const ref = this.hosts[0] ?? null;
    const voice = caster ?? ref;
    // 구경 손님 응원 (sim duelCheer와 같은 규칙).
    const g = this.group;
    if (g !== null && ev.type !== 'finish') {
      for (const e of g.participants) {
        const a = this.actor(e.seat);
        if (a === null) continue;
        const c = duelCheer(e.pick, ev);
        if (c === 'lead' && e.role === 'bettor') a.playMotion('hop', 0.7, 0.6);
        if (c === 'behind' && ev.type === 'brink') a.emote('sweat', e.role === 'player' ? 1 : 0.8);
      }
    }
    switch (ev.type) {
      case 'lead':
        if (!this.talk.busy(this.time)) this.talk.say(voice, ev.prev === -1 ? `${SIDE_NAME(ev.actor)} 밀어붙여요!` : `${SIDE_NAME(ev.actor)}, 되밀어요!`, 1.1, this.time);
        break;
      case 'brink': {
        const a = this.actor(ev.actor);
        a?.showPose('agony', 0.8);
        this.talk.say(voice, play.flip && ev.actor === play.winner ? '버텨요, 버텨!' : '아슬아슬!', 1.1, this.time);
        break;
      }
      case 'flip': {
        const a = this.actor(ev.actor);
        a?.emote('anger', 1);
        this.talk.say(voice, '뒤집기다!', 1.2, this.time);
        break;
      }
      default:
        break;
    }
  }

  /** 넘어뜨리는 순간: 먼지, 반짝이, 심판 폴짝, 해설. */
  private onThrow(play: Extract<GroupPlay, { kind: 'ssireum' }>, p: number): void {
    const L = this.L;
    const loser = play.winner === 0 ? 1 : 0;
    const s = this.seatAt[loser];
    if (s !== undefined) {
      const fwd = loser === 0 ? 1 : -1;
      const x = s.x + p * this.reach - fwd * L.bodyH * S.player * 0.15;
      puff(this.fx, this.anim, x, s.y, L.sw * 0.08, 5, 1.1);
    }
    const ws = this.seatAt[play.winner];
    if (play.flip && ws !== undefined) sparkles(this.fx, this.anim, ws.x + p * this.reach, ws.y - L.bodyH * S.player * 0.6, L.sw * 0.06, 8, L.sw * 0.14);
    this.hosts[0]?.cheer(play.flip);
    const name = SIDE_NAME(play.winner);
    this.talk.say(this.hosts[1] ?? this.hosts[0] ?? null, play.flip ? '뒤집기 성공!' : play.close ? `${name} 승! 막상막하!` : `${name} 승!`, 1.8, this.time);
  }

  override onRoundFinished(seat: number, round: ActiveRound, payout: number): void {
    // 글자는 꽝을 빼고 (진 선수는 벌러덩으로 보인다), 선수는 크게·구경 손님은 작게. 코인은 항아리에서.
    const a = this.actor(seat);
    if (a === null) return;
    const tier = round.outcome.tier;
    const L = this.L;
    // 벌러덩 누운 선수는 누운 몸 위에.
    const play = this.play;
    const lying = seat < 2 && play !== null && play.kind === 'ssireum' && play.winner !== seat;
    const at = lying ? { x: a.root.x + a.rig.dx * a.root.scale.x, y: a.root.y - L.bodyH * S.player * 0.75 } : undefined;
    // 빚 걸기 판의 채무자 선수는 '이겼다!' 대신 빚 결과 글자 (GroupScene).
    const debtor = this.entryAt(seat)?.debt !== undefined;
    settle(a, tier, payout, this.time, { ui: this.ui, fx: this.fx, anim: this.anim, L }, seat < 2 ? Math.max(16, L.sw * 0.06) : Math.max(13, L.sw * 0.045), !debtor, at);
    if (payout > 0) this.shakePot();
    if (tier === 'jackpot' && this.tl.once('confetti')) confetti(this.fx, this.anim, L.w, L.h, 40);
    if (tier === 'jackpot' || tier === 'win') for (const h of this.hosts) h?.cheer(tier === 'jackpot');
  }

  override destroy(): void {
    this.talk.clear();
    super.destroy();
  }
}
