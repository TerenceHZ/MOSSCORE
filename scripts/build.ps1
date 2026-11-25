#!/usr/bin/env pwsh
# ============================================================
# MOSS CORE 一键打包
# 用法：打包.bat           → dev 版（测试版，DEV 图标）
#       打包.bat release   → 正式版（SETUP 图标）
# ============================================================

$ErrorActionPreference = 'Continue'
$ROOT = 'D:\数据库'
$INSTALL = 'C:\Users\ROG\MOSS CORE'
$PAYLOAD = "$ROOT\installer\payload"
$DIST = "$ROOT\installer\dist"
$ISCC = 'C:\Users\ROG\AppData\Local\Programs\Inno Setup 6\ISCC.exe'
$DOTNET = 'C:\Program Files\dotnet\dotnet.exe'
$PEM = 'C:\Users\ROG\Downloads\moss_core.pem'
$SERVER = 'ubuntu@43.160.232.254'
$VER = '1.0.55'

$Channel = 'dev'
if ($args.Count -gt 0 -and $args[0] -eq 'release') { $Channel = 'release' }

$t0 = Get-Date
function P($m, $c = 'White') { Write-Host $m -ForegroundColor $c }

P "" Cyan
P "================================" Cyan
P " MOSS CORE 打包 v$VER  [$Channel]" Cyan
P "================================" Cyan
P "" Cyan

# ---- 1. 同步 index.html ----
P "[1/7] 同步界面" Gray
Copy-Item "$ROOT\desktop-webview\index.html" "$ROOT\vendor\agent-neural\index.html" -Force
Copy-Item "$ROOT\desktop-webview\index.html" "$ROOT\mac-electron\index.html" -Force
P "      OK" Green

# ---- 2. 图标选择 ----
P "[2/7] 图标" Gray
$iconExeSrc   = "$ROOT\desktop-webview\icon.ico"
$iconBackup   = "$ROOT\desktop-webview\icon-base.ico"
$iconDev      = "$ROOT\installer\icon-dev.ico"
$iconSetup    = "$ROOT\installer\icon-setup.ico"

# 备份原始图标（仅一次）
if (-not (Test-Path $iconBackup)) {
    $gitIcon = & cmd /c "`"C:\Program Files\Git\cmd\git.exe`" -C `"$ROOT`" show HEAD:desktop-webview/icon.ico 2>nul"
    if (Test-Path $iconExeSrc) {
        $isDev = $false
        try {
            $b = [System.IO.File]::ReadAllBytes($iconExeSrc)
            # DEV 图标特征：PNG 帧（首字节 0x89）
            if ($b.Length -lt 200000) { $isDev = $true }
        } catch {}
        if (-not $isDev) {
            Copy-Item $iconExeSrc $iconBackup -Force
            P "      已备份原始图标" DarkGray
        }
    }
}

# exe 图标：dev → DEV 图标；release → 原始图标
if ($Channel -eq 'dev' -and (Test-Path $iconDev)) {
    Copy-Item $iconDev $iconExeSrc -Force
    $exeIconDesc = 'DEV'
} elseif (Test-Path $iconBackup) {
    Copy-Item $iconBackup $iconExeSrc -Force
    $exeIconDesc = '原始'
} else {
    $exeIconDesc = '当前'
}

# 安装程序图标：release → SETUP；dev → DEV
if ($Channel -eq 'release' -and (Test-Path $iconSetup)) {
    $setupIcon = $iconSetup
    $setupIconDesc = 'SETUP'
} elseif (Test-Path $iconDev) {
    $setupIcon = $iconDev
    $setupIconDesc = 'DEV'
} else {
    $setupIcon = $iconExeSrc
    $setupIconDesc = '原始'
}
P "      exe=$exeIconDesc  安装程序=$setupIconDesc" Green

# ---- 3. 编译 exe ----
P "[3/7] 编译 exe" Gray
$exe = "$ROOT\release\publish\MOSS CORE.exe"
$marker = "$ROOT\release\publish\.channel"
$needBuild = $true
if ((Test-Path $exe) -and (Test-Path $marker)) {
    $prev = (Get-Content $marker -Raw).Trim()
    if ($prev -ne $Channel) {
        P "      通道变化（$prev -> $Channel），重编" Yellow
    } else {
        $csNewest = (Get-ChildItem "$ROOT\desktop-webview\*.cs" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
        $iconNewest = (Get-Item $iconExeSrc).LastWriteTime
        $newest = if ($csNewest -gt $iconNewest) { $csNewest } else { $iconNewest }
        if ((Get-Item $exe).LastWriteTime -gt $newest) {
            $needBuild = $false
            P "      跳过（无变化）" Yellow
        }
    }
}
if ($needBuild) {
    $chArg = if ($Channel -eq 'release') { '-p:Channel=release' } else { '-p:Channel=dev' }
    & $DOTNET publish "$ROOT\desktop-webview\MossCore.csproj" -c Release -r win-x64 --self-contained true -o "$ROOT\release\publish" --nologo -v q $chArg 2>&1 | Out-Null
    if (-not (Test-Path $exe)) { P "      编译失败！" Red; Read-Host "按回车退出"; exit 1 }
    Set-Content $marker $Channel -Encoding UTF8
    P "      OK  ($Channel)" Green
}

# ---- 4. 准备 payload ----
P "[4/7] 准备文件" Gray
if (Test-Path $PAYLOAD) { Get-ChildItem $PAYLOAD | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Path $PAYLOAD -Force | Out-Null
Copy-Item $exe $PAYLOAD -Force
Copy-Item "$ROOT\desktop-webview\index.html" "$PAYLOAD\index.html" -Force
Copy-Item $iconExeSrc "$PAYLOAD\icon.ico" -Force
foreach ($f in @('watchlist.json', 'live-seed.json', 'data-source.json', 'window-default.txt', 'README.txt', 'LICENSE')) {
    if (Test-Path "$INSTALL\$f") { Copy-Item "$INSTALL\$f" "$PAYLOAD\$f" -Force }
}
Set-Content "$PAYLOAD\VERSION.txt" "$VER / $(Get-Date -Format 'yyyyMMdd')" -Encoding UTF8
P "      OK" Green

# ---- 5. 编译安装程序 ----
P "[5/7] 编译安装程序" Gray
# .iss 用 {#SourceDir}\icon.ico 作为安装器图标
# 但 exe 也需要 icon.ico，两者冲突
# 方案：先用 setup 图标编译安装器，再恢复 exe 图标
$payloadIcon = "$PAYLOAD\icon.ico"
Copy-Item $payloadIcon "$PAYLOAD\icon-exe-tmp.ico" -Force
Copy-Item $setupIcon $payloadIcon -Force

Get-ChildItem $DIST -Filter '*.exe' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Push-Location "$ROOT\installer"
$isccOut = & $ISCC "$ROOT\installer\moss-setup.iss" 2>&1
Pop-Location

# 恢复 exe 图标
Copy-Item "$PAYLOAD\icon-exe-tmp.ico" $payloadIcon -Force
Remove-Item "$PAYLOAD\icon-exe-tmp.ico" -Force -ErrorAction SilentlyContinue

$setup = "$DIST\MOSS-CORE-Setup-v$VER.exe"
if (-not (Test-Path $setup)) {
    P "      编译失败！" Red
    $isccOut | Select-Object -Last 15 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkYellow }
    Read-Host "按回车退出"; exit 1
}
$mb = [math]::Round((Get-Item $setup).Length / 1MB, 1)
P "      OK  $mb MB  (图标=$setupIconDesc)" Green

# ---- 6. 装到本机 + 快捷方式 ----
P "[6/7] 安装到本机" Gray
Get-Process -Name 'MOSS CORE' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name 'msedgewebview2' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Get-ChildItem $PAYLOAD -File | ForEach-Object { Copy-Item $_.FullName "$INSTALL\$($_.Name)" -Force }
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'MOSS CORE.lnk'
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = "$INSTALL\MOSS CORE.exe"
$sc.WorkingDirectory = $INSTALL
$sc.IconLocation = "$INSTALL\icon.ico,0"
$sc.Save()
P "      OK" Green

# ---- 7. 桌面 + 服务器 ----
P "[7/7] 导出安装包" Gray
$deskName = if ($Channel -eq 'release') { "MOSS-CORE-Setup-v$VER-正式.exe" } else { "MOSS-CORE-Setup-v$VER-dev.exe" }
Copy-Item $setup (Join-Path ([Environment]::GetFolderPath('Desktop')) $deskName) -Force
scp -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30 -i $PEM $setup "$SERVER`:/tmp/s.exe" 2>$null
$r = ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30 -i $PEM $SERVER "sudo mv /tmp/s.exe /var/www/moss-site/downloads/$deskName; sudo chown caddy:caddy /var/www/moss-site/downloads/*.exe; echo OK" 2>&1
if ($r -match 'OK') { P "      OK 已上传" Green } else { P "      上传失败" Yellow }

Start-Process -FilePath $lnk
$sec = [math]::Round(((Get-Date) - $t0).TotalSeconds, 0)

P "" Green
P "================================" Green
P " 完成  用时 $sec 秒  [$Channel]" Green
P "================================" Green
P " 图标：exe=$exeIconDesc  安装包=$setupIconDesc" White
P " 文件：桌面\$deskName" White
P "" White
Read-Host "按回车关闭"
