jest.mock('../../adapters/WebAdapters', () => ({logger:{warn:jest.fn(),error:jest.fn()}}));
jest.mock('../UnifiedDataService', () => ({__esModule:true,default:{}}));
jest.mock('../../i18n', () => ({__esModule:true,default:{t:()=> 'Download search model'}}));
jest.mock('../classify/classifyByTier', () => ({readActiveClipModel:jest.fn(async()=>({id:'mobileclip2_s2',filename:'search.onnx',url:'https://example.org/search.onnx'}))}));
jest.mock('../classify/classifierModelSource', () => ({isClassifierModelDownloaded:jest.fn(),ensureClassifierModel:jest.fn(async()=>'/models/search.onnx')}));
import service from '../ClipVectorIndexService';
import {isClassifierModelDownloaded,ensureClassifierModel} from '../classify/classifierModelSource';
beforeEach(()=>jest.clearAllMocks());
test('retained search model works independently of the selected classification tier',async()=>{
 isClassifierModelDownloaded.mockResolvedValue(true);
 expect(await service.isReady()).toBe(true);
 expect(ensureClassifierModel).toHaveBeenCalledWith('search.onnx','https://example.org/search.onnx');
});
test('missing search model is not silently downloaded or replaced by a classifier',async()=>{
 isClassifierModelDownloaded.mockResolvedValue(false);
 expect(await service.isReady()).toBe(false);
 expect(ensureClassifierModel).not.toHaveBeenCalled();
});
