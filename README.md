# dsh-plugin-mc-server-ops

**Minecraft 服务器部署与运维工具箱** —— 给 [DSH (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) 用的宿主插件。

把一台 Minecraft 服务器从「装好」到「长期稳定运行」的一整套动作，变成 AI 可以直接调用的 12 个工具。

> 这个插件是从真实运维现场长出来的：一台 Windows VPS 上跑 Forge 1.20.1 的 234 模组丧尸整合包（某丧尸末日整合包），
> 期间踩过 BOM 编码、`@e` 全局选择器、RCON 多包截断、SSH 杀进程、`falling_block` 隐形卡顿…… 全部沉淀成了工具和知识库。

---

## 特性

| 能力 | 工具 | 说明 |
|---|---|---|
| 状态快照 | `mc_status` | 在线人数/玩家名、TPS、MSPT、各维度 tick、RCON 延迟 |
| 任意命令 | `mc_rcon` | 一条或多条 RCON 命令，支持 list/say/op/give/gamerule/forge tps/forge entity list/stop |
| 卡顿诊断 | `mc_diagnose` | TPS+MSPT+实体统计+日志告警+堆内存+CPU → 分级结论与处理建议 |
| 异常清理 | `mc_cleanup` | `falling_block` / `item` / `experience_orb` / 任意实体，清理前后报数量 |
| 全服广播 | `mc_announce` | 自动转 tellraw，可带提示音 |
| 安全重启 | `mc_restart` | 倒计时公告 → save-all flush → stop → 等退出 → SSH 拉起 |
| 日志读取 | `mc_log` | 远端（SSH）或本地，支持正则过滤，自动滤噪 |
| 配置读写 | `mc_config` | server.properties 读写（**UTF-8 无 BOM**，规避「找不到主类」） |
| 数据包管理 | `mc_install_datapack` | 内置 item-cleaner（定时清理掉落物），自动适配 pack_format / functions 目录 |
| 桌面监控 | `mc_monitor` | 生成始终置顶的浮窗（人数/TPS/MSPT/延迟/曲线/玩家），支持保活计划任务 |
| 部署脚本包 | `mc_deploy` | 生成 RCON 初始化 + OpenSSH 安装 + 防火墙 + 自动堆内存 + 启动脚本 + 坑位手册 |
| 知识库 | `mc_pitfalls` | 12 条实战坑与解法，支持关键词检索 |

---

## 安装

```bash
# 从 npm（发布后）
dsh plugin --profile desktop add dsh-plugin-mc-server-ops

# 从本地目录（开发）
dsh plugin --profile desktop add ./mc-server-ops
```

或者手动：在 `~/.dsh/profiles/desktop/package.json` 里加依赖，再在 `cordis.patch.yml` 注册 bundle，然后 `pnpm install`。

---

## 配置

在 DSH 设置页的插件配置里填（也可以直接写 `cordis.patch.yml`）：

```yaml
- id: mc-server-ops
  name: dsh-plugin-mc-server-ops
  config:
    defaultServer: main
    timeoutMs: 15000
    servers:
      main:
        label: 我的服务器
        host: play.example.com
        rconPort: 25575          # RCON 端口，不是游戏端口！
        rconPass: "your-rcon-pass"
        serverDir: D:\mcpack     # 服务端目录（SSH 用）
        javaMemMaxGB: 12         # 用来判断堆内存是否吃满
        startTask: MinecraftServer   # 计划任务名（重启用）
        startBat: D:\mcpack\start-server.bat
        ssh:
          host: play.example.com
          port: 22
          user: Administrator
          password: "your-ssh-pass"
          # hostKey: "ssh-ed25519 255 SHA256:..."   # 首次会自动抓取
```

> **只有 RCON 也能用 6 个工具**（status / rcon / diagnose / cleanup / announce / pitfalls）。
> 配上 SSH 后解锁 config / log / datapack 部署 / 自动重启 / 系统资源诊断。

---

## 使用示例（对 AI 说）

```
看看服务器卡不卡
→ mc_diagnose

服务器现在几个人
→ mc_status

把掉落的沙砾方块清理一下
→ mc_cleanup target=falling_block

广播一下 21:00 重启
→ mc_announce message="21:00 重启，请及时下线"

把渲染距离改成 6
→ mc_config set=["view-distance=6"]

公告 + 重启服务器
→ mc_restart countdown=30

在我桌面装一个监控浮窗
→ mc_monitor action=install → action=start → action=keepalive

这台 Windows VPS 怎么装
→ mc_deploy （生成脚本包）
```

---

## 桌面监控组件

`mc_monitor` 会生成 4 个文件到指定目录：

```
McServerMonitor.ps1   浮窗（WinForms，无边框/置顶/可拖动/圆角）
mcmon-poll.ps1        采集器（独立进程，每 N 秒写 JSON）
start-monitor.vbs     无黑窗口启动器
mcmon-keepalive.ps1   保活脚本（计划任务每 5 分钟检查）
```

**关键设计**：采集和显示**分离**。

```
服务器 ──RCON──> 采集器进程 ──写──> %TEMP%\mcmon_state.json ──读──> 浮窗
```

所以 RCON 超时（最长 6 秒）也不会让窗口卡死。窗口只做渲染。

**显示内容**：在线人数（大字）、状态灯（流畅/轻微卡顿/严重卡顿/离线）、
TPS 曲线（最近 120 次采样）、TPS / MSPT / 延迟、维度健康度、玩家名列表、更新时间。

**颜色规则**：

| 指标 | 绿 | 黄 | 红 |
|---|---|---|---|
| TPS | ≥19.5 | 17~19.5 | <17 |
| MSPT | ≤15 ms | 15~35 ms | >35 ms |
| RCON 延迟 | ≤120 ms | 120~300 ms | >300 ms |

**保活**：`mc_monitor action=keepalive` 注册计划任务
（登录自启 + 每 5 分钟检查），窗口或采集器没了会自动拉起。

---

## 内置数据包：item-cleaner

定时清理地面掉落物，防止掉落物堆积导致卡顿。

```
每 N 分钟（默认 10）
提前 M 秒（默认 10）广播预警 + 提示音
清理时统计数量并播报「已清理 X 个掉落物」
```

生成的 `.mcfunction` 已经处理好这些坑：

- 文件 **UTF-8 无 BOM**（BOM 会让第一行命令报错）
- 伪玩家名用 `icTimer` 而不是 `#timer`（`#` 在 mcfunction 里是注释符）
- `pack_format` 按版本填（1.20.1 = 15，1.21.1 = 48）
- 1.21+ 自动把 `functions/` 改成 `function/`

部署到远端（需要 SSH）：

```
mc_install_datapack pack=item-cleaner intervalMinutes=10 deploy=true reload=true
```

---

## 知识库（mc_pitfalls）

12 条实战坑，每条都带「现象 → 原因 → 解法」：

1. 配置文件带 UTF-8 BOM → `java 找不到主类 锘?-Xms4G`
2. `@e` / `@a` 是全局选择器，`execute in` 不能限定作用范围
3. `.mcfunction` 里 `#` 是注释符 → 伪玩家名不能用 `#timer`
4. RCON 长输出分多包，只读一个会截断
5. SSH 远程启动的服务进程会随会话结束被杀
6. `falling_block` 是隐形卡顿源
7. PowerShell 5.1 的保留变量与别名冲突（`$args`、`rv`、`cd`…）
8. 堆内存给太大 + `AlwaysPreTouch` → Windows 报 1450
9. 通过 SSH 执行 PowerShell 用 `-EncodedCommand` 避开引号地狱
10. plink 首次连接卡在 host key 确认
11. 客户端连不上但进程端口都正常（NAT/映射/防火墙/模组屏蔽握手）
12. 冒烟测试别用「模拟握手」判断端口通不通

查法：`mc_pitfalls topic=falling_block`

---

## 兼容性

| 项目 | 支持 |
|---|---|
| 服务端 | Forge / Fabric / NeoForge / Paper（只要开了 RCON） |
| 版本 | 1.16 ~ 1.21.x（`forge tps` 需要 Forge 系；Paper 用 `tps`） |
| 宿主机 | Windows（RCON 全功能）；SSH 在 Windows 用 plink，Linux/macOS 用系统 ssh |
| 桌面监控 | 仅 Windows（WinForms） |

---

## 安全提示

- RCON 密码会出现在插件配置里，请用独立强密码，别复用面板/账号密码
- SSH 默认用密码认证；生产建议改成密钥
- `mc_restart` 会**真的停服**，调用前确认已经公告
- `mc_cleanup` 是**不可逆删除**实体，`falling_block` 之外的实体请谨慎

---

## License

MIT
