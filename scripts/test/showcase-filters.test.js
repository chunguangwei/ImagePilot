// 验证时刻秀模板新增滤镜 fresh/candy/coldgrey 确实改变像素（肉眼看数值变化）。
const babel = require('@babel/core'); const Module = require('module'); const path = require('path');
function load(p) {
  const abs = path.resolve(__dirname, p);
  const { code } = babel.transformFileSync(abs, { presets: ['module:metro-react-native-babel-preset'] });
  const m = new Module(abs); m.filename = abs; m.paths = Module._nodeModulePaths(path.dirname(abs));
  m._compile(code, abs); return m.exports;
}
const Jimp = require('jimp');
(async () => {
  const { applyJimpFilterToBase64 } = load('../../src/services/enhance/jimpFilters.js');
  const img = new Jimp(8, 8, 0x808080ff);
  const b64 = (await img.getBase64Async(Jimp.MIME_JPEG)).split(',')[1];
  for (const id of ['fresh', 'candy', 'coldgrey']) {
    const out = await applyJimpFilterToBase64(b64, id, 1);
    const o = await Jimp.read(Buffer.from(out.split(',')[1], 'base64'));
    const a = Jimp.intToRGBA(o.getPixelColor(4, 4));
    console.log(id, '→', JSON.stringify(a), '(原 128,128,128)');
  }
  console.log('DONE');
})().catch((e) => { console.error(e); process.exit(1); });
