const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('path');

// @jimp/core 在 RN 下 require('fs')/require('path')（仅文件读写分支用到，我们不触发），
// 用空模块兜底，避免 "Unable to resolve module fs/path"。
const EMPTY_SHIM = path.resolve(__dirname, 'src/services/enhance/metro-shims/empty.js');

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  resolver: {
    sourceExts: ['js', 'json', 'ts', 'tsx', 'jsx'],
    // 明确指定平台扩展优先级
    platforms: ['ios', 'android', 'native', 'web'],
    alias: {
      buffer: 'buffer',
    },
    blockList: [
      /backup_.*\/.*/, // 排除所有备份目录
    ],
    // 见 EMPTY_SHIM 说明：把裸 fs/path 解析到空模块（仅 @jimp/core 用到且不触发）。
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === 'fs' || moduleName === 'path') {
        return {type: 'sourceFile', filePath: EMPTY_SHIM};
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);

