import { NativeModules } from 'react-native';
import { getUri, RNFS, logger } from '../../adapters/WebAdapters';
import UnifiedDataService from '../UnifiedDataService';
import { runCaptionFirstPass } from './captionFirstPass';

export async function runScannerCaptionFirst(scanner, images, config, platform) {
  scanner.totalImagesToBeClassified = images.length;
  let result;
  try {
    result = await runCaptionFirstPass(images, {
      config,
      shouldStop: () => !!scanner._stopRequested,
      save: rows => UnifiedDataService.batchUpdateClassification(rows, false),
      resolveImage: async image => {
        if (String(image.mimeType || '').startsWith('video/')) {
          const frame = platform === 'ios'
            ? await NativeModules.PhotoKitModule.extractVideoFrame(String(image.uri || '').replace(/^ph:\/\//, ''))
            : await NativeModules.MediaStoreModule.extractVideoFrame(image.uri || String(image.id || ''));
          return { uri: frame, cleanup: () => RNFS.unlink(frame.replace(/^file:\/\//, '')) };
        }
        return { uri: getUri(image) || image.uri };
      },
      onProgress: async (stage, done, total, state) => {
        scanner.imagesClassified = state.processedCount;
        const progressStage = platform === 'android' && stage === 'classifying_local' ? 'remote_inference' : stage;
        await scanner.sendProgressMessage(progressStage, done, total, scanner.imagesClassified, images.length);
      },
    });
  } finally {
    try { await UnifiedDataService.imageCache.refreshCache(); }
    catch (error) { logger.warn('Caption-first cache refresh:', error?.message || error); }
  }
  scanner.imagesClassified = result.processedCount;
  await scanner.sendProgressMessage('completed', result.processedCount, images.length, result.processedCount, images.length);
  return result;
}
