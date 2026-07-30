@echo off
echo 开始构建ImagePilotPC版本...

echo.
echo 步骤1: 安装依赖
if defined CI goto skip_install
call npm install
goto after_install
:skip_install
echo (CI 模式，跳过 npm install，使用 workflow 已安装依赖)
:after_install

echo.
echo 步骤2: 构建React应用
call npm run build

echo.
echo 步骤3: 打包Electron应用（EXE版本和APPX版本）
call npx electron-builder --win nsis portable appx --x64 --config.forceCodeSigning=false

echo.
echo 步骤4: 修复APPX图标（生成修复后的未签名版本，用于提交微软）
powershell -ExecutionPolicy Bypass -File ".\fix-appx-icons-proper.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo 错误: APPX图标修复失败
    exit /b 1
)

echo.
echo 步骤5: 签名APPX（测试签名版本）
powershell -ExecutionPolicy Bypass -File ".\sign-appx-with-test-cert.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo 错误: APPX签名失败
    exit /b 1
)

echo.
echo 构建完成！输出文件位于 dist 目录中
echo   - EXE版本: ImagePilot-win-amd-portable-*.exe, ImagePilot-win-amd-setup-*.exe
echo   - APPX无签名版本（已修复图标，用于提交微软）: ImagePilot-*.appx
echo   - APPX测试签名版本: ImagePilot-*-signed.appx
if defined CI goto no_pause
pause
:no_pause
