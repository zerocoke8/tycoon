# 코드 구조 (프로토타입)

기획은 `docs/DESIGN.md`. 이 문서는 모듈의 경계와 약속이다. PixiJS v8 + Vite 8 + TypeScript 7 (strict), npm 패키지는 pixi.js 하나.

## 규칙

- import는 `.ts` 확장자를 붙인다 (`from '../data/defs.ts'`). tsconfig: `allowImportingTsExtensions`, `erasableSyntaxOnly` → enum·namespace·생성자 매개변수 속성(`constructor(private x)`) 금지.
  덕분에 `src/sim/`과 `src/data/`, `src/core/`는 Node 24로 바로 돌릴 수 있다 (`node scripts/sim-check.ts`). 이 세 폴더는 pixi.js·DOM을 import하지 않는다.
- 게임 안 낱말: '놀이', '놀이부스', '한판', '손님', '촌장', '진행자'. '도박·겜블·베팅'은 화면 글자에 쓰지 않는다 ('판돈' 대신 '건 코인').
- 숫자는 그림이 아니라 코드 글자로 그린다.
- 밸런스 숫자는 `src/data/defs.ts`에만 (땅 값 `LAND`·장식 `DECOR` 포함). 칸·땅·처음 마을은 `src/data/map.ts`, 건물·부스·장식의 모양(차지하는 칸·입구·안쪽 자리, 건물 기준 상대 좌표)은 `src/data/catalog.ts`.
- 모든 무작위는 `core/rng.ts`의 `Rng` (상태 `GameState.rng`)로. 화면 연출용 무작위(파티클 흩뿌리기 등)만 `Math.random` 허용.

## 폴더

```text
src/
  core/      rng.ts, events.ts (+ tween.ts 등 공용 도구)
  data/      defs.ts (밸런스), map.ts (칸·땅·처음 마을), catalog.ts (건물·부스·장식 모양: 상대 좌표)
  sim/       types.ts (상태·이벤트), api.ts (SimApi 약속), sim.ts (Sim 클래스) 그리고 village.ts (배치형 마을), path.ts (길 칸 길찾기), monsters.ts, booths.ts, games.ts, reactions.ts, economy.ts, save.ts
  view/      art.ts (그림 불러오기, 배율), world.ts (VillageView: 카메라·층·입력), buildMode.ts (짓기 모드: 유령·길 칠하기·땅 고르기), ground.ts (바닥), roads.ts (길 모양), land.ts (사지 않은 땅의 구름), monsterView.ts, buildings.ts, fx.ts
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
  저장 버전 4 (넷째 묶음). 버전 2·3 저장은 `save.ts migrate2`(경주장 `BoothState.race` → `group`) → `migrate3`(손님 장신구·맡긴 장신구·빚 칸)으로 그대로 잇는다 (새 부스·건물·재료 칸, 새 진행자 후보는 채운다).
- 손님 상태 기계 (`MonsterPhase`): arriving → wandering → toBooth → queued → toSeat → playing → reacting → (다시 한판 | wandering | resting | leaving).
  - 걷기 (배치형 마을, 아래 '배치형 마을'): `path.ts route(state, from, to, via, lane)`가 길 칸으로만 → `Monster.path`(세계 좌표 점들). 속도 SIM.walkSpeed (떠다니는 종은 floatSpeed).
    건물 안 자리(줄·자리·계산대·일터·쉼터·구경 자리)는 그 건물의 입구 앞 길 칸 → 문(door) → 자리로 들어간다. `Sim.walk(m, to, via)`가 손님마다 비켜 걷기(laneOffset)를 붙인다.
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
  부스 해금에는 회관 레벨 조건(`unlock.hall`)이 있다 (`boothLockReason`). 열림(`boothOpen`)은 진행자에 더해 지도에 놓였고 입구가 길로 마을 입구와 이어져야 한다 (`booths.ts boothIdleReason`: stored·road·staff).
- 둘째 묶음 부스: 결과 세부는 `games.ts` (wheel·duck·ring·claw·pouch). 오리 낚시는 잃어도 ×0.5, 한판마다 기분 +2(`moodPerRound`), 지면 기분 하락 반(`moodLossScale`),
  복주머니는 참가비가 손님의 특산 재료 1개(`matFee`, 손님은 `Monster.mats` 1~2개를 들고 온다, 없으면 고르지 않는다, 창고가 가득이어도 놀고 토스트)이고 건 코인 ×0.4(`betScale`), 대박이면 떠날 때 귀한 물건 확정(`Monster.surePrecious`).
  인형 뽑기에서 뽑은 인형은 도감 `dex[종].plush`에 모인다 (그 종 인형이 처음이면 토스트). 반응은 둘째 묶음 부스마다 자기 표(`reactions.ts BOOTH_TABLE`, 등급마다 3~5개).
- 단체 놀이 엔진 (손님 여럿이 한 판, DESIGN 3.6): 경주장·씨름장·오리배·연날리기·줄다리기·보물찾기 (`defs.ts GROUP_BOOTHS`, `isGroupBooth(b)`).
  흐름은 `sim.ts`의 '단체 놀이' 묶음 하나가 모두 똑같이 돌리고, 놀이마다 다른 것은 놀이 모듈 `sim/group/<booth>.ts`의 `GroupGame` (`sim/group/core.ts` 약속, `sim/group/index.ts GROUP_GAMES`).
  상태 `BoothState.group: GroupState | null` (단체 놀이 부스만):
  - idle → gathering: 자리에 앉은 손님이 참가비·건 코인을 내고 `GroupGame.join(rng, 자리, 손님, 참가자)`로 고른다 (`GroupEntry { monster, seat, pick, role, bet, fee }`, `groupJoined`).
    첫 손님부터 `groupGatherSec(b, 진행)`, `readiness(참가자, 기다린 초)`가 'soon'이면 `groupStartSoonSec`, 자리가 다 차면 `GROUP_RULES[b].fullStartSec` 안에 출발.
    'none'(씨름 선수 둘이 안 옴, 줄다리기 편이 안 참)이면 기다리다 `maxWaitSec` 뒤 접는다 (`groupCancelled` 'timeout', 건 코인을 돌려주고 손님은 다른 걸 하러 간다).
    자리로 걸어오는 손님이 있으면 gatherSec까지는 기다린다. 모이는 중에 자리를 뜨면 건 코인을 돌려받는다. 모이는 중인 판은 손님을 끈다 (`TUNE.groupGatherPull`, 'none'이면 × `groupNeedPull`).
  - running: `lineup`(줄다리기 편 맞추기: 오래 기다린 손님부터, 빠진 손님은 건 코인을 돌려받고 다음 판, 낸 참가비는 다음 판 몫 `GroupState.prepaid`)과 행운(행운아·행운 부적: 그 손님 쪽이 이긴다) 뒤
    `GroupGame.generate(rng, 참가자, ctx)` → `GroupPlay` (판 전체: `end`, 움직이는 것마다 키프레임 `tracks: {t, p}[][]`, 사건 `events`, 참가자마다 결과 `outcomes`, 놀이마다의 칸).
    참가자마다 `BoothState.rounds[자리]`에 한판 (outcome = play.outcomes[i]) → `groupStarted` → 자리마다 `roundStarted`.
    매 틱 `GroupGame.poll`이 낸 사건(타임라인 사건을 시각대로, 경주·오리배는 1등이 바뀔 때)마다 `groupEvent` (참가자 응원 `cheers`: `cheer()`가 lead면 들썩, behind면 조마조마, 손님 pose도 잠깐, 입담만큼 기분 +).
    응원 말은 응원 열쇠(`reactions.ts cheerKey`: 사건 종류, 남의 일이면 ':other', 자기 일이면 `GroupGame.cheerDetail`의 세부 — 보물찾기 'find:boot'·'find:pebble')로 고른다.
  - done: `play.end`가 되면 `groupFinished` → 참가자마다 `roundFinished`·`monsterReact`가 한꺼번에, `GroupGame.center` 근처 손님(자리에서 기다리는 손님 포함)은 `monsterSpectate` (`crowd()`의 등급). `resultSec` 뒤 idle.
    지급은 한꺼번에 나눈다 (`sim.ts settleGroup`): 항아리가 모자라면 모든 승자를 같은 비율로 줄인다 (참가 차례로 주면 늦게 온 승자가 0코인). 항아리 축제면 받을 몫이 가장 큰 승자가 다른 손님 몫을 뺀 나머지를 통째로.
  - running·done 동안 앉은 손님은 다음 판을 기다린다 (phase 'playing', 참가자 아님). 판에 끼지 못하고 `TUNE.groupBenchGiveUpSec` 넘게 기다리면 다른 걸 하러 간다.
  - 부스가 닫혀도(꼭 있어야 하는 진행자가 쉼) 진행 중인 판은 끝까지 간다. 모이는 중이던 판은 접고 건 코인을 돌려준다 (`groupCancelled` 'closed'). 그 뒤 손님은 자리를 뜬다.
  - 놀이마다: 경주장 `group/race.ts` (경주 `sim/race.ts generateRace`, 1등 ×3.5·꼴찌 역전 ×6·사진 판정 2등 nearMiss), 오리배 `group/boat.ts` (같은 경주, 물길 `BOAT_COURSE`),
    씨름 `group/ssireum.ts` (자리 0·1 = 홍·청 선수, 2~5 구경, 미는 힘 p(t) `group/duel.ts`), 줄다리기 `group/tug.ts` (자리 짝수 홍·홀수 청, 밧줄 c(t)),
    연날리기 `group/kite.ts` (연 넷, 연싸움 tangle → cut, 마지막 연), 보물찾기 `group/dig.ts` (판 자리 = 자리, 판의 15%에 상자 하나). 등급 규칙은 각 파일 머리말과 `types.ts GroupPlay`.
  - 키프레임 읽기 `trackAt(keys, t)` (넘치지 않는 3차 보간), 경주 `raceProgress(play.race, 선수, t)`, `raceOf(play)`, `livePlay(group)`, `entryOf/outcomeOf(group, 손님)`.
  - 놀이 모듈이 더 줄 수 있는 것 (`GroupGame`, 없으면 기본): `seatFor(rng, 손님, 빈 자리, 앉은 손님)` = 줄 맨 앞 손님이 앉을 자리 (씨름 선수·구경, 연 날리기·구경, 줄다리기 적은 편, 보물찾기 아무 흙더미),
    `stepIn(참가자, 기다린 초, 빈 자리, who)` = 출발 조건이 안 맞을 때 참가자 하나가 다른 자리로 나서기 (씨름: 12초 뒤 구경 손님이 모래판으로, `groupJoined`를 다시 낸다),
    `buzz(play, 사건, 참가자)` = 진행 중 큰 사건에 근처 구경꾼이 들썩 (`GroupBuzz` wow·gasp·cheer·laugh → `monsterSpectate`, 참가자는 빼고), `join(..., who)` = 다른 참가자를 보고 고르기.
    공용 고르기 `crowdPick` (같은 종 선수 → 구경꾼은 많은 쪽·대담이는 적은 쪽), 나설 확률 `eagerness`, 고른 수 `backers`.
  - 판이 시작되면 근처를 걷던 손님이 멈춰 구경한다 (`TUNE.groupDraw*`, 진행자 손님맞이만큼 더). 반응 표: `reactions.ts groupCheerReaction`·`groupBuzzReaction`·`groupReactionLabels(booth)` (응원·구경·들썩 이름표).
    진행자 능력치: 진행 = 모이는 시간·판 길이 (`TUNE.groupPacePerPoint`), 입담 = 사건마다 기분·구경 반응 확률, 손님맞이 = 끌어오기·멈춰 구경.
- 넷째 묶음 (DESIGN 3.7: 장신구·전당포·은행·파산·일터·빚 걸기 판). 숫자는 `defs.ts` (ACCESSORIES·ACCESSORY_SPAWN·VAULT·PAWN·BANK·LABOR·DEBT_MATCH, 건물 pawnshop·bank·workyard + `BUILD_HALL`),
  모양은 `catalog.ts` (`SHOP_GEO`·`YARD_GEO`, 배율 `BUILDING_LAYOUT.k`), 세계 좌표는 `village.ts` (`shop(s)`·`yard()`), 순수 도구는 `sim/debt.ts` (값·자리·게이지 `counterPt(state, …)`·`workPt`·`waitPt`, 손님이 들를 수 있나 `shopOpen`), 흐름은 `sim.ts` '넷째 묶음' 묶음.
  - 손님: `Monster.accessories: Accessory[]` (key·slot·value, 올 때 `debt.ts rollAccessories`), `pawned: PawnTicket[]` (이번 방문에 맡김, price = 빌린 코인), `debt` (갚을 빚),
    `loans?`, `errand?` ('pawn'|'redeem'|'loan'|'repay'), `homeward?`, `counter?`, `bankrupt?`, `wasBankrupt?`, `declined?` ('low'|'broke': 더 놀기 싫다고 한 단계), `chased?` (빚 쫓기 판 수),
    `labor?: LaborState` (facility·spot·wait·progress·made·total·boostSec·boostMult·match·since·matches). 단골 `Regular.recovered` = 파산했다가 다 갚은 손님.
  - phase: toPawnshop → atPawnshop, toBank → atBank (계산대 PAWN·BANK.counterSec 뒤 볼일, 그다음 reacting), toWork → working | waitWork, relieved (다 갚음 → 떠남).
  - 흐름: decide = 파산 → 일터 / `goSettle`(빚 갚기 → 되찾기, 낸 뒤에도 돈이 넉넉할 때) / 돈이 떨어짐(`shortOfMoney`) → `seekMoney` / `chaseDebt` / 떠나기. 반응 뒤(afterReact)에도 같은 자리에서 다시 하기 전에 seekMoney.
    `seekMoney`: 단계(`moneyStage`: low = 처음 지갑의 PAWN.lowFrac 아래, broke = 한판도 못 함)마다 한 번 `debt.ts wantMore` 확률로 묻고 (은행은 일터 채무자 수 × BANK.wary만큼 덜),
    전당포 (값이 가장 큰 장신구), 없으면 은행 (`bankOpenFor`: 은행·일터, 빚 없음, 한 방문 BANK.maxLoans번). 걸어가며 작은 반응 (`sideReact`: seekPawn·seekLoan·goRedeem·goRepay).
    `chaseDebt` = 빚이 있는데 갚을 만큼 없으면 끈기가 다 돼도 한판만 더 (BANK.chase). 맡기거나 빌린 뒤(`afterBorrow`)는 정말 못 놀 때만 다시 묻는다.
    `leave` = 떠나기 전 볼일(낼 수 있으면) → 빚이 남으면 `goBankrupt` (지갑을 금고로, 맡긴 장신구는 컬렉션) → 아니면 `goHome`. `depart`에서 못 찾은 장신구는 `GameState.pawnCollection`.
    금고: `debt.ts canLend` (빌려준 뒤 VAULT.reserve가 남는다, maxShare), 모자라면 `vaultEmpty`. 빌려주기는 수입이 아니다 (`totals.coinsEarned`에는 이자만).
  - 일터: `pickWorkSpot` (시설마다 일터 레벨의 workers 자리, 없으면 기다림, 자리가 나면 가장 오래 기다린 손님부터), `tickLabor` (빚 −`laborRate`/초, 1코인마다 `laborTick`,
    LABOR.coinsPerMat마다 재료 → `laborOutput` + 한숨·영차 반응), 응원 톡·간식·반장(`tickForeman`, LABOR.foreman, `foremanCheer`) = `boostLabor`.
    파산하고 LABOR.forgiveSec가 지나면 `forgiveLong` (반장이 남은 빚을 덜어 줌, `debtCleared.forgiven`). 채무자는 손님 수 한도·구경 반응에서 빠진다. 다 갚으면 `relieve` (홀가분 반응) → 떠나는 순간 `depart`에서 단골 (`wasBankrupt`면 팁만, 종 재료·귀한 물건 없음).
  - 빚 걸기 판: 단체 놀이 `GroupState.mode = 'debt'`, `debtors` (자리 i = debtors[i]), `debtNext` (예약). `GroupEntry.debt` = 건 빚 (bet·fee 0). 출발 조건 = 불린 채무자가 다 참가 (`groupReady`).
    부를 수 있는 채무자 `debtPool` (일터로 가는·일하는·기다리는, 빚 DEBT_MATCH.minStake 이상, 이번 파산에 maxPerStint번 안), 짝 = `debt.ts pairDebtors` (빚이 비슷한 이웃끼리), 줄다리기는 tugMin명부터.
    줄다리기(DEBT_MATCH.watchOnly)는 그동안 다른 손님을 앉히지 않는다. 끝나면 `settleDebts` (이기면 × winKeep·대박 0, 지면 + 짝 상대의 건 빚, maxDebt까지)가 채무자 반응(matchHalved·matchCleared·matchAdded)보다 먼저, 그다음 `debtSettled`.
  - 이벤트: pawned·redeemed·pawnCollected(from)·vaultEmpty·loanTaken·loanRepaid·bankrupt·laborTick·laborOutput·foremanCheer·debtCleared(forgiven)·debtMatchCalled·debtSettled(changes: `DebtChange` opponent·result) (`types.ts SimEvents`).
    반응은 `reactions.ts debtReaction(kind)` (`DebtReactKind` 20가지, `DEBT_REACT_KINDS`). 누적 `GameState.debtTotals` (forgiven 포함), 반장 시계 `GameState.foremanTimer`.
  - API: `buildingBuilt(id)`, `buildingLockReason(id)` (회관 레벨), `upgradeBuilding`은 레벨 0이면 짓기. 개발용 `Sim.devBankrupt(id, debt)`.
  - sim-check: `--auto --seeds N --debt` (일터를 지은 뒤 30분마다 맡김·컬렉션·대출·파산·빚 걸기 판, 일한 시간, 채무자 수, 금고, 장부, 돈이 떨어진 손님 깔때기),
    `--debt-build` (지을 수 있으면 바로), `--no-debt` (짓지 않음), `--open-all` (다 열린 마을). selftest 6g: 장신구·마음·짝·전당포·싫다·금고·은행·빚 쫓기·파산·일터·반장·빚 걸기 판(1:1·2:2)·저장·반응 표·45분 장부.
- 개발용: `sim/dev.ts devOpenAll(sim)` = 모든 땅·부스를 열고 (큰 것부터 길까지 이어 자동 배치 `devPlaceAll`), 그림 있는 진행자를 다 고용, 전당포·은행·일터도 끝까지, 재료는 창고 반 (주소 `?all=1`, sim-check). `devAllLand(sim)` = 땅을 다. `devGiveGoods(sim)` = 간식·응원 도구 몇 개씩.
  `devBroke` (주소 `?broke=1`: 넷째 묶음 건물 레벨 1·금고 2000·손님 지갑을 거의 비게), `devSeedDebtors(sim, n)` (`?debtors=N`: 일터에 채무자 n), `devAccessories` (`?acc=1`: 모든 손님에게 장신구 셋).
  주소 `?unlockAll=1` = `?all=1` + `devGiveGoods` (저장하지 않는다). 개발 서버 콘솔 `mpv.setSpeed(n)`으로 배속을 바꾼다 (스크린숏: 빠르게 손님을 모았다가 천천히 찍기).
- 촌장의 행동은 `SimApi`의 메서드 (응원 톡, 간식, 응원 도구, 짓기·업그레이드, 고용·배치, 가공).
- 처음 상태: 코인 SIM.startCoins, 슬롯·홀짝 부스 열림, 진행자 둘(HOST_PRESETS의 slot·oddeven)이 각 부스에, 후보에 cups·darts·wheel 진행자 (그림 있는 진행자는 그 부스를 열 수 있는 회관 레벨이 되면 후보로 온다), 건물 레벨 1, 처음 마을 (`map.ts DEFAULT_*`, 처음 땅 3×3 조각).
- 회관 레벨이 오르면 더 먼 땅 고리를 살 수 있다 (`defs.ts LAND.hall`). 종은 SPECIES.hall 조건으로 손님에 나온다.
- `scripts/sim-check.ts`: 새 게임을 화면 없이 30분(게임 시간) 돌리며 1분마다 코인·손님 수·한판 수·대박·떠난 손님의 평균 기분·팁을 찍는다. 밸런스 확인용.
  `--auto --seeds 24 --minutes 120`: 욕심쟁이 촌장(회관 먼저, 단체 놀이는 회관 1부터·지금 구역 부스는 회관 2부터 다음 회관보다 먼저)의 이정표 표 (분위수), 부스마다 연 뒤 1분 한판 수,
  경주 평균 참가자, 단체 놀이마다 한 판 평균 참가자·접힌 판 비율 (`--detail`: 다음 회관 비용 항목마다 모인 때, `--first N`: N번 시드부터).
  `--selftest`: 결과 세부·확률, 경주 생성, 저장(경주 중 포함), catchUp, 행동, 진행자 자리, 새 부스 반응 표, 경주장 lifecycle,
  단체 놀이 생성기(씨름·줄다리기 p/c 모양과 등급, 연 끊김 순서, 보물 상자 하나, 오리배 = 경주, ODDS 비율)·엔진(부스마다 판, 편 맞추기, 판 중 저장, 옛 저장 2 → 3),
  자리 고르기·구경 고르기·나서기, 진행 중 구경 반응, 60분 오래 돌리기(처음부터 다 열린 마을 포함: 접힌 씨름 판 3분의 1 이하, 판 끝에 구경하는 손님).

## 화면 (src/view)

- 좌표: 세계 = 칸 72×64 × 96px (`data/map.ts WORLD`, 땅 조각 9×8, 처음 땅은 아래 가운데 3×3). 화면 논리 폭 720 기준이 아니라, 카메라가 세계를 화면에 맞춘다:
  확대 0.06~0.35(좁은 화면은 지도 폭 6400이 다 들어올 때까지, 390px 폰 약 0.06) ~ 1.6. 처음에는 열린 놀이부스(건물·자리·진행자·항아리)가 HUD와 아래 탭 사이에 다 들어오게 맞춘다 (폰 약 0.26, 넓은 화면 최대 0.8).
  UI가 위·아래를 덮은 높이를 `setViewInset`으로 알리면 카메라는 그 사이 띠의 가운데를 맞춘다 (손님 카드가 열리면 따라가는 손님이 카드 위에).
- 지도가 커져도 걷는 시간에 묶인 규칙은 지도를 따른다: 손님이 머무는 시간(TUNE.maxVisitSec)은 첫 한판부터, 손님 수 한도에는 걸어 들어오는 손님을 세지 않고,
  첫 손님 자리·입구에서 걸어 들어오는 거리는 노드 수·비율로 (픽셀 상수가 아니다). sim-check의 '멈춤' 한도도 길 그래프의 가장 먼 거리에서 정한다.
- 조작: 한 손가락 끌기 = 이동(관성), 두 손가락 = 확대·축소, 휠 = 확대·축소. 짧게 누르기(움직임 < 8px) = 누르기: 손님 → 손님 카드, 부스·건물 → 패널.
- 층: ground(코드로 그린 바닥) → floor(바닥에 깔리는 그림: 씨름 모래판·흙더미, 단체 놀이의 바닥 표시) → 그림자 → 물체층(건물·소품·주민·손님, **y로 정렬**, 사지 않은 땅의 구름 띠(land.ts)·'길이 없어요' 표시도 여기)
  → 효과층(이모트·파티클·숫자) → sky(연과 연줄, 모든 것 위) → 디버그층(D 키: 노드·간선·자리·물길·놀이 마당).
- 바닥(`ground.ts`): `GROUND_STYLE` 색. 모든 길·광장 테두리를 먼저, 속을 나중에 (둥근 끝). 연못은 씨앗 난수로 울퉁불퉁한 덩어리. 길 위 조약돌 점, 풀밭에 풀 한 포기(`map/tuft` 그림이 있으면 그림, 없으면 짧은 획 셋)를 씨앗 난수로 흩뿌린다. 한 번 그려서 RenderTexture 여러 장(타일)로 굽는다 (큰 Graphics를 매 프레임 그리지 않게).
  길 모양은 `view/roads.ts`: 길 칸마다 바깥 모서리만 둥근 사각형(`roundShape`), 꺾임·갈림길 안쪽 모서리(꼭짓점 둘레 네 칸 중 셋이 길)는 빈 칸 쪽으로 휘어 들어가고(`ROAD_FILLET`),
  2×2 넘게 뭉친 길은 광장 (넓은 모래 + 안쪽 꼭짓점에 납작한 돌 드문드문), 길 칸마다 조약돌. 마을 입구 아치 밑 길 띠(FLOORS road)도 길 칸처럼 그린다.
  시설 바닥 모양은 `catalog.ts FLOORS` (분수 광장·줄다리기·보물찾기 마당·오리배 연못·경주로).
  경주로(`catalog.ts RACE_GEO`, 세계 좌표 `village.race()`)도 바닥에 굽는다: 길과 같은 모래·테두리의 타원 띠, 안쪽 풀밭, 레인 사이 크림색 선, 출발선(출발대 바로 앞, `mapUtil.ts RACE_START_P`), 결승선 바둑판.
  땅 조각마다 바닥 그림(Graphics + 풀 스프라이트, 둘레 한 칸까지 같이 그려 조각 사이 이음매가 맞는다)을 따로 만들고, 타일(조각의 1/3, 256px, 이웃과 2px 겹침)로 굽는다.
  길·시설 자리가 바뀌면 (`sim.village().stamp`) 바뀐 칸 둘레 조각 그림만 다시 만들고 그 타일만 다시 굽는다 (그동안은 옛 타일). 짙은 구름에 덮인 타일(`land.ts underFog`)은 굽지 않는다.
  덧그림 (타일 위, 건물 아래): `setGrid(on)` 짓기 모드 칸 금 (world.ts가 놓기·옮기기·길 모드에서 켠다), `setTint(GroundTint[])` 칸 물들이기 (유령 발자국 등), `previewRoads(add, erase)` 칠하는 길 미리보기 (진짜 길 모양).
- 그림 놓기: `view/art.ts`의 `artSprite(group, key, { k, anchor })`. 배율 `ART_SCALE` (건물 0.7, 놀이부스 0.5), 손님 발 기준점 `monsterFoot(종, 포즈)` = 그 포즈 그림의 아래 끝
  (떠다니는 종은 기본 그림의 아래 끝, 그림이 없으면 `MONSTER_FOOT` 캔버스 512, 870). 포즈를 바꿀 때 `setArt(group, key, anchor)`로 기준점도 바꾼다. 건물·소품·주민은 'bottom'.
  그림이 없으면 자리 표시가 나온다 (게임은 그림 없이도 돈다).
- 손님(`monsterView.ts`): 몸 = `monsters/<species>_<pose>`. 오른쪽을 볼 때 scale.x = -1. 걸을 때 통통 걷기(작은 위아래 + 살짝 기울기), 떠다니는 종은 둥실. `Motion` 연출은 트윈(hop, bigHop, shake, squash, spin, slump, tremble, bounceLoop).
  머리 위 이모트(`fx/emote_<kind>`, 작은 말풍선 없이 톡 튀어나와 떠 있다가 사라짐). 화면 좌표는 sim 좌표를 부드럽게 따라간다 (lerp).
  같은 손님을 다시 누를 수 있게 넉넉한 hit 영역. 선이 너무 가늘어지지 않게 텍스처는 mipmap (art.ts가 켠다).
- 건물(`buildings.ts`): 건물·놀이부스·장식 소품·진행자(`BoothSpot.hosts`의 자리마다 한 사람, 자리 0을 본다, 앉은 손님도 진행자 0을 본다). 경주장의 출발대·결승선은 `BoothSpot.props` (출발대는 칸 색이 레인 순서와 맞게 뒤집는다). 닫힌 부스는 빈 부지 표식(`map/lot_sign`)과 흐린 건물.
  부스 옆 상금 항아리(`map/prize_pot`)는 항아리 비율에 따라 크기가 살짝 커진다 (슬롯은 부스 그림 계산대 위 항아리를 덮어 그린다).
- 단체 놀이 지도 화면 (`view/group/registry.ts GROUP_MAP`, 부스마다 하나, `world.ts`가 만든다): `GroupMapRenderer { update(dt, view), hitTest(wx, wy), restoreTextures?(), destroy() }`.
  바탕 `view/group/base.ts GroupMapBase` (보이기·화면 시계 `clock`·판 `play`·참가자·`own(층, 그릇)`·손님 몸 맡기기 `puppet(id, MonsterPuppet)`·시작 숫자 3·2·1 `startCount(x, y, 진행자)`: 출발 조건이 맞을 때만). 손님을 그리기 전에 불린다.
  씨름 `group/ssireum.ts`, 오리배 `group/boat.ts`, 연날리기 `group/kite.ts`, 줄다리기 `group/tug.ts`, 보물찾기 `group/dig.ts`, 경주장은 `racetrack.ts`.
  손님 몸 맡기기: `MonstersView.puppet(id, { dx, dy, lift, rot, sx, sy, pose, facing, still, alpha })` (그 프레임만, sim 좌표는 그대로).
  모양: 씨름 `SSIREUM_GEO`, 오리배 `BOAT_GEO`(물길 course·연못 pond·구경 자리 watch, 고리 길 `LoopCourse`·`map.ts lanePoint`), 연 `KITE_GEO`, 줄다리기 `TUG_GEO`, 보물찾기 `DIG_GEO` (`data/catalog.ts`, 상대 좌표).
  화면은 만들 때 세계 좌표 모양을 읽는다 (`this.ctx.sim.village().ring()·boat()·kite()·tug()·dig()`, 바탕 `this.spot` = `village().booth(b)`, 놓였나 `this.placed`). 놓인 자리가 바뀌면 world.ts가 단체 놀이 화면을 새로 만든다.
  바닥에 깔리는 부스 그림·소품은 `BoothSpot.flat`·`props[].flat` (buildings.ts가 floor층에, path.ts는 그 위를 걸어도 된다).
  씨름·줄다리기·보물찾기는 손님 몸 맡기기를 `group/ssireumPuppets.ts PuppetSet`(부드럽게 맡기고 놓기 = 일어나기, 누운 몸 그림자 `LieShadows`)으로 한다.
  보물찾기의 할아버지는 상자를 아무도 못 찾으면 `buildings.hostNode('dig', 0)`을 직접 옮겨 걸어가 판다 (buildings.ts는 매 프레임 y·scale만 다시 잡는다).
  연은 하늘 층에 그림자(같은 그림을 어둡게, 아래로)를 달고 뜨고, 보이는 세계 폭이 넓을수록 조금 커진다 (`kite.ts FAR_FROM`: 지도를 넓게 봐도 연이 보이게).
  오리배 물길은 왼쪽 아래(출발) → 위 → 오른쪽 끝(결승): 출발·결승·결승 뒤 미끄러지기가 선착장 차양 밖이다. 판이 끝나면 아래 물길(선착장 앞)을 레인 안쪽(`RETURN_LANE`)으로 지나 출발선까지 돌아간다.
  잠긴 부스의 물길·말뚝·방석은 흐리게. 씨름 진 손님은 몸 가운데를 축으로 눕힌다 (머리가 모래판 밧줄 기둥·옆 구경 자리까지 가지 않게).
  단체 놀이 승자의 받은 코인 글자는 바싹 붙어 선 승자끼리 단(0~2)을 엇갈리고 조금씩 늦게 띄운다 (`world.ts groupFinished`, `fx.floatText(…, delay, dy)`).
- 경주장(`racetrack.ts`): 선수 넷(`racers/<key>`, 레인 = 선수 번호)이 `BoothState.group`(play.race)을 매 프레임 따라간다. idle·gathering = 출발선에 서서 들썩 (출발 3초 전 웅크리고 3·2·1),
  running = `sim/race.ts raceProgress`로 레인을 달린다 (화면 시계가 sim 시계를 부드럽게 따라감, 오른쪽으로 달리면 뒤집기, 선수마다 걸음), 결승 뒤 미끄러져 서고 1등이 통통,
  다음 경주를 받으면 남은 반 바퀴를 돌아 출발선으로. 관중석 자리마다 방석 (그림자층). 참가자 응원은 sim `groupEvent` 이벤트를 구경꾼처럼 작게 (모든 단체 놀이 같이). 경주로·선수를 누르면 경주장.
- WebGL 문맥을 잃었다 되찾으면 코드로 구운 텍스처(바닥 타일·효과·구름)를 다시 굽는다 (`webglcontextrestored`).
  사지 않은 땅의 구름 (`view/land.ts LandView`, 물체층): 가진 땅에서 떨어진 거리로 짙어지는 안개 (작은 텍스처, 32px 텍셀, `FOG_RAMP` 160px 동안 부드럽게, 지도 밖도 구름)를
  땅 조각 한 줄(띠)마다 스프라이트로 깔고 zIndex = 띠 아래 변 (바로 아래 가진 땅의 키 큰 건물이 구름 앞에 선다). 가진 땅과 맞닿은 변·모서리를 따라 구름(`map/cloud_puff`)이 줄지어 일렁이고
  (남쪽 변은 아래 끝을 변에 맞추고, 북·동·서 변은 가진 땅 쪽으로 조금 삐져나온다), 띠마다 떠도는 구름이 바람 따라 흐르다 안개가 옅은 곳에서 흐려진다.
  땅을 사면 그 조각 안개가 가운데부터 걷히고 덮던 구름이 양옆으로 갈라져 흩어진다 (+ 반짝이), 새 가장자리 구름은 조금 뒤 피어난다.
- 효과(`fx.ts`): 코인 튀기기(`items/coin`), 색종이(`fx/fx_confetti` 여러 색으로 tint), 반짝이(`fx/emote_sparkle` 작게), 먼지(`fx/fx_puff`), 떠오르는 숫자(+12, 둥근 굵은 글꼴, 흰 테두리). 대박이면 크게.
- 넷째 묶음 화면: 장신구 `view/accessory.ts` — `AccessoryLayer` (몸 그릇의 자식, (0,0) = 발 기준점, `setAccessories(list)`·`setPose(species, pose)`·`setScaleK(k)`, 뒤에 그릴 것은 `back` 그릇),
  `accessoryAnchors(species, pose)` = 자리마다 캔버스 점과 자리 기준 폭 (`data/accessoryAnchors.ts`: `MEASURED` = `tools/accessory-anchors.ts`가 원본 그림 알파에서 잰 27종 × 4포즈 (`@generated` 사이만 다시 쓴다),
  `FIXES` = 손으로 고친 종, 합친 것 `ACCESSORY_ANCHORS`). 장신구마다 붙이는 법 `ACCESSORY_FIT` (그림 안 붙는 점 ax·ay, 폭 비율, 옮기기·기울기), 둘을 합친 자리는 `accessoryPlacement(종, 포즈, key, slot)`
  (몸 그림·날아가는 장신구·UI가 같은 값을 쓴다), UI 카드용 `accessoryPortrait(종, 포즈, list)` (몸 그림 상자 비율 → `ui/pics.ts dressPic`). `ACCESSORY_SIZE`는 장신구를 모를 때의 대강. 그림이 없으면 코드 모양.
  어둠 `view/moodFilter.ts debtFilters(t)` (단계마다 공유 ColorMatrixFilter: 휘도 쪽으로 70% 섞어 채도를 빼고·밝기 75%·살짝 푸르스름, t 0~1. Pixi `saturate`는 −1 아래에서 색이 뒤집혀 행렬을 직접 만든다. UI는 CSS `saturate(0.3) brightness(0.75)`). 지도 손님(`monsterView.ts`)은 파산하면 어둡게 (몸 그림·장신구 그릇 `skin`에만: 손에 든 연장은 밝게,
  다 갚으면 LABOR.reliefSec 동안 걷힘)·터덜터덜 걸음·먹구름 (7초, 일터에서는 14초마다: 처음 박자는 손님 id로, 띄운 뒤에는 0~5초 무작위로 늦춰 여럿이 한꺼번에 뜨지 않게), working이면 연장(items/hoe·pickaxe, 손잡이 끝을 손에 쥐고 들어 올렸다 톡 내려찍기: 그 프레임 `struck`·`strikeX/Y`)질,
  waitWork면 쪼그리고 흔들흔들. 되찾는 장신구가 날아오는 동안은 `holdAccessory(key, sec)`로 몸에 그리지 않는다. 머리 위 표시는 `drawX·drawY`(맡긴 몸까지 더한 발)와 `emoteLift`(이모트를 더 올림), 장신구 자리 점은 `accessoryAt(key, slot, out)` (`accessoryPlacement`: 몸에 그린 장신구와 같은 점·폭·붙는 점 ax·ay).
  건물(`buildings.ts`): 전당포·은행·일터(시설 둘·소품)는 짓기 전 흐리게 + 빈 부지 표식, 지으면 주인 (`npcNode(id)`·`npcHop(id)`·`buildingParts(id)`).
  전당포 진열창·은행 문 `shopPort(id, out)`, 일터 소품 `yardPropTop(key, out)`·`yardPropHop(key)`. 일터 반장은 일하는 채무자가 있으면 밭 고랑 사이·광산 앞을 오가며 (`FOREMAN_ROUTE`) 가끔 `foremanWhistle(big)`,
  sim `foremanCheer`면 `foremanCheer(x, y, run)`으로 그 손님 곁에 걸어가 '힘내!'.
  연출 `view/debtMap.ts DebtMapView` (world.ts가 손님을 그린 뒤 돌린다, 효과층의 이모트 위): 일터 채무자 머리 위 빚 게이지 (바탕 = 남은 빚, 채움 = 갚은 만큼 `laborGauge`, 넓게 보면 막대만·조금 크게),
  빚 걸기 판 채무자는 '빚 42' 표 (정산하면 출렁·'빚 42→21'), 맡기기 = 장신구가 몸 그 자리에서 떠올라 진열창으로 → 코인이 손님에게, 되찾기 = 코인이 가게로 → 장신구가 날아와 다시 몸에,
  은행 = 문 ↔ 손님 코인, 파산 = '빚 N', 일터 = 내려찍을 때 흙덩이·흙먼지(밭)·돌 조각(광산)·땀방울·한숨, 재료가 바구니·수레로 (`fx.itemArc`), 다 갚음 = 게이지가 꽉 차며 톡·색종이·'빚 다 갚았다!'.
  전당포·은행 계산대의 금고 코인 글자(coinsChanged)는 가게 위에 (`DebtMapView.shopAbove`).

## 확대 화면 (src/view/closeup)

- 부스를 누르면 화면 위쪽 약 55%에 확대 화면 (Pixi Container, 둥근 테두리 패널), 아래는 HTML 부스 정보(UI).
- 장면 고르기는 `registry.ts`: 보통 부스는 `BoothScene` + 부스 장치(`RIGS[b]`, Rig 약속은 rig.ts), 단체 놀이는 `GROUP_SCENES[b]`: 경주장 `RaceScene`(race.ts),
  씨름·오리배·연날리기·줄다리기·보물찾기는 `GroupScene`(group.ts: 배경·진행자·자리마다 손님·발밑 표·항아리·안내·결과를 맡는다)을 이은 `closeup/<booth>.ts`
  (`layout(L)` = 자리·진행자 자리, `drawPlay(play, t, dt)` = 그 시각의 모습, `move(actor, dx, dy, rot)`). 모두 `CloseupScene` 약속.
  GroupScene 훅: `pickText(참가자)` = 발밑 표, `waitText(group)` = 출발 조건이 안 맞을 때 위쪽 글 (씨름 '선수를 기다려요', 줄다리기 '홍 1 : 청 2'), `shakePot()` = 코인이 나갈 때 항아리 흔들기.
  장면 공용 도구: `ssireum_kit.ts` (씨름·줄다리기·보물찾기: `Timeline` 사건 재생, `Talk` 말풍선, `settle` 결과 (받은 코인 숫자는 결과 글자 위로), 먼지·흙·반짝이), `boat_kite_shared.ts` (오리배·연: `fitHost` 진행자를 작게, `HostTalk`, `pickBadge`).
  사건은 CloseupView가 넘기지 않으니 장면이 `play.events`를 자기 시계로 읽는다 (중간에 열면 지난 사건은 건너뛴다). 개발용 미리보기 `_dev/group3_preview.html`·`_dev/boat_kite_preview.html` (진짜 Sim을 돌려 고른 순간에 멈춘다).
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
  - race (`RaceScene`): 상태(`booths.race.group`, 판의 `play.race`)를 매 프레임 읽는다 (중간에 열어도 그 순간). 모이는 중 = '출발까지 N초'·3·2·1, 달리는 중 = 순위표·해설 말풍선·자기 선수가 앞서면 들썩·꼴찌면 땀, 사진 판정은 화면 시계를 멈췄다 따라잡는다, 결과 = 1등 메달·코인·관중 반응.
- 반응: 결과에 맞는 포즈·이모트·연출을 지도보다 크게. 코인이 항아리에서 손님에게 튄다.
- 넷째 묶음: `MonsterActor.sync(m, dt)` (모든 장면이 매 프레임 부른다)가 몸 그릇 안 `AccessoryLayer`(뒤집기·기울기·포즈를 따라감)와 파산 어둠(`debtFilters`, 몸·장신구만, 처음 보일 때는 바로·다 갚으면 LABOR.reliefSec 동안 걷힘)·
  슬픈 숨쉬기·먹구름(장면이 `quiet`면 쉼)을 맡는다. 단체 놀이 `GroupScene`은 빚 걸기 판에 채무자 표 (`debt_kit.ts DebtBadge` '홍 빚 42' → 결과 때 '빚 49 → 25' 세며 초록·금·빨강),
  모이는 동안 위쪽 글 '빚 걸기 판! 채무자를 기다려요', 구석 표지 `debtSign`, 편마다 한 줄 `debtCaption` ('빚 반으로!'·'빚이 사라졌다!'·'상대 빚만큼 +N'), 0이 된 채무자의 홀가분 (2.6초 남겨 어둠이 걷힘).
  전·후 빚은 상태에서 읽는다 (`GroupEntry.debt` → 판이 done이면 `Monster.debt`: 중간에 열어도 맞다). 장면 훅 `debtBadgeAt(자리, 글자 크기)`·`signAt(크기)`·`debtStake(자리)` (씨름·줄다리기가 자리를 정한다).
  개발용 미리보기: `_dev/group3_preview.html?debt=1&debtors=N&acc=1`, `_dev/preview.html?acc=key,…&bankrupt=1`, 장신구 대조표 `_dev/accessory_preview.html` (27종 × 4포즈, `&dark=1&flip=1&lean=…`).

## UI (src/ui)

- HTML 오버레이(`#ui`, 캔버스 위). 모바일 세로 기준, 엄지가 닿는 아래쪽에 조작. 글꼴: 'Jua'(제목·숫자), 'Gowun Dodum'(본문). 색은 art-kit 안내서 1.8의 CSS 토큰.
- 위: 코인, 재료 가방(누르면 재료·귀한 물건·가공품 목록과 얻는 곳, 재료는 그 종이 오는 회관 레벨별로 묶음 `labels.ts AREAS`), 마을 레벨. 그 아래 '다음 목표' 칩 (`ui/goal.ts`: 보관함의 부스·건물 놓기 → 길이 끊긴 건물에 길 잇기 → (회관 2 이상인데 짓기 모드를 안 써 본 사람) 짓기 모드 알림 → 손님 응원 → 부스 구경 → 열린 부스의 꼭 필요한 빈 자리 → 아직 구경하지 않은 새 단체 놀이(경주장 빼고)의 판이 모이거나 한창이면 지도에서 보러 가기 (구경한 놀이는 `mpv-hints-v1`의 `watched`) → 지금 살 수 있는 가장 싼 짓기 (짓기 탭의 그 묶음으로) → 다음 부스와 다음 마을회관 중 코인이 덜 드는 쪽, 누르면 그 화면).
- 아래 탭: 마을(지도) / 짓기(마을 꾸미기 [길 깔기]·[길 지우기]·[땅 넓히기], 보관함, 건물·부스 업그레이드, 열고 놓기, 장식, 놓인 것의 [옮기기]·[보관하기]) / 주민(진행자 자리 칸: 열린 부스의 자리마다 한 칸, 고용·배치·레벨) / 공방(가공 레시피와 진행) / 도감(손님 | 인형 바꾸기: 종·본 반응, 인형 뽑기로 모은 인형). 그 탭에서 지금 할 수 있는 일이 있으면 작은 점.
- 비용 칩은 아이템 그림과 이름을 같이 (폰에는 hover가 없다).
- 손님 카드(손님을 누르면): 그림, 이름(별명 + 종), 성격, 지갑, 기분 막대, 이번 방문 기록, [응원하기] [간식 주기 ▾].
- 부스 패널(부스를 누르면): 확대 화면 + 이름, 레벨, 참가비(복주머니는 특산 재료 1개), 항아리, 진행자 자리마다 한 줄(자리 이름·쓰는 능력치·꼭 필요/있으면 좋아요, [바꾸기 ▾] = `ui/staffMenu.ts`), 줄, [업그레이드] [응원 도구 걸기 ▾].
  단체 놀이(경주장 포함)는 확대 화면 바로 아래에 상태 줄과 판(`ui/groupBoard.ts GroupSection`, 글은 `ui/groupText.ts`): 단계·남은 초·기다리는 조건 (씨름 빠진 편, 줄다리기 편 인원)·접히기 전 경고, 승부가 나면 결과 먼저, [지도] = 패널을 닫고 지도에서 그 판을 보여 준다.
  판: 경주·오리배 = 선수 카드 넷 (지금 순위), 씨름 = 홍·청 선수와 미는 힘 막대, 줄다리기 = 편마다 자리와 밧줄 띠, 연 = 연 넷 (나는 중·엉킴·끊김·우승), 보물찾기 = 지도와 같은 3×2 흙더미 (판 깊이·나온 것·'바로 옆!'·상자 자리).
  다음 판을 모으는 동안은 지난 판 카드 (결과·몇 초 전·손님마다 결과와 받은 코인, 접힌 판은 까닭: 메모리에만), 참가자 줄 (포즈·고른 것·건 코인·결과).
- 토스트: sim `toast` 이벤트와 행동 Result 실패 이유. HUD·목표 칩 바로 아래 (`--toast-top`), 부스 패널이 열려 있으면 화면 아래, 고르기 판이 열려 있으면 판 아래 층.
  '처음 보는 손님이 왔어요: …'처럼 '머리: 이름'인 토스트가 이어 오면 한 줄로 묶는다.
- 목표 칩: 빈 진행자 자리 → 부스 패널을 열고 그 자리의 고르기 판을 연다 (`showBooth(b, role)`), 고용 → 주민 탭을 고용 후보 칸으로 (`openHire`). 시트가 열려 있으면 숨는다.
  진행자 고르기 판 끝에는 늘 '새 진행자 고용하기'. 닫힌 부스 패널은 경고 바로 아래에 진행자 자리 줄을 먼저 보인다.
- 한글 줄바꿈은 낱말 단위 (`.mpv-ui { word-break: keep-all }`).
- 아이템 그림은 `assets/art/items/<key>.webp`를 <img>로 (없으면 글자).
- 넷째 묶음 UI: 전당포·은행·일터를 누르면 `ui/panels/debt.ts` 시트 (`PawnshopPanel`: 맡긴 장신구 줄·진열장 컬렉션 칸 (못 모은 것은 실루엣 '???')·레벨, `BankPanel`: 대출·빚 있는 손님·금고,
  `WorkyardPanel`: 일하는·기다리는 채무자 줄 (빚 게이지·남은 시간·응원/간식 버튼)·나온 재료 (`DebtLog`: 화면을 연 뒤 laborOutput)·빚 걸기 판 상태). 짓기 전에는 설명·비용·짓기 버튼 먼저.
  손님 카드: 장신구·맡긴 장신구(되찾는 값)·빚 칩, 그림 위에 장신구 (`pics.ts dressPic`: `accessoryPortrait` 비율로 <img> 겹치기, 몸 뒤 장신구는 뺀다), 파산하면 카드가 어둡게 가라앉고 먹구름·혼잣말·빚 게이지.
  줄다리기·씨름 판(`groupBoard.ts`·`groupText.ts`): 빚 걸기 판 띠·채무자마다 건 빚 → 결과 '52→26'. 짓기 탭에 '전당포 · 은행 · 일터' 묶음, 목표 칩은 전당포 → 일터 → 은행, 첫 빚 걸기 판·첫 채무자 안내.
  토스트: sim `toast.topic = 'debt'`(파산·다 갚음)는 20초(`ui.ts DEBT_TOAST_GAP`) 안에 또 오면 건너뛴다 (큰 마을에서 1분에 한두 번 오니, 지도 연출·일터 시트에는 그대로).

## 배치형 마을 (DESIGN 6.1)

- 칸·땅: `data/map.ts` CELL 96px, 땅 조각 CHUNK 8칸, 지도 CHUNKS 9×8 조각 (GRID 72×64 칸), 처음 땅 `LAND_START` (아래 가운데 3×3), 고리 `chunkRing`, 처음 마을 `DEFAULT_PLACED`·`DEFAULT_ROADS`·`DEFAULT_DECOR`·`DEFAULT_LOTS`.
  땅 값·회관 레벨 `defs.ts LAND` (값 = (base + perBought × 산 조각 수) × (1 + ringMult × (고리 - 1)), 고리마다 회관 레벨 hall[고리]), 장식 값·기분 `DECOR`·`DECOR_AURA`.
- 모양: `data/catalog.ts` (모두 건물 왼쪽 위 모서리 기준 px). `CatalogKey` = 부스·건물·장식, `footprint(key)` = 칸 w×h·입구 칸 `entry`(발자국 바로 바깥 한 칸)·문 `door`·`fixed`(마을 입구),
  `BOOTH_LAYOUT[b].spot` (BoothSpot: base·seats·queue·pot·hosts·props), `BUILDING_LAYOUT[id]` (base·k), `SHOP_GEO`·`YARD_GEO`·`FOUNTAIN_REST`·`GATE_SPAWN`·`CHIEF_AT`,
  큰 시설 `RACE_GEO`(17×11, 입구 오른쪽)·`BOAT_GEO`(12×10)·`KITE_GEO`(9×5)·`TUG_GEO`(12×6)·`DIG_GEO`(10×8)·`SSIREUM_GEO`(9×6)·일터(12×8), 바닥 모양 `FLOORS`, `catalogKind`·`catalogName`·`artBase`·`needsRoad`.
- 상태: `GameState.village` (`types.ts VillageState`): placed (`Placed` id·key·x·y), roads (칸 번호), chunks (조각 번호), decor (보관함 장식 개수), nextId, rev (place·road·land).
  부스·건물의 보관함은 따로 적지 않는다 (가졌는데 placed에 없으면 보관함). 저장 5 (`save.ts migrate4`: 옛 저장 4는 처음 마을 + 가진 것 자동 배치, 땅은 놓을 만큼만
  (그 회관 레벨로 살 수 있는 조각 가운데 한 조각으로 놓이는 것부터 공짜로 주고, 다 놓은 뒤 빈 조각은 돌려놓는다), 손님은 마을 입구에서 다시, 하던 판·한판의 건 코인은 돌려주고 결과가 난 판(done)은 그대로).
- `sim/village.ts`: `villageOf(state)` = `Village` (rev가 같으면 같은 객체, 화면은 `stamp.place·road·land`로 다시 그릴 때를 안다):
  칸 지도 (`owned`·`occ`·`road`·`entryOf`·`comp`), `placed(key)`·`byId`·`at(x, y)`·`connected(key)`·`linkedId(id)`·`entryPt`·`door`·`isRoad`·`isOwned`·`isWalkable`·`walkable`(걸을 수 있는 길 칸),
  세계 좌표 모양 `booth(b)`·`race()`·`boat()`·`kite()`·`tug()`·`dig()`·`ring()`·`shop(s)`·`yard()`·`rest()`·`gateSpawn()`·`chief()`·`art(key)`·`artOf(placed)` (놓이지 않았으면 지도 밖 `OFF`),
  장식 둘레 기분 `auraAt(칸)`, 길찾기 바탕 `fieldTo`·`cellPath`·`nearestWalkable`, 되돌아가기 `hopField()`(걸을 수 있는 길에서 거꾸로 번지는 가장 싼 길: 길 칸 1, 빈 가진 땅 4, 건물은 못 지난다)·`rescueCells(칸)`
  (그 칸에서 걸을 수 있는 길까지: 끊긴 길 조각은 따라 걷고 풀밭은 짧게, 건물 안이면 입구 칸에서). 검사 `checkPlace`·`roadPaintable`·`chunkInfo`, 바꾸기 `addPlaced`·`movePlaced`·`removePlaced`·`setRoads`·`addChunk` (rev를 올린다),
  자동 배치 `findSpot`·`roadTo` (장식은 `findDecorSpot`: 걸을 수 있는 길 옆 빈 칸 가운데 둘레 길 칸 기분을 가장 많이 더하는 칸).
- `sim/path.ts`: `route(state, from, to, via, lane)` (길 칸으로만, 건물 안은 입구 → 문 → 자리, 같은 건물 안은 곧장, 길 밖에 선 손님은 `rescueCells`로 먼저 길로,
  이어지지 않은 목적지는 그 가까운 걸을 수 있는 길 칸까지만: 길 밖으로 나가지 않는다). 큰 시설 안에서 곧장 가면 경주로·연못을 가로지르는 길은 발자국 안쪽 둘레로 돌아간다 (`innerWay`).
  `laneOffset(id)`, `roadPoint`, `gateDistance`, `pathLength(from, pts)`, `roadAnchor(state, p)` (걸어 나설 길 칸 + 더 걷는 칸 수), `walkCells(state, p, key)` (그 건물 입구까지 길 칸 수, 못 가면 -1),
  `onRoad(state, p)` (걸을 수 있는 길 칸이나 입구가 있는 건물 안: 길로만 걷기 검사), `clampInto(state, key, p)` (줄·계산대·기다리는 자리가 목록보다 많을 때 발자국 안으로).
- 걷기 (sim.ts): `go(m, to, via)`가 길과 목적지 `Monster.dest`를 함께 적는다. 길을 다 걸었는데 목적지에 못 닿았으면 (`shortArrival`: 걷는 동안 길이 끊김) 다시 길을 찾고, 그래도 못 가면 줄·자리로 가던 손님은 다른 걸 하러 간다.
  서 있는 손님이 길 밖이면 (지운 길·치우거나 옮긴 건물 자리) `backToRoad`가 phase·timer는 그대로 두고 길로 걷게 한다 (`decideSoon`도). 길 칸 위에서는 `TUNE.roadSpeed`배로 걷는다.
  부스 고르기(`booths.ts chooseBooth`)·구경하러 가기는 길 칸 거리 d만큼 무게를 나눈다 (1 + d / `TUNE.boothNearCells`, 단체 놀이는 × `TUNE.groupNearMult`).
  마을 입구 앞 길 칸은 지울 수 없다 (`eraseRoad`). 가게·일터에 닿았는데 문을 닫았으면 볼일을 접는다. 일터에 갈 수 없는 채무자는 길에서 기다리다 `LABOR.noYardSec` 뒤 반장이 빚을 덜어 준다 (`relieve(…, 'noYard')`).
  다음 마을회관에 모자란 재료를 가져오는 종은 `TUNE.neededSpeciesWeight`배 자주 온다 (`monsters.ts createMonster`).
- Sim (SimApi): 묻기 `village()`·`owned`·`stored`·`storage()`·`catalog()`·`buyCost`·`buyLockReason`·`canPlace(key, cell, moving)`·`chunk(i)`·`chunkLockReason(i)`,
  행동 `buy(key)` (보관함으로)·`place(key, cell)` (보관함에서, 없으면 사서: 알림은 한 줄)·`move(id, cell)` (안의 손님도 같이, 그리로 오던 손님은 적어 둔 목적지 `Monster.dest`를 새 자리로)·
  `store(id)` (안의 손님·그리로 오던 손님은 다른 걸 하러, 부스 진행자는 쉰다, 모이거나 하던 판·보통 부스의 한판은 접고 건 코인을 돌려준다, 결과가 난 판은 그대로 치운다.
  마을 입구(`fixed`)와 바탕 건물 마을회관·공방·사무소·창고·분수(`keep`, `catalog.ts storable`)는 보관할 수 없다)·
  `paintRoad(cells)` (마을 입구와 이어진 건물이 생기면 알림)·`eraseRoad(cells)` (걷던 손님은 길을 다시)·`buyChunk(i)`·`autoPlace(key)`, `announceStorage()`. 이벤트 `villageChanged {what, key?}`·`landBought {chunk}`.
  안전망: 길을 다 걸었는데 목적지가 그 건물 발자국 밖에 남았으면 (옮긴 옛 자리) `resend`가 하던 일에 맞게 다시 보낸다. 일터 입구 길만 끊기면 일터 안 채무자는 그대로 일하고, 밖에서 못 오는 채무자만 `LABOR.noYardSec`를 잰다.
  단체 놀이를 접은 까닭 `GroupCancelReason` (closed = 진행자, road, stored, timeout).
  부스 열기·건물 짓기는 보관함으로 간다 (게임). `Sim.autoPlaceDefault`·`sim.autoPlaceOnBuy` = 사면 바로 자동 배치 (sim-check·개발용).
  놓인 부스를 놓으면 진행자를 세운다 (`autoAssign`), 보관함 부스엔 진행자를 세울 수 없다 (`assign`·`staff.ts hirePost`). 손님이 들르는 가게·일터·분수는 놓이고 이어져야 쓴다 (`debt.ts shopOpen`).
- 화면: `view/buildMode.ts BuildModeView` (world.ts가 가진다) — 모드 `BuildMode` none·place(key)·move(id)·road·erase·land(chunk?),
  VillageView `setBuildMode(mode)`·`buildState()`·`confirmBuild()`·`cancelBuild()`·`onBuildChange`·`onBuildFail`·`onTapLand(chunk)`·`onTapPlaced(id)`.
  place·move·road·erase에서 한 손가락 = 유령 옮기기·길 칠하기 (손을 떼면 sim.paintRoad·eraseRoad), 두 손가락 = 지도 이동·확대. 유령은 놓을 수 있으면 초록·없으면 빨강, 입구 칸 (이어진 길이면 초록, 아니면 노랑).
  `BuildingsView`는 놓인 것마다 그림을 세우고 (자리가 바뀌면 다시), `placedAt(wx, wy)`·`chunkAt`·`setHidden(id)`(옮기는 동안 숨김).
  칸 금은 바닥 하나만 (`ground.ts setGrid`, 건물 아래: buildMode.ts는 칸 금을 그리지 않는다). 칠하는 길은 `BuildModeView.onPreview` → `ground.previewRoads` (진짜 길 모양,
  손을 뗀 뒤 몇 프레임 더 두어 타일을 다시 굽는 동안 깜박이지 않게). 놓기·옮기기·길 모드에서는 가장자리 구름이 옅어진다 (`LandView.setSeeThrough`: 땅 끝 칸이 보이게).
  큰 시설·보통 부스의 바닥 오솔길은 `FLOORS`의 walk 띠 (부스 5×5는 입구 길에서 계산대까지 한 칸 폭, 밀어내기·경주장·오리배도): 길이 아니라 디딤돌로 그린다 (`ground.ts drawWalk`, sim 길 칸도 아니다).
  마을 입구 아치 밑만 road 띠 (진짜 길과 똑같이). 풀은 마당·연못·경주로를 가진 시설과 마을 입구 발자국, 오솔길 칸에는 심지 않는다 (`bareFloor`, `walkGrid`).
  카메라: 땅 사기 말고는 가진 땅 둘레 + 구름 한 조각 안 (`world.ts area`), 땅 사기를 끝내면 산 조각 (없으면 들어가기 전 자리)으로. 마을 탭을 또 누르면 분수로 (`focusVillage`).
  길 칠하기의 가장자리 자동 이동은 옆 띠가 좁고 (28px) 그 가장자리 쪽으로 움직이거나 멈춰 둘 때만 (`edgePan`). 길 깔기 모드로 이을 때는 입구와 가장 가까운 이어진 길 칸을 같이 담는다 (`panels/build.ts focusJoin`).
  가장자리 구름은 가진 땅으로 22px 안팎만 삐져나오고, 가진 땅의 건물·장식·길에 걸치면 옅게 (`land.ts syncCovers`). 장식 유령·자동 배치는 건물 지붕에 가리는 두 줄을 뒤로 미룬다 (`village.ts underRoof`).
- 디버그 (D 키, `?debug=1`): 칸·땅 조각·걸을 수 있는 길 칸·발자국·입구·안쪽 자리 + `debug.ts GuestDebug` (걷는 손님의 남은 길, 0.2초마다 자국: 초록 = 길 칸이나 입구 있는 건물 안, 빨강 = 길 밖, `world.debugGuests.off` = 길 밖 자국 수).
- UI: `ui/buildBar.ts BuildBar` (짓기 모드 ✓/✕ 띠), `ui/panels/build.ts startPlace(ctx, key)`·`placeRow(ctx, key)`·`PlacedPanel` (장식), UiCtx `startBuild(mode)`·`showPlaced(id)`, UiApi `showLand`·`onBuildChange`·`toast`.
- 주소: `?build=road|erase|land|<key>|tab|tab:<분류>` (처음부터 짓기 모드·짓기 탭), `?at=<key>` (놓인 그 건물), `?unlockAll=1`은 장식 36개도 길가에 놓는다 (`dev.ts devDecorate`).
- 자동 배치 (`findSpot(…, spread)`, `autoPlace(key, spread)`): spread면 위·아래로 바로 붙은 다른 건물 칸마다 점수 +8 (새 길 한 칸 = 14): 건물 그림이 발자국 위로 1~2칸 삐져나가서,
  붙여 놓으면 아래 건물 지붕이 위 시설의 마당·자리를 가린다. 옛 저장 옮기기·`devPlaceAll`(?all)만 켠다 (sim-check 촌장은 끈다: 흩어 놓으면 빈 땅이 조각나 일터가 늦게 놓인다).
- sim-check: 처음 마을·놓기 검사·놓기/옮기기/보관하기·길 끊기/잇기·땅·길로만 걷기 (걷는 손님이 길 칸이나 건물 안)·옛 저장(4) 옮기기 (`scripts/fixtures/save-v4-*.json`: early 회관 1, mid 회관 3·부스 9·전당포, all 회관 5)·자동 배치 + 땅 넓히기 (selftest 0),
  튼튼함 (`villageRobustness`: 마을 입구 앞 길, 경주장 둘레 길, 큰길 끊기·잇기, 일터 치우기, 15분 동안 아무렇게나 길 지우기·옮기기·보관하기: 길 밖 손님은 서 있지 않고, 풀밭은 짧게, 건물을 지나지 않는다).
  `--village` = 배치형 마을 시험만. 매 틱 놓인 것 불변식 (`checkVillage`), 욕심쟁이 촌장은 보관함에 남은 것이 있으면 그것이 들어갈 땅을 산다 (`landFor`), 50초에 한 번쯤 길가에 장식 (`--no-decor`: 안 산다,
  `--cheap N`: 회관 코인을 모으는 중에도 회관 코인의 N배 이하 부스는 연다). `--auto --seeds`는 10틱마다 길 밖 손님(`strays`: 서 있든 걷든)을 세어 하나라도 있으면 실패, 손님 시간 (놀기·걷기·입구 오가기·줄)을 찍는다.
