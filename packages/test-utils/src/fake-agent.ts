// @o11yfleet/test-utils — Fake OpAMP Agent

import {
  encodeFrame,
  decodeFrame,
  type AgentToServer,
  type ServerToAgent,
  AgentCapabilities,
  RemoteConfigStatuses,
} from "@o11yfleet/core/codec";

export interface FakeAgentOptions {
  endpoint: string;
  enrollmentToken?: string;
  assignmentClaim?: string;
  instanceUid?: Uint8Array;
}

export class FakeOpampAgent {
  private ws: WebSocket | null = null;
  private sequenceNum = 0;
  private instanceUid: Uint8Array;
  private endpoint: string;
  private enrollmentToken?: string;
  private assignmentClaim?: string;
  private messageQueue: ServerToAgent[] = [];
  private waiters: Array<(msg: ServerToAgent) => void> = [];

  constructor(opts: FakeAgentOptions) {
    this.endpoint = opts.endpoint;
    this.enrollmentToken = opts.enrollmentToken;
    this.assignmentClaim = opts.assignmentClaim;
    // Generate random 16-byte instance UID if not provided
    this.instanceUid = opts.instanceUid ?? crypto.getRandomValues(new Uint8Array(16));
  }

  async connect(): Promise<void> {
    const headers: Record<string, string> = {};
    if (this.assignmentClaim) {
      headers["Authorization"] = `Bearer ${this.assignmentClaim}`;
    } else if (this.enrollmentToken) {
      headers["Authorization"] = `Bearer ${this.enrollmentToken}`;
    }

    // Note: in test env, this will be called against a mock/local endpoint
    this.ws = new WebSocket(this.endpoint);

    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error("No WebSocket"));
      this.ws.binaryType = "arraybuffer";
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (event) => {
        const msg = decodeFrame<ServerToAgent>(event.data as ArrayBuffer);
        const waiter = this.waiters.shift();
        if (waiter) {
          waiter(msg);
        } else {
          this.messageQueue.push(msg);
        }
      };
    });
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
      const timer = setTimeout(() => reject(new Error("Timeout waiting for server message")), timeoutMs);
      this.waiters.push((msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  async waitForRemoteConfig(timeoutMs = 5000): Promise<ServerToAgent> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const msg = await this.waitForMessage(deadline - Date.now());
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

  private send(msg: AgentToServer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(encodeFrame(msg));
  }
}
