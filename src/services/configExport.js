/**
 * configExport — 配置导出脱敏（框架无关纯函数）
 *
 * 导出 / 备份 / 分享配置前调用，剥离任何敏感痕迹：
 *   - 递归删除任意层级中名为 `apiKey` 的字段（防御：理论上不该存在，真实 Key 在 SecureKeyStore）
 *   - 可选剥离 `apiKeyRef`（引用本身不含密钥，但会暴露用了哪些服务）
 *   - 默认不改动其它配置（models / baseURL / model 等保持原样）
 *
 * 由 fork 的 ConfigService.sanitizeForExport 直接调用即可（见 ConfigService.diff.md 第 3 节）。
 */

/** 默认要剥离的敏感字段名（小写精确匹配） */
const SECRET_KEYS = new Set(['apikey', 'api_key', 'secret', 'password', 'token', 'accesstoken', 'access_token']);

/**
 * @param {object} settings - 完整配置对象
 * @param {object} [opts]
 * @param {boolean} [opts.stripKeyRefs=false] - 是否同时剥离 apiKeyRef（更严格）
 * @param {string[]} [opts.extraSecretKeys]   - 追加要剥离的字段名
 * @returns {object} 脱敏后的深拷贝（不修改入参）
 */
export function sanitizeForExport(settings, opts = {}) {
  if (settings == null || typeof settings !== 'object') return settings;

  const secrets = new Set(SECRET_KEYS);
  if (opts.stripKeyRefs) secrets.add('apikeyref');
  for (const k of opts.extraSecretKeys || []) secrets.add(String(k).toLowerCase());

  const seen = new WeakSet();
  const scrub = (node) => {
    if (Array.isArray(node)) return node.map(scrub);
    if (node && typeof node === 'object') {
      if (seen.has(node)) return undefined; // 防循环引用
      seen.add(node);
      const out = {};
      for (const [key, value] of Object.entries(node)) {
        if (secrets.has(key.toLowerCase())) continue; // 丢弃敏感字段
        out[key] = scrub(value);
      }
      return out;
    }
    return node;
  };

  return scrub(settings);
}

export default sanitizeForExport;
