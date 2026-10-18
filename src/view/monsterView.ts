// 지도 위 손님 몬스터. 손님마다 MonsterView 하나: 몸 그림(monsters/<종>_<포즈>), 그림자(코드), 머리 위 이모트.
// sim 좌표를 부드럽게 따라가고(lerp), 걸을 때 통통, 떠다니는 종은 둥실. Motion 연출은 시간으로 계산한다 (트윈 객체를 만들지 않는다).
// 프레임마다 새 객체를 만들지 않는다: 포즈 그림 이름은 미리 만들어 두고, 계산 결과는 같은 객체에 쓴다.
// 단체 놀이 화면(view/group)은 손님 몸을 한 프레임씩 맡을 수 있다 (MonstersView.puppet: 씨름 밀기, 줄다리기 끌려가기, 벌러덩).
// 넷째 묶음 (DESIGN 3.7): 몸에 단 장신구 (view/accessory.ts AccessoryLayer, 몸 그릇의 자식이라 같이 뒤집힌다),
// 파산한 손님은 어두운 필터 (view/moodFilter.ts, 다 갚으면 LABOR.reliefSec 동안 걷힌다)·가끔 머리 위 먹구름·터덜터덜 걸음,
// 일터에서는 괭이·곡괭이질 (내려찍는 프레임에 struck: 먼지·돌 조각은 view/debtMap.ts), 기다릴 때는 쪼그리고 흔들흔들.
// 되찾는 장신구가 전당포에서 날아오는 동안은 몸에 그리지 않는다 (holdAccessory). 머리 위 표시(빚 게이지·표)는 drawX·drawY·emoteLift.

import { Container, Graphics, GraphicsContext, Sprite, Texture, type Filter } from 'pixi.js';
import { LABOR, SPECIES, SPECIES_IDS, type AccessoryId, type AccessorySlot, type GoodId, type SpeciesId } from '../data/defs.ts';
import type { SimApi } from '../sim/api.ts';
import type { Accessory, EmoteKind, Monster, MonsterId, Motion, Pose, Reaction } from '../sim/types.ts';
import { ART_SCALE, ArtNode, artMeta, artTexture, hasArt, monsterFoot } from './art.ts';
import { AccessoryLayer, accessoryAnchors, accessoryPlacement } from './accessory.ts';
import type { FxLayer } from './fx.ts';
import { clamp, follow, type ViewRect } from './mapUtil.ts';
import { debtFilters } from './moodFilter.ts';

/** 그림이 없을 때 자리 표시 색 (defs.ts SPECIES.color). */
const SPECIES_COLOR = {} as Record<SpeciesId, number>;
for (const s of SPECIES_IDS) SPECIES_COLOR[s] = SPECIES[s].color;

const POSES: readonly Pose[] = ['base', 'joy', 'agony', 'sad'];
/** 종·포즈별 그림 key (프레임마다 문자열을 만들지 않게 미리). */
const POSE_KEY = {} as Record<SpeciesId, Record<Pose, string>>;
for (const s of SPECIES_IDS) {
  const row = {} as Record<Pose, string>;
  for (const p of POSES) row[p] = `${s}_${p}`;
  POSE_KEY[s] = row;
}

/** 걷기 한 걸음 (세계 px, 반 주기). */
const STRIDE = 30;
/** 떠다니는 종이 땅에서 떠 있는 높이. */
const HOVER = 16;
/** 이모트 크기 (세계 px, 긴 변). */
const EMOTE_SIZE = 46;
/** 파산한 손님 이모트를 넓게 볼 때 키우는 배율의 끝. */
const GLOOMY_EMOTE_MAX = 1.15;
/** sim 좌표를 따라가는 빠르기. 이보다 멀리 떨어지면 바로 옮긴다. */
const FOLLOW_RATE = 14;
const SNAP_DIST = 260;
const LEAVE_FADE = 0.55;
const APPEAR_SEC = 0.35;
/** 파산한 손님 머리 위 먹구름: 이 초마다 한 번 (일터에서 일하고 기다릴 때는 GLOOM_YARD초마다: 여럿이 한꺼번에 시끄럽지 않게), 이만큼 보인다. */
const GLOOM_EVERY = 7;
const GLOOM_YARD = 14;
const GLOOM_SHOW = 2.4;
/** 먹구름을 띄운 뒤 다음 박자를 이만큼까지 늦춘다 (초, 손님마다 무작위). */
const GLOOM_JITTER = 5;
/**
 * 연장 (items/<key>): 손잡이 끝 = 그림 안 비율 (gx, gy), base = 그 그림의 손잡이 → 머리 방향 (왼쪽으로 뒤집어 든 뒤 왼쪽 수평에서 위로, rad),
 * up·down = 들었을 때·내려찍었을 때의 방향 (rad, 같은 기준), sec = 한 번 휘두르는 초, size = 긴 변 (세계 px).
 * 그림은 머리가 오른쪽 위라 왼쪽으로 뒤집어 든다 (몸 그림처럼 왼쪽을 본다).
 */
interface ToolDef {
  readonly gx: number;
  readonly gy: number;
  readonly base: number;
  readonly up: number;
  readonly down: number;
  readonly sec: number;
  readonly size: number;
}
const TOOLS: Readonly<Record<string, ToolDef>> = {
  hoe: { gx: 0.07, gy: 0.87, base: Math.atan2(65, 130), up: 1.3, down: -0.45, sec: 1.15, size: 60 },
  pickaxe: { gx: 0.25, gy: 0.94, base: Math.atan2(110, 40), up: 1.95, down: 0.05, sec: 1.3, size: 58 },
};
/** 그림이 없을 때 코드로 그린 연장 (손잡이가 왼쪽 위 45°). */
const TOOL_FALLBACK: ToolDef = { gx: 0, gy: 0, base: Math.PI / 4, up: 1.3, down: -0.4, sec: 1.2, size: 46 };
/** 휘두르기 한 번 (u 0~1): 들어 올리기 → 잠깐 멈춤 → 톡 내려찍기 (SWING_HIT) → 반동. 돌려주는 값: 내려찍은 쪽 0 ~ 든 쪽 1. */
const SWING_HIT = 0.76;
function swingLift(u: number): number {
  if (u < 0.5) {
    const v = u / 0.5;
    return v * v * (3 - 2 * v);
  }
  if (u < 0.66) return 1 + Math.sin(((u - 0.5) / 0.16) * Math.PI) * 0.04;
  if (u < SWING_HIT) {
    const v = (u - 0.66) / (SWING_HIT - 0.66);
    return 1 - v * v;
  }
  const v = (u - SWING_HIT) / (1 - SWING_HIT);
  return Math.sin(v * Math.PI) * 0.07 * (1 - v);
}

interface MotionOut {
  dx: number;
  dy: number;
  rot: number;
  sx: number;
  sy: number;
  flip: number;
}

/** Motion 연출 한 순간 (t초, 반응 시간 dur, 세기 k). 끝났으면 false. */
function motionAt(type: Motion, t: number, dur: number, k: number, facing: number, o: MotionOut): boolean {
  o.dx = 0;
  o.dy = 0;
  o.rot = 0;
  o.sx = 1;
  o.sy = 1;
  o.flip = 1;
  // 계속되는 연출은 끝 0.3초 동안 잦아든다.
  const fade = clamp((dur - t) / 0.3, 0, 1);
  switch (type) {
    case 'hop': {
      const D = 0.5;
      if (t >= D) return false;
      const s = Math.sin((Math.PI * t) / D);
      o.dy = -s * 26 * k;
      o.sy = 1 + 0.08 * k * s;
      o.sx = 1 - 0.05 * k * s;
      return true;
    }
    case 'bigHop': {
      const D = 1.15;
      if (t >= D) return false;
      const u = t / D;
      if (u < 0.12) {
        const s = Math.sin((u / 0.12) * Math.PI);
        o.sy = 1 - 0.2 * k * s;
        o.sx = 1 + 0.14 * k * s;
      } else if (u < 0.62) {
        const v = (u - 0.12) / 0.5;
        const s = Math.sin(Math.PI * v);
        o.dy = -s * 62 * k;
        o.sy = 1 + 0.1 * k * s;
        o.sx = 1 - 0.07 * k * s;
        o.rot = Math.sin(v * Math.PI * 2) * 0.1 * k;
      } else if (u < 0.7) {
        const s = Math.sin(((u - 0.62) / 0.08) * Math.PI);
        o.sy = 1 - 0.14 * k * s;
        o.sx = 1 + 0.1 * k * s;
      } else {
        const s = Math.sin(Math.PI * ((u - 0.7) / 0.3));
        o.dy = -s * 26 * k;
        o.sy = 1 + 0.05 * k * s;
      }
      return true;
    }
    case 'shake': {
      const D = 0.75;
      if (t >= D) return false;
      const a = 1 - t / D;
      o.dx = Math.sin(t * 46) * 7 * k * a;
      o.rot = Math.sin(t * 46 + 1) * 0.07 * k * a;
      return true;
    }
    case 'squash': {
      const D = 0.7;
      if (t >= D) return false;
      const u = t / D;
      const s = Math.sin(u * Math.PI * 3) * (1 - u);
      o.sy = 1 - 0.22 * k * s;
      o.sx = 1 + 0.18 * k * s;
      return true;
    }
    case 'spin': {
      // 3/4 그림이라 제자리에서 좌우로 두 번 돌아 보인다.
      const D = 0.85;
      if (t >= D) return false;
      const u = t / D;
      o.flip = Math.cos(u * Math.PI * 4);
      o.dy = -Math.sin(Math.PI * u) * 18 * k;
      return true;
    }
    case 'slump': {
      if (t >= dur) return false;
      const e = (1 - (1 - Math.min(1, t / 0.28)) ** 2) * fade;
      o.sy = 1 - 0.17 * k * e;
      o.sx = 1 + 0.1 * k * e;
      o.rot = 0.06 * facing * e;
      o.dy = 2 * e;
      return true;
    }
    case 'tremble': {
      if (t >= dur) return false;
      const a = fade * Math.min(1, t / 0.1);
      o.dx = Math.sin(t * 75) * 2.4 * k * a;
      o.sy = 1 - 0.035 * k * a * Math.abs(Math.sin(t * 19));
      return true;
    }
    case 'bounceLoop': {
      if (t >= dur) return false;
      const s = Math.abs(Math.sin(t * Math.PI * 2.4));
      const c = (1 - s) * (1 - s);
      o.dy = -s * 18 * k * fade;
      o.sy = 1 - 0.1 * k * c * fade + 0.04 * k * s * fade;
      o.sx = 1 + 0.07 * k * c * fade;
      return true;
    }
    default:
      return false;
  }
}

function backOut(t: number): number {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

const MO: MotionOut = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, flip: 1 };

/**
 * 단체 놀이 화면이 이 프레임에 맡기는 손님 몸 (MonstersView.puppet). 매 프레임 다시 준다: 손님을 그린 뒤 풀린다.
 * sim 좌표·상태는 그대로이고 그림만 바뀐다 (누르기 상자도 sim 좌표).
 */
export interface MonsterPuppet {
  /** 발 자리를 옮긴다 (세계 px, 그림자·이모트도 같이). */
  readonly dx?: number;
  readonly dy?: number;
  /** 몸을 그림자에서 띄운다 (세계 px, 위가 +). */
  readonly lift?: number;
  /** 몸 기울기 (rad, 발 기준, + = 시계 방향). 벌러덩 = ±π/2. */
  readonly rot?: number;
  readonly sx?: number;
  readonly sy?: number;
  /** 포즈 그림 (sim pose 대신). */
  readonly pose?: Pose;
  /** 바라보는 쪽 (sim facing 대신, 1 = 오른쪽). */
  readonly facing?: -1 | 1;
  /** 걷기·숨쉬기·반응 연출을 끄고 몸을 통째로 맡는다. */
  readonly still?: boolean;
  /** 투명도 배수. */
  readonly alpha?: number;
}

/** 손님 하나의 화면. */
export class MonsterView {
  readonly id: MonsterId;
  readonly species: SpeciesId;
  readonly floats: boolean;
  /** 물체층 (y 정렬). 위치 = 발. */
  readonly node = new Container();
  /** 그림자층. */
  readonly shadow: Graphics;
  /** 효과층의 이모트. */
  readonly emote = new Sprite(Texture.EMPTY);
  private readonly body = new Container();
  /** 몸 그림 + 장신구 (어둠 필터는 여기에만: 손에 든 연장은 밝게 보이게 body에 따로). */
  private readonly skin = new Container();
  private readonly art: ArtNode;
  /** 몸에 단 장신구 (몸 그릇의 자식). */
  private readonly acc: AccessoryLayer;
  private accSig = '';
  /** 어둠 (0 = 그대로, 1 = 파산 모습)과 목표, 지금 단 필터. */
  private dark = 0;
  private darkTarget = 0;
  private darkFilters: readonly Filter[] | null = null;
  /** 파산: 먹구름 시계 (MonstersView가 이모트를 띄운다). */
  gloomy = false;
  gloomT = 0;
  /** 일터: 손에 든 연장 (items/hoe·pickaxe, 없으면 null)과 그 이름·모양, 손 자리, 일 시계, 기다릴 때 쪼그림. */
  private tool: Container | null = null;
  private toolKey = '';
  private toolDef: ToolDef = TOOL_FALLBACK;
  private handX = 0;
  private handY = 0;
  private wantTool = '';
  private workT = 0;
  private squat = false;
  /** 이 프레임에 연장이 땅을 내려찍었다 (그 끝 자리 strikeX·Y, 세계 좌표). 일터 먼지·돌 조각은 debtMap.ts가. */
  struck = false;
  strikeX = 0;
  strikeY = 0;
  /** 되찾는 장신구가 날아오는 동안 몸에 그리지 않는다 (key → 남은 초). */
  private readonly held = new Map<AccessoryId, number>();
  private lastAcc: readonly Accessory[] = [];
  /** 이 프레임에 그린 발 자리 (단체 놀이가 맡긴 몸까지 더한, 세계 좌표): 머리 위 표시가 따라간다. */
  drawX = 0;
  drawY = 0;
  private bodyDx = 0;
  /** 이모트를 더 올린다 (머리 위에 빚 게이지·표가 있을 때, 세계 px). 화면 쪽이 매 프레임 정한다. */
  emoteLift = 0;

  /** 화면 위치 (발, 세계 좌표). */
  x = 0;
  y = 0;
  private vx = 0;
  private vy = 0;
  facing: -1 | 1 = -1;
  private flip = 1;
  private walkPhase = 0;
  private walkBlend = 0;
  private readonly seed: number;
  private pose: Pose | '' = '';
  private mood = 60;
  /** 머리 꼭대기 높이 (발에서 위로, 세계 px)와 몸 반폭. */
  readonly headH: number;
  readonly halfW: number;
  private readonly shadowRx: number;
  /** 지금 몸이 들린 높이 (점프·둥실, 위가 음수). */
  bodyDy = 0;

  private motion: Motion = 'none';
  private motionT = 0;
  private motionDur = 0;
  private motionK = 1;

  private emoteT = -1;
  private emoteDur = 0;
  private emoteTexSize = 1;

  seen = 0;
  leaving = false;
  dead = false;
  /** 이 프레임에 단체 놀이 화면이 맡긴 몸 (없으면 null, 그린 뒤 풀린다). */
  puppet: MonsterPuppet | null = null;
  private fadeT = 0;
  private appear = 1;
  private placed = false;

  constructor(m: Monster, shadowCtx: GraphicsContext, appear: boolean) {
    this.id = m.id;
    this.species = m.species;
    this.floats = SPECIES[m.species].floats;
    this.seed = (m.id * 2.399) % (Math.PI * 2);
    // 처음부터 파산한 손님(불러온 저장·한꺼번에 온 채무자)도 먹구름 박자가 손님마다 다르게.
    this.gloomT = this.gloomStart();
    const k = ART_SCALE.monster;
    this.art = new ArtNode({ k, anchor: monsterFoot(m.species), placeholder: { w: 440, h: 460, color: SPECIES_COLOR[m.species] } });
    const meta = artMeta('monsters', POSE_KEY[m.species].base);
    const footY = monsterFoot(m.species).y;
    this.headH = meta !== undefined ? (footY - meta.trim.y) * k : 460 * k;
    this.halfW = meta !== undefined ? (meta.trim.w * k) / 2 : 220 * k;
    this.shadowRx = Math.max(22, this.halfW * 0.72);
    this.shadow = new Graphics(shadowCtx);
    this.shadow.eventMode = 'none';
    this.acc = new AccessoryLayer({ k });
    this.skin.addChild(this.acc.back, this.art, this.acc);
    this.body.addChild(this.skin);
    this.node.addChild(this.body);
    this.node.eventMode = 'none';
    // 손으로 가려 내지만(culled), CullerPlugin이 있어도 같은 답이 나오게.
    this.node.cullable = true;
    this.node.cullableChildren = false;
    this.shadow.cullable = true;
    this.emote.cullable = true;
    this.emote.anchor.set(0.5, 1);
    this.emote.visible = false;
    this.emote.eventMode = 'none';
    this.appear = appear ? 0 : 1;
    this.setPose(m.pose);
    this.mood = m.mood;
    this.facing = m.facing;
    this.flip = m.facing === 1 ? -1 : 1;
  }

  private setPose(p: Pose): void {
    if (p === this.pose) return;
    this.pose = p;
    const keys = POSE_KEY[this.species];
    // 포즈 그림이 아직 없으면 기본 그림 (자리 표시보다 낫다).
    const usePose = hasArt('monsters', keys[p]) || !hasArt('monsters', keys.base);
    const key = usePose ? keys[p] : keys.base;
    // 포즈마다 자기 발끝을 기준점으로 (발이 그림자에서 뜨거나 가라앉지 않게).
    this.art.setArt('monsters', key, monsterFoot(this.species, usePose ? p : 'base'));
    this.acc.setPose(this.species, usePose ? p : 'base');
    if (this.tool !== null) this.placeTool();
  }

  /** 연장을 옆구리 붙는 점(손 높이)에 (포즈가 바뀌면 다시). */
  private placeTool(): void {
    const t = this.tool;
    if (t === null) return;
    const pose = this.pose === '' ? 'base' : this.pose;
    const a = accessoryAnchors(this.species, pose).side;
    const f = monsterFoot(this.species, pose);
    const k = ART_SCALE.monster;
    // 왼쪽을 보는 몸의 앞(왼쪽) 손 높이.
    this.handX = (a.x - f.x) * k - this.halfW * 0.9;
    this.handY = (a.y - f.y) * k - 6;
    t.position.set(this.handX, this.handY);
  }

  /** 연장을 바꾼다 ('' = 없음). 손잡이 끝이 손에 오게, 머리가 앞(왼쪽)으로. 그림이 없으면 코드로 막대 + 머리. */
  private setTool(key: string): void {
    if (key === this.toolKey) return;
    this.toolKey = key;
    this.tool?.destroy({ children: true });
    this.tool = null;
    if (key === '') return;
    const c = new Container();
    const tex = artTexture('items', key);
    const def = TOOLS[key];
    if (tex !== undefined && def !== undefined) {
      const sp = new Sprite(tex);
      sp.anchor.set(def.gx, def.gy);
      const s = def.size / Math.max(1, tex.width, tex.height);
      sp.scale.set(-s, s);
      c.addChild(sp);
      this.toolDef = def;
    } else {
      const g = new Graphics();
      g.moveTo(0, 0).lineTo(-30, -30).stroke({ color: 0xa0703f, width: 5, cap: 'round' });
      if (key === 'pickaxe') g.moveTo(-42, -22).quadraticCurveTo(-34, -40, -18, -40).stroke({ color: 0x8a847d, width: 6, cap: 'round' });
      else g.moveTo(-40, -30).lineTo(-26, -38).stroke({ color: 0x8a847d, width: 7, cap: 'round' });
      c.addChild(g);
      this.toolDef = TOOL_FALLBACK;
    }
    this.body.addChild(c);
    this.tool = c;
    // 손님마다 휘두르는 박자가 다르게.
    this.workT = (this.seed / (Math.PI * 2)) * this.toolDef.sec;
    this.placeTool();
  }

  /** 단 장신구 (되찾아 날아오는 중인 것은 빼고). 같으면 아무것도 안 한다. */
  private applyAccessories(acc: readonly Accessory[]): void {
    this.lastAcc = acc;
    let sig = '';
    for (let i = 0; i < acc.length; i++) {
      const k = acc[i]?.key;
      if (k !== undefined && !this.held.has(k)) sig += k + ',';
    }
    if (sig === this.accSig) return;
    this.accSig = sig;
    this.acc.setAccessories(this.held.size === 0 ? acc : acc.filter((a) => !this.held.has(a.key)));
  }

  /** 장신구 key를 sec초 동안 몸에 그리지 않는다 (되찾는 장신구가 전당포에서 날아오는 동안). releaseAccessory로 일찍 풀 수 있다. */
  holdAccessory(key: AccessoryId, sec: number): void {
    this.held.set(key, sec);
    this.applyAccessories(this.lastAcc);
  }

  releaseAccessory(key: AccessoryId): void {
    if (!this.held.delete(key)) return;
    this.applyAccessories(this.lastAcc);
  }

  /**
   * 장신구 key (자리 slot)의 지금 모습 (세계 좌표, 몸 기울기·눌림은 빼고): 붙는 점 x·y, 그 장신구 폭 w (세계 px), 기울기 rot, 좌우 flip (1 = 그림 그대로),
   * 그림 안 붙는 점 비율 ax·ay. 몸에 그린 장신구(AccessoryLayer)와 같은 accessoryPlacement라 날아가고 날아오는 장신구가 몸의 그 자리에서 떠나고 닿는다.
   */
  accessoryAt(key: AccessoryId, slot: AccessorySlot, out: { x: number; y: number; w: number; rot: number; flip: number; ax: number; ay: number }): void {
    const pose = this.pose === '' ? 'base' : hasArt('monsters', POSE_KEY[this.species][this.pose]) ? this.pose : 'base';
    const a = accessoryPlacement(this.species, pose, key, slot);
    const f = monsterFoot(this.species, pose);
    const k = ART_SCALE.monster;
    const flip = this.flip < 0 ? -1 : 1;
    out.x = this.drawX + this.bodyDx + (a.x - f.x) * k * flip;
    out.y = this.drawY + this.bodyDy + (a.y - f.y) * k;
    out.w = a.width * k;
    out.rot = a.rot * flip;
    out.flip = flip;
    out.ax = a.ax;
    out.ay = a.ay;
  }

  /** sim 상태를 따라간다 (매 프레임). */
  sync(m: Monster, dt: number): void {
    const tx = m.pos.x;
    const ty = m.pos.y;
    const ox = this.x;
    const oy = this.y;
    if (!this.placed) {
      this.x = tx;
      this.y = ty;
      this.placed = true;
    } else {
      const dx = tx - this.x;
      const dy = ty - this.y;
      if (dx * dx + dy * dy > SNAP_DIST * SNAP_DIST) {
        this.x = tx;
        this.y = ty;
      } else {
        const f = follow(FOLLOW_RATE, dt);
        this.x += dx * f;
        this.y += dy * f;
      }
    }
    const mx = this.x - ox;
    const my = this.y - oy;
    const moved = Math.sqrt(mx * mx + my * my);
    if (dt > 0 && moved < SNAP_DIST) {
      this.vx = mx / dt;
      this.vy = my / dt;
      const walking = moved / dt > 14 ? 1 : 0;
      this.walkBlend += (walking - this.walkBlend) * follow(8, dt);
      this.walkPhase += (moved / STRIDE) * Math.PI;
    }
    this.facing = this.puppet?.facing ?? m.facing;
    this.mood = m.mood;
    this.setPose(this.puppet?.pose ?? m.pose);
    // 넷째 묶음: 장신구, 어둠, 일터의 연장·쪼그림.
    this.applyAccessories(m.accessories);
    this.darkTarget = m.bankrupt === true ? 1 : 0;
    this.gloomy = m.bankrupt === true && m.phase !== 'playing';
    const lab = m.labor;
    this.wantTool = m.phase === 'working' && lab !== null && lab !== undefined ? LABOR.facilities[lab.facility].tool : '';
    this.squat = m.phase === 'waitWork';
  }

  /** 결과 반응 (구경꾼은 작게). */
  react(r: Reaction, small: boolean, emoteTex: Texture | null): void {
    if (r.motion !== 'none') {
      this.motion = r.motion;
      this.motionT = 0;
      this.motionDur = Math.max(0.5, r.duration);
      this.motionK = clamp(r.intensity, 0.5, 2) * (small ? 0.7 : 1);
    }
    if (emoteTex !== null) this.showEmote(emoteTex, Math.max(1, r.duration));
  }

  /** 작은 통통 (응원·간식). */
  hop(k: number): void {
    this.motion = 'hop';
    this.motionT = 0;
    this.motionDur = 0.5;
    this.motionK = k;
  }

  showEmote(tex: Texture, duration: number): void {
    this.emote.texture = tex;
    this.emoteTexSize = Math.max(1, tex.width, tex.height);
    this.emoteT = 0;
    this.emoteDur = duration;
    this.emote.visible = true;
    this.emote.alpha = 1;
  }

  startLeaving(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.fadeT = 0;
  }

  /** 머리 위 한 점 (효과 위치). */
  headX(): number {
    return this.x;
  }
  headY(): number {
    return this.y + this.bodyDy - this.headH;
  }

  /** 넉넉한 누르기 상자. */
  hits(wx: number, wy: number): boolean {
    if (this.leaving) return false;
    const hw = Math.max(46, this.halfW + 16);
    const top = this.y - this.headH - (this.floats ? HOVER + 10 : 0) - 26;
    return wx >= this.x - hw && wx <= this.x + hw && wy >= top && wy <= this.y + 22;
  }

  /** 그리기 (매 프레임). time = 누적 초, emoteScale = 확대가 작을 때 이모트를 조금 키우는 배율. */
  update(dt: number, time: number, view: ViewRect, emoteScale: number): void {
    if (this.leaving) {
      this.fadeT += dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.fadeT >= LEAVE_FADE) this.dead = true;
    }
    if (this.appear < 1) this.appear = Math.min(1, this.appear + dt / APPEAR_SEC);

    // 바라보는 쪽 (그림은 왼쪽을 본다). 0을 지나며 살짝 납작해져 몸을 돌리는 것처럼.
    const flipTarget = this.facing === 1 ? -1 : 1;
    if (this.flip !== flipTarget) {
      const step = dt * 12;
      this.flip = this.flip < flipTarget ? Math.min(flipTarget, this.flip + step) : Math.max(flipTarget, this.flip - step);
    }

    let dx = 0;
    let dy = 0;
    let rot = 0;
    let sx = 1;
    let sy = 1;
    const wb = this.walkBlend;
    // 파산한 손님 (어둠이 반 넘게): 터덜터덜 (덜 통통, 많이 숙이고, 어깨가 좌우로 흔들), 서 있을 때 느린 한숨 숨쉬기.
    const gloom = this.dark > 0.5;
    const droop = (this.mood < 25 || gloom) && wb > 0.05;
    if (this.floats) {
      dy -= HOVER + Math.sin(time * (gloom ? 1.4 : 2.3) + this.seed) * (gloom ? 3 : 5);
      rot += 0.07 * this.facing * wb;
    } else {
      const s = Math.sin(this.walkPhase);
      const bob = Math.abs(s);
      dy -= bob * (gloom ? 1.6 : droop ? 3 : 5.5) * wb;
      rot += s * (gloom ? 0.04 : 0.065) * wb;
      sy *= 1 - (1 - bob) * 0.04 * wb;
    }
    if (droop) {
      // 기운 없는 걸음: 살짝 납작하고 앞으로 숙인다 (파산이면 더).
      sy *= gloom ? 0.92 : 0.95;
      sx *= gloom ? 1.05 : 1.03;
      rot += (gloom ? 0.1 : 0.05) * this.facing * wb;
      if (gloom) rot += Math.sin(this.walkPhase * 0.5) * 0.035 * wb;
    }
    // 서 있을 때 숨쉬기 (파산이면 느리고 깊은 한숨).
    const breathe = Math.sin(time * (gloom ? 1.1 : 2.2) + this.seed) * (gloom ? 0.022 : 0.014) * (1 - wb);
    sy *= 1 + breathe;
    sx *= 1 - breathe * 0.5;
    // 일터: 쪼그리고 기다리기 (흔들흔들), 괭이·곡괭이질 (들 때 뒤로 젖히고, 내려찍을 때 몸이 눌리며 앞으로).
    if (this.squat) {
      sy *= 0.86;
      sx *= 1.06;
      rot += Math.sin(time * 1.3 + this.seed) * 0.03;
    }
    if (this.wantTool !== this.toolKey) this.setTool(this.wantTool);
    this.struck = false;
    if (this.tool !== null) {
      const d = this.toolDef;
      const u0 = (this.workT % d.sec) / d.sec;
      this.workT += dt;
      const u = (this.workT % d.sec) / d.sec;
      const lift = swingLift(u);
      const ang = d.down + (d.up - d.down) * lift;
      this.tool.rotation = ang - d.base;
      const hit = u >= SWING_HIT ? Math.sin(Math.min(1, (u - SWING_HIT) / 0.14) * Math.PI) : 0;
      sy *= (1 + 0.03 * lift) * (1 - 0.06 * hit);
      sx *= 1 + 0.035 * hit;
      rot += (0.06 * hit - 0.04 * lift) * this.facing;
      // 내려찍은 프레임 (u가 SWING_HIT를 지났다): 연장 끝 자리.
      if ((u0 < SWING_HIT && u >= SWING_HIT) || (u < u0 && u >= SWING_HIT)) {
        this.struck = true;
        const len = d.size * 0.92;
        const f = this.flip < 0 ? -1 : 1;
        this.strikeX = this.x + (this.handX - Math.cos(d.down) * len) * f;
        this.strikeY = this.y + this.handY - Math.sin(d.down) * len;
      }
    }
    // 되찾는 장신구 기다림 (시간이 다 되면 다시 그린다).
    if (this.held.size > 0) {
      for (const [k, t] of this.held) {
        if (t - dt <= 0) this.releaseAccessory(k);
        else this.held.set(k, t - dt);
      }
    }
    // 어둠 (파산): 다 갚으면 LABOR.reliefSec 동안 걷힌다.
    if (this.dark !== this.darkTarget) {
      const step = dt / LABOR.reliefSec;
      this.dark = this.dark < this.darkTarget ? Math.min(this.darkTarget, this.dark + step) : Math.max(this.darkTarget, this.dark - step);
      const f = debtFilters(this.dark);
      if (f !== this.darkFilters) {
        this.darkFilters = f;
        this.skin.filters = f === null ? null : [...f];
      }
    }
    // 먹구름 박자는 손님마다 다르게 (한꺼번에 뜨지 않게).
    if (this.gloomy) this.gloomT += dt;
    else this.gloomT = this.gloomStart();

    let flipMul = 1;
    if (this.motion !== 'none') {
      this.motionT += dt;
      if (motionAt(this.motion, this.motionT, this.motionDur, this.motionK, this.facing, MO)) {
        dx += MO.dx;
        dy += MO.dy;
        rot += MO.rot;
        sx *= MO.sx;
        sy *= MO.sy;
        flipMul = MO.flip;
      } else {
        this.motion = 'none';
      }
    }

    // 단체 놀이 화면이 맡긴 몸.
    const pp = this.puppet;
    let px = 0;
    let py = 0;
    if (pp !== null) {
      if (pp.still === true) {
        dx = 0;
        dy = this.floats ? -HOVER : 0;
        rot = 0;
        sx = 1;
        sy = 1;
        flipMul = 1;
      }
      px = pp.dx ?? 0;
      py = pp.dy ?? 0;
      dy -= pp.lift ?? 0;
      rot += pp.rot ?? 0;
      sx *= pp.sx ?? 1;
      sy *= pp.sy ?? 1;
    }

    // 나타날 때 톡, 떠날 때 작아지며 흐려짐.
    let a = pp?.alpha ?? 1;
    let pop = 1;
    if (this.appear < 1) {
      a = this.appear;
      pop = 0.6 + 0.4 * backOut(this.appear);
    }
    if (this.leaving) {
      const u = Math.min(1, this.fadeT / LEAVE_FADE);
      a *= 1 - u;
      pop *= 1 - 0.25 * u;
    }

    this.bodyDy = dy;
    this.bodyDx = dx;
    const fx = this.x + px;
    const fy = this.y + py;
    this.drawX = fx;
    this.drawY = fy;
    this.node.position.set(fx, fy);
    const z = Math.round(fy);
    if (this.node.zIndex !== z) this.node.zIndex = z;
    this.body.position.set(dx, dy);
    this.body.rotation = rot;
    this.body.scale.set(this.flip * flipMul * sx * pop, sy * pop);
    this.node.alpha = a;

    // 그림자: 몸이 높이 뜰수록 작고 옅게.
    const lift = this.floats ? -dy - HOVER : -dy;
    const ss = clamp(1 - lift / 200, 0.55, 1.05) * pop;
    this.shadow.position.set(fx, fy);
    this.shadow.scale.set(this.shadowRx * ss, this.shadowRx * 0.32 * ss);
    this.shadow.alpha = a * clamp(1 - lift / 260, 0.4, 1);

    // 이모트: 톡 튀어나와 떠 있다가 사라진다.
    if (this.emoteT >= 0) {
      this.emoteT += dt;
      const e = this.emoteT;
      if (e >= this.emoteDur || this.leaving) {
        this.emoteT = -1;
        this.emote.visible = false;
      } else {
        const p = e < 0.28 ? backOut(e / 0.28) : 1;
        // 파산한 손님 (머리 위에 게이지가 있다)은 넓게 볼 때 덜 키운다 (먹구름·땀방울이 머리보다 커지지 않게).
        const s = (EMOTE_SIZE / this.emoteTexSize) * p * (this.gloomy ? Math.min(emoteScale, GLOOMY_EMOTE_MAX) : emoteScale);
        this.emote.scale.set(s);
        this.emote.position.set(fx + 6, fy + dy - this.headH - 10 - this.emoteLift + Math.sin(e * 3.2) * 3);
        this.emote.alpha = e > this.emoteDur - 0.35 ? (this.emoteDur - e) / 0.35 : 1;
      }
    }

    // 화면 밖이면 그리지 않는다.
    const m = this.halfW + 40;
    const culled = this.x + m < view.x0 || this.x - m > view.x1 || this.y + 40 < view.y0 || this.y - this.headH - 140 > view.y1;
    this.node.culled = culled;
    this.shadow.culled = culled;
    this.emote.culled = culled;
  }

  /** 먹구름 시계의 처음 값: 손님마다 다른 박자 (짧은 간격 GLOOM_EVERY 안에서 고르게 퍼진다). */
  private gloomStart(): number {
    return (this.seed / (Math.PI * 2)) * GLOOM_EVERY;
  }

  /** 먹구름 이모트를 띄울 때인가 (파산한 손님, 이모트가 없을 때, GLOOM_EVERY초마다). */
  wantsGloom(): boolean {
    if (!this.gloomy || this.emoteT >= 0 || this.leaving) return false;
    if (this.gloomT < (this.wantTool !== '' || this.squat ? GLOOM_YARD : GLOOM_EVERY)) return false;
    // 0이 아니라 조금씩 다르게 되돌린다: 다른 이모트가 끝나기를 같이 기다린 손님들이 같은 박자로 묶이지 않게 (화면 연출용 무작위).
    this.gloomT = -Math.random() * GLOOM_JITTER;
    return true;
  }

  destroy(): void {
    this.node.destroy({ children: true });
    this.shadow.destroy();
    this.emote.destroy();
  }
}

export interface MonsterLayers {
  readonly objects: Container;
  readonly shadows: Container;
  readonly effects: Container;
}

/** 모든 손님 화면. sim.state.monsters와 맞춘다 (이벤트를 놓쳐도 다음 프레임에 맞는다). */
export class MonstersView {
  private readonly sim: SimApi;
  private readonly layers: MonsterLayers;
  private readonly fx: FxLayer;
  private readonly views: MonsterView[] = [];
  private readonly byId = new Map<MonsterId, MonsterView>();
  private readonly flatShadow: GraphicsContext;
  private readonly softShadow: GraphicsContext;
  private frame = 0;

  constructor(sim: SimApi, layers: MonsterLayers, fx: FxLayer) {
    this.sim = sim;
    this.layers = layers;
    this.fx = fx;
    // 그림자는 코드로 (그림에 넣지 않는다). 모두 같은 도형을 나눠 쓴다.
    this.flatShadow = new GraphicsContext().ellipse(0, 0, 1, 1).fill({ color: 0x000000, alpha: 0.12 });
    this.softShadow = new GraphicsContext()
      .ellipse(0, 0, 1.15, 1.15)
      .fill({ color: 0x000000, alpha: 0.035 })
      .ellipse(0, 0, 0.85, 0.85)
      .fill({ color: 0x000000, alpha: 0.04 })
      .ellipse(0, 0, 0.55, 0.55)
      .fill({ color: 0x000000, alpha: 0.05 });
    for (const m of sim.state.monsters) this.ensure(m, false);
  }

  get(id: MonsterId): MonsterView | undefined {
    return this.byId.get(id);
  }

  /** 이 프레임에 손님 id의 몸을 맡긴다 (단체 놀이 화면이 손님을 그리기 전에 부른다, null = 맡기지 않음). */
  puppet(id: MonsterId, p: MonsterPuppet | null): void {
    const v = this.byId.get(id);
    if (v !== undefined) v.puppet = p;
  }

  private ensure(m: Monster, appear: boolean): MonsterView {
    let v = this.byId.get(m.id);
    if (v === undefined) {
      v = new MonsterView(m, SPECIES[m.species].floats ? this.softShadow : this.flatShadow, appear);
      this.byId.set(m.id, v);
      this.views.push(v);
      this.layers.shadows.addChild(v.shadow);
      this.layers.objects.addChild(v.node);
      this.layers.effects.addChild(v.emote);
      v.sync(m, 0);
    }
    return v;
  }

  // ── sim 이벤트 ──

  spawned(id: MonsterId): void {
    const m = this.sim.monster(id);
    if (m === undefined) return;
    const v = this.ensure(m, true);
    this.fx.puff(v.x, v.y, 5, 50);
  }

  left(id: MonsterId): void {
    this.byId.get(id)?.startLeaving();
  }

  react(id: MonsterId, r: Reaction, spectate: boolean): void {
    const v = this.byId.get(id);
    if (v === undefined) return;
    v.react(r, spectate, r.emote === null ? null : this.fx.tex.emote(r.emote));
    if (spectate) return;
    const hx = v.headX();
    const hy = v.headY();
    if (r.pose === 'sad' || r.emote === 'tear') this.fx.tears(hx, hy + v.headH * 0.35, v.facing, Math.round(2 + 2 * r.intensity));
    if (r.motion === 'bigHop' || r.emote === 'sparkle') this.fx.sparkles(hx, hy + v.headH * 0.4, Math.round(4 + 3 * r.intensity), v.halfW + 30);
  }

  cheered(id: MonsterId, by: 'tap' | GoodId): void {
    const v = this.byId.get(id);
    if (v === undefined) return;
    v.hop(by === 'tap' ? 0.7 : 1);
    if (by === 'tap') {
      v.showEmote(this.fx.tex.emote('heart'), 1.6);
      this.fx.hearts(v.headX(), v.headY(), 3);
    } else {
      // 간식이면 그 간식 그림을 머리 위에 (없으면 하트).
      v.showEmote(artTexture('items', by) ?? this.fx.tex.emote('heart'), 1.8);
      this.fx.sparkles(v.headX(), v.headY() + v.headH * 0.3, 6, v.halfW + 24);
      this.fx.hearts(v.headX(), v.headY(), 2);
    }
  }

  emoteTexture(kind: EmoteKind): Texture {
    return this.fx.tex.emote(kind);
  }

  // ── 매 프레임 ──

  update(dt: number, time: number, view: ViewRect, zoom: number): void {
    const frame = ++this.frame;
    const list = this.sim.state.monsters;
    for (let i = 0; i < list.length; i++) {
      const m = list[i] as Monster;
      const v = this.byId.get(m.id) ?? this.ensure(m, true);
      v.seen = frame;
      if (!v.leaving) v.sync(m, dt);
    }
    const emoteScale = clamp(0.7 / zoom, 1, 1.6);
    for (let i = this.views.length - 1; i >= 0; i--) {
      const v = this.views[i] as MonsterView;
      if (v.seen !== frame) v.startLeaving();
      v.update(dt, time, view, emoteScale);
      if (v.wantsGloom()) v.showEmote(this.fx.tex.emote('storm'), GLOOM_SHOW);
      v.puppet = null;
      if (v.dead) {
        this.byId.delete(v.id);
        const last = this.views.pop() as MonsterView;
        if (last !== v) this.views[i] = last;
        v.destroy();
      }
    }
  }

  /** 누른 점의 손님 (겹치면 앞쪽 = y가 큰 쪽). */
  hitTest(wx: number, wy: number): MonsterId | null {
    let best: MonsterView | null = null;
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i] as MonsterView;
      if (v.hits(wx, wy) && (best === null || v.y > best.y)) best = v;
    }
    return best === null ? null : best.id;
  }

  destroy(): void {
    for (const v of this.views) v.destroy();
    this.views.length = 0;
    this.byId.clear();
    this.flatShadow.destroy();
    this.softShadow.destroy();
  }
}
