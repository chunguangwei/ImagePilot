const {rankEmbeddingEvidence,embeddingDecision}=require('../embeddingRanking');
const candidate=(id,similarity,supportSimilarity)=>({appCategory:id,similarity,supportSimilarity});
test('conflicting semantic evidence is not accepted despite a clear centroid winner',()=>{
 const d=embeddingDecision([candidate('plants',.674,.64),candidate('electronics',.660,.70)],.005);
 expect(d.rejectionReason).toBe('prototype-disagreement');
});
test('weak support cannot force a confident category',()=>{
 expect(embeddingDecision([candidate('plants',.68,.65),candidate('electronics',.66,.649)],.005).rejectionReason).toBe('weak-prototype-support');
});
test('single explicit rule remains authoritative and dimensions are checked',()=>{
 const ranks=rankEmbeddingEvidence([1,0],[{id:'custom'}],[[1,0]],[[[1,0]]]);
 expect(embeddingDecision(ranks,.005).rejectionReason).toBeNull();
 expect(ranks[0].referenceScores).toEqual([1]);
 expect(()=>rankEmbeddingEvidence([1],[{id:'custom'}],[[1,0]],[[[1,0]]])).toThrow('dimension');
});
test.each(require('../../../../docs/features/embedding-user-rack-results.json').images.map(x=>[x.name,x]))('recorded native sample %s retains agreed category',(_name,x)=>{
 const support=new Map(x.topTwo.map(c=>[c.id,c.score]));
 // Saved reports contain top five only; sufficient for comparing the two recorded winners/margins.
 expect(x.centroid[0].id).toBe(x.topTwo[0].id);
 expect(x.centroid[0].score-x.centroid[1].score).toBeGreaterThanOrEqual(.005);
 expect(x.topTwo[0].score-x.topTwo[1].score).toBeGreaterThanOrEqual(.005);
 expect(support.has(x.centroid[0].id)).toBe(true);
});
