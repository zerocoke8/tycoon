// 개발용: 가짜 sim으로 몬스터 경주장 '함께 경주' 연출을 보는 미리보기 (게임에 쓰지 않는다).
// sim이 경주 lifecycle(RaceState: gathering → running → done)을 이을 때의 모습을 미리 본다: 손님이 하나씩 앉으며 선수에 걸고,
// 카운트다운 뒤 경주 하나를 같이 보고, 끝나면 자리마다 roundFinished + monsterReact.
//   ?n=1~6 (손님 수) &comeback=1 &photo=1 &seed= &at=초(그 시각에서 멈춤; 없으면 계속 돈다) &gather=초(모이는 시간, 기본 5)
//   &w=&h= (패널 크기) &closed=1 (해설자 없음)

import { Application } from 'pixi.js';
import { Emitter } from '../../../core/events.ts';
import { Rng } from '../../../core/rng.ts';
import { tweens } from '../../../core/tween.ts';
import { BOOTH_IDS, BOOTHS, HOST_PRESETS, ODDS, type OutcomeTier, type SpeciesId } from '../../../data/defs.ts';
import type { SimApi } from '../../../sim/api.ts';
import { generateRace, raceOutcome } from '../../../sim/race.ts';
import type { BoothState, GameState, Monster, RacerIndex, Reaction, SimEvents } from '../../../sim/types.ts';
import { idleRace } from '../../../sim/race.ts';
import { loadArt } from '../../art.ts';
import { CloseupView } from '../closeupView.ts';

const q = new URLSearchParams(location.search);
const n = Math.max(0, Math.min(6, Number(q.get('n') ?? '5')));
const atRaw = q.get('at');
const gather = Number(q.get('gather') ?? '5');
const rng = new Rng(Number(q.get('seed') ?? '11'));
const SPECIES: SpeciesId[] = (q.get('sp') ?? 'dragon,crab,bat,dokkaebi,ghost,goblin').split(',') as SpeciesId[];

const REACT: Record<OutcomeTier, Reaction> = {
  jackpot: { pose: 'joy', emote: 'sparkle', motion: 'bigHop', intensity: 1.2, duration: 2.5, label: '대박 만세' },
  win: { pose: 'joy', emote: 'heart', motion: 'hop', intensity: 1, duration: 2, label: '신난다' },
  nearMiss: { pose: 'agony', emote: 'shock', motion: 'tremble', intensity: 1, duration: 2, label: '아깝다!' },
  lose: { pose: 'sad', emote: 'tear', motion: 'slump', intensity: 1, duration: 2, label: '털썩' },
};

const mon = (id: number, sp: SpeciesId): Monster =>
  ({ id, species: sp, nickname: '콩', traits: ['cheerful'], wallet: 50, mood: 60, patience: 3, phase: 'playing', pos: { x: 0, y: 0 }, facing: -1, path: [], booth: 'race', seat: id - 1, pose: 'base', stats: { rounds: 0, wins: 0, jackpots: 0, nearMisses: 0, spent: 0, won: 0 }, timer: 0, cheerCooldown: 0, hadJackpot: false, mats: 1 }) as Monster;

const roles = BOOTHS.race.roles.map((_, role) => HOST_PRESETS.find((p) => p.booth === 'race' && p.role === role));
const closed = q.get('closed') !== null;
const bs: BoothState = {
  unlocked: true,
  level: 1,
  pot: 240,
  staff: roles.map((_, i) => (closed && i === 1 ? null : i + 1)),
  seats: Array.from({ length: 6 }, () => null),
  queue: [],
  rounds: Array.from({ length: 6 }, () => null),
  cheer: null,
  race: idleRace(),
};
const state = {
  booths: Object.fromEntries(BOOTH_IDS.map((b) => [b, bs])),
  staff: roles.map((p, i) => ({ id: i + 1, name: p?.name ?? '진행자', art: p?.art ?? 'host_slot', stats: { pace: 3, charm: 3, welcome: 3 }, level: 1, post: { booth: 'race', role: i } })),
  monsters: Array.from({ length: 6 }, (_, i) => mon(i + 1, SPECIES[i] ?? 'dragon')),
} as unknown as GameState;
const bus = new Emitter<SimEvents>();
const sim = { state, bus, monster: (id: number) => state.monsters.find((m) => m.id === id) } as unknown as SimApi;

const D = BOOTHS.race.roundSec[0] ?? 10;
const opts = { ...(q.get('comeback') !== null ? { comeback: true } : {}), ...(q.get('photo') !== null ? { photo: true } : {}) };
const result = generateRace(rng, D, opts);
// 손님 i가 거는 선수: 역전·사진 판정 경주면 둘째 손님이 1등, 셋째가 2등에 걸게 (연출을 보려고).
const betOf = (i: number): RacerIndex => (i === 1 ? (result.finishOrder[0] ?? 0) : i === 2 ? (result.finishOrder[1] ?? 1) : (rng.int(0, 3) as RacerIndex));
const bets = Array.from({ length: 6 }, (_, i) => betOf(i));
let clock = -0.3;
let finished = false;
let cleared = false;

function tickSim(dt: number): void {
  clock += dt;
  const race = bs.race!;
  // 모이기: 손님이 gather초 동안 하나씩 앉는다.
  for (let i = 0; i < n; i++) {
    const at = (i / Math.max(1, n)) * gather * 0.6;
    if (clock >= at && bs.seats[i] === null && race.phase !== 'done' && !cleared) {
      bs.seats[i] = i + 1;
      race.participants.push({ monster: i + 1, seat: i, racer: bets[i] ?? 0, bet: 10, fee: 2 });
      if (race.phase === 'idle') {
        race.phase = 'gathering';
        race.countdown = gather;
      }
    }
  }
  if (race.phase === 'gathering') {
    race.countdown -= dt;
    if (race.countdown <= 0) {
      race.phase = 'running';
      race.elapsed = 0;
      race.duration = D;
      race.result = result;
      bus.emit('raceStarted', { booth: 'race', race });
    }
  } else if (race.phase === 'running') {
    race.elapsed += dt;
    if (race.elapsed >= race.duration) {
      race.phase = 'done';
      race.countdown = 3;
      bus.emit('raceFinished', { booth: 'race', race });
    }
  } else if (race.phase === 'done' && !finished) {
    finished = true;
    for (const p of race.participants) {
      const outcome = raceOutcome(result, p.racer);
      const row = ODDS.race as Partial<Record<OutcomeTier, readonly [number, number]>>;
      const payout = Math.min(bs.pot, Math.round(p.bet * (row[outcome.tier]?.[1] ?? 0)));
      bs.pot -= payout;
      const round = { monster: p.monster, bet: p.bet, fee: p.fee, outcome, elapsed: D, duration: D };
      bus.emit('roundFinished', { booth: 'race', seat: p.seat, round, payout });
      bus.emit('monsterReact', { id: p.monster, reaction: REACT[outcome.tier] });
    }
  } else if (race.phase === 'done') {
    race.countdown -= dt;
    if (race.countdown <= 0 && !cleared) {
      cleared = true;
      for (let i = 0; i < 6; i++) bs.seats[i] = null;
      Object.assign(race, idleRace());
    }
  }
}

async function main(): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, background: 0x93b468, antialias: true, resolution: Math.min(2, devicePixelRatio), autoDensity: true, preference: 'webgl' });
  document.body.append(app.canvas);
  await loadArt(undefined, 4);
  const closeup = new CloseupView(app, sim);
  closeup.onTapMonster = (id) => console.log('tap', id);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Number(q.get('w') ?? Math.max(160, Math.min(vw - 24, 600)));
  const h = Number(q.get('h') ?? Math.round(Math.min(w * 0.95, vh * 0.48)));
  closeup.open('race', { x: Math.round((vw - w) / 2), y: 64, w, h });
  // 프레임마다 따로 (Promise.then이 프레임 사이에 돌게).
  const step = (dt: number): void => {
    tickSim(dt);
    closeup.update(dt);
    tweens.update(dt);
  };
  if (atRaw !== null) {
    const at = Number(atRaw);
    while (clock < at - 1e-6) {
      step(1 / 60);
      await Promise.resolve();
    }
    app.ticker.stop();
    app.render();
    console.log('order', result.finishOrder.join(','), 'comeback', result.comeback, 'photo', result.photoFinish, 'bets', bets.slice(0, n).join(','));
    document.title = 'ready';
    return;
  }
  app.ticker.add((t) => step(Math.min(0.1, t.deltaMS / 1000)));
}

void main();
