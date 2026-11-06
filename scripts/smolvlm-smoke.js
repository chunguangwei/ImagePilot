// Isolated simulator only. Never run this entry point against a user's library.
import React from 'react';
import {AppRegistry,Text} from 'react-native';
import RNFS from 'react-native-fs';
import {runLfmClassification} from '../src/services/classify/LfmClassifier';
import UnifiedDataService from '../src/services/UnifiedDataService';
const root=RNFS.DocumentDirectoryPath;
const report={model:'smolvlm-500m-instruct',started:Date.now(),records:[],timings:[],failures:[]};
const persist=()=>RNFS.writeFile(`${root}/smolvlm-smoke-result.json`,JSON.stringify(report,null,2));
async function run(){
 try{
  await UnifiedDataService.initialize();
  const names=['rack','trophy','portrait','cat','food','group'];
  const images=names.map(name=>({id:`smol-smoke-${name}`,uri:`file://${root}/smol-smoke-${name}.jpg`,fileName:`smol-smoke-${name}.jpg`,category:'NA',message:null}));
  for(const name of names) {const dest=`${root}/smol-smoke-${name}.jpg`;if(await RNFS.exists(dest))await RNFS.unlink(dest);await RNFS.copyFile(`${root}/${name}.jpg`,dest);}
  await persist();
  for(const image of images) await UnifiedDataService.imageStorageService.storage.addOrUpdateSingleImage(image);
  await UnifiedDataService.imageCache.refreshCache();
  report.result=await runLfmClassification(images,{
   onTiming:(image,timing)=>report.timings.push({id:image.id,...timing}),
   onFailure:async(image,detail)=>{report.failures.push({id:image.id,...detail});await persist();},
   save:async(image,result)=>{
    const saved=await UnifiedDataService.batchUpdateClassification([{id:image.id,category:result.topPrediction.appCategory,message:result.vlmLabel}],true);
    const row=await UnifiedDataService.imageStorageService.getImageDetailsById(image.id);
    report.records.push({id:image.id,category:row.category,message:row.message});await persist();return saved;
   },
  });
 }catch(e){report.error=e.message;}
 report.done=true;report.elapsedMs=Date.now()-report.started;await persist();
}
AppRegistry.registerComponent('imagepilot',()=>()=> <Text>SmolVLM native validation</Text>);run();
