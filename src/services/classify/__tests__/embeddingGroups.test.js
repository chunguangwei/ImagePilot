const {categoryEmbeddingGroups}=require('../categorySemantics');
const {rankGroupedEvidence,groupedDecision}=require('../embeddingGroups');
test('all builtins have explicit groups with two paraphrases per subtype',()=>{
 const cfg=require('../../../../public/initialSettings.json');
 for(const [id,names] of Object.entries(cfg.categoryNameMap)){
  if(id.startsWith('NA'))continue;
  const groups=categoryEmbeddingGroups({id,en:names.english,zh:names.chinese});
  expect(groups.length).toBeGreaterThan(0);
  expect(new Set(groups.map(g=>g.id)).size).toBe(groups.length);
  expect(groups.every(g=>g.texts.length===2)).toBe(true);
 }
});
test('explicit rules and descriptions cannot be bypassed by builtin examples',()=>{
 for(const c of [{id:'electronics',en:'Electronics',rule:'只允许手机'}, {id:'vehicles',en:'Vehicles',description:'只允许汽车'}]){
  const groups=categoryEmbeddingGroups(c);
  expect(groups).toHaveLength(1);expect(groups[0].texts).toHaveLength(1);
  expect(groups[0].texts[0]).toContain(c.rule||c.description);
 }
});
test('unrelated subtypes cannot dilute a supported parent, and sibling groups do not compete for margin',()=>{
 const ranks=rankGroupedEvidence([1,0],[{id:'a'},{id:'b'}],[
  [{id:'a1',vectors:[[1,0],[1,0]]},{id:'a2',vectors:[[0,1],[0,1]]}],
  [{id:'b1',vectors:[[.8,.6],[.8,.6]]}]
 ]);
 expect(ranks[0].appCategory).toBe('a');expect(ranks[0].similarity).toBe(1);
 expect(groupedDecision(ranks,.005).rejectionReason).toBeNull();
});
test('one matching paraphrase cannot alone promote a subtype',()=>{
 const ranks=rankGroupedEvidence([1,0],[{id:'a'},{id:'b'}],[
  [{id:'a1',vectors:[[1,0],[0,1]]}],
  [{id:'b1',vectors:[[.8,.6],[.8,.6]]}]
 ]);
 expect(ranks[0].appCategory).toBe('b');
});
test('a tie between parents remains uncertain and a single rule still works',()=>{
 const rows=[{appCategory:'a',similarity:.7},{appCategory:'b',similarity:.7}];
 expect(groupedDecision(rows,.005).rejectionReason).toBe('ambiguous');
 expect(groupedDecision([rows[0]],.005).rejectionReason).toBeNull();
});

test('global decision uses clear subtype evidence, retains same-category fallback, and rejects conflicting clear views',()=>{
 const {selectGroupedDecision}=require('../embeddingGroups');
 const ranks=(a,b)=>[{appCategory:a,similarity:.8},{appCategory:b,similarity:.7}];
 const legacy={margin:.1,rejectionReason:null};
 expect(selectGroupedDecision(ranks('a','b'),legacy,ranks('b','a'),.005).rejectionReason).toBe('category-view-disagreement');
 expect(selectGroupedDecision(ranks('a','b'),{...legacy,rejectionReason:'prototype-disagreement'},ranks('b','a'),.005).predictions[0].appCategory).toBe('b');
 const weak=[{appCategory:'a',similarity:.7},{appCategory:'b',similarity:.699}];
 expect(selectGroupedDecision(ranks('a','b'),legacy,weak,.005).method).toBe('category-fallback');
 expect(selectGroupedDecision(ranks('b','a'),legacy,weak,.005).rejectionReason).toBe('category-view-disagreement');
 expect(selectGroupedDecision(ranks('a','b'),{...legacy,rejectionReason:'ambiguous'},weak,.005).rejectionReason).toBe('ambiguous');
});

test('an exact subtype tie is resolved by the same clear legacy parent regardless of list order',()=>{
 const {selectGroupedDecision}=require('../embeddingGroups');
 const legacy=[{appCategory:'a',similarity:.8},{appCategory:'b',similarity:.7}];
 const tied=[{appCategory:'a',similarity:.7},{appCategory:'b',similarity:.7}];
 for(const rows of [tied,[...tied].reverse()]){
  const result=selectGroupedDecision(legacy,{margin:.1,rejectionReason:null},rows,.005);
  expect(result.method).toBe('category-fallback');
  expect(result.predictions[0].appCategory).toBe('a');
 }
});
