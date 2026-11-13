# MOSS 工作流小窗口（跟随 DSH 显示进度）
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$statePath = Join-Path $root 'state.json'
$logPath = Join-Path $root 'panel.log'

function Write-PLog([string]$m) {
    try { [IO.File]::AppendAllText($logPath, "$(Get-Date -Format 'HH:mm:ss') $m`r`n", (New-Object Text.UTF8Encoding($false))) } catch {}
}

Write-PLog 'panel start'

$form = New-Object System.Windows.Forms.Form
$form.Text = 'MOSS 工作流'
$form.FormBorderStyle = 'None'
$form.StartPosition = 'Manual'
$form.Width = 430
$form.Height = 210
$form.BackColor = [System.Drawing.Color]::FromArgb(7, 9, 12)
$form.TopMost = $true
$form.ShowInTaskbar = $false

$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.Left = $wa.Right - $form.Width - 20
$form.Top = $wa.Top + 20

$lblKicker = New-Object System.Windows.Forms.Label
$lblKicker.Text = 'MOSS CORE - WORKFLOW'
$lblKicker.Font = New-Object System.Drawing.Font('Consolas', 8)
$lblKicker.ForeColor = [System.Drawing.Color]::FromArgb(139, 125, 104)
$lblKicker.SetBounds(16, 10, 300, 16)
$form.Controls.Add($lblKicker)

$lblClose = New-Object System.Windows.Forms.Label
$lblClose.Text = 'X'
$lblClose.Font = New-Object System.Drawing.Font('Consolas', 10)
$lblClose.ForeColor = [System.Drawing.Color]::FromArgb(120, 110, 95)
$lblClose.SetBounds(404, 8, 16, 16)
$lblClose.Cursor = [System.Windows.Forms.Cursors]::Hand
$form.Controls.Add($lblClose)

$lblTask = New-Object System.Windows.Forms.Label
$lblTask.Text = '（空闲）'
$lblTask.Font = New-Object System.Drawing.Font('Microsoft YaHei', 11, [System.Drawing.FontStyle]::Bold)
$lblTask.ForeColor = [System.Drawing.Color]::White
$lblTask.SetBounds(16, 32, 396, 28)
$form.Controls.Add($lblTask)

$lblCount = New-Object System.Windows.Forms.Label
$lblCount.Text = '步骤 0/0'
$lblCount.Font = New-Object System.Drawing.Font('Consolas', 8)
$lblCount.ForeColor = [System.Drawing.Color]::FromArgb(232, 160, 32)
$lblCount.SetBounds(16, 62, 200, 16)
$form.Controls.Add($lblCount)

$lblNow = New-Object System.Windows.Forms.Label
$lblNow.Text = '> 等待任务'
$lblNow.Font = New-Object System.Drawing.Font('Microsoft YaHei', 10, [System.Drawing.FontStyle]::Bold)
$lblNow.ForeColor = [System.Drawing.Color]::FromArgb(255, 210, 122)
$lblNow.SetBounds(16, 84, 396, 24)
$form.Controls.Add($lblNow)

$lblLog = New-Object System.Windows.Forms.Label
$lblLog.Text = ''
$lblLog.Font = New-Object System.Drawing.Font('Consolas', 8)
$lblLog.ForeColor = [System.Drawing.Color]::FromArgb(150, 142, 126)
$lblLog.SetBounds(16, 116, 396, 74)
$form.Controls.Add($lblLog)

# 拖动（用 $this，避免 param 绑定问题）
$script:dragging = $false
$script:ox = 0; $script:oy = 0

$form.add_MouseDown({
    if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        $script:dragging = $true; $script:ox = $_.X; $script:oy = $_.Y
    }
})
$form.add_MouseMove({
    if ($script:dragging) {
        $form.Left += $_.X - $script:ox
        $form.Top += $_.Y - $script:oy
    }
})
$form.add_MouseUp({ $script:dragging = $false })
$lblClose.add_Click({ $form.Close() })

$script:lastSig = ''

function Update-Panel {
    if (-not (Test-Path $statePath)) { return }
    try {
        $raw = Get-Content $statePath -Raw -Encoding utf8
        if (-not $raw.Trim()) { return }
        $job = $raw | ConvertFrom-Json
    } catch { return }
    if (-not $job) { return }

    $steps = @($job.steps)
    $total = $steps.Count
    $done = @($steps | Where-Object { $_.state -eq 'done' }).Count
    $running = $steps | Where-Object { $_.state -eq 'running' } | Select-Object -First 1
    $logs = @($job.logs)

    $sig = "$($job.task)|$total|$done|$($running.name)|$(($logs | Select-Object -First 1).msg)"
    if ($sig -eq $script:lastSig) { return }
    $script:lastSig = $sig

    $lblTask.Text = [string]$job.task
    $lblCount.Text = "步骤 $done/$total"
    if ($running) {
        $lblNow.Text = '> 正在：' + [string]$running.name
        $lblNow.ForeColor = [System.Drawing.Color]::FromArgb(255, 210, 122)
    } elseif ($total -gt 0 -and $done -ge $total) {
        $lblNow.Text = 'OK 已完成'
        $lblNow.ForeColor = [System.Drawing.Color]::FromArgb(99, 192, 142)
    } else {
        $lblNow.Text = '> 待开始'
        $lblNow.ForeColor = [System.Drawing.Color]::FromArgb(150, 142, 126)
    }

    $lines = @()
    foreach ($l in ($logs | Select-Object -First 2)) {
        if ($l) {
            $t = [string]$l.at
            if ($t.Length -ge 16) { $t = $t.Substring(11, 5) }
            $lines += "$t  $([string]$l.msg)"
        }
    }
    $lblLog.Text = ($lines -join "`r`n")
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.add_Tick({
    try {
        if (-not $form.Visible) { $form.Show() }
        Update-Panel
    } catch { Write-PLog "tick error: $($_.Exception.Message)" }
})

Write-PLog 'form ready'
$form.Show()
$timer.Start()
[System.Windows.Forms.Application]::Run()
Write-PLog 'panel exit'
