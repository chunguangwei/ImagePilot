# INTEGRATION-REAL.md · 基于真实代码的 LLM Provider 集成蓝图

> 本文档由对**本仓库真实源码**的分析得出（非骨架假设），用于把「可配置云端 LLM 分类」接入 ImageClassifier。
> 分支 `feat/llm-provider` 已**纯新增**落地 LLM 模块（未改任何原文件、未动 main、未改 package.json）。
> ⚠️ 真实接线与验证须在本机 RN/Electron 环境完成（移动端构建/真机不在 CI 范围）。

---

## 0. 实测事实（与原骨架假设的差异）

| 项 | 真实情况（文件:行） | 对集成的影响 |
|---|---|---|
| 配置存储 | `ConfigService` 是**只读**静态配置（`public/initialSettings.json`，模型/类别映射），无 set/save | aiProvider 配置**不放** ConfigService |
| 用户可写设置 | `UnifiedDataService.readSettings()` (L1329) / `writeSettings()` (L1344) → `imageStorageService.saveSettings` | aiProvider 存 `settings.aiProvider`，已由 `adapters/UnifiedDataConfigService.js` 实现 |
| 本地分类 | `ImageClassifierService.classifyImageWithMobileNetV3(imageUri)` (L642)，返回 `{topPrediction:{class,probability}, confidence,...}` | 由 `adapters/localOnnxRunner.js` 封装为 onnxRunner |
| 类别映射 | `ImageClassifierService.mapMobileNetV3ToAppCategory(cls)` (L336) | 映射到 App 分类（注意与 schema 枚举对齐，见 §4） |
| 硬编码远程 | `getAPIConfig()`→`https://api.aifuture.net.cn` (L772)；`batchClassifyRemote()` (L1006)、`batchCheckCache()` (L822) | 这是原作者私有后端，**待剥离/路由**（见 §3） |
| 远程调用方 | `GalleryScannerService.js` L2441 `batchClassifyRemote(...)`、L2094 `batchCheckCache(...)` | Provider 路由加在此编排层 |
| 模块/测试 | CJS + babel，`npm test`=jest（babel-jest，**非**原生 ESM） | 新增模块用 import/export，babel 可转；勿照搬骨架的原生-ESM jest 配置 |
| 已装依赖 | onnxruntime ✅、AsyncStorage ✅；**缺** ajv / exifr / electron-store / react-native-keychain | 见 §5 |

---

## 1. 已落地（本分支纯新增，未被现有代码引用，故不影响现有构建）

```
src/services/llm/**                      Provider 抽象层 + 路由 + 加密 Key + 校验
src/services/llm/adapters/
  ├── UnifiedDataConfigService.js        🆕 aiProvider 配置 ←→ UnifiedDataService
  └── localOnnxRunner.js                 🆕 封装 classifyImageWithMobileNetV3
src/services/LocalClassifierService.js   本地兜底归一化
src/services/configExport.js             配置导出脱敏
src/services/image/ImagePreprocessor.js  1024px resize + base64
src/services/location/**                 语义地点 + 离线地理编码
src/services/exif/ExifService.js         exifr 读 GPS/时间
src/services/rename/SmartRenameService.js 智能改名
src/ui/config/**, src/ui/rename/**       配置页 controller/视图 + 改名 controller
```

## 2. 装配（在应用初始化处）

```js
import imageClassifier from './services/ImageClassifierService.js';
import configService from './services/llm/adapters/UnifiedDataConfigService.js';
import { createLocalOnnxRunner, localMapper } from './services/llm/adapters/localOnnxRunner.js';
import { LocalClassifierService } from './services/LocalClassifierService.js';
import { LLMProviderService } from './services/llm/LLMProviderService.js';
import { SecureKeyStore, createRNKeychainAdapter, createElectronAdapter } from './services/llm/SecureKeyStore.js';

// Key 存储：移动端 react-native-keychain；PC 端 electron safeStorage（见 §5）
const keyStore = new SecureKeyStore(/* 平台 adapter */);

const localClassifier = new LocalClassifierService({
  onnxRunner: createLocalOnnxRunner(imageClassifier),
  mapper: localMapper,
});

const llm = new LLMProviderService({ configService, keyStore, localClassifier, platform });
```

## 3. 接入点：GalleryScannerService 的远程分类路由

原流程在 `GalleryScannerService.js` L2441 直接 `this.imageClassifier.batchClassifyRemote(...)`。
按 `aiProvider.active` 路由（**只新增分支，保留原私有后端作为一种选择或移除**）：

```js
const aiCfg = await configService.getAIProviderConfig();
if (aiCfg.active === 'local-onnx') {
  // 本地：沿用原 ONNX 流程
} else {
  // 云端：改用用户配置的 Provider
  const inputs = await Promise.all(validResults.map(async (r) => ({
    id: r.hash,
    imageBase64: (await preprocessor.process({ uri: r.imageData?.uri })).base64,
  })));
  const prompt = aiCfg.promptOverride || loadPrompt(aiCfg.promptLang);
  const out = await llm.classifyBatch(inputs, prompt, { concurrent: aiCfg.concurrent });
  // 把 out[i].result（schema 字段）映射回本仓库分类结果结构后并入下游
}
```

> **剥离原作者商业链接**（计划 Week1 D1）：`getAPIConfig()` 的 `https://api.aifuture.net.cn`、
> `batchCheckCache` 私有缓存接口属原作者后端。若不再使用，应移除相关调用与 `getAPIConfig`；
> 若保留为"官方云"选项，需获授权并在 UI/文档明示。当前分支未改动它们。

## 4. 两处真实数据形态差异（务必处理）

1. **输入形态**：远程 Provider 吃 base64，本地 ONNX 吃 imageUri。`llm.classify` 内部 fallback 时会把传入参数转给本地；接线时请确保本地路径拿到的是**原始 imageUri**（建议 `classify` 调用层对本地/远程分别传参，或让 onnxRunner 接受 base64 并在内部走 `preprocessImageForMobileNetV3` 的 data: 支持）。
2. **类别体系**：`mapMobileNetV3ToAppCategory` 返回 App 自有分类，未必落在 `schema.json` 的 contentCategory 枚举内（single_person/social/pet/food/scenery/id_card/screenshot/qrcode/other）。两条路线择一：
   - 提供「App 分类 → schema 枚举」对照表（推荐，改 `localMapper`）；
   - 或扩展 `schema.json` 枚举以匹配 App 分类，并同步云端提示词。

## 5. 待装依赖（按平台）

```bash
npm i ajv exifr                 # ajv 缺失时 ResponseValidator 自动降级；exifr 用于 GPS/时间
npm i electron-store            # 仅 PC：SecureKeyStore electron adapter 持久化
npm i react-native-keychain     # 仅移动端：Key 加密存储（iOS 需 pod install）
```

## 6. 验证（须本机执行，CI 未覆盖）

- [ ] `npm i` 上述依赖后，应用可正常启动（移动端 + PC）
- [ ] 配置页能选 Provider、存 Key（不回显明文）、测试连接
- [ ] `active=local-onnx` 全离线分类正常（回归原行为）
- [ ] 配置云端 Key 后，扫描分类走 Provider；断网/错 Key 且 fallbackToLocal → 回退本地
- [ ] 导出配置不含明文 Key（`configExport.sanitizeForExport`）

## 7. 骨架仓库（含完整单测 / CI / 文档）

LLM 模块的独立骨架、132 个单测、CI 与文档见：<https://github.com/chunguangwei/ImagePilot>
本分支是把该骨架按真实代码接入本仓库的工作分支。
