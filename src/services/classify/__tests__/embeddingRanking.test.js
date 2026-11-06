const {rankEmbeddingEvidence,embeddingDecision}=require('../embeddingRanking');
const candidate=(id,similarity,supportSimilarity)=>({appCategory:id,similarity,supportSimilarity,referenceScores:[supportSimilarity]});
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
 expect(x.centroid[0].id).toBe(x.maximum[0].id);
 expect(x.maximum[0].score).toBeGreaterThan(x.maximum[1].score);
 expect(x.centroid[0].score-x.centroid[1].score).toBeGreaterThanOrEqual(.005);
 expect(x.topTwo[0].score-x.topTwo[1].score).toBeGreaterThanOrEqual(.005);
 expect(support.has(x.centroid[0].id)).toBe(true);
});

test('Android 1.5.94 rack evidence is rejected when averaging hides the strongest specific reference',()=>{
 const rows=[
  {appCategory:'plants',similarity:0.674255187852352,supportSimilarity:0.6690400632003027,referenceScores:[0.6644826550714903,0.6735974713291152,0.6622945635891953]},
  {appCategory:'single_person',similarity:0.6670342232556783,supportSimilarity:0.6589415170717414,referenceScores:[0.6614109914547671,0.6430481182334395,0.6564720426887156]},
  {appCategory:'electronics',similarity:0.6601617596206656,supportSimilarity:0.6527781320528947,referenceScores:[0.6274543621748617,0.6781019019309278,0.6250481151514409]},
  {appCategory:'architecture',similarity:0.6530026978214536,supportSimilarity:0.6545760035355714,referenceScores:[0.6389813396333153,0.6180344125245547,0.6701706674378277]},
 ];
 const d=embeddingDecision(rows,.005);
 expect(d.rejectionReason).toBe('strongest-prototype-disagreement');
 expect(d.strongestCategory).toBe('electronics');
 expect(d.strongestMargin).toBeCloseTo(0.0045044306018126,10);
});

test('equal strongest references across categories are rejected regardless of category ordering',()=>{
 const a={...candidate('a',.8,.75),referenceScores:[.9,.6]};
 const b={...candidate('b',.7,.7),referenceScores:[.9,.5]};
 expect(embeddingDecision([a,b],.005).rejectionReason).toBe('strongest-prototype-disagreement');
});
test('a lower-scoring competing reference does not veto agreed evidence',()=>{
 expect(embeddingDecision([candidate('a',.8,.78),candidate('b',.7,.70)],.005).rejectionReason).toBeNull();
});
