/**
 * v0.2.0 新增的 10 个工具（宝可梦服专有场景）
 *
 * 与 lib/index.js 的基础工具分开，方便维护。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { rconOnce } from "./rcon.js";
import { cleanOutput } from "./ssh.js";
import {
  validatePokemonSpec,
  buildPokegiveCommand,
  buildPokeEditCommand,
  parseOnlinePlayers,
  resolveItem,
} from "./cobblemon.js";
import {
  PLOTS_DEFAULTS,
  parseProperties,
  mergeProperties,
  detectPlotsRisks,
  buildAdventureFix,
  buildEconomyCommand,
  auditPlayerData,
  buildQuestAdvancementFix,
  recommendJvm,
  writeJvmArgs,
} from "./extras.js";

/** 由 index.js 注入的公共工具 */
let H = {};

export function initHelpers(helpers) {
  H = helpers;
}

function text(v) {
  return [{ type: "text", text: String(v) }];
}

// ===========================================================================
// 宝可梦：发 / 改 / 查 / 道具
// ===========================================================================

export function toolMcPokemonGive(ctx, config) {
  return {
    name: "mc_pokemon_give",
    description:
      "给玩家发宝可梦（Cobblemon）。自动加 execute as 玩家上下文，自动把中文的性格/特性/道具/技能翻译成英文参数值。支持等级、性别、性格、特性、6V/努力值、携带道具、4 个技能。",
    parameters: {
      player: { type: "string", required: true, description: "目标玩家名" },
      species: { type: "string", required: true, description: "物种英文 ID（如 pelipper / garchomp / mimikyu）" },
      level: { type: "integer", description: "等级，默认 50" },
      gender: { type: "string", description: "male / female / genderless" },
      nature: { type: "string", description: "性格，中英文均可：内敛 / 胆小 / 爽朗 / 固执 / 大胆 / 淘气 / 温和 / 慎重 / 悠闲 / 天真 / 冷静" },
      ability: { type: "string", description: "特性，中英文均可：降雨 / 扬沙 / 再生力 / 魔法镜 / 纯朴 / 恒净之躯 / 画皮 / 铁刺 / 轻装" },
      heldItem: { type: "string", description: "携带道具，中文或 ID：生命宝珠 / 吃剩的东西 / 凹凸头盔 / 气势披带 / 讲究围巾 / 潮湿岩石 / 进化奇石" },
      moves: { type: "array", items: { type: "string" }, description: "最多 4 个技能，中文或英文：浊流 / 暴风 / 冰冻光束 / 守住" },
      ivs: { type: "array", items: { type: "integer" }, description: "6 个个体值，顺序 hp/atk/def/spa/spd/spe。6V 传 [31,31,31,31,31,31]" },
      evs: { type: "array", items: { type: "integer" }, description: "6 个努力值，顺序同上，总和 ≤510" },
      server: { type: "string", description: "服务器名称" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          command: { type: "string" },
          output: { type: "string" },
          errors: { type: "array", items: { type: "string" } },
          warnings: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
        },
      },
      render: (_a, v) => text(v.summary),
    },
    async execute(args) {
      const v = validatePokemonSpec({
        species: args.species,
        level: args.level,
        nature: args.nature,
        ability: args.ability,
        gender: args.gender,
        heldItem: args.heldItem,
        moves: args.moves,
        ivs: args.ivs,
        evs: args.evs,
      });
      if (!v.ok) {
        return {
          ok: false,
          command: "",
          output: "",
          errors: v.errors,
          warnings: v.warnings,
          summary: `❌ 参数有误，未执行：\n${v.errors.map((e) => "  - " + e).join("\n")}`,
        };
      }
      let cmd;
      try {
        cmd = buildPokegiveCommand(args.player, v.spec);
      } catch (e) {
        return { ok: false, command: "", output: "", errors: [String(e.message)], warnings: [], summary: `❌ ${e.message}` };
      }
      const server = H.resolveServer(config, args.server);
      try {
        const res = await rconOnce(H.rconOpts(server, config), cmd);
        const out = res[0].output.trim();
        const good = /Gave |has been given/i.test(out) || out.length > 0;
        return {
          ok: good,
          command: cmd,
          output: out,
          errors: [],
          warnings: v.warnings,
          summary:
            (good ? "✅ " : "⚠️ ") +
            `给 ${args.player} 发了 ${v.spec.species}\n` +
            `命令：${cmd}\n` +
            `返回：${out || "(无输出)"}` +
            (v.warnings.length ? `\n注意：\n${v.warnings.map((w) => "  - " + w).join("\n")}` : ""),
        };
      } catch (e) {
        return { ok: false, command: cmd, output: "", errors: [H.safeErr(e)], warnings: v.warnings, summary: `❌ 执行失败：${H.safeErr(e)}\n命令：${cmd}` };
      }
    },
  };
}

export function toolMcPokemonEdit(ctx, config) {
  return {
    name: "mc_pokemon_edit",
    description:
      "修改玩家身上某只宝可梦（Cobblemon /pokeedit）。⚠️ 改技能必须传完整 4 个——moves= 是【替换整个技能栏】，只传 1-3 个会把剩下的清空（本工具会拒绝执行并说明原因）。",
    parameters: {
      player: { type: "string", required: true, description: "玩家名" },
      slot: { type: "integer", required: true, description: "队伍槽位 1~6" },
      moves: { type: "array", items: { type: "string" }, description: "⚠️ 必须正好 4 个技能（替换整个技能栏）" },
      level: { type: "integer", description: "改成这个等级" },
      nature: { type: "string", description: "改性格" },
      ability: { type: "string", description: "改特性" },
      heldItem: { type: "string", description: "改携带道具（传 none 表示取下）" },
      server: { type: "string", description: "服务器名称" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { ok: { type: "boolean", required: true }, command: { type: "string" }, output: { type: "string" }, summary: { type: "string" } },
      },
      render: (_a, v) => text(v.summary),
    },
    async execute(args) {
      const opts = {};
      if (args.moves !== undefined) opts.moves = args.moves;
      if (args.level !== undefined) opts.level = args.level;
      if (args.nature !== undefined) opts.nature = args.nature;
      if (args.ability !== undefined) opts.ability = args.ability;
      if (args.heldItem !== undefined) opts.heldItem = String(args.heldItem).toLowerCase() === "none" ? null : args.heldItem;

      let cmd;
      try {
        cmd = buildPokeEditCommand(args.player, args.slot, opts);
      } catch (e) {
        return { ok: false, command: "", output: "", summary: `❌ ${e.message}` };
      }
      const server = H.resolveServer(config, args.server);
      try {
        const res = await rconOnce(H.rconOpts(server, config), cmd);
        const out = res[0].output.trim();
        return { ok: true, command: cmd, output: out, summary: `✅ 已修改\n命令：${cmd}\n返回：${out || "(无输出)"}` };
      } catch (e) {
        return { ok: false, command: cmd, output: "", summary: `❌ 执行失败：${H.safeErr(e)}\n命令：${cmd}` };
      }
    },
  };
}

export function toolMcPokemonTeam(ctx, config) {
  return {
    name: "mc_pokemon_team",
    description:
      "读玩家的宝可梦队伍（SSH 读 world/usercache.json 拿 UUID，再读 world/cobblemonplayerdata/<uuid>.json）。比 pokeedit 探测安全，不会修改任何东西。",
    parameters: {
      player: { type: "string", required: true, description: "玩家名" },
      showMoves: { type: "boolean", description: "是否显示技能，默认 true" },
      server: { type: "string", description: "服务器名称" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          uuid: { type: "string" },
          party: { type: "array", items: { type: "object", additionalProperties: true } },
          raw: { type: "string" },
          summary: { type: "string" },
        },
      },
      render: (_a, v) => text(v.summary),
    },
    async execute(args) {
      const server = H.resolveServer(config, args.server);
      const ssh = H.sshSession(server);
      if (!ssh) {
        return {
          ok: false,
          uuid: "",
          party: [],
          raw: "",
          summary:
            "❌ 读队伍需要 ssh 配置（要读存档文件）。\n" +
            `替代方案（会用 pokeedit 探测，但会把等级设成 50）：\n` +
            `  execute as ${args.player} run pokeedit 1 level=50   → 返回 "Edited xxx's Pikachu."`,
        };
      }
      const dir = server.serverDir ?? "/opt/minecraft";
      const script = `
$ErrorActionPreference = 'SilentlyContinue'
$dir = '${dir.replace(/'/g, "''")}'
$name = '${String(args.player).replace(/'/g, "''")}'
$uc = Join-Path $dir 'world/usercache.json'
if (-not (Test-Path $uc)) { Write-Output 'ERR_NO_USERCACHE'; exit }
$users = Get-Content $uc -Raw | ConvertFrom-Json
$u = $users | Where-Object { $_.name -ieq $name } | Select-Object -First 1
if (-not $u) { Write-Output ('ERR_NO_USER:' + $name); exit }
Write-Output ('UUID=' + $u.uuid)
$cp = Join-Path $dir ('world/cobblemonplayerdata/' + $u.uuid + '.json')
if (-not (Test-Path $cp)) { Write-Output 'ERR_NO_PB'; exit }
$raw = [System.IO.File]::ReadAllText($cp)
Write-Output ('LEN=' + $raw.Length)
$j = $raw | ConvertFrom-Json
$party = $j.party
if ($null -eq $party) { $party = $j.pokemon }
if ($null -eq $party) { $party = @() }
$i = 0
foreach ($p in $party) {
  $i++
  $species = ''
  if ($p.species) { $species = [string]$p.species } elseif ($p.Species) { $species = [string]$p.Species }
  $lv = ''
  if ($p.level) { $lv = [string]$p.level } elseif ($p.Level) { $lv = [string]$p.Level }
  $nm = ''
  if ($p.nickname) { $nm = [string]$p.nickname }
  $moves = @()
  if ($p.moves) { foreach ($m in $p.moves) { if ($m.id) { $moves += $m.id } elseif ($m.move) { $moves += $m.move } elseif ($m -is [string]) { $moves += $m } } }
  $item = ''
  if ($p.heldItem) { $item = [string]$p.heldItem }
  $nature = ''
  if ($p.nature) { $nature = [string]$p.nature }
  $ability = ''
  if ($p.ability) { $ability = [string]$p.ability }
  Write-Output ("$i|" + $species + "|" + $lv + "|" + $nm + "|" + $nature + "|" + $ability + "|" + $item + "|" + ($moves -join ','))
}
Write-Output 'END'
`;
      try {
        const r = await ssh.powershell(script);
        const lines = cleanOutput(r.stdout);
        const joined = lines.join("\n");
        if (/ERR_NO_USERCACHE/.test(joined)) {
          return { ok: false, uuid: "", party: [], raw: joined, summary: `❌ 找不到 world/usercache.json（服务端目录 ${dir} 对吗？）` };
        }
        if (/ERR_NO_USER:/.test(joined)) {
          return { ok: false, uuid: "", party: [], raw: joined, summary: `❌ usercache.json 里没有玩家「${args.player}」（他从没进过服？）` };
        }
        if (/ERR_NO_PB/.test(joined)) {
          return { ok: false, uuid: "", party: [], raw: joined, summary: `❌ 该玩家没有宝可梦数据（没抓过宝可梦？）` };
        }
        const uuid = (/UUID=([0-9a-fA-F-]+)/.exec(joined) ?? [])[1] ?? "";
        const party = [];
        for (const ln of lines) {
          const m = /^(\d+)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|(.*)$/.exec(ln);
          if (!m) continue;
          party.push({
            slot: Number(m[1]),
            species: m[2],
            level: m[3] ? Number(m[3]) : undefined,
            nickname: m[4] || undefined,
            nature: m[5] || undefined,
            ability: m[6] || undefined,
            heldItem: m[7] || undefined,
            moves: m[8] ? m[8].split(",").filter(Boolean) : [],
          });
        }
        const summary = party.length
          ? `【${args.player}】的队伍（UUID ${uuid}）：\n` +
            party
              .map(
                (p) =>
                  `  ${p.slot}. ${p.nickname ? p.nickname + "（" + p.species + "）" : p.species}` +
                  (p.level ? `  Lv${p.level}` : "") +
                  (p.nature ? `  ${p.nature}` : "") +
                  (p.ability ? `  ${p.ability}` : "") +
                  (p.heldItem ? `  @${p.heldItem}` : "") +
                  (args.showMoves !== false && p.moves.length ? `\n      技能：${p.moves.join(", ")}` : ""),
              )
              .join("\n")
          : `该玩家队伍为空或解析不出成员。原始输出：\n${joined.slice(0, 1200)}`;
        return { ok: party.length > 0, uuid, party, raw: joined, summary };
      } catch (e) {
        return { ok: false, uuid: "", party: [], raw: "", summary: `❌ ${H.safeErr(e)}` };
      }
    },
  };
}

export function toolMcPokemonItem(ctx, config) {
  return {
    name: "mc_pokemon_item",
    description:
      "给玩家发宝可梦道具 / 超进化石 + 超级手环。自动把中文名解析成正确 ID（超进化石真实 ID 在 mega_showdown 里，不是 zamega）。megaKit=true 会同时给超级手环。",
    parameters: {
      player: { type: "string", required: true, description: "玩家名" },
      items: { type: "array", items: { type: "string" }, description: "物品名（中文或 ID）：喷火龙Y进化石 / 巨金怪进化石 / 生命宝珠" },
      count: { type: "integer", description: "每个物品数量，默认 1" },
      megaKit: { type: "boolean", description: "是否额外给一个超级手环" },
      server: { type: "string", description: "服务器名称" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          resolved: { type: "array", items: { type: "object", additionalProperties: true } },
          summary: { type: "string" },
        },
      },
      render: (_a, v) => text(v.summary),
    },
    async execute(args) {
      const count = Math.max(1, args.count ?? 1);
      const cmds = [];
      const resolved = [];
      if (args.megaKit) {
        cmds.push(`give ${args.player} mega_showdown:mega_bracelet 1`);
        resolved.push({ input: "(超级手环)", id: "mega_showdown:mega_bracelet" });
      }
      for (const name of args.items ?? []) {
        const id = resolveItem(name, { defaultNamespace: "cobblemon" });
        if (!id) {
          resolved.push({ input: name, id: null, error: "解析失败" });
          continue;
        }
        cmds.push(`give ${args.player} ${id} ${count}`);
        resolved.push({ input: name, id });
      }
      if (cmds.length === 0) {
        return { ok: false, resolved, summary: "❌ 没有可发放的物品。检查 items，或用 megaKit=true 只发手环。" };
      }
      const server = H.resolveServer(config, args.server);
      try {
        const res = await rconOnce(H.rconOpts(server, config), cmds);
        const out = res.map((r) => `${r.command}\n  → ${r.output.trim() || "(无输出)"}`).join("\n");
        return {
          ok: true,
          resolved,
          summary:
            `✅ 已发给 ${args.player}：\n` +
            resolved.map((r) => `  - ${r.input} → ${r.id ?? "❌ 未解析"}`).join("\n") +
            `\n\n执行结果：\n${out}` +
            (resolved.some((r) => r.id && r.id.startsWith("mega_showdown:"))
              ? "\n\n超进化 = 超级手环（饰品栏 mega_slot）+ 宝可梦携带对应进化石 + 战斗中按键。"
              : ""),
        };
      } catch (e) {
        return { ok: false, resolved, summary: `❌ ${H.safeErr(e)}` };
      }
    },
  };
}

// ===========================================================================
// 地皮
// ===========================================================================

export function toolMcPlots(ctx, config) {
  return {
    name: "mc_plots",
    description:
      "fabricplots（地皮）管理：读配置、检测「会自动清理生物/误伤宝可梦」的危险项、一键应用安全配置、广播「地皮不持久化」的重启预警。",
    parameters: {
      action: { type: "string", required: true, description: "read | check | apply-safe | warn-restart" },
      configPath: { type: "string", description: "本地 fabricplots.properties 路径" },
      server: { type: "string", description: "服务器名称（走 SSH 读 <serverDir>/config/fabricplots.properties）" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          values: { type: "object", additionalProperties: true },
          risks: { type: "array", items: { type: "object", additionalProperties: true } },
          summary: { type: "string" },
        },
      },
      render: (_a, v) => text(v.summary),
    },
    async execute(args) {
      const action = args.action;
      let cfgText = null;
      let source = "";

      if (args.configPath) {
        if (!fs.existsSync(args.configPath)) {
          return { ok: false, values: {}, risks: [], summary: `❌ 文件不存在：${args.configPath}` };
        }
        cfgText = fs.readFileSync(args.configPath, "utf8");
        source = args.configPath;
      } else {
        const server = H.resolveServer(config, args.server);
        const ssh = H.sshSession(server);
        if (!ssh) {
          return { ok: false, values: {}, risks: [], summary: "❌ 需要 configPath（本地文件）或配好 ssh（读远端 config/fabricplots.properties）" };
        }
        const dir = server.serverDir ?? "/opt/minecraft";
        const r = await ssh.powershell(`
$p = Join-Path '${dir.replace(/'/g, "''")}' 'config/fabricplots.properties'
if (Test-Path $p) { Get-Content $p } else { Write-Output 'ERR_NO_FILE' }
`);
        const lines = cleanOutput(r.stdout);
        if (lines.includes("ERR_NO_FILE")) {
          return { ok: false, values: {}, risks: [], summary: `❌ 远端找不到 config/fabricplots.properties（serverDir=${dir}）` };
        }
        cfgText = lines.join("\n");
        source = `${dir}/config/fabricplots.properties`;
      }

      const cfg = parseProperties(cfgText);

      if (action === "read") {
        return {
          ok: true,
          values: cfg,
          risks: [],
          summary: `【${source}】当前配置：\n` + Object.entries(cfg).map(([k, v]) => `  ${k}=${v}`).join("\n"),
        };
      }

      if (action === "check") {
        const risks = detectPlotsRisks(cfg);
        return {
          ok: true,
          values: cfg,
          risks,
          summary:
            risks.length === 0
              ? `✅ 【${source}】未检测到危险项`
              : `⚠️ 【${source}】发现 ${risks.length} 个风险：\n` +
                risks.map((r) => `  [${r.level}] ${r.message}\n      → ${r.fix}`).join("\n") +
                `\n\n用 mc_plots action=apply-safe 一键改成安全值。`,
        };
      }

      if (action === "apply-safe") {
        const merged = mergeProperties(cfgText, PLOTS_DEFAULTS);
        if (args.configPath) {
          const backup = args.configPath + ".bak-" + new Date().toISOString().slice(0, 10);
          try {
            fs.copyFileSync(args.configPath, backup);
          } catch {}
          fs.writeFileSync(args.configPath, merged, "utf8");
          return {
            ok: true,
            values: parseProperties(merged),
            risks: [],
            summary:
              `✅ 已写入安全配置：${args.configPath}\n备份：${backup}\n\n` +
              Object.entries(PLOTS_DEFAULTS).map(([k, v]) => `  ${k}=${v}`).join("\n") +
              `\n\n⚠️ 需要重启服务器生效`,
          };
        }
        const server = H.resolveServer(config, args.server);
        const ssh = H.sshSession(server);
        if (!ssh) return { ok: false, values: {}, risks: [], summary: "❌ 远端写入需要 ssh 配置" };
        const dir = server.serverDir ?? "/opt/minecraft";
        const payload = Buffer.from(merged, "utf8").toString("base64");
        const r = await ssh.powershell(`
$p = Join-Path '${dir.replace(/'/g, "''")}' 'config/fabricplots.properties'
Copy-Item $p ($p + '.bak-safe') -Force -ErrorAction SilentlyContinue
[System.IO.File]::WriteAllBytes($p, [System.Convert]::FromBase64String('${payload}'))
Write-Output 'WROTE'
Get-Content $p | Select-String 'mob-scan-interval-ticks|unnamed-mob-grace-ticks|mob-cap-per-plot|claim-limit|street-sweeper|inactivity-expiry|manage-gamemode' | ForEach-Object { Write-Output $_.Line }
`);
        const out = cleanOutput(r.stdout);
        return {
          ok: out.includes("WROTE"),
          values: parseProperties(merged),
          risks: [],
          summary:
            `✅ 已写入远端安全配置（${dir}/config/fabricplots.properties）\n备份：.bak-safe\n\n` +
            out.filter((l) => l !== "WROTE").join("\n") +
            `\n\n⚠️ 需要重启服务器生效`,
        };
      }

      if (action === "warn-restart") {
        const server = H.resolveServer(config, args.server);
        const cmds = [
          `tellraw @a ["",{"text":"━━━━━━━━━━━━━━━━━━","color":"red","bold":true}]`,
          `tellraw @a ["",{"text":"【重启预警】","color":"red","bold":true}]`,
          `tellraw @a ["",{"text":"  地皮世界不持久化 ✗ 重启后地皮里的东西可能丢失","color":"yellow","bold":true}]`,
          `tellraw @a ["",{"text":"  请立刻把地皮里的物品收回背包或箱子里","color":"yellow"}]`,
          `tellraw @a ["",{"text":"━━━━━━━━━━━━━━━━━━","color":"red","bold":true}]`,
          `playsound minecraft:block.note_block.bell master @a ~ ~ ~ 1 1`,
        ];
        try {
          await rconOnce(H.rconOpts(server, config), cmds);
          return { ok: true, values: {}, risks: [], summary: "✅ 已广播「地皮不持久化，请收回物品」的预警" };
        } catch (e) {
          return { ok: false, values: {}, risks: [], summary: `❌ ${H.safeErr(e)}` };
        }
      }

      return { ok: false, values: {}, risks: [], summary: `❌ 未知 action：${action}（可用 read / check / apply-safe / warn-restart）` };
    },
  };
}

// ===========================================================================
// 经济
// ===========================================================================

export function toolMcEconomy(ctx, config) {
  return {
    name: "mc_economy",
    description:
      "经济系统操作（impactor）。★ 参数顺序是「金额 货币 玩家」，不是「玩家 金额」。支持 deposit / withdraw / set / balance。并提示 RCON 拿不到余额回显。",
    parameters: {
      action: { type: "string", required: true, description: "deposit | withdraw | set | balance" },
      player: { type: "string", required: true, description: "玩家名" },
      amount: { type: "number", description: "金额（balance 时不需要）" },
      currency: { type: "string", description: "货币 ID，默认 impactor:dollars" },
      server: { type: "string", description: "服务器名称" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { ok: { type: "boolean", required: true }, command: { type: "string" }, output: { type: "string" }, summary: { type: "string" } },
      },
      render: (_a, v) => text(v.summary),
    },
    async execute(args) {
      let cmd;
      try {
        cmd = buildEconomyCommand({ action: args.action, player: args.player, amount: args.amount, currency: args.currency });
      } catch (e) {
        return { ok: false, command: "", output: "", summary: `❌ ${e.message}` };
      }
      const server = H.resolveServer(config, args.server);
      try {
        const res = await rconOnce(H.rconOpts(server, config), cmd);
        const out = res[0].output.trim();
        return {
          ok: true,
          command: cmd,
          output: out,
          summary:
            `✅ 已执行：${cmd}\n返回：${out || "(无输出)"}\n\n` +
            "注意：economy 的 `Transaction completed successfully!` / `Balance: $N` 走服务器日志，RCON 拿不到。\n" +
            "要确认真实余额，读：`config/impactor/economy/accounts/users/<UUID前2位>/<UUID>.conf`",
        };
      } catch (e) {
        return { ok: false, command: cmd, output: "", summary: `❌ ${H.safeErr(e)}\n命令：${cmd}` };
      }
    },
  };
}

// ===========================================================================
// 玩家数据审计
// ===========================================================================

export function toolMcPlayerData(ctx, config) {
  return {
    name: "mc_playerdata",
    description:
      "玩家数据审计：零字节/截断的 playerdata、孤立 .dat.old（可恢复）、宝可梦数据、rctmod 进度。区分「真丢失」和「良性噪音」。支持本地目录或 SSH 远端。",
    parameters: {
      worldDir: { type: "string", description: "本地世界目录" },
      server: { type: "string", description: "服务器名称（走 SSH 读 <serverDir>/world）" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          verdict: { type: "string" },
          report: { type: "object", additionalProperties: true },
          summary: { type: "string" },
        },
      },
      render: (_a, v) => text(v.summary),
    },
    async execute(args) {
      if (args.worldDir) {
        if (!fs.existsSync(args.worldDir)) {
          return { ok: false, verdict: "missing", report: {}, summary: `❌ 目录不存在：${args.worldDir}` };
        }
        const r = auditPlayerData(args.worldDir);
        const lines = [
          `世界目录：${r.worldDir}`,
          `原版玩家数据：${r.playerdata.count} 个（零字节 ${r.playerdata.zeroByte.length}，<100字节 ${r.playerdata.small.length}）`,
          `宝可梦数据：${r.cobblemonplayerdata.count} 个，共 ${r.cobblemonplayerdata.totalMB} MB`,
          `训练家进度：${r.rctmod.count} 个`,
          `.dat.old 备份：${r.playerdata.oldCount} 个，孤立可恢复 ${r.playerdata.oldOrphans.length} 个`,
          "",
          ...r.notes,
        ];
        if (r.playerdata.zeroByte.length) lines.push(`零字节：${r.playerdata.zeroByte.slice(0, 5).join(", ")}`);
        if (r.playerdata.oldOrphans.length) lines.push(`孤立 .old：${r.playerdata.oldOrphans.slice(0, 5).join(", ")}`);
        return { ok: r.verdict === "ok", verdict: r.verdict, report: r, summary: lines.join("\n") };
      }
      const server = H.resolveServer(config, args.server);
      const ssh = H.sshSession(server);
      if (!ssh) return { ok: false, verdict: "no-access", report: {}, summary: "❌ 需要 worldDir（本地路径）或配好 ssh" };
      const dir = server.serverDir ?? "/opt/minecraft";
      const script = `
$w = Join-Path '${dir.replace(/'/g, "''")}' 'world'
if (-not (Test-Path $w)) { Write-Output 'ERR_NO_WORLD'; exit }
$pd = @(Get-ChildItem (Join-Path $w 'playerdata') -Filter *.dat -ErrorAction SilentlyContinue | Where-Object { -not $_.Name.EndsWith('.dat.old') })
Write-Output ('PD_COUNT=' + $pd.Count)
Write-Output ('PD_ZERO=' + @($pd | Where-Object { $_.Length -eq 0 }).Count)
Write-Output ('PD_SMALL=' + @($pd | Where-Object { $_.Length -gt 0 -and $_.Length -lt 100 }).Count)
$olds = @(Get-ChildItem (Join-Path $w 'playerdata') -Filter *.dat.old -ErrorAction SilentlyContinue)
Write-Output ('OLD_COUNT=' + $olds.Count)
$orphan = 0
foreach ($o in $olds) { $base = $o.FullName -replace '\\.old$',''; if (-not (Test-Path $base)) { $orphan++ } }
Write-Output ('OLD_ORPHAN=' + $orphan)
$cp = @(Get-ChildItem (Join-Path $w 'cobblemonplayerdata') -File -ErrorAction SilentlyContinue)
Write-Output ('PB_COUNT=' + $cp.Count)
Write-Output ('PB_ZERO=' + @($cp | Where-Object { $_.Length -eq 0 }).Count)
Write-Output ('PB_MB=' + [math]::Round((($cp | Measure-Object -Property Length -Sum).Sum)/1MB, 1))
$rct = @(Get-ChildItem (Join-Path $w 'data') -Filter 'rctmod.player.*.stat.dat' -ErrorAction SilentlyContinue)
Write-Output ('RCT_COUNT=' + $rct.Count)
`;
      const r = await ssh.powershell(script);
      const out = cleanOutput(r.stdout);
      if (out.includes("ERR_NO_WORLD")) return { ok: false, verdict: "missing", report: {}, summary: `❌ 远端找不到 ${dir}/world` };
      const g = (k) => {
        const m = new RegExp(`${k}=([\\d.]+)`).exec(out.join("\n"));
        return m ? Number(m[1]) : 0;
      };
      const report = {
        playerdata: { count: g("PD_COUNT"), zeroByte: g("PD_ZERO"), smallCount: g("PD_SMALL"), oldCount: g("OLD_COUNT"), oldOrphans: g("OLD_ORPHAN") },
        cobblemonplayerdata: { count: g("PB_COUNT"), zeroByte: g("PB_ZERO"), totalMB: g("PB_MB") },
        rctmod: { count: g("RCT_COUNT") },
      };
      const problems = [];
      if (report.playerdata.zeroByte > 0) problems.push(`${report.playerdata.zeroByte} 个零字节 playerdata（真丢失）`);
      if (report.playerdata.smallCount > 0) problems.push(`${report.playerdata.smallCount} 个 <100 字节的 playerdata（可能截断）`);
      if (report.cobblemonplayerdata.zeroByte > 0) problems.push(`${report.cobblemonplayerdata.zeroByte} 个零字节宝可梦数据`);
      const lines = [
        `世界目录：${dir}/world`,
        `原版玩家数据：${report.playerdata.count} 个（零字节 ${report.playerdata.zeroByte}，<100字节 ${report.playerdata.smallCount}）`,
        `宝可梦数据：${report.cobblemonplayerdata.count} 个，共 ${report.cobblemonplayerdata.totalMB} MB`,
        `训练家进度：${report.rctmod.count} 个`,
        `.dat.old 备份：${report.playerdata.oldCount} 个，孤立可恢复 ${report.playerdata.oldOrphans} 个`,
        "",
        problems.length ? `⚠️ 发现问题：\n${problems.map((p) => "  - " + p).join("\n")}` : "✅ 没有零字节/截断的玩家数据",
        "",
        "注意：日志里的 `Could not ... .old File ... is corrupt or missing. Data is lost` 是首次加载的良性噪音，不是真的丢数据。",
      ];
      return { ok: problems.length === 0, verdict: problems.length ? "damaged" : "ok", report, summary: lines.join("\n") };
    },
  };
}

// ===========================================================================
// 游戏模式修复
// ===========================================================================

export function toolMcGamemodeFix(ctx, config) {
  return {
    name: "mc_gamemode_fix",
    description:
      "修复「玩家卡在冒险模式」：查 playerGameType、强制切回 survival、或生成/部署 adventure-fix 数据包（每 5 秒自动把竞技场外的 adventure 玩家切回生存）。",
    parameters: {
      action: { type: "string", required: true, description: "check | fix | install-datapack" },
      player: { type: "string", description: "玩家名（check / fix 用）" },
      outputDir: { type: "string", description: "数据包输出目录" },
      arenaDimension: { type: "string", description: "竞技场维度 ID，默认 spleef:arena" },
      packFormat: { type: "integer", description: "pack_format，1.20.1=15，1.21.1=48" },
      deploy: { type: "boolean", description: "是否通过 SSH 部署到 world/datapacks" },
      server: { type: "string", description: "服务器名称" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { ok: { type: "boolean", required: true }, report: { type: "string" }, summary: { type: "string" } },
      },
      render: (_a, v) => text(v.summary),
    },
    async execute(args) {
      const server = H.resolveServer(config, args.server);
      const action = args.action;

      if (action === "check") {
        if (!args.player) return { ok: false, report: "", summary: "❌ check 需要 player 参数" };
        try {
          const res = await rconOnce(H.rconOpts(server, config), `data get entity ${args.player} playerGameType`);
          const out = res[0].output.trim();
          const m = /playerGameType:\s*(\d+)/.exec(out);
          const code = m ? Number(m[1]) : null;
          const map = { 0: "生存 survival ✅", 1: "创造 creative", 2: "冒险 adventure ⚠️", 3: "旁观 spectator" };
          return {
            ok: code === 0,
            report: out,
            summary:
              `${args.player} 的游戏模式：${code === null ? "解析失败" : map[code] ?? `未知(${code})`}\n原始：${out}` +
              (code === 2 ? "\n\n用 mc_gamemode_fix action=fix 修回来。" : ""),
          };
        } catch (e) {
          return { ok: false, report: "", summary: `❌ ${H.safeErr(e)}` };
        }
      }

      if (action === "fix") {
        if (!args.player) return { ok: false, report: "", summary: "❌ fix 需要 player 参数" };
        try {
          const res = await rconOnce(H.rconOpts(server, config), [`gamemode survival ${args.player}`, `data get entity ${args.player} playerGameType`]);
          const out = res[1].output.trim();
          const m = /playerGameType:\s*(\d+)/.exec(out);
          return { ok: m ? Number(m[1]) === 0 : true, report: out, summary: `已切回生存：${args.player}\n验证：${out}` };
        } catch (e) {
          return { ok: false, report: "", summary: `❌ ${H.safeErr(e)}` };
        }
      }

      if (action === "install-datapack") {
        const outDir = args.outputDir || path.join(os.tmpdir(), "mc-datapacks");
        const built = buildAdventureFix({
          targetDir: outDir,
          arenaDimension: args.arenaDimension ?? "spleef:arena",
          packFormat: args.packFormat ?? 15,
        });
        let deployed = false;
        const notes = [];
        if (args.deploy) {
          const ssh = H.sshSession(server);
          if (!ssh) notes.push("⚠ 未配置 ssh，跳过部署");
          else {
            const dir = server.serverDir ?? "/opt/minecraft";
            const entries = [];
            const walk = (base, rel) => {
              for (const e of fs.readdirSync(path.join(base, rel), { withFileTypes: true })) {
                const r = path.posix.join(rel, e.name);
                if (e.isDirectory()) walk(base, r);
                else entries.push([r, fs.readFileSync(path.join(base, r)).toString("base64")]);
              }
            };
            walk(built.dir, "");
            const r = await ssh.powershell(`
$dest = Join-Path '${dir.replace(/'/g, "''")}' 'world/datapacks/adventure-fix'
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest -Force | Out-Null
$files = '${JSON.stringify(entries)}' | ConvertFrom-Json
foreach ($f in $files) {
  $t = Join-Path $dest ($f[0] -replace '/', '\\')
  $pp = Split-Path $t -Parent
  if (-not (Test-Path $pp)) { New-Item -ItemType Directory -Path $pp -Force | Out-Null }
  [System.IO.File]::WriteAllBytes($t, [System.Convert]::FromBase64String($f[1]))
}
Write-Output ('DEPLOYED=' + $dest)
`);
            deployed = cleanOutput(r.stdout).some((l) => l.startsWith("DEPLOYED="));
            notes.push(deployed ? "已部署到 world/datapacks/adventure-fix" : "部署输出异常");
          }
        }
        return {
          ok: true,
          report: built.dir,
          summary:
            `✅ adventure-fix 数据包已生成：${built.dir}\n` +
            `文件：${built.files.join(", ")}\n` +
            `竞技场维度：${built.arenaDimension}（离开该维度且处于 adventure 的玩家会被自动切回 survival）\n` +
            `检查间隔：${built.intervalTicks} tick（${built.intervalTicks / 20} 秒）\n` +
            (notes.length ? notes.join("\n") + "\n" : "") +
            `\n生效：/reload 或重启服务器。`,
        };
      }

      return { ok: false, report: "", summary: `❌ 未知 action：${action}（可用 check / fix / install-datapack）` };
    },
  };
}

// ===========================================================================
// FTB Quests 成就修复
// ===========================================================================

export function toolMcQuest(ctx, config) {
  return {
    name: "mc_quest",
    description:
      "修 FTB Quests 卡任务：为「type: advancement 但成就根本不存在」的任务生成桩成就数据包（minecraft:impossible 触发器），再 advancement grant 补发。支持本地生成 + SSH 部署 + RCON 授权。",
    parameters: {
      action: { type: "string", required: true, description: "build | grant" },
      advancements: { type: "array", items: { type: "string" }, description: "成就 ID，格式 namespace:path，如 rctmod:trainers/defeat_kanto_giovanni_gym" },
      player: { type: "string", description: "补发成就的玩家（grant 用）" },
      outputDir: { type: "string", description: "数据包输出目录" },
      packFormat: { type: "integer", description: "pack_format，默认 15" },
      deploy: { type: "boolean", description: "是否 SSH 部署到 world/datapacks" },
      server: { type: "string", description: "服务器名称" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          dir: { type: "string" },
          advancements: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
        },
      },
      render: (_a, v) => text(v.summary),
    },
    async execute(args) {
      const server = H.resolveServer(config, args.server);

      if (args.action === "grant") {
        if (!args.player || !args.advancements?.length) {
          return { ok: false, dir: "", advancements: [], summary: "❌ grant 需要 player 和 advancements" };
        }
        const cmds = args.advancements.map((a) => `advancement grant ${args.player} only ${a}`);
        try {
          const res = await rconOnce(H.rconOpts(server, config), cmds);
          return {
            ok: true,
            dir: "",
            advancements: args.advancements,
            summary:
              `授权结果：\n` +
              res.map((r) => `> ${r.command}\n  ${r.output.trim() || "(无输出)"}`).join("\n") +
              `\n\n判读：\n  "Couldn't grant ... as they already have it" → 成就存在且已拥有（任务应能完成）\n  "Unknown advancement" → 成就确实不存在，需要先 build 桩成就`,
          };
        } catch (e) {
          return { ok: false, dir: "", advancements: [], summary: `❌ ${H.safeErr(e)}` };
        }
      }

      const advs = (args.advancements ?? [])
        .map((s) => {
          const i = String(s).indexOf(":");
          return i > 0 ? { namespace: String(s).slice(0, i), path: String(s).slice(i + 1) } : null;
        })
        .filter(Boolean);
      if (advs.length === 0) return { ok: false, dir: "", advancements: [], summary: "❌ 需要 advancements，格式 namespace:path" };

      const outDir = args.outputDir || path.join(os.tmpdir(), "mc-datapacks");
      const built = buildQuestAdvancementFix({ targetDir: outDir, advancements: advs, packFormat: args.packFormat ?? 15 });
      const notes = [];
      if (args.deploy) {
        const ssh = H.sshSession(server);
        if (!ssh) notes.push("⚠ 未配置 ssh，跳过部署");
        else {
          const dir = server.serverDir ?? "/opt/minecraft";
          const entries = [];
          const walk = (base, rel) => {
            for (const e of fs.readdirSync(path.join(base, rel), { withFileTypes: true })) {
              const r = path.posix.join(rel, e.name);
              if (e.isDirectory()) walk(base, r);
              else entries.push([r, fs.readFileSync(path.join(base, r)).toString("base64")]);
            }
          };
          walk(built.dir, "");
          const r = await ssh.powershell(`
$dest = Join-Path '${dir.replace(/'/g, "''")}' 'world/datapacks/quest-adv-fix'
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest -Force | Out-Null
$files = '${JSON.stringify(entries)}' | ConvertFrom-Json
foreach ($f in $files) {
  $t = Join-Path $dest ($f[0] -replace '/', '\\')
  $pp = Split-Path $t -Parent
  if (-not (Test-Path $pp)) { New-Item -ItemType Directory -Path $pp -Force | Out-Null }
  [System.IO.File]::WriteAllBytes($t, [System.Convert]::FromBase64String($f[1]))
}
Write-Output ('DEPLOYED=' + $dest)
`);
          notes.push(cleanOutput(r.stdout).some((l) => l.startsWith("DEPLOYED=")) ? "已部署到 world/datapacks/quest-adv-fix" : "部署输出异常");
        }
      }
      return {
        ok: true,
        dir: built.dir,
        advancements: built.advancements,
        summary:
          `✅ 桩成就数据包已生成：${built.dir}\n` +
          `成就：${built.advancements.join(", ")}\n` +
          `文件：${built.files.join(", ")}\n` +
          (notes.length ? notes.join("\n") + "\n" : "") +
          `\n下一步：/reload → mc_quest action=grant player=<玩家> advancements=[...]`,
      };
    },
  };
}

// ===========================================================================
// JVM
// ===========================================================================

export function toolMcJvm(ctx, config) {
  return {
    name: "mc_jvm",
    description:
      "计算并写入 JVM 参数（user_jvm_args.txt）。按物理内存推荐 -Xms/-Xmx + G1GC 参数，自动用 UTF-8 无 BOM 写入（避免「找不到主类 锘?-Xms4G」），并警告 AlwaysPreTouch 的 1450 崩溃风险。",
    parameters: {
      physicalGB: { type: "number", required: true, description: "服务器物理内存（GB）" },
      heavyModpack: { type: "boolean", description: "是否大型整合包" },
      includeGcLog: { type: "boolean", description: "是否加 GC 日志参数" },
      writeTo: { type: "string", description: "写入 user_jvm_args.txt 的路径（不传则只计算）" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          xms: { type: "number" },
          xmx: { type: "number" },
          args: { type: "array", items: { type: "string" } },
          warnings: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
        },
      },
      render: (_a, v) => text(v.summary),
    },
    async execute(args) {
      let r;
      try {
        r = recommendJvm(args.physicalGB, { heavyModpack: args.heavyModpack, includeGcLog: args.includeGcLog });
      } catch (e) {
        return { ok: false, xms: 0, xmx: 0, args: [], warnings: [], summary: `❌ ${e.message}` };
      }
      let writeNote = "";
      if (args.writeTo) {
        try {
          const w = writeJvmArgs(args.writeTo, r.args);
          writeNote =
            `\n\n✅ 已写入：${w.path}\n` +
            (w.hasBom ? "❌ 警告：文件带 BOM！" : "✅ 无 BOM（java 不会报「找不到主类」）") +
            `\n备份：${w.path}.bak`;
        } catch (e) {
          writeNote = `\n\n❌ 写入失败：${e.message}`;
        }
      }
      return {
        ok: true,
        xms: r.xms,
        xmx: r.xmx,
        args: r.args,
        warnings: r.warnings,
        summary:
          `物理内存 ${args.physicalGB} GB → 推荐 -Xms${r.xms}G -Xmx${r.xmx}G\n\n` +
          `参数：\n${r.args.map((a) => "  " + a).join("\n")}` +
          (r.warnings.length ? `\n\n注意：\n${r.warnings.map((w) => "  - " + w).join("\n")}` : "") +
          writeNote,
      };
    },
  };
}

// ===========================================================================
// 统一导出
// ===========================================================================

export function makeExtraTools(ctx, config) {
  return [
    toolMcPokemonGive(ctx, config),
    toolMcPokemonEdit(ctx, config),
    toolMcPokemonTeam(ctx, config),
    toolMcPokemonItem(ctx, config),
    toolMcPlots(ctx, config),
    toolMcEconomy(ctx, config),
    toolMcPlayerData(ctx, config),
    toolMcGamemodeFix(ctx, config),
    toolMcQuest(ctx, config),
    toolMcJvm(ctx, config),
  ];
}
