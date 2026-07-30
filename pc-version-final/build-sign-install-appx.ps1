# APPX 打包、签名、安装一体化脚本
# 用法: .\build-sign-install-appx.ps1 [选项]
#
# 选项:
#   -SkipBuild     跳过打包步骤（使用现有的 APPX 文件）
#   -SkipSign      跳过签名步骤（使用未签名的 APPX）
#   -SkipInstall   跳过安装步骤（只打包和签名）
#   -CertPassword  证书密码（默认: test123456）
#
# 注意:
#   此脚本使用与 build.bat 相同的构建逻辑，确保一致性

param(
    [switch]$SkipBuild = $false,
    [switch]$SkipSign = $false,
    [switch]$SkipInstall = $false,
    [string]$CertPassword = "test123456"
)

$ErrorActionPreference = "Stop"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "APPX 打包、签名、安装一体化工具" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# 检查管理员权限（安装时需要）
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($SkipInstall -and -not $isAdmin) {
    Write-Host "警告: 安装 APPX 需要管理员权限" -ForegroundColor Yellow
    Write-Host "请以管理员身份运行此脚本`n" -ForegroundColor Yellow
}

# 步骤1: 构建和打包（使用与 build.bat 相同的逻辑）
if (-not $SkipBuild) {
    Write-Host "[步骤 1/5] 安装依赖..." -ForegroundColor Yellow
    try {
        Push-Location $PSScriptRoot
        npm install
        if ($LASTEXITCODE -ne 0) {
            throw "依赖安装失败"
        }
        Write-Host "✓ 依赖安装完成" -ForegroundColor Green
    } catch {
        Write-Host "✗ 依赖安装失败: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    } finally {
        Pop-Location
    }
    
    Write-Host "`n[步骤 2/5] 构建React应用..." -ForegroundColor Yellow
    try {
        Push-Location $PSScriptRoot
        npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "React应用构建失败"
        }
        Write-Host "✓ React应用构建完成" -ForegroundColor Green
    } catch {
        Write-Host "✗ React应用构建失败: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    } finally {
        Pop-Location
    }
    
    Write-Host "`n[步骤 3/5] 打包Electron应用（EXE版本和APPX版本）..." -ForegroundColor Yellow
    try {
        Push-Location $PSScriptRoot
        npx electron-builder --win nsis portable appx --x64 --config.forceCodeSigning=false
        if ($LASTEXITCODE -ne 0) {
            throw "Electron应用打包失败"
        }
        Write-Host "✓ Electron应用打包完成" -ForegroundColor Green
    } catch {
        Write-Host "✗ Electron应用打包失败: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    } finally {
        Pop-Location
    }
    
    Write-Host "`n[步骤 4/5] 修复APPX图标..." -ForegroundColor Yellow
    try {
        Push-Location $PSScriptRoot
        powershell -ExecutionPolicy Bypass -File ".\fix-appx-icons-proper.ps1"
        if ($LASTEXITCODE -ne 0) {
            throw "APPX图标修复失败"
        }
        Write-Host "✓ APPX图标修复完成" -ForegroundColor Green
    } catch {
        Write-Host "✗ APPX图标修复失败: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[步骤 1-4/5] 跳过构建步骤（使用现有的 APPX 文件）" -ForegroundColor Gray
}

# 步骤5: 查找 APPX 文件
Write-Host "`n[步骤 5/5] 查找 APPX 文件..." -ForegroundColor Yellow

$appxFiles = Get-ChildItem -Path "$PSScriptRoot\dist" -Filter "*.appx" -ErrorAction SilentlyContinue | 
             Where-Object { $_.Name -notlike "*-signed.appx" } |
             Sort-Object LastWriteTime -Descending

if (-not $appxFiles -or $appxFiles.Count -eq 0) {
    Write-Host "✗ 未找到未签名的 APPX 文件！" -ForegroundColor Red
    Write-Host "请先运行构建命令或移除 -SkipBuild 参数" -ForegroundColor Yellow
    exit 1
}

$AppxPath = $appxFiles[0].FullName
Write-Host "✓ 找到 APPX 文件: $AppxPath" -ForegroundColor Green

# 步骤6: 签名 APPX（使用 sign-appx-with-test-cert.ps1）
if (-not $SkipSign) {
    Write-Host "`n[步骤 6/6] 签名 APPX 文件..." -ForegroundColor Yellow
    
    try {
        Push-Location $PSScriptRoot
        powershell -ExecutionPolicy Bypass -File ".\sign-appx-with-test-cert.ps1" -AppxPath $AppxPath
        if ($LASTEXITCODE -ne 0) {
            throw "APPX签名失败"
        }
        Write-Host "✓ APPX签名完成" -ForegroundColor Green
        
        # 查找签名后的文件
        $signedAppxFiles = Get-ChildItem -Path "$PSScriptRoot\dist" -Filter "*-signed.appx" -ErrorAction SilentlyContinue | 
                          Sort-Object LastWriteTime -Descending
        if ($signedAppxFiles -and $signedAppxFiles.Count -gt 0) {
            $AppxPath = $signedAppxFiles[0].FullName
            Write-Host "✓ 签名后的文件: $AppxPath" -ForegroundColor Green
        }
    } catch {
        Write-Host "✗ APPX签名失败: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    } finally {
        Pop-Location
    }
} else {
    Write-Host "`n[步骤 6/6] 跳过签名步骤" -ForegroundColor Gray
    Write-Host "警告: 未签名的 APPX 可能需要开发者模式才能安装" -ForegroundColor Yellow
}

# 步骤7: 安装 APPX
if (-not $SkipInstall) {
    Write-Host "`n[步骤 7/7] 安装 APPX 包..." -ForegroundColor Yellow
    
    if (-not $isAdmin) {
        Write-Host "警告: 需要管理员权限来安装 APPX 包" -ForegroundColor Yellow
        Write-Host "请以管理员身份运行此脚本，或手动安装:" -ForegroundColor Yellow
        Write-Host "  Add-AppxPackage -Path `"$AppxPath`"" -ForegroundColor Gray
        exit 0
    }
    
    # 检查并启用开发者模式
    Write-Host "检查开发者模式..." -ForegroundColor Gray
    $devMode = Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" -Name "AllowDevelopmentWithoutDevLicense" -ErrorAction SilentlyContinue
    
    if ($null -eq $devMode -or $devMode.AllowDevelopmentWithoutDevLicense -ne 1) {
        Write-Host "正在启用开发者模式..." -ForegroundColor Gray
        Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" -Name "AllowDevelopmentWithoutDevLicense" -Value 1 -ErrorAction Stop
        Write-Host "✓ 开发者模式已启用" -ForegroundColor Green
    } else {
        Write-Host "✓ 开发者模式已启用" -ForegroundColor Green
    }
    
    # 卸载旧版本（如果存在）
    Write-Host "检查已安装的版本..." -ForegroundColor Gray
    $installedApp = Get-AppxPackage | Where-Object { $_.Name -like "*ImagePilot*" -or $_.Name -like "*ImageClassifier*" }
    
    if ($installedApp) {
        Write-Host "找到已安装的应用: $($installedApp.Name)" -ForegroundColor Yellow
        Write-Host "正在卸载旧版本..." -ForegroundColor Gray
        
        try {
            Remove-AppxPackage -Package $installedApp.PackageFullName -ErrorAction Stop
            Write-Host "✓ 旧版本已卸载" -ForegroundColor Green
            Start-Sleep -Seconds 2
        } catch {
            Write-Host "警告: 卸载失败，可能需要在设置中手动卸载: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "未找到已安装的版本" -ForegroundColor Gray
    }
    
    # 安装新版本
    Write-Host "正在安装 APPX 包..." -ForegroundColor Gray
    Write-Host "文件: $AppxPath" -ForegroundColor Gray
    
    try {
        Add-AppxPackage -Path $AppxPath -ErrorAction Stop
        Write-Host "✓ APPX 包安装成功！" -ForegroundColor Green
        
        # 验证安装
        Write-Host "`n验证安装..." -ForegroundColor Gray
        $newApp = Get-AppxPackage | Where-Object { $_.Name -like "*ImagePilot*" -or $_.Name -like "*ImageClassifier*" }
        
        if ($newApp) {
            Write-Host "✓ 应用已成功安装" -ForegroundColor Green
            Write-Host "  名称: $($newApp.Name)" -ForegroundColor Gray
            Write-Host "  版本: $($newApp.Version)" -ForegroundColor Gray
            Write-Host "  安装位置: $($newApp.InstallLocation)" -ForegroundColor Gray
        } else {
            Write-Host "警告: 无法验证应用是否已安装" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "`n✗ 安装失败: $($_.Exception.Message)" -ForegroundColor Red
        
        if ($_.Exception.Message -like "*证书*" -or $_.Exception.Message -like "*certificate*" -or $_.Exception.Message -like "*0x800B0100*") {
            Write-Host "`n提示: APPX 包需要签名才能安装" -ForegroundColor Yellow
            Write-Host "手动步骤:" -ForegroundColor Yellow
            Write-Host "1. 创建测试证书: .\create-test-certificate.ps1" -ForegroundColor Gray
            Write-Host "2. 安装证书: .\install-test-certificate.bat (以管理员身份)" -ForegroundColor Gray
            Write-Host "3. 重新运行此脚本" -ForegroundColor Gray
        }
        
        exit 1
    }
} else {
    Write-Host "`n[步骤 7/7] 跳过安装步骤" -ForegroundColor Gray
}

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "✓ 完成！" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Green

if (-not $SkipInstall) {
    Write-Host "下一步:" -ForegroundColor Cyan
    Write-Host "1. 打开开始菜单，搜索 'ImagePilot'" -ForegroundColor Gray
    Write-Host "2. 右键点击应用，选择 '固定到开始屏幕'" -ForegroundColor Gray
    Write-Host "3. 检查磁贴图标是否正确显示" -ForegroundColor Gray
    Write-Host "4. 运行应用测试功能" -ForegroundColor Gray
}

Write-Host "`nAPPX 文件位置: $AppxPath" -ForegroundColor Gray
