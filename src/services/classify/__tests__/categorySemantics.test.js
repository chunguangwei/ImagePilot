const { categoryDescription, categoryText } = require('../categorySemantics');
const { embeddingRecordFields } = require('../embeddingRecordFields');

test('all built-in visual categories have bilingual semantic descriptions', () => {
  const config = require('../../../../public/initialSettings.json');
  for (const [id, names] of Object.entries(config.categoryNameMap)) {
    if (id.startsWith('NA')) continue;
    for (const lang of ['zh', 'en']) {
      expect(categoryDescription({ id }, lang).length).toBeGreaterThan(10);
    }
  }
});
test('custom rules and configured descriptions take precedence over built-in defaults', () => {
  expect(categoryDescription({ id: 'kids', rule: '只包含儿童绘画' }, 'zh')).toBe('只包含儿童绘画');
  expect(categoryDescription({ id: 'pets', description: { zh: '仅室内猫咪', en: 'Indoor cats only' } }, 'en')).toBe('Indoor cats only');
  expect(categoryText({ id: 'custom', zh: '工作', rule: '会议和同事合影' }, 'zh')).toContain('会议和同事合影');
});
test('embedding persistence preserves existing image descriptions and does not store similarity as confidence', () => {
  const fields = embeddingRecordFields({ engine: 'embeddinggemma2', similarity: 0.685, margin: 0.01,
    classificationAccepted: true, categoryDescription: '类别说明', predictions: [{ appCategory: 'kids', similarity: 0.685 }] });
  expect(fields).not.toHaveProperty('message');
  expect(fields.confidence).toBeNull();
  expect(fields.mobileNetV3Detections.embedding.similarity).toBe(0.685);
  expect(fields.mobileNetV3Detections.embedding.candidates[0].appCategory).toBe('kids');
});
