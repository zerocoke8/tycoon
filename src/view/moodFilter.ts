// 파산한 손님의 어두운 필터 (넷째 묶음, DESIGN 3.7): 채도를 빼고 25%쯤 어둡게, 살짝 푸르스름하게.
// 단계(STEPS)마다 필터 하나를 만들어 모든 손님이 나눠 쓴다 (다 갚으면 LABOR.reliefSec 동안 단계를 내려 어둠이 걷힌다).
// 지도 손님(monsterView.ts), 확대 화면 손님, 다른 화면이 같이 쓴다: node.filters = debtFilters(t).

import { ColorMatrixFilter, type Filter } from 'pixi.js';

/** 어둠 단계 수 (0 = 그대로 ~ STEPS = 파산 모습). */
const STEPS = 10;
/** 파산 모습: 채도를 이만큼 빼고 (0~1), 밝기 배수, 푸른 기운. */
const DESAT = 0.7;
const DARKEN = 0.25;
const COOL = 0.06;

const cache: (readonly Filter[] | null)[] = [];

/** t(0~1)의 단계 필터 한 벌 (공유). t가 0에 가까우면 null (필터 없음). 화면이 node.filters에 그대로 넣는다. */
export function debtFilters(t: number): readonly Filter[] | null {
  const i = Math.round(Math.max(0, Math.min(1, t)) * STEPS);
  if (i <= 0) return null;
  const hit = cache[i];
  if (hit !== undefined && hit !== null) return hit;
  const u = i / STEPS;
  const f = new ColorMatrixFilter();
  f.resolution = 'inherit';
  f.antialias = 'inherit';
  // 밝기(휘도) 쪽으로 d만큼 섞어 채도를 빼고 (Pixi saturate는 -1보다 작으면 색이 뒤집혀 직접 만든다), 어둡게, 빨강·초록을 조금 줄여 푸르스름하게.
  const d = DESAT * u;
  const b = 1 - DARKEN * u;
  const tint = [b * (1 - COOL * u), b * (1 - COOL * u * 0.5), b];
  const lum = [0.299, 0.587, 0.114];
  const m: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) m.push(((row === col ? 1 - d : 0) + d * (lum[col] ?? 0)) * (tint[row] ?? 1));
    m.push(0, 0);
  }
  m.push(0, 0, 0, 1, 0);
  f.matrix = m as typeof f.matrix;
  const list = [f];
  cache[i] = list;
  return list;
}

/** 한 단계씩 (화면이 지난 단계와 비교해 filters를 바꿀지 정할 때). */
export function debtStep(t: number): number {
  return Math.round(Math.max(0, Math.min(1, t)) * STEPS);
}
