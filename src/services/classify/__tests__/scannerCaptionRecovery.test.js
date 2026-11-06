jest.mock('react-native', () => ({ NativeModules: {}, Platform: { OS: 'android' } }));
jest.mock('../../../adapters/WebAdapters', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }, getUri: image => image.uri }));
jest.mock('../../UnifiedDataService', () => ({ readSettings: jest.fn(async () => ({ embeddingCaption: { enabled: true } })), readImagesByCategory: jest.fn(async () => []), readAllImages: jest.fn(async () => []), migrateUnclassifiedVideos: jest.fn(), batchUpdateClassification: jest.fn(async () => ({ success: true, updatedCount: 1 })), imageCache: { buildCache: jest.fn(), refreshCache: jest.fn() } }));
jest.mock('../../ImageClassifierService', () => jest.fn());
jest.mock('../../ImageProcessor', () => ({}));
jest.mock('../../ImageSimilarityService', () => jest.fn());
jest.mock('../../CityLocationService', () => ({}));
jest.mock('../../similarityDetectionPhase', () => ({}));
jest.mock('../../../adapters/ScanServiceAdapter', () => ({ ScanService: { stop: jest.fn() } }));
jest.mock('../../../i18n', () => ({}));
jest.mock('../../ClipVectorIndexService', () => ({ requestStop: jest.fn() }));
jest.mock('../classifyByTier', () => ({ readActiveTier: async () => 'embeddinggemma2', classifyImageByTier: jest.fn(async () => ({ success: true, engine: 'embeddinggemma2', classificationAccepted: true, topPrediction: { appCategory: 'electronics' } })) }));
jest.mock('../EmbeddingGemmaClassifier', () => ({ disposeEmbeddingGemma: jest.fn() }));
jest.mock('../LfmCaptionService', () => ({ runCaptionPass: jest.fn(async (images, options) => {
  for (const image of images) await options.save(image, 'description');
  return { generated: images.length, stopped: false };
}) }));
const data = require('../../UnifiedDataService');
const { classifyImageByTier } = require('../classifyByTier');
const { runCaptionPass } = require('../LfmCaptionService');
const { disposeEmbeddingGemma } = require('../EmbeddingGemmaClassifier');
const row = id => ({ id, uri: `file://${id}`, category: 'electronics', mobileNetV3Detections: { embedding: { model: 'embeddinggemma2', caption: { state: 'pending' } } } });
for (const platform of ['android', 'ios']) {
  const Scanner = require(`../../GalleryScannerService.${platform}`).default;
  describe(platform, () => {
    let scanner;
    beforeEach(() => { jest.clearAllMocks(); data.readAllImages.mockResolvedValue([]); scanner = new Scanner(); scanner.sendProgressMessage = jest.fn(); });
    test('resumes saved caption work with zero unclassified images', async () => {
      data.readAllImages.mockResolvedValue([row('interrupted')]);
      await scanner._classifyAllNAImagesByLocalOnnxJS(null, null);
      expect(classifyImageByTier).not.toHaveBeenCalled();
      expect(runCaptionPass.mock.calls[0][0][0].id).toBe('interrupted');
      expect(data.batchUpdateClassification.mock.calls[0][0][0].message).toBe('description');
    });
    test('flushes a bounded batch before classifying the rest, with no overlapping models', async () => {
      const images = Array.from({ length: 10 }, (_, i) => ({ id: String(i), uri: `file://${i}` }));
      await scanner._classifyAllNAImagesByLocalOnnxJS(null, images);
      expect(runCaptionPass.mock.calls.map(call => call[0].length)).toEqual([8, 2]);
      expect(disposeEmbeddingGemma.mock.invocationCallOrder[0]).toBeLessThan(runCaptionPass.mock.invocationCallOrder[0]);
      expect(runCaptionPass.mock.invocationCallOrder[0]).toBeLessThan(classifyImageByTier.mock.invocationCallOrder[8]);
    });
    test('reclassification does not overwrite an existing description', async () => {
      await scanner._classifyAllNAImagesByLocalOnnxJS(null, [{ id: 'manual', uri: 'file://manual', message: 'My caption' }]);
      expect(runCaptionPass).not.toHaveBeenCalled();
      expect(data.batchUpdateClassification.mock.calls[0][0][0]).not.toHaveProperty('message');
      expect(data.batchUpdateClassification.mock.calls[0][0][0].mobileNetV3Detections.embedding.caption.state).toBe('preserved');
    });
    test('stop during classification preserves pending state and resumes next run', async () => {
      data.batchUpdateClassification.mockImplementationOnce(async () => { scanner._stopRequested = true; return { success: true, updatedCount: 1 }; });
      await scanner._classifyAllNAImagesByLocalOnnxJS(null, [{ id: 'stopped', uri: 'file://stopped' }]);
      expect(runCaptionPass).not.toHaveBeenCalled();
      const saved = data.batchUpdateClassification.mock.calls[0][0][0];
      expect(saved.mobileNetV3Detections.embedding.caption.state).toBe('pending');
      data.readAllImages.mockResolvedValue([saved]);
      await scanner._classifyAllNAImagesByLocalOnnxJS(null, null);
      expect(runCaptionPass).toHaveBeenCalledTimes(1);
    });
  });
}
