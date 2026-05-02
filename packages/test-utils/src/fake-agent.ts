// @o11yfleet/test-utils — Fake OpAMP Agent
//
// A reusable fake OTel Collector that speaks the OpAMP protocol over WebSocket.
// Works in Node.js (v22+ built-in WebSocket) for full-stack E2E tests against
// wrangler dev, and in any browser-like environment.

import {
  encodeAgentToServerProto,
  decodeServerToAgentProto,
  type AgentToServer,
  type ServerToAgent,
  AgentCapabilities,
  RemoteConfigStatuses,
} from "@o11yfleet/core/codec";
import { uint8ToHex } from "@o11yfleet/core/hex";
import {
  buildHello as buildHelloMsg,
  buildHeartbeat as buildHeartbeatMsg,
  buildHealthReport as buildHealthMsg,
  buildConfigAck as buildConfigAckMsg,
  buildShutdown as buildShutdownMsg,
  buildExporterFailure,
  buildHealthRecovered,
  buildReceiverFailure,
  buildComponentHealthMap,
  CONFIGURABLE_CAPABILITIES,
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

// ─── Behavior Modes ─────────────────────────────────────────────────
//
// Agent behavior modes simulate realistic fleet conditions observed from
// real otelcol-contrib instances. Each mode runs an autonomous loop after
// enrollment, mimicking what a real collector would do under that condition.

/** Named behavior mode for a fake agent. */
export type AgentBehaviorMode =
  /** Steady heartbeats only — no health changes. This is the default. */
  | "healthy"
  /** Periodic exporter failure cycles: healthy → unhealthy → healthy → …
   *  Sends StatusRecoverableError (retryable). Models OTLP backend going down. */
  | "failing-exporter"
  /** Permanent receiver failure. Sends StatusPermanentError once and stays unhealthy.
   *  Models a port conflict that prevents the collector from starting a pipeline. */
  | "failing-receiver"
  /** Abrupt disconnect + reconnect on a timer. No agent_disconnect message.
   *  Models network instability or container restart without graceful shutdown. */
  | "flapping"
  /** Clean restart: sends agent_disconnect, closes WS, reconnects with seq=0.
   *  Models otelcol supervisor restart (e.g. after config reload or crash). */
  | "restarting"
  /** Always responds to config pushes with RemoteConfigStatuses.FAILED.
   *  Models a misconfigured collector that rejects every config attempt. */
  | "config-rejecting";

/** Behavior configuration for an agent behavior mode. */
export interface BehaviorConfig {
  mode: AgentBehaviorMode;
  /** For failing-exporter: total seconds of one failure+recovery cycle.
   *  The agent fails for half the cycle, then recovers for the other half.
   *  Default: 120 (fails 60s, recovers 60s). */
  cycleSeconds?: number;
  /** For flapping: seconds to stay offline before reconnecting. Default: 30. */
  offlineSeconds?: number;
  /** For flapping: seconds between flap events. Default: 300. */
  flapIntervalSeconds?: number;
  /** For restarting: seconds between clean restarts. Default: 300. */
  restartIntervalSeconds?: number;
  /** For failing-exporter: which exporter to fail. Default: "otlphttp". */
  exporter?: string;
  /** For failing-receiver: which receiver to fail. Default: "otlp". */
  receiver?: string;
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

  // Behavior loop state
  private behaviorTimers: ReturnType<typeof setTimeout>[] = [];
  private rejectConfigs = false;
  /** Collector process start time for health reports (set on first enrollment). */
  private processStartNano = BigInt(Date.now()) * 1_000_000n;

  constructor(opts: FakeAgentOptions) {
    this.endpoint = opts.endpoint;
    this.enrollmentToken = opts.enrollmentToken;
    this.assignmentClaim = opts.assignmentClaim;
    this.agentName = opts.name ?? "fake-agent";
    this.instanceUid = opts.instanceUid ?? crypto.getRandomValues(new Uint8Array(16));
    this.autoHeartbeatEnabled = opts.autoHeartbeat ?? false;
    this.onAutoHeartbeat = opts.onAutoHeartbeat;
    this.profile = opts.profile ?? {};
    // Reuse the shared CONFIGURABLE_CAPABILITIES preset. Critical
    // properties: it includes `AcceptsRemoteConfig`, without which
    // the worker's rollout filter
    // (`!(attachment.capabilities & AcceptsRemoteConfig)` → skip)
    // drops this agent from every config push and tests see `pushed=0`.
    this.resolvedCapabilities = this.profile.capabilities ?? CONFIGURABLE_CAPABILITIES;
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

        const msg = decodeServerToAgentProto(data as ArrayBuffer);

        // config-rejecting mode: auto-respond to config pushes with FAILED.
        // All other agents auto-ACK config pushes with APPLIED (matching real collector).
        if (msg.remote_config) {
          const hash = msg.remote_config.config_hash ?? new Uint8Array(0);
          this.sequenceNum++;
          this.sendRaw({
            instance_uid: this.instanceUid,
            sequence_num: this.sequenceNum,
            capabilities: this.resolvedCapabilities,
            flags: 0,
            remote_config_status: {
              last_remote_config_hash: hash,
              status: this.rejectConfigs
                ? RemoteConfigStatuses.FAILED
                : RemoteConfigStatuses.APPLIED,
              error_message: this.rejectConfigs
                ? "config rejected: validation failed (simulated)"
                : "",
            },
          });
          // Still deliver to waiters so tests that watch for config pushes work
        }

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
   *
   * Per OpAMP spec, client sends first — we connect, send hello, then
   * wait for the first ServerToAgent. The worker is protobuf-only
   * since #399, so the assignment claim arrives in the binary frame's
   * `connection_settings.opamp.headers[Authorization]` instead of a
   * separate `enrollment_complete` text message.
   */
  async connectAndEnroll(): Promise<EnrollmentResult> {
    await this.connect();

    // Per OpAMP spec: client sends first to trigger enrollment
    await this.sendHello();

    // First ServerToAgent carries the assignment claim in
    // ConnectionSettingsOffers.opamp.headers (`Authorization: Bearer …`).
    const msg = await this.waitForMessage(10_000);
    const authHeader = msg.connection_settings?.opamp?.headers?.find(
      (h) => h.key.toLowerCase() === "authorization",
    );
    if (!authHeader) {
      throw new Error(
        "Expected ConnectionSettingsOffers with Authorization header on first ServerToAgent during enrollment",
      );
    }
    const bearerMatch = authHeader.value.match(/^Bearer\s+(.+)$/i);
    if (!bearerMatch?.[1]) {
      throw new Error(
        `Authorization header must be a non-empty Bearer token, got: ${authHeader.value.slice(0, 32)}…`,
      );
    }
    const token = bearerMatch[1];
    // Persist the freshly-issued claim so that any subsequent reconnect
    // (`a.close()` → `a.connect()`) authenticates with the assignment
    // claim instead of the now-consumed enrollment token.
    this.assignmentClaim = token;

    // Adopt the server-assigned instance_uid if it differs from ours.
    // Per OpAMP spec §5.1, the server sets `agent_identification.new_instance_uid`
    // when it detects a UID collision (or otherwise wants to rename the
    // agent). Subsequent heartbeats/reconnects must use the new value.
    const newUid = msg.agent_identification?.new_instance_uid;
    if (newUid && newUid.length > 0) {
      this.instanceUid = new Uint8Array(newUid);
    }

    const enrollment: EnrollmentResult = {
      type: "enrollment_complete",
      assignment_claim: token,
      instance_uid: uint8ToHex(this.instanceUid),
    };
    this._enrollment = enrollment;

    // Real otelcol-contrib sends a second health report ~1s after startup (seq=1),
    // also all StatusOK. Send it now so the server sees a proper post-startup health frame.
    await this.sendHealthReport();

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

  /**
   * Send a full StatusOK health report (matching the real collector's seq=1 frame).
   * This includes the full component_health_map, all StatusOK.
   */
  async sendHealthReport(): Promise<void> {
    this.sequenceNum++;
    const p = this.profile;
    const nowNano = BigInt(Date.now()) * 1_000_000n;
    const pipelines = p.pipelines ?? REAL_COLLECTOR_PIPELINES;
    const extensions = p.extensions ?? ["opamp"];
    const componentHealthMap = buildComponentHealthMap(pipelines, extensions, nowNano);
    this.send(
      buildHealthMsg({
        instanceUid: this.instanceUid,
        sequenceNum: this.sequenceNum,
        capabilities: this.resolvedCapabilities,
        healthy: true,
        status: "StatusOK",
        componentHealthMap,
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

  /**
   * Start an autonomous behavior loop after enrollment.
   *
   * Call this after `connectAndEnroll()` to simulate realistic fleet behavior.
   * The loop runs until `stopBehavior()` or `close()` is called.
   */
  startBehavior(config: BehaviorConfig): void {
    this.stopBehavior();

    switch (config.mode) {
      case "healthy":
        // No-op — steady heartbeats come from the auto-heartbeat timer
        break;

      case "failing-exporter":
        this.startFailingExporterLoop(config);
        break;

      case "failing-receiver":
        this.startFailingReceiverOnce(config);
        break;

      case "flapping":
        this.startFlappingLoop(config);
        break;

      case "restarting":
        this.startRestartingLoop(config);
        break;

      case "config-rejecting":
        this.rejectConfigs = true;
        break;
    }
  }

  /** Stop the behavior loop and clear any pending timers. */
  stopBehavior(): void {
    this.rejectConfigs = false;
    for (const t of this.behaviorTimers) clearTimeout(t);
    this.behaviorTimers = [];
  }

  private startFailingExporterLoop(config: BehaviorConfig): void {
    const cycleMs = (config.cycleSeconds ?? 120) * 1000;
    const failMs = cycleMs / 2;
    const exporter = config.exporter ?? "otlphttp";
    const pipelines = this.profile.pipelines;

    const failCycle = () => {
      if (!this.connected) return;
      try {
        this.sequenceNum++;
        this.sendRaw(
          buildExporterFailure({
            instanceUid: this.instanceUid,
            sequenceNum: this.sequenceNum,
            capabilities: this.resolvedCapabilities,
            exporter,
            pipelines,
            startTimeNano: this.processStartNano,
          }),
        );
      } catch {
        // WS may have closed
      }

      // Recover after failMs
      const recoverTimer = setTimeout(() => {
        if (!this.connected) return;
        try {
          this.sequenceNum++;
          this.sendRaw(
            buildHealthRecovered({
              instanceUid: this.instanceUid,
              sequenceNum: this.sequenceNum,
              capabilities: this.resolvedCapabilities,
              pipelines,
              startTimeNano: this.processStartNano,
            }),
          );
        } catch {
          // WS may have closed
        }
      }, failMs);
      this.behaviorTimers.push(recoverTimer);

      // Schedule next failure cycle
      const nextCycleTimer = setTimeout(failCycle, cycleMs);
      this.behaviorTimers.push(nextCycleTimer);
    };

    // Jitter the first failure to avoid all agents failing simultaneously
    const jitter = Math.floor(Math.random() * failMs);
    const firstTimer = setTimeout(failCycle, jitter);
    this.behaviorTimers.push(firstTimer);
  }

  private startFailingReceiverOnce(config: BehaviorConfig): void {
    const receiver = config.receiver ?? "otlp";
    const pipelines = this.profile.pipelines;

    // Send the permanent failure right away (real collector sends this on startup)
    const sendTimer = setTimeout(
      () => {
        if (!this.connected) return;
        try {
          this.sequenceNum++;
          this.sendRaw(
            buildReceiverFailure({
              instanceUid: this.instanceUid,
              sequenceNum: this.sequenceNum,
              capabilities: this.resolvedCapabilities,
              receiver,
              pipelines,
              startTimeNano: this.processStartNano,
            }),
          );
        } catch {
          // WS may have closed
        }
      },
      500 + Math.floor(Math.random() * 2000),
    );
    this.behaviorTimers.push(sendTimer);
  }

  private startFlappingLoop(config: BehaviorConfig): void {
    const flapIntervalMs = (config.flapIntervalSeconds ?? 300) * 1000;
    const offlineMs = (config.offlineSeconds ?? 30) * 1000;

    const doFlap = async () => {
      if (!this.connected) return;
      try {
        // Abrupt close — no agent_disconnect, just drop the connection
        this.ws?.close();
        this.ws = null;
      } catch {
        // Already closed
      }

      // Wait offline period, then reconnect
      const reconnectTimer = setTimeout(async () => {
        if (!this._enrollment) return;
        try {
          // Reconnect resets seq to 0 (process restart simulation)
          this.sequenceNum = 0;
          this.processStartNano = BigInt(Date.now()) * 1_000_000n;
          await this.connect();
          await this.sendHello();
          // Drain the enrollment ServerToAgent (config + assignment reuse)
          const msg = await this.waitForMessage(10_000);
          // Update assignment claim if server re-issued one
          const auth = msg.connection_settings?.opamp?.headers?.find(
            (h) => h.key.toLowerCase() === "authorization",
          );
          if (auth) {
            const m = auth.value.match(/^Bearer\s+(.+)$/i);
            if (m?.[1]) this.assignmentClaim = m[1];
          }
        } catch {
          // Reconnect failed — will retry on next flap cycle
        }

        // Schedule next flap
        const nextTimer = setTimeout(doFlap, flapIntervalMs);
        this.behaviorTimers.push(nextTimer);
      }, offlineMs);
      this.behaviorTimers.push(reconnectTimer);
    };

    // Jitter first flap across the interval
    const jitter = Math.floor(Math.random() * flapIntervalMs);
    const firstTimer = setTimeout(doFlap, jitter);
    this.behaviorTimers.push(firstTimer);
  }

  private startRestartingLoop(config: BehaviorConfig): void {
    const intervalMs = (config.restartIntervalSeconds ?? 300) * 1000;

    const doRestart = async () => {
      if (!this._enrollment) return;
      try {
        // Graceful disconnect: send agent_disconnect then close
        if (this.connected) {
          this.sequenceNum++;
          this.sendRaw({
            instance_uid: this.instanceUid,
            sequence_num: this.sequenceNum,
            capabilities: this.resolvedCapabilities,
            flags: 0,
            agent_disconnect: {},
          });
          this.ws?.close();
          this.ws = null;
        }
      } catch {
        // Already closed
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 500);
      });

      try {
        // Clean restart: seq resets to 0, new process start time
        this.sequenceNum = 0;
        this.processStartNano = BigInt(Date.now()) * 1_000_000n;
        await this.connect();
        await this.sendHello();
        const msg = await this.waitForMessage(10_000);
        const auth = msg.connection_settings?.opamp?.headers?.find(
          (h) => h.key.toLowerCase() === "authorization",
        );
        if (auth) {
          const m = auth.value.match(/^Bearer\s+(.+)$/i);
          if (m?.[1]) this.assignmentClaim = m[1];
        }
      } catch {
        // Reconnect failed
      }

      // Schedule next restart
      const nextTimer = setTimeout(doRestart, intervalMs);
      this.behaviorTimers.push(nextTimer);
    };

    // Jitter first restart
    const jitter = Math.floor(Math.random() * intervalMs);
    const firstTimer = setTimeout(doRestart, jitter);
    this.behaviorTimers.push(firstTimer);
  }

  close(): void {
    // Stop behavior loops
    this.stopBehavior();
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
    // Send StatusStopping health report before closing (matches real otelcol shutdown)
    if (this.connected) {
      try {
        this.sequenceNum++;
        this.sendRaw(
          buildShutdownMsg({
            instanceUid: this.instanceUid,
            sequenceNum: this.sequenceNum,
            capabilities: this.resolvedCapabilities,
            pipelines: this.profile.pipelines,
            startTimeNano: this.processStartNano,
          }),
        );
      } catch {
        // Best-effort — WS may already be closing
      }
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

  /**
   * Send a fully-formed AgentToServer message. Public so tests can drive
   * specific protocol scenarios without going through the named helpers
   * (sendHello/sendHeartbeat/...).
   *
   * Side-effect: keeps the internal `sequenceNum` counter in sync with
   * `msg.sequence_num`. Tests that mix `sendMessage` with `sendHeartbeat`
   * (which does `++sequenceNum`) or `sendHealth*` would otherwise see
   * mismatched sequence numbers — `sendHeartbeat` would re-use a number
   * the worker has already advanced past, triggering ReportFullState.
   */
  sendMessage(msg: AgentToServer): void {
    this.sequenceNum = msg.sequence_num;
    this.send(msg);
  }

  /**
   * Send raw bytes over the WebSocket, bypassing the codec entirely.
   * Used for tests that need to feed the worker malformed frames,
   * unknown protobuf fields, or a hand-crafted byte sequence.
   *
   * Caller is responsible for the wire format. The 0x00 opamp-go data-type
   * header byte is NOT prepended — pass exactly the bytes you want sent.
   */
  sendBytes(bytes: ArrayBuffer | Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(bytes);
  }

  /**
   * Send the canonical "garbage protobuf" payload used by §4.5
   * malformed-frame tests. The leading 0x00 byte is the opamp-go
   * data-type header that real agent frames carry — including it makes
   * this exercise the same parse path real frames take
   * (`decodeAgentToServerProto` strips the 0x00, then `fromBinary`
   * tries to parse the remainder and rejects field-tag 0 as invalid).
   * Centralised here so multiple §4.5 tests share canonical input.
   */
  sendMalformedProtobuf(): void {
    this.sendBytes(new Uint8Array([0x00, 0x05, 0xde, 0xad, 0xbe, 0xef, 0x00]));
  }

  /** Send a raw AgentToServer message — used internally by behavior loops. */
  private sendRaw(msg: AgentToServer): void {
    this.send(msg);
  }

  private send(msg: AgentToServer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(encodeAgentToServerProto(msg));
  }
}
