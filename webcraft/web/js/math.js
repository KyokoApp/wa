// Minimal mat4 / vec3 math + frustum extraction (column-major for WebGL).

export function mat4Identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function mat4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

// view = rotX(-pitch) * rotY(-yaw) * translate(-pos), camera looks along -Z at yaw 0
export function mat4View(px, py, pz, yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  // basis (world-space camera axes)
  // forward = (-cp*sy, sp, -cp*cy)
  const fx = -cp * sy, fy = sp, fz = -cp * cy;
  // right = (cy, 0, -sy)
  const rx = cy, ry = 0, rz = -sy;
  // up = right x forward? up = cross(right, forward) -> (ry*fz-rz*fy, rz*fx-rx*fz, rx*fy-ry*fx)
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;
  const out = new Float32Array(16);
  out[0] = rx; out[4] = ry; out[8] = rz;
  out[1] = ux; out[5] = uy; out[9] = uz;
  out[2] = -fx; out[6] = -fy; out[10] = -fz;
  out[12] = -(rx * px + ry * py + rz * pz);
  out[13] = -(ux * px + uy * py + uz * pz);
  out[14] = fx * px + fy * py + fz * pz;
  out[15] = 1;
  return out;
}

export function cameraBasis(yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return {
    fwd: [-cp * sy, sp, -cp * cy],
    right: [cy, 0, -sy],
    up: [sy * sp, cp, cy * sp],
  };
}

// extract 6 normalized planes [a,b,c,d] from a view-projection matrix
export function frustumPlanes(vp) {
  const m = vp;
  const rows = [
    [m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]], // left
    [m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]], // right
    [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]], // bottom
    [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]], // top
    [m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]], // near
    [m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]], // far
  ];
  return rows.map((p) => {
    const len = Math.hypot(p[0], p[1], p[2]) || 1;
    return [p[0] / len, p[1] / len, p[2] / len, p[3] / len];
  });
}

export function aabbVisible(planes, minx, miny, minz, maxx, maxy, maxz) {
  for (let i = 0; i < 6; i++) {
    const p = planes[i];
    const x = p[0] > 0 ? maxx : minx;
    const y = p[1] > 0 ? maxy : miny;
    const z = p[2] > 0 ? maxz : minz;
    if (p[0] * x + p[1] * y + p[2] * z + p[3] < 0) return false;
  }
  return true;
}

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function mix(a, b, t) {
  return a + (b - a) * t;
}

export function mix3(a, b, t) {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

export function clamp(x, a, b) {
  return Math.min(b, Math.max(a, x));
}
