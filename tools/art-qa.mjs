// 그림 검수: 세트마다 외곽선 굵기를 늘 같게 (docs/ART_QA.md).
//   node tools/art-qa.mjs                      모든 그림을 재서 범위를 벗어난 것을 알린다
//   node tools/art-qa.mjs <그룹/key>...        그 그림만
//   node tools/art-qa.mjs --fix [--retries 2]  벗어난 그림을 <key>.rejectedN.png로 남기고 '가늘었다/굵었다' 문단을 붙여 다시 뽑는다
//                                              (손님 기본 그림을 다시 뽑으면 같은 종의 포즈 셋과 인형도 다시 뽑는다)
// 잣대: art-kit inspect.ts의 외곽선 '짧은 변 1024 환산'(at1024). 세트마다 목표 ± 허용치 (아래 RULES).
// 사용자 규칙 (2026-10-18): "외곽선의 두께를 항상 일정하게" — 가는 쪽만이 아니라 굵은 쪽도 벗어나면 다시 뽑는다.
// 세트 기준 그림(art-assets.ts LOCKED, copy: true)은 다시 뽑지 않는다 (세트의 잣대다).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOLS = dirname(fileURLToPath(import.meta.url));
const KIT = join(TOOLS, 'art-kit');
const RAW = join(TOOLS, 'art-raw');
const { PROJECT_ASSETS } = await import(pathToFileURL(join(TOOLS, 'art-assets.ts')).href);

/**
 * 세트와 외곽선 목표 (at1024 px). 2026-10-18 지금 그림들의 분포(가운데값)와 세트 기준 그림에서 정했다.
 * 목표를 바꾸면 docs/ART_QA.md의 표도 같이 고친다.
 */
export const RULES = [
  { set: '주민', test: (a) => a.group === 'characters', target: 20, tol: 1.5 },
  { set: '손님 몬스터', test: (a) => a.group === 'monsters', target: 14.5, tol: 2.7 },
  { set: '건물·놀이부스', test: (a) => a.group === 'map' && a.max >= 600 && a.max <= 720 && a.transparent, target: 12, tol: 2 },
  { set: '지도 소품', test: (a) => a.group === 'map' && a.max <= 400 && a.transparent, target: 19.5, tol: 3.5 },
  { set: '아이템·장신구', test: (a) => a.group === 'items', target: 23, tol: 3.5 },
  { set: '슬롯 심볼', test: (a) => a.group === 'icons', target: 31, tol: 4 },
  { set: '이모트·효과', test: (a) => a.group === 'fx', target: 35, tol: 5 },
  { set: '선수·탈것', test: (a) => a.group === 'racers', target: 15, tol: 3 },
  { set: '인형', test: (a) => a.group === 'objects' && a.key.startsWith('plush_'), target: 18, tol: 3 },
];

/**
 * 사용자가 눈으로 보고 좋다고 승인한 그림: 범위를 벗어나도 검수에서 뺀다 (다시 뽑지 않는다). 승인한 날과 까닭을 남긴다.
 */
export const APPROVED = new Map([
  ['characters/clerk_souvenir', '2026-10-18 사용자 승인: 둘째 판 A (선 23px)가 좋다'],
  // 측정 예외: 짙은 색 면이 외곽선으로 잡혀 수치가 부푼다 (눈으로 다른 그림과 같은 굵기임을 확인했다).
  ['racers/racer_ladybug', '2026-10-18 측정 예외: 짙은 머리와 등 점이 외곽선으로 잡힌다 (후보 9장 모두 18.8 이상, 눈으로는 다른 선수와 같은 굵기)'],
]);

const ruleOf = (a) => (APPROVED.has(`${a.group}/${a.key}`) ? null : RULES.find((r) => r.test(a)) ?? null);
const id = (a) => `${a.group}/${a.key}`;

const THIN =
  'IMPORTANT outline thickness: the previous try came out with a TOO THIN outline. Use the SAME very thick, bold dark brown outline as the reference images on every shape, ' +
  'exactly as heavy as on the dwarf (and the second image, if any): NOT thinner. Keep the object the same size in the canvas.';
const THICK =
  'IMPORTANT outline thickness: the previous try came out with a TOO THICK outline. Use exactly the SAME outline thickness as the reference images: a bold dark brown line, but NOT heavier or fatter than on the dwarf (and the second image, if any). Keep the object the same size in the canvas.';

function measure(files) {
  if (files.length === 0) return new Map();
  const out = execFileSync(process.execPath, [join(KIT, 'tools', 'inspect.ts'), '--json', ...files], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const rows = JSON.parse(out);
  const list = Array.isArray(rows) ? rows : Object.values(rows);
  const m = new Map();
  files.forEach((f, i) => m.set(f, list[i]));
  return m;
}

function check(assets) {
  const files = [];
  const items = [];
  for (const a of assets) {
    const rule = ruleOf(a);
    if (rule === null) continue;
    const f = join(RAW, a.group, `${a.key}.png`);
    if (!existsSync(f)) continue;
    files.push(f);
    items.push({ a, rule, f });
  }
  const m = measure(files);
  return items.map(({ a, rule, f }) => {
    const v = m.get(f)?.outline?.at1024 ?? NaN;
    const lo = rule.target - rule.tol;
    const hi = rule.target + rule.tol;
    const status = Number.isNaN(v) ? 'skip' : v < lo ? 'thin' : v > hi ? 'thick' : 'ok';
    return { a, rule, f, v, lo, hi, status };
  });
}

function nextRejected(a) {
  const dir = join(RAW, a.group);
  const used = readdirSync(dir).filter((n) => n.startsWith(`${a.key}.rejected`)).length;
  return join(dir, `${a.key}.rejected${used + 1}.png`);
}

function regen(a, extra) {
  const r = spawnSync(process.execPath, [join(KIT, 'tools', 'gen.ts'), id(a)], {
    cwd: KIT,
    encoding: 'utf8',
    env: { ...process.env, ART_RETRY_KEY: id(a), ART_RETRY_EXTRA: extra },
  });
  const line = `${r.stdout}`.split('\n').find((l) => l.includes('뽑음:'));
  return r.status === 0 && line !== undefined;
}

const SAME =
  'IMPORTANT outline thickness: use EXACTLY the same outline thickness as the reference images (the dwarf, and the second image if any): a bold dark brown line, neither thinner nor thicker. Keep the object the same size in the canvas.';

/**
 * --pick N: '가늘었다/굵었다' 문단은 Codex가 반대쪽으로 지나치게 고칠 때가 많다. 그래서 중립 문단(SAME)으로 후보 N장을 동시에 뽑고,
 * 지금 판·버린 판(rejectedN)·후보를 모두 재서 목표에 가장 가까운 것을 원본 자리에 놓는다 (나머지는 rejectedN / art-try에 남는다).
 */
function pickBest(a, n) {
  const rule = ruleOf(a);
  if (rule === null) return null;
  const dir = join(RAW, a.group);
  const jobs = Array.from({ length: n }, (_, i) => `${id(a)}@../art-try/qa/${a.group}-${a.key}-${i + 1}`);
  spawnSync(process.execPath, [join(TOOLS, 'art-batch.mjs'), '-j', String(n), ...jobs], {
    cwd: TOOLS,
    encoding: 'utf8',
    env: { ...process.env, ART_RETRY_KEY: id(a), ART_RETRY_EXTRA: SAME },
  });
  const cands = [join(dir, `${a.key}.png`), ...readdirSync(dir).filter((f) => f.startsWith(`${a.key}.rejected`)).map((f) => join(dir, f))];
  for (let i = 1; i <= n; i++) cands.push(join(TOOLS, 'art-try', 'qa', `${a.group}-${a.key}-${i}`, a.group, `${a.key}.png`));
  const ok = cands.filter((f) => existsSync(f));
  const m = measure(ok);
  let best = null;
  for (const f of ok) {
    const v = m.get(f)?.outline?.at1024;
    if (typeof v !== 'number') continue;
    const d = Math.abs(v - rule.target);
    if (best === null || d < best.d) best = { f, v, d };
  }
  if (best === null) return null;
  const cur = join(dir, `${a.key}.png`);
  if (best.f !== cur) {
    if (existsSync(cur)) renameSync(cur, nextRejected(a));
    if (best.f.includes(`${a.key}.rejected`)) renameSync(best.f, cur);
    else writeFileSync(cur, readFileSync(best.f));
  }
  return { v: best.v, from: best.f, inRange: Math.abs(best.v - rule.target) <= rule.tol };
}

const args = process.argv.slice(2);
const pickN = args.includes('--pick') ? Number(args[args.indexOf('--pick') + 1]) : 0;
if (pickN > 0) {
  const pk = args.filter((x, i) => !x.startsWith('--') && args[i - 1] !== '--pick');
  const todo = check(PROJECT_ASSETS.filter((a) => pk.length === 0 || pk.includes(id(a)) || pk.includes(a.group)))
    .filter((r) => (r.status === 'thin' || r.status === 'thick') && !r.a.copy)
    .map((r) => r.a);
  for (const a of todo) {
    process.stdout.write(`  후보 ${pickN}장에서 고르기 ${id(a)} … `);
    const r = pickBest(a, pickN);
    console.log(r === null ? '실패' : `${r.v} ${r.inRange ? '통과' : '가장 가까운 판 (아직 벗어남)'} ← ${r.from.replace(TOOLS, 'tools')}`);
  }
  process.exit();
}
const fix = args.includes('--fix');
const ri = args.indexOf('--retries');
const retries = ri >= 0 ? Number(args[ri + 1]) : 2;
const picks = args.filter((x, i) => !x.startsWith('--') && !(ri >= 0 && i === ri + 1));
let assets = PROJECT_ASSETS.filter((a) => picks.length === 0 || picks.includes(id(a)) || picks.includes(a.group));

const results = check(assets);
const bad = results.filter((r) => r.status === 'thin' || r.status === 'thick');
const bySet = new Map();
for (const r of results) {
  const s = bySet.get(r.rule.set) ?? { n: 0, bad: 0 };
  s.n++;
  if (r.status === 'thin' || r.status === 'thick') s.bad++;
  bySet.set(r.rule.set, s);
}
for (const [set, s] of bySet) console.log(`${set.padEnd(10)} ${s.n}장, 벗어남 ${s.bad}`);
for (const r of bad) console.log(`  ${r.status === 'thin' ? '가늚' : '굵음'}  ${id(r.a).padEnd(34)} ${String(r.v).padStart(5)}  (범위 ${r.lo}~${r.hi}, ${r.rule.set})${r.a.copy ? '  [세트 기준 그림: 다시 뽑지 않음]' : ''}`);
if (!fix) {
  process.exitCode = bad.length > 0 ? 1 : 0;
  process.exit();
}

// ── 다시 뽑기 ──
const queue = bad.filter((r) => !r.a.copy).map((r) => r.a);
/** 기본 그림이 바뀌어 따라 다시 뽑아야 하는 그림 (굵기가 범위 안이어도 한 번은 꼭 다시 뽑는다). */
const forced = new Set();
// 손님 기본 그림이 바뀌면 같은 종의 포즈 셋과 인형도 (그 기본 그림을 참조로 그렸다).
for (const a of [...queue]) {
  const m = a.group === 'monsters' && /^(.*)_base$/.exec(a.key);
  if (!m) continue;
  for (const k of ['joy', 'agony', 'sad'].map((p) => `${m[1]}_${p}`)) {
    const p = PROJECT_ASSETS.find((x) => x.group === 'monsters' && x.key === k);
    if (p && !queue.includes(p)) {
      queue.push(p);
      forced.add(p);
    }
  }
  const pl = PROJECT_ASSETS.find((x) => x.group === 'objects' && x.key === `plush_${m[1]}`);
  if (pl && !queue.includes(pl)) {
    queue.push(pl);
    forced.add(pl);
  }
}
let fixed = 0;
for (const a of queue) {
  const rule = ruleOf(a);
  for (let t = 1; t <= retries; t++) {
    const [now] = check([a]);
    const mustRedo = t === 1 && (forced.has(a) || bad.some((b) => b.a === a));
    if (now && now.status === 'ok' && !mustRedo) break;
    const f = join(RAW, a.group, `${a.key}.png`);
    const extra = now?.status === 'thick' ? THICK : now?.status === 'thin' ? THIN : '';
    if (existsSync(f)) renameSync(f, nextRejected(a));
    process.stdout.write(`  다시 뽑기 ${id(a)} (${t}/${retries}${extra === THICK ? ', 굵었다' : extra === THIN ? ', 가늘었다' : ', 기본 그림이 바뀌어서'}) … `);
    if (!regen(a, extra)) {
      console.log('실패');
      continue;
    }
    const [after] = check([a]);
    console.log(`${after?.v} ${after?.status === 'ok' ? '통과' : '아직 벗어남'}`);
    if (after?.status === 'ok') {
      fixed++;
      break;
    }
    if (rule === null) break;
  }
}
console.log(`\n다시 뽑아 통과: ${fixed} / ${queue.length}. 남은 것은 위에서 '아직 벗어남'. 버린 판은 <key>.rejectedN.png로 남았다.`);
