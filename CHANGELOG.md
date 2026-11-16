# Changelog

## 0.2.0 — 2026-11-16

补齐 **Cobblemon（宝可梦）服务器**与 **fabricplots 地皮** 专有场景。工具从 12 个 → **22 个**，知识库从 12 条 → **44 条**。

### 新增工具（10 个）

| 工具 | 作用 |
|---|---|
| `mc_pokemon_give` | 发宝可梦。自动 `execute as`，自动把中文性格/特性/道具/技能翻译成英文参数 |
| `mc_pokemon_edit` | 改宝可梦。**硬性护栏**：`moves=` 必须传满 4 个（它是替换整个技能栏，只传 1-3 个会清空） |
| `mc_pokemon_team` | 读队伍。走 `world/usercache.json` → `cobblemonplayerdata/<uuid>.json`，**不修改任何东西** |
| `mc_pokemon_item` | 发道具/超进化石/超级手环。中文名自动解析到正确 ID（`mega_showdown:*` 而非 `zamega:*`） |
| `mc_plots` | fabricplots 配置读取 / **危险项检测** / 一键安全配置 / 地皮不持久化重启预警 |
| `mc_economy` | 经济操作。强制正确参数顺序「金额 货币 玩家」，并提示 RCON 拿不到余额回显 |
| `mc_playerdata` | 玩家数据审计。零字节 / 截断 / 孤立 `.dat.old` / 宝可梦数据 / rctmod 进度 |
| `mc_gamemode_fix` | 修「卡在冒险模式」。查询 / 强切 survival / 部署 adventure-fix 数据包 |
| `mc_quest` | 修 FTB Quests 卡任务。为不存在的 advancement 生成桩成就 + 补发 |
| `mc_jvm` | JVM 参数。按物理内存档位推荐（16GB→12G，64GB→22G，均为实测值），**UTF-8 无 BOM** 写入 |

### 新增模块

- `lib/kb.js` — 知识库独立成模块，44 条，分 `general` / `cobblemon` / `plots` 三类
- `lib/cobblemon.js` — 中文→英文翻译表（性格 50 / 特性 40 / 道具 39 / 技能 78）+ 参数校验 + 命令生成 + **pokeedit 护栏**
- `lib/extras.js` — 地皮配置解析与风险检测 / adventure-fix 生成器 / 经济命令 / 玩家数据审计 / 桩成就生成器 / JVM 档位
- `lib/tools-extra.js` — 10 个新工具定义（与 index.js 分开避免循环 import）

### 新增数据包模板

- `adventure-fix` — 每 5 秒把竞技场外的 adventure 玩家自动切回 survival（治 spleef 的 gamemode 泄漏）
- `quest-adv-fix` — 为 FTB Quests 引用的不存在成就生成 `minecraft:impossible` 桩成就

### 修正

- `mc_install_datapack`: `adventure-fix` 委托给 `mc_gamemode_fix`（那条有完整部署逻辑）
- `recommendJvm`: 从线性百分比改成**实测档位表**（之前 16GB 会算成 9G，实际应用 12G）
- 修回被漏掉的 `installMonitor` import
- 修 `buildPokeEditCommand` 的「未指定字段」误判（`parts.length === 2` 应为 `=== 1`）

---
## 0.1.0 — 2026-11-16

首个版本。从一台真实运行中的 Windows VPS（Forge 1.20.1 / 234 模组丧尸整合包）的运维现场提炼。

### 新增工具（12 个）

- `mc_status` — 状态快照（人数/玩家名/TPS/MSPT/维度/RCON 延迟）
- `mc_rcon` — 执行任意 RCON 命令（支持多条复用连接）
- `mc_diagnose` — 卡顿全链路诊断（tick / 维度 / 实体 / 日志 / 堆内存 / CPU）
- `mc_cleanup` — 清理异常实体（falling_block / item / experience_orb / 任意 ID）
- `mc_announce` — 全服广播（自动 tellraw + 提示音）
- `mc_restart` — 公告 + save-all flush + stop + SSH 自动拉起
- `mc_log` — 读日志尾部（SSH / 本地，支持正则过滤，自动滤噪）
- `mc_config` — server.properties 读写（UTF-8 无 BOM）
- `mc_install_datapack` — 生成/部署数据包（item-cleaner）
- `mc_monitor` — 桌面监控浮窗（安装/启动/停止/状态/保活）
- `mc_deploy` — 生成 Windows VPS 部署脚本包
- `mc_pitfalls` — 运维知识库（12 条实战坑）

### 内置模块

- `lib/rcon.js` — 零依赖 RCON 客户端，支持多包拼接、连接复用、错误分类
- `lib/ssh.js` — 跨平台 SSH 执行层（plink / ssh），自动抓取并缓存 host key，PowerShell 用 `-EncodedCommand` 传输
- `lib/diagnose.js` — 诊断引擎（解析 `forge tps` / `forge entity list` / 日志 → 分级结论 + 建议）
- `lib/datapacks.js` — 数据包生成器（自动处理 pack_format、functions/function、无 BOM）
- `lib/monitor.js` — 桌面监控组件部署器（采集器 + 浮窗 + 保活计划任务）

### 内置资产

- `assets/McServerMonitor.ps1` — WinForms 浮窗（无边框/置顶/可拖动/圆角/迷你 TPS 曲线）
- `assets/mcmon-poll.ps1` — 独立采集器（单例锁，写 JSON）
- `assets/start-monitor.vbs` — 无黑窗口启动器
- `assets/mcmon-keepalive.ps1` — 保活脚本
- `assets/datapacks/item-cleaner/` — 掉落物清理数据包模板（带占位符）

### 设计要点

- **采集与显示分离**：RCON 超时不会让监控窗口卡死
- **无 BOM 写入**：所有生成的配置文件、数据包文件都是 UTF-8 无 BOM
- **独立会话启动**：重启用计划任务触发，不随 SSH 会话被杀
- **多包读取**：长 RCON 响应自动拼接，不会截断
- **分级诊断**：`falling_block` 多但 TPS 正常时报「潜在隐患」而不是「严重卡顿」
