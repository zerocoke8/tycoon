// 진짜 Seedance를 부르지 않고 API 클라이언트를 처음부터 끝까지 시험: 이 파일 안에서 Ark 작업 API 흉내 서버(127.0.0.1)를 띄우고
// make.ts와 같은 길(prepare → generateClip → extract)을 돈다.
//   node tools/sprite/test-api.ts
// 먼저 node tools/sprite/test-synth.ts가 만든 tools/sprite/test-out/synth_hop.mp4가 있어야 한다 (흉내 서버가 '결과 영상'으로 준다).
// 보는 것: 요청 방법·경로·Bearer 키, 본문 필드(model, content의 text·first_frame·last_frame data URL, ratio adaptive,
//   resolution, duration, generate_audio false, watermark false), queued → running → succeeded 기다리기, video_url 받기,
//   .task.json 기록, extract가 기록에서 종·클립·prepare 기록을 찾아 시트를 만드는지.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fail, readJson, SPRITE_DIR } from './common.ts';
import { extract } from './extract.ts';
import { prepare } from './prepare.ts';
import { generateClip, type CreateTaskBody, type TaskRecord } from './seedance.ts';

const OUT = join(SPRITE_DIR, 'test-out');
const VIDEO = join(OUT, 'synth_hop.mp4');
if (!existsSync(VIDEO)) fail('먼저 node tools/sprite/test-synth.ts (합성 영상이 필요하다)');

const KEY = 'test-key-not-real';
const problems: string[] = [];
let created: CreateTaskBody | null = null;
let polls = 0;
let port = 0;

function send(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString();
}

const server = createServer((req, res) => {
  void (async () => {
    const url = req.url ?? '';
    if (url === '/files/result.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end(readFileSync(VIDEO));
      return;
    }
    if (req.headers.authorization !== `Bearer ${KEY}`) {
      problems.push(`Authorization 머리가 다르다: ${req.headers.authorization ?? '(없음)'}`);
      send(res, 401, { error: { code: 'AuthenticationError', message: 'bad key' } });
      return;
    }
    if (req.method === 'POST' && url === '/api/v3/contents/generations/tasks') {
      const body = JSON.parse(await readBody(req)) as CreateTaskBody;
      created = body;
      send(res, 200, { id: 'cgt-mock-0001' });
      return;
    }
    if (req.method === 'GET' && url === '/api/v3/contents/generations/tasks/cgt-mock-0001') {
      polls++;
      const status = polls === 1 ? 'queued' : polls === 2 ? 'running' : 'succeeded';
      send(res, 200, {
        id: 'cgt-mock-0001',
        model: created?.model,
        status,
        error: null,
        content: status === 'succeeded' ? { video_url: `http://127.0.0.1:${port}/files/result.mp4` } : null,
        usage: status === 'succeeded' ? { completion_tokens: 108900, total_tokens: 108900 } : null,
        resolution: '720p',
        ratio: '1:1',
        duration: 4,
        framespersecond: 24,
        created_at: 1760000000,
        updated_at: 1760000060,
      });
      return;
    }
    problems.push(`모르는 요청: ${req.method} ${url}`);
    send(res, 404, { error: { code: 'NotFound', message: url } });
  })();
});
await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
port = (server.address() as AddressInfo).port;
process.env.SEEDANCE_API_KEY = KEY;
process.env.SEEDANCE_BASE_URL = `http://127.0.0.1:${port}/api/v3`;
process.env.SEEDANCE_MODEL = 'dreamina-seedance-2-5-260628';

const prep = await prepare({ input: 'monsters/dragon_base', out: join(OUT, 'api', 'prep', 'dragon_base.png'), quiet: true });
const video = join(OUT, 'api', 'dragon', 'idle.mp4');
await generateClip({ image: prep.png, clip: 'idle', species: 'dragon', out: video, pollSec: 1 });
server.close();

// 요청 본문 확인
const b = created as CreateTaskBody | null;
if (b === null) problems.push('작업 만들기 요청이 오지 않았다');
else {
  const text = b.content.find((c) => c.type === 'text');
  const roles = b.content.filter((c) => c.type === 'image_url').map((c) => (c.type === 'image_url' ? c.role : ''));
  const urls = b.content.filter((c) => c.type === 'image_url').map((c) => (c.type === 'image_url' ? c.image_url.url : ''));
  if (b.model !== 'dreamina-seedance-2-5-260628') problems.push(`model ${b.model}`);
  if (text === undefined || !/magenta \(#FF00FF\)/.test(text.type === 'text' ? text.text : '')) problems.push('프롬프트에 마젠타 바탕 규칙이 없다');
  if (roles.join(',') !== 'first_frame,last_frame') problems.push(`그림 역할 ${roles.join(',')}`);
  if (!urls.every((u) => u.startsWith('data:image/png;base64,iVBOR'))) problems.push('그림이 PNG data URL이 아니다');
  if (b.ratio !== 'adaptive' || b.resolution !== '720p' || b.duration !== 4 || b.generate_audio !== false || b.watermark !== false) problems.push(`옵션 ${JSON.stringify({ ratio: b.ratio, resolution: b.resolution, duration: b.duration, generate_audio: b.generate_audio, watermark: b.watermark })}`);
  if ('camera_fixed' in b) problems.push('2.x 요청에 camera_fixed가 들어갔다 (1.0 pro 전용)');
}
const rec = readJson<TaskRecord>(video.replace(/\.mp4$/, '.task.json'));
if (rec.status !== 'succeeded' || rec.taskId !== 'cgt-mock-0001' || rec.videoUrl === null || rec.prep === null) problems.push(`기록 ${JSON.stringify({ status: rec.status, taskId: rec.taskId, videoUrl: rec.videoUrl, prep: rec.prep })}`);
if (polls < 3) problems.push(`기다리기 ${polls}번`);
if (readFileSync(video).length !== readFileSync(VIDEO).length) problems.push('받은 영상 크기가 다르다');

// extract: 기록에서 종·클립·prepare를 찾는다 (옵션 없이)
const r = await extract({ video, outRoot: join(OUT, 'api', 'anim'), quiet: true });
if (r.meta.species !== 'dragon' || r.meta.name !== 'idle' || r.meta.source.prep === null || !r.meta.loop) problems.push(`extract ${JSON.stringify({ species: r.meta.species, clip: r.meta.name, prep: r.meta.source.prep, loop: r.meta.loop })}`);

if (problems.length > 0) {
  console.log(`\n실패:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`\n통과: 요청 모양, Bearer 키, 기다리기 ${polls}번 (queued → running → succeeded), 받기, 기록, extract (${r.meta.frames}프레임, ${r.atlas.w}x${r.atlas.h})`);
