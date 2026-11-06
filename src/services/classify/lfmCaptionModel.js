import RNFS from 'react-native-fs';
import { ensureLargeModel, modelLocalPath, deleteClassifierModel } from './classifierModelSource';

// Keep legacy module/settings keys for migration; files and model metadata are distinct.
export const CAPTION_MODEL_ID = 'smolvlm-500m-instruct';
export const CAPTION_MODEL_NAME = 'SmolVLM-500M-Instruct';
const BASE = 'https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/72e986006ef53e37cdd3f6d4241c90b0f01df376/';
export const CAPTION_FILES = [
  { filename: 'SmolVLM-500M-Instruct-Q8_0.gguf', bytes: 436806912, sha256: '9d4612de6a42214499e301494a3ecc2be0abdd9de44e663bda63f1152fad1bf4' },
  { filename: 'mmproj-SmolVLM-500M-Instruct-Q8_0.gguf', bytes: 108783360, sha256: 'd1eb8b6b23979205fdf63703ed10f788131a3f812c7b1f72e0119d5d81295150' },
];
export const CAPTION_SIZE_MB = Math.ceil(CAPTION_FILES.reduce((n, f) => n + f.bytes, 0) / 1000000);
const verified = new Map();
let downloading = false;
export function captionModelPaths() {
  return { model: modelLocalPath(CAPTION_FILES[0].filename), projector: modelLocalPath(CAPTION_FILES[1].filename) };
}
async function verifyFile(f) {
  const path = modelLocalPath(f.filename);
  try {
    const stat = await RNFS.stat(path);
    if (Number(stat.size) !== f.bytes) return false;
    const stamp = `${stat.size}:${String(stat.mtime)}`;
    if (verified.get(path) === stamp) return true;
    if ((await RNFS.hash(path, 'sha256')) !== f.sha256) return false;
    verified.set(path, stamp);
    return true;
  } catch (_) { return false; }
}
export async function captionModelReady() {
  for (const f of CAPTION_FILES) if (!(await verifyFile(f))) return false;
  return true;
}
export async function downloadCaptionModel(onProgress, signal) {
  if (downloading) throw new Error('Caption model download already running');
  downloading = true;
  try {
    const total = CAPTION_FILES.reduce((n, f) => n + f.bytes, 0);
    let done = 0;
    for (const f of CAPTION_FILES) {
      if (signal?.aborted) throw new Error('E_ABORTED');
      if (!(await verifyFile(f))) {
        // Remove invalid final files; resumable .part files remain managed by downloader.
        const path = modelLocalPath(f.filename);
        if (await RNFS.exists(path)) await RNFS.unlink(path);
        verified.delete(path);
        await ensureLargeModel(f.filename, BASE + f.filename, p => onProgress?.((done + p * f.bytes) / total), { expectedBytes: f.bytes, expectedSha256: f.sha256, signal });
        if (!(await verifyFile(f))) {
          await deleteClassifierModel(f.filename);
          throw new Error('E_CORRUPT SmolVLM model checksum mismatch');
        }
      }
      done += f.bytes; onProgress?.(done / total);
    }
  } finally { downloading = false; }
}
export async function deleteCaptionModel() {
  if (downloading) throw new Error('Caption model download running');
  for (const f of CAPTION_FILES) {
    const path = modelLocalPath(f.filename);
    verified.delete(path);
    for (const suffix of ['', '.part', '.tail']) {
      if (await RNFS.exists(path + suffix)) await RNFS.unlink(path + suffix);
    }
  }
}

const LEGACY_FILES = ['LFM2.5-VL-450M-Q4_K_M.gguf', 'mmproj-LFM2.5-VL-450m-F16.gguf', ...CAPTION_FILES.map(f => f.filename)];
export async function hasLegacyCaptionModel() {
  for (const name of LEGACY_FILES) for (const suffix of ['', '.part', '.tail']) {
    if (await RNFS.exists(modelLocalPath(name) + suffix)) return true;
  }
  return false;
}
export async function deleteLegacyCaptionModel() {
  for (const name of LEGACY_FILES) for (const suffix of ['', '.part', '.tail']) {
    const path = modelLocalPath(name) + suffix;
    if (await RNFS.exists(path)) await RNFS.unlink(path);
  }
}
