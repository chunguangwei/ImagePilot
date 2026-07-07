# 验证 APPX 包中的磁贴图标配置
# 用法: .\verify-tile-icons.ps1 [appx文件路径]

param(
    [string]$AppxPath = ""
)

$ErrorActionPreference = "Stop"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "验证磁贴图标配置" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# 如果没有指定路径，自动查找最新的APPX文件
if ([string]::IsNullOrEmpty($AppxPath)) {
    Write-Host "正在查找最新的 APPX 文件..." -ForegroundColor Yellow
    
    $appxFiles = Get-ChildItem -Path "$PSScriptRoot\dist" -Filter "*.appx" -ErrorAction SilentlyContinue | 
                 Sort-Object LastWriteTime -Descending
    
    if ($appxFiles -and $appxFiles.Count -gt 0) {
        $AppxPath = $appxFiles[0].FullName
        Write-Host "找到 APPX 文件: $AppxPath" -ForegroundColor Green
    } else {
        Write-Host "错误: 未找到 APPX 文件！" -ForegroundColor Red
        Write-Host "请先运行打包命令: npm run electron-pack-appx" -ForegroundColor Yellow
        exit 1
    }
}

if (-not (Test-Path $AppxPath)) {
    Write-Host "错误: APPX 文件不存在: $AppxPath" -ForegroundColor Red
    exit 1
}

# 创建临时解压目录
$tempDir = Join-Path $env:TEMP "verify-appx-$(Get-Date -Format 'yyyyMMddHHmmss')"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    Write-Host "`n[步骤 1/3] 解压 APPX 文件..." -ForegroundColor Yellow
    Write-Host "临时目录: $tempDir" -ForegroundColor Gray
    
    # 解压 APPX（APPX 实际上是 ZIP 文件，需要先复制并重命名为 .zip）
    $tempZip = Join-Path $env:TEMP "verify-appx-$(Get-Date -Format 'yyyyMMddHHmmss').zip"
    Copy-Item -Path $AppxPath -Destination $tempZip -Force
    try {
        Expand-Archive -Path $tempZip -DestinationPath $tempDir -Force
        Write-Host "✓ 解压完成" -ForegroundColor Green
    } finally {
        Remove-Item -Path $tempZip -Force -ErrorAction SilentlyContinue
    }
    
    # 检查图标文件
    Write-Host "`n[步骤 2/3] 检查图标文件..." -ForegroundColor Yellow
    
    # APPX 中的图标文件在 assets 目录中（不是 images）
    $assetsDir = Join-Path $tempDir "assets"
    
    # 必需的图标文件（基础文件，electron-builder 会自动检测）
    $requiredIcons = @(
        "StoreLogo.png",
        "Square44x44Logo.png",
        "Square150x150Logo.png",
        "Wide310x150Logo.png",
        "Square310x310Logo.png"
    )
    
    $allFound = $true
    foreach ($icon in $requiredIcons) {
        $iconPath = Join-Path $assetsDir $icon
        if (Test-Path $iconPath) {
            try {
                Add-Type -AssemblyName System.Drawing
                $img = [System.Drawing.Image]::FromFile($iconPath)
                $size = (Get-Item $iconPath).Length
                Write-Host "  ✓ $icon - $($img.Width)x$($img.Height) ($([math]::Round($size/1KB, 2)) KB)" -ForegroundColor Green
                $img.Dispose()
            } catch {
                $size = (Get-Item $iconPath).Length
                Write-Host "  ✓ $icon ($([math]::Round($size/1KB, 2)) KB)" -ForegroundColor Green
            }
        } else {
            Write-Host "  ✗ $icon (未找到)" -ForegroundColor Red
            $allFound = $false
        }
    }
    
    # 检查 assets 目录中的所有图标文件
    Write-Host "`nassets 目录中的所有图标文件:" -ForegroundColor Cyan
    if (Test-Path $assetsDir) {
        Get-ChildItem -Path $assetsDir -Filter "*.png" | ForEach-Object {
            Write-Host "  - $($_.Name)" -ForegroundColor Gray
        }
    } else {
        Write-Host "  ⚠ assets 目录不存在！" -ForegroundColor Yellow
    }
    
    if (-not $allFound) {
        Write-Host "`n警告: 部分图标文件缺失！" -ForegroundColor Yellow
    } else {
        Write-Host "`n✓ 所有图标文件都存在" -ForegroundColor Green
    }
    
    # 检查 manifest 配置
    Write-Host "`n[步骤 3/3] 检查 AppxManifest.xml 配置..." -ForegroundColor Yellow
    
    $manifestPath = Join-Path $tempDir "AppxManifest.xml"
    if (Test-Path $manifestPath) {
        $manifestContent = Get-Content $manifestPath -Raw
        
        # 检查 DefaultTile 配置
        if ($manifestContent -match '<uap:DefaultTile[^>]*>') {
            Write-Host "✓ 找到 DefaultTile 配置" -ForegroundColor Green
            
            # 检查各个图标路径
            $checks = @(
                @{ Name = "Wide310x150Logo"; Pattern = 'Wide310x150Logo="([^"]+)"' },
                @{ Name = "Square150x150Logo"; Pattern = 'Square150x150Logo="([^"]+)"' },
                @{ Name = "Square310x310Logo"; Pattern = 'Square310x310Logo="([^"]+)"' }
            )
            
            foreach ($check in $checks) {
                if ($manifestContent -match $check.Pattern) {
                    $path = $matches[1]
                    Write-Host "  ✓ $($check.Name): $path" -ForegroundColor Green
                } else {
                    Write-Host "  ✗ $($check.Name): 未配置" -ForegroundColor Red
                }
            }
        } else {
            Write-Host "✗ 未找到 DefaultTile 配置！" -ForegroundColor Red
            Write-Host "  磁贴图标可能不会正确显示" -ForegroundColor Yellow
        }
        
        # 显示 manifest 中的相关部分
        Write-Host "`nManifest 中的 DefaultTile 配置:" -ForegroundColor Cyan
        if ($manifestContent -match '<uap:DefaultTile[^>]*>') {
            $tileMatch = $manifestContent | Select-String -Pattern '<uap:DefaultTile[^>]*>' -AllMatches
            foreach ($match in $tileMatch.Matches) {
                Write-Host "  $($match.Value)" -ForegroundColor Gray
            }
        }
    } else {
        Write-Host "✗ 未找到 AppxManifest.xml" -ForegroundColor Red
    }
    
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "验证完成！" -ForegroundColor Green
    Write-Host "========================================`n" -ForegroundColor Green
    
    Write-Host "下一步检查:" -ForegroundColor Cyan
    Write-Host "1. 打开开始菜单，搜索 'ImagePilot'" -ForegroundColor Gray
    Write-Host "2. 右键点击应用，选择 '固定到开始屏幕'" -ForegroundColor Gray
    Write-Host "3. 检查磁贴是否显示正确的图标（不是默认图标）" -ForegroundColor Gray
    Write-Host "4. 尝试调整磁贴大小，检查不同尺寸的图标" -ForegroundColor Gray
    
} finally {
    # 清理临时目录
    Write-Host "`n清理临时文件..." -ForegroundColor Gray
    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}

