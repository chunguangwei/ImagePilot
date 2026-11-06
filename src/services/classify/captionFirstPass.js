import { runCaptionPass } from './LfmCaptionService';
import { disposeEmbeddingGemma } from './EmbeddingGemmaClassifier';
import { classifyImageByTier } from './classifyByTier';
import { embeddingRecordFields } from './embeddingRecordFields';

export const SUBJECT_CAPTION_STYLE = 'subject-scene-v1';
function sourceKey(image) { return JSON.stringify([image.uri || image.id || '', image.size ?? null]); }
function captionText(image) {
  const caption = image.mobileNetV3Detections?.embedding?.caption;
  // User edits and legacy OCR-heavy descriptions are never treated as model evidence.
  return caption?.style === SUBJECT_CAPTION_STYLE && caption.sourceKey === sourceKey(image) && ['generated', 'preserved'].includes(caption.state)
    ? String(caption.text || '').trim() : '';
}
function metadata(image, changes) {
  return { ...image.mobileNetV3Detections, embedding: {
    ...image.mobileNetV3Detections?.embedding, model: 'embeddinggemma2', ...changes,
  } };
}

/** Caption -> persist -> release LFM -> classify original pixels + caption, in bounded batches. */
export async function runCaptionFirstPass(images, {
  config, save, resolveImage, shouldStop = () => false, onProgress = async () => {}, batchSize = 8,
}) {
  const result = { success: true, processedCount: 0, failedCount: 0, captionsGenerated: 0, captionsFailed: 0, fusionFailed: 0, stopped: false };
  if (!config?.enabled) return result;
  let done = 0;
  const total = images.length * 2;
  async function persist(image, patch) {
    const saved = await save([{ id: image.id, uri: image.uri, ...patch }]);
    if (saved?.success === false || saved?.updatedCount === 0 || saved?.failedCount > 0) throw new Error('Classification/caption persistence failed');
    Object.assign(image, patch); // Only advance in-memory state after durable success.
  }
  try {
    for (let start = 0; start < images.length && !shouldStop(); start += batchSize) {
      const batch = images.slice(start, start + batchSize).map(image => ({ ...image }));
      await disposeEmbeddingGemma();
      for (const image of batch) {
        if (shouldStop()) break;
        const existing = image.mobileNetV3Detections?.embedding?.caption;
        await persist(image, { mobileNetV3Detections: metadata(image, {
          classification: { state: 'pending' },
          caption: captionText(image) ? existing : { model: 'lfm2.5-vl-450m', style: SUBJECT_CAPTION_STYLE, state: 'pending' },
        }) });
      }
      if (shouldStop()) break;
      const missing = batch.filter(image => !captionText(image));
      done += batch.length - missing.length;
      await onProgress('caption_generation', done, total, result);
      if (missing.length) {
        const captions = await runCaptionPass(missing, {
          config, shouldStop, resolveImage,
          save: async (image, text) => {
            const preserve = !!String(image.message || '').trim();
            await persist(image, {
              ...(preserve ? {} : { message: text }),
              mobileNetV3Detections: metadata(image, { caption: {
                model: 'lfm2.5-vl-450m', style: SUBJECT_CAPTION_STYLE, state: preserve ? 'preserved' : 'generated', text, sourceKey: sourceKey(image),
              } }),
            });
            return { success: true, updatedCount: 1 };
          },
          onFailure: (image, detail) => persist(image, { mobileNetV3Detections: metadata(image, {
            caption: { model: 'lfm2.5-vl-450m', style: SUBJECT_CAPTION_STYLE, state: 'failed', ...detail },
          }) }),
          onProgress: async n => onProgress('caption_generation', done + n, total, result),
        });
        result.captionsGenerated += captions.generated;
        result.captionsFailed += captions.failed;
        done += captions.generated + captions.failed;
        if (captions.stopped || shouldStop()) { result.stopped = true; break; }
      }
      // runCaptionPass has released its native context before resolving.
      for (const image of batch) {
        if (shouldStop()) break;
        let source;
        try {
          source = await resolveImage(image);
          if (!source?.uri) throw new Error('Image unavailable');
          const classification = await classifyImageByTier(source.uri, 'embeddinggemma2', { caption: captionText(image) });
          if (classification?.success === false) throw new Error(classification.error || 'Classification failed');
          const fields = embeddingRecordFields(classification, true, image);
          fields.mobileNetV3Detections.embedding.caption = image.mobileNetV3Detections.embedding.caption;
          fields.mobileNetV3Detections.embedding.classification = {
            state: classification.fusionError ? 'fallback' : 'complete', mode: classification.classificationMode || 'image',
            imageOnlyCategory: classification.imageOnlyCategory,
            ...(classification.fusionError ? { fusionError: classification.fusionError } : {}),
          };
          await persist(image, { ...fields, category: classification.classificationAccepted ? classification.topPrediction?.appCategory || 'other' : 'other' });
          result.processedCount++;
          if (classification.fusionError) result.fusionFailed++;
        } catch (error) {
          result.failedCount++;
          await persist(image, { mobileNetV3Detections: metadata(image, {
            classification: { state: 'failed', error: String(error?.message || error).slice(0, 300) },
          }) });
        } finally {
          if (source?.cleanup) await source.cleanup().catch(() => {});
        }
        done++;
        await onProgress('classifying_local', done, total, result);
      }
    }
  } finally {
    await disposeEmbeddingGemma();
  }
  result.stopped = result.stopped || shouldStop();
  return result;
}
