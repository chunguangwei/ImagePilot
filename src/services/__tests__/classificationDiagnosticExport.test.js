jest.mock('react-native-fs',()=>({CachesDirectoryPath:'/cache',writeFile:jest.fn(async()=>{})}));
jest.mock('react-native',()=>({Platform:{OS:'android'},NativeModules:{MultiImageShareModule:{shareFile:jest.fn(async()=>{})}},Share:{share:jest.fn(async()=>{})}}));
const fs=require('react-native-fs');
const {Platform,NativeModules,Share}=require('react-native');
const {exportClassificationDiagnostic}=require('../classificationDiagnosticExport');
beforeEach(()=>{jest.clearAllMocks();Platform.OS='android';});
test('writes full UTF-8 diagnostics to a txt attachment on Android',async()=>{
 const report={model:'embeddinggemma2',diagnostics:{categories:Array.from({length:500},(_,i)=>({id:i,text:'完整中文诊断'}))}};
 const path=await exportClassificationDiagnostic(report,'分类诊断');
 expect(path).toMatch(/^\/cache\/imagepilot-classification-.*\.txt$/);
 const [written,content,encoding]=fs.writeFile.mock.calls[0];expect(written).toBe(path);expect(encoding).toBe('utf8');
 expect(JSON.parse(content.replace(/^\uFEFF/,''))).toEqual({model:'embeddinggemma2',...report.diagnostics});
 expect(NativeModules.MultiImageShareModule.shareFile).toHaveBeenCalledWith(path,'text/plain','分类诊断');
 expect(Share.share).not.toHaveBeenCalled();
});
test('iOS shares a file URL without the diagnostic text in the message',async()=>{
 Platform.OS='ios';const path=await exportClassificationDiagnostic({model:'embeddinggemma2'},'Diagnostics');
 expect(Share.share).toHaveBeenCalledWith({title:'Diagnostics',url:`file://${path}`});
 expect(NativeModules.MultiImageShareModule.shareFile).not.toHaveBeenCalled();
});
test('write failure is surfaced and does not launch a share sheet',async()=>{
 fs.writeFile.mockRejectedValueOnce(new Error('disk full'));
 await expect(exportClassificationDiagnostic({model:'embeddinggemma2'},'Diagnostics')).rejects.toThrow('disk full');
 expect(Share.share).not.toHaveBeenCalled();expect(NativeModules.MultiImageShareModule.shareFile).not.toHaveBeenCalled();
});
