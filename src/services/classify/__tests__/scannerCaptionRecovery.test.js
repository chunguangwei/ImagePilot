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
jest.mock('../classifyByTier', () => ({ readActiveTier: jest.fn(async () => 'lfm'), classifyImageByTier: jest.fn(async () => ({ success: true, engine: 'embeddinggemma2', classificationAccepted: true, topPrediction: { appCategory: 'electronics' } })) }));
jest.mock('../EmbeddingGemmaClassifier', () => ({ disposeEmbeddingGemma: jest.fn() }));
jest.mock('../LfmClassifier', () => ({ runLfmClassification: jest.fn() }));
const data = require('../../UnifiedDataService');
const { classifyImageByTier, readActiveTier } = require('../classifyByTier');
const { runLfmClassification } = require('../LfmClassifier');
const row = id => ({ id, uri: `file://${id}`, category: 'electronics', mobileNetV3Detections: { lfm: { state: 'pending' } } });
for (const platform of ['android', 'ios']) {
  const Scanner = require(`../../GalleryScannerService.${platform}`).default;
  describe(platform, () => {
    let scanner;
    beforeEach(() => {
      jest.clearAllMocks();readActiveTier.mockResolvedValue('lfm');data.readAllImages.mockResolvedValue([]);
      data.batchUpdateClassification.mockResolvedValue({success:true,updatedCount:1});
      runLfmClassification.mockImplementation(async (images, options) => {
        let generated=0;
        for(const image of images){if(options.shouldStop()) break;await options.save(image,{topPrediction:{appCategory:'electronics'},vlmLabel:'A network rack'});generated++;await options.onProgress(generated);}
        return {generated,failed:0,stopped:options.shouldStop()};
      });
      scanner = new Scanner(); scanner.sendProgressMessage = jest.fn();
    });
    test('registers a multi-photo pending queue in one write before inference',async()=>{
      await scanner._classifyAllNAImagesByLocalOnnxJS(null,[row('a'),row('b')]);
      const pendingCalls=data.batchUpdateClassification.mock.calls.filter(([patches])=>patches.every(p=>p.mobileNetV3Detections?.lfm?.state==='pending'));
      expect(pendingCalls).toHaveLength(1);
      expect(pendingCalls[0][0].map(p=>p.id)).toEqual(['a','b']);
    });
    test('an uncertain result that fails to save is counted as failure, not retained uncertainty',async()=>{
      readActiveTier.mockResolvedValue('embeddinggemma2');
      classifyImageByTier.mockResolvedValueOnce({success:true,engine:'embeddinggemma2',classificationAccepted:false,topPrediction:null,predictions:[]});
      data.batchUpdateClassification.mockResolvedValueOnce({success:true,updatedCount:0,failedCount:1});
      const r=await scanner._classifyAllNAImagesByLocalOnnxJS(null,[{id:'missing',uri:'file://x',category:'NA'}]);
      expect(r.uncertainCount).toBe(0);expect(r.failedCount).toBe(1);expect(scanner.imagesClassified).toBe(0);
    });
    test('uncertain embedding results preserve pending or existing category and report uncertainty',async()=>{
      readActiveTier.mockResolvedValue('embeddinggemma2');
      classifyImageByTier.mockResolvedValueOnce({success:true,engine:'embeddinggemma2',classificationAccepted:false,topPrediction:null,predictions:[],similarity:0.67,margin:0.003});
      const r=await scanner._classifyAllNAImagesByLocalOnnxJS(null,[{id:'uncertain',uri:'file://x',category:'NA'}]);
      const saved=data.batchUpdateClassification.mock.calls.at(-1)[0][0];
      expect(saved.category).toBe('NA');expect(r.uncertainCount).toBe(1);expect(scanner.imagesClassified).toBe(0);
    });
    test('independent LFM resumes interrupted classified photos with zero NA images', async () => {
      data.readAllImages.mockResolvedValue([row('interrupted')]);
      const r=await scanner._classifyAllNAImagesByLocalOnnxJS(null, null);
      expect(r.processedCount).toBe(1);expect(classifyImageByTier).not.toHaveBeenCalled();
      expect(data.batchUpdateClassification.mock.calls.at(-1)[0][0]).toMatchObject({category:'electronics',message:'A network rack',mobileNetV3Detections:{lfm:{state:'complete'}}});
    });
    test('reclassification preserves manual descriptions and removes obsolete embedding evidence', async () => {
      await scanner._classifyAllNAImagesByLocalOnnxJS(null, [{...row('manual'),message:'My caption',mobileNetV3Detections:{embedding:{model:'embeddinggemma2'}}}]);
      const saved=data.batchUpdateClassification.mock.calls.at(-1)[0][0];expect(saved).not.toHaveProperty('message');expect(saved.mobileNetV3Detections).not.toHaveProperty('embedding');expect(saved.confidence).toBeNull();expect(saved.generalDetections).toEqual([]);
    });
    test('EmbeddingGemma ignores old enabled caption config and stays image-only', async () => {
      readActiveTier.mockResolvedValue('embeddinggemma2');data.readSettings.mockResolvedValue({embeddingCaption:{enabled:true}});
      await scanner._classifyAllNAImagesByLocalOnnxJS(null,[{id:'off',uri:'file://off'}]);
      expect(runLfmClassification).not.toHaveBeenCalled();expect(classifyImageByTier.mock.calls[0][2].caption).toBeUndefined();
    });
    test('stop preserves remaining selection as pending without half-saving category and description', async () => {
      scanner.sendProgressMessage.mockImplementation(async(stage,n)=>{if(n===1 && stage!=='initializing') scanner._stopRequested=true;});
      const images=[row('a'),row('b')];const r=await scanner._classifyAllNAImagesByLocalOnnxJS(null,images);
      expect(r.processedCount).toBe(1);expect(images[1].mobileNetV3Detections.lfm.state).toBe('pending');expect(images[0].message).toBe('A network rack');
    });
  });
}

test('selecting LFM can recover legacy interrupted caption work',()=>{
 const {pendingLfm}=require('../lfmScanner');
 const legacy={id:'legacy',category:'electronics',mobileNetV3Detections:{embedding:{model:'embeddinggemma2',caption:{state:'pending'}}}};
 expect(pendingLfm([legacy,{...legacy,id:'na',category:'NA'}])).toEqual([legacy]);
});
