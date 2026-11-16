# =====================================================================
#  一键发布脚本
#  作用：检查环境 → 打 tag → 推送 GitHub/Gitee → 发 npm
#  用法：powershell -NoProfile -ExecutionPolicy Bypass -File publish.ps1
# =====================================================================
$ErrorActionPreference = 'Continue'
$Dir = $PSScriptRoot
Push-Location $Dir
try {
    Write-Host "`n===== 0. 当前版本 =====" -ForegroundColor Cyan
    $pkg = Get-Content (Join-Path $Dir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Write-Host ("  " + $pkg.name + "  v" + $pkg.version)

    Write-Host "`n===== 1. 环境检查 =====" -ForegroundColor Cyan
    $git = Get-Command git -ExeOnly -ErrorAction SilentlyContinue
    if ($git) { Write-Host ("  ✅ git  " + (& git --version)) -ForegroundColor Green }
    else { Write-Host "  ❌ git 未安装 → https://git-scm.com/download/win" -ForegroundColor Red }

    $npm = Get-Command npm -ExeOnly -ErrorAction SilentlyContinue
    if ($npm) { Write-Host ("  ✅ npm  " + (& npm --version)) -ForegroundColor Green }
    else { Write-Host "  ❌ npm 未安装 → https://nodejs.org/" -ForegroundColor Red }

    Write-Host "`n===== 2. 语法检查 =====" -ForegroundColor Cyan
    if ($npm) {
        & node --check (Join-Path $Dir 'lib/index.js')
        & node --check (Join-Path $Dir 'lib/rcon.js')
        & node --check (Join-Path $Dir 'lib/ssh.js')
        & node --check (Join-Path $Dir 'lib/monitor.js')
        & node --check (Join-Path $Dir 'lib/datapacks.js')
        & node --check (Join-Path $Dir 'lib/diagnose.js')
        if ($LASTEXITCODE -eq 0) { Write-Host "  ✅ 全部通过" -ForegroundColor Green }
    } else {
        Write-Host "  跳过（没有 node）" -ForegroundColor Yellow
    }

    Write-Host "`n===== 3. 敏感信息扫描 =====" -ForegroundColor Cyan
    $bad = @()
    # 用「形状」匹配，而不是写死具体密码（否则这个脚本本身会泄露）
    $patterns = @(
        'rcon\.password\s*=\s*\S+',          # server.properties 里的 rcon 密码
        '\b\d{1,3}(\.\d{1,3}){3}\b',          # IPv4 地址（示例 IP 也会被提示，确认后可忽略）
        '[A-Za-z0-9]{16,}',                   # 长度 ≥16 的连续字符串（疑似密码/token）
        '[a-z0-9-]+\.(?:cn|com|net|top|xyz)'  # 具体域名
    )
    $allowList = @('play\.example\.com', 'example\.com', 'minecraft\.net', 'deepseek\.com', 'curseforge\.com', 'modrinth\.com', 'github\.com', 'gitee\.com', 'npmjs\.com')
    Get-ChildItem $Dir -Recurse -File | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.git\\' } | ForEach-Object {
        $c = $null
        try { $c = [System.IO.File]::ReadAllText($_.FullName, [System.Text.Encoding]::UTF8) } catch { return }
        foreach ($p in $patterns) {
            if ($c -match $p) { $bad += ($_.FullName.Replace($Dir,'') + '  ← ' + $p) }
        }
    }
    # 过 allowList
    $bad = @($bad | Where-Object {
        $line = $_
        -not ($allowList | Where-Object { $line -match $_ })
    })
    if ($bad.Count -gt 0) {
        Write-Host "  ⚠ 以下位置可能含敏感信息，请人工确认（确认无误后可以 continue）：" -ForegroundColor Yellow
        $bad | Select-Object -First 20 | ForEach-Object { Write-Host ("    " + $_) -ForegroundColor Yellow }
        $ans = Read-Host "  仍要继续发布吗？(y/N)"
        if ($ans -notmatch '^[Yy]') { Write-Host "  已中止。" -ForegroundColor Red; exit 1 }
    }
    Write-Host "  ✅ 干净" -ForegroundColor Green

    Write-Host "`n===== 4. 打 tag 并推送（GitHub）====" -ForegroundColor Cyan
    Write-Host "  如果还没建仓库，先在 GitHub 建一个空仓库，然后执行：" -ForegroundColor Yellow
    Write-Host '    git remote add origin https://github.com/<你的用户名>/dsh-plugin-mc-server-ops.git' -ForegroundColor Gray
    Write-Host '    git push -u origin main' -ForegroundColor Gray
    Write-Host '    git tag -a v0.1.0 -m "v0.1.0 首个版本"' -ForegroundColor Gray
    Write-Host '    git push origin v0.1.0' -ForegroundColor Gray

    Write-Host "`n  推 Gitee（国内更快）：" -ForegroundColor Yellow
    Write-Host '    git remote add gitee https://gitee.com/<你的用户名>/dsh-plugin-mc-server-ops.git' -ForegroundColor Gray
    Write-Host '    git push gitee main --tags' -ForegroundColor Gray

    Write-Host "`n===== 5. 发布到 npm =====" -ForegroundColor Cyan
    Write-Host '    npm login' -ForegroundColor Gray
    Write-Host '    npm pack --dry-run    # 先看看会打包哪些文件' -ForegroundColor Gray
    Write-Host '    npm publish --access public' -ForegroundColor Gray
    Write-Host "`n  发布后用户就能装：" -ForegroundColor Yellow
    Write-Host ('    dsh plugin --profile desktop add ' + $pkg.name) -ForegroundColor Gray

    Write-Host "`n===== 6. 上架到插件市场 =====" -ForegroundColor Cyan
    Write-Host '  详见 docs/UPLOAD.md（里面写了 SkillHub 等平台需要填哪些字段）' -ForegroundColor Gray

    Write-Host "`n===== 完成 =====" -ForegroundColor Green
} finally {
    Pop-Location
    Read-Host "`n按回车关闭"
}