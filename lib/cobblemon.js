/**
 * Cobblemon（宝可梦）专用模块
 *
 * 解决的核心问题：
 *   1. /pokegive 和 /pokeedit 必须带玩家上下文（execute as）
 *   2. 参数名、性格/特性/技能/道具全是英文小写，中文名要能自动翻译
 *   3. /pokeedit 的 moves= 是【替换】不是追加 —— 必须强制传全 4 个技能
 *   4. 超进化石的真实物品 ID 在 mega_showdown 里，不是 zamega
 *
 * ⚠️ pokeedit 覆盖技能的事故就是本插件作者踩出来的，所以这里加了硬性护栏。
 */

// ---------------------------------------------------------------------------
// 字典：中文 → 英文（Cobblemon 参数值）
// ---------------------------------------------------------------------------

/** 性格：中文 → nature 参数值 */
export const NATURES = {
  勤奋: "hardy", 坦率: "docile", 害羞: "bashful", 浮躁: "quirky", 认真: "serious",
  孤独: "lonely", 勇敢: "brave", 固执: "adamant", 顽皮: "naughty", 大胆: "bold",
  坦率2: "docile", 淘气: "impish", 乐天: "lax", 胆小: "timid", 急躁: "hasty",
  开朗: "jolly", 天真: "naive", 内敛: "modest", 慢吞吞: "mild", 冷静: "quiet",
  害羞2: "bashful", 温和: "calm", 温顺: "gentle", 慎重: "careful", 浮躁2: "quirky",
  // 常见英文别名
  hardy: "hardy", modest: "modest", timid: "timid", jolly: "jolly", adamant: "adamant",
  bold: "bold", impish: "impish", calm: "calm", careful: "careful", relaxed: "relaxed",
  naive: "naive", quiet: "quiet", brave: "brave", gentle: "gentle", hasty: "hasty",
  mild: "mild", rash: "rash", sassy: "sassy", lonely: "lonely", naughty: "naughty",
  lax: "lax", docile: "docile", bashful: "bashful", quirky: "quirky", serious: "serious",
};

/** 特性：中文 → ability 参数值（小写去空格） */
export const ABILITIES = {
  降雨: "drizzle", 扬沙: "sandstream", 日照: "drought", 降雪: "snowwarning",
  再生力: "regenerator", 魔法镜: "magicbounce", 纯朴: "unaware", 自然回复: "naturalcure",
  压迫感: "pressure", 恒净之躯: "clearbody", 粗糙皮肤: "roughskin", 飘浮: "levitate",
  激流: "torrent", 猛火: "blaze", 茂盛: "overgrow", 虫之预感: "swarm",
  画皮: "disguise", 铁刺: "ironbarbs", 轻装: "unburden", 危险回避: "emergencyexit",
  持久力: "stamina", 悠游自如: "swiftswim", 穿透: "infiltrator", 技术高手: "technician",
  威吓: "intimidate", 加速: "speedboost", 多重鳞片: "multiscale", 坚硬: "sturdy",
  蓄水: "waterabsorb", 引火: "flashfire", 避雷针: "lightningrod", 叶绿素: "chlorophyll",
  沙隐: "sandveil", 雪隐: "snowcloak", 蜕皮: "shedskin", 威吓2: "intimidate",
  变幻自如: "protean", 自由者: "libero", 强壮之颚: "strongjaw", 胆量: "scrappy",
};

/** 道具：中文 → 完整 item id */
export const ITEMS = {
  生命宝珠: "cobblemon:life_orb",
  吃剩的东西: "cobblemon:leftovers",
  凹凸头盔: "cobblemon:rocky_helmet",
  凸凸头盔: "cobblemon:rocky_helmet",
  气势披带: "cobblemon:focus_sash",
  讲究围巾: "cobblemon:choice_scarf",
  讲究头带: "cobblemon:choice_band",
  讲究眼镜: "cobblemon:choice_specs",
  黑色污泥: "cobblemon:black_sludge",
  进化奇石: "cobblemon:eviolite",
  潮湿岩石: "cobblemon:damp_rock",
  沙沙岩石: "cobblemon:smooth_rock",
  炽热岩石: "cobblemon:heat_rock",
  冰冷岩石: "cobblemon:icy_rock",
  文柚果: "cobblemon:sitrus_berry",
  大根茎: "cobblemon:big_root",
  厚底靴: "cobblemon:heavy_duty_boots",
  突击背心: "cobblemon:assault_vest",
  达人带: "cobblemon:expert_belt",
  力量头带: "cobblemon:muscle_band",
  博识眼镜: "cobblemon:wise_glasses",
  剩饭: "cobblemon:leftovers",
  // 超进化相关
  超级手环: "mega_showdown:mega_bracelet",
  超级手镯: "mega_showdown:brendan_mega_cuff",
  喷火龙X进化石: "mega_showdown:charizardite_x",
  喷火龙Y进化石: "mega_showdown:charizardite_y",
  巨金怪进化石: "mega_showdown:metagrossite",
  具甲武者进化石: "mega_showdown:golisopite",
  勾魂眼进化石: "mega_showdown:sablenite",
  蜥蜴王进化石: "mega_showdown:sceptilite",
  火焰鸡进化石: "mega_showdown:blazikenite",
  超梦X进化石: "mega_showdown:mewtwonite_x",
  超梦Y进化石: "mega_showdown:mewtwonite_y",
  路卡利欧进化石: "mega_showdown:lucarionite",
  烈咬陆鲨进化石: "mega_showdown:garchompite",
  班基拉斯进化石: "mega_showdown:tyranitarite",
  暴飞龙进化石: "mega_showdown:salamencite",
  巨沼怪进化石: "mega_showdown:swampertite",
  沙奈朵进化石: "mega_showdown:gardevoirite",
};

/** 技能：中文 → move id（小写无空格） */
export const MOVES = {
  浊流: "muddywater", 暗影球: "shadowball", 冰冻光束: "icebeam", 守住: "protect",
  铁壁: "irondefense", 扑击: "bodypress", 寄生种子: "leechseed", 撒菱: "spikes",
  克命爪: "direclaw", 近身战: "closecombat", 剑舞: "swordsdance", 击掌奇袭: "fakeout",
  汲取: "leechlife", 铁头: "ironhead", 突袭: "suckerpunch",
  龙之波动: "dragonpulse", 电光束: "electroshot", 大声咆哮: "snarl", 求雨: "raindance",
  暴风: "hurricane", 偷懒: "slackoff", 哈欠: "yawn", 地震: "earthquake", 隐形岩: "stealthrock",
  子弹拳: "bulletpunch", 精神之牙: "psychicfangs", 冰冻拳: "icepunch",
  岩石封锁: "rocktomb", 逆鳞: "outrage", 流星群: "dracometeor",
  恶之波动: "darkpulse", 急速折返: "uturn", 喷射火焰: "flamethrower",
  水流喷射: "aquajet", 泡影的咏叹调: "sparklingaria", 月亮之力: "moonblast", 冥想: "calmmind",
  嬉闹: "playrough", 影子偷袭: "shadowsneak", 暗影爪: "shadowclaw",
  剧毒: "toxic", 热水: "scald", 碉堡: "banefulbunker", 自我再生: "recover",
  羽栖: "roost", 清除浓雾: "defog", 地球上投: "seismictoss", 生蛋: "softboiled",
  瞬间移动: "teleport", 挑衅: "taunt", 拍落: "knockoff", 磷火: "willowisp",
  月光: "moonlight", 辅助力量: "storedpower", 宇宙力量: "cosmicpower",
  鳃咬: "fishiousrend", 岩崩: "rockslide", 冰冻牙: "icefang", 咬碎: "crunch",
  尖石攻击: "stoneedge", 火焰牙: "firefang", 愤怒之拳: "ragefist", 吸取拳: "drainpunch",
  火焰拳: "firepunch", 过热: "overheat", 日光束: "solarbeam", 变身: "transform",
  龙爪: "dragonclaw", 十万伏特: "thunderbolt", 打雷: "thunder", 冲浪: "surf",
  水炮: "hydropump", 大字爆炎: "fireblast", 空气斩: "airslash", 精神强念: "psychic",
  影子球: "shadowball", 恶之袭击: "suckerpunch", 岩崩2: "rockslide",
};

/** 已知的“中文名 ≠ 物种 ID”的坑，列出来当提醒 */
export const SPECIES_TRAPS = [
  { zh: "阿尔奈朵", real: "阿尔宙斯（arceus）的一个融合形态", note: "融合形态挂在 target 物种上，必须搜阿尔宙斯" },
  { zh: "时空铠骑", real: "不存在", note: "凯骑=铠骑=armarouge（红莲铠骑）；模组里只有 armaraeon / armartina" },
  { zh: "超级勾魂眼", real: "sableye + mega_showdown:sablenite", note: "名字带“超级”不代表是独立物种，是普通物种+进化石" },
];

// ---------------------------------------------------------------------------
// 解析与校验
// ---------------------------------------------------------------------------

function pick(dict, input) {
  if (!input) return null;
  const raw = String(input).trim();
  // 直接就是英文 id
  if (/^[a-z0-9._:-]+$/i.test(raw) && !dict[raw]) return raw.toLowerCase().replace(/[\s-]/g, "");
  if (dict[raw]) return dict[raw];
  // 忽略大小写
  const lower = raw.toLowerCase();
  for (const [k, v] of Object.entries(dict)) {
    if (k.toLowerCase() === lower) return v;
  }
  // 已经是合法英文形态
  if (/^[a-z0-9]+$/i.test(raw)) return lower;
  return null;
}

export function resolveNature(v) {
  return pick(NATURES, v);
}
export function resolveAbility(v) {
  return pick(ABILITIES, v);
}
export function resolveMove(v) {
  return pick(MOVES, v);
}

/**
 * 解析道具。支持三类写法：
 *   1. 中文名（生命宝珠）
 *   2. 完整 id（cobblemon:life_orb）
 *   3. 简写（life_orb → 自动补 cobblemon: 前缀）
 */
export function resolveItem(v, { defaultNamespace = "cobblemon" } = {}) {
  if (!v) return null;
  const raw = String(v).trim();
  if (ITEMS[raw]) return ITEMS[raw];
  const lower = raw.toLowerCase();
  for (const [k, id] of Object.entries(ITEMS)) {
    if (k.toLowerCase() === lower) return id;
  }
  if (raw.includes(":")) return raw;
  return `${defaultNamespace}:${lower.replace(/[\s-]/g, "_")}`;
}

/**
 * 校验宝可梦配置，返回 { ok, errors[], warnings[], spec }
 *
 * @param {object} input
 * @param {string} input.species     物种 ID（如 pelipper）
 * @param {number} [input.level]
 * @param {string} [input.nature]
 * @param {string} [input.ability]
 * @param {string} [input.gender]    male | female | genderless
 * @param {string} [input.heldItem]
 * @param {string[]} [input.moves]   最多 4 个
 * @param {number[]} [input.ivs]     6 个数字，顺序 hp/atk/def/spa/spd/spe
 * @param {number[]} [input.evs]     同上
 */
export function validatePokemonSpec(input) {
  const errors = [];
  const warnings = [];

  const species = input.species ? String(input.species).trim().toLowerCase().replace(/\s+/g, "") : "";
  if (!species) errors.push("缺少 species（物种 ID，如 pelipper / garchomp）");
  if (species && !/^[a-z0-9-]+$/.test(species)) {
    warnings.push(`species「${species}」包含非标准字符，确认是不是中文名（要用英文 ID）`);
  }

  const level = input.level ?? 50;
  if (!Number.isInteger(level) || level < 1 || level > 100) errors.push(`level 必须是 1~100 的整数，收到 ${input.level}`);

  let nature = null;
  if (input.nature) {
    nature = resolveNature(input.nature);
    if (!nature) errors.push(`无法识别性格「${input.nature}」，可用：${Object.keys(NATURES).filter((k) => /[\u4e00-\u9fa5]/.test(k)).slice(0, 10).join("、")} 等`);
  }

  let ability = null;
  if (input.ability) {
    ability = resolveAbility(input.ability);
    if (!ability) errors.push(`无法识别特性「${input.ability}」`);
  }

  let heldItem = null;
  if (input.heldItem) {
    heldItem = resolveItem(input.heldItem);
    if (heldItem && !heldItem.includes(":")) errors.push(`道具 ID 解析失败：「${input.heldItem}」`);
  }

  let moves = [];
  if (input.moves && input.moves.length > 0) {
    if (input.moves.length > 4) errors.push(`技能最多 4 个，收到 ${input.moves.length} 个`);
    moves = input.moves.map((m) => {
      const id = resolveMove(m);
      if (!id) errors.push(`无法识别技能「${m}」`);
      return id;
    }).filter(Boolean);
  }

  let ivs = null;
  if (input.ivs) {
    if (input.ivs.length !== 6) errors.push(`ivs 必须是 6 个数字（hp/atk/def/spa/spd/spe），收到 ${input.ivs.length} 个`);
    else if (input.ivs.some((x) => !Number.isInteger(x) || x < 0 || x > 31)) errors.push("ivs 每个值必须是 0~31 的整数");
    else ivs = input.ivs;
  }

  let evs = null;
  if (input.evs) {
    if (input.evs.length !== 6) errors.push(`evs 必须是 6 个数字（hp/atk/def/spa/spd/spe），收到 ${input.evs.length} 个`);
    else if (input.evs.some((x) => !Number.isInteger(x) || x < 0 || x > 252)) errors.push("evs 每个值必须是 0~252 的整数");
    else if (input.evs.reduce((a, b) => a + b, 0) > 510) errors.push(`努力值总和不能超过 510，当前 ${input.evs.reduce((a, b) => a + b, 0)}`);
    else evs = input.evs;
  }

  const gender = input.gender ? String(input.gender).toLowerCase() : null;
  if (gender && !["male", "female", "genderless"].includes(gender)) errors.push(`gender 必须是 male / female / genderless`);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    spec: { species, level, nature, ability, gender, heldItem, moves, ivs, evs },
  };
}

/** 生成 pokegive 命令（自动加 execute as） */
export function buildPokegiveCommand(player, spec) {
  if (!player) throw new Error("必须指定玩家");
  const parts = [`execute as ${player} run pokegive ${spec.species}`];
  parts.push(`level=${spec.level ?? 50}`);
  if (spec.gender) parts.push(`gender=${spec.gender}`);
  if (spec.nature) parts.push(`nature=${spec.nature}`);
  if (spec.ability) parts.push(`ability=${spec.ability}`);
  if (spec.heldItem) parts.push(`held_item=${spec.heldItem}`);
  if (spec.moves && spec.moves.length > 0) parts.push(`moves=${spec.moves.join(",")}`);

  const ivNames = ["hp_iv", "attack_iv", "defence_iv", "special_attack_iv", "special_defence_iv", "speed_iv"];
  if (spec.ivs) spec.ivs.forEach((v, i) => parts.push(`${ivNames[i]}=${v}`));

  const evNames = ["hp_ev", "attack_ev", "defence_ev", "special_attack_ev", "special_defence_ev", "speed_ev"];
  if (spec.evs) spec.evs.forEach((v, i) => parts.push(`${evNames[i]}=${v}`));

  return parts.join(" ");
}

/**
 * 生成 pokeedit 命令
 *
 * ⚠️ 硬性护栏：如果传了 moves，必须正好 4 个 —— 否则拒绝生成命令。
 *    因为 moves= 是【替换整个技能栏】，传 1~3 个会把剩下的技能清空。
 */
export function buildPokeEditCommand(player, slot, opts = {}) {
  if (!player) throw new Error("必须指定玩家");
  if (!Number.isInteger(slot) || slot < 1 || slot > 6) throw new Error("slot 必须是 1~6");

  const parts = [`execute as ${player} run pokeedit ${slot}`];

  if (opts.moves !== undefined) {
    if (!Array.isArray(opts.moves) || opts.moves.length === 0) {
      throw new Error("moves 必须是非空数组");
    }
    if (opts.moves.length < 4) {
      throw new Error(
        `⚠️ 危险操作被拒绝：pokeedit 的 moves= 是【替换整个技能栏】，不是追加。\n` +
          `你只传了 ${opts.moves.length} 个技能，会把剩下 ${4 - opts.moves.length} 个槽位清空。\n` +
          `要改技能必须把目标宝可梦的完整 4 个技能都列出来。\n` +
          `先用 mc_pokemon_team 或 mc_rcon "execute as ${player} run pokeedit ${slot} level=50" 确认这是哪只宝可梦。`,
      );
    }
    if (opts.moves.length > 4) throw new Error(`moves 最多 4 个，收到 ${opts.moves.length} 个`);
    const ids = opts.moves.map((m) => {
      const id = resolveMove(m);
      if (!id) throw new Error(`无法识别技能「${m}」`);
      return id;
    });
    parts.push(`moves=${ids.join(",")}`);
  }

  if (opts.level) parts.push(`level=${opts.level}`);
  if (opts.nature) {
    const n = resolveNature(opts.nature);
    if (!n) throw new Error(`无法识别性格「${opts.nature}」`);
    parts.push(`nature=${n}`);
  }
  if (opts.ability) {
    const a = resolveAbility(opts.ability);
    if (!a) throw new Error(`无法识别特性「${opts.ability}」`);
    parts.push(`ability=${a}`);
  }
  if (opts.heldItem !== undefined) {
    const it = resolveItem(opts.heldItem);
    parts.push(`held_item=${it ?? "minecraft:air"}`);
  }

  // parts 只有 1 个元素 = 除了基础命令什么都没加（此时才该报错）
  if (parts.length === 1) throw new Error("没有指定任何要修改的字段");

  return parts.join(" ");
}

/** 给超进化石 + 手环的组合（一键生成 give 命令） */
export function buildMegaKitCommands(player, stoneName) {
  const stone = resolveItem(stoneName, { defaultNamespace: "mega_showdown" });
  const cmds = [`give ${player} mega_showdown:mega_bracelet 1`];
  if (stone) cmds.push(`give ${player} ${stone} 1`);
  return { stone, commands: cmds };
}

/** 解析 list 输出里的玩家名（给批量发宝可梦用） */
export function parseOnlinePlayers(listText) {
  const m = /There are (\d+) of a max of (\d+) players online:?\s*(.*)$/m.exec(String(listText));
  if (!m) return [];
  return m[3].split(",").map((s) => s.trim()).filter(Boolean);
}
