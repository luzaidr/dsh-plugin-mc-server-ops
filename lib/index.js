/**
 * dsh-plugin-mc-server-ops
 * Minecraft 服务器部署与运维工具箱（DSH 宿主插件）
 *
 * 提供的工具：
 *   mc_status            服务器状态快照
 *   mc_rcon              执行任意 RCON 命令
 *   mc_diagnose          卡顿诊断（TPS/MSPT/实体/日志/资源）
 *   mc_cleanup           清理异常实体（falling_block / item / 指定类型）
 *   mc_announce          全服广播
 *   mc_restart           公告 + 保存 + 优雅停服（可自动重启）
 *   mc_log               读取服务器日志尾部
 *   mc_config            读写 server.properties
 *   mc_install_datapack  生成并安装数据包（item-cleaner）
 *   mc_monitor           桌面监控小组件（安装/启动/停止/保活）
 *   mc_deploy            生成 Windows VPS 部署脚本包
 *   mc_pitfalls          Minecraft 运维知识库（坑与解法）
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import z from "@deepseek-ai/schemastery";
import { rconOnce, rconPing, RconConnection } from "./rcon.js";
import { SshSession, cleanOutput } from "./ssh.js";
import { diagnose, renderDiagnosis, parseForgeTps, parsePlayerList, parseEntityList, analyzeLagLog } from "./diagnose.js";
import { buildItemCleaner, listDatapacks } from "./datapacks.js";
import {
  installMonitor,
  startMonitor,
  stopMonitor,
  registerKeepalive,
  unregisterKeepalive,
  readMonitorState,
  listAssets,
} from "./monitor.js";

export const name = "mc-server-ops";

export const Config = z.object({
  servers: z.any().default({}),
  defaultServer: z.string().default(""),
  timeoutMs: z.number().default(15000),
  monitorDir: z.string().default(""),
});

export const inject = ["tools"];

const isWin = os.platform() === "win32";

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function normalizeServers(config) {
  const raw = config.servers ?? {};
  if (Array.isArray(raw)) {
    const out = {};
    for (const s of raw) {
      if (s && s.name) out[s.name] = s;
    }
    return out;
  }
  return typeof raw === "object" ? raw : {};
}

function resolveServer(config, requested) {
  const servers = normalizeServers(config);
  const key = requested || config.defaultServer || Object.keys(servers)[0];
  const s = key ? servers[key] : undefined;
  if (!s) {
    throw new Error(
      `未找到服务器配置「${key ?? "(空)"}」。请在插件设置里配置 servers，例如：\n` +
        JSON.stringify(
          {
            servers: {
              main: {
                label: "我的服务器",
                host: "play.example.com",
                rconPort: 25575,
                rconPass: "your-rcon-password",
                ssh: { host: "play.example.com", port: 22, user: "Administrator", password: "..." },
                serverDir: "D:\\\\mcpack",
                javaMemMaxGB: 12,
              },
            },
            defaultServer: "main",
          },
          null,
          2,
        ),
    );
  }
  return { key, ...s };
}

function rconOpts(server, config) {
  return {
    host: server.host,
    port: server.rconPort ?? 25575,
    password: server.rconPass ?? server.rconPassword ?? "",
    timeoutMs: config.timeoutMs ?? 15000,
  };
}

function sshSession(server) {
  const cfg = server.ssh;
  if (!cfg || !cfg.host) return null;
  return new SshSession({
    host: cfg.host,
    port: cfg.port ?? 22,
    user: cfg.user ?? "Administrator",
    password: cfg.password ?? "",
    hostKey: cfg.hostKey,
    plinkPath: cfg.plinkPath,
  });
}

function text(value) {
  return [{ type: "text", text: String(value) }];
}

function safeErr(e) {
  const msg = String(e?.message ?? e);
  if (e?.code === "RCON_AUTH_FAILED") return `RCON 密码错误。请检查配置里的 rconPass。`;
  if (e?.code === "RCON_CONNECT_TIMEOUT") return `RCON 连接超时：${msg}\n排查：① 服务器是否在运行 ② 防火墙/端口映射 ③ 主机端口是否写对（RCON 不是游戏端口）`;
  if (e?.code === "RCON_NO_RESPONSE") return `RCON 无响应：${msg}`;
  return msg;
}

/** 简易轮询等待 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// 工具定义
// ---------------------------------------------------------------------------

function toolMcStatus(ctx, config) {
  return {
    name: "mc_status",
    description:
      "获取 Minecraft 服务器状态快照：在线人数与玩家名、TPS、MSPT、各维度 tick 时间、RCON 往返延迟。需要服务器开启 RCON。",
    parameters: {
      server: { type: "string", description: "服务器名称（插件配置 servers 里的 key）。省略则用 defaultServer。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          server: { type: "string" },
          online: { type: "integer" },
          max: { type: "integer" },
          players: { type: "array", items: { type: "string" } },
          tps: { type: "number" },
          mspt: { type: "number" },
          latencyMs: { type: "integer" },
          dims: { type: "array", items: { type: "object", additionalProperties: true } },
          summary: { type: "string" },
          error: { type: "string" },
        },
      },
      render: (_a, v) => text(v.summary ?? (v.error ? `❌ ${v.error}` : "")),
    },
    async execute(args, exec) {
      const server = resolveServer(config, args.server);
      const opts = rconOpts(server, config);
      const ping = await rconPing(opts);
      if (!ping.ok) {
        return { ok: false, server: server.key, error: ping.error ?? "RCON 连不上", summary: `❌ 无法连接 ${server.key}（${server.host}:${opts.port}）：${ping.error ?? ""}` };
      }
      const res = await rconOnce(opts, ["list", "forge tps"]);
      const players = parsePlayerList(res[0].output);
      const tps = parseForgeTps(res[1].output);
      const lines = [
        `【${server.label ?? server.key}】${players.online} / ${players.max} 人在线`,
        `TPS：${tps.overall?.tps ?? "?"}   MSPT：${tps.overall?.mspt ?? "?"} ms   RCON 延迟：${ping.latencyMs} ms`,
      ];
      if (players.names.length) lines.push(`玩家：${players.names.join("、")}`);
      const bad = tps.dims.filter((d) => d.mspt > 25);
      lines.push(bad.length ? `⚠ ${bad.length} 个维度 MSPT 超过 25ms` : `全部 ${tps.dims.length} 个维度正常`);
      return {
        ok: true,
        server: server.key,
        online: players.online,
        max: players.max,
        players: players.names,
        tps: tps.overall?.tps ?? 0,
        mspt: tps.overall?.mspt ?? 0,
        latencyMs: ping.latencyMs,
        dims: tps.dims,
        summary: lines.join("\n"),
      };
    },
  };
}

function toolMcRcon(ctx, config) {
  return {
    name: "mc_rcon",
    description:
      "在 Minecraft 服务器上执行 RCON 命令（一条或多条）。支持 list / say / op / give / gamerule / forge tps / forge entity list / save-all flush / stop 等所有服务端命令。",
    parameters: {
      commands: {
        type: "array",
        required: true,
        description: "要执行的命令列表（不要带前导斜杠）。",
        items: { type: "string" },
      },
      server: { type: "string", description: "服务器名称，省略用 defaultServer。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          results: { type: "array", items: { type: "object", additionalProperties: true } },
          summary: { type: "string" },
          error: { type: "string" },
        },
      },
      render: (_a, v) => text(v.summary ?? (v.error ? `❌ ${v.error}` : "")),
    },
    async execute(args) {
      const server = resolveServer(config, args.server);
      try {
        const res = await rconOnce(rconOpts(server, config), args.commands);
        const results = res.map((r) => ({ command: r.command, output: r.output.trim() }));
        const summary = results.map((r) => `> ${r.command}\n${r.output || "(无输出)"}`).join("\n\n");
        return { ok: true, results, summary };
      } catch (e) {
        return { ok: false, results: [], error: safeErr(e), summary: `❌ ${safeErr(e)}` };
      }
    },
  };
}

function toolMcDiagnose(ctx, config) {
  return {
    name: "mc_diagnose",
    description:
      "Minecraft 卡顿诊断：采集 TPS/MSPT、各维度 tick、实体统计（含 falling_block 掉落方块）、日志里的 Can't keep up 告警，并通过 SSH 读取 java 堆内存和 CPU，给出分级结论与处理建议。",
    parameters: {
      server: { type: "string", description: "服务器名称，省略用 defaultServer。" },
      includeSystem: { type: "boolean", description: "是否通过 SSH 读取系统资源（需要配置 ssh）。默认 true。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          severity: { type: "string" },
          summary: { type: "string" },
          findings: { type: "array", items: { type: "object", additionalProperties: true } },
          actions: { type: "array", items: { type: "string" } },
          report: { type: "string" },
          error: { type: "string" },
        },
      },
      render: (_a, v) => text(v.report ?? v.summary ?? (v.error ? `❌ ${v.error}` : "")),
    },
    async execute(args) {
      const server = resolveServer(config, args.server);
      const opts = rconOpts(server, config);
      let tpsText = "";
      let listText = "";
      let entityText = "";
      try {
        const res = await rconOnce(opts, ["forge tps", "list", "forge entity list"]);
        tpsText = res[0].output;
        listText = res[1].output;
        entityText = res[2].output;
      } catch (e) {
        return { ok: false, error: safeErr(e), summary: `❌ ${safeErr(e)}`, report: `❌ 诊断失败：${safeErr(e)}` };
      }

      let logText = "";
      let system = null;
      const wantSystem = args.includeSystem !== false;
      const ssh = wantSystem ? sshSession(server) : null;
      if (ssh) {
        try {
          const dir = server.serverDir ?? "/opt/minecraft";
          const r = await ssh.powershell(`
$dir = '${dir.replace(/'/g, "''")}'
$log = Join-Path $dir 'logs/latest.log'
if (Test-Path $log) { Get-Content $log -Tail 400 } else { Write-Output '[NO_LOG]' }
`);
          logText = cleanOutput(r.stdout).join("\n");
          const r2 = await ssh.powershell(`
$j = Get-Process java -ErrorAction SilentlyContinue | Select-Object -First 1
$os = Get-CimInstance Win32_OperatingSystem
$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
if ($j) { Write-Output ('JAVA_GB=' + [math]::Round($j.WorkingSet64/1GB,2)) }
Write-Output ('CPU=' + $cpu)
Write-Output ('FREE_GB=' + [math]::Round($os.FreePhysicalMemory/1MB,1))
Write-Output ('TOTAL_GB=' + [math]::Round($os.TotalVisibleMemorySize/1MB,1))
`);
          const joined = cleanOutput(r2.stdout).join("\n");
          const gv = (re) => {
            const m = re.exec(joined);
            return m ? Number(m[1]) : undefined;
          };
          system = {
            javaMemGB: gv(/JAVA_GB=([\d.]+)/),
            javaMemMaxGB: server.javaMemMaxGB,
            cpuPercent: gv(/CPU=([\d.]+)/),
            freeMemGB: gv(/FREE_GB=([\d.]+)/),
            totalMemGB: gv(/TOTAL_GB=([\d.]+)/),
          };
        } catch {
          // SSH 失败不影响 RCON 侧诊断
        }
      }

      const d = diagnose({ tpsText, listText, entityText, logText, system });
      const report = renderDiagnosis(d);
      return {
        ok: true,
        severity: d.severity,
        summary: d.summary,
        findings: d.findings,
        actions: d.actions,
        report,
      };
    },
  };
}

function toolMcCleanup(ctx, config) {
  return {
    name: "mc_cleanup",
    description:
      "清理服务器上的异常实体。常用：falling_block（掉落的沙砾/沙子，最常见的隐形卡顿源）、item（掉落物）、experience_orb（经验球）。注意 @e 是全局选择器，execute in <维度> 并不能限定作用范围。",
    parameters: {
      target: {
        type: "string",
        required: true,
        description: "清理目标：falling_block | item | experience_orb | 任意实体 ID（如 minecraft:zombie）",
      },
      dimension: { type: "string", description: "可选的维度过滤（如 minecraft:overworld）。省略则全局。" },
      limitWarn: { type: "boolean", description: "清理前先报告数量。默认 true。" },
      server: { type: "string", description: "服务器名称。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          before: { type: "integer" },
          killed: { type: "string" },
          summary: { type: "string" },
          error: { type: "string" },
        },
      },
      render: (_a, v) => text(v.summary ?? (v.error ? `❌ ${v.error}` : "")),
    },
    async execute(args) {
      const server = resolveServer(config, args.server);
      const typeId = args.target.includes(":") ? args.target : `minecraft:${args.target}`;
      let selector = `@e[type=${typeId}]`;
      if (args.dimension) selector = `@e[type=${typeId},x=0,y=-1000,z=0,distance=0]`;
      try {
        const conn = new RconConnection(rconOpts(server, config));
        try {
          await conn.connect();
          // 先数一遍（execute if entity 能返回 count）
          const probe = await conn.exec(`execute if entity ${selector}`);
          const m = /count:\s*(\d+)/.exec(probe);
          const before = m ? Number(m[1]) : 0;

          let killedText = "";
          if (args.dimension) {
            const r = await conn.exec(`execute in ${args.dimension} run kill @e[type=${typeId}]`);
            killedText = r.trim();
          } else {
            const r = await conn.exec(`kill ${selector}`);
            killedText = r.trim();
          }
          return {
            ok: true,
            before,
            killed: killedText,
            summary: `清理 ${typeId}\n清理前数量：${before}\n结果：${killedText || "(无输出)"}`,
          };
        } finally {
          conn.close();
        }
      } catch (e) {
        return { ok: false, before: 0, killed: "", error: safeErr(e), summary: `❌ ${safeErr(e)}` };
      }
    },
  };
}

function toolMcAnnounce(ctx, config) {
  return {
    name: "mc_announce",
    description: "向 Minecraft 服务器全服广播消息（支持多行、可指定颜色样式由调用方用 tellraw JSON 直接控制）。",
    parameters: {
      message: { type: "string", required: true, description: "广播内容（纯文本，会自动转成 tellraw）。" },
      color: { type: "string", description: "文字颜色：gold/yellow/red/green/aqua/white。默认 gold。" },
      sound: { type: "boolean", description: "是否播放提示音。默认 true。" },
      server: { type: "string", description: "服务器名称。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { ok: { type: "boolean", required: true }, summary: { type: "string" }, error: { type: "string" } },
      },
      render: (_a, v) => text(v.summary ?? (v.error ? `❌ ${v.error}` : "")),
    },
    async execute(args) {
      const server = resolveServer(config, args.server);
      const color = args.color ?? "gold";
      const safe = String(args.message).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
      const cmd = `tellraw @a ["",{"text":"[服务器] ","color":"${color}","bold":true},{"text":"${safe}","color":"white"}]`;
      const cmds = [cmd];
      if (args.sound !== false) cmds.push("playsound minecraft:block.note_block.pling master @a ~ ~ ~ 1 1");
      try {
        const res = await rconOnce(rconOpts(server, config), cmds);
        return { ok: true, summary: `已广播到 ${server.key}：${args.message}\n${res.map((r) => r.output.trim()).filter(Boolean).join("\n")}` };
      } catch (e) {
        return { ok: false, error: safeErr(e), summary: `❌ ${safeErr(e)}` };
      }
    },
  };
}

function toolMcRestart(ctx, config) {
  return {
    name: "mc_restart",
    description:
      "带公告的安全重启：倒计时广播 → save-all flush → stop → 等待进程退出 → 通过 SSH 重新启动。适用于 Windows VPS（计划任务启动）或直接跑 run.bat 的服务器。",
    parameters: {
      countdown: { type: "integer", description: "倒计时秒数。默认 30，最小 5。" },
      restart: { type: "boolean", description: "停服后是否自动重启。默认 true（需要配置 ssh）。" },
      save: { type: "boolean", description: "是否 save-all flush。默认 true。" },
      server: { type: "string", description: "服务器名称。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          stopped: { type: "boolean" },
          started: { type: "boolean" },
          summary: { type: "string" },
          error: { type: "string" },
        },
      },
      render: (_a, v) => text(v.summary ?? (v.error ? `❌ ${v.error}` : "")),
    },
    async execute(args) {
      const server = resolveServer(config, args.server);
      const total = Math.max(5, args.countdown ?? 30);
      const opts = rconOpts(server, config);
      const log = [];
      const conn = new RconConnection(opts);
      try {
        await conn.connect();
        await conn.exec(`tellraw @a ["",{"text":"━━━━━━━━━━━━━━━━━━","color":"red","bold":true}]`);
        await conn.exec(`tellraw @a ["",{"text":"【服务器即将重启】","color":"red","bold":true}]`);
        await conn.exec(`tellraw @a ["",{"text":"  ${total} 秒后重启，请整理背包并退出","color":"yellow"}]`);
        await conn.exec(`tellraw @a ["",{"text":"━━━━━━━━━━━━━━━━━━","color":"red","bold":true}]`);
        try {
          await conn.exec(`playsound minecraft:block.note_block.bell master @a ~ ~ ~ 1 1`);
        } catch {}
        log.push(`已广播重启公告（${total} 秒）`);

        const marks = [];
        let remain = total;
        while (remain > 0) {
          const step = remain > 15 ? 10 : remain > 5 ? 5 : 1;
          remain -= step;
          marks.push(remain);
          if (remain > 0) {
            try {
              await conn.exec(`tellraw @a ["",{"text":"[重启] ","color":"red","bold":true},{"text":"${remain} 秒后重启","color":"yellow"}]`);
            } catch {}
          }
          await sleep(Math.min(step, 5) * 1000);
        }
        log.push(`倒计时完成（节点：${marks.filter((m) => m > 0).join(", ")}）`);

        if (args.save !== false) {
          const r = await conn.exec("save-all flush");
          log.push(`保存世界：${r.trim() || "ok"}`);
          await sleep(3000);
        }

        const stopRes = await conn.exec("stop");
        log.push(`停服：${stopRes.trim() || "ok"}`);
      } catch (e) {
        conn.close();
        return { ok: false, stopped: false, started: false, error: safeErr(e), summary: `❌ 重启失败：${safeErr(e)}\n\n已完成：\n${log.join("\n")}` };
      }
      conn.close();

      // 等进程退出
      await sleep(15000);

      const ssh = sshSession(server);
      let started = false;
      if (args.restart !== false && ssh) {
        try {
          const killRes = await ssh.powershell(`
$j = Get-Process java -ErrorAction SilentlyContinue
if ($j) { $j | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 8; Write-Output 'FORCED_KILL' } else { Write-Output 'ALREADY_EXITED' }
`);
          log.push(`进程状态：${cleanOutput(killRes.stdout).join(" ") || "unknown"}`);

          // 优先用计划任务启动（独立会话，不会随 SSH 断开被杀）
          const startRes = await ssh.powershell(`
$task = '${(server.startTask ?? "MinecraftServer").replace(/'/g, "''")}'
$t = Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
if ($t) { schtasks /run /tn $task 2>&1 | Out-Null; Write-Output ('STARTED_TASK=' + $task) }
else {
  $bat = '${(server.startBat ?? "").replace(/'/g, "''")}'
  if ($bat -and (Test-Path $bat)) {
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', ('start "" /min "' + $bat + '"') -WorkingDirectory (Split-Path $bat) -WindowStyle Hidden
    Write-Output 'STARTED_BAT'
  } else { Write-Output 'NO_START_METHOD' }
}
`);
          const s = cleanOutput(startRes.stdout).join(" ");
          log.push(`启动：${s}`);
          started = /STARTED_/.test(s);
        } catch (e) {
          log.push(`启动失败：${safeErr(e)}`);
        }
      } else if (args.restart !== false) {
        log.push("⚠ 未配置 ssh，无法自动重启。请手动启动服务器。");
      }

      return {
        ok: true,
        stopped: true,
        started,
        summary: `重启流程完成（${server.key}）\n\n${log.map((l) => "- " + l).join("\n")}`,
      };
    },
  };
}

function toolMcLog(ctx, config) {
  return {
    name: "mc_log",
    description: "读取 Minecraft 服务器日志尾部。可通过 SSH 读远端（推荐），也可读本地文件。会顺带筛出 WARN/ERROR/Can't keep up 行。",
    parameters: {
      lines: { type: "integer", description: "读取行数。默认 60。" },
      filter: { type: "string", description: "只保留匹配此正则的行（可选）。" },
      server: { type: "string", description: "服务器名称。" },
      localPath: { type: "string", description: "直接指定本地日志文件路径（跳过 SSH）。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { ok: { type: "boolean", required: true }, content: { type: "string" }, summary: { type: "string" }, error: { type: "string" } },
      },
      render: (_a, v) => text(v.summary ?? (v.error ? `❌ ${v.error}` : "")),
    },
    async execute(args) {
      const n = Math.max(10, args.lines ?? 60);
      let content = "";

      if (args.localPath) {
        if (!fs.existsSync(args.localPath)) {
          return { ok: false, error: `文件不存在：${args.localPath}`, summary: `❌ 文件不存在：${args.localPath}` };
        }
        const all = fs.readFileSync(args.localPath, "utf8").split(/\r?\n/);
        content = all.slice(-n).join("\n");
      } else {
        const server = resolveServer(config, args.server);
        const ssh = sshSession(server);
        if (!ssh) {
          return { ok: false, error: "未配置 ssh，无法读取远端日志", summary: "❌ 未配置 ssh，无法读取远端日志。也可以在 config 里给服务器加 ssh 配置。" };
        }
        const dir = server.serverDir ?? "/opt/minecraft";
        const r = await ssh.powershell(`
$log = Join-Path '${dir.replace(/'/g, "''")}' 'logs/latest.log'
if (Test-Path $log) { Get-Content $log -Tail ${n} } else { Write-Output '[NO_LOG]' }
`);
        content = cleanOutput(r.stdout).join("\n");
      }

      if (args.filter) {
        let re;
        try {
          re = new RegExp(args.filter);
        } catch (e) {
          return { ok: false, error: `filter 不是合法正则：${e.message}`, summary: `❌ filter 不是合法正则` };
        }
        content = content
          .split(/\r?\n/)
          .filter((l) => re.test(l))
          .join("\n");
      }
      return { ok: true, content, summary: content || "(无内容)" };
    },
  };
}

function toolMcConfig(ctx, config) {
  return {
    name: "mc_config",
    description:
      "读写服务器 server.properties。写入时使用 UTF-8 无 BOM + 每行独立（避免 PowerShell 的 Set-Content 加 BOM 导致 java 把 BOM 当类名报「找不到主类」）。支持同时设置多个键。",
    parameters: {
      keys: { type: "array", items: { type: "string" }, description: "要读取的键（省略则读全部关键项）。" },
      set: { type: "array", items: { type: "string" }, description: "要设置的键值，格式 \"key=value\"。" },
      reload: { type: "boolean", description: "改完是否重启服务器生效。默认 false。" },
      server: { type: "string", description: "服务器名称。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { ok: { type: "boolean", required: true }, values: { type: "object", additionalProperties: true }, summary: { type: "string" }, error: { type: "string" } },
      },
      render: (_a, v) => text(v.summary ?? (v.error ? `❌ ${v.error}` : "")),
    },
    async execute(args) {
      const server = resolveServer(config, args.server);
      const ssh = sshSession(server);
      if (!ssh) {
        return { ok: false, values: {}, error: "未配置 ssh", summary: "❌ 读写 server.properties 需要 ssh 配置。" };
      }
      const dir = server.serverDir ?? "/opt/minecraft";
      const keys = args.keys ?? [
        "server-port", "online-mode", "max-players", "view-distance", "simulation-distance",
        "difficulty", "hardcore", "pvp", "enable-rcon", "rcon.port", "enable-command-block",
        "level-type", "allow-flight", "spawn-protection",
      ];

      if (args.set && args.set.length) {
        const pairs = args.set
          .map((s) => {
            const i = s.indexOf("=");
            return i > 0 ? [s.slice(0, i).trim(), s.slice(i + 1).trim()] : null;
          })
          .filter(Boolean);
        if (pairs.length === 0) {
          return { ok: false, values: {}, error: "set 参数格式应为 key=value", summary: "❌ set 参数格式应为 \"key=value\"" };
        }
        const pairsLiteral = pairs.map(([k, v]) => `  @("${k.replace(/"/g, '""')}","${v.replace(/"/g, '""')}")`).join("\n");

        const script = `
$sp = Join-Path '${dir.replace(/'/g, "''")}' 'server.properties'
if (-not (Test-Path $sp)) { Write-Output 'ERR_NO_FILE'; exit }
$t = [System.IO.File]::ReadAllText($sp)
$t = $t.TrimStart([char]0xFEFF)
$lines = @($t -split "\`r?\`n" | Where-Object { $_.Trim() })
$out = New-Object System.Collections.Generic.List[string]
foreach ($l in $lines) { $out.Add($l.Trim()) }
$pairs = @(
${pairsLiteral}
)
foreach ($pr in $pairs) {
  $k = $pr[0]; $v = $pr[1]
  $hit = $false
  for ($i = 0; $i -lt $out.Count; $i++) {
    if ($out[$i] -match ('^' + [regex]::Escape($k) + '=')) { $out[$i] = $k + '=' + $v; $hit = $true }
  }
  if (-not $hit) { $out.Add($k + '=' + $v) }
}
[System.IO.File]::WriteAllLines($sp, $out.ToArray(), (New-Object System.Text.UTF8Encoding($false)))
Write-Output 'WROTE'
Get-Content $sp | Select-String '${keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}' | ForEach-Object { Write-Output $_.Line }
`;
        const r = await ssh.powershell(script);
        const outLines = cleanOutput(r.stdout);
        if (outLines.includes("ERR_NO_FILE")) {
          return { ok: false, values: {}, error: `找不到 ${dir}/server.properties`, summary: `❌ 找不到 ${dir}\\server.properties` };
        }
        const values = {};
        for (const line of outLines) {
          const m = /^([\w.\-]+)=(.*)$/.exec(line);
          if (m) values[m[1]] = m[2];
        }
        return {
          ok: true,
          values,
          summary: `已写入 ${pairs.length} 项到 ${server.key} 的 server.properties（UTF-8 无 BOM）：\n` +
            pairs.map(([k, v]) => `  ${k}=${v}`).join("\n") +
            (args.reload ? "\n⚠ 需要重启服务器才生效" : "\n提示：大部分配置需要重启服务器才生效"),
        };
      }

      const pattern = keys.join("|");
      const r = await ssh.powershell(`
$sp = Join-Path '${dir.replace(/'/g, "''")}' 'server.properties'
if (Test-Path $sp) { Get-Content $sp | Select-String '${pattern}' | ForEach-Object { $_.Line } } else { Write-Output 'ERR_NO_FILE' }
`);
      const outLines = cleanOutput(r.stdout);
      if (outLines.includes("ERR_NO_FILE")) {
        return { ok: false, values: {}, error: `找不到 ${dir}/server.properties`, summary: `❌ 找不到 ${dir}\\server.properties` };
      }
      const values = {};
      for (const line of outLines) {
        const m = /^([\w.\-]+)=(.*)$/.exec(line);
        if (m) values[m[1]] = m[2];
      }
      return {
        ok: true,
        values,
        summary: `${server.key} 的 server.properties：\n` + Object.entries(values).map(([k, v]) => `  ${k}=${v}`).join("\n"),
      };
    },
  };
}

function toolMcInstallDatapack(ctx, config) {
  return {
    name: "mc_install_datapack",
    description:
      "生成并安装内置数据包。目前内置 item-cleaner（定时清理地面掉落物，防止掉落物堆积卡顿）。会自动处理 UTF-8 无 BOM、pack_format、functions/function 目录差异，并可通过 SSH 部署到远端 world/datapacks。",
    parameters: {
      pack: { type: "string", required: true, description: "数据包 id：item-cleaner" },
      intervalMinutes: { type: "integer", description: "item-cleaner 的清理间隔（分钟）。默认 10。" },
      warnSeconds: { type: "integer", description: "清理前预警秒数。默认 10。" },
      packFormat: { type: "integer", description: "数据包 pack_format。1.20.1=15，1.21.1=48。默认 15。" },
      outputDir: { type: "string", description: "本地生成目录。默认临时目录。" },
      deploy: { type: "boolean", description: "是否通过 SSH 部署到 serverDir/world/datapacks。默认 false。" },
      reload: { type: "boolean", description: "部署后是否执行 RCON reload。默认 false。" },
      server: { type: "string", description: "服务器名称。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          dir: { type: "string" },
          files: { type: "array", items: { type: "string" } },
          deployed: { type: "boolean" },
          summary: { type: "string" },
          error: { type: "string" },
        },
      },
      render: (_a, v) => text(v.summary ?? (v.error ? `❌ ${v.error}` : "")),
    },
    async execute(args) {
      if (args.pack !== "item-cleaner") {
        const list = listDatapacks().map((d) => `${d.id}（${d.name}）`).join("、");
        return { ok: false, dir: "", files: [], deployed: false, error: `未知数据包 ${args.pack}`, summary: `❌ 未知数据包「${args.pack}」。可用：${list}` };
      }
      const outDir = args.outputDir || path.join(os.tmpdir(), "mc-datapacks");
      const built = buildItemCleaner({
        targetDir: outDir,
        intervalMinutes: args.intervalMinutes ?? 10,
        warnSeconds: args.warnSeconds ?? 10,
        packFormat: args.packFormat ?? 15,
      });

      let deployed = false;
      const notes = [];
      if (args.deploy) {
        const server = resolveServer(config, args.server);
        const ssh = sshSession(server);
        if (!ssh) {
          notes.push("⚠ 未配置 ssh，跳过远端部署");
        } else {
          const dir = server.serverDir ?? "/opt/minecraft";
          const destRel = `world/datapacks/${path.basename(built.dir)}`;
          // 用 base64 传输（规避中文路径 / 引号 / 换行）
          const fileEntries = [];
          const walk = (base, rel) => {
            for (const ent of fs.readdirSync(path.join(base, rel), { withFileTypes: true })) {
              const r = path.posix.join(rel, ent.name);
              if (ent.isDirectory()) walk(base, r);
              else fileEntries.push({ rel: r, b64: fs.readFileSync(path.join(base, r)).toString("base64") });
            }
          };
          walk(built.dir, "");
          const payload = JSON.stringify(fileEntries.map((f) => [f.rel, f.b64]));
          const script = `
$dest = Join-Path '${dir.replace(/'/g, "''")}' '${destRel}'
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest -Force | Out-Null
$json = '${payload}'
$files = $json | ConvertFrom-Json
foreach ($f in $files) {
  $rel = $f[0]; $b64 = $f[1]
  $target = Join-Path $dest ($rel -replace '/', '\\')
  $parent = Split-Path $target -Parent
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  [System.IO.File]::WriteAllBytes($target, [System.Convert]::FromBase64String($b64))
}
Write-Output ('DEPLOYED=' + $dest)
Write-Output ('COUNT=' + @($files).Count)
`;
          try {
            const r = await ssh.powershell(script);
            const out = cleanOutput(r.stdout).join("\n");
            deployed = /DEPLOYED=/.test(out);
            notes.push(deployed ? `已部署到 ${destRel}` : `部署输出：${out}`);
          } catch (e) {
            notes.push(`部署失败：${safeErr(e)}`);
          }
        }
      }

      if (args.reload && deployed) {
        try {
          const r = await rconOnce(rconOpts(resolveServer(config, args.server), config), "reload");
          notes.push(`reload：${r[0].output.trim()}`);
        } catch (e) {
          notes.push(`reload 失败：${safeErr(e)}`);
        }
      }

      return {
        ok: true,
        dir: built.dir,
        files: built.files,
        deployed,
        summary:
          `已生成 ${args.pack}（间隔 ${args.intervalMinutes ?? 10} 分钟，预警 ${args.warnSeconds ?? 10} 秒）\n` +
          `目录：${built.dir}\n` +
          `文件：${built.files.join(", ")}\n` +
          `间隔 ticks：${built.intervalTicks}，预警点：${built.warnAt}` +
          (notes.length ? `\n${notes.join("\n")}` : "") +
          `\n\n使用：/reload 或重启服务器后生效。`,
      };
    },
  };
}

function toolMcMonitor(ctx, config) {
  return {
    name: "mc_monitor",
    description:
      "桌面监控小组件（Windows）。安装一个始终置顶的浮窗，实时显示在线人数、TPS、MSPT、RCON 延迟、TPS 曲线、玩家列表。采用「采集器 + 窗口」双进程架构，窗口永不卡顿。支持一键安装、启动、停止、注册保活计划任务。",
    parameters: {
      action: { type: "string", required: true, description: "install | start | stop | status | keepalive | keepalive-remove | list-assets" },
      dir: { type: "string", description: "安装目录。默认 %USERPROFILE%\\Desktop\\McServerMonitor。" },
      label: { type: "string", description: "窗口标题。默认取服务器 label。" },
      interval: { type: "integer", description: "刷新间隔（秒）。默认 5。" },
      everyMinutes: { type: "integer", description: "保活检查间隔（分钟）。默认 5。" },
      server: { type: "string", description: "服务器名称。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          dir: { type: "string" },
          state: { type: "object", additionalProperties: true },
          summary: { type: "string" },
          error: { type: "string" },
        },
      },
      render: (_a, v) => text(v.summary ?? (v.error ? `❌ ${v.error}` : "")),
    },
    async execute(args) {
      const action = args.action;
      const dir = args.dir || config.monitorDir || path.join(os.homedir(), "Desktop", "McServerMonitor");

      try {
        if (action === "list-assets") {
          const a = listAssets();
          return { ok: true, dir, summary: `可用组件：\n${a.map((x) => "- " + x).join("\n")}` };
        }

        if (action === "install") {
          const server = resolveServer(config, args.server);
          const r = installMonitor({
            targetDir: dir,
            host: server.host,
            port: server.rconPort ?? 25575,
            pass: server.rconPass ?? server.rconPassword ?? "",
            interval: args.interval ?? 5,
            label: args.label ?? server.label ?? server.key,
          });
          return {
            ok: true,
            dir: r.dir,
            summary:
              `✅ 监控组件已安装到：${r.dir}\n` +
              `文件：${r.copied.join(", ")}\n` +
              `配置：host=${r.config.host} rconPort=${r.config.port} interval=${r.config.interval}s label=${r.config.label}\n\n` +
              `下一步：mc_monitor action=start 启动，或 mc_monitor action=keepalive 注册开机自启+每 5 分钟保活。`,
          };
        }

        if (action === "start") {
          startMonitor(dir);
          await sleep(2000);
          const st = readMonitorState();
          return {
            ok: true,
            dir,
            state: st ?? {},
            summary: `✅ 已启动监控窗口（${dir}）\n` + (st ? `当前数据：${st.players}/${st.maxPlayers} 人  TPS ${st.tps}  MSPT ${st.mspt}ms  延迟 ${st.pingMs}ms` : "（采集器还在启动，几秒后会有数据）"),
          };
        }

        if (action === "stop") {
          const r = await stopMonitor();
          return { ok: true, dir, summary: `已停止监控：${r.output}` };
        }

        if (action === "status") {
          const st = readMonitorState();
          if (!st) return { ok: true, dir, summary: "采集器还没有写过状态（可能未启动）" };
          return {
            ok: true,
            dir,
            state: st,
            summary:
              `监控状态（数据 ${st.ageSeconds}s 前）\n` +
              `在线：${st.players} / ${st.maxPlayers}${st.playerNames?.length ? "  （" + st.playerNames.join("、") + "）" : ""}\n` +
              `TPS：${st.tps}   MSPT：${st.mspt} ms   RCON 延迟：${st.pingMs} ms\n` +
              `维度：${(st.dims ?? []).length} 个\n` +
              `更新时间：${st.ts}` +
              (st.ageSeconds > 30 ? "\n⚠ 数据已过期，采集器可能已停止" : ""),
          };
        }

        if (action === "keepalive") {
          const r = await registerKeepalive({ dir, everyMinutes: args.everyMinutes ?? 5 });
          return { ok: true, dir, summary: `✅ 保活计划任务已注册：\n${r.output}` };
        }

        if (action === "keepalive-remove") {
          const r = await unregisterKeepalive();
          return { ok: r.ok, dir, summary: r.ok ? "已移除保活计划任务" : `移除结果：${r.output}` };
        }

        return { ok: false, dir, error: `未知 action: ${action}`, summary: `❌ 未知 action「${action}」。可用：install | start | stop | status | keepalive | keepalive-remove | list-assets` };
      } catch (e) {
        return { ok: false, dir, error: safeErr(e), summary: `❌ ${safeErr(e)}` };
      }
    },
  };
}

function toolMcDeploy(ctx, config) {
  return {
    name: "mc_deploy",
    description:
      "生成 Minecraft 服务端（Windows VPS）部署脚本包：初始化 RCON、安装 OpenSSH Server、放行防火墙、按物理内存自动设置 -Xmx、创建工作方式正确的启动脚本和计划任务。也包含开发调试中踩过的编码陷阱说明。",
    parameters: {
      outputDir: { type: "string", description: "脚本包输出目录。默认 %USERPROFILE%\\Desktop\\mc-deploy-kit。" },
      serverDir: { type: "string", description: "目标服务器上的服务端目录（默认 D:\\minecraft）。" },
      rconPort: { type: "integer", description: "RCON 端口。默认 25575。" },
      rconPass: { type: "string", description: "RCON 密码。" },
      javaXmx: { type: "string", description: "堆上限，如 12G。留空则按物理内存 60%（上限 12G）自动计算。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { ok: { type: "boolean", required: true }, dir: { type: "string" }, files: { type: "array", items: { type: "string" } }, summary: { type: "string" }, error: { type: "string" } },
      },
      render: (_a, v) => text(v.summary ?? (v.error ? `❌ ${v.error}` : "")),
    },
    async execute(args) {
      const outDir = path.resolve(args.outputDir || path.join(os.homedir(), "Desktop", "mc-deploy-kit"));
      const serverDir = args.serverDir ?? "D:\\minecraft";
      const rconPort = args.rconPort ?? 25575;
      const rconPass = args.rconPass ?? "CHANGE_ME_STRONG_PASSWORD";
      const xmx = args.javaXmx ?? "";

      fs.mkdirSync(outDir, { recursive: true });
      const files = [];

      // ---- 1. 初始化脚本 ----
      const init = `# =====================================================================
#  Minecraft 服务器 · 一键初始化
#  作用：开启 RCON + 安装 OpenSSH Server + 放行防火墙 + 设置堆内存
#  用法：在【服务器上】右键 → 使用 PowerShell 运行（管理员）
# =====================================================================
$ErrorActionPreference = 'Continue'
$ServerDir = '${serverDir.replace(/'/g, "''")}'
$RconPort  = ${rconPort}
$RconPass  = '${rconPass.replace(/'/g, "''")}'
$ForceXmx  = '${xmx}'

function Log($m, $c = 'Gray') { Write-Host ('[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $m) -ForegroundColor $c }

Log '===== 0. 环境 =====' Cyan
$os = Get-CimInstance Win32_OperatingSystem
$ramGB = [math]::Round($os.TotalVisibleMemorySize/1MB, 1)
Log ('系统: ' + $os.Caption)
Log ('内存: ' + $ramGB + ' GB')
Log ('目标目录: ' + $ServerDir)

Log '===== 1. Java 版本 =====' Cyan
try {
  $v = (& java -version 2>&1 | Out-String)
  Log (($v -split "\`r?\`n")[0])
  if ($v -match 'version "(\\d+)') {
    $major = [int]$matches[1]
    if ($major -lt 17) { Log ('⚠ Java ' + $major + ' 太旧，1.20.1 需要 17+') Yellow }
    elseif ($major -ge 22) { Log ('⚠ Java ' + $major + '，部分 Forge 1.20.1 包不支持 22+') Yellow }
    else { Log ('Java ' + $major + ' OK') Green }
  }
} catch { Log '❌ 找不到 java，请先安装 JDK 17' Red }

Log '===== 2. 开启 RCON =====' Cyan
$sp = Join-Path $ServerDir 'server.properties'
if (-not (Test-Path $sp)) {
  Log ('❌ 找不到 ' + $sp + '（服务端还没装？）') Red
} else {
  Copy-Item $sp ($sp + '.bak-init') -Force
  $t = [System.IO.File]::ReadAllText($sp)
  $t = $t.TrimStart([char]0xFEFF)
  $lines = @($t -split "\`r?\`n" | Where-Object { $_.Trim() })
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($l in $lines) { $out.Add($l.Trim()) }
  $pairs = @(@('enable-rcon','true'), @('rcon.port',"$RconPort"), @('rcon.password',"$RconPass"))
  foreach ($pr in $pairs) {
    $k = $pr[0]; $v2 = $pr[1]; $hit = $false
    for ($i = 0; $i -lt $out.Count; $i++) {
      if ($out[$i] -match ('^' + [regex]::Escape($k) + '=')) { $out[$i] = $k + '=' + $v2; $hit = $true }
    }
    if (-not $hit) { $out.Add($k + '=' + $v2) }
  }
  [System.IO.File]::WriteAllLines($sp, $out.ToArray(), (New-Object System.Text.UTF8Encoding($false)))
  Log '已写入 RCON 配置（UTF-8 无 BOM）' Green
  Get-Content $sp | Select-String 'rcon' | ForEach-Object { Log ('  ' + $_.Line) DarkGray }
}

Log '===== 3. 设置堆内存 =====' Cyan
$jvm = Join-Path $ServerDir 'user_jvm_args.txt'
if (Test-Path $jvm) {
  Copy-Item $jvm ($jvm + '.bak') -Force -ErrorAction SilentlyContinue
  $memGB = if ($ForceXmx) { $ForceXmx } else { [Math]::Min(12, [Math]::Max(4, [math]::Floor($ramGB * 0.6))) }
  $sysMem = if ($ForceXmx) { '手动' } else { [Math]::Min(12, [Math]::Max(4, [math]::Floor($ramGB * 0.6))) }
  Log ('设置 -Xms' + [Math]::Floor([double]([string]$sysMem -replace '[^\\d.]','')) * 0.5 + 'G -Xmx' + $memGB + 'G' + $(if ($ForceXmx) { '（手动指定）' } else { '（物理内存 ' + $ramGB + 'GB × 60% ✗ 上限 12G）' })) Green
} else { Log '没有 user_jvm_args.txt，跳过' Yellow }

Log '===== 4. 安装 OpenSSH Server =====' Cyan
try {
  $cap = Get-WindowsCapability -Online -Name 'OpenSSH.Server*' -ErrorAction Stop
  if ($cap.State -eq 'Installed') { Log 'OpenSSH Server 已安装' Green }
  else { Add-WindowsCapability -Online -Name $cap.Name -ErrorAction Stop | Out-Null; Log 'OpenSSH Server 安装完成' Green }
  Set-Service sshd -StartupType Automatic -ErrorAction SilentlyContinue
  if ((Get-Service sshd).Status -ne 'Running') { Start-Service sshd -ErrorAction SilentlyContinue }
  Log ('sshd 状态: ' + (Get-Service sshd -ErrorAction SilentlyContinue).Status) Green
} catch { Log ('❌ ' + $_.Exception.Message) Red }

Log '===== 5. 防火墙 =====' Cyan
foreach ($pi in @(@{P=$RconPort; N='Minecraft RCON'}, @{P=25565; N='Minecraft Game Port'}, @{P=22; N='OpenSSH'})) {
  try {
    if (-not (Get-NetFirewallRule -DisplayName $pi.N -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -DisplayName $pi.N -Direction Inbound -Protocol TCP -LocalPort $pi.P -Action Allow -ErrorAction Stop | Out-Null
      Log ('已放行 ' + $pi.P + ' (' + $pi.N + ')') Green
    } else { Log ($pi.P.ToString() + ' 规则已存在') DarkGray }
  } catch { Log ('防火墙 ' + $pi.P + ': ' + $_.Exception.Message) Yellow }
}

Log '===== 6. 自检 =====' Cyan
foreach ($pt in 25565, $RconPort, 22) {
  $L = Get-NetTCPConnection -LocalPort $pt -State Listen -ErrorAction SilentlyContinue
  Log ($pt.ToString().PadLeft(6) + '  ' + $(if ($L) { '监听中' } else { '未监听' }))
}
$j = Get-Process java -ErrorAction SilentlyContinue
if ($j) { Log ('java 进程: ' + $j.Count + ' 个') } else { Log 'java 未运行' Yellow }

Log '===== 完成，请把上面的输出发回来 =====' Green
Read-Host '按回车关闭'
`;
      const p1 = path.join(outDir, "mc-init.ps1");
      fs.writeFileSync(p1, init, "utf8");
      files.push(path.basename(p1));

      // ---- 2. 启动脚本（无 pause，供计划任务） ----
      const starter = `@echo off\r\ncd /d "%~dp0"\r\njava @user_jvm_args.txt @libraries/net/minecraftforge/forge/1.20.1-47.4.0/win_args.txt nogui\r\n`;
      const p2 = path.join(outDir, "start-server.bat");
      fs.writeFileSync(p2, starter, "utf8");
      files.push(path.basename(p2));

      // ---- 3. 启动器 ----
      const launcher = `@echo off
chcp 65001 >nul
title Minecraft Server Initializer
echo ==========================================
echo   Minecraft Server 一键初始化
echo ==========================================
echo.
echo 需要：已安装 Java 17+ / 服务端在 ${serverDir}
echo.
pause
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File','%~dp0mc-init.ps1'"
`;
      const p3 = path.join(outDir, "mc-init.bat");
      fs.writeFileSync(p3, launcher, "utf8");
      files.push(path.basename(p3));

      // ---- 4. 陷阱说明 ----
      const pitfalls = `# Windows 上做 Minecraft 服务器运维的坑（实测）

## 1. 配置文件绝对不能带 UTF-8 BOM

PowerShell 5.1 的 \`Set-Content -Encoding UTF8\` **会加 BOM**（EF BB BF）。
java 读取 \`user_jvm_args.txt\` 时会把 BOM 当成参数的一部分，报：

\`\`\`
错误: 找不到或无法加载主类 锘?-Xms4G
\`\`\`

**正确做法**：
\`\`\`powershell
[System.IO.File]::WriteAllLines($path, $lines, (New-Object System.Text.UTF8Encoding($false)))
\`\`\`

## 2. \`#\` 在 .mcfunction 里是注释符

数据包里的伪玩家名不能用 \`#timer\`（整行会被当注释丢掉），要用 \`icTimer\`。

## 3. \`@e\` / \`@a\` 是全局选择器

\`execute in minecraft:overworld run kill @e[type=item]\` **会杀掉所有维度**的掉落物。
\`execute in\` 只改变执行位置/维度上下文，**不限定实体选择器的作用范围**。

要限定维度，需要用 \`execute in <dim> run kill @e[...,x=..,dx=..]\` 或按 tag 过滤。

## 4. PowerShell 5.1 里 \`$args\` 是保留变量

不要用它做参数名，会导致函数行为异常。

## 5. 函数名 / 变量名会撞内置别名

\`rv\` = Remove-Variable、\`cd\` = Set-Location、\`ls\` = Get-ChildItem……
自定义函数用 \`ReadVarX\` / \`PutVarInt\` 这种带前缀的名字。

## 6. \`Select-Object -join\` 不存在

\`-join\` 是运算符，不是 Select-Object 的参数。要写成：
\`\`\`powershell
($items | Select-Object -First 3) -join ", "
\`\`\`

## 7. RCON 输出长的时候会分多个包

只读一个响应包会截断。要一直读到空闲（无数据）为止。

## 8. 通过 SSH 远程启动服务器：进程会随会话结束被杀

用 \`schtasks /run /tn <任务名>\` 启动，或者注册一个登录/开机触发的计划任务，
不要用 \`Start-Process cmd /c start ...\`（SSH 会话断开会连带子进程一起没）。

## 9. spark 命令的输出走的是聊天消息，RCON 里可能是空的

想要结构化数据，用 \`forge tps\` + \`forge entity list\`（这两条 RCON 能拿到）。

## 10. 中文路径 + Invoke-WebRequest -OutFile

路径里带 \`[\` \`]\` 会报「无法找到指定文件」。用无方括号的临时文件名下载，再 \`Move-Item -LiteralPath\`。

## 11. 堆内存别一次给太大

16GB 物理内存的机器，\`-Xmx12G\` 是上限。
给到 32G 又加 \`-XX:+AlwaysPreTouch\`，Windows 会报
\`系统资源不足，无法完成请求的服务 (1450)\`，直接写到 RegionFile 失败。

## 12. \`falling_block\` 是最容易被忽视的卡顿源

沙砾/沙子塌方会在同一坐标堆积几十上百个 \`minecraft:falling_block\`，
每个每 tick 都要做碰撞检测。表现为 MSPT 飙高但"看起来没什么东西"。

排查：\`forge entity list\` 看 \`minecraft:falling_block\` 的数量，
清理：\`kill @e[type=minecraft:falling_block]\`（全局），
定位：\`execute as @e[type=minecraft:falling_block,limit=1] run data get entity @s Pos\`
`;
      const p4 = path.join(outDir, "PITFALLS.md");
      fs.writeFileSync(p4, pitfalls, "utf8");
      files.push(path.basename(p4));

      return {
        ok: true,
        dir: outDir,
        files,
        summary:
          `✅ 部署脚本包已生成：${outDir}\n\n` +
          files.map((f) => `  - ${f}`).join("\n") +
          `\n\n用法：把整个目录传到服务器上，双击 mc-init.bat 运行。\n` +
          `重点：mc-init.ps1 里已内置「UTF-8 无 BOM」写法，不会踩 BOM 坑。`,
      };
    },
  };
}

function toolMcPitfalls(ctx, config) {
  return {
    name: "mc_pitfalls",
    description:
      "Minecraft 服务器运维知识库：查询踩过的坑及解法（BOM 编码、@e 全局选择器、mcfunction 注释符、PowerShell 别名冲突、RCON 多包、SSH 启动进程被杀、falling_block 卡顿等）。不传 topic 返回全部条目标题。",
    parameters: {
      topic: { type: "string", description: "关键词（模糊匹配标题和内容）。省略则列出全部条目。" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { ok: { type: "boolean", required: true }, count: { type: "integer" }, summary: { type: "string" } },
      },
      render: (_a, v) => text(v.summary),
    },
    async execute(args) {
      const KB = PITFALL_KB;
      const topic = (args.topic ?? "").toLowerCase().trim();
      const hits = topic
        ? KB.filter((x) => (x.title + " " + x.body + " " + x.tags.join(" ")).toLowerCase().includes(topic))
        : KB;
      if (hits.length === 0) {
        return { ok: true, count: 0, summary: `没有匹配「${args.topic}」的条目。\n\n全部条目：\n${KB.map((x) => "- " + x.title).join("\n")}` };
      }
      const summary = hits
        .map((x, i) => `### ${i + 1}. ${x.title}\n${x.body}`)
        .join("\n\n---\n\n");
      return { ok: true, count: hits.length, summary };
    },
  };
}

const PITFALL_KB = [
  {
    title: "配置文件带 UTF-8 BOM → java 报「找不到主类 锘?-Xms4G」",
    tags: ["bom", "编码", "encoding", "jvm", "user_jvm_args", "启动失败"],
    body:
      "PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会写入 BOM（EF BB BF）。\n" +
      "java 读 `user_jvm_args.txt` 时把 BOM 当成第一个参数的一部分，报 `错误: 找不到或无法加载主类 锘?-Xms4G`。\n\n" +
      "**解法**：用 `[System.IO.File]::WriteAllLines($path, $lines, (New-Object System.Text.UTF8Encoding($false)))`\n" +
      "校验：读前 3 字节，不应是 `EF BB BF`。",
  },
  {
    title: "@e / @a 是全局选择器，execute in <维度> 不能限定作用范围",
    tags: ["selector", "execute", "维度", "dimension", "误杀"],
    body:
      "`execute in minecraft:overworld run kill @e[type=item]` 会杀掉**所有维度**的掉落物。\n" +
      "`execute in` 只改变执行位置上下文，不限定实体选择器。\n\n" +
      "**解法**：用 `execute in <dim> positioned <x> <y> <z> run kill @e[type=item,distance=..N]`，\n" +
      "或者用 tag / 独立的计分板标记来分区。",
  },
  {
    title: ".mcfunction 里 `#` 是注释符 → 伪玩家名不能用 `#timer`",
    tags: ["mcfunction", "datapack", "数据包", "scoreboard"],
    body:
      "数据包函数里以 `#` 开头的行会被整行当注释丢弃，`scoreboard players add #timer obj 1` 会**静默失效**。\n\n" +
      "**解法**：伪玩家名用 `icTimer`、`icCnt` 这类不带 `#` 的名字。",
  },
  {
    title: "RCON 长输出会分多个包，只读一个会截断",
    tags: ["rcon", "多包", "截断", "forge entity list"],
    body:
      "`forge entity list`、`forge tps` 这类输出较长时，服务端会拆成多个响应包。\n" +
      "只读第一个包会得到半截数据（表现为「命令没输出」）。\n\n" +
      "**解法**：读完第一个包后继续读，直到连接空闲（设置一个 1 秒左右的 idle 超时）。",
  },
  {
    title: "SSH 远程启动服务的进程会随会话结束被杀",
    tags: ["ssh", "进程", "启动", "schtasks", "计划任务"],
    body:
      "在 SSH 里执行 `Start-Process cmd /c start run.bat` 起的 java，SSH 会话一断就被连带杀掉。\n\n" +
      "**解法**：注册计划任务（`schtasks /create`），然后 `schtasks /run` 触发。\n" +
      "任务以 SYSTEM 或你自己的账户运行，脱离 SSH 会话。",
  },
  {
    title: "falling_block 是隐形卡顿源",
    tags: ["卡顿", "lag", "falling_block", "mspt", "沙砾"],
    body:
      "沙砾/沙子塌方会在同一坐标堆积几十上百个 `minecraft:falling_block`。\n" +
      "每个每 tick 都要做重力 + 碰撞检测，MSPT 会从 8ms 飙到 50ms+，而玩家「看起来没看到什么」。\n\n" +
      "**排查**：`forge entity list` 看 `minecraft:falling_block` 数量。\n" +
      "**清理**：`kill @e[type=minecraft:falling_block]`（全局，不带 execute in）。\n" +
      "**定位**：`execute as @e[type=minecraft:falling_block,limit=1] run data get entity @s Pos`。",
  },
  {
    title: "PowerShell 5.1 的保留变量与别名冲突",
    tags: ["powershell", "别名", "args", "脚本"],
    body:
      "`$args` 是自动变量，不能做参数名。\n" +
      "`rv`（Remove-Variable）、`cd`、`ls`、`rm` 等是内置别名，自定义函数同名会覆盖或报错。\n" +
      "`Select-Object` 没有 `-join` 参数（`-join` 是运算符）。\n\n" +
      "**解法**：函数名加前缀（`ReadVarInt`/`PutVarInt`），流程用显式变量名。",
  },
  {
    title: "堆内存给太大 + AlwaysPreTouch → Windows 报 1450",
    tags: ["jvm", "内存", "heap", "1450", "AlwaysPreTouch"],
    body:
      "64GB 内存的机器设 `-Xms32G -Xmx32G -XX:+AlwaysPreTouch`，Windows 会在写 RegionFile 时报\n" +
      "`java.io.IOException: 系统资源不足，无法完成请求的服务 (1450)`。\n\n" +
      "**解法**：`-Xms` 取物理内存的 30~40%，`-Xmx` 取 60~75%（16GB → `-Xms6G -Xmx12G`），\n" +
      "**去掉** `-XX:+AlwaysPreTouch`。",
  },
  {
    title: "通过 SSH 执行 PowerShell：用 -EncodedCommand 避开所有引号问题",
    tags: ["ssh", "plink", "powershell", "引号", "编码"],
    body:
      "远程执行 `powershell -Command \"...\"` 时，嵌套引号、换行、中文会互相打架，经常报\n" +
      "`The ampersand (&) character is not allowed` 或中文乱码。\n\n" +
      "**解法**：把脚本用 UTF-16LE 编码成 base64，用 `-EncodedCommand` 传：\n" +
      "```js\nconst enc = Buffer.from(script, 'utf16le').toString('base64');\n// ssh host 'powershell -NoProfile -EncodedCommand ' + enc\n```",
  },
  {
    title: "plink 首次连接会卡在 host key 确认",
    tags: ["plink", "ssh", "hostkey", "卡住"],
    body:
      "plink 第一次连新机器会交互式问是否接受 host key，非交互环境会**永久卡住**。\n\n" +
      "**解法**：先用 `-batch` 跑一次，从 stderr 里抓 `ssh-ed25519 255 SHA256:...` 指纹，\n" +
      "再用 `-hostkey \"<指纹>\"` 重连。指纹可以缓存到配置里。",
  },
  {
    title: "客户端连不上，但服务器进程/端口都正常",
    tags: ["连接", "端口", "nat", "映射", "防火墙"],
    body:
      "排查顺序：\n" +
      "1. 服务器内部 `Test-NetConnection 127.0.0.1 -Port 25565` → 排除服务端问题\n" +
      "2. 云厂商 NAT 端口映射：内网端口必须写对（游戏是 25565，RCON 是 25575），协议 TCP\n" +
      "3. `enable-status` 影响服务器列表显示，但**不影响玩家进服**\n" +
      "4. 部分模组会屏蔽非官方客户端的握手（表现为「能连上但无响应」）",
  },
  {
    title: "冒烟测试：别用「模拟握手」判断端口通不通",
    tags: ["测试", "握手", "误判", "状态查询"],
    body:
      "手写的 Minecraft 状态查询/登录握手很容易因为协议号、UUID 字段、字段顺序写错而收到不到响应，\n" +
      "从而**误判「端口不通」**。\n\n" +
      "**更可靠**：让真人客户端连一次；或者用 RCON `list` 确认有玩家在线。",
  },
];

// ---------------------------------------------------------------------------
// 注册
// ---------------------------------------------------------------------------

export function apply(ctx, config) {
  const cfg = {
    servers: {},
    defaultServer: "",
    timeoutMs: 15000,
    monitorDir: "",
    ...(config ?? {}),
  };

  const tools = [
    toolMcStatus(ctx, cfg),
    toolMcRcon(ctx, cfg),
    toolMcDiagnose(ctx, cfg),
    toolMcCleanup(ctx, cfg),
    toolMcAnnounce(ctx, cfg),
    toolMcRestart(ctx, cfg),
    toolMcLog(ctx, cfg),
    toolMcConfig(ctx, cfg),
    toolMcInstallDatapack(ctx, cfg),
    toolMcMonitor(ctx, cfg),
    toolMcDeploy(ctx, cfg),
    toolMcPitfalls(ctx, cfg),
  ];

  for (const t of tools) {
    ctx.tools.register(t);
  }
}

export default { name, Config, inject, apply };
