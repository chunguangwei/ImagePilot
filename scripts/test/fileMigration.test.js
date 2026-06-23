const babel = require('@babel/core'), Module = require('module'), path = require('path');
function load(p){const abs=path.resolve(__dirname,p);const{code}=babel.transformFileSync(abs,{presets:['module:metro-react-native-babel-preset']});const m=new Module(abs);m.filename=abs;m.paths=Module._nodeModulePaths(path.dirname(abs));m._compile(code,abs);return m.exports;}
const { sanitizeDirName, resolveNameConflict } = load('../../src/services/desktop/fileMigration.js');
let f=0; const ok=(c,m)=>{if(!c){console.error('FAIL',m);f++;}};

// 清洗非法字符
ok(sanitizeDirName('美食') === '美食', '中文保留');
ok(sanitizeDirName('a/b:c*?"<>|d') === 'a_b_c______d', '非法字符→_');
ok(sanitizeDirName('  .trim. ') === 'trim', '首尾空格和点去掉');
ok(sanitizeDirName('') === '_', '空名兜底为_');

// 同名冲突：不存在→原样；存在→加序号
ok(resolveNameConflict('/d/a.jpg', () => false) === '/d/a.jpg', '不冲突原样');
let calls = ['/d/a.jpg', '/d/a(1).jpg']; // 这两个存在，a(2) 不存在
ok(resolveNameConflict('/d/a.jpg', (p) => calls.includes(p)) === '/d/a(2).jpg', '冲突加序号到不冲突');
ok(resolveNameConflict('/d/noext', (p)=>p==='/d/noext') === '/d/noext(1)', '无扩展名也能加序号');

// Task 4 追加：buildMigrationItems
const { buildMigrationItems } = load('../../src/services/desktop/fileMigration.js');
const imgs = [
  { id: '1', uri: 'file:///D:/p/a.jpg', appCategory: 'foods' },
  { id: '2', uri: 'file:///D:/p/b.jpg', appCategory: 'NA' },      // 跳过
  { id: '3', uri: 'file:///D:/p/c.jpg', appCategory: '' },         // 跳过
  { id: '4', uri: 'file:///D:/p/d.jpg', appCategory: 'a/b' },      // 非法名清洗
];
const getName = (c) => ({ foods: '美食', 'a/b': 'a/b' }[c] || c);
const getPath = (im) => im.uri.replace('file:///', '');
const { items, skipped } = buildMigrationItems(imgs, 'D:/out', getName, getPath);
ok(items.length === 2, `已分类2张（得 ${items.length}）`);
ok(skipped === 2, 'NA+空 跳过2张');
ok(items[0].targetDir === 'D:/out/美食' && items[0].fileName === 'a.jpg', '美食目标正确');
ok(items[1].targetDir === 'D:/out/a_b', '非法分类名清洗为 a_b');

console.log(f===0?'PASS':f+' FAIL'); process.exit(f?1:0);
