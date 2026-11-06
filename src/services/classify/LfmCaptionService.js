import { cleanSubjectCaption } from './subjectCaption';
import { captionLanguage } from './captionLanguage';
import { captionModelReady, captionModelPaths } from './lfmCaptionModel';
import { prepareImageFile, cleanupTmp } from './vlmShared';
import { logger } from '../../adapters/WebAdapters';

let queue = Promise.resolve();
let busy = false;
export function isCaptionBusy() { return busy; }
export function captionPrompt(language) {
  return language === 'en'
    ? 'What is the main subject and setting? Answer in one English phrase of 8-12 words. Do not read any text in the image.'
    : '图片主要主体和场景是什么？只用一个中文短语回答，约15字，不转录图片中的文字。';
}
/** A separate pass: caller must release EmbeddingGemma before entering. No network fallback. */
export function runCaptionPass(images, options = {}) {
  const task = queue.then(() => run(images, options));
  queue = task.catch(() => {});
  return task;
}
async function run(images, { config, save, resolveImage = async image => ({ uri: image.uri }), shouldStop = () => false, onProgress = () => {}, onFailure = async () => {} }) {
  const result = { generated: 0, failed: 0, stopped: false };
  if (!config?.enabled || !images.length) return result;
  if (shouldStop()) return { ...result, stopped: true };
  const reportFailure = async (image, stage, error) => {
    const detail = { stage, error: String(error?.message || error).slice(0, 500) };
    logger.warn(`[LFM caption:${stage}] ${detail.error}`);
    try { await onFailure(image, detail); } catch (e) {
      logger.warn(`[LFM diagnostic save] ${e?.message || e}`);
    }
  };
  if (!(await captionModelReady())) {
    for (const image of images) await reportFailure(image, 'verify', 'Caption model files missing or checksum invalid');
    return { ...result, failed: images.length, skipped: 'model-missing' };
  }
  let stage = 'model';
  let attempted = 0;
  let context;
  let timer;
  busy = true;
  try {
    const { initLlama } = require('llama.rn');
    const paths = captionModelPaths();
    context = await initLlama({ model: paths.model, n_ctx: 2048, n_batch: 256, n_threads: 2, n_gpu_layers: 0, use_mmap: true, ctx_shift: false });
    stage = 'vision';
    if (!(await context.initMultimodal({ path: paths.projector, use_gpu: false }))) throw new Error('LFM vision initialization failed');
    let stopSent = false;
    let completing = false;
    timer = setInterval(() => {
      if (completing && shouldStop() && !stopSent) { stopSent = true; Promise.resolve(context.stopCompletion()).catch(() => {}); }
    }, 250);
    const language = captionLanguage();
    for (let i = 0; i < images.length; i++) {
      if (shouldStop()) { result.stopped = true; break; }
      let source; let tmp;
      attempted = i + 1;
      stage = 'image';
      try {
        source = await resolveImage(images[i]);
        if (!source?.uri) throw new Error('Image unavailable');
        tmp = await prepareImageFile(source.uri, 512);
        stage = 'inference';
        await context.clearCache(true); // LFM recurrent state must not leak across images.
        if (shouldStop()) { result.stopped = true; break; }
        completing = true;
        const output = await context.completion({
          messages: [{ role: 'user', content: [{ type: 'text', text: captionPrompt(language) }, { type: 'image_url', image_url: { url: tmp } }] }],
          n_predict: 40, temperature: 0.1, top_p: 0.9, penalty_repeat: 1.1,
          stop: ['<|im_end|>', '<|endoftext|>'],
        });
        if (shouldStop()) { result.stopped = true; break; }
        const text = cleanSubjectCaption(output?.text);
        if (!text) throw new Error('Empty caption');
        stage = 'save';
        const saved = await save(images[i], text);
        if (saved?.success === false || saved?.updatedCount === 0 || saved?.failedCount > 0) throw new Error('Caption save failed');
        result.generated++;
      } catch (e) {
        result.failed++;
        await reportFailure(images[i], stage, e);
      } finally {
        completing = false;
        if (tmp) await cleanupTmp(tmp).catch(() => {});
        if (source?.cleanup) await source.cleanup().catch(() => {});
      }
      await onProgress(i + 1, images.length);
    }
  } catch (e) {
    result.failed = images.length - result.generated;
    for (const image of images.slice(attempted)) await reportFailure(image, stage, e);
  } finally {
    if (timer) clearInterval(timer);
    if (context) await context.release().catch(e => logger.warn(`[LFM release] ${e?.message || e}`));
    busy = false;
  }
  return result;
}
