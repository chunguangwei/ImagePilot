jest.mock('../../adapters/WebAdapters',()=>({logger:{debug:jest.fn(),warn:jest.fn(),info:jest.fn()},Platform:{OS:'android'},RNFS:{exists:jest.fn(),unlink:jest.fn()},getLocalPath:x=>x.uri,getUri:x=>x.uri}));
jest.mock('react-native',()=>({Platform:{OS:'android',Version:33},NativeModules:{MediaStoreModule:{requestDeleteMedia:jest.fn()}}}));
jest.mock('../ImageStorageService',()=>jest.fn().mockImplementation(()=>({deleteImages:jest.fn(async()=>{}),getImages:jest.fn(async()=>[]),getSimilarityGroupIndex:jest.fn(async()=>({}))})));
jest.mock('../locationStorageService',()=>({}));
jest.mock('../ConfigService',()=>({}));
const data=require('../UnifiedDataService').default;
const {NativeModules}=require('react-native');
const native=NativeModules.MediaStoreModule.requestDeleteMedia;
const {RNFS}=require('../../adapters/WebAdapters');
beforeEach(()=>{
 jest.clearAllMocks();
 jest.spyOn(data.imageCache,'_getImageById').mockImplementation(id=>({id,uri:`content://media/external/images/media/${id}||/storage/${id}.jpg`}));
 jest.spyOn(data.imageCache,'refreshCache').mockResolvedValue();
 native.mockResolvedValue(true);
});
afterEach(()=>jest.restoreAllMocks());
test('single and batch Android media deletion request consent before touching database',async()=>{
 native.mockImplementation(async uris=>{expect(data.imageStorageService.deleteImages).not.toHaveBeenCalled();expect(uris).toHaveLength(2);return true;});
 const r=await data.writeDeleteImages(['1','2']);
 expect(native).toHaveBeenCalledTimes(1);
 expect(r).toMatchObject({success:true,successfulImageIds:['1','2']});
 expect(data.imageStorageService.deleteImages).toHaveBeenCalledWith(['1','2']);
 expect(data.imageCache.refreshCache).toHaveBeenCalled();expect(RNFS.unlink).not.toHaveBeenCalled();
});
test('declined consent preserves records and marks cancellation without retrying',async()=>{
 native.mockRejectedValue(Object.assign(new Error('declined'),{code:'E_DENIED'}));
 const r=await data.writeDeleteImages(['1']);
 expect(r).toMatchObject({success:false,cancelled:true,authorizationAttempted:true});
 expect(data.imageStorageService.deleteImages).not.toHaveBeenCalled();
});
test('failed native consent request never reports deletion success',async()=>{
 native.mockRejectedValue(new Error('No Activity'));
 const r=await data.writeDeleteImages(['1']);
 expect(r).toMatchObject({success:false,filesDeleted:0,filesFailed:1,authorizationAttempted:true});
 expect(data.imageStorageService.deleteImages).not.toHaveBeenCalled();
});

test('database cleanup failure is not presented as complete success',async()=>{
 data.imageStorageService.deleteImages.mockResolvedValueOnce({success:false,filesFailed:1});
 const r=await data.writeDeleteImages(['1']);
 expect(r.success).toBe(false);expect(r.authorizationAttempted).toBe(true);
 expect(data.imageCache.refreshCache).toHaveBeenCalled();
});
