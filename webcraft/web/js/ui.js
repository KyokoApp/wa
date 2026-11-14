// UI: screens, HUD, hotbar, inventory, settings, debug panel, toasts.

import { BLOCK_NAMES, BLOCK_TILES, PALETTE, BIOME_NAMES } from './blocks.js';
import { blockIconURL } from './textures.js';

const SETTINGS_KEY = 'webcraft_settings';
const SAVE_KEY = 'webcraft_save';

export const DEFAULT_SETTINGS = {
  renderDistance: 6,
  fov: 78,
  sensitivity: 2.2,
  shaders: 1, // 0 off, 1 medium, 2 high
  smooth: true,
  dayLength: 480,
  showDebug: false,
};

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function loadSaveBytes() {
  const b64 = localStorage.getItem(SAVE_KEY);
  if (!b64) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function storeSaveBytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  localStorage.setItem(SAVE_KEY, btoa(bin));
}

export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
}

export class UI {
  constructor(settings) {
    this.settings = settings;
    this.el = {};
    for (const id of [
      'screen-title', 'screen-settings', 'screen-controls', 'screen-pause',
      'hud', 'crosshair', 'hotbar', 'debug', 'toast', 'inventory', 'inv-grid',
      'touch', 'btn-resume', 'btn-save', 'btn-settings-pause', 'btn-quit',
      'btn-play', 'btn-continue', 'btn-open-settings', 'btn-open-controls',
      'btn-settings-back', 'btn-controls-back', 'btn-close-inv', 'btn-new-world',
      'seed-input', 'loading', 'loading-text', 'coords', 'fps',
      'set-render', 'set-render-val', 'set-fov', 'set-fov-val', 'set-sens',
      'set-sens-val', 'set-shaders', 'set-smooth', 'set-day', 'set-day-val',
      'target-label',
    ]) {
      this.el[id] = document.getElementById(id);
    }
    this._bindSettings();
  }

  showScreen(name) {
    for (const key of ['screen-title', 'screen-settings', 'screen-controls', 'screen-pause', 'inventory']) {
      if (this.el[key]) this.el[key].style.display = 'none';
    }
    if (name && this.el[name]) this.el[name].style.display = 'flex';
  }

  setLoading(text) {
    if (this.el.loading) {
      this.el.loading.style.display = text ? 'flex' : 'none';
      if (text && this.el['loading-text']) this.el['loading-text'].textContent = text;
    }
  }

  setHud(on) {
    if (this.el.hud) this.el.hud.style.display = on ? 'block' : 'none';
    const t = document.getElementById('touch');
    if (t) t.style.display = on && this.isTouchDevice() ? 'block' : 'none';
  }

  isTouchDevice() {
    return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  }

  toast(msg, ms = 2200) {
    if (!this.el.toast) return;
    this.el.toast.textContent = msg;
    this.el.toast.style.opacity = '1';
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { this.el.toast.style.opacity = '0'; }, ms);
  }

  // ---------- hotbar / inventory ----------
  updateHotbar(slots, current) {
    const bar = this.el.hotbar;
    if (!bar) return;
    bar.innerHTML = '';
    slots.forEach((blockId, i) => {
      const cell = document.createElement('div');
      cell.className = 'slot' + (i === current ? ' active' : '');
      const img = document.createElement('img');
      img.src = blockIconURL(blockId, BLOCK_TILES[blockId] || BLOCK_TILES[1]);
      img.alt = BLOCK_NAMES[blockId] || '?';
      img.draggable = false;
      cell.appendChild(img);
      const num = document.createElement('span');
      num.textContent = i + 1;
      cell.appendChild(num);
      cell.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (this.onHotbarPick) this.onHotbarPick(i);
      });
      bar.appendChild(cell);
    });
  }

  openInventory(onPick) {
    const grid = this.el['inv-grid'];
    if (!grid) return;
    grid.innerHTML = '';
    for (const id of PALETTE) {
      const cell = document.createElement('div');
      cell.className = 'slot inv';
      const img = document.createElement('img');
      img.src = blockIconURL(id, BLOCK_TILES[id] || BLOCK_TILES[1]);
      img.draggable = false;
      cell.appendChild(img);
      const label = document.createElement('span');
      label.textContent = BLOCK_NAMES[id] || '?';
      cell.appendChild(label);
      cell.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        onPick(id);
      });
      grid.appendChild(cell);
    }
    this.showScreen('inventory');
  }

  // ---------- debug ----------
  updateDebug(state, fps, stats, engineInfo) {
    if (!this.el.debug) return;
    if (!this.settings.showDebug) {
      this.el.debug.style.display = 'none';
      return;
    }
    this.el.debug.style.display = 'block';
    const b = state.target ? `hit (${state.target.x}, ${state.target.y}, ${state.target.z}) face ${state.target.face}` : 'none';
    this.el.debug.innerHTML = [
      `<b>RustCraft Web</b> — Rust/WASM + WebGL2`,
      `FPS: ${fps.toFixed(0)}  |  tris: ${(engineInfo.tris / 1000).toFixed(0)}k  |  draw: ${engineInfo.draws}`,
      `XYZ: ${state.x.toFixed(2)} / ${state.y.toFixed(2)} / ${state.z.toFixed(2)}`,
      `Biome: ${BIOME_NAMES[state.biome] || '?'}  |  waktu: ${engineInfo.timeOfDay.toFixed(2)}`,
      `Chunks: ${stats.cols} kolom / ${stats.sections} section | edit: ${stats.edits}`,
      `Target: ${b}`,
      `WASM mem: ${(engineInfo.wasmMB).toFixed(1)} MB`,
    ].join('<br>');
    if (this.el.coords) {
      this.el.coords.textContent = `${state.x.toFixed(0)}, ${state.y.toFixed(0)}, ${state.z.toFixed(0)}`;
    }
  }

  updateTargetLabel(state) {
    const el = this.el['target-label'];
    if (!el) return;
    if (state.target && state.target.block) {
      el.textContent = BLOCK_NAMES[state.target.block] || '';
      el.style.opacity = '1';
    } else {
      el.style.opacity = '0';
    }
  }

  // ---------- settings ----------
  _bindSettings() {
    const s = this.settings;
    const bind = (id, valId, key, fmt, scale = 1) => {
      const input = this.el[id];
      if (!input) return;
      if (input.type === 'checkbox') input.checked = !!s[key];
      else input.value = s[key] * scale;
      const show = () => {
        if (this.el[valId]) this.el[valId].textContent = fmt(s[key]);
      };
      show();
      input.addEventListener('input', () => {
        if (input.type === 'checkbox') s[key] = input.checked;
        else s[key] = parseFloat(input.value) / scale;
        show();
        saveSettings(s);
        if (this.onSettingsChange) this.onSettingsChange(key);
      });
    };
    bind('set-render', 'set-render-val', 'renderDistance', (v) => `${v} chunk`);
    bind('set-fov', 'set-fov-val', 'fov', (v) => `${v}°`);
    bind('set-sens', 'set-sens-val', 'sensitivity', (v) => v.toFixed(1), 10);
    bind('set-day', 'set-day-val', 'dayLength', (v) => `${v}s`);
    const sh = this.el['set-shaders'];
    if (sh) {
      sh.value = String(s.shaders);
      sh.addEventListener('change', () => {
        s.shaders = parseInt(sh.value, 10);
        saveSettings(s);
        if (this.onSettingsChange) this.onSettingsChange('shaders');
      });
    }
    bind('set-smooth', null, 'smooth', () => '');
  }
}
