const { pendingCaptions, createCaptionQueue } = require('../captionQueue');
const row = (id, state = 'pending', message = '') => ({ id, uri: `file://${id}`, message, category: 'plants', mobileNetV3Detections: { embedding: { model: 'embeddinggemma2', caption: { state } } } });
test('recovers interrupted and failed captions without reclassifying or replacing existing descriptions', () => {
  expect(pendingCaptions([row('a'), row('b', 'failed'), row('c', 'generated', 'saved'), row('d', 'pending', 'manual'), { id: 'unclassified' }]).map(x => x.id)).toEqual(['a', 'b']);
});
test('serial batches release the classifier before captions and flush before the whole library finishes', async () => {
  const events = [];
  const queue = createCaptionQueue({ limit: 2, release: async () => events.push('release'), run: async images => { events.push(images.map(x => x.id)); return { generated: images.length }; } });
  await queue.add([row('a')]);
  expect(events).toEqual([]);
  await queue.add([row('b')]);
  expect(events).toEqual(['release', ['a', 'b']]);
  await queue.add([row('c')]);
  await queue.flush();
  expect(events).toEqual(['release', ['a', 'b'], 'release', ['c']]);
});
test('stopping leaves pending work for persisted recovery and never starts another model', async () => {
  const run = jest.fn(); const release = jest.fn();
  const queue = createCaptionQueue({ limit: 1, shouldStop: () => true, release, run });
  await queue.add([row('a')]); await queue.flush();
  expect(run).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
});
