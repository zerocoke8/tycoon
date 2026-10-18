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
// 넷째 묶음 (DESIGN 3.7): 손님마다 장신구·파산 어둠 (MonsterActor.sync), 다 갚는 순간 '빚 다 갚았다!'.
//   빚 걸기 판 (group.mode 'debt', 줄다리기·밀어내기): 채무자 발밑 표 = 편 + 건 빚 (debt_kit.ts DebtBadge), 모이는 중 위쪽 글 '빚 걸기 판!',
//   판 중엔 구석 표지 (signAt), 끝나면 (done) 편마다 '빚 반으로!'·'빚이 사라졌다!'·'상대 빚만큼 +N'과 발밑 표 '빚 49 → 25' (새 빚까지 세어 감).
//   전·후 빚은 상태에서 (참가 때 건 빚 GroupEntry.debt → 정산 뒤 Monster.debt): 중간에 열어도 맞는다.

import { Container, Graphics, Text } from 'pixi.js';
import { boothDef, type GroupBoothId, type OutcomeTier, SIDES } from '../../data/defs.ts';
import { ease } from '../../core/tween.ts';
import type { SimApi } from '../../sim/api.ts';
import { groupGame } from '../../sim/group/index.ts';
import type { ActiveRound, BoothState, GroupEntry, GroupPlay, GroupState, MonsterId, Reaction } from '../../sim/types.ts';
import { artSprite, hasArt } from '../art.ts';
import { DEFAULT_REACTION, HostActor, MonsterActor, neutralPose } from './actor.ts';
import { type BadgeAlign, DebtBadge, debtCaption, debtSign, debtTone, popDebtCaption } from './debt_kit.ts';
import { sparkles } from './ssireum_kit.ts';
import { Anim, clamp01, confetti, dismiss, FONT, floatText, flyCoins, INK, lerp, popCaption } from './fx.ts';
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

/** 빚 걸기 판 결과: 발밑 숫자가 세기 시작하는 때(결과 뒤 초)와 세는 길이, 다 갚은 손님을 자리에 남겨 두는 초. */
const DEBT_COUNT = { delay: 0.45, sec: 1.1, reliefHold: 2.6 } as const;

/** 빚 걸기 판 채무자 하나의 결과 (전·후 빚, 등급, 보인 때). */
interface DebtResult {
  readonly seat: number;
  readonly side: number;
  readonly before: number;
  readonly after: number;
  readonly tier: OutcomeTier;
  readonly at: number;
}

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
  /** 빚 걸기 판: 채무자 발밑 표 (자리마다), 결과 (판마다 채무자 id → 결과), 표지. */
  private readonly debtBadges: (DebtBadge | null)[];
  private readonly debtResults = new Map<MonsterId, DebtResult>();
  private debtPlay: GroupPlay | null = null;
  /** 마지막 '빚 다 갚았다!' 글자를 띄운 때 (여럿이 한꺼번에 다 갚으면 글자는 하나). */
  private reliefAt = -99;
  private readonly sign: Container;

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
    this.debtBadges = bs.seats.map(() => null);
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

    this.sign = debtSign(Math.max(11, L.sw * 0.034));
    this.sign.visible = false;
    this.ui.addChild(this.sign);
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

  /**
   * 채무자 발밑 표 자리 (패널 px, fs = 표 글자 크기, align = 표를 펼치는 쪽: 0 가운데, -1 왼쪽으로, 1 오른쪽으로).
   * 자리가 붙어 있으면 장면이 줄마다 엇갈리거나 바깥으로 펼친다.
   */
  protected debtBadgeAt(seat: number, fs: number): { x: number; y: number; align?: BadgeAlign } {
    const at = this.seatAt[seat];
    return at === undefined ? { x: this.L.w / 2, y: this.L.feetY } : { x: at.x, y: at.y + fs };
  }

  /** 빚 걸기 판 결과 글자 줄의 가운데 y (패널 px, size = 글자 크기): '빚 걸기 판' 표지 바로 아래. */
  protected debtCaptionY(size: number): number {
    const p = this.signAt({ w: this.sign.width, h: this.sign.height });
    return p.y + this.sign.height + size * 1.15;
  }

  /** '빚 걸기 판' 표지 자리 (패널 px, 표지 왼쪽 위). 장면이 위쪽 막대·글자를 피해 바꾼다. */
  protected signAt(_size: { w: number; h: number }): { x: number; y: number } {
    return { x: 10, y: 10 };
  }

  /** 자리 seat의 채무자가 건 빚 (참가 전이면 지금 빚), 빚 걸기 판의 채무자가 아니면 null. */
  protected debtStake(seat: number): number | null {
    const g = this.group;
    if (g === null || g.mode !== 'debt') return null;
    const e = this.entryAt(seat);
    if (e !== undefined) return e.debt ?? null;
    const id = this.state.seats[seat] ?? null;
    if (id === null || !(g.debtors ?? []).includes(id)) return null;
    return this.sim.monster(id)?.debt ?? null;
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
    this.syncDebt();
    // 판 중·결과 때는 먹구름을 띄우지 않는다 (놀이가 먼저 보이게).
    const busy = bs.group !== null && (bs.group.phase === 'running' || bs.group.phase === 'done');
    for (const a of this.actors) {
      if (a === null) continue;
      neutralPose(a.rig);
      a.eager = 0;
      a.quiet = busy;
    }
    this.drawPlay(this.play, this.clock, dt);
    for (const a of this.actors) {
      if (a === null) continue;
      a.sync(this.sim.monster(a.id), dt);
      if (a.relieved) {
        a.relieved = false;
        this.onRelieved(a);
      }
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
        // 결과 반응을 보여 주는 동안은 자리가 비어도 남는다. 빚을 막 다 갚은 채무자도 (어둠이 걷히는 것을 보여 주게).
        const m = this.sim.monster(cur.id);
        if (want === null && m !== undefined && (this.time < cur.holdUntil || (cur.bankrupt && m.phase === 'relieved'))) {
          this.syncDebtBadge(i);
          continue;
        }
        cur.leave(this.L.sw * 0.3);
        this.actors[i] = null;
      }
      // 빚 걸기 판: 아직 자리로 오는 중인 채무자는 그리지 않고 자리에 흐린 표만 (닿으면 걸어 들어온다: '빚진 손님을 기다려요'와 맞게).
      if (want !== null && this.debtComing(i, want)) {
        this.setBadge(i, '');
        this.syncDebtBadge(i, want);
        continue;
      }
      this.setBadge(i, '');
      this.setDebtBadge(i, null);
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
    // 빚 걸기 판의 채무자는 편 + 건 빚 표.
    if (this.syncDebtBadge(seat)) {
      this.setBadge(seat, '');
      return;
    }
    const e = this.entryAt(seat);
    this.setBadge(seat, e === undefined ? '' : (this.pickText(e) ?? ''));
  }

  /** 자리 seat의 손님 id가 빚 걸기 판에 불려 아직 자리로 오는 중인가 (참가 전). */
  private debtComing(seat: number, id: MonsterId): boolean {
    const g = this.group;
    if (g === null || g.mode !== 'debt' || !(g.debtors ?? []).includes(id) || this.entryAt(seat) !== undefined) return false;
    return this.sim.monster(id)?.phase === 'toSeat';
  }

  /**
   * 자리 seat의 채무자 표를 맞춘다 (결과가 났으면 새 빚까지 세어 간다). 채무자가 아니면 표를 치우고 false.
   * coming = 아직 오는 중인 채무자 (그림이 없다): 표만 흐리게.
   */
  private syncDebtBadge(seat: number, coming: MonsterId | null = null): boolean {
    const a = this.actors[seat] ?? null;
    const id = a?.id ?? coming;
    const r = id === null ? undefined : this.debtResults.get(id);
    const stake = r?.before ?? this.debtStake(seat);
    if (id === null || stake === null) {
      this.setDebtBadge(seat, null);
      return false;
    }
    const side = r?.side ?? this.entryAt(seat)?.pick ?? seat % 2;
    const key = `${id}:${side}`;
    let b = this.debtBadges[seat] ?? null;
    if (b === null || b.key !== key) {
      const fs = Math.max(11, this.L.sw * 0.036);
      const p = this.debtBadgeAt(seat, fs);
      b = new DebtBadge(key, SIDES[side]?.name ?? '', SIDES[side]?.color ?? 0x888888, fs, p.align ?? 0);
      b.node.position.set(p.x, p.y);
      b.node.zIndex = 56;
      this.setDebtBadge(seat, b);
    }
    b.node.alpha = a === null ? 0.5 : 1;
    if (r === undefined) b.set(stake, 'stake');
    else {
      // '빚 49 → 25': 오른쪽 숫자가 새 빚까지 세어 간다.
      const u = ease.outCubic(clamp01((this.time - r.at - DEBT_COUNT.delay) / DEBT_COUNT.sec));
      b.set(lerp(r.before, r.after, u), u <= 0 ? 'stake' : debtTone(r.before, r.after), r.before);
    }
    return true;
  }

  private setDebtBadge(seat: number, b: DebtBadge | null): void {
    const cur = this.debtBadges[seat] ?? null;
    if (cur === b) return;
    cur?.destroy();
    this.debtBadges[seat] = b;
    if (b !== null) this.root.addChild(b.node);
  }

  /** 빚 걸기 판: 표지, 판이 끝나면 (done) 채무자마다 전·후 빚을 잡아 결과 연출. */
  private syncDebt(): void {
    const g = this.group;
    const debt = g !== null && g.mode === 'debt';
    const showSign = debt && g.phase !== 'gathering' && g.phase !== 'idle';
    if (showSign && !this.sign.visible) {
      const p = this.signAt({ w: this.sign.width, h: this.sign.height });
      this.sign.position.set(p.x, p.y);
    }
    this.sign.visible = showSign;
    // 새 판이 시작되면 (빚 걸기 판이 아니어도) 지난 결과를 비운다.
    const play = g?.play ?? null;
    if (play !== null && play !== this.debtPlay) {
      this.debtPlay = play;
      this.debtResults.clear();
    }
    if (!debt || play === null || g.phase !== 'done' || this.clock < play.end - 0.05) return;
    const fresh: DebtResult[] = [];
    g.participants.forEach((e, i) => {
      if (e.debt === undefined || this.debtResults.has(e.monster)) return;
      const m = this.sim.monster(e.monster);
      const o = play.outcomes[i];
      if (m === undefined || o === undefined) return;
      const r: DebtResult = { seat: e.seat, side: e.pick, before: e.debt, after: m.debt, tier: o.tier, at: this.time };
      this.debtResults.set(e.monster, r);
      fresh.push(r);
    });
    if (fresh.length > 0) this.showDebtResults(fresh);
  }

  /**
   * 빚 걸기 판 결과: 편마다 글자 하나 (발밑 표는 '빚 49 → 25'로 세어 간다), 빚이 0이 되면 색종이.
   * 글자는 '빚 걸기 판' 표지 아래 고정 줄에 (홍 = 왼쪽 반, 청 = 오른쪽 반): 머리 높이는 구경 손님 결과 글자·받은 코인 숫자가 뜨는 곳이라.
   */
  private showDebtResults(list: readonly DebtResult[]): void {
    const L = this.L;
    const size = Math.max(13, L.sw * 0.048);
    const y = this.debtCaptionY(size);
    for (const side of [0, 1]) {
      const rs = list.filter((r) => r.side === side);
      const first = rs[0];
      if (first === undefined) continue;
      const cap = debtCaption(first.tier, rs.every((r) => r.after <= 0), rs.map((r) => r.after - r.before));
      const x = side === 0 ? L.w * 0.26 : L.w * 0.74;
      this.anim.after(0.25, () => popDebtCaption(this.ui, this.anim, cap.text, x, y, size, cap.color, 2.4, L.w * 0.47));
    }
    if (list.some((r) => r.after <= 0 && r.before > 0)) this.anim.after(0.3, () => confetti(this.fx, this.anim, L.w, L.h, 30));
  }

  /** 채무자가 빚을 다 갚았다 (빚 걸기 판에서 빚이 0이 되어): 어둠이 걷히는 동안 자리에 남고 '빚 다 갚았다!'·반짝이. */
  private onRelieved(a: MonsterActor): void {
    const L = this.L;
    a.holdUntil = Math.max(a.holdUntil, this.time + DEBT_COUNT.reliefHold);
    a.emote('sparkle', 1.2);
    const s = Math.abs(a.root.scale.y);
    const x = a.root.x + a.rig.dx * a.root.scale.x;
    const top = a.root.y + a.bodyTop() * s;
    sparkles(this.fx, this.anim, x, top + L.bodyH * s * 0.3, L.sw * 0.05, 7, L.bodyH * s * 0.45);
    if (this.time - this.reliefAt < 1.5) return;
    this.reliefAt = this.time;
    const size = Math.max(15, L.sw * 0.055);
    const half = size * 3.4;
    popCaption(this.ui, this.anim, '빚 다 갚았다!', Math.max(half, Math.min(L.w - half, x)), Math.max(size * 1.6, top - L.bodyH * 0.08), size, 0xffd54a, 1.8);
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
    else if (g !== null && g.phase === 'gathering' && g.mode === 'debt') {
      // 빚 걸기 판: 불린 채무자가 다 와야 시작 (sim groupReady와 같이).
      const ready = (g.debtors ?? []).every((id) => g.participants.some((e) => e.monster === id));
      note = !ready ? '빚 걸기 판!\n빚진 손님을 기다려요' : g.countdown > 0.5 ? `빚 걸기 판!\n시작까지 ${Math.ceil(g.countdown)}초` : '빚 걸기 판!\n곧 시작!';
    } else if (g !== null && g.phase === 'gathering') {
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
