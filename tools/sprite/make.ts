// 한 번에: 정지 그림 → (prepare) 마젠타 입력 → (seedance) 영상 → (extract) 시트. 클립마다 차례로 (API 동시 호출 없음).
//   node tools/sprite/make.ts <species> [클립,클립… | all] [옵션]
//   예) node tools/sprite/make.ts dragon idle,joy --dry      요청만 찍는다 (네트워크 없음, 키 없어도 된다)
//       node tools/sprite/make.ts dragon all                 7개 클립 모두
//       node tools/sprite/make.ts chief idle,walk            주민 (tools/art-raw/characters/chief.png)
//
// 클립의 첫 프레임 그림: tools/art-raw/monsters/<species>_<pose>.png (프리셋의 pose), 없으면 <species>_base.png.
//   주민은 tools/art-raw/characters/<species>.png 하나.
// 이미 있는 것은 다시 만들지 않는다: 마젠타 입력(원본보다 새것이면), 영상(.mp4가 있으면). --force면 모두 다시.
// 영상 만들기가 실패하면 그 클립만 건너뛰고 끝에 알린다.
//
// 옵션:
//   --dry              Seedance 요청만 찍는다 (prepare는 한다: 찍을 본문에 그림이 들어가므로)
//   --force            있는 것도 다시
//   --skip-video       영상을 만들지 않고 있는 영상만 시트로
//   --resolution R     Seedance 해상도 (기본 720p)
//   --cell-h N --fps N --out-root DIR --anim-raw DIR    (extract.ts, 폴더)
//   --poll N --timeout N   (seedance.ts)

import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ANIM_OUT, ANIM_RAW, ART_RAW, fail, parseArgs, rel } from './common.ts';
import { extract } from './extract.ts';
import { prepare } from './prepare.ts';
import { CLIPS, clipPreset } from './presets.ts';
import { generateClip } from './seedance.ts';

function newer(a: string, b: string): boolean {
  return existsSync(a) && existsSync(b) && statSync(a).mtimeMs >= statSync(b).mtimeMs;
}

/** 클립의 첫 프레임 원본. */
export function stillFor(species: string, pose: string): { path: string; key: string } | null {
  const mon = (p: string): string => join(ART_RAW, 'monsters', `${species}_${p}.png`);
  if (existsSync(mon(pose))) return { path: mon(pose), key: `${species}_${pose}` };
  if (existsSync(mon('base'))) return { path: mon('base'), key: `${species}_base` };
  const ch = join(ART_RAW, 'characters', `${species}.png`);
  if (existsSync(ch)) return { path: ch, key: species };
  return null;
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2), {
    valued: ['resolution', 'cell-h', 'fps', 'out-root', 'anim-raw', 'poll', 'timeout'],
    switches: ['dry', 'force', 'skip-video'],
  });
  const species = args.positional[0];
  if (species === undefined) {
    console.log('node tools/sprite/make.ts <species> [idle,walk,joy,agony,sad,cry_lie,clap | all] [--dry] [--force] [--skip-video]');
    process.exit(1);
  }
  const list = args.positional[1] === undefined || args.positional[1] === 'all' ? Object.keys(CLIPS) : (args.positional[1] ?? '').split(',').filter((s) => s !== '');
  for (const c of list) if (clipPreset(c) === undefined) fail(`모르는 클립: ${c} (아는 것: ${Object.keys(CLIPS).join(', ')})`);
  const dry = args.has('dry');
  const force = args.has('force');
  const rawDir = resolve(args.get('anim-raw') ?? ANIM_RAW);
  const outRoot = resolve(args.get('out-root') ?? ANIM_OUT);
  const done: string[] = [];
  const failed: string[] = [];

  for (const clip of list) {
    const preset = clipPreset(clip);
    if (preset === undefined) continue;
    console.log(`\n── ${species}/${clip}: ${preset.ko}`);
    const still = stillFor(species, preset.pose);
    if (still === null) {
      failed.push(`${clip} (정지 그림 없음)`);
      console.warn(`  정지 그림이 없다: tools/art-raw/monsters/${species}_base.png 또는 characters/${species}.png`);
      continue;
    }
    if (!still.key.endsWith(`_${preset.pose}`) && still.key.startsWith(`${species}_`)) console.log(`  ${species}_${preset.pose}.png가 없어 ${still.key}.png로 시작한다`);
    try {
      const prepPng = join(rawDir, 'prep', `${still.key}.png`);
      const prepJson = join(rawDir, 'prep', `${still.key}.json`);
      if (force || !newer(prepPng, still.path) || !existsSync(prepJson)) await prepare({ input: still.path, out: prepPng, resolution: args.get('resolution') });
      else console.log(`  마젠타 입력 있음: ${rel(prepPng)}`);

      const video = join(rawDir, species, `${clip}.mp4`);
      if (args.has('skip-video')) {
        if (!existsSync(video)) {
          failed.push(`${clip} (영상 없음)`);
          console.warn(`  영상이 없다: ${rel(video)}`);
          continue;
        }
      } else if (dry || force || !existsSync(video)) {
        const r = await generateClip({
          image: prepPng,
          clip,
          species,
          out: video,
          dry,
          resolution: args.get('resolution'),
          pollSec: args.get('poll') === undefined ? undefined : args.num('poll', 10),
          timeoutSec: args.get('timeout') === undefined ? undefined : args.num('timeout', 1800),
        });
        if (r.dry) {
          done.push(`${clip} (dry)`);
          continue;
        }
      } else console.log(`  영상 있음: ${rel(video)}`);

      await extract({
        video,
        species,
        clip,
        prep: prepJson,
        outRoot,
        fps: args.get('fps') === undefined ? undefined : args.num('fps', 12),
        cellH: args.get('cell-h') === undefined ? undefined : args.num('cell-h', 320),
      });
      done.push(clip);
    } catch (e) {
      failed.push(`${clip} (${(e as Error).message.split('\n')[0] ?? ''})`);
      console.error(`  실패: ${(e as Error).message}`);
    }
  }
  console.log(`\n끝: ${done.length === 0 ? '없음' : done.join(', ')}${failed.length === 0 ? '' : ` / 실패·건너뜀: ${failed.join(', ')}`}`);
  process.exit(failed.length === 0 ? 0 : 1);
}
