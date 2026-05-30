const path = require('path');

module.exports = {
  babel: {
    presets: [
      '@babel/preset-env',
      '@babel/preset-react'
    ],
    plugins: [
      '@babel/plugin-proposal-class-properties'
    ]
  },
  webpack: {
    configure: (webpackConfig) => {
      // 指定入口文件为 index.desktop.js
      webpackConfig.entry = path.resolve(__dirname, 'src/index.desktop.js');
      
      // 添加别名，将 react-native 映射到 react-native-web
      webpackConfig.resolve.alias = {
        ...webpackConfig.resolve.alias,
        'react-native': 'react-native-web',
        // PC 构建不包含 onnxruntime-react-native，用桩模块避免 resolve 报错（Electron 用 onnxruntime-node）
        'onnxruntime-react-native': path.resolve(__dirname, 'stubs/onnxruntime-react-native.js'),
        // 强制使用正确的React版本
        'react': path.resolve(__dirname, 'node_modules/react'),
        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      };
      
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        "react-native-fs": false,
        "react-native-vector-icons": false,
        "react-native-image-picker": false,
      };
      
      // 使用 ignorePlugin 完全忽略这些模块
      const webpack = require('webpack');
      webpackConfig.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /^(react-native-fs|react-native-vector-icons|react-native-image-picker|react-native-localize)$/
        })
      );
      
      // 添加 CopyWebpackPlugin 来复制模型文件
      const CopyWebpackPlugin = require('copy-webpack-plugin');
      webpackConfig.plugins.push(
        new CopyWebpackPlugin({
          patterns: [
            {
              from: path.resolve(__dirname, 'public/models'),
              to: path.resolve(__dirname, 'build/models')
            }
          ]
        })
      );
      
      // 配置 source-map-loader 忽略缺失的 source map 文件
      // 修复 onnxruntime-react-native 缺失 source map 导致的构建失败
      if (webpackConfig.module && webpackConfig.module.rules) {
        webpackConfig.module.rules.forEach((rule) => {
          // 查找 source-map-loader 规则
          if (rule.use && Array.isArray(rule.use)) {
            const sourceMapLoaderIndex = rule.use.findIndex(
              (use) => use.loader && use.loader.includes('source-map-loader')
            );

            if (sourceMapLoaderIndex !== -1) {
              // 排除 onnxruntime-react-native 模块
              if (!rule.exclude) {
                rule.exclude = /node_modules\/onnxruntime-react-native/;
              } else if (Array.isArray(rule.exclude)) {
                rule.exclude.push(/node_modules\/onnxruntime-react-native/);
              } else {
                rule.exclude = [rule.exclude, /node_modules\/onnxruntime-react-native/];
              }

              // 配置 source-map-loader 忽略错误
              rule.use[sourceMapLoaderIndex].options = rule.use[sourceMapLoaderIndex].options || {};
              // 使用 webpack 的 ignoreWarnings 或者直接修改 loader 行为
            }
          }
        });
      }

      // 扩 babel-loader 的 include —— CRA 默认只编译 pc-version-final/src/，
      // 但 RN 移动端共享的 src/ui/config/AIModelConfigScreen.desktop.jsx 在 RN 根 src/ 下，
      // 没扩 include 它进 source-map-loader 但没进 babel-loader，
      // 结果 JSX 没转译 → 报 "Unexpected token <"。
      // 把 RN 根 src/ 也加进 babel-loader 的 include，复用同一 controller 双端共享。
      const rnSrcPath = path.resolve(__dirname, '../src');
      if (webpackConfig.module && webpackConfig.module.rules) {
        webpackConfig.module.rules.forEach((rule) => {
          // CRA 的规则 oneOf 在 rule.oneOf 数组里
          const innerRules = rule.oneOf || [rule];
          innerRules.forEach((inner) => {
            const loader = inner.loader || '';
            const isBabel = loader.includes('babel-loader');
            const testsJsx =
              inner.test instanceof RegExp &&
              (inner.test.test('test.jsx') || inner.test.test('test.js'));
            if (isBabel && testsJsx) {
              // include 可能是 string / array / RegExp，统一成数组追加
              if (!inner.include) {
                inner.include = [rnSrcPath];
              } else if (Array.isArray(inner.include)) {
                if (!inner.include.includes(rnSrcPath)) inner.include.push(rnSrcPath);
              } else {
                inner.include = [inner.include, rnSrcPath];
              }
            }
          });
        });
      }
      
      // 使用 webpack 的 ignoreWarnings 来忽略 source map 警告
      if (!webpackConfig.ignoreWarnings) {
        webpackConfig.ignoreWarnings = [];
      }
      webpackConfig.ignoreWarnings.push(
        /Failed to parse source map/,
        /ENOENT: no such file or directory.*\.map/
      );
      
      return webpackConfig;
    },
  },
};
