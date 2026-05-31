/**
 * localOnnxRunner — 把本仓库现有的本地 ONNX 推理封装成 LocalClassifierService 的 onnxRunner
 *
 * 关键事实（本仓库实测）：
 *   - 本地分类入口：ImageClassifierService.classifyImageWithMobileNetV3(imageUri, options) (L642)
 *     返回 { success, predictions, validPredictions, topPrediction:{class,probability}, confidence, model }
 *   - 类别映射：ImageClassifierService.mapMobileNetV3ToAppCategory(mobileNetV3Class) (L336)
 *
 * 注意输入形态差异：
 *   远程 Provider 吃 base64；本地 ONNX 吃 imageUri（文件路径）。fallback 到本地时应透传
 *   **原始 imageUri**，而不是预处理后的 base64（详见 INTEGRATION-REAL.md「数据形态」一节）。
 *
 * 用法（依赖注入，避免对默认导出形态做假设）：
 *   import imageClassifier from '../../ImageClassifierService.js';
 *   import { createLocalOnnxRunner, localMapper } from './adapters/localOnnxRunner.js';
 *   import { LocalClassifierService } from '../LocalClassifierService.js';
 *   const local = new LocalClassifierService({
 *     onnxRunner: createLocalOnnxRunner(imageClassifier),
 *     mapper: localMapper,
 *   });
 */

/**
 * @param {object} imageClassifier - ImageClassifierService 实例
 * @returns {{infer: (imageUri:string)=>Promise<object>}}
 */
export function createLocalOnnxRunner(imageClassifier) {
  if (!imageClassifier || typeof imageClassifier.classifyImageWithMobileNetV3 !== 'function') {
    throw new Error('createLocalOnnxRunner: 需要传入带 classifyImageWithMobileNetV3 的 ImageClassifierService 实例');
  }
  return {
    async infer(imageUri) {
      const r = await imageClassifier.classifyImageWithMobileNetV3(imageUri);
      const top = r && r.topPrediction;
      const appCategory =
        top && typeof imageClassifier.mapMobileNetV3ToAppCategory === 'function'
          ? imageClassifier.mapMobileNetV3ToAppCategory(top.class)
          : 'other';
      // 原样带出，交给 localMapper 归一化为 schema 字段
      return { appCategory, confidence: (r && r.confidence) || 0, raw: r };
    },
  };
}

/**
 * 把 infer() 的原始结果映射到 schema.json 字段。
 * ⚠️ contentCategory 必须落在 schema 枚举内
 * （single_person|social|pet|food|scenery|id_card|screenshot|electronics|qrcode|other）。
 * 本仓库 mapMobileNetV3ToAppCategory 返回的是 App 自有分类，可能不在该枚举——
 * 不在则被 LocalClassifierService 归一化回 'other'。生产请提供 App 分类 → schema 的对照表，
 * 或扩展 schema.json 枚举以匹配 App 分类体系（详见 INTEGRATION-REAL.md）。
 */
export function localMapper(raw) {
  return {
    contentCategory: raw.appCategory,
    colorTheme: 'mixed',
    confidence: raw.confidence,
    description: '',
    model: 'mobilenetv3',
  };
}
