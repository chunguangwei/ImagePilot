// Reuse the existing persisted JSON column; no DB migration and no fake image caption.
export function embeddingRecordFields(result, captionEnabled = false, image = {}) {
  if (result?.engine !== 'embeddinggemma2') return {};
  return {
    ...(result.classificationAccepted !== true ? {category:'other'} : {}),
    confidence: null,
    mobileNetV3Detections: {
      embedding: {
        model: 'embeddinggemma2',
        caption: { state: String(image.message || '').trim() ? 'preserved' : captionEnabled ? 'pending' : 'disabled' },
        accepted: result.classificationAccepted === true,
        fallbackCategory: result.classificationAccepted !== true ? 'other' : undefined,
        similarity: result.similarity,
        margin: result.margin,
        minimumMargin: result.minimumMargin,
        minimumSimilarity: result.minimumSimilarity,
        scoringVersion: result.scoringVersion,
        diagnostics: result.diagnostics,
        rejectionReason: result.rejectionReason,
        categoryDescription: result.categoryDescription || '',
        candidates: (result.predictions || []).map(({ appCategory, similarity }) => ({ appCategory, similarity })),
      },
    },
    // Deliberately omit message: an existing generated or manually edited caption is retained.
  };
}
