// art-kit inspect.ts의 결과를 짧은 표로 (검수용).
//   node tools/art-check.mjs <폴더나 png>...
// 열: 파일, 캔버스, 그림 크기(캔버스 대비 %), 발 높이(아래에서 %), 외곽선(짧은 변 1024 환산), 경고.
// 손님 몬스터는 몸 높이 약 50%, 발 약 15%(GUEST_FRAME)여야 한다.

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = join(dirname(fileURLToPath(import.meta.url)), 'art-kit');
const targets = process.argv.slice(2).map((p) => join(process.cwd(), p));
const out = execFileSync(process.execPath, [join(KIT, 'tools', 'inspect.ts'), '--json', ...targets], { encoding: 'utf8', maxBuffer: 64 << 20 });
const rows = JSON.parse(out);
const list = Array.isArray(rows) ? rows : Object.values(rows);
for (const r of list) {
  const f = String(r.file);
  if (/\.(try|rejected)\d*\.png$/.test(f)) continue;
  const b = r.bbox ?? { w: 0, h: 0 };
  const m = r.margins ?? { bottom: 0 };
  const pct = (v, t) => `${Math.round((v / t) * 100)}%`.padStart(4);
  console.log(
    `${f.padEnd(26)} ${`${r.w}x${r.h}`.padEnd(10)} 그림 ${pct(b.w, r.w)}×${pct(b.h, r.h)}  발 ${pct(m.bottom, r.h)}  선 ${String(r.outline?.at1024 ?? '-').padStart(5)}  ${(r.warnings ?? []).join('; ')}`,
  );
}
