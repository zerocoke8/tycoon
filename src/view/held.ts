// 손님 손에 든 것 (다섯째 묶음, DESIGN 3.8): Monster.held (간식·음료·빵·아이스크림·꽃다발·인형·사진·점괘)를 몸 그릇 안에 그린다.
// 몸 그릇(발이 (0,0), 왼쪽을 보는 그림, 좌우 뒤집기는 몸 그릇 scale.x)의 자식이라 몸과 같이 뒤집히고 기운다. monsterView.ts가 손님마다 하나 만든다.
// 손 자리는 장신구 붙는 점 표(accessoryAnchors: 목 = 턱 아래 가슴, 옆구리 = 손 높이)에서 잡는다: 종·포즈마다 몸에 붙는다.
//  - 먹거리: 앞 손에 들고 가끔 입으로 가져가 냠 (몸이 오물오물 눌림, 몇 입마다 머리 위 냠냠 이모트 emote_yum·부스러기), 먹을수록 조금씩 작아진다.
//  - 음료: 빨대를 입에 대고 홀짝 (컵이 기운다). 꽃다발: 앞에 들고 살랑 (건네러 갈 때는 높이 받쳐 든다). 인형: 가슴에 꼭 안고 가끔 꼬옥 (작은 하트).
//  - 사진·점괘: 앞에 들고 가끔 들여다본다. 날아오는 동안(가게 주인 → 손님)은 hide(sec)로 숨긴다.
// 그림이 늦게 오면 ArtNode가 다시 그린다. 화면 연출용 무작위라 Math.random을 쓴다.

import { Container, Graphics } from 'pixi.js';
import type { SpeciesId } from '../data/defs.ts';
import type { Pose } from '../sim/types.ts';
import { accessoryAnchors } from './accessory.ts';
import { ART_SCALE, ArtNode, artMeta, monsterFoot } from './art.ts';

/** 든 것의 종류 (들고 있는 모습이 다르다). */
export type HeldKind = 'food' | 'drink' | 'plush' | 'bouquet' | 'paper';

/** 그림 이름 'group/key' → 종류. */
export function heldKind(item: string): HeldKind {
  if (item.startsWith('objects/plush_')) return 'plush';
  if (item === 'items/food_lemonade' || item === 'items/food_cocoa') return 'drink';
  if (item.startsWith('items/food_')) return 'food';
  if (item === 'items/bouquet') return 'bouquet';
  return 'paper';
}

/** 종류마다 긴 변 (세계 px)과 그림 안 쥐는 점 비율 (ax, ay). */
const LOOK: Record<HeldKind, { readonly size: number; readonly ax: number; readonly ay: number }> = {
  food: { size: 31, ax: 0.5, ay: 0.72 },
  drink: { size: 30, ax: 0.5, ay: 0.78 },
  plush: { size: 50, ax: 0.5, ay: 0.62 },
  bouquet: { size: 36, ax: 0.5, ay: 0.82 },
  paper: { size: 28, ax: 0.5, ay: 0.7 },
};

/** 먹기 한 입: 입으로 가져가는 초·입에 머무는 초(오물오물)·내리는 초, 입 사이 쉬는 초 (범위). */
const BITE_UP = 0.22;
const BITE_HOLD = 0.42;
const BITE_DOWN = 0.26;
const BITE_GAP: readonly [number, number] = [0.9, 1.7];
/** 몇 입마다 냠냠 이모트 (범위). */
const YUM_EVERY: readonly [number, number] = [2, 4];
/** 인형 꼬옥 사이 (초, 범위)와 한 번 꼬옥 하는 초. */
const HUG_GAP: readonly [number, number] = [2.6, 4.6];
const HUG_SEC = 0.5;
/** 사진·점괘 들여다보기 사이 (초, 범위)와 보는 초. */
const PEEK_GAP: readonly [number, number] = [3.5, 6];
const PEEK_SEC = 1.1;
/** 손에 막 들어온 톡 (초). */
const POP_SEC = 0.3;

const rand = (r: readonly [number, number]): number => r[0] + Math.random() * (r[1] - r[0]);
const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** 먹는 동안 몸이 받는 움직임 (monsterView가 몸에 곱하고 더한다). */
export interface HeldBodyOut {
  sx: number;
  sy: number;
  dy: number;
  rot: number;
}

/** 몸 그릇 안 점 (발 기준, 왼쪽을 보는 그림 좌표). */
interface LocalPts {
  handX: number;
  handY: number;
  mouthX: number;
  mouthY: number;
  chestX: number;
  chestY: number;
}

/** 손님 하나의 손에 든 것. */
export class HeldView {
  private readonly parent: Container;
  private readonly species: SpeciesId;
  private readonly seed: number;
  /** 지금 그리는 것 ('' = 없음)과 그 노드 (쥐는 점이 (0,0)). */
  private key = '';
  private kind: HeldKind = 'food';
  private node: Container | null = null;
  /** sim에서 받은 것. */
  private wantKey = '';
  private eat = false;
  private left = 1;
  private total = 1;
  private presenting = false;
  /** 숨김 (날아오는 동안, 남은 초)과 손에 막 들어온 톡 (남은 초). */
  private hideT = 0;
  private popT = 0;
  /** 포즈가 바뀌면 손 자리를 다시 잰다. */
  private pose: Pose | '' = '';
  private readonly pts: LocalPts = { handX: 0, handY: 0, mouthX: 0, mouthY: 0, chestX: 0, chestY: 0 };
  /** 먹기·꼬옥·들여다보기 시계 (지금 동작의 지난 초, 다음 동작까지 남은 초). */
  private actT = -1;
  private gapT = 0;
  private bites = 0;
  private yumAt = 3;
  /** 이 프레임에 바깥이 띄울 것 (한 번 읽으면 지운다). */
  private yum = false;
  private heart = false;
  private crumb = false;
  /** 이 프레임의 든 것 자리 (몸 그릇 좌표, 바깥이 세계 좌표로 바꾼다). */
  readonly at = { x: 0, y: 0 };

  constructor(parent: Container, species: SpeciesId, seed: number) {
    this.parent = parent;
    this.species = species;
    this.seed = seed;
  }

  /** sim 상태 (매 프레임). item = 그림 'group/key' ('' = 없음), presenting = 꽃을 건네러 가는 중. */
  sync(item: string, eat: boolean, left: number, total: number, presenting: boolean): void {
    this.wantKey = item;
    this.eat = eat;
    this.left = left;
    this.total = Math.max(0.001, total);
    this.presenting = presenting;
  }

  /** sec초 동안 그리지 않는다 (가게에서 날아오는 동안). */
  hide(sec: number): void {
    this.hideT = Math.max(this.hideT, sec);
  }

  /** 지금 손에 든 게 있나 (숨김과 상관없이). */
  get holding(): boolean {
    return this.wantKey !== '';
  }

  /** 지금 든 것의 종류 (없으면 null). */
  get heldKind(): HeldKind | null {
    return this.wantKey === '' ? null : heldKind(this.wantKey);
  }

  /** 냠냠 이모트를 띄울 때인가 (몇 입마다 한 번). */
  takeYum(): boolean {
    const y = this.yum;
    this.yum = false;
    return y;
  }

  /** 인형을 꼬옥 안을 때 작은 하트. */
  takeHeart(): boolean {
    const h = this.heart;
    this.heart = false;
    return h;
  }

  /** 한 입 베어 문 순간 (부스러기). */
  takeCrumb(): boolean {
    const c = this.crumb;
    this.crumb = false;
    return c;
  }

  private setItem(key: string): void {
    this.key = key;
    this.node?.destroy({ children: true });
    this.node = null;
    this.actT = -1;
    this.gapT = 0.4 + (this.seed % 1) * 0.6;
    this.bites = 0;
    this.yumAt = Math.round(rand(YUM_EVERY));
    this.popT = POP_SEC;
    if (key === '') return;
    this.kind = heldKind(key);
    const look = LOOK[this.kind];
    const slash = key.indexOf('/');
    const group = slash > 0 ? key.slice(0, slash) : 'items';
    const name = slash > 0 ? key.slice(slash + 1) : key;
    const meta = artMeta(group, name);
    const node = new Container();
    if (meta !== undefined) {
      const t = meta.trim;
      const k = look.size / Math.max(1, t.w, t.h);
      const a = new ArtNode({ k, anchor: { x: t.x + t.w * look.ax, y: t.y + t.h * look.ay }, placeholder: { w: t.w, h: t.h, color: 0xf3d36a } });
      a.setArt(group, name);
      node.addChild(a);
    } else {
      const s = look.size;
      const g = new Graphics().circle(0, -s * 0.2, s * 0.32).fill(0xf3d36a).stroke({ color: 0x402c1c, width: 3 });
      node.addChild(g);
    }
    node.eventMode = 'none';
    this.parent.addChild(node);
    this.node = node;
  }

  /** 손·입·가슴 자리를 그 포즈 그림에서 잰다 (장신구 붙는 점 표: 목 = 턱 아래, 옆구리 = 손 높이). */
  private measure(pose: Pose, halfW: number, headH: number): void {
    this.pose = pose;
    const a = accessoryAnchors(this.species, pose);
    const f = monsterFoot(this.species, pose);
    const k = ART_SCALE.monster;
    const nx = (a.neck.x - f.x) * k;
    const ny = (a.neck.y - f.y) * k;
    const sy = (a.side.y - f.y) * k;
    const p = this.pts;
    // 앞(왼쪽) 손: 목보다 앞으로 몸 반폭쯤, 높이는 목과 옆구리 사이 (작은 몸은 손이 배 앞).
    p.handX = nx - halfW * 0.62;
    p.handY = ny + (sy - ny) * 0.55;
    // 입: 목 점 조금 위·앞.
    p.mouthX = nx - halfW * 0.4;
    p.mouthY = ny - headH * 0.1;
    // 가슴 (인형 안기): 목 점 조금 아래·앞.
    p.chestX = nx - halfW * 0.22;
    p.chestY = ny + headH * 0.2;
  }

  /**
   * 그리기 (매 프레임). pose = 지금 몸 그림 포즈 (그림이 없으면 base), halfW·headH = 몸 크기 (세계 px).
   * 먹는 동안 몸 움직임을 out에 쓴다 (sx·sy 곱하기, dy·rot 더하기: rot은 왼쪽을 보는 그림 기준).
   */
  update(dt: number, time: number, pose: Pose, halfW: number, headH: number, out: HeldBodyOut): void {
    out.sx = 1;
    out.sy = 1;
    out.dy = 0;
    out.rot = 0;
    if (this.wantKey !== this.key) this.setItem(this.wantKey);
    if (this.hideT > 0) this.hideT = Math.max(0, this.hideT - dt);
    if (pose !== this.pose) this.measure(pose, halfW, headH);
    const node = this.node;
    if (node === null) return;
    if (this.hideT > 0) {
      node.visible = false;
      this.popT = POP_SEC;
      // 날아오는 물건이 닿을 곳 (손, 인형은 가슴). 숨긴 동안에는 먹지 않는다 (닿은 뒤 첫 입).
      this.at.x = this.kind === 'plush' ? this.pts.chestX : this.pts.handX;
      this.at.y = this.kind === 'plush' ? this.pts.chestY : this.pts.handY;
      return;
    }
    node.visible = true;
    // 손에 막 들어왔으면 톡 (커졌다 제 크기로).
    let pop = 1;
    if (this.popT > 0) {
      this.popT = Math.max(0, this.popT - dt);
      pop = 1 + 0.35 * Math.sin((1 - this.popT / POP_SEC) * Math.PI);
    }
    const p = this.pts;
    const sway = Math.sin(time * 2.1 + this.seed);
    let x = p.handX;
    let y = p.handY;
    let rot = sway * 0.06;
    let s = 1;
    // 먹을수록 조금씩 작아진다 (먹거리만).
    const eaten = this.eat && this.kind === 'food' ? 0.62 + 0.38 * smooth(this.left / this.total) : 1;
    // 동작 시계.
    if (this.actT >= 0) this.actT += dt;
    else {
      this.gapT -= dt;
      if (this.gapT <= 0) this.actT = 0;
    }
    switch (this.kind) {
      case 'food':
      case 'drink': {
        if (!this.eat) break;
        const total = BITE_UP + BITE_HOLD + BITE_DOWN;
        if (this.actT >= 0) {
          const t = this.actT;
          // 입으로 → 오물오물 → 내린다.
          const u = t < BITE_UP ? smooth(t / BITE_UP) : t < BITE_UP + BITE_HOLD ? 1 : 1 - smooth((t - BITE_UP - BITE_HOLD) / BITE_DOWN);
          x = p.handX + (p.mouthX - p.handX) * u;
          y = p.handY + (p.mouthY - p.handY) * u;
          rot = this.kind === 'drink' ? -0.55 * u : -0.25 * u;
          if (t >= BITE_UP && t < BITE_UP + BITE_HOLD) {
            // 오물오물: 몸이 작게 눌렸다 펴진다.
            const c = Math.abs(Math.sin(((t - BITE_UP) / BITE_HOLD) * Math.PI * 3));
            out.sy = 1 - 0.045 * c;
            out.sx = 1 + 0.03 * c;
            if (t - dt < BITE_UP) {
              this.bites++;
              if (this.kind === 'food') this.crumb = true;
              if (this.bites >= this.yumAt) {
                this.bites = 0;
                this.yumAt = Math.round(rand(YUM_EVERY));
                this.yum = true;
              }
            }
          }
          // 입으로 가져갈 때 고개를 살짝 숙인다.
          out.rot = -0.05 * u;
          if (t >= total) {
            this.actT = -1;
            this.gapT = rand(BITE_GAP);
          }
        }
        break;
      }
      case 'plush': {
        x = p.chestX;
        y = p.chestY;
        rot = sway * 0.04;
        if (this.actT >= 0) {
          const u = this.actT / HUG_SEC;
          const c = Math.sin(Math.min(1, u) * Math.PI);
          // 꼬옥: 인형이 눌리고 몸도 같이 살짝.
          s = 1 + 0.08 * c;
          out.sy = 1 - 0.035 * c;
          out.sx = 1 + 0.03 * c;
          if (this.actT - dt <= 0) this.heart = Math.random() < 0.6;
          if (u >= 1) {
            this.actT = -1;
            this.gapT = rand(HUG_GAP);
          }
        }
        if (s !== 1) {
          node.scale.set(s * 1.04 * pop, s * 0.94 * pop);
          node.position.set(x, y);
          node.rotation = rot;
          this.at.x = x;
          this.at.y = y;
          return;
        }
        break;
      }
      case 'bouquet': {
        // 건네러 갈 때는 앞으로 높이 받쳐 들고 살랑, 아니면 손에 들고 살랑.
        if (this.presenting) {
          x = p.handX - halfW * 0.12;
          y = p.handY - headH * 0.12 + Math.sin(time * 6 + this.seed) * 1.5;
          rot = -0.18 + sway * 0.08;
        } else rot = -0.08 + sway * 0.08;
        this.actT = -1;
        break;
      }
      case 'paper': {
        if (this.actT >= 0) {
          const u = Math.sin(Math.min(1, this.actT / PEEK_SEC) * Math.PI);
          x = p.handX + (p.mouthX - p.handX) * 0.55 * u;
          y = p.handY + (p.mouthY - p.handY) * 0.55 * u;
          rot = -0.2 * u;
          if (this.actT >= PEEK_SEC) {
            this.actT = -1;
            this.gapT = rand(PEEK_GAP);
          }
        }
        break;
      }
    }
    s *= eaten * pop;
    node.scale.set(s);
    node.position.set(x, y);
    node.rotation = rot;
    this.at.x = x;
    this.at.y = y;
  }

  destroy(): void {
    this.node?.destroy({ children: true });
    this.node = null;
  }
}
