param(
  [Parameter(Mandatory = $true)][string]$Root,
  [Parameter(Mandatory = $true)][string]$Electron,
  [string]$Icon
)

$desktop = [Environment]::GetFolderPath('Desktop')
if ([string]::IsNullOrWhiteSpace($desktop)) { exit 1 }

$linkPath = Join-Path $desktop '550C Market Terminal.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($linkPath)
$shortcut.TargetPath = $Electron
$shortcut.Arguments = '--no-sandbox --disable-gpu-sandbox "' + $Root + '"'
$shortcut.WorkingDirectory = $Root
if (-not [string]::IsNullOrWhiteSpace($Icon) -and (Test-Path -LiteralPath $Icon)) {
  $shortcut.IconLocation = $Icon + ',0'
} else {
  $shortcut.IconLocation = $Electron + ',0'
}
$shortcut.Description = '550C Market Terminal'
$shortcut.Save()

Write-Host "[550C] 桌面快捷方式已创建：$linkPath"
exit 0
