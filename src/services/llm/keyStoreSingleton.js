/**
 * keyStoreSingleton — 全应用共享的 SecureKeyStore 单例
 *
 * 为什么要单例：配置页（AIModelConfigController）存 Key 与
 * GalleryScannerService 取 Key 必须用**同一个** SecureKeyStore 实例，
 * 否则 UI 里存进去的 Key 在分类时读不到。
 *
 * 持久化：优先用 AsyncStorage 适配器（应用私有沙盒，重启后 Key 不丢）；
 * AsyncStorage 不可用时回退内存适配器（仅保证不崩）。
 * 如需硬件级加密：原生链接 react-native-keychain 后，把 makeAdapter 改为
 * createRNKeychainAdapter(Keychain)（PC 端可用 createElectronAdapter）。
 */

import { SecureKeyStore, createMemoryAdapter, createAsyncStorageAdapter } from './SecureKeyStore.js';

function makeAdapter() {
  // 优先 AsyncStorage 持久化；不可用则回退内存，保证不破坏构建/启动。
  try {
    // eslint-disable-next-line global-require
    const mod = require('@react-native-async-storage/async-storage');
    const AsyncStorage = mod && (mod.default || mod);
    if (AsyncStorage && typeof AsyncStorage.getItem === 'function' && typeof AsyncStorage.setItem === 'function') {
      return createAsyncStorageAdapter(AsyncStorage);
    }
  } catch (_) {
    // ignore，回退内存
  }
  return createMemoryAdapter();
}

const keyStore = new SecureKeyStore(makeAdapter());

export default keyStore;
