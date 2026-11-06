import React from 'react';
import renderer,{act} from 'react-test-renderer';
import Picker from '../ReclassificationModelPicker';
import keyStore from '../../services/llm/keyStoreSingleton';
import {isReclassificationModelReady,downloadReclassificationModel} from '../../services/classify/reclassificationAvailability';
jest.mock('react-native',()=>({Modal:'Modal',View:'View',Text:'Text',ScrollView:'Scroll',TouchableOpacity:'Button',ActivityIndicator:'Spinner',Alert:{alert:jest.fn()}}));
jest.mock('react-i18next',()=>({useTranslation:()=>({i18n:{language:'zh'}})}));
jest.mock('../../ui/ios/theme',()=>({useIosColors:()=>({})}));
jest.mock('../../services/llm/adapters/UnifiedDataConfigService',()=>({getAIProviderConfig:async()=>({active:'local-onnx',providers:{openai:{model:'unused',baseURL:'https://example.com',apiKeyRef:'x'}}})}));
jest.mock('../../services/llm/keyStoreSingleton',()=>({hasKey:jest.fn(async()=>false)}));
jest.mock('../../services/classify/reclassificationAvailability',()=>({isReclassificationModelReady:jest.fn(),downloadReclassificationModel:jest.fn()}));
const find=(tree,label)=>tree.root.findAllByType('Button').find(b=>b.findAllByType('Text').some(t=>t.props.children===label));
const content=tree=>JSON.stringify(tree.toJSON());
beforeEach(()=>{jest.clearAllMocks();keyStore.hasKey.mockResolvedValue(false);isReclassificationModelReady.mockResolvedValue(false);});
test('all local choices are shown, unconfigured online choices are hidden',async()=>{
 let tree;await act(async()=>{tree=renderer.create(<Picker request={{count:2,run:jest.fn()}} onClose={jest.fn()}/>);});
 for(const name of ['Gemma 2','物体识别','场景识别','MobileCLIP','Gemma4-E2B'])expect(content(tree)).toContain(name);
 expect(content(tree)).not.toContain('openai');expect(content(tree)).toContain('下载');
});
test('cancelled download does not block selection after reopening',async()=>{
 let tree,rejectDownload;const run=jest.fn(),close=jest.fn();
 downloadReclassificationModel.mockImplementation(()=>new Promise((_,reject)=>{rejectDownload=reject;}));
 await act(async()=>{tree=renderer.create(<Picker request={{count:1,run}} onClose={close}/>);});
 let pending;act(()=>{pending=find(tree,'Gemma 2').props.onPress();});
 act(()=>find(tree,'取消下载并关闭').props.onPress());
 expect(downloadReclassificationModel.mock.calls[0][2].aborted).toBe(true);
 await act(async()=>{tree.update(<Picker request={null} onClose={close}/>);rejectDownload(new Error('cancelled'));await pending;});
 isReclassificationModelReady.mockResolvedValue(true);
 await act(async()=>{tree.update(<Picker request={{count:1,run}} onClose={close}/>);});
 await act(async()=>{await find(tree,'Gemma 2').props.onPress();});
 expect(run).toHaveBeenCalledWith({forceLocal:true,tier:'embeddinggemma2',strict:true});
});
jest.mock('../../services/classify/classifyByTier',()=>({readActiveTier:async()=> 'vlm'}));
test('pending picker shows only default local model and uses classification wording',async()=>{
 let tree;await act(async()=>{tree=renderer.create(<Picker request={{count:4,run:jest.fn(),scope:'pending'}} onClose={jest.fn()}/>);});
 expect(content(tree)).toContain('Gemma4-E2B');
 for(const name of ['Gemma 2','物体识别','场景识别','MobileCLIP'])expect(content(tree)).not.toContain(name);
 expect(content(tree)).toContain('开始分类');
 expect(content(tree)).not.toContain('重新分类');
});

test('pending cloud choice is configured only and waits for explicit start',async()=>{
 keyStore.hasKey.mockResolvedValue(true);const run=jest.fn();let tree;
 await act(async()=>{tree=renderer.create(<Picker request={{count:2,scope:'pending',run}} onClose={jest.fn()}/>);});
 expect(content(tree)).toContain('openai · unused');
 await act(async()=>{find(tree,'openai · unused').props.onPress();});
 expect(run).not.toHaveBeenCalled();
 await act(async()=>{await find(tree,'开始分类').props.onPress();});
 expect(run).toHaveBeenCalledWith({forceLocal:false,provider:'openai'});
});
