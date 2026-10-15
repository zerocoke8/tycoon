// 확대 화면의 손님(오른쪽, 왼쪽을 봄)과 진행자(왼쪽, 뒤집어 오른쪽을 봄).
// 층: root(자리·등장) → motion(반응 트윈) → act(놀이 동작: 부스 장치가 매 프레임 정함) → body(그림).
// 기준점은 발 (손님 = monsterFoot(종), 진행자 = 그림 아래 가운데).

import { Container, Rectangle } from 'pixi.js';
import { type OutcomeTier, SPECIES, type SpeciesId } from '../../data/defs.ts';
import { ease } from '../../core/tween.ts';
import type { Motion, MonsterId, Pose, Reaction } from '../../sim/types.ts';
import { type ArtNode, artMeta, artSprite, hasArt, monsterFoot } from '../art.ts';
import { type Anim, bubbleNode, emoteNode, lerp } from './fx.ts';

/** 놀이 동작 (부스 장치가 매 프레임 정하고, 프레임마다 기본값으로 돌아간다). */
export interface RigPose {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  rot: number;
}

export function neutralPose(p: RigPose): void {
  p.dx = 0;
  p.dy = 0;
  p.sx = 1;
  p.sy = 1;
  p.rot = 0;
}

/** 손님 그림이 없을 때 자리 표시 색 (defs.ts SPECIES.color). */
const speciesColor = (s: SpeciesId): number => SPECIES[s].color;

/** 반응 이벤트가 오지 않았을 때 쓰는 기본 반응. */
export const DEFAULT_REACTION: Record<OutcomeTier, Reaction> = {
  jackpot: { pose: 'joy', emote: 'sparkle', motion: 'bigHop', intensity: 1.2, duration: 2.4, label: '' },
  win: { pose: 'joy', emote: 'note', motion: 'hop', intensity: 1, duration: 1.8, label: '' },
  nearMiss: { pose: 'agony', emote: 'shock', motion: 'tremble', intensity: 1, duration: 1.8, label: '' },
  lose: { pose: 'sad', emote: 'tear', motion: 'slump', intensity: 1, duration: 1.8, label: '' },
};

export class MonsterActor {
  readonly id: MonsterId;
  readonly species: SpeciesId;
  readonly root = new Container();
  private readonly motion = new Container();
  private readonly act = new Container();
  private readonly body: ArtNode;
  /** 몸 높이 (root 배율 1 기준 px). */
  readonly bodyH: number;
  /** 머리 꼭대기 y (root 기준, 음수). */
  readonly headY: number;
  readonly floats: boolean;
  private readonly anim: Anim;
  private readonly motionOwner: object;
  /** 놀이 동작 (부스 장치가 정함). */
  readonly rig: RigPose = { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0 };
  private poseLeft = 0;
  private bubble: Container | null = null;
  private bubbleText = '';
  private emoteNodeNow: Container | null = null;
  private readonly phase = Math.random() * 10;
  /** 이 시각까지는 자리가 비어도 남아서 반응을 보여 준다 (씬 시간). */
  holdUntil = 0;
  /** 결과가 났는데 반응 이벤트를 기다리는 중 (씬 시간 at까지). */
  expect: { tier: OutcomeTier; at: number } | null = null;
  lastReact = -99;
  leaving = false;
  /** 한판을 기다리는 손님의 들썩임 (0~1). */
  eager = 0;

  constructor(id: MonsterId, species: SpeciesId, k: number, bodyH: number, anim: Anim, onTap: (id: MonsterId) => void) {
    this.id = id;
    this.species = species;
    this.anim = anim;
    this.motionOwner = anim.owner();
    this.bodyH = bodyH;
    this.floats = SPECIES[species].floats;
    const foot = monsterFoot(species);
    this.body = artSprite('monsters', `${species}_base`, { k, anchor: foot, placeholder: { w: 460, h: 480, color: speciesColor(species) } });
    const m = artMeta('monsters', `${species}_base`);
    this.headY = m !== undefined && hasArt('monsters', `${species}_base`) ? (m.trim.y - foot.y) * k : -480 * k;
    this.act.addChild(this.body);
    this.motion.addChild(this.act);
    this.root.addChild(this.motion);
    this.root.eventMode = 'static';
    this.root.cursor = 'pointer';
    const top = Math.min(this.headY, -bodyH) - bodyH * 0.1;
    this.root.hitArea = new Rectangle(-bodyH * 0.5, top, bodyH, -top + bodyH * 0.08);
    this.root.on('pointertap', () => {
      if (!this.leaving) onTap(this.id);
    });
  }

  update(dt: number, time: number): void {
    const H = this.bodyH;
    const float = this.floats ? -H * 0.08 + Math.sin(time * 2.2 + this.phase) * H * 0.03 : 0;
    const breathe = Math.sin(time * 2.6 + this.phase) * 0.012;
    const hop = this.eager > 0 ? -Math.abs(Math.sin(time * 7 + this.phase)) * H * 0.03 * this.eager : 0;
    this.act.position.set(this.rig.dx, this.rig.dy + float + hop);
    this.act.scale.set(this.rig.sx * (1 - breathe * 0.5), this.rig.sy * (1 + breathe));
    this.act.rotation = this.rig.rot;
    if (this.poseLeft > 0) {
      this.poseLeft -= dt;
      if (this.poseLeft <= 0) this.setPose('base');
    }
  }

  /** 포즈를 sec초 동안 (그 뒤 기본). */
  showPose(pose: Pose, sec: number): void {
    this.setPose(pose);
    this.poseLeft = Math.max(0.3, sec);
  }

  setPose(pose: Pose): void {
    const has = hasArt('monsters', `${this.species}_${pose}`);
    const key = has ? `${this.species}_${pose}` : `${this.species}_base`;
    // 포즈마다 자기 발끝을 기준점으로 (포즈를 바꿔도 발이 바닥에 붙어 있게).
    this.body.setArt('monsters', key, monsterFoot(this.species, has ? pose : 'base'));
  }

  /** 반응 묶음 보여 주기 (지도보다 크게). */
  react(r: Reaction, time: number): void {
    this.expect = null;
    this.lastReact = time;
    this.setPose(r.pose);
    this.poseLeft = Math.max(1.4, r.duration);
    if (r.emote !== null) this.emote(r.emote, 1.25);
    this.playMotion(r.motion, r.intensity, r.duration);
  }

  /** 머리 위 이모트 (톡 튀어나와 떠 있다가 사라짐). */
  emote(kind: Parameters<typeof emoteNode>[0], scale = 1): void {
    this.emoteNodeNow?.destroy({ children: true });
    const H = this.bodyH;
    const n = emoteNode(kind, H * 0.32 * scale);
    const x = H * 0.22;
    const y = this.headY - H * 0.08;
    n.position.set(x, y);
    n.scale.set(0);
    this.root.addChild(n);
    this.emoteNodeNow = n;
    // 새 이모트가 앞 것을 지울 수 있으니 매번 살아 있는지 본다.
    void this.anim
      .run(0.3, (t) => {
        if (!n.destroyed) n.scale.set(t);
      }, { ease: ease.outBack })
      .then(() => this.anim.run(1.5, (t) => {
        if (n.destroyed) return;
        n.y = y - H * 0.12 * t;
        n.alpha = t > 0.75 ? (1 - t) / 0.25 : 1;
      }, { ease: ease.linear }))
      .then(() => {
        if (this.emoteNodeNow === n) this.emoteNodeNow = null;
        if (!n.destroyed) n.destroy({ children: true });
      });
  }

  /** 머리 위 말풍선 (null이면 닫기). 같은 글자면 그대로. */
  setBubble(text: string | null): void {
    const want = text ?? '';
    if (want === this.bubbleText) return;
    this.bubbleText = want;
    this.bubble?.destroy({ children: true });
    this.bubble = null;
    if (text === null) return;
    const H = this.bodyH;
    const b = bubbleNode(text, Math.max(14, H * 0.16));
    b.position.set(-H * 0.12, this.headY - H * 0.02);
    b.scale.set(0.3);
    this.root.addChild(b);
    this.bubble = b;
    void this.anim.run(0.25, (t) => {
      if (!b.destroyed) b.scale.set(lerp(0.3, 1, t));
    }, { ease: ease.outBack });
  }

  /** 반응 연출 (트윈). 앞 연출은 멈추고 바로 시작. */
  playMotion(m: Motion, intensity: number, duration: number): void {
    this.anim.cancel(this.motionOwner);
    const mo = this.motion;
    mo.position.set(0, 0);
    mo.scale.set(1);
    mo.rotation = 0;
    const H = this.bodyH;
    const I = Math.max(0.6, Math.min(2, intensity));
    const owner = this.motionOwner;
    const hops = (n: number, height: number, each: number): void => {
      void this.anim.run(
        n * each,
        (t) => {
          const k = (t * n) % 1;
          const arc = Math.sin(Math.PI * k);
          mo.y = -arc * height;
          // 땅에 닿을 때 살짝 찌그러진다.
          const land = k < 0.12 ? 1 - k / 0.12 : k > 0.9 ? (k - 0.9) / 0.1 : 0;
          mo.scale.set(1 + land * 0.08, 1 - land * 0.1 + arc * 0.05);
          if (t >= 1) mo.scale.set(1);
        },
        { ease: ease.linear, owner },
      );
    };
    switch (m) {
      case 'none':
        break;
      case 'hop':
        hops(2, H * 0.14 * I, 0.34);
        break;
      case 'bigHop':
        hops(3, H * 0.32 * I, 0.48);
        break;
      case 'bounceLoop':
        hops(Math.max(2, Math.round(duration / 0.36)), H * 0.1 * I, 0.36);
        break;
      case 'shake':
        void this.anim.run(0.8, (t) => {
          mo.x = Math.sin(t * Math.PI * 12) * H * 0.05 * I * (1 - t);
          mo.rotation = Math.sin(t * Math.PI * 12) * 0.05 * I * (1 - t);
        }, { ease: ease.linear, owner });
        break;
      case 'squash':
        void this.anim.run(0.7, (t) => {
          const s = t < 0.25 ? t / 0.25 : 1 - ease.outElastic((t - 0.25) / 0.75);
          mo.scale.set(1 + 0.16 * I * s, 1 - 0.18 * I * s);
        }, { ease: ease.linear, owner });
        break;
      case 'spin':
        void this.anim.run(0.9, (t) => {
          mo.scale.x = Math.cos(t * Math.PI * 4);
          mo.y = -Math.sin(Math.PI * t) * H * 0.16 * I;
        }, { ease: ease.inOutQuad, owner });
        break;
      case 'slump': {
        const hold = Math.max(0.6, duration - 0.8);
        void this.anim
          .run(0.35, (t) => {
            mo.y = H * 0.05 * I * t;
            mo.scale.set(1 + 0.06 * t, 1 - 0.14 * I * t);
            mo.rotation = 0.06 * t;
          }, { owner })
          .then(() => this.anim.run(0.45, (t) => {
            mo.y = H * 0.05 * I * (1 - t);
            mo.scale.set(1 + 0.06 * (1 - t), 1 - 0.14 * I * (1 - t));
            mo.rotation = 0.06 * (1 - t);
          }, { delay: hold, owner }));
        break;
      }
      case 'tremble':
        void this.anim.run(Math.max(0.8, duration * 0.8), (t) => {
          const fade = t > 0.85 ? (1 - t) / 0.15 : 1;
          mo.x = Math.sin(t * 160) * H * 0.014 * I * fade;
          mo.scale.y = 1 - 0.04 * fade;
        }, { ease: ease.linear, owner });
        break;
    }
  }

  /** 오른쪽에서 걸어 들어온다. */
  enter(from: number): void {
    const x = this.root.x;
    const y = this.root.y;
    this.root.x = x + from;
    this.root.alpha = 0;
    void this.anim.run(0.5, (t) => {
      if (this.root.destroyed || this.leaving) return;
      this.root.x = lerp(x + from, x, t);
      this.root.y = y - Math.abs(Math.sin(t * Math.PI * 3)) * this.bodyH * 0.06 * (1 - t);
      this.root.alpha = Math.min(1, t * 3);
    }, { ease: ease.outCubic });
  }

  /** 오른쪽으로 나가고 지워진다. */
  leave(to: number): void {
    if (this.leaving) return;
    this.leaving = true;
    this.root.eventMode = 'none';
    this.setBubble(null);
    const x = this.root.x;
    void this.anim
      .run(0.45, (t) => {
        if (this.root.destroyed) return;
        this.root.x = x + to * t;
        this.root.alpha = 1 - t;
      }, { ease: ease.inQuad })
      .then(() => this.destroy());
  }

  /** 던지는 손 자리 (root 기준). */
  hand(): { x: number; y: number } {
    return { x: -this.bodyH * 0.3, y: -this.bodyH * 0.6 };
  }

  /** 지금 몸이 놓인 자리 (root 기준): 장치가 정한 rig.dx·dy에 둥실(떠다니는 종)·들썩을 더한 값. 손에 쥔 소품이 몸을 따라가게. */
  bodyOffset(): { x: number; y: number } {
    return { x: this.act.x, y: this.act.y };
  }

  destroy(): void {
    this.anim.cancel(this.motionOwner);
    if (!this.root.destroyed) this.root.destroy({ children: true });
  }
}

export class HostActor {
  readonly root = new Container();
  private readonly motion = new Container();
  private readonly body: ArtNode;
  private readonly anim: Anim;
  private readonly owner: object;
  readonly height: number;
  /** 그림 배율 (패널 px / 캔버스 px). */
  readonly k: number;
  art: string;
  private readonly phase = Math.random() * 10;
  /** 놀이 동작 (부스 장치가 매 프레임 정하고, update가 적용한 뒤 0으로 돌린다). */
  readonly rig = { dy: 0, rot: 0 };

  constructor(art: string, k: number, anim: Anim) {
    this.art = art;
    this.k = k;
    this.anim = anim;
    this.owner = anim.owner();
    this.body = artSprite('characters', art, { k, anchor: 'bottom', placeholder: { w: 560, h: 960, color: 0xe9d3b4 } });
    // 그림은 왼쪽을 본다: 뒤집어 오른쪽(손님 쪽)을 보게.
    this.body.scale.x = -1;
    this.height = 960 * k;
    this.motion.addChild(this.body);
    this.root.addChild(this.motion);
  }

  setArt(art: string): void {
    if (art === this.art) return;
    this.art = art;
    this.body.setArt('characters', art);
  }

  /** 그림 반폭 (패널 px): 패널 왼쪽 끝에 잘리지 않게 자리를 정할 때. */
  get halfW(): number {
    const m = artMeta('characters', this.art);
    return (m !== undefined && hasArt('characters', this.art) ? m.trim.w : 560) * this.k * 0.5;
  }

  update(time: number): void {
    // 숨쉬듯 살짝 들썩이고 몸을 흔든다 (부스 장치가 정한 동작을 더한다).
    const s = Math.sin(time * 1.8 + this.phase);
    this.body.y = -Math.abs(Math.sin(time * 0.9 + this.phase)) * this.height * 0.008 + this.rig.dy;
    this.body.scale.y = 1 + s * 0.01;
    this.body.rotation = Math.sin(time * 0.9 + this.phase) * 0.015 + this.rig.rot;
    this.rig.dy = 0;
    this.rig.rot = 0;
  }

  /** 손님이 이기면 같이 폴짝. */
  cheer(big: boolean): void {
    this.anim.cancel(this.owner);
    const h = this.height * (big ? 0.12 : 0.06);
    const n = big ? 3 : 1;
    void this.anim.run(0.36 * n, (t) => {
      this.motion.y = -Math.abs(Math.sin(t * Math.PI * n)) * h;
    }, { ease: ease.linear, owner: this.owner });
  }

  /** 아깝게 놓치면 움찔. */
  flinch(): void {
    this.anim.cancel(this.owner);
    void this.anim.run(0.5, (t) => {
      this.motion.rotation = Math.sin(t * Math.PI * 6) * 0.04 * (1 - t);
    }, { ease: ease.linear, owner: this.owner });
  }

  destroy(): void {
    this.anim.cancel(this.owner);
    if (!this.root.destroyed) this.root.destroy({ children: true });
  }
}
