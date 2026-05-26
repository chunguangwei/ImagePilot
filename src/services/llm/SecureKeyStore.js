/**
 * SecureKeyStore — 跨平台加密 Key 存储
 *
 * 三平台实现：
 *   - PC (Electron): 使用 Electron safeStorage（基于 OS Keychain）
 *   - iOS (RN): react-native-keychain
 *   - Android (RN): react-native-keychain (背后是 EncryptedSharedPreferences)
 *
 * 设计：
 *   1. 上层只用 ref（如 "kc:openai_key"）—— ConfigService 中只存 ref，不存 Key
 *   2. ref 命名格式：`kc:<providerName>_key`
 *   3. 平台后端通过依赖注入（adapter）传入，便于测试和跨平台
 *
 * Key 命名约定：
 *   - service: 'ImagePilot.LLM'
 *   - account: ref 去掉 'kc:' 前缀（如 'openai_key'）
 */

const SERVICE_NAME = 'ImagePilot.LLM';

/**
 * KeyStoreAdapter 接口（由调用方实现并注入）
 *   - get(service, account): Promise<string|null>
 *   - set(service, account, value): Promise<void>
 *   - remove(service, account): Promise<void>
 *   - list(service): Promise<string[]>  // 可选
 */

export class SecureKeyStore {
  /**
   * @param {object} adapter - 平台 adapter
   * @param {object} [opts]
   * @param {boolean} [opts.cache=true] - 是否在内存缓存（避免频繁解密）
   */
  constructor(adapter, opts = {}) {
    if (!adapter || typeof adapter.get !== 'function') {
      throw new Error('SecureKeyStore: adapter with get/set/remove required');
    }
    this.adapter = adapter;
    this._memCache = opts.cache !== false ? new Map() : null;
  }

  /**
   * 解析 ref → 真实 Key
   * @param {string} ref - 'kc:openai_key' 或纯 account 名
   * @returns {Promise<string|null>}
   */
  async getKey(ref) {
    if (!ref) return null;
    const account = this._parseRef(ref);
    if (this._memCache && this._memCache.has(account)) {
      return this._memCache.get(account);
    }
    const value = await this.adapter.get(SERVICE_NAME, account);
    if (this._memCache && value) this._memCache.set(account, value);
    return value;
  }

  /**
   * 设置 Key
   * @param {string} ref
   * @param {string} value
   */
  async setKey(ref, value) {
    if (!ref) throw new Error('setKey: ref required');
    if (typeof value !== 'string') throw new Error('setKey: value must be string');
    const account = this._parseRef(ref);
    await this.adapter.set(SERVICE_NAME, account, value);
    if (this._memCache) this._memCache.set(account, value);
  }

  /**
   * 删除 Key
   */
  async removeKey(ref) {
    if (!ref) return;
    const account = this._parseRef(ref);
    await this.adapter.remove(SERVICE_NAME, account);
    if (this._memCache) this._memCache.delete(account);
  }

  /**
   * 检查 Key 是否存在（不返回内容）
   */
  async hasKey(ref) {
    const v = await this.getKey(ref);
    return !!v;
  }

  /** 清空内存缓存（如登出时） */
  clearMemCache() {
    if (this._memCache) this._memCache.clear();
  }

  // eslint-disable-next-line class-methods-use-this
  _parseRef(ref) {
    return ref.startsWith('kc:') ? ref.slice(3) : ref;
  }
}

// ============ 平台 Adapter 工厂（按需引入） ============

/**
 * Electron / Node 平台 adapter
 * 用法（在 main 进程注入）：
 *   import { safeStorage } from 'electron';
 *   import Store from 'electron-store';
 *   const store = new Store({ name: 'imagepilot-secrets' });
 *   const adapter = createElectronAdapter({ safeStorage, store });
 *   const keyStore = new SecureKeyStore(adapter);
 *
 * @param {object} deps
 * @param {object} deps.safeStorage - electron.safeStorage
 * @param {object} deps.store       - electron-store 实例
 */
export function createElectronAdapter({ safeStorage, store }) {
  return {
    async get(service, account) {
      const key = `${service}.${account}`;
      const encrypted = store.get(key);
      if (!encrypted) return null;
      if (!safeStorage.isEncryptionAvailable()) return null;
      try {
        const buf = Buffer.from(encrypted, 'base64');
        return safeStorage.decryptString(buf);
      } catch (_) {
        return null;
      }
    },
    async set(service, account, value) {
      const key = `${service}.${account}`;
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Electron safeStorage encryption is not available on this OS');
      }
      const buf = safeStorage.encryptString(value);
      store.set(key, buf.toString('base64'));
    },
    async remove(service, account) {
      const key = `${service}.${account}`;
      store.delete(key);
    },
  };
}

/**
 * React Native 平台 adapter（iOS Keychain + Android EncryptedSharedPreferences）
 * 依赖：react-native-keychain
 *
 * 用法：
 *   import * as Keychain from 'react-native-keychain';
 *   const adapter = createRNKeychainAdapter(Keychain);
 *   const keyStore = new SecureKeyStore(adapter);
 *
 * 注：Keychain 不原生支持 (service, account) 同时存在多 entry，所以我们
 * 把 service+account 拼成单一字符串作为 service 参数。
 */
export function createRNKeychainAdapter(Keychain) {
  return {
    async get(service, account) {
      const compound = `${service}.${account}`;
      try {
        const credentials = await Keychain.getGenericPassword({ service: compound });
        return credentials ? credentials.password : null;
      } catch (_) {
        return null;
      }
    },
    async set(service, account, value) {
      const compound = `${service}.${account}`;
      await Keychain.setGenericPassword(account, value, {
        service: compound,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    },
    async remove(service, account) {
      const compound = `${service}.${account}`;
      await Keychain.resetGenericPassword({ service: compound });
    },
  };
}

/**
 * AsyncStorage 平台 adapter（React Native）—— 持久化，存于应用私有沙盒。
 * 依赖：@react-native-async-storage/async-storage（本仓库已链接）。
 *
 * 说明：相比 react-native-keychain 的硬件加密，这里是「应用私有但明文」存储
 * （/data/data/<pkg> 沙盒，其他应用无法读取，未 root 情况下安全）。选它是因为
 * keychain 未做原生链接，而 AsyncStorage 已可用——优先保证「重启后 Key 不丢」。
 * 如需硬件级加密，后续把 react-native-keychain 原生链接后改用 createRNKeychainAdapter。
 *
 * @param {object} AsyncStorage - @react-native-async-storage/async-storage 默认导出
 */
export function createAsyncStorageAdapter(AsyncStorage) {
  const keyOf = (service, account) => `secure-key:${service}.${account}`;
  return {
    async get(service, account) {
      const v = await AsyncStorage.getItem(keyOf(service, account));
      return v == null ? null : v;
    },
    async set(service, account, value) {
      await AsyncStorage.setItem(keyOf(service, account), value);
    },
    async remove(service, account) {
      await AsyncStorage.removeItem(keyOf(service, account));
    },
  };
}

/**
 * 内存 Adapter（仅用于单元测试，绝不要在生产中使用）
 */
export function createMemoryAdapter() {
  const store = new Map();
  return {
    async get(service, account) {
      return store.get(`${service}.${account}`) ?? null;
    },
    async set(service, account, value) {
      store.set(`${service}.${account}`, value);
    },
    async remove(service, account) {
      store.delete(`${service}.${account}`);
    },
    _dump: () => Object.fromEntries(store), // 仅供测试断言
  };
}

export default SecureKeyStore;
