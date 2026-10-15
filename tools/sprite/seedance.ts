// Seedance 2.x 이미지→영상 API 클라이언트와 명령. BytePlus ModelArk(해외) / 火山方舟 Ark(중국)의 '영상 생성 작업' API.
//   POST {base}/contents/generations/tasks          작업 만들기 → { id }
//   GET  {base}/contents/generations/tasks/{id}     작업 보기 → { status, content.video_url, … }
//   DELETE {base}/contents/generations/tasks/{id}   대기 중 작업 취소 (확인 안 됨, README 참고)
//   인증: Authorization: Bearer <API 키>
// 사실과 출처는 tools/sprite/README.md의 'Seedance API' 절 (확인한 것 / 확인 못 한 것을 나눠 적었다).
//
// 설정 (환경 변수 또는 tools/sprite/.env.local, 저장소에 넣지 않는다):
//   SEEDANCE_API_KEY   (없으면 ARK_API_KEY)
//   SEEDANCE_BASE_URL  기본 https://ark.ap-southeast.bytepluses.com/api/v3 (BytePlus). 중국 Ark는 https://ark.cn-beijing.volces.com/api/v3
//   SEEDANCE_MODEL     기본 dreamina-seedance-2-5-260628 (BytePlus). 중국 Ark는 doubao-seedance-2-5-260628
//
// 명령:
//   node tools/sprite/seedance.ts --image <prep.png> --clip <이름> [--species S] [--out FILE.mp4] [--dry]
//        [--duration N] [--resolution 720p] [--last same|none|FILE.png] [--extra "덧붙일 영어 문장"] [--model ID]
//        [--audio] [--watermark] [--poll 10] [--timeout 1800] [--dry-body FILE.json]
//   node tools/sprite/seedance.ts --status <작업 id>
//   node tools/sprite/seedance.ts --resume <영상 옆의 .task.json>     (끊긴 기다림을 이어서 받는다)
//   node tools/sprite/seedance.ts --cancel <작업 id>
//   node tools/sprite/seedance.ts --clips                             (프리셋과 프롬프트 보기)
//
// --dry: 네트워크 없이 보낼 요청(방법, 주소, 머리, 본문)을 그대로 찍는다. 그림 data URL만 길이로 줄여 찍는다
//        (--dry-body FILE이면 본문 전체를 파일로). API 키가 없어도 된다.
// 결과: <out>.mp4 와 <out>.task.json (요청 요약, 작업 id, 상태, 영상 주소, prepare 기록 경로: extract.ts가 읽는다).
//   작업 id는 만들자마자 .task.json에 적는다: 기다리다 끊겨도 --resume으로 받는다 (작업은 7일, 영상 주소는 24시간 산다).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { ANIM_RAW, ensureDir, fail, loadEnvLocal, parseArgs, readJson, rel, writeJson } from './common.ts';
import type { PrepSidecar } from './prepare.ts';
import { buildPrompt, CLIPS, clipPreset, type ClipPreset } from './presets.ts';

export const DEFAULT_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';
export const DEFAULT_MODEL = 'dreamina-seedance-2-5-260628';

export interface SeedanceConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
}

/** 환경 변수 + tools/sprite/.env.local. needKey가 false면 키 없이도 돌려준다 (--dry). */
export function loadConfig(needKey: boolean, model?: string): SeedanceConfig {
  loadEnvLocal();
  const apiKey = process.env.SEEDANCE_API_KEY ?? process.env.ARK_API_KEY ?? '';
  if (needKey && apiKey === '') fail('SEEDANCE_API_KEY가 없다. tools/sprite/.env.local에 SEEDANCE_API_KEY=... 를 적거나 환경 변수로 준다 (--dry는 키 없이 된다).');
  return {
    apiKey,
    baseUrl: (process.env.SEEDANCE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: model ?? process.env.SEEDANCE_MODEL ?? DEFAULT_MODEL,
  };
}

export type ContentItem =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image_url'; readonly image_url: { readonly url: string }; readonly role: 'first_frame' | 'last_frame' | 'reference_image' };

/** 작업 만들기 본문 (공식 문서의 필드 이름 그대로). */
export interface CreateTaskBody {
  readonly model: string;
  readonly content: readonly ContentItem[];
  readonly ratio?: string;
  readonly resolution?: string;
  readonly duration?: number;
  readonly generate_audio?: boolean;
  readonly watermark?: boolean;
  readonly return_last_frame?: boolean;
  /** Seedance 1.0 pro 계열만 (2.x는 받지 않는다: 프롬프트로 카메라를 묶는다). */
  readonly camera_fixed?: boolean;
  readonly seed?: number;
}

export interface TaskInfo {
  readonly id: string;
  readonly model?: string;
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed' | 'expired' | 'cancelled' | string;
  readonly error?: { readonly code?: string; readonly message?: string } | null;
  readonly content?: { readonly video_url?: string; readonly last_frame_url?: string } | null;
  readonly usage?: { readonly completion_tokens?: number; readonly total_tokens?: number } | null;
  readonly resolution?: string;
  readonly ratio?: string;
  readonly duration?: number;
  readonly framespersecond?: number;
  readonly created_at?: number;
  readonly updated_at?: number;
}

/** 로컬 그림 → data URL (공식 형식: data:image/<소문자 형식>;base64,<…>). */
export function imageDataUrl(path: string): string {
  const ext = (path.toLowerCase().split('.').pop() ?? 'png').replace('jpg', 'jpeg');
  return `data:image/${ext};base64,${readFileSync(path).toString('base64')}`;
}

export interface BuildOptions {
  readonly model: string;
  readonly prompt: string;
  readonly firstFrame: string;
  /** 끝 프레임 그림 (되풀이 클립은 첫 프레임과 같은 그림). 없으면 첫 프레임 모드. */
  readonly lastFrame?: string;
  readonly resolution?: string;
  readonly duration?: number;
  readonly audio?: boolean;
  readonly watermark?: boolean;
  readonly returnLastFrame?: boolean;
}

/** 요청 본문 만들기. 비율은 'adaptive' (2.5의 첫 프레임·첫끝 프레임 작업은 adaptive만 받는다: 그림 비율을 따른다). */
export function buildBody(o: BuildOptions): CreateTaskBody {
  const content: ContentItem[] = [
    { type: 'text', text: o.prompt },
    { type: 'image_url', image_url: { url: imageDataUrl(o.firstFrame) }, role: 'first_frame' },
  ];
  if (o.lastFrame !== undefined) content.push({ type: 'image_url', image_url: { url: imageDataUrl(o.lastFrame) }, role: 'last_frame' });
  const legacy = /seedance-1-0/.test(o.model);
  return {
    model: o.model,
    content,
    ratio: 'adaptive',
    resolution: o.resolution ?? '720p',
    duration: o.duration ?? 4,
    // 2.x는 기본으로 소리를 만든다: 쓰지 않으므로 끈다.
    generate_audio: legacy ? undefined : (o.audio ?? false),
    watermark: o.watermark ?? false,
    return_last_frame: o.returnLastFrame ?? false,
    ...(legacy ? { camera_fixed: true } : {}),
  };
}

/** 찍기용: data URL을 길이·해시로 줄인 본문. */
export function redactBody(body: CreateTaskBody): unknown {
  return {
    ...body,
    content: body.content.map((c) => {
      if (c.type !== 'image_url') return c;
      const url = c.image_url.url;
      if (!url.startsWith('data:')) return c;
      const b64 = url.slice(url.indexOf(',') + 1);
      const sha = createHash('sha256').update(b64).digest('hex').slice(0, 12);
      return { ...c, image_url: { url: `${url.slice(0, url.indexOf(',') + 1)}<base64 ${b64.length}자, 원본 ${Math.round((b64.length * 3) / 4 / 1024)}KB, sha256 ${sha}…>` } };
    }),
  };
}

function headers(cfg: SeedanceConfig): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` };
}

async function call<T>(cfg: SeedanceConfig, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const url = `${cfg.baseUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { method, headers: headers(cfg), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    throw new Error(`${method} ${url} 연결 실패: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 800);
    try {
      const j = JSON.parse(text) as { error?: { code?: string; message?: string } };
      if (j.error !== undefined) msg = `${j.error.code ?? ''} ${j.error.message ?? ''}`.trim();
    } catch {
      // 본문이 JSON이 아니면 그대로.
    }
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${msg}`);
  }
  return (text === '' ? {} : JSON.parse(text)) as T;
}

export async function createTask(cfg: SeedanceConfig, body: CreateTaskBody): Promise<string> {
  const r = await call<{ id?: string }>(cfg, 'POST', '/contents/generations/tasks', body);
  if (typeof r.id !== 'string') throw new Error(`작업 id가 없다: ${JSON.stringify(r).slice(0, 300)}`);
  return r.id;
}

export function getTask(cfg: SeedanceConfig, id: string): Promise<TaskInfo> {
  return call<TaskInfo>(cfg, 'GET', `/contents/generations/tasks/${encodeURIComponent(id)}`);
}

export async function cancelTask(cfg: SeedanceConfig, id: string): Promise<void> {
  await call(cfg, 'DELETE', `/contents/generations/tasks/${encodeURIComponent(id)}`);
}

const DONE = new Set(['succeeded', 'failed', 'expired', 'cancelled']);

export async function waitTask(cfg: SeedanceConfig, id: string, o: { pollSec?: number; timeoutSec?: number; onStatus?: (t: TaskInfo) => void } = {}): Promise<TaskInfo> {
  const started = Date.now();
  const poll = Math.max(1, o.pollSec ?? 10) * 1000;
  const limit = (o.timeoutSec ?? 1800) * 1000;
  let last = '';
  for (;;) {
    let t: TaskInfo;
    try {
      t = await getTask(cfg, id);
    } catch (e) {
      // 잠깐의 네트워크 오류는 넘기고 다시 묻는다.
      console.warn(`  (다시 묻기) ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, poll));
      continue;
    }
    if (t.status !== last) {
      last = t.status;
      o.onStatus?.(t);
    }
    if (DONE.has(t.status)) return t;
    if (Date.now() - started > limit) throw new Error(`기다림 시간 초과 (${o.timeoutSec ?? 1800}초). 작업 ${id}는 계속 돈다: --resume으로 이어 받는다.`);
    await new Promise((r) => setTimeout(r, poll));
  }
}

export async function download(url: string, out: string): Promise<number> {
  const res = await fetch(url, { signal: AbortSignal.timeout(600_000) });
  if (!res.ok) throw new Error(`영상 받기 실패 HTTP ${res.status} (영상 주소는 24시간만 산다)`);
  const buf = Buffer.from(await res.arrayBuffer());
  ensureDir(dirname(out));
  writeFileSync(out, buf);
  return buf.length;
}

/** <영상>.task.json: 작업 기록. extract.ts가 species·clip·prep을 읽는다. */
export interface TaskRecord {
  readonly version: 1;
  species: string;
  clip: string;
  prep: string | null;
  image: string;
  lastImage: string | null;
  video: string;
  baseUrl: string;
  model: string;
  prompt: string;
  request: unknown;
  taskId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  videoUrl: string | null;
  error: unknown;
  usage: unknown;
  info: Partial<TaskInfo> | null;
}

export interface GenerateOptions {
  /** prepare가 만든 마젠타 그림 (옆에 같은 이름 .json이 있으면 읽는다). */
  readonly image: string;
  readonly clip: string;
  readonly species?: string;
  readonly out?: string;
  readonly dry?: boolean;
  readonly dryBody?: string;
  readonly duration?: number;
  readonly resolution?: string;
  /** 'same' (되풀이 클립 기본) | 'none' | 그림 경로 */
  readonly last?: string;
  readonly extra?: string;
  readonly model?: string;
  readonly audio?: boolean;
  readonly watermark?: boolean;
  readonly pollSec?: number;
  readonly timeoutSec?: number;
}

function presetOrDie(name: string): ClipPreset {
  const p = clipPreset(name);
  if (p === undefined) fail(`모르는 클립: ${name} (아는 것: ${Object.keys(CLIPS).join(', ')})`);
  return p;
}

/** 요청을 만들어 (dry면 찍고 멈춘다) 작업을 만들고, 기다리고, 영상을 받는다. */
export async function generateClip(o: GenerateOptions): Promise<{ video: string; record: string; dry: boolean }> {
  const preset = presetOrDie(o.clip);
  const image = resolve(o.image);
  if (!existsSync(image)) fail(`그림이 없다: ${rel(image)} (먼저 prepare.ts)`);
  const prepPath = image.replace(/\.png$/i, '') + '.json';
  const prep = existsSync(prepPath) ? readJson<PrepSidecar>(prepPath) : null;
  const species = o.species ?? prep?.species ?? basename(image).replace(/_[^_]*\.png$/i, '');
  const video = resolve(o.out ?? join(ANIM_RAW, species, `${o.clip}.mp4`));
  const recordPath = video.replace(/\.mp4$/i, '') + '.task.json';
  const lastOpt = o.last ?? (preset.loop ? 'same' : 'none');
  const lastImage = lastOpt === 'none' ? undefined : lastOpt === 'same' ? image : resolve(lastOpt);
  if (lastImage !== undefined && !existsSync(lastImage)) fail(`끝 프레임 그림이 없다: ${rel(lastImage)}`);

  const cfg = loadConfig(o.dry !== true, o.model);
  const prompt = buildPrompt(preset, species, o.extra);
  const body = buildBody({
    model: cfg.model,
    prompt,
    firstFrame: image,
    lastFrame: lastImage,
    resolution: o.resolution ?? prep?.out.resolution ?? '720p',
    duration: o.duration ?? preset.duration,
    audio: o.audio,
    watermark: o.watermark,
  });
  const redacted = redactBody(body);

  if (o.dry === true) {
    const key = cfg.apiKey === '' ? '<SEEDANCE_API_KEY 없음>' : `${cfg.apiKey.slice(0, 4)}…(${cfg.apiKey.length}자)`;
    console.log(`--dry: 네트워크를 쓰지 않는다. 보낼 요청 (${species}/${o.clip}):`);
    console.log(`POST ${cfg.baseUrl}/contents/generations/tasks`);
    console.log(`Content-Type: application/json`);
    console.log(`Authorization: Bearer ${key}`);
    console.log(JSON.stringify(redacted, null, 2));
    console.log(`그다음: GET ${cfg.baseUrl}/contents/generations/tasks/<id>를 ${o.pollSec ?? 10}초마다 → status=succeeded면 content.video_url을 ${rel(video)}로 받는다.`);
    if (o.dryBody !== undefined) {
      writeFileSync(resolve(o.dryBody), JSON.stringify(body, null, 2));
      console.log(`본문 전체: ${rel(resolve(o.dryBody))}`);
    }
    return { video, record: recordPath, dry: true };
  }

  const now = (): string => new Date().toISOString();
  const record: TaskRecord = {
    version: 1,
    species,
    clip: o.clip,
    prep: existsSync(prepPath) ? rel(prepPath) : null,
    image: rel(image),
    lastImage: lastImage === undefined ? null : rel(lastImage),
    video: rel(video),
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    prompt,
    request: redacted,
    taskId: null,
    status: 'creating',
    createdAt: now(),
    updatedAt: now(),
    videoUrl: null,
    error: null,
    usage: null,
    info: null,
  };
  writeJson(recordPath, record);
  console.log(`작업 만들기: ${species}/${o.clip} (${cfg.model}, ${body.resolution}, ${body.duration}초${lastImage === undefined ? '' : ', 끝 프레임 있음'})`);
  record.taskId = await createTask(cfg, body);
  record.status = 'queued';
  record.updatedAt = now();
  writeJson(recordPath, record);
  console.log(`  작업 id ${record.taskId} (기록: ${rel(recordPath)})`);
  await finish(cfg, record, recordPath, o.pollSec, o.timeoutSec);
  return { video, record: recordPath, dry: false };
}

async function finish(cfg: SeedanceConfig, record: TaskRecord, recordPath: string, pollSec?: number, timeoutSec?: number): Promise<void> {
  const id = record.taskId;
  if (id === null) throw new Error('작업 id가 없다');
  const started = Date.now();
  const t = await waitTask(cfg, id, {
    pollSec,
    timeoutSec,
    onStatus: (s) => {
      record.status = s.status;
      record.updatedAt = new Date().toISOString();
      writeJson(recordPath, record);
      console.log(`  ${Math.round((Date.now() - started) / 1000)}초: ${s.status}`);
    },
  });
  record.status = t.status;
  record.error = t.error ?? null;
  record.usage = t.usage ?? null;
  record.info = { resolution: t.resolution, ratio: t.ratio, duration: t.duration, framespersecond: t.framespersecond };
  record.updatedAt = new Date().toISOString();
  if (t.status !== 'succeeded') {
    writeJson(recordPath, record);
    throw new Error(`작업 ${id}: ${t.status} ${t.error?.code ?? ''} ${t.error?.message ?? ''}`.trim());
  }
  const url = t.content?.video_url;
  if (url === undefined) {
    writeJson(recordPath, record);
    throw new Error(`작업 ${id}: 성공인데 video_url이 없다`);
  }
  record.videoUrl = url;
  writeJson(recordPath, record);
  const video = resolve(record.video);
  const bytes = await download(url, video);
  console.log(`  받음: ${rel(video)} (${Math.round(bytes / 1024)}KB, 토큰 ${t.usage?.completion_tokens ?? '?'}) → node tools/sprite/extract.ts ${rel(video)}`);
}

/** 끊긴 작업 이어 받기. */
export async function resume(recordPath: string, pollSec?: number, timeoutSec?: number): Promise<void> {
  const record = readJson<TaskRecord>(resolve(recordPath));
  const cfg = { ...loadConfig(true), baseUrl: record.baseUrl, model: record.model };
  console.log(`이어 받기: ${record.species}/${record.clip} 작업 ${record.taskId} (마지막 상태 ${record.status})`);
  await finish(cfg, record, resolve(recordPath), pollSec, timeoutSec);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), {
    valued: ['image', 'clip', 'species', 'out', 'duration', 'resolution', 'last', 'extra', 'model', 'poll', 'timeout', 'dry-body', 'status', 'resume', 'cancel'],
    switches: ['dry', 'audio', 'watermark', 'clips'],
  });
  const poll = args.get('poll') === undefined ? undefined : args.num('poll', 10);
  const timeout = args.get('timeout') === undefined ? undefined : args.num('timeout', 1800);
  if (args.has('clips')) {
    for (const c of Object.values(CLIPS)) console.log(`${c.name.padEnd(8)} ${c.loop ? '되풀이' : '한 번  '} ${c.duration}초 첫 프레임 ${c.pose.padEnd(5)}  ${c.ko}`);
    const first = Object.values(CLIPS)[0];
    if (first !== undefined) console.log(`\n프롬프트 예 (dragon/${first.name}):\n${buildPrompt(first, 'dragon')}`);
  } else if (args.get('status') !== undefined) {
    const t = await getTask(loadConfig(true), args.get('status') ?? '');
    console.log(JSON.stringify(t, null, 2));
  } else if (args.get('cancel') !== undefined) {
    await cancelTask(loadConfig(true), args.get('cancel') ?? '');
    console.log('취소를 보냈다 (대기 중 작업만 취소된다).');
  } else if (args.get('resume') !== undefined) {
    await resume(args.get('resume') ?? '', poll, timeout);
  } else {
    const image = args.get('image');
    const clip = args.get('clip');
    if (image === undefined || clip === undefined) {
      console.log('node tools/sprite/seedance.ts --image <prep.png> --clip <idle|walk|joy|agony|sad|cry_lie|clap> [--species S] [--out FILE.mp4] [--dry] ...');
      console.log('node tools/sprite/seedance.ts --clips | --status <id> | --resume <FILE.task.json> | --cancel <id>');
      process.exit(1);
    }
    await generateClip({
      image,
      clip,
      species: args.get('species'),
      out: args.get('out'),
      dry: args.has('dry'),
      dryBody: args.get('dry-body'),
      duration: args.get('duration') === undefined ? undefined : args.num('duration', 4),
      resolution: args.get('resolution'),
      last: args.get('last'),
      extra: args.get('extra'),
      model: args.get('model'),
      audio: args.has('audio'),
      watermark: args.has('watermark'),
      pollSec: poll,
      timeoutSec: timeout,
    });
  }
}

if (import.meta.main) {
  main().catch((e: unknown) => fail((e as Error).message));
}
