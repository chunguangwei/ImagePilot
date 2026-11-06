// The database caption state is the durable queue; this buffer only limits model switches.
export function pendingCaptions(images) {
  return images.filter(image => {
    if (['NA', 'NA_video'].includes(image.category)) return false;
    const embedding = image.mobileNetV3Detections?.embedding;
    if (embedding?.model !== 'embeddinggemma2') return false;
    if (['pending', 'failed', 'fallback'].includes(embedding.classification?.state)) return true;
    return ['pending', 'failed'].includes(embedding.caption?.state)
      && (embedding.caption?.style === 'subject-scene-v1' || !String(image.message || '').trim());
  });
}

export function createCaptionQueue({ limit = 8, release, run, shouldStop = () => false }) {
  let buffer = [];
  async function flush() {
    if (!buffer.length || shouldStop()) return;
    await release();
    const images = buffer;
    buffer = [];
    return run(images);
  }
  return {
    flush,
    async add(images) {
      for (const image of images) {
        if (shouldStop()) break; // persisted pending rows survive stop/process exit
        buffer.push(image);
        if (buffer.length >= limit) await flush();
      }
    },
  };
}
