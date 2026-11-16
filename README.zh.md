# Minecraft 服务器运维插件（中文说明）

> [DSH (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) 宿主插件
> 把「一台 Minecraft 服务器从装好到长期稳定运行」的全套动作，变成 AI 可直接调用的 12 个工具。

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

## 12 个工具

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
| `mc_pitfalls` | 运维知识库（12 条坑） | 无 |

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
