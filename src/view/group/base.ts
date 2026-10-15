// 지도 위 단체 놀이 화면의 약속과 공용 바탕 (view/group/<booth>.ts가 GroupMapBase를 이어받는다. 경주장은 view/racetrack.ts).
//
// 약속:
//   - sim은 읽기만 한다. 매 프레임 sim.state.booths[booth].group(GroupState)을 읽어 그 시각의 모습을 그린다 (이벤트를 놓쳐도, 저장을 불러와도 맞는다).
//     판(play)은 시작할 때 다 정해져 있다: play.tracks(키프레임: sim/group/core.ts trackAt)와 play.events(사건, 시각 순서)를 재생한다.
//     this.clock = 화면 시계 (판 시작 뒤 초): running이면 sim 시계(0.1초 틱)를 부드럽게 따라가고, done이면 계속 흐른다 (결과 뒤 연출).
//   - update는 손님을 그리기 전에 불린다: 손님 몸을 맡기려면 이때 this.puppet(id, {...}) (그 프레임만, monsterView.ts MonsterPuppet).
//     손님의 sim 자리는 BoothSpot.seats (sim이 걸어가 앉힌다). 그림만 옮기거나 기울인다.
//   - 층 (모두 카메라 안 세계 좌표): floor = 바닥 그림 위·그림자 아래 (모래판 표시, 선), shadows = 그림자,
//     objects = y로 정렬되는 물체 (zIndex = 발 y: 밧줄·배), effects = 이모트·입자, sky = 모든 것 위 (연과 연줄).
//   - 부스 그림·진행자·항아리·props(깃발·흙더미)는 buildings.ts가 그린다. 진행자를 통통: this.ctx.buildings.hostHop(부스, 자리, 세기).
//     효과: this.ctx.fx (puff·confetti·sparkles·floatText·coinArc …, view/fx.ts).
//   - 닫힌 부스(잠김)·닫힌 구역에서는 draw를 부르지 않고 own()으로 만든 그릇을 숨긴다 (onShown).

import type { Container } from 'pixi.js';
import type { GroupBoothId } from '../../data/defs.ts';
import { BOOTH_SPOTS, type BoothSpot, type DistrictId } from '../../data/map.ts';
import type { SimApi } from '../../sim/api.ts';
import { groupGame } from '../../sim/group/index.ts';
import type { BoothState, GroupEntry, GroupPlay, GroupState, Monster, MonsterId } from '../../sim/types.ts';
import type { BuildingsView } from '../buildings.ts';
import type { FxLayer } from '../fx.ts';
import { clamp, districtAt, follow, type ViewRect } from '../mapUtil.ts';
import type { MonsterPuppet, MonstersView, MonsterView } from '../monsterView.ts';

export interface GroupMapLayers {
  /** 바닥 타일 위, 그림자 아래 (바닥에 그리는 표시). 바닥에 깔리는 부스 그림(모래판·선착장·흙더미)도 여기 있다. */
  readonly floor: Container;
  readonly shadows: Container;
  /** y로 정렬 (zIndex = 발 y). */
  readonly objects: Container;
  /** 이모트·입자 위. */
  readonly effects: Container;
  /** 모든 것 위 (닫힌 구역 구름보다도 위). */
  readonly sky: Container;
}

export interface GroupMapCtx {
  readonly sim: SimApi;
  readonly booth: GroupBoothId;
  readonly layers: GroupMapLayers;
  readonly fx: FxLayer;
  readonly buildings: BuildingsView;
  readonly monsters: MonstersView;
}

export interface GroupMapRenderer {
  /** 매 프레임 (손님을 그리기 전). view = 보이는 세계 사각형 (화면 밖은 그리지 않아도 된다). */
  update(dt: number, view: ViewRect): void;
  /** 지도를 누른 곳이 이 놀이 마당(모래판·밧줄·연·물길·흙 마당…)인가: 그러면 그 부스 패널이 열린다 (구름 덮인 곳은 묻지 않는다). */
  hitTest(wx: number, wy: number): boolean;
  /** WebGL 문맥을 되찾은 뒤 코드로 구운 텍스처를 다시 굽는다 (있으면). */
  restoreTextures?(): void;
  destroy(): void;
}

/** 단체 놀이 지도 화면의 공용 바탕: 보이기·화면 시계·참가자·손님 몸 맡기기. */
export abstract class GroupMapBase implements GroupMapRenderer {
  protected readonly ctx: GroupMapCtx;
  protected readonly booth: GroupBoothId;
  protected readonly spot: BoothSpot;
  private readonly district: DistrictId | null;
  /** 부스가 열렸고 구역도 열려 보이는 중. */
  protected shown = false;
  /** 화면 시계 (판 시작 뒤 초, 판이 없으면 0). */
  protected clock = 0;
  /** 지금 보여 주는 판 (sim GroupState.play와 같은 객체, running·done 동안). 바뀌면 onPlay. */
  protected play: GroupPlay | null = null;
  /** 누적 초. */
  protected time = 0;
  private readonly owned: Container[] = [];
  /** 마지막으로 띄운 시작 숫자 (startCount). */
  private shownCount = 0;

  constructor(ctx: GroupMapCtx) {
    this.ctx = ctx;
    this.booth = ctx.booth;
    this.spot = BOOTH_SPOTS[ctx.booth];
    this.district = districtAt(this.spot.base.x, this.spot.base.y);
  }

  protected get sim(): SimApi {
    return this.ctx.sim;
  }

  protected get bs(): BoothState {
    return this.ctx.sim.state.booths[this.booth];
  }

  protected get group(): GroupState | null {
    return this.bs.group;
  }

  /** 이번 판(또는 모이는 중) 참가자 (참가 순서). */
  protected get entries(): readonly GroupEntry[] {
    return this.group?.participants ?? [];
  }

  /** 자리 seat의 참가자 (없으면 undefined). */
  protected entryAt(seat: number): GroupEntry | undefined {
    return this.group?.participants.find((e) => e.seat === seat);
  }

  protected monster(id: MonsterId): Monster | undefined {
    return this.ctx.sim.monster(id);
  }

  /** 지도 위 손님 그림 (x·y = 발, headH·halfW, facing). */
  protected view(id: MonsterId): MonsterView | undefined {
    return this.ctx.monsters.get(id);
  }

  /** 이 프레임에 손님 몸을 맡긴다. */
  protected puppet(id: MonsterId, p: MonsterPuppet | null): void {
    this.ctx.monsters.puppet(id, p);
  }

  /** 그릇 하나를 층에 붙인다 (보이기·숨기기·지우기를 바탕이 맡는다). */
  protected own<T extends Container>(layer: Container, node: T): T {
    node.eventMode = 'none';
    node.visible = this.shown;
    layer.addChild(node);
    this.owned.push(node);
    return node;
  }

  update(dt: number, view: ViewRect): void {
    this.time += dt;
    const st = this.ctx.sim.state;
    const show = this.bs.unlocked && (this.district === null || st.districts.includes(this.district));
    if (show !== this.shown) {
      this.shown = show;
      this.onShown(show);
    }
    if (!show) return;
    this.followClock(dt);
    this.draw(dt, view);
  }

  private followClock(dt: number): void {
    const g = this.group;
    const p = g !== null && (g.phase === 'running' || g.phase === 'done') ? g.play : null;
    if (p !== this.play) {
      const prev = this.play;
      this.play = p;
      this.clock = p === null || g === null ? 0 : g.elapsed;
      this.onPlay(p, prev);
      return;
    }
    if (p === null || g === null) return;
    this.clock += dt;
    if (g.phase === 'running') {
      // sim 시계는 0.1초씩 간다: 가까이 붙어 있되 부드럽게 끌려간다.
      this.clock += (g.elapsed - this.clock) * follow(3, dt);
      this.clock = clamp(this.clock, g.elapsed - 0.2, g.elapsed + 0.2);
    }
  }

  /**
   * 시작 숫자 3·2·1 ((x, y) 위로 떠오른다, 진행자 host 통통): 모이는 중이고 출발할 수 있을 때만
   * (씨름 상대·줄다리기 편이 덜 차 출발 조건이 안 맞으면 띄우지 않는다). draw에서 매 프레임 부른다.
   */
  protected startCount(x: number, y: number, host: number): void {
    const g = this.group;
    if (g !== null && g.phase === 'gathering' && groupGame(this.booth).readiness(g.participants, g.elapsed) !== 'none') {
      const c = Math.ceil(g.countdown - 1e-6);
      if (c >= 1 && c <= 3 && c !== this.shownCount) {
        this.ctx.fx.floatText(x, y, `${c}`, 'win', c === 1);
        this.ctx.buildings.hostHop(this.booth, host, 0.6);
      }
      this.shownCount = c;
    } else {
      this.shownCount = 0;
    }
  }

  /** 보이기 시작·그만 (부스가 열리거나 구역이 열릴 때). 기본: own()으로 붙인 그릇을 보이고 숨긴다. */
  protected onShown(show: boolean): void {
    for (const c of this.owned) c.visible = show;
  }

  /** 새 판이 시작됐다 (p, 중간에 열었으면 this.clock이 이미 흘렀다) 또는 판이 끝나 쉰다 (p = null, prev = 끝난 판). */
  protected onPlay(_p: GroupPlay | null, _prev: GroupPlay | null): void {}

  /** 보이는 동안 매 프레임. */
  protected abstract draw(dt: number, view: ViewRect): void;

  hitTest(_wx: number, _wy: number): boolean {
    return false;
  }

  destroy(): void {
    for (const c of this.owned) c.destroy({ children: true });
    this.owned.length = 0;
  }
}

/** 타원 (cx, cy, rx, ry) 안인가. */
export function inEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}
