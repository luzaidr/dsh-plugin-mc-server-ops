# =====================================================================
#  Minecraft 服务器状态采集器
#  由 McServerMonitor.ps1 后台调用；把状态写成 JSON 供窗口读取
#  参数由监控窗口自动传入
# =====================================================================
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'mcmon-config.json'),
    [string]$OutPath    = (Join-Path $env:TEMP 'mcmon_state.json')
)

$ErrorActionPreference = 'SilentlyContinue'

function Write-State {
    param($Obj, [string]$Path)
    $json = $Obj | ConvertTo-Json -Depth 6 -Compress
    $tmp = $Path + '.tmp'
    [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $Path -Force
}

# ---------- 单例锁 ----------
$lockPath = Join-Path $env:TEMP 'mcmon_poller.lock'
if (Test-Path -LiteralPath $lockPath) {
    $oldPid = 0
    try { $oldPid = [int]((Get-Content -LiteralPath $lockPath -Raw) -replace '\s','') } catch {}
    if ($oldPid -gt 0) {
        $alive = $null
        try { $alive = Get-Process -Id $oldPid -ErrorAction SilentlyContinue } catch {}
        if ($alive) { return }
    }
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
[System.IO.File]::WriteAllText($lockPath, $PID.ToString(), (New-Object System.Text.UTF8Encoding($false)))

# ---------- 配置 ----------
$cfg = @{ host = '127.0.0.1'; port = 25575; pass = ''; interval = 5; label = 'Minecraft Server' }
if (Test-Path -LiteralPath $ConfigPath) {
    try {
        $raw = [System.IO.File]::ReadAllText($ConfigPath, [System.Text.Encoding]::UTF8)
        $c = $raw | ConvertFrom-Json
        if ($c.host)     { $cfg.host = [string]$c.host }
        if ($c.port)     { $cfg.port = [int]$c.port }
        if ($c.pass)     { $cfg.pass = [string]$c.pass }
        if ($c.interval) { $cfg.interval = [int]$c.interval }
        if ($c.label)    { $cfg.label = [string]$c.label }
    } catch {}
}

# ---------- RCON ----------
function Send-RconPacket {
    param([System.IO.Stream]$Stream, [int]$Id, [int]$Type, [string]$Body)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
    $len = 4 + 4 + $bytes.Length + 2
    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)
    $bw.Write([int]$len); $bw.Write([int]$Id); $bw.Write([int]$Type)
    $bw.Write($bytes, 0, $bytes.Length); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Flush()
    $arr = $ms.ToArray(); $bw.Close()
    $Stream.Write($arr, 0, $arr.Length); $Stream.Flush()
}

function Read-RconPacket {
    param([System.IO.Stream]$Stream)
    $hdr = New-Object byte[] 4
    $r = 0
    while ($r -lt 4) { $n = $Stream.Read($hdr, $r, 4 - $r); if ($n -le 0) { return $null }; $r += $n }
    $len = [BitConverter]::ToInt32($hdr, 0)
    if ($len -le 0 -or $len -gt 500000) { return $null }
    $buf = New-Object byte[] $len
    $r = 0
    while ($r -lt $len) { $n = $Stream.Read($buf, $r, $len - $r); if ($n -le 0) { break }; $r += $n }
    return [PSCustomObject]@{
        Id   = [BitConverter]::ToInt32($buf, 0)
        Body = [System.Text.Encoding]::UTF8.GetString($buf, 8, [Math]::Max(0, $r - 10))
    }
}

function Read-MorePackets {
    param([System.IO.Stream]$Stream, [System.Net.Sockets.TcpClient]$Tcp, [int]$IdleMs = 900, [int]$OrigTimeout = 6000)
    $extra = New-Object System.Text.StringBuilder
    $Tcp.ReceiveTimeout = $IdleMs
    for ($i = 0; $i -lt 40; $i++) {
        try { $p = Read-RconPacket -Stream $Stream } catch { $p = $null }
        if ($null -eq $p) { break }
        [void]$extra.Append($p.Body)
    }
    $Tcp.ReceiveTimeout = $OrigTimeout
    return $extra.ToString()
}

function Get-ServerState {
    $state = [ordered]@{
        ok = $false; time = (Get-Date).ToString('HH:mm:ss'); ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        players = 0; maxPlayers = 0; playerNames = @(); tps = 0.0; mspt = 0.0; pingMs = 0
        dims = @(); error = $null; label = $cfg.label
    }
    $tcp = $null
    try {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $tcp = New-Object System.Net.Sockets.TcpClient
        $iar = $tcp.BeginConnect($cfg.host, $cfg.port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(6000)) { throw '连接超时' }
        $tcp.EndConnect($iar)
        $tcp.ReceiveTimeout = 6000
        $st = $tcp.GetStream()

        Send-RconPacket -Stream $st -Id 1 -Type 3 -Body $cfg.pass
        $auth = Read-RconPacket -Stream $st
        if ($null -eq $auth) { throw '认证无响应' }
        if ($auth.Id -eq -1) { throw 'RCON 密码错误' }

        Send-RconPacket -Stream $st -Id 2 -Type 2 -Body 'list'
        $r1 = Read-RconPacket -Stream $st
        $listText = if ($r1) { $r1.Body } else { '' }
        if ($listText -match 'There are (\d+) of a max of (\d+) players online:?\s*(.*)$') {
            $state.players = [int]$matches[1]
            $state.maxPlayers = [int]$matches[2]
            if ($matches[3].Trim()) {
                $state.playerNames = @($matches[3].Trim().Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
            }
        }

        Send-RconPacket -Stream $st -Id 3 -Type 2 -Body 'forge tps'
        $r2 = Read-RconPacket -Stream $st
        $tpsText = if ($r2) { $r2.Body } else { '' }
        $tpsText += (Read-MorePackets -Stream $st -Tcp $tcp)
        $dims = @()
        foreach ($line in ($tpsText -split "`r?`n")) {
            if ($line -match '^(?:Dim\s+)?([\w:\.\-]+)\s*\(([^)]*)\):\s*Mean tick time:\s*([\d\.]+)\s*ms\.\s*Mean TPS:\s*([\d\.]+)') {
                $dims += [PSCustomObject]@{ name = $matches[1]; mspt = [double]$matches[3]; tps = [double]$matches[4] }
            } elseif ($line -match 'Overall:\s*Mean tick time:\s*([\d\.]+)\s*ms\.\s*Mean TPS:\s*([\d\.]+)') {
                $state.mspt = [double]$matches[1]; $state.tps = [double]$matches[2]
            }
        }
        $state.dims = @($dims)

        $sw.Restart()
        Send-RconPacket -Stream $st -Id 4 -Type 2 -Body 'time query gametime'
        $null = Read-RconPacket -Stream $st
        $sw.Stop()
        $state.pingMs = [int]$sw.ElapsedMilliseconds
        $state.ok = $true
    } catch {
        $state.error = $_.Exception.Message
    } finally {
        if ($tcp) { try { $tcp.Close() } catch {} }
    }
    return $state
}

$interval = [Math]::Max(2, $cfg.interval)
while ($true) {
    $s = Get-ServerState
    Write-State -Obj $s -Path $OutPath
    Start-Sleep -Seconds $interval
}
