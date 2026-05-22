/**
 * keyStoreSingleton — 全应用共享的 SecureKeyStore 单例
 *
 * 为什么要单例：配置页（AIModelConfigController）存 Key 与
 * GalleryScannerService 取 Key 必须用**同一个** SecureKeyStore 实例，
 * 否则 UI 里存进去的 Key 在分类时读不到。
 *
 * ⚠️ 默认用 createMemoryAdapter（进程内，不持久化）——仅保证不崩、可冒烟。
 * 真机/桌面上线前请按平台换成持久化适配器（见下注释），需先装对应依赖：
 *   - 移动端：`npm i react-native-keychain`（iOS 还需 pod install）
 *       import * as Keychain from 'react-native-keychain';
 *       adapter = createRNKeychainAdapter(Keychain);
 *   - PC(Electron)：`npm i electron-store`
 *       import { safeStorage } from 'electron'; import Store from 'electron-store';
 *       adapter = createElectronAdapter({ safeStorage, store: new Store() });
 *
 * 切换方式：把下面 makeAdapter() 里的分支按平台返回对应 adapter 即可。
 */

import { SecureKeyStore, createMemoryAdapter } from './SecureKeyStore.js';

function makeAdapter() {
  // TODO(device): 按平台返回持久化 adapter（见文件头注释）。
  // 现在统一用内存适配器，保证缺少原生依赖时也不会破坏构建/启动。
  return createMemoryAdapter();
}

const keyStore = new SecureKeyStore(makeAdapter());

export default keyStore;
