# 自动签名Release APK脚本（已废弃：发版签名现走 CI GitHub Secrets，见 main-build/android-build workflow）
# 仅本地手动签名时用。密码不再硬编码——通过参数传入，例如：
#   .\sign-release-apk.ps1 -StorePass <pw> -KeyPass <pw>
param(
    [string]$KeystorePath = "android-release-key.keystore",
    [string]$Alias = "imageclassifier",
    [string]$StorePass = "",
    [string]$KeyPass = ""
)

Write-Host "🔐 开始自动签名Release APK..." -ForegroundColor Green

# 检查APK文件：优先 app-release-unsigned.apk，其次 app-release.apk（Gradle 可能已签名）
$releaseDir = "app\build\outputs\apk\release"
$signedApk = "$releaseDir\app-release-signed.apk"

$unsignedApk = $null
foreach ($name in @("app-release-unsigned.apk", "app-release.apk")) {
    $path = Join-Path $releaseDir $name
    if (Test-Path $path) {
        $unsignedApk = $path
        break
    }
}

if (-not $unsignedApk) {
    $anyApk = Get-ChildItem -Path $releaseDir -Filter "*.apk" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($anyApk) {
        $unsignedApk = $anyApk.FullName
        Write-Host "📄 使用找到的 APK: $unsignedApk" -ForegroundColor Cyan
    }
}

if (-not $unsignedApk) {
    Write-Host "❌ 未找到 APK 文件，请先运行: .\gradlew assembleRelease" -ForegroundColor Red
    Write-Host "   查找目录: $releaseDir" -ForegroundColor Yellow
    exit 1
}

# 若已是 app-release-signed.apk 则跳过
if ((Split-Path $unsignedApk -Leaf) -eq "app-release-signed.apk") {
    Write-Host "✅ APK 已签名: $unsignedApk" -ForegroundColor Green
    exit 0
}

# 若源文件是 app-release.apk（Gradle 已签名），直接复制为 signed
if ($unsignedApk -like "*app-release.apk" -and $unsignedApk -notlike "*unsigned*") {
    Write-Host "📄 Gradle 已签名，复制为: $signedApk" -ForegroundColor Cyan
    Copy-Item -Path $unsignedApk -Destination $signedApk -Force
    Write-Host "✅ 完成: $signedApk" -ForegroundColor Green
    exit 0
}

# 自动检测Android SDK路径
$sdk = $env:ANDROID_HOME
if (-not $sdk) {
    $sdk = "$env:LOCALAPPDATA\Android\Sdk"
}

if (-not (Test-Path $sdk)) {
    Write-Host "❌ Android SDK未找到" -ForegroundColor Red
    Write-Host "请设置ANDROID_HOME环境变量或安装Android SDK" -ForegroundColor Yellow
    exit 1
}

# 检测build-tools
$btDir = Join-Path $sdk "build-tools"
if (-not (Test-Path $btDir)) {
    Write-Host "❌ build-tools文件夹未找到" -ForegroundColor Red
    exit 1
}

$bt = Get-ChildItem -Path $btDir -Directory | Sort-Object Name -Descending | Select-Object -First 1
if (-not $bt) {
    Write-Host "❌ 未找到build-tools版本" -ForegroundColor Red
    exit 1
}

$apksigner = Join-Path $bt.FullName "apksigner.bat"
if (-not (Test-Path $apksigner)) {
    Write-Host "❌ apksigner未找到" -ForegroundColor Red
    exit 1
}

# 检测keytool
$keytoolPaths = @(
    "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe",
    "C:\Program Files\Android\Android Studio\jre\bin\keytool.exe"
)

$keytool = $null
foreach ($p in $keytoolPaths) {
    if (Test-Path $p) {
        $keytool = $p
        break
    }
}

if (-not $keytool) {
    Write-Host "❌ keytool未找到" -ForegroundColor Red
    Write-Host "请安装Android Studio或设置JDK到PATH" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ 找到工具:" -ForegroundColor Green
Write-Host "   - apksigner: $apksigner" -ForegroundColor Cyan
Write-Host "   - keytool: $keytool" -ForegroundColor Cyan

# 检查或创建keystore
if (-not (Test-Path $KeystorePath)) {
    Write-Host "🔑 创建新的keystore..." -ForegroundColor Yellow
    & $keytool -genkey -v -keystore $KeystorePath -alias $Alias -storepass $StorePass -keypass $KeyPass -dname "CN=芯图相册, OU=Dev, O=ImageClassifier, L=Beijing, S=Beijing, C=CN" -keyalg RSA -keysize 2048 -validity 10000
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ 创建keystore失败" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Keystore创建成功" -ForegroundColor Green
} else {
    Write-Host "✅ 使用现有keystore: $KeystorePath" -ForegroundColor Green
}

# 签名APK
Write-Host "🔐 开始签名APK..." -ForegroundColor Yellow
& $apksigner sign --ks $KeystorePath --ks-key-alias $Alias --ks-pass pass:$StorePass --key-pass pass:$KeyPass --out $signedApk $unsignedApk

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ APK签名成功!" -ForegroundColor Green
    Write-Host "📱 签名后的APK: $signedApk" -ForegroundColor Cyan
    
    # 显示文件信息
    $fileInfo = Get-Item $signedApk
    Write-Host "📊 文件大小: $([math]::Round($fileInfo.Length / 1MB, 2)) MB" -ForegroundColor Cyan
    Write-Host "📅 创建时间: $($fileInfo.CreationTime)" -ForegroundColor Cyan
    
    Write-Host "`n🎉 签名完成! 可以安装到手机了" -ForegroundColor Green
} else {
    Write-Host "❌ APK签名失败" -ForegroundColor Red
    exit 1
}
