/**
 * jimpCustom — RN/Hermes 可用的「定制版」Jimp。
 *
 * 为什么不直接 `import 'jimp'`：
 *  - jimp 0.22 无 exports 字段，RN 默认 mainFields 选到 browser UMD 构建，
 *    该构建在 Hermes 下不写 module.exports → 拿到空对象 {}（Jimp.read=undefined）。
 *  - 改指 jimp/dist（Node 全量构建）又会拉入 @jimp/plugin-print，
 *    它在「模块初始化阶段」就 path.join 拼字体路径 → RN 无 path 直接崩。
 *
 * 方案：用 @jimp/custom 自行装配，只挑实际用到的解码器/插件，绕开 plugin-print。
 * 这些 @jimp/* 子包 main 指向各自 dist 的 CJS，能被 Metro 正常解析（带 .read）。
 * @jimp/core 仍 require fs/path，但仅在未走到的文件读写分支里用，已用空 shim 兜底。
 */

import configure from '@jimp/custom';
import jpeg from '@jimp/jpeg';               // 仅 JPEG：输入(缩放后)与输出都是 jpeg；
                                             // 不引 @jimp/png（pngjs 依赖 Node stream，RN 无）。
import color from '@jimp/plugin-color';     // greyscale / sepia / brightness / contrast
import blur from '@jimp/plugin-blur';        // blur（柔化）
import invert from '@jimp/plugin-invert';    // invert（反色）
import resize from '@jimp/plugin-resize';    // scale 依赖 resize
import scale from '@jimp/plugin-scale';      // scaleToFit（超分前限尺寸）

// Metro/Hermes 互操作下个别默认导出可能被再包一层，统一解包。
const d = (m) => (m && m.default ? m.default : m);

const Jimp = d(configure)({
  types: [d(jpeg)],
  plugins: [d(color), d(blur), d(invert), d(resize), d(scale)],
});

export default Jimp;
