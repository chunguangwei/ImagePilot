/**
 * loadOnnxSession — onnxruntime-react-native 多策略加载 helper
 *
 * 背景：iOS sim/真机上 InferenceSession.create(modelPath) 单次调用偶发
 * "Can't load a model: failed to load model"，但同样的文件能用 Uint8Array
 * 形式加载成功。和 ImageClassifierService 里 MobileNetV3 加载链路是同一个坑。
 *
 * 顺序：
 *   1) bare path（去掉 file:// 前缀，iOS 原生 onnxruntime 更喜欢 fs path）
 *   2) 原 path + sessionOptions
 *   3) Uint8Array（RNFS 读 base64 → Buffer → Uint8Array）兜底
 *
 * 各 runner（superRes / inpaint / matting / docDewarp）统一通过本函数加载。
 */

import * as ortNS from 'onnxruntime-react-native';

const ort = ortNS.default || ortNS;
const { InferenceSession } = ort;

export async function loadOnnxSession(modelPath, sessionOptions = {}) {
  if (!modelPath) throw new Error('loadOnnxSession: modelPath 为空');

  const errors = [];
  const isStr = typeof modelPath === 'string';
  const bare = isStr ? modelPath.replace(/^file:\/\//, '') : null;

  // try 1: bare path + 空 options（最常 work 的组合）
  if (bare) {
    try {
      return await InferenceSession.create(bare, {});
    } catch (e) { errors.push(`bare: ${e?.message || e}`); }
  }

  // try 2: 带 file:// 的原 path + 用户传入 options
  try {
    return await InferenceSession.create(modelPath, sessionOptions || {});
  } catch (e) { errors.push(`orig: ${e?.message || e}`); }

  // try 3: Uint8Array 兜底（读文件成内存 buffer 再 create）
  try {
    // eslint-disable-next-line global-require
    const RNFS = require('react-native-fs');
    const Buf = require('buffer').Buffer;
    const fsPath = bare || modelPath;
    const b64 = await RNFS.readFile(fsPath, 'base64');
    const u8 = new Uint8Array(Buf.from(b64, 'base64'));
    return await InferenceSession.create(u8, {});
  } catch (e) {
    errors.push(`buf: ${e?.message || e}`);
  }

  throw new Error(`InferenceSession.create 三策略全失败: ${errors.join(' | ')}`);
}

export default loadOnnxSession;
