/**
 * categoryMapper — LLM schema 枚举 ↔ App 分类 ID 的双向映射
 *
 * 背景：LLM Provider 按 `prompts/schema.json` 输出 `contentCategory`（如 single_person /
 * social / pet / food / scenery / id_card / screenshot / qrcode / other），而上游
 * ImageClassifier 的 App 分类 ID（见 fork `public/initialSettings.json` 的
 * `categoryDisplayOrder` / `categoryNameMap`，由 `mapMobileNetV3ToAppCategory` 落地）
 * 是另一套命名：single_person / social_activities / travel_scenery / pets / foods /
 * idcard / screenshot / qrcode / other / NA。
 *
 * 9 个 schema 枚举里有 5 个与 App ID 不一致（social/pet/food/scenery/id_card），
 * 若不映射会被下游识别为未知分类而落入 other。本模块提供权威映射表 + 守卫，
 * 供 remoteClassifyRouter 作默认 `mapCategory` 使用。
 *
 * 纯数据 + 纯函数，可在骨架仓库单测；不依赖 RN/Electron 或 fork 运行时。
 * 注意：`NA`（待分类）是 App 内部状态，LLM 不会输出，故不在反向表中。
 */

/** App 分类 ID 全集（与 fork categoryDisplayOrder 对齐，含内部态 NA） */
export const APP_CATEGORY_IDS = Object.freeze([
  'single_person',
  'social_activities',
  'travel_scenery',
  'pets',
  'foods',
  'idcard',
  'screenshot',
  'qrcode',
  'other',
  'NA',
]);

/** LLM schema contentCategory 枚举 → App 分类 ID */
export const SCHEMA_TO_APP_CATEGORY = Object.freeze({
  single_person: 'single_person',
  social: 'social_activities',
  pet: 'pets',
  food: 'foods',
  scenery: 'travel_scenery',
  id_card: 'idcard',
  screenshot: 'screenshot',
  qrcode: 'qrcode',
  other: 'other',
});

/** App 分类 ID → LLM schema contentCategory 枚举（SCHEMA_TO_APP_CATEGORY 的反转） */
export const APP_TO_SCHEMA_CATEGORY = Object.freeze(
  Object.entries(SCHEMA_TO_APP_CATEGORY).reduce((acc, [schemaCat, appId]) => {
    acc[appId] = schemaCat;
    return acc;
  }, {}),
);

/**
 * 把 LLM 的 contentCategory 映射为 App 分类 ID。未知/空值 → 'other'（与上游兜底一致）。
 * @param {string} contentCategory schema.json 的 contentCategory 枚举值
 * @returns {string} App 分类 ID
 */
export function mapSchemaCategoryToApp(contentCategory) {
  if (!contentCategory) return 'other';
  return SCHEMA_TO_APP_CATEGORY[contentCategory] || 'other';
}

/**
 * 反向：把 App 分类 ID 映射回 LLM schema 枚举（用于按 App 分类构造 few-shot/对照）。
 * 未知 → 'other'。
 * @param {string} appCategoryId App 分类 ID
 * @returns {string} schema contentCategory 枚举值
 */
export function mapAppCategoryToSchema(appCategoryId) {
  if (!appCategoryId) return 'other';
  return APP_TO_SCHEMA_CATEGORY[appCategoryId] || 'other';
}

export default mapSchemaCategoryToApp;
