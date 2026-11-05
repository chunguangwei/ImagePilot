import { captionRecordFields } from '../captionRecordFields';
const image = { id: '1', uri: 'file:///photo.jpg', mobileNetV3Detections: { embedding: { candidates: [{ appCategory: 'single_person', similarity: 0.6 }] } } };
test('caption write preserves classification evidence and writes searchable message', () => {
  const fields = captionRecordFields(image, { state: 'generated' }, '一个人站在树旁。');
  expect(fields.message).toBe('一个人站在树旁。');
  expect(fields.mobileNetV3Detections.embedding.candidates).toEqual(image.mobileNetV3Detections.embedding.candidates);
  expect(fields.category).toBeUndefined();
});
test('failure preserves existing caption and records stage and reason', () => {
  const fields = captionRecordFields(image, { state: 'failed', stage: 'vision', error: 'failed to load' });
  expect(fields).not.toHaveProperty('message');
  expect(fields.mobileNetV3Detections.embedding.caption.stage).toBe('vision');
  expect(image.mobileNetV3Detections.embedding.caption).toBeUndefined();
});
