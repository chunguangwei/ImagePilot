# 提取阿里云App备案所需信息脚本
# 使用方法: .\get-aliyun-filing-info.ps1 [-KeystorePath "路径"] [-Alias "别名"]
#
# 参数说明：
#   -KeystorePath: 签名密钥文件路径（默认: android-release-key.keystore）
#   -Alias: 密钥别名（留空则自动检测，通常为 imageclassifier）
#   -Domain: 具体使用的域名（可选，如果不提供会询问）
#   -StorePass: 密钥库密码（可选，如果不提供会询问）

param(
    [string]$KeystorePath = "android-release-key.keystore",
    [string]$Alias = "",  # 留空，脚本会自动检测
    [string]$Domain = "",
    [string]$StorePass = ""  # 可选，如果提供则跳过询问
)

Write-Host "📋 提取阿里云App备案所需信息..." -ForegroundColor Green
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
    exit 1
}

Write-Host "✅ 找到keytool: $keytool" -ForegroundColor Green

# 检查密钥文件是否存在
if (-not (Test-Path $KeystorePath)) {
    Write-Host "❌ 未找到签名密钥文件: $KeystorePath" -ForegroundColor Red
    Write-Host "请使用 -KeystorePath 参数指定正确的keystore文件路径" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ 找到密钥文件: $KeystorePath" -ForegroundColor Green

# 尝试列出所有别名，帮助用户确认
Write-Host ""
Write-Host "💡 提示: 如果不知道密钥别名，脚本会尝试列出所有别名" -ForegroundColor Yellow
Write-Host ""

# 读取密钥库密码
if ([string]::IsNullOrWhiteSpace($StorePass)) {
    Write-Host ""
    $storePassword = Read-Host "请输入密钥库密码" -AsSecureString
    $storePasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($storePassword))
} else {
    Write-Host "✅ 使用提供的密钥库密码" -ForegroundColor Green
    $storePasswordPlain = $StorePass
}

# 尝试列出所有别名
Write-Host ""
Write-Host "🔍 正在查找密钥别名..." -ForegroundColor Yellow
$script:foundAliases = @()

try {
    $aliasListOutput = & $keytool -list -keystore $KeystorePath -storepass $storePasswordPlain 2>&1
    if ($LASTEXITCODE -eq 0) {
        # 尝试多种模式匹配别名
        $aliasPatterns = @(
            "^\s+(\S+),\s+\d{4}",  # 标准格式: "别名, 日期"
            "^\s+(\S+),\s+\d{4}年",  # 中文日期格式: "别名, 2025年"
            "(\S+),\s+\d{4}-\d{2}-\d{2}",  # 带日期格式: "别名, 2025-10-22"
            "(\S+),\s+\d{4}年\d{1,2}月",  # 中文日期: "别名, 2025年10月"
            "别名名称:\s*(\S+)",    # 中文输出: "别名名称: xxx"
            "Alias name:\s*(\S+)"  # 英文输出: "Alias name: xxx"
        )
        
        foreach ($pattern in $aliasPatterns) {
            $matches = $aliasListOutput | Select-String -Pattern $pattern
            if ($matches) {
                foreach ($match in $matches) {
                    $aliasName = $match.Matches[0].Groups[1].Value
                    if ($aliasName -and $script:foundAliases -notcontains $aliasName) {
                        $script:foundAliases += $aliasName
                    }
                }
            }
        }
        
        if ($script:foundAliases.Count -gt 0) {
            Write-Host "✅ 找到以下密钥别名:" -ForegroundColor Green
            foreach ($a in $script:foundAliases) {
                if ($a -eq $Alias) {
                    Write-Host "   ✓ $a (将使用此别名)" -ForegroundColor Green
                } else {
                    Write-Host "   - $a" -ForegroundColor Gray
                }
            }
            # 如果用户没有指定别名，或指定的别名不存在，使用第一个找到的别名
            if ([string]::IsNullOrWhiteSpace($Alias)) {
                $Alias = $script:foundAliases[0]
                Write-Host "✅ 自动选择别名: $Alias" -ForegroundColor Green
            } elseif ($script:foundAliases -notcontains $Alias) {
                $originalAlias = $Alias
                $Alias = $script:foundAliases[0]
                Write-Host "⚠️  指定的别名 '$originalAlias' 不存在，将使用 '$Alias'" -ForegroundColor Yellow
            }
        } else {
            if ([string]::IsNullOrWhiteSpace($Alias)) {
                Write-Host "❌ 无法自动识别别名！" -ForegroundColor Red
                Write-Host "💡 请手动指定别名: .\get-aliyun-filing-info.ps1 -Alias '您的别名'" -ForegroundColor Cyan
                Write-Host "💡 或先运行查看别名: keytool -list -keystore $KeystorePath" -ForegroundColor Cyan
                exit 1
            } else {
                Write-Host "⚠️  无法自动识别别名，将使用指定的别名: $Alias" -ForegroundColor Yellow
            }
        }
    } else {
        if ([string]::IsNullOrWhiteSpace($Alias)) {
            Write-Host "❌ 无法列出别名（可能是密码错误）且未指定别名！" -ForegroundColor Red
            Write-Host "💡 请手动指定别名: .\get-aliyun-filing-info.ps1 -Alias 'imageclassifier'" -ForegroundColor Cyan
            exit 1
        } else {
            Write-Host "⚠️  无法列出别名（可能是密码错误），将使用指定的别名: $Alias" -ForegroundColor Yellow
            Write-Host "💡 如果后续步骤失败，请检查密码是否正确" -ForegroundColor Cyan
        }
    }
} catch {
    if ([string]::IsNullOrWhiteSpace($Alias)) {
        Write-Host "❌ 无法列出别名且未指定别名！" -ForegroundColor Red
        Write-Host "   错误详情: $_" -ForegroundColor Gray
        Write-Host "💡 请手动指定别名: .\get-aliyun-filing-info.ps1 -Alias 'imageclassifier'" -ForegroundColor Cyan
        exit 1
    } else {
        Write-Host "⚠️  无法列出别名，将使用指定的别名: $Alias" -ForegroundColor Yellow
        Write-Host "   错误详情: $_" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "📝 正在提取信息..." -ForegroundColor Yellow

# 1. 获取应用包名（从build.gradle）
$buildGradlePath = "app\build.gradle"
if (Test-Path $buildGradlePath) {
    $buildGradleContent = Get-Content $buildGradlePath -Raw
    if ($buildGradleContent -match 'applicationId\s+"([^"]+)"') {
        $packageName = $matches[1]
        Write-Host "✅ 应用包名: $packageName" -ForegroundColor Green
    } else {
        Write-Host "⚠️  无法从build.gradle读取应用包名，使用默认值" -ForegroundColor Yellow
        $packageName = "com.imageclassifier.v2"
    }
} else {
    Write-Host "⚠️  未找到build.gradle，使用默认包名" -ForegroundColor Yellow
    $packageName = "com.imageclassifier.v2"
}

# 2. 获取证书MD5指纹
Write-Host "🔐 正在提取证书MD5指纹..." -ForegroundColor Yellow
Write-Host "   使用别名: $Alias" -ForegroundColor Gray
try {
    $certInfo = & $keytool -list -v -keystore $KeystorePath -alias $Alias -storepass $storePasswordPlain 2>&1
    $exitCode = $LASTEXITCODE
    
    if ($exitCode -ne 0) {
        Write-Host "❌ keytool命令执行失败，退出码: $exitCode" -ForegroundColor Red
        Write-Host "命令输出:" -ForegroundColor Yellow
        $certInfo | ForEach-Object { Write-Host "   $_" -ForegroundColor Gray }
        Write-Host ""
        Write-Host "💡 可能的原因:" -ForegroundColor Yellow
        Write-Host "   1. 密钥别名不正确（当前使用: $Alias）" -ForegroundColor White
        if ($script:foundAliases -and $script:foundAliases.Count -gt 0) {
            Write-Host "   2. 可用的别名: $($script:foundAliases -join ', ')" -ForegroundColor White
            Write-Host "   3. 请使用正确的别名重新运行: .\get-aliyun-filing-info.ps1 -Alias '别名名称'" -ForegroundColor Cyan
        } else {
            Write-Host "   2. 密钥库密码错误" -ForegroundColor White
            Write-Host "   3. 密钥文件损坏" -ForegroundColor White
            Write-Host "   4. 请先手动列出别名: keytool -list -keystore $KeystorePath" -ForegroundColor Cyan
        }
        throw "无法读取证书信息"
    }
    
    # 检查是否有错误信息
    $errorLines = $certInfo | Select-String -Pattern "错误|Error|Exception|密钥库不存在|keystore was tampered with|password was incorrect" -CaseSensitive:$false
    if ($errorLines) {
        Write-Host "❌ 检测到错误信息:" -ForegroundColor Red
        $errorLines | ForEach-Object { Write-Host "   $_" -ForegroundColor Red }
        throw "证书信息读取失败"
    }
    
    # 提取MD5指纹（尝试多种格式）
    $md5Patterns = @(
        "MD5:\s*([A-F0-9:]+)",           # 标准格式: "MD5: A1:B2:C3..."
        "MD5指纹\s*\(SHA256\):\s*([A-F0-9:]+)",  # 某些版本的格式
        "MD5\s+fingerprint:\s*([A-F0-9:]+)",     # 英文格式
        "MD5\s+指纹:\s*([A-F0-9:]+)"             # 中文格式
    )
    
    $md5Fingerprint = $null
    foreach ($pattern in $md5Patterns) {
        $md5Match = $certInfo | Select-String -Pattern $pattern -CaseSensitive
        if ($md5Match) {
            $md5Value = $md5Match.Matches[0].Groups[1].Value
            $md5Fingerprint = ($md5Value -replace ':', '').ToUpper()
            break
        }
    }
    
    if ($md5Fingerprint) {
        Write-Host "✅ 证书MD5指纹: $md5Fingerprint" -ForegroundColor Green
    } else {
        Write-Host "⚠️  keytool输出中未包含MD5指纹（新版本Java默认不显示MD5）" -ForegroundColor Yellow
        Write-Host "   将在导出公钥时一并计算MD5指纹..." -ForegroundColor Yellow
        # MD5将在后续导出PEM证书时计算
        $md5Fingerprint = $null  # 标记需要稍后计算
    }
    
    # 提取SHA1指纹（备用）
    $sha1Patterns = @(
        "SHA1:\s*([A-F0-9:]+)",
        "SHA1指纹:\s*([A-F0-9:]+)",
        "SHA1\s+fingerprint:\s*([A-F0-9:]+)"
    )
    
    foreach ($pattern in $sha1Patterns) {
        $sha1Match = $certInfo | Select-String -Pattern $pattern -CaseSensitive
        if ($sha1Match) {
            $sha1Value = $sha1Match.Matches[0].Groups[1].Value
            $sha1Fingerprint = ($sha1Value -replace ':', '').ToUpper()
            break
        }
    }
} catch {
    Write-Host "❌ 提取证书信息失败: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "🔧 调试建议:" -ForegroundColor Yellow
    Write-Host "   1. 手动验证别名: keytool -list -keystore $KeystorePath" -ForegroundColor Cyan
    Write-Host "   2. 手动查看证书: keytool -list -v -keystore $KeystorePath -alias $Alias" -ForegroundColor Cyan
    exit 1
}

# 3. 导出并提取公钥
Write-Host "🔑 正在提取公钥..." -ForegroundColor Yellow
try {
    $certTempFile = "temp_cert.pem"
    if ($keytool -eq "keytool") {
        Invoke-Expression "keytool -export -rfc -keystore `"$KeystorePath`" -alias $Alias -file `"$certTempFile`" -storepass `"$storePasswordPlain`" 2>&1 | Out-Null"
    } else {
        & $keytool -export -rfc -keystore $KeystorePath -alias $Alias -file $certTempFile -storepass $storePasswordPlain 2>&1 | Out-Null
    }
    
    if ($LASTEXITCODE -ne 0) {
        throw "无法导出证书，请检查密钥别名是否正确"
    }
    
    if (Test-Path $certTempFile) {
        # 读取证书内容并提取公钥
        $certContent = Get-Content $certTempFile -Raw
        # 移除BEGIN/END标记和换行符，只保留BASE64内容
        $publicKeyBase64 = ($certContent -replace "-----BEGIN CERTIFICATE-----", "" -replace "-----END CERTIFICATE-----", "" -replace "`r`n", "" -replace "`n", "").Trim()
        
        # 阿里云备案通常需要的是证书的BASE64编码字符串（不含BEGIN/END标记）
        $publicKey = $publicKeyBase64
        Write-Host "✅ 公钥已提取" -ForegroundColor Green
        
        # 如果之前没有获取到MD5指纹，现在从PEM证书计算
        if (-not $md5Fingerprint) {
            Write-Host "🔐 从证书文件计算MD5指纹..." -ForegroundColor Yellow
            try {
                # PEM证书是BASE64编码的DER，需要解码后计算MD5
                $certBytes = [System.Convert]::FromBase64String($publicKeyBase64)
                $md5Hash = [System.Security.Cryptography.MD5]::Create().ComputeHash($certBytes)
                $md5Fingerprint = ($md5Hash | ForEach-Object { $_.ToString("X2") }) -join ""
                Write-Host "✅ 证书MD5指纹（通过证书计算）: $md5Fingerprint" -ForegroundColor Green
            } catch {
                Write-Host "⚠️  从PEM证书计算MD5失败: $_" -ForegroundColor Yellow
                Write-Host "   尝试使用DER格式..." -ForegroundColor Gray
                # 备用方案：导出DER格式
                try {
                    $certDerFile = "temp_cert.der"
                    $currentDir = Get-Location
                    $certDerPath = Join-Path $currentDir.Path $certDerFile
                    
                    $keystoreFullPath = (Resolve-Path $KeystorePath -ErrorAction SilentlyContinue).Path
                    if (-not $keystoreFullPath) {
                        $keystoreFullPath = $KeystorePath
                    }
                    
                    if ($keytool -eq "keytool") {
                        Invoke-Expression "keytool -export -keystore `"$keystoreFullPath`" -alias $Alias -file `"$certDerPath`" -storepass `"$storePasswordPlain`" 2>&1" | Out-Null
                    } else {
                        & $keytool -export -keystore $keystoreFullPath -alias $Alias -file $certDerPath -storepass $storePasswordPlain 2>&1 | Out-Null
                    }
                    
                    if (Test-Path $certDerPath) {
                        $certBytes = [System.IO.File]::ReadAllBytes($certDerPath)
                        $md5Hash = [System.Security.Cryptography.MD5]::Create().ComputeHash($certBytes)
                        $md5Fingerprint = ($md5Hash | ForEach-Object { $_.ToString("X2") }) -join ""
                        Write-Host "✅ 证书MD5指纹（通过DER证书计算）: $md5Fingerprint" -ForegroundColor Green
                        Remove-Item $certDerPath -ErrorAction SilentlyContinue
                    }
                } catch {
                    Write-Host "❌ 计算MD5指纹失败" -ForegroundColor Red
                }
            }
        }
        
        # 清理临时文件
        Remove-Item $certTempFile -ErrorAction SilentlyContinue
    } else {
        throw "证书文件未生成"
    }
} catch {
    Write-Host "❌ 提取公钥失败: $_" -ForegroundColor Red
    Write-Host "💡 提示: 请确认密钥别名是否正确，可以使用以下命令查看所有别名:" -ForegroundColor Yellow
    Write-Host "   keytool -list -keystore $KeystorePath" -ForegroundColor Cyan
    if (Test-Path $certTempFile) {
        Remove-Item $certTempFile -ErrorAction SilentlyContinue
    }
    exit 1
}

# 4. 询问域名（如果未提供）
if ([string]::IsNullOrWhiteSpace($Domain)) {
    Write-Host ""
    Write-Host "请输入具体使用的域名（例如: www.example.com）:" -ForegroundColor Yellow
    $Domain = Read-Host "域名"
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "📋 阿里云App备案所需信息" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. 具体使用的域名:" -ForegroundColor Yellow
Write-Host "   $Domain" -ForegroundColor White
Write-Host ""
Write-Host "2. 安卓平台软件包名称:" -ForegroundColor Yellow
Write-Host "   $packageName" -ForegroundColor White
Write-Host ""
Write-Host "3. 公钥:" -ForegroundColor Yellow
Write-Host "   $publicKey" -ForegroundColor White
Write-Host ""
Write-Host "4. 证书MD5指纹:" -ForegroundColor Yellow
Write-Host "   $md5Fingerprint" -ForegroundColor White
Write-Host ""
if ($sha1Fingerprint) {
    Write-Host "   (SHA1指纹: $sha1Fingerprint)" -ForegroundColor Gray
}
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# 保存到文件
$outputFile = "aliyun-filing-info.txt"
$outputContent = @"
阿里云App备案所需信息
生成时间: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

═══════════════════════════════════════════════════════════
1. 具体使用的域名
═══════════════════════════════════════════════════════════
$Domain

═══════════════════════════════════════════════════════════
2. 安卓平台软件包名称
═══════════════════════════════════════════════════════════
$packageName

═══════════════════════════════════════════════════════════
3. 公钥
═══════════════════════════════════════════════════════════
$publicKey

═══════════════════════════════════════════════════════════
4. 证书MD5指纹
═══════════════════════════════════════════════════════════
$md5Fingerprint
"@

$outputContent | Out-File -FilePath $outputFile -Encoding UTF8
Write-Host "✅ 信息已保存到: $outputFile" -ForegroundColor Green
Write-Host ""
Write-Host "💡 提示: 可以直接复制上面的信息填写到阿里云备案页面" -ForegroundColor Cyan
Write-Host ""

