jest.mock('../../adapters/WebAdapters', () => ({logger:{debug:jest.fn(),info:jest.fn(),warn:jest.fn(),error:jest.fn()},getLocalPath:img=>img.uri || '',getUri:img=>img.uri,Platform:{OS:'android'}}));
jest.mock('../ImageStorageService',()=>jest.fn().mockImplementation(()=>({batchUpdateClassification:jest.fn(),batchUpdateImageCategory:jest.fn(),getImages:jest.fn(),getSimilarityGroupIndex:jest.fn(async()=>({}))})));
jest.mock('../locationStorageService',()=>({}));
jest.mock('../ConfigService',()=>({isConfigLoaded:()=>true,getCategoryNameMap:()=>({NA:{},electronics:{}}),isBuiltinCategoryHidden:()=>false}));
const data=require('../UnifiedDataService').default;
const cache=require('../GlobalImageCache').default;
beforeEach(async()=>{
 jest.clearAllMocks(); cache.imageStorageService=data.imageStorageService;cache.isLoaded=false;
 data.imageStorageService.getImages.mockResolvedValue([{id:'a',category:'NA',uri:'file:///a',timestamp:1}]);
 await cache.buildCache();
 data.imageStorageService.batchUpdateClassification.mockResolvedValue({success:true,updatedCount:1,failedCount:0});
});
test('a committed classification changes folder count, row and description without a full reload',async()=>{
 const listener=jest.fn();const off=data.addCacheListener(listener);
 const reads=data.imageStorageService.getImages.mock.calls.length;
 await data.batchUpdateClassification([{id:'a',category:'electronics',message:'Network rack'}],true);
 expect(cache.getCache().categoryCounts.electronics).toBe(1);
 expect(cache.getCache().categoryCounts.NA || 0).toBe(0);
 expect(cache.getCache().allImages[0].message).toBe('Network rack');
 expect(cache.getCache().recentImages[0].category).toBe('electronics');
 expect(listener).toHaveBeenCalledTimes(1);
 expect(data.imageStorageService.getImages.mock.calls.length).toBe(reads);
 off();
});
test('caption-only patches keep category and explicit null clears old confidence',async()=>{
 await data.batchUpdateClassification([{id:'a',message:'Short caption',confidence:null}],true);
 expect(cache.getCache().allImages[0]).toMatchObject({category:'NA',message:'Short caption',confidence:null});
});
test('a failed save never publishes an invented successful classification',async()=>{
 data.imageStorageService.batchUpdateClassification.mockResolvedValue({success:false,updatedCount:0,failedCount:1});
 await data.batchUpdateClassification([{id:'a',category:'electronics'}],true);
 expect(cache.getCache().allImages[0].category).toBe('NA');
});
test('partial success reloads actual records rather than publishing failed patches',async()=>{
 data.imageStorageService.batchUpdateClassification.mockResolvedValue({success:false,updatedCount:1,failedCount:1});
 data.imageStorageService.getImages.mockResolvedValue([{id:'a',category:'electronics',uri:'file:///a'},{id:'b',category:'NA',uri:'file:///b'}]);
 await data.batchUpdateClassification([{id:'a',category:'electronics'},{id:'b',category:'electronics'}],true);
 expect(cache.getCache().categoryCounts).toEqual({electronics:1,NA:1});
});
test.each([null,''])('empty category %s follows the database result rather than preserving stale category',async category=>{
 data.imageStorageService.getImages.mockResolvedValue([{id:'a',category,uri:'file:///a'}]);
 await data.batchUpdateClassification([{id:'a',category}],true);
 expect(cache.getCache().allImages[0].category).toBe(category);
});
test('URI-only writes resolve the actual database record',async()=>{
 data.imageStorageService.getImages.mockResolvedValue([{id:'a',category:'electronics',uri:'file:///a'}]);
 await data.batchUpdateClassification([{uri:'file:///a',category:'electronics'}],true);
 expect(cache.getCache().categoryCounts.electronics).toBe(1);
});
test('classification writes do not replace a URI that storage does not change',async()=>{
 await data.batchUpdateClassification([{id:'a',uri:'file:///temporary-resize',category:'electronics'}],true);
 expect(cache.getCache().allImages[0].uri).toBe('file:///a');
});

test('manual move updates source, destination, recent photo and subscribers immediately',async()=>{
 data.imageStorageService.batchUpdateImageCategory.mockResolvedValue({success:true,processed:1});
 const listener=jest.fn();const off=data.addCacheListener(listener);
 const result=await data.updateImagesCategory(['a'],'electronics');
 expect(result.success).toBe(true);
 expect(cache.getCache().categoryCounts).toEqual({electronics:1});
 expect(cache.getCache().recentImages[0]).toMatchObject({category:'electronics',confidence:'manual'});
 expect(listener).toHaveBeenCalledTimes(1);off();
});
test('failed manual move does not move the photo only in memory',async()=>{
 data.imageStorageService.batchUpdateImageCategory.mockResolvedValue({success:false,processed:0,errors:[{error:'disk full'}]});
 const result=await data.updateImagesCategory(['a'],'electronics');
 expect(result.success).toBe(false);
 expect(cache.getCache().allImages[0].category).toBe('NA');
});
test('partial manual move reloads actual rows and reports incomplete success',async()=>{
 data.imageStorageService.batchUpdateImageCategory.mockResolvedValue({success:true,processed:1});
 data.imageStorageService.getImages.mockResolvedValue([{id:'a',category:'electronics'},{id:'b',category:'NA'}]);
 const result=await data.updateImagesCategory(['a','b'],'electronics');
 expect(result.success).toBe(false);
 expect(cache.getCache().categoryCounts).toEqual({electronics:1,NA:1});
});
