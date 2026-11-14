// Integration test: the exact JS wrapper the browser uses (web/js/engine.js)
// driven against the real wasm module, headless in Node.
import { readFile } from 'node:fs/promises';
import { RustEngine } from '../web/js/engine.js';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name} ${extra}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const bytes = await readFile(new URL('../web/rustcraft.wasm', import.meta.url));
const mod = await WebAssembly.compile(bytes);
const inst = await WebAssembly.instantiate(mod, {
  env: { host_now: () => performance.now() / 1000 },
});
const engine = new RustEngine(inst);

// world build
engine.newGame(0xC0FFEE, 2, true);
let pending = 1, loops = 0;
while (pending > 0 && loops < 300) {
  pending = engine.updateChunks(30);
  loops++;
}
check('streamed', pending === 0, `(loops=${loops})`);

const dirty = engine.drainDirty();
check('drainDirty non-empty', dirty.length > 0, `(${dirty.length})`);

const m = engine.mesh(dirty[0], 0);
check('mesh() returns buffers', !!m && m.verts instanceof Uint8Array && m.idx instanceof Uint32Array,
  m ? `(v=${m.verts.length}B i=${m.idx.length})` : '(null)');
check('mesh is independent copy', m && m.verts.buffer !== engine.ex.memory.buffer);

// tick & state
engine.tick({ mx: 1, mz: 0.5, yaw: 0.7, pitch: -0.2, dt: 1 / 60, flags: 4, slot: 3 });
const st = engine.getState();
check('state has position', Number.isFinite(st.x) && Number.isFinite(st.y) && Number.isFinite(st.z));
check('state has biome field', typeof st.biome === 'number');

// slot placement path
engine.setSlot(3, 21);
engine.tick({ mx: 0, mz: 0, yaw: 0.7, pitch: -1.4, dt: 1 / 60, flags: 32 | 64, slot: 3 });
const st2 = engine.getState();
check('edits tracked via wrapper', typeof st2.edits === 'number');

// save round-trip through wrapper
const save = engine.save();
check('save() bytes', save && save.length > 44, `(${save && save.length})`);
check('save magic', save && save[0] === 0x52 && save[1] === 0x43 && save[2] === 0x57 && save[3] === 0x53);
engine.newGame(1, 2, true);
check('load() ok', engine.load(save) === 1);
const st3 = engine.getState();
check('position restored via wrapper', Math.abs(st3.x - st2.x) < 0.01 && Math.abs(st3.y - st2.y) < 0.01,
  `(${st3.x.toFixed(2)}, ${st3.y.toFixed(2)})`);

const stats = engine.stats();
check('stats readable', typeof stats.cols === 'number' && typeof stats.sections === 'number');
engine.updateChunks(40);
const stats2 = engine.stats();
check('world re-streams after load', stats2.cols > 0 && stats2.sections > 0,
  `(${stats2.cols} cols, ${stats2.sections} sections)`);

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
