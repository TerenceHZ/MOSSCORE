#!/usr/bin/env pwsh
# ============================================================
# MOSS CORE 一键同步脚本
# 用途：把家里电脑推送的更新，完整同步到本机（源码/编译/部署/验证）
# 用法：powershell -ExecutionPolicy Bypass -File D:\MOSS\scripts\sync-home.ps1
# ============================================================

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ROOT = 'D:\MOSS'
$GIT = 'D:\Apps\Git\cmd\git.exe'
$DOTNET = 'C:\Users\ROG\.dotnet\dotnet.exe'
$INSTALL_DIR = 'C:\Users\ROG\MOSS CORE'
$PEM = 'C:\Users\ROG\.ssh\mosscore_deploy'
$SERVER = 'ubuntu@43.160.232.254'
$PROXY_ARGS = @('-c', 'http.proxy=http://127.0.0.1:7890', '-c', 'https.proxy=http://127.0.0.1:7890')

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function OK($msg) { Write-Host "    OK  $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    !!  $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "    XX  $msg" -ForegroundColor Red }

$report = [ordered]@{
    startedAt    = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    pull         = 'pending'
    changedFiles = @()
    htmlSynced   = 'skip'
    archCheck    = 'skip'
    exeBuilt     = 'skip'
    cloudDeployed = 'skip'
    clientRun    = 'skip'
    errors       = @()
}

try {
    # ---------- 1. 拉取远端 ----------
    Step 1 '拉取 GitHub 最新代码'
    Push-Location $ROOT
    $before = (& $GIT rev-parse HEAD).Trim()
    $env:GIT_TERMINAL_PROMPT = '0'
    $ErrorActionPreference = 'Continue'
    $fetchOut = cmd /c "`"$GIT`" -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 fetch origin main 2>&1"
    $ErrorActionPreference = 'Stop'
    if ($fetchOut -match 'fatal|error:') {
        throw "git fetch 失败：$fetchOut"
    }
    $remote = (& $GIT rev-parse origin/main).Trim()

    if ($before -eq $remote) {
        OK '已是最新，没有新提交'
        $report.pull = 'uptodate'
    }
    else {
        $changed = @(& $GIT diff --name-only $before $remote) | Where-Object { $_ }
        $report.changedFiles = @($changed)
        Write-Host "    变更文件："
        $changed | ForEach-Object { Write-Host "      - $_" }

        # 保存本地未提交改动，避免覆盖丢失
        $dirty = & $GIT status --porcelain | Where-Object { $_ -notmatch '^\?\?' }
        if ($dirty) {
            Warn "本地有未提交改动，先备份"
            $bk = Join-Path $ROOT "backup\presync-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
            New-Item -ItemType Directory -Path $bk -Force | Out-Null
            & $GIT stash push -m "presync-backup" 2>&1 | Out-Null
            $report.errors += "本地改动已 stash，可用 git stash pop 恢复"
        }

        & $GIT reset --hard origin/main 2>$null | Out-Null
        OK "已更新到 $remote"
        $report.pull = 'updated'
    }
    Pop-Location

    # ---------- 2. 同步 index.html ----------
    Step 2 '同步 index.html（以 desktop-webview 为准）'
    $srcIndex = Join-Path $ROOT 'desktop-webview\index.html'
    $targets = @(
        (Join-Path $ROOT 'vendor\agent-neural\index.html'),
        (Join-Path $ROOT 'mac-electron\index.html'),
        (Join-Path $INSTALL_DIR 'index.html')
    )

    if (Test-Path $srcIndex) {
        $srcHash = (Get-FileHash $srcIndex).Hash
        $needCopy = $false
        foreach ($t in $targets) {
            if (-not (Test-Path $t) -or (Get-FileHash $t).Hash -ne $srcHash) { $needCopy = $true }
        }
        if ($needCopy) {
            foreach ($t in $targets) {
                $dir = Split-Path $t -Parent
                if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
                Copy-Item $srcIndex $t -Force
            }
            OK 'index.html 已同步到 3 处'
            $report.htmlSynced = 'done'
        }
        else {
            OK 'index.html 各处已一致'
            $report.htmlSynced = 'uptodate'
        }
    }
    else {
        Fail 'desktop-webview/index.html 不存在'
        $report.htmlSynced = 'failed'
    }

    # ---------- 2.5 架构合规检查 ----------
    Step '2.5' '架构合规检查'
    $pyExe = 'C:\Users\ROG\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
    $checkScript = Join-Path $ROOT 'scripts\check_architecture.py'
    if ((Test-Path $pyExe) -and (Test-Path $checkScript)) {
        $env:PYTHONIOENCODING = 'utf-8'
        $out = & $pyExe $checkScript 2>&1
        $last = ($out | Select-Object -Last 1)
        if ($last -match '全部通过|checks passed') {
            OK $last
        }
        else {
            Fail "架构检查未通过：$last"
            $out | Select-Object -Last 15 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkYellow }
            $report.errors += "架构检查失败"
        }
    }
    else {
        Warn '跳过架构检查（缺少 python 或脚本）'
    }

    # ---------- 3. 判断是否需要编译 exe ----------
    Step 3 '检查是否需要重新编译 exe'
    $csFiles = Get-ChildItem (Join-Path $ROOT 'desktop-webview') -Filter '*.cs' -File
    $csproj = Join-Path $ROOT 'desktop-webview\MossCore.csproj'
    $newestCs = ($csFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
    if (Test-Path $csproj) {
        $projTime = (Get-Item $csproj).LastWriteTime
        if ($projTime -gt $newestCs) { $newestCs = $projTime }
    }
    $exePath = Join-Path $ROOT 'release\publish\MOSS CORE.exe'
    $installedExe = Join-Path $INSTALL_DIR 'MOSS CORE.exe'

    $needBuild = $false
    if (-not (Test-Path $exePath)) { $needBuild = $true }
    elseif ((Get-Item $exePath).LastWriteTime -lt $newestCs) { $needBuild = $true }
    elseif ((Test-Path $installedExe) -and (Get-FileHash $exePath).Hash -ne (Get-FileHash $installedExe).Hash) {
        # 发布版比安装版新，需要覆盖
    }

    if ($needBuild) {
        Warn "C# 源码较新（$newestCs），开始编译"
        $proc = Start-Process -FilePath $DOTNET -ArgumentList @(
            'publish', (Join-Path $ROOT 'desktop-webview\MossCore.csproj'),
            '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
            '-o', (Join-Path $ROOT 'release\publish'), '--nologo', '-v', 'q'
        ) -PassThru -NoNewWindow -Wait
        if ($proc.ExitCode -eq 0 -and (Test-Path $exePath)) {
            OK "编译成功：$((Get-Item $exePath).Length) 字节"
            $report.exeBuilt = 'done'
        }
        else {
            Fail "编译失败（exit=$($proc.ExitCode)）"
            $report.exeBuilt = 'failed'
            $report.errors += 'dotnet publish 失败'
        }
    }
    else {
        OK 'exe 已是最新，跳过编译'
        $report.exeBuilt = 'uptodate'
    }

    # ---------- 4. 部署 exe 到安装目录 ----------
    Step 4 '部署 exe 到安装目录'
    if (Test-Path $exePath) {
        $needCopyExe = $true
        if (Test-Path $installedExe) {
            $needCopyExe = (Get-FileHash $exePath).Hash -ne (Get-FileHash $installedExe).Hash
        }
        if ($needCopyExe) {
            Get-Process -Name 'MOSS CORE' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
            Get-Process -Name 'msedgewebview2' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            Copy-Item $exePath $installedExe -Force
            OK 'exe 已更新'
            $report.clientRun = 'stopped'
        }
        else {
            OK 'exe 已是最新'
        }
    }
    # 同步其他资源
    foreach ($f in @('icon.ico', 'watchlist.json', 'live-seed.json', 'window-default.txt')) {
        $s = Join-Path $INSTALL_DIR $f
        if (Test-Path $s) { } # 保留安装目录现有配置
    }

    # ---------- 5. 部署云端 ----------
    Step 5 '检查是否需要部署云端'
    $cloudFiles = @('collector.py', 'queue_core.py', 'license_core.py')
    $needDeploy = $false
    $toDeploy = @()
    foreach ($cf in $cloudFiles) {
        $local = Join-Path $ROOT "cloud\$cf"
        if (-not (Test-Path $local)) { continue }
        $localMd5 = (Get-FileHash $local -Algorithm MD5).Hash.ToLower()
        $toDeploy += [pscustomobject]@{ File = $cf; Path = $local; Md5 = $localMd5 }
    }

    if ($toDeploy.Count -gt 0) {
        # 一次性取服务器端 md5
        $remoteMd5 = & ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30 -i $PEM $SERVER `
            'md5sum /opt/moss-core/collector.py /opt/moss-core/queue_core.py /opt/moss-core/license_core.py 2>/dev/null' 2>&1
        $remoteMap = @{}
        foreach ($line in $remoteMd5) {
            if ($line -match '^([0-9a-f]{32})\s+(\S+)$') {
                $remoteMap[(Split-Path $Matches[2] -Leaf)] = $Matches[1]
            }
        }
        $diff = @()
        foreach ($item in $toDeploy) {
            if ($remoteMap[$item.File] -ne $item.Md5) { $diff += $item }
        }

        if ($diff.Count -gt 0) {
            Write-Host "    需要上传："
            $diff | ForEach-Object { Write-Host "      - $($_.File)" }
            foreach ($item in $diff) {
                scp -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30 -i $PEM $item.Path "$SERVER`:/tmp/$($item.File)" 2>&1 | Out-Null
            }
            $cmds = ($diff | ForEach-Object { "sudo cp /tmp/$($_.File) /opt/moss-core/$($_.File);" }) -join ' '
            $restart = 'sudo chown root:root /opt/moss-core/*.py; sudo systemctl restart moss-core-collector.service; sleep 6; sudo systemctl is-active moss-core-collector.service'
            $out = & ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30 -i $PEM $SERVER "$cmds $restart" 2>&1
            if ($out -match 'active') {
                OK '云端已部署并重启'
                $report.cloudDeployed = 'done'
            }
            else {
                Fail "云端部署异常：$out"
                $report.cloudDeployed = 'failed'
                $report.errors += "云端部署: $out"
            }
        }
        else {
            OK '云端已是最新'
            $report.cloudDeployed = 'uptodate'
        }
    }

    # ---------- 6. 重启客户端 ----------
    Step 6 '启动客户端'
    $running = Get-Process -Name 'MOSS CORE' -ErrorAction SilentlyContinue
    if (-not $running) {
        $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'MOSS CORE.lnk'
        if (Test-Path $lnk) { Start-Process -FilePath $lnk }
        else { Start-Process -FilePath (Join-Path $INSTALL_DIR 'MOSS CORE.exe') }
        Start-Sleep -Seconds 15
        $p = Get-Process -Name 'MOSS CORE' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($p) {
            OK "客户端已启动 (PID $($p.Id), $($p.StartTime.ToString('HH:mm:ss')))"
            $report.clientRun = "running:$($p.Id)"
        }
        else {
            Fail '客户端启动失败'
            $report.clientRun = 'failed'
        }
    }
    else {
        OK "客户端已在运行 (PID $($running[0].Id))"
        $report.clientRun = "already:$($running[0].Id)"
    }

    # ---------- 7. 健康检查 ----------
    Step 7 '验证云端接口'
    $tk = 'yb4m3bG30ZIW0v4CwBzgGxoidZhRllej8vAmfxk6jzo'
    try {
        $q = Invoke-RestMethod 'https://43-160-232-254.sslip.io/queue' -Headers @{ Authorization = "Bearer $tk" } -TimeoutSec 20
        OK "queue ok: left=$($q.left.symbol) right=$($q.right.symbol)"
    }
    catch { Warn "queue 检查失败：$($_.Exception.Message)" }

}
catch {
    Fail "同步中断：$($_.Exception.Message)"
    $report.errors += $_.Exception.Message
}
finally {
    $report.finishedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host " 同步结果" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    $report.GetEnumerator() | ForEach-Object {
        $v = if ($_.Value -is [array]) { ($_.Value -join ', ') } else { $_.Value }
        Write-Host ("  {0,-14} : {1}" -f $_.Key, $v)
    }
    Write-Host ""

    # 写日志
    $logDir = Join-Path $ROOT 'backup\sync-logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $logFile = Join-Path $logDir ("sync-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $report | ConvertTo-Json -Depth 5 | Set-Content $logFile -Encoding UTF8
    Write-Host "日志：$logFile" -ForegroundColor DarkGray
}
