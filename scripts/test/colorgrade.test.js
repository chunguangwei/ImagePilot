const babel = require('@babel/core'); const Module = require('module'); const path = require('path');
function load(p) {
  const abs = path.resolve(__dirname, p);
  const { code } = babel.transformFileSync(abs, { presets: ['module:metro-react-native-babel-preset'] });
  const m = new Module(abs); m.filename = abs; m.paths = Module._nodeModulePaths(path.dirname(abs));
  m._compile(code, abs); return m.exports;
}
const cg = load('../../src/services/enhance/colorGrade.js');
let fail = 0; const ok = (c, m) => { if (!c) { console.error('FAIL', m); fail++; } };
const L = (id) => cg.getLook(id);

ok(cg.hasLook('warm_cream'), 'warm_cream 存在');
ok(!cg.hasLook('nope'), 'nope 不存在');
ok(cg.lookIds().length === 7, '7 个 look，实际' + cg.lookIds().length);

// 暖奶油：高光（亮像素）R > B（暖）
let [r, g, b] = cg.gradePixel(220, 220, 220, L('warm_cream'), 1);
ok(r > b, 'warm_cream 高光 R>B 暖: ' + [r, g, b]);

// 冷灰：阴影（暗像素）B > R（阴影偏青蓝）
[r, g, b] = cg.gradePixel(40, 40, 40, L('cold_grey'), 1);
ok(b > r, 'cold_grey 阴影 B>R 冷: ' + [r, g, b]);

// 高饱和：彩色像素饱和度不降
const sat = (rr, gg, bb) => Math.max(rr, gg, bb) - Math.min(rr, gg, bb);
const before = sat(180, 90, 90);
[r, g, b] = cg.gradePixel(180, 90, 90, L('high_saturation'), 1);
ok(sat(r, g, b) >= before, 'high_saturation 饱和不降: ' + before + '→' + sat(r, g, b));

// 强度 0 ≈ 原样
[r, g, b] = cg.gradePixel(128, 128, 128, L('film_vintage'), 0);
ok(Math.abs(r - 128) <= 1 && Math.abs(g - 128) <= 1 && Math.abs(b - 128) <= 1, '强度0≈原样: ' + [r, g, b]);

// 所有 look 都能处理且输出在 0~255
for (const id of cg.lookIds()) {
  const [rr, gg, bb] = cg.gradePixel(150, 120, 90, L(id), 1);
  ok([rr, gg, bb].every((v) => v >= 0 && v <= 255), id + ' 输出合法: ' + [rr, gg, bb]);
}

console.log(fail === 0 ? 'ALL PASS' : fail + ' FAILED');
process.exit(fail === 0 ? 0 : 1);
