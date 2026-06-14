const babel = require('@babel/core'); const Module = require('module'); const path = require('path');
function load(p){ const abs=path.resolve(__dirname,p); const {code}=babel.transformFileSync(abs,{presets:['module:metro-react-native-babel-preset']}); const m=new Module(abs); m.filename=abs; m.paths=Module._nodeModulePaths(path.dirname(abs)); m._compile(code,abs); return m.exports; }
const T = load('../../src/config/showcaseTemplates.js');
const fm = load('../../src/services/showcase/filterMap.js');
let fail=0; const ok=(c,m)=>{ if(!c){console.error('FAIL',m); fail++;} };
ok(T.SHOWCASE_TEMPLATES.length===25, 'count=25 实际'+T.SHOWCASE_TEMPLATES.length);
const ids=new Set();
for(const t of T.SHOWCASE_TEMPLATES){
  ok(/^[a-z0-9_]+$/.test(t.id), 'id ASCII: '+t.id);
  ok(!ids.has(t.id), 'id 唯一: '+t.id); ids.add(t.id);
  ok(typeof t.interval==='number' && t.interval>0, 'interval: '+t.id);
  ok(fm.mapFilter(t.globalFilter)!==null, 'filter 有映射: '+t.id+' '+t.globalFilter);
  ok('transition' in t && 'intro' in t && 'outro' in t, '字段齐: '+t.id);
}
ok(T.getTemplate('wedding_eternal_vow')!==null, 'getTemplate 命中');
ok(T.getTemplate('nope')===null, 'getTemplate 未命中→null');
console.log(fail===0?'ALL PASS':fail+' FAILED'); process.exit(fail===0?0:1);
