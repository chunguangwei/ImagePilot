// Reuse already encoded references: no additional model/image inference.
export function rankEmbeddingEvidence(vector, categories, centroids, prototypes) {
  const dot = (reference) => {
    if (reference.length !== vector.length) throw new Error('Embedding dimension mismatch');
    return Math.max(-1, Math.min(1, vector.reduce((sum, v, i) => sum + v * reference[i], 0)));
  };
  return categories.map((category, index) => {
    const referenceScores = prototypes[index].map(dot);
    const best = [...referenceScores].sort((a, b) => b - a).slice(0, 2);
    return { name: category.id, appCategory: category.id, similarity: dot(centroids[index]),
      supportSimilarity: best.reduce((sum, score) => sum + score, 0) / best.length, referenceScores };
  }).sort((a, b) => b.similarity - a.similarity);
}
export function embeddingDecision(predictions, minimumMargin) {
  const top = predictions[0];
  const support = [...predictions].sort((a, b) => b.supportSimilarity - a.supportSimilarity);
  const margin = predictions.length > 1 ? top.similarity - predictions[1].similarity : null;
  const supportMargin = support.length > 1 ? support[0].supportSimilarity - support[1].supportSimilarity : null;
  const rejectionReason = top.similarity <= 0 ? 'non-positive'
    : margin !== null && margin < minimumMargin ? 'ambiguous'
    : support[0].appCategory !== top.appCategory ? 'prototype-disagreement'
    : supportMargin !== null && supportMargin < minimumMargin ? 'weak-prototype-support' : null;
  return { margin, supportMargin, supportCategory: support[0].appCategory, rejectionReason };
}
