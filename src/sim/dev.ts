// 개발용: 마을을 한 번에 다 연다 (모든 구역과 부스, 그림 있는 진행자를 모두 고용해 자기 자리에).
// 새 부스 연출을 만들 때 쓴다: 주소 ?all=1·?unlockAll=1 (main.ts, 저장하지 않는다), scripts/sim-check.ts --selftest.

import { BOOTH_IDS, GOODS, PRECIOUS, type GoodId, type MaterialId, type PreciousId } from '../data/defs.ts';
import type { SimApi } from './api.ts';
import { isPreset, presetPost } from './staff.ts';

export function devOpenAll(sim: SimApi): void {
  const st = sim.state;
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

/** 개발용: 간식·응원 도구를 몇 개씩 (주소 ?unlockAll=1). 재료·귀한 물건은 devOpenAll이 이미 넉넉히 준다. */
export function devGiveGoods(sim: SimApi, n = 5): void {
  const st = sim.state;
  for (const g of Object.keys(GOODS) as GoodId[]) st.goods[g] = (st.goods[g] ?? 0) + n;
}
