# 코드 구조 (프로토타입)

기획은 `docs/DESIGN.md`. 이 문서는 모듈의 경계와 약속이다. PixiJS v8 + Vite 8 + TypeScript 7 (strict), npm 패키지는 pixi.js 하나.

## 규칙

- import는 `.ts` 확장자를 붙인다 (`from '../data/defs.ts'`). tsconfig: `allowImportingTsExtensions`, `erasableSyntaxOnly` → enum·namespace·생성자 매개변수 속성(`constructor(private x)`) 금지.
  덕분에 `src/sim/`과 `src/data/`, `src/core/`는 Node 24로 바로 돌릴 수 있다 (`node scripts/sim-check.ts`). 이 세 폴더는 pixi.js·DOM을 import하지 않는다.
- 게임 안 낱말: '놀이', '놀이부스', '한판', '손님', '촌장', '진행자'. '도박·겜블·베팅'은 화면 글자에 쓰지 않는다 ('판돈' 대신 '건 코인').
- 숫자는 그림이 아니라 코드 글자로 그린다.
- 밸런스 숫자는 `src/data/defs.ts`에만. 지도 배치는 `src/data/map.ts`에만.
- 모든 무작위는 `core/rng.ts`의 `Rng` (상태 `GameState.rng`)로. 화면 연출용 무작위(파티클 흩뿌리기 등)만 `Math.random` 허용.

## 폴더

```text
src/
  core/      rng.ts, events.ts (+ tween.ts 등 공용 도구)
  data/      defs.ts (밸런스), map.ts (배치)
  sim/       types.ts (상태·이벤트), api.ts (SimApi 약속), sim.ts (Sim 클래스) 그리고 path.ts, monsters.ts, booths.ts, games.ts, reactions.ts, economy.ts, save.ts
  view/      art.ts (그림 불러오기, 배율), world.ts (VillageView: 카메라·층), ground.ts, monsterView.ts, buildings.ts, fx.ts
  view/closeup/  CloseupView (부스 확대 화면)
  ui/        HTML 오버레이 (HUD, 아래 탭, 시트, 손님 카드, 토스트), ui.css
  main.ts    부팅, 루프, 연결
scripts/     sim-check.ts (화면 없이 몇 분 돌려 경제 수치 보기)
tools/       art-kit, art-assets.ts (그림), sprite/ (Seedance → 스프라이트 시트)
public/assets/art/  다듬은 WebP와 meta.json (art-kit process.ts가 쓴다)
```

## 흐름

```text
main.ts: Pixi Application (resizeTo window, resolution = min(devicePixelRatio, 2), autoDensity)
  ├─ loadArt(onProgress, 회관 레벨) → 로딩 화면 (그 레벨에서 그릴 수 있는 그림만: 손님은 그 종이 오는 레벨부터,
  │     확대 화면 배경·장치·경주 선수·인형은 그 부스를 열 수 있는 레벨부터). 회관이 오르면 loadArtForHall(레벨) (main.ts가 buildingUpgraded를 듣는다).
  │     늦게 온 그림은 자리 표시를 그리던 ArtNode가 스스로 다시 그린다. 새 장치 그림은 art.ts OBJECT_BOOTHS에 더한다.
  │     그림 하나가 실패하면 세 번 다시 받는다 (Pixi Assets retry). 끝내 실패하면 콘솔 경고 + 자리 표시.
  ├─ sim = new Sim(load() ?? newGame())          sim/*
  ├─ world = new VillageView(app, sim)           view/*   (sim.state를 매 프레임 읽고, sim.bus 이벤트로 연출)
  ├─ closeup = new CloseupView(app, sim)         view/closeup/*
  └─ ui = new Ui(rootEl, sim, { world, closeup }) ui/*
루프: 누적 시간을 SIM.dt(0.1초)로 잘라 sim.tick(SIM.dt) (한 프레임 최대 10틱), 그다음 world.update(frameDt), closeup.update(frameDt)
탭 숨김 → 돌아오면 sim.catchUp(숨은 초). 저장을 불러와 시작하면 sim.catchUp(지금 - savedAt). 자동 저장 SIM.autosaveSec마다 + 탭 숨길 때.
루프의 단계(sim·트윈·지도·확대 화면·UI·저장·그리기)는 따로 try로 감싼다: 한 단계가 던져도 오류 상자에 한 번 알리고 다음 프레임이 계속 온다.
```

## 시뮬레이션 (src/sim)

- `Sim implements SimApi` (`api.ts`). 생성자 `new Sim(state: GameState)`; `newGame(seed?)`, `loadGame(): GameState | null`(localStorage 키 `mpv-save-v1`, 버전 확인).
- 손님 상태 기계 (`MonsterPhase`): arriving → wandering → toBooth → queued → toSeat → playing → reacting → (다시 한판 | wandering | resting | leaving).
  - 걷기: `path.ts`가 `data/map.ts`의 NODES/EDGES로 최단 경로 → `Monster.path`(세계 좌표 점들). 속도 SIM.walkSpeed (떠다니는 종은 floatSpeed).
    길의 첫 직선(지금 자리 → 첫 노드)·마지막 직선(노드 → 목적지)·곧장 걷기는 부스 그림이 서 있는 땅(BOOTH_SPOTS.base 위 사각형, `crossesBooth`)을 가로지르지 않게 고른다 (그림 뒤로 숨지 않게).
  - 부스 고르기: 좋아하는 부스 가중치 + 열린 부스(진행자 있음) + 줄 길이. 줄이 가득이면 다른 부스나 쉬기.
  - 건 코인: 지갑 × 성격(겁쟁이 0.08~0.12, 보통 0.15~0.25, 대담이 0.3~0.45), 최소 1. 참가비(fee)는 마을 코인으로, 건 코인은 부스 항아리로.
  - 한판 시작 때 `games.ts`가 결과(RoundOutcome)를 정한다 (ODDS 표, 응원 도구·행운아의 luck 반영). 세부(detail)는 등급과 맞아야 한다:
    - slot: jackpot = 종 셋, win = 같은 그림 셋(종 아님), nearMiss = 둘 같고 셋째가 다름(셋째 릴이 '한 칸 비껴감'), lose = 모두 다르거나 하나만 같음.
    - oddeven: 조약돌 1~9개, 홀짝 맞히면 win.
    - cups: swaps 3~6번(부스 레벨·진행자 진행이 높을수록 빠르게·많이), ballAt과 picked가 같으면 win, nearMiss는 고른 컵 바로 옆.
    - darts: dist 0~0.12 jackpot, 0.12~0.45 win, 0.45~0.6 nearMiss(가장자리 걸침), 그 밖 lose.
  - 지급: payout = bet × multiplier, 항아리에서 (모자라면 항아리 전부). 항아리가 potCap을 넘으면 그 부스의 다음 승자(win·jackpot만, 돌려받기·아까운 판은 아님)가 항아리를 통째로 (potFestival 이벤트, 반응은 공용 대박 표).
  - 빈털터리: 이기지 못한 한판 뒤 지갑 < 다음 판 최소 (오리 낚시·복주머니처럼 조금 돌려받았어도).
  - 반응(`reactions.ts`): 등급 × 성격 × 기분 → `Reaction` (pose, emote, motion, intensity, duration, label). 다채롭게: 등급마다 후보 3~5개.
    예) jackpot: joy+sparkle+bigHop '대박 만세', joy+heart+spin '빙글빙글'; nearMiss: agony+shock+tremble '아깝다!', agony+anger+shake '으아악'; lose: sad+tear+slump '털썩', sad+storm+none '먹구름'; 빈털터리(지갑 < 최소): sad+tear+slump 큰 반응.
    구경꾼(watcher 성격 또는 근처 손님)은 반경 안의 대박·아깝다에 `monsterSpectate` (heart/sparkle/shock, hop).
  - 기분: MOOD.delta × 성격(흥부자 기쁨 1.6배, 울보 슬픔 1.6배) + 진행자 입담 + 응원 도구. 분수 레벨로 천천히 오른다.
  - 떠나기: 지갑 < 다음 판 최소, 끈기 0, 기분 < leaveBelow. 떠날 때 팁·재료·귀한 물건 (MOOD 표). 빈털터리라도 간식을 받았으면 웃으며 떠난다.
- 진행자 자리 (2026-10-15): 부스 데이터 `BOOTHS[b].roles: { key, name, stat, optional? }[]` (보통 부스는 '진행자' 하나, 경주장은 출발 신호·해설자·사육사).
  부스 상태 `BoothState.staff: (StaffId | null)[]` (roles와 같은 순서), 진행자 `Staff.post: { booth, role } | null`. `assign(staff, booth | null, role = 0)`: 자리에 다른 진행자가 있으면 서로 바꾼다.
  열림(`boothOpen`) = 해금 && optional이 아닌 자리가 다 참. 능력치는 `booths.ts boothStat(state, b, stat)`: 그 능력치를 맡은 자리(roles[i].stat)의 진행자, 없으면 0번 자리.
  그림 있는 진행자(`HOST_PRESETS`)의 자리 = `staff.ts presetPost` (이름과 그림이 같아야: 무작위 후보는 처음 넷의 그림을 빌려 쓴다). UI도 같은 규칙.
  고용하면 `hirePost`: 자기 자리 (열린 부스면 서 있던 진행자와 바꿔 서고 그 진행자는 다른 빈 자리로, 없으면 쉰다) → 꼭 있어야 하는 빈 자리 → 있으면 좋은 빈 자리.
  자기 부스가 아직 잠긴 그림 있는 진행자는 있으면 좋은 자리를 맡지 않고 쉰다. 부스를 열면 `autoAssign`: 자리마다 어울리는 진행자(쉬는 중이거나 다른 부스의 있으면 좋은 자리) 먼저,
  남은 자리는 쉬는 진행자 가운데 이 부스의 다른 빈 자리에 어울리지 않는 사람 (그림 없는 진행자 먼저).
  부스 해금에는 회관 레벨 조건(`unlock.hall` = 그 구역이 열리는 레벨)이 있다 (`boothLockReason`).
- 둘째 묶음 부스: 결과 세부는 `games.ts` (wheel·duck·ring·claw·pouch). 오리 낚시는 잃어도 ×0.5, 한판마다 기분 +2(`moodPerRound`), 지면 기분 하락 반(`moodLossScale`),
  복주머니는 참가비가 손님의 특산 재료 1개(`matFee`, 손님은 `Monster.mats` 1~2개를 들고 온다, 없으면 고르지 않는다, 창고가 가득이어도 놀고 토스트)이고 건 코인 ×0.4(`betScale`), 대박이면 떠날 때 귀한 물건 확정(`Monster.surePrecious`).
  인형 뽑기에서 뽑은 인형은 도감 `dex[종].plush`에 모인다 (그 종 인형이 처음이면 토스트). 반응은 둘째 묶음 부스마다 자기 표(`reactions.ts BOOTH_TABLE`, 등급마다 3~5개).
- 몬스터 경주장 (손님 여럿이 경주 하나): 경주 만들기는 `sim/race.ts` (`generateRace` → `RaceResult`: 키프레임·들어온 순서·역전·사진 판정, `raceProgress`, `raceOutcome`),
  흐름은 `sim.ts`의 경주장 묶음. 상태 `BoothState.race: RaceState`:
  - idle → gathering: 관중석 자리에 앉은 손님이 선수를 고르고(`pickRacer`, 좋아하는 선수 `RACE.fans`) 참가비·건 코인을 낸다 (`raceJoined`). 첫 손님부터 `raceGatherSec(진행)`,
    둘 이상이면 `raceStartSoonSec(진행)` 안에 출발 (출발 신호의 진행이 높을수록 짧게), 자리가 다 차면 `RACE.fullStartSec`. 관중석으로 걸어오는 손님이 있으면 첫 손님부터 raceGatherSec까지는 기다린다.
    모이는 중에 자리를 뜨면 건 코인을 돌려받는다.
  - running: 결과를 정하고 (행운아·행운 부적이면 그 손님 선수가 1등일 수 있다) 참가자마다 `BoothState.rounds[자리]`에 한판 → `raceStarted` → 자리마다 `roundStarted`.
    1등이 바뀌면 `raceProgress` (참가자 응원 `cheers`: 자기 선수가 1등이면 들썩, 1등을 뺏기거나 꼴찌면 땀, 손님 pose도 잠깐, 해설자 입담만큼 기분 +).
  - done: 모든 선수가 들어오면 `raceFinished` → 참가자마다 `roundFinished`·`monsterReact`가 한꺼번에 (1등 ×3.5, 꼴찌에서 1등 역전 ×6, 사진 판정 2등 nearMiss),
    경주로 근처 손님(관중석에서 기다리는 손님 포함)은 `monsterSpectate` (해설자 입담만큼 기분 +). `RACE.resultSec` 뒤 idle.
  - running·done 동안 앉은 손님은 다음 경주를 기다린다 (phase 'playing', 참가자 아님). 사육사(손님맞이)는 손님을 더 부르고(비어 있으면 손님맞이 2로 친다), 모이는 중인 경주도 손님을 끈다.
  - 경주장이 닫혀도(출발 신호·해설자가 쉼) 달리는 경주는 끝까지 간다. 모이는 중이던 경주는 접고 건 코인을 돌려준다 (`cancelRace`). 그 뒤 손님은 자리를 뜬다.
- 개발용: `sim/dev.ts devOpenAll(sim)` = 모든 구역·부스를 열고 그림 있는 진행자를 다 고용, 재료는 창고 반 (주소 `?all=1`, sim-check). `devGiveGoods(sim)` = 간식·응원 도구 몇 개씩.
  주소 `?unlockAll=1` = `?all=1` + `devGiveGoods` (저장하지 않는다). 개발 서버 콘솔 `mpv.setSpeed(n)`으로 배속을 바꾼다 (스크린숏: 빠르게 손님을 모았다가 천천히 찍기).
- 촌장의 행동은 `SimApi`의 메서드 (응원 톡, 간식, 응원 도구, 짓기·업그레이드, 고용·배치, 가공).
- 처음 상태: 코인 SIM.startCoins, 슬롯·홀짝 부스 열림, 진행자 둘(HOST_PRESETS의 slot·oddeven)이 각 부스에, 후보에 cups·darts·wheel 진행자 (그림 있는 진행자는 그 부스를 열 수 있는 회관 레벨이 되면 후보로 온다), 건물 레벨 1, 중앙 구역만 열림.
- 회관 레벨이 오르면 `DISTRICTS`의 hall 조건에 맞는 구역이 열린다 (districtOpened). 종은 SPECIES.hall 조건으로 손님에 나온다.
- `scripts/sim-check.ts`: 새 게임을 화면 없이 30분(게임 시간) 돌리며 1분마다 코인·손님 수·한판 수·대박·떠난 손님의 평균 기분·팁을 찍는다. 밸런스 확인용.
  `--auto --seeds 24 --minutes 75`: 욕심쟁이 촌장(회관 먼저, 회관 3부터는 새 구역 부스 먼저)의 이정표 표 (분위수), 부스마다 연 뒤 1분 한판 수, 경주 평균 참가자 (`--detail`: 다음 회관 비용 항목마다 모인 때).
  `--selftest`: 결과 세부·확률, 경주 생성, 저장(경주 중 포함), catchUp, 행동, 진행자 자리, 새 부스 반응 표, 경주장 lifecycle, 60분 오래 돌리기(처음부터 다 열린 마을 포함).

## 화면 (src/view)

- 좌표: 세계 6400×7800 (`data/map.ts WORLD`, 가운데 중앙 구역 + 둘레 세 구역). 화면 논리 폭 720 기준이 아니라, 카메라가 세계를 화면에 맞춘다:
  확대 0.06~0.35(좁은 화면은 지도 폭 6400이 다 들어올 때까지, 390px 폰 약 0.06) ~ 1.6. 처음에는 열린 놀이부스(건물·자리·진행자·항아리)가 HUD와 아래 탭 사이에 다 들어오게 맞춘다 (폰 약 0.26, 넓은 화면 최대 0.8).
  UI가 위·아래를 덮은 높이를 `setViewInset`으로 알리면 카메라는 그 사이 띠의 가운데를 맞춘다 (손님 카드가 열리면 따라가는 손님이 카드 위에).
- 지도가 커져도 걷는 시간에 묶인 규칙은 지도를 따른다: 손님이 머무는 시간(TUNE.maxVisitSec)은 첫 한판부터, 손님 수 한도에는 걸어 들어오는 손님을 세지 않고,
  첫 손님 자리·입구에서 걸어 들어오는 거리는 노드 수·비율로 (픽셀 상수가 아니다). sim-check의 '멈춤' 한도도 길 그래프의 가장 먼 거리에서 정한다.
- 조작: 한 손가락 끌기 = 이동(관성), 두 손가락 = 확대·축소, 휠 = 확대·축소. 짧게 누르기(움직임 < 8px) = 누르기: 손님 → 손님 카드, 부스·건물 → 패널.
- 층: ground(코드로 그린 바닥) → 물체층(건물·소품·주민·손님, **y로 정렬**) → 효과층(이모트·파티클·숫자) → 구름층(닫힌 구역) → 디버그층(D 키: 노드·간선·자리).
- 바닥(`ground.ts`): `GROUND_STYLE` 색. 모든 길·광장 테두리를 먼저, 속을 나중에 (둥근 끝). 연못은 씨앗 난수로 울퉁불퉁한 덩어리. 길 위 조약돌 점, 풀밭에 풀 한 포기(`map/tuft` 그림이 있으면 그림, 없으면 짧은 획 셋)를 씨앗 난수로 흩뿌린다. 한 번 그려서 RenderTexture 여러 장(타일)로 굽는다 (큰 Graphics를 매 프레임 그리지 않게).
  경주로(`data/map.ts RACE_TRACK`)도 바닥에 굽는다: 길과 같은 모래·테두리의 타원 띠, 안쪽 풀밭, 레인 사이 크림색 선, 출발선(출발대 바로 앞, `mapUtil.ts RACE_START_P`), 결승선 바둑판.
- 그림 놓기: `view/art.ts`의 `artSprite(group, key, { k, anchor })`. 배율 `ART_SCALE` (건물 0.7, 놀이부스 0.5), 손님 발 기준점 `monsterFoot(종, 포즈)` = 그 포즈 그림의 아래 끝
  (떠다니는 종은 기본 그림의 아래 끝, 그림이 없으면 `MONSTER_FOOT` 캔버스 512, 870). 포즈를 바꿀 때 `setArt(group, key, anchor)`로 기준점도 바꾼다. 건물·소품·주민은 'bottom'.
  그림이 없으면 자리 표시가 나온다 (게임은 그림 없이도 돈다).
- 손님(`monsterView.ts`): 몸 = `monsters/<species>_<pose>`. 오른쪽을 볼 때 scale.x = -1. 걸을 때 통통 걷기(작은 위아래 + 살짝 기울기), 떠다니는 종은 둥실. `Motion` 연출은 트윈(hop, bigHop, shake, squash, spin, slump, tremble, bounceLoop).
  머리 위 이모트(`fx/emote_<kind>`, 작은 말풍선 없이 톡 튀어나와 떠 있다가 사라짐). 화면 좌표는 sim 좌표를 부드럽게 따라간다 (lerp).
  같은 손님을 다시 누를 수 있게 넉넉한 hit 영역. 선이 너무 가늘어지지 않게 텍스처는 mipmap (art.ts가 켠다).
- 건물(`buildings.ts`): 건물·놀이부스·장식 소품·진행자(`BoothSpot.hosts`의 자리마다 한 사람, 자리 0을 본다, 앉은 손님도 진행자 0을 본다). 경주장의 출발대·결승선은 `BoothSpot.props` (출발대는 칸 색이 레인 순서와 맞게 뒤집는다). 닫힌 부스는 빈 부지 표식(`map/lot_sign`)과 흐린 건물.
  부스 옆 상금 항아리(`map/prize_pot`)는 항아리 비율에 따라 크기가 살짝 커진다 (슬롯은 부스 그림 계산대 위 항아리를 덮어 그린다).
- 경주장(`racetrack.ts`): 선수 넷(`racers/<key>`, 레인 = 선수 번호)이 `BoothState.race`를 매 프레임 따라간다. idle·gathering = 출발선에 서서 들썩 (출발 3초 전 웅크리고 3·2·1),
  running = `sim/race.ts raceProgress`로 레인을 달린다 (화면 시계가 sim 시계를 부드럽게 따라감, 오른쪽으로 달리면 뒤집기, 선수마다 걸음), 결승 뒤 미끄러져 서고 1등이 통통,
  다음 경주를 받으면 남은 반 바퀴를 돌아 출발선으로. 관중석 자리마다 방석 (그림자층). 참가자 응원은 sim `raceProgress` 이벤트를 구경꾼처럼 작게. 경주로·선수를 누르면 경주장.
- WebGL 문맥을 잃었다 되찾으면 코드로 구운 텍스처(바닥 타일·효과·구름)를 다시 굽는다 (`webglcontextrestored`).
  구름(`map/cloud_puff`)이 닫힌 구역을 덮고, 열리면 흩어지며 사라진다.
- 효과(`fx.ts`): 코인 튀기기(`items/coin`), 색종이(`fx/fx_confetti` 여러 색으로 tint), 반짝이(`fx/emote_sparkle` 작게), 먼지(`fx/fx_puff`), 떠오르는 숫자(+12, 둥근 굵은 글꼴, 흰 테두리). 대박이면 크게.

## 확대 화면 (src/view/closeup)

- 부스를 누르면 화면 위쪽 약 55%에 확대 화면 (Pixi Container, 둥근 테두리 패널), 아래는 HTML 부스 정보(UI).
- 장면 고르기는 `registry.ts`: 보통 부스는 `BoothScene` + 부스 장치(`RIGS[b]`, Rig 약속은 rig.ts), 경주장은 자기 장면 `RaceScene`(race.ts). 둘 다 `CloseupScene` 약속.
  장치는 `RigCtx`(배치 Layout, 트윈, 자리의 손님·진행자, 앞층, 도감에서 본 종 `plushPool`)만 받는다. 그림에서 잰 값은 장치 파일 안 상수 (공용 layout.ts는 바닥·차양·벽).
  장치가 `guardRight`를 주면 (고리 던지기 선반 오른쪽 끝) 장면이 넓은 종을 그 선 오른쪽으로 민다 (패널 끝이 먼저).
  배경 그림이 늦게 오면 자리 표시로 지었다가 그림이 오면 장면을 다시 짓는다 (`needsRebuild`, 차양 띠도 그림에서 잘라 쓴다).
- 구성: 배경 `closeup/bg_<booth>` (정사각, 패널을 채우게 cover) → 기계·소품 (`objects/*`) → 손님(오른쪽, 왼쪽을 봄, 크게) → 진행자(왼쪽, 좌우 뒤집어 오른쪽을 봄).
  자리가 둘이면 손님 둘. 손님이 없으면 진행자만 기다린다.
- 연출은 sim 이벤트로: `roundStarted`에서 결과를 이미 알고 있으니 그 결과로 끝나게 연출, `roundFinished`에 결과 표시와 큰 반응.
  - slot: 기계의 세 창(slot_machine 그림의 빈 창 자리에 마스크)에서 심볼이 세로로 돈다, 1·2·3 순서로 멈춤. nearMiss면 셋째 릴이 천천히 오다 한 칸 비껴 멈춘다. 대박이면 기계가 통통.
  - oddeven: 진행자가 쥔 손을 흔들다가 그 손(그림의 손, layout.ts ODDEVEN_HAND)에서 조약돌을 하나씩 그릇에 던져 넣으며 센다(숫자 글자), 손님 머리 위에 '홀?' '짝?' 말풍선.
  - cups: 컵 셋이 swaps대로 자리를 바꾸고, 손님이 하나를 가리키면 들어 올린다 (구슬).
  - darts: 손님이 던지는 동작(squash) → 다트가 포물선으로 날아가 dist·angle 자리에 꽂힌다. nearMiss는 가장자리에 걸쳐 흔들.
  - wheel: 찜한 칸에 노란 테두리·손님 말풍선(칸 그림), 바퀴가 turns바퀴 빠르게 돌다 느려져 landed에 멈춘다 (테두리 못이 바늘을 튕긴다). nearMiss는 찜한 칸 안에서 기다 못에 걸려 옆 칸으로 톡 넘어간다.
  - duck: 오리 다섯이 통 속을 돌며 둥실, 손님이 쥔 낚싯대(줄은 코드로) 끝 고리가 duck을 낚아 올려 뒤집으면 바닥 표시(금별·은별·빈 동그라미). slipped면 버둥대다 떨어져 퐁당.
  - ring: 코드로 그린 3단 선반에 병 3×3, 고리 셋이 차례로 포물선을 그려 throws[i].bottle로. 걸리면 목을 타고 내려가 앉는다 (고리 뒤 반쪽은 병 뒤, 앞 반쪽은 병 앞). wobble은 입구에서 빙글. 선반 앞 표시 셋.
  - claw: 기계 창 속 인형 더미(도감에서 본 종, 창 모양 마스크)와 레일 위 집게(진자). win/double은 출구로 옮겨 문으로 톡, slip은 slipAt에서 놓쳐 출구 앞에 떨어진다, miss는 허공을 집는다.
  - pouch: 손님의 특산 재료가 진행자 손으로 날아가고, 손님이 망설이다 '빨강!/파랑!/노랑!', 고른 주머니가 탁자에 떨어져 열린다 (대박 = 금빛·코인 분수, coins = 코인 비, one = 한 닢, empty = 먼지 퐁).
  - race (`RaceScene`): 상태(`booths.race.race`)를 매 프레임 읽는다 (중간에 열어도 그 순간). 모이는 중 = '출발까지 N초'·3·2·1, 달리는 중 = 순위표·해설 말풍선·자기 선수가 앞서면 들썩·꼴찌면 땀, 사진 판정은 화면 시계를 멈췄다 따라잡는다, 결과 = 1등 메달·코인·관중 반응.
- 반응: 결과에 맞는 포즈·이모트·연출을 지도보다 크게. 코인이 항아리에서 손님에게 튄다.

## UI (src/ui)

- HTML 오버레이(`#ui`, 캔버스 위). 모바일 세로 기준, 엄지가 닿는 아래쪽에 조작. 글꼴: 'Jua'(제목·숫자), 'Gowun Dodum'(본문). 색은 art-kit 안내서 1.8의 CSS 토큰.
- 위: 코인, 재료 가방(누르면 재료·귀한 물건·가공품 목록과 얻는 곳, 재료는 그 종이 오는 구역별로 묶음), 마을 레벨. 그 아래 '다음 목표' 칩 (`ui/goal.ts`: 손님 응원 → 부스 구경 → 새 구역이 열렸으면 보러 가기 → 열린 부스의 꼭 필요한 빈 자리 → 지금 살 수 있는 가장 싼 짓기 → 다음 부스와 다음 마을회관 중 코인이 덜 드는 쪽, 누르면 그 화면).
- 아래 탭: 마을(지도) / 짓기(건물·부스 업그레이드, 해금, 구역별 묶음과 잠긴 이유) / 주민(진행자 자리 칸: 열린 부스의 자리마다 한 칸, 고용·배치·레벨) / 공방(가공 레시피와 진행) / 도감(손님 | 인형 바꾸기: 종·본 반응, 인형 뽑기로 모은 인형). 그 탭에서 지금 할 수 있는 일이 있으면 작은 점.
- 비용 칩은 아이템 그림과 이름을 같이 (폰에는 hover가 없다).
- 손님 카드(손님을 누르면): 그림, 이름(별명 + 종), 성격, 지갑, 기분 막대, 이번 방문 기록, [응원하기] [간식 주기 ▾].
- 부스 패널(부스를 누르면): 확대 화면 + 이름, 레벨, 참가비(복주머니는 특산 재료 1개), 항아리, 진행자 자리마다 한 줄(자리 이름·쓰는 능력치·꼭 필요/있으면 좋아요, [바꾸기 ▾] = `ui/staffMenu.ts`), 줄, [업그레이드] [응원 도구 걸기 ▾].
  경주장은 경주 상태(기다림·출발까지 N초·달리는 중·결과), 선수 카드 넷(응원 수, 지금 순위로 정렬), 관중석 목록.
- 토스트: sim `toast` 이벤트와 행동 Result 실패 이유. HUD·목표 칩 바로 아래 (`--toast-top`), 부스 패널이 열려 있으면 화면 아래, 고르기 판이 열려 있으면 판 아래 층.
  '처음 보는 손님이 왔어요: …'처럼 '머리: 이름'인 토스트가 이어 오면 한 줄로 묶는다.
- 목표 칩: 빈 진행자 자리 → 부스 패널을 열고 그 자리의 고르기 판을 연다 (`showBooth(b, role)`), 고용 → 주민 탭을 고용 후보 칸으로 (`openHire`). 시트가 열려 있으면 숨는다.
  진행자 고르기 판 끝에는 늘 '새 진행자 고용하기'. 닫힌 부스 패널은 경고 바로 아래에 진행자 자리 줄을 먼저 보인다.
- 한글 줄바꿈은 낱말 단위 (`.mpv-ui { word-break: keep-all }`).
- 아이템 그림은 `assets/art/items/<key>.webp`를 <img>로 (없으면 글자).
