# Fix APPX icons using MakeAppx.exe (preserves structure, can re-sign)
# Usage: .\fix-appx-icons-proper.ps1 [path-to-appx]

param(
    [string]$AppxPath = ""
)

$ErrorActionPreference = "Stop"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Fix APPX icons with MakeAppx.exe" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

if ([string]::IsNullOrEmpty($AppxPath)) {
    $appxFiles = Get-ChildItem -Path "$PSScriptRoot\dist" -Filter "*.appx" -ErrorAction SilentlyContinue |
                 Sort-Object LastWriteTime -Descending

    $fileList = @($appxFiles)
    if ($fileList.Count -gt 0) {
        $AppxPath = $fileList[0].FullName
        Write-Host "Found APPX: $AppxPath" -ForegroundColor Green
    } else {
        Write-Host "Error: No APPX file found." -ForegroundColor Red
        exit 1
    }
}

if (-not (Test-Path $AppxPath)) {
    Write-Host "Error: APPX file does not exist: $AppxPath" -ForegroundColor Red
    exit 1
}

$makeAppxPaths = @(
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.26100.0\x64\makeappx.exe",
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.22621.0\x64\makeappx.exe",
    "${env:ProgramFiles}\Windows Kits\10\bin\10.0.26100.0\x64\makeappx.exe"
)

$makeAppx = $null
foreach ($path in $makeAppxPaths) {
    if (Test-Path $path) {
        $makeAppx = $path
        break
    }
}

if (-not $makeAppx) {
    Write-Host "Error: MakeAppx.exe not found. Install Windows SDK." -ForegroundColor Red
    exit 1
}

Write-Host "MakeAppx.exe: $makeAppx" -ForegroundColor Green

$backupPath = $AppxPath + ".backup"
if (-not (Test-Path $backupPath)) {
    Copy-Item $AppxPath $backupPath -Force
    Write-Host "Backup: $backupPath" -ForegroundColor Gray
}

$tempDir = Join-Path $env:TEMP "fix-appx-proper-$(Get-Date -Format 'yyyyMMddHHmmss')"
$unpackDir = Join-Path $tempDir "unpack"
$repackDir = Join-Path $tempDir "repack"

New-Item -ItemType Directory -Path $unpackDir -Force | Out-Null
New-Item -ItemType Directory -Path $repackDir -Force | Out-Null

try {
    Write-Host "`n[1/5] Unpacking APPX..." -ForegroundColor Yellow
    & $makeAppx unpack /l /p $AppxPath /d $unpackDir
    if ($LASTEXITCODE -ne 0) {
        throw "Unpack failed, exit code: $LASTEXITCODE"
    }
    Write-Host "  [OK] Unpack done" -ForegroundColor Green

    Write-Host "`n[2/5] Copying icons to Assets..." -ForegroundColor Yellow
    $assetsDir = Join-Path $unpackDir "Assets"
    if (-not (Test-Path $assetsDir)) {
        New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null
    }

    $imagesDir = Join-Path $PSScriptRoot "images"
    if (Test-Path $imagesDir) {
        $requiredIcons = @(
            @{ Name = "StoreLogo.png"; ExpectedSize = "50x50" },
            @{ Name = "Square44x44Logo.png"; ExpectedSize = "44x44" },
            @{ Name = "Square150x150Logo.png"; ExpectedSize = "150x150" },
            @{ Name = "Wide310x150Logo.png"; ExpectedSize = "310x150" },
            @{ Name = "Square310x310Logo.png"; ExpectedSize = "310x310" }
        )

        Add-Type -AssemblyName System.Drawing

        foreach ($iconInfo in $requiredIcons) {
            $iconName = $iconInfo.Name
            $sourcePath = Join-Path $imagesDir $iconName

            if (Test-Path $sourcePath) {
                try {
                    $img = [System.Drawing.Image]::FromFile($sourcePath)
                    $actualSize = "$($img.Width)x$($img.Height)"
                    $img.Dispose()

                    if ($actualSize -eq $iconInfo.ExpectedSize) {
                        $destPath = Join-Path $assetsDir $iconName
                        Copy-Item $sourcePath $destPath -Force
                        Write-Host "  [OK] $iconName ($actualSize)" -ForegroundColor Green
                    } else {
                        Write-Host "  [!] $iconName wrong size: $actualSize (expected: $($iconInfo.ExpectedSize))" -ForegroundColor Yellow
                        $destPath = Join-Path $assetsDir $iconName
                        Copy-Item $sourcePath $destPath -Force
                    }
                } catch {
                    Write-Host "  [X] $iconName read error: $($_.Exception.Message)" -ForegroundColor Red
                }
            } else {
                Write-Host "  [X] $iconName missing" -ForegroundColor Red
            }
        }
        Write-Host "  [OK] Icons copied" -ForegroundColor Green
    } else {
        Write-Host "  [!] images folder not found, skip icon copy" -ForegroundColor Yellow
    }

    Write-Host "`n[3/5] Fixing AppxManifest.xml..." -ForegroundColor Yellow
    $manifestPath = Join-Path $unpackDir "AppxManifest.xml"
    if (Test-Path $manifestPath) {
        $manifestContent = Get-Content $manifestPath -Raw

        $originalContent = $manifestContent
        $manifestContent = $manifestContent -replace 'assets\\', 'Assets\'
        $manifestContent = $manifestContent -replace 'assets/', 'Assets/'

        if ($manifestContent -ne $originalContent) {
            Write-Host "  [OK] Fixed path case (assets -> Assets)" -ForegroundColor Green
        }

        Write-Host "  Checking icon references..." -ForegroundColor Gray

        if ($manifestContent -notmatch 'Logo="Assets\\StoreLogo\.png"') {
            $manifestContent = $manifestContent -replace 'Logo="[^"]*StoreLogo[^"]*"', 'Logo="Assets\StoreLogo.png"'
            if ($manifestContent -match 'Logo="Assets\\StoreLogo\.png"') {
                Write-Host "    [OK] StoreLogo fixed" -ForegroundColor Green
            }
        }

        if ($manifestContent -notmatch 'Square44x44Logo="Assets\\Square44x44Logo\.png"') {
            $manifestContent = $manifestContent -replace 'Square44x44Logo="[^"]*"', 'Square44x44Logo="Assets\Square44x44Logo.png"'
            Write-Host "    [OK] Square44x44Logo fixed" -ForegroundColor Green
        }

        if ($manifestContent -notmatch 'Square150x150Logo="Assets\\Square150x150Logo\.png"') {
            $manifestContent = $manifestContent -replace 'Square150x150Logo="[^"]*"', 'Square150x150Logo="Assets\Square150x150Logo.png"'
            Write-Host "    [OK] Square150x150Logo fixed" -ForegroundColor Green
        }

        $defaultTilePattern = "<uap:DefaultTile[^>]*>"
        if ($manifestContent -match $defaultTilePattern) {
            $defaultTileMatch = [regex]::Match($manifestContent, $defaultTilePattern)
            $newTileAttrs = @()
            $newTileAttrs += 'Wide310x150Logo="Assets\Wide310x150Logo.png"'
            $newTileAttrs += 'Square310x310Logo="Assets\Square310x310Logo.png"'
            $newTileTag = "<uap:DefaultTile " + ($newTileAttrs -join " ") + ">"
            $manifestContent = $manifestContent -replace $defaultTilePattern, $newTileTag
            Write-Host "    [OK] DefaultTile updated" -ForegroundColor Green
        }

        $locationRemoved = $false
        $locationPatterns = @(
            '<Capability[^>]*Name="location"[^>]*/?>',
            '<uap:Capability[^>]*Name="location"[^>]*/?>',
            '<Capability[^>]*Name="location"[^>]*>[\s\S]*?</Capability>',
            '<uap:Capability[^>]*Name="location"[^>]*>[\s\S]*?</uap:Capability>'
        )

        foreach ($pattern in $locationPatterns) {
            if ($manifestContent -match $pattern) {
                $manifestContent = $manifestContent -replace $pattern, ''
                $locationRemoved = $true
            }
        }

        if ($locationRemoved) {
            Write-Host "    [OK] Location capability removed" -ForegroundColor Green
        } else {
            Write-Host "    [OK] No location capability (OK)" -ForegroundColor Gray
        }

        $manifestContent | Set-Content $manifestPath -Encoding UTF8 -NoNewline
        Write-Host "  [OK] AppxManifest.xml updated" -ForegroundColor Green

    } else {
        Write-Host "  [X] AppxManifest.xml not found" -ForegroundColor Red
        exit 1
    }

    Write-Host "`n[4/5] Repacking with MakeAppx.exe..." -ForegroundColor Yellow
    $newAppxPath = Join-Path $repackDir "ImagePilot-1.0.0.appx"
    $output = & $makeAppx pack /l /d $unpackDir /p $newAppxPath /o 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [X] Repack failed, exit code: $LASTEXITCODE" -ForegroundColor Red
        Write-Host "  Output:" -ForegroundColor Yellow
        $output | Select-Object -Last 20 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
        try {
            [xml]$testXml = Get-Content $manifestPath
            Write-Host "    [OK] XML valid" -ForegroundColor Green
        } catch {
            Write-Host "    [X] XML error: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "    DefaultTile:" -ForegroundColor Yellow
            $defaultTileRegex = "<uap:DefaultTile[^>]*>"
            if ($manifestContent -match $defaultTileRegex) {
                $defaultTileVal = [regex]::Match($manifestContent, $defaultTileRegex).Value
                Write-Host "    $defaultTileVal" -ForegroundColor Gray
            }
        }
        throw "Repack failed, exit code: $LASTEXITCODE"
    }
    Write-Host "  [OK] Repack done" -ForegroundColor Green

    Write-Host "`n[5/5] Replacing original file..." -ForegroundColor Yellow
    Copy-Item $newAppxPath $AppxPath -Force
    Write-Host "  [OK] File replaced" -ForegroundColor Green

    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "[OK] Fix complete" -ForegroundColor Green
    Write-Host "========================================`n" -ForegroundColor Green

    Write-Host "Summary:" -ForegroundColor Cyan
    Write-Host "  1. [OK] Path case assets -> Assets" -ForegroundColor Green
    Write-Host "  2. [OK] Location capability removed" -ForegroundColor Green
    Write-Host "  3. [OK] Icons copied to Assets" -ForegroundColor Green
    Write-Host "  4. [OK] Repacked with MakeAppx.exe" -ForegroundColor Green
    Write-Host "`nRe-sign: .\sign-appx-with-test-cert.ps1" -ForegroundColor Cyan
    Write-Host "Backup: $backupPath" -ForegroundColor Gray

} catch {
    Write-Host "`nError: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Restoring backup..." -ForegroundColor Yellow
    if (Test-Path $backupPath) {
        Copy-Item $backupPath $AppxPath -Force
        Write-Host "  [OK] Backup restored" -ForegroundColor Green
    }
    exit 1
} finally {
    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
