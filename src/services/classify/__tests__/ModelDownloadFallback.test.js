const mockFiles=new Map();
const mockFs={DocumentDirectoryPath:'/docs',exists:jest.fn(async p=>mockFiles.has(p)),stat:jest.fn(async p=>{if(!mockFiles.has(p))throw Error('missing');return {size:mockFiles.get(p)}}),mkdir:jest.fn(async()=>{}),unlink:jest.fn(async p=>mockFiles.delete(p)),moveFile:jest.fn(async(a,b)=>{mockFiles.set(b,mockFiles.get(a));mockFiles.delete(a)}),read:jest.fn(async()=> 'R0dVRg=='),hash:jest.fn(async()=> 'good'),downloadFile:jest.fn(),stopDownload:jest.fn()};
jest.mock('react-native-fs',()=>mockFs);
jest.mock('react-native',()=>({Platform:{OS:'android'},NativeModules:{}}));
jest.mock('../../../adapters/WebAdapters',()=>({logger:{warn:jest.fn(),debug:jest.fn()}}));
const {ensureLargeModel}=require('../classifierModelSource');
const url='https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/model.gguf';
beforeEach(()=>{mockFiles.clear();jest.clearAllMocks();mockFs.hash.mockResolvedValue('good');mockFs.downloadFile.mockImplementation(o=>({promise:Promise.resolve().then(()=>{mockFiles.set(o.toFile,2000000);return {statusCode:200}})}));});
test('large models switch from failed international source to domestic source',async()=>{
 mockFs.downloadFile.mockImplementationOnce(()=>({promise:Promise.reject(Error('blocked'))}));
 await ensureLargeModel('model.gguf',url,null,{expectedBytes:2000000,expectedSha256:'good'});
 expect(mockFs.downloadFile).toHaveBeenCalledTimes(2);expect(mockFs.downloadFile.mock.calls[1][0].fromUrl).toContain('modelscope.cn');
});
test('a bad checksum retries another source instead of loading corrupt weights',async()=>{
 mockFs.hash.mockResolvedValueOnce('bad').mockResolvedValueOnce('good');
 await ensureLargeModel('model.gguf',url,null,{expectedBytes:2000000,expectedSha256:'good'});
 expect(mockFs.downloadFile).toHaveBeenCalledTimes(2);
});
test('user cancellation never starts the fallback source',async()=>{
 mockFs.downloadFile.mockImplementationOnce(()=>({promise:Promise.reject(Error('E_ABORTED'))}));
 await expect(ensureLargeModel('model.gguf',url)).rejects.toThrow('E_ABORTED');expect(mockFs.downloadFile).toHaveBeenCalledTimes(1);
});
test('oversized local weights are not treated as a completed download',async()=>{
 mockFiles.set('/docs/classify_models/model.gguf',2000001);
 await ensureLargeModel('model.gguf',url,null,{expectedBytes:2000000});
 expect(mockFs.downloadFile).toHaveBeenCalled();
});
test('an HTTP error page is not resumed as the prefix of the next model source',async()=>{
 mockFs.downloadFile.mockImplementationOnce(o=>({promise:Promise.resolve().then(()=>{mockFiles.set(o.toFile,16);return {statusCode:404}})}));
 await ensureLargeModel('model.gguf',url,null,{expectedBytes:2000000});
 expect(mockFs.downloadFile.mock.calls[1][0].headers?.Range).toBeUndefined();
});
test('short HTTP 200 error page is discarded before healthy fallback resumes',async()=>{
 mockFs.read.mockImplementation(async p=>mockFiles.get(p)===16 ? 'PGh0bWw+' : 'R0dVRg==');
 mockFs.downloadFile.mockImplementationOnce(o=>({promise:Promise.resolve().then(()=>{mockFiles.set(o.toFile,16);return {statusCode:200}})}));
 await ensureLargeModel('model.gguf',url,null,{expectedBytes:2000000});
 expect(mockFs.downloadFile.mock.calls[1][0].headers?.Range).toBeUndefined();
});
test('a legitimate interrupted GGUF prefix remains resumable across sources',async()=>{
 mockFs.read.mockResolvedValue('R0dVRg==');
 mockFs.downloadFile.mockImplementationOnce(o=>({promise:Promise.resolve().then(()=>{mockFiles.set(o.toFile,1000000);throw Error('connection lost')})}));
 await ensureLargeModel('model.gguf',url,null,{expectedBytes:2000000});
 expect(mockFs.downloadFile.mock.calls[1][0].headers.Range).toBe('bytes=1000000-');
});
