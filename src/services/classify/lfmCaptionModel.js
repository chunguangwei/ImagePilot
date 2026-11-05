import RNFS from 'react-native-fs';
import { ensureLargeModel, modelLocalPath, deleteClassifierModel } from './classifierModelSource';

// Official LiquidAI GGUF assets. Both files are required; languages share weights.
const BASE = 'https://huggingface.co/LiquidAI/LFM2.5-VL-450M-GGUF/resolve/main/';
export const CAPTION_FILES = [
  { filename: 'LFM2.5-VL-450M-Q4_K_M.gguf', bytes: 229313568, sha256: '1093f1331319199bbcacdbd7ecc9aa6e5678db6b55073948d0f508be90c8ab68' },
  { filename: 'mmproj-LFM2.5-VL-450m-F16.gguf', bytes: 189126080, sha256: '51b458cfdbc736982145a35f798ce37611af0aab639e58b33473ba0c7815fd99' },
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
        await ensureLargeModel(f.filename, BASE + f.filename, p => onProgress?.((done + p * f.bytes) / total), { expectedBytes: f.bytes, signal });
        if (!(await verifyFile(f))) {
          await deleteClassifierModel(f.filename);
          throw new Error('E_CORRUPT LFM model checksum mismatch');
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
