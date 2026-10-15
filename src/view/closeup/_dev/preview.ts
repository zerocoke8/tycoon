// 개발용: 가짜 sim으로 확대 화면 연출을 보는 미리보기 (게임에 쓰지 않는다).
//   ?booth=slot|oddeven|cups|darts|wheel|duck|ring|race|claw|pouch &tier=jackpot|win|nearMiss|lose &at=초(한판 시작 뒤, 그 시각에서 멈춤; 없으면 계속 돈다)
//   &seats=1|2 (경주장은 6까지) &sp=dragon|crab|… &w=&h= (패널 크기, 없으면 UI와 같은 계산)
//   ?real=초 : 진짜 Sim을 그만큼 돌린 뒤 한판 중인 부스를 열고, &at=초 더 돌려 멈춘다 (&seed=, &hop=1 부스 바꿔 열기, &catch=초 20초에 몰아서 계산).

import { Application } from 'pixi.js';
import { Emitter } from '../../../core/events.ts';
import { tweens } from '../../../core/tween.ts';
import { BOOTH_IDS, BOOTHS, HOST_PRESETS, type BoothId, type OutcomeTier, type SpeciesId } from '../../../data/defs.ts';
import type { SimApi } from '../../../sim/api.ts';
import type { ActiveRound, BoothState, GameState, Monster, Reaction, RoundDetail, SimEvents } from '../../../sim/types.ts';
import { Sim, newGame } from '../../../sim/sim.ts';
import { loadArt } from '../../art.ts';
import { CloseupView } from '../closeupView.ts';

const q = new URLSearchParams(location.search);
const booth = (q.get('booth') ?? 'slot') as BoothId;
const tier = (q.get('tier') ?? 'win') as OutcomeTier;
const atRaw = q.get('at');
const seats = Number(q.get('seats') ?? '1');
const species = (q.get('sp') ?? 'dragon') as SpeciesId;

function detail(): RoundDetail {
  switch (booth) {
    case 'slot':
      return { kind: 'slot', reels: tier === 'jackpot' ? ['sym_bell', 'sym_bell', 'sym_bell'] : tier === 'win' ? ['sym_star', 'sym_star', 'sym_star'] : tier === 'nearMiss' ? ['sym_gem', 'sym_gem', 'sym_star'] : ['sym_apple', 'sym_gem', 'sym_acorn'] };
    case 'oddeven':
      return { kind: 'oddeven', pebbles: 7, guess: tier === 'win' ? 'odd' : 'even' };
    case 'cups':
      return { kind: 'cups', swaps: [[0, 1], [1, 2], [0, 2], [0, 1]], ballAt: tier === 'win' ? 1 : 0, picked: tier === 'lose' ? 2 : 1 };
    case 'darts':
      return { kind: 'darts', dist: tier === 'jackpot' ? 0.05 : tier === 'win' ? 0.3 : tier === 'nearMiss' ? 0.52 : 0.8, angle: 2.4 };
    case 'wheel':
      return { kind: 'wheel', picked: tier === 'win' ? 2 : tier === 'lose' ? 1 : 5, landed: tier === 'jackpot' ? 5 : tier === 'win' ? 2 : tier === 'nearMiss' ? 0 : 4, turns: 4 };
    case 'duck':
      return { kind: 'duck', duck: 2, mark: tier === 'jackpot' ? 'gold' : tier === 'win' ? 'silver' : tier === 'nearMiss' ? 'gold' : 'none', slipped: tier === 'nearMiss' };
    case 'ring': {
      const hits = tier === 'jackpot' ? [true, true, true] : tier === 'win' ? [true, false, true] : tier === 'nearMiss' ? [true, false, false] : [false, false, false];
      return { kind: 'ring', throws: hits.map((hit, i) => ({ bottle: [4, 0, 8][i] ?? 0, hit, wobble: tier === 'nearMiss' && i === 2 })) };
    }
    case 'claw':
      return { kind: 'claw', x: 0.6, target: species, target2: tier === 'jackpot' ? 'crab' : null, result: tier === 'jackpot' ? 'double' : tier === 'win' ? 'win' : tier === 'nearMiss' ? 'slip' : 'miss', slipAt: tier === 'nearMiss' ? 0.85 : tier === 'lose' ? 0 : 1 };
    case 'pouch':
      return { kind: 'pouch', pick: tier === 'jackpot' ? 2 : tier === 'nearMiss' ? 1 : 0, content: tier === 'jackpot' ? 'jackpot' : tier === 'win' ? 'coins' : tier === 'nearMiss' ? 'one' : 'empty' };
    case 'race':
      return { kind: 'race', racer: 0, place: tier === 'jackpot' || tier === 'win' ? 1 : tier === 'nearMiss' ? 2 : 3, comeback: tier === 'jackpot', photoFinish: tier === 'nearMiss' };
  }
}

const REACT: Record<OutcomeTier, Reaction> = {
  jackpot: { pose: 'joy', emote: 'sparkle', motion: 'bigHop', intensity: 1.2, duration: 2.5, label: '대박 만세' },
  win: { pose: 'joy', emote: 'heart', motion: 'hop', intensity: 1, duration: 2, label: '신난다' },
  nearMiss: { pose: 'agony', emote: 'shock', motion: 'tremble', intensity: 1, duration: 2, label: '아깝다!' },
  lose: { pose: 'sad', emote: 'tear', motion: 'slump', intensity: 1, duration: 2, label: '털썩' },
};

const mon = (id: number, sp: SpeciesId): Monster =>
  ({ id, species: sp, nickname: '콩', traits: ['cheerful'], wallet: 50, mood: 60, patience: 3, phase: 'playing', pos: { x: 0, y: 0 }, facing: -1, path: [], booth, seat: id - 1, pose: 'base', stats: { rounds: 0, wins: 0, jackpots: 0, nearMisses: 0, spent: 0, won: 0 }, timer: 0, cheerCooldown: 0, hadJackpot: false, mats: 1 }) as Monster;

// 진행자: 그 부스 자리마다 그림이 맞는 진행자 (HOST_PRESETS).
const roles = BOOTHS[booth].roles.map((_, role) => HOST_PRESETS.find((p) => p.booth === booth && p.role === role));
const bs: BoothState = {
  unlocked: true,
  level: 1,
  pot: 128,
  staff: roles.map((_, i) => i + 1),
  seats: seats > 1 ? Array.from({ length: seats }, (_, i) => i + 1) : [1],
  queue: [],
  rounds: Array.from({ length: Math.max(1, seats) }, () => null),
  cheer: null,
  race: null,
};
const state = {
  booths: Object.fromEntries(BOOTH_IDS.map((b) => [b, bs])),
  staff: roles.map((p, i) => ({ id: i + 1, name: p?.name ?? '진행자', art: p?.art ?? 'host_slot', stats: { pace: 3, charm: 3, welcome: 3 }, level: 1, post: { booth, role: i } })),
  monsters: Array.from({ length: Math.max(2, seats) }, (_, i) => mon(i + 1, i === 0 ? species : 'crab')),
} as unknown as GameState;
const bus = new Emitter<SimEvents>();
const sim = { state, bus, monster: (id: number) => state.monsters.find((m) => m.id === id) } as unknown as SimApi;

const D = BOOTHS[booth].roundSec[0] ?? 4;
let clock = -0.6;
let started = false;
let round: ActiveRound | null = null;

function tickSim(dt: number): void {
  clock += dt;
  if (!started && clock >= 0) {
    started = true;
    round = { monster: 1, bet: 10, fee: 2, outcome: { tier, multiplier: tier === 'jackpot' ? 20 : tier === 'win' ? 3 : 0, detail: detail() }, elapsed: 0, duration: D };
    bs.rounds[0] = round;
    bus.emit('roundStarted', { booth, seat: 0, round });
  }
  if (round !== null) {
    round.elapsed += dt;
    if (round.elapsed >= round.duration) {
      const r = round;
      round = null;
      bs.rounds[0] = null;
      const payout = Math.min(bs.pot, r.bet * r.outcome.multiplier);
      bs.pot -= payout;
      bus.emit('roundFinished', { booth, seat: 0, round: r, payout });
      bus.emit('monsterReact', { id: 1, reaction: REACT[tier] });
    }
  }
}

/** 진짜 Sim으로: pre초 돌리고 → 한판 중인 부스를 열고 → at초 더 (프레임 1/60, 틱 SIM.dt). */
async function real(app: Application, pre: number): Promise<void> {
  const rs = new Sim(newGame(Number(q.get('seed') ?? '7')));
  let errors = 0;
  const counts: Record<string, number> = {};
  for (const k of ['roundStarted', 'roundFinished', 'monsterReact', 'potFestival'] as const) rs.bus.on(k, () => (counts[k] = (counts[k] ?? 0) + 1));
  for (let t = 0; t < pre; t += 0.1) rs.tick(0.1);
  // 한판 중인 부스 (없으면 손님이 있는 부스)
  const ids = BOOTH_IDS;
  const pick = ids.find((b) => rs.state.booths[b].rounds.some((r) => r !== null)) ?? ids.find((b) => rs.state.booths[b].seats.some((x) => x !== null)) ?? 'slot';
  const closeup = new CloseupView(app, rs);
  const vw = window.innerWidth;
  const w = Math.max(160, Math.min(vw - 24, 600));
  const h = Math.round(Math.min(w * 0.95, window.innerHeight * 0.48));
  closeup.open(pick, { x: Math.round((vw - w) / 2), y: 64, w, h });
  let acc = 0;
  const at = Number(atRaw ?? '0');
  for (let t = 0; t < at; t += 1 / 60) {
    acc += 1 / 60;
    while (acc >= 0.1) {
      acc -= 0.1;
      rs.tick(0.1);
    }
    try {
      closeup.update(1 / 60);
      tweens.update(1 / 60);
    } catch (e) {
      errors++;
      if (errors < 3) console.error(e);
    }
    // 탭이 숨겨졌다 돌아온 것처럼 몰아서 계산 (이벤트 없이 상태만 바뀐다).
    if (q.get('catch') !== null && Math.floor(t * 60) === 1200) rs.catchUp(Number(q.get('catch')));
    // 가끔 다른 부스로 바꿔 연다 (열고 닫기 시험).
    if (q.get('hop') !== null && Math.floor(t * 60) % 600 === 599) {
      const next = ids[(ids.indexOf(closeup.booth ?? 'slot') + 1) % ids.length] ?? 'slot';
      closeup.open(next, { x: Math.round((vw - w) / 2), y: 64, w, h });
    }
  }
  console.log('booth', closeup.booth, 'events', JSON.stringify(counts), 'errors', errors, 'rounds', JSON.stringify(rs.state.booths[closeup.booth ?? 'slot'].rounds.map((r) => r && { t: r.outcome.tier, e: +r.elapsed.toFixed(2), d: +r.duration.toFixed(2) })));
  app.ticker.stop();
  app.render();
  document.title = 'ready';
}

async function main(): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, background: 0x93b468, antialias: true, resolution: Math.min(2, devicePixelRatio), autoDensity: true, preference: 'webgl' });
  document.body.append(app.canvas);
  // 미리보기는 모든 부스를 보니 그림을 다 (회관 4) 불러온다.
  await loadArt(undefined, 4);
  const pre = q.get('real');
  if (pre !== null) return real(app, Number(pre));
  const closeup = new CloseupView(app, sim);
  closeup.onTapMonster = (id) => console.log('tap', id);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Number(q.get('w') ?? Math.max(160, Math.min(vw - 24, 600)));
  const h = Number(q.get('h') ?? Math.round(Math.min(w * 0.95, vh * 0.48)));
  closeup.open(booth, { x: Math.round((vw - w) / 2), y: 64, w, h });
  const step = (dt: number): void => {
    tickSim(dt);
    closeup.update(dt);
    tweens.update(dt);
  };
  if (atRaw !== null) {
    // 그 시각까지 한 번에 돌리고 멈춘다 (스크린샷용).
    const at = Number(atRaw);
    while (clock < at - 1e-6) step(1 / 60);
    app.ticker.stop();
    app.render();
    document.title = 'ready';
    return;
  }
  app.ticker.add((t) => step(Math.min(0.1, t.deltaMS / 1000)));
}

void main();
