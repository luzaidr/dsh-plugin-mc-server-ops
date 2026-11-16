/**
 * 卡顿诊断引擎
 *
 * 从"实战"里总结出来的诊断路径（都是真踩过的坑）：
 *   1. MSPT / TPS      —— 先看整体是否超预算（50ms）
 *   2. 各维度 MSPT      —— 定位是哪个维度在拖后腿
 *   3. 实体统计         —— forge entity list（实体爆炸 / falling_block 堆积）
 *   4. 掉落方块         —— falling_block 是最常见的隐形杀手
 *   5. 日志告警         —— "Can't keep up!" 的频率和幅度
 *   6. 堆内存           —— -Xmx 是否被吃满（GC 风暴）
 *   7. CPU              —— 是否 100%（堆满的典型表现）
 */

/** 从 `forge tps` 输出解析 */
export function parseForgeTps(text) {
  const out = { overall: null, dims: [] };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const dim = /^(?:Dim\s+)?([\w:.\-]+)\s*\(([^)]*)\):\s*Mean tick time:\s*([\d.]+)\s*ms\.\s*Mean TPS:\s*([\d.]+)/.exec(line);
    if (dim) {
      out.dims.push({ name: dim[1], type: dim[2], mspt: Number(dim[3]), tps: Number(dim[4]) });
      continue;
    }
    const overall = /Overall:\s*Mean tick time:\s*([\d.]+)\s*ms\.\s*Mean TPS:\s*([\d.]+)/.exec(line);
    if (overall) out.overall = { mspt: Number(overall[1]), tps: Number(overall[2]) };
  }
  return out;
}

/** 从 `list` 输出解析 */
export function parsePlayerList(text) {
  const t = String(text);
  const m = /There are (\d+) of a max of (\d+) players online:?\s*(.*)$/m.exec(t);
  if (!m) return { online: 0, max: 0, names: [] };
  const names = m[3]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { online: Number(m[1]), max: Number(m[2]), names };
}

/** 从 `forge entity list` 输出解析 */
export function parseEntityList(text) {
  const items = [];
  let total = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const tot = /^Total:\s*(\d+)/.exec(line);
    if (tot) {
      total = Number(tot[1]);
      continue;
    }
    const m = /^(\d+):\s*([\w:.\-]+)/.exec(line);
    if (m) items.push({ count: Number(m[1]), type: m[2] });
  }
  items.sort((a, b) => b.count - a.count);
  return { total: total ?? items.reduce((s, x) => s + x.count, 0), items };
}

/** 统计日志里的卡顿告警 */
export function analyzeLagLog(text) {
  const behind = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const m = /Can't keep up!.*?Running (\d+)ms or (\d+) ticks behind/.exec(raw);
    if (m) behind.push({ ms: Number(m[1]), ticks: Number(m[2]) });
  }
  if (behind.length === 0) {
    return { count: 0, maxMs: 0, avgMs: 0, worst: null, samples: [] };
  }
  const msList = behind.map((x) => x.ms);
  const worst = behind.reduce((a, b) => (b.ms > a.ms ? b : a));
  return {
    count: behind.length,
    maxMs: worst.ms,
    avgMs: Math.round(msList.reduce((s, x) => s + x, 0) / msList.length),
    worst,
    samples: behind.slice(-10),
  };
}

/**
 * 综合诊断：输入原始数据，输出结论 + 建议
 *
 * @param {object} input
 * @param {string} input.tpsText        forge tps 输出
 * @param {string} [input.listText]     list 输出
 * @param {string} [input.entityText]   forge entity list 输出
 * @param {string} [input.logText]      日志尾部
 * @param {object} [input.system]       { javaMemGB, javaMemMaxGB, cpuPercent, freeMemGB, totalMemGB }
 */
export function diagnose(input) {
  const tps = parseForgeTps(input.tpsText ?? "");
  const players = input.listText ? parsePlayerList(input.listText) : null;
  const entities = input.entityText ? parseEntityList(input.entityText) : null;
  const lag = input.logText ? analyzeLagLog(input.logText) : null;
  const sys = input.system ?? null;

  const findings = [];
  const actions = [];
  let severity = "ok";

  /** 当前 TPS 是否已经下降到可感知的程度（决定某些"隐患"该报 warn 还是 critical） */
  const tpsHealthy = !tps.overall || tps.overall.tps >= 19.5;

  const bump = (level) => {
    const order = { ok: 0, info: 1, warn: 2, critical: 3 };
    if (order[level] > order[severity]) severity = level;
  };

  // ---- 1. MSPT / TPS ----
  if (tps.overall) {
    const { mspt, tps: t } = tps.overall;
    if (t >= 19.5) {
      findings.push({ level: "ok", area: "tick", message: `TPS ${t} / MSPT ${mspt}ms —— 正常` });
    } else if (t >= 17) {
      bump("warn");
      findings.push({ level: "warn", area: "tick", message: `TPS ${t} / MSPT ${mspt}ms —— 已开始掉帧（预算 50ms）` });
      actions.push("检查是否有大量掉落方块（falling_block）或实体堆积");
    } else {
      bump("critical");
      findings.push({ level: "critical", area: "tick", message: `TPS ${t} / MSPT ${mspt}ms —— 严重卡顿` });
      actions.push("立即执行 mc_diagnose 的实体统计；必要时清理 falling_block 后重启");
    }
  }

  // ---- 2. 维度 ----
  if (tps.dims.length > 0) {
    const bad = tps.dims.filter((d) => d.mspt > 25);
    if (bad.length > 0) {
      bump("warn");
      findings.push({
        level: "warn",
        area: "dimension",
        message: `${bad.length} 个维度 MSPT 超 25ms：` + bad.map((d) => `${d.name}=${d.mspt}ms`).join(", "),
      });
      actions.push(`重点排查 ${bad[0].name} 维度的实体和区块加载`);
    } else {
      findings.push({ level: "ok", area: "dimension", message: `全部 ${tps.dims.length} 个维度 MSPT 正常` });
    }
  }

  // ---- 3. 实体 ----
  if (entities) {
    findings.push({ level: "info", area: "entity", message: `实体总数 ${entities.total}，Top5：` + entities.items.slice(0, 5).map((x) => `${x.type}×${x.count}`).join(", ") });
    const falling = entities.items.find((x) => x.type === "minecraft:falling_block");
    if (falling && falling.count > 10) {
      // 关键修正：falling_block 多不等于已经卡，要看 TPS 是否真的掉了
      const level = tpsHealthy ? "warn" : "critical";
      bump(level);
      findings.push({
        level,
        area: "entity",
        message:
          `★ falling_block 有 ${falling.count} 个` +
          (tpsHealthy
            ? " —— 当前 TPS 正常，属于【潜在隐患】（每个每 tick 做碰撞检测，数量涨上去会突然卡）"
            : " —— 已确认是卡顿源（每个每 tick 做碰撞检测）"),
      });
      actions.push(`执行 mc_rcon "kill @e[type=minecraft:falling_block]" 清理掉落方块`);
      actions.push('然后定位坐标：mc_rcon "execute as @e[type=minecraft:falling_block,limit=1] run data get entity @s Pos"');
      actions.push("根据坐标排查沙砾/沙子塌方点，或考虑填实那片区域");
    } else if (falling && falling.count > 3) {
      bump("info");
      findings.push({ level: "info", area: "entity", message: `falling_block ×${falling.count}（略多，通常是沙砾/沙子塌方）` });
    }
    // 载具类：数量异常基本等于"卡住的实体"
    const vehicles = entities.items.filter((x) => /dragnvehicles|simpleplanes|immersive_aircraft|create:seat/.test(x.type));
    const vehicleTotal = vehicles.reduce((s, x) => s + x.count, 0);
    if (vehicleTotal > 15) {
      bump(tpsHealthy ? "info" : "warn");
      findings.push({
        level: tpsHealthy ? "info" : "warn",
        area: "entity",
        message: `载具实体 ${vehicleTotal} 个（${vehicles.map((v) => v.type.split(":")[1] + "×" + v.count).join(", ")}）—— 玩家通常不会造这么多，可能是卡住/重复生成的残留`,
      });
      actions.push('排查载具：mc_rcon "execute as @e[type=dragnvehicles:motorcycle,limit=1] run data get entity @s Pos"');
    }
    // 亡灵总数（丧尸整合包特有）
    const undeadKeywords = /^(minecraft:zombie|minecraft:husk|minecraft:drowned|minecraft:zombie_villager|zombie_extreme:|undead_revamp2:)/;
    const undead = entities.items.filter((x) => undeadKeywords.test(x.type));
    const undeadTotal = undead.reduce((s, x) => s + x.count, 0);
    if (undeadTotal > 60) {
      bump(tpsHealthy ? "info" : "warn");
      findings.push({
        level: tpsHealthy ? "info" : "warn",
        area: "entity",
        message: `亡灵类实体共 ${undeadTotal} 个 —— 丧尸整合包正常偏高，但配合 AI 模组（enhancedai / zombieawareness）开销很大`,
      });
      actions.push("查看模组配置：僵尸潮 hordes-common.toml 的 spawnAmount / hordeSpawnMax，以及 enhancedai 的 AI 开关");
    }
    const items = entities.items.find((x) => x.type === "minecraft:item");
    if (items && items.count > 150) {
      bump("warn");
      findings.push({ level: "warn", area: "entity", message: `掉落物 ${items.count} 个 —— 建议装掉落物清理数据包` });
      actions.push("用 mc_datapack 安装 item-cleaner（每 10 分钟自动清理）");
    }
    for (const heavy of entities.items) {
      if (/cobblemon|zombie_extreme|undead_revamp|customnpc|dragnvehicles/.test(heavy.type) && heavy.count > 40) {
        bump("warn");
        findings.push({ level: "warn", area: "entity", message: `${heavy.type} ×${heavy.count} 数量偏多，AI 开销大` });
        actions.push(`考虑限制 ${heavy.type} 的生成（模组配置或 spawner_control）`);
      }
    }
  }

  // ---- 4. 日志 ----
  if (lag) {
    if (lag.count === 0) {
      findings.push({ level: "ok", area: "log", message: "日志里没有 Can't keep up 告警" });
    } else if (lag.count < 10) {
      bump("info");
      findings.push({ level: "info", area: "log", message: `Can't keep up ${lag.count} 次，最大 ${lag.maxMs}ms` });
    } else {
      bump("critical");
      findings.push({
        level: "critical",
        area: "log",
        message: `Can't keep up ${lag.count} 次，平均 ${lag.avgMs}ms，最大 ${lag.maxMs}ms`,
      });
      actions.push("日志告警密集 → 优先按 falling_block / 实体 / 堆内存三条线排查");
    }
  }

  // ---- 5. 系统资源 ----
  if (sys) {
    if (typeof sys.cpuPercent === "number" && sys.cpuPercent >= 90) {
      bump("critical");
      findings.push({ level: "critical", area: "system", message: `CPU ${sys.cpuPercent}% —— 通常是堆内存打满导致 GC 风暴` });
      actions.push("把 -Xmx 提高（16GB 物理内存建议 -Xms6G -Xmx12G），然后重启");
    }
    if (typeof sys.javaMemGB === "number" && typeof sys.javaMemMaxGB === "number" && sys.javaMemGB / sys.javaMemMaxGB > 0.92) {
      bump("critical");
      findings.push({
        level: "critical",
        area: "system",
        message: `java 堆 ${sys.javaMemGB.toFixed(2)}GB / ${sys.javaMemMaxGB}GB —— 已接近上限`,
      });
      actions.push("重启服务器释放堆，同时上调 -Xmx");
    }
    if (typeof sys.freeMemGB === "number" && sys.freeMemGB < 2) {
      bump("warn");
      findings.push({ level: "warn", area: "system", message: `系统可用内存仅 ${sys.freeMemGB}GB` });
    }
  }

  // ---- 结论 ----
  const tpsNow = tps.overall?.tps ?? null;
  const tpsLabel = tpsNow === null ? "未取到 TPS" : `TPS ${tpsNow}`;

  const summary =
    severity === "ok"
      ? `服务器状态健康（${tpsLabel}），未发现明显卡顿源。`
      : severity === "info"
        ? `当前可用（${tpsLabel}），有少量可优化项。`
        : severity === "warn"
          ? tpsHealthy
            ? `当前 TPS 正常（${tpsLabel}），但存在【潜在卡顿隐患】，建议提前清理。`
            : `已出现性能问题（${tpsLabel}），建议按建议项处理。`
          : `存在严重卡顿源（${tpsLabel}），建议立即处理。`;

  return {
    severity,
    summary,
    findings,
    actions: [...new Set(actions)],
    raw: { tps, players, entities, lag, system: sys },
  };
}

/** 把诊断结果渲染成可读文本 */
export function renderDiagnosis(d) {
  const icon = { ok: "✅", info: "ℹ️", warn: "⚠️", critical: "🔴" };
  const lines = [];
  lines.push(`【${icon[d.severity] ?? ""} ${d.severity.toUpperCase()}】${d.summary}`);
  lines.push("");
  if (d.raw.players) {
    lines.push(`在线：${d.raw.players.online} / ${d.raw.players.max}` + (d.raw.players.names.length ? `  （${d.raw.players.names.join("、")}）` : ""));
  }
  if (d.raw.tps?.overall) {
    lines.push(`TPS：${d.raw.tps.overall.tps}   MSPT：${d.raw.tps.overall.mspt} ms`);
  }
  lines.push("");
  lines.push("诊断项：");
  for (const f of d.findings) {
    lines.push(`  ${icon[f.level] ?? "-"} [${f.area}] ${f.message}`);
  }
  if (d.actions.length > 0) {
    lines.push("");
    lines.push("建议动作：");
    d.actions.forEach((a, i) => lines.push(`  ${i + 1}. ${a}`));
  }
  return lines.join("\n");
}
