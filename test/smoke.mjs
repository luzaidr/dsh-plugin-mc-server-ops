/**
 * 冒烟测试 v0.2.0 —— 不需要真实服务器
 *
 *   ELECTRON_RUN_AS_NODE=1 "<DSH>/DSH NEXT.exe" test/smoke.mjs
 *   或：node test/smoke.mjs
 */
import { apply, name } from "../lib/index.js";
import { buildItemCleaner, listDatapacks } from "../lib/datapacks.js";
import { installMonitor, listAssets } from "../lib/monitor.js";
import { parseForgeTps, parsePlayerList, parseEntityList, analyzeLagLog, diagnose, renderDiagnosis } from "../lib/diagnose.js";
import {
  validatePokemonSpec,
  buildPokegiveCommand,
  buildPokeEditCommand,
  resolveItem,
  resolveNature,
  resolveAbility,
  resolveMove,
  NATURES,
  ABILITIES,
  ITEMS,
  MOVES,
} from "../lib/cobblemon.js";
import {
  parseProperties,
  mergeProperties,
  detectPlotsRisks,
  buildAdventureFix,
  buildEconomyCommand,
  auditPlayerData,
  buildQuestAdvancementFix,
  recommendJvm,
  writeJvmArgs,
  PLOTS_DEFAULTS,
} from "../lib/extras.js";
import { KB, searchKb, kbCategories } from "../lib/kb.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

let failed = 0;
function ok(label, cond, detail = "") {
  if (cond) console.log(`  ✅ ${label}${detail ? "  " + detail : ""}`);
  else {
    failed++;
    console.log(`  ❌ ${label}${detail ? "  " + detail : ""}`);
  }
}
function section(t) {
  console.log(`\n=== ${t} ===`);
}

// ---------------------------------------------------------------------------
section("1. 插件元信息");
ok("name = mc-server-ops", name === "mc-server-ops", name);

// ---------------------------------------------------------------------------
section("2. 工具注册（v0.2.0 应有 22 个）");
const tools = new Map();
const ctx = { tools: { register: (t) => tools.set(t.name, t) } };
apply(ctx, { servers: {}, defaultServer: "", timeoutMs: 15000, monitorDir: "" });
ok("22 个工具", tools.size === 22, String(tools.size));

const EXPECTED = [
  // v0.1.0 通用
  "mc_status", "mc_rcon", "mc_diagnose", "mc_cleanup", "mc_announce", "mc_restart",
  "mc_log", "mc_config", "mc_install_datapack", "mc_monitor", "mc_deploy", "mc_pitfalls",
  // v0.2.0 宝可梦 / 地皮
  "mc_pokemon_give", "mc_pokemon_edit", "mc_pokemon_team", "mc_pokemon_item",
  "mc_plots", "mc_economy", "mc_playerdata", "mc_gamemode_fix", "mc_quest", "mc_jvm",
];
const missing = EXPECTED.filter((n) => !tools.has(n));
ok("工具名齐全", missing.length === 0, missing.length ? "缺: " + missing.join(", ") : EXPECTED.length + " 个全在");

section("3. 每个工具的 schema 完整性");
let schemaOk = true;
for (const [n, t] of tools) {
  const hasName = typeof t.name === "string" && t.name.length > 0;
  const hasDesc = typeof t.description === "string" && t.description.length > 30;
  const hasParams = t.parameters && typeof t.parameters === "object";
  const hasExec = typeof t.execute === "function";
  const hasRender = t.output && typeof t.output.render === "function";
  if (!(hasName && hasDesc && hasParams && hasExec && hasRender)) {
    schemaOk = false;
    console.log(`  ❌ ${n}: name=${hasName} desc=${hasDesc} params=${hasParams} exec=${hasExec} render=${hasRender}`);
  }
}
ok("全部工具 schema 完整", schemaOk);

// ---------------------------------------------------------------------------
section("4. ★ Cobblemon 翻译表");
ok("性格 > 20 条", Object.keys(NATURES).length > 20, String(Object.keys(NATURES).length));
ok("特性 > 20 条", Object.keys(ABILITIES).length > 20, String(Object.keys(ABILITIES).length));
ok("道具 > 30 条", Object.keys(ITEMS).length > 30, String(Object.keys(ITEMS).length));
ok("技能 > 60 条", Object.keys(MOVES).length > 60, String(Object.keys(MOVES).length));
ok("内敛 → modest", resolveNature("内敛") === "modest", String(resolveNature("内敛")));
ok("胆小 → timid", resolveNature("胆小") === "timid", String(resolveNature("胆小")));
ok("降雨 → drizzle", resolveAbility("降雨") === "drizzle", String(resolveAbility("降雨")));
ok("浊流 → muddywater", resolveMove("浊流") === "muddywater", String(resolveMove("浊流")));

section("5. ★★ 超进化石必须解析到 mega_showdown（不是 zamega）");
const stoneChecks = [
  ["喷火龙Y进化石", "mega_showdown:charizardite_y"],
  ["喷火龙X进化石", "mega_showdown:charizardite_x"],
  ["巨金怪进化石", "mega_showdown:metagrossite"],
  ["具甲武者进化石", "mega_showdown:golisopite"],
  ["勾魂眼进化石", "mega_showdown:sablenite"],
  ["超级手环", "mega_showdown:mega_bracelet"],
];
for (const [zh, expect] of stoneChecks) {
  const got = resolveItem(zh);
  ok(`${zh} → ${expect}`, got === expect, got ?? "null");
}
ok("生命宝珠 → cobblemon:life_orb", resolveItem("生命宝珠") === "cobblemon:life_orb", resolveItem("生命宝珠"));
ok("已带命名空间的原样返回", resolveItem("mega_showdown:metagrossite") === "mega_showdown:metagrossite");

// ---------------------------------------------------------------------------
section("6. ★★ pokeedit 护栏（只传 1 个技能必须拒绝）");
let guardThrew = false;
let guardMsg = "";
try {
  buildPokeEditCommand("Alice", 4, { moves: ["overheat"] });
} catch (e) {
  guardThrew = true;
  guardMsg = String(e.message);
}
ok("只传 1 个技能 → 抛错", guardThrew);
ok("错误信息说明了原因", /替换整个技能栏|清空/.test(guardMsg), guardMsg.split("\n")[0]);
let guardThrew2 = false;
try {
  buildPokeEditCommand("Alice", 4, { moves: ["overheat", "flamethrower", "roost"] });
} catch {
  guardThrew2 = true;
}
ok("只传 3 个技能 → 也抛错", guardThrew2);
const okEdit = buildPokeEditCommand("Alice", 4, { moves: ["flamethrower", "hurricane", "roost", "overheat"] });
ok("传 4 个技能 → 正常", okEdit === "execute as Alice run pokeedit 4 moves=flamethrower,hurricane,roost,overheat", okEdit);

section("7. pokegive 命令生成");
const v = validatePokemonSpec({
  species: "pelipper",
  level: 50,
  nature: "胆小",
  ability: "降雨",
  heldItem: "潮湿岩石",
  moves: ["浊流", "暴风", "冰冻光束", "求雨"],
  ivs: [31, 31, 31, 31, 31, 31],
  evs: [6, 0, 0, 252, 0, 252],
});
ok("校验通过", v.ok, v.errors.join("; "));
const giveCmd = buildPokegiveCommand("Alice", v.spec);
ok("命令以 execute as 开头", giveCmd.startsWith("execute as Alice run pokegive pelipper"), giveCmd.slice(0, 60));
ok("含 level=50", giveCmd.includes("level=50"));
ok("含 nature=timid", giveCmd.includes("nature=timid"));
ok("含 ability=drizzle", giveCmd.includes("ability=drizzle"));
ok("含 held_item", giveCmd.includes("held_item=cobblemon:damp_rock"));
ok("含 moves", giveCmd.includes("moves=muddywater,hurricane,icebeam,raindance"));
ok("含 ivs", giveCmd.includes("speed_iv=31"));
ok("含 evs", giveCmd.includes("special_attack_ev=252"));

section("8. 参数校验能抓错");
const bad1 = validatePokemonSpec({ species: "pelipper", ivs: [31, 31] });
ok("ivs 数量不对 → 报错", !bad1.ok && bad1.errors.some((e) => /ivs/.test(e)), bad1.errors[0] ?? "");
const bad2 = validatePokemonSpec({ species: "pelipper", evs: [252, 252, 252, 252, 252, 252] });
ok("努力值总和 >510 → 报错", !bad2.ok && bad2.errors.some((e) => /510/.test(e)), bad2.errors[0] ?? "");
const bad3 = validatePokemonSpec({ species: "pelipper", level: 999 });
ok("等级越界 → 报错", !bad3.ok, bad3.errors[0] ?? "");

// ---------------------------------------------------------------------------
section("9. ★ 经济命令参数顺序（金额 货币 玩家）");
const eco = buildEconomyCommand({ action: "deposit", amount: 10000, player: "Alice" });
ok("顺序正确", eco === "economy deposit 10000 impactor:dollars Alice", eco);
const eco2 = buildEconomyCommand({ action: "balance", player: "Alice" });
ok("balance 不带金额", eco2 === "economy balance impactor:dollars Alice", eco2);
let ecoThrew = false;
try {
  buildEconomyCommand({ action: "deposit", amount: -5, player: "Alice" });
} catch {
  ecoThrew = true;
}
ok("负数金额 → 抛错", ecoThrew);

// ---------------------------------------------------------------------------
section("10. ★ fabricplots 危险配置检测");
const dangerous = parseProperties(`
mob-scan-interval-ticks=1200
unnamed-mob-grace-ticks=600
mob-cap-per-plot=5
claim-limit=1
street-sweeper=true
`);
const risks = detectPlotsRisks(dangerous);
ok("检出风险", risks.length >= 3, String(risks.length));
ok("有 critical 级别", risks.some((r) => r.level === "critical"));
ok("指出 mob-scan-interval-ticks", risks.some((r) => /mob-scan-interval-ticks/.test(r.message)));

const safe = parseProperties(`mob-scan-interval-ticks=2147483000
unnamed-mob-grace-ticks=2147483000
mob-cap-per-plot=999`);
ok("安全配置无风险", detectPlotsRisks(safe).length === 0, String(detectPlotsRisks(safe).length));

const merged = mergeProperties("mob-scan-interval-ticks=1200\n# 保留这行注释\nclaim-limit=1\n", PLOTS_DEFAULTS);
ok("merge 后 mob-scan 变安全值", /mob-scan-interval-ticks=2147483000/.test(merged));
ok("merge 保留注释", /# 保留这行注释/.test(merged));

// ---------------------------------------------------------------------------
section("11. ★ JVM 档位（16GB→12G，64GB→22G 是实测值）");
ok("16 GB → 12 G", recommendJvm(16).xmx === 12, String(recommendJvm(16).xmx));
ok("64 GB → 22 G", recommendJvm(64).xmx === 22, String(recommendJvm(64).xmx));
ok("12 GB → 8 G", recommendJvm(12).xmx === 8, String(recommendJvm(12).xmx));
ok("8 GB 有吃紧警告", recommendJvm(8).warnings.some((w) => /吃紧/.test(w)));
ok("64 GB 警告 AlwaysPreTouch", recommendJvm(64).warnings.some((w) => /AlwaysPreTouch|1450/.test(w)));

const tmpJvm = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mcops-jvm-")), "user_jvm_args.txt");
const wj = writeJvmArgs(tmpJvm, recommendJvm(16).args);
ok("写入 user_jvm_args.txt", fs.existsSync(tmpJvm));
ok("★ 写的文件无 BOM", wj.hasBom === false);
const jvmFirstLine = fs.readFileSync(tmpJvm, "utf8").split("\n")[0];
ok("第一行是 -Xms… -Xmx…", /^-Xms\d+G -Xmx\d+G$/.test(jvmFirstLine), jvmFirstLine);

// ---------------------------------------------------------------------------
section("12. 数据包生成");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcops-smoke-"));
const built = buildItemCleaner({ targetDir: tmp, intervalMinutes: 5, warnSeconds: 10, packFormat: 15 });
ok("item-cleaner 生成", fs.existsSync(built.dir));
ok("intervalTicks = 6000", built.intervalTicks === 6000, String(built.intervalTicks));
const tickBody = fs.readFileSync(path.join(built.dir, "data/itemcleaner/functions/tick.mcfunction"), "utf8");
ok("用 icTimer 不用 #timer", tickBody.includes("icTimer") && !tickBody.includes("#timer"));
ok("无未替换占位符", !tickBody.includes("{{"));

const adv = buildAdventureFix({ targetDir: tmp, arenaDimension: "spleef:arena", packFormat: 15 });
ok("adventure-fix 生成", fs.existsSync(adv.dir));
ok("adventure-fix 6 个文件", adv.files.length === 6, adv.files.join(", "));
const fixBody = fs.readFileSync(path.join(adv.dir, "data/advfix/functions/fix_one.mcfunction"), "utf8");
ok("fix_one 会切回 survival", /gamemode survival @s/.test(fixBody));
const predBody = JSON.parse(fs.readFileSync(path.join(adv.dir, "data/advfix/predicate/in_arena.json"), "utf8"));
ok("in_arena 判定 spleef:arena", predBody.predicate.dimension === "spleef:arena", JSON.stringify(predBody.predicate));

const qf = buildQuestAdvancementFix({
  targetDir: tmp,
  advancements: [{ namespace: "rctmod", path: "trainers/defeat_kanto_giovanni_gym" }],
  packFormat: 15,
});
ok("quest-adv-fix 生成", fs.existsSync(qf.dir));
const stub = JSON.parse(fs.readFileSync(path.join(qf.dir, "data/rctmod/advancements/trainers/defeat_kanto_giovanni_gym.json"), "utf8"));
ok("桩成就用 impossible 触发器", stub.criteria.impossible.trigger === "minecraft:impossible");
ok("桩成就是 hidden", stub.display.hidden === true);

// BOM 全扫
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
walk(adv.dir);
walk(qf.dir);
ok("所有生成文件无 BOM", bomFree);

// ---------------------------------------------------------------------------
section("13. 玩家数据审计");
const fakeWorld = path.join(tmp, "world");
fs.mkdirSync(path.join(fakeWorld, "playerdata"), { recursive: true });
fs.mkdirSync(path.join(fakeWorld, "cobblemonplayerdata"), { recursive: true });
fs.mkdirSync(path.join(fakeWorld, "data"), { recursive: true });
fs.writeFileSync(path.join(fakeWorld, "playerdata", "aaaa1111-0000-0000-0000-000000000001.dat"), Buffer.alloc(500, 1));
fs.writeFileSync(path.join(fakeWorld, "playerdata", "bbbb2222-0000-0000-0000-000000000002.dat"), Buffer.alloc(0)); // 零字节
fs.writeFileSync(path.join(fakeWorld, "playerdata", "cccc3333-0000-0000-0000-000000000003.dat.old"), Buffer.alloc(400, 1)); // 孤儿
fs.writeFileSync(path.join(fakeWorld, "cobblemonplayerdata", "aaaa1111-0000-0000-0000-000000000001.json"), "{}");
const audit = auditPlayerData(fakeWorld);
ok("统计到 2 个 playerdata", audit.playerdata.count === 2, String(audit.playerdata.count));
ok("检出 1 个零字节", audit.playerdata.zeroByte.length === 1, audit.playerdata.zeroByte.join(","));
ok("检出 1 个孤立 .old", audit.playerdata.oldOrphans.length === 1, audit.playerdata.oldOrphans.join(","));
ok("判定为 damaged", audit.verdict === "damaged", audit.verdict);
ok("提示 .dat.old 噪音是良性", audit.notes.some((n) => /良性噪音/.test(n)));

// ---------------------------------------------------------------------------
section("14. 知识库");
ok("KB 条目 ≥ 30", KB.length >= 30, String(KB.length));
const cats = kbCategories();
ok("有 general / cobblemon / plots 分类", cats.length >= 3, cats.map((c) => `${c.cat}(${c.count})`).join(" "));
ok("能搜到 falling_block", searchKb("falling_block").length > 0);
ok("能搜到 pokeedit", searchKb("pokeedit").length > 0);
ok("能搜到 地皮", searchKb("地皮").length > 0);
ok("能搜到 超进化", searchKb("超进化").length > 0);
ok("能搜到 1450", searchKb("1450").length > 0);

// ---------------------------------------------------------------------------
section("15. 通用解析器（回归）");
const t = parseForgeTps("Overall: Mean tick time: 7.077 ms. Mean TPS: 20.000");
ok("parseForgeTps", t.overall?.mspt === 7.077 && t.overall?.tps === 20);
ok("parsePlayerList", parsePlayerList("There are 3 of a max of 50 players online: A, B, C").names.length === 3);
ok("parseEntityList", parseEntityList("Total: 500\n    120: minecraft:falling_block").items[0].count === 120);
ok("analyzeLagLog", analyzeLagLog("Can't keep up! Running 13849ms or 276 ticks behind").maxMs === 13849);

section("16. 诊断分级（关键回归）");
const a = diagnose({ tpsText: "Overall: Mean tick time: 8.2 ms. Mean TPS: 20.000", entityText: "Total: 300\n     22: minecraft:falling_block" });
ok("TPS 正常 + falling_block 22 → warn", a.severity === "warn", a.severity);
const b = diagnose({
  tpsText: "Overall: Mean tick time: 70.1 ms. Mean TPS: 14.1",
  entityText: "Total: 500\n    120: minecraft:falling_block",
  system: { javaMemGB: 10.4, javaMemMaxGB: 10, cpuPercent: 100 },
});
ok("严重卡顿 → critical", b.severity === "critical", b.severity);
ok("报告可渲染", renderDiagnosis(b).length > 200);

section("17. 资产与监控");
ok("4 个监控资产", listAssets().length === 4, listAssets().join(", "));
const monDir = path.join(tmp, "monitor");
const mon = installMonitor({ targetDir: monDir, host: "play.example.com", port: 25575, pass: "TEST", interval: 5, label: "示例" });
ok("监控组件安装", mon.copied.length === 4);
ok("配置写对", JSON.parse(fs.readFileSync(path.join(monDir, "mcmon-config.json"), "utf8")).host === "play.example.com");

section("18. 清理");
try {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(path.dirname(tmpJvm), { recursive: true, force: true });
  ok("临时目录已清理", true);
} catch {
  ok("临时目录已清理", false);
}

console.log("\n" + (failed === 0 ? "ALL_OK" : `FAILED (${failed})`));
process.exit(failed === 0 ? 0 : 1);
