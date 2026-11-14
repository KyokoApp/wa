// Syntax-check all browser modules without executing them (parse only).
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const jsDir = join(here, '..', 'web', 'js');

let fail = 0;
for (const f of (await readdir(jsDir)).filter((f) => f.endsWith('.js'))) {
  const src = await readFile(join(jsDir, f), 'utf8');
  try {
    new vm.SourceTextModule(src, { identifier: f });
    console.log(`  ok   ${f}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${f}: ${e.message}`);
  }
}
process.exit(fail ? 1 : 0);
