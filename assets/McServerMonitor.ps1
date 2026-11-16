# =====================================================================
#  Minecraft 服务器 · 桌面实时监控（WinForms 浮窗）
#  只读 JSON 显示；采集由 mcmon-poll.ps1 后台完成 → 窗口永不卡顿
#  启动：双击 start-monitor.vbs（无黑窗口）
# =====================================================================
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$Root      = $PSScriptRoot
$CfgPath   = Join-Path $Root 'mcmon-config.json'
$StatePath = Join-Path $env:TEMP 'mcmon_state.json'
$PosPath   = Join-Path $env:APPDATA 'McServerMonitor\pos.txt'
$PollPath  = Join-Path $Root 'mcmon-poll.ps1'

$cfg = @{ host = '127.0.0.1'; port = 25575; pass = ''; interval = 5; label = 'Minecraft Server' }
if (Test-Path -LiteralPath $CfgPath) {
    try {
        $c = ([System.IO.File]::ReadAllText($CfgPath, [System.Text.Encoding]::UTF8)) | ConvertFrom-Json
        foreach ($k in 'host','pass','label') { if ($c.$k) { $cfg[$k] = [string]$c.$k } }
        if ($c.port)     { $cfg.port = [int]$c.port }
        if ($c.interval) { $cfg.interval = [int]$c.interval }
    } catch {}
}

$script:PollProc = $null
function Start-Poller {
    try {
        $existing = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine.Contains('mcmon-poll.ps1') -and $_.ProcessId -ne $PID })
        if ($existing.Count -gt 0) { return }
        $argLine = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $PollPath + '" -ConfigPath "' + $CfgPath + '" -OutPath "' + $StatePath + '"'
        $script:PollProc = Start-Process -FilePath 'powershell.exe' -ArgumentList $argLine -WindowStyle Hidden -PassThru -ErrorAction Stop
    } catch {}
}
Start-Poller

$C_BG     = [System.Drawing.Color]::FromArgb(24, 26, 32)
$C_BG2    = [System.Drawing.Color]::FromArgb(34, 37, 45)
$C_TEXT   = [System.Drawing.Color]::FromArgb(232, 234, 240)
$C_DIM    = [System.Drawing.Color]::FromArgb(150, 155, 168)
$C_GOOD   = [System.Drawing.Color]::FromArgb(80, 220, 140)
$C_WARN   = [System.Drawing.Color]::FromArgb(255, 200, 70)
$C_BAD    = [System.Drawing.Color]::FromArgb(255, 90, 90)
$C_ACCENT = [System.Drawing.Color]::FromArgb(120, 180, 255)

$form = New-Object System.Windows.Forms.Form
$form.Text            = 'Minecraft 监控'
$form.FormBorderStyle = 'None'
$form.StartPosition   = 'Manual'
$form.TopMost         = $true
$form.Size            = New-Object System.Drawing.Size(340, 300)
$form.BackColor       = $C_BG
$form.ShowInTaskbar   = $true
$form.MinimumSize     = New-Object System.Drawing.Size(300, 260)
$form.Opacity         = 0.94

$px = -1; $py = -1
if (Test-Path -LiteralPath $PosPath) {
    try {
        $p = (Get-Content -LiteralPath $PosPath -Raw).Trim() -split ','
        if ($p.Count -ge 2) { $px = [int]$p[0]; $py = [int]$p[1] }
    } catch {}
}
$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
if ($px -lt 0 -or $px -gt $wa.Width - 100) { $px = $wa.Width - $form.Width - 24 }
if ($py -lt 0 -or $py -gt $wa.Height - 60)  { $py = 24 }
$form.Location = New-Object System.Drawing.Point($px, $py)

$bar = New-Object System.Windows.Forms.Panel
$bar.Location  = New-Object System.Drawing.Point(0, 0)
$bar.Size      = New-Object System.Drawing.Size($form.Width, 34)
$bar.BackColor = $C_BG2
$bar.Anchor    = 'Top,Left,Right'
$form.Controls.Add($bar)

$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text      = ('  ' + $cfg.label)
$lblTitle.ForeColor = $C_TEXT
$lblTitle.Font      = New-Object System.Drawing.Font('Microsoft YaHei UI', 9, [System.Drawing.FontStyle]::Bold)
$lblTitle.Location  = New-Object System.Drawing.Point(4, 8)
$lblTitle.AutoSize  = $true
$bar.Controls.Add($lblTitle)

$btnClose = New-Object System.Windows.Forms.Label
$btnClose.Text      = '✕'
$btnClose.ForeColor = $C_DIM
$btnClose.Font      = New-Object System.Drawing.Font('Segoe UI', 11)
$btnClose.Size      = New-Object System.Drawing.Size(28, 26)
$btnClose.TextAlign = 'MiddleCenter'
$btnClose.Location  = New-Object System.Drawing.Point(($form.Width - 34), 4)
$btnClose.Anchor    = 'Top,Right'
$btnClose.Cursor    = 'Hand'
$bar.Controls.Add($btnClose)
$btnClose.Add_Click({ $form.Close() })
$btnClose.Add_MouseEnter({ $btnClose.ForeColor = $C_BAD })
$btnClose.Add_MouseLeave({ $btnClose.ForeColor = $C_DIM })

$drag = $false; $dx = 0; $dy = 0
$bar.Add_MouseDown({ param($s, $e) $script:drag = $true; $script:dx = $e.X; $script:dy = $e.Y })
$bar.Add_MouseMove({ param($s, $e) if ($script:drag) { $form.Location = New-Object System.Drawing.Point(($form.Left + $e.X - $script:dx), ($form.Top + $e.Y - $script:dy)) } })
$bar.Add_MouseUp({ $script:drag = $false })
$lblTitle.Add_MouseDown({ param($s, $e) $script:drag = $true; $script:dx = $e.X + $lblTitle.Left; $script:dy = $e.Y + $lblTitle.Top })
$lblTitle.Add_MouseMove({ param($s, $e) if ($script:drag) { $form.Location = New-Object System.Drawing.Point(($form.Left + $e.X - $script:dx), ($form.Top + $e.Y - $script:dy)) } })
$lblTitle.Add_MouseUp({ $script:drag = $false })

$lblPlayersTitle = New-Object System.Windows.Forms.Label
$lblPlayersTitle.Text      = '在线人数'
$lblPlayersTitle.ForeColor = $C_DIM
$lblPlayersTitle.Font      = New-Object System.Drawing.Font('Microsoft YaHei UI', 8.5)
$lblPlayersTitle.Location  = New-Object System.Drawing.Point(16, 46)
$lblPlayersTitle.AutoSize  = $true
$form.Controls.Add($lblPlayersTitle)

$lblPlayers = New-Object System.Windows.Forms.Label
$lblPlayers.Text      = '--'
$lblPlayers.ForeColor = $C_ACCENT
$lblPlayers.Font      = New-Object System.Drawing.Font('Segoe UI', 30, [System.Drawing.FontStyle]::Bold)
$lblPlayers.Location  = New-Object System.Drawing.Point(12, 62)
$lblPlayers.AutoSize  = $true
$form.Controls.Add($lblPlayers)

$lblMax = New-Object System.Windows.Forms.Label
$lblMax.Text      = '/ --'
$lblMax.ForeColor = $C_DIM
$lblMax.Font      = New-Object System.Drawing.Font('Segoe UI', 11)
$lblMax.Location  = New-Object System.Drawing.Point(12, 108)
$lblMax.AutoSize  = $true
$form.Controls.Add($lblMax)

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Text      = '● 连接中…'
$lblStatus.ForeColor = $C_DIM
$lblStatus.Font      = New-Object System.Drawing.Font('Microsoft YaHei UI', 11, [System.Drawing.FontStyle]::Bold)
$lblStatus.Location  = New-Object System.Drawing.Point(190, 70)
$lblStatus.AutoSize  = $true
$form.Controls.Add($lblStatus)

$lblStatusSub = New-Object System.Windows.Forms.Label
$lblStatusSub.Text      = ''
$lblStatusSub.ForeColor = $C_DIM
$lblStatusSub.Font      = New-Object System.Drawing.Font('Microsoft YaHei UI', 8.5)
$lblStatusSub.Location  = New-Object System.Drawing.Point(192, 96)
$lblStatusSub.AutoSize  = $true
$form.Controls.Add($lblStatusSub)

$chart = New-Object System.Windows.Forms.PictureBox
$chart.Location  = New-Object System.Drawing.Point(14, 132)
$chart.Size      = New-Object System.Drawing.Size(($form.Width - 28), 44)
$chart.Anchor    = 'Top,Left,Right'
$chart.BackColor = $C_BG2
$form.Controls.Add($chart)
$script:hist = New-Object System.Collections.ArrayList

$chart.Add_Paint({
    param($s, $e)
    $g = $e.Graphics
    $g.SmoothingMode = 'AntiAlias'
    $w = $chart.Width; $h = $chart.Height
    $penGrid = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(55, 60, 72)), 1
    $g.DrawLine($penGrid, 0, ($h - 6), $w, ($h - 6))
    $g.DrawLine($penGrid, 0, ($h / 2), $w, ($h / 2))
    if ($script:hist.Count -lt 2) { $penGrid.Dispose(); return }
    $maxPts = [Math]::Max(2, [int]($w / 4))
    $pts = @($script:hist | Select-Object -Last $maxPts)
    $poly = New-Object System.Collections.Generic.List[System.Drawing.PointF]
    for ($i = 0; $i -lt $pts.Count; $i++) {
        $x = ($i / [Math]::Max(1, ($pts.Count - 1))) * ($w - 2) + 1
        $ratio = [Math]::Max(0.0, [Math]::Min(1.0, ([double]$pts[$i]) / 20.0))
        $y = ($h - 6) - $ratio * ($h - 10)
        $poly.Add((New-Object System.Drawing.PointF($x, $y)))
    }
    if ($poly.Count -ge 2) {
        $pen = New-Object System.Drawing.Pen $C_GOOD, 1.8
        $g.DrawLines($pen, $poly.ToArray())
        $pen.Dispose()
    }
    $penGrid.Dispose()
})

$lblTps = New-Object System.Windows.Forms.Label
$lblTps.Text      = 'TPS   --'
$lblTps.ForeColor = $C_GOOD
$lblTps.Font      = New-Object System.Drawing.Font('Consolas', 9.5)
$lblTps.Location  = New-Object System.Drawing.Point(16, 182)
$lblTps.AutoSize  = $true
$form.Controls.Add($lblTps)

$lblMspt = New-Object System.Windows.Forms.Label
$lblMspt.Text      = 'MSPT  --'
$lblMspt.ForeColor = $C_TEXT
$lblMspt.Font      = New-Object System.Drawing.Font('Consolas', 9.5)
$lblMspt.Location  = New-Object System.Drawing.Point(150, 182)
$lblMspt.AutoSize  = $true
$form.Controls.Add($lblMspt)

$lblPing = New-Object System.Windows.Forms.Label
$lblPing.Text      = '延迟  --'
$lblPing.ForeColor = $C_TEXT
$lblPing.Font      = New-Object System.Drawing.Font('Consolas', 9.5)
$lblPing.Location  = New-Object System.Drawing.Point(16, 202)
$lblPing.AutoSize  = $true
$form.Controls.Add($lblPing)

$lblDims = New-Object System.Windows.Forms.Label
$lblDims.Text      = '维度  --'
$lblDims.ForeColor = $C_DIM
$lblDims.Font      = New-Object System.Drawing.Font('Microsoft YaHei UI', 8.5)
$lblDims.Location  = New-Object System.Drawing.Point(150, 202)
$lblDims.AutoSize  = $true
$form.Controls.Add($lblDims)

$lblNames = New-Object System.Windows.Forms.Label
$lblNames.Text     = ''
$lblNames.ForeColor = $C_DIM
$lblNames.Font     = New-Object System.Drawing.Font('Microsoft YaHei UI', 8)
$lblNames.Location = New-Object System.Drawing.Point(16, 222)
$lblNames.Size     = New-Object System.Drawing.Size(($form.Width - 32), 32)
$lblNames.Anchor   = 'Top,Left,Right'
$form.Controls.Add($lblNames)

$lblTime = New-Object System.Windows.Forms.Label
$lblTime.Text      = '等待数据…'
$lblTime.ForeColor = [System.Drawing.Color]::FromArgb(110, 115, 128)
$lblTime.Font      = New-Object System.Drawing.Font('Microsoft YaHei UI', 7.5)
$lblTime.Location  = New-Object System.Drawing.Point(16, 262)
$lblTime.AutoSize  = $true
$lblTime.Anchor    = 'Bottom,Left'
$form.Controls.Add($lblTime)

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miRefresh = $menu.Items.Add('立即刷新')
$miRefresh.Add_Click({ Remove-Item -LiteralPath $StatePath -Force -EA SilentlyContinue })
$miTop = $menu.Items.Add('窗口置顶')
$miTop.CheckOnClick = $true
$miTop.Checked = $true
$miTop.Add_Click({ $form.TopMost = $miTop.Checked })
$miRestart = $menu.Items.Add('重启采集器')
$miRestart.Add_Click({
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -EA SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains('mcmon-poll.ps1') -and $_.ProcessId -ne $PID } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }
    Start-Sleep -Milliseconds 400
    Start-Poller
})
$null = $menu.Items.Add('-')
$miExit = $menu.Items.Add('退出监控')
$miExit.Add_Click({
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -EA SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains('mcmon-poll.ps1') -and $_.ProcessId -ne $PID } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }
    $form.Close()
})
$form.ContextMenuStrip = $menu
$chart.ContextMenuStrip = $menu

function Set-Status {
    param([string]$Text, [System.Drawing.Color]$Color, [string]$Sub)
    $lblStatus.Text = $Text
    $lblStatus.ForeColor = $Color
    $lblStatusSub.Text = $Sub
}

$script:tick = 0
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick({
    $script:tick++
    if ($script:tick % 10 -eq 1) {
        $alive = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -EA SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine.Contains('mcmon-poll.ps1') -and $_.ProcessId -ne $PID })
        if ($alive.Count -eq 0) { Start-Poller }
    }
    if (-not (Test-Path -LiteralPath $StatePath)) { Set-Status '● 启动中…' $C_DIM '采集器启动中'; return }
    $raw = $null
    try { $raw = [System.IO.File]::ReadAllText($StatePath, [System.Text.Encoding]::UTF8) } catch { return }
    if (-not $raw -or $raw.Trim() -eq '') { return }
    $st = $null
    try { $st = $raw | ConvertFrom-Json } catch { return }
    if (-not $st) { return }

    if (-not $st.ok) {
        Set-Status '● 离线' $C_BAD ('无法连接：' + $st.error)
        $lblPlayers.Text = '✕'; $lblPlayers.ForeColor = $C_BAD
        $lblMax.Text = '/ --'; $lblTps.Text = 'TPS   --'; $lblMspt.Text = 'MSPT  --'
        $lblPing.Text = '延迟  --'; $lblDims.Text = '维度  --'; $lblNames.Text = ''
        $lblTime.Text = ('最后尝试 ' + $st.time)
        return
    }

    $lblPlayers.Text = [string]$st.players
    $lblMax.Text = ('/ ' + $st.maxPlayers)
    $lblPlayers.ForeColor = if ($st.players -gt 0) { $C_ACCENT } else { $C_DIM }

    $tps = [double]$st.tps; $mspt = [double]$st.mspt
    $lblTps.Text  = ('TPS   ' + ('{0:F2}' -f $tps))
    $lblMspt.Text = ('MSPT  ' + ('{0:F1}' -f $mspt) + ' ms')
    $lblTps.ForeColor  = if ($tps -ge 19.5) { $C_GOOD } elseif ($tps -ge 17.0) { $C_WARN } else { $C_BAD }
    $lblMspt.ForeColor = if ($mspt -le 15) { $C_GOOD } elseif ($mspt -le 35) { $C_WARN } else { $C_BAD }

    $ping = [int]$st.pingMs
    $lblPing.Text = ('延迟  ' + $ping + ' ms')
    $lblPing.ForeColor = if ($ping -le 120) { $C_GOOD } elseif ($ping -le 300) { $C_WARN } else { $C_BAD }

    $dimCount = @($st.dims).Count
    $badDims = @($st.dims | Where-Object { [double]$_.tps -lt 19.0 })
    if ($badDims.Count -gt 0) {
        $lblDims.Text = ('维度  ' + $badDims.Count + '/' + $dimCount + ' 掉帧')
        $lblDims.ForeColor = $C_WARN
    } else {
        $lblDims.Text = ('维度  ' + $dimCount + ' 正常')
        $lblDims.ForeColor = $C_DIM
    }

    if ($tps -ge 19.5 -and $ping -le 300) {
        Set-Status '● 流畅' $C_GOOD '服务器运行正常'
    } elseif ($tps -ge 17.0) {
        Set-Status '● 轻微卡顿' $C_WARN ('TPS 掉到 ' + ('{0:F1}' -f $tps))
    } else {
        Set-Status '● 严重卡顿' $C_BAD ('TPS ' + ('{0:F1}' -f $tps) + ' / MSPT ' + ('{0:F0}' -f $mspt) + 'ms')
    }

    $names = @($st.playerNames)
    if ($names.Count -gt 0) {
        $txt = ($names -join '、')
        if ($txt.Length -gt 46) { $txt = $txt.Substring(0, 46) + '…' }
        $lblNames.Text = '玩家：' + $txt
    } else {
        $lblNames.Text = '玩家：（无人在线）'
    }

    [void]$script:hist.Add($tps)
    if ($script:hist.Count -gt 120) { $script:hist.RemoveAt(0) }
    $chart.Invalidate()
    $lblTime.Text = ('更新于 ' + $st.time)
})

$form.Add_FormClosing({
    try {
        $dir = Split-Path $PosPath
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        [System.IO.File]::WriteAllText($PosPath, ($form.Left.ToString() + ',' + $form.Top.ToString()), (New-Object System.Text.UTF8Encoding($false)))
    } catch {}
    try { $timer.Stop() } catch {}
    try {
        Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -EA SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine.Contains('mcmon-poll.ps1') -and $_.ProcessId -ne $PID } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }
    } catch {}
})

try {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = 12; $w = $form.Width; $h = $form.Height
    $path.AddArc(0, 0, $r, $r, 180, 90)
    $path.AddArc($w - $r, 0, $r, $r, 270, 90)
    $path.AddArc($w - $r, $h - $r, $r, $r, 0, 90)
    $path.AddArc(0, $h - $r, $r, $r, 90, 90)
    $path.CloseFigure()
    $form.Region = New-Object System.Drawing.Region($path)
} catch {}

$form.Add_Shown({ $timer.Start() })
[void]$form.ShowDialog()
