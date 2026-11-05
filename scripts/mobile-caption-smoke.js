/** Development-only entry point. Place official models in Documents/classify_models
 * and a test image in Documents/sample.jpg. Bundle this file ONLY for a test install. */
import React from 'react';
import { AppRegistry, Text, NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import ImageStorageService from '../src/services/ImageStorageService';
import { runCaptionPass } from '../src/services/classify/LfmCaptionService';
import { captionRecordFields } from '../src/services/classify/captionRecordFields';

const report = { platform: Platform.OS, bridgeReset: typeof NativeModules.RNLlama?.clearCache };
const file = `${RNFS.DocumentDirectoryPath}/caption-smoke-result.json`;
async function run() {
  const storage = new ImageStorageService();
  try {
    await RNFS.writeFile(file, JSON.stringify(report));
    await storage.ensureInitialized();
    const images = [1, 2].map(n => ({ id: `caption-smoke-${n}`, uri: `file://${RNFS.DocumentDirectoryPath}/caption-sample-${n}.jpg`, fileName: `sample-${n}.jpg`, category: 'social_activities', mobileNetV3Detections: { embedding: { model: 'embeddinggemma2', accepted: true } } }));
    for (const image of images) {
      const target = image.uri.replace(/^file:\/\//, '');
      if (await RNFS.exists(target)) await RNFS.unlink(target);
      await RNFS.copyFile(`${RNFS.DocumentDirectoryPath}/sample.jpg`, target);
      await storage.storage.addOrUpdateSingleImage(image);
    }
    const embeddingPath = `${RNFS.DocumentDirectoryPath}/classify_models/embeddinggemma-2-text-vision-440m.litertlm`;
    if (await RNFS.exists(embeddingPath)) {
      const { classifyWithEmbeddingGemma, disposeEmbeddingGemma } = require('../src/services/classify/EmbeddingGemmaClassifier');
      try { report.classification = await classifyWithEmbeddingGemma(images[0].uri, embeddingPath); }
      finally { await disposeEmbeddingGemma(); }
    }
    report.result = await runCaptionPass(images, {
      config: { enabled: true, language: 'system' },
      save: (image, message) => storage.batchUpdateClassification([captionRecordFields(image, { state: 'generated' }, message)]),
      onFailure: async (image, detail) => { report.failure = detail; await storage.batchUpdateClassification([captionRecordFields(image, { state: 'failed', ...detail })]); },
    });
    report.records = [];
    for (const image of images) {
      const saved = await storage.getImageDetailsById(image.id);
      report.records.push({ id: saved?.id, message: saved?.message, category: saved?.category, metadata: saved?.mobileNetV3Detections });
    }
  } catch (error) { report.error = error.message; report.stack = error.stack; }
  report.done = true;
  await RNFS.writeFile(file, JSON.stringify(report, null, 2));
}
AppRegistry.registerComponent('ImageClassifier', () => () => <Text>Caption smoke test</Text>);
AppRegistry.registerComponent('ImagePilot', () => () => <Text>Caption smoke test</Text>);
run();
