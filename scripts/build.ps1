#!/usr/bin/env pwsh
# ============================================================
# MOSS CORE 一键打包（快速版）
# 双击 打包.bat 即可，全程无交互
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

$t0 = Get-Date
function P($m, $c = 'White') { Write-Host $m -ForegroundColor $c }

P "`n================================" Cyan
P " MOSS CORE 打包 v$VER" Cyan
P "================================`n" Cyan

# ---- 1. 同步 index.html ----
P "[1/6] 同步界面" Gray
Copy-Item "$ROOT\desktop-webview\index.html" "$ROOT\vendor\agent-neural\index.html" -Force
Copy-Item "$ROOT\desktop-webview\index.html" "$ROOT\mac-electron\index.html" -Force
P "      OK" Green

# ---- 2. 编译 exe ----
P "[2/6] 编译 exe（约 40 秒）" Gray
$exe = "$ROOT\release\publish\MOSS CORE.exe"
$needBuild = $true
if (Test-Path $exe) {
    $csNewest = (Get-ChildItem "$ROOT\desktop-webview\*.cs" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
    if ((Get-Item $exe).LastWriteTime -gt $csNewest) {
        $needBuild = $false
        P "      跳过（C# 没变化）" Yellow
    }
}
if ($needBuild) {
    & $DOTNET publish "$ROOT\desktop-webview\MossCore.csproj" -c Release -r win-x64 --self-contained true -o "$ROOT\release\publish" --nologo -v q 2>&1 | Out-Null
    if (-not (Test-Path $exe)) { P "      编译失败！" Red; Read-Host "按回车退出"; exit 1 }
    P "      OK" Green
}

# ---- 3. 准备 payload ----
P "[3/6] 准备文件" Gray
if (Test-Path $PAYLOAD) { Get-ChildItem $PAYLOAD | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Path $PAYLOAD -Force | Out-Null
Copy-Item $exe $PAYLOAD -Force
Copy-Item "$ROOT\desktop-webview\index.html" "$PAYLOAD\index.html" -Force
foreach ($f in @('icon.ico','watchlist.json','live-seed.json','data-source.json','window-default.txt','README.txt','LICENSE')) {
    if (Test-Path "$INSTALL\$f") { Copy-Item "$INSTALL\$f" "$PAYLOAD\$f" -Force }
}
Set-Content "$PAYLOAD\VERSION.txt" "$VER / $(Get-Date -Format 'yyyyMMdd')" -Encoding UTF8
P "      OK" Green

# ---- 4. 编译安装程序 ----
P "[4/6] 编译安装程序（约 8 秒）" Gray
Get-ChildItem $DIST -Filter '*.exe' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Push-Location "$ROOT\installer"
& $ISCC "$ROOT\installer\moss-setup.iss" 2>&1 | Out-Null
Pop-Location
$setup = "$DIST\MOSS-CORE-Setup-v$VER.exe"
if (-not (Test-Path $setup)) { P "      编译失败！" Red; Read-Host "按回车退出"; exit 1 }
$mb = [math]::Round((Get-Item $setup).Length / 1MB, 1)
P "      OK  $mb MB" Green

# ---- 5. 装到本机 + 快捷方式 ----
P "[5/6] 安装到本机" Gray
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

# ---- 6. 兜底：桌面 + 服务器 ----
P "[6/6] 复制到桌面并上传" Gray
Copy-Item $setup (Join-Path ([Environment]::GetFolderPath('Desktop')) "MOSS-CORE-Setup-v$VER.exe") -Force
scp -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30 -i $PEM $setup "$SERVER`:/tmp/s.exe" 2>$null
$r = ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30 -i $PEM $SERVER "sudo mv /tmp/s.exe /var/www/moss-site/downloads/MOSS-CORE-Setup-v$VER.exe; sudo chown caddy:caddy /var/www/moss-site/downloads/*.exe; echo OK" 2>&1
if ($r -match 'OK') { P "      OK 已上传" Green } else { P "      上传失败（可稍后手动）" Yellow }

# ---- 启动 ----
Start-Process -FilePath $lnk
$elapsed = [math]::Round(((Get-Date) - $t0).TotalSeconds, 0)

P "`n================================" Green
P " 完成  用时 $elapsed 秒" Green
P "================================" Green
P " 安装包：桌面\MOSS-CORE-Setup-v$VER.exe" White
P " 本机：已安装并启动" White
P ""
Read-Host "按回车关闭"
