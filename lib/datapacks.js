/**
 * 数据包生成与安装
 *
 * 内置数据包：
 *  - item-cleaner：每 N 分钟自动清理地面掉落物（清理前预警）
 *
 * 设计要点（都是踩过的坑）：
 *  - .mcfunction 里 `#` 是注释符 → 伪玩家名不能用 `#timer`，必须用 `icTimer`
 *  - 文件必须 UTF-8 无 BOM，否则第一行命令会带上 BOM 而报错
 *  - pack_format：1.20.1 = 15
 *  - 目录名：1.20.1 用 `functions/`（1.21+ 改成 `function/`）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(__dirname, "..", "assets");
const TEMPLATE_ROOT = path.join(ASSETS, "datapacks", "item-cleaner");

/** 1.21+ 把 functions 改成 function */
function functionsDir(packFormat) {
  return packFormat >= 45 ? "function" : "functions";
}

/** 写文件（UTF-8 无 BOM，强制 LF） */
function writeNoBom(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const normalized = content.replace(/\r\n/g, "\n");
  fs.writeFileSync(file, normalized, { encoding: "utf8" });
}

/**
 * 生成 item-cleaner 数据包
 * @param {object} opts
 * @param {string} opts.targetDir      输出目录（会创建 <targetDir>/item-cleaner）
 * @param {number} [opts.intervalMinutes]  清理间隔（分钟，默认 10）
 * @param {number} [opts.warnSeconds]  预警提前量（秒，默认 10）
 * @param {number} [opts.packFormat]   pack_format（1.20.1 = 15；1.21.1 = 48）
 * @returns {{dir:string, files:string[], intervalTicks:number, warnAt:number}}
 */
export function buildItemCleaner(opts) {
  const intervalMinutes = opts.intervalMinutes ?? 10;
  const warnSeconds = opts.warnSeconds ?? 10;
  const packFormat = opts.packFormat ?? 15;

  const intervalTicks = Math.round(intervalMinutes * 60 * 20);
  const warnTicks = Math.round(warnSeconds * 20);
  const warnAt = Math.max(1, intervalTicks - warnTicks);

  const ns = "itemcleaner";
  const fdir = functionsDir(packFormat);
  const outDir = path.join(path.resolve(opts.targetDir), "item-cleaner");

  const subst = (s) =>
    s
      .replaceAll("{{INTERVAL_MIN}}", String(intervalMinutes))
      .replaceAll("{{INTERVAL_TICKS}}", String(intervalTicks))
      .replaceAll("{{WARN_SEC}}", String(warnSeconds))
      .replaceAll("{{WARN_AT}}", String(warnAt))
      .replaceAll("{{CLEAN_AT}}", String(intervalTicks));

  const files = [];

  const readT = (rel) => fs.readFileSync(path.join(TEMPLATE_ROOT, rel), "utf8");

  // pack.mcmeta
  const mcmeta = JSON.parse(readT("pack.mcmeta"));
  mcmeta.pack.pack_format = packFormat;
  mcmeta.pack.description = subst(mcmeta.pack.description);
  writeNoBom(path.join(outDir, "pack.mcmeta"), JSON.stringify(mcmeta, null, 2));
  files.push("pack.mcmeta");

  // tick 钩子
  const tickTag = JSON.parse(readT("data/minecraft/tags/functions/tick.json"));
  writeNoBom(path.join(outDir, "data", "minecraft", "tags", fdir, "tick.json"), JSON.stringify(tickTag, null, 2));
  files.push(`data/minecraft/tags/${fdir}/tick.json`);

  // 三个函数
  for (const fn of ["tick", "warn", "clean"]) {
    const body = subst(readT(`data/itemcleaner/functions/${fn}.mcfunction`));
    writeNoBom(path.join(outDir, "data", ns, fdir, `${fn}.mcfunction`), body);
    files.push(`data/${ns}/${fdir}/${fn}.mcfunction`);
  }

  return { dir: outDir, files, intervalTicks, warnAt };
}

/** 内置数据包清单 */
export function listDatapacks() {
  return [
    {
      id: "item-cleaner",
      name: "掉落物清理",
      description: "每 N 分钟清理地面掉落物，清理前预警并统计数量。防止掉落物堆积导致的服务器卡顿。",
      params: { intervalMinutes: 10, warnSeconds: 10, packFormat: 15 },
      build: buildItemCleaner,
    },
  ];
}

/**
 * 把生成好的数据包部署到服务器 world/datapacks
 * 只做本地目录复制（远程请用 mc_deploy_datapack 配合 SSH）
 */
export function copyIntoServerWorld(opts) {
  const src = path.resolve(opts.packDir);
  const world = path.resolve(opts.worldDir);
  const dest = path.join(world, "datapacks", path.basename(src));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  return { dest, worldDir: world };
}
