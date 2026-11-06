import { NativeModules } from 'react-native';
import { getUri, RNFS, logger } from '../../adapters/WebAdapters';
import UnifiedDataService from '../UnifiedDataService';
import { pendingCaptions } from './captionQueue';
import { runLfmClassification } from './LfmClassifier';

export function pendingLfm(images) {
  const legacy = new Set(pendingCaptions(images || []));
  return (images || []).filter(image => !['NA', 'NA_video'].includes(image.category)
    && (['pending', 'failed'].includes(image.mobileNetV3Detections?.lfm?.state) || legacy.has(image)));
}

export async function runScannerLfm(scanner, images, platform) {
  scanner.totalImagesToBeClassified = images.length;
  let processedCount = 0;
  let result;
  const timings = new Map();
  const save = async (image, patch) => {
    const r = await UnifiedDataService.batchUpdateClassification([{ id: image.id, uri: image.uri, ...patch }], true);
    if (r?.success === false || r?.updatedCount === 0 || r?.failedCount > 0) throw new Error('LFM result save failed');
    Object.assign(image, patch);
    return r;
  };
  const state = (image, value) => ({ ...image.mobileNetV3Detections, lfm: { model: 'smolvlm-500m-instruct', ...value } });
  try {
    // Queue the explicit selection too: a stopped reclassification must not vanish from recovery.
    const pending = images.map(image => ({ id: image.id, uri: image.uri,
      mobileNetV3Detections: state(image, { state: 'pending' }),
    }));
    if (pending.length) {
      const queued = await UnifiedDataService.batchUpdateClassification(pending, true);
      if (queued?.success === false || queued?.updatedCount === 0 || queued?.failedCount > 0) throw new Error('LFM queue save failed');
      images.forEach((image, index) => { image.mobileNetV3Detections = pending[index].mobileNetV3Detections; });
    }
    result = await runLfmClassification(images, {
      shouldStop: () => !!scanner._stopRequested,
      onTiming: (image, timing) => timings.set(image.id, timing),
      resolveImage: async image => {
        if (String(image.mimeType || '').startsWith('video/')) {
          const frame = platform === 'ios'
            ? await NativeModules.PhotoKitModule.extractVideoFrame(String(image.uri || '').replace(/^ph:\/\//, ''))
            : await NativeModules.MediaStoreModule.extractVideoFrame(image.uri || String(image.id || ''));
          return { uri: frame, cleanup: () => RNFS.unlink(frame.replace(/^file:\/\//, '')) };
        }
        return { uri: getUri(image) || image.uri };
      },
      save: async (image, classification) => {
        const preserve = !!String(image.message || '').trim();
        // Remove obsolete embedding evidence so the preview never presents old similarity as new LFM evidence.
        const detections = { lfm: { model: 'smolvlm-500m-instruct', state: 'complete', description: classification.vlmLabel, ...(timings.has(image.id) ? { timing: timings.get(image.id) } : {}) } };
        const r = await save(image, {
          category: classification.topPrediction.appCategory,
          confidence: null, idCardDetections: [], generalDetections: [],
          ...(!preserve ? { message: classification.vlmLabel } : {}),
          mobileNetV3Detections: detections,
        });
        processedCount++; scanner.imagesClassified = processedCount;
        return r;
      },
      onFailure: (image, detail) => save(image, { mobileNetV3Detections: state(image, { state: 'failed', error: detail.error }) }),
      onProgress: done => scanner.sendProgressMessage(platform === 'android' ? 'remote_inference' : 'classifying_local', done, images.length, processedCount, images.length),
    });
  } finally {
    try { await UnifiedDataService.imageCache.refreshCache(); }
    catch (e) { logger.warn('LFM cache refresh:', e?.message || e); }
  }
  await scanner.sendProgressMessage('completed', processedCount, images.length, processedCount, images.length);
  return { success: true, processedCount, failedCount: result.failed, stopped: result.stopped };
}
