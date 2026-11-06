import { CLASSIFIER_TIER_ORDER, DEFAULT_CLASSIFIER_TIER, CLASSIFIER_TIERS } from '../classifierModelTiers';
test('only fast EmbeddingGemma and detailed E2B choices are offered', () => {
  expect(CLASSIFIER_TIER_ORDER).toEqual(['embeddinggemma2', 'vlm']);
  expect(DEFAULT_CLASSIFIER_TIER).toBe('embeddinggemma2');
  expect(CLASSIFIER_TIERS.lfm).toBeUndefined();
});
