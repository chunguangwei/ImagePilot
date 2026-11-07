// Development-only: isolated signed app with model and fixture JPEGs in its bundle.
// Never imported by the production entry point.
import React from 'react';
import {AppRegistry, Text} from 'react-native';
import RNFS from 'react-native-fs';
import config from '../src/services/ConfigService';
import {classifyWithEmbeddingGemma, disposeEmbeddingGemma} from '../src/services/classify/EmbeddingGemmaClassifier';
const report = {platform: 'iphone-production-pipeline', samples: []};
async function run() {
  try {
    await config.initialize();
    const root = RNFS.MainBundlePath;
    for (const [name, expected] of [['user-rack', 'electronics'], ['user-trophy', 'art'], ['user-group', 'social_activities']]) {
      const result = await classifyWithEmbeddingGemma(`file://${root}/${name}.jpg`, `${root}/model.litertlm`);
      report.samples.push({name, expected, result});
      await RNFS.writeFile(`${RNFS.DocumentDirectoryPath}/production-pipeline.json`, JSON.stringify(report, null, 2));
    }
  } catch (error) {
    report.error = String(error?.stack || error);
  } finally {
    await disposeEmbeddingGemma();
    report.done = true;
    await RNFS.writeFile(`${RNFS.DocumentDirectoryPath}/production-pipeline.json`, JSON.stringify(report, null, 2));
  }
}
AppRegistry.registerComponent('imagepilot', () => () => <Text>Gemma 2 production pipeline test</Text>);
run();
