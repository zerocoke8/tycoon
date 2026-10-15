# tools/sprite — Seedance 영상 → 스프라이트 시트

Codex 정지 그림을 Seedance 2.5(이미지→영상)로 움직이게 하고, 그 영상을 게임이 쓰는 스프라이트 시트로 바꾼다.
Node 24와 ffmpeg만 쓴다 (npm 패키지 없음). 기획: `docs/DESIGN.md` 7.1, 7.2.

```text
tools/art-raw/monsters/dragon_base.png (투명, 1254²)
  │ prepare.ts   마젠타(#FF00FF) 바탕, Seedance 크기(720p 1:1 = 960²), 캔버스 대응 기록
  ▼
tools/anim-raw/prep/dragon_base.png + .json
  │ seedance.ts  작업 만들기 → 기다리기 → 영상 받기 (첫 프레임 = 이 그림, 되풀이면 끝 프레임도 = 이 그림)
  ▼
tools/anim-raw/dragon/idle.mp4 + idle.task.json
  │ extract.ts   프레임 → 마젠타 빼기 → 이음매 자르기 → 클립 공통 상자 → 줄이기 → 시트 + JSON
  ▼
public/assets/anim/dragon/idle.webp + idle.json, public/assets/anim/index.json
  │ src/view/anim.ts   loadClip('dragon', 'idle') → { textures, fps, anchor, loop } | null
  ▼
게임 (AnimatedSprite, 정지 그림과 같은 발 기준점·배율)
```

`tools/anim-raw/`와 `tools/sprite/test-out/`은 저장소에 넣지 않는다 (.gitignore). 영상은 다시 뽑으면 다르게 나오므로 `tools/anim-raw/`는 따로 보관해 둔다.

## 준비

- **Node 24** (`node tools/sprite/<도구>.ts`로 바로 돈다).
- **ffmpeg**: 환경 변수 `FFMPEG`(파일 또는 bin 폴더) → `PATH` → `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_*\ffmpeg-*\bin` 순서로 찾는다. `winget install Gyan.FFmpeg`이면 따로 할 일이 없다.
- **API 키** (영상 만들 때만): `tools/sprite/env.example`을 `tools/sprite/.env.local`로 복사해 `SEEDANCE_API_KEY`를 채운다. `.env.local`은 `.gitignore`의 `.env.*`로 빠진다.
  - `SEEDANCE_BASE_URL` 기본 `https://ark.ap-southeast.bytepluses.com/api/v3` (BytePlus), 중국 Ark는 `https://ark.cn-beijing.volces.com/api/v3`.
  - `SEEDANCE_MODEL` 기본 `dreamina-seedance-2-5-260628` (BytePlus), 중국 Ark는 `doubao-seedance-2-5-260628`. **콘솔에서 꼭 확인한다** (아래 'Seedance API').

## 빠른 시작

```bash
node tools/sprite/make.ts dragon idle,joy --dry   # 보낼 요청만 찍는다 (네트워크 없음, 키 없어도 된다)
node tools/sprite/make.ts dragon idle              # 한 클립: prepare → Seedance → extract
node tools/sprite/make.ts dragon all               # 7개 모두 (차례로)
node tools/sprite/make.ts dragon all --skip-video  # 영상은 이미 있고 시트만 다시
node tools/sprite/make.ts chief idle,walk          # 주민 (tools/art-raw/characters/chief.png)
```

`make.ts`는 이미 있는 것(마젠타 입력, 영상)을 다시 만들지 않는다. `--force`면 모두 다시. 실패한 클립은 건너뛰고 끝에 알린다.
결과를 열어 본다: `node tools/sprite/extract.ts tools/anim-raw/dragon/idle.mp4 --debug` → `public/assets/anim/dragon/idle.preview.png` (체크 무늬 위 시트, 빨간 십자 = 발).

## 클립 프리셋 (`presets.ts`)

| 클립 | 내용 | 첫 프레임 | 되풀이 | 길이 |
|---|---|---|---|---|
| idle | 대기: 숨쉬기, 눈 깜빡, 살짝 흔들 | base | 예 | 4초 |
| walk | 제자리 걷기 (러닝머신처럼, 화면을 가로지르지 않음) | base | 예 | 4초 |
| joy | 만세하며 통통 점프, 같은 자리에 내려앉음 | joy | 예 | 4초 |
| agony | 머리 감싸 쥐고 도리도리 (아깝게 놓침) | agony | 예 | 4초 |
| sad | 축 처지고 눈물 한 방울 | sad | 예 | 4초 |
| cry_lie | 벌러덩 드러누워 떼쓰며 엉엉 (끝까지 누워 있음) | sad | 아니오 | 6초 |
| clap | 구경하며 박수, 살짝 들썩 | base | 예 | 4초 |

- 첫 프레임 그림은 `tools/art-raw/monsters/<종>_<포즈>.png`, 없으면 `<종>_base.png`. 포즈 그림은 base와 같은 캔버스 자리에 그렸으므로 발 기준점은 언제나 base에서 잰다 (`monsterFoot`와 같다).
- 되풀이 클립은 **끝 프레임 = 첫 프레임 그림** (Seedance 첫·끝 프레임 모드. 공식 문서: 두 그림이 같아도 된다).
- 프롬프트 = 공통 규칙 + 동작 + 종 메모(`SPECIES_NOTES`: 박쥐는 날갯짓으로 떠 있음, 유령은 다리 없이 둥실 …) + 되풀이 문장.
  공통 규칙: 고정 카메라(줌·팬·흔들림·컷 없음), 화면 끝까지 평평한 마젠타 #FF00FF(그림자·바닥·조명 변화·그러데이션·비네트·입자 없음),
  같은 그림 결(굵은 짙은 갈색 외곽선, 평평한 색, 음영·하이라이트 추가 없음, 모션 블러 없음), 같은 자리·같은 크기·왼쪽을 봄,
  발은 같은 자리(점프는 같은 자리에 착지), 새 물건·효과·캐릭터 없음.
  `node tools/sprite/seedance.ts --clips`로 목록과 프롬프트 예를 본다. 클립 하나에 덧붙일 말은 `--extra "..."`.

## 도구별

### prepare.ts — 마젠타 입력 그림

```bash
node tools/sprite/prepare.ts monsters/dragon_base            # 또는 원본 경로
node tools/sprite/prepare.ts characters/chief --resolution 1080p
```

- 투명 원본의 알파를 art-kit처럼 다듬고(< 8은 0, ≥ 240은 255), ffmpeg로 마젠타 바탕에 얹는다
  (`color` 소스 + `premultiply` + `scale=…:flags=area` + `overlay=alpha=premultiplied`: 가장자리에 엉뚱한 색이 끼지 않는다).
- 비율: Seedance 2.5 첫 프레임 작업은 `ratio=adaptive`만 받고 영상 비율을 그림에 맞춘다. 그래서 그림을 지원 비율 가운데 가장 가까운 것으로
  **덧대고**(자르지 않는다) 크기도 그 해상도의 영상 크기로 맞춘다: 몬스터 1:1 → 960×960, 주민 2:3 → 3:4 834×1112 (720p).
- 기록 `<key>.json`: 원본·캔버스·출력 크기, 놓은 자리, `canvasToOut`(출력 px = 캔버스 px × s + o), 발 기준점(캔버스·출력), 외곽선 색.
- 옵션: `--resolution 480p|720p|1080p`, `--ratio`, `--zoom 0.85`(점프·드러눕기 자리가 모자라면 그림을 줄여 여유를 둔다), `--canvas WxH`, `--foot X,Y`, `--outline #rrggbb`, `--out`.

### seedance.ts — API 클라이언트 + 명령

```bash
node tools/sprite/seedance.ts --image tools/anim-raw/prep/dragon_base.png --clip idle --dry
node tools/sprite/seedance.ts --image tools/anim-raw/prep/dragon_base.png --clip idle
node tools/sprite/seedance.ts --resume tools/anim-raw/dragon/idle.task.json   # 끊긴 기다림 이어 받기
node tools/sprite/seedance.ts --status <작업 id>
node tools/sprite/seedance.ts --cancel <작업 id>
```

- 요청 본문: `model`, `content`[ text 프롬프트, image_url(data URL) `role: first_frame`, (되풀이면) `role: last_frame` ],
  `ratio: "adaptive"`, `resolution: "720p"`, `duration: 4`, `generate_audio: false`(2.x 기본은 소리 켜짐), `watermark: false`, `return_last_frame: false`.
  모델 id에 `seedance-1-0`이 들어 있을 때만 `camera_fixed: true` (1.0 pro 전용 필드). 2.x는 카메라 고정을 프롬프트로 건다.
- `--dry`: 방법·주소·머리·본문을 그대로 찍는다 (data URL은 길이·sha256으로 줄여서. `--dry-body FILE`이면 본문 전체를 파일로).
- 작업 id는 만들자마자 `<영상>.task.json`에 적는다. 기다리다 끊겨도 `--resume`. 작업 기록은 7일, 영상 주소는 24시간 산다.
- 모듈로도 쓴다: `loadConfig`, `buildBody`, `createTask`, `getTask`, `waitTask`, `cancelTask`, `download`, `generateClip`, `resume`.
- 옵션: `--duration`, `--resolution`, `--last same|none|FILE.png`, `--extra`, `--model`, `--audio`, `--watermark`, `--poll 10`, `--timeout 1800`, `--out`.

### extract.ts — 영상 → 시트

```bash
node tools/sprite/extract.ts tools/anim-raw/dragon/idle.mp4 [--debug]
```

1. ffmpeg가 `fps=12`로 프레임을 고르고 **yuv444p 전 범위**로 풀어 Node로 흘린다 (rawvideo 파이프, 영상 전체를 메모리에 올리지 않는다).
2. 마젠타 빼기 (`key.ts`, 아래).
3. 되풀이 클립이면 이음매 자르기: 앞 25% 안의 시작 s와 절반 이상 뒤의 끝 e 가운데 두 프레임(과 이웃 프레임: 움직이는 방향)이 가장 닮은 짝 → [s, e).
4. 남은 **모든 프레임의 알파 사각형을 합친 공통 상자**(+ 여백)로 자른다 → 프레임끼리 흔들리지 않는다.
5. 칸 높이(`--cell-h 320`)에 맞춰 넓이 평균으로 줄인다 (미리 곱한 알파: 투명한 곳의 색이 번지지 않는다). 격자로 붙여 ffmpeg로 WebP(품질 90, 알파) 또는 PNG.
6. JSON (PixiJS v8 스프라이트시트):
   - `frames`: `<종>_<클립>_000` …, 칸마다 `anchor` = 발 기준점 (prepare 기록에서 영상 → 칸 좌표로 옮긴 것).
   - `animations: { <클립>: [...] }`, `meta.image`, `meta.size`.
   - `meta.scale` = **칸 px / 캔버스 px**. Pixi는 이것을 텍스처 해상도로 쓰므로 텍스처 크기가 '캔버스 단위'가 된다 → 게임에서 `scale = ART_SCALE.monster` 하나로 정지 그림과 같은 크기.
   - `meta.clip`: `{ species, name, fps, loop, frames, anchor, cell, scale, canvas, foot, source }`.
7. `public/assets/anim/index.json`에 클립을 적는다 (게임은 이 목록에 있는 클립만 부른다: 없는 파일을 요청하지 않는다).

옵션: `--fps`(0 = 영상 그대로), `--cell-h` 또는 `--scale`(칸 px/캔버스 px로 고정: 종의 클립끼리 선명도를 맞출 때), `--pad 6`, `--loop auto|on|off`, `--trim A:B`,
`--format webp|png`, `--quality`, `--max-atlas 4096`(넘으면 칸을 줄인다), `--matrix auto|601|709|2020`, `--outline auto|#rrggbb`, `--band --dkey --dfg --min-island`, `--out-root`, `--no-index`, `--debug`.

### 마젠타 빼기 (`key.ts`)

H.264 4:2:0은 색(Cb·Cr)을 반 해상도로 저장하고 번지게 한다. 밝기(Y)는 제 해상도라 날카롭다. 그래서:

1. **바탕판**: 프레임을 12×12 칸으로 나눠 칸마다 '마젠타 색상(색의 방향)'인 픽셀의 중앙값을 바탕 색으로 잡고 쌍선형으로 편다.
   밝기는 보지 않으므로 그러데이션·비네트로 어두워진 마젠타도 바탕이 된다. 프레임마다 다시 잰다 (밝기 깜빡임).
2. 바탕 색과의 거리(Y는 0.5배, Cb·Cr)로 바탕(< 26) / 가장자리 / 그림(> 70)을 크게 가른다.
3. **가장자리 띠**(그림이 아닌 곳에서 3px 안): 그림 바깥 둘레는 언제나 짙은 외곽선이라, 외곽선과 마젠타가 섞인 픽셀은 Y가 둘 사이에 놓인다
   → **α = (Y_바탕 − Y) / (Y_바탕 − Y_외곽선)**, 색은 **외곽선 색**. 색이 번져도 외곽선–마젠타 선분 위에서 번지므로(잔차 ≤ 26) 이 길을 쓴다.
   그 밖의 반투명 픽셀(밝은 색의 흐림)은 바탕을 빼서(unmix) 제 색을 되살리고 마젠타 기운을 뺀다(despill).
4. 띠 바로 안쪽(+3px)의 어두운 외곽선 픽셀이 마젠타 쪽으로 물들었으면 외곽선 색으로 (오목한 모서리 끝).
5. 아주 옅은 알파 정리, 작은 섬(압축 잡티, 알파 합 < 40px) 지우기. 투명 픽셀의 색도 외곽선 색으로 채운다 (밉맵·WebP가 가장자리에 분홍을 끌어오지 않게).
6. 외곽선 색은 첫 프레임에서 잰다 (바탕에서 4~7px 안쪽의 어두운 픽셀 중앙값). 못 재면 prepare 기록의 색(원본에서 잰 것).
7. YCbCr 행렬: 영상 태그(bt709 → 709), 태그가 없으면 601(ffmpeg 기본과 같다). 10비트 HEVC(2.5의 1080p)도 ffmpeg가 8비트로 푼다.

## 게임에서 쓰기 (`src/view/anim.ts`)

```ts
import { clipSprite, loadClip } from './anim.ts';
const clip = await loadClip('dragon', 'idle');          // 없으면 null → 정지 그림 그대로
if (clip !== null) {
  const s = clipSprite(clip, ART_SCALE.monster);         // anchor = 발, scale = k
  body.addChild(s); art.visible = false; s.play();       // ArtNode와 같은 부모·같은 (0,0)
}
```

- 내보내는 것: `loadClip(species, clip): Promise<AnimClip | null>`, `AnimClip { textures, fps, anchor, loop }`, `clipSprite(clip, k)`, `loadAnimIndex()`, `hasClip()`, `unloadClip()`.
- 좌우 뒤집기와 트윈 연출은 지금처럼 부모(MonsterView의 `body`)에 건다. 반응 포즈 이름(joy·agony·sad)과 클립 이름이 같다.
- 클립 한 장은 GPU에서 수 MB (예: 칸 274×320 × 48프레임 ≈ 17MB + 밉맵). 화면에 보이는 손님·확대 화면에만 쓰고, 다 쓴 클립은 `unloadClip`.

## 시험 (Seedance 없이)

```bash
node tools/sprite/test-synth.ts                   # 진짜 원본(dragon_base)으로 합성 영상 → extract → 자동 검사
node tools/sprite/test-synth.ts --noisy           # 고르지 않은 바탕 (비네트 + 프레임마다 잡음)
node tools/sprite/test-synth.ts --untagged --res 480p --crf 28   # 태그 없는 601 영상, 얇은 외곽선, 강한 압축
node tools/sprite/test-synth.ts --src monsters/bat_base           # 연보라 박쥐 (마젠타에 가장 가까운 색)
node tools/sprite/test-synth.ts --src characters/chief            # 주민 (3:4)
node tools/sprite/test-api.ts                     # 흉내 API 서버로 클라이언트 전체 (요청 모양, 기다리기, 받기, 기록, extract)
```

`test-synth.ts`: 투명 원본을 마젠타 위에 얹어 찌그러짐·점프(ffmpeg `scale=eval=frame` + `overlay`, 발 기준점 고정)를 넣은 H.264 yuv420p 영상을 만들고,
투명 바탕, 분홍 테(가장자리 4px 안의 마젠타 기운, 원본 팔레트와 견줌), 외곽선(첫 프레임을 원본에서 바로 만든 정답과 알파 IoU·|Δα|·깎임/불어남), 속 색,
발 줄(점프 밖 프레임의 아래 끝 ±1px, 발 가로 자리), 발 기준점, 되풀이 자르기, JSON 모양, index.json을 잰다.
눈으로 볼 그림: `test-out/check_edges.png`(흰·검정·초록 바탕 4배), `test-out/check_frames.png`(남색 바탕, 노란 줄 = 발), `test-out/anim/<종>/hop.preview.png`.

## 문제 해결

| 증상 | 할 일 |
|---|---|
| 분홍 테가 남는다 | `--debug`로 확인. 외곽선이 얇으면(480p) `--band 2`, 넓게 번졌으면 `--band 4`. 외곽선 색을 잘못 쟀으면 `--outline #2b1610`. 가장 좋은 건 720p 이상으로 다시 뽑기. |
| 그림 속 마젠타 같은 색이 구멍 난다 | 몬스터 팔레트에 진분홍·마젠타를 쓰지 않는다 (DESIGN 7.1). prepare가 그림에 마젠타 기운이 있으면 경고한다. `--dkey 18`로 바탕 판정을 좁힌다. |
| "바탕이 고르지 않다" 경고 | 바탕판이 받아 주지만 가장자리를 꼭 본다. 심하면 프롬프트에 `--extra "The magenta background must stay perfectly uniform."`를 더해 다시 뽑는다. |
| 그림자·바닥이 생겼다 | 어두운 마젠타 그림자는 외곽선 섞임처럼 반투명 짙은 색으로 남는다. 다시 뽑거나 `--trim`으로 그 구간을 뺀다. |
| 되풀이 이음매가 튄다 ("이음매가 보일 수 있다") | `--loop off`로 전부 쓰거나 `--trim A:B`로 직접 고른다. 모델이 끝 프레임을 첫 프레임에 못 맞췄으면 다시 뽑는다. |
| 발이 흔들린다·떠 있다 | 모델이 캐릭터를 옮긴 것이다 (시트는 공통 상자라 흔들림을 만들지 않는다). 프롬프트의 '같은 자리' 문장을 강하게 (`--extra`), 또는 다시 뽑기. |
| 화면 가장자리에 닿는다 경고 | 점프·드러눕기가 잘렸다. `prepare --zoom 0.85`로 여유를 두고 다시 뽑는다. |
| 색이 살짝 다르다 | 태그 없는 영상의 행렬 추측이 틀렸을 수 있다: `--matrix 709` 또는 `--matrix 601`. |
| 시트가 너무 크다 | 프레임 수 × 칸 크기. `--fps 10`, `--cell-h 256`, 클립 길이 줄이기. `--max-atlas`를 넘으면 칸을 알아서 줄인다. |
| HTTP 401 | 키 확인 (`SEEDANCE_API_KEY`, 지역: BytePlus 키는 BytePlus 주소로). |
| HTTP 404 / 모델 없음 | `SEEDANCE_MODEL`을 콘솔의 모델 id로 (계정에 그 모델이 열려 있어야 한다). |
| 받기 실패 | 영상 주소는 24시간만 산다: `--resume`으로 작업을 다시 물어 새 주소를 받는다 (작업은 7일). |
| ffmpeg를 못 찾는다 | `FFMPEG`에 ffmpeg.exe 경로 또는 bin 폴더 (`.env.local`에 적어도 된다). |

## Seedance API — 찾은 사실과 출처

확인한 것 (공식 문서, 2026-10-15에 읽음):

- 작업 만들기 `POST {base}/contents/generations/tasks`, 본문 `model`, `content`[`{type:"text",text}`, `{type:"image_url",image_url:{url},role:"first_frame"|"last_frame"|"reference_image"}`, …],
  `ratio`(16:9, 4:3, 1:1, 3:4, 9:16, 21:9, adaptive), `resolution`(2.5: 480p·720p·1080p, 기본 720p), `duration`(2.5: 4~30초 또는 -1), `generate_audio`(기본 true, 2.x),
  `watermark`(기본 false), `return_last_frame`, `callback_url`, `execution_expires_after`, (2.5만) `output_format`·`draft`·`omni_reference_task_type`.
  `camera_fixed`·`seed`·`frames`는 **Seedance 1.0 pro 계열만**. 응답 `{ id }`.
  — 火山方舟 创建视频生成任务 API: https://docs.volcengine.com/docs/82379/1520757
- **2.5의 첫 프레임·첫끝 프레임 작업은 `ratio`로 adaptive만 받는다**; 영상 비율은 첫 프레임 그림을 따른다. 첫·끝 프레임 그림은 같아도 되고, 비율이 다르면 끝 프레임을 잘라 맞춘다. (같은 문서)
- 해상도 × 비율 → 영상 크기 표 (2.5 720p: 1:1 960×960, 3:4 834×1112, 9:16 720×1280 …; 1080p 1:1 1440×1440). 2.5의 1080p는 10비트 H.265. (같은 문서)
- 그림 입력: jpeg·png·webp·bmp·tiff·gif(2.0부터 heic·heif), 가로÷세로 0.4~2.5, 한 변 300~6000px, 30MB 미만, 요청 본문 64MB 이하.
  data URL 형식 `data:image/<소문자 형식>;base64,<…>`. (같은 문서)
- 출력 프레임 속도: 문서의 식 '프레임 수 = 길이 × 24'와 응답 예의 `framespersecond=24`. (같은 문서)
- 작업 보기 `GET {base}/contents/generations/tasks/{id}`: `status` queued·running·succeeded·failed·expired·cancelled, `content.video_url`(**24시간** 유효), `content.last_frame_url`,
  `usage.completion_tokens`, `framespersecond`, `resolution`, `ratio`, `duration`. 7일 안의 작업만 볼 수 있다. 2.5 영상 주소는 100번까지 받을 수 있다.
  — 查询视频生成任务 API: https://docs.volcengine.com/docs/82379/1521309
- 인증 `Authorization: Bearer $ARK_API_KEY`, 중국 Ark 기본 주소 `https://ark.cn-beijing.volces.com/api/v3`. — Base URL及鉴权: https://docs.volcengine.com/docs/82379/1298459
- 중국 Ark의 2.5 모델 id `doubao-seedance-2-5-260628` (위 创建 문서의 Python 예).
- BytePlus ModelArk에 Seedance 2.5가 나왔다 (2026-08-06, 클립 최대 30초). — https://www.byteplus.com/en/blog/dreamina-seedance2-5 ,
  튜토리얼 https://docs.byteplus.com/en/docs/ModelArk/2607688 (스크립트로 그려지는 페이지라 본문을 읽지 못했다).

**확인 못 한 것** (쓰기 전에 콘솔·문서로 확인):

- BytePlus 주소 `https://ark.ap-southeast.bytepluses.com/api/v3`: 제3자 글(예: https://www.datacamp.com/tutorial/seedance-2-0-api-guide)에서. BytePlus API 문서(https://docs.byteplus.com/en/docs/ModelArk/1520757)는 본문을 읽지 못했다. 경로·필드는 중국 Ark와 같다고 가정했다.
- BytePlus 2.5 모델 id `dreamina-seedance-2-5-260628`: 제3자 글(https://aiseedance25.app/seedance-2-5-api)에서. 2.0은 `dreamina-seedance-2-0-260128`.
- 취소 `DELETE {base}/contents/generations/tasks/{id}`: 查询 문서가 '취소·삭제' API 문서를 가리키지만 그 문서는 읽지 않았다.
- 요금: 토큰 과금 (`usage.completion_tokens`). 제3자 글의 식 '(입력 영상 초 + 출력 초) × 가로 × 세로 × fps / 1024'는 확인하지 않았다.
- 2.5 첫 프레임 모드가 `resolution`을 그대로 따르는지 (adaptive 비율 + 720p면 960×960으로 나올 것으로 본다). extract는 받은 영상 크기에 맞춰 옮기므로 크기가 달라도 된다 (비율이 다르면 경고).

## 파일

| 파일 | 하는 일 |
|---|---|
| `common.ts` | 폴더, 인자, ffmpeg 찾기·돌리기·프레임 흘리기, 그림 읽기·쓰기, `.env.local`, 넓이 평균 줄이기 |
| `presets.ts` | 클립 프리셋, 종 메모, 프롬프트 틀 |
| `prepare.ts` | 마젠타 입력 그림 + 캔버스 대응 기록 |
| `seedance.ts` | API 클라이언트 + 명령 (`--dry`, `--resume`, `--status`, `--cancel`, `--clips`) |
| `key.ts` | 마젠타 빼기 |
| `extract.ts` | 영상 → 시트 + JSON + index.json |
| `make.ts` | 한 번에 (prepare → seedance → extract) |
| `test-synth.ts`, `test-api.ts` | Seedance 없는 시험 |
| `env.example` | `.env.local` 틀 |
