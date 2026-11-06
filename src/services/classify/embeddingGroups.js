// Alternative-appearance ranking, independent of category names and IDs. Inputs are normalized embeddings.
export function rankGroupedEvidence(vector, categories, groupsByCategory) {
  const dot = reference => {
    if (!Array.isArray(reference) || reference.length !== vector.length) throw new Error('Embedding dimension mismatch');
    const score = vector.reduce((sum, v, i) => sum + v * reference[i], 0);
    if (!Number.isFinite(score)) throw new Error('Invalid embedding vector');
    return Math.max(-1, Math.min(1, score));
  };
  return categories.map((category, index) => {
    const groups = groupsByCategory[index].map(group => {
      if (!group.vectors.length) throw new Error('Empty reference group');
      const referenceScores = group.vectors.map(dot);
      return {id: group.id, referenceScores, similarity: referenceScores.reduce((a,b)=>a+b,0)/referenceScores.length};
    }).sort((a,b)=>b.similarity-a.similarity);
    if (!groups.length) throw new Error('Empty category groups');
    return {appCategory:category.id, similarity:groups[0].similarity, matchedGroup:groups[0].id, groups};
  }).sort((a,b)=>b.similarity-a.similarity);
}
export function groupedDecision(predictions, minimumMargin) {
  if (!predictions.length) throw new Error('No category candidates');
  const margin = predictions.length>1 ? predictions[0].similarity-predictions[1].similarity:null;
  return {margin,rejectionReason:predictions[0].similarity<=0?'non-positive':margin!==null&&margin<minimumMargin?'ambiguous':null};
}

export function selectGroupedDecision(legacyPredictions, legacyDecision, groupedPredictions, minimumMargin) {
  const grouped = groupedDecision(groupedPredictions, minimumMargin);
  const legacyParent = groupedPredictions.find(p => p.appCategory === legacyPredictions[0].appCategory);
  // An exact cross-parent tie has no unique first parent; ordering must not change fallback.
  const sameParent = legacyParent?.similarity === groupedPredictions[0].similarity;
  if (legacyDecision.rejectionReason === null && !sameParent) {
    return {...grouped, rejectionReason:'category-view-disagreement', method:'subtype', predictions:groupedPredictions};
  }
  if (grouped.rejectionReason === 'ambiguous' && legacyDecision.rejectionReason === null && sameParent) {
    return {margin:legacyDecision.margin, rejectionReason:null, method:'category-fallback', predictions:legacyPredictions};
  }
  return {...grouped,method:'subtype',predictions:groupedPredictions};
}
