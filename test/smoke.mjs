/**
 * 冒烟测试：不需要真实服务器也能跑
 *
 *   ELECTRON_RUN_AS_NODE=1 "<DSH>/DSH NEXT.exe" test/smoke.mjs
 *   （或者装了 node 就直接 node test/smoke.mjs）
 *
 * 本测试只验证「结构 + 纯函数」，不会连接任何真实服务器。
 * 想测真实连接，把 test/live.mjs.example 复制成 test/live.mjs 并填你自己的服务器信息。
 */
import { apply, name } from "../lib/index.js";
import { buildItemCleaner, listDatapacks } from "../lib/datapacks.js";
import { installMonitor, listAssets } from "../lib/monitor.js";
import { parseForgeTps, parsePlayerList, parseEntityList, analyzeLagLog, diagnose, renderDiagnosis } from "../lib/diagnose.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

let failed = 0;
function ok(label, cond, detail = "") {
  if (cond) {
    console.log(`  ✅ ${label}${detail ? "  " + detail : ""}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}${detail ? "  " + detail : ""}`);
  }
}

console.log("=== 1. 插件元信息 ===");
ok("name", name === "mc-server-ops", name);

console.log("\n=== 2. 工具注册 ===");
const tools = new Map();
const ctx = { tools: { register: (t) => tools.set(t.name, t) } };
apply(ctx, { servers: {}, defaultServer: "", timeoutMs: 15000, monitorDir: "" });
ok("注册 12 个工具", tools.size === 12, String(tools.size));
ok(
  "工具名齐全",
  ["mc_status", "mc_rcon", "mc_diagnose", "mc_cleanup", "mc_announce", "mc_restart", "mc_log", "mc_config", "mc_install_datapack", "mc_monitor", "mc_deploy", "mc_pitfalls"].every((n) => tools.has(n)),
  [...tools.keys()].join(", "),
);

console.log("\n=== 3. 每个工具的 schema 完整性 ===");
let schemaOk = true;
for (const [n, t] of tools) {
  const hasName = typeof t.name === "string" && t.name.length > 0;
  const hasDesc = typeof t.description === "string" && t.description.length > 20;
  const hasParams = t.parameters && typeof t.parameters === "object";
  const hasExec = typeof t.execute === "function";
  const hasRender = t.output && typeof t.output.render === "function";
  if (!(hasName && hasDesc && hasParams && hasExec && hasRender)) {
    schemaOk = false;
    console.log(`  ❌ ${n}  schema 不完整: name=${hasName} desc=${hasDesc} params=${hasParams} exec=${hasExec} render=${hasRender}`);
  }
}
ok("全部工具 schema 完整", schemaOk);

console.log("\n=== 4. 资产 ===");
const assets = listAssets();
ok("4 个资产文件", assets.length === 4, assets.join(", "));
ok("数据包清单", listDatapacks().length === 1, listDatapacks().map((d) => d.id).join(", "));

console.log("\n=== 5. 数据包生成（含参数替换）===");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcops-smoke-"));
const built = buildItemCleaner({ targetDir: tmp, intervalMinutes: 5, warnSeconds: 10, packFormat: 15 });
ok("目录存在", fs.existsSync(built.dir), built.dir);
ok("intervalTicks = 6000", built.intervalTicks === 6000, String(built.intervalTicks));
ok("warnAt = 5800", built.warnAt === 5800, String(built.warnAt));
const tickBody = fs.readFileSync(path.join(built.dir, "data/itemcleaner/functions/tick.mcfunction"), "utf8");
ok("tick.mcfunction 用了 icTimer（不是 #timer）", tickBody.includes("icTimer") && !tickBody.includes("#timer"));
ok("tick.mcfunction 无未替换占位符", !tickBody.includes("{{"), (tickBody.trim().split("\n")[2] ?? "").trim());
const mcmeta = JSON.parse(fs.readFileSync(path.join(built.dir, "pack.mcmeta"), "utf8"));
ok("pack.mcmeta pack_format = 15", mcmeta.pack.pack_format === 15, String(mcmeta.pack.pack_format));
ok("pack.mcmeta 描述已替换占位符", !mcmeta.pack.description.includes("{{"), mcmeta.pack.description.slice(0, 40));
let bomFree = true;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else {
      const b = fs.readFileSync(p);
      if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
        bomFree = false;
        console.log(`  ❌ 有 BOM: ${p}`);
      }
    }
  }
};
walk(built.dir);
ok("全部生成文件无 BOM", bomFree);

console.log("\n=== 6. 监控组件安装 ===");
const monDir = path.join(tmp, "monitor");
const mon = installMonitor({ targetDir: monDir, host: "play.example.com", port: 25575, pass: "TEST_ONLY_NOT_REAL", interval: 5, label: "示例服务器" });
ok("4 个文件已复制", mon.copied.length === 4, mon.copied.join(", "));
ok("配置已写入", fs.existsSync(path.join(monDir, "mcmon-config.json")));
const cfg = JSON.parse(fs.readFileSync(path.join(monDir, "mcmon-config.json"), "utf8"));
ok("配置内容正确", cfg.host === "play.example.com" && cfg.port === 25575 && cfg.interval === 5, JSON.stringify(cfg));

console.log("\n=== 7. 解析器 ===");
const t = parseForgeTps("Dim minecraft:overworld (minecraft:overworld): Mean tick time: 6.353 ms. Mean TPS: 20.000\nOverall: Mean tick time: 7.077 ms. Mean TPS: 20.000");
ok("parseForgeTps overall", t.overall?.mspt === 7.077 && t.overall?.tps === 20, JSON.stringify(t.overall));
ok("parseForgeTps 维度", t.dims.length === 1 && t.dims[0].name === "minecraft:overworld", JSON.stringify(t.dims[0]));
const p = parsePlayerList("There are 3 of a max of 50 players online: Alice, Bob, Carol");
ok("parsePlayerList", p.online === 3 && p.max === 50 && p.names.length === 3, p.names.join(","));
const e = parseEntityList("Total: 500\n    120: minecraft:falling_block\n     90: minecraft:zombie");
ok("parseEntityList", e.total === 500 && e.items[0].count === 120, JSON.stringify(e.items));
const lag = analyzeLagLog("Can't keep up! Is the server overloaded? Running 13849ms or 276 ticks behind");
ok("analyzeLagLog", lag.count === 1 && lag.maxMs === 13849, JSON.stringify(lag.worst));

console.log("\n=== 8. 诊断分级（关键回归）===");
const a = diagnose({
  tpsText: "Overall: Mean tick time: 8.2 ms. Mean TPS: 20.000",
  listText: "There are 2 of a max of 50 players online: A, B",
  entityText: "Total: 300\n     22: minecraft:falling_block\n     40: minecraft:zombie",
  logText: "",
});
ok("TPS 正常 + falling_block 22 → warn", a.severity === "warn", a.severity);
ok("结论里说明是「潜在隐患」", /隐患/.test(a.summary), a.summary);

const b = diagnose({
  tpsText: "Dim minecraft:overworld (minecraft:overworld): Mean tick time: 68.5 ms. Mean TPS: 14.2\nOverall: Mean tick time: 70.1 ms. Mean TPS: 14.1",
  listText: "There are 5 of a max of 50 players online: A, B, C, D, E",
  entityText: "Total: 500\n    120: minecraft:falling_block\n     90: minecraft:zombie",
  logText: "Can't keep up! Running 13849ms or 276 ticks behind\nCan't keep up! Running 11912ms or 238 ticks behind",
  system: { javaMemGB: 10.4, javaMemMaxGB: 10, cpuPercent: 100, freeMemGB: 4.1, totalMemGB: 16 },
});
ok("严重卡顿 → critical", b.severity === "critical", b.severity);
ok("给出多条建议动作", b.actions.length >= 4, String(b.actions.length));
ok("报告可渲染", renderDiagnosis(b).length > 200);

console.log("\n=== 9. 清理 ===");
try {
  fs.rmSync(tmp, { recursive: true, force: true });
  ok("临时目录已清理", true);
} catch {
  ok("临时目录已清理", false);
}

console.log("\n" + (failed === 0 ? "ALL_OK" : `FAILED (${failed})`));
process.exit(failed === 0 ? 0 : 1);
