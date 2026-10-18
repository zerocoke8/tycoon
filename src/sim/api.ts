// 시뮬레이션의 바깥 약속 (화면·UI가 쓰는 것). 구현은 sim.ts의 Sim 클래스.
// 행동은 모두 Result를 돌려준다: 안 되면 ok=false와 한국어 이유 (UI가 그대로 토스트로 띄운다).

import type { CatalogKey, CatalogKind } from '../data/catalog.ts';
import type { BoothId, BuildingId, GoodId, MaterialId, PreciousId, ShopId } from '../data/defs.ts';
import type { Cell } from '../data/map.ts';
import type { GameState, Monster, MonsterId, SimBus, StaffId } from './types.ts';
import type { ChunkInfo, PlaceCheck, Village } from './village.ts';

export interface Cost {
  readonly coins: number;
  readonly mats?: Partial<Record<MaterialId, number>>;
  readonly precious?: Partial<Record<PreciousId, number>>;
}

export type Result = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** 보관함 한 줄 (가졌는데 지도에 놓지 않은 것). */
export interface StorageItem {
  readonly key: CatalogKey;
  readonly count: number;
}

/** 짓기 목록 한 줄 (SimApi.catalog). */
export interface CatalogEntry {
  readonly key: CatalogKey;
  readonly kind: CatalogKind;
  /** 가진 수 (부스·건물 0·1, 장식 = 놓인 것 + 보관함). */
  readonly owned: number;
  /** 보관함에 있는 수. */
  readonly stored: number;
  /** 지도에 놓인 수. */
  readonly placed: number;
  /** 사는 비용 (부스 = 열기, 처음엔 없는 건물 = 짓기, 장식 = 값). 이미 가진 부스·건물은 null. */
  readonly cost: Cost | null;
  /** 비용 말고 아직 못 사는 이유 (마을회관 레벨). */
  readonly lock: string | null;
  /** 차지하는 칸. */
  readonly w: number;
  readonly h: number;
  /** 손님이 들르는 곳이라 입구 앞이 길과 이어져야 한다. */
  readonly needsRoad: boolean;
  /** 옮기거나 보관할 수 없다 (마을 입구). */
  readonly fixed: boolean;
  /** 보관함에 넣을 수 있다 (마을 입구·마을회관·공방·사무소·창고·분수는 안 된다: catalog.ts storable). */
  readonly storable: boolean;
}

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
  /** 모자란 것 한 줄 ('무 잎이 1개 모자라요.' …, 넉넉하면 null). */
  missingReason(cost: Cost): string | null;
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

  // ── 배치형 마을 (DESIGN 6.1, sim/village.ts) ──
  /** 칸 지도·길 이어짐·세계 좌표 모양 (그때그때 부른다: 바뀌면 새 객체). */
  village(): Village;
  /** 가진 수 (부스·건물 0·1, 장식 = 놓인 것 + 보관함). */
  owned(key: CatalogKey): number;
  /** 보관함에 있는 수. */
  stored(key: CatalogKey): number;
  storage(): StorageItem[];
  /** 짓기 목록 (부스 → 건물 → 장식). */
  catalog(): CatalogEntry[];
  /** 사는 비용 (가진 부스·건물은 null). */
  buyCost(key: CatalogKey): Cost | null;
  buyLockReason(key: CatalogKey): string | null;
  /** key를 칸 cell(왼쪽 위 칸)에 놓을 수 있나. moving = 옮기는 중인 자기 id (Placed.id). */
  canPlace(key: CatalogKey, cell: Cell, moving?: number): PlaceCheck;
  /** 땅 조각 하나 (map.ts chunkIndex). */
  chunk(index: number): ChunkInfo;
  chunkLockReason(index: number): string | null;

  // ── 배치형 마을 행동 ──
  /** 사서 보관함에 (부스 열기·건물 짓기·장식 사기). */
  buy(key: CatalogKey): Result;
  /** 지도에 놓는다 (보관함에서, 없으면 먼저 산다). */
  place(key: CatalogKey, cell: Cell): Result;
  /** 놓인 것(Placed.id)을 옮긴다 (안의 손님도 같이). */
  move(id: number, cell: Cell): Result;
  /** 놓인 것을 보관함으로 (마을 입구는 안 된다). */
  store(id: number): Result;
  /** 길 칸 깔기·지우기 (가진 땅의 빈 칸만). */
  paintRoad(cells: readonly Cell[]): Result;
  eraseRoad(cells: readonly Cell[]): Result;
  /** 땅 조각 사기 (가진 땅에 이웃한 조각, 값·회관 레벨). */
  buyChunk(index: number): Result;
  /**
   * 보관함의 것을 알맞은 자리에 길까지 이어 놓는다 (자리가 없으면 실패). spread = 다른 건물에 위아래로 붙이지 않게 (village.ts findSpot),
   * near = 마을 입구 대신 이 칸에 가까운 자리 (개발용).
   */
  autoPlace(key: CatalogKey, spread?: boolean, near?: Cell): Result;

  // ── 다섯째 묶음: 가게 (DESIGN 3.8, sim/shops.ts) ──
  /** 손님을 받는 중 (지었고, 가게 주인이 있고, 놓여 입구가 길로 이어졌다). */
  shopOpen(shop: ShopId): boolean;
  /** 짓는 비용 (이미 있으면 null). 짓기는 buy(key)·place(key, cell) (가게 주인이 같이 온다). */
  shopBuyCost(shop: ShopId): Cost | null;
  /** 비용 말고 아직 지을 수 없는 이유 (마을회관 레벨). */
  shopLockReason(shop: ShopId): string | null;
  /** 다음 레벨 비용 (없거나 최고 레벨이면 null). */
  shopUpgradeCost(shop: ShopId): Cost | null;
  upgradeShop(shop: ShopId): Result;
  /** 진행자를 가게 주인으로 (shop = null이면 쉬게). 맡던 부스 자리·가게는 빈다, 그 가게에 있던 주인은 이 진행자가 맡던 가게로 (없으면 쉰다). */
  assignShop(staff: StaffId, shop: ShopId | null): Result;

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
