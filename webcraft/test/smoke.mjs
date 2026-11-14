// RustCraft engine smoke test — runs the wasm module headless in Node.
// Validates: instantiation, worldgen, meshing, physics landing, raycast,
// break/place edits and save/load round-trip.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', 'web', 'rustcraft.wasm');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name} ${extra}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const bytes = await readFile(wasmPath);
const mod = await WebAssembly.compile(bytes);
const imports = WebAssembly.Module.imports(mod);
console.log('imports:', JSON.stringify(imports.map(i => `${i.module}.${i.name}`)));

let t0 = performance.now();
const instance = await WebAssembly.instantiate(mod, {
  env: { host_now: () => performance.now() / 1000 },
});
const ex = instance.exports;

function alloc(n) { return ex.alloc(n); }
function u32(p, i) { return new Uint32Array(ex.memory.buffer, p + i * 4, 1)[0]; }
function i32(p, i) { return new Int32Array(ex.memory.buffer, p + i * 4, 1)[0]; }
function f32(p, i) { return new Float32Array(ex.memory.buffer, p + i * 4, 1)[0]; }
function wu32(p, i, v) { new Uint32Array(ex.memory.buffer, p + i * 4, 1)[0] = v; }
function wf32(p, i, v) { new Float32Array(ex.memory.buffer, p + i * 4, 1)[0] = v; }

const inputP = alloc(32);
const stateP = alloc(80);
const hdrP = alloc(32);
const dirtyP = alloc(4096 * 4);
const unloadP = alloc(4096 * 4);
const statsP = alloc(64);
const saveP = alloc(4 * 1024 * 1024);

// ---------- 1. create game & stream world ----------
console.log('\n[1] worldgen + meshing');
const g = ex.game_new(1234, 3, 1);
check('game_new returns handle', g > 0);

let pending = 1, loops = 0;
while (pending > 0 && loops < 400) {
  pending = ex.game_update_chunks(g, 25);
  loops++;
}
check('world streamed to completion', pending === 0, `(loops=${loops})`);
ex.game_stats(g, statsP);
const cols = u32(statsP, 0), secs = u32(statsP, 1);
check('columns generated', cols >= 49, `(${cols})`);
check('sections meshed', secs >= 294, `(${secs})`);

const nDirty = ex.game_dirty(g, dirtyP, 4096);
check('dirty meshes queued', nDirty >= 294, `(${nDirty})`);

// ---------- 2. mesh data sanity ----------
console.log('\n[2] mesh buffers');
let totalTris = 0, okVerts = true, sawWater = false;
for (let i = 0; i < Math.min(nDirty, 200); i++) {
  const id = u32(dirtyP, i);
  for (const pass of [0, 1]) {
    const ic = ex.game_mesh(g, id, pass, hdrP);
    const vc = u32(hdrP, 3);
    if (ic > 0) {
      totalTris += ic / 3;
      const vptr = u32(hdrP, 5), iptr = u32(hdrP, 6);
      const v = new Float32Array(ex.memory.buffer, vptr, vc * 6);
      for (let k = 0; k < v.length; k++) {
        if (!Number.isFinite(v[k])) { okVerts = false; break; }
      }
      const idx = new Uint32Array(ex.memory.buffer, iptr, ic);
      for (let k = 0; k < ic; k++) if (idx[k] >= vc) { okVerts = false; break; }
      if (pass === 1) sawWater = true;
    }
  }
}
check('vertex data finite', okVerts);
check('has triangles', totalTris > 1000, `(${totalTris} tris sampled)`);
check('water mesh exists', sawWater);

// ---------- 3. physics: player falls and lands ----------
console.log('\n[3] physics');
ex.game_state(g, stateP);
const y0 = f32(stateP, 1);
for (let i = 0; i < 400; i++) {
  wf32(inputP, 0, 0); wf32(inputP, 1, 0);
  wf32(inputP, 2, 0); wf32(inputP, 3, 0);
  wf32(inputP, 4, 1 / 60);
  wu32(inputP, 5, 0);
  wu32(inputP, 6, 0);
  ex.game_tick(g, inputP);
}
ex.game_state(g, stateP);
const y1 = f32(stateP, 1);
const flags = u32(stateP, 6);
check('player landed on ground', (flags & 1) === 1, `(y=${y1.toFixed(2)})`);
check('player fell', y1 < y0, `(y0=${y0.toFixed(2)} -> y1=${y1.toFixed(2)})`);

// ---------- 4. raycast down hits a block ----------
console.log('\n[4] raycast + edits');
wf32(inputP, 2, 0); wf32(inputP, 3, -1.45); // look down
wf32(inputP, 4, 1 / 60); wu32(inputP, 5, 0);
ex.game_tick(g, inputP);
ex.game_state(g, stateP);
const face = u32(stateP, 10), tx = i32(stateP, 7), ty = i32(stateP, 8), tz = i32(stateP, 9);
check('raycast hits block below', face !== 255, `(hit ${tx},${ty},${tz} face=${face})`);
check('hit is under player', ty <= y1, `(ty=${ty})`);

// break it
wu32(inputP, 5, 1 << 5); // F_BREAK_PRESS
ex.game_tick(g, inputP);
ex.game_stats(g, statsP);
check('break recorded an edit', u32(statsP, 4) >= 1, `(edits=${u32(statsP, 4)})`);

// look down-forward at nearby ground and place (not inside our own AABB)
wf32(inputP, 3, -0.7);
wu32(inputP, 5, 0); ex.game_tick(g, inputP);
wu32(inputP, 5, 1 << 6); // F_PLACE_PRESS
ex.game_tick(g, inputP);
ex.game_stats(g, statsP);
check('place recorded an edit', u32(statsP, 4) >= 2, `(edits=${u32(statsP, 4)})`);

// ---------- 5. save / load round trip ----------
console.log('\n[5] save/load');
ex.game_state(g, stateP);
const yPre = f32(stateP, 1);
ex.game_stats(g, statsP);
const editsPre = u32(statsP, 4);
const saveLen = ex.game_save(g, saveP);
check('save bytes written', saveLen > 44, `(${saveLen} bytes)`);
const g2 = ex.game_new(999, 3, 1);
const okLoad = ex.game_load(g2, saveP, saveLen);
check('load accepted', okLoad === 1);
ex.game_state(g2, stateP);
const y2 = f32(stateP, 1);
check('player pos restored', Math.abs(y2 - yPre) < 0.01, `(y=${y2.toFixed(2)})`);
ex.game_stats(g2, statsP);
check('edits restored', u32(statsP, 4) === editsPre, `(${u32(statsP, 4)} vs ${editsPre})`);

// ---------- 6. remesh after edit ----------
console.log('\n[6] dirty after edit');
let d2 = ex.game_dirty(g, dirtyP, 4096);
check('edited sections re-queued', d2 > 0, `(${d2})`);

const dt = ((performance.now() - t0) / 1000).toFixed(2);
console.log(`\n==== ${pass} passed, ${fail} failed  (${dt}s) ====`);
process.exit(fail ? 1 : 0);
