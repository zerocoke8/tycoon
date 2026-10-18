// 개발용: 장신구 붙는 점 대조표 (게임에 쓰지 않는다). 27종 × 4포즈에 머리·목·옆구리 장신구를 하나씩 달아 한 화면에 늘어놓는다.
// data/accessoryAnchors.ts의 FIXES를 맞출 때 본다 (tools/accessory-anchors.ts --sheet 는 점만, 이 화면은 진짜 장신구 그림으로).
//   ?species=종,종 (기본 모두) &poses=base,joy,agony,sad &cell=칸 px (기본 150) &cols=열 수 (기본 화면 폭에 맞춰 포즈 수의 배수)
//   &head=<장신구>|cycle|none &neck=… &side=… (기본 cycle: 종마다 돌려 가며) &set=N (cycle 시작을 N만큼 밀기)
//   &flip=1 (오른쪽 보기) &lean=라디안 (몸 기울이기) &dark=1 (파산 필터) &dots=1 (붙는 점 표시) &label=0 (이름 숨기기) &bg=rrggbb

import { Application, Container, Graphics, Text } from 'pixi.js';
import { ACCESSORIES, ACCESSORY_IDS, SPECIES, SPECIES_IDS, type AccessoryDef, type AccessoryId, type AccessorySlot, type SpeciesId } from '../../../data/defs.ts';
import type { Pose } from '../../../sim/types.ts';
import { AccessoryLayer, accessoryAnchors } from '../../accessory.ts';
import { ArtNode, artMeta, loadArt, monsterFoot } from '../../art.ts';
import { debtFilters } from '../../moodFilter.ts';

const q = new URLSearchParams(location.search);
const list = <T extends string>(name: string, all: readonly T[]): T[] => {
  const v = q.get(name);
  return v === null || v === '' ? [...all] : (v.split(',').filter((s) => (all as readonly string[]).includes(s)) as T[]);
};
const species = list<SpeciesId>('species', SPECIES_IDS);
const poses = list<Pose>('poses', ['base', 'joy', 'agony', 'sad']);
const cell = Number(q.get('cell') ?? '150');
const flip = q.get('flip') === '1';
const lean = Number(q.get('lean') ?? '0');
const dark = q.get('dark') === '1';
const dots = q.get('dots') === '1';
const label = q.get('label') !== '0';
const setOff = Number(q.get('set') ?? '0');
const bg = parseInt(q.get('bg') ?? 'e8e2d6', 16);
const info = document.getElementById('info');

const bySlot = (slot: AccessorySlot): AccessoryId[] => ACCESSORY_IDS.filter((k) => ACCESSORIES[k].slot === slot);
/** 종 i의 자리 장신구 (주소 값 > cycle). 종이 빠진 장신구(고블린 돈주머니)는 달지 않는다. */
function pick(slot: AccessorySlot, i: number, sp: SpeciesId): AccessoryId | null {
  const v = q.get(slot) ?? 'cycle';
  if (v === 'none') return null;
  const all = bySlot(slot);
  const key = v === 'cycle' ? all[(i + setOff) % all.length] : (all.find((k) => k === v) ?? null);
  if (key === undefined || key === null) return null;
  const ex = ((ACCESSORIES[key] as AccessoryDef).exclude ?? []) as readonly string[];
  return ex.includes(sp) ? null : key;
}

const DOT: Record<AccessorySlot, number> = { head: 0xe02828, neck: 0x2858e0, side: 0x14a03c };

async function main(): Promise<void> {
  await loadArt(undefined, 9);
  const perRow = Math.max(1, Math.floor(window.innerWidth / (cell * poses.length)));
  const cols = Number(q.get('cols') ?? String(perRow * poses.length));
  const rows = Math.ceil((species.length * poses.length) / cols);
  const app = new Application();
  await app.init({ width: cols * cell, height: rows * cell, background: bg, antialias: true, resolution: window.devicePixelRatio, autoDensity: true });
  document.body.appendChild(app.canvas);
  const k = (cell * 1.25) / 1024;
  const grid = new Graphics();
  for (let c = 1; c < cols; c++) grid.moveTo(c * cell, 0).lineTo(c * cell, rows * cell);
  for (let r = 1; r < rows; r++) grid.moveTo(0, r * cell).lineTo(cols * cell, r * cell);
  grid.stroke({ color: 0xb8b0a0, width: 1 });
  app.stage.addChild(grid);
  let n = 0;
  species.forEach((sp, si) => {
    const acc = (['head', 'neck', 'side'] as const)
      .map((slot) => ({ slot, key: pick(slot, si, sp) }))
      .filter((a): a is { slot: AccessorySlot; key: AccessoryId } => a.key !== null);
    for (const pose of poses) {
      const usePose: Pose = artMeta('monsters', `${sp}_${pose}`) !== undefined ? pose : 'base';
      const cx = (n % cols) * cell + cell / 2;
      const cy = Math.floor(n / cols) * cell + cell * 0.88;
      n++;
      const root = new Container();
      root.position.set(cx, cy);
      const body = new Container();
      const art = new ArtNode({ k, anchor: monsterFoot(sp, usePose), placeholder: { w: 440, h: 460, color: SPECIES[sp].color } });
      art.setArt('monsters', `${sp}_${usePose}`, monsterFoot(sp, usePose));
      const layer = new AccessoryLayer({ k });
      layer.setPose(sp, usePose);
      layer.setAccessories(acc);
      body.addChild(layer.back, art, layer);
      if (dots) {
        const g = new Graphics();
        const a = accessoryAnchors(sp, usePose);
        const f = monsterFoot(sp, usePose);
        for (const slot of ['head', 'neck', 'side'] as const) g.circle((a[slot].x - f.x) * k, (a[slot].y - f.y) * k, 2.5).fill(DOT[slot]);
        body.addChild(g);
      }
      body.scale.x = flip ? -1 : 1;
      body.rotation = lean;
      if (dark) body.filters = debtFilters(1) === null ? null : [...(debtFilters(1) ?? [])];
      root.addChild(body);
      app.stage.addChild(root);
      if (label) {
        const t = new Text({ text: `${sp} ${pose}`, style: { fontSize: 10, fill: 0x6a5a4a, fontFamily: 'monospace' } });
        t.position.set(cx - cell / 2 + 3, cy - cell * 0.88 + 2);
        app.stage.addChild(t);
      }
    }
  });
  if (info !== null) info.textContent = `${species.length}종 × ${poses.length}포즈 · cell ${cell}${flip ? ' · flip' : ''}${dark ? ' · dark' : ''}${lean !== 0 ? ` · lean ${lean}` : ''}`;
  document.title = 'ready';
}

void main();
