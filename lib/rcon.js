/**
 * Minecraft RCON 客户端（纯 Node，零依赖）
 *
 * 特性：
 *  - 支持长输出（自动读取多个响应包，直到空闲超时）
 *  - 多次命令复用同一连接
 *  - 完整错误分类（连接超时 / 密码错 / 无响应）
 *
 * 协议参考：https://wiki.vg/RCON
 */
import net from "node:net";

const TYPE = {
  RESPONSE: 0,
  COMMAND: 2,
  AUTH: 3,
};

const ERR = {
  CONNECT_TIMEOUT: "RCON_CONNECT_TIMEOUT",
  AUTH_FAILED: "RCON_AUTH_FAILED",
  NO_RESPONSE: "RCON_NO_RESPONSE",
  CLOSED: "RCON_CLOSED",
};

export class RconError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RconError";
    this.code = code;
  }
}

/** 编码一个 RCON 包 */
function encodePacket(id, type, body) {
  const bodyBuf = Buffer.from(body, "utf8");
  const len = 4 + 4 + bodyBuf.length + 2;
  const buf = Buffer.alloc(4 + len);
  buf.writeInt32LE(len, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  buf.writeUInt8(0, 12 + bodyBuf.length);
  buf.writeUInt8(0, 13 + bodyBuf.length);
  return buf;
}

/**
 * 一个可复用的 RCON 连接
 */
export class RconConnection {
  /**
   * @param {object} opts
   * @param {string} opts.host
   * @param {number} [opts.port]
   * @param {string} opts.password
   * @param {number} [opts.timeoutMs]   单次操作超时
   * @param {number} [opts.idleMs]      多包读取的空闲判定窗口
   */
  constructor(opts) {
    this.host = opts.host;
    this.port = opts.port ?? 25575;
    this.password = opts.password;
    this.timeoutMs = opts.timeoutMs ?? 15000;
    this.idleMs = opts.idleMs ?? 1200;
    this.socket = null;
    this._nextId = 2;
    this._pending = null;
    this._buffer = Buffer.alloc(0);
    this._authPromise = null;
  }

  /** 建立连接 + 认证（幂等） */
  async connect() {
    if (this._authPromise) return this._authPromise;
    this._authPromise = (async () => {
      await this._open();
      const res = await this._send(TYPE.AUTH, this.password, 1);
      if (res === null) throw new RconError(ERR.NO_RESPONSE, "RCON 认证无响应");
      if (res.id === -1) throw new RconError(ERR.AUTH_FAILED, "RCON 密码错误");
    })();
    try {
      await this._authPromise;
    } catch (e) {
      this._authPromise = null;
      this.close();
      throw e;
    }
    return this;
  }

  _open() {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new RconError(ERR.CONNECT_TIMEOUT, `连接 ${this.host}:${this.port} 超时（${this.timeoutMs}ms）`));
      }, this.timeoutMs);

      sock.once("connect", () => {
        clearTimeout(timer);
        this.socket = sock;
        this._attach();
        resolve();
      });
      sock.once("error", (err) => {
        clearTimeout(timer);
        reject(new RconError(ERR.CLOSED, `RCON 连接失败：${err.message}`));
      });
    });
  }

  _attach() {
    const sock = this.socket;
    sock.setTimeout(this.timeoutMs);
    sock.on("data", (chunk) => this._onData(chunk));
    sock.on("timeout", () => {
      if (this._pending) {
        const p = this._pending;
        this._pending = null;
        p.reject(new RconError(ERR.NO_RESPONSE, "RCON 读取超时"));
      }
    });
    sock.on("error", () => {});
    sock.on("close", () => {
      if (this._pending) {
        const p = this._pending;
        this._pending = null;
        p.reject(new RconError(ERR.CLOSED, "RCON 连接被关闭"));
      }
    });
  }

  _onData(chunk) {
    this._buffer = Buffer.concat([this._buffer, chunk]);
    while (this._buffer.length >= 4) {
      const len = this._buffer.readInt32LE(0);
      if (len < 10 || len > 1_000_000) {
        // 脏数据，丢弃
        this._buffer = Buffer.alloc(0);
        return;
      }
      if (this._buffer.length < 4 + len) return;
      const id = this._buffer.readInt32LE(4);
      const body = this._buffer.subarray(12, 4 + len - 2).toString("utf8");
      this._buffer = this._buffer.subarray(4 + len);
      const pending = this._pending;
      if (pending) {
        this._pending = null;
        pending.resolve({ id, body });
      }
    }
  }

  _send(type, body, fixedId) {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new RconError(ERR.CLOSED, "RCON 未连接"));
        return;
      }
      const id = fixedId ?? this._nextId++;
      const timer = setTimeout(() => {
        if (this._pending) {
          this._pending = null;
          reject(new RconError(ERR.NO_RESPONSE, "RCON 响应超时"));
        }
      }, this.timeoutMs);

      this._pending = {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      this.socket.write(encodePacket(id, type, body));
    });
  }

  /**
   * 执行一条命令，返回完整文本（含多包拼接）
   * @param {string} command
   * @returns {Promise<string>}
   */
  async exec(command) {
    await this.connect();
    const first = await this._send(TYPE.COMMAND, command);
    if (!first) throw new RconError(ERR.NO_RESPONSE, "命令无响应");

    let text = first.body;

    // 长输出会分多个包返回：继续读到空闲为止
    while (true) {
      const more = await this._readIdle();
      if (more === null) break;
      text += "\n" + more.body;
    }
    return text;
  }

  /** 尝试在 idleMs 内再读一个包 */
  _readIdle() {
    return new Promise((resolve) => {
      if (!this.socket || this.socket.destroyed) {
        resolve(null);
        return;
      }
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this._pending = null;
        resolve(v);
      };
      const timer = setTimeout(() => finish(null), this.idleMs);

      this._pending = {
        resolve: (v) => finish(v),
        reject: () => finish(null),
      };

      // 如果缓冲区里已经有完整包，_onData 会立刻消费它
      if (this._buffer.length >= 4) {
        const len = this._buffer.readInt32LE(0);
        if (this._buffer.length >= 4 + len) {
          this._onData(Buffer.alloc(0));
        }
      }
    });
  }

  /** 复用连接执行多条命令 */
  async execMany(commands) {
    const out = [];
    for (const cmd of commands) {
      out.push({ command: cmd, output: await this.exec(cmd) });
    }
    return out;
  }

  close() {
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {}
      this.socket = null;
    }
    this._authPromise = null;
    this._pending = null;
    this._buffer = Buffer.alloc(0);
  }
}

/**
 * 一次性执行（便捷函数，内部自动关闭连接）
 * @param {object} opts - 同 RconConnection
 * @param {string|string[]} commands
 */
export async function rconOnce(opts, commands) {
  const conn = new RconConnection(opts);
  try {
    await conn.connect();
    const list = Array.isArray(commands) ? commands : [commands];
    const results = [];
    for (const cmd of list) {
      results.push({ command: cmd, output: await conn.exec(cmd) });
    }
    return results;
  } finally {
    conn.close();
  }
}

/** 测试连通性（不执行任何命令） */
export async function rconPing(opts) {
  const started = Date.now();
  const conn = new RconConnection(opts);
  try {
    await conn.connect();
    return { ok: true, latencyMs: Date.now() - started };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - started, error: e.message, code: e.code };
  } finally {
    conn.close();
  }
}

export { ERR as RCON_ERRORS };
