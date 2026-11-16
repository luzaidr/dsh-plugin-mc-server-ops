# 上传到插件市场

这个包已经可以直接发布。下面是常见市场的上传要点。

---

## 包结构

```
dsh-plugin-mc-server-ops/
├── package.json          ← 必需：name / version / description / main / license / keywords
├── README.md             ← 必需：市场展示页正文
├── README.zh.md          ← 中文说明
├── LICENSE               ← MIT
├── CHANGELOG.md
├── .gitignore
├── lib/                  ← 插件代码（ESM，无需构建）
│   ├── index.js          ← 入口，导出 name / Config / inject / apply
│   ├── rcon.js           ← RCON 客户端
│   ├── ssh.js            ← SSH 执行层
│   ├── diagnose.js       ← 诊断引擎
│   ├── datapacks.js      ← 数据包生成
│   └── monitor.js        ← 桌面监控部署
├── assets/               ← 运行时资产
│   ├── McServerMonitor.ps1
│   ├── mcmon-poll.ps1
│   ├── start-monitor.vbs
│   ├── mcmon-keepalive.ps1
│   └── datapacks/item-cleaner/
├── docs/PITFALLS.md      ← 运维踩坑手册
└── test/smoke.mjs        ← 冒烟测试
```

**无需构建**：`lib/*.js` 就是最终产物（纯 ESM），没有 TS、没有打包步骤。

---

## 上传前需要改的 3 个地方

### 1. `package.json` 里的占位信息

```json
"homepage": "https://github.com/your-name/dsh-plugin-mc-server-ops",   ← 改成你的仓库
"repository": { "url": "git+https://github.com/your-name/..." },
"bugs": { "url": "https://github.com/your-name/.../issues" },
"author": "your-name"                                                  ← 改成你的名字
```

### 2. 可选：改成带 scope 的包名

如果市场要求 scoped 包：

```json
"name": "@your-scope/dsh-plugin-mc-server-ops"
```

同时更新 README 里的安装命令。

### 3. 可选：加预览图

市场一般会取 `README.md` 里的第一张图做封面。建议加一个 `preview.png`（浮窗截图）并：

```json
"files": [ "preview.png", ... ]
```

---

## 发布到 npm（推荐路径）

DSH 的插件加载走 npm 包，所以**发到 npm 是最标准的方式**：

```bash
cd mc-server-ops

# 1. 登录（首次）
npm login

# 2. 干跑一遍看看会打包哪些文件
npm pack --dry-run

# 3. 正式的
npm publish --access public
```

> 包名如果被占用，改成 `@your-scope/dsh-plugin-mc-server-ops`。

**发布后用户可以这样安装**：

```bash
dsh plugin --profile desktop add dsh-plugin-mc-server-ops
```

---

## 发布到 SkillHub / 其他插件目录

以 [SkillHub](https://www.skillhub.cn/) 为例，通常需要：

1. **仓库地址**（GitHub / Gitee）
2. **包名 + 版本**
3. **分类**：工作流
4. **一句话简介**（≤80 字）：
   > Minecraft 服务器部署与运维工具箱：RCON 管理、卡顿诊断、公告重启、数据包安装、桌面监控浮窗。
5. **详细描述**：直接贴 `README.md`
6. **标签**：`minecraft` `rcon` `server-ops` `monitoring` `devops` `forge` `fabric`
7. **许可证**：MIT
8. **截图**（可选但强烈建议）

**本包已内置** 市场会读的元数据：

```json
"dsh": {
  "category": "工作流",
  "hostOnly": true,
  "icon": "🎮",
  "displayName": "Minecraft 服务器运维",
  "displayNameEn": "Minecraft Server Ops"
}
```

---

## 本地安装测试（不发布也能用）

```bash
# 方法 A：直接从目录装
dsh plugin --profile desktop add /path/to/mc-server-ops

# 方法 B：手工注册
# 1) 在 ~/.dsh/profiles/desktop/package.json 的 dependencies 里加：
#      "dsh-plugin-mc-server-ops": "file:/path/to/mc-server-ops"
# 2) 在 ~/.dsh/profiles/desktop/cordis.patch.yml 末尾加：
#      - id: mc-server-ops
#        name: dsh-plugin-mc-server-ops
#        config:
#          defaultServer: main
#          servers:
#            main: { host: play.example.com, rconPort: 25575, rconPass: "xxx" }
# 3) 在 profile 目录执行 pnpm install
# 4) 重启 DSH
```

---

## 装好之后怎么验证

```
1. 打开 DSH 设置 → 插件，确认能看到 "Minecraft 服务器运维"
2. 在对话里让 AI「看看服务器卡不卡」
3. 它应该调用 mc_diagnose 并返回分级诊断
4. 如果报「未找到服务器配置」→ 去插件设置里填 servers
```

---

## 常见问题

**Q：为什么 `package.json` 里的 `files` 没包含 `test/`，但 zip 里还有？**

`files` 是**npm publish** 用的白名单（决定哪些进 tarball）。
zip 是源码快照，会包含测试文件。两个产物用途不同：

| 产物 | 用途 |
|---|---|
| `*.tgz` | `npm publish` / 市场 tarball 上传 |
| `*.zip` | 源码分发 / 人工审阅 |

**Q：peerDependencies 为什么都是 optional？**

因为 `@deepseek-ai/cordis`、`dsh-tools`、`schemastery` 由 DSH 运行时提供，
装到用户机器上时不需要重复安装。标 optional 可以避免 pnpm 警告。

**Q：能在 Linux/macOS 上用吗？**

RCON 相关工具（status / rcon / diagnose / cleanup / announce / pitfalls）**完全可用**。
`mc_config` / `mc_log` / `mc_restart` / `mc_install_datapack` 的远端部分用系统 `ssh`（需要密钥或 sshpass）。
`mc_monitor`（桌面浮窗）和 `mc_deploy`（Windows 脚本包）**仅 Windows**。
