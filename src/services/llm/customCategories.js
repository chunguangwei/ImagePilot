/**
 * customCategories — 自定义分类（A 方案：LLM 按用户规则打标）
 *
 * 用户在设置里定义 [{ id, name, rule }]；分类时把这些追加进提示词，让大模型在
 * 内置分类之外，按规则把图片归入自定义分类。LLM 输出的 contentCategory 既可能是
 * 内置 schema 枚举，也可能是某个自定义 id —— resolveAppCategory 统一解析为 App 分类 id。
 *
 * 纯逻辑，可在骨架单测；fork 端 wireLLMRouting 读 settings.customCategories 后调用。
 */

import { mapSchemaCategoryToApp } from './adapters/categoryMapper.js';

/** 过滤出合法的自定义分类（需有 id + name；id 不与内置冲突由调用方保证） */
export function validCustomCategories(list = []) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const c of list) {
    if (!c || typeof c.id !== 'string' || !c.id.trim() || typeof c.name !== 'string' || !c.name.trim()) continue;
    const id = c.id.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: c.name.trim(), rule: typeof c.rule === 'string' ? c.rule.trim() : '' });
  }
  return out;
}

/**
 * 生成追加到分类提示词的「自定义分类」段；无自定义分类返回空串。
 * @param {Array<{id,name,rule}>} customCategories
 * @param {string} lang - 'zh' | 'en'
 */
export function buildCustomCategoryPromptSection(customCategories = [], lang = 'zh') {
  const valid = validCustomCategories(customCategories);
  if (!valid.length) return '';
  if (lang === 'en') {
    const lines = valid.map((c) => `  - ${c.id}: ${c.name}${c.rule ? ` — ${c.rule}` : ''}`);
    return (
      '\nUser-defined categories — if the image matches one of these rules, ' +
      'output that id in contentCategory (these take priority over the generic categories):\n' +
      lines.join('\n') +
      '\n'
    );
  }
  const lines = valid.map((c) => `  - ${c.id}：${c.name}${c.rule ? `——${c.rule}` : ''}`);
  return (
    '\n用户自定义分类——若图片符合以下任一规则，请在 contentCategory 中输出对应 id' +
    '（优先于上面的通用分类）：\n' +
    lines.join('\n') +
    '\n'
  );
}

/** 把基础提示词 + 自定义分类段拼成最终提示词 */
export function buildClassificationPrompt(basePrompt, customCategories = [], lang = 'zh') {
  return `${basePrompt}${buildCustomCategoryPromptSection(customCategories, lang)}`;
}

/** contentCategory 是否命中某个自定义分类 id */
export function isCustomCategoryId(id, customCategories = []) {
  return validCustomCategories(customCategories).some((c) => c.id === id);
}

/**
 * 把 LLM 的 contentCategory 解析为最终 App 分类 id：
 *   命中自定义 id → 直通；否则按内置 schema 枚举映射。
 */
export function resolveAppCategory(contentCategory, customCategories = []) {
  if (isCustomCategoryId(contentCategory, customCategories)) return contentCategory;
  return mapSchemaCategoryToApp(contentCategory);
}
