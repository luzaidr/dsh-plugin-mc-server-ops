# =====================================================================
#  监控保活脚本
#  由计划任务每 5 分钟执行：缺哪个补哪个
#  用法：powershell -NoProfile -ExecutionPolicy Bypass -File mcmon-keepalive.ps1
# =====================================================================
$dir = $PSScriptRoot
$monPs  = Join-Path $dir 'McServerMonitor.ps1'
$pollPs = Join-Path $dir 'mcmon-poll.ps1'
$logF   = Join-Path $env:TEMP 'mcmon_keepalive.log'

function Note([string]$m) {
    try { Add-Content -LiteralPath $logF -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '  ' + $m) -Encoding UTF8 -ErrorAction SilentlyContinue } catch {}
}

# 日志裁剪
try {
    if (Test-Path $logF) {
        $lines = @(Get-Content $logF -ErrorAction SilentlyContinue)
        if ($lines.Count -gt 400) { $lines | Select-Object -Last 150 | Set-Content $logF -Encoding UTF8 }
    }
} catch {}

function Get-Procs([string]$pattern) {
    $myPid = $PID
    $all = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue)
    return @($all | Where-Object { $_.ProcessId -ne $myPid -and $_.CommandLine -and $_.CommandLine.Contains($pattern) })
}

$hasPoll = (Get-Procs 'mcmon-poll.ps1').Count -gt 0
if ($hasPoll) { Start-Sleep -Seconds 3; $hasPoll = (Get-Procs 'mcmon-poll.ps1').Count -gt 0 }
$hasMon  = (Get-Procs 'McServerMonitor.ps1').Count -gt 0

Note ('检查: 窗口=' + $hasMon + '  采集器=' + $hasPoll)

if (-not $hasPoll) {
    $argLine = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $pollPs + '"'
    try {
        Start-Process -FilePath 'powershell.exe' -ArgumentList $argLine -WindowStyle Hidden -ErrorAction Stop | Out-Null
        Start-Sleep -Seconds 3
        Note ('启动采集器 -> 现在 ' + (Get-Procs 'mcmon-poll.ps1').Count + ' 个')
    } catch { Note ('采集器启动失败: ' + $_.Exception.Message) }
}

if (-not $hasMon) {
    $argLine = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $monPs + '"'
    try {
        Start-Process -FilePath 'powershell.exe' -ArgumentList $argLine -WindowStyle Hidden -ErrorAction Stop | Out-Null
        Start-Sleep -Seconds 3
        Note ('启动监控窗口 -> 现在 ' + (Get-Procs 'McServerMonitor.ps1').Count + ' 个')
    } catch { Note ('窗口启动失败: ' + $_.Exception.Message) }
}
