/**
 * LocalClassifierService — 本地 ONNX 兜底分类
 *
 * 作用：把 A 仓库（ImageClassifier）已有的本地推理（YOLOv8s + MobileNetV3 + 身份证检测）
 * 封装成与远程 Provider 一致的归一化输出，供 LLMProviderService 的 fallbackToLocal 链路调用。
 *
 * 设计：
 *   1. 不重写推理逻辑 —— 通过注入 `onnxRunner` 复用上游已有实现（零侵入）。
 *   2. 输出对齐 prompts/schema.json 的 ClassifyResult，让上层无需区分 remote/local。
 *   3. onnxRunner 缺失时不崩溃：返回 source='unavailable' 的安全占位，便于 UI 提示。
 *
 * 与 LLMProviderService 的契约：
 *   LLMProviderService._classifyLocal() 会调用 `localClassifier.classify(imageBase64)`，
 *   期望返回**归一化结果对象本身**（不带 { source } 包装，包装由 Service 负责）。
 */

import { ResponseValidator } from './llm/ResponseValidator.js';

/**
 * @typedef {Object} OnnxRunner
 * @property {(imageBase64: string) => Promise<object>} infer
 *   返回上游原始推理结果（字段命名可能与 schema 不同，由 mapper 归一化）。
 */

const CATEGORY_ENUM = [
  'single_person',
  'social',
  'pet',
  'food',
  'scenery',
  'id_card',
  'screenshot',
  'qrcode',
  'other',
];
const COLOR_ENUM = ['blue', 'green', 'red', 'yellow', 'black', 'white', 'warm', 'cold', 'mixed'];

export class LocalClassifierService {
  /**
   * @param {Object} deps
   * @param {OnnxRunner} [deps.onnxRunner]  - 上游 ONNX 推理实现（注入）
   * @param {(raw: object) => object} [deps.mapper] - 把上游原始结果映射成 schema 字段
   * @param {ResponseValidator} [deps.validator]
   */
  constructor({ onnxRunner, mapper, validator } = {}) {
    this.onnxRunner = onnxRunner || null;
    this.mapper = mapper || LocalClassifierService.defaultMapper;
    this.validator = validator || new ResponseValidator();
  }

  /** 上游是否已接入推理实现 */
  get available() {
    return typeof this.onnxRunner?.infer === 'function';
  }

  /**
   * 单图本地分类。
   * @param {string} imageBase64 - 不带 data: 前缀的 base64（预处理后）
   * @returns {Promise<object>} 归一化 ClassifyResult（含 providerName:'local-onnx'）
   */
  async classify(imageBase64) {
    const start = Date.now();

    if (!this.available) {
      // 未接入推理：返回安全占位而非抛错，避免 fallback 再次失败导致整条链路崩溃。
      return this._placeholder('onnx_runner_not_configured', Date.now() - start);
    }

    let raw;
    try {
      raw = await this.onnxRunner.infer(imageBase64);
    } catch (err) {
      return this._placeholder(`onnx_infer_failed: ${err.message}`, Date.now() - start);
    }

    const normalized = this._normalize(this.mapper(raw || {}), Date.now() - start);

    // 本地结果也过一遍校验：不阻断，仅在不合法时把置信度压低并标注。
    const v = this.validator.validate(normalized);
    if (!v.ok) {
      normalized.confidence = Math.min(normalized.confidence, 0.3);
      normalized.description = normalized.description || `local result coerced: ${v.errors}`;
    }
    return normalized;
  }

  /**
   * 批量本地分类（受控串行——本地推理通常 CPU/NPU 受限，避免并发抢资源）。
   * @param {Array<{imageBase64: string, id?: string}>} images
   * @param {{onProgress?: (p:{done:number,total:number,current?:string})=>void}} [opts]
   */
  async classifyBatch(images, opts = {}) {
    const onProgress = opts.onProgress || (() => {});
    const out = [];
    for (let i = 0; i < images.length; i++) {
      const item = images[i];
      try {
        out.push({ id: item.id, ok: true, result: await this.classify(item.imageBase64) });
      } catch (err) {
        out.push({ id: item.id, ok: false, error: err.message });
      }
      onProgress({ done: i + 1, total: images.length, current: item.id });
    }
    return out;
  }

  // ============ 内部 ============

  _normalize(m, costMs) {
    const category = CATEGORY_ENUM.includes(m.contentCategory) ? m.contentCategory : 'other';
    const color = COLOR_ENUM.includes(m.colorTheme) ? m.colorTheme : 'mixed';
    let confidence = typeof m.confidence === 'number' ? m.confidence : 0.5;
    if (confidence < 0) confidence = 0;
    if (confidence > 1) confidence = 1;
    return {
      contentCategory: category,
      colorTheme: color,
      isScreenshot: !!m.isScreenshot || category === 'screenshot',
      isIDCard: !!m.isIDCard || category === 'id_card',
      confidence,
      description: typeof m.description === 'string' ? m.description : '',
      rawText: '',
      costMs,
      providerName: 'local-onnx',
      model: m.model || 'onnx',
    };
  }

  _placeholder(reason, costMs) {
    return {
      contentCategory: 'other',
      colorTheme: 'mixed',
      isScreenshot: false,
      isIDCard: false,
      confidence: 0,
      description: '',
      rawText: reason,
      costMs,
      providerName: 'local-onnx',
      model: 'unavailable',
      unavailable: true,
    };
  }

  /**
   * 默认 mapper —— 假定上游已用同名字段；接入真实 ONNX 时按其输出覆写。
   * 例：上游若给 { label, palette, score }，则传入
   *   mapper: (raw) => ({ contentCategory: raw.label, colorTheme: raw.palette, confidence: raw.score })
   */
  static defaultMapper(raw) {
    return {
      contentCategory: raw.contentCategory,
      colorTheme: raw.colorTheme,
      isScreenshot: raw.isScreenshot,
      isIDCard: raw.isIDCard,
      confidence: raw.confidence,
      description: raw.description,
      model: raw.model,
    };
  }
}

export default LocalClassifierService;
