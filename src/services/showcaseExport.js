/**
 * showcaseExport —— 时刻秀导出为视频（iOS + 安卓）
 *
 * 流程：选中图压成 1080 长边临时 JPEG（统一格式给原生）→ 原生 exportSlideshow
 * （iOS=PhotoKitModule/AVAssetWriter；安卓=MediaStoreModule/MediaCodec；两端均：图片序列 +
 * 交叉淡入 + 背景乐循环铺满，混音失败退纯视频）→ 返回 mp4 路径 → 调用方分享 → 清理临时图。
 * 视频片段第一版不进导出（混排转码复杂度高，二期）。
 */
import { NativeModules, Platform } from 'react-native';
import { RNFS, logger } from '../adapters/WebAdapters';
import ImageProcessor from './ImageProcessor';

/** 取当前平台的导出原生模块（iOS=PhotoKitModule / 安卓=MediaStoreModule），无则 null。 */
function exportModule() {
  const m = Platform.OS === 'ios' ? NativeModules.PhotoKitModule : NativeModules.MediaStoreModule;
  return (m && typeof m.exportSlideshow === 'function') ? m : null;
}

export function isExportSupported() {
  return !!exportModule();
}

/**
 * 导出时刻秀为 mp4。
 * @param {{images:Array, interval:number, musicPath:string}} sc 放映集（images 为完整记录）
 * @param {(phase:string, done:number, total:number)=>void} onPhase
 * @returns {Promise<string>} file:// mp4 路径（临时目录，分享后系统自清）
 */
export async function exportShowcaseVideo(sc, onPhase) {
  if (!isExportSupported()) throw new Error('导出功能在此设备不可用');
  const photos = (sc.images || []).filter((i) => i && !String(i.mimeType || '').startsWith('video/'));
  if (photos.length === 0) throw new Error('没有可导出的图片（视频片段暂不参与导出）');

  const { getUri } = require('../adapters/WebAdapters');
  const { aspectDims } = require('./showcase/filterMap');
  const { w: outW, h: outH } = aspectDims(sc.aspect); // 画幅 → 导出尺寸（9:16/16:9/1:1）
  const resizeLong = Math.max(outW, outH);
  const tmpDir = `${RNFS.CachesDirectoryPath}/showcase-export-${Date.now()}`;
  await RNFS.mkdir(tmpDir);
  const imagePaths = [];
  try {
    for (let i = 0; i < photos.length; i++) {
      if (onPhase) onPhase('prepare', i + 1, photos.length);
      const uri = getUri(photos[i]) || photos[i].uri;
      // 统一转成本地 JPEG（ph:// 等由 resizer 解；长边足够画布即可，原生按 w/h 等比黑底适配）
      // eslint-disable-next-line no-await-in-loop
      const resized = await ImageProcessor.resizeImage(uri, resizeLong, resizeLong, {
        maintainAspectRatio: true, outputFormat: 'jpeg', quality: 90,
      });
      if (resized && resized.uri) {
        const dest = `${tmpDir}/img_${String(i).padStart(3, '0')}.jpg`;
        // eslint-disable-next-line no-await-in-loop
        await RNFS.copyFile(resized.uri.replace(/^file:\/\//, ''), dest);
        imagePaths.push(dest);
      }
    }
    if (imagePaths.length === 0) throw new Error('图片准备失败');
    if (onPhase) onPhase('encode', 0, 1);
    const mod = exportModule();
    if (!mod) throw new Error('导出功能在此设备不可用');
    const out = await mod.exportSlideshow({
      imagePaths,
      interval: sc.interval || 3,
      musicPath: sc.musicPath || '',
      width: outW,
      height: outH,
    });
    if (onPhase) onPhase('done', 1, 1);
    return out;
  } finally {
    // 清理临时图（导出 mp4 在系统 tmp，分享后系统自清）
    try { await RNFS.unlink(tmpDir); } catch (_) {}
  }
}

export default { isExportSupported, exportShowcaseVideo };
