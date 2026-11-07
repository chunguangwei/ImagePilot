jest.mock('../classify/lfmScanner',()=>({}));
jest.mock('react-native',()=>({NativeModules:{PhotoKitModule:{fetchAllPhotos:jest.fn(async()=>({items:[{id:'old-photo',uri:'ph://old-photo',fileName:'old.jpg'}]}))}},NativeEventEmitter:jest.fn(),Platform:{OS:'ios'}}));
jest.mock('../../adapters/WebAdapters',()=>({logger:{debug:jest.fn(),info:jest.fn(),warn:jest.fn()},RNFS:{},getUri:x=>x.uri}));
jest.mock('../UnifiedDataService',()=>({readAllImages:jest.fn(),writeImageDetailedInfo:jest.fn(async()=>{}),migrateUnclassifiedVideos:jest.fn()}));
jest.mock('../ImageClassifierService',()=>jest.fn());
jest.mock('../ImageProcessor',()=>jest.fn());
jest.mock('../ImageSimilarityService',()=>jest.fn());
jest.mock('../CityLocationService',()=>({}));
jest.mock('../similarityDetectionPhase',()=>({}));
jest.mock('../classify/classifyByTier',()=>({}));
jest.mock('../ClipVectorIndexService',()=>({isReady:async()=>false}));
import Scanner from '../GalleryScannerService.ios';
import data from '../UnifiedDataService';
beforeEach(()=>jest.clearAllMocks());
function scanner(){const s=Object.create(Scanner.prototype);s._emit=jest.fn();s._ensureAuthorization=async()=>true;s._saveScanCompletionInfo=async()=>{};s.enrichExifInfo=async()=>{};s.enrichLocationInfo=async()=>{};return s;}
test('full scan aborts without writing photos when existing records cannot be read',async()=>{
 data.readAllImages.mockRejectedValueOnce(new Error('database unavailable'));
 const result=await scanner().scanGalleryWithProgress();
 expect(result.success).toBe(false);expect(data.writeImageDetailedInfo).not.toHaveBeenCalled();
});
test('incremental changes abort without overwriting previous classifications when reading fails',async()=>{
 data.readAllImages.mockRejectedValueOnce(new Error('database unavailable'));
 await expect(scanner()._handlePhotoLibraryChange({changed:[{id:'old-photo',uri:'ph://old-photo'}]})).rejects.toThrow('database unavailable');
 expect(data.writeImageDetailedInfo).not.toHaveBeenCalled();
});
