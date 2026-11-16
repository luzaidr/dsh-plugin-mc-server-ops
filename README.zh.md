# Minecraft 服务器运维插件（中文说明）

> [DSH (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) 宿主插件
> 把「一台 Minecraft 服务器从装好到长期稳定运行」的全套动作，变成 AI 可直接调用的 22 个工具。

英文说明见 [README.md](README.md)。

---

## 这是什么

从**真实运维现场**长出来的插件：一台 Windows VPS 上跑 Forge 1.20.1 的 234 模组丧尸整合包，
期间踩过的坑（BOM 编码、`@e` 全局选择器、RCON 多包截断、SSH 杀进程、`falling_block` 隐形卡顿……）
全部沉淀成工具和知识库。

装上之后，你可以直接对 AI 说：

- 「看看服务器卡不卡」→ 它跑 `mc_diagnose`，给出分级结论 + 处理建议
- 「把掉落的沙砾清一下」→ `mc_cleanup target=falling_block`
- 「公告 30 秒后重启」→ `mc_restart countdown=30`
- 「在我桌面装个监控浮窗」→ `mc_monitor install → start → keepalive`
- 「渲染距离改成 6」→ `mc_config set=["view-distance=6"]`
- 「帮我生成部署脚本」→ `mc_deploy`，产出一键初始化脚本包

---

## 12 个基础工具

| 工具 | 作用 | 需要 |
|---|---|---|
| `mc_status` | 人数 / TPS / MSPT / 维度 / 延迟 | RCON |
| `mc_rcon` | 执行任意服务端命令（支持多条） | RCON |
| `mc_diagnose` | 卡顿全链路诊断 | RCON（+SSH 更准） |
| `mc_cleanup` | 清理异常实体 | RCON |
| `mc_announce` | 全服广播（带提示音） | RCON |
| `mc_restart` | 公告 + 保存 + 停服 + 自动拉起 | RCON + SSH |
| `mc_log` | 读日志尾部（自动滤噪） | SSH 或本地路径 |
| `mc_config` | 读写 server.properties | SSH |
| `mc_install_datapack` | 生成/部署数据包 | 本地（+SSH 部署） |
| `mc_monitor` | 桌面监控浮窗 + 保活 | Windows |
| `mc_deploy` | 生成 Windows VPS 部署包 | 本地 |
| `mc_pitfalls` | 运维知识库（44 条坑） | 无 |

---

## 安装

```bash
dsh plugin --profile desktop add dsh-plugin-mc-server-ops
```

## 最小配置

```yaml
- id: mc-server-ops
  name: dsh-plugin-mc-server-ops
  config:
    defaultServer: main
    servers:
      main:
        label: 我的服务器
        host: play.example.com
        rconPort: 25575        # RCON 端口，不是 25565！
        rconPass: "你的RCON密码"
```

**只有 RCON 就能用 6 个工具**。配上 SSH 后解锁配置读写、日志、数据包部署、自动重启、系统资源诊断。

---

## 桌面监控组件细节

采用**采集与显示分离**的双进程架构：

```
服务器 ──RCON──> 采集器（隐藏进程）──写 JSON──> 浮窗（只渲染）
```

所以 RCON 超时不会让窗口卡死。

浮窗显示：

```
┌────────────────────────────────────┐
│  我的服务器                     ✕ │
│                                    │
│  在线人数                 ● 流畅   │
│      3            ┌──────────────┐ │
│  / 50             │  〰〰〰〰〰〰  │ │ ← TPS 曲线
│                   └──────────────┘ │
│  TPS   20.00   MSPT  8.5 ms       │
│  延迟  39 ms   维度  6 个正常      │
│                                    │
│  玩家：Alice、Bob、Carol          │
│  更新于 20:40:58                   │
└────────────────────────────────────┘
```

操作：拖动标题栏移动（位置自动记住）、`✕` 关闭、右键菜单（立即刷新 / 窗口置顶 / 重启采集器 / 退出）。

颜色：TPS ≥19.5 绿 / 17~19.5 黄 / <17 红；MSPT ≤15 绿 / ≤35 黄 / >35 红。

保活：`mc_monitor action=keepalive` 注册计划任务（登录自启 + 每 5 分钟检查）。

---

## 内置数据包 item-cleaner

每 10 分钟清理一次地面掉落物，清理前 10 秒广播预警，清理后播报数量。

已经处理好这些坑：
- 文件 UTF-8 **无 BOM**
- 伪玩家名用 `icTimer` 而不是 `#timer`（`#` 是注释符）
- `pack_format` 按版本自动填
- 1.21+ 自动把 `functions/` 改成 `function/`

```
mc_install_datapack pack=item-cleaner intervalMinutes=10 deploy=true reload=true
```

---

## 安全提示

- RCON 密码会存在插件配置里，用**独立强密码**
- `mc_restart` 会**真的停服**
- `mc_cleanup` 是**不可逆删除**
- SSH 生产环境建议用密钥

---

## License

MIT

---

## v0.2.0 — 补上宝可梦服（Cobblemon）与地皮

工具 **12 → 22 个**，知识库 **12 → 44 条**。

### 新增的 10 个工具

| 工具 | 作用 |
|---|---|
| `mc_pokemon_give` | 发宝可梦。自动加 `execute as <玩家>`，自动把中文的性格/特性/道具/技能翻译成 Cobblemon 认的英文参数 |
| `mc_pokemon_edit` | 改宝可梦。**硬护栏**：`moves=` 必须正好 4 个——它是**替换整个技能栏**，只传 1~3 个会把剩下的静默清空。工具会直接拒绝 |
| `mc_pokemon_team` | 读队伍。走 `world/usercache.json` → `cobblemonplayerdata/<uuid>.json`，**只读不写** |
| `mc_pokemon_item` | 发道具/超进化石/超级手环。中文名解析成**真实 ID**（`mega_showdown:*`，不是 `zamega:*`）|
| `mc_plots` | fabricplots：读配置、**检测危险的生物清理设置**、一键安全配置、广播「地皮不持久化」预警 |
| `mc_economy` | 经济操作，强制正确的参数顺序（**金额 货币 玩家**），并提示 RCON 读不到余额回显 |
| `mc_playerdata` | 玩家数据审计：零字节/截断的 `.dat`、孤立 `.dat.old`（可恢复）、宝可梦数据、rctmod 进度 |
| `mc_gamemode_fix` | 修「卡在冒险模式」：查询、强切 survival、部署 `adventure-fix` 数据包 |
| `mc_quest` | 修 FTB Quests 卡任务：给**根本不存在的成就**生成桩成就，再补发 |
| `mc_jvm` | 按物理内存档位给 JVM 参数（16 GB → `-Xmx12G`，64 GB → `-Xmx22G`，都是实测值），**UTF-8 无 BOM** 写入 |

### 中文 → 英文 翻译表（真正让它可用的部分）

`lib/cobblemon.js` 内置：

- **性格 50 条**：内敛→modest、胆小→timid、爽朗→jolly、固执→adamant …
- **特性 40 条**：降雨→drizzle、扬沙→sandstream、画皮→disguise …
- **道具 39 条**：生命宝珠→`cobblemon:life_orb`、凹凸头盔→`cobblemon:rocky_helmet`、喷火龙Y进化石→`mega_showdown:charizardite_y` …
- **技能 78 条**：浊流→muddywater、流星群→dracometeor、急速折返→uturn …

### 新增数据包模板

- `adventure-fix` — 每 5 秒把**竞技场维度之外**处于 `adventure` 的玩家切回 `survival`。治 spleef 竞技场的游戏模式泄漏
- `quest-adv-fix` — 为 FTB Quests 引用的**不存在的成就**生成 `minecraft:impossible` 桩成就（一个 51 章的整合包里能扫出 **208 处**这种坏引用）

### 沉淀进去的实测数字

| 项目 | 值 |
|---|---|
| 16 GB 服务器 | `-Xms6G -Xmx12G`（工作集约 5 GB）|
| 64 GB 服务器 | `-Xms16G -Xmx22G`（曾用 32G + AlwaysPreTouch → Windows 报 1450）|
| fabricplots 安全值 | `mob-scan-interval-ticks=2147483000`、`unnamed-mob-grace-ticks=2147483000`、`mob-cap-per-plot=999` |
| 经济命令 | `economy deposit 10000 impactor:dollars <玩家>` |
| 超进化石 | `mega_showdown:charizardite_y` / `metagrossite` / `golisopite` / `sablenite` |