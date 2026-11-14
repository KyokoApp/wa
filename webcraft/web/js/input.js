// Input: keyboard + mouse (pointer lock) + touch (virtual joystick, tap/hold) — Bedrock-style.

export const F = {
  JUMP: 1, SNEAK: 2, SPRINT: 4, FLY_TOGGLE: 8,
  BREAK_HELD: 16, BREAK_PRESS: 32, PLACE_PRESS: 64, UP: 128, DOWN: 256,
};

export class Input {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.hooks = hooks; // { onPause, onSlot, onInventory, onDebug, onFlyToggle}
    this.yaw = 0;
    this.pitch = 0;
    this.sensitivity = 0.0022;
    this.keys = new Set();
    this.slot = 0;
    this.enabled = false;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    this.edge = { fly: false, breakPress: false, placePress: false };
    this.mouse = { left: false, right: false };
    this.touch = {
      moveX: 0, moveZ: 0,
      jump: false, sneak: false, up: false, down: false,
      breakHeld: false, joyPointer: null, lookPointer: null,
      lookStart: 0, lookMoved: 0, holdTimer: 0,
    };
    this.lastSpace = 0;

    this._bindKeyboard();
    this._bindMouse();
    if (this.isTouch) this._bindTouch();
  }

  // ---------------- keyboard ----------------
  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const code = e.code;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(code)) {
        e.preventDefault();
      }
      if (!e.repeat) {
        if (code === 'Space') {
          const now = performance.now();
          if (now - this.lastSpace < 280) {
            this.edge.fly = true;
            if (this.hooks.onFlyToggle) this.hooks.onFlyToggle();
          }
          this.lastSpace = now;
        }
        if (code === 'KeyF') {
          this.edge.fly = true;
          if (this.hooks.onFlyToggle) this.hooks.onFlyToggle();
        }
        if (code === 'KeyE' && this.hooks.onInventory) this.hooks.onInventory();
        if (code === 'F3' && this.hooks.onDebug) { e.preventDefault(); this.hooks.onDebug(); }
        if (code === 'Escape' && this.hooks.onPause) this.hooks.onPause();
        if (code.startsWith('Digit')) {
          const n = parseInt(code.slice(5), 10);
          if (n >= 1 && n <= 9) this.setSlot(n - 1);
        }
      }
      this.keys.add(code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      this.setSlot((this.slot + (e.deltaY > 0 ? 1 : 8)) % 9);
    }, { passive: true });
  }

  setSlot(i) {
    this.slot = i;
    if (this.hooks.onSlot) this.hooks.onSlot(i);
  }

  // ---------------- mouse ----------------
  _bindMouse() {
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.isTouch) return;
      if (document.pointerLockElement !== this.canvas) {
        this.canvas.requestPointerLock();
        return;
      }
      if (e.button === 0) { this.mouse.left = true; this.edge.breakPress = true; }
      if (e.button === 2) { this.mouse.right = true; this.edge.placePress = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== this.canvas) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      const lim = Math.PI / 2 - 0.01;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    });
    document.addEventListener('pointerlockchange', () => {
      if (!this.enabled) return;
      if (this.suppressPause) { this.suppressPause = false; return; }
      if (document.pointerLockElement !== this.canvas && this.hooks.onPause && !this.isTouch) {
        this.hooks.onPause();
      }
    });
  }

  // ---------------- touch ----------------
  _bindTouch() {
    const t = this.touch;
    const joyBase = document.getElementById('joystick');
    const joyKnob = document.getElementById('joystick-knob');

    const canvasDown = (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const x = e.clientX, half = window.innerWidth / 2;
      if (x < half && t.joyPointer === null) {
        t.joyPointer = e.pointerId;
        t.joyOX = x; t.joyOY = e.clientY;
        if (joyBase) {
          joyBase.style.left = `${x - 64}px`;
          joyBase.style.top = `${e.clientY - 64}px`;
          joyBase.style.display = 'block';
        }
      } else if (t.lookPointer === null) {
        t.lookPointer = e.pointerId;
        t.lookLX = x; t.lookLY = e.clientY;
        t.lookStart = performance.now();
        t.lookMoved = 0;
        t.holdTimer = setTimeout(() => {
          t.breakHeld = true;
          this.edge.breakPress = true;
        }, 260);
      }
    };
    const canvasMove = (e) => {
      if (!this.enabled) return;
      if (e.pointerId === t.joyPointer) {
        let dx = e.clientX - t.joyOX, dy = e.clientY - t.joyOY;
        const len = Math.hypot(dx, dy), max = 56;
        if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
        t.moveX = dx / max;
        t.moveZ = -dy / max;
        if (joyKnob) joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      } else if (e.pointerId === t.lookPointer) {
        const dx = e.clientX - t.lookLX, dy = e.clientY - t.lookLY;
        t.lookLX = e.clientX; t.lookLY = e.clientY;
        t.lookMoved += Math.abs(dx) + Math.abs(dy);
        this.yaw -= dx * this.sensitivity * 1.35;
        this.pitch -= dy * this.sensitivity * 1.35;
        const lim = Math.PI / 2 - 0.01;
        this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
        if (t.lookMoved > 14 && t.holdTimer) { clearTimeout(t.holdTimer); t.holdTimer = 0; }
      }
    };
    const canvasUp = (e) => {
      if (e.pointerId === t.joyPointer) {
        t.joyPointer = null; t.moveX = 0; t.moveZ = 0;
        if (joyKnob) joyKnob.style.transform = 'translate(0,0)';
        if (joyBase) joyBase.style.display = 'none';
      } else if (e.pointerId === t.lookPointer) {
        if (t.holdTimer) { clearTimeout(t.holdTimer); t.holdTimer = 0; }
        if (t.breakHeld) {
          t.breakHeld = false;
        } else if (t.lookMoved < 14 && performance.now() - t.lookStart < 260) {
          this.edge.placePress = true; // tap = place
        }
        t.lookPointer = null;
      }
    };
    this.canvas.addEventListener('pointerdown', canvasDown);
    this.canvas.addEventListener('pointermove', canvasMove);
    this.canvas.addEventListener('pointerup', canvasUp);
    this.canvas.addEventListener('pointercancel', canvasUp);
    this.canvas.style.touchAction = 'none';

    // buttons
    const bindBtn = (id, down, up) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); down(); });
      el.addEventListener('pointerup', (e) => { e.preventDefault(); if (up) up(); });
      el.addEventListener('pointercancel', () => { if (up) up(); });
    };
    bindBtn('btn-jump', () => { t.jump = true; }, () => { t.jump = false; });
    bindBtn('btn-sneak', () => { t.sneak = !t.sneak; });
    bindBtn('btn-up', () => { t.up = true; }, () => { t.up = false; });
    bindBtn('btn-down', () => { t.down = true; }, () => { t.down = false; });
    bindBtn('btn-fly', () => { this.edge.fly = true; });
    bindBtn('btn-break', () => { t.breakHeld = true; this.edge.breakPress = true; }, () => { t.breakHeld = false; });
    bindBtn('btn-place', () => { this.edge.placePress = true; });
    bindBtn('btn-inventory', () => { if (this.hooks.onInventory) this.hooks.onInventory(); });
    bindBtn('btn-pause', () => { if (this.hooks.onPause) this.hooks.onPause(); });
    bindBtn('btn-debug', () => { if (this.hooks.onDebug) this.hooks.onDebug(); });
  }

  /** consume edges + build the engine input struct */
  poll(dt) {
    let mx = 0, mz = 0;
    if (this.enabled) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
      mx += this.touch.moveX;
      mz += this.touch.moveZ;
      const len = Math.hypot(mx, mz);
      if (len > 1) { mx /= len; mz /= len; }
    }
    let flags = 0;
    if (this.keys.has('Space') || this.touch.jump) flags |= F.JUMP;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touch.sneak) flags |= F.SNEAK;
    if (this.keys.has('ControlLeft') || this.keys.has('KeyR')) flags |= F.SPRINT;
    if (this.touch.up) flags |= F.UP;
    if (this.touch.down) flags |= F.DOWN;
    if (this.mouse.left || this.touch.breakHeld) flags |= F.BREAK_HELD;
    if (this.edge.breakPress) flags |= F.BREAK_PRESS;
    if (this.edge.placePress) flags |= F.PLACE_PRESS;
    if (this.edge.fly) flags |= F.FLY_TOGGLE;

    this.edge.breakPress = false;
    this.edge.placePress = false;
    this.edge.fly = false;

    return { mx, mz, yaw: this.yaw, pitch: this.pitch, dt, flags, slot: this.slot };
  }
}
