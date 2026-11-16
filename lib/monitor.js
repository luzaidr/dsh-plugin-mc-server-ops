/**
 * 桌面监控组件：把 WinForms 浮窗 + 后台采集器 + 保活计划任务
 * 一键部署到指定目录。
 *
 * 架构（关键设计，实战验证过）：
 *   采集器（独立进程）──写──> %TEMP%\mcmon_state.json ──读──> 窗口
 *   好处：RCON 超时/慢响应不会让窗口卡死
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(__dirname, "..", "assets");
const isWin = os.platform() === "win32";

const ASSET_FILES = ["McServerMonitor.ps1", "mcmon-poll.ps1", "start-monitor.vbs", "mcmon-keepalive.ps1"];

/** 列出可部署的组件 */
export function listAssets() {
  return ASSET_FILES.filter((f) => fs.existsSync(path.join(ASSETS, f)));
}

/**
 * 安装监控组件到目标目录
 * @param {object} opts
 * @param {string} opts.targetDir   目标目录（不存在会自动创建）
 * @param {string} opts.host        RCON 主机
 * @param {number} opts.port        RCON 端口
 * @param {string} opts.pass        RCON 密码
 * @param {number} [opts.interval]  刷新间隔（秒）
 * @param {string} [opts.label]     窗口标题
 */
export function installMonitor(opts) {
  if (!isWin) {
    throw new Error("桌面监控组件依赖 Windows WinForms，目前只支持 Windows 目标机。");
  }
  const dir = path.resolve(opts.targetDir);
  fs.mkdirSync(dir, { recursive: true });

  const copied = [];
  for (const f of ASSET_FILES) {
    const src = path.join(ASSETS, f);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(dir, f);
    fs.copyFileSync(src, dst);
    copied.push(f);
  }

  const cfg = {
    host: opts.host,
    port: opts.port,
    pass: opts.pass,
    interval: opts.interval ?? 5,
    label: opts.label ?? "Minecraft Server",
  };
  fs.writeFileSync(path.join(dir, "mcmon-config.json"), JSON.stringify(cfg, null, 2), "utf8");

  return { dir, copied, config: cfg };
}

/** 立刻启动监控（调用 VBS，无黑窗口） */
export function startMonitor(dir) {
  const vbs = path.join(path.resolve(dir), "start-monitor.vbs");
  if (!fs.existsSync(vbs)) throw new Error(`找不到 ${vbs}`);
  const child = spawn("wscript.exe", [`"${vbs}"`], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  return { started: true, vbs };
}

/** 停止监控（窗口 + 采集器） */
export function stopMonitor() {
  const script = `
$myPid = $PID
$all = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue)
$killed = 0
foreach ($x in @($all | Where-Object { $_.ProcessId -ne $myPid -and $_.CommandLine -and ($_.CommandLine.Contains('mcmon-poll.ps1') -or $_.CommandLine.Contains('McServerMonitor.ps1')) })) {
  Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue
  $killed++
}
Remove-Item (Join-Path $env:TEMP 'mcmon_poller.lock') -Force -ErrorAction SilentlyContinue
Write-Output ("killed=" + $killed)
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((resolve) => {
    const child = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { windowsHide: true });
    let out = "";
    child.stdout?.on("data", (d) => (out += d));
    child.on("close", () => resolve({ output: out.trim() }));
    child.on("error", (e) => resolve({ output: String(e?.message ?? e) }));
  });
}

/**
 * 注册保活计划任务（登录自启 + 每 N 分钟检查）
 * @param {object} opts
 * @param {string} opts.dir
 * @param {number} [opts.everyMinutes]
 * @param {string} [opts.taskName]
 */
export function registerKeepalive(opts) {
  const dir = path.resolve(opts.dir);
  const kp = path.join(dir, "mcmon-keepalive.ps1");
  if (!fs.existsSync(kp)) throw new Error(`找不到 ${kp}`);
  const name = opts.taskName ?? "McServerMonitor";
  const every = opts.everyMinutes ?? 5;

  const script = `
$name = '${name}'
$kp = '${kp.replace(/'/g, "''")}'
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
$act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $kp + '"')
$t1 = New-ScheduledTaskTrigger -AtLogOn
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes ${every})
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $name -Action $act -Trigger @($t1, $t2) -Settings $set -Description 'Minecraft 服务器桌面监控 保活' -Force -ErrorAction Stop | Out-Null
$t = Get-ScheduledTask -TaskName $name
$i = Get-ScheduledTaskInfo -TaskName $name
Write-Output ('OK name=' + $t.TaskName + ' state=' + $t.State + ' next=' + $i.NextRunTime)
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    const child = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { windowsHide: true });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (err += d));
    child.on("close", (code) => {
      if (code === 0 && /OK /i.test(out)) resolve({ ok: true, output: out.trim() });
      else reject(new Error((err || out || "注册计划任务失败").trim().slice(0, 600)));
    });
    child.on("error", (e) => reject(e));
  });
}

/** 卸载保活任务 */
export function unregisterKeepalive(taskName = "McServerMonitor") {
  const script = `
Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false -ErrorAction SilentlyContinue
Write-Output 'REMOVED'
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((resolve) => {
    const child = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { windowsHide: true });
    let out = "";
    child.stdout?.on("data", (d) => (out += d));
    child.on("close", () => resolve({ ok: /REMOVED/.test(out), output: out.trim() }));
    child.on("error", (e) => resolve({ ok: false, output: String(e?.message ?? e) }));
  });
}

/** 读当前状态 JSON（采集器写的） */
export function readMonitorState() {
  const p = path.join(os.tmpdir(), "mcmon_state.json");
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, "utf8");
    const j = JSON.parse(raw);
    const stat = fs.statSync(p);
    return { ...j, ageSeconds: Math.round((Date.now() - stat.mtimeMs) / 1000) };
  } catch {
    return null;
  }
}
