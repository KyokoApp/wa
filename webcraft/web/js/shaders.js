// GLSL ES 3.00 shaders: sky+clouds, chunks (waves/AO/fog/water specular), post FX.

export const SKY_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_ndc;
void main() {
  v_ndc = a_pos;
  gl_Position = vec4(a_pos, 0.9999, 1.0);
}`;

export const SKY_FS = `#version 300 es
precision highp float;
in vec2 v_ndc;
out vec4 fragColor;
uniform vec3 u_camPos, u_camFwd, u_camRight, u_camUp;
uniform float u_tanFov, u_aspect, u_time, u_daylight, u_underwater;
uniform vec3 u_sunDir, u_skyTop, u_skyHorizon, u_sunColor, u_cloudColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1, 0));
  float c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.55;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.13 + 17.7; a *= 0.5; }
  return s;
}

void main() {
  vec3 dir = normalize(u_camFwd
    + u_camRight * v_ndc.x * u_tanFov * u_aspect
    + u_camUp * v_ndc.y * u_tanFov);

  float up = clamp(dir.y, -1.0, 1.0);
  vec3 col = mix(u_skyHorizon, u_skyTop, pow(max(up, 0.0), 0.55));
  if (up < 0.0) {
    col = mix(u_skyHorizon, u_skyTop * 0.55, pow(-up, 0.7));
  }

  // sun disc + glow
  float s = dot(dir, u_sunDir);
  float disc = smoothstep(0.9990, 0.99955, s);
  float glow = pow(max(s, 0.0), 24.0);
  col += u_sunColor * (disc * 1.35 + glow * 0.32);

  // moon
  float m = dot(dir, -u_sunDir);
  float mdisc = smoothstep(0.9992, 0.99965, m);
  float night = 1.0 - u_daylight;
  col += vec3(0.86, 0.9, 1.0) * mdisc * night * 0.9;
  col += vec3(0.5, 0.6, 0.85) * pow(max(m, 0.0), 48.0) * night * 0.22;

  // stars
  if (night > 0.15 && dir.y > 0.0) {
    vec3 sd = dir * 220.0;
    float h = hash21(floor(sd.xz / max(abs(dir.y), 0.08)) + floor(sd.y));
    float tw = 0.75 + 0.25 * sin(u_time * 2.2 + h * 40.0);
    float star = smoothstep(0.9975, 1.0, h) * tw * night * smoothstep(0.0, 0.18, dir.y);
    col += vec3(star);
  }

  // procedural cloud layer
  if (dir.y > 0.015) {
    float t = (235.0 - u_camPos.y) / dir.y;
    if (t > 0.0 && t < 9000.0) {
      vec2 p = u_camPos.xz + dir.xz * t;
      float f = fbm(p * 0.0016 + vec2(u_time * 0.008, u_time * 0.0045));
      float edge = smoothstep(0.52, 0.66, f);
      float fade = smoothstep(0.015, 0.14, dir.y) * exp(-t * 0.00012);
      float shade = 0.72 + 0.28 * fbm(p * 0.004 + 31.0);
      col = mix(col, u_cloudColor * shade, edge * fade * 0.82);
    }
  }

  if (u_underwater > 0.5) {
    col = mix(col, vec3(0.06, 0.22, 0.42), 0.82);
  }
  fragColor = vec4(col, 1.0);
}`;

export const CHUNK_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in vec4 a_light;
uniform mat4 u_vp;
uniform vec3 u_off;
uniform float u_time;
out vec2 v_uv;
out vec4 v_light;
out vec3 v_wpos;
out float v_dist;
void main() {
  vec3 w = a_pos + u_off;
  float wf = a_light.a * 255.0;
  if (wf > 0.5 && wf < 1.5) {
    w.x += sin(u_time * 1.7 + w.z * 0.9 + w.y * 0.6) * 0.055;
    w.z += cos(u_time * 1.4 + w.x * 0.8) * 0.055;
    w.y += sin(u_time * 1.1 + w.x * 1.3) * 0.028;
  } else if (wf > 1.5) {
    w.y += sin(u_time * 1.25 + w.x * 0.62 + w.z * 0.41) * 0.05
         + cos(u_time * 1.9 + w.z * 0.85) * 0.035;
  }
  v_uv = a_uv;
  v_light = a_light;
  v_wpos = w;
  vec4 p = u_vp * vec4(w, 1.0);
  v_dist = p.w;
  gl_Position = p;
}`;

export const CHUNK_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_light;
in vec3 v_wpos;
in float v_dist;
out vec4 fragColor;
uniform sampler2D u_atlas;
uniform float u_daylight, u_fogNear, u_fogFar, u_alphaCut, u_isWater;
uniform vec3 u_fogColor, u_sunDir, u_camPos, u_sunColor;

void main() {
  vec4 tex = texture(u_atlas, v_uv);
  if (tex.a < u_alphaCut) discard;

  float ao = 0.42 + 0.58 * v_light.g;
  float day = 0.28 + 0.82 * u_daylight;
  float light = v_light.r * ao * day;
  vec3 col = tex.rgb * light;

  // emissive (glowstone) glows harder at night
  float em = v_light.b * (0.35 + 1.35 * (1.0 - u_daylight));
  col += tex.rgb * em;

  // subtle sky ambient on lit faces
  col += vec3(0.035, 0.055, 0.09) * v_light.r * u_daylight * ao;

  float alpha = tex.a;
  if (u_isWater > 0.5) {
    vec3 n = normalize(cross(dFdx(v_wpos), dFdy(v_wpos)));
    if (n.y < 0.0) n = -n;
    vec3 view = normalize(u_camPos - v_wpos);
    float spec = pow(max(dot(reflect(-u_sunDir, n), view), 0.0), 90.0);
    float fres = pow(1.0 - max(dot(n, view), 0.0), 3.0);
    col += u_sunColor * spec * (0.25 + 1.1 * u_daylight);
    alpha = mix(0.58, 0.92, fres);
    col += vec3(0.02, 0.05, 0.10) * fres;
  }

  float fog = smoothstep(u_fogNear, u_fogFar, v_dist);
  col = mix(col, u_fogColor, fog);
  fragColor = vec4(col, alpha);
}`;

export const LINE_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
uniform mat4 u_vp;
void main() {
  gl_Position = u_vp * vec4(a_pos, 1.0);
}`;

export const LINE_FS = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec4 u_color;
void main() { fragColor = u_color; }`;

export const POST_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

export const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_scene;
uniform float u_threshold;
void main() {
  vec3 c = texture(u_scene, v_uv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  float k = max(l - u_threshold, 0.0) / max(l, 0.0001);
  fragColor = vec4(c * k, 1.0);
}`;

export const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tex;
uniform vec2 u_dir; // texel-scaled direction
void main() {
  vec3 s = texture(u_tex, v_uv).rgb * 0.227027;
  s += texture(u_tex, v_uv + u_dir * 1.3846).rgb * 0.3162162;
  s += texture(u_tex, v_uv - u_dir * 1.3846).rgb * 0.3162162;
  s += texture(u_tex, v_uv + u_dir * 3.2308).rgb * 0.0702703;
  s += texture(u_tex, v_uv - u_dir * 3.2308).rgb * 0.0702703;
  fragColor = vec4(s, 1.0);
}`;

export const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_scene, u_bloom;
uniform float u_bloomStrength, u_daylight, u_underwater, u_time, u_vignette;
uniform vec3 u_tint;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 col = texture(u_scene, v_uv).rgb;
  col += texture(u_bloom, v_uv).rgb * u_bloomStrength;

  // day/night grade
  vec3 nightTint = vec3(0.82, 0.88, 1.18);
  col *= mix(nightTint, vec3(1.0), clamp(u_daylight, 0.0, 1.0));
  col *= u_tint;

  col = aces(col * 1.06);

  // vignette
  vec2 d = v_uv - 0.5;
  float v = 1.0 - dot(d, d) * u_vignette;
  col *= clamp(v, 0.0, 1.0);

  if (u_underwater > 0.5) {
    float w = sin((v_uv.x + v_uv.y) * 18.0 + u_time * 1.6) * 0.012;
    col = mix(col, vec3(0.07, 0.27, 0.46), 0.30 + w);
  }
  fragColor = vec4(col, 1.0);
}`;
