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
      return {id: group.id, exclude: !!group.exclude, referenceScores, similarity: referenceScores.reduce((a,b)=>a+b,0)/referenceScores.length};
    }).sort((a,b)=>b.similarity-a.similarity);
    if (!groups.length) throw new Error('Empty category groups');
    const positive = groups.find(g => !g.exclude);
    if (!positive) throw new Error('No positive category group');
    const exclusion = groups.find(g => g.exclude);
    return {appCategory:category.id, similarity:positive.similarity, matchedGroup:positive.id,
      exclusionSimilarity:exclusion?.similarity, groups};
  }).sort((a,b)=>b.similarity-a.similarity);
}
export function groupedDecision(predictions, minimumMargin) {
  if (!predictions.length) throw new Error('No category candidates');
  const margin = predictions.length>1 ? predictions[0].similarity-predictions[1].similarity:null;
  return {margin,rejectionReason:predictions[0].similarity<=0?'non-positive':margin!==null&&margin<minimumMargin?'ambiguous':null};
}

export function selectGroupedDecision(legacyPredictions, legacyDecision, groupedPredictions, minimumMargin) {
  const grouped = groupedDecision(groupedPredictions, minimumMargin);
  // A subtype may resolve diluted category evidence, but must not silently
  // reaccept a parent already vetoed by a stronger reference in another parent.
  if (legacyDecision.rejectionReason === 'strongest-prototype-disagreement'
      && (legacyDecision.strongestMargin === 0
        || groupedPredictions[0].appCategory !== legacyDecision.strongestCategory)) {
    return {...grouped, rejectionReason:'strongest-prototype-disagreement', method:'subtype', predictions:groupedPredictions};
  }
  const legacyParent = groupedPredictions.find(p => p.appCategory === legacyPredictions[0].appCategory);
  // An exact cross-parent tie has no unique first parent; ordering must not change fallback.
  const sameParent = legacyParent?.similarity === groupedPredictions[0].similarity;
  if (legacyDecision.rejectionReason === null && !sameParent) {
    return {...grouped, rejectionReason:'category-view-disagreement', method:'subtype', predictions:groupedPredictions};
  }
  if (grouped.rejectionReason === 'ambiguous' && legacyDecision.rejectionReason === null && sameParent) {
    return checkExclusion({margin:legacyDecision.margin, rejectionReason:null, method:'category-fallback', predictions:legacyPredictions}, groupedPredictions, minimumMargin);
  }
  return checkExclusion({...grouped,method:'subtype',predictions:groupedPredictions}, groupedPredictions, minimumMargin);
}

function checkExclusion(decision, groupedPredictions, minimumMargin) {
  const winner = groupedPredictions.find(p => p.appCategory === decision.predictions[0].appCategory);
  if (winner.exclusionSimilarity != null && winner.similarity - winner.exclusionSimilarity < minimumMargin) {
    return {...decision, rejectionReason:'exclusion-conflict'};
  }
  return decision;
}

// 1.6+: choose the highest eligible category. Legacy consensus is diagnostic only.
// Other is a fallback, not a visual class that can outscore a specific subject.
export function selectHighestDecision(predictions, minimumSimilarity) {
  if (!Number.isFinite(minimumSimilarity)) throw new Error('Invalid minimum similarity');
  for (const p of predictions) {
    if (!Number.isFinite(p.similarity) || (p.exclusionSimilarity != null && !Number.isFinite(p.exclusionSimilarity))) {
      throw new Error('Invalid category similarity');
    }
  }
  const ranked = [...predictions].sort((a,b) => b.similarity-a.similarity || (a.appCategory < b.appCategory ? -1 : a.appCategory > b.appCategory ? 1 : 0));
  const eligible = ranked.filter(p => p.appCategory !== 'other'
    && (p.exclusionSimilarity == null || p.similarity > p.exclusionSimilarity));
  const candidate = eligible[0] || null;
  return {
    candidate, predictions: ranked, method: 'highest-score',
    margin: eligible.length > 1 ? eligible[0].similarity-eligible[1].similarity : null,
    rejectionReason: !candidate ? 'no-eligible-category' : candidate.similarity < minimumSimilarity ? 'low-similarity' : null,
    excludedCategories: ranked.filter(p => p.appCategory !== 'other' && p.exclusionSimilarity != null && p.similarity <= p.exclusionSimilarity).map(p=>p.appCategory),
  };
}
