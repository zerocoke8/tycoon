// 부팅·루프·연결. Pixi 앱 → 글꼴·그림 불러오기(로딩 화면) → Sim → 지도(VillageView) → 확대 화면(CloseupView) → UI.
// 루프: 누적 시간을 SIM.dt로 잘라 sim.tick (한 프레임 최대 10틱 × 배속), 그다음 tweens → world → closeup → ui.
// 탭을 숨기면 저장, 돌아오면 숨은 시간만큼 sim.catchUp. 저장을 불러와 시작하면 저장한 뒤 지난 시간만큼도 catchUp.
// 자동 저장은 SIM.autosaveSec마다. 루프의 단계(sim·트윈·지도·확대 화면·UI·저장·그리기)는 따로 try로 감싸서,
// 한 단계가 던져도 다음 프레임이 계속 온다 (Pixi 티커는 리스너가 던지면 다음 프레임을 요청하지 않는다).
//
// 개발용 주소 옵션 (예: /?fresh=1&seed=1&speed=6&open=slot):
//   ?fresh=1        저장을 읽지도 쓰지도 않는 새 게임 (진짜 저장은 그대로 남는다)
//   ?seed=N         새 게임의 씨앗 (저장이 없거나 fresh일 때)
//   ?speed=N        시뮬레이션·연출 배속 (0.25~20, 개발 서버 콘솔에서는 mpv.setSpeed(n))
//   ?coins=N        시작 코인을 N으로
//   ?open=<booth>   2초 뒤 그 부스 패널(확대 화면)을 연다 (slot·oddeven·cups·darts·wheel·duck·ring·race·claw·pouch)
//   ?all=1          마을을 다 연다: 모든 구역·부스, 그림 있는 진행자 모두 고용 (새 부스 연출 확인용, 저장하지 않는다)
//   ?unlockAll=1    ?all=1과 같고, 재료를 창고 가득·귀한 물건·간식과 응원 도구도 몇 개씩 준다 (저장하지 않는다)
//   ?monster=1      3초 뒤 첫 손님 카드를 연다
//   ?debug=1        지도 디버그 층 (길 그래프·자리)
//   ?zoom=Z         처음 카메라 확대 (지도 폭이 다 보이는 확대 ~ 1.6, 폰 기본 약 0.39)
// 잡히지 않은 오류는 index.html의 빨간 오류 상자에 쌓인다 (헤드리스 --dump-dom에서도 보인다).

import './style.css';
import { Application, UPDATE_PRIORITY } from 'pixi.js';
import { tweens } from './core/tween.ts';
import { BOOTH_IDS, SIM, type BoothId } from './data/defs.ts';
import { PLAZAS } from './data/map.ts';
import { devGiveGoods, devOpenAll } from './sim/dev.ts';
import { Sim, loadGame, newGame } from './sim/sim.ts';
import type { GameState } from './sim/types.ts';
import { createUi } from './ui/ui.ts';
import { loadArt, loadArtForHall } from './view/art.ts';
import { CloseupView } from './view/closeup/index.ts';
import { VillageView } from './view/world.ts';

declare global {
  interface Window {
    /** index.html의 오류 상자. */
    mpvError?: (text: string) => void;
    /** 개발 서버에서만: 콘솔로 들여다보기. */
    mpv?: unknown;
  }
}

// ── 주소 옵션 ──

const params = new URLSearchParams(location.search);
const num = (key: string): number | null => {
  const v = params.get(key);
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const DEV = {
  fresh: params.get('fresh') === '1',
  seed: num('seed'),
  speed: Math.min(20, Math.max(0.25, num('speed') ?? 1)),
  coins: num('coins'),
  open: params.get('open'),
  monster: params.get('monster') === '1',
  debug: params.get('debug') === '1',
  zoom: num('zoom'),
  all: params.get('all') === '1' || params.get('unlockAll') === '1',
  unlockAll: params.get('unlockAll') === '1',
};
/** fresh 게임은 저장하지 않는다 (진짜 저장을 덮지 않게). */
const SAVING = !DEV.fresh && !DEV.all;

/** 지금 배속 (개발 서버에서는 콘솔 mpv.setSpeed(n)으로 바꿀 수 있다). */
let speed = DEV.speed;
/** 한 프레임에 계산하는 최대 틱 (배속이면 그만큼 더). */
const maxTicks = (): number => Math.ceil(10 * Math.max(1, speed));
/** 프레임 사이가 이보다 길면 잘라 낸다 (멈칫한 뒤 몰아서 달리지 않게, 초). */
const MAX_FRAME_SEC = 0.25;
/** 이 초보다 오래 숨었다 돌아오면 몰아서 계산한다. */
const CATCHUP_MIN_SEC = 1;
/** 글꼴을 기다리는 최대 시간 (ms): 글꼴 서버가 막혀도 게임은 뜬다. */
const FONT_WAIT_MS = 4000;
/**
 * 미리 불러올 글자: 한글 웹 글꼴은 글자 묶음마다 따로 받는다. Pixi 글자(캔버스)는 그릴 때 글꼴이 없으면
 * 대신 글꼴로 굳으니, 지도·확대 화면에 그리는 글자를 미리 받아 둔다.
 */
const FONT_SAMPLE =
  '대박! 맞았다 아깝다 꽝… 홀? 짝? 줄 항아리 축제 아직 열지 않은 놀이부스 진행자가 없어요 사과 버섯 별 보석 도토리 종 +-0123456789' +
  // 둘째 묶음 부스·경주장 (복주머니 말풍선, 경주 해설·결과, 선수 이름)
  ' 빨강! 파랑! 노랑! 출발까지 초 출발 신호와 해설자가 있어야 열려요 앞으로! 대역전이다! 마지막 직선! 사진 판정! 찰칵! 골인! 1등! 다음엔… 달팽이 거북 개구리 무당벌레';

// ── 로딩 화면 ──

const loadingEl = document.getElementById('loading');
const fillEl = document.getElementById('loading-fill');
function setProgress(p: number): void {
  if (fillEl !== null) fillEl.style.width = `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
}
function hideLoading(): void {
  if (loadingEl === null) return;
  loadingEl.classList.add('done');
  window.setTimeout(() => loadingEl.remove(), 500);
}
function failLoading(): void {
  loadingEl?.classList.add('failed');
  const text = loadingEl?.querySelector('.loading-text');
  if (text) text.textContent = '마을에 가지 못했어요. 새로고침해 주세요.';
}

function reportError(e: unknown): void {
  const text = e instanceof Error ? (e.stack ?? e.message) : String(e);
  console.error(e);
  if (window.mpvError) window.mpvError(text);
}

/** 루프 단계마다 처음 한 번만 오류 상자에 (같은 오류가 매 프레임 쌓이지 않게), 그 뒤는 콘솔에만. */
const reported = new Set<string>();
function guard(stage: string, fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch (e) {
    if (reported.has(stage)) console.error(e);
    else {
      reported.add(stage);
      reportError(e);
    }
    return false;
  }
}

/** 글꼴 (Jua·Gowun Dodum)을 기다린다. 늦으면 그냥 간다. */
async function waitFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  const loads = Promise.all([
    document.fonts.load(`32px Jua`, FONT_SAMPLE),
    document.fonts.load(`16px "Gowun Dodum"`, FONT_SAMPLE),
  ]).then(
    () => undefined,
    () => undefined,
  );
  await Promise.race([loads, new Promise<void>((r) => window.setTimeout(r, FONT_WAIT_MS))]);
}

// ── 게임 상태 ──

function startState(): { state: GameState; loaded: boolean } {
  const saved = DEV.fresh || DEV.all ? null : loadGame();
  const state = saved ?? newGame(DEV.seed ?? undefined);
  if (DEV.coins !== null) state.coins = Math.max(0, Math.floor(DEV.coins));
  return { state, loaded: saved !== null };
}

// ── 부팅 ──

async function boot(): Promise<void> {
  const appEl = document.getElementById('app') ?? document.body;
  const uiEl = document.getElementById('ui') ?? document.body.appendChild(document.createElement('div'));

  const app = new Application();
  await app.init({
    resizeTo: window,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    background: 0x93b468,
  });
  appEl.appendChild(app.canvas);
  // 유령 클릭 막기: 지도를 누르면 pointerup에서 UI 시트·뒤판이 바로 열리는데, 손가락을 뗀 뒤 브라우저가 만드는 click이
  // 그 자리의 새 뒤판에 떨어져 시트가 곧장 닫힌다. Pixi는 pointer 이벤트만 쓰니 캔버스의 touchend 기본 동작(click)을 막는다.
  app.canvas.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
  app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // 확대 화면 root가 zIndex로 지도 위에 오게.
  app.stage.sortableChildren = true;

  // 글꼴과 그림을 함께 (막대는 그림 기준, 글꼴은 몫이 작다). 그림은 지금 마을회관 레벨에서 쓰는 것만 (회관이 오르면 더).
  const start = startState();
  let fontsDone = false;
  let artP = 0;
  const show = (): void => setProgress((fontsDone ? 0.1 : 0) + artP * 0.9);
  await Promise.all([
    waitFonts().then(() => {
      fontsDone = true;
      show();
    }),
    loadArt((p) => {
      artP = p;
      show();
    }, start.state.buildings.hall.level),
  ]);

  const sim = new Sim(start.state);
  sim.bus.on('buildingUpgraded', (e) => {
    if (e.id === 'hall') void loadArtForHall(e.level);
  });
  if (DEV.all) devOpenAll(sim);
  if (DEV.unlockAll) devGiveGoods(sim);
  const world = new VillageView(app, sim);
  const closeup = new CloseupView(app, sim);
  const ui = createUi(uiEl, sim, { world, closeup });

  world.onTapMonster = (id) => ui.showMonster(id);
  world.onTapBooth = (b) => ui.showBooth(b);
  world.onTapBuilding = (id) => ui.showBuilding(id);
  world.onTapEmpty = () => ui.closeAll();
  closeup.onTapMonster = (id) => ui.showMonster(id);
  tweens.onError = (e) => guard('tween', () => {
    throw e;
  });

  // 저장을 불러왔으면 저장한 뒤 지난 시간만큼 마을을 돌린다 (창을 닫았다 열어도, 폰이 탭을 버렸다 다시 열어도 같게).
  // UI를 만든 뒤에 불러야 요약 토스트가 보인다. catchUp은 SIM.catchUpMaxSec까지만, 0 이하면 아무것도 안 한다.
  const savedAt = start.state.savedAt;
  if (start.loaded && savedAt > 0) guard('catchUp', () => sim.catchUp((Date.now() - savedAt) / 1000));

  /** 아직 계산하지 않은 sim 시간과 자동 저장까지 쌓인 초. */
  let acc = 0;
  let saveAcc = 0;

  // ── 저장 ──
  const save = (): void => {
    if (SAVING) sim.save();
  };
  let hiddenAt: number | null = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      save();
      return;
    }
    if (hiddenAt === null) return;
    const sec = (Date.now() - hiddenAt) / 1000;
    hiddenAt = null;
    acc = 0;
    if (sec >= CATCHUP_MIN_SEC) guard('catchUp', () => sim.catchUp(sec));
  });
  window.addEventListener('pagehide', save);

  // ── 화면 크기 ── (UI는 스스로 window resize를 듣고 확대 화면 rect를 다시 잡는다)
  window.addEventListener('resize', () => {
    app.resize();
    world.resize(app.screen.width, app.screen.height);
  });

  // ── 루프 ──
  app.ticker.add((ticker) => {
    const frameDt = Math.min(ticker.deltaMS / 1000, MAX_FRAME_SEC);
    // 숨은 동안은 돌리지 않는다 (돌아올 때 catchUp이 맡는다).
    if (!document.hidden) {
      acc += frameDt * speed;
      const ok = guard('sim', () => {
        let n = 0;
        const max = maxTicks();
        while (acc >= SIM.dt && n < max) {
          acc -= SIM.dt;
          n++;
          sim.tick(SIM.dt);
        }
        if (n >= max) acc = Math.min(acc, SIM.dt);
      });
      if (!ok) acc = 0;
    }
    const dt = frameDt * speed;
    guard('tweens', () => tweens.update(dt));
    guard('world', () => world.update(dt));
    guard('closeup', () => closeup.update(dt));
    guard('ui', () => ui.update(dt));
    saveAcc += frameDt;
    if (saveAcc >= SIM.autosaveSec) {
      saveAcc = 0;
      guard('save', save);
    }
  });
  // Pixi가 단 그리기 리스너도 감싼다 (그리기가 던져도 다음 프레임이 온다).
  app.ticker.remove(app.render, app);
  app.ticker.add(() => guard('render', () => app.render()), null, UPDATE_PRIORITY.LOW);

  // ── 개발용 옵션 ──
  if (DEV.debug) world.setDebug(true);
  if (DEV.zoom !== null) world.focusOn(PLAZAS[0]?.c ?? { x: 0, y: 0 }, DEV.zoom);
  const openBooth = DEV.open;
  if (openBooth !== null) {
    if ((BOOTH_IDS as readonly string[]).includes(openBooth)) window.setTimeout(() => ui.showBooth(openBooth as BoothId), 2000);
    else reportError(new Error(`?open=${openBooth}: 없는 부스 (${BOOTH_IDS.join('·')})`));
  }
  if (DEV.monster) {
    window.setTimeout(() => {
      const m = sim.state.monsters.find((x) => x.phase !== 'leaving') ?? sim.state.monsters[0];
      if (m !== undefined) ui.showMonster(m.id);
    }, 3000);
  }
  if (import.meta.env.DEV) {
    const setSpeed = (n: number): void => {
      speed = Math.min(20, Math.max(0.25, n));
    };
    window.mpv = { app, sim, world, closeup, ui, tweens, setSpeed };
  }

  // 첫 그림이 나간 뒤 로딩 화면을 걷는다.
  setProgress(1);
  requestAnimationFrame(() => requestAnimationFrame(hideLoading));
}

boot().catch((e: unknown) => {
  failLoading();
  reportError(e);
});
