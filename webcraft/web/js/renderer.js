// WebGL2 renderer: sky pass, chunk passes (opaque + water), highlight, bloom post.

import {
  SKY_VS, SKY_FS, CHUNK_VS, CHUNK_FS, LINE_VS, LINE_FS,
  POST_VS, BRIGHT_FS, BLUR_FS, COMPOSITE_FS,
} from './shaders.js';
import {
  mat4Perspective, mat4Multiply, mat4View, frustumPlanes, aabbVisible, cameraBasis,
} from './math.js';
import { buildAtlas } from './textures.js';

function compile(gl, vsSrc, fsSrc) {
  const mk = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error('shader compile error: ' + gl.getShaderInfoLog(sh) + '\n' + src.slice(0, 400));
    }
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, mk(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('program link error: ' + gl.getProgramInfoLog(prog));
  }
  return prog;
}

class Chunk {
  constructor(cx, cy, cz) {
    this.cx = cx; this.cy = cy; this.cz = cz;
    this.opaque = null; // {vao, vbo, ibo, count}
    this.water = null;
    this.dist = 0;
  }
}

export class Renderer {
  constructor(canvas, quality = 1) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
      antialias: true, depth: true, alpha: false,
      powerPreference: 'high-performance',
    });
    if (!this.gl) throw new Error('WebGL2 tidak tersedia di perangkat ini');
    this.quality = quality;
    this.chunks = new Map();
    this.time = 0;
    this.tris = 0;

    const gl = this.gl;
    this.progSky = compile(gl, SKY_VS, SKY_FS);
    this.progChunk = compile(gl, CHUNK_VS, CHUNK_FS);
    this.progLine = compile(gl, LINE_VS, LINE_FS);
    this.progBright = compile(gl, POST_VS, BRIGHT_FS);
    this.progBlur = compile(gl, POST_VS, BLUR_FS);
    this.progComp = compile(gl, POST_VS, COMPOSITE_FS);
    this.u = {};
    for (const [name, prog] of Object.entries({
      sky: this.progSky, chunk: this.progChunk, line: this.progLine,
      bright: this.progBright, blur: this.progBlur, comp: this.progComp,
    })) {
      const map = {};
      const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(prog, i);
        map[info.name] = gl.getUniformLocation(prog, info.name);
      }
      this.u[name] = map;
    }

    // fullscreen triangle
    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // highlight line buffer (24 verts, dynamic)
    this.lineVao = gl.createVertexArray();
    gl.bindVertexArray(this.lineVao);
    this.lineVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.bufferData(gl.ARRAY_BUFFER, 24 * 3 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // atlas
    const atlas = buildAtlas();
    this.atlasTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this._initFramebuffers();
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
  }

  _initFramebuffers() {
    const gl = this.gl;
    const mk = (w, h, depth) => {
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (depth) {
        const rb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fbo, tex, w, h };
    };
    this.fbScene = null;
    this.fbA = null;
    this.fbB = null;
    this._mk = mk;
  }

  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
    const w = Math.max(2, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(2, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width === w && this.canvas.height === h && this.fbScene) return;
    this.canvas.width = w;
    this.canvas.height = h;
    if (this.fbScene) {
      gl.deleteFramebuffer(this.fbScene.fbo); gl.deleteTexture(this.fbScene.tex);
      gl.deleteFramebuffer(this.fbA.fbo); gl.deleteTexture(this.fbA.tex);
      gl.deleteFramebuffer(this.fbB.fbo); gl.deleteTexture(this.fbB.tex);
    }
    this.fbScene = this._mk(w, h, true);
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    this.fbA = this._mk(hw, hh, false);
    this.fbB = this._mk(hw, hh, false);
  }

  // ---------- chunk mesh management ----------
  remove(id) {
    const c = this.chunks.get(id);
    if (!c) return;
    const gl = this.gl;
    for (const part of [c.opaque, c.water]) {
      if (part) {
        gl.deleteVertexArray(part.vao);
        gl.deleteBuffer(part.vbo);
        gl.deleteBuffer(part.ibo);
        this.tris -= part.count / 3;
      }
    }
    this.chunks.delete(id);
  }

  _uploadPart(m) {
    if (!m || m.idx.length === 0) return null;
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, m.verts, gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 24, 16);
    gl.bindVertexArray(null);
    return { vao, vbo, ibo, count: m.idx.length };
  }

  upload(id, mOpaque, mWater) {
    this.remove(id);
    const cx = (mOpaque || mWater).cx;
    const cy = (mOpaque || mWater).cy;
    const cz = (mOpaque || mWater).cz;
    const c = new Chunk(cx, cy, cz);
    c.opaque = this._uploadPart(mOpaque);
    c.water = this._uploadPart(mWater);
    if (c.opaque) this.tris += c.opaque.count / 3;
    if (c.water) this.tris += c.water.count / 3;
    this.chunks.set(id, c);
  }

  invalidateAll() {
    for (const id of [...this.chunks.keys()]) this.remove(id);
  }

  // ---------- rendering ----------
  render(state) {
    this.resize();
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    this.time = state.time;

    const proj = mat4Perspective(
      (state.fov * Math.PI) / 180, w / h, 0.08, 1200
    );
    const view = mat4View(state.x, state.y, state.z, state.yaw, state.pitch);
    const vp = mat4Multiply(proj, view);
    const planes = frustumPlanes(vp);
    const basis = cameraBasis(state.yaw, state.pitch);
    const tanFov = Math.tan((state.fov * Math.PI) / 360);

    const post = this.quality > 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, post ? this.fbScene.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.clearColor(state.fogColor[0], state.fogColor[1], state.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // ---- sky ----
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.progSky);
    const us = this.u.sky;
    gl.uniform3f(us.u_camPos, state.x, state.y, state.z);
    gl.uniform3fv(us.u_camFwd, basis.fwd);
    gl.uniform3fv(us.u_camRight, basis.right);
    gl.uniform3fv(us.u_camUp, basis.up);
    gl.uniform1f(us.u_tanFov, tanFov);
    gl.uniform1f(us.u_aspect, w / h);
    gl.uniform1f(us.u_time, state.time);
    gl.uniform1f(us.u_daylight, state.daylight);
    gl.uniform1f(us.u_underwater, state.underwater ? 1 : 0);
    gl.uniform3fv(us.u_sunDir, state.sunDir);
    gl.uniform3fv(us.u_skyTop, state.skyTop);
    gl.uniform3fv(us.u_skyHorizon, state.skyHorizon);
    gl.uniform3fv(us.u_sunColor, state.sunColor);
    gl.uniform3fv(us.u_cloudColor, state.cloudColor);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);

    // ---- chunks (opaque) ----
    gl.useProgram(this.progChunk);
    const uc = this.u.chunk;
    gl.uniformMatrix4fv(uc.u_vp, false, vp);
    gl.uniform1f(uc.u_time, state.time);
    gl.uniform1f(uc.u_daylight, state.daylight);
    gl.uniform1f(uc.u_fogNear, state.fogNear);
    gl.uniform1f(uc.u_fogFar, state.fogFar);
    gl.uniform3fv(uc.u_fogColor, state.fogColor);
    gl.uniform3fv(uc.u_sunDir, state.sunDir);
    gl.uniform3fv(uc.u_camPos, [state.x, state.y, state.z]);
    gl.uniform3fv(uc.u_sunColor, state.sunColor);
    gl.uniform1i(uc.u_atlas, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);

    const visible = [];
    for (const c of this.chunks.values()) {
      const x0 = c.cx * 16, y0 = c.cy * 16, z0 = c.cz * 16;
      if (!aabbVisible(planes, x0, y0, z0, x0 + 16, y0 + 16, z0 + 16)) continue;
      const dx = x0 + 8 - state.x, dy = y0 + 8 - state.y, dz = z0 + 8 - state.z;
      c.dist = dx * dx + dy * dy + dz * dz;
      visible.push(c);
    }

    gl.uniform1f(uc.u_alphaCut, 0.4);
    gl.uniform1f(uc.u_isWater, 0);
    for (const c of visible) {
      if (!c.opaque) continue;
      gl.uniform3f(uc.u_off, c.cx * 16, c.cy * 16, c.cz * 16);
      gl.bindVertexArray(c.opaque.vao);
      gl.drawElements(gl.TRIANGLES, c.opaque.count, gl.UNSIGNED_INT, 0);
    }

    // ---- water (back to front, blended) ----
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform1f(uc.u_alphaCut, 0.02);
    gl.uniform1f(uc.u_isWater, 1);
    visible.sort((a, b) => b.dist - a.dist);
    for (const c of visible) {
      if (!c.water) continue;
      gl.uniform3f(uc.u_off, c.cx * 16, c.cy * 16, c.cz * 16);
      gl.bindVertexArray(c.water.vao);
      gl.drawElements(gl.TRIANGLES, c.water.count, gl.UNSIGNED_INT, 0);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // ---- block highlight ----
    if (state.target) {
      const t = state.target;
      const e = 0.004;
      const x0 = t.x - e, y0 = t.y - e, z0 = t.z - e;
      const x1 = t.x + 1 + e, y1 = t.y + 1 + e, z1 = t.z + 1 + e;
      const pts = new Float32Array([
        x0, y0, z0, x1, y0, z0, x1, y0, z0, x1, y0, z1,
        x1, y0, z1, x0, y0, z1, x0, y0, z1, x0, y0, z0,
        x0, y1, z0, x1, y1, z0, x1, y1, z0, x1, y1, z1,
        x1, y1, z1, x0, y1, z1, x0, y1, z1, x0, y1, z0,
        x0, y0, z0, x0, y1, z0, x1, y0, z0, x1, y1, z0,
        x1, y0, z1, x1, y1, z1, x0, y0, z1, x0, y1, z1,
      ]);
      gl.useProgram(this.progLine);
      gl.uniformMatrix4fv(this.u.line.u_vp, false, vp);
      gl.uniform4f(this.u.line.u_color, 0.05, 0.05, 0.05, 0.85);
      gl.bindVertexArray(this.lineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pts);
      gl.drawArrays(gl.LINES, 0, 24);
    }

    // ---- post processing ----
    if (!post) return;

    gl.disable(gl.DEPTH_TEST);
    // bright pass -> fbA
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbA.fbo);
    gl.viewport(0, 0, this.fbA.w, this.fbA.h);
    gl.useProgram(this.progBright);
    gl.uniform1i(this.u.bright.u_scene, 0);
    gl.uniform1f(this.u.bright.u_threshold, 0.62);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fbScene.tex);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // blur ping-pong
    const passes = this.quality >= 2 ? 2 : 1;
    gl.useProgram(this.progBlur);
    gl.uniform1i(this.u.blur.u_tex, 0);
    for (let i = 0; i < passes; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbB.fbo);
      gl.uniform2f(this.u.blur.u_dir, 1 / this.fbA.w, 0);
      gl.bindTexture(gl.TEXTURE_2D, this.fbA.tex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbA.fbo);
      gl.uniform2f(this.u.blur.u_dir, 0, 1 / this.fbA.h);
      gl.bindTexture(gl.TEXTURE_2D, this.fbB.tex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // composite -> screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.progComp);
    const up = this.u.comp;
    gl.uniform1i(up.u_scene, 0);
    gl.uniform1i(up.u_bloom, 1);
    gl.uniform1f(up.u_bloomStrength, this.quality >= 2 ? 0.75 : 0.5);
    gl.uniform1f(up.u_daylight, state.daylight);
    gl.uniform1f(up.u_underwater, state.underwater ? 1 : 0);
    gl.uniform1f(up.u_time, state.time);
    gl.uniform1f(up.u_vignette, this.quality >= 2 ? 0.55 : 0.35);
    gl.uniform3f(up.u_tint, 1, 1, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fbScene.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.fbA.tex);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
  }
}
