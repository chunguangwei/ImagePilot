# 生成华为应用市场上传密钥脚本
# 使用方法: .\generate-upload-key.ps1

Write-Host "🔐 生成华为应用市场上传密钥..." -ForegroundColor Green
Write-Host ""

# 检测keytool
$keytoolPaths = @(
    "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe",
    "C:\Program Files\Android\Android Studio\jre\bin\keytool.exe",
    "keytool"  # 如果在PATH中
)

$keytool = $null
foreach ($p in $keytoolPaths) {
    if ($p -eq "keytool") {
        try {
            $null = Get-Command keytool -ErrorAction Stop
            $keytool = "keytool"
            break
        } catch {
            continue
        }
    } elseif (Test-Path $p) {
        $keytool = $p
        break
    }
}

if (-not $keytool) {
    Write-Host "❌ keytool未找到" -ForegroundColor Red
    Write-Host "请安装Android Studio或设置JDK到PATH" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "手动查找keytool的方法：" -ForegroundColor Yellow
    Write-Host "1. 查找JDK安装路径（通常在 C:\Program Files\Java\jdk-XX\bin\keytool.exe）" -ForegroundColor Cyan
    Write-Host "2. 或使用Android Studio自带的JDK" -ForegroundColor Cyan
    exit 1
}

Write-Host "✅ 找到keytool: $keytool" -ForegroundColor Green
Write-Host ""

# 读取密码
Write-Host "请输入密钥信息（密码不会显示在屏幕上）：" -ForegroundColor Yellow
$keystorePassword = Read-Host "密钥库密码" -AsSecureString
$keyPasswordInput = Read-Host "密钥密码（可直接回车使用相同密码）" -AsSecureString

# 转换密码
$keystorePasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($keystorePassword))
if ($keyPasswordInput.Length -eq 0) {
    $keyPasswordPlain = $keystorePasswordPlain
} else {
    $keyPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($keyPasswordInput))
}

# 读取别名（默认upload）
$alias = Read-Host "密钥别名（默认: upload）"
if ([string]::IsNullOrWhiteSpace($alias)) {
    $alias = "upload"
}

# 读取有效期（默认10000天）
$validity = Read-Host "有效期（天数，默认: 10000）"
if ([string]::IsNullOrWhiteSpace($validity)) {
    $validity = "10000"
}

Write-Host ""
Write-Host "📦 步骤1: 生成上传密钥文件 (upload-keystore.jks)..." -ForegroundColor Yellow

# 生成密钥
$keytoolCmd = "$keytool -genkeypair -v -storetype PKCS12 -keystore upload-keystore.jks -alias $alias -keyalg RSA -keysize 2048 -validity $validity -storepass `"$keystorePasswordPlain`" -keypass `"$keyPasswordPlain`" -dname `"CN=ImagePilot, OU=Dev, O=ImageClassifier, L=Beijing, S=Beijing, C=CN`""

try {
    if ($keytool -eq "keytool") {
        Invoke-Expression "keytool -genkeypair -v -storetype PKCS12 -keystore upload-keystore.jks -alias $alias -keyalg RSA -keysize 2048 -validity $validity -storepass `"$keystorePasswordPlain`" -keypass `"$keyPasswordPlain`" -dname `"CN=ImagePilot, OU=Dev, O=ImageClassifier, L=Beijing, S=Beijing, C=CN`""
    } else {
        & $keytool -genkeypair -v -storetype PKCS12 -keystore upload-keystore.jks -alias $alias -keyalg RSA -keysize 2048 -validity $validity -storepass $keystorePasswordPlain -keypass $keyPasswordPlain -dname "CN=ImagePilot, OU=Dev, O=ImageClassifier, L=Beijing, S=Beijing, C=CN"
    }
    
    if ($LASTEXITCODE -ne 0) {
        throw "生成密钥失败"
    }
    Write-Host "✅ 密钥文件生成成功" -ForegroundColor Green
} catch {
    Write-Host "❌ 生成密钥失败: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "📄 步骤2: 导出证书文件 (upload_certificate.pem)..." -ForegroundColor Yellow

# 导出证书
try {
    if ($keytool -eq "keytool") {
        Invoke-Expression "keytool -export -rfc -keystore upload-keystore.jks -alias $alias -file upload_certificate.pem -storepass `"$keystorePasswordPlain`""
    } else {
        & $keytool -export -rfc -keystore upload-keystore.jks -alias $alias -file upload_certificate.pem -storepass $keystorePasswordPlain
    }
    
    if ($LASTEXITCODE -ne 0) {
        throw "导出证书失败"
    }
    Write-Host "✅ 证书文件生成成功" -ForegroundColor Green
} catch {
    Write-Host "❌ 导出证书失败: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "✅ 完成！" -ForegroundColor Green
Write-Host ""
Write-Host "📁 生成的文件：" -ForegroundColor Cyan
Write-Host "   - upload-keystore.jks (密钥文件，请妥善保管)" -ForegroundColor White
Write-Host "   - upload_certificate.pem (证书文件，需上传到AGC)" -ForegroundColor White
Write-Host ""
Write-Host "⚠️  重要提示：" -ForegroundColor Yellow
Write-Host "   1. 请妥善保管密钥文件 (upload-keystore.jks) 和密码" -ForegroundColor White
Write-Host "   2. 不要将密钥文件提交到Git仓库" -ForegroundColor White
Write-Host "   3. 建议备份密钥文件到安全位置" -ForegroundColor White
Write-Host ""
Write-Host "📤 下一步操作：" -ForegroundColor Cyan
Write-Host "   1. 登录 AppGallery Connect: https://developer.huawei.com/consumer/cn/service/josp/agc/index.html" -ForegroundColor White
Write-Host "   2. 进入应用详情 → 版本信息 → 签名密钥管理" -ForegroundColor White
Write-Host "   3. 上传 upload_certificate.pem 文件" -ForegroundColor White
Write-Host "   4. 使用 upload-keystore.jks 签名APK后上传" -ForegroundColor White
Write-Host ""

