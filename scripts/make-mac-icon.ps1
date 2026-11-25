Add-Type -AssemblyName System.Drawing

$base = 'D:\数据库\mac-electron\icon.png'
$outDev = 'D:\数据库\mac-electron\icon-dev.png'

if (-not (Test-Path $base)) { throw "找不到 $base" }

$src = [System.Drawing.Image]::FromFile($base)
$W = $src.Width
$H = $src.Height
Write-Host "基础图标: ${W}x${H}"

# 复制到画布
$canvas = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.DrawImage($src, 0, 0, $W, $H)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# DEV 角标：底部横向色带
$bandH = [int]($H * 0.16)
$bandY = $H - $bandH
$bandColor = [System.Drawing.Color]::FromArgb(255, 128, 224, 208)   # 青色
$brush = New-Object System.Drawing.SolidBrush($bandColor)
$g.FillRectangle($brush, 0, $bandY, $W, $bandH)

# DEV 文字
$fontSize = [float]($bandH * 0.62)
$font = New-Object System.Drawing.Font('Arial', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$rf = New-Object System.Drawing.RectangleF(0, $bandY, $W, $bandH)
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Black)
$g.DrawString('DEV', $font, $textBrush, $rf, $sf)

$g.Dispose(); $brush.Dispose(); $textBrush.Dispose(); $src.Dispose()

$canvas.Save($outDev, [System.Drawing.Imaging.ImageFormat]::Png)
$canvas.Dispose()

Write-Host "已生成: $outDev ($([math]::Round((Get-Item $outDev).Length/1KB,1)) KB)"
