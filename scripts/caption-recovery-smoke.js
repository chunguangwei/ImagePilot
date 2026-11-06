// Development-only native + SQLite regression; never use as the release entry point.
import React from 'react';
import { AppRegistry, Text, NativeModules } from 'react-native';
import RNFS from 'react-native-fs';
import ImageStorageService from '../src/services/ImageStorageService';
import { pendingCaptions } from '../src/services/classify/captionQueue';
import { runCaptionPass } from '../src/services/classify/LfmCaptionService';
import { captionRecordFields } from '../src/services/classify/captionRecordFields';
import { classifyWithEmbeddingGemma, disposeEmbeddingGemma } from '../src/services/classify/EmbeddingGemmaClassifier';
import { embeddingRecordFields } from '../src/services/classify/embeddingRecordFields';
const report = {};
async function run() {
  const storage = new ImageStorageService();
  const root = RNFS.DocumentDirectoryPath;
  try {
    await storage.ensureInitialized();
    const images = ['rack', 'trophy', 'portrait', 'cat', 'food', 'group'].map(id => ({ id: `recovery-${id}`, uri: `file://${root}/${id}.jpg`, fileName: `${id}.jpg`, category: 'NA' }));
    for (const image of images) {
      await storage.storage.addOrUpdateSingleImage(image);
      const result = await classifyWithEmbeddingGemma(image.uri, `${root}/classify_models/embeddinggemma-2-text-vision-440m.litertlm`);
      report[image.id] = result;
      await storage.batchUpdateClassification([{ ...image, ...embeddingRecordFields(result, true), category: result.topPrediction?.appCategory || 'other' }]);
    }
    await disposeEmbeddingGemma();
    // Recreate the storage client and use the actual lightweight gallery read after interruption.
    const reopened = new ImageStorageService();
    const pending = pendingCaptions(await reopened.getImages()).filter(x => x.id.startsWith('recovery-'));
    report.recovered = pending.map(x => x.id);
    report.captions = await runCaptionPass(pending, {
      config: { enabled: true },
      save: (image, text) => reopened.batchUpdateClassification([captionRecordFields(image, { state: 'generated' }, text)]),
      onFailure: async (image, detail) => { report.failure = detail; },
    });
    report.records = [];
    for (const image of pending) report.records.push(await reopened.getImageDetailsById(image.id));
    report.remaining = pendingCaptions(await reopened.getImages()).filter(x => x.id.startsWith('recovery-')).length;
  } catch (e) { report.error = e.message; report.stack = e.stack; }
  report.done = true;
  await RNFS.writeFile(`${root}/recovery-smoke-result.json`, JSON.stringify(report, null, 2));
}
AppRegistry.registerComponent('ImagePilot', () => () => <Text>Caption recovery test</Text>);
run();
