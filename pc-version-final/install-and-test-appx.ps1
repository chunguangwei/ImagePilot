# 安装并测试APPX包，验证磁贴图标
# 用法: .\install-and-test-appx.ps1 [appx文件路径]

param(
    [string]$AppxPath = "",
    [switch]$SkipBuild = $false,
    [switch]$SkipSign = $false
)

$ErrorActionPreference = "Stop"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "APPX 安装和测试工具" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# 检查管理员权限
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "警告: 需要管理员权限来安装APPX包" -ForegroundColor Yellow
    Write-Host "请以管理员身份运行此脚本`n" -ForegroundColor Yellow
}

# 如果没有指定路径，自动查找最新的已签名APPX文件（优先查找 -signed.appx）
if ([string]::IsNullOrEmpty($AppxPath)) {
    Write-Host "正在查找最新的已签名 APPX 文件..." -ForegroundColor Yellow
    
    # 优先查找已签名的文件
    $signedFiles = Get-ChildItem -Path "$PSScriptRoot\dist" -Filter "*-signed.appx" -ErrorAction SilentlyContinue | 
                   Sort-Object LastWriteTime -Descending
    
    if ($signedFiles -and $signedFiles.Count -gt 0) {
        $AppxPath = $signedFiles[0].FullName
        Write-Host "找到已签名的 APPX 文件: $AppxPath" -ForegroundColor Green
    } else {
        # 如果没有找到已签名的文件，查找所有 APPX 文件
        $appxFiles = Get-ChildItem -Path "$PSScriptRoot\dist" -Filter "*.appx" -ErrorAction SilentlyContinue | 
                     Where-Object { $_.Name -notlike "*-signed.appx" } |
                     Sort-Object LastWriteTime -Descending
        
        if ($appxFiles -and $appxFiles.Count -gt 0) {
            $AppxPath = $appxFiles[0].FullName
            Write-Host "找到 APPX 文件: $AppxPath（未签名，将尝试自动签名）" -ForegroundColor Yellow
        } else {
            if (-not $SkipBuild) {
                Write-Host "未找到 APPX 文件，开始打包..." -ForegroundColor Yellow
                & "$PSScriptRoot\build-and-verify-appx.ps1"
                
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "错误: 打包失败！" -ForegroundColor Red
                    exit 1
                }
                
                # 重新查找
                $appxFiles = Get-ChildItem -Path "$PSScriptRoot\dist" -Filter "*.appx" -ErrorAction SilentlyContinue | 
                             Sort-Object LastWriteTime -Descending
                if ($appxFiles -and $appxFiles.Count -gt 0) {
                    $AppxPath = $appxFiles[0].FullName
                } else {
                    Write-Host "错误: 打包后仍未找到 APPX 文件！" -ForegroundColor Red
                    exit 1
                }
            } else {
                Write-Host "错误: 未找到 APPX 文件！" -ForegroundColor Red
                Write-Host "请先运行打包命令: npm run electron-pack-appx" -ForegroundColor Yellow
                exit 1
            }
        }
    }
}

if (-not (Test-Path $AppxPath)) {
    Write-Host "错误: APPX 文件不存在: $AppxPath" -ForegroundColor Red
    exit 1
}

# 步骤1: 检查并签名 APPX 文件（如果需要）
if (-not $SkipSign) {
    Write-Host "`n[步骤 1/4] 检查 APPX 签名状态..." -ForegroundColor Yellow
    
    # 检查文件是否已签名
    $isSigned = $false
    try {
        $signTool = (Get-Command signtool.exe -ErrorAction SilentlyContinue).Source
        if ($signTool) {
            $verifyOutput = & $signTool verify /pa /v "`"$AppxPath`"" 2>&1
            if ($LASTEXITCODE -eq 0) {
                $isSigned = $true
                Write-Host "✓ APPX 文件已签名" -ForegroundColor Green
            }
        }
    } catch {
        # SignTool 不可用，跳过检查
    }
    
    if (-not $isSigned) {
        Write-Host "APPX 文件未签名，尝试使用测试证书签名..." -ForegroundColor Yellow
        
        $signScript = Join-Path $PSScriptRoot "sign-appx-with-test-cert.ps1"
        if (Test-Path $signScript) {
            try {
                & $signScript -AppxPath $AppxPath
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "✓ APPX 文件签名成功" -ForegroundColor Green
                    # 更新路径为签名后的文件
                    $signedPath = $AppxPath -replace '\.appx$', '-signed.appx'
                    if (Test-Path $signedPath) {
                        $AppxPath = $signedPath
                        Write-Host "  使用签名文件: $AppxPath" -ForegroundColor Gray
                    }
                } else {
                    Write-Host "警告: 签名失败，将尝试直接安装（可能需要开发者模式）" -ForegroundColor Yellow
                }
            } catch {
                Write-Host "警告: 签名脚本执行失败: $($_.Exception.Message)" -ForegroundColor Yellow
                Write-Host "将尝试直接安装（可能需要开发者模式）" -ForegroundColor Yellow
            }
        } else {
            Write-Host "警告: 未找到签名脚本，将尝试直接安装（可能需要开发者模式）" -ForegroundColor Yellow
        }
    }
}

# 步骤2: 检查并启用开发者模式
Write-Host "`n[步骤 2/4] 检查开发者模式..." -ForegroundColor Yellow

$devMode = Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" -Name "AllowDevelopmentWithoutDevLicense" -ErrorAction SilentlyContinue

if ($null -eq $devMode -or $devMode.AllowDevelopmentWithoutDevLicense -ne 1) {
    if ($isAdmin) {
        Write-Host "正在启用开发者模式..." -ForegroundColor Yellow
        Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" -Name "AllowDevelopmentWithoutDevLicense" -Value 1 -ErrorAction Stop
        Write-Host "✓ 开发者模式已启用" -ForegroundColor Green
    } else {
        Write-Host "警告: 需要管理员权限来启用开发者模式" -ForegroundColor Yellow
        Write-Host "请以管理员身份运行此脚本，或手动启用开发者模式" -ForegroundColor Yellow
    }
} else {
    Write-Host "✓ 开发者模式已启用" -ForegroundColor Green
}

# 步骤3: 卸载旧版本（如果存在）
Write-Host "`n[步骤 3/4] 检查已安装的版本..." -ForegroundColor Yellow

$installedApp = Get-AppxPackage | Where-Object { $_.Name -like "*XinTuAlbum*" -or $_.Name -like "*ImageClassifier*" }

if ($installedApp) {
    Write-Host "找到已安装的应用: $($installedApp.Name)" -ForegroundColor Yellow
    Write-Host "正在卸载旧版本..." -ForegroundColor Yellow
    
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

# 步骤4: 安装APPX包
Write-Host "`n[步骤 4/4] 安装 APPX 包..." -ForegroundColor Yellow
Write-Host "文件: $AppxPath" -ForegroundColor Gray

try {
    Add-AppxPackage -Path $AppxPath -ErrorAction Stop
    Write-Host "✓ APPX 包安装成功！" -ForegroundColor Green
} catch {
    Write-Host "✗ 安装失败: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.Exception.Message -like "*证书*" -or $_.Exception.Message -like "*certificate*" -or $_.Exception.Message -like "*0x800B0100*") {
        Write-Host "`n提示: APPX 包需要签名才能安装" -ForegroundColor Yellow
        Write-Host "手动步骤:" -ForegroundColor Yellow
        Write-Host "1. 创建测试证书: .\create-test-certificate.ps1" -ForegroundColor Gray
        Write-Host "2. 安装证书: .\install-test-certificate.bat (以管理员身份)" -ForegroundColor Gray
        Write-Host "3. 签名 APPX: .\sign-appx-with-test-cert.ps1" -ForegroundColor Gray
        Write-Host "4. 重新运行安装: .\install-and-test-appx.ps1" -ForegroundColor Gray
    }
    
    exit 1
}

# 验证安装
Write-Host "`n验证安装..." -ForegroundColor Yellow
$newApp = Get-AppxPackage | Where-Object { $_.Name -like "*XinTuAlbum*" -or $_.Name -like "*ImageClassifier*" }

if ($newApp) {
    Write-Host "✓ 应用已成功安装" -ForegroundColor Green
    Write-Host "  名称: $($newApp.Name)" -ForegroundColor Gray
    Write-Host "  版本: $($newApp.Version)" -ForegroundColor Gray
    Write-Host "  安装位置: $($newApp.InstallLocation)" -ForegroundColor Gray
} else {
    Write-Host "警告: 无法验证应用是否已安装" -ForegroundColor Yellow
}

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "✓ 安装完成！" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Green

Write-Host "下一步验证步骤:" -ForegroundColor Cyan
Write-Host "1. 打开开始菜单，搜索 'ImagePilot'" -ForegroundColor Gray
Write-Host "2. 右键点击应用磁贴，选择 '固定到开始屏幕'" -ForegroundColor Gray
Write-Host "3. 检查磁贴是否显示正确的应用图标（不是默认图标）" -ForegroundColor Gray
Write-Host "4. 如果磁贴显示默认图标，说明磁贴图标配置有问题" -ForegroundColor Yellow
Write-Host ""
Write-Host "也可以运行应用，检查应用图标是否正确显示" -ForegroundColor Gray

