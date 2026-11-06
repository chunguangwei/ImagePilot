// Development-only. Run against an isolated simulator, never a user's photo library.
import React from 'react';
import {AppRegistry,Text} from 'react-native';
import RNFS from 'react-native-fs';
import data from '../src/services/UnifiedDataService';
import {subscribeCacheRefresh} from '../src/services/subscribeCacheRefresh';
const root=RNFS.DocumentDirectoryPath;
const ids=['refresh-smoke-a','refresh-smoke-b'];
const report={started:Date.now(),stages:[]};
const save=()=>RNFS.writeFile(`${root}/refresh-consistency-result.json`,JSON.stringify(report,null,2));
function snapshot(label){
 const cache=data.imageCache.getCache();const rows=cache.allImages.filter(x=>ids.includes(x.id));
 return {label,rows:rows.map(x=>({id:x.id,category:x.category,message:x.message,confidence:x.confidence})),counts:cache.categoryCounts};
}
async function run(){let off;
 try{
  await data.initialize();
  for(const id of ids) await data.imageStorageService.storage.addOrUpdateSingleImage({id,uri:`file://${root}/${id}.jpg`,fileName:`${id}.jpg`,category:'NA',message:null});
  await data.imageCache.refreshCache();
  const views=[];off=subscribeCacheRefresh(data,()=>{views.push(snapshot('listener'));},10);
  report.stages.push(snapshot('before'));await save();
  report.ai=await data.batchUpdateClassification([{id:ids[0],category:'electronics',message:'A network rack'}],true);
  report.stages.push(snapshot('ai'));await save();
  report.manual=await data.updateImagesCategory([ids[0]],'art','manual');
  report.stages.push(snapshot('manual'));await save();
  report.batch=await data.updateImagesCategory(ids,'pets','manual');
  report.stages.push(snapshot('batch'));await save();
  await new Promise(resolve=>setTimeout(resolve,100));report.views=views;
  report.pass=report.stages[1].rows.find(x=>x.id===ids[0]).category==='electronics'
    &&report.stages[2].rows.find(x=>x.id===ids[0]).category==='art'
    &&report.stages[3].rows.every(x=>x.category==='pets')&&views.length>0;
 }catch(e){report.error=e.message;report.stack=e.stack;}
 finally{off?.();report.done=true;report.elapsedMs=Date.now()-report.started;await save();}
}
AppRegistry.registerComponent('imagepilot',()=>()=> <Text>Native persistence refresh test</Text>);run();
