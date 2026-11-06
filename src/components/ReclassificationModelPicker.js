import React,{useState,useEffect,useRef} from 'react';
import {Modal,View,Text,ScrollView,TouchableOpacity,ActivityIndicator,Alert} from 'react-native';
import {useTranslation} from 'react-i18next';
import {useIosColors} from '../ui/ios/theme';
import configService from '../services/llm/adapters/UnifiedDataConfigService';
import keyStore from '../services/llm/keyStoreSingleton';
import {buildReclassificationChoices,resolveReclassificationChoice} from '../services/classify/reclassificationChoice';
import {isReclassificationModelReady,downloadReclassificationModel} from '../services/classify/reclassificationAvailability';

let taskRunning=false;
const names={embeddinggemma2:['Gemma 2','Gemma 2'],basic:['物体识别','Object recognition'],scene:['场景识别','Scene recognition'],clip:['MobileCLIP','MobileCLIP'],vlm:['Gemma4-E2B','Gemma4-E2B']};
const sizes={embeddinggemma2:388,basic:22,scene:45,clip:147,vlm:2468};
export function useReclassificationPicker(navigation) {
  const [request,setRequest]=useState(null);
  return {open:(count,run)=>setRequest({count,run}),picker:<ReclassificationModelPicker request={request} onClose={()=>setRequest(null)} navigation={navigation}/>};
}
export default function ReclassificationModelPicker({request,onClose}) {
  const c=useIosColors();const {i18n}=useTranslation();const en=String(i18n.language).startsWith('en');
  const text=(zh,eng)=>en?eng:zh;
  const [rows,setRows]=useState([]),[loading,setLoading]=useState(false),[busy,setBusy]=useState(null),[progress,setProgress]=useState(0),[error,setError]=useState('');
  const controller=useRef(null),selecting=useRef(false),generation=useRef(0);
  const load=async token=>{
    const aiCfg=await configService.getAIProviderConfig();
    const choices=await buildReclassificationChoices({isReady:isReclassificationModelReady,aiCfg,hasKey:ref=>keyStore.hasKey(ref)});
    if(generation.current===token)setRows(choices.filter(row=>row.kind==='local'||row.available));
  };
  useEffect(()=>{
    const token=++generation.current;selecting.current=false;setRows([]);setError('');setBusy(null);
    if(request){setLoading(true);load(token).catch(e=>{if(generation.current===token)setError(String(e.message||e));}).finally(()=>{if(generation.current===token)setLoading(false);});}
    return ()=>{generation.current++;controller.current?.abort();};
  },[request]);
  const close=()=>{generation.current++;controller.current?.abort();controller.current=null;onClose();};
  const select=async row=>{
    if(selecting.current||controller.current)return;
    if(taskRunning){Alert.alert(text('正在分类','Classification in progress'),text('请等待本次分类完成。','Wait for the current classification to finish.'));return;}
    if(!row.available){
      const token=generation.current;const abort=new AbortController();controller.current=abort;setBusy(row.id);setProgress(0);
      try{await downloadReclassificationModel(row.id,p=>{if(token===generation.current)setProgress(p);},abort.signal);await load(token);}
      catch(e){if(!abort.signal.aborted && token===generation.current)Alert.alert(text('下载失败','Download failed'),String(e.message||e));}
      finally{if(controller.current===abort)controller.current=null;if(token===generation.current)setBusy(null);}
      return;
    }
    selecting.current=true;
    const token=generation.current;
    try{
      if(row.kind==='local' && !await isReclassificationModelReady(row.id))throw new Error(text('模型文件不可用，请重新下载。','Model unavailable. Please download again.'));
      if(token!==generation.current)return;
      if(taskRunning)throw new Error(text('请等待当前分类完成。','Wait for the current classification to finish.'));
      const opts=resolveReclassificationChoice(row);taskRunning=true;onClose();
      try{await request.run(opts);}finally{taskRunning=false;}
    }catch(e){selecting.current=false;Alert.alert(text('无法开始','Unable to start'),String(e.message||e));}
  };
  return <Modal visible={!!request} transparent animationType="slide" onRequestClose={close}>
    <View style={{flex:1,backgroundColor:'rgba(0,0,0,.4)',justifyContent:'center',padding:20}}>
      <View style={{backgroundColor:c.card,borderRadius:20,maxHeight:'85%',padding:20}}>
        <Text accessibilityRole="header" style={{fontSize:21,fontWeight:'600',color:c.label}}>{text('选择本次分类模型','Choose a model for this run')}</Text>
        <Text style={{color:c.secondaryLabel,marginVertical:12}}>{text(`重新分类 ${request?.count||0} 项，不改变默认模型。`,`Reclassify ${request?.count||0} items without changing your default model.`)}</Text>
        {loading?<ActivityIndicator/>:<ScrollView keyboardShouldPersistTaps="handled">
          {!!error&&<Text style={{color:c.label}}>{error}</Text>}
          {['small','large','online'].map(group=>{
            const items=rows.filter(r=>group==='online'?r.kind==='online':group==='large'?r.id==='vlm':r.kind==='local'&&r.id!=='vlm');
            if(!items.length)return null;
            return <View key={group}>
              <Text style={{color:c.secondaryLabel,marginTop:14,marginBottom:6}}>{group==='small'?text('本地小模型','Local small models'):group==='large'?text('本地大模型','Local large model'):text('在线模型 · 照片将发送至所选服务','Online models · Sends photos to the selected service')}</Text>
              {items.map(row=><TouchableOpacity key={row.id} accessibilityRole="button" disabled={!!busy} onPress={()=>select(row)} style={{paddingVertical:14,borderBottomWidth:0.5,borderBottomColor:c.separator}}>
                <Text style={{color:c.label,fontSize:17,fontWeight:'600'}}>{names[row.id]?.[en?1:0]||`${row.provider} · ${row.model}`}</Text>
                <Text style={{color:c.secondaryLabel,marginTop:5}}>{row.kind==='online'?text('分类与描述 · 使用你的配置','Classification and captions · Your configuration'):row.id==='vlm'?text('分类与描述 · 支持自定义规则 · 较慢','Classification and captions · Custom rules · Slower'):row.id==='embeddinggemma2'?text('快速分类 · 支持自定义类别 · 无描述','Fast classification · Custom categories · No captions'):text('预设类别 · 不支持自定义规则 · 无描述','Preset categories · No custom rules or captions')}</Text>
                <Text style={{color:c.accent||'#007AFF',marginTop:7}}>{busy===row.id?`${text('下载中','Downloading')} ${Math.round(Math.max(0,Math.min(1,Number.isFinite(progress)?progress:0))*100)}%`:row.available?text('使用此模型','Use this model'):`${text('下载','Download')} · ${sizes[row.id]} MB`}</Text>
              </TouchableOpacity>)}
            </View>;
          })}
        </ScrollView>}
        <TouchableOpacity accessibilityRole="button" onPress={close} style={{minHeight:48,justifyContent:'center',alignItems:'center',marginTop:8}}><Text style={{color:c.accent||'#007AFF'}}>{busy?text('取消下载并关闭','Cancel download and close'):text('取消','Cancel')}</Text></TouchableOpacity>
      </View>
    </View>
  </Modal>;
}
