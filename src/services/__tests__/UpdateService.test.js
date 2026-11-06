/**
 * UpdateService — 防回归测试。
 *
 * 重点覆盖最近修过的两个 bug：
 *   1. iOS 用户被推 Android 更新 + 下载链接跑到 Android（修：iOS 早返回 hasUpdate=false）
 *   2. version 比较错乱（修：parseVersion + isNewer 用语义版本逐段比）
 *
 * 不测下载/安装路径（依赖原生 ApkInstaller / RNFS）。
 */

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },          // 默认 android；iOS 用例里 doMock 覆盖
  Linking: { openURL: jest.fn() },
}));

jest.mock('../../config/BuildInfo', () => ({
  BUILD_VERSION: '1.5.1',
}));

describe('isNewer — 语义版本比较', () => {
  let isNewer;
  beforeAll(() => {
    isNewer = require('../UpdateService').isNewer;
  });

  test('a=1.6.0 > b=1.5.1 → true', () => {
    expect(isNewer('1.6.0', '1.5.1')).toBe(true);
  });

  test('a=1.5.1 == b=1.5.1 → false（同版本不算更新）', () => {
    expect(isNewer('1.5.1', '1.5.1')).toBe(false);
  });

  test('a=1.5.0 < b=1.5.1 → false', () => {
    expect(isNewer('1.5.0', '1.5.1')).toBe(false);
  });

  test('字符串前缀 v1.6.0 兼容', () => {
    expect(isNewer('v1.6.0', '1.5.1')).toBe(true);
    expect(isNewer('V1.6.0', '1.5.1')).toBe(true);
  });

  test('a=2.0 > b=1.99.99（首段先决）', () => {
    expect(isNewer('2.0', '1.99.99')).toBe(true);
  });

  test('a=1.5.10 > b=1.5.9（非词典序）', () => {
    expect(isNewer('1.5.10', '1.5.9')).toBe(true);
  });

  test('a 缺位段补 0：1.5 vs 1.5.0 → false（等价）', () => {
    expect(isNewer('1.5', '1.5.0')).toBe(false);
    expect(isNewer('1.5.0', '1.5')).toBe(false);
  });

  test('空/无效输入兜底为 [0]', () => {
    expect(isNewer('', '1.0.0')).toBe(false);
    expect(isNewer('1.0.0', '')).toBe(true);
    expect(isNewer(undefined, '1.0.0')).toBe(false);
  });
});

describe('checkForUpdate — iOS 早返回（不推 Android 更新）', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('react-native', () => ({
      Platform: { OS: 'ios' },
      Linking: { openURL: jest.fn() },
    }));
    jest.doMock('../../config/BuildInfo', () => ({ BUILD_VERSION: '1.5.1' }));
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('iOS：hasUpdate=false，apkUrl=null，pageUrl 是 release 页', async () => {
    const { checkForUpdate, RELEASES_PAGE } = require('../UpdateService');
    const r = await checkForUpdate();
    expect(r.hasUpdate).toBe(false);
    expect(r.latestVersion).toBeNull();
    expect(r.apkUrl).toBeNull();
    expect(r.pageUrl).toBe(RELEASES_PAGE);
  });

  test('iOS：完全不调 fetch（不打 GitHub API）', async () => {
    const { checkForUpdate } = require('../UpdateService');
    await checkForUpdate();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('checkForUpdate — Android 主路径', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('react-native', () => ({
      Platform: { OS: 'android' },
      Linking: { openURL: jest.fn() },
    }));
    jest.doMock('../../config/BuildInfo', () => ({ BUILD_VERSION: '1.5.1' }));
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('API 返回新版本 + apk asset → hasUpdate=true，apkUrl 解析正确', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v1.6.0',
        body: 'release notes',
        html_url: 'https://github.com/x/releases/tag/v1.6.0',
        assets: [
          { name: 'app-release.apk', browser_download_url: 'https://github.com/x/releases/download/v1.6.0/app-release.apk' },
          { name: 'source.zip', browser_download_url: 'https://...' },
        ],
      }),
    });
    const { checkForUpdate } = require('../UpdateService');
    const r = await checkForUpdate();
    expect(r.hasUpdate).toBe(true);
    expect(r.latestVersion).toBe('v1.6.0');
    expect(r.apkUrl).toContain('app-release.apk');
    expect(r.notes).toBe('release notes');
  });

  test('API 返回相同版本 → hasUpdate=false', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: 'v1.5.1', assets: [] }),
    });
    const { checkForUpdate } = require('../UpdateService');
    const r = await checkForUpdate();
    expect(r.hasUpdate).toBe(false);
  });

  test('API 404（无任何 release）→ hasUpdate=false，不抛错', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404 });
    const { checkForUpdate } = require('../UpdateService');
    const r = await checkForUpdate();
    expect(r.hasUpdate).toBe(false);
    expect(r.latestVersion).toBeNull();
  });

  test('API throw（网络挂） + atom 兜底拿到版本 → 用 atom 结果', async () => {
    global.fetch
      .mockRejectedValueOnce(new Error('network')).mockRejectedValueOnce(new Error('proxy network'))      // api.github.com
      .mockResolvedValueOnce({                          // releases.atom
        ok: true,
        text: async () => '<feed><entry><link href="https://github.com/x/releases/tag/v1.7.0"/></entry></feed>',
      })
      .mockResolvedValueOnce({ ok: true, text: async () => '<a href="/chunguangwei/ImagePilot/releases/download/v1.7.0/ImagePilot-android-arm-1.7.0.apk">APK</a>' });
    const { checkForUpdate, UPDATE_REPO } = require('../UpdateService');
    const r = await checkForUpdate();
    expect(r.hasUpdate).toBe(true);
    expect(r.latestVersion).toBe('v1.7.0');
    // API 不通时从实际发布附件列表获取 APK，不猜文件名。
    expect(r.apkUrl).toBe(`https://github.com/${UPDATE_REPO}/releases/download/v1.7.0/ImagePilot-android-arm-1.7.0.apk`);
  });

  test('apk 资产缺失（仅源码包） → apkUrl=null（不会推一个错链接）', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v1.6.0',
        assets: [{ name: 'sources.tar.gz', browser_download_url: 'https://...' }],
      }),
    });
    const { checkForUpdate } = require('../UpdateService');
    const r = await checkForUpdate();
    expect(r.apkUrl).toBeNull();
  });
});

describe('resolveApkUrl — in-app fallback', () => {
  beforeEach(() => { global.fetch = jest.fn(); });
  afterEach(() => { delete global.fetch; });
  test('resolves the actual APK from GitHub expanded assets without opening a browser', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: async () => '<a href="/chunguangwei/ImagePilot/releases/download/v1.8.0/renamed.apk">download</a>' });
    const { resolveApkUrl } = require('../UpdateService');
    expect(await resolveApkUrl({ latestVersion: 'v1.8.0' })).toBe('https://github.com/chunguangwei/ImagePilot/releases/download/v1.8.0/renamed.apk');
  });
  test('does not accept APK links from another repository or release', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: async () => '<a href="https://evil.test/app.apk">apk</a><a href="/other/repo/releases/download/v1.8.0/app.apk">apk</a><a href="/chunguangwei/ImagePilot/releases/download/v1.7.0/old.apk">old</a>' });
    const { resolveApkUrl } = require('../UpdateService');
    await expect(resolveApkUrl({ latestVersion: 'v1.8.0' })).rejects.toThrow();
  });
});

describe('mainland update metadata fallback',()=>{
 beforeEach(()=>{jest.resetModules();jest.doMock('react-native',()=>({Platform:{OS:'android'},Linking:{openURL:jest.fn()}}));});
 afterEach(()=>{delete global.fetch;});
 test('API connection failure tries the verified proxy route',async()=>{
  global.fetch=jest.fn(async url=>{
   if(url.startsWith('https://api.github.com/'))throw new Error('blocked');
   if(url.startsWith('https://gh-proxy.com/https://api.github.com/')) return {ok:true,status:200,json:async()=>({tag_name:'v9.0.0',assets:[],html_url:'https://github.com/chunguangwei/ImagePilot/releases/tag/v9.0.0'})};
   throw new Error('unexpected');
  });
  expect((await require('../UpdateService').checkForUpdate()).hasUpdate).toBe(true);
 });
});
