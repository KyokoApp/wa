// RustCraft Web — bootstrap & main loop. Engine: Rust/WASM, renderer: WebGL2.

import { RustEngine } from './engine.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import {
  UI, loadSettings, saveSettings, loadSaveBytes, storeSaveBytes, clearSave,
} from './ui.js';
import { DEFAULT_HOTBAR } from './blocks.js';
import { clamp, smoothstep, mix3 } from './math.js';

const canvas = document.getElementById('game');
const settings = loadSettings();
const ui = new UI(settings);

let engine = null;
let renderer = null;
let input = null;
let running = false;
let paused = false;
let slots = [...DEFAULT_HOTBAR];
let timeOfDay = 0.32; // pagi
let gameTime = 0;
let lastT = performance.now();
let fpsEMA = 60;
let pendingChunks = 1;
let worldSeed = 1;
let frames = 0;
let saveTimer = 0;
let firstStreamDone = false;

function hashSeed(str) {
  str = String(str).trim();
  if (/^\d+$/.test(str)) return parseInt(str, 10) >>> 0;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function sunState() {
  const ang = (timeOfDay - 0.25) * Math.PI * 2;
  const elev = Math.sin(ang);
  const raw = [Math.cos(ang) * 0.88, elev, 0.34];
  const len = Math.hypot(raw[0], raw[1], raw[2]);
  const sunDir = [raw[0] / len, raw[1] / len, raw[2] / len];
  const daylight = smoothstep(-0.12, 0.24, elev);
  const sunset = 1 - smoothstep(0.02, 0.34, Math.abs(elev));

  const day = {
    top: [0.20, 0.46, 0.90], horizon: [0.66, 0.80, 0.97],
    sun: [1.0, 0.97, 0.88], cloud: [1.0, 1.0, 1.0],
  };
  const dusk = {
    top: [0.17, 0.22, 0.50], horizon: [0.99, 0.55, 0.30],
    sun: [1.0, 0.52, 0.28], cloud: [1.0, 0.72, 0.55],
  };
  const night = {
    top: [0.012, 0.02, 0.07], horizon: [0.045, 0.065, 0.15],
    sun: [0.20, 0.25, 0.40], cloud: [0.22, 0.25, 0.38],
  };

  const blend = (a, b) => mix3(a, b, daylight);
  const skyTop = mix3(blend(night.top, day.top), dusk.top, sunset * 0.72);
  const skyHorizon = mix3(blend(night.horizon, day.horizon), dusk.horizon, sunset * 0.85);
  const sunColor = mix3(blend(night.sun, day.sun), dusk.sun, sunset * 0.8);
  const cloudColor = mix3(blend(night.cloud, day.cloud), dusk.cloud, sunset * 0.7);
  const fogColor = mix3(skyHorizon, skyTop, 0.18);
  return { sunDir, daylight, skyTop, skyHorizon, sunColor, cloudColor, fogColor };
}

function applySettings() {
  if (!engine || !renderer) return;
  engine.setViewDistance(settings.renderDistance);
  renderer.quality = settings.shaders;
  if (input) input.sensitivity = settings.sensitivity / 1000;
}

function doSave() {
  if (!engine || !input) return;
  const bytes = engine.save();
  if (!bytes) return;
  storeSaveBytes(bytes);
  localStorage.setItem('webcraft_meta', JSON.stringify({
    seed: worldSeed, timeOfDay, yaw: input.yaw, pitch: input.pitch, slots,
  }));
}

function startGame(seed, restore) {
  worldSeed = seed >>> 0;
  try {
    if (!renderer) renderer = new Renderer(canvas, settings.shaders);
    else { renderer.quality = settings.shaders; renderer.invalidateAll(); }
  } catch (e) {
    ui.toast('Gagal init WebGL2: ' + e.message, 5000);
    return;
  }
  if (!input) {
    input = new Input(canvas, {
      onPause: () => pauseGame(),
      onSlot: (i) => ui.updateHotbar(slots, i),
      onInventory: () => toggleInventory(),
      onDebug: () => { settings.showDebug = !settings.showDebug; saveSettings(settings); },
    });
    input.sensitivity = settings.sensitivity / 1000;
    ui.onHotbarPick = (i) => { input.setSlot(i); ui.updateHotbar(slots, i); };
    ui.onSettingsChange = () => applySettings();
  }
  input.enabled = true;
  input.yaw = 0.6;
  input.pitch = -0.12;

  engine.newGame(worldSeed, settings.renderDistance, settings.smooth);

  if (restore) {
    const bytes = loadSaveBytes();
    if (bytes && engine.load(bytes) === 1) {
      try {
        const meta = JSON.parse(localStorage.getItem('webcraft_meta') || '{}');
        if (meta.timeOfDay !== undefined) timeOfDay = meta.timeOfDay;
        if (meta.yaw !== undefined) { input.yaw = meta.yaw; input.pitch = meta.pitch || 0; }
        if (Array.isArray(meta.slots)) slots = meta.slots;
      } catch { /* ignore */ }
      ui.toast('Dunia dimuat dari save');
    }
  } else {
    timeOfDay = 0.32;
    slots = [...DEFAULT_HOTBAR];
    clearSave();
  }
  for (let i = 0; i < 9; i++) engine.setSlot(i, slots[i]);

  ui.showScreen(null);
  ui.setHud(true);
  ui.updateHotbar(slots, input.slot);
  running = true;
  paused = false;
  firstStreamDone = false;
  lastT = performance.now();
  requestAnimationFrame(frame);
}

function pauseGame() {
  if (!running || paused) return;
  paused = true;
  doSave();
  ui.showScreen('screen-pause');
  if (document.pointerLockElement) document.exitPointerLock();
}

function resumeGame() {
  paused = false;
  ui.showScreen(null);
  lastT = performance.now();
  if (!input.isTouch) canvas.requestPointerLock();
}

function quitToTitle() {
  doSave();
  running = false;
  paused = false;
  if (input) input.enabled = false;
  ui.setHud(false);
  ui.showScreen('screen-title');
  if (document.pointerLockElement) document.exitPointerLock();
  refreshContinueBtn();
}

function toggleInventory() {
  const inv = document.getElementById('inventory');
  if (inv.style.display === 'flex') {
    ui.showScreen(null);
    if (!input.isTouch) canvas.requestPointerLock();
  } else {
    if (document.pointerLockElement) {
      input.suppressPause = true;
      document.exitPointerLock();
    }
    ui.openInventory((blockId) => {
      slots[input.slot] = blockId;
      engine.setSlot(input.slot, blockId);
      ui.updateHotbar(slots, input.slot);
      ui.showScreen(null);
      if (!input.isTouch) canvas.requestPointerLock();
    });
  }
}

// ---------------- main loop ----------------
function frame(now) {
  if (!running) return;
  const dt = clamp((now - lastT) / 1000, 0, 0.1);
  lastT = now;
  fpsEMA = fpsEMA * 0.92 + (1 / Math.max(dt, 0.001)) * 0.08;
  frames++;

  if (!paused) {
    gameTime += dt;
    timeOfDay = (timeOfDay + dt / Math.max(60, settings.dayLength)) % 1;
    const inp = input.poll(dt);
    engine.tick(inp);
    pendingChunks = engine.updateChunks(settings.shaders > 0 ? 10 : 16);
    saveTimer += dt;
    if (saveTimer > 30) { saveTimer = 0; doSave(); }
  }

  // stream meshes to GPU
  for (const id of engine.drainUnloads()) renderer.remove(id);
  for (const id of engine.drainDirty()) {
    const m0 = engine.mesh(id, 0);
    const m1 = engine.mesh(id, 1);
    const ok0 = m0 && m0.idx.length > 0;
    const ok1 = m1 && m1.idx.length > 0;
    if (ok0 || ok1) {
      renderer.upload(id, ok0 ? m0 : null, ok1 ? m1 : null);
    }
  }

  const state = engine.getState();
  const sun = sunState();
  const fogFar = settings.renderDistance * 16 * 0.96;
  renderer.render({
    x: state.x, y: state.y + 1.62, z: state.z,
    yaw: input.yaw, pitch: input.pitch,
    fov: settings.fov,
    time: gameTime,
    target: state.target,
    underwater: state.headWater,
    fogNear: fogFar * 0.52,
    fogFar,
    ...sun,
  });

  // HUD
  if (frames % 6 === 0) {
    const stats = engine.stats();
    if (settings.showDebug) {
      ui.updateDebug(state, fpsEMA, stats, {
        tris: renderer.tris, draws: renderer.chunks.size * 2,
        timeOfDay,
        wasmMB: engine.ex.memory.buffer.byteLength / (1024 * 1024),
      });
    }
    ui.updateTargetLabel(state);
    if (!firstStreamDone && pendingChunks === 0) {
      firstStreamDone = true;
      ui.setLoading(null);
    } else if (!firstStreamDone) {
      ui.setLoading(`Membuat dunia… (${pendingChunks} bagian tersisa)`);
    }
  }
  requestAnimationFrame(frame);
}

// ---------------- menus ----------------
function refreshContinueBtn() {
  const btn = document.getElementById('btn-continue');
  if (btn) btn.style.display = loadSaveBytes() ? 'block' : 'none';
}

function wireMenus() {
  const on = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };
  on('btn-play', () => {
    const seedText = document.getElementById('seed-input').value;
    startGame(hashSeed(seedText || Math.floor(Math.random() * 1e9)), false);
  });
  on('btn-new-world', () => {
    clearSave();
    const seedText = document.getElementById('seed-input').value;
    startGame(hashSeed(seedText || Math.floor(Math.random() * 1e9)), false);
  });
  on('btn-continue', () => {
    const meta = JSON.parse(localStorage.getItem('webcraft_meta') || '{}');
    startGame(meta.seed || 1, true);
  });
  on('btn-open-settings', () => ui.showScreen('screen-settings'));
  on('btn-open-controls', () => ui.showScreen('screen-controls'));
  on('btn-settings-back', () => {
    ui.showScreen(running ? 'screen-pause' : 'screen-title');
  });
  on('btn-controls-back', () => ui.showScreen('screen-title'));
  on('btn-resume', () => resumeGame());
  on('btn-save', () => { doSave(); ui.toast('Dunia tersimpan'); });
  on('btn-settings-pause', () => ui.showScreen('screen-settings'));
  on('btn-quit', () => quitToTitle());
  on('btn-close-inv', () => {
    ui.showScreen(null);
    if (!input.isTouch) canvas.requestPointerLock();
  });
}

// ---------------- boot ----------------
(async function boot() {
  wireMenus();
  refreshContinueBtn();
  ui.setLoading('Memuat engine Rust (WebAssembly)…');
  try {
    engine = await RustEngine.load('rustcraft.wasm');
  } catch (e) {
    ui.setLoading('Gagal memuat engine: ' + e.message);
    return;
  }
  ui.setLoading(null);
  ui.showScreen('screen-title');

  // resize-safe
  window.addEventListener('resize', () => { if (renderer) renderer.resize(); });

  // WebGL context loss -> rebuild meshes
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    running = false;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    renderer = new Renderer(canvas, settings.shaders);
    engine.invalidate();
    running = true;
    lastT = performance.now();
    requestAnimationFrame(frame);
  });
})();
