// 단체 놀이 확대 화면의 공용 바탕 (GroupScene). 씨름·오리배·연날리기·줄다리기·보물찾기 장면(closeup/<booth>.ts)이 이어받는다
// (경주장은 자기 장면 race.ts). CloseupScene 약속(registry.ts)을 따른다.
//
// 바탕이 맡는 것: 배경(closeup/bg_<부스>, 패널을 덮게), 진행자(역할마다 HostActor), 자리마다 손님(MonsterActor, 자리 배치는 장면이 layout()으로),
//   손님 발밑 표(pickText: '홍'·'빨강 연'…), 상금 항아리, 위쪽 안내 글('시작까지 N초', 닫힘 이유), 결과(손님 머리 위 글자·항아리 → 손님 코인·진행자 폴짝),
//   sim 반응·구경·응원 이벤트를 손님 그림에.
// 장면이 맡는 것: layout(L) = 자리·진행자 자리, drawPlay(play, t, dt) = 그 시각의 놀이 모습 (this.stage·this.front에 그린다,
//   손님 동작은 actor.rig = { dx, dy, sx, sy, rot }, 진행자는 host.rig = { dy, rot }: 매 프레임 기본값으로 돌아간다).
// 상태를 매 프레임 읽어 맞춘다 (중간에 열어도 그 시각의 모습): sim.state.booths[booth].group (GroupState), 판 = group.play (running·done).
// this.clock = 판 시작 뒤 초 (running이면 sim 시계를 부드럽게 따라가고, done이면 계속 흐른다). 판이 없으면 0.

import { Container, Graphics, Text } from 'pixi.js';
import { boothDef, type GroupBoothId, type OutcomeTier } from '../../data/defs.ts';
import { ease } from '../../core/tween.ts';
import type { SimApi } from '../../sim/api.ts';
import { groupGame } from '../../sim/group/index.ts';
import type { ActiveRound, BoothState, GroupEntry, GroupPlay, GroupState, MonsterId, Reaction } from '../../sim/types.ts';
import { artSprite, hasArt } from '../art.ts';
import { DEFAULT_REACTION, HostActor, MonsterActor, neutralPose } from './actor.ts';
import { Anim, confetti, dismiss, FONT, floatText, flyCoins, INK, popCaption } from './fx.ts';
import { computeLayout, FLOOR_COLOR, type Layout, WALL_COLOR } from './layout.ts';
import type { CloseupScene } from './registry.ts';

/** 손님 자리 하나 (패널 px). face = 1이면 그림 그대로 왼쪽을 보고, -1이면 뒤집어 오른쪽을 본다. */
export interface GroupSeat {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly z: number;
  readonly face: 1 | -1;
}

/** 진행자 자리 하나 (패널 px). face = 1이면 오른쪽을 본다 (HostActor 기본), -1이면 왼쪽. */
export interface GroupHostSpot {
  readonly x: number;
  readonly y: number;
  readonly face: 1 | -1;
}

export interface GroupStage {
  /** 자리마다 (BoothState.seats와 같은 순서). */
  readonly seats: readonly GroupSeat[];
  /** 진행자 자리마다 (BOOTHS[b].roles와 같은 순서). */
  readonly hosts: readonly GroupHostSpot[];
}

const CAPTION: Record<OutcomeTier, { text: string; color: number }> = {
  jackpot: { text: '대박!', color: 0xffc83d },
  win: { text: '이겼다!', color: 0x9ad66f },
  nearMiss: { text: '아깝다!', color: 0xff9a5c },
  lose: { text: '다음엔…', color: 0xc3cbd8 },
};

export abstract class GroupScene implements CloseupScene {
  readonly booth: GroupBoothId;
  readonly root = new Container();
  protected readonly sim: SimApi;
  protected readonly L: Layout;
  protected readonly anim = new Anim();
  /** 놀이 장치 층 (손님 뒤, zIndex 20). */
  protected readonly stage = new Container();
  /** 손님 앞 층 (zIndex 45). */
  protected readonly front = new Container();
  protected readonly fx = new Container();
  protected readonly ui = new Container();
  protected readonly actors: (MonsterActor | null)[];
  protected readonly hosts: (HostActor | null)[];
  protected readonly seatAt: readonly GroupSeat[];
  protected readonly hostAt: readonly GroupHostSpot[];
  protected time = 0;
  /** 판 시작 뒤 초 (판이 없으면 0). */
  protected clock = 0;
  /** 지금 보여 주는 판 (running·done). */
  protected play: GroupPlay | null = null;
  private readonly unlocked: boolean;
  private readonly bgReady: boolean;
  private readonly onTap: (id: MonsterId) => void;
  private readonly badges: (Container | null)[];
  private readonly badgeText: string[];
  private readonly note: Text;
  private noteShown = '';
  private readonly pot: Container;
  private readonly potLabel: Text;
  private readonly potH: number;
  private potShown = -1;
  private caption: Text | null = null;

  constructor(sim: SimApi, booth: GroupBoothId, w: number, h: number, onTap: (id: MonsterId) => void) {
    this.sim = sim;
    this.booth = booth;
    this.onTap = onTap;
    const bs = sim.state.booths[booth];
    this.unlocked = bs.unlocked;
    const L = computeLayout(booth, w, h, 1);
    this.L = L;
    this.root.sortableChildren = true;

    // 배경: 정사각 그림을 패널을 덮게 (그림이 없으면 벽·바닥 자리 표시, 그림이 오면 다시 짓는다).
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
      g.zIndex = 0;
      this.root.addChild(g);
    }

    const st = this.layout(L);
    this.seatAt = st.seats;
    this.hostAt = st.hosts;
    this.actors = bs.seats.map(() => null);
    this.hosts = boothDef(booth).roles.map(() => null);
    this.badges = bs.seats.map(() => null);
    this.badgeText = bs.seats.map(() => '');
    if (!this.unlocked) this.stage.tint = 0xb3aaa2;

    // 상금 항아리 (왼쪽 아래)
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

    this.stage.zIndex = 20;
    this.front.zIndex = 45;
    this.fx.zIndex = 50;
    this.ui.zIndex = 60;
    this.root.addChild(this.stage, this.pot, this.front, this.fx, this.ui);

    const nFont = Math.max(14, L.sw * 0.05);
    this.note = new Text({ text: '', style: { fontFamily: FONT, fontSize: nFont, fill: 0xffffff, stroke: { color: INK, width: Math.max(3, nFont * 0.2), join: 'round' }, align: 'center' } });
    this.note.anchor.set(0.5, 0);
    this.note.position.set(w / 2, Math.max(10, h * 0.04));
    this.ui.addChild(this.note);
  }

  /** 자리·진행자 자리 (패널 px). L = 공용 배치 (바닥 줄 feetY, 몸 높이 bodyH, 무대 sx·sw …). */
  protected abstract layout(L: Layout): GroupStage;

  /** 매 프레임 그 시각의 놀이 모습 (play = null이면 쉬거나 모이는 중, t = this.clock). 손님 동작은 actor.rig. */
  protected abstract drawPlay(play: GroupPlay | null, t: number, dt: number): void;

  /** 모이는 중인데 출발 조건이 안 맞을 때 위쪽 안내 글 (씨름 상대·줄다리기 편을 기다림). */
  protected waitText(_g: GroupState): string {
    return '손님을\n기다려요';
  }

  /** 손님 발밑 표 글자 (그 손님이 고른 것: '홍', '빨강 연'…, null = 표 없음). */
  protected pickText(_e: GroupEntry): string | null {
    return null;
  }

  protected get state(): BoothState {
    return this.sim.state.booths[this.booth];
  }

  protected get group(): GroupState | null {
    return this.state.group;
  }

  /** 자리 seat의 참가자 (이번 판 또는 모이는 중). */
  protected entryAt(seat: number): GroupEntry | undefined {
    return this.group?.participants.find((e) => e.seat === seat);
  }

  /** 자리 seat의 손님 그림 (없거나 떠나는 중이면 null). */
  protected actor(seat: number): MonsterActor | null {
    const a = this.actors[seat] ?? null;
    return a === null || a.leaving ? null : a;
  }

  /** 손님 그림을 패널 px로 옮기고 기울인다 (자리가 뒤집혀 있어도 보이는 쪽 그대로, rot + = 시계 방향). drawPlay에서 매 프레임. */
  protected move(a: MonsterActor, dx: number, dy: number, rot = 0): void {
    const sx = a.root.scale.x || 1;
    const sy = a.root.scale.y || 1;
    a.rig.dx = dx / sx;
    a.rig.dy = dy / sy;
    a.rig.rot = rot * Math.sign(sx);
  }

  needsRebuild(): boolean {
    const bs = this.state;
    return bs.unlocked !== this.unlocked || bs.seats.length !== this.actors.length || (!this.bgReady && hasArt('closeup', `bg_${this.booth}`));
  }

  update(dt: number): void {
    this.time += dt;
    const bs = this.state;
    this.syncHosts(bs);
    this.syncCast(bs);
    this.followClock(dt);
    for (const a of this.actors) {
      if (a === null) continue;
      neutralPose(a.rig);
      a.eager = 0;
    }
    this.drawPlay(this.play, this.clock, dt);
    for (const a of this.actors) {
      if (a === null) continue;
      a.update(dt, this.time);
      if (a.expect !== null && this.time >= a.expect.at) {
        const tier = a.expect.tier;
        a.expect = null;
        if (this.time - a.lastReact > 0.6) a.react(DEFAULT_REACTION[tier], this.time);
      }
    }
    for (const h of this.hosts) h?.update(this.time);
    this.syncLabels(bs);
  }

  private followClock(dt: number): void {
    const g = this.group;
    const p = g !== null && (g.phase === 'running' || g.phase === 'done') ? g.play : null;
    if (p !== this.play) {
      this.play = p;
      this.clock = p === null || g === null ? 0 : g.elapsed;
      if (p !== null && this.caption !== null) {
        dismiss(this.anim, this.caption);
        this.caption = null;
      }
      return;
    }
    if (p === null || g === null) return;
    this.clock += dt;
    if (g.phase === 'running') this.clock = Math.max(g.elapsed - 0.2, Math.min(g.elapsed + 0.2, this.clock + (g.elapsed - this.clock) * Math.min(1, dt * 3)));
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
        const h = new HostActor(staff.art, this.L.kHost, this.anim);
        const at = this.hostAt[role] ?? { x: this.L.sx + this.L.sw * 0.12, y: this.L.feetY, face: 1 };
        h.root.position.set(Math.max(6 + h.halfW, Math.min(this.L.w - 6 - h.halfW, at.x)), at.y);
        h.root.scale.x = at.face;
        h.root.zIndex = 10 + role;
        this.root.addChild(h.root);
        this.hosts[role] = h;
      } else cur.setArt(staff.art);
    }
  }

  private syncCast(bs: BoothState): void {
    for (let i = 0; i < this.actors.length; i++) {
      const want = bs.seats[i] ?? null;
      const cur = this.actors[i] ?? null;
      if (cur !== null && cur.id === want) {
        this.syncBadge(i);
        continue;
      }
      if (cur !== null) {
        // 결과 반응을 보여 주는 동안은 자리가 비어도 남는다.
        if (want === null && this.sim.monster(cur.id) !== undefined && this.time < cur.holdUntil) continue;
        cur.leave(this.L.sw * 0.3);
        this.actors[i] = null;
      }
      this.setBadge(i, '');
      if (want === null) continue;
      const m = this.sim.monster(want);
      const at = this.seatAt[i];
      if (m === undefined || at === undefined) continue;
      const a = new MonsterActor(m.id, m.species, this.L.kMon, this.L.bodyH, this.anim, (id) => this.onTap(id));
      a.root.position.set(at.x, at.y);
      a.root.scale.set(at.scale * at.face, at.scale);
      a.root.zIndex = at.z;
      this.root.addChild(a.root);
      this.actors[i] = a;
      if (this.time > 0) a.enter(this.L.sw * 0.2 * at.face);
      if (m.pose !== 'base' && m.phase === 'reacting') a.showPose(m.pose, m.timer);
    }
  }

  private syncBadge(seat: number): void {
    const e = this.entryAt(seat);
    this.setBadge(seat, e === undefined ? '' : (this.pickText(e) ?? ''));
  }

  private setBadge(seat: number, text: string): void {
    if (this.badgeText[seat] === text) return;
    this.badgeText[seat] = text;
    this.badges[seat]?.destroy({ children: true });
    this.badges[seat] = null;
    const at = this.seatAt[seat];
    if (text === '' || at === undefined) return;
    const fs = Math.max(11, this.L.sw * 0.034);
    const c = new Container();
    const t = new Text({ text, style: { fontFamily: FONT, fontSize: fs, fill: INK } });
    t.anchor.set(0.5);
    const bw = t.width + fs * 0.9;
    const bh = fs * 1.45;
    c.addChild(new Graphics().roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2).fill({ color: 0xfff6e6, alpha: 0.92 }).stroke({ color: INK, width: 2 }), t);
    c.position.set(at.x, at.y + fs * 0.9);
    c.zIndex = 55;
    this.root.addChild(c);
    this.badges[seat] = c;
  }

  private syncLabels(bs: BoothState): void {
    if (bs.pot !== this.potShown) {
      this.potShown = bs.pot;
      this.potLabel.text = `${Math.floor(bs.pot)}`;
    }
    const g = bs.group;
    const roles = boothDef(this.booth).roles;
    const need = roles.filter((r, i) => r.optional !== true && (bs.staff[i] ?? null) === null).map((r) => r.name);
    let note = '';
    if (!bs.unlocked) note = '아직 열지 않은 놀이부스';
    else if (need.length > 0 && (g === null || g.phase === 'idle' || g.phase === 'gathering')) note = `${need.join('·')} 자리가\n비어 쉬는 중`;
    else if (g !== null && g.phase === 'gathering') {
      // 출발 조건이 안 맞으면 (씨름 상대·줄다리기 편) 기다린다는 글 (UI 상태 줄과 같이).
      if (groupGame(this.booth).readiness(g.participants, g.elapsed) === 'none') note = this.waitText(g);
      else {
        // 오리배는 '출발' (아래 부스 패널 상태 줄과 같은 말).
        const S = this.booth === 'race' || this.booth === 'boat' ? '출발' : '시작';
        note = g.countdown > 0.5 ? `${S}까지 ${Math.ceil(g.countdown)}초` : `곧 ${S}!`;
      }
    }
    if (note !== this.noteShown) {
      this.noteShown = note;
      this.note.text = note;
    }
  }

  // ── sim 이벤트 ─────────────────────────────────────────────────────────

  onRoundStarted(_seat: number, _round: ActiveRound): void {
    // 판은 상태(group.play)를 매 프레임 읽어 맞춘다.
  }

  onRoundFinished(seat: number, round: ActiveRound, payout: number): void {
    const L = this.L;
    const tier = round.outcome.tier;
    const a = this.actor(seat);
    const cap = CAPTION[tier];
    if (a !== null) {
      const s = Math.abs(a.root.scale.x);
      const headY = a.root.y + a.headY * s;
      const capSize = Math.max(16, L.sw * 0.065);
      popCaption(this.ui, this.anim, cap.text, a.root.x, headY - L.bodyH * 0.12, capSize, cap.color);
      a.holdUntil = this.time + 2.4;
      if (this.time - a.lastReact > 0.6) a.expect = { tier, at: this.time + 0.35 };
      if (payout > 0) {
        const from = { x: L.pot.x, y: L.pot.y - this.potH * 0.85 };
        const to = { x: a.root.x, y: a.root.y - L.bodyH * 0.45 * s };
        flyCoins(this.fx, this.anim, from, to, Math.max(3, Math.min(14, Math.round(3 + payout / 4))), L.sw * 0.05, () => {
          // 숫자는 결과 글자 위로 (글자에 가려지지 않게).
          floatText(this.fx, this.anim, `+${payout}`, to.x, headY - L.bodyH * 0.12 - capSize * 1.2, Math.max(16, L.sw * 0.06));
        });
        this.shakePot();
      }
    }
    if (tier === 'jackpot') confetti(this.fx, this.anim, L.w, L.h, 40);
    if (tier === 'jackpot' || tier === 'win') for (const h of this.hosts) h?.cheer(tier === 'jackpot');
  }

  /** 항아리가 흔들린다 (코인이 나갈 때: onRoundFinished를 바꾼 장면도 부른다). */
  protected shakePot(): void {
    const pot = this.pot;
    void this.anim.run(0.55, (t) => {
      pot.rotation = Math.sin(t * Math.PI * 8) * 0.09 * (1 - t);
    }, { ease: ease.linear });
  }

  private actorOf(id: MonsterId): MonsterActor | null {
    return this.actors.find((a): a is MonsterActor => a !== null && a.id === id && !a.leaving) ?? null;
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
    this.setBadge(i, '');
  }

  onPotFestival(_amount: number): void {
    const L = this.L;
    popCaption(this.ui, this.anim, '항아리 축제!', L.caption.x, L.caption.y, L.caption.size * 0.75, 0xffd54a, 1.6);
    confetti(this.fx, this.anim, L.w, L.h, 40);
  }

  destroy(): void {
    this.anim.kill();
    for (const h of this.hosts) h?.destroy();
    for (const a of this.actors) a?.destroy();
    this.root.destroy({ children: true });
  }
}

/** 손님 자리 줄 하나: n자리를 x0~x1에 고르게 (앞줄일수록 크게·앞에). */
export function seatRow(n: number, x0: number, x1: number, y: number, scale: number, z: number, face: 1 | -1): GroupSeat[] {
  return Array.from({ length: n }, (_, i) => ({ x: n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1), y, scale, z: z + i * 0.01, face }));
}
