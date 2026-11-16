# Changelog

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
