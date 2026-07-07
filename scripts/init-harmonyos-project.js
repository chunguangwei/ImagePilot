/**
 * 初始化鸿蒙项目结构
 * 创建基本的目录结构和配置文件
 */

const fs = require('fs');
const path = require('path');

console.log('========================================');
console.log('  初始化鸿蒙项目结构');
console.log('========================================');
console.log('');

const projectRoot = path.resolve(__dirname, '..');
const harmonyosDir = path.join(projectRoot, 'harmonyos');

// 检查是否已存在
if (fs.existsSync(harmonyosDir)) {
  console.log('⚠️  harmonyos/ 目录已存在');
  console.log('   如果要重新初始化，请先删除 harmonyos/ 目录');
  process.exit(1);
}

console.log('📁 创建目录结构...');

// 创建目录结构
const directories = [
  'harmonyos',
  'harmonyos/entry',
  'harmonyos/entry/src',
  'harmonyos/entry/src/main',
  'harmonyos/entry/src/main/ets',
  'harmonyos/entry/src/main/ets/entryability',
  'harmonyos/entry/src/main/ets/pages',
  'harmonyos/entry/src/main/ets/react-native',
  'harmonyos/entry/src/main/ets/react-native/modules',
  'harmonyos/entry/src/main/resources',
  'harmonyos/entry/src/main/resources/base',
  'harmonyos/entry/src/main/resources/base/element',
  'harmonyos/entry/src/main/resources/base/media',
  'harmonyos/entry/src/main/resources/base/profile',
  'harmonyos/entry/src/main/resources/rawfile',
];

directories.forEach(dir => {
  const fullPath = path.join(projectRoot, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`   ✅ ${dir}`);
  }
});

console.log('');
console.log('📝 创建配置文件...');

// 创建 oh-package.json5
const ohPackageJson = {
  name: 'xintualbum-harmonyos',
  version: '1.0.0',
  description: 'ImagePilot-鸿蒙版本',
  main: 'index.js',
  author: '',
  license: 'Apache-2.0',
  dependencies: {},
  devDependencies: {
    '@ohos/hypium': '^1.0.0'
  }
};

fs.writeFileSync(
  path.join(harmonyosDir, 'oh-package.json5'),
  JSON.stringify(ohPackageJson, null, 2).replace(/"/g, '')
    .replace(/,(\s*})/g, '$1')
    .replace(/,(\s*\])/g, '$1')
);

console.log('   ✅ oh-package.json5');

// 创建 build-profile.json5
const buildProfile = {
  apiType: 'stageMode',
  buildOption: {
    arkOptions: {
      runtimeOnly: false
    }
  }
};

fs.writeFileSync(
  path.join(harmonyosDir, 'build-profile.json5'),
  JSON.stringify(buildProfile, null, 2).replace(/"/g, '')
);

console.log('   ✅ build-profile.json5');

// 创建 entry/build-profile.json5
fs.writeFileSync(
  path.join(harmonyosDir, 'entry', 'build-profile.json5'),
  JSON.stringify(buildProfile, null, 2).replace(/"/g, '')
);

console.log('   ✅ entry/build-profile.json5');

// 创建 module.json5
const moduleJson = {
  module: {
    name: 'entry',
    type: 'entry',
    description: 'ImagePilot主模块',
    mainElement: 'EntryAbility',
    deviceTypes: ['phone', 'tablet'],
    deliveryWithInstall: true,
    installationFree: false,
    pages: ['pages/Index'],
    abilities: [
      {
        name: 'EntryAbility',
        srcEntry: './ets/entryability/EntryAbility.ets',
        description: '应用入口',
        icon: '$media:icon',
        label: '$string:entry_MainAbility',
        startWindowIcon: '$media:icon',
        startWindowBackground: '$color:start_window_background',
        exported: true,
        skills: [
          {
            entities: ['entity.system.home'],
            actions: ['action.system.home']
          }
        ]
      }
    ],
    requestPermissions: [
      {
        name: 'ohos.permission.READ_MEDIA',
        reason: '需要读取相册图片',
        usedScene: {
          abilities: ['EntryAbility'],
          when: 'inuse'
        }
      },
      {
        name: 'ohos.permission.WRITE_MEDIA',
        reason: '需要保存图片',
        usedScene: {
          abilities: ['EntryAbility'],
          when: 'inuse'
        }
      }
    ]
  }
};

fs.writeFileSync(
  path.join(harmonyosDir, 'entry/src/main/module.json5'),
  JSON.stringify(moduleJson, null, 2).replace(/"/g, '')
);

console.log('   ✅ entry/src/main/module.json5');

// 创建 README.md
const readme = `# 鸿蒙版本

这是ImagePilot的鸿蒙版本。

## 目录结构

- \`entry/\` - 应用入口模块
- \`entry/src/main/ets/\` - ArkTS 源代码
- \`entry/src/main/resources/\` - 资源文件

## 开发

\`\`\`bash
# 安装依赖
ohpm install

# 构建
hvigorw assembleHap
\`\`\`

## 更多信息

请参考项目根目录的文档：
- \`docs/鸿蒙开发环境安装指南.md\`
- \`docs/鸿蒙项目结构设计.md\`
- \`docs/鸿蒙适配方案-快速上线版.md\`
`;

fs.writeFileSync(
  path.join(harmonyosDir, 'README.md'),
  readme
);

console.log('   ✅ README.md');

console.log('');
console.log('========================================');
console.log('✅ 鸿蒙项目结构初始化完成！');
console.log('========================================');
console.log('');
console.log('下一步：');
console.log('1. 运行环境检查: npm run harmonyos:check');
console.log('2. 安装依赖: npm run harmonyos:install');
console.log('3. 测试依赖: npm run harmonyos:test-deps');
console.log('');

