import {categoryEmbeddingGroups, categoryMatchingRule} from '../categorySemantics';
import {normalizeCustomMatching} from '../categorySemantics';
import {buildCustomCategoryPromptSection} from '../../llm/customCategories';
test('legacy free text remains one intact rule, never split by punctuation',()=>{
 const c={id:'work',zh:'工作',rule:'只在办公室；包含机器，不包含植物'};
 expect(categoryEmbeddingGroups(c)).toEqual([{id:'rule',texts:['工作: '+c.rule]}]);
});
test('alternative scenarios retain the original rule in every reference',()=>{
 const c={id:'work',zh:'工作',rule:'公司内设备',scenarios:['网络机柜','打印机']};
 const groups=categoryEmbeddingGroups(c);
 expect(groups).toHaveLength(2);
 groups.forEach(g=>{expect(g.texts).toHaveLength(2);expect(g.texts[0]).toBe('工作: '+c.rule);expect(g.texts[1]).toContain(c.rule);});
 expect(groups[0].texts[1]).toContain('网络机柜');
 expect(groups[1].texts[1]).toContain('打印机');
});
test('normalization deduplicates only explicit lines without rewriting the rule',()=>{
 expect(normalizeCustomMatching({scenarios:'机柜\n\n打印机\n机柜',exclusions:'  盆栽  '})).toEqual({scenarios:['机柜','打印机'],exclusions:'盆栽'});
 expect(normalizeCustomMatching({scenarios:[null,42,'机柜'],exclusions:42})).toEqual({scenarios:['机柜'],exclusions:''});
});
test('exclusions do not become positive embedding references; generative engines receive the full instructions',()=>{
 const c={id:'work',name:'工作',zh:'工作',rule:'设备',scenarios:['机柜'],exclusions:'盆栽'};
 expect(categoryEmbeddingGroups(c)[0].texts.join()).not.toContain('盆栽');
 expect(categoryMatchingRule(c,'zh')).toContain('盆栽');
 const prompt=buildCustomCategoryPromptSection([c],'en');
 expect(prompt).toContain('机柜');expect(prompt).toContain('盆栽');
 expect(prompt).not.toContain('take priority');
});

test('exclusion evidence can veto a match but never promote an excluded subject',()=>{
 const {rankGroupedEvidence, selectGroupedDecision}=require('../embeddingGroups');
 const ranked=rankGroupedEvidence([1,0],[{id:'work'},{id:'other'}],[[{id:'rule',vectors:[[0.8,0.6]]},{id:'exclusion',exclude:true,vectors:[[0.9,0.43589]]}],[{id:'rule',vectors:[[0.7,0.71414]]}]]);
 expect(ranked[0].similarity).toBe(0.8);
 expect(selectGroupedDecision(ranked,{rejectionReason:null,margin:0.1},ranked,0.005).rejectionReason).toBe('exclusion-conflict');
});
test.each([false,true])('fallback checks exclusions on its actual winner regardless tie order (%s)',reverse=>{
 const {selectGroupedDecision}=require('../embeddingGroups');
 const legacy=[{appCategory:'custom',similarity:0.9},{appCategory:'builtin',similarity:0.7}];
 const grouped=[{appCategory:'builtin',similarity:0.8},{appCategory:'custom',similarity:0.8,exclusionSimilarity:0.9}];
 if(reverse)grouped.reverse();
 expect(selectGroupedDecision(legacy,{rejectionReason:null,margin:0.2},grouped,0.005).rejectionReason).toBe('exclusion-conflict');
});

test('a broad scenario cannot win on its own when independent original-rule evidence is weaker',()=>{
 const {rankGroupedEvidence,selectHighestDecision}=require('../embeddingGroups');
 const category={id:'custom',zh:'自定义',rule:'人物为主体',scenarios:['一个人物']};
 const groups=categoryEmbeddingGroups(category);
 const vector=score=>[score,Math.sqrt(1-score*score)];
 const encoded=groups.map(g=>({...g,vectors:g.texts.map(text=>vector(text.includes('规则内的具体场景')?.68:.65))}));
 const ranked=rankGroupedEvidence([1,0],[category,{id:'alternative'}],[encoded,[{id:'scene',vectors:[vector(.675),vector(.675)]}]]);
 expect(selectHighestDecision(ranked,.5).candidate.appCategory).toBe('alternative');
 expect(groups[0].texts).toContain('自定义: 人物为主体');
 const strong=groups.map(g=>({...g,vectors:g.texts.map(()=>vector(.8))}));
 expect(selectHighestDecision(rankGroupedEvidence([1,0],[category,{id:'alternative'}],[strong,[{id:'scene',vectors:[vector(.675)]}]]),.5).candidate.appCategory).toBe('custom');
});
