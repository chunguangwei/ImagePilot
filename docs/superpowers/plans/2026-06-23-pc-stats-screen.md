# PC 端相册报告（desktop）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 或 executing-plans。

**Goal:** 新建 StatsScreen.desktop.js 展示相册报告（调共享 getAlbumStats），desktop 加入口，建立 PC desktop 功能样板。

**Architecture:** 逻辑零改（getAlbumStats 共享）；新建 desktop 屏幕 + 平台解析 import + 首页入口。

**Tech Stack:** React Native（desktop 变体，web 平台）、共享 UnifiedDataService。

## Global Constraints
- 仅新增/改 desktop，**不改 getAlbumStats 等 service**、不改移动端。
- 一期**不做分享成图**（view-shot 桌面不可用，YAGNI）。
- i18n 复用移动端 StatsScreen 已有的 `stats.*` key（不新增）。
- `getAlbumStats()` 返回：`{ total, photos, videos, totalBytes, withDesc, videoSeconds, longestVideo, earliest, latest, years:[[year,count]...], topCategories:[[catId,count]...], topCities:[[city,count]...], busiestDay:{day,count}|null }`。

---

### Task 1: StatsScreen.desktop + 平台解析 + 首页入口

**Files:**
- Create: `src/screens/desktop/StatsScreen.desktop.js`
- Modify: `src/App.js`（StatsScreen import 改平台解析 + 确保 Stack.Screen 注册）
- Modify: `src/screens/desktop/HomeScreen.desktop.js`（加「相册报告」入口）

**实现第一步：核对 4 件事（读文件确认，别假设）**
1. **平台解析模式**：看 `src/App.js` 怎么 import 已有 desktop 版屏幕（如 `CategoryScreen`/`SettingsScreen`/`HomeScreen`）——是 `from './screens/CategoryScreen'`（无后缀，metro 按平台解析 .desktop/.mobile）还是别的。**StatsScreen 改成同款**：当前 line 37 `import StatsScreen from './screens/mobile/StatsScreen.mobile'` 强制 mobile，要改成与 CategoryScreen 同样的平台解析方式（很可能需要建 `src/screens/StatsScreen.js` 做 platform re-export，或直接改 import 路径——照 CategoryScreen 的实际做法来）。
2. **StatsScreen.mobile.js 的完整 UI**：读它（223 行），看它怎么用 `getAlbumStats()` 返回字段渲染卡片（总览/年度/Top分类/Top城市/拍照最多一天/最长视频/AI覆盖），desktop 版渲染**相同字段**。
3. **desktop 屏幕骨架/样式**：参考一个现有 desktop 屏幕（如 `EnhanceResultScreen.desktop.js` 1135 行）的：顶部返回栏、ScrollView 容器、卡片样式、`useIosColors`/主题、navigation prop 用法。新屏幕照此骨架。
4. **HomeScreen.desktop 入口区 + 导航路由名**：看 HomeScreen.desktop 现有功能入口（菜单/按钮）怎么 `navigation.navigate('xxx')`，相册报告入口照此加，路由名用 App.js 注册的名（如 `'Stats'`）。

- [ ] **Step 1: 核对上述 4 件事**（读 App.js / StatsScreen.mobile.js / 一个 desktop 屏幕 / HomeScreen.desktop）

- [ ] **Step 2: 新建 `src/screens/desktop/StatsScreen.desktop.js`**

照 desktop 屏幕骨架写：顶部返回栏 + ScrollView。`useEffect` 调 `UnifiedDataService.getAlbumStats()` → `setStats`。加载态 ActivityIndicator；`stats.total===0` 时友好空态。渲染卡片（用 Step 2 看到的移动端字段渲染逻辑，桌面**多列布局**用 flexDirection row + flexWrap 或网格）：
- 总览卡：photos / videos(+formatDuration(videoSeconds)) / fmtBytes(totalBytes) / 时间跨度(earliest~latest 年份) / AI 覆盖(withDesc/total %)
- 年度分布卡：years 各 [year,count]（列表或简单条）
- Top 分类卡：topCategories（catId → 用 `UnifiedDataService.configService.getCategoryDisplayName(catId, lang)` 转名）
- Top 城市卡：topCities
- 拍照最多的一天卡：busiestDay（day + count）
- 最长视频卡：longestVideo（有则展示时长）
i18n 复用移动端 `stats.*` key（title/overview/photos/videos/storage/span/aiCoverage 等，从 StatsScreen.mobile 抄 key 名）。**不做分享按钮**。

- [ ] **Step 3: App.js — StatsScreen 改平台解析 + 注册路由**

按 Step 1 看到的模式，把 line 37 的 `import StatsScreen from './screens/mobile/StatsScreen.mobile'` 改成平台解析（让 web 走 .desktop、ios/android 走 .mobile）。确保有 `<Stack.Screen name="Stats" component={StatsScreen} />`（若无则加，路由名与入口 navigate 的名一致）。

- [ ] **Step 4: HomeScreen.desktop 加入口**

在 HomeScreen.desktop 功能入口区加「相册报告」项，`onPress={() => navigation.navigate('Stats')}`，照现有入口样式/文案（i18n `stats.title`）。

- [ ] **Step 5: 校验**

```bash
node -e "require('@babel/core').transformFileSync('src/screens/desktop/StatsScreen.desktop.js')" >/dev/null 2>&1 && echo OK_NEW
node -e "require('@babel/core').transformFileSync('src/App.js')" >/dev/null 2>&1 && echo OK_APP
node -e "require('@babel/core').transformFileSync('src/screens/desktop/HomeScreen.desktop.js')" >/dev/null 2>&1 && echo OK_HOME
```
Expected: `OK_NEW` `OK_APP` `OK_HOME`

- [ ] **Step 6: 桌面端手动验证**（必做，UI 要真运行）

桌面端打开「相册报告」：统计数据正确（与移动端一致）；无照片时不报错；大屏布局正常；移动端 StatsScreen 不受影响（平台解析没串）。

- [ ] **Step 7: 提交**

```bash
git add src/screens/desktop/StatsScreen.desktop.js src/App.js src/screens/desktop/HomeScreen.desktop.js
git commit -m "feat(pc): 相册报告 desktop 页 + 入口（PC拉齐🟢首个）"
```

---

## Self-Review

**Spec 覆盖**：getAlbumStats 调用(Step 2)✓ 统计项展示(Step 2)✓ 大屏布局(Step 2)✓ 入口(Step 4)✓ 平台解析让 desktop 用专版(Step 3)✓ 不做分享(Global Constraints)✓ 样板价值(整个 Task 即样板)✓。

**关键风险**：平台解析改动（Step 3）若改错会影响移动端 StatsScreen——Step 6 验证移动端不受影响。**实现者务必先做 Step 1 核对 CategoryScreen 的实际平台解析方式**，照抄，别自创。

**Placeholder**：Step 1 的"核对"是有意的实现前调研（desktop 模式必须照现有的来），非占位；其余步骤均有具体动作。
