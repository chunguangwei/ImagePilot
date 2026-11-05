import { captionModelReady, captionModelPaths } from './lfmCaptionModel';
import { prepareImageFile, cleanupTmp, currentLang } from './vlmShared';
import { logger } from '../../adapters/WebAdapters';

let queue = Promise.resolve();
let busy = false;
export function isCaptionBusy() { return busy; }
export function captionPrompt(language) {
  return language === 'en'
    ? 'Describe the visible image in English in one or two concise sentences. Mention the main subjects, actions and setting. Only describe what is visible; do not guess names, identities or unreadable text. Output only the description.'
    : '请用中文一到两句话简洁描述图片中可见的主体、动作和场景。只描述实际可见内容，不猜测姓名、身份或看不清的文字。只输出图片描述，不要前言。';
}
/** A separate pass: caller must release EmbeddingGemma before entering. No network fallback. */
export function runCaptionPass(images, options = {}) {
  const task = queue.then(() => run(images, options));
  queue = task.catch(() => {});
  return task;
}
async function run(images, { config, save, resolveImage = async image => ({ uri: image.uri }), shouldStop = () => false, onProgress = () => {} }) {
  const result = { generated: 0, failed: 0, stopped: false };
  if (!config?.enabled || !images.length) return result;
  if (shouldStop()) return { ...result, stopped: true };
  if (!(await captionModelReady())) return { ...result, skipped: 'model-missing' };
  let context;
  let timer;
  busy = true;
  try {
    const { initLlama } = require('llama.rn');
    const paths = captionModelPaths();
    context = await initLlama({ model: paths.model, n_ctx: 2048, n_batch: 256, n_threads: 2, n_gpu_layers: 0, use_mmap: true, ctx_shift: false });
    if (!(await context.initMultimodal({ path: paths.projector, use_gpu: false }))) throw new Error('LFM vision initialization failed');
    let stopSent = false;
    let completing = false;
    timer = setInterval(() => {
      if (completing && shouldStop() && !stopSent) { stopSent = true; Promise.resolve(context.stopCompletion()).catch(() => {}); }
    }, 250);
    const language = ['zh', 'en'].includes(config.language) ? config.language : currentLang();
    for (let i = 0; i < images.length; i++) {
      if (shouldStop()) { result.stopped = true; break; }
      let source; let tmp;
      try {
        source = await resolveImage(images[i]);
        if (!source?.uri) throw new Error('Image unavailable');
        tmp = await prepareImageFile(source.uri, 512);
        await context.clearCache(true); // LFM recurrent state must not leak across images.
        if (shouldStop()) { result.stopped = true; break; }
        completing = true;
        const output = await context.completion({
          messages: [{ role: 'user', content: [{ type: 'text', text: captionPrompt(language) }, { type: 'image_url', image_url: { url: tmp } }] }],
          n_predict: 160, temperature: 0.1, top_p: 0.9, repeat_penalty: 1.1,
          stop: ['<|im_end|>', '<|endoftext|>'],
        });
        if (shouldStop()) { result.stopped = true; break; }
        const text = String(output?.text || '').replace(/<\|[^>]+\|>/g, '').trim();
        if (!text) throw new Error('Empty caption');
        const saved = await save(images[i], text);
        if (saved?.success === false || saved?.updatedCount === 0 || saved?.failedCount > 0) throw new Error('Caption save failed');
        result.generated++;
      } catch (e) {
        result.failed++;
        logger.warn(`[LFM caption] ${e?.message || e}`);
      } finally {
        completing = false;
        if (tmp) await cleanupTmp(tmp).catch(() => {});
        if (source?.cleanup) await source.cleanup().catch(() => {});
      }
      await onProgress(i + 1, images.length);
    }
  } catch (e) {
    result.failed = images.length - result.generated;
    logger.warn(`[LFM caption] ${e?.message || e}`);
  } finally {
    if (timer) clearInterval(timer);
    if (context) await context.release().catch(e => logger.warn(`[LFM release] ${e?.message || e}`));
    busy = false;
  }
  return result;
}
