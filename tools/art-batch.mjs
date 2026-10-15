// art-kit의 gen.ts를 여러 개 동시에 돌린다 (키트 README: 다른 키라면 2~3개 동시에 돌려도 된다).
//   node tools/art-batch.mjs [-j 3] <그룹/key>[@원본폴더] ...
// '@원본폴더'를 붙이면 그 폴더(키트 폴더 기준)에 뽑는다: 기준 그림 후보를 여러 판 뽑을 때 (예: monsters/dragon_base@../art-try/dragon1).
// 같은 키를 같은 폴더에 동시에 두 번 돌리지 않는다 (gen.ts가 잠금으로 막는다).
// 끝나면 키마다 결과 한 줄(뽑음/실패, 크기, 걸린 시간, 토큰)을 찍는다. 전체 출력은 각 원본 폴더의 _logs/에 있다.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = join(dirname(fileURLToPath(import.meta.url)), 'art-kit');
const args = process.argv.slice(2);
let jobs = 3;
const queue = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-j') jobs = Number(args[++i]);
  else queue.push(args[i]);
}
if (queue.length === 0) {
  console.log('node tools/art-batch.mjs [-j 3] <그룹/key>[@원본폴더] ...');
  process.exit(1);
}

const results = [];
function run(job) {
  const [id, raw] = job.split('@');
  const argv = ['tools/gen.ts', id, ...(raw ? ['--raw', raw] : [])];
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, argv, { cwd: KIT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => {
      const line = out.split('\n').find((l) => l.includes('뽑음:')) ?? out.trim().split('\n').slice(-3).join(' | ');
      const sec = Math.round((Date.now() - started) / 1000);
      const r = `${code === 0 ? 'OK ' : 'ERR'} ${job.padEnd(44)} ${sec}s  ${line.trim()}`;
      console.log(r);
      results.push(r);
      resolve();
    });
  });
}

let next = 0;
async function worker() {
  while (next < queue.length) await run(queue[next++]);
}
console.log(`${queue.length}개, 동시에 ${jobs}개`);
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, worker));
const bad = results.filter((r) => r.startsWith('ERR')).length;
console.log(`\n끝: ${results.length - bad}개 뽑음, ${bad}개 실패`);
