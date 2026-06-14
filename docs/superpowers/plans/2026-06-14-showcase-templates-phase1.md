# 时刻秀剪映式模板一键出片（一期）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在创建时刻秀时选一个风格模板，自动套用「全局滤镜 + 单图时长 + 转场 + 片头/片尾标题卡」一键出片，效果应用内全平台可见、导出 iOS 先行。

**Architecture:** 27 模板做成纯数据 JSON 注册表（一期只消费 globalFilter/duration/transition/intro/outro）。选模板保存时后台预生成：逐张套 jimp 滤镜→缓存图；intro/outro 文案经槽位映射→渲染样式 View→view-shot 截图。把这些缓存图组装成 `items` 存进 showcases 表新增列（兼容旧 imageIds）。MomentsScreen 解析 items→图片对象数组（含 uri），播放/导出零改动。

**Tech Stack:** React Native 0.72，jimp（jimpFilters），react-native-view-shot（captureRef），RNFS，react-native-sqlite-storage。纯 JS，无原生改动。

参考 spec：`docs/superpowers/specs/2026-06-14-showcase-templates-phase1-design.md`

---

## File Structure

- **Create** `src/config/showcaseTemplates.js` — 27 模板数据 + `getTemplate(id)`。
- **Create** `src/services/showcase/filterMap.js` — globalFilter→jimp 映射、transition→mode 映射、槽位文案替换（纯函数，可 Node 测）。
- **Create** `src/services/showcase/templateApply.js` — 套滤镜 + 生成标题卡 + 组装 items（带进度回调）。
- **Create** `src/components/shared/ShowcaseTitleCard.js` — 标题卡样式 View（供 view-shot 截图）。
- **Modify** `src/services/enhance/jimpFilters.js` — 新增 3 个滤镜预设 fresh/candy/coldgrey。
- **Modify** `src/services/ImageStorageService.js` — showcases 加 `items` 列 + 迁移 + saveShowcase 写 items。
- **Modify** `src/screens/mobile/MomentsScreen.mobile.js` — 解析 items→images。
- **Modify** `src/screens/mobile/ShowcaseCreateScreen.mobile.js` — 模板选择行 + 保存时套用 + 标题卡离屏渲染容器。
- **Modify** `src/i18n/locales/{zh,en}/common.json` — 模板名 / 文案。
- **Create** `scripts/test/showcase-template-logic.test.js` — filterMap / 槽位映射 Node 测试。

测试现实：本仓库无正式 test runner，纯函数用 `node` + `@babel/core` transform 跑断言脚本（沿用 jimp 测试手法）；UI/截图/落库走真机验证步骤。

---

## Task 1: 滤镜与转场映射 + 槽位文案（纯函数，先测）

**Files:**
- Create: `src/services/showcase/filterMap.js`
- Test: `scripts/test/showcase-template-logic.test.js`

- [ ] **Step 1: 写失败测试**

`scripts/test/showcase-template-logic.test.js`：
```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test/showcase-template-logic.test.js`
Expected: FAIL（filterMap.js 不存在 / 函数未定义）

- [ ] **Step 3: 实现 filterMap.js**

```js
/**
 * filterMap —— 模板字段到现有能力的映射 + intro/outro 槽位文案替换（纯函数）。
 */

// globalFilter → 现有 jimp 滤镜 id + 强度
const FILTER_MAP = Object.freeze({
  warm_cream: { jimpId: 'warm', intensity: 1 },
  high_saturation: { jimpId: 'vivid', intensity: 1 },
  film_vintage: { jimpId: 'film', intensity: 1 },
  japanese_soft: { jimpId: 'fade', intensity: 0.8 },
  fresh_clean: { jimpId: 'fresh', intensity: 1 },
  candy_bright: { jimpId: 'candy', intensity: 1 },
  cold_grey: { jimpId: 'coldgrey', intensity: 1 },
});
export function mapFilter(globalFilter) {
  return FILTER_MAP[globalFilter] || null;
}

// 模板 transition → 现有 8 种播放 mode（淡入/平移/缩放/推入/翻转/弹入/上浮/直切）
const TRANSITION_MAP = Object.freeze({
  soft_dissolve: 'fade', fade: 'fade',
  slide: 'slide', wipe: 'slide', pan_left: 'slide', pan_right: 'slide',
  zoom: 'zoom', ken_burns_zoom_in: 'zoom', ken_burns_zoom_out: 'zoom',
  pageflip: 'flip',
  bounce: 'spring',
  rise: 'rise', slide_up: 'rise',
  push: 'push',
  flash: 'none', glitch: 'none', mask_heart: 'none', mask_circle: 'none',
});
export function mapTransition(transition) {
  return TRANSITION_MAP[transition] || 'fade';
}

// intro/outro 文案槽位：主体类变量→名称，时间类→日期，其余小众变量删除
const NAME_VARS = ['name', 'name1', 'name2', 'destination', 'babyName', 'petName', 'shopName',
  'productName', 'brandName', 'eventName', 'className', 'location', 'goal', 'dishName'];
const DATE_VARS = ['date', 'year'];
export function fillSlots(text, slots = {}) {
  if (!text) return '';
  let out = String(text).replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (NAME_VARS.includes(key)) return slots.name || '';
    if (DATE_VARS.includes(key)) return slots.date || '';
    return ''; // 小众变量删除
  });
  // 清理删除变量后残留的连续空格 / 首尾空格
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out;
}

export default { mapFilter, mapTransition, fillSlots };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/test/showcase-template-logic.test.js`
Expected: `ALL PASS`

- [ ] **Step 5: 提交**

```bash
git add src/services/showcase/filterMap.js scripts/test/showcase-template-logic.test.js
git commit -m "feat(showcase): 模板滤镜/转场/槽位映射纯函数 + 测试"
```

---

## Task 2: 新增 3 个 jimp 滤镜预设

**Files:**
- Modify: `src/services/enhance/jimpFilters.js:51-56`（JIMP_FILTERS 对象内）

- [ ] **Step 1: 加 fresh/candy/coldgrey 预设**

在 `src/services/enhance/jimpFilters.js` 的 `JIMP_FILTERS` 里、`film:` 行之后、`soften:` 之前插入：
```js
  fresh: { name: '清新', apply: (img, i) => { img.brightness(0.06 * i); img.color([{ apply: 'desaturate', params: [8 * i] }]); } },
  candy: { name: '糖果', apply: (img, i) => { img.brightness(0.08 * i); img.color([{ apply: 'saturate', params: [28 * i] }]); } },
  coldgrey: { name: '冷灰', apply: (img, i) => { img.color([{ apply: 'desaturate', params: [30 * i] }]); temperature(img, Math.round(-12 * i)); } },
```

- [ ] **Step 2: 把新 id 纳入 hasIntensity**

`jimpFilters.js` 的 `hasIntensity` 数组（约 62 行）加入 `'fresh', 'candy', 'coldgrey'`：
```js
export const hasIntensity = (id) => ['bright', 'contrast', 'soften', 'vivid', 'fade', 'warm', 'cool', 'film', 'fresh', 'candy', 'coldgrey'].includes(id);
```

- [ ] **Step 3: babel 校验**

Run: `node -e "require('@babel/core').transformFileSync('src/services/enhance/jimpFilters.js')"`
Expected: 无报错

- [ ] **Step 4: 合成图量化验证（确认三个滤镜真改变像素）**

`scripts/test/showcase-filters.test.js`：解码 → 套 fresh/candy/coldgrey → 比较前后均值变化非 0（candy 饱和↑、coldgrey 蓝通道相对↑、fresh 亮度↑）。沿用现有 jimp 测试手法（Jimp 构造色值 0xRRGGBBAA，alpha 必须 255）。
```js
const Jimp = require('jimp');
(async () => {
  const { applyJimpFilterToBase64 } = require('../../src/services/enhance/jimpFilters.js'); // 经 babel 加载，见 Task1 load()
  const img = new Jimp(8, 8, 0x808080ff);
  const b64 = await img.getBase64Async(Jimp.MIME_JPEG);
  for (const id of ['fresh', 'candy', 'coldgrey']) {
    const out = await applyJimpFilterToBase64(b64.split(',')[1], id, 1);
    const o = await Jimp.read(Buffer.from(out.split(',')[1], 'base64'));
    const before = Jimp.intToRGBA(img.getPixelColor(4, 4));
    const after = Jimp.intToRGBA(o.getPixelColor(4, 4));
    console.log(id, before, '→', after);
  }
})();
```
（用 Task 1 的 `load()` 经 babel 加载 jimpFilters；纯断言可选，肉眼确认数值变化即可。）

- [ ] **Step 5: 提交**

```bash
git add src/services/enhance/jimpFilters.js scripts/test/showcase-filters.test.js
git commit -m "feat(showcase): jimp 新增 fresh/candy/coldgrey 滤镜预设"
```

---

## Task 3: 模板注册表

**Files:**
- Create: `src/config/showcaseTemplates.js`

- [ ] **Step 1: 写注册表（27 模板，一期消费字段）**

结构：每项 `{ id, name, category, globalFilter, interval, transition, intro, outro }`（intro/outro 为含 `{{var}}` 的文案字符串，空串表示无该卡）。从用户提供的 27 模板规格转录 globalFilter / clipRules.defaultDuration→interval / clipRules.transition / intro.text / outro.text。完整 27 条数据见 spec 附带的用户规格；逐条填入，例如：
```js
export const SHOWCASE_TEMPLATES = Object.freeze([
  { id: 'wedding_eternal_vow', name: '婚礼·永恒誓约', category: '情感纪念', globalFilter: 'warm_cream', interval: 3.5, transition: 'soft_dissolve', intro: '{{name1}} ❤ {{name2}}', outro: '{{date}}' },
  { id: 'travel_distant_memory', name: '旅游·远方记忆', category: '旅行生活', globalFilter: 'high_saturation', interval: 2.2, transition: 'slide', intro: '{{destination}}', outro: '{{date}} · 旅行的意义' },
  { id: 'ontheroad_diary', name: '在路上·公路日记', category: '旅行生活', globalFilter: 'film_vintage', interval: 1.8, transition: 'flash', intro: 'ON THE ROAD', outro: '' },
  { id: 'study_growth_track', name: '学习·成长轨迹', category: '学习成长', globalFilter: 'fresh_clean', interval: 2.0, transition: 'fade', intro: '{{goal}}', outro: '坚持，终有回响' },
  { id: 'life_daily_fragments', name: '生活·日常碎片', category: '旅行生活', globalFilter: 'japanese_soft', interval: 2.5, transition: 'soft_dissolve', intro: '{{date}} 的小确幸', outro: '生活，慢慢来' },
  // … 其余 22 条按用户规格同结构转录（birthday/baby/sport/graduation/goods/newyear/christmas/midautumn/food探店/coffee/recipe/pet/couple/family/childhood/career/brand/event/hiking/fitness 等）
]);

export function getTemplate(id) {
  return SHOWCASE_TEMPLATES.find((tpl) => tpl.id === id) || null;
}
export default SHOWCASE_TEMPLATES;
```

- [ ] **Step 2: babel 校验**

Run: `node -e "require('@babel/core').transformFileSync('src/config/showcaseTemplates.js')"`
Expected: 无报错

- [ ] **Step 3: 计数断言（确认 27 条且字段齐全）**

Run（用 Task 1 load()）: 断言 `SHOWCASE_TEMPLATES.length === 27` 且每条有 id/globalFilter/interval/transition。
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/config/showcaseTemplates.js
git commit -m "feat(showcase): 27 模板数据注册表"
```

---

## Task 4: showcases 表加 items 列 + 读写

**Files:**
- Modify: `src/services/ImageStorageService.js`（建表段、迁移段 migrateAddCameraSettings、saveShowcase、listShowcases）

- [ ] **Step 1: 建表加 items 列**

`CREATE TABLE IF NOT EXISTS showcases` 内 `coverId TEXT` 之后加 `,\n        items TEXT`。

- [ ] **Step 2: 迁移补旧库 items 列**

在 `migrateAddCameraSettings()` 里、coverId 迁移块之后，复制同样的 PRAGMA→ALTER 块，把 `coverId` 换成 `items`：
```js
    try {
      const pr = await this.db.executeSql('PRAGMA table_info(showcases)');
      const ti = pr && pr.length > 0 ? pr[0] : null;
      let has = false;
      if (ti && ti.rows) { for (let i = 0; i < ti.rows.length; i++) { if (ti.rows.item(i).name === 'items') { has = true; break; } } }
      if (!has) { await this.db.executeSql('ALTER TABLE showcases ADD COLUMN items TEXT'); logger.debug('✅ 迁移完成：showcases.items 已添加'); }
    } catch (e) { if (!(e.message && e.message.includes('duplicate column'))) logger.warn('⚠️ 迁移 showcases.items 出错:', e?.message); }
```

- [ ] **Step 3: saveShowcase 写 items**

把 INSERT 改为含 items 列（10 列）：
```js
        'INSERT OR REPLACE INTO showcases (id, name, description, imageIds, mode, interval, musicPath, createdAt, coverId, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [sc.id, sc.name || '', sc.description || '', JSON.stringify(sc.imageIds || []), sc.mode || 'fade', sc.interval || 3, sc.musicPath || '', sc.createdAt || new Date().toISOString(), sc.coverId || '', sc.items ? JSON.stringify(sc.items) : '']
```

- [ ] **Step 4: listShowcases 解析 items**

在 `out.push({ ...row, imageIds: ids })` 前解析 items：
```js
          let items = null;
          try { if (row.items) items = JSON.parse(row.items); } catch (_) {}
          out.push({ ...row, imageIds: ids, items });
```

- [ ] **Step 5: babel 校验 + 提交**

Run: `node -e "require('@babel/core').transformFileSync('src/services/ImageStorageService.js')"`
```bash
git add src/services/ImageStorageService.js
git commit -m "feat(showcase): showcases 加 items 列（模板生成资源）+ 读写迁移"
```

---

## Task 5: MomentsScreen 解析 items → 图片对象

**Files:**
- Modify: `src/screens/mobile/MomentsScreen.mobile.js`（load 里时刻秀解析块）

- [ ] **Step 1: items 优先解析**

把时刻秀 map 改为：有 items 用 items（asset 项构造 {id,uri}，album 项查 byId），否则回退 imageIds：
```js
        setShowcases(list.map((sc) => {
          let images;
          if (Array.isArray(sc.items) && sc.items.length) {
            images = sc.items.map((it) => {
              if (it.kind === 'asset') return { id: `asset_${it.uri}`, uri: it.uri };
              return byId.get(it.imageId);
            }).filter(Boolean);
          } else {
            images = sc.imageIds.map((id) => byId.get(id)).filter(Boolean);
          }
          const cover = (sc.coverId && images.find((i) => i.id === sc.coverId)) || images[0];
          return { ...sc, images, cover };
        }).filter((sc) => sc.images.length > 0));
```

- [ ] **Step 2: babel 校验 + 提交**

Run: `node -e "require('@babel/core').transformFileSync('src/screens/mobile/MomentsScreen.mobile.js')"`
```bash
git add src/screens/mobile/MomentsScreen.mobile.js
git commit -m "feat(showcase): Moments 解析 items（asset/album）→ 图片对象，播放/导出零改动"
```

---

## Task 6: 标题卡组件

**Files:**
- Create: `src/components/shared/ShowcaseTitleCard.js`

- [ ] **Step 1: 写标题卡 View（9:16，背景图 + 标题/副标题）**

```js
import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { getUri } from '../../adapters/WebAdapters';

/** 标题卡：9:16 容器，背景取一张图（暗化）+ 居中标题/副标题。供 view-shot 截图。 */
export default function ShowcaseTitleCard({ bgImage, title, subtitle, color = '#FFFFFF', width = 270, height = 480 }) {
  return (
    <View style={[styles.card, { width, height }]}>
      {bgImage ? <Image source={{ uri: getUri(bgImage) || bgImage?.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <View style={[StyleSheet.absoluteFill, styles.scrim]} />
      <View style={styles.center}>
        {title ? <Text style={[styles.title, { color }]} numberOfLines={3}>{title}</Text> : null}
        {subtitle ? <Text style={[styles.subtitle, { color }]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  card: { backgroundColor: '#000', overflow: 'hidden' },
  scrim: { backgroundColor: 'rgba(0,0,0,0.4)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  title: { fontSize: 26, fontWeight: '800', textAlign: 'center', letterSpacing: 1 },
  subtitle: { fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 12, opacity: 0.92 },
});
```

- [ ] **Step 2: babel 校验 + 提交**

Run: `node -e "require('@babel/core').transformFileSync('src/components/shared/ShowcaseTitleCard.js')"`
```bash
git add src/components/shared/ShowcaseTitleCard.js
git commit -m "feat(showcase): 标题卡组件（供 view-shot 截图）"
```

---

## Task 7: 模板套用服务

**Files:**
- Create: `src/services/showcase/templateApply.js`

**说明：** 套滤镜（jimp）+ 组装 items。标题卡的 view-shot 截图依赖 UI ref，无法在纯 service 里截 —— 故 service 负责滤镜+组装，标题卡截图由 ShowcaseCreate（Task 8）传入 `captureTitleCard(spec)` 回调。service 形如：

- [ ] **Step 1: 实现 applyTemplate**

```js
/**
 * templateApply —— 选模板保存时预生成：逐张套滤镜→缓存图；intro/outro 经回调截标题卡；
 * 组装 items（标题卡/滤镜图均为 {kind:'asset', uri}）。返回 { items, interval, mode }。
 */
import { RNFS, getUri } from '../../adapters/WebAdapters';
import ImageProcessor from '../ImageProcessor';
import { applyJimpFilterToBase64 } from '../enhance/jimpFilters';
import { mapFilter, mapTransition, fillSlots } from './filterMap';
import { getTemplate } from '../../config/showcaseTemplates';

const DIR = () => `${RNFS.CachesDirectoryPath}/showcase_assets`;

async function readResizedBase64(uri, max = 1080) {
  const r = await ImageProcessor.resizeImage(uri, max, max * 2, { maintainAspectRatio: true, outputFormat: 'jpeg', quality: 90 });
  const p = (r && r.uri || uri).replace(/^file:\/\//, '');
  return RNFS.readFile(p, 'base64');
}

/**
 * @param templateId 模板 id
 * @param albumImages 选中的相册图对象数组（含 id/uri）
 * @param slots { name, date }
 * @param captureTitleCard async ({ title, subtitle, bgImage }) => assetUri  // 由 UI 提供
 * @param onProgress (done, total) => void
 * @returns { items, interval, mode } | null
 */
export async function applyTemplate(templateId, albumImages, slots, captureTitleCard, onProgress) {
  const tpl = getTemplate(templateId);
  if (!tpl) return null;
  const dir = `${DIR()}/sc_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await RNFS.mkdir(dir);
  const fm = mapFilter(tpl.globalFilter);
  const items = [];
  const photos = albumImages.filter((i) => i && !String(i.mimeType || '').startsWith('video/'));
  const total = photos.length + 2;
  let done = 0;

  // 片头标题卡
  const introText = fillSlots(tpl.intro, slots);
  if (introText && captureTitleCard) {
    const uri = await captureTitleCard({ title: introText, subtitle: '', bgImage: photos[0] });
    if (uri) items.push({ kind: 'asset', uri });
  }
  onProgress && onProgress(++done, total);

  // 逐张套滤镜
  for (const img of photos) {
    const src = getUri(img) || img.uri;
    let outUri;
    if (fm) {
      const b64 = await readResizedBase64(src, 1080);
      const dataUrl = await applyJimpFilterToBase64(b64, fm.jimpId, fm.intensity);
      outUri = `${dir}/f_${items.length}.jpg`;
      await RNFS.writeFile(outUri, dataUrl.split(',')[1], 'base64');
    } else {
      // 无滤镜：直接拷一份（保证 items 自洽、删时刻清缓存）
      const r = await ImageProcessor.resizeImage(src, 1080, 1920, { maintainAspectRatio: true, outputFormat: 'jpeg', quality: 90 });
      outUri = `${dir}/f_${items.length}.jpg`;
      await RNFS.copyFile((r.uri || src).replace(/^file:\/\//, ''), outUri);
    }
    items.push({ kind: 'asset', uri: `file://${outUri}` });
    onProgress && onProgress(++done, total);
  }

  // 片尾标题卡
  const outroText = fillSlots(tpl.outro, slots);
  if (outroText && captureTitleCard) {
    const uri = await captureTitleCard({ title: outroText, subtitle: '', bgImage: photos[photos.length - 1] });
    if (uri) items.push({ kind: 'asset', uri });
  }
  onProgress && onProgress(++done, total);

  return { items, interval: tpl.interval || 3, mode: mapTransition(tpl.transition) };
}

export default { applyTemplate };
```

- [ ] **Step 2: babel 校验 + 提交**

Run: `node -e "require('@babel/core').transformFileSync('src/services/showcase/templateApply.js')"`
```bash
git add src/services/showcase/templateApply.js
git commit -m "feat(showcase): 模板套用服务（滤镜预生成 + 组装 items）"
```

---

## Task 8: ShowcaseCreate 集成模板选择 + 离屏标题卡截图

**Files:**
- Modify: `src/screens/mobile/ShowcaseCreateScreen.mobile.js`

- [ ] **Step 1: 引入依赖 + state**

顶部 import：
```js
import { captureRef } from 'react-native-view-shot';
import ShowcaseTitleCard from '../../components/shared/ShowcaseTitleCard';
import { SHOWCASE_TEMPLATES } from '../../config/showcaseTemplates';
import { applyTemplate } from '../../services/showcase/templateApply';
```
组件内加：
```js
const [templateId, setTemplateId] = useState('');
const [applying, setApplying] = useState(null); // {done,total} | null
const titleCardRef = useRef(null);
const [cardSpec, setCardSpec] = useState(null); // 离屏待截标题卡
```

- [ ] **Step 2: 离屏标题卡渲染 + 截图回调**

在 return 的根 View 末尾（绝对定位、屏幕外）渲染一个待截卡：
```jsx
<View style={{ position: 'absolute', left: -10000, top: 0 }} collapsable={false}>
  {cardSpec ? (
    <View ref={titleCardRef} collapsable={false}>
      <ShowcaseTitleCard title={cardSpec.title} subtitle={cardSpec.subtitle} bgImage={cardSpec.bgImage} />
    </View>
  ) : null}
</View>
```
截图回调（渲染→等一拍→captureRef→写文件返回 uri）：
```js
const captureTitleCard = (spec) => new Promise((resolve) => {
  setCardSpec(spec);
  setTimeout(async () => {
    try {
      const uri = await captureRef(titleCardRef, { format: 'jpg', quality: 0.92, result: 'tmpfile' });
      resolve(uri.startsWith('file://') ? uri : `file://${uri}`);
    } catch (e) { logger.warn('标题卡截图失败:', e?.message || e); resolve(null); }
    finally { setCardSpec(null); }
  }, 350);
});
```

- [ ] **Step 3: 模板选择行 UI**

在预览条下方插入横滑模板 chip 行（无模板 + 各模板）：选中即 `setTemplateId(id)` 并把该模板 interval/mode 预填（chip 仍可改）。
```jsx
<Text style={[styles.label, { color: c.label }]}>{t('showcase.templateLabel', { defaultValue: '模板（可选）' })}</Text>
<ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
  <Chip active={!templateId} label={t('showcase.noTemplate', { defaultValue: '无模板' })} onPress={() => setTemplateId('')} />
  {SHOWCASE_TEMPLATES.map((tpl) => (
    <Chip key={tpl.id} active={templateId === tpl.id} label={tpl.name}
      onPress={() => { setTemplateId(tpl.id); setIntervalSec(tpl.interval || 3); }} />
  ))}
</ScrollView>
```

- [ ] **Step 4: 保存时套用模板**

在 `save()` 里、构造 saveShowcase 参数前，若选了模板则套用：
```js
let templateItems = null; let saveMode = mode; let saveInterval = interval;
if (templateId) {
  setApplying({ done: 0, total: imgs.length + 2 });
  const slots = { name: n, date: (() => { const im = imgs.find((i) => i.takenAt || i.timestamp); const ts = im && (im.takenAt || im.timestamp); const d = ts ? new Date(ts) : new Date(); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; })() };
  const res = await applyTemplate(templateId, imgs, slots, captureTitleCard, (done, total) => setApplying({ done, total }));
  setApplying(null);
  if (res) { templateItems = res.items; saveMode = res.mode; saveInterval = res.interval; }
}
```
saveShowcase 参数加 `items: templateItems, mode: saveMode, interval: saveInterval`（无模板时 items 为 null，走原 imageIds 逻辑）。

- [ ] **Step 5: 套用进度提示**

保存按钮区或悬浮提示展示 `applying` 时「正在套用模板 {done}/{total}」。

- [ ] **Step 6: i18n + babel 校验**

`{zh,en}/common.json` 的 showcase 段加 `templateLabel`/`noTemplate`/`applyingTemplate`。
Run: `node -e "require('@babel/core').transformFileSync('src/screens/mobile/ShowcaseCreateScreen.mobile.js')"`、JSON.parse 校验两 locale。

- [ ] **Step 7: 提交**

```bash
git add src/screens/mobile/ShowcaseCreateScreen.mobile.js src/i18n/locales/zh/common.json src/i18n/locales/en/common.json
git commit -m "feat(showcase): 创建页模板选择 + 保存套用（滤镜+标题卡）"
```

---

## Task 9: 删时刻清缓存（防泄漏）

**Files:**
- Modify: `src/services/ImageStorageService.js`（deleteShowcase）

- [ ] **Step 1: 删 showcase 时清其 items 资源目录**

`deleteShowcase(id)` 删库前，先读该 showcase 的 items，unlink 每个 asset 文件的父目录（`showcase_assets/sc_*`）。最简：删库后扫 `showcase_assets` 目录清理孤儿（实现时按 RNFS 能力，逐 asset unlink 即可）。
```js
// 删库前：取 items → unlink 资源
try {
  const [r] = await this.storage.db.executeSql('SELECT items FROM showcases WHERE id = ?', [id]);
  const row = r && r.rows && r.rows.length ? r.rows.item(0) : null;
  if (row && row.items) {
    const items = JSON.parse(row.items);
    for (const it of items) { if (it.kind === 'asset' && it.uri) { try { await RNFS.unlink(it.uri.replace(/^file:\/\//, '')); } catch (_) {} } }
  }
} catch (_) {}
```

- [ ] **Step 2: babel 校验 + 提交**

```bash
git add src/services/ImageStorageService.js
git commit -m "feat(showcase): 删时刻秀时清理模板生成的缓存资源"
```

---

## Task 10: 真机端到端验证 + 发版

- [ ] **Step 1: iOS/安卓装机各跑一遍**

选「婚礼·永恒誓约」+3 张图 → 保存（看「正在套用模板 x/y」进度）→ 应用内播放：暖色滤镜生效、片头「名称 ❤ 名称」、片尾日期、转场淡入、单图 3.5s。安卓与 iOS 应用内均见效果。iOS 导出 MP4 含滤镜图+首尾标题卡。删该时刻秀 → 缓存目录清空。旧（无 items）时刻秀播放/导出不受影响。无模板创建仍正常。

- [ ] **Step 2: 发版**

bump 5 处版本号 + README 更新日志 + BuildInfo → 分支 PR → 安卓 build job 绿 → 合并 → CI 出 Release。

---

## 关键风险
1. **view-shot 离屏截图时序**：渲染→截图需等一拍（350ms）+ 背景图加载。若空截，加大延时或在 Image onLoad 后再截。最大不确定项。
2. **保存耗时**：jimp 逐张串行，20 张约 20-40s，进度条覆盖；超大相册建议提示。
3. **缓存空间**：每时刻多存一份滤镜图 + 2 标题卡，删时清理（Task 9）。
4. **27 模板数据转录**：需逐条从用户规格填准 globalFilter/interval/transition/intro/outro。
