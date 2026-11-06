import {RNFS} from '../../adapters/WebAdapters';
import {retryOtherVideoClassification,checkVideoClassificationStop} from './videoClassificationRetry';

// All temporary frames belong to one retry; sequential inference bounds memory.
export default async function retryVideoFrames(initial,{extractFrame,classifyFrame,initialFrameHash,initialFrame,...options}) {
  if(options.categoryOf(initial)!=='other')return initial;
  const seen=new Set(initialFrameHash?[initialFrameHash]:[]);
  if(initialFrame){try{seen.add(await RNFS.hash(initialFrame.replace(/^file:\/\//,''),'sha256'));}catch(_){}}
  return retryOtherVideoClassification(initial,{...options,classifyFrame:async position=>{
    let uri;
    try{
      uri=await extractFrame(position);
      checkVideoClassificationStop(options.shouldStop);
      if(!uri)return null;
      const hash=await RNFS.hash(uri.replace(/^file:\/\//,''),'sha256');
      if(seen.has(hash))return null;seen.add(hash);
      return await classifyFrame(uri);
    }finally{
      if(uri)try{await RNFS.unlink(uri.replace(/^file:\/\//,''));}catch(_){}
    }
  }});
}
