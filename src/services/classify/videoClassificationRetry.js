export function localResultCategory(result) {
  if(result?.success===false)return 'other';
  if(result?.engine==='embeddinggemma2'&&result.classificationAccepted!==true)return 'other';
  return result?.topPrediction&&(result.classificationAccepted===true||result.confidence>=0.15)
    ?result.topPrediction.appCategory||'other':'other';
}
export function checkVideoClassificationStop(shouldStop) {
  if(shouldStop?.())throw Object.assign(new Error('Classification cancelled'),{code:'CLASSIFICATION_CANCELLED'});
}
// Only retry Other. Sample separate time bands, at most three extra inferences.
// Two agreeing frames are needed; a single surprising frame must not decide a video.
export async function retryOtherVideoClassification(initial,{categoryOf,classifyFrame,shouldStop,random=Math.random,onError}) {
  if(categoryOf(initial)!=='other')return initial;
  const votes=new Map();
  for(const [start,width] of [[0.15,0.15],[0.65,0.15],[0.85,0.1]]){
    checkVideoClassificationStop(shouldStop);
    try{
      const result=await classifyFrame(start+width*random());
      checkVideoClassificationStop(shouldStop);
      if(!result)continue;
      const category=categoryOf(result);
      if(!category||['other','NA','NA_video'].includes(category))continue;
      const count=(votes.get(category)||0)+1;votes.set(category,count);
      if(count>=2)return result;
    }catch(error){
      if(error.code==='CLASSIFICATION_CANCELLED')throw error;
      onError?.(error);
    }
  }
  return initial;
}
