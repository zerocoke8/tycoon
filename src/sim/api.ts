// 시뮬레이션의 바깥 약속 (화면·UI가 쓰는 것). 구현은 sim.ts의 Sim 클래스.
// 행동은 모두 Result를 돌려준다: 안 되면 ok=false와 한국어 이유 (UI가 그대로 토스트로 띄운다).

import type { BoothId, BuildingId, GoodId, MaterialId, PreciousId } from '../data/defs.ts';
import type { GameState, Monster, MonsterId, SimBus, StaffId } from './types.ts';

export interface Cost {
  readonly coins: number;
  readonly mats?: Partial<Record<MaterialId, number>>;
  readonly precious?: Partial<Record<PreciousId, number>>;
}

export type Result = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface SimApi {
  readonly state: GameState;
  readonly bus: SimBus;

  /** 고정 틱 dt(초)만큼 진행. 화면 루프가 누적 시간을 SIM.dt로 잘라 부른다. */
  tick(dt: number): void;
  /** 탭이 숨겨졌다 돌아왔을 때 sec초를 몰아서 계산 (SIM.catchUpMaxSec까지, 이벤트는 요약만). */
  catchUp(sec: number): void;

  // ── 물어보기 ──
  monster(id: MonsterId): Monster | undefined;
  hallLevel(): number;
  boothFee(booth: BoothId): number;
  boothSeats(booth: BoothId): number;
  /** 한판에 내는 손님 특산 재료 수 (복주머니 1, 그 밖 0). 이런 부스는 코인 참가비(boothFee)가 0. */
  boothMatFee(booth: BoothId): number;
  canAfford(cost: Cost): boolean;
  /** 다음 레벨 비용 (최고 레벨이면 null). 처음에 없는 건물(전당포·은행·일터, defs.ts BUILD_HALL)은 레벨 0이고 이것이 짓는 비용. */
  buildingUpgradeCost(id: BuildingId): Cost | null;
  /** 지었나 (레벨 1 이상). */
  buildingBuilt(id: BuildingId): boolean;
  /** 비용 말고 아직 지을 수 없는 이유 (마을회관 레벨이 모자람). 지을 수 있거나 이미 지었으면 null. */
  buildingLockReason(id: BuildingId): string | null;
  boothUnlockCost(booth: BoothId): Cost | null;
  /** 비용 말고 아직 열 수 없는 이유 (그 구역이 닫힘 = 마을회관 레벨이 모자람). 열 수 있거나 이미 열렸으면 null. */
  boothLockReason(booth: BoothId): string | null;
  boothUpgradeCost(booth: BoothId): Cost | null;
  /** 공방에서 지금 만들 수 있는 레시피 (data/defs.ts RECIPES의 index). */
  availableRecipes(): readonly { readonly index: number; readonly affordable: boolean }[];
  /** 재료 한 종류마다 둘 수 있는 최대 개수 (창고). */
  materialCap(): number;
  /** 부스가 손님을 받는 중 (해금됐고 꼭 있어야 하는 진행자 자리가 다 찼다). */
  boothOpen(booth: BoothId): boolean;
  /** 공방에서 한꺼번에 만들 수 있는 개수 (state.crafting.length와 비교). */
  craftSlots(): number;

  // ── 촌장의 행동 ──
  /** 손님을 톡 눌러 응원 (쿨타임). */
  cheer(id: MonsterId): Result;
  /** 손님에게 간식 주기. */
  giveSnack(id: MonsterId, good: GoodId): Result;
  /** 부스에 응원 도구 걸기. */
  placeCheer(booth: BoothId, good: GoodId): Result;
  /** 건물 업그레이드 (레벨 0이면 짓기). */
  upgradeBuilding(id: BuildingId): Result;
  unlockBooth(booth: BoothId): Result;
  upgradeBooth(booth: BoothId): Result;
  /** 후보 index를 고용. */
  hire(candidate: number): Result;
  /**
   * 진행자를 부스의 자리 role(BOOTHS[booth].roles의 index, 기본 0)에 배치 (booth = null이면 쉬게).
   * 그 자리에 다른 진행자가 있으면 서로 자리를 바꾼다 (옮겨 온 진행자가 쉬던 중이었으면 원래 진행자는 쉰다).
   * 부스는 꼭 있어야 하는 자리(optional이 아닌 역할)가 다 차야 돌아간다.
   */
  assign(staff: StaffId, booth: BoothId | null, role?: number): Result;
  staffLevelUp(staff: StaffId): Result;
  staffLevelUpCost(staff: StaffId): Cost | null;
  craft(recipe: number): Result;

  // ── 저장 ──
  save(): void;
  /** 저장을 지우고 새 게임. */
  reset(): void;
}
