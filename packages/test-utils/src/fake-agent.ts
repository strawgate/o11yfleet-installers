// @o11yfleet/test-utils — Fake OpAMP Agent
//
// A reusable fake OTel Collector that speaks the OpAMP protocol over WebSocket.
// Works in Node.js (v22+ built-in WebSocket) for full-stack E2E tests against
// wrangler dev, and in any browser-like environment.

import {
  encodeFrame,
  decodeFrame,
  type AgentToServer,
  type ServerToAgent,
  AgentCapabilities,
  RemoteConfigStatuses,
} from "@o11yfleet/core/codec";

export interface FakeAgentOptions {
  /** WebSocket endpoint, e.g. "ws://localhost:8787/v1/opamp" */
  endpoint: string;
  /** Enrollment token (fp_enroll_*) for first-time connection */
  enrollmentToken?: string;
  /** Signed assignment claim for reconnection */
  assignmentClaim?: string;
  /** Custom instance UID (16 bytes). Auto-generated if omitted. */
  instanceUid?: Uint8Array;
  /** Agent name for identifying_attributes. Defaults to "fake-agent". */
  name?: string;
  /** Enable auto-heartbeat based on server-directed interval. Defaults to false. */
  autoHeartbeat?: boolean;
  /** Callback invoked on each auto-heartbeat (for monitoring). */
  onAutoHeartbeat?: () => void;
}

export interface EnrollmentResult {
  type: string;
  assignment_claim: string;
  instance_uid: string;
}

export class FakeOpampAgent {
  private ws: WebSocket | null = null;
  private sequenceNum = 0;
  private instanceUid: Uint8Array;
  private endpoint: string;
  private enrollmentToken?: string;
  private assignmentClaim?: string;
  private agentName: string;
  private autoHeartbeatEnabled: boolean;
  private onAutoHeartbeat?: () => void;

  // Binary (OpAMP) message queue
  private messageQueue: ServerToAgent[] = [];
  private waiters: Array<(msg: ServerToAgent) => void> = [];

  // Text (enrollment) message queue
  private textQueue: string[] = [];
  private textWaiters: Array<(msg: string) => void> = [];

  // Enrollment result (populated after successful enrollment)
  private _enrollment: EnrollmentResult | null = null;

  // Auto-heartbeat timer (driven by server-directed heart_beat_interval)
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** Server-directed heartbeat interval in milliseconds. */
  private _serverHeartbeatMs: number | null = null;

  // WebSocket keepalive: sends text "ping" frames for Cloudflare auto-response
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly KEEPALIVE_INTERVAL_MS = 30_000; // 30s

  // Close event tracking for diagnostics
  private _lastCloseCode: number | null = null;
  private _lastCloseReason: string | null = null;
  private _disconnectedAt: number | null = null;

  constructor(opts: FakeAgentOptions) {
    this.endpoint = opts.endpoint;
    this.enrollmentToken = opts.enrollmentToken;
    this.assignmentClaim = opts.assignmentClaim;
    this.agentName = opts.name ?? "fake-agent";
    this.instanceUid = opts.instanceUid ?? crypto.getRandomValues(new Uint8Array(16));
    this.autoHeartbeatEnabled = opts.autoHeartbeat ?? false;
    this.onAutoHeartbeat = opts.onAutoHeartbeat;
  }

  /**
   * Open a WebSocket connection to the server.
   * Auth is passed via ?token= query parameter (works in Node.js + browser).
   */
  async connect(): Promise<void> {
    const token = this.assignmentClaim ?? this.enrollmentToken;
    const url = token
      ? `${this.endpoint}${this.endpoint.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
      : this.endpoint;

    this.ws = new WebSocket(url);

    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("No WebSocket"));
        return;
      }
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        this.startKeepalive();
        resolve();
      };
      this.ws.onerror = (e) => reject(e);

      this.ws.onmessage = (event) => {
        // Text frames = enrollment messages or keepalive pongs
        if (typeof event.data === "string") {
          // Ignore keepalive "pong" auto-responses
          if (event.data === "pong") return;

          const textWaiter = this.textWaiters.shift();
          if (textWaiter) {
            textWaiter(event.data);
          } else {
            this.textQueue.push(event.data);
          }
          return;
        }

        // Binary frames = OpAMP protocol
        const data =
          event.data instanceof ArrayBuffer
            ? event.data
            : (event.data as Blob).arrayBuffer
              ? null // shouldn't happen with binaryType=arraybuffer
              : event.data;
        if (!data) return;

        const msg = decodeFrame<ServerToAgent>(data as ArrayBuffer);

        // Process server-directed heartbeat interval
        this.processHeartbeatInterval(msg);

        const waiter = this.waiters.shift();
        if (waiter) {
          waiter(msg);
        } else {
          this.messageQueue.push(msg);
        }
      };

      this.ws.onclose = (event) => {
        this._lastCloseCode = event.code;
        this._lastCloseReason = event.reason;
        this._disconnectedAt = Date.now();
      };
    });
  }

  /**
   * Connect and complete enrollment in one call.
   * Per OpAMP spec, client sends first — we connect, send hello,
   * then receive the enrollment_complete text + initial binary response.
   */
  async connectAndEnroll(): Promise<EnrollmentResult> {
    await this.connect();

    // Per OpAMP spec: client sends first to trigger enrollment
    await this.sendHello();

    // Receive enrollment_complete text message (server responds to our hello)
    const text = await this.waitForTextMessage(10_000);
    const enrollment = JSON.parse(text) as EnrollmentResult;
    if (enrollment.type !== "enrollment_complete") {
      throw new Error(`Expected enrollment_complete, got ${enrollment.type}`);
    }

    this._enrollment = enrollment;

    // Consume the initial OpAMP binary response
    await this.waitForMessage(5000);

    return enrollment;
  }

  /** The enrollment result, if enrollment has completed. */
  get enrollment(): EnrollmentResult | null {
    return this._enrollment;
  }

  async sendHello(): Promise<void> {
    this.sequenceNum = 0;
    const msg: AgentToServer = {
      instance_uid: this.instanceUid,
      sequence_num: this.sequenceNum,
      capabilities:
        AgentCapabilities.ReportsStatus |
        AgentCapabilities.AcceptsRemoteConfig |
        AgentCapabilities.ReportsHealth |
        AgentCapabilities.ReportsRemoteConfig,
      flags: 0,
      health: {
        healthy: true,
        start_time_unix_nano: BigInt(Date.now()) * 1000000n,
        last_error: "",
        status: "running",
        status_time_unix_nano: BigInt(Date.now()) * 1000000n,
        component_health_map: {},
      },
      agent_description: {
        identifying_attributes: [{ key: "service.name", value: { string_value: this.agentName } }],
        non_identifying_attributes: [{ key: "os.type", value: { string_value: "test" } }],
      },
    };
    this.send(msg);
  }

  async sendHeartbeat(): Promise<void> {
    this.sequenceNum++;
    const msg: AgentToServer = {
      instance_uid: this.instanceUid,
      sequence_num: this.sequenceNum,
      capabilities:
        AgentCapabilities.ReportsStatus |
        AgentCapabilities.AcceptsRemoteConfig |
        AgentCapabilities.ReportsHealth,
      flags: 0,
    };
    this.send(msg);
  }

  async sendHealth(healthy: boolean, status: string = ""): Promise<void> {
    this.sequenceNum++;
    const msg: AgentToServer = {
      instance_uid: this.instanceUid,
      sequence_num: this.sequenceNum,
      capabilities:
        AgentCapabilities.ReportsStatus |
        AgentCapabilities.AcceptsRemoteConfig |
        AgentCapabilities.ReportsHealth,
      flags: 0,
      health: {
        healthy,
        start_time_unix_nano: BigInt(Date.now()) * 1000000n,
        last_error: healthy ? "" : status,
        status,
        status_time_unix_nano: BigInt(Date.now()) * 1000000n,
        component_health_map: {},
      },
    };
    this.send(msg);
  }

  async waitForMessage(timeoutMs = 5000): Promise<ServerToAgent> {
    const queued = this.messageQueue.shift();
    if (queued) return queued;

    return new Promise((resolve, reject) => {
      const waiter = (msg: ServerToAgent) => {
        clearTimeout(timer);
        resolve(msg);
      };
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(waiter);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error("Timeout waiting for server message"));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  async waitForTextMessage(timeoutMs = 5000): Promise<string> {
    const queued = this.textQueue.shift();
    if (queued) return queued;

    return new Promise((resolve, reject) => {
      const waiter = (msg: string) => {
        clearTimeout(timer);
        resolve(msg);
      };
      const timer = setTimeout(() => {
        const idx = this.textWaiters.indexOf(waiter);
        if (idx !== -1) this.textWaiters.splice(idx, 1);
        reject(new Error("Timeout waiting for text message"));
      }, timeoutMs);
      this.textWaiters.push(waiter);
    });
  }

  async waitForRemoteConfig(timeoutMs = 5000): Promise<ServerToAgent> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const msg = await this.waitForMessage(remaining);
      if (msg.remote_config) return msg;
    }
    throw new Error("Timeout waiting for remote config");
  }

  async applyConfig(hash: Uint8Array): Promise<void> {
    this.sequenceNum++;
    const msg: AgentToServer = {
      instance_uid: this.instanceUid,
      sequence_num: this.sequenceNum,
      capabilities:
        AgentCapabilities.ReportsStatus |
        AgentCapabilities.AcceptsRemoteConfig |
        AgentCapabilities.ReportsRemoteConfig,
      flags: 0,
      remote_config_status: {
        last_remote_config_hash: hash,
        status: RemoteConfigStatuses.APPLIED,
        error_message: "",
      },
    };
    this.send(msg);
  }

  close(): void {
    // Stop keepalive and auto-heartbeat timers
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    // Reject any pending waiters so tests don't hang
    const pendingWaiters = this.waiters.splice(0);
    for (const waiter of pendingWaiters) {
      try {
        waiter(null as unknown as ServerToAgent);
      } catch {
        /* ignore */
      }
    }
    const pendingTextWaiters = this.textWaiters.splice(0);
    for (const waiter of pendingTextWaiters) {
      try {
        waiter(null as unknown as string);
      } catch {
        /* ignore */
      }
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get uid(): Uint8Array {
    return this.instanceUid;
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  get seq(): number {
    return this.sequenceNum;
  }

  /** Server-directed heartbeat interval in milliseconds, if received. */
  get serverHeartbeatMs(): number | null {
    return this._serverHeartbeatMs;
  }

  /** Close code from the last disconnect, if any. */
  get lastCloseCode(): number | null {
    return this._lastCloseCode;
  }

  /** Close reason from the last disconnect, if any. */
  get lastCloseReason(): string | null {
    return this._lastCloseReason;
  }

  /** Timestamp (ms) when the connection was last lost, if any. */
  get disconnectedAt(): number | null {
    return this._disconnectedAt;
  }

  /** Update the stored assignment claim (e.g. after enrollment). */
  setAssignmentClaim(claim: string): void {
    this.assignmentClaim = claim;
  }

  /**
   * Process server-directed heart_beat_interval from a ServerToAgent message.
   * If autoHeartbeat is enabled, starts a heartbeat loop.
   *
   * Strategy: send the FIRST heartbeat quickly (within 30s) with random jitter
   * to avoid thundering herd, then switch to the server-directed interval.
   * This prevents Cloudflare edge idle timeout (~100s) from killing connections
   * during long enrollment ramps.
   */
  private processHeartbeatInterval(msg: ServerToAgent): void {
    if (
      msg.heart_beat_interval === null ||
      msg.heart_beat_interval === undefined ||
      msg.heart_beat_interval <= 0
    )
      return;

    const intervalMs = Math.floor(msg.heart_beat_interval / 1_000_000);
    if (intervalMs <= 0 || intervalMs === this._serverHeartbeatMs) return;

    this._serverHeartbeatMs = intervalMs;

    if (!this.autoHeartbeatEnabled) return;

    // Don't restart if already running
    if (this.heartbeatTimer) return;

    // First heartbeat: random jitter 5-30s to avoid thundering herd
    const firstDelay = 5_000 + Math.floor(Math.random() * 25_000);

    const doHeartbeat = () => {
      if (!this.connected) {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
        return;
      }
      try {
        this.sendHeartbeat();
        this.onAutoHeartbeat?.();
      } catch {
        // Connection may have closed between the check and send
      }
    };

    // Schedule first heartbeat quickly, then switch to steady interval
    this.heartbeatTimer = setTimeout(() => {
      doHeartbeat();
      this.heartbeatTimer = setInterval(doHeartbeat, intervalMs);
    }, firstDelay) as unknown as ReturnType<typeof setInterval>;
  }

  /**
   * Start WebSocket keepalive: sends text "ping" frames every 30s.
   * The DO's setWebSocketAutoResponse auto-replies "pong" without waking,
   * keeping the Cloudflare edge alive at zero DO CPU cost.
   */
  private startKeepalive(): void {
    if (this.keepaliveTimer) return;
    // Send initial ping immediately so the DO's auto-response timestamp is set
    // before the alarm's zombie sweep fires
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send("ping");
      }
    } catch {
      /* ignore */
    }
    this.keepaliveTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
        this.keepaliveTimer = null;
        return;
      }
      try {
        this.ws.send("ping");
      } catch {
        // Connection may have closed
      }
    }, FakeOpampAgent.KEEPALIVE_INTERVAL_MS);
  }

  private send(msg: AgentToServer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(encodeFrame(msg));
  }
}
