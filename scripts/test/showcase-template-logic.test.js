const babel = require('@babel/core');
const Module = require('module');
const path = require('path');
function load(p) {
  const abs = path.resolve(__dirname, p);
  const { code } = babel.transformFileSync(abs, { presets: ['module:metro-react-native-babel-preset'] });
  const m = new Module(abs); m.filename = abs; m.paths = Module._nodeModulePaths(path.dirname(abs));
  m._compile(code, abs); return m.exports;
}
const fm = load('../../src/services/showcase/filterMap.js');
let fail = 0; const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error('FAIL', msg, a, '!=', b); fail++; } };

// 滤镜映射
eq(fm.mapFilter('warm_cream').jimpId, 'warm', 'warm_cream→warm');
eq(fm.mapFilter('high_saturation').jimpId, 'vivid', 'high_saturation→vivid');
eq(fm.mapFilter('film_vintage').jimpId, 'film', 'film_vintage→film');
eq(fm.mapFilter('japanese_soft').jimpId, 'fade', 'japanese_soft→fade');
eq(fm.mapFilter('fresh_clean').jimpId, 'fresh', 'fresh_clean→fresh');
eq(fm.mapFilter('candy_bright').jimpId, 'candy', 'candy_bright→candy');
eq(fm.mapFilter('cold_grey').jimpId, 'coldgrey', 'cold_grey→coldgrey');
eq(fm.mapFilter('unknown_x'), null, 'unknown→null');

// 转场映射到现有 8 种 mode
eq(fm.mapTransition('soft_dissolve'), 'fade', 'soft_dissolve→fade');
eq(fm.mapTransition('slide'), 'slide', 'slide→slide');
eq(fm.mapTransition('zoom'), 'zoom', 'zoom→zoom');
eq(fm.mapTransition('pageflip'), 'flip', 'pageflip→flip');
eq(fm.mapTransition('bounce'), 'spring', 'bounce→spring');
eq(fm.mapTransition('glitch'), 'none', 'glitch→none(降级直切)');
eq(fm.mapTransition('mask_heart'), 'none', 'mask_heart→none');
eq(fm.mapTransition('whatever'), 'fade', '未知→fade兜底');

// 槽位映射：name/date 替换，小众变量删除并清理多余符号
const slots = { name: '宝宝的夏天', date: '2024.7.1' };
eq(fm.fillSlots('{{name1}} ❤ {{name2}}', slots), '宝宝的夏天 ❤ 宝宝的夏天', 'name 类→名称');
eq(fm.fillSlots('{{date}}', slots), '2024.7.1', 'date→日期');
eq(fm.fillSlots('ON THE ROAD', slots), 'ON THE ROAD', '固定文案原样');
eq(fm.fillSlots('海拔 {{altitude}} m', slots), '海拔 m', '小众变量删除');
eq(fm.fillSlots('¥{{price}}', slots), '¥', '价格变量删除');
eq(fm.fillSlots('  {{x}}  双空格 ', slots).includes('  '), false, '清理连续空格');

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
