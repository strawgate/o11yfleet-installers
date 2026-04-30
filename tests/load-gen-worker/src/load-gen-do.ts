// LoadGenDO — Durable Object that manages a shard of outbound WebSocket connections
//
// Each instance holds up to ~5,000 connections to the target o11yfleet worker.
// Connections use the OpAMP enrollment protocol matching FakeOpampAgent.

// ─── OpAMP Frame Encoding (inlined from @o11yfleet/core/codec/framing) ──────

const HEADER_SIZE = 4;
const TEXT_ENCODER = new TextEncoder();

function encodeFrame(msg: Record<string, unknown>): ArrayBuffer {
  const json = JSON.stringify(msg, (_key, value) => {
    if (value instanceof Uint8Array) {
      return { __type: "bytes", data: Array.from(value) };
    }
    if (typeof value === "bigint") {
      return { __type: "bigint", value: value.toString() };
    }
    return value;
  });
  const payload = TEXT_ENCODER.encode(json);
  const buf = new ArrayBuffer(HEADER_SIZE + payload.byteLength);
  const view = new DataView(buf);
  view.setUint32(0, payload.byteLength, false);
  new Uint8Array(buf, HEADER_SIZE).set(payload);
  return buf;
}

// AgentCapabilities bit flags
const CAP_REPORTS_STATUS = 0x00000001;
const CAP_ACCEPTS_REMOTE_CONFIG = 0x00000002;
const CAP_REPORTS_HEALTH = 0x00000800;
const CAP_REPORTS_REMOTE_CONFIG = 0x00001000;
const HELLO_CAPABILITIES =
  CAP_REPORTS_STATUS | CAP_ACCEPTS_REMOTE_CONFIG | CAP_REPORTS_HEALTH | CAP_REPORTS_REMOTE_CONFIG;

// ─── Per-connection state (minimal for memory) ──────────────────────────────

interface ConnState {
  ws: WebSocket | null;
  enrolled: boolean;
}

// ─── LoadGenDO ──────────────────────────────────────────────────────────────

interface ShardConfig {
  shard: number;
  target: string;
  token: string;
  count: number;
}

export class LoadGenDO {
  private connections: ConnState[] = [];
  private config: ShardConfig | null = null;
  private dropped = 0;
  private closeCodes: Record<number, number> = {};
  private errors: string[] = [];
  private rampComplete = false;
  private fetchAttempts = 0;
  private fetchSuccess = 0;
  private ctx: DurableObjectState;

  constructor(ctx: DurableObjectState, _env: Record<string, unknown>) {
    this.ctx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/start" && request.method === "POST") {
      return this.handleStart(request);
    }
    if (url.pathname === "/status") {
      return this.handleStatus();
    }
    if (url.pathname === "/stop" && request.method === "POST") {
      return this.handleStop();
    }

    return new Response("LoadGenDO", { status: 200 });
  }

  private async handleStart(request: Request): Promise<Response> {
    this.closeAll();

    const config = (await request.json()) as ShardConfig;
    this.config = config;
    this.dropped = 0;
    this.closeCodes = {};
    this.errors = [];
    this.rampComplete = false;
    this.fetchAttempts = 0;
    this.fetchSuccess = 0;

    // CF Workers fetch() uses https:// with Upgrade header (not wss://).
    const targetUrl = new URL(config.target);
    const wsUrl = `${targetUrl.protocol}//${targetUrl.host}/v1/opamp?token=${encodeURIComponent(config.token)}`;

    // Ramp connections using a concurrency-limited pool.
    // CF Workers allow ~6 concurrent outbound connections per host.
    const rampPromise = this.rampWithConcurrency(wsUrl, config.count, 6);
    this.ctx.waitUntil(rampPromise);

    return Response.json({ ok: true, shard: config.shard, target_count: config.count });
  }

  /** Open `total` connections with at most `concurrency` in flight at once. */
  private async rampWithConcurrency(
    wsUrl: string,
    total: number,
    concurrency: number,
  ): Promise<void> {
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < total) {
        const idx = nextIndex++;
        await this.openConnection(wsUrl, idx);
      }
    };

    await Promise.allSettled(Array.from({ length: concurrency }, () => worker()));
    this.rampComplete = true;
  }

  private async openConnection(wsUrl: string, index: number): Promise<void> {
    this.fetchAttempts++;
    try {
      const resp = await fetch(wsUrl, {
        headers: { Upgrade: "websocket" },
      });

      const ws = resp.webSocket;
      if (!ws) {
        this.dropped++;
        if (this.errors.length < 20) {
          const body = await resp.text().catch(() => "");
          this.errors.push(
            `open[${index}]: no ws, status=${resp.status}, body=${body.slice(0, 100)}`,
          );
        }
        return;
      }

      ws.accept();
      this.fetchSuccess++;

      const conn: ConnState = { ws, enrolled: false };
      const connIndex = this.connections.length;
      this.connections.push(conn);

      ws.addEventListener("message", (event) => {
        this.handleMessage(conn, event);
      });

      ws.addEventListener("close", (event) => {
        this.handleClose(connIndex, event.code);
      });

      ws.addEventListener("error", () => {
        this.handleClose(connIndex, 1006);
      });

      // OpAMP: client sends first
      this.sendHello(conn, index);
    } catch (e) {
      this.dropped++;
      if (this.errors.length < 20) {
        this.errors.push(`open[${index}]: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  private sendHello(conn: ConnState, index: number): void {
    const instanceUid = new Uint8Array(16);
    crypto.getRandomValues(instanceUid);
    const nowNano = BigInt(Date.now()) * 1000000n;

    const msg = {
      instance_uid: instanceUid,
      sequence_num: 0,
      capabilities: HELLO_CAPABILITIES,
      flags: 0,
      health: {
        healthy: true,
        start_time_unix_nano: nowNano,
        last_error: "",
        status: "running",
        status_time_unix_nano: nowNano,
        component_health_map: {},
      },
      agent_description: {
        identifying_attributes: [
          { key: "service.name", value: { string_value: `loadgen-agent-${index}` } },
        ],
        non_identifying_attributes: [{ key: "os.type", value: { string_value: "loadgen" } }],
      },
    };

    try {
      conn.ws!.send(encodeFrame(msg));
    } catch {
      // Connection may have already closed
    }
  }

  private handleMessage(conn: ConnState, event: MessageEvent): void {
    if (typeof event.data !== "string") {
      // Binary frames: OpAMP protocol — consume silently
      return;
    }
    if (event.data === "pong") return;
    if (event.data.includes("enrollment_complete")) {
      conn.enrolled = true;
    }
  }

  private handleClose(connIndex: number, code: number): void {
    this.dropped++;
    this.closeCodes[code] = (this.closeCodes[code] ?? 0) + 1;
    const conn = this.connections[connIndex];
    if (conn) conn.ws = null;
  }

  private handleStatus(): Response {
    let connected = 0;
    let enrolled = 0;

    for (const conn of this.connections) {
      // Use readyState === 1 (OPEN) — numeric to avoid WebSocket.OPEN compat issues
      if (conn.ws && conn.ws.readyState === 1) {
        connected++;
        if (conn.enrolled) enrolled++;
      }
    }

    return Response.json({
      shard: this.config?.shard ?? -1,
      target_count: this.config?.count ?? 0,
      connected,
      enrolled,
      dropped: this.dropped,
      close_codes: this.closeCodes,
      errors: this.errors.slice(0, 10),
      ramp_complete: this.rampComplete,
      fetch_attempts: this.fetchAttempts,
      fetch_success: this.fetchSuccess,
      connections_len: this.connections.length,
    });
  }

  private handleStop(): Response {
    const stats = JSON.parse(JSON.stringify(this.buildStats()));
    this.closeAll();
    return Response.json(stats);
  }

  private buildStats(): Record<string, unknown> {
    let connected = 0;
    let enrolled = 0;

    for (const conn of this.connections) {
      if (conn.ws && conn.ws.readyState === 1) {
        connected++;
        if (conn.enrolled) enrolled++;
      }
    }

    return {
      shard: this.config?.shard ?? -1,
      target_count: this.config?.count ?? 0,
      connected,
      enrolled,
      dropped: this.dropped,
      close_codes: this.closeCodes,
      errors: this.errors.slice(0, 10),
      ramp_complete: this.rampComplete,
      fetch_attempts: this.fetchAttempts,
      fetch_success: this.fetchSuccess,
      connections_len: this.connections.length,
    };
  }

  private closeAll(): void {
    for (const conn of this.connections) {
      try {
        if (conn.ws && conn.ws.readyState === 1) {
          conn.ws.close(1000, "load test stopped");
        }
      } catch {
        // Already closed
      }
    }

    this.connections = [];
    this.config = null;
  }
}
