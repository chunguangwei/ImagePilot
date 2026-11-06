// Development-only: six named fixture JPGs and official models in Documents; never bundle for release.
import React from 'react';
import { AppRegistry, Text } from 'react-native';
import RNFS from 'react-native-fs';
import ImageStorageService from '../src/services/ImageStorageService';
import UnifiedDataService from '../src/services/UnifiedDataService';
import Scanner from '../src/services/GalleryScannerService.ios';
import { captionLanguage } from '../src/services/classify/captionLanguage';
import { pendingLfm } from '../src/services/classify/lfmScanner';
const root = RNFS.DocumentDirectoryPath;
const report = { started: Date.now(), language: captionLanguage() };
async function run() {
  try {
    const llama = require('llama.rn'); const init = llama.initLlama;
    report.outputs=[];
    llama.initLlama=async opts=>{const ctx=await init(opts);const complete=ctx.completion.bind(ctx);ctx.completion=async params=>{report.grammar=params.grammar;const r=await complete(params);report.outputs.push(r.text);return r;};return ctx;};
    const store = new ImageStorageService(); await store.ensureInitialized();
    const settings = await UnifiedDataService.readSettings();
    await UnifiedDataService.writeSettings({ ...settings, classifierModelTier: 'lfm' });
    const images = [];
    for (let i=0;i<6;i++) {
      const uri=`file://${root}/lfm-standard-${i}.jpg`;
      if(await RNFS.exists(uri)) await RNFS.unlink(uri);
      await RNFS.copyFile(`${root}/${['rack','trophy','portrait','cat','food','group'][i%6]}.jpg`,uri);
      const image={id:`lfm-standard-${i}`,uri,fileName:`lfm-standard-${i}.jpg`,category:'other',message:null};
      await store.storage.addOrUpdateSingleImage(image);images.push(image);
    }
    const scanner=new Scanner();
    report.progress=[];
    scanner.onProgress=p=>{ report.progress.push({stage:p.stage,processed:p.processed,total:p.total}); if(p.stage==='classifying_local' && p.processed===2) scanner.requestStop(); };
    report.result=await scanner._classifyAllNAImagesByLocalOnnxJS(null,images);
    report.interrupted=report.result;
    const resumedImages=[];
    for (const image of images) resumedImages.push(await store.getImageDetailsById(image.id));
    const resumed = new Scanner(); resumed.onProgress=()=>{};
    report.resumed=await resumed._classifyAllNAImagesByLocalOnnxJS(null,pendingLfm(resumedImages));
    report.records=[];
    for(const image of images) { const x=await store.getImageDetailsById(image.id);report.records.push({id:x.id,category:x.category,message:x.message,lfm:x.mobileNetV3Detections?.lfm}); }
  } catch(e){report.error=e.message;report.stack=e.stack;}
  report.done=true; report.elapsedMs=Date.now()-report.started;
  await RNFS.writeFile(`${root}/lfm-standard-language-${report.language}-result.json`,JSON.stringify(report,null,2));
}
AppRegistry.registerComponent('imagepilot',()=>()=> <Text>LFM independent model test</Text>);
run();
