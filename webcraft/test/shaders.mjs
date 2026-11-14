// Validate every GLSL shader with Khronos glslangValidator.
import * as S from '../web/js/shaders.js';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.GLSLANG,
  '/tmp/glsltest/node_modules/glslang-validator-prebuilt-predownloaded/bin/glslangValidator.linux',
  'node_modules/glslang-validator-prebuilt-predownloaded/bin/glslangValidator.linux',
].filter(Boolean);
const VALIDATOR = CANDIDATES.find((p) => existsSync(p));
if (!VALIDATOR) {
  console.log('glslangValidator tidak ditemukan — skip (set env GLSLANG)');
  process.exit(0);
}
chmodSync(VALIDATOR, 0o755);

const stages = [
  ['sky.vert', S.SKY_VS], ['sky.frag', S.SKY_FS],
  ['chunk.vert', S.CHUNK_VS], ['chunk.frag', S.CHUNK_FS],
  ['line.vert', S.LINE_VS], ['line.frag', S.LINE_FS],
  ['post.vert', S.POST_VS], ['bright.frag', S.BRIGHT_FS],
  ['blur.frag', S.BLUR_FS], ['comp.frag', S.COMPOSITE_FS],
];

const dir = mkdtempSync(join(tmpdir(), 'glsl-'));
let fail = 0;
for (const [name, src] of stages) {
  const file = join(dir, name);
  writeFileSync(file, src);
  try {
    execFileSync(VALIDATOR, [file], { stdio: 'pipe' });
    console.log(`  ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}\n${(e.stdout || e.stderr || '').toString()}`);
  }
}
console.log(fail ? `${fail} shader gagal` : 'semua shader valid');
process.exit(fail ? 1 : 0);
