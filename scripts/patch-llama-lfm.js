/** Backport upstream optional LFM2-VL input norm to the RN 0.72-compatible runtime.
 * Upstream: ggml-org/llama.cpp tools/mtmd/{clip.cpp,models/siglip.cpp}.
 * Fail closed on dependency drift: prebuilt 0.9.7 cannot load the official 450M projector.
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../node_modules/llama.rn');
if (JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version !== '0.9.7') throw new Error('Review LFM patch before upgrading llama.rn');
function replace(file, before, after) {
  const target = path.join(root, file); const source = fs.readFileSync(target, 'utf8');
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error('LFM patch mismatch: ' + file);
  fs.writeFileSync(target, source.replace(before, after));
}
replace('cpp/tools/mtmd/clip.cpp',
`            case PROJECTOR_TYPE_LFM2:
            case PROJECTOR_TYPE_KIMIVL:
                {
                    model.mm_input_norm_w = get_tensor(TN_MM_INP_NORM);
                    model.mm_input_norm_b = get_tensor(TN_MM_INP_NORM_B);`,
`            case PROJECTOR_TYPE_LFM2:
            case PROJECTOR_TYPE_KIMIVL:
                {
                    // ImagePilot: LFM2.5-VL-450M omits input LayerNorm; Kimi still requires it.
                    model.mm_input_norm_w = get_tensor(TN_MM_INP_NORM, model.proj_type != PROJECTOR_TYPE_LFM2);
                    model.mm_input_norm_b = get_tensor(TN_MM_INP_NORM_B, model.proj_type != PROJECTOR_TYPE_LFM2);`);
replace('cpp/tools/mtmd/models/siglip.cpp',
`        // projection
        cur = lm_ggml_norm(ctx0, cur, 1e-5); // default nn.LayerNorm
        cur = lm_ggml_mul(ctx0, cur, model.mm_input_norm_w);
        cur = lm_ggml_add(ctx0, cur, model.mm_input_norm_b);`,
`        // ImagePilot: upstream LFM2-VL optional input norm (450M has none).
        if (model.mm_input_norm_w) {
            cur = lm_ggml_norm(ctx0, cur, 1e-5);
            cur = lm_ggml_mul(ctx0, cur, model.mm_input_norm_w);
        }
        if (model.mm_input_norm_b) {
            cur = lm_ggml_add(ctx0, cur, model.mm_input_norm_b);
        }`);
// Keep all CPU-dispatch library names, but compile no GPU/NPU backend or SDK dependency.
for (const file of ['android/src/main/CMakeLists.txt', 'android/src/main/rnllama/CMakeLists.txt']) {
  const anchor = file.includes('/rnllama/') ? '    if (NOT ${arch} STREQUAL "generic")' : '    # Create the shared library with JNI wrapper';
  replace(file, anchor, '    # ImagePilot LFM CPU baseline (all CPU instruction variants retained)\n    set(ENABLE_OPENCL OFF)\n    set(ENABLE_HEXAGON OFF)\n\n' + anchor);
}
replace('android/gradle.properties', 'RNLlama_ndkversion=27.3.13750724', 'RNLlama_ndkversion=27.2.12479018');
console.log('Applied llama.rn 0.9.7 LFM2.5-VL compatibility / CPU build patch');
