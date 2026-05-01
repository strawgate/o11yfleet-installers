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
} from "@o11yfleet/core/codec";
import {
  buildHello as buildHelloMsg,
  buildHeartbeat as buildHeartbeatMsg,
  buildHealthReport as buildHealthMsg,
  buildConfigAck as buildConfigAckMsg,
} from "./opamp-messages.js";

/** Pipeline configuration for realistic component_health_map. */
export interface PipelineConfig {
  name: string; // e.g. "traces", "metrics", "logs"
  receivers: string[]; // e.g. ["otlp"]
  processors: string[]; // e.g. ["batch"]
  exporters: string[]; // e.g. ["debug"]
}

/** Standard pipeline set matching a real otelcol-contrib with otlp/batch/debug. */
export const REAL_COLLECTOR_PIPELINES: PipelineConfig[] = [
  { name: "traces", receivers: ["otlp"], processors: ["batch"], exporters: ["debug"] },
  { name: "metrics", receivers: ["otlp"], processors: ["batch"], exporters: ["debug"] },
  { name: "logs", receivers: ["otlp"], processors: ["batch"], exporters: ["debug"] },
];

/** Generate a random 12-char hex hostname like a Docker container ID. */
function randomHostname(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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
  /** Realistic agent profile matching real OTel Collector behavior. */
  profile?: AgentProfile;
}

/** Realistic agent profile — matches what otelcol-contrib actually reports. */
export interface AgentProfile {
  /** Service version, e.g. "0.123.0". */
  serviceVersion?: string;
  /** Hostname to report. Auto-generated if omitted. */
  hostname?: string;
  /** OS type. Defaults to "linux". */
  osType?: string;
  /** Architecture. Defaults to "arm64". */
  arch?: string;
  /** Pipeline definitions for component_health_map. */
  pipelines?: PipelineConfig[];
  /** Extensions to include. Defaults to ["opamp"]. */
  extensions?: string[];
  /** Capabilities bitmask. Defaults to 2053 (real collector value). */
  capabilities?: number;
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

  private profile: AgentProfile;
  private resolvedCapabilities: number;

  constructor(opts: FakeAgentOptions) {
    this.endpoint = opts.endpoint;
    this.enrollmentToken = opts.enrollmentToken;
    this.assignmentClaim = opts.assignmentClaim;
    this.agentName = opts.name ?? "fake-agent";
    this.instanceUid = opts.instanceUid ?? crypto.getRandomValues(new Uint8Array(16));
    this.autoHeartbeatEnabled = opts.autoHeartbeat ?? false;
    this.onAutoHeartbeat = opts.onAutoHeartbeat;
    this.profile = opts.profile ?? {};
    this.resolvedCapabilities =
      this.profile.capabilities ??
      AgentCapabilities.ReportsStatus |
        AgentCapabilities.ReportsEffectiveConfig |
        AgentCapabilities.ReportsHealth;
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
    const p = this.profile;
    const hostname = p.hostname ?? randomHostname();
    const hasEffectiveConfigCap =
      (this.resolvedCapabilities & AgentCapabilities.ReportsEffectiveConfig) !== 0;
    const msg = buildHelloMsg({
      instanceUid: this.instanceUid,
      sequenceNum: this.sequenceNum,
      capabilities: this.resolvedCapabilities,
      name: this.agentName,
      serviceVersion: p.serviceVersion,
      hostname,
      osType: p.osType,
      arch: p.arch,
      pipelines: p.pipelines,
      extensions: p.extensions,
      includeEffectiveConfig: hasEffectiveConfigCap,
    });
    this.send(msg);
  }

  async sendHeartbeat(): Promise<void> {
    this.sequenceNum++;
    this.send(
      buildHeartbeatMsg({
        instanceUid: this.instanceUid,
        sequenceNum: this.sequenceNum,
        capabilities: this.resolvedCapabilities,
      }),
    );
  }

  async sendHealth(healthy: boolean, status: string = ""): Promise<void> {
    this.sequenceNum++;
    this.send(
      buildHealthMsg({
        instanceUid: this.instanceUid,
        sequenceNum: this.sequenceNum,
        capabilities: this.resolvedCapabilities,
        healthy,
        status: status || undefined,
        lastError: healthy ? "" : status,
      }),
    );
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
    this.send(
      buildConfigAckMsg({
        instanceUid: this.instanceUid,
        sequenceNum: this.sequenceNum,
        capabilities: this.resolvedCapabilities,
        configHash: hash,
      }),
    );
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
