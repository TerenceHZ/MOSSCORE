#!/usr/bin/env pwsh
# ============================================================
# MOSS CORE 打包脚本（Windows EXE 安装程序）
# 用法：双击 打包.bat，或 powershell -ExecutionPolicy Bypass -File package-win.ps1
# ============================================================

$ErrorActionPreference = 'Stop'
$ROOT = 'D:\数据库'
$INSTALL_DIR = 'C:\Users\ROG\MOSS CORE'
$DESKTOP = [Environment]::GetFolderPath('Desktop')
$PAYLOAD = Join-Path $ROOT 'installer\payload'
$DIST = Join-Path $ROOT 'installer\dist'
$ISCC = 'C:\Users\ROG\AppData\Local\Programs\Inno Setup 6\ISCC.exe'
$DOTNET = 'C:\Program Files\dotnet\dotnet.exe'
$GIT = 'C:\Program Files\Git\cmd\git.exe'
$PEM = 'C:\Users\ROG\Downloads\moss_core.pem'
$SERVER = 'ubuntu@43.160.232.254'
$VERSION = '1.0.55'

function Step($n, $m) { Write-Host "`n[$n] $m" -ForegroundColor Cyan }
function OK($m) { Write-Host "    OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "    !!  $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "    XX  $m" -ForegroundColor Red }

try {
    # ---------- 1. 同步源码 ----------
    Step 1 '同步 index.html 到三处'
    $src = Join-Path $ROOT 'desktop-webview\index.html'
    foreach ($t in @(
        (Join-Path $ROOT 'vendor\agent-neural\index.html'),
        (Join-Path $ROOT 'mac-electron\index.html')
    )) {
        Copy-Item $src $t -Force
    }
    OK 'index.html 已同步'

    # ---------- 2. 架构检查 ----------
    Step 2 '架构合规检查'
    $py = 'C:\Users\ROG\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
    $check = Join-Path $ROOT 'scripts\check_architecture.py'
    if ((Test-Path $py) -and (Test-Path $check)) {
        $env:PYTHONIOENCODING = 'utf-8'
        $out = & $py $check 2>&1
        $last = ($out | Select-Object -Last 1)
        if ($last -match 'all.*checks passed') { OK $last }
        else {
            Fail "架构检查失败：$last"
            $out | Select-Object -Last 10 | ForEach-Object { Write-Host "      $_" }
            throw '架构检查未通过，中止打包'
        }
    }

    # ---------- 3. 编译 exe ----------
    Step 3 '编译 MOSS CORE.exe'
    $pub = Join-Path $ROOT 'release\publish'
    Remove-Item "$pub\*" -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $pub -Force | Out-Null
    $proc = Start-Process -FilePath $DOTNET -ArgumentList @(
        'publish', (Join-Path $ROOT 'desktop-webview\MossCore.csproj'),
        '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
        '-o', $pub, '--nologo', '-v', 'q'
    ) -PassThru -NoNewWindow -Wait
    $exe = Join-Path $pub 'MOSS CORE.exe'
    if ($proc.ExitCode -ne 0 -or -not (Test-Path $exe)) { throw 'dotnet publish 失败' }
    OK "编译成功：$([math]::Round((Get-Item $exe).Length/1MB,1)) MB"

    # ---------- 4. 准备 payload ----------
    Step 4 '准备安装包内容'
    if (Test-Path $PAYLOAD) { Get-ChildItem $PAYLOAD | Remove-Item -Recurse -Force }
    New-Item -ItemType Directory -Path $PAYLOAD -Force | Out-Null
    Copy-Item $exe $PAYLOAD -Force
    Copy-Item $src (Join-Path $PAYLOAD 'index.html') -Force
    foreach ($f in @('icon.ico', 'watchlist.json', 'live-seed.json', 'data-source.json', 'window-default.txt', 'README.txt', 'LICENSE')) {
        $s = Join-Path $INSTALL_DIR $f
        if (Test-Path $s) { Copy-Item $s (Join-Path $PAYLOAD $f) -Force }
    }
    $today = Get-Date -Format 'yyyyMMdd'
    Set-Content (Join-Path $PAYLOAD 'VERSION.txt') "$VERSION / $today" -Encoding UTF8
    OK "payload 就绪（$((Get-ChildItem $PAYLOAD -File).Count) 个文件）"

    # ---------- 5. 编译安装程序 ----------
    Step 5 '编译 Setup.exe'
    if (-not (Test-Path $ISCC)) { throw "找不到 Inno Setup：$ISCC" }
    New-Item -ItemType Directory -Path $DIST -Force | Out-Null
    Get-ChildItem $DIST -Filter '*.exe' | Remove-Item -Force -ErrorAction SilentlyContinue
    Push-Location (Join-Path $ROOT 'installer')
    $cproc = Start-Process -FilePath $ISCC -ArgumentList @((Join-Path $ROOT 'installer\moss-setup.iss')) -PassThru -NoNewWindow -Wait
    Pop-Location
    $setup = Join-Path $DIST "MOSS-CORE-Setup-v$VERSION.exe"
    if (-not (Test-Path $setup)) { throw 'Setup.exe 编译失败' }
    OK "Setup.exe：$([math]::Round((Get-Item $setup).Length/1MB,1)) MB"

    # ---------- 6. 部署到本机 ----------
    Step 6 '部署到本机'
    Get-Process -Name 'MOSS CORE' -ErrorAction SilentlyContinue | Stop-Process -Force
    Get-Process -Name 'msedgewebview2' -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 3
    Get-ChildItem $PAYLOAD -File | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $INSTALL_DIR $_.Name) -Force
    }
    $ver = Get-Content (Join-Path $INSTALL_DIR 'VERSION.txt')
    OK "已部署，VERSION.txt = $ver"

    # ---------- 7. 校正桌面快捷方式 ----------
    Step 7 '校正桌面快捷方式'
    $lnkPath = Join-Path $DESKTOP 'MOSS CORE.lnk'
    $ws = New-Object -ComObject WScript.Shell
    if (Test-Path $lnkPath) {
        $sc = $ws.CreateShortcut($lnkPath)
    } else {
        $sc = $ws.CreateShortcut($lnkPath)
    }
    $exeTarget = Join-Path $INSTALL_DIR 'MOSS CORE.exe'
    $sc.TargetPath = $exeTarget
    $sc.WorkingDirectory = $INSTALL_DIR
    $iconFile = Join-Path $INSTALL_DIR 'icon.ico'
    if (Test-Path $iconFile) { $sc.IconLocation = "$iconFile,0" }
    $sc.Description = 'MOSS CORE 异动监测'
    $sc.Save()
    # 验证
    $verify = $ws.CreateShortcut($lnkPath)
    if ($verify.TargetPath -eq $exeTarget) {
        OK "快捷方式 → $exeTarget"
    } else {
        Fail "快捷方式目标不对：$($verify.TargetPath)"
    }

    # ---------- 8. 启动客户端 ----------
    Step 8 '启动客户端'
    Start-Process -FilePath $lnkPath
    Start-Sleep -Seconds 15
    $p = Get-Process -Name 'MOSS CORE' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($p) { OK "已启动 PID=$($p.Id)" } else { Fail '启动失败' }

    # ---------- 9. 复制到桌面 ----------
    Step 9 '复制 Setup.exe 到桌面'
    $deskSetup = Join-Path $DESKTOP "MOSS-CORE-Setup-v$VERSION.exe"
    Copy-Item $setup $deskSetup -Force
    Get-ChildItem $DESKTOP -Filter 'MOSS CORE 桌面版-*.zip' | Remove-Item -Force -ErrorAction SilentlyContinue
    $hash = (Get-FileHash $deskSetup -Algorithm SHA256).Hash
    @(
        "MOSS CORE 安装程序 v$VERSION",
        "文件：$deskSetup",
        "大小：$([math]::Round((Get-Item $deskSetup).Length/1MB,1)) MB",
        "SHA256：$hash"
    ) | Set-Content (Join-Path $DESKTOP 'MOSS CORE 最新版本.txt') -Encoding UTF8
    OK "已复制：$deskSetup"

    # ---------- 10. 上传服务器 ----------
    Step 10 '上传到服务器'
    scp -o StrictHostKeyChecking=accept-new -o ConnectTimeout=60 -i $PEM $setup "$SERVER`:/tmp/moss-setup-new.exe" 2>$null | Out-Null
    $remote = ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=60 -i $PEM $SERVER "sudo mv /tmp/moss-setup-new.exe /var/www/moss-site/downloads/MOSS-CORE-Setup-v$VERSION.exe; sudo chown caddy:caddy /var/www/moss-site/downloads/*.exe; echo done" 2>&1
    if ($remote -match 'done') { OK '上传完成' } else { Warn "上传异常：$remote" }

    # ---------- 完成 ----------
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host " 打包完成" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  版本:     v$VERSION"
    Write-Host "  安装包:   $deskSetup"
    Write-Host "  本机:     已安装并启动"
    Write-Host "  服务器:   已上传"
    Write-Host ""

} catch {
    Write-Host "`n打包中止：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
