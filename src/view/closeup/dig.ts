// 보물찾기 마당 확대 화면. 배경 closeup/bg_dig (흙 마당, 뒤에 나무 울타리) 위에 흙더미 여섯 (map/dirt_mound, 판 자리 0~2 뒤줄·3~5 앞줄).
// 손님은 자기 흙더미 오른쪽에 서서 왼쪽을 보고 판다. 지도와 같은 타임라인을 크게 재생한다:
//   모이는 중: 삽 대여 언니가 손님마다 삽(items/shovel)을 휙 던져 준다, 보물 지도 할아버지는 보물 지도(코드: 양피지·점선·빨간 X)를 펼쳐 든다.
//   판 중: 판 깊이 play.tracks[자리](0→1)만큼 흙더미가 패이고(구멍이 커진다) 삽질 (몸을 숙여 푹 → 들어 올려 흙덩이를 뒤로 휙, 흙먼지).
//   findAt: 구멍에서 무언가 튀어 올라 머리 위에 (동전 주머니 items/coin_pile·보석 items/gem = 반짝이와 기쁨, 헌 장화 items/old_boot·조약돌 objects/pebble = 시무룩),
//   보물상자(map/treasure_chest)는 구멍 옆 땅에 툭 떨어졌다가 열리며(treasure_chest_open) 반짝이·코인 분수·색종이.
//   아무도 못 찾은 상자(reveal): 할아버지가 상자 자리로 걸어가 파서 보여 주고 '여기였지!', 바로 옆을 판 손님은 '바로 옆이었는데!'.
// 발밑 표는 판 자리('2번 땅'), 나온 뒤엔 나온 것 이름. 결과는 손님마다 작은 글자(꽝은 글자 없이)와 코인.
// 진행자: 보물 지도 할아버지(자리 0, 왼쪽 뒤), 삽 대여(자리 1, 오른쪽 뒤). 판이 끝나 쉬면 삽은 언니에게 돌아간다.

import { Container, Graphics } from 'pixi.js';
import { SPECIES } from '../../data/defs.ts';
import { ease } from '../../core/tween.ts';
import type { SimApi } from '../../sim/api.ts';
import { trackAt } from '../../sim/group/core.ts';
import { digNear } from '../../sim/group/dig.ts';
import type { ActiveRound, DigFind, GroupEntry, GroupEvent, GroupPlay, MonsterId } from '../../sim/types.ts';
import { type ArtNode, artSprite } from '../art.ts';
import type { HostActor, MonsterActor } from './actor.ts';
import { clamp01, confetti, coinNode, INK, lerp, span } from './fx.ts';
import { GroupScene, type GroupSeat, type GroupStage } from './group.ts';
import type { Layout } from './layout.ts';
import { clods, placeHost, preloadGlyphs, puff, settle, sparkles, Talk, Timeline } from './ssireum_kit.ts';

/** closeup/bg_dig에서 잰 값 (배경 높이의 비율): 울타리 아래 끝 = 흙 마당이 시작하는 선. */
const BG = { dirt: 0.518 } as const;
/**
 * 뒤줄·앞줄 (흙 띠 높이의 비율)과 손님 배율, 흙더미 열 (패널 폭의 비율). 손님은 흙더미에서 오른쪽으로 STAND만큼.
 * 뒤줄은 반 칸 왼쪽으로 엇갈려 (앞줄 손님 머리가 뒤줄 손님·발밑 표를 가리지 않게).
 */
const ROWS = [
  { y: 0.3, s: 0.46, mound: 0.16, z: 30, col: [0.14, 0.4, 0.66] },
  { y: 0.67, s: 0.55, mound: 0.19, z: 36, col: [0.27, 0.53, 0.79] },
] as const;
const STAND = 0.1;
const S = { grandpa: 0.62, lender: 0.6 } as const;
/** 상자 자리 6~8 (판 자리 사이, map.ts DIG_FIELD.chests 순서): 열 사이 x (패널 폭 비율). */
const MID_X = [0.335, 0.595, 0.855] as const;
/** characters/dig_grandpa: 두루마리를 쥔 손 (발에서 캔버스 px, 그림은 왼쪽을 보고 손은 그림 왼쪽). */
const GRANDPA_HAND = { x: -249, y: -408 } as const;
/** characters/dig_lender: 가슴 앞에 든 삽 (발에서 캔버스 px). */
const LENDER_SHOVELS = { x: -40, y: -470 } as const;

const FIND_NAME: Record<DigFind, string> = { none: '', chest: '보물상자!', coins: '동전 주머니', gem: '보석', boot: '헌 장화', pebble: '조약돌' };
const FIND_ART: Record<Exclude<DigFind, 'none'>, { group: string; key: string; w: number; size: number; color: number }> = {
  chest: { group: 'map', key: 'treasure_chest', w: 489, size: 0.9, color: 0xb0743f },
  coins: { group: 'items', key: 'coin_pile', w: 514, size: 0.36, color: 0xf3d36a },
  gem: { group: 'items', key: 'gem', w: 606, size: 0.32, color: 0x8ec8ee },
  boot: { group: 'items', key: 'old_boot', w: 496, size: 0.3, color: 0x8a6a50 },
  pebble: { group: 'objects', key: 'pebble', w: 427, size: 0.26, color: 0xb3aea8 },
};

preloadGlyphs('보물이 묻혀 있단다! 파 보거라! 삽 받아요! 여기였지! 바로 옆이었는데! 보물상자! 동전 주머니 보석 헌 장화 조약돌 0123456789번 땅 대박! 이겼다! 아깝다!');

interface Spot {
  readonly mound: ArtNode;
  readonly hole: Graphics;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly row: (typeof ROWS)[number];
}

interface Pop {
  readonly node: ArtNode;
  readonly find: Exclude<DigFind, 'none'>;
  readonly spot: number;
  /** 상자 자리 (상자만, DIG_FIELD.chests index). */
  readonly chest: number;
  readonly at: number;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  fired: boolean;
}

export class DigScene extends GroupScene {
  private readonly spots: Spot[] = [];
  private readonly shovels: (Container | null)[] = [];
  private readonly map: Container;
  private readonly talk: Talk;
  private readonly lenderTalk: Talk;
  private readonly tl = new Timeline();
  private readonly dirtTop: number;
  private readonly band: number;
  private pops: Pop[] = [];
  private popsFor: GroupPlay | null = null;
  /** 손님마다 삽이 손에 닿는 씬 시각 (없으면 아직 삽이 없다). */
  private readonly held = new Map<MonsterId, number>();
  private readonly posed = new Set<MonsterId>();
  private gatherSaid = false;

  constructor(sim: SimApi, w: number, h: number, onTap: (id: MonsterId) => void) {
    super(sim, 'dig', w, h, onTap);
    const L = this.L;
    this.dirtTop = L.bg.y + BG.dirt * L.bg.size;
    this.band = Math.max(20, Math.min(L.h, L.bg.y + L.bg.size) - this.dirtTop);
    for (let i = 0; i < 6; i++) {
      const row = ROWS[i < 3 ? 0 : 1];
      const x = L.w * (row.col[i % 3] ?? 0.5);
      const y = this.dirtTop + this.band * row.y;
      const mw = L.w * row.mound;
      const mound = artSprite('map', 'dirt_mound', { k: mw / 553, anchor: 'bottom', placeholder: { w: 553, h: 287, color: 0x9a6a3e } });
      mound.position.set(x, y + mw * 0.06);
      mound.zIndex = row.z - 1;
      const hole = new Graphics();
      hole.zIndex = row.z - 0.9;
      this.root.addChild(mound, hole);
      this.spots.push({ mound, hole, x, y, w: mw, row });
      this.shovels.push(null);
    }
    this.map = treasureMap(L.bodyH * 0.4);
    this.map.visible = false;
    this.map.zIndex = 13;
    this.root.addChild(this.map);
    this.talk = new Talk(this.ui, this.anim, L);
    this.lenderTalk = new Talk(this.ui, this.anim, L);
    this.update(0);
  }

  protected layout(L: Layout): GroupStage {
    const dirtTop = L.bg.y + BG.dirt * L.bg.size;
    const band = Math.max(20, Math.min(L.h, L.bg.y + L.bg.size) - dirtTop);
    const seats: GroupSeat[] = [];
    for (let i = 0; i < 6; i++) {
      const row = ROWS[i < 3 ? 0 : 1];
      const col = i % 3;
      seats.push({ x: L.w * ((row.col[col] ?? 0.5) + STAND), y: dirtTop + band * row.y, scale: row.s, z: row.z + col * 0.1, face: 1 });
    }
    return {
      seats,
      hosts: [
        { x: L.w * 0.075, y: dirtTop + band * 0.04, face: 1 },
        { x: L.w * 0.925, y: dirtTop + band * 0.04, face: -1 },
      ],
    };
  }

  protected override pickText(e: GroupEntry): string | null {
    const p = this.play;
    if (p !== null && p.kind === 'dig') {
      const at = p.findAt[e.pick] ?? -1;
      const f = p.finds[e.pick] ?? 'none';
      if (at >= 0 && this.clock >= at + 0.3 && f !== 'none') return FIND_NAME[f];
    }
    return `${e.pick + 1}번 땅`;
  }

  /** 상자 자리 c의 패널 좌표 (앞 여섯 = 흙더미, 뒤 셋 = 사이). */
  private chestAt(c: number): { x: number; y: number; z: number; s: number } {
    const sp = this.spots[c];
    // 흙더미 가운데, 그 자리 손님 바로 뒤 (손님이 상자 앞에서 만세).
    if (sp !== undefined) return { x: sp.x - sp.w * 0.05, y: sp.y + sp.w * 0.05, z: sp.row.z - 0.5, s: sp.row.s };
    const mid = this.dirtTop + this.band * ((ROWS[0].y + ROWS[1].y) / 2);
    return { x: this.L.w * (MID_X[c - 6] ?? 0.5), y: mid, z: 34, s: (ROWS[0].s + ROWS[1].s) / 2 };
  }

  protected drawPlay(play: GroupPlay | null, t: number, dt: number): void {
    const dig = play !== null && play.kind === 'dig' ? play : null;
    this.talk.update(this.time);
    this.lenderTalk.update(this.time);
    if (this.tl.sync(play, t)) this.posed.clear();
    if (dig !== null && this.popsFor !== dig) this.buildPops(dig);
    if (dig === null && this.popsFor !== null) this.clearPops();
    if (dig !== null) for (const ev of this.tl.due(t)) this.onEvent(dig, ev);
    this.drawHosts(dig, t);
    this.syncShovels(dig);
    this.drawSpots(dig, t, dt);
    if (dig !== null) this.drawPops(dig, t);
    if (dig !== null && t < 1.2 && this.tl.once('start')) this.talk.say(this.hosts[0] ?? null, '파 보거라!', 1.2, this.time);
  }

  // ── 진행자 ─────────────────────────────────────────────────────────────

  /** 할아버지: 지도를 펼쳐 들고, 상자를 아무도 못 찾으면 그 자리로 걸어가 판다. 언니: 삽을 던져 줄 때 휙. */
  private drawHosts(play: Extract<GroupPlay, { kind: 'dig' }> | null, t: number): void {
    const L = this.L;
    const gp = this.hosts[0] ?? null;
    const ld = this.hosts[1] ?? null;
    const h0 = this.hostAt[0];
    const h1 = this.hostAt[1];
    if (ld !== null && h1 !== undefined) placeHost(ld, L, h1.x, h1.y, S.lender, h1.face);
    this.map.visible = false;
    if (gp === null || h0 === undefined) return;
    let x = h0.x;
    let y = h0.y;
    let face = h0.face;
    gp.root.zIndex = 10;
    const reveal = play?.events.find((e) => e.type === 'reveal');
    if (play !== null && reveal !== undefined) {
      // 상자 자리로 걸어가서(왼쪽에 서서 오른쪽을 보고) 파고, 결과가 나고 조금 뒤 돌아온다.
      const c = this.chestAt(play.chest);
      const tx = c.x - L.w * 0.08;
      const ty = c.y + this.band * 0.02;
      const go = ease.inOutQuad(span(t, reveal.t - 1.25, reveal.t - 0.2));
      const back = ease.inOutQuad(span(t, play.end + 2.1, play.end + 3));
      const u = go * (1 - back);
      x = lerp(h0.x, tx, u);
      y = lerp(h0.y, ty, u);
      if (back > 0 && back < 1) face = -1;
      const walking = (go > 0 && go < 1) || (back > 0 && back < 1);
      if (walking) gp.rig.dy = -Math.abs(Math.sin(this.time * 12)) * gp.height * S.grandpa * 0.04;
      if (u > 0.5) gp.root.zIndex = c.z - 0.3;
      // 파기: 도착해서 상자가 나올 때까지 콩콩.
      if (t > reveal.t - 0.2 && t < reveal.t + 0.1) gp.rig.rot = Math.sin(this.time * 30) * 0.06;
    }
    placeHost(gp, L, x, y, S.grandpa, face);
    // 보물 지도: 모이는 중·판 중 (상자가 나오기 전까지) 펼쳐 든다.
    const chestOut = play !== null && (play.found ? t >= (play.findAt[play.chest] ?? Infinity) : reveal !== undefined && t >= reveal.t - 1.3);
    const g = this.group;
    const showMap = !chestOut && g !== null && (g.phase === 'gathering' || (play !== null && t < play.end));
    if (showMap) {
      const k = gp.k * S.grandpa;
      const flip = gp.root.scale.x < 0 ? 1 : -1;
      this.map.visible = true;
      // 얼굴을 가리지 않게 손 앞(보는 쪽)으로 펼쳐 든다.
      this.map.position.set(gp.root.x + GRANDPA_HAND.x * k * flip + flip * L.bodyH * 0.2, gp.root.y + GRANDPA_HAND.y * k + L.bodyH * 0.04 + Math.sin(this.time * 2) * 2);
      this.map.rotation = -0.12 * flip + Math.sin(this.time * 1.3) * 0.03;
    }
  }

  // ── 삽 ────────────────────────────────────────────────────────────────

  /** 참가자마다 삽: 모이는 중에 들어오면 언니가 던져 주고, 판이 끝나 쉬면 돌려받는다. */
  private syncShovels(play: Extract<GroupPlay, { kind: 'dig' }> | null): void {
    const g = this.group;
    const live = new Set<MonsterId>();
    for (const e of g?.participants ?? []) {
      const a = this.actor(e.seat);
      if (a === null) continue;
      live.add(a.id);
      if (this.held.has(a.id)) continue;
      // 판 중에 열었거나 막 열었으면 이미 들고 있다. 아니면 던져 준다.
      if (play !== null || this.time < 0.3) this.held.set(a.id, -1);
      else this.tossShovel(a);
    }
    for (const [id] of this.held) {
      if (live.has(id)) continue;
      this.held.delete(id);
      const seat = this.actors.findIndex((a) => a !== null && a.id === id);
      if (seat >= 0) this.returnShovel(seat);
    }
    for (let seat = 0; seat < this.shovels.length; seat++) {
      const a = this.actor(seat);
      const has = a !== null && (this.held.get(a.id) ?? Infinity) <= this.time;
      let sh = this.shovels[seat] ?? null;
      if (!has) {
        if (sh !== null) sh.visible = false;
        continue;
      }
      if (sh === null) {
        sh = this.makeShovel(seat);
        this.shovels[seat] = sh;
      }
      sh.visible = true;
    }
    if (g === null || g.phase !== 'gathering') this.gatherSaid = false;
  }

  private makeShovel(seat: number): Container {
    const s = this.seatAt[seat];
    const H = this.L.bodyH * (s?.scale ?? 0.5);
    const c = new Container();
    const art = artSprite('items', 'shovel', { k: (H * 0.62) / 800, anchor: 'center', placeholder: { w: 570, h: 567, color: 0x9a9a9a } });
    // 그림은 손잡이가 왼쪽 위, 날이 오른쪽 아래: 뒤집어 날이 왼쪽 아래(흙더미 쪽)로.
    art.scale.x *= -1;
    const hand = new Graphics();
    c.addChild(art, hand);
    c.zIndex = (s?.z ?? 30) + 0.05;
    this.root.addChild(c);
    return c;
  }

  /** 언니 가슴 앞 삽 자리 (패널 px). */
  private lenderHands(): { x: number; y: number } {
    const ld = this.hosts[1] ?? null;
    if (ld === null) return { x: this.L.w * 0.95, y: this.dirtTop - this.L.bodyH * 0.5 };
    const k = ld.k * Math.abs(ld.root.scale.y);
    const flip = ld.root.scale.x < 0 ? 1 : -1;
    return { x: ld.root.x + LENDER_SHOVELS.x * k * flip, y: ld.root.y + LENDER_SHOVELS.y * k };
  }

  /** 삽 하나가 언니 손에서 손님 손으로 포물선 (닿으면 손님이 든다). */
  private tossShovel(a: MonsterActor): void {
    const from = this.lenderHands();
    const H = this.L.bodyH * Math.abs(a.root.scale.y);
    const to = { x: a.root.x - H * 0.25, y: a.root.y - H * 0.45 };
    const dur = 0.55;
    this.held.set(a.id, this.time + dur);
    const ld = this.hosts[1] ?? null;
    if (ld !== null) {
      ld.cheer(false);
      if (!this.gatherSaid) {
        this.gatherSaid = true;
        this.lenderTalk.say(ld, '삽 받아요!', 1.1, this.time);
        this.anim.after(0.9, () => this.talk.say(this.hosts[0] ?? null, '보물이 묻혀 있단다!', 1.6, this.time));
      }
    }
    const fly = artSprite('items', 'shovel', { k: (H * 0.62) / 800, anchor: 'center', placeholder: { w: 570, h: 567, color: 0x9a9a9a } });
    fly.position.set(from.x, from.y);
    this.fx.addChild(fly);
    const lift = this.L.bodyH * 0.5;
    void this.anim
      .run(dur, (u) => {
        fly.position.set(lerp(from.x, to.x, u), lerp(from.y, to.y, u) - Math.sin(Math.PI * u) * lift);
        fly.rotation = -u * Math.PI * 2;
      }, { ease: ease.linear })
      .then(() => {
        fly.destroy({ children: true });
        if (!a.leaving && !a.root.destroyed) a.playMotion('squash', 0.6, 0.5);
      });
  }

  /** 판이 끝나 쉬면 삽이 언니에게 돌아간다. */
  private returnShovel(seat: number): void {
    const sh = this.shovels[seat] ?? null;
    if (sh === null || !sh.visible) return;
    sh.visible = false;
    const from = { x: sh.x, y: sh.y };
    const to = this.lenderHands();
    const H = this.L.bodyH * (this.seatAt[seat]?.scale ?? 0.5);
    const fly = artSprite('items', 'shovel', { k: (H * 0.62) / 800, anchor: 'center', placeholder: { w: 570, h: 567, color: 0x9a9a9a } });
    fly.position.set(from.x, from.y);
    this.fx.addChild(fly);
    const lift = this.L.bodyH * 0.45;
    void this.anim
      .run(0.5, (u) => {
        fly.position.set(lerp(from.x, to.x, u), lerp(from.y, to.y, u) - Math.sin(Math.PI * u) * lift);
        fly.rotation = u * Math.PI * 2;
        fly.alpha = u > 0.85 ? (1 - u) / 0.15 : 1;
      }, { ease: ease.linear, delay: seat * 0.08 })
      .then(() => fly.destroy({ children: true }));
  }

  // ── 흙더미·삽질 ───────────────────────────────────────────────────────

  private drawSpots(play: Extract<GroupPlay, { kind: 'dig' }> | null, t: number, dt: number): void {
    const L = this.L;
    for (let i = 0; i < this.spots.length; i++) {
      const sp = this.spots[i];
      if (sp === undefined) continue;
      const keys = play?.tracks[i] ?? [];
      const at = play?.findAt[i] ?? -1;
      // 판 깊이: 판이 끝나 쉬면 흙을 덮는다.
      const d = play !== null && keys.length > 0 ? trackAt(keys, t) : 0;
      sp.mound.scale.y = 1 - 0.22 * d;
      const hole = sp.hole.clear();
      if (d > 0.02) {
        const hx = sp.x + sp.w * 0.3;
        const hy = sp.y + sp.w * 0.04;
        const rx = sp.w * (0.08 + 0.17 * d);
        hole.ellipse(hx, hy, rx, rx * 0.36).fill({ color: 0x5c3a22 }).stroke({ color: INK, width: 2 });
        hole.ellipse(hx, hy + rx * 0.06, rx * 0.7, rx * 0.2).fill({ color: 0x3e2614 });
      }
      const a = this.actor(i);
      const sh = this.shovels[i] ?? null;
      if (a === null) continue;
      const H = L.bodyH * sp.row.s;
      const e = this.entryAt(i);
      const digging = play !== null && e !== undefined && d > 0 && at >= 0 && t < at;
      const holding = sh !== null && sh.visible;
      let shx = -H * 0.27;
      let shy = -H * 0.42;
      let shr = 0;
      if (digging) {
        // 삽질 한 번 (0.48초): 푹 (숙이며 날이 흙더미로) → 들어 올림 → 흙덩이를 뒤로 휙.
        const ph = (this.time * 2.1 + i * 0.37) % 1;
        const stab = ph < 0.42 ? ease.outQuad(ph / 0.42) : ph < 0.75 ? 1 - ease.inOutQuad((ph - 0.42) / 0.33) : 0;
        const toss = ph >= 0.75 ? Math.sin(((ph - 0.75) / 0.25) * Math.PI) : 0;
        this.move(a, -H * 0.04 * stab, 0, -0.26 * stab + 0.08 * toss);
        shx = lerp(-H * 0.27, -H * 0.42, stab) + H * 0.12 * toss;
        shy = lerp(-H * 0.42, -H * 0.2, stab) - H * 0.12 * toss;
        shr = lerp(0, -0.35, stab) + 0.7 * toss;
        const prev = (ph - dt * 2.1 + 1) % 1;
        if (prev < 0.75 && ph >= 0.75) clods(this.fx, this.anim, a.root.x + shx, a.root.y + shy, H * 0.07, 1, 3);
        if (prev < 0.4 && ph >= 0.4) puff(this.fx, this.anim, sp.x + sp.w * 0.3, sp.y, H * 0.28, 2, 0.6);
      } else if (e !== undefined && play === null) a.eager = 0.4;
      if (holding && sh !== null) {
        // 판 뒤 (나온 뒤)엔 삽을 세워 든다.
        const done = play !== null && at >= 0 && t >= at;
        if (done) {
          shx = -H * 0.2;
          shy = -H * 0.5;
          shr = 0.35;
        }
        const lean = a.rig.rot * Math.sign(a.root.scale.x);
        const cx = a.root.x + shx * Math.cos(lean) - shy * Math.sin(lean) + a.rig.dx * a.root.scale.x;
        const cy = a.root.y + shx * Math.sin(lean) + shy * Math.cos(lean) + a.rig.dy * Math.abs(a.root.scale.y);
        sh.position.set(cx, cy);
        sh.rotation = shr + lean;
        const hand = sh.getChildAt(1) as Graphics;
        const r = Math.max(3, H * 0.07);
        hand.clear().circle(H * 0.12, -H * 0.12, r).fill({ color: SPECIES[a.species].color }).stroke({ color: INK, width: 1.5 });
      }
    }
  }

  // ── 나온 것 ───────────────────────────────────────────────────────────

  private clearPops(): void {
    for (const p of this.pops) p.node.destroy({ children: true });
    this.pops = [];
    this.popsFor = null;
  }

  /** 판이 시작되면 나올 것들을 만들어 둔다 (숨겨 두고 때가 되면 튀어 오른다). */
  private buildPops(play: Extract<GroupPlay, { kind: 'dig' }>): void {
    this.clearPops();
    this.popsFor = play;
    const L = this.L;
    const add = (find: DigFind, spot: number, chest: number, at: number): void => {
      if (find === 'none' || at < 0) return;
      const a = FIND_ART[find];
      const pos = chest >= 0 ? this.chestAt(chest) : null;
      const sp = this.spots[spot];
      const rs = pos?.s ?? sp?.row.s ?? 0.5;
      const size = L.bodyH * rs * a.size * (find === 'chest' ? 1 : 1.25);
      const node = artSprite(a.group, a.key, { k: size / a.w, anchor: find === 'chest' ? 'bottom' : 'center', placeholder: { w: a.w, h: a.w * 0.8, color: a.color } });
      node.visible = false;
      node.zIndex = find === 'chest' ? (pos?.z ?? 34) : 52;
      this.root.addChild(node);
      const x = pos?.x ?? (sp !== undefined ? sp.x + sp.w * 0.3 : L.w / 2);
      const y = pos?.y ?? (sp !== undefined ? sp.y + sp.w * 0.04 : L.h * 0.7);
      this.pops.push({ node, find, spot, chest, at, x, y, size, fired: false });
    };
    play.finds.forEach((f, spot) => add(f, spot, f === 'chest' ? play.chest : -1, play.findAt[spot] ?? -1));
    const reveal = play.events.find((e) => e.type === 'reveal');
    if (reveal !== undefined && play.chest >= 0) add('chest', -1, play.chest, reveal.t);
  }

  private drawPops(play: Extract<GroupPlay, { kind: 'dig' }>, t: number): void {
    const L = this.L;
    for (const p of this.pops) {
      const u = t - p.at;
      p.node.visible = u >= 0;
      if (u < 0) continue;
      if (p.find === 'chest') {
        // 구멍에서 툭 튀어 나와 옆 땅에 떨어지고 (0.5초), 열린다.
        const rise = clamp01(u / 0.5);
        const hop = Math.sin(rise * Math.PI) * p.size * 0.9;
        const land = u > 0.5 ? Math.abs(Math.sin((u - 0.5) * 10)) * p.size * 0.06 * Math.max(0, 1 - (u - 0.5) / 0.6) : 0;
        p.node.position.set(p.x, p.y - hop - land);
        p.node.scale.set(lerp(0.4, 1, ease.outBack(rise)));
        if (u >= 0.65) p.node.setArt('map', 'treasure_chest_open');
        else p.node.setArt('map', 'treasure_chest');
      } else {
        // 머리 위로 빙글 튀어 올라 떠 있는다 (헌 장화·조약돌은 조금 낮게, 시무룩하게 기운다).
        const sp = this.spots[p.spot];
        const H = L.bodyH * (sp?.row.s ?? 0.5);
        const good = p.find === 'coins' || p.find === 'gem';
        const rise = clamp01(u / 0.45);
        const hx = p.x + H * 0.05;
        const hy = p.y - H * (good ? 1.05 : 0.85);
        const arc = Math.sin(rise * Math.PI) * H * 0.25;
        p.node.position.set(lerp(p.x, hx, rise), lerp(p.y, hy, ease.outQuad(rise)) - arc * (1 - rise) + Math.sin(this.time * 3 + p.spot) * H * 0.02 * rise);
        p.node.scale.set(lerp(0.3, 1, ease.outBack(rise)));
        p.node.rotation = (1 - rise) * Math.PI * 2 + (good ? 0 : 0.25 * rise);
      }
      if (!p.fired) {
        p.fired = true;
        // 판 중간에 열었으면 이미 지난 일은 조용히.
        if (u < 0.6) this.onPop(play, p);
      }
    }
  }

  /** 무언가 나온 순간: 흙먼지, 손님 반응, 상자면 반짝이·코인 분수·색종이·바로 옆 손님 '바로 옆이었는데!'. */
  private onPop(play: Extract<GroupPlay, { kind: 'dig' }>, p: Pop): void {
    const L = this.L;
    puff(this.fx, this.anim, p.x, p.y, L.sw * 0.07, 4, 1);
    const a = p.spot >= 0 ? this.actor(p.spot) : null;
    if (p.find === 'chest') {
      this.anim.after(0.65, () => {
        sparkles(this.fx, this.anim, p.x, p.y - p.size * 0.6, L.sw * 0.06, 10, L.sw * 0.16);
        this.coinFountain(p.x, p.y - p.size * 0.5);
        if (p.spot >= 0) confetti(this.fx, this.anim, L.w, L.h, 40);
      });
      if (a !== null) {
        a.showPose('joy', 2);
        a.playMotion('bigHop', 1.1, 1.6);
        a.emote('sparkle', 1);
      }
      if (p.spot < 0) {
        this.talk.say(this.hosts[0] ?? null, '여기였지!', 1, this.time);
        this.hosts[0]?.cheer(false);
      }
      // 상자 바로 옆을 판 손님: 상자가 열리고 나서 (할아버지 말풍선과 겹치지 않게).
      for (const e of this.group?.participants ?? []) {
        if (!digNear(play.chest, e.pick)) continue;
        const n = this.actor(e.seat);
        if (n === null) continue;
        const alive = (): boolean => !n.leaving && !n.root.destroyed;
        this.anim.after(0.9, () => {
          if (!alive()) return;
          n.showPose('agony', 1.8);
          n.playMotion('tremble', 1, 1.4);
          n.setBubble('바로 옆이었는데!');
        });
        this.anim.after(2.6, () => {
          if (alive()) n.setBubble(null);
        });
      }
      return;
    }
    if (a === null) return;
    const good = p.find === 'coins' || p.find === 'gem';
    if (good) {
      sparkles(this.fx, this.anim, p.x, p.y - L.bodyH * 0.5, L.sw * 0.045, 6, L.sw * 0.08);
      a.showPose('joy', 1.4);
      a.playMotion('hop', 1, 1);
      a.emote(p.find === 'gem' ? 'sparkle' : 'note', 0.9);
    } else {
      // 상자 바로 옆이면 상자가 나올 때 크게 아쉬워한다 (그전엔 갸웃).
      const near = digNear(play.chest, p.spot);
      a.showPose(near ? 'base' : 'sad', 1.2);
      a.playMotion(near ? 'shake' : 'slump', 0.7, 1);
      a.emote(near ? 'shock' : 'sweat', 0.8);
    }
  }

  /** 상자에서 코인이 퐁퐁 솟았다 떨어진다. */
  private coinFountain(x: number, y: number): void {
    const L = this.L;
    for (let i = 0; i < 9; i++) {
      const c = coinNode(L.sw * 0.04);
      c.position.set(x, y);
      this.fx.addChild(c);
      const dx = (Math.random() - 0.5) * L.sw * 0.22;
      const up = L.sw * (0.12 + Math.random() * 0.1);
      void this.anim
        .run(0.8 + Math.random() * 0.3, (u) => {
          c.position.set(x + dx * u, y - Math.sin(Math.PI * u) * up + L.sw * 0.05 * u);
          c.rotation = u * 8;
          c.alpha = u > 0.85 ? (1 - u) / 0.15 : 1;
        }, { ease: ease.linear, delay: i * 0.05 })
        .then(() => c.destroy({ children: true }));
    }
  }

  private onEvent(_play: Extract<GroupPlay, { kind: 'dig' }>, ev: GroupEvent): void {
    if (ev.type === 'dig') {
      const a = this.actor(ev.actor);
      a?.playMotion('squash', 0.6, 0.4);
    }
  }

  override onRoundFinished(seat: number, round: ActiveRound, payout: number): void {
    const a = this.actor(seat);
    if (a === null) return;
    const tier = round.outcome.tier;
    settle(a, tier, payout, this.time, { ui: this.ui, fx: this.fx, anim: this.anim, L: this.L }, Math.max(13, this.L.sw * 0.045));
    if (payout > 0) this.shakePot();
    if (tier === 'win' || tier === 'jackpot') for (const h of this.hosts) h?.cheer(tier === 'jackpot');
  }

  override destroy(): void {
    this.talk.clear();
    this.lenderTalk.clear();
    this.clearPops();
    super.destroy();
  }
}

/** 보물 지도 (양피지, 점선 길, 빨간 X). (0, 0) = 가운데. */
function treasureMap(size: number): Container {
  const c = new Container();
  const w = size;
  const h = size * 0.7;
  const line = Math.max(2, size * 0.035);
  const g = new Graphics();
  // 양피지: 위아래가 살짝 물결.
  const pts: number[] = [];
  const n = 6;
  for (let i = 0; i <= n; i++) pts.push(-w / 2 + (w * i) / n, -h / 2 + (i % 2 === 0 ? 0 : h * 0.04));
  for (let i = n; i >= 0; i--) pts.push(-w / 2 + (w * i) / n, h / 2 - (i % 2 === 0 ? 0 : h * 0.04));
  g.poly(pts).fill({ color: 0xf3e2b8 }).stroke({ color: INK, width: line, join: 'round' });
  // 말린 끝
  g.roundRect(-w / 2 - w * 0.05, -h / 2 - h * 0.04, w * 0.1, h * 1.08, w * 0.05).fill({ color: 0xe2c98f }).stroke({ color: INK, width: line });
  g.roundRect(w / 2 - w * 0.05, -h / 2 - h * 0.04, w * 0.1, h * 1.08, w * 0.05).fill({ color: 0xe2c98f }).stroke({ color: INK, width: line });
  // 점선 길
  const path = [
    [-w * 0.32, h * 0.22],
    [-w * 0.15, h * 0.05],
    [0, h * 0.15],
    [w * 0.12, -h * 0.05],
    [w * 0.22, -h * 0.12],
  ];
  for (let i = 0; i < path.length - 1; i++) {
    const [x0, y0] = path[i] as number[];
    const [x1, y1] = path[i + 1] as number[];
    for (let s = 0; s < 1; s += 0.34) g.moveTo(lerp(x0 ?? 0, x1 ?? 0, s), lerp(y0 ?? 0, y1 ?? 0, s)).lineTo(lerp(x0 ?? 0, x1 ?? 0, s + 0.17), lerp(y0 ?? 0, y1 ?? 0, s + 0.17));
  }
  g.stroke({ color: 0x8a5a34, width: line * 0.9, cap: 'round' });
  // 빨간 X
  const xr = w * 0.07;
  const xx = w * 0.28;
  const xy = -h * 0.16;
  g.moveTo(xx - xr, xy - xr).lineTo(xx + xr, xy + xr).moveTo(xx + xr, xy - xr).lineTo(xx - xr, xy + xr).stroke({ color: 0xd8483a, width: line * 1.5, cap: 'round' });
  // 작은 나무 둘
  g.circle(-w * 0.28, -h * 0.15, w * 0.05).fill({ color: 0x8fb36a }).stroke({ color: INK, width: line * 0.7 });
  g.circle(-w * 0.18, -h * 0.2, w * 0.04).fill({ color: 0x8fb36a }).stroke({ color: INK, width: line * 0.7 });
  c.addChild(g);
  return c;
}
