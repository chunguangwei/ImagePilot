const size = 2 * 1024 * 1024;
let fsMock, installer, files;
beforeEach(() => {
  jest.resetModules(); files = new Map();
  fsMock = {
    CachesDirectoryPath: '/cache', DownloadDirectoryPath: '/public/Download',
    exists: jest.fn(async p => files.has(p)), stat: jest.fn(async p => ({ size: files.get(p) || 0 })),
    read: jest.fn(async () => 'PK\x03\x04'), unlink: jest.fn(async p => files.delete(p)),
    moveFile: jest.fn(async (a,b) => { files.set(b,files.get(a)); files.delete(a); }),
    downloadFile: jest.fn(({toFile,begin}) => ({promise: Promise.resolve().then(() => { files.set(toFile,size); begin({statusCode:200,contentLength:size}); return {statusCode:200}; })})),
  };
  installer = {install: jest.fn().mockResolvedValue(true)};
  jest.doMock('react-native-fs', () => fsMock);
  jest.doMock('react-native', () => ({Platform:{OS:'android'}, Linking:{openURL:jest.fn()}, NativeModules:{ApkInstaller:installer}}));
  global.fetch = jest.fn(async url => ({ok:true,url,headers:{get: name => name==='content-length' ? String(size) : null}}));
});
afterEach(() => {delete global.fetch;});
test('uses private cache and reuses the complete APK after installation permission is granted', async () => {
  const {downloadAndInstall}=require('../UpdateService');
  const error=Object.assign(new Error('permission'),{code:'E_NEED_PERMISSION'});
  installer.install.mockRejectedValueOnce(error).mockResolvedValueOnce(true);
  await expect(downloadAndInstall('https://github.com/a/v1/app.apk')).rejects.toMatchObject({code:'E_NEED_PERMISSION'});
  const path=await downloadAndInstall('https://github.com/a/v1/app.apk');
  expect(path.startsWith('/cache/')).toBe(true);
  expect(fsMock.downloadFile).toHaveBeenCalledTimes(1);
  expect(installer.install).toHaveBeenCalledTimes(2);
});
test('different release URLs never reuse the preceding version package', async () => {
  const {downloadAndInstall}=require('../UpdateService');
  const a=await downloadAndInstall('https://github.com/a/v1/app.apk');
  const b=await downloadAndInstall('https://github.com/a/v2/app.apk');
  expect(a).not.toBe(b);
  expect(fsMock.downloadFile).toHaveBeenCalledTimes(2);
});

test('an installation failure retains the local path and retries without any network request', async () => {
  const {downloadAndInstall, installDownloadedApk}=require('../UpdateService');
  installer.install.mockRejectedValueOnce(Object.assign(new Error('system refused'),{code:'E_INSTALL'}));
  let failure;
  try {await downloadAndInstall('https://github.com/a/v3/app.apk');} catch(e){failure=e;}
  expect(failure).toMatchObject({code:'E_INSTALL',updateStage:'install'});
  expect(failure.apkPath.startsWith('/cache/')).toBe(true);
  global.fetch.mockClear();
  await installDownloadedApk(failure.apkPath);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(fsMock.downloadFile).toHaveBeenCalledTimes(1);
});
