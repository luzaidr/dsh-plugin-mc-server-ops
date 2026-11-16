/**
 * 服务器扩展模块：地皮 / 经济 / 玩家数据 / 任务 / JVM
 *
 * 全是宝可梦服（Cobblemon + fabricplots + FTB Quests + impactor）那套场景里踩出来的。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ===========================================================================
// fabricplots 地皮
// ===========================================================================

export const PLOTS_DEFAULTS = {
  "mob-cap-per-plot": "999",
  "mob-escape-action": "teleport",
  "mob-scan-interval-ticks": "2147483000",
  "unnamed-mob-grace-ticks": "2147483000",
  "mob-spawning": "per-plot",
  "protect-mob-griefing": "true",
  "claim-limit": "1",
  "street-sweeper": "false",
  "inactivity-expiry": "false",
  "manage-gamemode": "false",
  "advance-time": "true",
  "advance-weather": "true",
  "spawnChunkRadius": "0",
};

/** properties 文本 → 对象 */
export function parseProperties(text) {
  const out = {};
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** 对象 → properties 文本（保留原有注释顺序） */
export function mergeProperties(originalText, updates) {
  const lines = String(originalText ?? "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  const seen = new Set();
  for (const raw of lines) {
    const line = raw;
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("!")) {
      out.push(line);
      continue;
    }
    const i = t.indexOf("=");
    if (i <= 0) {
      out.push(line);
      continue;
    }
    const key = t.slice(0, i).trim();
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      out.push(`${key}=${updates[key]}`);
      seen.add(key);
    } else {
      out.push(line);
    }
  }
  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) out.push(`${k}=${v}`);
  }
  return out.join("\n") + "\n";
}

/** 判断一份 fabricplots 配置里有没有「会自动清理生物」的危险项 */
export function detectPlotsRisks(cfg) {
  const risks = [];
  const scan = Number(cfg["mob-scan-interval-ticks"] ?? 0);
  const grace = Number(cfg["unnamed-mob-grace-ticks"] ?? 0);
  if (scan > 0 && scan < 72000) {
    risks.push({
      level: "critical",
      message: `mob-scan-interval-ticks=${scan}（约 ${(scan / 20).toFixed(0)} 秒扫一次）—— 会周期性清理地皮生物，容易误伤其他维度的宝可梦`,
      fix: "改成 2147483000（等于永不扫描）",
    });
  }
  if (grace > 0 && grace < 72000) {
    risks.push({
      level: "critical",
      message: `unnamed-mob-grace-ticks=${grace}（约 ${(grace / 20).toFixed(0)} 秒宽限）—— 未命名生物会被清掉`,
      fix: "改成 2147483000（等于永不过期）",
    });
  }
  const cap = Number(cfg["mob-cap-per-plot"] ?? 999);
  if (cap > 0 && cap < 20) {
    risks.push({ level: "warn", message: `mob-cap-per-plot=${cap} —— 上限太低，玩家养的宝可梦可能被判超限`, fix: "建议 999" });
  }
  if (String(cfg["street-sweeper"] ?? "false") === "true") {
    risks.push({ level: "warn", message: "street-sweeper=true —— 会自动清理街道上的实体", fix: "确认这是你要的" });
  }
  if (String(cfg["inactivity-expiry"] ?? "false") === "true") {
    risks.push({ level: "warn", message: "inactivity-expiry=true —— 长期不活跃的地皮会被回收", fix: "确认这是你要的" });
  }
  if (String(cfg["manage-gamemode"] ?? "false") === "true") {
    risks.push({ level: "warn", message: "manage-gamemode=true —— 地皮世界会自动切游戏模式，可能和竞技场抢", fix: "一般设 false" });
  }
  return risks;
}

// ===========================================================================
// adventure_fix 数据包（治 gamemode 泄漏）
// ===========================================================================

/**
 * 生成 adventure-fix 数据包
 * 作用：每 5 秒检查一次，把「在竞技场外但处于 adventure 模式」的玩家自动切回 survival
 *
 * @param {object} opts
 * @param {string} opts.targetDir
 * @param {string} [opts.arenaDimension]  竞技场维度 ID（默认 spleef:arena）
 * @param {number} [opts.checkIntervalTicks] 检查间隔（默认 100 = 5 秒）
 * @param {number} [opts.packFormat]
 */
export function buildAdventureFix(opts) {
  const arena = opts.arenaDimension ?? "spleef:arena";
  const interval = opts.checkIntervalTicks ?? 100;
  const packFormat = opts.packFormat ?? 15;
  const fdir = packFormat >= 45 ? "function" : "functions";
  const outDir = path.join(path.resolve(opts.targetDir), "adventure-fix");

  const writeNoBom = (rel, content) => {
    const p = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(content).replace(/\r\n/g, "\n"), "utf8");
    return rel;
  };

  const files = [];

  files.push(
    writeNoBom(
      "pack.mcmeta",
      JSON.stringify(
        { pack: { pack_format: packFormat, description: "Adventure Fix — 自动把竞技场外的冒险模式玩家切回生存" } },
        null,
        2,
      ),
    ),
  );

  files.push(
    writeNoBom(
      `data/minecraft/tags/${fdir}/tick.json`,
      JSON.stringify({ values: ["advfix:tick"] }, null, 2),
    ),
  );

  files.push(
    writeNoBom(
      `data/advfix/${fdir}/tick.mcfunction`,
      `scoreboard objectives add advfix_tick dummy "冒险模式自愈计时"
scoreboard players add advTimer advfix_tick 1
execute if score advTimer advfix_tick matches ${interval}.. run function advfix:check
`,
    ),
  );

  files.push(
    writeNoBom(
      `data/advfix/${fdir}/check.mcfunction`,
      `scoreboard players set advTimer advfix_tick 0
execute as @a[gamemode=adventure] at @s unless predicate advfix:in_arena run function advfix:fix_one
`,
    ),
  );

  files.push(
    writeNoBom(
      `data/advfix/${fdir}/fix_one.mcfunction`,
      `gamemode survival @s
title @s actionbar [{"text":"已自动恢复生存模式","color":"green"}]
playsound minecraft:entity.player.levelup master @s ~ ~ ~ 0.6 1.4
`,
    ),
  );

  files.push(
    writeNoBom(
      "data/advfix/predicate/in_arena.json",
      JSON.stringify(
        {
          condition: "minecraft:location_check",
          predicate: { dimension: arena },
        },
        null,
        2,
      ),
    ),
  );

  return { dir: outDir, files, arenaDimension: arena, intervalTicks: interval };
}

// ===========================================================================
// 经济系统
// ===========================================================================

/**
 * 生成 /economy 命令（参数顺序：金额 货币 玩家 —— 很多人写反）
 * @param {object} opts
 * @param {"deposit"|"withdraw"|"set"|"balance"} opts.action
 * @param {number} [opts.amount]
 * @param {string} [opts.currency]   默认 impactor:dollars
 * @param {string} opts.player
 */
export function buildEconomyCommand(opts) {
  const currency = opts.currency ?? "impactor:dollars";
  const player = opts.player;
  if (!player) throw new Error("必须指定玩家");

  if (opts.action === "balance") {
    return `economy balance ${currency} ${player}`;
  }
  const amount = Number(opts.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount 必须是正数");
  const action = opts.action ?? "deposit";
  if (!["deposit", "withdraw", "set"].includes(action)) throw new Error(`action 必须是 deposit / withdraw / set / balance`);

  return `economy ${action} ${amount} ${currency} ${player}`;
}

/**
 * 读 impactor 的余额文件（RCON 拿不到余额，只能读文件）
 * @param {string} accountsRoot  形如 config/impactor/economy/accounts/users
 * @param {string} uuid
 * @returns {{ ok:boolean, balance?:number, currency?:string, path?:string, error?:string }}
 */
export function readImpactorBalance(accountsRoot, uuid, currency = "impactor:dollars") {
  const u = String(uuid ?? "").trim().toLowerCase();
  if (!/^[0-9a-f-]{32,36}$/.test(u)) return { ok: false, error: `UUID 格式不对：${uuid}` };
  const prefix = u.slice(0, 2);
  const p = path.join(path.resolve(accountsRoot), prefix, `${u}.conf`);
  if (!fs.existsSync(p)) return { ok: false, error: `找不到余额文件：${p}` };
  const text = fs.readFileSync(p, "utf8");
  // 内容形如：  "impactor:dollars": 10500.0
  const re = new RegExp(`"${currency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*([-\\d.]+)`);
  const m = re.exec(text);
  if (!m) return { ok: false, error: `文件里没有 ${currency} 字段`, path: p };
  return { ok: true, balance: Number(m[1]), currency, path: p };
}

// ===========================================================================
// 玩家数据审计
// ===========================================================================

/**
 * 审计一个世界目录里的玩家数据
 * @param {string} worldDir
 */
export function auditPlayerData(worldDir) {
  const w = path.resolve(worldDir);
  const result = {
    worldDir: w,
    exists: fs.existsSync(w),
    playerdata: { count: 0, zeroByte: [], small: [], oldOrphans: [], oldCount: 0 },
    cobblemonplayerdata: { count: 0, zeroByte: [], totalMB: 0 },
    rctmod: { count: 0 },
    verdict: "ok",
    notes: [],
  };
  if (!result.exists) {
    result.verdict = "missing";
    result.notes.push(`世界目录不存在：${w}`);
    return result;
  }

  const list = (dir, filter) => {
    const d = path.join(w, dir);
    if (!fs.existsSync(d)) return [];
    try {
      return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile() && filter(e.name)).map((e) => e.name);
    } catch {
      return [];
    }
  };

  // ---- playerdata
  const pd = list("playerdata", (n) => n.endsWith(".dat") && !n.endsWith(".dat.old"));
  result.playerdata.count = pd.length;
  for (const n of pd) {
    const st = fs.statSync(path.join(w, "playerdata", n));
    if (st.size === 0) result.playerdata.zeroByte.push(n);
    else if (st.size < 100) result.playerdata.small.push({ name: n, size: st.size });
  }

  // ---- .old 孤儿（.dat 没了但 .old 还在 → 可恢复）
  const olds = list("playerdata", (n) => n.endsWith(".dat.old"));
  result.playerdata.oldCount = olds.length;
  for (const n of olds) {
    const base = path.join(w, "playerdata", n.replace(/\.old$/, ""));
    if (!fs.existsSync(base)) result.playerdata.oldOrphans.push(n);
  }

  // ---- cobblemonplayerdata
  const cp = list("cobblemonplayerdata", () => true);
  result.cobblemonplayerdata.count = cp.length;
  let total = 0;
  for (const n of cp) {
    const p = path.join(w, "cobblemonplayerdata", n);
    const st = fs.statSync(p);
    total += st.size;
    if (st.size === 0) result.cobblemonplayerdata.zeroByte.push(n);
  }
  result.cobblemonplayerdata.totalMB = Math.round((total / 1024 / 1024) * 10) / 10;

  // ---- rctmod
  result.rctmod.count = list("data", (n) => n.startsWith("rctmod.player.") && n.endsWith(".stat.dat")).length;

  // ---- 判定
  const problems = [];
  if (result.playerdata.zeroByte.length > 0) problems.push(`${result.playerdata.zeroByte.length} 个零字节 playerdata（真丢失）`);
  if (result.playerdata.small.length > 0) problems.push(`${result.playerdata.small.length} 个小于 100 字节的 playerdata（可能截断）`);
  if (result.cobblemonplayerdata.zeroByte.length > 0) problems.push(`${result.cobblemonplayerdata.zeroByte.length} 个零字节宝可梦数据（真丢失）`);

  if (problems.length > 0) {
    result.verdict = "damaged";
    result.notes.push(...problems);
  } else {
    result.verdict = "ok";
    result.notes.push("没有零字节或被截断的玩家数据");
  }
  if (result.playerdata.oldOrphans.length > 0) {
    result.notes.push(
      `有 ${result.playerdata.oldOrphans.length} 个孤立的 .dat.old（对应的 .dat 不存在）—— 这些通常可以从 .old 恢复，先确认是不是真的缺玩家`,
    );
  }
  result.notes.push(
    "注意：日志里的 `Could not ... .old File ... is corrupt or missing. Data is lost` 是首次加载的良性噪音，不代表数据丢失",
  );
  return result;
}

// ===========================================================================
// FTB Quests 坏成就引用 → 桩成就数据包
// ===========================================================================

/**
 * 生成「桩成就」数据包，让引用不存在成就的 FTB 任务能够完成
 *
 * @param {object} opts
 * @param {string} opts.targetDir
 * @param {{namespace:string, path:string}[]} opts.advancements   如 {namespace:'rctmod', path:'trainers/defeat_kanto_giovanni_gym'}
 * @param {number} [opts.packFormat]
 */
export function buildQuestAdvancementFix(opts) {
  const packFormat = opts.packFormat ?? 15;
  const outDir = path.join(path.resolve(opts.targetDir), "quest-adv-fix");
  const files = [];
  const writeNoBom = (rel, content) => {
    const p = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(content).replace(/\r\n/g, "\n"), "utf8");
    files.push(rel);
  };

  writeNoBom("pack.mcmeta", JSON.stringify({ pack: { pack_format: packFormat, description: "Quest Advancement Fix — 为 FTB Quests 引用的缺失成就补桩" } }, null, 2));

  const names = [];
  for (const a of opts.advancements ?? []) {
    if (!a?.namespace || !a?.path) continue;
    const body = {
      display: {
        icon: { item: "minecraft:paper" },
        title: { text: `[自动修复] ${a.namespace}:${a.path}` },
        description: { text: "由 dsh-plugin-mc-server-ops 生成的桩成就，用于让 FTB Quests 的 advancement 任务可以完成。" },
        frame: "task",
        show_toast: false,
        announce_to_chat: false,
        hidden: true,
      },
      criteria: { impossible: { trigger: "minecraft:impossible" } },
      requirements: [["impossible"]],
    };
    writeNoBom(`data/${a.namespace}/advancements/${a.path}.json`, JSON.stringify(body, null, 2));
    names.push(`${a.namespace}:${a.path.replace(/\//g, "/")}`);
  }

  return { dir: outDir, files, advancements: names };
}

// ===========================================================================
// JVM 参数
// ===========================================================================

/**
 * 按物理内存推荐堆大小
 * @param {number} physicalGB
 * @param {object} [opts]
 * @param {boolean} [opts.heavyModpack] 大型整合包更贪心
 */
export function recommendJvm(physicalGB, opts = {}) {
  const g = Number(physicalGB);
  if (!Number.isFinite(g) || g < 2) throw new Error(`物理内存不合理：${physicalGB}`);

  // 档位来自实测：16GB → -Xmx12G（工作集 5GB，堆余量充足）
  //             64GB → -Xmx22G（曾用 32G + AlwaysPreTouch 导致 Windows 报 1450）
  const tiers = [
    { mem: 8, xmx: 6 },
    { mem: 10, xmx: 7 },
    { mem: 12, xmx: 8 },
    { mem: 16, xmx: 12 },
    { mem: 20, xmx: 14 },
    { mem: 24, xmx: 16 },
    { mem: 32, xmx: 20 },
    { mem: 48, xmx: 22 },
    { mem: 64, xmx: 22 },
  ];
  let xmx;
  const hit = tiers.find((t) => g <= t.mem);
  if (hit) {
    xmx = hit.xmx;
  } else {
    // 超过 64GB：保守 34%（和 64GB 档一致），最多 32G
    xmx = Math.min(32, Math.floor(g * 0.34));
  }
  if (opts.heavyModpack) xmx = Math.min(32, xmx + 2);
  // 护栏：至少留 4GB 给系统
  xmx = Math.max(2, Math.min(xmx, g - 4));
  const xms = Math.max(1, Math.floor(xmx / 2));
  const args = [
    `-Xms${xms}G -Xmx${xmx}G`,
    "-XX:+UseG1GC",
    "-XX:+ParallelRefProcEnabled",
    "-XX:MaxGCPauseMillis=200",
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:+DisableExplicitGC",
    "-XX:G1NewSizePercent=30",
    "-XX:G1MaxNewSizePercent=40",
    "-XX:G1HeapRegionSize=8M",
    "-XX:G1ReservePercent=20",
    "-XX:G1HeapWastePercent=5",
    "-XX:G1MixedGCCountTarget=4",
    "-XX:InitiatingHeapOccupancyPercent=15",
    "-XX:G1MixedGCLiveThresholdPercent=90",
    "-XX:G1RSetUpdatingPauseTimePercent=5",
    "-XX:SurvivorRatio=32",
    "-XX:MaxTenuringThreshold=1",
    "-Dfile.encoding=UTF-8",
  ];

  const warnings = [];
  if (g <= 8) warnings.push(`${g} GB 跑大型整合包会吃紧，建议至少 12 GB`);
  if (g >= 32) warnings.push("不要加 -XX:+AlwaysPreTouch，会让 Windows 报「系统资源不足 (1450)」");
  if (opts.includeGcLog) args.push("-Xlog:gc*:file=logs/gc.log:time,uptime,level,tags:filecount=5,filesize=20M");

  return { xms, xmx, args, warnings };
}

/** 写 user_jvm_args.txt（UTF-8 无 BOM） */
export function writeJvmArgs(filePath, args) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, filePath + ".bak");
    } catch {}
  }
  fs.writeFileSync(path.resolve(filePath), args.join("\n") + "\n", "utf8");
  // 校验无 BOM
  const b = fs.readFileSync(path.resolve(filePath));
  const hasBom = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
  return { path: path.resolve(filePath), hasBom, lines: args.length };
}

// ===========================================================================
// Lootr 配置
// ===========================================================================

/** 生成推荐的 lootr.json（关闭每 tick 检查） */
export function buildLootrConfig() {
  return {
    perform_tick_decay: false,
    start_tick_decay: false,
    perform_piecewise_check: false,
    decay_all: false,
    _note: "由 dsh-plugin-mc-server-ops 生成。/lootr disable 命令不存在，不要被网上的教程误导。",
  };
}
