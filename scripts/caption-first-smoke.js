// Development-only: six named fixture JPGs and official models in Documents; never bundle for release.
import React from 'react';
import { AppRegistry, Text } from 'react-native';
import RNFS from 'react-native-fs';
import ImageStorageService from '../src/services/ImageStorageService';
import UnifiedDataService from '../src/services/UnifiedDataService';
import Scanner from '../src/services/GalleryScannerService.ios';
const root = RNFS.DocumentDirectoryPath;
const report = { started: Date.now() };
async function run() {
  try {
    const store = new ImageStorageService(); await store.ensureInitialized();
    const settings = await UnifiedDataService.readSettings();
    await UnifiedDataService.writeSettings({ ...settings, classifierModelTier: 'embeddinggemma2', embeddingCaption: { enabled: true } });
    const images = [];
    for (let i=0;i<12;i++) {
      const uri=`file://${root}/fusion-batch-${i}.jpg`;
      if(await RNFS.exists(uri)) await RNFS.unlink(uri);
      await RNFS.copyFile(`${root}/${['rack','trophy','portrait','cat','food','group'][i%6]}.jpg`,uri);
      const image={id:`fusion-batch-${i}`,uri,fileName:`fusion-batch-${i}.jpg`,category:'NA',message:null};
      await store.storage.addOrUpdateSingleImage(image);images.push(image);
    }
    const scanner=new Scanner();
    report.progress=[];
    scanner.onProgress=p=>{ report.progress.push({stage:p.stage,processed:p.processed,total:p.total}); if(p.stage==='caption_generation' && p.processed===8) scanner.requestStop(); };
    report.result=await scanner._classifyAllNAImagesByLocalOnnxJS(null,images);
    report.interrupted=report.result;
    const resumedImages=[];
    for (const image of images) resumedImages.push(await store.getImageDetailsById(image.id));
    const resumed = new Scanner(); resumed.onProgress=()=>{};
    report.resumed=await resumed._classifyAllNAImagesByLocalOnnxJS(null,resumedImages);
    report.records=[];
    for(const image of images) { const x=await store.getImageDetailsById(image.id);report.records.push({id:x.id,category:x.category,message:x.message,caption:x.mobileNetV3Detections?.embedding?.caption,classification:x.mobileNetV3Detections?.embedding?.classification}); }
  } catch(e){report.error=e.message;report.stack=e.stack;}
  report.done=true;
  await RNFS.writeFile(`${root}/caption-first-scanner-result.json`,JSON.stringify(report,null,2));
}
AppRegistry.registerComponent('ImagePilot',()=>()=> <Text>Native batch switch test</Text>);
run();
