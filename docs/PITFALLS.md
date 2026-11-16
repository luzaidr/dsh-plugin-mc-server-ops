# Minecraft 服务器运维踩坑手册

这 12 条都是从**真实运维现场**踩出来的。每一条都写成「现象 → 原因 → 解法」，
可以直接对照排查。

---

## 1. 配置文件带 UTF-8 BOM → java 报「找不到主类 锘?-Xms4G」

**现象**

```
错误: 找不到或无法加载主类 锘?-Xms4G
原因: java.lang.ClassNotFoundException: 锘?-Xms4G
```

**原因**

PowerShell 5.1 的 `Set-Content -Encoding UTF8` **会写入 BOM**（`EF BB BF`）。
java 读 `user_jvm_args.txt` 时把 BOM 当成第一个参数的一部分，
于是 `-Xms4G` 变成了 `锘?-Xms4G`，被当成主类名。

**解法**

```powershell
# ❌ 会加 BOM
$lines | Set-Content $path -Encoding UTF8

# ✅ 无 BOM
[System.IO.File]::WriteAllLines($path, $lines, (New-Object System.Text.UTF8Encoding($false)))
```

**校验**

```powershell
$b = [System.IO.File]::ReadAllBytes($path)
Write-Host (($b[0..2] | ForEach-Object { $_.ToString('X2') }) -join ' ')
# 应该是 2D 58 6D ...（'-Xm'），不能是 EF BB BF
```

> 同样的坑也适用于 `server.properties`、`.mcfunction`、`.json`。

---

## 2. `@e` / `@a` 是全局选择器，`execute in` 不能限定作用范围

**现象**

```mcfunction
execute in minecraft:overworld run kill @e[type=minecraft:item]
```

本想只清主世界的掉落物，结果**下界、末地、所有模组维度的掉落物全没了**。

**原因**

`execute in <dimension>` 只改变**执行位置/维度的上下文**，
**不会**把实体选择器的作用范围限制在那个维度。`@e` 默认就是「所有已加载实体」。

**解法**

```mcfunction
# 方案 A：加坐标+距离约束
execute in minecraft:overworld positioned 0 64 0 run kill @e[type=minecraft:item,distance=..100000]

# 方案 B：用 tag 先标记，再按 tag 处理
tag @e[type=minecraft:item] add to_purge
kill @e[tag=to_purge]

# 方案 C：干脆全局清理（很多场景这就是想要的）
kill @e[type=minecraft:item]
```

> 这个坑也适用于 `gamerule`——`gamerule` 是**全局**的，不分维度。

---

## 3. `.mcfunction` 里 `#` 是注释符 → 伪玩家名不能用 `#timer`

**现象**

```mcfunction
scoreboard players add #timer ic_timer 1
```

计时器永远不动，但**没有任何报错**。

**原因**

数据包函数里，以 `#` 开头的整行会被当作**注释**丢弃。
所以 `scoreboard players add #timer ...` 这行**根本没执行**。

**解法**

```mcfunction
# 伪玩家名不要用 # 开头
scoreboard players add icTimer ic_timer 1
```

同理，`#` 也不能用来做「命名空间」风格的前缀。

---

## 4. RCON 长输出分多包，只读一个会截断

**现象**

通过程序执行 `forge entity list` 或 `forge tps` 时，
要么拿到空字符串，要么拿到半截数据（行数明显不对）。

**原因**

Minecraft 的 RCON 协议里，服务端会把长响应拆成**多个响应包**陆续发送。
只读第一个包就会截断。

**解法**

读完第一个包后，**继续读到连接空闲为止**（设一个 0.5~1.5 秒的 idle 超时）：

```js
let text = firstPacket.body;
while (true) {
  const more = await readWithIdleTimeout(1200);
  if (!more) break;
  text += "\n" + more.body;
}
```

本插件的 `lib/rcon.js` 已内置这个逻辑（`_readIdle`）。

---

## 5. SSH 远程启动的服务进程会随会话结束被杀

**现象**

通过 SSH 执行启动命令，服务器起来了；
但 SSH 会话一断，java 进程**跟着消失**。日志里也没有停服记录。

**原因**

SSH 会话是一个进程组/作业对象，会话结束时子进程被连带清理。
（Windows OpenSSH 和 Linux 都有这个行为）

**解法**

用**计划任务**启动，让它脱离 SSH 会话：

```powershell
# 创建一次性/开机任务
schtasks /create /tn "MinecraftServer" /tr "cmd.exe /c D:\mcpack\start-server.bat" /sc onstart /ru SYSTEM /rl highest /f

# 触发
schtasks /run /tn "MinecraftServer"
```

或者用 `Start-Process -WindowStyle Hidden` 配合计划任务。
**不要**用 `Start-Process cmd.exe /c start ...`（父进程一断就没了）。

---

## 6. `falling_block` 是隐形卡顿源

**现象**

- TPS 从 20 掉到 19 甚至 14
- MSPT 从 8ms 飙到 50ms+
- 玩家「看起来没看到什么异常」
- 日志大量 `Can't keep up! Running xxxx ms or xxx ticks behind`

**原因**

沙砾/沙子塌方会在同一个坐标堆积**几十上百个** `minecraft:falling_block` 实体。
每个实体每 tick 都要做：
1. 重力计算
2. 与周围方块的碰撞检测
3. 落地判定

50 个就是 50 倍的物理开销，直接吃掉 MSPT 的一大半。

**排查**

```bash
forge entity list        # 看 minecraft:falling_block 的数量
```

正常应该 0~5 个。超过 10 个就异常，超过 30 个基本就是卡顿主因。

**清理**

```mcfunction
kill @e[type=minecraft:falling_block]
```

⚠️ **不要**加 `execute in <维度>`——**@e 是全局的**，加了也不会限定范围（见第 2 条）。

**定位源头**

```mcfunction
execute as @e[type=minecraft:falling_block,limit=1] run data get entity @s Pos
```

拿到坐标后去看那片区域，通常是：玩家挖了沙砾/沙子，上方悬空的部分持续塌方。

**根治**：把塌方区域填实，或让玩家填掉。

---

## 7. PowerShell 5.1 的保留变量与别名冲突

**现象**

- 函数参数莫名收不到值
- 自定义函数调用报「找不到接受实际参数的位置形式参数」
- 脚本行为诡异但语法检查通过

**原因**

| 名字 | 是什么 |
|---|---|
| `$args` | 自动变量（函数参数数组），**不能做参数名** |
| `rv` | `Remove-Variable` 的别名 |
| `cd` / `ls` / `rm` / `cat` | 内置别名 |
| `$PID` | 当前进程 ID（只读） |
| `$input` | 管道输入枚举器 |

另外，`Select-Object` **没有** `-join` 参数（`-join` 是运算符）：

```powershell
# ❌ 报错
$found | Select-Object -First 3 -join ", "

# ✅ 正确
($found | Select-Object -First 3) -join ", "
```

**解法**

- 自定义函数名加前缀：`ReadVarInt`、`PutVarInt`、`Get-RconPacket`
- 不用 `$args` 做参数名
- 需要 `-join` 时先 `Select-Object` 再括号 `-join`

---

## 8. 堆内存给太大 + `AlwaysPreTouch` → Windows 报 1450

**现象**

```
java.io.IOException: 系统资源不足，无法完成请求的服务
  at sun.nio.ch.FileDispatcherImpl.pwrite0
  at net.minecraft.world.level.chunk.storage.RegionFile
```

服务器运行一段时间后**写区块时崩**。

**原因**

64 GB 物理内存的机器上设 `-Xms32G -Xmx32G -XX:+AlwaysPreTouch`：
JVM 启动时就**强行把 32 GB 全部提交并预触碰**，
加上堆外内存、DirectByteBuffer、模组分配，把 Windows 的提交限额打满，
后续文件写入就失败。

**解法**

```
-Xms 取物理内存的 30~40%
-Xmx 取物理内存的 60~75%
去掉 -XX:+AlwaysPreTouch
```

对 16 GB 机器：`-Xms6G -Xmx12G`。
对 64 GB 机器：`-Xms16G -Xmx22G`（而不是 32G）。

---

## 9. 通过 SSH 执行 PowerShell：用 `-EncodedCommand` 避开引号地狱

**现象**

```
The ampersand (&) character is not allowed.
The term 'y' is not recognized as the name of a cmdlet
```
或者中文全变乱码。

**原因**

`ssh host "powershell -Command \"...\""` 有多层引号解析：
SSH 客户端一层、目标 shell 一层、PowerShell 一层。
嵌套引号、换行、`&`、中文、`$` 全会互相打架。

**解法**

把脚本用 **UTF-16LE** 编码成 base64，用 `-EncodedCommand` 传：

```js
const enc = Buffer.from(script, "utf16le").toString("base64");
// ssh host `powershell -NoProfile -EncodedCommand ${enc}`
```

**零引号问题、零编码问题**。本插件的 `lib/ssh.js` 就是这么做的。

---

## 10. plink 首次连接卡在 host key 确认

**现象**

脚本通过 plink 连新服务器时**永久挂住**，CPU 0%，没有任何输出。

**原因**

plink 第一次连一台新机器会**交互式询问**是否接受 host key。
非交互环境（脚本/CI）里没人回答，就一直等。

**解法**

先用 `-batch` 跑一次，从 stderr 里抓到指纹：

```
The server's ssh-ed25519 key fingerprint is:
ssh-ed25519 255 SHA256:qG3HLdVRL6aaF1BeQMeloQTAdsvisPppiwcuP3g+04M
```

然后用 `-hostkey` 重连：

```bash
plink -batch -ssh -P 22 -l user -pw pass -hostkey "ssh-ed25519 255 SHA256:qG3HL..." host "echo ok"
```

指纹可以缓存进配置，后续不用每次都抓。本插件的 `SshSession.handshake()` 就是这个流程。

---

## 11. 客户端连不上，但服务器进程端口都正常

**排查顺序**

**① 服务器内部自测**

```powershell
Test-NetConnection 127.0.0.1 -Port 25565
```

通则说明服务端没问题，问题在网络/映射。

**② 云厂商 NAT 端口映射**

- 内网端口必须精确（游戏 `25565`，RCON `25575`，SSH `22`，RDP `3389`）
- 协议：Java 版用 **TCP**，RCON 用 **TCP**，基岩版才需要 UDP
- 一个高度可疑的信号：**外网端口能 TCP 连上但不返回任何数据**
  → 通常是这条映射指向了错误的内网端口，或者端口已被其他租户占用

**③ `enable-status`**

只影响**服务器列表里的状态显示**，**不影响玩家进服**。
如果 RCON `list` 显示有玩家在线，说明进服是好的，只是状态查询被挡了。

**④ 模组屏蔽非官方客户端握手**

有些模组（反机器人 / 连接优化类）会拒绝非常规的握手包。
表现为「能连上但无响应」。

---

## 12. 冒烟测试别用「模拟握手」判断端口通不通

**现象**

自己写了个 Minecraft 状态查询/登录握手脚本，测出来「没有响应」，
于是判断「端口不通」——但玩家其实能正常进服。

**原因**

手写握手很容易在这些地方出错：

- 协议号写错（1.20.1 = **763**，1.21.1 = 767）
- **Login Start 的字段结构随版本变化**（1.20.1 有 UUID 16 字节，1.20.2+ 移除了）
- VarInt 编码/解码边界
- 混淆了 `status`（next state 1）和 `login`（next state 2）

**更可靠的验证方式**

1. 让**真人客户端**连一次（最可靠）
2. 用 RCON `list` 看是否真有玩家在线
3. 用 `spark` / `forge tps` 确认服务端在正常 tick

---

## 附：快速诊断清单

卡顿时按这个顺序看：

```
1. forge tps            → MSPT 是否超 50ms？哪个维度？
2. forge entity list    → falling_block 数量？实体总数？Top5？
3. 日志 grep Can't keep up → 频率和最大落后时间
4. java 堆内存 / CPU    → 堆是否接近上限（GC 风暴会导致 CPU 100%）
5. -Xmx 设置            → 16GB 机器必须 ≥12G
```

对应本插件的工具：

```
mc_diagnose        → 一次跑完 1~5
mc_cleanup         → 清理 falling_block / item
mc_config          → 调 view-distance / simulation-distance
mc_restart         → 公告 + 重启（释放堆）
```
