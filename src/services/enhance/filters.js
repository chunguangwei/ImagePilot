/**
 * filters — 修图滤镜/美颜引擎（GLSL 着色器库 + 注册表，跨平台）
 *
 * 设计：每个滤镜是一段 gl-react 约定的片元着色器（varying `uv` + sampler `t`），
 * 参数以 uniform 暴露并带 {min,max,default} 元数据。渲染层（RN: gl-react-native+expo-gl /
 * Electron: gl-react-dom）共用同一份着色器与参数模型——纯数据 + 纯函数，可在骨架单测。
 *
 * 着色器为自有实现（基础色彩/美颜算法，非移植任何第三方代码）。
 */

const HEADER = 'precision highp float;\nvarying vec2 uv;\nuniform sampler2D t;\n';

/** 亮度/对比度/饱和度：一个着色器统管基础调整 */
const ADJUST = `${HEADER}uniform float brightness; // -1..1
uniform float contrast;   // 0..2 (1=原样)
uniform float saturation; // 0..2 (1=原样)
void main() {
  vec4 c = texture2D(t, uv);
  vec3 rgb = c.rgb + brightness;                 // 亮度
  rgb = (rgb - 0.5) * contrast + 0.5;            // 对比度
  float g = dot(rgb, vec3(0.299, 0.587, 0.114)); // 灰度（Rec.601）
  rgb = mix(vec3(g), rgb, saturation);           // 饱和度
  gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}`;

const GRAYSCALE = `${HEADER}uniform float intensity; // 0..1
void main() {
  vec4 c = texture2D(t, uv);
  float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  gl_FragColor = vec4(mix(c.rgb, vec3(g), intensity), c.a);
}`;

const SEPIA = `${HEADER}uniform float intensity; // 0..1
void main() {
  vec4 c = texture2D(t, uv);
  vec3 s = vec3(
    dot(c.rgb, vec3(0.393, 0.769, 0.189)),
    dot(c.rgb, vec3(0.349, 0.686, 0.168)),
    dot(c.rgb, vec3(0.272, 0.534, 0.131))
  );
  gl_FragColor = vec4(mix(c.rgb, clamp(s, 0.0, 1.0), intensity), c.a);
}`;

/** 暖色：抬红降蓝 */
const WARM = `${HEADER}uniform float intensity; // 0..1
void main() {
  vec4 c = texture2D(t, uv);
  vec3 w = c.rgb + vec3(0.10, 0.03, -0.08) * intensity;
  gl_FragColor = vec4(clamp(w, 0.0, 1.0), c.a);
}`;

/** 冷色：抬蓝降红 */
const COOL = `${HEADER}uniform float intensity; // 0..1
void main() {
  vec4 c = texture2D(t, uv);
  vec3 w = c.rgb + vec3(-0.08, 0.0, 0.12) * intensity;
  gl_FragColor = vec4(clamp(w, 0.0, 1.0), c.a);
}`;

/** 暗角 */
const VIGNETTE = `${HEADER}uniform float intensity; // 0..1
void main() {
  vec4 c = texture2D(t, uv);
  float d = distance(uv, vec2(0.5));
  float v = smoothstep(0.8, 0.45, d);
  gl_FragColor = vec4(c.rgb * mix(1.0, v, intensity), c.a);
}`;

/**
 * 美颜（磨皮）：对当前像素做 3x3 邻域均值近似的简易模糊，再与原图按 intensity 混合。
 * resolution 用于把像素步长换算到 uv 空间。真正的双边/高斯磨皮可后续替换，接口不变。
 */
const BEAUTY = `${HEADER}uniform float intensity;   // 0..1
uniform vec2 resolution;   // 纹理像素尺寸
void main() {
  vec2 px = 1.0 / max(resolution, vec2(1.0));
  vec3 sum = vec3(0.0);
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      sum += texture2D(t, uv + vec2(float(x), float(y)) * px).rgb;
    }
  }
  vec3 blur = sum / 9.0;
  vec4 c = texture2D(t, uv);
  gl_FragColor = vec4(mix(c.rgb, blur, intensity), c.a);
}`;

/**
 * 滤镜注册表。每项：
 *   { id, name, shader, params: [{ key, min, max, default }], needsResolution? }
 */
export const FILTERS = Object.freeze({
  none: { id: 'none', name: '原图', shader: null, params: [] },
  adjust: {
    id: 'adjust',
    name: '基础调整',
    shader: ADJUST,
    params: [
      { key: 'brightness', min: -1, max: 1, default: 0 },
      { key: 'contrast', min: 0, max: 2, default: 1 },
      { key: 'saturation', min: 0, max: 2, default: 1 },
    ],
  },
  grayscale: { id: 'grayscale', name: '黑白', shader: GRAYSCALE, params: [{ key: 'intensity', min: 0, max: 1, default: 1 }] },
  sepia: { id: 'sepia', name: '复古', shader: SEPIA, params: [{ key: 'intensity', min: 0, max: 1, default: 1 }] },
  warm: { id: 'warm', name: '暖色', shader: WARM, params: [{ key: 'intensity', min: 0, max: 1, default: 0.5 }] },
  cool: { id: 'cool', name: '冷色', shader: COOL, params: [{ key: 'intensity', min: 0, max: 1, default: 0.5 }] },
  vignette: { id: 'vignette', name: '暗角', shader: VIGNETTE, params: [{ key: 'intensity', min: 0, max: 1, default: 0.6 }] },
  beauty: {
    id: 'beauty',
    name: '美颜磨皮',
    shader: BEAUTY,
    needsResolution: true,
    params: [{ key: 'intensity', min: 0, max: 1, default: 0.5 }],
  },
});

/** 滤镜 id 列表（含 none，按展示顺序） */
export const FILTER_IDS = Object.freeze(Object.keys(FILTERS));

/** 取某滤镜的默认参数对象 */
export function defaultParams(filterId) {
  const f = FILTERS[filterId];
  if (!f) return {};
  const out = {};
  for (const p of f.params) out[p.key] = p.default;
  return out;
}

/** 把参数夹到各自 [min,max]；未知键丢弃；缺失键补默认 */
export function clampParams(filterId, params = {}) {
  const f = FILTERS[filterId];
  if (!f) return {};
  const out = {};
  for (const p of f.params) {
    const v = typeof params[p.key] === 'number' ? params[p.key] : p.default;
    out[p.key] = Math.min(p.max, Math.max(p.min, v));
  }
  return out;
}

/**
 * 组合滤镜管线：把若干 {filterId, params} 步骤规整为可渲染的有序数组。
 * 跳过未知滤镜与 none；参数夹紧。渲染层按顺序逐级把上一层输出作为下一层输入。
 * @param {Array<{filterId:string, params?:object}>} steps
 * @returns {Array<{id:string, shader:string, params:object, needsResolution:boolean}>}
 */
export function buildPipeline(steps = []) {
  const out = [];
  for (const step of steps) {
    const f = FILTERS[step.filterId];
    if (!f || !f.shader) continue; // 跳过 none / 未知
    out.push({
      id: f.id,
      shader: f.shader,
      params: clampParams(f.id, step.params),
      needsResolution: !!f.needsResolution,
    });
  }
  return out;
}

export default FILTERS;
