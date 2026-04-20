import { createConnection, type Socket } from "node:net";

// ── RCON packet types ─────────────────────────────────────────────────────────
const TYPE_AUTH    = 3;
const TYPE_COMMAND = 2;

// ── Packet encoding / decoding ────────────────────────────────────────────────

/**
 * Build a raw RCON packet buffer.
 *
 * Wire format (all little-endian):
 *   [4] size  = 4 (id) + 4 (type) + payload.length + 2 (null terminators)
 *   [4] id
 *   [4] type
 *   [N] payload  (UTF-8)
 *   [1] 0x00  (null terminator)
 *   [1] 0x00  (padding)
 */
function encodePacket(id: number, type: number, body: string): Buffer {
  const payload = Buffer.from(body, "utf8");
  const size    = payload.length + 10; // 4+4+payload+2
  const buf     = Buffer.allocUnsafe(size + 4); // +4 for the size field itself

  buf.writeInt32LE(size,    0);
  buf.writeInt32LE(id,      4);
  buf.writeInt32LE(type,    8);
  payload.copy(buf,         12);
  buf.writeUInt8(0, 12 + payload.length);
  buf.writeUInt8(0, 13 + payload.length);

  return buf;
}

type DecodedPacket = { consumed: number; id: number; type: number; payload: string };

/**
 * Try to read one packet from the front of `buf`.
 * Returns null when there is not enough data yet.
 */
function decodePacket(buf: Buffer): DecodedPacket | null {
  if (buf.length < 14) return null;          // 4 (size) + 4 (id) + 4 (type) + 2 (nulls)

  const size = buf.readInt32LE(0);
  if (size < 10) return null;                // malformed
  if (buf.length < size + 4) return null;   // incomplete

  const id      = buf.readInt32LE(4);
  const type    = buf.readInt32LE(8);
  // payload sits between byte 12 and the two trailing null bytes
  const payload = buf.toString("utf8", 12, 4 + size - 2);

  return { consumed: size + 4, id, type, payload };
}

// ── Pending request bookkeeping ───────────────────────────────────────────────

type Resolver = { resolve: (s: string) => void; reject: (e: Error) => void };

// ── RconClient ────────────────────────────────────────────────────────────────

export class RconClient {
  private socket:  Socket | null = null;
  private buf:     Buffer = Buffer.alloc(0);
  private nextId:  number = 1;
  private pending: Map<number, Resolver> = new Map();

  // Auth state — resolved / rejected by the first packet we receive.
  private authResolve?: () => void;
  private authReject?:  (e: Error) => void;
  private authing = false;

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Open a TCP connection to the RCON server and authenticate.
   * Rejects if the password is wrong or the connection times out.
   */
  connect(host: string, port: number, password: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.authResolve = resolve;
      this.authReject  = reject;
      this.authing     = true;

      const socket = createConnection({ host, port });
      this.socket  = socket;

      socket.setTimeout(10_000, () => {
        socket.destroy(new Error(`RCON connection to ${host}:${port} timed out`));
      });

      socket.on("connect", () => {
        // Auth packet always uses id=0
        socket.write(encodePacket(0, TYPE_AUTH, password));
      });

      socket.on("data", (chunk: Buffer) => {
        this.buf = Buffer.concat([this.buf, chunk]);
        this.flush();
      });

      socket.on("error", (err) => {
        this.handleError(err);
      });

      socket.on("close", () => {
        this.handleError(new Error("RCON socket closed unexpectedly"));
      });
    });
  }

  /**
   * Send a command and return the server's response text.
   * Rejects after `timeoutMs` if no response is received.
   */
  send(command: string, timeoutMs = 10_000): Promise<string> {
    if (!this.socket || this.authing) {
      return Promise.reject(new Error("RCON not connected"));
    }

    const id = this.nextId++;

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RCON timeout waiting for response to: ${command}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (s) => { clearTimeout(timer); resolve(s); },
        reject:  (e) => { clearTimeout(timer); reject(e);  },
      });

      this.socket!.write(encodePacket(id, TYPE_COMMAND, command));
    });
  }

  /** Tear down the connection. Safe to call multiple times. */
  destroy(): void {
    this.socket?.destroy();
    this.socket = null;
    // Reject any requests still in flight
    for (const { reject } of this.pending.values()) {
      reject(new Error("RCON connection destroyed"));
    }
    this.pending.clear();
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private flush(): void {
    let packet: DecodedPacket | null;

    while ((packet = decodePacket(this.buf)) !== null) {
      this.buf = this.buf.subarray(packet.consumed);

      if (this.authing) {
        // The very first packet is the auth response.
        this.authing = false;
        if (packet.id === -1) {
          // id=-1 means authentication failed
          this.authReject?.(new Error("RCON authentication failed: wrong password"));
        } else {
          this.authResolve?.();
        }
        continue;
      }

      // Regular command response — route to the matching pending resolver.
      const resolver = this.pending.get(packet.id);
      if (resolver) {
        this.pending.delete(packet.id);
        resolver.resolve(packet.payload);
      }
    }
  }

  private handleError(err: Error): void {
    if (this.authing) {
      this.authing = false;
      this.authReject?.(err);
    }
    for (const { reject } of this.pending.values()) {
      reject(err);
    }
    this.pending.clear();
  }
}

// ── Convenience wrapper ───────────────────────────────────────────────────────

/**
 * Connect, run `fn`, then disconnect — even if `fn` throws.
 *
 * @example
 * const response = await withRcon("host", 25575, "secret", (r) => r.send("list"));
 */
export async function withRcon<T>(
  host:     string,
  port:     number,
  password: string,
  fn:       (rcon: RconClient) => Promise<T>,
): Promise<T> {
  const client = new RconClient();
  await client.connect(host, port, password);
  try {
    return await fn(client);
  } finally {
    client.destroy();
  }
}
