// 개발용: 진짜 Sim으로 오리배 경주·연날리기 확대 화면의 한 순간을 보는 미리보기 (게임에 쓰지 않는다).
// 마을을 다 열고 그 부스만 열어 두어(손님이 다 그리로) 원하는 판이 나올 때까지 빨리 돌린 뒤, 판 시작 lead초 전 상태에서
// 확대 화면을 열고 프레임(1/60초)마다 at초(판 시작 뒤)까지 돌려 멈춘다.
//   ?booth=boat|kite &want=any|photo|comeback|plain(오리배)|close|late|plain(연) &n=최소 참가자
//   &at=초[,초…](판 시작 뒤, 음수면 시작 전: 여러 개면 시각마다 title 'shot:i'로 멈춰 찍기(window.__shotDone = 'i')를 기다린다)
//   &lead=초 &seed= &level=1~3 &live=1(멈추지 않고 계속) &w=&h=(패널)

import { Application } from 'pixi.js';
import { tweens } from '../../../core/tween.ts';
import { BOOTH_IDS, type BoothId } from '../../../data/defs.ts';
import { devOpenAll } from '../../../sim/dev.ts';
import { Sim, newGame } from '../../../sim/sim.ts';
import type { GameState, GroupPlay, GroupState } from '../../../sim/types.ts';
import { loadArt } from '../../art.ts';
import { CloseupView } from '../closeupView.ts';

const q = new URLSearchParams(location.search);
const booth = (q.get('booth') ?? 'boat') as BoothId;
const want = q.get('want') ?? 'any';
const minN = Number(q.get('n') ?? '2');
const lead = Number(q.get('lead') ?? '3');
const seed = Number(q.get('seed') ?? '3');
const level = Number(q.get('level') ?? '1');
const live = q.get('live') !== null;
const info = document.getElementById('info');

function makeSim(): Sim {
  const s = new Sim(newGame(seed));
  devOpenAll(s);
  for (let i = 1; i < level; i++) s.upgradeBooth(booth);
  for (const b of BOOTH_IDS) if (b !== booth) s.state.booths[b].unlocked = false;
  return s;
}

function matches(play: GroupPlay, g: GroupState): boolean {
  if (g.participants.length < minN) return false;
  switch (want) {
    case 'photo':
      return play.kind === 'boat' && play.race.photoFinish;
    case 'comeback':
      return play.kind === 'boat' && play.race.comeback;
    case 'close':
      return play.kind === 'kite' && play.close;
    case 'late':
      return play.kind === 'kite' && play.late && !play.close;
    case 'plain':
      return (play.kind === 'boat' && !play.race.photoFinish && !play.race.comeback) || (play.kind === 'kite' && !play.close && !play.late);
    default:
      return true;
  }
}

/** 원하는 판이 시작되는 틱과 그보다 lead초 이상 앞의 상태 (1초마다 떠 둔 것). */
function findStart(): { tick: number; snap: GameState; snapTick: number } | null {
  const s = makeSim();
  const snaps: { tick: number; state: GameState }[] = [];
  for (let i = 0; i < 20 * 60 * 10; i++) {
    if (i % 10 === 0) {
      snaps.push({ tick: i, state: structuredClone(s.state) });
      if (snaps.length > 12) snaps.shift();
    }
    const before = s.state.booths[booth].group?.phase;
    s.tick(0.1);
    const g = s.state.booths[booth].group;
    if (g === null) return null;
    if (before === 'running' || g.phase !== 'running' || g.play === null || !matches(g.play, g)) continue;
    const tick = i + 1;
    const snap = [...snaps].reverse().find((x) => x.tick <= tick - lead * 10) ?? snaps[0];
    return snap === undefined ? null : { tick, snap: snap.state, snapTick: snap.tick };
  }
  return null;
}

function describe(s: Sim): string {
  const g = s.state.booths[booth].group;
  if (g === null) return '';
  const p = g.play;
  const ent = g.participants.map((e, i) => `${e.seat}:${s.monster(e.monster)?.species ?? '?'} pick${e.pick} ${e.role[0]} ${p?.outcomes[i]?.tier ?? ''}`).join('  ');
  let extra = '';
  if (p?.kind === 'boat') extra = `order ${p.race.finishOrder.join(',')} at ${p.race.finishAt.map((t) => t.toFixed(2)).join(',')} photo ${p.race.photoFinish} comeback ${p.race.comeback}`;
  if (p?.kind === 'kite') extra = `order ${p.order.join(',')} cutAt ${p.cutAt.map((t) => t.toFixed(1)).join(',')} close ${p.close} late ${p.late} end ${p.end}`;
  return `${booth} ${g.phase} t=${g.elapsed.toFixed(2)} | ${extra}\n${ent}`;
}

async function main(): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, background: 0x93b468, antialias: true, resolution: Math.min(2, devicePixelRatio), autoDensity: true, preference: 'webgl' });
  document.body.append(app.canvas);
  await loadArt(undefined, 5);
  await document.fonts.ready;
  const found = findStart();
  if (found === null) {
    if (info !== null) info.textContent = '원하는 판을 못 찾았어요';
    document.title = 'ready';
    return;
  }
  const s = new Sim(found.snap);
  const closeup = new CloseupView(app, s);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const full = Math.max(160, Math.min(vw - 24, 600));
  const hh = Number(q.get('h') ?? Math.round(Math.min(full * 0.95, vh * (vh < 720 ? 0.4 : 0.48))));
  const w = Number(q.get('w') ?? Math.max(160, Math.min(full, Math.round(hh * 1.6))));
  closeup.open(booth, { x: Math.round((vw - w) / 2), y: 64, w, h: hh });
  let acc = 0;
  let simT = found.snapTick * 0.1;
  const startT = found.tick * 0.1;
  const step = (dt: number): void => {
    acc += dt;
    while (acc >= 0.1 - 1e-9) {
      acc -= 0.1;
      s.tick(0.1);
      simT += 0.1;
    }
    closeup.update(dt);
    tweens.update(dt);
  };
  const done = window as unknown as { __shotDone?: string };
  const ats = String(q.get('at') ?? '3').split(',').map(Number).filter((v) => Number.isFinite(v));
  for (let i = 0; i < ats.length; i++) {
    const stopAt = startT + (ats[i] ?? 0);
    while (simT + acc < stopAt - 1e-6) {
      step(1 / 60);
      await yieldTask();
    }
    if (info !== null) info.textContent = describe(s);
    if (i === ats.length - 1 && live) break;
    app.render();
    document.title = `shot:${i}`;
    while (done.__shotDone !== String(i)) await new Promise((r) => setTimeout(r, 50));
  }
  if (live) {
    app.ticker.add((t) => {
      step(Math.min(0.1, t.deltaMS / 1000));
      if (info !== null) info.textContent = describe(s);
    });
    return;
  }
  app.ticker.stop();
  document.title = 'ready';
}

/** 다음 일거리로 (setTimeout처럼 4ms로 묶이지 않게). */
function yieldTask(): Promise<void> {
  return new Promise((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => r();
    ch.port2.postMessage(0);
  });
}

void main();
