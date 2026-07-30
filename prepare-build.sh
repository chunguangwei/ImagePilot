#!/bin/bash

# ImageClassifier macOS Build Script
# This script prepares and builds the ImageClassifier application for macOS

set -e  # Exit on any error

echo "🚀 ImageClassifier macOS Build Preparation"
echo "=========================================="

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

echo ""
echo "📋 Checking system requirements..."

# Check for Node.js
if command_exists node; then
    NODE_VERSION=$(node -v)
    echo "✅ Node.js found: $NODE_VERSION"
else
    echo "❌ Node.js not found. Please install Node.js first."
    exit 1
fi

# Check for npm
if command_exists npm; then
    NPM_VERSION=$(npm -v)
    echo "✅ npm found: $NPM_VERSION"
else
    echo "❌ npm not found."
    exit 1
fi

# Check for Git
if command_exists git; then
    GIT_VERSION=$(git --version)
    echo "✅ Git found: $GIT_VERSION"
else
    echo "❌ Git not found."
    exit 1
fi

echo ""
echo "🔧 Checking project structure..."

# Change to the project directory
cd "$(dirname "$0")/pc-version-final" || { echo "❌ Could not find pc-version-final directory"; exit 1; }

echo "📍 Working in: $(pwd)"

# Create a backup of the original package.json in case we need to restore it
if [ ! -f "package.json.backup" ]; then
    cp package.json package.json.backup
    echo "📋 Backed up original package.json"
fi

echo ""
echo "📦 Preparing build dependencies..."

# Temporarily modify package.json to make canvas optional during install
echo "📝 Creating temporary package.json without canvas issues..."
cat > temp-package.json << 'EOF'
{
  "name": "imageclassifier-app",
  "version": "1.1.2",
  "description": "ImagePilot-智能分类，便捷管理，仅你可见",
  "author": "ImageClassifier Team",
  "main": "public/electron.js",
  "homepage": "./",
  "scripts": {
    "start": "craco start",
    "prebuild": "node ../scripts/generate-build-info.js",
    "build": "craco build",
    "test": "craco test",
    "eject": "react-scripts eject",
    "electron": "electron .",
    "electron-dev": "concurrently \"npm start\" \"wait-on http://localhost:3000 && electron .\"",
    "electron-pack": "npm run build && electron-builder",
    "electron:build": "npm run build && electron-builder --win nsis",
    "electron:build-portable": "npm run build && electron-builder --win portable",
    "electron:build-all": "npm run build && electron-builder --win nsis --win portable",
    "electron:build-mac": "npm run build && electron-builder --mac dmg",
    "electron:build-mac-zip": "npm run build && electron-builder --mac dmg --mac zip",
    "preelectron-pack": "npm run build"
  },
  "dependencies": {
    "buffer": "^6.0.3",
    "exif-parser": "^0.1.12",
    "jimp": "^1.6.0",
    "noop2": "^1.0.0",
    "onnxruntime-node": "^1.23.0",
    "onnxruntime-web": "^1.22.0",
    "opencv.js": "^1.2.1",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-native": "^0.72.17",
    "react-native-web": "^0.19.6",
    "react-refresh": "^0.17.0",
    "sharp": "^0.34.4"
  },
  "devDependencies": {
    "@craco/craco": "^7.1.0",
    "concurrently": "^8.2.0",
    "copy-webpack-plugin": "^13.0.1",
    "electron": "^25.3.0",
    "electron-builder": "^24.6.3",
    "react-scripts": "5.0.1",
    "wait-on": "^7.0.1"
  },
  "browserslist": {
    "production": [
      ">0.2%",
      "not dead",
      "not op_mini all"
    ],
    "development": [
      "last 1 chrome version",
      "last 1 firefox version",
      "last 1 safari version"
    ]
  },
  "resolutions": {
    "react-native-fs": "npm:noop2@1.0.0",
    "react-native-vector-icons": "npm:noop2@1.0.0"
  },
  "build": {
    "appId": "com.imageclassifier.app",
    "productName": "ImagePilot",
    "directories": {
      "output": "dist"
    },
    "files": [
      "build/**/*",
      "public/**/*",
      "node_modules/**/*",
      "images/**/*"
    ],
    "buildDependenciesFromSource": false,
    "npmRebuild": false,
    "win": {
      "icon": "public/icon.ico",
      "target": [
        {
          "target": "nsis",
          "arch": [
            "x64"
          ]
        },
        {
          "target": "portable",
          "arch": [
            "x64"
          ]
        },
        {
          "target": "appx",
          "arch": [
            "x64"
          ]
        }
      ],
      "requestedExecutionLevel": "asInvoker"
    },
    "appx": {
      "displayName": "ImagePilot",
      "publisher": "CN=03F46D22-3B0F-4788-A8BF-351A4DF78D3D",
      "publisherDisplayName": "ImagePilot",
      "identityName": "E8546D00.75903E98454E",
      "applicationId": "ImagePilot",
      "backgroundColor": "transparent",
      "showNameOnTiles": true,
      "artifactName": "${productName}-${version}.${ext}",
      "languages": [
        "zh-CN"
      ]
    },
    "extraFiles": [
      {
        "from": "build/appx/Assets",
        "to": "Assets",
        "filter": ["**/*.png"]
      }
    ],
    "mac": {
      "icon": "public/icon.icns",
      "target": [
        {
          "target": "dmg",
          "arch": ["x64", "arm64"]
        },
        {
          "target": "zip",
          "arch": ["x64", "arm64"]
        }
      ],
      "category": "public.app-category.photography",
      "artifactName": "${productName}-${version}-${arch}.${ext}",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist"
    },
    "dmg": {
      "title": "ImagePilot",
      "icon": "public/icon.icns",
      "contents": [
        {
          "x": 130,
          "y": 220
        },
        {
          "x": 410,
          "y": 220,
          "type": "link",
          "path": "/Applications"
        }
      ],
      "window": {
        "width": 540,
        "height": 380
      }
    },
    "linux": {
      "icon": "public/icon.png",
      "target": "AppImage"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "allowElevation": true,
      "perMachine": false,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "ImagePilot",
      "deleteAppDataOnUninstall": false,
      "runAfterFinish": true,
      "include": "installer/installer.nsh",
      "artifactName": "${productName}-Setup-${version}.${ext}",
      "language": "2052",
      "warningsAsErrors": false
    }
  }
}
EOF

# Replace the current package.json temporarily
mv package.json package.json.with-canvas
mv temp-package.json package.json

echo ""
echo "📦 Installing dependencies (excluding canvas)..."
npm install --no-optional --legacy-peer-deps

echo ""
echo "✅ Basic dependencies installed successfully!"

echo ""
echo "🔄 Restoring original package.json with canvas dependency..."
mv package.json package.json.without-canvas
mv package.json.with-canvas package.json

echo ""
echo "📋 To complete the installation with canvas support, run these commands manually:"
echo ""
echo "   # Install system dependencies for canvas (run these first):"
echo "   brew install pkg-config cairo pango libpng jpeg giflib librsvg pixman"
echo ""
echo "   # Then install canvas:"
echo "   npm install canvas@^2.11.2"
echo ""
echo "   # Or if you want to rebuild canvas specifically:"
echo "   npm rebuild canvas"
echo ""

echo ""
echo "🎉 The ImageClassifier project is now prepared for macOS!"
echo ""
echo "To run in development mode:"
echo "   npm start           # Terminal 1: Starts the React app"
echo "   npx electron .      # Terminal 2: Starts the Electron app"
echo ""
echo "To build for production:"
echo "   npm run build       # Build the React app"
echo "   npm run electron:build-mac  # Create macOS app"
echo ""
echo "The application will appear in the dist/ folder after building."
echo ""
echo "💡 Note: The core macOS functionality (window management, menus, file operations)"
echo "   is already implemented and will work even without canvas."