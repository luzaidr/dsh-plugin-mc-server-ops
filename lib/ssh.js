/**
 * 跨平台远程命令执行（SSH）
 *
 * Windows: 用 PuTTY 的 plink.exe（支持 -pw 密码 / -hostkey 免交互）
 * Linux/macOS: 用系统 ssh（需要已配置密钥或 sshpass）
 *
 * 设计要点：
 *  - 首次连接自动抓取 host key 指纹，之后缓存复用（避免交互卡死）
 *  - 所有命令通过 `powershell -EncodedCommand` 发送（Windows），
 *    彻底规避引号 / 换行 / 中文编码问题
 */
import { spawn } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const isWin = os.platform() === "win32";

export class SshError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SshError";
    this.code = code;
  }
}

/** 找 plink.exe */
export function findPlink() {
  const candidates = [
    process.env.PLINK_PATH,
    path.join(process.env.LOCALAPPDATA ?? "", "Temp", "mctools", "plink.exe"),
    "C:\\Program Files\\PuTTY\\plink.exe",
    "C:\\Program Files (x86)\\PuTTY\\plink.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

/** 执行一个外部程序，收集 stdout+stderr */
function run(exe, args, { timeoutMs = 60000, input } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(exe, args, { windowsHide: true });
    } catch (e) {
      resolve({ code: -1, stdout: "", stderr: String(e?.message ?? e) });
      return;
    }
    let stdout = "";
    let stderr = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        child.kill();
      } catch {}
      resolve({ code: -2, stdout, stderr: stderr + "\n[TIMEOUT]" });
    }, timeoutMs);

    child.stdout?.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr?.on("data", (d) => (stderr += d.toString("utf8")));
    child.on("error", (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(e?.message ?? e) });
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });
    if (input !== undefined) {
      try {
        child.stdin?.end(input);
      } catch {}
    }
  });
}

/** 提取 plink 报错里的 host key 指纹 */
function extractFingerprint(text) {
  const m = /(ssh-(?:ed25519|rsa)\s+\d+\s+SHA256:[A-Za-z0-9+/=]+)/.exec(text ?? "");
  return m ? m[1] : null;
}

/**
 * SSH 会话
 */
export class SshSession {
  /**
   * @param {object} cfg
   * @param {string} cfg.host
   * @param {number} [cfg.port]
   * @param {string} cfg.user
   * @param {string} cfg.password
   * @param {string} [cfg.hostKey]   已知指纹（如 `ssh-ed25519 255 SHA256:xxx`）
   * @param {string} [cfg.plinkPath]
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.port = cfg.port ?? 22;
    this.hostKey = cfg.hostKey ?? null;
    this.plink = cfg.plinkPath ?? findPlink();
  }

  get available() {
    return isWin ? Boolean(this.plink) : true;
  }

  describe() {
    return `${this.cfg.user}@${this.cfg.host}:${this.port}`;
  }

  /** 基础参数 */
  _baseArgs(extra = []) {
    const args = [
      "-batch",
      "-ssh",
      "-P",
      String(this.port),
      "-l",
      this.cfg.user,
      "-pw",
      this.cfg.password,
    ];
    if (this.hostKey) args.push("-hostkey", this.hostKey);
    return [...args, ...extra, this.cfg.host];
  }

  /**
   * 建立连接并确认 host key（自动抓取指纹）
   * @returns {Promise<{ok:boolean, hostKey?:string, error?:string}>}
   */
  async handshake() {
    if (!isWin) {
      return { ok: true, hostKey: null };
    }
    if (!this.plink) {
      return { ok: false, error: "找不到 plink.exe。请安装 PuTTY，或在插件配置里填 ssh.plinkPath。" };
    }
    const r = await run(this.plink, this._baseArgs(["echo", "MC_OPS_OK"]), { timeoutMs: 30000 });
    if (r.stdout.includes("MC_OPS_OK")) return { ok: true, hostKey: this.hostKey };

    const fp = extractFingerprint(r.stderr + r.stdout);
    if (!fp) {
      return { ok: false, error: (r.stderr || r.stdout || "SSH 握手失败").trim().slice(0, 500) };
    }
    this.hostKey = fp;
    const r2 = await run(this.plink, this._baseArgs(["echo", "MC_OPS_OK"]), { timeoutMs: 30000 });
    if (r2.stdout.includes("MC_OPS_OK")) return { ok: true, hostKey: fp };
    return { ok: false, error: (r2.stderr || r2.stdout || "SSH 握手失败（指纹已缓存但连接仍失败）").trim().slice(0, 500) };
  }

  /**
   * 执行 PowerShell 脚本（Windows 目标机）
   * 用 -EncodedCommand 传输，规避所有引号/编码问题
   * @param {string} script
   * @returns {Promise<{ok:boolean, stdout:string, stderr:string, code:number}>}
   */
  async powershell(script) {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
    return this.raw(psCmd);
  }

  /**
   * 执行任意远程命令行（目标机默认 shell）
   * @param {string} commandLine
   */
  async raw(commandLine, { timeoutMs = 120000 } = {}) {
    if (!isWin) {
      const r = await run("ssh", ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-p", String(this.port), `${this.cfg.user}@${this.cfg.host}`, commandLine], { timeoutMs });
      return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr, code: r.code };
    }
    if (!this.plink) {
      throw new SshError("NO_PLINK", "找不到 plink.exe");
    }
    if (!this.hostKey) {
      const hs = await this.handshake();
      if (!hs.ok) throw new SshError("HANDSHAKE_FAILED", hs.error ?? "SSH 握手失败");
    }
    const r = await run(this.plink, this._baseArgs([commandLine]), { timeoutMs });
    return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr, code: r.code };
  }
}

/** 清理 PowerShell 输出里的噪音行 */
export function cleanOutput(lines) {
  return (Array.isArray(lines) ? lines : String(lines).split(/\r?\n/))
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !/^plink\.exe\s*:/.test(l) &&
        !/^所在位置/.test(l) &&
        !/^\+ /.test(l) &&
        !/^    \+/.test(l) &&
        !/CategoryInfo|FullyQualifiedErrorId|^At line/.test(l),
    );
}
