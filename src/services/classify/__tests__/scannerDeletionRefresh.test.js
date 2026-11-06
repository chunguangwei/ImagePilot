jest.mock('react-native', () => ({ NativeModules: { GalleryScanModule: { startBasicImageScan: jest.fn(async()=>({scanId:'delete-only',hasNewImages:false})) } }, NativeEventEmitter: jest.fn(), Platform: { OS: 'android' } }));
jest.mock('../../../adapters/WebAdapters', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }, getUri: image => image.uri }));
jest.mock('../../UnifiedDataService', () => ({ readSettings: jest.fn(async () => ({ embeddingCaption: { enabled: true } })), readImagesByCategory: jest.fn(async () => []), readAllImages: jest.fn(async () => []), migrateUnclassifiedVideos: jest.fn(), batchUpdateClassification: jest.fn(async () => ({ success: true, updatedCount: 1 })), imageCache: { buildCache: jest.fn(), refreshCache: jest.fn() } }));
jest.mock('../../ImageClassifierService', () => jest.fn());
jest.mock('../../ImageProcessor', () => ({}));
jest.mock('../../ImageSimilarityService', () => jest.fn());
jest.mock('../../CityLocationService', () => ({}));
jest.mock('../../similarityDetectionPhase', () => ({}));
jest.mock('../../../adapters/ScanServiceAdapter', () => ({ ScanService: { stop: jest.fn(),start:jest.fn(),updateProgress:jest.fn(),isRunning:jest.fn(async()=>false) } }));
jest.mock('../../../i18n', () => ({t:key=>key}));
jest.mock('../../ClipVectorIndexService', () => ({ requestStop: jest.fn() }));
jest.mock('../classifyByTier', () => ({ readActiveTier: jest.fn(async () => 'lfm'), classifyImageByTier: jest.fn(async () => ({ success: true, engine: 'embeddinggemma2', classificationAccepted: true, topPrediction: { appCategory: 'electronics' } })) }));
jest.mock('../EmbeddingGemmaClassifier', () => ({ disposeEmbeddingGemma: jest.fn() }));
jest.mock('../LfmClassifier', () => ({ runLfmClassification: jest.fn() }));

const data=require('../../UnifiedDataService');
const Scanner=require('../../GalleryScannerService.android').default;
test('deletion-only scan refreshes committed DB changes before reporting completion',async()=>{
 const scanner=new Scanner();scanner.setupEventListeners=jest.fn();scanner._cleanupScanState=jest.fn();jest.spyOn(scanner,'sendProgressMessage');
 const progress=jest.fn();
 await scanner.startScan({},progress);
 expect(data.imageCache.refreshCache).toHaveBeenCalledTimes(1);
 expect(scanner.sendProgressMessage).toHaveBeenLastCalledWith('completed',0,0,0,0);
 expect(data.imageCache.refreshCache.mock.invocationCallOrder[0]).toBeLessThan(progress.mock.invocationCallOrder.slice(-1)[0]);
});

test('deletion-only scan also refreshes when no progress callback is supplied',async()=>{
 jest.clearAllMocks();
 const scanner=new Scanner();scanner.setupEventListeners=jest.fn();scanner._cleanupScanState=jest.fn();
 await scanner.startScan({});
 expect(data.imageCache.refreshCache).toHaveBeenCalledTimes(1);
});

test('native startup failure is reported once without an unobserved scan rejection',async()=>{
 const native=require('react-native').NativeModules.GalleryScanModule;
 native.startBasicImageScan.mockRejectedValueOnce(new Error('Database cleanup failed: locked'));
 const scanner=new Scanner();scanner.setupEventListeners=jest.fn();scanner._cleanupScanState=jest.fn();
 await expect(scanner.startScan({})).rejects.toThrow('Database cleanup failed');
 await new Promise(resolve=>setImmediate(resolve));
 expect(scanner.scanReject).toBeNull();expect(scanner._cleanupScanState).toHaveBeenCalled();
});
