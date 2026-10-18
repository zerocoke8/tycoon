// 개발용: 마을을 한 번에 다 연다 (모든 땅과 부스, 그림 있는 진행자를 모두 고용해 자기 자리에, 부스·건물은 길까지 이어 자동 배치).
// 새 부스 연출을 만들 때 쓴다: 주소 ?all=1·?unlockAll=1 (main.ts, 저장하지 않는다), scripts/sim-check.ts --selftest.

import { Rng } from '../core/rng.ts';
import { ACCESSORIES, ACCESSORY_IDS, BOOTH_IDS, BUILD_HALL, DECOR, DECOR_IDS, GOODS, PRECIOUS, type AccessoryDef, type AccessoryId, type BuildingId, type DecorId, type GoodId, type MaterialId, type PreciousId } from '../data/defs.ts';
import { CHUNKS } from '../data/map.ts';
import type { SimApi } from './api.ts';
import { createMonster } from './monsters.ts';
import type { Sim } from './sim.ts';
import { isPreset, presetPost } from './staff.ts';
import { addChunk, villageOf } from './village.ts';

/** 넷째 묶음 건물 (처음엔 빈 부지): 전당포·은행·일터. */
const DEBT_BUILDINGS = Object.keys(BUILD_HALL) as BuildingId[];

/** 개발용: 모든 땅 조각을 산 것으로 (값 없이). */
export function devAllLand(sim: SimApi): void {
  for (let i = 0; i < CHUNKS.w * CHUNKS.h; i++) addChunk(sim.state, i);
  sim.bus.emit('villageChanged', { what: 'land' });
}

/** 개발용: 보관함의 부스·건물을 모두 자동 배치 (큰 것부터, 자리가 없으면 남긴다). */
export function devPlaceAll(sim: SimApi): void {
  const keys = sim.storage().map((x) => x.key).filter((k) => sim.catalog().find((c) => c.key === k)?.kind !== 'decor');
  const area = (k: string): number => {
    const c = sim.catalog().find((x) => x.key === k);
    return c === undefined ? 0 : c.w * c.h;
  };
  keys.sort((a, b) => area(b) - area(a));
  for (const k of keys) sim.autoPlace(k, true);
}

export function devOpenAll(sim: SimApi): void {
  const st = sim.state;
  devAllLand(sim);
  st.coins += 100_000;
  for (const k of Object.keys(PRECIOUS) as PreciousId[]) st.precious[k] = (st.precious[k] ?? 0) + 20;
  const fill = (): void => {
    for (const k of Object.keys(st.materials) as MaterialId[]) st.materials[k] = Math.max(st.materials[k] ?? 0, sim.materialCap());
  };
  fill();
  while (sim.upgradeBuilding('warehouse').ok) fill();
  fill();
  while (sim.upgradeBuilding('hall').ok) fill();
  fill();
  for (const b of BOOTH_IDS) sim.unlockBooth(b);
  // 전당포·은행·일터도 끝까지.
  for (const id of DEBT_BUILDINGS) {
    fill();
    while (sim.upgradeBuilding(id).ok) fill();
  }
  devPlaceAll(sim);
  for (let i = st.candidates.length - 1; i >= 0; i--) {
    const c = st.candidates[i];
    if (c !== undefined && isPreset(c)) sim.hire(i);
  }
  // 고용 순서 때문에 다른 자리에 간 진행자를 자기 자리로.
  for (const s of st.staff) {
    const p = presetPost(s);
    if (p !== null && st.booths[p.booth].unlocked) sim.assign(s.id, p.booth, p.role);
  }
  // 재료는 창고 반만 남긴다 (가득이면 손님이 떠날 때마다 '창고가 가득' 토스트가 쏟아진다).
  const half = Math.floor(sim.materialCap() / 2);
  for (const k of Object.keys(st.materials) as MaterialId[]) st.materials[k] = Math.min(st.materials[k] ?? 0, half);
}

/** 개발용 (주소 ?unlockAll=1): 장식을 n개 사서 길가에 자동 배치 (다 자란 마을 모습: 나무·꽃·벤치·가로등 …를 돌려 가며). */
export function devDecorate(sim: SimApi, n = 36): void {
  const keys = DECOR_IDS.filter((k) => k !== 'crates' && k !== 'signpost');
  for (let i = 0; i < n; i++) {
    const k = keys[i % keys.length] as DecorId;
    sim.state.coins += DECOR[k].cost;
    if (!sim.buy(k).ok || !sim.autoPlace(k).ok) break;
  }
}

/** 개발용: 간식·응원 도구를 몇 개씩 (주소 ?unlockAll=1). 재료·귀한 물건은 devOpenAll이 이미 넉넉히 준다. */
export function devGiveGoods(sim: SimApi, n = 5): void {
  const st = sim.state;
  for (const g of Object.keys(GOODS) as GoodId[]) st.goods[g] = (st.goods[g] ?? 0) + n;
}

/**
 * 개발용 (주소 ?broke=1): 전당포·은행·일터를 (회관 레벨과 상관없이) 레벨 1로 짓고, 마을 금고를 넉넉히, 새 손님의 지갑을 거의 비게 한다
 * (곧 돈이 떨어져 전당포·은행·파산 흐름을 본다). 저장하지 않는 게임에서만 쓴다.
 */
export function devBroke(sim: SimApi, wallet = 6): void {
  devBuildDebt(sim);
  const thin = (id: number): void => {
    const m = sim.monster(id);
    if (m !== undefined) m.wallet = Math.min(m.wallet, wallet);
  };
  for (const m of sim.state.monsters) thin(m.id);
  sim.bus.on('monsterSpawned', (e) => thin(e.id));
}

/**
 * 개발용 (주소 ?acc=1): 모든 손님(지금·새로 오는)에게 장신구를 자리마다 하나씩 단다 (머리·목·옆구리, 종이 빠진 장신구는 빼고).
 * 장신구 붙는 점(data/accessoryAnchors.ts)을 맞출 때 쓴다. 머리·목 장신구는 손님마다 돌려 가며.
 */
export function devAccessories(sim: SimApi): void {
  const heads = ACCESSORY_IDS.filter((k) => ACCESSORIES[k].slot === 'head');
  const necks = ACCESSORY_IDS.filter((k) => ACCESSORIES[k].slot === 'neck');
  const dress = (id: number): void => {
    const m = sim.monster(id);
    if (m === undefined) return;
    const pick = [heads[id % heads.length], necks[id % necks.length], 'acc_coin_pouch' as AccessoryId];
    m.accessories = pick
      .filter((k): k is AccessoryId => k !== undefined && !(((ACCESSORIES[k] as AccessoryDef).exclude ?? []) as readonly string[]).includes(m.species))
      .map((k) => ({ key: k, slot: ACCESSORIES[k].slot, value: ACCESSORIES[k].value[0] }));
  };
  for (const m of sim.state.monsters) dress(m.id);
  sim.bus.on('monsterSpawned', (e) => dress(e.id));
}

/** 개발용: 전당포·은행·일터가 아직 없으면 레벨 1로 (비용·회관 레벨 없이) 지어 자동 배치 (자리가 모자라면 이웃 땅을 산다), 금고는 2000코인 이상. */
export function devBuildDebt(sim: SimApi): void {
  const st = sim.state;
  for (const id of DEBT_BUILDINGS) if (st.buildings[id].level < 1) st.buildings[id].level = 1;
  for (const id of DEBT_BUILDINGS) {
    for (let tries = 0; tries < 6 && !sim.autoPlace(id).ok; tries++) {
      const next = Array.from({ length: CHUNKS.w * CHUNKS.h }, (_, i) => sim.chunk(i)).filter((c) => !c.owned && c.adjacent).sort((a, b) => a.ring - b.ring)[0];
      if (next === undefined) break;
      addChunk(st, next.index);
    }
  }
  st.coins = Math.max(st.coins, 2000);
  sim.bus.emit('buildingUpgraded', { id: 'workyard', level: st.buildings.workyard.level });
}

/** 개발용 (주소 ?debtors=N): 일터를 짓고 채무자 n명을 바로 일터에 (빚 20~70). */
export function devSeedDebtors(sim: Sim, n: number): void {
  devBuildDebt(sim);
  const st = sim.state;
  const rng = new Rng(0xdeb7 + n);
  for (let i = 0; i < n; i++) {
    const at = villageOf(st).yard().center;
    const m = createMonster(rng, st, st.nextId++, { x: at.x + rng.range(-160, 160), y: at.y + rng.range(-80, 80) }, null);
    m.phase = 'wandering';
    st.monsters.push(m);
    st.totals.visitors += 1;
    (st.dex[m.species] ??= { visits: 0, reactions: [] }).visits += 1;
    sim.bus.emit('monsterSpawned', { id: m.id });
    sim.devBankrupt(m.id, rng.int(20, 70));
  }
}
