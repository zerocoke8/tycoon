// 부스 하나의 확대 장면 (패널 px, (0,0) = 패널 왼쪽 위). 패널 크기가 바뀌면 새로 짓는다.
// 매 프레임 sim.state를 읽어 출연진(진행자·자리의 손님)과 진행 중인 한판을 맞추고,
// sim 이벤트(한판 시작·끝, 반응)로 연출한다. 이벤트를 놓쳐도(몰아서 계산) 상태만으로 맞는 모습이 된다.

import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { type BoothId, type OutcomeTier, SPECIES_IDS } from '../../data/defs.ts';
import { ease } from '../../core/tween.ts';
import type { SimApi } from '../../sim/api.ts';
import type { ActiveRound, BoothState, MonsterId, Reaction } from '../../sim/types.ts';
import { artMeta, artSprite, artTexture, hasArt } from '../art.ts';
import { DEFAULT_REACTION, HostActor, MonsterActor, neutralPose } from './actor.ts';
import { Anim, confetti, coinNode, dismiss, FONT, floatText, flyCoins, INK, popCaption } from './fx.ts';
import { AWNING_LINE, computeLayout, FLOOR_COLOR, type Layout, WALL_COLOR } from './layout.ts';
import type { CloseupScene } from './registry.ts';
import type { Play, Rig, RigCtx } from './rig.ts';

const CAPTION: Record<OutcomeTier, { text: string; color: number }> = {
  jackpot: { text: '대박!', color: 0xffc83d },
  win: { text: '맞았다!', color: 0x9ad66f },
  nearMiss: { text: '아깝다!', color: 0xff9a5c },
  lose: { text: '꽝…', color: 0xc3cbd8 },
};

/** 끝난 한판의 결과를 이만큼 보여 준 뒤 다른 자리의 한판으로 장치를 넘긴다 (초). */
const RESULT_HOLD = 0.9;
/** 손님·진행자 그림이 패널 가장자리에서 떨어지는 여유 (패널 px). */
const EDGE_MARGIN = 6;
const POSES = ['base', 'joy', 'agony', 'sad'] as const;

/** 손님 그림이 발(캔버스 x 512)에서 오른쪽으로 뻗는 가장 먼 길이 (캔버스 px, 모든 포즈 중). 왼쪽을 보는 그림이라 오른쪽은 꼬리·등. */
function rightReach(species: string): number {
  let r = 0;
  for (const p of POSES) {
    const m = artMeta('monsters', `${species}_${p}`);
    if (m !== undefined && hasArt('monsters', `${species}_${p}`)) r = Math.max(r, m.trim.x + m.trim.w - 512);
  }
  return r > 0 ? r : 240;
}

/** 손님 그림이 발에서 왼쪽(얼굴·앞발 쪽)으로 뻗는 가장 먼 길이 (캔버스 px, 모든 포즈 중). */
function leftReach(species: string): number {
  let r = 0;
  for (const p of POSES) {
    const m = artMeta('monsters', `${species}_${p}`);
    if (m !== undefined && hasArt('monsters', `${species}_${p}`)) r = Math.max(r, 512 - m.trim.x);
  }
  return r > 0 ? r : 240;
}

function sameRound(a: ActiveRound, b: ActiveRound): boolean {
  return a === b || (a.monster === b.monster && a.bet === b.bet && a.duration === b.duration && JSON.stringify(a.outcome) === JSON.stringify(b.outcome));
}

/** 보통 부스(진행자 하나, 자리 1~2)의 확대 장면. 부스마다의 장치(Rig)는 registry.ts가 정해 준다. */
export class BoothScene implements CloseupScene {
  readonly booth: BoothId;
  readonly root = new Container();
  readonly seatCount: number;
  readonly unlocked: boolean;
  /** 지을 때 배경 그림이 있었나 (없었으면 자리 표시로 그렸다: 그림이 오면 다시 짓는다). */
  private readonly bgReady: boolean;
  private readonly sim: SimApi;
  private readonly L: Layout;
  private readonly anim = new Anim();
  private readonly front = new Container();
  private readonly fx = new Container();
  private readonly ui = new Container();
  private readonly rig: Rig;
  private host: HostActor | null = null;
  private readonly actors: (MonsterActor | null)[] = [null, null];
  private readonly plays: (Play | null)[] = [null, null];
  /** 시뮬레이션 elapsed를 마지막으로 본 값 (자리마다): 움직일 때만 시계를 맞춘다. */
  private readonly simElapsed: number[] = [-1, -1];
  private focus: number | null = null;
  private time = 0;
  /** 지금 떠 있는 큰 결과 글자 (다음 한판이 시작되면 치운다). */
  private caption: Text | null = null;
  private readonly pot: Container;
  private readonly potLabel: Text;
  private readonly potH: number;
  private potShown = -1;
  private readonly queueBadge = new Container();
  private readonly queueBg = new Graphics();
  private readonly queueText: Text;
  private queueShown = -1;
  private readonly note: Text;
  private readonly onTap: (id: MonsterId) => void;

  constructor(sim: SimApi, booth: BoothId, w: number, h: number, onTap: (id: MonsterId) => void, makeRig: (ctx: RigCtx) => Rig) {
    this.sim = sim;
    this.booth = booth;
    this.onTap = onTap;
    const bs = sim.state.booths[booth];
    this.seatCount = Math.min(2, bs.seats.length);
    this.unlocked = bs.unlocked;
    const L = computeLayout(booth, w, h, this.seatCount);
    this.L = L;
    this.root.sortableChildren = true;

    // 배경 (그림이 아직 없으면 자리 표시: needsRebuild가 그림이 오면 다시 짓게 한다)
    this.bgReady = hasArt('closeup', `bg_${booth}`);
    if (this.bgReady) {
      const bg = artSprite('closeup', `bg_${booth}`, { k: L.bg.size / 1024, anchor: 'center' });
      bg.position.set(L.bg.x + L.bg.size / 2, L.bg.y + L.bg.size / 2);
      bg.zIndex = 0;
      this.root.addChild(bg);
    } else {
      const g = new Graphics().rect(0, 0, w, h).fill({ color: WALL_COLOR[booth] });
      g.rect(0, L.floorY, w, h - L.floorY).fill({ color: FLOOR_COLOR });
      g.moveTo(0, L.floorY).lineTo(w, L.floorY).stroke({ color: INK, width: 3 });
      for (let i = 1; i < 3; i++) {
        const y = L.floorY + ((h - L.floorY) * i) / 3;
        g.moveTo(0, y).lineTo(w, y).stroke({ color: 0x9a6a3e, width: 2 });
      }
      // 차양
      const n = 7;
      const cw = w / n;
      for (let i = 0; i < n; i++) {
        g.rect(i * cw, 0, cw, h * 0.06).fill({ color: i % 2 === 0 ? 0xf3a76a : 0xfbefdc });
        g.circle(i * cw + cw / 2, h * 0.06, cw / 2).fill({ color: i % 2 === 0 ? 0xf3a76a : 0xfbefdc }).stroke({ color: INK, width: 2 });
      }
      g.zIndex = 0;
      this.root.addChild(g);
    }
    // 넓적한 패널은 바닥이 보이게 배경 위를 자른다: 그러면 차양이 끄트머리만 남으니 차양 띠를 패널 위에 따로 붙인다
    // (차양 아래는 민무늬 벽이라 이음매가 보이지 않는다).
    const bgTex = artTexture('closeup', `bg_${booth}`);
    const band = bgTex === undefined ? 0 : Math.round(bgTex.frame.height * AWNING_LINE[booth]);
    if (bgTex !== undefined && L.bg.y < -1 && band >= 2) {
      const strip = new Sprite(new Texture({ source: bgTex.source, frame: new Rectangle(bgTex.frame.x, bgTex.frame.y, bgTex.frame.width, band) }));
      strip.scale.set(L.bg.size / bgTex.frame.width);
      strip.position.set(L.bg.x, 0);
      strip.zIndex = 1;
      this.root.addChild(strip);
    }

    // 장치
    const ctx: RigCtx = {
      L,
      anim: this.anim,
      actor: (seat) => {
        const a = this.actors[seat];
        return a === null || a === undefined || a.leaving ? null : a;
      },
      host: () => this.host,
      front: this.front,
      plushPool: () => {
        const dex = this.sim.state.dex;
        return SPECIES_IDS.filter((s) => (dex[s]?.visits ?? 0) > 0);
      },
    };
    this.rig = makeRig(ctx);
    // 닫힌 부스: 장치를 흐리게 (투명하게 하면 컵 속 구슬이 비친다).
    if (!this.unlocked) this.rig.root.tint = 0xb3aaa2;
    this.root.addChild(this.rig.root);

    // 상금 항아리 (앞, 왼쪽 아래)와 항아리 코인 수
    const kPot = L.pot.w / 668;
    this.potH = 617 * kPot;
    this.pot = artSprite('objects', 'prize_pot', { k: kPot, anchor: 'bottom', placeholder: { w: 668, h: 617, color: 0xc98a4f } });
    this.pot.position.set(L.pot.x, L.pot.y);
    this.pot.zIndex = 40;
    const potFont = Math.max(12, L.pot.w * 0.24);
    this.potLabel = new Text({ text: '', style: { fontFamily: FONT, fontSize: potFont, fill: 0xffffff, stroke: { color: INK, width: Math.max(3, potFont * 0.22), join: 'round' } } });
    this.potLabel.anchor.set(0.5);
    this.potLabel.position.set(0, -this.potH * 0.36);
    this.pot.addChild(this.potLabel);
    this.root.addChild(this.pot);

    this.front.zIndex = 45;
    this.fx.zIndex = 50;
    this.ui.zIndex = 60;
    this.root.addChild(this.front, this.fx, this.ui);

    // 줄 수 (오른쪽 위 작은 표)
    const qFont = Math.max(12, L.sw * 0.042);
    this.queueText = new Text({ text: '', style: { fontFamily: FONT, fontSize: qFont, fill: INK } });
    this.queueText.anchor.set(1, 0.5);
    this.queueBadge.addChild(this.queueBg, this.queueText);
    this.queueBadge.position.set(w - Math.max(10, w * 0.03), Math.max(16, h * 0.045) + qFont * 0.5);
    this.ui.addChild(this.queueBadge);

    // 안내 글자 (닫힌 부스·진행자 없음)
    const nFont = Math.max(14, L.sw * 0.05);
    this.note = new Text({ text: '', style: { fontFamily: FONT, fontSize: nFont, fill: 0xffffff, stroke: { color: INK, width: Math.max(3, nFont * 0.2), join: 'round' }, align: 'center' } });
    this.note.anchor.set(0.5);
    this.note.position.set(w / 2, L.caption.y + L.caption.size);
    this.ui.addChild(this.note);

    // 처음 모습을 바로 맞춘다 (한판 중에 열어도).
    this.update(0);
  }

  private get state(): BoothState {
    return this.sim.state.booths[this.booth];
  }

  /** 자리 수·열림이 바뀌거나, 자리 표시로 그린 배경의 그림이 늦게 왔으면 다시 지어야 한다 (차양 띠도 그림에서 잘라 쓴다). */
  needsRebuild(): boolean {
    const bs = this.state;
    return Math.min(2, bs.seats.length) !== this.seatCount || bs.unlocked !== this.unlocked || (!this.bgReady && hasArt('closeup', `bg_${this.booth}`));
  }

  hasMonster(id: MonsterId): boolean {
    return this.actors.some((a) => a !== null && a.id === id && !a.leaving);
  }

  private actorOf(id: MonsterId): MonsterActor | null {
    return this.actors.find((a): a is MonsterActor => a !== null && a.id === id && !a.leaving) ?? null;
  }

  // ── 매 프레임 ───────────────────────────────────────────────────────────

  update(dt: number): void {
    this.time += dt;
    const bs = this.state;
    this.syncHost(bs);
    this.syncCast(bs);
    this.syncPlays(bs, dt);

    for (const a of this.actors) {
      if (a === null) continue;
      neutralPose(a.rig);
      a.eager = 0;
    }
    const fp = this.focus === null ? null : (this.plays[this.focus] ?? null);
    if (fp !== null && !fp.done) this.rig.render(fp);
    else this.rig.idle(dt, this.time);
    this.plays.forEach((p, i) => {
      const a = this.actors[i];
      if (p !== null && !p.done && i !== this.focus && a !== null && a !== undefined) a.eager = 1;
    });

    for (const a of this.actors) {
      if (a === null) continue;
      a.update(dt, this.time);
      // 반응 이벤트가 오지 않으면 기본 반응
      if (a.expect !== null && this.time >= a.expect.at) {
        const tier = a.expect.tier;
        a.expect = null;
        if (this.time - a.lastReact > 0.6) a.react(DEFAULT_REACTION[tier], this.time);
      }
    }
    this.host?.update(this.time);
    this.syncLabels(bs);
  }

  private syncHost(bs: BoothState): void {
    const id = bs.staff[0] ?? null;
    const staff = id === null ? undefined : this.sim.state.staff.find((s) => s.id === id);
    if (staff === undefined) {
      if (this.host !== null) {
        this.host.destroy();
        this.host = null;
      }
      return;
    }
    if (this.host === null) {
      this.host = new HostActor(staff.art, this.L.kHost, this.anim);
      this.host.root.zIndex = 10;
      this.root.addChild(this.host.root);
    } else this.host.setArt(staff.art);
    // 그림 폭은 진행자마다 다르다: 머리·머리카락이 패널 왼쪽 끝에 잘리지 않게.
    this.host.root.position.set(Math.max(this.L.host.x, EDGE_MARGIN + this.host.halfW), this.L.host.y);
  }

  private syncCast(bs: BoothState): void {
    for (let i = 0; i < 2; i++) {
      const want = i < this.seatCount ? (bs.seats[i] ?? null) : null;
      const cur = this.actors[i] ?? null;
      if (cur !== null && cur.id === want) continue;
      if (cur !== null) {
        // 결과 반응을 보여 주는 동안은 자리가 비어도 남는다.
        const keep = want === null && this.sim.monster(cur.id) !== undefined && this.time < cur.holdUntil;
        if (keep) continue;
        cur.leave(this.L.sw * 0.4);
        this.actors[i] = null;
      }
      if (want === null) continue;
      const m = this.sim.monster(want);
      const seat = this.L.seats[i];
      if (m === undefined || seat === undefined) continue;
      const a = new MonsterActor(m.id, m.species, this.L.kMon, this.L.bodyH, this.anim, (id) => this.onTap(id));
      // 종마다 그림이 오른쪽(꼬리·등)으로 뻗는 길이가 다르다: 패널 밖으로 나가지 않게 왼쪽으로 당긴다.
      const kS = this.L.kMon * seat.scale;
      const maxX = this.L.w - EDGE_MARGIN - rightReach(m.species) * kS;
      // 장치가 막는 선이 있으면 (고리 던지기 선반) 몸이 그 앞을 가리지 않게 오른쪽으로 (패널 끝이 먼저).
      const minX = this.rig.guardRight === undefined ? -Infinity : this.rig.guardRight + leftReach(m.species) * kS;
      a.root.position.set(Math.min(Math.max(seat.x, minX), maxX), seat.y);
      a.root.scale.set(seat.scale);
      a.root.zIndex = seat.z;
      this.root.addChild(a.root);
      this.actors[i] = a;
      if (this.time > 0) a.enter(this.L.sw * 0.35);
      if (m.pose !== 'base' && m.phase === 'reacting') a.showPose(m.pose, m.timer);
    }
  }

  private syncPlays(bs: BoothState, dt: number): void {
    for (let i = 0; i < 2; i++) {
      const r = bs.rounds[i] ?? null;
      const p = this.plays[i] ?? null;
      if (p !== null && !p.done) {
        if (r === null || !sameRound(p.round, r)) {
          // 이벤트 없이 끝났다 (몰아서 계산 등): 끝난 모습으로만.
          this.endPlay(i, p);
        } else {
          p.t += dt;
          // 시뮬레이션 시계가 움직이면 거기에 맞춘다 (틱 단위라 조금의 차이는 둔다).
          if (r.elapsed !== this.simElapsed[i]) {
            this.simElapsed[i] = r.elapsed;
            if (Math.abs(p.t - r.elapsed) > 0.3) p.t = r.elapsed;
          }
        }
      }
      const now = this.plays[i] ?? null;
      if (r !== null && r.elapsed < r.duration && (now === null || (now.done && !sameRound(now.round, r)))) this.startPlay(i, r);
    }
    // 장치를 맡을 한판 고르기
    if (this.focus !== null) {
      const fp = this.plays[this.focus] ?? null;
      const other = this.plays.some((p, i) => p !== null && !p.done && i !== this.focus);
      if (fp === null || (fp.done && other && this.time - fp.doneAt > RESULT_HOLD)) this.focus = null;
    }
    if (this.focus === null) {
      const i = this.plays.findIndex((p) => p !== null && !p.done);
      const p = this.plays[i];
      if (i >= 0 && p !== null && p !== undefined) {
        this.focus = i;
        this.rig.begin(p);
      }
    }
  }

  private startPlay(seat: number, r: ActiveRound): void {
    const p: Play = { seat, round: r, t: Math.max(0, r.elapsed), D: r.duration > 0.5 ? r.duration : 3, done: false, doneAt: 0 };
    this.plays[seat] = p;
    this.simElapsed[seat] = r.elapsed;
    const fp = this.focus === null ? null : (this.plays[this.focus] ?? null);
    if (this.focus === seat || fp === null || (fp.done && this.time - fp.doneAt > RESULT_HOLD)) {
      this.focus = seat;
      this.rig.begin(p);
      if (this.caption !== null) dismiss(this.anim, this.caption);
      this.caption = null;
    }
  }

  private endPlay(seat: number, p: Play): void {
    p.done = true;
    p.doneAt = this.time;
    if (this.focus === seat) this.rig.finish(p);
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
    const note = !bs.unlocked ? '아직 열지 않은 놀이부스' : this.host === null ? '진행자가 없어요' : '';
    if (this.note.text !== note) this.note.text = note;
  }

  // ── sim 이벤트 ─────────────────────────────────────────────────────────

  onRoundStarted(seat: number, round: ActiveRound): void {
    const p = this.plays[seat] ?? null;
    if (p !== null && !p.done && sameRound(p.round, round)) return;
    if (p !== null && !p.done) this.endPlay(seat, p);
    this.startPlay(seat, round);
  }

  onRoundFinished(seat: number, round: ActiveRound, payout: number): void {
    const p = this.plays[seat] ?? null;
    const wasFocus = this.focus === seat || this.focus === null;
    if (p !== null && !p.done) this.endPlay(seat, p);
    this.showResult(seat, round, payout, wasFocus);
  }

  private showResult(seat: number, round: ActiveRound, payout: number, big: boolean): void {
    const L = this.L;
    const tier = round.outcome.tier;
    const a = this.actors[seat] ?? null;
    const cap = CAPTION[tier];
    if (big) {
      if (this.caption !== null) dismiss(this.anim, this.caption);
      this.caption = popCaption(this.ui, this.anim, cap.text, L.caption.x, L.caption.y, L.caption.size, cap.color);
      this.rig.celebrate(tier);
    } else if (a !== null) {
      const s = a.root.scale.x;
      popCaption(this.ui, this.anim, cap.text, a.root.x, a.root.y + (a.headY - L.bodyH * 0.25) * s, L.caption.size * 0.6, cap.color);
    }
    if (payout > 0) {
      const from = { x: L.pot.x, y: L.pot.y - this.potH * 0.85 };
      const s = a?.root.scale.x ?? 1;
      const to = a !== null ? { x: a.root.x - L.bodyH * 0.05 * s, y: a.root.y - L.bodyH * 0.45 * s } : { x: L.sx + L.sw * 0.8, y: L.feetY - L.bodyH * 0.5 };
      // 복주머니 '동전 하나뿐'은 동전 한 닢만 날아간다 (아깝다 농담이 살게).
      const d = round.outcome.detail;
      const n = d.kind === 'pouch' && d.content === 'one' ? 1 : Math.max(3, Math.min(16, Math.round(3 + payout / 4)));
      const headY = a !== null ? a.root.y + a.headY * s : to.y - L.bodyH * 0.5;
      flyCoins(this.fx, this.anim, from, to, n, L.sw * 0.055, () => {
        floatText(this.fx, this.anim, `+${payout}`, to.x, headY - L.bodyH * 0.1, Math.max(18, L.sw * 0.07));
      });
      this.shakePot();
    }
    if (tier === 'jackpot') confetti(this.fx, this.anim, L.w, L.h, 50);
    if (tier === 'jackpot' || tier === 'win') this.host?.cheer(tier === 'jackpot');
    else if (tier === 'nearMiss') this.host?.flinch();
    if (a !== null) {
      a.holdUntil = this.time + 2.2;
      if (this.time - a.lastReact > 0.6) a.expect = { tier, at: this.time + 0.35 };
    }
  }

  private shakePot(): void {
    const pot = this.pot;
    void this.anim.run(0.55, (t) => {
      pot.rotation = Math.sin(t * Math.PI * 8) * 0.09 * (1 - t);
      pot.scale.set(1 + Math.sin(t * Math.PI) * 0.06);
    }, { ease: ease.linear });
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
    a.leave(this.L.sw * 0.4);
    this.actors[i] = null;
  }

  onPotFestival(amount: number): void {
    const L = this.L;
    this.anim.after(0.55, () => {
      popCaption(this.ui, this.anim, '항아리 축제!', L.caption.x, L.caption.y + L.caption.size * 1.05, L.caption.size * 0.75, 0xffd54a, 1.6);
      confetti(this.fx, this.anim, L.w, L.h, 40);
      // 항아리에서 코인이 펑펑
      for (let i = 0; i < Math.min(10, 3 + Math.floor(amount / 50)); i++) {
        const c = coinNode(L.sw * 0.05);
        const x0 = L.pot.x;
        const y0 = L.pot.y - this.potH * 0.85;
        c.position.set(x0, y0);
        this.fx.addChild(c);
        const vx = (Math.random() - 0.3) * L.sw * 0.35;
        const up = L.h * (0.15 + Math.random() * 0.15);
        void this.anim.run(0.9, (t) => {
          c.position.set(x0 + vx * t, y0 - up * Math.sin(Math.PI * t) + t * t * L.h * 0.05);
          c.alpha = t > 0.8 ? (1 - t) / 0.2 : 1;
        }, { ease: ease.linear, delay: i * 0.05 }).then(() => c.destroy({ children: true }));
      }
    });
  }

  destroy(): void {
    this.anim.kill();
    this.rig.destroy();
    this.host?.destroy();
    for (const a of this.actors) a?.destroy();
    this.root.destroy({ children: true });
  }
}
