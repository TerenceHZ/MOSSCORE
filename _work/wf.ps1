# MOSS CORE 工作流面板 · 状态写入器
# 用法：
#   powershell -ExecutionPolicy Bypass -File wf.ps1 init -TaskName "任务名" -StepList "步骤1|步骤2|步骤3"
#   powershell -ExecutionPolicy Bypass -File wf.ps1 set  -Index 1 -StepState running -Note "开始第一步"
#   powershell -ExecutionPolicy Bypass -File wf.ps1 set  -Index 1 -StepState done    -Note "第一步完成"
#   powershell -ExecutionPolicy Bypass -File wf.ps1 log  -Note "随便记一条"
# 每次调用都会重写 workflow.html（浏览器 5 秒自动刷新）和 workflow.md

param(
  [Parameter(Mandatory = $true)][ValidateSet('init', 'set', 'log', 'reset')][string]$Action,
  [string]$TaskName = '',
  [string]$StepList = '',
  [int]$Index = 0,
  [ValidateSet('pending', 'running', 'done', 'failed', 'skipped', '')][string]$StepState = '',
  [string]$Note = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$statePath = Join-Path $root 'state.json'
$htmlPath = Join-Path $root 'workflow.html'
$mdPath = Join-Path $root 'workflow.md'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Get-Now { (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') }

function New-Job {
  [pscustomobject]@{
    task      = '（空闲）'
    startedAt = (Get-Now)
    updatedAt = (Get-Now)
    steps     = @()
    logs      = @()
  }
}

function Read-Job {
  if (Test-Path $statePath) {
    try {
      $raw = Get-Content $statePath -Raw -Encoding utf8
      if ($raw.Trim()) {
        $obj = $raw | ConvertFrom-Json
        if ($null -ne $obj) { return $obj }
      }
    } catch { }
  }
  return (New-Job)
}

function Save-Job($job) {
  $job.updatedAt = Get-Now
  [IO.File]::WriteAllText($statePath, ($job | ConvertTo-Json -Depth 6), $utf8)
}

function Add-Log($job, [string]$msg, [string]$kind = 'info') {
  $entry = [pscustomobject]@{ at = (Get-Now); msg = $msg; kind = $kind }
  $job.logs = @($entry) + @($job.logs)
  if ($job.logs.Count -gt 200) { $job.logs = $job.logs[0..199] }
}

function Render($job) {
  $stepsArr = @($job.steps)
  $logsArr = @($job.logs)
  $total = $stepsArr.Count
  $done = @($stepsArr | Where-Object { $_.state -eq 'done' }).Count
  if ($total -gt 0) { $pct = [math]::Round($done * 100 / $total) } else { $pct = 0 }

  $iconOf = @{ pending = '·'; running = '▶'; done = '✔'; failed = '✕'; skipped = '–' }
  $clsOf = @{ pending = 'pending'; running = 'running'; done = 'done'; failed = 'failed'; skipped = 'skipped' }

  $rows = @()
  for ($i = 0; $i -lt $total; $i++) {
    $s = $stepsArr[$i]
    $st = if ($s.state) { [string]$s.state } else { 'pending' }
    if (-not $iconOf.ContainsKey($st)) { $st = 'pending' }
    $name = [System.Net.WebUtility]::HtmlEncode([string]$s.name)
    $snote = [System.Net.WebUtility]::HtmlEncode([string]$s.note)
    $sat = [System.Net.WebUtility]::HtmlEncode([string]$s.at)
    $rows += "<li class=""s $($clsOf[$st])""><span class=""ic"">$($iconOf[$st])</span><span class=""n"">$($i + 1). $name</span><span class=""t"">$sat</span><div class=""note"">$snote</div></li>"
  }

  $logRows = @()
  foreach ($l in ($logsArr | Select-Object -First 30)) {
    $msg = [System.Net.WebUtility]::HtmlEncode([string]$l.msg)
    $lat = [System.Net.WebUtility]::HtmlEncode([string]$l.at)
    $lkind = [System.Net.WebUtility]::HtmlEncode([string]$l.kind)
    $logRows += "<li class=""k-$lkind""><b>$lat</b><span>$msg</span></li>"
  }

  $taskHtml = [System.Net.WebUtility]::HtmlEncode([string]$job.task)
  $updated = [System.Net.WebUtility]::HtmlEncode([string]$job.updatedAt)
  $started = [System.Net.WebUtility]::HtmlEncode([string]$job.startedAt)
  $now = Get-Now
  $rowsHtml = $rows -join "`n"
  $logHtml = $logRows -join "`n"

  $html = @"
<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="5">
<title>MOSS 工作流 · $taskHtml</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#05070a;color:#ece5d5;font:13px/1.65 "Segoe UI","Microsoft YaHei",sans-serif;
background-image:linear-gradient(rgba(232,160,32,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(232,160,32,.05) 1px,transparent 1px);
background-size:56px 56px}
.wrap{max-width:980px;margin:0 auto;padding:28px 24px 60px}
.head{border:1px solid #3b3324;background:linear-gradient(180deg,#0b0e12,#080a0d);padding:18px 20px;margin-bottom:16px}
.kicker{font:600 10px/1 Consolas,monospace;letter-spacing:.22em;color:#8b7d68}
h1{font:600 21px/1.3 "Segoe UI","Microsoft YaHei",sans-serif;margin:10px 0 6px;color:#fff;letter-spacing:.5px}
.meta{display:flex;gap:18px;flex-wrap:wrap;font:11px/1 Consolas,monospace;color:#6f6352;margin-top:8px}
.bar{height:4px;background:#15181d;margin-top:14px;position:relative;overflow:hidden}
.bar>i{display:block;height:100%;width:$pct%;background:linear-gradient(90deg,#e8a020,#ffd27a);box-shadow:0 0 12px rgba(232,160,32,.55);transition:width .4s}
.bar b{position:absolute;right:0;top:-18px;font:600 11px Consolas,monospace;color:#e8a020}
section{border:1px solid #23262c;background:#080a0e;padding:16px 18px;margin-bottom:14px}
h2{font:600 10px/1 Consolas,monospace;letter-spacing:.2em;color:#8b7d68;margin:0 0 12px}
ul{list-style:none;margin:0;padding:0}
li.s{display:grid;grid-template-columns:24px 1fr auto;gap:8px;padding:9px 0;border-bottom:1px solid #15181d;align-items:start}
li.s:last-child{border-bottom:0}
li.s .ic{font-family:Consolas,monospace;color:#5f594f}
li.s .n{color:#cfc6b4}
li.s .t{font:10px/1.6 Consolas,monospace;color:#5f594f}
li.s .note{grid-column:2 / 4;font-size:11.5px;color:#8b7d68;margin-top:2px}
li.s.done .ic{color:#63c08e}li.s.done .n{color:#9dd8b3}
li.s.running .ic{color:#e8a020;animation:pulse 1.2s infinite}li.s.running .n{color:#ffd27a}
li.s.failed .ic{color:#c96358}li.s.failed .n{color:#e0a39b}
li.s.skipped .ic,li.s.skipped .n{color:#5f594f;text-decoration:line-through}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
#log li{display:grid;grid-template-columns:140px 1fr;gap:10px;padding:5px 0;border-bottom:1px dashed #14171c;font-size:11.5px}
#log li b{font:10px/1.8 Consolas,monospace;color:#5f594f;font-weight:400}
#log li span{color:#a99f8b}
#log li.k-done span{color:#9dd8b3}#log li.k-error span{color:#e0a39b}#log li.k-warn span{color:#ffd27a}
.foot{text-align:center;font:10px/1.8 Consolas,monospace;color:#4b463d;margin-top:22px}
.dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#63c08e;margin-right:6px;box-shadow:0 0 8px rgba(99,192,142,.7);animation:pulse 2s infinite}
</style></head><body><div class="wrap">
<div class="head">
  <div class="kicker">MOSS CORE · WORKFLOW MONITOR</div>
  <h1>$taskHtml</h1>
  <div class="meta"><span><span class="dot"></span>进行中</span><span>开始 $started</span><span>刷新 $now</span></div>
  <div class="bar"><b>$done / $total</b><i></i></div>
</div>
<section><h2>步骤</h2><ul>$rowsHtml</ul></section>
<section><h2>实时日志</h2><ul id="log">$logHtml</ul></section>
<div class="foot">每 5 秒自动刷新 · 双击本文件即可随时查看</div>
</div></body></html>
"@
  [IO.File]::WriteAllText($htmlPath, $html, $utf8)

  $md = New-Object System.Text.StringBuilder
  [void]$md.AppendLine("# 工作流：$($job.task)")
  [void]$md.AppendLine("")
  [void]$md.AppendLine("- 开始：$($job.startedAt)    更新：$($job.updatedAt)")
  [void]$md.AppendLine("- 进度：$done / $total（$pct%）")
  [void]$md.AppendLine("")
  [void]$md.AppendLine("## 步骤")
  for ($i = 0; $i -lt $total; $i++) {
    $s = $stepsArr[$i]
    $st = if ($s.state) { [string]$s.state } else { 'pending' }
    $mark = switch ($st) { 'done' { 'x' } 'running' { '>' } 'failed' { '!' } 'skipped' { '-' } default { ' ' } }
    [void]$md.AppendLine("- [$mark] $($i + 1). $($s.name)  $($s.note)")
  }
  [void]$md.AppendLine("")
  [void]$md.AppendLine("## 日志")
  foreach ($l in ($logsArr | Select-Object -First 40)) { [void]$md.AppendLine("- $($l.at)  $($l.msg)") }
  [IO.File]::WriteAllText($mdPath, $md.ToString(), $utf8)
}

$job = Read-Job

switch ($Action) {
  'reset' {
    $job = New-Job
  }
  'init' {
    $list = @()
    if ($StepList) {
      $n = 0
      foreach ($s in ($StepList -split '\|')) {
        $n++
        $list += [pscustomobject]@{ name = $s.Trim(); state = 'pending'; note = ''; at = '' }
      }
    }
    $job = New-Job
    $job.task = if ($TaskName) { $TaskName } else { '（未命名任务）' }
    $job.steps = $list
    Add-Log $job "任务开始：$($job.task)" 'info'
  }
  'set' {
    $stepsArr = @($job.steps)
    if ($Index -lt 1 -or $Index -gt $stepsArr.Count) { throw "步骤序号越界：$Index（共 $($stepsArr.Count) 步）" }
    $s = $stepsArr[$Index - 1]
    if ($StepState) { $s.state = $StepState }
    if ($Note) { $s.note = $Note }
    $s.at = Get-Now
    $job.steps = $stepsArr
    $label = if ($StepState) { $StepState } else { 'update' }
    $kind = if ($StepState -eq 'failed') { 'error' } elseif ($StepState -eq 'done') { 'done' } else { 'info' }
    Add-Log $job "[$Index] $($s.name) -> $label$(if ($Note) { "：$Note" })" $kind
  }
  'log' {
    Add-Log $job $Note 'info'
  }
}

Save-Job $job
Render $job
Write-Host ("[{0}] {1} ok - panel: {2}" -f (Get-Now), $Action, $htmlPath)
