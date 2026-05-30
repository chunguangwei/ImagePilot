// 🔧 必须在所有 import 之前设置 polyfill，防止依赖库使用未定义的函数
// 设置 setImmediate polyfill (React Native 不支持 setImmediate)
if (typeof global.setImmediate === 'undefined') {
  global.setImmediate = (fn, ...args) => {
    return setTimeout(() => {
      if (typeof fn === 'function') {
        fn(...args);
      }
    }, 0);
  };
  global.clearImmediate = (id) => {
    return clearTimeout(id);
  };
}

// 设置 performance polyfill (React Native 不支持 performance API)
if (typeof global.performance === 'undefined') {
  const startTime = Date.now();
  global.performance = {
    now: () => {
      return Date.now() - startTime;
    },
    timing: {
      navigationStart: startTime,
    },
    mark: () => {},
    measure: () => {},
    clearMarks: () => {},
    clearMeasures: () => {},
    getEntriesByType: () => [],
    getEntriesByName: () => [],
  };
}

// 设置 Intl polyfill (React Native 的 JavaScriptCore 在某些 Android 版本中不支持 Intl)
// 注意：polyfills.js 中已经有 Intl polyfill，这里只作为备用
// 直接使用简单实现，避免 require 失败导致应用无法启动
if (typeof global.Intl === 'undefined') {
  global.Intl = {
    DateTimeFormat: class {
      constructor(locale, options) {
        this.locale = locale;
        this.options = options;
      }
      format(date) {
        // 简单的日期格式化实现
        if (!date) return '';
        const d = new Date(date);
        if (isNaN(d.getTime())) return '';
        // 使用简单的日期格式化，不依赖 Intl
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
      }
    },
    NumberFormat: class {
      constructor(locale, options) {
        this.locale = locale;
        this.options = options;
      }
      format(number) {
        // 简单的数字格式化实现
        if (typeof number !== 'number') return String(number);
        // 使用简单的数字格式化，不依赖 Intl
        return String(number);
      }
    },
    Collator: class {
      constructor(locale, options) {
        this.locale = locale;
        this.options = options;
      }
      compare(a, b) {
        // 简单的字符串比较实现（不依赖 localeCompare）
        const aStr = String(a || '').toLowerCase();
        const bStr = String(b || '').toLowerCase();
        if (aStr < bStr) return -1;
        if (aStr > bStr) return 1;
        return 0;
      }
    }
  };
}

// 共享适配层 - 移动端专用版本
// 使用静态导入避免Metro的动态require问题
import React from 'react';
import { View, Text, Alert as RNAlert, Platform, PermissionsAndroid as RN_PermissionsAndroid, NativeModules, AppState as RNAppState, BackHandler } from 'react-native';
import { Buffer } from 'buffer';

// React Native 专用模块 - 静态导入
import RNFS_Native from 'react-native-fs';
import AsyncStorage_Native from '@react-native-async-storage/async-storage';
import SQLite_Native from 'react-native-sqlite-storage';
import { SafeAreaView as SafeAreaView_Native } from 'react-native-safe-area-context';
import { NavigationContainer as NavigationContainer_Native, useFocusEffect as useFocusEffect_Native } from '@react-navigation/native';
import { createStackNavigator as createStackNavigator_Native } from '@react-navigation/stack';
import { createBottomTabNavigator as createBottomTabNavigator_Native } from '@react-navigation/bottom-tabs';
import { launchImageLibrary as launchImageLibrary_Native } from 'react-native-image-picker';
import MaterialIcons_Native from 'react-native-vector-icons/MaterialIcons';
import ImageResizer_Native from 'react-native-image-resizer';
import jpeg from 'jpeg-js';

console.log('✅ React Native modules loaded successfully (native version)');

// ========== 统一日志系统 ==========
class Logger {
  constructor() {
    this.isDevelopment = __DEV__;
    this.isDebug = this.isDevelopment;
    // 日志收集：最多保存最近1000条日志
    this.logBuffer = [];
    this.maxLogSize = 1000;
    this.loggingEnabled = true; // 是否启用日志收集
  }

  setDebugMode(enabled) {
    this.isDebug = enabled;
  }

  setLoggingEnabled(enabled) {
    this.loggingEnabled = enabled;
  }

  // 格式化日志参数
  formatArgs(args) {
    return args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
  }

  log(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    
    // 收集日志（在 release 版本中也收集所有级别的日志，方便调试）
    // 注意：即使 isDebug 为 false，也收集所有日志，但只输出 error 和 warn 到控制台
    if (this.loggingEnabled) {
      const formattedArgs = this.formatArgs(args);
      const logEntry = `${prefix} ${message}${formattedArgs ? ' ' + formattedArgs : ''}`;
      
      this.logBuffer.push(logEntry);
      
      // 限制日志缓冲区大小
      if (this.logBuffer.length > this.maxLogSize) {
        this.logBuffer.shift(); // 移除最旧的日志
      }
    }
    
    // 输出到控制台（仅在 debug 模式下，但 error 和 warn 始终输出）
    if (!this.isDebug && level !== 'error' && level !== 'warn') return;
    
    switch (level) {
      case 'error':
        console.error(prefix, message, ...args);
        break;
      case 'warn':
        console.warn(prefix, message, ...args);
        break;
      case 'info':
        console.info(prefix, message, ...args);
        break;
      case 'debug':
        console.log(prefix, message, ...args);
        break;
      default:
        console.log(prefix, message, ...args);
    }
  }

  error(message, ...args) { this.log('error', message, ...args); }
  warn(message, ...args) { this.log('warn', message, ...args); }
  info(message, ...args) { this.log('info', message, ...args); }
  debug(message, ...args) { this.log('debug', message, ...args); }

  // 获取所有日志
  getAllLogs() {
    return this.logBuffer.join('\n');
  }

  // 清空日志
  clearLogs() {
    this.logBuffer = [];
  }

  // 获取日志数量
  getLogCount() {
    return this.logBuffer.length;
  }
}

const logger = new Logger();

// URI分隔符：用于拼装contentUri和relativePath
// 使用双竖线 || 作为分隔符，确保在content URI中绝对不会出现
const URI_SEPARATOR = '||';

const isPermissionDenied = (error) => {
  const message = typeof error === 'string' ? error : error?.message;
  const code = typeof error === 'object' ? error?.code : undefined;

  const permissionCodes = ['EACCES', 'EPERM', 'PERMISSION_DENIED', 'SECURITY_EXCEPTION'];
  if (code && permissionCodes.includes(String(code).toUpperCase())) {
    return true;
  }

  if (!message || typeof message !== 'string') {
    return false;
  }
  
  const lowerMessage = message.toLowerCase();
  return [
    '权限',
    'permission',
    'eacces',
    'eperm',
    'securityexception',
    'operation not permitted',
    'selinux',
    'requires android.permission',
  ].some(keyword => lowerMessage.includes(keyword));
};

// ========== 导出 ==========

// Platform（直接重新导出）
export { Platform };

// NativeModules（直接重新导出，用于访问原生模块）
export { NativeModules };

// AppState（用于监听应用状态变化）
export const AppState = RNAppState;

// BackHandler（用于处理返回键和退出应用）
export { BackHandler };

// logger
export { logger };

// URI转换函数
export const getWebAccessibleUri = (uri) => {
  if (!uri) return null;
  return uri.startsWith('file://') ? uri : `file://${uri}`;
};

// 路径标准化函数 - 统一处理不同平台的文件路径格式
export const normalizeFilePath = (filePath) => {
  if (!filePath) return filePath;
  
  let normalizedPath = filePath;
  
  // 移除file://前缀（支持 file:// 和 file:/// 两种格式）
  if (normalizedPath.startsWith('file:///')) {
    normalizedPath = normalizedPath.replace('file:///', '');
  } else if (normalizedPath.startsWith('file://')) {
    normalizedPath = normalizedPath.replace('file://', '');
  }
  
  // Windows路径处理: /D:/path -> D:/path
  // 使用循环确保移除所有前导斜杠
  while (normalizedPath.startsWith('/') && normalizedPath.length > 2 && normalizedPath[2] === ':') {
    normalizedPath = normalizedPath.substring(1);
  }

  // 解码可能存在的URL编码路径（如中文、空格、冒号等）
  // 需要分段解码，因为路径可能部分编码、部分未编码
  try {
    // 对于 Windows 路径，需要分别处理盘符和路径部分
    if (normalizedPath.match(/^[A-Za-z]:/)) {
      const driveMatch = normalizedPath.match(/^([A-Za-z]:)(.*)$/);
      if (driveMatch) {
        const drive = driveMatch[1]; // 盘符，例如 "C:"
        const pathPart = driveMatch[2]; // 路径部分
        
        // 对路径部分分段解码
        const decodedPathPart = pathPart.split('/').map(segment => {
          if (!segment) return segment; // 保留空字符串（用于处理连续斜杠）
          try {
            // 尝试解码每个路径段
            return decodeURIComponent(segment);
          } catch (e) {
            // 如果解码失败（可能已经是未编码的），保留原始值
            return segment;
          }
        }).join('/');
        
        normalizedPath = drive + decodedPathPart;
      }
    } else {
      // 非 Windows 路径：分段解码路径
      const decodedPathPart = normalizedPath.split('/').map(segment => {
        if (!segment) return segment; // 保留空字符串
        try {
          return decodeURIComponent(segment);
        } catch (e) {
          return segment; // 解码失败，保留原始值
        }
      }).join('/');
      normalizedPath = decodedPathPart;
    }
  } catch (e) {
    // 如果解码失败，保留原始字符串
    // 这通常意味着路径已经是未编码的格式
  }

  // 将正斜杠统一转换为当前系统的路径分隔符
  const separator = (typeof process !== 'undefined' && process.platform === 'win32') ? '\\' : '/';
  normalizedPath = normalizedPath.replace(/\//g, separator);
  
  return normalizedPath;
};

// 将文件路径转换为 file:// URI，正确处理路径中的特殊字符（包括冒号、中文等）
// Windows路径中的冒号（除了盘符）需要被编码为 %3A
// 中文和其他特殊字符需要被正确编码
export const pathToFileUri = (filePath) => {
  if (!filePath) return filePath;
  
  // 如果已经是 file:// URI，需要确保它被正确编码
  if (filePath.startsWith('file://')) {
    // 调用 ensureEncodedFileUri 确保编码正确
    return ensureEncodedFileUri(filePath);
  }
  
  // 规范化路径：将反斜杠转换为正斜杠
  let normalizedPath = filePath.replace(/\\/g, '/');
  
  // Windows路径处理：保留盘符后的冒号，但编码路径中其他位置的冒号
  // 例如：C:/test:image/中文/photo.jpg -> file://C:/test%3Aimage/%E4%B8%AD%E6%96%87/photo.jpg
  if (normalizedPath.match(/^[A-Za-z]:/)) {
    // Windows路径：分离盘符和路径部分
    const driveMatch = normalizedPath.match(/^([A-Za-z]:)(.*)$/);
    if (driveMatch) {
      const drive = driveMatch[1]; // 例如 "C:"
      let pathPart = driveMatch[2]; // 例如 "/test:image/中文/photo.jpg"
      
      // 确保路径部分以 / 开头（如果没有）
      if (!pathPart.startsWith('/')) {
        pathPart = '/' + pathPart;
      }
      
      // 对路径部分进行编码，分段处理每个路径段
      // 这样可以正确处理中文、冒号、空格等特殊字符
      const encodedPath = pathPart.split('/').map((segment, index) => {
        // 第一个空字符串（由于 split 产生的）保留为空字符串
        if (!segment) {
          return segment;
        }
        
        // 对每个路径段进行编码，处理冒号、中文等特殊字符
        // encodeURIComponent 会正确编码：冒号(:) -> %3A，中文 -> %E4%B8%AD%E6%96%87 等
        return encodeURIComponent(segment);
      }).join('/');
      
      // 移动端使用 file:// 格式（两个斜杠），但Windows路径需要三个斜杠
      return `file:///${drive}${encodedPath}`;
    }
  }
  
  // 非Windows路径或无法识别的格式：分段编码路径
  // 使用 split 和 map 确保每个路径段都被正确编码
  const encodedPath = normalizedPath.split('/').map(segment => {
    if (!segment) {
      return segment; // 保留空字符串
    }
    return encodeURIComponent(segment);
  }).join('/');
  
  // 移动端使用 file:// 格式（两个斜杠）
  return `file://${encodedPath}`;
};

const ensureEncodedFileUri = (uri) => {
  if (!uri || typeof uri !== 'string') {
    return null;
  }

  if (!uri.startsWith('file://')) {
    return pathToFileUri(uri);
  }

  try {
    const tripleSlash = uri.startsWith('file:///');
    const prefix = tripleSlash ? 'file:///' : 'file://';
    let pathPart = uri.slice(prefix.length);

    // 移除前导斜杠（如果有）
    if (pathPart.startsWith('/')) {
      pathPart = pathPart.replace(/^\/+/, '');
    }

    // 对于 Windows 路径，需要特殊处理盘符
    if (pathPart.match(/^[A-Za-z]:/)) {
      const driveMatch = pathPart.match(/^([A-Za-z]:)(.*)$/);
      if (driveMatch) {
        const drive = driveMatch[1]; // 盘符，例如 "C:"
        let pathSegments = driveMatch[2]; // 路径部分
        
        // 确保路径部分以 / 开头（如果没有）
        if (!pathSegments.startsWith('/')) {
          pathSegments = '/' + pathSegments;
        }
        
        // 分段解码和重新编码，确保所有特殊字符（包括中文、冒号）都被正确编码
        const encodedPath = pathSegments.split('/').map((segment) => {
          if (!segment) {
            return segment; // 保留空字符串
          }
          
          // 先解码（如果已经编码），然后重新编码
          // 这样可以确保所有路径段都被正确编码
          let decodedSegment = segment;
          try {
            decodedSegment = decodeURIComponent(segment);
          } catch (decodeError) {
            // 如果解码失败（可能已经是未编码的），使用原始值
            decodedSegment = segment;
          }
          
          // 重新编码，确保冒号、中文等特殊字符都被正确编码
          return encodeURIComponent(decodedSegment);
        }).join('/');
        
        return `file:///${drive}${encodedPath}`;
      }
    }
    
    // 非 Windows 路径：分段解码和重新编码
    const segments = pathPart.split('/').map((segment) => {
      if (!segment) {
        return segment; // 保留空字符串
      }
      
      // 先解码（如果已经编码），然后重新编码
      let decodedSegment = segment;
      try {
        decodedSegment = decodeURIComponent(segment);
      } catch (decodeError) {
        // 如果解码失败（可能已经是未编码的），使用原始值
        decodedSegment = segment;
      }
      
      // 重新编码，确保所有特殊字符都被正确编码
      return encodeURIComponent(decodedSegment);
    });
    
    return `${prefix}${segments.join('/')}`;
  } catch (error) {
    logger.warn(`⚠️ ensureEncodedFileUri failed: ${error.message}`);
    return uri;
  }
};

/**
 * 统一处理路径参数，将字符串或对象转换为统一的URI字符串
 * @param {string|object} input - 可以是URI字符串或图片对象
 * @returns {string|null} URI字符串（从对象的uri字段提取，或直接返回字符串）
 */
const normalizePathParams = (input) => {
  if (!input) {
    return null;
  }

  // 字符串输入：直接返回（URI字符串，如 "content://..." 或 "file://..."）
  if (typeof input === 'string') {
    return input.trim();
  }

  // 对象输入：提取uri字段（图片对象，如 { uri: '...', fileName: '...', ... }）
  if (typeof input === 'object') {
    return input.uri ?? null;
  }

  return null;
};

/**
 * 解析拼装的URI（contentUri||relativePath 格式）
 * @param {string} uri - 可能是拼装的URI或普通URI
 * @returns {Object} { contentUri, relativePath, isCombined }
 */
const parseCombinedUri = (uri) => {
  if (!uri || typeof uri !== 'string') {
    return { contentUri: null, relativePath: null, isCombined: false };
  }
  
  // 检查是否包含分隔符 ||
  const separatorIndex = uri.indexOf(URI_SEPARATOR);
  if (separatorIndex === -1) {
    // 没有分隔符，说明是普通URI
    const isOpaqueScheme = uri.startsWith('content://') || uri.startsWith('ph://');
    return {
      contentUri: isOpaqueScheme ? uri : null,
      relativePath: null,
      isCombined: false
    };
  }
  
  // 有分隔符，拆分
  const contentUri = uri.substring(0, separatorIndex);
  const relativePath = uri.substring(separatorIndex + URI_SEPARATOR.length);
  
  return { 
    contentUri, 
    relativePath, 
    isCombined: true 
  };
};

/**
 * 从输入中提取本地文件路径
 * @param {string|object} input - 可以是URI字符串或图片对象
 * @returns {string|null} 本地文件路径（相对路径或绝对路径），如果是content:// URI则返回null
 */
export const getLocalPath = (input) => {
  const originalUri = normalizePathParams(input);
  
  // 如果没有originalUri，返回null
  if (!originalUri || typeof originalUri !== 'string') {
    return null;
  }
  
  // 检查是否是拼装格式（contentUri||path）
  // path可能是相对路径（Android 10+）或绝对路径（Android 9及以下）
  const { relativePath, isCombined } = parseCombinedUri(originalUri);
  
  if (isCombined && relativePath) {
    // 是拼装格式，直接返回path部分（MediaStore返回的路径已经是标准格式）
    return relativePath;
  }
  
  // 不是拼装格式，按原逻辑处理
  if (originalUri.startsWith('content://')) {
    // content:// URI 无法直接获取本地路径
    return null;
  }
  
  // 普通路径或file:// URI，标准化后返回
  return normalizeFilePath(originalUri);
};

/**
 * 从输入中提取file:// URI
 * @param {string|object} input - 可以是URI字符串或图片对象
 * @returns {string|null} file:// URI，如果是content:// URI则返回null
 */
export const getFileUri = (input) => {
  const originalUri = normalizePathParams(input);

  if (!originalUri || typeof originalUri !== 'string') {
    return null;
  }

  // 检查是否是拼装格式（contentUri||path）
  const { isCombined } = parseCombinedUri(originalUri);
  if (isCombined) {
    // 是拼装格式，提取contentUri部分（但getFileUri不应该返回contentUri）
    // 如果只有contentUri，无法转换为file:// URI
    return null;
  }

  if (originalUri.startsWith('content://') || originalUri.startsWith('ph://')) {
    return null;
  }

  if (originalUri.startsWith('file://')) {
    return ensureEncodedFileUri(originalUri);
  }

  const normalizedPath = normalizeFilePath(originalUri);
  return normalizedPath ? pathToFileUri(normalizedPath) : null;
};

/**
 * 从输入中提取content:// URI
 * @param {string|object} input - 可以是URI字符串或图片对象
 * @returns {string|null} content:// URI，如果不是content:// URI则返回null
 */
export const getContentUri = (input) => {
  const originalUri = normalizePathParams(input);
  
  if (!originalUri || typeof originalUri !== 'string') {
    return null;
  }
  
  // 检查是否是拼装格式（contentUri||relativePath）
  const { contentUri: parsedContentUri, isCombined } = parseCombinedUri(originalUri);
  
  if (isCombined && parsedContentUri) {
    // 是拼装格式，返回contentUri部分
    return parsedContentUri;
  }
  
  // 不是拼装格式，按原逻辑处理
  if (originalUri.startsWith('content://') || originalUri.startsWith('ph://')) {
    return originalUri;
  }

  return null;
};

/**
 * 获取图片URI（自动选择content://或file://）
 * 移动端返回content:// URI，PC端返回file:// URI
 * @param {string|Object} input - originalUri字符串或包含uri字段的对象
 * @returns {string|null} content:// URI 或 file:// URI，如果无法获取则返回null
 */
export const getUri = (input) => {
  // 优先尝试获取content:// URI（移动端）
  const contentUri = getContentUri(input);
  if (contentUri) {
    return contentUri;
  }
  
  // 如果没有content:// URI，尝试获取file:// URI（PC端）
  return getFileUri(input);
};

// 文件统计信息
export const getFileStats = async (filePath) => {
  const normalizedPath = normalizeFilePath(filePath);
  const stats = await RNFS_Native.stat(normalizedPath);
      return stats;
};

// 读取文件用于EXIF
export const readFileForExif = async (filePath) => {
  const normalizedPath = normalizeFilePath(filePath);
  const buffer = await RNFS_Native.read(normalizedPath, 65536, 0, 'base64');
    const nodeBuffer = Buffer.from(buffer, 'base64');
    return nodeBuffer;
};

// 读取图片文件为Blob
export const readImageFileAsBlob = async (filePath) => {
  const normalizedPath = normalizeFilePath(filePath);
  logger.debug(`Reading image file as blob: ${normalizedPath}`);
  const base64 = await RNFS_Native.readFile(normalizedPath, 'base64');
  return { base64, uri: filePath };
};

// MIME类型获取
export const getMimeTypeFromExtension = (ext) => {
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp'
  };
  return mimeTypes[ext] || 'image/jpeg';
};

// ========== 1. PermissionsAndroid 适配 ==========
export const PermissionsAndroid = {
  PERMISSIONS: RN_PermissionsAndroid.PERMISSIONS,
  RESULTS: RN_PermissionsAndroid.RESULTS,
  request: async (permission, options) => {
    return await RN_PermissionsAndroid.request(permission, options);
  },
  requestMultiple: async (permissions) => {
    return await RN_PermissionsAndroid.requestMultiple(permissions);
  },
  check: async (permission) => {
    return await RN_PermissionsAndroid.check(permission);
  }
};

// ========== 2. AsyncStorage 适配 ==========
export const AsyncStorage = {
  getItem: async (key) => {
    const value = await AsyncStorage_Native.getItem(key);
    // AsyncStorage存储的是字符串，需要parse
      try {
        return value ? JSON.parse(value) : null;
    } catch {
      return value;
    }
  },
  setItem: async (key, value) => {
    // AsyncStorage只能存储字符串，需要stringify
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    return await AsyncStorage_Native.setItem(key, stringValue);
  },
  removeItem: async (key) => {
    return await AsyncStorage_Native.removeItem(key);
  },
  clear: async () => {
    return await AsyncStorage_Native.clear();
  },
  getAllKeys: async () => {
    return await AsyncStorage_Native.getAllKeys();
  }
};

// ========== 3. RNFS 适配 ==========
export const RNFS = {
  read: async (filePath, start, length, encoding) => {
    return await RNFS_Native.read(filePath, start, length, encoding);
  },
  stat: async (filePath) => {
    return await RNFS_Native.stat(filePath);
  },
  readDir: async (dirPath) => {
    return await RNFS_Native.readDir(dirPath);
  },
  exists: async (filePath) => {
    return await RNFS_Native.exists(filePath);
  },
  mkdir: async (dirPath) => {
    return await RNFS_Native.mkdir(dirPath, { NSURLIsExcludedFromBackupKey: true });
  },
  unlink: async (filePath) => {
      const cleanPath = filePath.replace('file://', '');
      
    // Android：优先使用MediaStore API
    if (Platform.OS === 'android') {
      try {
        const { MediaStoreModule } = NativeModules;
        if (MediaStoreModule) {
          try {
            const result = await MediaStoreModule.deleteFile(cleanPath);
            if (result) {
              return; // 删除成功
            }
            // 删除失败，继续尝试RNFS
          } catch (error) {
            // MediaStore 删除失败，降级到 RNFS
            const errorMessage = error && typeof error === 'object' ? (error.message || String(error)) : String(error || 'Unknown error');
            const mediaStoreLog = isPermissionDenied(error) ? logger.info.bind(logger) : logger.warn.bind(logger);
            mediaStoreLog('⚠️ MediaStore删除失败:', errorMessage);
          }
        }
      } catch (error) {
        // MediaStore 删除失败，降级到 RNFS（通常是临时文件）
      }
      
      // 降级到RNFS（用于删除临时文件）
      try {
        // 先检查文件是否存在
        const fileExists = await RNFS_Native.exists(cleanPath);
        if (!fileExists) {
          logger.debug('ℹ️ 文件不存在，无需删除:', cleanPath);
          return;
        }
        
        await RNFS_Native.unlink(cleanPath);
        
        // 验证文件是否真的被删除了
        const stillExists = await RNFS_Native.exists(cleanPath);
        if (stillExists) {
          logger.info('ℹ️ RNFS删除失败，文件仍然存在（可能缺少删除权限）:', cleanPath);
          const err = new Error('文件删除失败，文件仍然存在');
          err.code = 'PERMISSION_DENIED';
          throw err;
        }
        
        logger.debug('🗑️ RNFS删除成功:', cleanPath);
      } catch (error) {
        const errorMessage = error && typeof error === 'object' ? (error.message || String(error)) : String(error || 'Unknown error');
        const isPerm = isPermissionDenied(error);
        // 删除失败通常是权限问题，属于正常情况，统一使用 debug 级别
        logger.debug('RNFS删除失败（可能是权限问题）:', errorMessage);
        const errObj = error instanceof Error ? error : new Error(errorMessage);
        if (isPerm && !errObj.code) {
          errObj.code = 'PERMISSION_DENIED';
        }
        throw errObj;
      }
    } else {
      // iOS：直接使用RNFS
      try {
        // 先检查文件是否存在
        const fileExists = await RNFS_Native.exists(cleanPath);
        if (!fileExists) {
          logger.debug('ℹ️ 文件不存在，无需删除:', cleanPath);
          return;
        }
        
        await RNFS_Native.unlink(cleanPath);
        
        // 验证文件是否真的被删除了
        const stillExists = await RNFS_Native.exists(cleanPath);
        if (stillExists) {
          logger.info('ℹ️ RNFS删除失败，文件仍然存在（可能缺少删除权限）:', cleanPath);
          const err = new Error('文件删除失败，文件仍然存在');
          err.code = 'PERMISSION_DENIED';
          throw err;
        }
        
        logger.debug('🗑️ RNFS删除成功:', cleanPath);
      } catch (error) {
        const errorMessage = error && typeof error === 'object' ? (error.message || String(error)) : String(error || 'Unknown error');
        const isPerm = isPermissionDenied(error);
        // 删除失败通常是权限问题，属于正常情况，统一使用 debug 级别
        logger.debug('RNFS删除失败（可能是权限问题）:', errorMessage);
        const errObj = error instanceof Error ? error : new Error(errorMessage);
        if (isPerm && !errObj.code) {
          errObj.code = 'PERMISSION_DENIED';
        }
        throw errObj;
      }
    }
  },
  copyFile: async (from, to) => {
    return await RNFS_Native.copyFile(from, to);
  },
  moveFile: async (from, to) => {
    return await RNFS_Native.moveFile(from, to);
  },
  writeFile: async (filePath, content, encoding) => {
    return await RNFS_Native.writeFile(filePath, content, encoding);
  },
  readFile: async (filePath, encoding) => {
    return await RNFS_Native.readFile(filePath, encoding);
  },
  /**
   * 保存图片到相册（Android 专用）- 使用原生 MediaStoreModule
   * @param {string} imageUrl - 图片URL或base64数据
   * @param {string} fileName - 文件名（可选）
   * @returns {Promise<{uri: string, path?: string, fileName: string}>}
   */
  saveImageToGallery: async (imageUrl, fileName) => {
    if (Platform.OS === 'android') {
      try {
        // 先检查并请求所需权限
        const apiLevel = Platform.Version;
        let hasPermission = true;

        if (apiLevel >= 33) {
          // Android 13+ 只需要 READ_MEDIA_IMAGES 权限
          // 使用 MediaStore API 保存图片时，系统会自动处理写入权限，不需要 WRITE_MEDIA_IMAGES
          const readGranted = await RN_PermissionsAndroid.check('android.permission.READ_MEDIA_IMAGES');
          if (!readGranted) {
            const res = await RN_PermissionsAndroid.request('android.permission.READ_MEDIA_IMAGES');
            if (res !== RN_PermissionsAndroid.RESULTS.GRANTED && res !== 'granted') {
              hasPermission = false;
            }
          }
        } else {
          // Android 12 及以下需要 WRITE_EXTERNAL_STORAGE
          const writeGrantedOld = await RN_PermissionsAndroid.check('android.permission.WRITE_EXTERNAL_STORAGE');
          if (!writeGrantedOld) {
            const res = await RN_PermissionsAndroid.request('android.permission.WRITE_EXTERNAL_STORAGE');
            if (res !== RN_PermissionsAndroid.RESULTS.GRANTED && res !== 'granted') {
              hasPermission = false;
            }
          }
        }

        if (!hasPermission) {
          throw new Error('需要相册写入权限，请在系统设置中授予后重试');
        }

        const { MediaStoreModule } = NativeModules;
        
        if (!MediaStoreModule || typeof MediaStoreModule.saveImageToGallery !== 'function') {
          throw new Error('MediaStoreModule.saveImageToGallery 方法不可用');
        }
        
        logger.debug(`[Android] RNFS.saveImageToGallery: ${imageUrl}`);
        const result = await MediaStoreModule.saveImageToGallery(imageUrl, fileName || null);
        logger.debug(`[Android] 图片保存成功:`, result);
        return result;
      } catch (error) {
        logger.error(`[Android] 保存图片到相册失败:`, error);
        throw error;
      }
    } else {
      // iOS或其他平台：暂不支持
      throw new Error(`当前平台 ${Platform.OS} 不支持保存图片到相册`);
    }
  },
  DocumentDirectoryPath: RNFS_Native.DocumentDirectoryPath,
  ExternalDirectoryPath: RNFS_Native.ExternalDirectoryPath,
  PicturesDirectoryPath: RNFS_Native.PicturesDirectoryPath,
  CachesDirectoryPath: RNFS_Native.CachesDirectoryPath,
  MainBundlePath: RNFS_Native.MainBundlePath,
  LibraryDirectoryPath: RNFS_Native.LibraryDirectoryPath,
  ExternalStorageDirectoryPath: RNFS_Native.ExternalStorageDirectoryPath,
};

// ========== 4. SafeAreaView 适配 ==========
export const SafeAreaView = ({ children, style, ...props }) => {
  return <SafeAreaView_Native style={style} {...props}>{children}</SafeAreaView_Native>;
};

// ========== 5. Navigation 适配 ==========
export const useFocusEffect = (callback) => {
  return useFocusEffect_Native(callback);
};

// ========== 6. 图片选择器适配 ==========
export const launchImageLibrary = (options, callback) => {
  return launchImageLibrary_Native(options, callback);
};

// ========== 7. 图标库适配 ==========
export const Icon = ({ name, size, color, ...props }) => {
  return <MaterialIcons_Native name={name} size={size} color={color} {...props} />;
};

// ========== 8. 导航适配 ==========
export const NavigationContainer = React.forwardRef(({ children }, ref) => {
  return <NavigationContainer_Native ref={ref}>{children}</NavigationContainer_Native>;
});

export const createStackNavigator = () => {
  return createStackNavigator_Native();
};

export const createBottomTabNavigator = () => {
  return createBottomTabNavigator_Native();
};

// ========== 9. 数据库适配 ==========
export const SQLite = {
  openDatabase: (name, version, displayName, size) => {
    // Prefer object-form (official recommended): { name, location }
    let db;
    try {
      db = SQLite_Native.openDatabase({ name, location: 'default' });
    } catch (e) {
      // Fallback to legacy 4-arg signature
      db = SQLite_Native.openDatabase(name, version, displayName, size);
    }
    
    // 包装 executeSql 方法，将回调转换为 Promise
    // react-native-sqlite-storage 需要在 transaction 中执行 SQL
    const originalTransaction = db.transaction.bind(db);
    const originalExecuteSql = db.executeSql ? db.executeSql.bind(db) : null;
    
    db.executeSql = (sql, params = []) => {
      // PRAGMA 语句不能在 transaction 中执行，需要直接调用
      if (sql.trim().toUpperCase().startsWith('PRAGMA')) {
        if (!originalExecuteSql) {
          // 如果没有原生的 executeSql，PRAGMA 无法执行，直接返回空结果
          // 静默失败，不记录日志（PRAGMA 设置不是必需的）
          return Promise.resolve([{ rows: { length: 0 } }]);
        }
        // 直接使用原生的 executeSql（不在 transaction 中）
        return new Promise((resolve, reject) => {
          originalExecuteSql(
            sql,
            params,
            (results) => {
              resolve([results]);
            },
            (error) => {
              // PRAGMA 设置失败不影响功能，静默失败
              // 某些 SQLite 版本或配置可能不支持在事务外设置 PRAGMA
              // 不记录错误日志，避免日志噪音
              resolve([{ rows: { length: 0 } }]);
            }
          );
        });
      }
      
      // 普通 SQL 语句在 transaction 中执行
      return new Promise((resolve, reject) => {
        originalTransaction(
          (tx) => {
            tx.executeSql(
              sql,
              params,
              (tx, results) => {
                // 返回结果数组格式: [results]
                resolve([results]);
              },
              (tx, error) => {
                // 安全地处理错误对象，避免传递 undefined 给 logger
                const safeError = error && typeof error === 'object' 
                  ? (error.message || JSON.stringify(error)) 
                  : String(error || 'Unknown error');
                logger.error('SQLite executeSql error:', { sql, error: safeError });
                reject(error);
              }
            );
          },
          (error) => {
            // Transaction error callback
            // 安全地处理错误对象，避免传递 undefined 给 logger
            const safeError = error && typeof error === 'object' 
              ? (error.message || JSON.stringify(error)) 
              : String(error || 'Unknown error');
            logger.error('SQLite transaction error:', { sql, error: safeError });
            reject(error);
          }
        );
      });
    };
    
    return db;
  },
};

// ========== 10. 平台检测 ==========
export const isWeb = false;
export const isMobile = true;

// ========== 11. Alert 适配 ==========
export const Alert = {
  alert: (title, message, buttons, options) => {
      RNAlert.alert(title, message, buttons, options);
  }
};

// ========== 12. Electron 文件操作接口（移动端不需要） ==========
export const ElectronFileAPI = {
  readFile: async () => { throw new Error('ElectronFileAPI not available on mobile'); },
  writeFile: async () => { throw new Error('ElectronFileAPI not available on mobile'); },
  deleteFile: async () => { throw new Error('ElectronFileAPI not available on mobile'); },
  exists: async () => { throw new Error('ElectronFileAPI not available on mobile'); },
  mkdir: async () => { throw new Error('ElectronFileAPI not available on mobile'); },
  readDir: async () => { throw new Error('ElectronFileAPI not available on mobile'); },
  stat: async () => { throw new Error('ElectronFileAPI not available on mobile'); },
  openFileDialog: async () => { throw new Error('ElectronFileAPI not available on mobile'); },
  openDirectoryDialog: async () => { throw new Error('ElectronFileAPI not available on mobile'); },
};

// ========== 13. 样式辅助 ==========
export const createFixedStyle = (style) => style;

// ========== 14. 权限适配器（移动端专用） ==========
export const PermissionAdapter = {
  requestStoragePermission: async () => {
    if (Platform.OS !== 'android') return true;
        
        const apiLevel = Platform.Version;
    logger.debug(`📱 Android API级别: ${apiLevel}`);
    
    // Android 13+ (API 33+)
        if (apiLevel >= 33) {
      try {
          const hasMediaImages = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
          );
        
        if (!hasMediaImages) {
          const mediaGranted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
            {
              title: '需要访问相册权限',
              message: 'ImagePilot需要访问您的照片以进行智能分类',
              buttonNeutral: '稍后询问',
              buttonNegative: '拒绝',
              buttonPositive: '允许',
            }
          );
          return mediaGranted === PermissionsAndroid.RESULTS.GRANTED;
        }
        return true;
      } catch (error) {
        logger.error('请求媒体权限失败:', error);
        return false;
      }
    }
    
    // Android 10-12 (API 29-32)
    if (apiLevel >= 29) {
      try {
          const hasStoragePermission = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
          );
          
        if (!hasStoragePermission) {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
            {
              title: '需要访问存储权限',
              message: 'ImagePilot需要访问存储以读取照片',
              buttonNeutral: '稍后询问',
              buttonNegative: '拒绝',
              buttonPositive: '允许',
            }
          );
          return granted === PermissionsAndroid.RESULTS.GRANTED;
        }
        return true;
      } catch (error) {
        logger.error('请求存储权限失败:', error);
        return false;
      }
    }
    
    // Android 9及以下 (API 28-)
    try {
      const permissions = [
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
            PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      ];
      
      const grantedResults = await PermissionsAndroid.requestMultiple(permissions);
      
      return (
        grantedResults[PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE] === PermissionsAndroid.RESULTS.GRANTED &&
        grantedResults[PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE] === PermissionsAndroid.RESULTS.GRANTED
      );
      } catch (error) {
      logger.error('请求存储权限失败:', error);
      return false;
    }
  },

  checkStoragePermission: async () => {
    if (Platform.OS !== 'android') return true;
    
    const apiLevel = Platform.Version;
    
    // Android 13+
    if (apiLevel >= 33) {
      const hasMediaImages = await PermissionsAndroid.check(
              PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
            );
      return hasMediaImages;
    }
    
    // Android 10-12
    if (apiLevel >= 29) {
      const hasReadStorage = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
      );
      return hasReadStorage;
    }
    
    // Android 9及以下
    const hasReadStorage = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
    );
    const hasWriteStorage = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
    );
    
    return hasReadStorage && hasWriteStorage;
  },
};

// ========== 15. 模型路径适配器 ==========
export const ModelPathAdapter = {
  detectEnvironment: () => 'react-native',
  
  loadOnnxRuntime: async () => {
    // 移动端使用 onnxruntime-react-native
    // 使用动态 import 避免 release 构建时的 require undefined 问题
    const ortModule = await import('onnxruntime-react-native');
    const ort = ortModule.default || ortModule;
    logger.debug('📱 加载 onnxruntime-react-native');
    return ort;
  },
  
  getModelPath: (modelRelativePath) => {
    if (Platform.OS === 'android') {
      // Android: 返回带 file:// 协议的URI
      // assets 中的文件需要复制到可读写目录才能被 ONNX Runtime 访问
      const destPath = `${RNFS_Native.DocumentDirectoryPath}/models/${modelRelativePath}`;
      const fileUri = `file://${destPath}`;
      logger.debug(`📱 Android: ${destPath} -> ${fileUri}`);
      return fileUri;
      } else {
      // iOS: 用 DocumentDirectoryPath/models（可写目录）
      // —— onnxruntime-react-native iOS 端 InferenceSession.create 不能直接读 MainBundle
      //    （只读分区，落 "Can't load model: failed to load model"）。
      //    所以 ensureModelExists 会先把模型从 MainBundle/models 一次性拷到 Documents/models。
      const fullPath = `${RNFS_Native.DocumentDirectoryPath}/models/${modelRelativePath}`;
      return fullPath;
    }
  },
  
  // 把模型从只读源（Android: APK assets / iOS: MainBundle）一次性拷到可写目录
  // —— onnxruntime-react-native 在两个平台上都要求模型路径是可读写区
  ensureModelExists: async (modelRelativePath) => {
    if (Platform.OS === 'web') {
      logger.debug(`📱 web 平台，跳过模型复制: ${modelRelativePath}`);
      return;
    }

    const destPath = `${RNFS_Native.DocumentDirectoryPath}/models/${modelRelativePath}`;
    const dirPath = `${RNFS_Native.DocumentDirectoryPath}/models`;

    logger.debug(`🔍 检查模型文件: ${destPath}`);

    try {
      // 已存在 → 跳过；ONNX 模型不会变，覆盖时机交给应用升级（卸载重装会清 Documents）
      const fileExists = await RNFS_Native.exists(destPath);
      logger.debug(`📋 文件存在检查: ${modelRelativePath} = ${fileExists}`);
      if (fileExists) return;

      const dirExists = await RNFS_Native.exists(dirPath);
      if (!dirExists) await RNFS_Native.mkdir(dirPath);

      if (Platform.OS === 'android') {
        // Android: 从 APK assets 拷
        const sourcePath = `models/${modelRelativePath}`;
        logger.debug(`📋 从 APK 复制模型: ${modelRelativePath}`);
        await RNFS_Native.copyFileAssets(sourcePath, destPath);
      } else {
        // iOS: 从 MainBundle/models 拷（blue folder ref 已经把整层放进 .app）
        const sourcePath = `${RNFS_Native.MainBundlePath}/models/${modelRelativePath}`;
        logger.debug(`📋 从 MainBundle 复制模型: ${sourcePath}`);
        await RNFS_Native.copyFile(sourcePath, destPath);
      }
      logger.debug(`✅ 模型复制完成: ${modelRelativePath}`);
    } catch (error) {
      const errorMessage = error && typeof error === 'object' ? (error.message || String(error)) : String(error || 'Unknown error');
      logger.error(`❌ 模型复制失败 (${modelRelativePath}): ${errorMessage}`);
      throw error;
    }
  },
  
  getExecutionProviders: () => {
    // React Native环境：优先使用XNNPACK，降级为CPU
    // 注意：GPU推理可能因为内存拷贝开销而比CPU更慢
    // 特别是对于轻量级模型，建议先进行性能测试
    return ['cpu'];
  },
};

// ========== 16. Canvas适配器（移动端：使用原生图片处理） ==========
export const CanvasAdapter = {
  /**
   * 移动端：返回模拟的 Canvas 对象
   * 实际使用 ImageResizer + jpeg-js 处理图片
   */
  async createCanvas(width, height) {
    logger.debug(`📱 创建模拟 Canvas (${width}x${height})`);
    return {
      width,
      height,
      _targetWidth: width,
      _targetHeight: height,
      _imageData: null,
      getContext: () => ({
        // 模拟的 2d context，实际由 getImageData 提供数据
        getImageData: async (x, y, w, h) => {
          return this._imageData;
        },
        fillStyle: null,
        fillRect: () => {},
        drawImage: () => {},
      })
    };
  },

  /**
   * 移动端：加载并解码图片为像素数据
   * 使用 ImageResizer 调整大小 + jpeg-js 解码像素
   */
  async loadImage(imageUri, canvas = null) {
    logger.debug(`📱 处理图片: ${imageUri}`);
    
    let resized = null;
    let imageBuffer = null;
    let rawImageData = null;
    
    try {
      const filePath = imageUri.startsWith('file://') 
        ? imageUri.replace('file://', '') 
        : imageUri;
      
      const targetWidth = canvas?._targetWidth || 640;
      const targetHeight = canvas?._targetHeight || 640;
      
      // 1. 使用原生 ImageResizer 调整图片大小
      logger.debug(`📋 调整图片大小: ${targetWidth}x${targetHeight}`);
      resized = await ImageResizer_Native.createResizedImage(
        filePath,
        targetWidth,
        targetHeight,
        'JPEG',
        100, // 质量
        0,   // 旋转角度
        null, // 输出路径
        false, // 保持透明度
        {
          mode: 'contain', // 保持宽高比，填充黑边
          onlyScaleDown: false
        }
      );
      
      logger.debug(`✅ 图片调整完成: ${resized.uri}`);
      
      // 2. 读取调整后的图片为 Buffer
      const resizedPath = resized.uri.replace('file://', '');
      const buffer = await RNFS_Native.readFile(resizedPath, 'base64');
      imageBuffer = Buffer.from(buffer, 'base64');
      
      logger.debug(`📋 解码 JPEG (${Math.round(imageBuffer.length / 1024)} KB)`);
      
      // 3. 使用 jpeg-js 解码为像素数据
      rawImageData = jpeg.decode(imageBuffer, { useTArray: true });
      
      logger.debug(`✅ 图片解码成功: ${rawImageData.width}x${rawImageData.height}`);
      
      // 4. 创建返回对象
      const result = {
        width: rawImageData.width,
        height: rawImageData.height,
        data: rawImageData.data, // Uint8Array: RGBA 格式
        _rawImageData: rawImageData
      };
      
      // 🔥 立即清理临时文件和释放内存引用
      imageBuffer = null; // 释放 Buffer 引用
      
      // 清理临时文件
      if (resized && resized.uri) {
        try {
          const tempPath = resized.uri.replace('file://', '');
          if (await RNFS_Native.exists(tempPath)) {
            await RNFS_Native.unlink(tempPath);
            logger.debug(`🧹 已清理临时文件: ${tempPath}`);
          }
        } catch (cleanupError) {
          // 清理失败不影响主流程，静默处理
          logger.debug(`⚠️ 清理临时文件失败: ${resized.uri}`, cleanupError.message);
        }
      }
      
      return result;
    } catch (error) {
      logger.error(`❌ 图片处理失败: ${imageUri}`, error);
      throw error;
    } finally {
      // 🔥 确保在异常情况下也能清理资源
      if (resized && resized.uri) {
        try {
          const tempPath = resized.uri.replace('file://', '');
          if (await RNFS_Native.exists(tempPath)) {
            await RNFS_Native.unlink(tempPath);
          }
        } catch (cleanupError) {
          // 静默处理清理错误
        }
      }
      // 释放内存引用
      imageBuffer = null;
      // 注意：rawImageData 不能在这里设为 null，因为返回的对象中引用了它
    }
  },
};

// ========== 导出图片处理模块供 ImageProcessor 使用 ==========
export const ImageResizer = ImageResizer_Native;
// RNFS 已在第166行导出
export const jpegJs = jpeg;
// 静态导入避免 release 构建时的 require undefined 问题
import { Image as RNImageModule } from 'react-native';
export const RNImage = { getSize: RNImageModule.getSize };
