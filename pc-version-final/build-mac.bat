@echo off
chcp 65001 >nul
echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║         ImagePilot - macOS版本构建脚本                       ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

echo [1/3] 检查环境...
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 找不到npm，请先安装Node.js
    pause
    exit /b 1
)
echo ✅ Node.js环境检测成功

echo.
echo [2/3] 构建React应用...
call npm run build
if %errorlevel% neq 0 (
    echo ❌ 构建失败
    pause
    exit /b 1
)
echo ✅ React应用构建完成

echo.
echo [3/3] 打包macOS应用...
echo.
echo 选择打包格式:
echo   1. DMG安装包 (推荐)
echo   2. DMG + ZIP (包含便携版)
echo.
set /p choice="请选择 (1 或 2): "

if "%choice%"=="1" (
    echo.
    echo 📦 正在生成DMG安装包...
    call electron-builder --mac dmg
) else if "%choice%"=="2" (
    echo.
    echo 📦 正在生成DMG和ZIP...
    call electron-builder --mac dmg --mac zip
) else (
    echo ❌ 无效选择
    pause
    exit /b 1
)

if %errorlevel% neq 0 (
    echo.
    echo ❌ 打包失败，请检查错误信息
    pause
    exit /b 1
)

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║                    ✅ 构建完成！                           ║
echo ╚════════════════════════════════════════════════════════════╝
echo.
echo 📁 输出目录: dist\
echo.
echo 生成的文件:
dir /b dist\*.dmg 2>nul
dir /b dist\*.zip 2>nul
echo.
echo 💡 提示:
echo   - DMG文件可直接分发给macOS用户
echo   - 用户首次打开需要"右键-打开"
echo   - 支持Intel和Apple Silicon两种架构
echo.
echo 📖 详细说明请查看: BUILD_GUIDE_MAC.md
echo.
pause

