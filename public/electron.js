const { app, BrowserWindow, Menu, dialog, ipcMain, clipboard, nativeImage } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');

// 规范日志格式： [ISO8601] [LEVEL] [pid=xxx] message
const logLevels = { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' };
function formatLogLine(level, message, ...args) {
  const ts = new Date().toISOString();
  const pid = process.pid;
  const rest = args.map(a => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' ');
  const body = rest ? `${message} ${rest}` : message;
  return `[${ts}] [${level}] [pid=${pid}] ${body}\n`;
}
// 最早写入：脚本一加载就写 /tmp，方便确认主进程是否启动（不依赖 app ready）
try {
  fs.appendFileSync(path.join(os.tmpdir(), 'xintualbum-bootstrap.log'), formatLogLine(logLevels.INFO, 'electron main started'), 'utf8');
} catch (_) {}

const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_IS_DEV === '1' || !app.isPackaged;

// 打包后不向终端输出任何内容，避免乱码或无关信息
if (!isDev && process.stdout && process.stderr) {
  const noopWrite = () => {};
  try {
    process.stdout.write = noopWrite;
    process.stderr.write = noopWrite;
  } catch (_) {}
}

// 主进程日志仅用英文，避免终端/系统控制台编码非 UTF-8 时出现乱码
const L = {
  vcCheck: 'Checking Visual C++ Redistributable...',
  vcInstalling: 'Installing Visual C++ Redistributable...',
  vcInstallFail: 'Visual C++ Redistributable install failed:',
  vcInstallOk: 'Visual C++ Redistributable installed.',
  vcAlready: 'Visual C++ Redistributable already installed.',
  macSkip: 'macOS: skipping platform deps check.',
  linuxSkip: 'Linux: skipping platform deps check.',
  devEnv: 'Dev env:',
  loadApp: 'Loading app:',
  pageReady: 'Page loaded.',
  titlebarClick: 'Titlebar settings clicked.',
  deleteReq: 'Delete file request:',
  deleteCheck: 'Checking file exists:',
  deleteExists: 'File exists, deleting...',
  deleteOk: 'File deleted:',
  deleteNoFile: 'File not found:',
  deleteFail: 'Delete failed:',
  titlebarStats: 'Titlebar stats:',
  titlebarStatsFail: 'Titlebar stats update failed:',
  copyReq: 'Copy to clipboard, count:',
  copyEmpty: 'File list empty.',
  copyList: 'File list:',
  copyExists: 'File exists:',
  copyMissing: 'File not found:',
  copyNoFiles: 'No files to copy.',
  copyPreparing: 'Preparing to copy to clipboard:',
  copyPsScript: 'PowerShell script created:',
  copyCleanupFail: 'Cleanup temp files failed:',
  copyPsFail: 'PowerShell failed:',
  copyPsOk: 'PowerShell OK.',
  copyFileFail: 'Temp file creation failed:',
  copyJxaScript: 'JXA script created:',
  copyJxaFail: 'JXA failed:',
  copyOk: 'Clipboard set OK.',
  copyLinuxOk: 'Linux clipboard OK.',
  copyLinuxFail: 'Linux clipboard failed:',
  copyFail: 'Copy to clipboard failed:',
  dirCreated: 'Dir created:',
  dirFail: 'Create dir failed:',
  fileSaved: 'File saved:',
  fileSaveFail: 'Save file failed:',
  imageEmpty: 'Image empty or load failed:',
  imageCopyOk: 'Image copied to clipboard:',
  imageCopyFail: 'Copy image failed:',
  folderSelectFail: 'Folder select failed:'
};

// 防止 stdout/stderr 关闭后写入导致 EPIPE 未捕获异常（例如从 IDE/终端启动后关闭）
[process.stdout, process.stderr].forEach(stream => {
  if (stream && !stream._epipeHandled) {
    stream.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });
    stream._epipeHandled = true;
  }
});

// 主进程专用日志：与 src/adapters/WebAdapters.js 的 Logger 接口一致（info/warn/error/debug），
// 但主进程不能 require 前端模块，故在此单独实现；格式与 Logger helper 对齐（[timestamp] [LEVEL]），并增加 pid 与文件输出。
const safeLog = (fn, ...args) => {
  try {
    if (process.stdout.writable) fn(...args);
  } catch (e) {
    if (e.code !== 'EPIPE') throw e;
  }
};
const safeWarn = (fn, ...args) => {
  try {
    if (process.stderr.writable) fn(...args);
  } catch (e) {
    if (e.code !== 'EPIPE') throw e;
  }
};

// 打包后：日志写入固定路径，app 就绪时立即创建文件
let logFilePath = null;
function getLogPath() {
  return logFilePath;
}
function ensureLogFile() {
  if (logFilePath) return;
  const logsDir = app.getPath('logs'); // 应用标准日志目录，如 ~/Library/Logs/ImagePilot (macOS)
  const candidates = [
    path.join(logsDir, 'main.log'),
    path.join(os.tmpdir(), 'xintualbum-main.log')
  ];
  for (const p of candidates) {
    try {
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(p, formatLogLine(logLevels.INFO, 'log started', `path=${p}`), 'utf8');
      logFilePath = p;
      return;
    } catch (_) {}
  }
}
function toFile(level, message, ...args) {
  const p = getLogPath();
  if (!p) return;
  try {
    const line = formatLogLine(level, message, ...args);
    fs.appendFileSync(p, line, 'utf8');
  } catch (_) {}
}

const noop = () => {};
const logger = {
  debug: isDev ? (message, ...args) => safeLog(console.log, `[DEBUG] ${message}`, ...args) : (message, ...args) => toFile('DEBUG', message, ...args),
  info: isDev ? (message, ...args) => safeLog(console.log, `[INFO] ${message}`, ...args) : (message, ...args) => toFile('INFO', message, ...args),
  warn: isDev ? (message, ...args) => safeWarn(console.warn, `[WARN] ${message}`, ...args) : (message, ...args) => toFile('WARN', message, ...args),
  error: isDev ? (message, ...args) => safeWarn(console.error, `[ERROR] ${message}`, ...args) : (message, ...args) => toFile('ERROR', message, ...args)
};

  // 设置应用菜单 - 为 macOS 提供标准菜单
  if (process.platform === 'darwin') {
    // 为 macOS 创建标准菜单
    const template = [
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          ...(process.platform === 'darwin' ? [
            { type: 'separator' },
            { role: 'front' },
            { type: 'separator' },
            { role: 'window' }
          ] : [
            { role: 'close' }
          ])
        ]
      }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  } else {
    // 在 Windows/Linux 上，我们可以选择不显示菜单或显示简化菜单
    // 当前保持禁用状态，也可以构建一个简化的菜单
    const template = [
      {
        label: 'File',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'close' }
        ]
      }
    ];
    
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }

// 检查并安装 Visual C++ Redistributable
function checkAndInstallPlatformDependencies() {
  if (isDev) return; // 开发环境跳过
  
  if (process.platform === 'win32') {
    // Windows-specific: 检查并安装 Visual C++ Redistributable
    const redistPath = path.join(process.resourcesPath, 'redist');
    const vcRedistPath = path.join(redistPath, 'vc_redist.x64.exe');
    
    if (fs.existsSync(vcRedistPath)) {
      logger.info(L.vcCheck);
      
      // 检查是否已安装
      exec('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64"', (error) => {
        if (error) {
          logger.info(L.vcInstalling);
          
          // 静默安装
          exec(`"${vcRedistPath}" /quiet /norestart`, (installError) => {
            if (installError) {
              logger.warn(L.vcInstallFail, installError);
            } else {
              logger.info(L.vcInstallOk);
            }
          });
        } else {
          logger.info(L.vcAlready);
        }
      });
    }
  } else if (process.platform === 'darwin') {
    // macOS-specific: 检查必要依赖 (if any needed)
    logger.info(L.macSkip);
  } else if (process.platform === 'linux') {
    // Linux-specific: 检查必要依赖 (if any needed)
    logger.info(L.linuxSkip);
  }
}

function createWindow() {
  // 创建浏览器窗口
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webSecurity: false,  // 开发环境需要禁用以加载本地文件
      // GPU 相关配置，解决 GPU 状态错误
      // 在 macOS 上启用硬件加速以获得更好的性能
      hardwareAcceleration: process.platform === 'darwin',
      offscreen: false,  // 禁用离屏渲染
      backgroundThrottling: false  // 禁用后台节流
    },
    icon: process.platform === 'darwin' 
      ? path.join(__dirname, './icon.icns')  // macOS 使用 ICNS 格式（Dock 等）
      : process.platform === 'win32'
        ? path.join(__dirname, './icon.ico')  // Windows 使用 ICO 格式
        : path.join(__dirname, './icon.png'), // Linux 使用 PNG 格式
    title: process.platform === 'darwin' ? '' : 'ImagePilot-智能分类，便捷管理，仅你可见',
    autoHideMenuBar: true,  // 隐藏默认菜单栏
    // 混合模式：titleBarOverlay 留出空间给自定义标题栏（设置、暂存箱等）；macOS 上隐藏 overlay 内的图标和标题文字
    titleBarStyle: 'hidden',
    frame: true,
    titleBarOverlay: {
      color: '#2f3241',
      symbolColor: '#74b1be',
      height: 60
    },
    resizable: true,
    minimizable: true,
    maximizable: true,
    closable: true
  });

  // 加载应用
  logger.info(L.devEnv, {
    NODE_ENV: process.env.NODE_ENV,
    ELECTRON_IS_DEV: process.env.ELECTRON_IS_DEV,
    isPackaged: app.isPackaged,
    isDev: isDev
  });

  // 打包后：记录 __dirname 和要加载的路径，方便排查“白屏”
  const buildIndexPath = path.join(__dirname, '..', 'build', 'index.html');
  const buildIndexExists = fs.existsSync(buildIndexPath);
  logger.info('Log file path:', getLogPath());
  logger.info('__dirname:', __dirname);
  logger.info('build/index.html path:', buildIndexPath, 'exists:', buildIndexExists);

  // 开发：localhost；打包后必须加载 build/index.html（craco 构建出的完整页面），不是 public/index.html
  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${buildIndexPath}`;

  logger.info(L.loadApp, startUrl);
  // 打包后用 loadFile 更可靠（asar + file 协议）；开发用 loadURL(localhost)
  if (isDev) {
    mainWindow.loadURL(startUrl);
  } else {
    mainWindow.loadFile(buildIndexPath).catch((err) => {
      logger.error('loadFile failed:', err.message);
      mainWindow.loadURL(startUrl);
    });
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    logger.error('Page failed to load:', errorCode, errorDescription, validatedURL);
  });

  // 在开发和生产环境中都启用对本地文件的访问权限
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    // 添加跨域头，以便能够加载本地模型文件
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Access-Control-Allow-Origin': ['*'],
        'Access-Control-Allow-Headers': ['*'],
        'Access-Control-Allow-Methods': ['GET, POST, OPTIONS']
      }
    });
  });


  // 开发环境下打开开发者工具
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // 添加快捷键来切换开发者工具
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools();
    }
    if (input.control && input.shift && input.key.toLowerCase() === 'r') {
      mainWindow.reload();
    }
  });


  // 监听设置按钮点击事件
  ipcMain.on('show-settings-menu', (event) => {
    // 直接导航到设置页面
    mainWindow.webContents.send('navigate-to-settings');
  });

  // 监听自定义标题栏设置按钮点击
  ipcMain.on('titlebar-settings-click', (event) => {
    logger.debug(L.titlebarClick);
    mainWindow.webContents.send('navigate-to-settings');
  });

  // 监听窗口控制按钮事件
  ipcMain.on('window-minimize', () => {
    mainWindow.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.on('window-close', () => {
    mainWindow.close();
  });


  // 监听文件删除请求
  ipcMain.on('delete-file', (event, filePath) => {
    logger.debug(L.deleteReq, filePath);
    try {
      const fs = require('fs');
      const path = require('path');
      
      logger.debug(L.deleteCheck, filePath);
      // 检查文件是否存在
      if (fs.existsSync(filePath)) {
        logger.debug(L.deleteExists);
        // 删除文件
        fs.unlinkSync(filePath);
        logger.info(L.deleteOk, filePath);
        event.reply('delete-file-result', { success: true, message: '文件删除成功' });
      } else {
        logger.warn(L.deleteNoFile, filePath);
        event.reply('delete-file-result', { success: false, message: '文件不存在' });
      }
    } catch (error) {
      logger.error(L.deleteFail, filePath, error);
      event.reply('delete-file-result', { success: false, message: `文件删除失败: ${error.message}` });
    }
  });

  // 分类文件物理迁移：逐项移动/复制到 targetDir，解决同名冲突，回结果+进度。
  // 跨盘 move：fs.renameSync 抛 EXDEV → fallback copyFileSync + unlinkSync。
  ipcMain.on('migrate-files', (event, payload) => {
    const fsm = require('fs');
    const pathm = require('path');
    const { items = [], mode = 'copy' } = payload || {};
    const results = [];
    const total = items.length;
    let done = 0;

    const resolveConflict = (target) => {
      if (!fsm.existsSync(target)) return target;
      const ext = pathm.extname(target);
      const base = target.slice(0, target.length - ext.length);
      for (let i = 1; i < 100000; i++) {
        const c = `${base}(${i})${ext}`;
        if (!fsm.existsSync(c)) return c;
      }
      return target;
    };

    for (const it of items) {
      try {
        if (!fsm.existsSync(it.oldPath)) { results.push({ id: it.id, ok: false, error: '源文件不存在' }); done++; continue; }
        fsm.mkdirSync(it.targetDir, { recursive: true });
        const dest = resolveConflict(pathm.join(it.targetDir, it.fileName).replace(/\\/g, '/'));
        if (mode === 'move') {
          try { fsm.renameSync(it.oldPath, dest); }
          catch (e) {
            if (e && e.code === 'EXDEV') { fsm.copyFileSync(it.oldPath, dest); fsm.unlinkSync(it.oldPath); }
            else throw e;
          }
        } else {
          fsm.copyFileSync(it.oldPath, dest);
        }
        results.push({ id: it.id, ok: true, newPath: dest });
      } catch (error) {
        results.push({ id: it.id, ok: false, error: error.message });
      }
      done++;
      event.reply('migrate-files-progress', { done, total });
    }
    event.reply('migrate-files-result', { results });
  });

  // 监听更新标题栏统计信息
  ipcMain.on('update-titlebar-stats', (event, stats) => {
    logger.debug(L.titlebarStats, stats);
    try {
      const totalImages = stats.totalImages || 0;
      const classified = stats.classified || 0;
      const totalSize = stats.totalSize ? (stats.totalSize / 1024 / 1024).toFixed(1) : '0';
      // macOS 上标题栏不显示标题，只用于 Cmd+Tab 显示简短名称；Windows/Linux 显示完整统计
      if (process.platform === 'darwin') {
        mainWindow.setTitle('ImagePilot');
      } else {
        mainWindow.setTitle(`ImagePilot-智能分类，便捷管理，仅你可见 | 总照片: ${totalImages} | 已分类: ${classified} | 大小: ${totalSize}MB`);
      }
    } catch (error) {
      logger.error(L.titlebarStatsFail, error);
    }
  });

  // 监听复制文件到剪贴板请求
  ipcMain.on('copy-files-to-clipboard', (event, filePaths) => {
    logger.info(L.copyReq, filePaths.length);
    
    try {
      if (!Array.isArray(filePaths) || filePaths.length === 0) {
        logger.warn(L.copyEmpty);
        event.reply('copy-files-result', { success: false, error: '文件路径列表为空' });
        return;
      }

      logger.debug(L.copyList, filePaths);

      // 验证所有文件是否存在
      const existingFiles = [];
      const missingFiles = [];
      
      for (const filePath of filePaths) {
        if (fs.existsSync(filePath)) {
          existingFiles.push(filePath);
          logger.debug(L.copyExists, filePath);
        } else {
          missingFiles.push(filePath);
          logger.warn(L.copyMissing, filePath);
        }
      }

      if (existingFiles.length === 0) {
        logger.error(L.copyNoFiles);
        event.reply('copy-files-result', { 
          success: false, 
          error: '所有文件都不存在' 
        });
        return;
      }

      logger.info(L.copyPreparing, existingFiles.length);

      // 根据操作系统选择适当的剪贴板处理方式
      if (process.platform === 'win32') {
        // Windows平台：使用原有的PowerShell方法
        const tempFilePath = path.join(os.tmpdir(), `clipboard_files_${Date.now()}.txt`);
        
        try {
          // 将文件路径写入临时文件，每行一个路径
          // 使用UTF-8编码，并在每行末尾添加换行符
          const fileContent = existingFiles.map(filePath => {
            // 转义路径中的特殊字符，使用Base64编码避免路径中的特殊字符问题
            return Buffer.from(filePath, 'utf8').toString('base64');
          }).join('\n');
          
          fs.writeFileSync(tempFilePath, fileContent, 'utf8');
          logger.debug(L.copyPsScript, tempFilePath, existingFiles.length);
          
          // 构建PowerShell脚本，从临时文件读取路径
          // 将文件路径转换为PowerShell中的安全字符串（使用单引号，并转义单引号）
          const tempFileEscaped = tempFilePath.replace(/'/g, "''");
          const psScript = `Add-Type -AssemblyName System.Windows.Forms;
$files = New-Object System.Collections.Specialized.StringCollection;
$tempFile = '${tempFileEscaped}';

if (Test-Path $tempFile) {
  $filePaths = Get-Content $tempFile -Encoding UTF8;
  $count = 0;
  $errorCount = 0;
  foreach ($encodedPath in $filePaths) {
    if ([string]::IsNullOrWhiteSpace($encodedPath)) {
      continue;
    }
    try {
      $filePath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($encodedPath.Trim()));
      if (Test-Path $filePath) {
        [void]$files.Add($filePath);
        $count++;
        if ($count % 500 -eq 0) {
          Write-Host "Processed $count files...";
        }
      }
    } catch {
      $errorCount++;
      if ($errorCount -le 10) {
        Write-Host "Error decoding path: $_";
      }
    }
  }
  if ($files.Count -gt 0) {
    [System.Windows.Forms.Clipboard]::SetFileDropList($files);
    Write-Host "Successfully copied $($files.Count) files to clipboard";
  } else {
    Write-Host "No valid files found to copy";
    exit 1;
  }
  Remove-Item $tempFile -Force -ErrorAction SilentlyContinue;
} else {
  Write-Host "Temp file not found: $tempFile";
  exit 1;
}`;
          
          // 将PowerShell脚本保存到临时文件，避免命令行参数长度限制
          const psScriptPath = path.join(os.tmpdir(), `clipboard_script_${Date.now()}.ps1`);
          fs.writeFileSync(psScriptPath, psScript, 'utf8');
          logger.debug(L.copyPsScript, psScriptPath);
          
          // 执行PowerShell脚本
          const psCommand = `powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`;
          
          exec(psCommand, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            // 清理临时文件
            try {
              if (fs.existsSync(psScriptPath)) {
                fs.unlinkSync(psScriptPath);
              }
              if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
              }
            } catch (cleanupError) {
              logger.warn(L.copyCleanupFail, cleanupError);
            }
            
            if (error) {
              logger.error(L.copyPsFail, error);
              logger.error(`stderr:`, stderr);
              event.reply('copy-files-result', { 
                success: false, 
                error: `复制失败: ${error.message}` 
              });
            } else {
              logger.info(L.copyPsOk);
              logger.debug(`stdout:`, stdout);
              if (stderr) {
                logger.warn(`stderr:`, stderr);
              }
              
              event.reply('copy-files-result', { 
                success: true, 
                copiedCount: existingFiles.length,
                skippedCount: missingFiles.length
              });
            }
          });
        } catch (fileError) {
          logger.error(L.copyFileFail, fileError);
          // 清理临时文件
          try {
            if (fs.existsSync(tempFilePath)) {
              fs.unlinkSync(tempFilePath);
            }
          } catch (cleanupError) {
            // 忽略清理错误
          }
          event.reply('copy-files-result', { 
            success: false, 
            error: `创建临时文件失败: ${fileError.message}` 
          });
        }
      } else if (process.platform === 'darwin') {
        // macOS：路径写入临时文件，用 JXA（JavaScript for Automation）读文件并写入剪贴板，避免 AppleScript Cocoa 桥接语法问题
        const pathsFilePath = path.join(os.tmpdir(), `clipboard_paths_${Date.now()}.txt`);
        fs.writeFileSync(pathsFilePath, existingFiles.join('\n'), 'utf8');
        const pathsFileEscaped = pathsFilePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const jxaScript = `
          ObjC.import('Foundation');
          ObjC.import('AppKit');
          var pathsFile = "${pathsFileEscaped}";
          var content = ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(pathsFile, 4, null));
          if (!content) { $.exit(1); }
          var lines = content.split(/\\n/);
          var urls = [];
          for (var i = 0; i < lines.length; i++) {
            var p = lines[i].trim();
            if (p.length > 0) urls.push($.NSURL.fileURLWithPath(p));
          }
          if (urls.length > 0) {
            var pb = $.NSPasteboard.generalPasteboard;
            pb.clearContents;
            pb.writeObjects(urls);
          }
        `;

        const scriptPath = path.join(os.tmpdir(), `clipboard_script_${Date.now()}.js`);
        fs.writeFileSync(scriptPath, jxaScript.trim(), 'utf8');
        logger.debug(L.copyJxaScript, scriptPath);

        exec(`osascript -l JavaScript "${scriptPath}"`, (error, stdout, stderr) => {
          try {
            if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
            if (fs.existsSync(pathsFilePath)) fs.unlinkSync(pathsFilePath);
          } catch (cleanupError) {
            logger.warn(L.copyCleanupFail, cleanupError);
          }

          if (error) {
            logger.error(L.copyJxaFail, error);
            event.reply('copy-files-result', { 
              success: false, 
              error: `复制失败: ${error.message}` 
            });
          } else {
            logger.info(L.copyOk);
            event.reply('copy-files-result', { 
              success: true, 
              copiedCount: existingFiles.length,
              skippedCount: missingFiles.length
            });
          }
        });
      } else {
        // Linux及其他平台：使用xclip或xsel（如果可用）
        // 首先尝试使用系统剪贴板API
        try {
          // 使用Electron的clipboard API来设置文件路径
          // 注意：这可能不适用于所有Linux桌面环境
          clipboard.write({
            bookmark: existingFiles.join('\n'),
            text: existingFiles.join('\n')
          });
          
          logger.info(L.copyLinuxOk);
          event.reply('copy-files-result', { 
            success: true, 
            copiedCount: existingFiles.length,
            skippedCount: missingFiles.length
          });
        } catch (error) {
          logger.error(L.copyLinuxFail, error);
          event.reply('copy-files-result', { 
            success: false, 
            error: `复制失败: ${error.message}` 
          });
        }
      }
    } catch (error) {
      logger.error(L.copyFail, error);
      event.reply('copy-files-result', { 
        success: false, 
        error: error.message 
      });
    }
  });

  // 页面加载完成
  mainWindow.webContents.on('did-finish-load', () => {
    logger.info(L.pageReady);
  });


  // 窗口关闭事件
  mainWindow.on('closed', () => {
    // 在 macOS 上，当所有窗口关闭时并不退出应用程序
    // 用户可以通过dock重新打开窗口
    // 在其他平台上，关闭最后一个窗口时退出应用
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

// IPC处理函数
function setupIpcHandlers() {
  // 处理窗口控制请求
  ipcMain.handle('window-minimize', () => {
    if (mainWindow) {
      mainWindow.minimize();
    }
  });
  
  ipcMain.handle('window-maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });
  
  ipcMain.handle('window-close', () => {
    if (mainWindow) {
      mainWindow.close();
    }
  });

  // 处理文件夹选择请求
  ipcMain.handle('select-folder', async () => {
    try {
      // 动态获取用户的 Pictures 目录
      const os = require('os');
      const path = require('path');
      const defaultPath = path.join(os.homedir(), 'Pictures');
      
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: '选择照片目录',
        buttonLabel: '选择',
        defaultPath: defaultPath
      });
      
      if (!result.canceled && result.filePaths.length > 0) {
        return { success: true, path: result.filePaths[0] };
      } else {
        return { success: false, message: '用户取消了选择' };
      }
    } catch (error) {
      logger.error(L.folderSelectFail, error);
      return { success: false, message: '文件夹选择失败: ' + error.message };
    }
  });

  // ========== AI图像增强相关 IPC handlers ==========
  
  /**
   * 确保目录存在（递归创建）
   * 用于创建 xualbum 目录来存储增强后的图片
   */
  ipcMain.handle('ensure-directory', async (event, dirPath) => {
    try {
      const fs = require('fs').promises;
      await fs.mkdir(dirPath, { recursive: true });
      logger.debug(L.dirCreated, dirPath);
      return { success: true, path: dirPath };
    } catch (error) {
      logger.error(L.dirFail, error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 保存文件到指定路径
   * 用于保存增强后的图片到 xualbum 目录
   */
  ipcMain.handle('save-file-to-path', async (event, { path, buffer }) => {
    try {
      const fs = require('fs').promises;
      const pathModule = require('path');
      
      // 确保父目录存在
      const dir = pathModule.dirname(path);
      await fs.mkdir(dir, { recursive: true });
      
      // 写入文件
      await fs.writeFile(path, Buffer.from(buffer));
      logger.debug(L.fileSaved, path);
      
      return { success: true, path };
    } catch (error) {
      logger.error(L.fileSaveFail, error);
      return { success: false, error: error.message };
    }
  });

  // ========== 分享功能相关 IPC handlers ==========
  
  /**
   * 复制图片文件到剪贴板（作为图片对象）
   */
  ipcMain.handle('shell-copy-image-to-clipboard', async (event, imagePath) => {
    try {
      // 使用nativeImage加载图片
      const image = nativeImage.createFromPath(imagePath);
      
      if (image.isEmpty()) {
        logger.error(L.imageEmpty, imagePath);
        return { success: false, error: '图片加载失败' };
      }
      
      // 将图片写入剪贴板
      clipboard.writeImage(image);
      logger.debug(L.imageCopyOk, imagePath);
      return { success: true };
    } catch (error) {
      logger.error(L.imageCopyFail, error);
      return { success: false, error: error.message };
    }
  });

}

// 在应用启动前设置 GPU 相关参数，解决 GPU 状态错误
// 在 macOS 上，我们可能会启用硬件加速，因为它通常有更好的图形支持
if (process.platform !== 'darwin') {
  app.commandLine.appendSwitch('--disable-gpu');
  app.commandLine.appendSwitch('--disable-gpu-sandbox');
  app.commandLine.appendSwitch('--disable-software-rasterizer');
}
app.commandLine.appendSwitch('--disable-background-timer-throttling');
app.commandLine.appendSwitch('--disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('--disable-renderer-backgrounding');

// 当Electron完成初始化并准备创建浏览器窗口时调用此方法
app.whenReady().then(() => {
  ensureLogFile(); // 打包后：立即创建日志文件（app 标准 logs 目录或 /tmp），否则后续 logger 不会写
  checkAndInstallPlatformDependencies(); // 检查并安装平台特定依赖
  setupIpcHandlers();
  createWindow();
});

// 当所有窗口都关闭时退出应用
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
