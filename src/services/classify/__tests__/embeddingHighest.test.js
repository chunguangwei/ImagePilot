const {selectHighestDecision}=require('../embeddingGroups');
const row=(appCategory,similarity,extra={})=>({appCategory,similarity,...extra});
test('highest valid score wins despite tiny margins and other being higher',()=>{
 const r=selectHighestDecision([row('other',.9),row('plants',.701),row('custom',.7009)],.5);
 expect(r.candidate.appCategory).toBe('plants');expect(r.rejectionReason).toBeNull();
});
test('only low matches fall back, including an exact threshold boundary',()=>{
 expect(selectHighestDecision([row('a',.4999),row('b',.1)],.5).rejectionReason).toBe('low-similarity');
 expect(selectHighestDecision([row('a',.5)],.5).rejectionReason).toBeNull();
});
test('ties are deterministic and are not rejected',()=>{
 const rows=[row('z',.7),row('a',.7)];
 for(const x of [rows,[...rows].reverse()])expect(selectHighestDecision(x,.5).candidate.appCategory).toBe('a');
});
test('custom exclusions remove only the excluded candidate, not the next valid match',()=>{
 const r=selectHighestDecision([row('work',.8,{exclusionSimilarity:.81}),row('electronics',.7)],.5);
 expect(r.candidate.appCategory).toBe('electronics');expect(r.rejectionReason).toBeNull();
 expect(selectHighestDecision([row('work',.8,{exclusionSimilarity:.8})],.5).rejectionReason).toBe('no-eligible-category');
 expect(selectHighestDecision([row('work',.8,{exclusionSimilarity:.799})],.5).rejectionReason).toBeNull();
});
test('Other alone or no candidates cannot become a positive specific classification',()=>{
 for(const rows of [[],[row('other',.9)]])expect(selectHighestDecision(rows,.5).rejectionReason).toBe('no-eligible-category');
});
test('invalid scores are errors, not successful Other classifications',()=>{
 expect(()=>selectHighestDecision([row('a',NaN)],.5)).toThrow();
 expect(()=>selectHighestDecision([row('a',.7,{exclusionSimilarity:NaN})],.5)).toThrow();
});
