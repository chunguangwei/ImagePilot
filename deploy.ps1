# 部署脚本 - 构建并部署 Android 和 PC 版本
# 使用方法: .\deploy.ps1
# 
# 参数说明:
#   -ServerHost: 服务器主机名或IP地址 (默认: "web")
#   -ServerUser: 服务器用户名 (默认: "root")
#   -ServerPath: 服务器目标路径 (默认: "/var/www/xintuxiangce/website/dist")
#   -QiniuUploadScript: 服务器上七牛CDN上传脚本路径 (默认: "/path/to/qiniu-upload.sh")
#
# 示例:
#   .\deploy.ps1 -ServerHost "192.168.1.100" -QiniuUploadScript "/root/upload-to-qiniu.sh"
#
# 注意:
#   1. 需要确保已安装 OpenSSH 客户端 (Windows 10/11 通常已内置)
#   2. 需要配置 SSH 密钥认证或准备输入密码
#   3. 需要根据实际情况修改 QiniuUploadScript 路径

param(
    [string]$ServerHost = "web",
    [string]$ServerUser = "root",
    [string]$ServerPath = "/var/www/xintuxiangce/website/dist",
    [string]$QiniuUploadScript = "/var/www/xintuxiangce/qiniu-upload.py"  # 需要根据实际情况修改
)

$ErrorActionPreference = "Stop"

# 获取脚本所在目录（使用 $PSScriptRoot 或回退到 $MyInvocation）
if ($PSScriptRoot) {
    $scriptDir = $PSScriptRoot
} else {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

# 获取当前时间戳（2位年份+月+日+时+分）
function Get-Timestamp {
    $now = Get-Date
    return $now.ToString("yyMMddHHmm")
}

# 检查文件是否存在且生成时间在10分钟内
function Test-FileRecent {
    param(
        [string]$FilePath,
        [int]$Minutes = 10
    )
    
    if (-not (Test-Path $FilePath)) {
        Write-Host "❌ 文件不存在: $FilePath" -ForegroundColor Red
        return $false
    }
    
    $file = Get-Item $FilePath
    $fileTime = $file.LastWriteTime
    $now = Get-Date
    $timeDiff = ($now - $fileTime).TotalMinutes
    
    Write-Host "📄 文件: $FilePath" -ForegroundColor Cyan
    Write-Host "   生成时间: $fileTime" -ForegroundColor Gray
    Write-Host "   时间差: $([math]::Round($timeDiff, 2)) 分钟" -ForegroundColor Gray
    
    if ($timeDiff -gt $Minutes) {
        Write-Host "⚠️  警告: 文件生成时间超过 $Minutes 分钟！" -ForegroundColor Yellow
        return $false
    }
    
    return $true
}

# 压缩文件
function Compress-File {
    param(
        [string]$FilePath,
        [string]$OutputPath
    )
    
    Write-Host "📦 压缩文件: $FilePath -> $OutputPath" -ForegroundColor Yellow
    
    # 转换为绝对路径（使用脚本所在目录作为基准）
    if (-not [System.IO.Path]::IsPathRooted($FilePath)) {
        $FilePath = Join-Path $scriptDir $FilePath
    }
    $FilePath = [System.IO.Path]::GetFullPath($FilePath)
    
    if (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
        $OutputPath = Join-Path $scriptDir $OutputPath
    }
    $OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
    
    if (-not (Test-Path $FilePath)) {
        throw "源文件不存在: $FilePath"
    }
    
    # 确保输出目录存在
    $outputDir = Split-Path $OutputPath -Parent
    if (-not (Test-Path $outputDir)) {
        New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
        Write-Host "   创建输出目录: $outputDir" -ForegroundColor Gray
    }
    
    # 使用 .NET 压缩单个文件
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    
    # 如果输出文件已存在，先删除
    if (Test-Path $OutputPath) {
        Remove-Item $OutputPath -Force
    }
    
    # 创建 ZIP 文件并添加单个文件
    $zip = [System.IO.Compression.ZipFile]::Open($OutputPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $entry = $zip.CreateEntry((Split-Path $FilePath -Leaf))
        $entryStream = $entry.Open()
        try {
            $fileStream = [System.IO.File]::OpenRead($FilePath)
            try {
                $fileStream.CopyTo($entryStream)
            } finally {
                $fileStream.Close()
            }
        } finally {
            $entryStream.Close()
        }
    } finally {
        $zip.Dispose()
    }
    
    Write-Host "✅ 压缩完成: $OutputPath" -ForegroundColor Green
}

Write-Host "🚀 开始部署流程..." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

# 检查必要的命令是否可用
$requiredCommands = @("scp", "ssh")
foreach ($cmd in $requiredCommands) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "❌ 错误: 未找到命令 '$cmd'，请确保已安装 OpenSSH 客户端" -ForegroundColor Red
        Write-Host "   在 Windows 上，可以通过以下方式安装:" -ForegroundColor Yellow
        Write-Host "   设置 -> 应用 -> 可选功能 -> 添加功能 -> OpenSSH 客户端" -ForegroundColor Yellow
        exit 1
    }
}

# 步骤1: 构建 Android 版本
Write-Host "`n📱 步骤1: 构建 Android 版本..." -ForegroundColor Yellow
Push-Location android
try {
    & .\build-and-sign-release.ps1
    if ($LASTEXITCODE -ne 0) {
        throw "Android 构建失败"
    }
} finally {
    Pop-Location
}

# 步骤2: 构建 PC 版本
Write-Host "`n💻 步骤2: 构建 PC 版本..." -ForegroundColor Yellow
Push-Location pc-version-final
try {
    cmd /c ".\build.bat"
    if ($LASTEXITCODE -ne 0) {
        throw "PC 构建失败"
    }
} finally {
    Pop-Location
}

# 步骤3: 检查文件生成时间
Write-Host "`n🔍 步骤3: 检查文件生成时间..." -ForegroundColor Yellow

# 从 package.json 读取版本，动态查找 Windows 制品
$pcPkgPath = Join-Path $scriptDir "pc-version-final\package.json"
$pcVersion = "1.1.3"
if (Test-Path $pcPkgPath) {
    $pcPkg = Get-Content $pcPkgPath -Raw | ConvertFrom-Json
    $pcVersion = $pcPkg.version
}

$distPath = Join-Path $scriptDir "pc-version-final\dist"
# 按修改时间取最新，避免选中旧构建产物
$portableExe = Get-ChildItem -Path $distPath -Filter "*portable*.exe" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$setupExe = Get-ChildItem -Path $distPath -Filter "*Setup*.exe" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $portableExe) { $portableExe = Get-ChildItem -Path $distPath -Filter "ImagePilot*.exe" -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike "*Setup*" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1 }
if (-not $setupExe) { $setupExe = Get-ChildItem -Path $distPath -Filter "*Setup*.exe" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 }

$apkPath = Join-Path $scriptDir "android\app\build\outputs\apk\release\app-release-signed.apk"
$files = @(
    @{ Path = $apkPath; Name = "Android APK" }
)
if ($portableExe) { $files = @(@{ Path = $portableExe.FullName; Name = "便携版" }) + $files }
if ($setupExe) { $files = @(@{ Path = $setupExe.FullName; Name = "安装版" }) + $files }

$allRecent = $true
foreach ($file in $files) {
    if (-not (Test-FileRecent -FilePath $file.Path -Minutes 10)) {
        $allRecent = $false
    }
}

if (-not $allRecent) {
    Write-Host "`n⚠️  警告: 部分文件生成时间超过10分钟！" -ForegroundColor Yellow
    $response = Read-Host "是否继续部署? (Y/N)"
    if ($response -ne "Y" -and $response -ne "y") {
        Write-Host "❌ 用户取消部署" -ForegroundColor Red
        exit 1
    }
}

# 步骤4: 压缩文件
Write-Host "`n📦 步骤4: 压缩文件..." -ForegroundColor Yellow

$timestamp = Get-Timestamp
$tempDir = ".\deploy-temp"
if (Test-Path $tempDir) {
    Remove-Item $tempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

# 压缩便携版
$portableSource = if ($portableExe) { $portableExe.FullName } else { $null }
$portableZipLocal = "$tempDir\xtxc$timestamp.zip"
$portableZipRemote = "xtxc$timestamp.zip"
if ($portableSource -and (Test-Path $portableSource)) {
    Compress-File -FilePath $portableSource -OutputPath $portableZipLocal
} else {
    throw "便携版文件不存在，请在 pc-version-final\dist 中查找 *portable*.exe 或 ImagePilot*.exe"
}

# 压缩安装版
$setupSource = if ($setupExe) { $setupExe.FullName } else { $null }
$setupZipLocal = "$tempDir\xtxcsetup$timestamp.zip"
$setupZipRemote = "xtxcsetup$timestamp.zip"
if ($setupSource -and (Test-Path $setupSource)) {
    Compress-File -FilePath $setupSource -OutputPath $setupZipLocal
} else {
    throw "安装版文件不存在，请在 pc-version-final\dist 中查找 *Setup*.exe"
}

# 处理 Android APK（不压缩，直接重命名）
$apkSource = "android\app\build\outputs\apk\release\app-release-signed.apk"
$apkFileLocal = "$tempDir\xtxc$timestamp.apk"
$apkFileRemote = "xtxc$timestamp.apk"
if (Test-Path $apkSource) {
    Write-Host "📱 复制并重命名 APK 文件: $apkSource -> $apkFileLocal" -ForegroundColor Yellow
    # 转换为绝对路径
    if (-not [System.IO.Path]::IsPathRooted($apkSource)) {
        $apkSource = Join-Path $scriptDir $apkSource
    }
    $apkSource = [System.IO.Path]::GetFullPath($apkSource)
    
    if (-not [System.IO.Path]::IsPathRooted($apkFileLocal)) {
        $apkFileLocal = Join-Path $scriptDir $apkFileLocal
    }
    $apkFileLocal = [System.IO.Path]::GetFullPath($apkFileLocal)
    
    # 确保输出目录存在
    $apkOutputDir = Split-Path $apkFileLocal -Parent
    if (-not (Test-Path $apkOutputDir)) {
        New-Item -ItemType Directory -Path $apkOutputDir -Force | Out-Null
    }
    
    Copy-Item -Path $apkSource -Destination $apkFileLocal -Force
    Write-Host "✅ APK 文件处理完成: $apkFileLocal" -ForegroundColor Green
} else {
    throw "Android APK 文件不存在: $apkSource"
}

# 步骤5: 复制文件到服务器
Write-Host "`n📤 步骤5: 复制文件到服务器..." -ForegroundColor Yellow

$serverAddress = "${ServerUser}@${ServerHost}"

# 复制便携版
Write-Host "复制便携版到服务器..." -ForegroundColor Cyan
scp $portableZipLocal "${serverAddress}:${ServerPath}/pc/portable/$portableZipRemote"
if ($LASTEXITCODE -ne 0) {
    throw "复制便携版失败"
}
# 更新服务器上文件的修改时间为当前时间，确保上传脚本能正确识别最新文件
ssh "${serverAddress}" "touch '${ServerPath}/pc/portable/$portableZipRemote'"

# 复制安装版
Write-Host "复制安装版到服务器..." -ForegroundColor Cyan
scp $setupZipLocal "${serverAddress}:${ServerPath}/pc/setup/$setupZipRemote"
if ($LASTEXITCODE -ne 0) {
    throw "复制安装版失败"
}
# 更新服务器上文件的修改时间为当前时间，确保上传脚本能正确识别最新文件
ssh "${serverAddress}" "touch '${ServerPath}/pc/setup/$setupZipRemote'"
# 等待文件系统同步，确保文件已完全写入
Start-Sleep -Seconds 2

# 复制 Android APK
Write-Host "复制 Android APK 到服务器..." -ForegroundColor Cyan
scp $apkFileLocal "${serverAddress}:${ServerPath}/android/$apkFileRemote"
if ($LASTEXITCODE -ne 0) {
    throw "复制 Android APK 失败"
}
# 更新服务器上文件的修改时间为当前时间，确保上传脚本能正确识别最新文件
ssh "${serverAddress}" "touch '${ServerPath}/android/$apkFileRemote'"
# 等待文件系统同步，确保所有文件已完全写入
Start-Sleep -Seconds 2

# 步骤6: 调用服务器上的七牛 CDN 上传脚本
Write-Host "`n☁️  步骤6: 七牛 CDN 上传..." -ForegroundColor Yellow
Write-Host "是否上传到七牛 CDN?" -ForegroundColor Cyan
Write-Host "  [Y] 是，上传到七牛 CDN" -ForegroundColor Gray
Write-Host "  [N] 否，跳过上传" -ForegroundColor Gray
$uploadChoice = Read-Host "请选择 (Y/N)"

if ($uploadChoice -eq "Y" -or $uploadChoice -eq "y") {
    Write-Host "`n开始上传到七牛 CDN..." -ForegroundColor Yellow
    
    # 调用独立的七牛上传脚本
    $uploadScriptPath = Join-Path $scriptDir "upload-to-qiniu.ps1"
    
    if (-not (Test-Path $uploadScriptPath)) {
        Write-Host "❌ 错误: 未找到上传脚本: $uploadScriptPath" -ForegroundColor Red
        Write-Host "   请确保 upload-to-qiniu.ps1 文件存在于项目根目录" -ForegroundColor Yellow
        exit 1
    }
    
    # 调用上传脚本，传递参数
    try {
        & $uploadScriptPath -ServerHost $ServerHost -ServerUser $ServerUser -QiniuUploadScript $QiniuUploadScript
    
    if ($LASTEXITCODE -ne 0) {
            Write-Host "⚠️  警告: 七牛 CDN 上传脚本执行失败 (退出代码: $LASTEXITCODE)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "❌ 错误: 调用上传脚本失败: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "   脚本路径: $uploadScriptPath" -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "⏭️  已跳过七牛 CDN 上传" -ForegroundColor Gray
}

# 清理临时文件
Write-Host "`n🧹 清理临时文件..." -ForegroundColor Yellow
Remove-Item $tempDir -Recurse -Force

Write-Host "`n🎉 部署完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "时间戳: $timestamp" -ForegroundColor Cyan
Write-Host "便携版: xtxc$timestamp.zip" -ForegroundColor Cyan
Write-Host "安装版: xtxcsetup$timestamp.zip" -ForegroundColor Cyan
Write-Host "Android: xtxc$timestamp.apk" -ForegroundColor Cyan

