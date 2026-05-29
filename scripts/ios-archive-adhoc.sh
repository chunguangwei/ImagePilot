#!/usr/bin/env bash
# scripts/ios-archive-adhoc.sh
#
# Ad Hoc 一键打包：archive(Release) → exportArchive → /tmp/ImagePilot-vX.Y.Z.ipa
#
# 前置：
#   1) brew install cocoapods   （已装可跳）
#   2) cd ios && pod install
#   3) 用 Xcode 打开 ios/ImagePilot.xcworkspace → Target ImagePilot → Signing & Capabilities
#      ✓ 勾 Automatically manage signing（首次让 Xcode 帮你建 cert + profile 最稳）
#      Team 选你自己的 Apple Developer 账号
#   4) Apple Developer 后台：注册目标 iPhone 的 UDID
#   5) 改 ios/ExportOptions.plist 里的 <YOUR_TEAM_ID> 和 <YOUR_AD_HOC_PROFILE_NAME>
#
# 用法：
#   bash scripts/ios-archive-adhoc.sh
#
# 产物：
#   /tmp/ImagePilot-<version>.ipa   — 直接拖进 Apple Configurator 或发 TestFlight

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
IOS_DIR="$ROOT/ios"
WORKSPACE="$IOS_DIR/ImagePilot.xcworkspace"
SCHEME="ImagePilot"

# 从 package.json 拿版本号给 ipa 命名
VERSION=$(node -p "require('./package.json').version")
ARCHIVE_PATH="/tmp/ImagePilot-v${VERSION}.xcarchive"
EXPORT_DIR="/tmp/ImagePilot-v${VERSION}-ipa"
IPA_PATH="${EXPORT_DIR}/ImagePilot.ipa"
EXPORT_OPTIONS="$IOS_DIR/ExportOptions.plist"

echo "📦 ImagePilot iOS Ad Hoc 打包"
echo "    版本: v${VERSION}"
echo "    workspace: ${WORKSPACE}"
echo

if ! grep -q "YOUR_TEAM_ID" "$EXPORT_OPTIONS" 2>/dev/null; then
  echo "ℹ️  ExportOptions.plist 已配置（不含占位符 YOUR_TEAM_ID）"
else
  echo "❌ ${EXPORT_OPTIONS} 里还有 YOUR_TEAM_ID / YOUR_AD_HOC_PROFILE_NAME 占位符"
  echo "    请按文件顶部注释先填好，再跑本脚本。"
  exit 1
fi

# 清理上一次产物（不清的话 archive 失败时容易留半截）
rm -rf "$ARCHIVE_PATH" "$EXPORT_DIR"

# ---- 1) 先生成 BuildInfo + Metro 包用的 prebuild 信息 ----
echo "🛠  生成 BuildInfo..."
node scripts/generate-build-info.js >/dev/null

# ---- 2) Archive（Release 配置 / 设备架构） ----
echo "📚 xcodebuild archive (Release / generic iOS device) ..."
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE_PATH" \
  -allowProvisioningUpdates \
  archive

# ---- 3) 导出 .ipa ----
echo "📤 xcodebuild -exportArchive (ad-hoc) ..."
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -allowProvisioningUpdates

echo
echo "✅ 完成：$IPA_PATH"
echo
echo "下一步："
echo "  · 真机：Finder → 把 .ipa 拖到接好线的 iPhone（或用 Apple Configurator 2）"
echo "  · TestFlight：用 Transporter.app 上传 IPA（method 需是 app-store，本脚本是 ad-hoc，不能用）"
echo "  · 自家用：把 ipa 上传到你自己的服务器，用 itms-services 链接 OTA 安装"
