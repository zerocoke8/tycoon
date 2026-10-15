// UI 글자 만들기 (DOM 없음): 이름, 효과 설명, 손님 상태 글, 기분, 구역·자리 묶기.

import {
  BOOTH_IDS,
  BOOTHS,
  boothDef,
  BUILDINGS,
  GOODS,
  MATERIALS,
  ODDS,
  PRECIOUS,
  RACE,
  RECIPES,
  SPECIES,
  SPECIES_IDS,
  type BoothId,
  type BuildingId,
  type MaterialId,
  type SpeciesId,
  type StaffStats,
} from '../data/defs.ts';
import { BOOTH_SPOTS, DISTRICTS, type DistrictId } from '../data/map.ts';
import { presetPost } from '../sim/staff.ts';
import { josa } from '../sim/text.ts';
import type { Candidate, Monster, MonsterPhase, Staff } from '../sim/types.ts';
import { fmt } from './dom.ts';

export const BUILDING_IDS = Object.keys(BUILDINGS) as BuildingId[];
export const MAT_IDS = Object.keys(MATERIALS) as MaterialId[];

type Named = Readonly<Record<string, { readonly name: string } | undefined>>;
const NAMED: readonly Named[] = [MATERIALS as Named, PRECIOUS as Named, GOODS as Named];

/** 아이템 key → 이름 ('coin', mat_*, 귀한 물건, 가공품). */
export function itemName(key: string): string {
  if (key === 'coin') return '코인';
  for (const table of NAMED) {
    const row = table[key];
    if (row !== undefined) return row.name;
  }
  return key;
}

/** 아이템 그림이 없을 때 자리 표시 색. */
export function itemColor(key: string): string {
  if (key === 'coin') return 'var(--dd-gold)';
  if (key in MATERIALS) return 'var(--dd-butter)';
  if (key in PRECIOUS) return 'var(--dd-sky)';
  return 'var(--dd-orange)';
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** 종 색 (defs.ts SPECIES.color, 그림이 없을 때 자리 표시). */
export const SPECIES_COLOR = {} as Record<SpeciesId, string>;
for (const s of SPECIES_IDS) SPECIES_COLOR[s] = hex(SPECIES[s].color);

/** 받침에 맞는 '으로/로' (ㄹ 받침은 '로'). */
export function josaRo(word: string): string {
  const c = word.charCodeAt(word.length - 1);
  if (Number.isNaN(c) || c < 0xac00 || c > 0xd7a3) return `${word}로`;
  const jong = (c - 0xac00) % 28;
  return jong === 0 || jong === 8 ? `${word}로` : `${word}으로`;
}

// ── 구역 ──

/** 구역을 열리는 순서로 (중앙 → 연못 동네 → 북쪽 언덕 → 숲 동네). */
export const DISTRICT_ORDER: readonly DistrictId[] = (Object.keys(DISTRICTS) as DistrictId[]).sort((a, b) => DISTRICTS[a].hall - DISTRICTS[b].hall);

/** 마을회관 레벨 hall에 열리는 구역 (없으면 null). */
export function districtAtHall(hall: number): DistrictId | null {
  return DISTRICT_ORDER.find((d) => DISTRICTS[d].hall === hall) ?? null;
}

/** 부스가 놓인 구역 (지도 자리로 찾고, 못 찾으면 해금 레벨로). */
export function boothDistrict(b: BoothId): DistrictId {
  const p = BOOTH_SPOTS[b].base;
  const inRect = DISTRICT_ORDER.find((d) => {
    const r = DISTRICTS[d].rect;
    return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
  });
  return inRect ?? districtAtHall(boothDef(b).unlock.hall) ?? 'core';
}

/** 구역마다 부스 (BOOTH_IDS 순서). */
export function boothsIn(d: DistrictId): BoothId[] {
  return BOOTH_IDS.filter((b) => boothDistrict(b) === d);
}

/** 닫힌 부스의 까닭 (구역이 아직 닫힘): '연못 동네가 열려야 해요 (마을회관 Lv.2)'. 열 수 있으면 null. */
export function boothLockText(b: BoothId, hall: number): string | null {
  const need = boothDef(b).unlock.hall;
  if (hall >= need) return null;
  const d = DISTRICTS[boothDistrict(b)];
  const name = d.hall === need ? d.name : (DISTRICTS[districtAtHall(need) ?? 'core'].name);
  return `${josa(name, '이', '가')} 열려야 해요 (마을회관 Lv.${need})`;
}

/** 종이 찾아오는 구역 이름 (종의 hall = 그 구역이 열리는 레벨). */
export function speciesDistrict(s: SpeciesId): DistrictId {
  return districtAtHall(SPECIES[s].hall) ?? 'core';
}

/** 특산 재료 → 가져오는 종. */
export const MATERIAL_SPECIES = {} as Record<MaterialId, SpeciesId>;
for (const s of SPECIES_IDS) MATERIAL_SPECIES[SPECIES[s].material] = s;

// ── 놀이부스 ──

/** '슬롯 부스' → '슬롯' */
export const boothShort = (b: BoothId): string => BOOTHS[b].name.replace(/\s*부스$/, '');

/** 좁은 칸용 짧은 이름: '몬스터 경주장' → '경주장'. */
export const boothTiny = (b: BoothId): string => boothShort(b).replace(/^몬스터\s*/, '');

/** 자리 수 낱말 (boothEffect와 같은 말): 경주장은 관중석. */
export const seatWord = (b: BoothId): string => (boothDef(b).roles.length > 1 ? '관중석' : '자리');

/** 참가비 글: '참가비 3' / 복주머니는 '특산 재료 1개'. */
export function feeText(b: BoothId, fee: number): string {
  const m = boothDef(b).matFee ?? 0;
  return m > 0 ? `특산 재료 ${m}개` : `${fee}`;
}

/** 진행자 자리 이름: 자리가 하나면 '진행자', 여럿이면 그 역할 ('출발 신호', '해설자', '사육사'). */
export function roleName(b: BoothId, role: number): string {
  return BOOTHS[b].roles[role]?.name ?? '진행자';
}

/** 그 자리에서 쓰는 능력치 (자리가 하나인 부스는 null: 진행자가 세 능력치를 다 쓴다). */
export function roleStat(b: BoothId, role: number): keyof StaffStats | null {
  const roles = boothDef(b).roles;
  return roles.length > 1 ? (roles[role]?.stat ?? null) : null;
}

/** 자리가 하는 일 한 줄 (비어 있을 때 보여 준다). */
export function roleHelp(b: BoothId, role: number): string {
  const stat = roleStat(b, role);
  if (stat === null) return '진행: 한판이 빨라요 · 입담: 기분 + · 손님맞이: 손님 +';
  if (stat === 'pace') return '진행이 높을수록 출발을 덜 기다려요';
  if (stat === 'charm') return '입담이 높을수록 관중 기분이 올라요';
  return '손님맞이가 높을수록 손님이 더 몰려요';
}

/** 자리 하나의 긴 이름: '슬롯 부스' / '몬스터 경주장 해설자'. */
export function postName(b: BoothId, role: number): string {
  return BOOTHS[b].roles.length > 1 ? `${BOOTHS[b].name} ${roleName(b, role)}` : BOOTHS[b].name;
}

/** 진행자가 맡은 곳 한 줄: '쉬는 중' / '슬롯 부스 진행 중' / '몬스터 경주장 해설자'. */
export function staffWhere(st: Staff): string {
  const p = st.post;
  if (p === null) return '쉬는 중';
  return BOOTHS[p.booth].roles.length > 1 ? postName(p.booth, p.role) : `${BOOTHS[p.booth].name} 진행 중`;
}

/** 그림 있는 진행자(defs.ts HOST_PRESETS)의 어울리는 자리. 그림만 빌려 쓴 후보는 이름까지 같아야 한다 (sim/staff.ts presetPost). */
export function presetPostOf(who: Pick<Candidate, 'name' | 'art'>): { booth: BoothId; role: number } | null {
  return presetPost(who);
}

/** 가장 높은 능력치 (같으면 진행 → 입담 → 손님맞이). */
export function bestStat(stats: StaffStats): keyof StaffStats {
  let best: keyof StaffStats = 'pace';
  for (const k of ['charm', 'welcome'] as const) if (stats[k] > stats[best]) best = k;
  return best;
}

/** 놀이부스 레벨의 효과 한 줄. */
export function boothEffect(b: BoothId, level: number): string | null {
  const d = boothDef(b);
  const i = level - 1;
  const fee = d.fee[i];
  const seats = d.seats[i];
  const cap = d.potCap[i];
  if (fee === undefined || seats === undefined || cap === undefined) return null;
  return `참가비 ${feeText(b, fee)} · ${seatWord(b)} ${seats} · 항아리 ${fmt(cap)}`;
}

/** 진행자 자리 줄 (자리가 여럿인 부스만): '출발 신호 · 해설자 · 사육사(있으면 좋아요)'. */
export function boothRolesText(b: BoothId): string | null {
  const roles = boothDef(b).roles;
  if (roles.length < 2) return null;
  return roles.map((r) => (r.optional === true ? `${r.name}(있으면 좋아요)` : r.name)).join(' · ');
}

/** 부스만의 규칙 한 줄 (없으면 null). */
export function boothRule(b: BoothId): string | null {
  const d = boothDef(b);
  if (b === 'duck') {
    const back = ODDS.duck.lose[1];
    return `잃어도 건 코인의 ${back === 0.5 ? '반' : `${Math.round(back * 100)}%`}을 돌려받아요 · 한판마다 기분 +${d.moodPerRound ?? 0}`;
  }
  if ((d.matFee ?? 0) > 0) return `참가비는 손님의 특산 재료 ${d.matFee}개 (마을 창고로 와요) · 노랑 주머니 대박이면 떠날 때 귀한 물건을 꼭 남겨요`;
  if (b === 'claw') return '뽑은 인형은 도감의 인형 칸에 모여요';
  if (b === 'wheel') return '찜한 칸에 멈추면 이겨요 · 종 칸이면 대박';
  if (b === 'ring') return '고리 셋 가운데 둘 이상 걸면 이겨요';
  if (b === 'race') return `손님마다 선수 하나를 응원해요 · ${RACE.minRunners}명 이상 모이면 곧 출발`;
  return null;
}

export function boothPotCap(b: BoothId, level: number): number {
  const cap = BOOTHS[b].potCap;
  return cap[Math.min(cap.length, Math.max(1, level)) - 1] ?? 1;
}

/** 경주 선수 조끼 색 (CSS). */
export const RACER_COLOR: readonly string[] = RACE.racers.map((r) => hex(r.bib));

// ── 건물 ──

/** 건물 레벨의 효과 한 줄 (없는 레벨이면 null). */
export function buildingEffect(id: BuildingId, level: number): string | null {
  const i = level - 1;
  switch (id) {
    case 'hall': {
      const L = BUILDINGS.hall.levels[i];
      return L ? `손님이 한 번에 ${L.visitors}명까지` : null;
    }
    case 'gate': {
      const L = BUILDINGS.gate.levels[i];
      return L ? `손님이 ${L.spawnSec}초마다 찾아온다` : null;
    }
    case 'workshop': {
      const L = BUILDINGS.workshop.levels[i];
      return L ? `동시에 ${L.slots}개 · 속도 ×${L.speed}` : null;
    }
    case 'office': {
      const L = BUILDINGS.office.levels[i];
      return L ? `고용 후보 ${L.candidates}명` : null;
    }
    case 'warehouse': {
      const L = BUILDINGS.warehouse.levels[i];
      return L ? `재료마다 ${L.cap}개까지` : null;
    }
    case 'fountain': {
      const L = BUILDINGS.fountain.levels[i];
      return L ? `손님 기분 1분에 +${L.moodPerMin}` : null;
    }
  }
}

export const buildingMaxLevel = (id: BuildingId): number => BUILDINGS[id].levels.length;

/** 마을회관이 level이 되면 새로 열리는 것들. */
export function hallUnlocks(level: number): string[] {
  const out: string[] = [];
  const ds = DISTRICT_ORDER.filter((d) => DISTRICTS[d].hall === level).map((d) => DISTRICTS[d].name);
  if (ds.length > 0) out.push(`새 구역: ${ds.join(', ')}`);
  const bs = BOOTH_IDS.filter((b) => boothDef(b).unlock.hall === level).map((b) => boothShort(b));
  if (bs.length > 0) out.push(`새 놀이부스 자리: ${bs.join(', ')}`);
  const sp = SPECIES_IDS.filter((s) => SPECIES[s].hall === level).map((s) => SPECIES[s].name);
  if (sp.length > 0) out.push(`새 손님: ${sp.join(', ')}`);
  const rc = [...new Set(RECIPES.filter((r) => r.hall === level).map((r) => GOODS[r.out].name))];
  if (rc.length > 0) out.push(`새 레시피: ${rc.join(', ')}`);
  return out;
}

// ── 손님 ──

const PHASE: Record<MonsterPhase, string> = {
  arriving: '마을에 들어오는 중',
  wandering: '마을 구경 중',
  toBooth: '가는 중',
  queued: '줄 서는 중',
  toSeat: '자리에 앉는 중',
  playing: '한판 하는 중',
  reacting: '결과에 반응 중',
  resting: '분수 옆에서 쉬는 중',
  spectating: '남의 판 구경 중',
  leaving: '집에 가는 중',
};

/** 손님의 지금 할 일 한 줄. */
export function monsterStatus(m: Monster): string {
  const p = PHASE[m.phase];
  if (m.booth !== null && (m.phase === 'toBooth' || m.phase === 'queued' || m.phase === 'toSeat' || m.phase === 'playing' || m.phase === 'reacting')) {
    return m.phase === 'toBooth' ? `${josaRo(BOOTHS[m.booth].name)} ${p}` : `${BOOTHS[m.booth].name}에서 ${p}`;
  }
  return p;
}

/** 기분 0~100 → 이름과 막대 색. */
export function moodInfo(mood: number): { label: string; color: string } {
  if (mood >= 75) return { label: '신남', color: 'var(--dd-green)' };
  if (mood >= 50) return { label: '좋음', color: 'var(--dd-green)' };
  if (mood >= 30) return { label: '그럭저럭', color: 'var(--dd-butter)' };
  if (mood >= 15) return { label: '시무룩', color: 'var(--dd-orange)' };
  return { label: '울적', color: 'var(--dd-red)' };
}
