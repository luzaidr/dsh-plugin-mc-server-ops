/**
 * Minecraft 运维知识库
 *
 * 全部来自真实运维现场，每条都是「现象 → 原因 → 解法」。
 * 分成三类：
 *   general   —— 任何 MC 服务端都会遇到的
 *   cobblemon —— Cobblemon（宝可梦）整合包专有
 *   plots     —— fabricplots 地皮 / 竞技场 / 经济系统等
 *
 * 每条结构：
 *   { id, cat, title, tags: [], body }
 */

/** @typedef {{ id: string, cat: string, title: string, tags: string[], body: string }} KbEntry */

/** @type {KbEntry[]} */
export const KB = [
  // =========================================================================
  // 通用：编码与配置
  // =========================================================================
  {
    id: "bom-jvm",
    cat: "general",
    title: "配置文件带 UTF-8 BOM → java 报「找不到主类 锘?-Xms4G」",
    tags: ["bom", "编码", "encoding", "jvm", "user_jvm_args", "启动失败", "启动"],
    body:
      "**现象**\n" +
      "```\n错误: 找不到或无法加载主类 锘?-Xms4G\n原因: java.lang.ClassNotFoundException: 锘?-Xms4G\n```\n\n" +
      "**原因**\n" +
      "PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会写入 BOM（`EF BB BF`）。\n" +
      "java 读 `user_jvm_args.txt` 时把 BOM 当成第一个参数的一部分，`-Xms4G` 就变成了 `锘?-Xms4G`。\n\n" +
      "**解法**\n" +
      "```powershell\n# ❌ 会加 BOM\n$lines | Set-Content $path -Encoding UTF8\n\n# ✅ 无 BOM\n[System.IO.File]::WriteAllLines($path, $lines, (New-Object System.Text.UTF8Encoding($false)))\n```\n\n" +
      "**校验**\n" +
      "```powershell\n$b = [System.IO.File]::ReadAllBytes($path)\n($b[0..2] | ForEach-Object { $_.ToString('X2') }) -join ' '\n# 应该是 2D 58 6D（'-Xm'），不能是 EF BB BF\n```",
  },
  {
    id: "bom-mcfunction",
    cat: "general",
    title: "数据包 .mcfunction 带 BOM → 第一行命令报错",
    tags: ["bom", "数据包", "datapack", "mcfunction"],
    body:
      "`.mcfunction` 文件如果带 BOM，Minecraft 会把 BOM 当成命令的第一个字符，\n" +
      "报 `Unknown or incomplete command` 或直接静默失败。\n\n" +
      "**解法**：生成/写入 `.mcfunction` 时一律用无 BOM 的 UTF-8，并统一成 LF 换行。\n\n" +
      "本插件的 `lib/datapacks.js` 里 `writeNoBom()` 做的就是这件事。",
  },
  {
    id: "ps5-chinese-encoding",
    cat: "general",
    title: "PowerShell 5.1 + 中文：读文件乱码 / 写脚本报错",
    tags: ["powershell", "中文", "编码", "gbk", "bom"],
    body:
      "**现象 1**：`Get-Content -Raw` 读 UTF-8 文件得到 `鏈嶅姟鍣?` 这种乱码。\n" +
      "→ PowerShell 5.1 的 `Get-Content` 默认按**当前 ANSI 代码页**（中文系统是 GBK/936）解码。\n" +
      "**解法**：显式指定 `-Encoding UTF8`，或者用 `.NET`：\n" +
      "```powershell\n[System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)\n```\n\n" +
      "**现象 2**：`.ps1` 里写中文，执行时报语法错误或中文变乱码。\n" +
      "→ 脚本必须存成 **UTF-8 with BOM**（PS 5.1 靠 BOM 判断编码）。\n\n" +
      "**现象 3**：`.vbs` 里写中文 `MsgBox` 显示乱码。\n" +
      "→ `wscript.exe` 按 ANSI 读 `.vbs`，要么存成 **GBK**，要么存成 **UTF-16LE + BOM**。",
  },
  {
    id: "ps5-reserved-vars",
    cat: "general",
    title: "PowerShell 5.1 的保留变量与内置别名冲突",
    tags: ["powershell", "别名", "args", "脚本"],
    body:
      "**现象**：函数参数莫名收不到值、自定义函数报「找不到接受实际参数的位置形式参数」、行为诡异但语法检查通过。\n\n" +
      "**常见冲突**\n" +
      "| 名字 | 是什么 |\n" +
      "|---|---|\n" +
      "| `$args` | 自动变量（函数参数数组），**不能做参数名** |\n" +
      "| `rv` | `Remove-Variable` 的别名 |\n" +
      "| `cd` / `ls` / `rm` / `cat` | 内置别名 |\n" +
      "| `$PID` | 当前进程 ID（只读） |\n" +
      "| `$input` | 管道输入枚举器 |\n\n" +
      "**真实翻车案例**：写了个 `function RV {...}` 做 VarInt 解码，调用时 PowerShell 把它当 `Remove-Variable`，\n" +
      "报 `找不到名为 ... 的变量`。改成 `ReadVarInt` / `TakeVarInt` 就好了。\n\n" +
      "**另一个坑**：`Select-Object` 没有 `-join` 参数（`-join` 是运算符）：\n" +
      "```powershell\n# ❌ 报错：找不到与参数名称 join 匹配的参数\n$found | Select-Object -First 3 -join \", \"\n\n# ✅\n($found | Select-Object -First 3) -join \", \"\n```",
  },
  {
    id: "ps5-kill-self",
    cat: "general",
    title: "用命令行内容匹配杀进程 → 把自己的 shell 也杀了",
    tags: ["powershell", "进程", "kill", "自杀"],
    body:
      "**现象**：写脚本杀「命令行里含某个关键词」的进程，结果**自己的命令也挂了**（exit code 4294967295）。\n\n" +
      "**原因**：你的命令本身也包含那个关键词，`Get-CimInstance Win32_Process` 会匹配到自己。\n\n" +
      "**解法**\n" +
      "```powershell\n$myPid = $PID\n$procs = @(Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" |\n    Where-Object { $_.ProcessId -ne $myPid -and $_.CommandLine -and $_.CommandLine.Contains($kw) })\n```\n\n" +
      "更稳的做法：把关键词拆成字符拼（避免自己匹配）：\n" +
      "```powershell\n$kw = [char]0x4EBA + [char]0x6570 + [char]0x76D1 + [char]0x63A7\n```\n" +
      "或者干脆**只按进程名**匹配，不匹配命令行。",
  },

  // =========================================================================
  // 通用：选择器与命令
  // =========================================================================
  {
    id: "selector-global",
    cat: "general",
    title: "@e / @a 是全局选择器，execute in <维度> 不能限定作用范围",
    tags: ["selector", "execute", "维度", "dimension", "误杀", "@e", "@a"],
    body:
      "**现象**\n" +
      "```mcfunction\nexecute in minecraft:overworld run kill @e[type=minecraft:item]\n```\n" +
      "本想只清主世界的掉落物，结果**下界、末地、所有模组维度的掉落物全没了**。\n\n" +
      "**原因**\n" +
      "`execute in <dimension>` 只改变**执行位置/维度的上下文**，**不会**把实体选择器限制在那个维度。\n" +
      "`@e` / `@a` 默认就是「所有已加载的实体/玩家」。\n\n" +
      "**解法**\n" +
      "```mcfunction\n# A. 加坐标+距离约束\nexecute in minecraft:overworld positioned 0 64 0 run kill @e[type=minecraft:item,distance=..100000]\n\n# B. 先打 tag 再按 tag 处理\ntag @e[type=minecraft:item] add to_purge\nkill @e[tag=to_purge]\n\n# C. 大多数场景其实就是要全局清理\nkill @e[type=minecraft:item]\n```\n\n" +
      "> `gamerule` 同样是**全局**的，不分维度。曾经 `doMobSpawning=false` 就是这样把全服刷怪关掉的。",
  },
  {
    id: "gamerule-global",
    cat: "general",
    title: "gamerule 是全局的，不要以为它是按维度设置的",
    tags: ["gamerule", "全局", "doMobSpawning", "keepInventory"],
    body:
      "`/gamerule` 影响**整个服务器所有维度**。\n\n" +
      "**真实翻车**：想只在地皮维度关闭刷怪，执行了 `doMobSpawning false`，\n" +
      "结果主世界也不刷怪了，玩家以为服务器坏了。\n\n" +
      "**解法**：要按维度控制刷怪，用数据包/模组配置，不要动 gamerule。\n" +
      "Cobblemon 用 `config/cobblemon/main.json` 的 `worldSpawningBlocklist`。",
  },
  {
    id: "datapack-format",
    cat: "general",
    title: "数据包 pack_format 与 functions/function 目录随版本变化",
    tags: ["datapack", "数据包", "pack_format", "版本"],
    body:
      "| 版本 | pack_format | 函数目录 |\n" +
      "|---|---|---|\n" +
      "| 1.20.1 | **15** | `functions/` |\n" +
      "| 1.20.4 | 26 | `functions/` |\n" +
      "| 1.21 ~ 1.21.1 | **48** | `function/`（单数！）|\n" +
      "| 1.21.4 | 61 | `function/` |\n\n" +
      "**写错的表现**：数据包能加载但 tick 函数不执行，或 `datapack list` 里显示但没效果。\n\n" +
      "本插件 `lib/datapacks.js` 的 `functionsDir(packFormat)` 会自动切换（`>=45` 用 `function`）。",
  },
  {
    id: "datapack-mcfunction-comment",
    cat: "general",
    title: ".mcfunction 里 # 是注释符 → 伪玩家名不能用 #timer",
    tags: ["mcfunction", "datapack", "数据包", "scoreboard", "伪玩家"],
    body:
      "**现象**\n" +
      "```mcfunction\nscoreboard players add #timer ic_timer 1\n```\n" +
      "计时器永远不动，**没有任何报错**。\n\n" +
      "**原因**\n" +
      "数据包函数里，以 `#` 开头的整行会被当作**注释**丢弃。这一行根本没执行。\n\n" +
      "**解法**\n" +
      "```mcfunction\nscoreboard players add icTimer ic_timer 1\n```\n\n" +
      "同理，`#` 也不能拿来做命名空间风格的前缀（`#mymod:flag` 这种）。",
  },
  {
    id: "datapack-reload",
    cat: "general",
    title: "装完数据包要 /reload 或重启，且 tick 标签只在加载时读一次",
    tags: ["datapack", "reload", "数据包", "tick"],
    body:
      "**步骤**\n" +
      "1. 把数据包目录放到 `<world>/datapacks/<name>/`\n" +
      "2. `datapack list` 确认出现 `[file/<name> (world)]`\n" +
      "3. `/reload` 或重启服务器\n\n" +
      "**验证 tick 钩子是否生效**\n" +
      "```mcfunction\n# 在 tick 函数里加一行\nscoreboard players add icTimer ic_timer 1\n```\n" +
      "然后 `scoreboard players get icTimer ic_timer` 隔几秒读两次，数值应该在涨。\n\n" +
      "**坑**：`/reload` 不会重读 `data/minecraft/tags/functions/tick.json` 的新增文件时偶发不生效，\n" +
      "重启服务器最保险。",
  },

  // =========================================================================
  // 通用：RCON 与远程
  // =========================================================================
  {
    id: "rcon-multipacket",
    cat: "general",
    title: "RCON 长输出分多个包，只读一个会截断",
    tags: ["rcon", "多包", "截断", "forge entity list", "forge tps"],
    body:
      "**现象**：执行 `forge entity list` 或 `forge tps` 拿到空字符串或半截数据。\n\n" +
      "**原因**：Minecraft 的 RCON 会把长响应拆成**多个响应包**陆续发送。\n\n" +
      "**解法**：读完第一个包后**继续读到空闲**（0.5~1.5 秒 idle 超时）：\n" +
      "```js\nlet text = firstPacket.body;\nwhile (true) {\n  const more = await readWithIdleTimeout(1200);\n  if (!more) break;\n  text += '\\n' + more.body;\n}\n```\n\n" +
      "本插件 `lib/rcon.js` 的 `_readIdle()` 已内置。",
  },
  {
    id: "rcon-needs-player",
    cat: "general",
    title: "有些命令必须由玩家执行 → 用 execute as <玩家> run ...",
    tags: ["rcon", "execute", "玩家上下文", "pokegive", "rctmod"],
    body:
      "**现象**：通过 RCON 执行命令时报\n" +
      "```\nA player is required to run this command here\n```\n\n" +
      "**原因**：这些命令内部要拿「执行者玩家」的上下文（位置、队伍、背包、宝可梦队伍）。\n" +
      "RCON 的执行者是**控制台**，不是玩家。\n\n" +
      "**解法**：加一层 `execute as`\n" +
      "```\n# ❌\npokegive Pikachu level=50\n\n# ✅\nexecute as Alice run pokegive Pikachu level=50\n```\n\n" +
      "**需要玩家上下文的常见命令**\n" +
      "- `/pokegive`（Cobblemon）\n" +
      "- `/pokeedit`（Cobblemon）\n" +
      "- `/rctmod trainer summon`（Radical Cobblemon Trainers）\n" +
      "- 大部分 `/trigger`、`/team` 相关的玩家操作",
  },
  {
    id: "ssh-process-killed",
    cat: "general",
    title: "SSH 远程启动的服务进程会随会话结束被杀",
    tags: ["ssh", "进程", "启动", "schtasks", "计划任务"],
    body:
      "**现象**：通过 SSH 执行启动命令，服务器起来了；SSH 一断，java 进程**跟着消失**，日志里也没有停服记录。\n\n" +
      "**原因**：SSH 会话是一个进程组，会话结束时子进程被连带清理。\n\n" +
      "**解法**：用计划任务启动，脱离 SSH 会话：\n" +
      "```powershell\nschtasks /create /tn \"MinecraftServer\" /tr \"cmd.exe /c D:\\mcpack\\start-server.bat\" /sc onstart /ru SYSTEM /rl highest /f\nschtasks /run /tn \"MinecraftServer\"\n```\n\n" +
      "**不要**用 `Start-Process cmd.exe /c start ...`（父进程一断就没了）。\n\n" +
      "> 附带的坑：任务以 SYSTEM 运行时，`jstat` / `jcmd` 会报 `Could not map vmid to user name`，\n" +
      "> 需要性能分析时用 `spark` 而不是 attach JVM。",
  },
  {
    id: "ssh-encodedcommand",
    cat: "general",
    title: "通过 SSH 执行 PowerShell：用 -EncodedCommand 避开引号地狱",
    tags: ["ssh", "plink", "powershell", "引号", "编码", "EncodedCommand"],
    body:
      "**现象**\n" +
      "```\nThe ampersand (&) character is not allowed.\nThe term 'y' is not recognized as the name of a cmdlet\n```\n" +
      "或者中文全变乱码。\n\n" +
      "**原因**：`ssh host \"powershell -Command \\\"...\\\"\"` 有多层引号解析：SSH 客户端一层、目标 shell 一层、PowerShell 一层。\n\n" +
      "**解法**：脚本用 **UTF-16LE** 编码成 base64，用 `-EncodedCommand` 传：\n" +
      "```js\nconst enc = Buffer.from(script, 'utf16le').toString('base64');\n// ssh host `powershell -NoProfile -EncodedCommand ${enc}`\n```\n\n" +
      "零引号问题、零编码问题。本插件 `lib/ssh.js` 的 `powershell()` 就是这么做的。",
  },
  {
    id: "ssh-plink-hostkey",
    cat: "general",
    title: "plink 首次连接卡在 host key 确认 → 永久挂住",
    tags: ["plink", "ssh", "hostkey", "卡住", "puTTY"],
    body:
      "**现象**：脚本通过 plink 连新服务器时**永久挂住**，CPU 0%，没有任何输出。\n\n" +
      "**原因**：plink 第一次连新机器会**交互式询问**是否接受 host key，非交互环境没人回答。\n\n" +
      "**解法**：先用 `-batch` 跑一次，从 stderr 抓指纹：\n" +
      "```\nThe server's ssh-ed25519 key fingerprint is:\nssh-ed25519 255 SHA256:qG3HLdVRL6aaF1BeQMeloQTAdsvisPppiwcuP3g+04M\n```\n" +
      "然后用 `-hostkey` 重连：\n" +
      "```bash\nplink -batch -ssh -P 22 -l user -pw pass -hostkey \"ssh-ed25519 255 SHA256:...\" host \"echo ok\"\n```\n\n" +
      "本插件 `SshSession.handshake()` 就是这个流程，并且会把指纹缓存。",
  },

  // =========================================================================
  // 通用：JVM 与性能
  // =========================================================================
  {
    id: "jvm-heap",
    cat: "general",
    title: "堆内存给太大 + AlwaysPreTouch → Windows 报 1450（系统资源不足）",
    tags: ["jvm", "内存", "heap", "1450", "AlwaysPreTouch", "Xmx", "崩溃"],
    body:
      "**现象**\n" +
      "```\njava.io.IOException: 系统资源不足，无法完成请求的服务\n  at sun.nio.ch.FileDispatcherImpl.pwrite0\n  at net.minecraft.world.level.chunk.storage.RegionFile\n```\n" +
      "运行一段时间后**写区块时崩**。\n\n" +
      "**原因**：64 GB 机器上设 `-Xms32G -Xmx32G -XX:+AlwaysPreTouch`，\n" +
      "JVM 启动就强行把 32 GB 全部提交并预触碰，加上堆外内存、DirectByteBuffer、模组分配，\n" +
      "把 Windows 的提交限额打满，后续文件写入失败。\n\n" +
      "**解法**\n" +
      "```\n-Xms 取物理内存 30~40%\n-Xmx 取物理内存 60~75%\n去掉 -XX:+AlwaysPreTouch\n```\n\n" +
      "**实测值**\n" +
      "| 物理内存 | 推荐参数 | 结果 |\n" +
      "|---|---|---|\n" +
      "| 16 GB | `-Xms6G -Xmx12G` | 工作集 ~5 GB，堆余量充足 |\n" +
      "| 64 GB | `-Xms16G -Xmx22G` | 工作集 33.8 GB → 7~8 GB，系统可用 16→41 GB |\n\n" +
      "**校验**：加 GC 日志观察停顿，别凭感觉调：\n" +
      "```\n-Xlog:gc*:file=logs/gc.log:time,uptime,level,tags:filecount=5,filesize=20M\n```",
  },
  {
    id: "perf-falling-block",
    cat: "general",
    title: "falling_block 是隐形卡顿源（85 个 → MSPT 52ms）",
    tags: ["卡顿", "lag", "falling_block", "mspt", "沙砾", "tps"],
    body:
      "**现象**\n" +
      "- TPS 从 20 掉到 19.2\n" +
      "- MSPT 从 8ms 飙到 **52ms**\n" +
      "- 日志大量 `Can't keep up! Running 13849ms or 276 ticks behind`\n" +
      "- 玩家「看起来没看到什么异常」\n\n" +
      "**原因**\n" +
      "沙砾/沙子塌方会在同一坐标堆积**几十上百个** `minecraft:falling_block`。\n" +
      "每个每 tick 都要做重力 + 碰撞检测 + 落地判定。85 个就是 85 倍物理开销。\n\n" +
      "**排查**\n" +
      "```bash\nforge entity list        # 看 minecraft:falling_block 的数量\n```\n" +
      "正常 0~5 个；>10 异常；>30 基本就是主因。\n\n" +
      "**清理**\n" +
      "```mcfunction\nkill @e[type=minecraft:falling_block]\n```\n" +
      "⚠️ **不要**加 `execute in <维度>`——@e 是全局的，加了也不限定范围。\n\n" +
      "**定位源头**\n" +
      "```mcfunction\nexecute as @e[type=minecraft:falling_block,limit=1] run data get entity @s Pos\n```\n" +
      "拿到坐标去看那片区域，通常是玩家挖了沙砾、上方悬空部分持续塌方。\n\n" +
      "**根治**：把塌方区域填实。",
  },
  {
    id: "perf-diagnosis-order",
    cat: "general",
    title: "卡顿排查的正确顺序（别一上来就怀疑 GC）",
    tags: ["卡顿", "排查", "顺序", "诊断", "gc"],
    body:
      "```\n1. forge tps            → MSPT 是否超 50ms？哪个维度？\n2. forge entity list    → falling_block 数量？实体总数？Top5？\n3. 日志 grep \"Can't keep up\" → 频率和最大落后时间\n4. java 堆内存 / CPU    → 堆是否接近上限（GC 风暴会导致 CPU 100%）\n5. -Xmx 设置            → 16GB 机器必须 ≥12G\n```\n\n" +
      "**真实教训**：一度怀疑是 GC 问题，用 `jstat` 查了 YGC 2345 次 / 63.9 秒、FGC 0、GCT ≈0.06%，\n" +
      "GC 完全是红鲱鱼。真正的元凶是 **85 个 falling_block** + **堆内存打满**。\n\n" +
      "**看堆是否打满**\n" +
      "```powershell\n$j = Get-Process java | Select-Object -First 1\n[math]::Round($j.WorkingSet64/1GB, 2)   # 工作集\n```\n" +
      "工作集约等于 `-Xmx` 时，就是堆满了，CPU 会飙到 100%（GC 风暴）。",
  },
  {
    id: "perf-spark",
    cat: "general",
    title: "spark 的输出走聊天消息，RCON 里可能是空的",
    tags: ["spark", "性能", "采样", "rcon"],
    body:
      "**现象**：RCON 执行 `spark tps` / `spark health` 返回空字符串，但命令确实存在。\n\n" +
      "**原因**：spark 走的是 `sendSystemMessage`（聊天消息），不是标准的命令返回值，\n" +
      "RCON 的响应包里拿不到。\n\n" +
      "**解法**：结构化数据用原生命令\n" +
      "```\nforge tps            → 各维度 MSPT / TPS（RCON 能拿到）\nforge entity list    → 实体统计（RCON 能拿到，注意多包）\n```\n\n" +
      "要做深度分析时，让玩家在游戏里执行 `spark profiler start` / `spark profiler stop --upload`，\n" +
      "或者用 `spark profiler --timeout 60` 然后把生成的链接发给运维。",
  },
  {
    id: "perf-chunky",
    cat: "general",
    title: "区块预生成（Chunky）是降低探索卡顿最有效的手段",
    tags: ["chunky", "预生成", "区块", "卡顿", "世界生成"],
    body:
      "**为什么要做**：玩家跑到未生成的区域，服务器要**现场生成地形**，TPS 会暴跌。\n" +
      "预生成之后，玩家跑到那里只是读取，完全不卡。\n\n" +
      "**命令**（Forge/Fabric 的 Chunky 都兼容）\n" +
      "```\nchunky radius 2000        # 半径 2000 格（约 6.3 万区块）\nchunky start\nchunky progress           # 看进度（不是 chunky status）\nchunky pause / chunky cancel\n```\n\n" +
      "**实测**：4 核 / 16 GB 的 VPS 上，半径 2000 约 **25 分钟**跑完（40.7 chunks/s），\n" +
      "期间 TPS 保持 20.000，world 从 3 MB 涨到 **968 MB**。\n\n" +
      "**坑**：`config/chunky/config.json` 里 `continueOnRestart` 默认 `false`，\n" +
      "重启后任务不会自动继续，要重新 `chunky start`。\n" +
      "另外 `chunky progress` 显示 `No tasks running` 有两种含义：**任务做完了** / **任务被取消了**，\n" +
      "要看 world 目录的 region 文件数变化来判断。",
  },

  // =========================================================================
  // 通用：网络与端口
  // =========================================================================
  {
    id: "net-nat-mapping",
    cat: "general",
    title: "云 VPS 的 NAT 端口映射：为什么必须映射、怎么排查",
    tags: ["网络", "端口", "nat", "映射", "防火墙", "连不上"],
    body:
      "**为什么需要映射**\n" +
      "云 VPS 通常只有一个**内网 IP**（如 `172.16.x.x`），外面访问不到。\n" +
      "机房网关只把你**显式映射**的公网端口转发进来。\n\n" +
      "**协议怎么选**\n" +
      "| 用途 | 内网端口 | 协议 |\n" +
      "|---|---|---|\n" +
      "| Minecraft 游戏 | 25565 | TCP（Java 版）/ TCP+UDP（兼容基岩）|\n" +
      "| RCON | 25575 | **TCP** |\n" +
      "| SSH | 22 | **TCP** |\n" +
      "| RDP | 3389 | **TCP** |\n\n" +
      "**「能连上但无响应」的信号**\n" +
      "TCP 握手成功但服务端不返回任何数据 →\n" +
      "① 那条映射指向了**错误的内网端口**；② 该外网端口**已被其他租户占用**。\n" +
      "换一个偏门的外网端口（如 55421）通常能解决。\n\n" +
      "**服务器内部自测**\n" +
      "```powershell\nTest-NetConnection 127.0.0.1 -Port 25565     # 排除服务端问题\nTest-NetConnection <公网IP> -Port <映射端口>   # 测映射\n```",
  },
  {
    id: "net-enable-status",
    cat: "general",
    title: "enable-status 只影响服务器列表显示，不影响玩家进服",
    tags: ["enable-status", "状态查询", "服务器列表", "连不上"],
    body:
      "**现象**：服务器列表里显示「无法连接」/ 状态查询无响应，但玩家其实能正常进服。\n\n" +
      "**原因**：\n" +
      "- `enable-status=false` 会让服务端**拒绝 status 握手**（next state = 1）\n" +
      "- 但 **login 握手**（next state = 2）不受影响\n" +
      "- 某些模组（反机器人 / 连接优化类）也会屏蔽非官方的握手包\n\n" +
      "**怎么判断**\n" +
      "```\nRCON list 显示有玩家在线 → 进服是好的，只是状态查询被挡了\n```\n\n" +
      "**修正**：`server.properties` 里 `enable-status=true` + `enable-query=true`，重启生效。",
  },
  {
    id: "net-handshake-misjudge",
    cat: "general",
    title: "别用「模拟握手」判断端口通不通（会误判）",
    tags: ["测试", "握手", "误判", "状态查询", "login"],
    body:
      "**现象**：自己写了个 MC 状态查询 / 登录握手脚本，测出来「没有响应」，于是判断「端口不通」\n" +
      "—— 但玩家其实能正常进服。\n\n" +
      "**原因**：手写握手很容易在这些地方出错\n" +
      "- 协议号写错（**1.20.1 = 763**，1.20.4 = 765，1.21.1 = 767）\n" +
      "- **Login Start 的字段结构随版本变化**（1.20.1 有 UUID 16 字节，1.20.2+ 移除了）\n" +
      "- VarInt 编解码边界\n" +
      "- 混淆 `status`（next state 1）和 `login`（next state 2）\n" +
      "- 玩家名被反机器人机制拒绝\n\n" +
      "**更可靠的验证方式**\n" +
      "1. 让**真人客户端**连一次（最可靠）\n" +
      "2. RCON `list` 看是否真有玩家在线\n" +
      "3. `forge tps` 确认服务端在正常 tick",
  },
  {
    id: "net-iwr-brackets",
    cat: "general",
    title: "路径里带 [ ] 会让 Invoke-WebRequest -OutFile 失败",
    tags: ["powershell", "下载", "路径", "方括号"],
    body:
      "**现象**：`Invoke-WebRequest -OutFile 'D:\\mods\\[优化]xxx.jar'` 报「无法找到指定文件」，\n" +
      "或者下载出个 474 KB 的残缺文件（应该是 489 KB）。\n\n" +
      "**原因**：PowerShell 把 `[ ]` 当通配符处理。\n\n" +
      "**解法**：先下到无方括号的临时文件名，再用 `Move-Item -LiteralPath` 移过去，\n" +
      "并**用 SHA1 校验完整性**：\n" +
      "```powershell\n$tmp = Join-Path $env:TEMP 'dl.tmp'\n(New-Object System.Net.WebClient).DownloadFile($url, $tmp)\nMove-Item -LiteralPath $tmp -Destination 'D:\\mods\\[优化]xxx.jar'\n(Get-FileHash 'D:\\mods\\[优化]xxx.jar' -Algorithm SHA1).Hash  # 对比官方值\n```",
  },

  // =========================================================================
  // 整合包部署
  // =========================================================================
  {
    id: "modpack-deploy",
    cat: "general",
    title: "整合包服务端部署的完整步骤（Forge 1.20.1 为例）",
    tags: ["整合包", "modpack", "部署", "forge", "installer", "eula"],
    body:
      "**步骤**\n" +
      "```\n1. 解压服务端 zip 到目标目录（zip 通常没有子目录）\n" +
      "2. java -jar forge-<版本>-installer.jar --installServer\n" +
      "   → 生成 libraries/ + run.bat/run.sh\n" +
      "3. 创建 eula.txt：eula=true\n" +
      "4. 改 user_jvm_args.txt（⚠️ UTF-8 无 BOM）\n" +
      "5. 启动 → 首次会生成完整 server.properties\n" +
      "6. 再改 server.properties（⚠️ 首次启动后才改，因为会被 default-server-properties 覆盖）\n" +
      "7. 开 RCON + 放行防火墙\n" +
      "8. Chunky 预生成\n" +
      "```\n\n" +
      "**坑 1：`default-server-properties` 模组会覆盖一次**\n" +
      "包里带 `default-server.properties` + `default-server-properties` 模组，\n" +
      "**首次启动**会用模板内容覆盖 `server.properties`（日志里会打 `Replacing server properties with default properties!`），\n" +
      "之后打 `Default server properties injection ignored as it has already been run. This is not an error.`。\n" +
      "**所以必须在首次启动之后才改 server.properties**，否则会被冲掉。\n\n" +
      "**坑 2：模组配置会从 defaultconfigs 复制到 world/serverconfig**\n" +
      "首次启动后，`world/serverconfig/*.toml` 才是**实际生效**的那份，改 `config/` 里的没用。\n\n" +
      "**坑 3：enable-command-block 必须保持 true**\n" +
      "很多整合包（Create 系、载具系）的多方块和载具生成依赖命令方块。\n\n" +
      "**坑 4：Java 版本**\n" +
      "Forge 1.20.1 官方要 **Java 17**。Java 21 部分包能跑（Forge 47.2+），Java 22+ 明确不支持。",
  },
  {
    id: "modpack-java-version",
    cat: "general",
    title: "Forge 1.20.1 的 Java 版本兼容性实测",
    tags: ["java", "版本", "forge", "1.20.1"],
    body:
      "| Java | 结果 |\n" +
      "|---|---|\n" +
      "| 17 | ✅ 官方支持，最保险 |\n" +
      "| 21 | ⚠️ Forge 47.2+ 大多能跑（实测 47.4.0 + Zulu 21 的 234 模组包正常运行）|\n" +
      "| 22+ | ❌ 明确不支持 |\n\n" +
      "**判断方法**：启动日志里搜 `UnsupportedClassVersionError` 或 `mixin` 相关报错。\n\n" +
      "**注意**：装了 Java 21 但 Forge 要求 17 时，可以先试 21（省事），\n" +
      "崩了再降到 17。**不要**因为版本号不对就直接放弃 21。",
  },

  // =========================================================================
  // Cobblemon（宝可梦）
  // =========================================================================
  {
    id: "cobblemon-pokegive",
    cat: "cobblemon",
    title: "Cobblemon /pokegive 的完整参数与玩家上下文要求",
    tags: ["cobblemon", "宝可梦", "pokegive", "发宝可梦", "参数"],
    body:
      "**必须带玩家上下文**\n" +
      "```\n# ❌ RCON 直接执行 → A player is required to run this command here\nexecute as Alice run pokegive Pikachu\n```\n\n" +
      "**完整参数**（1.8.x 实测全部可用）\n" +
      "```\nexecute as Alice run pokegive <species> \\\n" +
      "  level=50 \\\n" +
      "  gender=female \\\n" +
      "  nature=timid \\\n" +
      "  ability=drizzle \\\n" +
      "  held_item=cobblemon:damp_rock \\\n" +
      "  moves=muddywater,hurricane,icebeam,raindance \\\n" +
      "  hp_iv=31 attack_iv=31 defence_iv=31 special_attack_iv=31 special_defence_iv=31 speed_iv=31 \\\n" +
      "  hp_ev=6 attack_ev=0 defence_ev=0 special_attack_ev=252 special_defence_ev=0 speed_ev=252\n" +
      "```\n\n" +
      "**参数名对照**\n" +
      "| 中文 | 参数 |\n" +
      "|---|---|\n" +
      "| 等级 | `level=` |\n" +
      "| 性格 | `nature=`（小写英文：timid / modest / adamant / jolly / bold / impish / calm / relaxed / naive / quiet ✓）|\n" +
      "| 特性 | `ability=`（小写去空格：drizzle / sandstream / regenerator / magicbounce ✓）|\n" +
      "| 性别 | `gender=male/female` |\n" +
      "| 携带道具 | `held_item=<完整 id>` |\n" +
      "| 技能 | `moves=a,b,c,d`（逗号分隔，**小写无空格**）|\n" +
      "| 个体值 | `hp_iv=` `attack_iv=` `defence_iv=` `special_attack_iv=` `special_defence_iv=` `speed_iv=` |\n" +
      "| 努力值 | `hp_ev=` 同上 |\n\n" +
      "**注意 `defence` 是英式拼写**（不是 `defense`）。\n\n" +
      "**给玩家发一整套队伍**：逐条 `execute as`，每条之间留 0.5 秒间隔，避免 RCON 拥塞。",
  },
  {
    id: "cobblemon-pokeedit",
    cat: "cobblemon",
    title: "★ /pokeedit 的 moves= 是【替换整个技能栏】，不是追加",
    tags: ["cobblemon", "宝可梦", "pokeedit", "技能", "覆盖", "事故"],
    body:
      "**这是本插件作者真实踩过的坑，会毁玩家数据。**\n\n" +
      "**现象**\n" +
      "```\nexecute as Alice run pokeedit 1 moves=overheat\n→ Edited Alice's Sableye.\n```\n" +
      "本来只想「学一个过热」，结果**把原来 4 个技能全部替换成了只有过热 1 个技能**。\n\n" +
      "**原因**\n" +
      "`moves=` 语义是**设置技能栏**（set），不是**追加**（append）。\n" +
      "不传的槽位会被清空。\n\n" +
      "**正确做法**\n" +
      "```\n# 要「保留原技能 + 加一个」→ 必须把 4 个技能全部列出来\nexecute as Alice run pokeedit 4 moves=flamethrower,hurricane,roost,overheat\n```\n\n" +
      "**槽位要先确认**\n" +
      "```\nexecute as Alice run pokeedit 1 level=50    # 返回 \"Edited Alice's Sableye.\" → 槽1 是 Sableye\n```\n" +
      "**先逐个槽位探明是谁**，再改技能，否则会改错宝可梦。\n\n" +
      "**补救**\n" +
      "立刻用原配招重新 `pokeedit` 覆盖回去，并**主动告知玩家**。\n" +
      "本插件的 `mc_pokemon_edit` 工具会强制要求传完整 4 个技能，并在只传 1-3 个时**拒绝执行**。",
  },
  {
    id: "cobblemon-mega-stone",
    cat: "cobblemon",
    title: "超进化石的物品 ID 在 mega_showdown 里，不是 zamega",
    tags: ["cobblemon", "宝可梦", "超进化", "mega", "进化石", "道具ID"],
    body:
      "**现象**：给 `zamega:golisopite` 报 `Unknown item`，但语言文件里明明写着「具甲武者进化石」。\n\n" +
      "**原因**\n" +
      "`zamega` 模组的语言文件里**保留了** `item.zamega.golisopite` 这个翻译键，\n" +
      "但**实际注册**这些物品的是 `mega_showdown` 模组，物品 ID 是 `mega_showdown:*`。\n\n" +
      "**对应的正确 ID**\n" +
      "| 中文 | 正确 ID |\n" +
      "|---|---|\n" +
      "| 喷火龙X进化石 | `mega_showdown:charizardite_x` |\n" +
      "| 喷火龙Y进化石 | `mega_showdown:charizardite_y` |\n" +
      "| 巨金怪进化石 | `mega_showdown:metagrossite` |\n" +
      "| 具甲武者进化石 | `mega_showdown:golisopite` |\n" +
      "| 勾魂眼进化石 | `mega_showdown:sablenite` |\n" +
      "| 超级手环 | `mega_showdown:mega_bracelet` |\n" +
      "| 小悠的超级手镯（含钥石）| `mega_showdown:brendan_mega_cuff` |\n\n" +
      "**怎么确认 ID 是否存在**\n" +
      "```\nclear <玩家> <item_id> 0\n→ \"Found 1 matching item(s)\"  = 物品存在\n→ \"No items were found\"       = 物品存在但玩家没有\n→ \"Unknown item 'xxx'\"        = ID 不存在\n```\n" +
      "**用 `clear ... 0` 探测是最安全的**（不会真的清东西）。\n\n" +
      "**超进化三件套**\n" +
      "超级手环 + 对应进化石 + 宝可梦携带 → 战斗中按键进化。\n" +
      "只给石头不给手环是进化不了的。",
  },
  {
    id: "cobblemon-commands-player-context",
    cat: "cobblemon",
    title: "Cobblemon 生态里需要玩家上下文的命令清单",
    tags: ["cobblemon", "宝可梦", "rctmod", "训练家", "execute as"],
    body:
      "| 命令 | 需要 `execute as` | 说明 |\n" +
      "|---|---|---|\n" +
      "| `/pokegive` | ✅ | 发给玩家的队伍/PC |\n" +
      "| `/pokeedit` | ✅ | 改玩家的宝可梦 |\n" +
      "| `/rctmod trainer summon` | ✅ | Radical Cobblemon Trainers 召唤训练家 |\n" +
      "| `/pokerename` / `/pokehelditem` | ✅ | |\n" +
      "| `/pc` 系列 | ✅ | |\n\n" +
      "**报错样式**\n" +
      "```\nA player is required to run this command here\n```\n" +
      "看到这句就是缺 `execute as <玩家>`。\n\n" +
      "**玩家不在线时**：大多数 Cobblemon 命令**无法执行**（因为要操作玩家实体）。\n" +
      "要离线给宝可梦，只能改存档（`world/cobblemonplayerdata/<uuid>.json`）或等玩家上线。",
  },
  {
    id: "cobblemon-ftbquests-advancement",
    cat: "cobblemon",
    title: "FTB Quests 的 type: advancement 任务引用不存在的成就 → 永远完不成",
    tags: ["cobblemon", "ftbquests", "任务", "成就", "advancement", "卡任务"],
    body:
      "**现象**：玩家做完了对应的战斗/收集，任务栏里的某一项永远不勾。\n\n" +
      "**排查**\n" +
      "1. 打开章节文件 `config/ftbquests/quests/chapters/<id>.snbt`\n" +
      "2. 找到卡住的任务，看 `tasks` 里的 `type: \"advancement\"` 和 `advancement: \"xxx:yyy\"`\n" +
      "3. 用 `/advancement grant <玩家> only <advancement>` 试一下\n" +
      "   如果返回 `Couldn't grant ... as they already have it` → 成就存在，问题在别处\n" +
      "   如果返回 `Unknown advancement` → **成就根本不存在**，任务永远完不成\n\n" +
      "**典型例子**\n" +
      "`rctmod:trainers/defeat_kanto_giovanni_gym`（坂木道馆）—— 这个成就**在任何模组里都不存在**，\n" +
      "但 FTB 章节里引用了它。（同类坏引用在一个 51 章的整合包里能扫出 **208 处**。）\n\n" +
      "**解法 A：补一个桩成就**（推荐，能让任务正常完成）\n" +
      "```json\n// world/datapacks/quest_adv_fix/data/rctmod/advancements/trainers/defeat_kanto_giovanni_gym.json\n{\n" +
      "  \"criteria\": { \"impossible\": { \"trigger\": \"minecraft:impossible\" } },\n" +
      "  \"requirements\": [[\"impossible\"]]\n}\n```\n" +
      "然后 `/reload` + `/advancement grant <玩家> only rctmod:...`\n\n" +
      "**解法 B：改任务类型**，把 `type: advancement` 换成 `type: checkmark`（手动勾）或 `kill`。",
  },
  {
    id: "cobblemon-species-additions",
    cat: "cobblemon",
    title: "Cobblemon 1.7+ 的融合形态用 species_additions，不是独立 species",
    tags: ["cobblemon", "宝可梦", "融合", "species_additions", "JEI"],
    body:
      "**现象**：想在 JEI 里找「阿尔奈朵」，搜不到。\n\n" +
      "**原因**\n" +
      "融合模组（如 `starlightfusion`）用 `data/cobblemon/species_additions/...` 把**融合形态挂到某个基础物种上**，\n" +
      "用 `\"target\": \"cobblemon:arceus\"` 指定。\n" +
      "所以「阿尔奈朵」是**阿尔宙斯的一个形态**，必须搜「阿尔宙斯」才看得到。\n\n" +
      "**怎么确认某个融合形态挂在谁身上**\n" +
      "```bash\n# 在模组 jar 里找\nunzip -l xxx-fusion.jar | grep species_additions\n# 然后看对应的 json 里的 \"target\" 字段\n```\n\n" +
      "**另一个坑**：不要凭中文名猜物种 ID。\n" +
      "「时空铠骑」不存在 —— 凯骑 = 铠骑 = `armarouge`（红莲铠骑），模组里只有 `armaraeon` / `armartina`。",
  },

  // =========================================================================
  // fabricplots 地皮
  // =========================================================================
  {
    id: "plots-not-persisted",
    cat: "plots",
    title: "★ fabricplots 地皮【不持久化】→ 每次重启前必须公告",
    tags: ["fabricplots", "地皮", "plot", "重启", "数据丢失", "公告"],
    body:
      "**核心事实**\n" +
      "fabricplots 的地皮世界**不写入磁盘**（或写入不完整），重建/重启后地皮内容可能丢失。\n" +
      "它的 `PlotWorldPainter.processPending` 是**每 tick** 从 `FabricPlots.onServerTick` 调用的，\n" +
      "也就是说地皮是靠运行时状态维护的。\n\n" +
      "**结论：重启前必须提前公告，让玩家把东西收回背包/箱子里。**\n\n" +
      "**标准重启流程**\n" +
      "```\n1. 提前 60 秒公告「服务器即将重启，请把地皮里的东西收回」\n" +
      "2. 倒计时 30 / 15 / 10 / 5 / 3 / 2 / 1\n" +
      "3. save-all flush\n" +
      "4. stop\n" +
      "5. 等进程退出 → 重启\n" +
      "```\n\n" +
      "本插件的 `mc_restart` 默认就带公告 + save + 优雅停服。",
  },
  {
    id: "plots-auto-explosion",
    cat: "plots",
    title: "★ plot_autoclaim 数据包在维度切换时触发 plot auto → 地皮世界爆炸",
    tags: ["fabricplots", "地皮", "plot auto", "数据包", "磁盘爆炸", "事故"],
    body:
      "**事故现象**\n" +
      "- 地皮维度的文件夹涨到 **22 GB**、6,557 个 region 文件\n" +
      "- 里面有区块在 **±30,000,000** 坐标\n" +
      "- 每次玩家进出地皮都卡 85~180 秒\n\n" +
      "**原因**\n" +
      "有个数据包用 `advancement` / `dimension change` 触发 `execute as @s at @s run plot auto`，\n" +
      "每换一次维度就给玩家**自动分配一块新地皮**，于是地皮世界被无限扩张。\n\n" +
      "**解法**\n" +
      "1. 把数据包移到 `world/datapacks-disabled/`\n" +
      "2. 把已经生成到远处的 region 文件打包移走\n" +
      "   （实测移走 1,180 个远端 region 文件共 **3,395 MB**）\n" +
      "3. 地皮配置里 `spawnChunkRadius=0`\n" +
      "4. 重启\n\n" +
      "**结果**：TPS 从 157 ms 恢复到 **6.5~12 ms** 稳定。\n\n" +
      "**教训**：任何「自动给玩家分配地皮/领地」的数据包都要先确认它会不会在维度切换时触发。",
  },
  {
    id: "plots-mob-purge",
    cat: "plots",
    title: "★ fabricplots 的未命名生物清理配置会【杀掉全服宝可梦】",
    tags: ["fabricplots", "地皮", "宝可梦", "mob", "清理", "误杀", "事故"],
    body:
      "**事故现象**\n" +
      "改了 fabricplots 的 `unnamed-mob-grace-ticks` / `mob-cap-per-plot` 想清理地皮里的怪，\n" +
      "结果**主世界的宝可梦全部死亡**。\n\n" +
      "**原因**\n" +
      "`@e` / `@a` 是**全局选择器**，地皮模组的清理逻辑如果没做维度限定，\n" +
      "就会把**所有维度**的未命名实体都清掉。\n" +
      "（同类错误：想只在地皮关刷怪，执行了 `doMobSpawning false`，结果全服不刷怪。）\n\n" +
      "**安全配置**（把自动清理彻底关掉，只保留限额）\n" +
      "```properties\n" +
      "mob-cap-per-plot=999\n" +
      "mob-escape-action=teleport\n" +
      "mob-scan-interval-ticks=2147483000   # 等于永不扫描\n" +
      "unnamed-mob-grace-ticks=2147483000   # 等于永不过期\n" +
      "mob-spawning=per-plot\n" +
      "protect-mob-griefing=true\n" +
      "```\n\n" +
      "**教训**：任何「清理实体」的配置，先确认它是不是按维度限定的。\n" +
      "拿不准就把 `*-interval-ticks` / `*-grace-ticks` 设成极大值（不清理），\n" +
      "用**定时公告 + 手动清理**代替自动清理。",
  },
  {
    id: "plots-config",
    cat: "plots",
    title: "fabricplots 关键配置项速查",
    tags: ["fabricplots", "地皮", "配置", "properties"],
    body:
      "配置文件：`config/fabricplots.properties`\n\n" +
      "| 配置项 | 作用 | 安全值 |\n" +
      "|---|---|---|\n" +
      "| `claim-limit` | 每人可拥有地皮数 | `1` |\n" +
      "| `mob-cap-per-plot` | 每块地皮的生物上限 | `999`（别设小）|\n" +
      "| `mob-scan-interval-ticks` | 生物扫描间隔 | `2147483000`（=关闭）|\n" +
      "| `unnamed-mob-grace-ticks` | 未命名生物宽限期 | `2147483000`（=关闭）|\n" +
      "| `mob-escape-action` | 生物跑出地皮时 | `teleport` |\n" +
      "| `mob-spawning` | 刷怪模式 | `per-plot` |\n" +
      "| `protect-mob-griefing` | 保护生物不被破坏方块 | `true` |\n" +
      "| `street-sweeper` | 街道清扫 | `false` |\n" +
      "| `inactivity-expiry` | 不活跃回收地皮 | `false` |\n" +
      "| `manage-gamemode` | 地皮内切换游戏模式 | `false` |\n" +
      "| `advance-time` / `advance-weather` | 地皮世界推进时间/天气 | `true` |\n" +
      "| `spawn-x/y/z` | 地皮世界出生点 | 按需 |\n\n" +
      "**改之前先备份**：`Copy-Item fabricplots.properties fabricplots.properties.bak`",
  },

  // =========================================================================
  // 竞技场 / 游戏模式
  // =========================================================================
  {
    id: "spleef-gamemode-leak",
    cat: "plots",
    title: "★ 竞技场把玩家切成 adventure 后没切回来 → 玩家卡在冒险模式",
    tags: ["spleef", "竞技场", "gamemode", "adventure", "冒险模式", "事故"],
    body:
      "**现象**：玩家反映「挖不了方块」「放不了东西」，一查 `playerGameType` 是 **2 = adventure**。\n" +
      "反复出现，每次都要手动 `gamemode survival <玩家>`。\n\n" +
      "**原因**\n" +
      "竞技场（spleef 等）的 kit/入场函数里有 `gamemode adventure @p`，\n" +
      "但**离开时靠的是「在竞技场内触发恢复」**。\n" +
      "玩家被 tp 走、掉线、或者被别的机制传送 → **恢复逻辑没跑到** → 永久卡在 adventure。\n\n" +
      "**临时救**：`gamemode survival <玩家>` + 验证 `data get entity <玩家> playerGameType`（0 = survival）\n\n" +
      "**根治：装一个自愈数据包**（每 5 秒扫一次，在竞技场外的 adventure 玩家自动切回 survival）\n" +
      "```json\n" +
      "// data/advfix/predicate/in_arena.json —— 判定是否在竞技场里\n" +
      "{ \"condition\": \"minecraft:location_check\", \"predicate\": { \"dimension\": \"spleef:arena\" } }\n" +
      "```\n" +
      "```mcfunction\n" +
      "# data/advfix/function/tick.mcfunction\n" +
      "execute as @a[gamemode=adventure] at @s unless predicate advfix:in_arena run function advfix:fix_one\n" +
      "```\n" +
      "```mcfunction\n" +
      "# data/advfix/function/fix_one.mcfunction\n" +
      "gamemode survival @s\n" +
      "title @s actionbar [{\"text\":\"已恢复生存模式\",\"color\":\"green\"}]\n" +
      "```\n" +
      "本插件内置了这个数据包模板（`mc_install_datapack pack=adventure-fix`）。",
  },

  // =========================================================================
  // 经济与玩家数据
  // =========================================================================
  {
    id: "economy-command-order",
    cat: "plots",
    title: "★ /economy deposit 的参数顺序是「金额 货币 玩家」",
    tags: ["economy", "经济", "金币", "impactor", "参数顺序"],
    body:
      "**正确格式**\n" +
      "```\n/economy deposit <金额> <货币> <玩家>\n```\n" +
      "```\n# 给 Alice 加 10000 金币\neconomy deposit 10000 impactor:dollars Alice\n```\n\n" +
      "**不是** `/economy deposit Alice 10000`（顺序反了会报参数错误）。\n" +
      "**货币必须写全 ID**（`impactor:dollars`），不能只写 `dollars`。\n\n" +
      "**坑 1：输出不进 RCON**\n" +
      "`economy` 的 `Transaction completed successfully!` / `Balance: $N` 是走**日志**的，\n" +
      "RCON 响应里拿不到。**要验证余额，直接读文件**：\n" +
      "```\nconfig/impactor/economy/accounts/users/<UUID前2位>/<UUID>.conf\n```\n" +
      "内容是纯文本：`\"impactor:dollars\": 10500.0`\n\n" +
      "**坑 2：多个经济模组会打架**\n" +
      "`ChestShop` 之类的商店模组必须指向同一个经济后端（比如全用 `impactor`）。\n" +
      "同时装 `cobbledollars` / `CobbleDollarsBridge` 会冲突，要么只留一个，要么把 bridge 挪进 `mods-disabled`。",
  },
  {
    id: "playerdata-audit",
    cat: "plots",
    title: "玩家数据「没了」的排查：先分清良性噪音和真丢失",
    tags: ["玩家数据", "playerdata", "存档", "数据丢失", "审计"],
    body:
      "**先别慌**：这些日志**不是**数据丢失\n" +
      "```\nCould not ... .old File ... is corrupt or missing. Data is lost\n```\n" +
      "这是**首次加载**某玩家时的良性噪音（旧的 `.old` 备份文件不存在，正常）。\n\n" +
      "**真正的审计项**\n" +
      "```powershell\n$w = 'world'\n# 1. 零字节 / 截断的玩家数据（真丢失）\nGet-ChildItem \"$w\\playerdata\" -Filter *.dat | Where-Object { $_.Length -lt 100 }\n\n" +
      "# 2. 孤立的 .old 文件（.dat 没了但 .old 还在 → 可以恢复）\nGet-ChildItem \"$w\\playerdata\" -Filter *.dat.old |\n  Where-Object { -not (Test-Path ($_.FullName -replace '\\.old$','')) }\n\n" +
      "# 3. 宝可梦数据单独一份\nGet-ChildItem \"$w\\cobblemonplayerdata\" -File | Measure-Object -Property Length -Sum\n```\n\n" +
      "**宝可梦服的数据文件分布**\n" +
      "| 路径 | 内容 |\n" +
      "|---|---|\n" +
      "| `world/playerdata/<uuid>.dat` | 原版玩家数据（背包/位置/经验）|\n" +
      "| `world/cobblemonplayerdata/<uuid>.json` | 宝可梦队伍 + PC |\n" +
      "| `world/data/rctmod.player.<uuid>.stat.dat` | 训练家进度（gzip NBT）|\n" +
      "| `config/impactor/economy/accounts/users/...` | 金币余额（纯文本）|\n\n" +
      "**恢复优先级**：`.dat.old` > `world` 备份 > 更早的整机备份。",
  },
  {
    id: "lootr-ticker-patch",
    cat: "plots",
    title: "Lootr 的每 tick 检查拖慢服务器 → 字节码补丁把 ticker 打空",
    tags: ["lootr", "战利品箱", "卡顿", "字节码", "补丁"],
    body:
      "**现象**：装了 Lootr（战利品箱）后 MSPT 明显上升，`spark` 里能看到 `BlockEntityTicker` 占大头。\n\n" +
      "**原因**：Lootr 的 `BlockEntityTicker.onServerTick` 每个 tick 都要检查所有战利品箱的衰减/刷新。\n\n" +
      "**解法 A（推荐）：先试配置**\n" +
      "```json\n// config/lootr.json\n{\n  \"perform_tick_decay\": false,\n  \"start_tick_decay\": false,\n  \"perform_piecewise_check\": false,\n  \"decay_all\": false\n}\n```\n" +
      "**注意**：`/lootr disable` 这个命令**不存在**（会报 `Incorrect argument for command`），别被网上的教程误导。\n\n" +
      "**解法 B：字节码补丁（配置无效时）**\n" +
      "在 jar 里定位 `BlockEntityTicker` 的 `onServerTick` 方法，把方法体替换成**立即 return**：\n" +
      "```\n原: B8 00 30 99 00 04 B1 BB 00 47 ...\n" +
      "新: B1 00 00 ...        # B1 = return\n```\n" +
      "补丁后 Lootr 的其他功能（开箱掉落、每人独立战利品）**全部正常**，只是不再每 tick 检查。\n" +
      "⚠️ 打补丁前备份原 jar（`.bak-orig`）。\n\n" +
      "**通用手法**：同类「每 tick 做无意义检查」的模组都可以这样处理 ——\n" +
      "先找 `onServerTick` / `tick`，再看能不能改成早退。",
  },
  {
    id: "mod-conflict-disabled",
    cat: "plots",
    title: "整合包里的模组冲突排查与禁用策略",
    tags: ["模组", "冲突", "崩溃", "mods-disabled", "排查"],
    body:
      "**排查顺序**\n" +
      "1. 看 `logs/latest.log` / `crash-reports/` 里的**第一个** `Caused by:` 栈顶\n" +
      "2. 栈里出现的类名 → 反查是哪个模组（看包名前缀）\n" +
      "3. 把可疑模组移到 `mods-disabled/`（不要删，方便回滚）\n" +
      "4. 重启验证\n\n" +
      "**真实案例**\n" +
      "| 模组 | 症状 | 处理 |\n" +
      "|---|---|---|\n" +
      "| 自制的 `jo-rad-gyms-fix-1.0.0.jar`（4 KB）| `NullPointerException: ServerPlayer` | 禁用 |\n" +
      "| `Carpet` 在 1.21.1 | `carpet:hello` 抛 `ClassCastException`，会踢玩家 | **不要启用** |\n" +
      "| `c2me`（区块加载并行）| 与某些区块模组冲突 | 移到 `mods-disabled` |\n" +
      "| `CobbleDollarsBridge` | 与经济模组冲突 | 移到 `mods-disabled` |\n\n" +
      "**策略**\n" +
      "- 永远**移动**而不是删除（`mods-disabled/` 保留原文件名）\n" +
      "- 一次只改一个模组\n" +
      "- 改之前先备份 `mods/` 的清单（`Get-ChildItem mods | Select Name`）",
  },
  {
    id: "rtp-dimension-blacklist",
    cat: "plots",
    title: "/rtp 随机传送会把玩家丢到 84,000 格外 → 引发世界生成卡顿",
    tags: ["rtp", "随机传送", "世界生成", "卡顿", "ftbessentials"],
    body:
      "**现象**：偶尔出现 85~180 秒的巨长卡顿，`spark` 显示在区块生成上。\n\n" +
      "**原因**：`/rtp`（随机传送）把玩家丢到几万格外，服务器要**现场生成**那片地形。\n" +
      "实测有玩家被丢到 **84,000 格**外，直接触发长卡顿。\n\n" +
      "**解法 1：把 rtp 限制住**\n" +
      "```snbt\n// config/ftbessentials.snbt\nrtp: {\n  enabled: false\n  dimension_blacklist: [\"minecraft:overworld\", \"minecraft:the_nether\", \"minecraft:the_end\", \"fabricplots:plots\", \"spleef:arena\", \"*\"]\n  max_distance: 1\n  min_distance: 0\n}\n```\n" +
      "同时把 `config/aliases.json` 里的 `/wild` 别名删掉。\n\n" +
      "**解法 2：预生成**（见 `perf-chunky` 条目）\n\n" +
      "**监控**：玩家坐标超过 20,000 格就提醒一次，超过 50,000 格考虑 `/tp` 回来。\n\n" +
      "**临时救急**：`/tp <玩家> 0 104 -20` 把玩家拉回出生点。",
  },

  // =========================================================================
  // 存档与备份
  // =========================================================================
  {
    id: "backup-strategy",
    cat: "general",
    title: "Minecraft 服务器的备份策略",
    tags: ["备份", "backup", "存档", "灾难恢复"],
    body:
      "**备份什么**\n" +
      "```\nworld/                    ← 世界（最大，必须）\nconfig/                   ← 模组配置\nserver.properties\nops.json / whitelist.json / banned-*.json\nmods/ 的清单（文件名+大小，不用备份 jar）\nworld/datapacks/          ← 数据包\n```\n\n" +
      "**怎么备**\n" +
      "```powershell\n# 停服后（最安全）\nsave-all flush + stop → robocopy /MIR world D:\\backup\\world-$(Get-Date -f yyyyMMdd-HHmm)\n\n" +
      "# 或热备（先 save-all flush 再复制）\n" +
      "```\n\n" +
      "**保留策略**：日备份留 7 份，周备份留 4 份，月备份留 3 份。\n\n" +
      "**验证备份有效**（很多人不做这一步，灾难时才发现备份是坏的）\n" +
      "```powershell\n# 至少检查 level.dat 能不能读\ntest-path \"D:\\backup\\<日期>\\world\\level.dat\"\n# 以及 region 文件数\n(Get-ChildItem \"D:\\backup\\<日期>\\world\\region\" -Filter *.mca).Count\n```",
  },
  {
    id: "rcon-security",
    cat: "general",
    title: "RCON 的安全实践",
    tags: ["rcon", "安全", "密码", "端口"],
    body:
      "**必须做的**\n" +
      "- RCON 密码用**独立强密码**，不要复用面板密码 / 系统密码\n" +
      "- RCON 端口**只对内网或白名单 IP** 开放（或走 SSH 隧道）\n" +
      "- `enable-rcon=true` 时确认 `broadcast-rcon-to-ops` 的取值符合预期\n\n" +
      "**推荐架构（云 VPS）**\n" +
      "```\n公网只开：游戏端口（TCP）、SSH（TCP，最好限制来源 IP）\nRCON 端口只绑定 127.0.0.1 或内网，通过 SSH 隧道访问\n```\n" +
      "本插件的运维脚本就是走 SSH → 本地 RCON（127.0.0.1:25575），**RCON 不暴露公网**。\n\n" +
      "**验漏**：定期看 `logs/latest.log` 有没有异常的 `RCON` 登录记录。",
  },
];

/** 按关键词检索 */
export function searchKb(topic) {
  const t = String(topic ?? "").toLowerCase().trim();
  if (!t) return KB;
  return KB.filter((x) =>
    (x.id + " " + x.title + " " + x.body + " " + x.tags.join(" ") + " " + x.cat).toLowerCase().includes(t),
  );
}

/** 按分类过滤 */
export function kbByCategory(cat) {
  return KB.filter((x) => x.cat === cat);
}

/** 全部分类 */
export function kbCategories() {
  const m = new Map();
  for (const x of KB) m.set(x.cat, (m.get(x.cat) ?? 0) + 1);
  return [...m.entries()].map(([cat, count]) => ({ cat, count }));
}
