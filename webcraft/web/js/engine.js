// Thin JS wrapper over the Rust engine's C ABI (see engine/src/lib.rs).

const INPUT_BYTES = 32;

export class RustEngine {
  static async load(url = 'rustcraft.wasm') {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status}`);
    const bytes = await res.arrayBuffer();
    const mod = await WebAssembly.compile(bytes);
    const inst = await WebAssembly.instantiate(mod, {
      env: { host_now: () => performance.now() / 1000 },
    });
    return new RustEngine(inst);
  }

  constructor(instance) {
    this.ex = instance.exports;
    this.game = 0;
    this.inputPtr = this.ex.alloc(INPUT_BYTES);
    this.statePtr = this.ex.alloc(80);
    this.hdrPtr = this.ex.alloc(32);
    this.dirtyPtr = this.ex.alloc(8192 * 4);
    this.unloadPtr = this.ex.alloc(8192 * 4);
    this.statsPtr = this.ex.alloc(64);
    this.saveCap = 8 * 1024 * 1024;
    this.savePtr = this.ex.alloc(this.saveCap);
  }

  // ---- raw views (re-read buffer each time: wasm memory can grow) ----
  _u32(p, i) { return new Uint32Array(this.ex.memory.buffer, p + i * 4, 1)[0]; }
  _i32(p, i) { return new Int32Array(this.ex.memory.buffer, p + i * 4, 1)[0]; }
  _f32(p, i) { return new Float32Array(this.ex.memory.buffer, p + i * 4, 1)[0]; }
  _wu32(p, i, v) { new Uint32Array(this.ex.memory.buffer, p + i * 4, 1)[0] = v; }
  _wf32(p, i, v) { new Float32Array(this.ex.memory.buffer, p + i * 4, 1)[0] = v; }

  newGame(seed, viewDistance, smoothLighting) {
    if (this.game) this.ex.game_free(this.game);
    this.game = this.ex.game_new(seed >>> 0, viewDistance, smoothLighting ? 1 : 0);
    return this.game;
  }

  setViewDistance(v) { this.ex.game_set_view(this.game, v); }
  setSmoothLighting(on) { this.ex.game_set_smooth(this.game, on ? 1 : 0); }
  setSlot(slot, blockId) { this.ex.game_set_slot(this.game, slot, blockId); }

  /** input: {mx, mz, yaw, pitch, dt, flags, slot} */
  tick(input) {
    const p = this.inputPtr;
    this._wf32(p, 0, input.mx);
    this._wf32(p, 1, input.mz);
    this._wf32(p, 2, input.yaw);
    this._wf32(p, 3, input.pitch);
    this._wf32(p, 4, input.dt);
    this._wu32(p, 5, input.flags | 0);
    this._wu32(p, 6, input.slot | 0);
    this._wu32(p, 7, 0);
    this.ex.game_tick(this.game, p);
  }

  getState() {
    const p = this.statePtr;
    this.ex.game_state(this.game, p);
    const flags = this._u32(p, 6);
    return {
      x: this._f32(p, 0), y: this._f32(p, 1), z: this._f32(p, 2),
      vx: this._f32(p, 3), vy: this._f32(p, 4), vz: this._f32(p, 5),
      onGround: !!(flags & 1), inWater: !!(flags & 2),
      headWater: !!(flags & 4), flying: !!(flags & 8),
      target: this._u32(p, 10) !== 255 ? {
        x: this._i32(p, 7), y: this._i32(p, 8), z: this._i32(p, 9),
        face: this._u32(p, 10), block: this._u32(p, 11),
      } : null,
      biome: this._u32(p, 12),
      edits: this._u32(p, 13),
      cols: this._u32(p, 14),
      sections: this._u32(p, 15),
    };
  }

  updateChunks(budgetMs) {
    return this.ex.game_update_chunks(this.game, budgetMs);
  }

  drainDirty() {
    const n = this.ex.game_dirty(this.game, this.dirtyPtr, 8192);
    const out = new Uint32Array(this.ex.memory.buffer, this.dirtyPtr, n).slice();
    return out;
  }

  drainUnloads() {
    const n = this.ex.game_unloads(this.game, this.unloadPtr, 8192);
    const out = new Uint32Array(this.ex.memory.buffer, this.unloadPtr, n).slice();
    return out;
  }

  /** returns {cx, cy, cz, verts: Uint8Array, idx: Uint32Array, pass} or null */
  mesh(id, pass) {
    const ic = this.ex.game_mesh(this.game, id, pass, this.hdrPtr);
    const p = this.hdrPtr;
    const vcount = this._u32(p, 3);
    if (ic === 0 && vcount === 0) return null;
    const vptr = this._u32(p, 5);
    const iptr = this._u32(p, 6);
    const verts = new Uint8Array(this.ex.memory.buffer, vptr, vcount * 24).slice();
    const idx = new Uint32Array(this.ex.memory.buffer, iptr, ic).slice();
    return {
      cx: this._u32(p, 0), cy: this._u32(p, 1), cz: this._u32(p, 2),
      verts, idx, pass,
    };
  }

  invalidate() { this.ex.game_invalidate(this.game); }

  save() {
    const size = this.ex.game_save_size(this.game);
    if (size > this.saveCap) return null;
    const n = this.ex.game_save(this.game, this.savePtr);
    return new Uint8Array(this.ex.memory.buffer, this.savePtr, n).slice();
  }

  load(bytes) {
    const ptr = this.ex.alloc(bytes.length);
    new Uint8Array(this.ex.memory.buffer, ptr, bytes.length).set(bytes);
    return this.ex.game_load(this.game, ptr, bytes.length);
  }

  stats() {
    this.ex.game_stats(this.game, this.statsPtr);
    return {
      cols: this._u32(this.statsPtr, 0),
      sections: this._u32(this.statsPtr, 1),
      dirty: this._u32(this.statsPtr, 2),
      unloads: this._u32(this.statsPtr, 3),
      edits: this._u32(this.statsPtr, 4),
    };
  }
}
