/**
 * templateApply —— 选模板保存时预生成：逐张套滤镜→缓存图；intro/outro 经回调截标题卡；
 * 组装 items（标题卡/滤镜图均为 {kind:'asset', uri}）。返回 { items, interval, mode }。
 *
 * 标题卡截图依赖 UI ref，无法在纯 service 里截 → 由调用方（ShowcaseCreate）传入
 * captureTitleCard(spec) 回调（渲染样式 View + view-shot）。
 */
import { RNFS, getUri, logger } from '../../adapters/WebAdapters';
import ImageProcessor from '../ImageProcessor';
import { applyJimpFilterToBase64 } from '../enhance/jimpFilters';
import { mapFilter, mapTransition, fillSlots } from './filterMap';
import { getTemplate } from '../../config/showcaseTemplates';

const ASSET_ROOT = () => `${RNFS.CachesDirectoryPath}/showcase_assets`;

async function readResizedBase64(uri, max = 1080) {
  const r = await ImageProcessor.resizeImage(uri, max, max * 2, {
    maintainAspectRatio: true, outputFormat: 'jpeg', quality: 90,
  });
  const p = ((r && r.uri) || uri).replace(/^file:\/\//, '');
  return RNFS.readFile(p, 'base64');
}

/**
 * @param {string} templateId
 * @param {Array} albumImages 选中相册图对象（含 id/uri）
 * @param {{name:string, date:string}} slots
 * @param {(spec:{title,subtitle,bgImage})=>Promise<string|null>} captureTitleCard
 * @param {(done:number,total:number)=>void} onProgress
 * @returns {Promise<{items:Array, interval:number, mode:string}|null>}
 */
export async function applyTemplate(templateId, albumImages, slots, captureTitleCard, onProgress) {
  const tpl = getTemplate(templateId);
  if (!tpl) return null;
  const dir = `${ASSET_ROOT()}/sc_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await RNFS.mkdir(dir);
  const fm = mapFilter(tpl.globalFilter);
  const items = [];
  const photos = (albumImages || []).filter((i) => i && !String(i.mimeType || '').startsWith('video/'));
  const total = photos.length + 2;
  let done = 0;

  // 片头标题卡
  const introText = fillSlots(tpl.intro, slots);
  if (introText && captureTitleCard) {
    try {
      const uri = await captureTitleCard({ title: introText, subtitle: '', bgImage: photos[0] });
      if (uri) items.push({ kind: 'asset', uri });
    } catch (e) { logger.warn('片头标题卡失败:', e?.message || e); }
  }
  onProgress && onProgress(++done, total);

  // 逐张套滤镜（无滤镜映射时直接拷一份，保证 items 自洽、删时可清）
  for (let idx = 0; idx < photos.length; idx++) {
    const img = photos[idx];
    const src = getUri(img) || img.uri;
    const outUri = `${dir}/f_${idx}.jpg`;
    try {
      if (fm) {
        const b64 = await readResizedBase64(src, 1080);
        const dataUrl = await applyJimpFilterToBase64(b64, fm.jimpId, fm.intensity);
        await RNFS.writeFile(outUri, dataUrl.split(',')[1], 'base64');
      } else {
        const r = await ImageProcessor.resizeImage(src, 1080, 1920, { maintainAspectRatio: true, outputFormat: 'jpeg', quality: 90 });
        await RNFS.copyFile(((r && r.uri) || src).replace(/^file:\/\//, ''), outUri);
      }
      items.push({ kind: 'asset', uri: `file://${outUri}` });
    } catch (e) {
      logger.warn('套滤镜失败，用原图:', e?.message || e);
      items.push({ kind: 'album', imageId: img.id }); // 兜底：退回相册引用
    }
    onProgress && onProgress(++done, total);
  }

  // 片尾标题卡
  const outroText = fillSlots(tpl.outro, slots);
  if (outroText && captureTitleCard) {
    try {
      const uri = await captureTitleCard({ title: outroText, subtitle: '', bgImage: photos[photos.length - 1] });
      if (uri) items.push({ kind: 'asset', uri });
    } catch (e) { logger.warn('片尾标题卡失败:', e?.message || e); }
  }
  onProgress && onProgress(++done, total);

  return { items, interval: tpl.interval || 3, mode: mapTransition(tpl.transition) };
}

export default { applyTemplate };
