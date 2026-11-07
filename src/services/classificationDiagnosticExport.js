import RNFS from 'react-native-fs';
import {NativeModules, Platform, Share} from 'react-native';

let exportSequence = 0;

export async function exportClassificationDiagnostic(result, title) {
  const cache = RNFS.CachesDirectoryPath;
  if (!cache) throw new Error('Cache directory unavailable');
  const shareFile = NativeModules.MultiImageShareModule?.shareFile;
  if (Platform.OS === 'android' && typeof shareFile !== 'function') {
    throw new Error('File sharing unavailable');
  }
  const report = {
    model: result.model, scoringVersion: result.scoringVersion, accepted: result.accepted,
    rejectionReason: result.rejectionReason, fallbackCategory: result.fallbackCategory,
    minimumMargin: result.minimumMargin, minimumSimilarity: result.minimumSimilarity,
    ...result.diagnostics,
  };
  const path = `${cache}/imagepilot-classification-${Date.now()}-${++exportSequence}.txt`;
  await RNFS.writeFile(path, '\uFEFF' + JSON.stringify(report, null, 2) + '\n', 'utf8');
  // Keep the cache file after opening the share sheet: the receiving app may read it later.
  if (Platform.OS === 'android') {
    await NativeModules.MultiImageShareModule.shareFile(path, 'text/plain', title);
  } else {
    await Share.share({title, url: `file://${path}`});
  }
  return path;
}
