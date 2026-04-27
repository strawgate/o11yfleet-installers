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

  // Binary (OpAMP) message queue
  private messageQueue: ServerToAgent[] = [];
  private waiters: Array<(msg: ServerToAgent) => void> = [];

  // Text (enrollment) message queue
  private textQueue: string[] = [];
  private textWaiters: Array<(msg: string) => void> = [];

  // Enrollment result (populated after successful enrollment)
  private _enrollment: EnrollmentResult | null = null;

  constructor(opts: FakeAgentOptions) {
    this.endpoint = opts.endpoint;
    this.enrollmentToken = opts.enrollmentToken;
    this.assignmentClaim = opts.assignmentClaim;
    this.agentName = opts.name ?? "fake-agent";
    this.instanceUid = opts.instanceUid ?? crypto.getRandomValues(new Uint8Array(16));
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
      if (!this.ws) return reject(new Error("No WebSocket"));
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);

      this.ws.onmessage = (event) => {
        // Text frames = enrollment messages
        if (typeof event.data === "string") {
          const textWaiter = this.textWaiters.shift();
          if (textWaiter) {
            textWaiter(event.data);
          } else {
            this.textQueue.push(event.data);
          }
          return;
        }

        // Binary frames = OpAMP protocol
        const data = event.data instanceof ArrayBuffer
          ? event.data
          : (event.data as Blob).arrayBuffer
            ? null // shouldn't happen with binaryType=arraybuffer
            : event.data;
        if (!data) return;

        const msg = decodeFrame<ServerToAgent>(data as ArrayBuffer);
        const waiter = this.waiters.shift();
        if (waiter) {
          waiter(msg);
        } else {
          this.messageQueue.push(msg);
        }
      };
    });
  }

  /**
   * Connect and complete enrollment in one call.
   * Returns the enrollment result (assignment_claim + instance_uid).
   */
  async connectAndEnroll(): Promise<EnrollmentResult> {
    await this.connect();

    // Wait for enrollment_complete text message
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
        identifying_attributes: [
          { key: "service.name", value: this.agentName },
        ],
        non_identifying_attributes: [
          { key: "os.type", value: "test" },
        ],
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
      const timer = setTimeout(
        () => reject(new Error("Timeout waiting for server message")),
        timeoutMs,
      );
      this.waiters.push((msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  async waitForTextMessage(timeoutMs = 5000): Promise<string> {
    const queued = this.textQueue.shift();
    if (queued) return queued;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timeout waiting for text message")),
        timeoutMs,
      );
      this.textWaiters.push((msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
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

  /** Update the stored assignment claim (e.g. after enrollment). */
  setAssignmentClaim(claim: string): void {
    this.assignmentClaim = claim;
  }

  private send(msg: AgentToServer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(encodeFrame(msg));
  }
}
