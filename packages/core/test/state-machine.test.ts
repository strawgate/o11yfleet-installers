import { describe, it, expect } from "vitest";
import { processFrame } from "../src/state-machine/processor.js";
import type { AgentState } from "../src/state-machine/types.js";
import type { AgentToServer } from "../src/codec/types.js";
import {
  AgentCapabilities,
  ServerToAgentFlags,
  RemoteConfigStatuses,
} from "../src/codec/types.js";
import { FleetEventType } from "../src/events.js";

function makeDefaultState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    instance_uid: new Uint8Array(16),
    tenant_id: "tenant-1",
    config_id: "config-1",
    sequence_num: 0,
    generation: 1,
    healthy: true,
    status: "running",
    last_error: "",
    current_config_hash: null,
    desired_config_hash: null,
    last_seen_at: 0,
    connected_at: 0,
    agent_description: null,
    capabilities: 0,
    ...overrides,
  };
}

function makeHelloMsg(uid?: Uint8Array): AgentToServer {
  return {
    instance_uid: uid ?? new Uint8Array(16),
    sequence_num: 0,
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
}

describe("state-machine/processFrame", () => {
  it("handles hello message — emits connected event", () => {
    const state = makeDefaultState();
    const msg = makeHelloMsg();
    const result = processFrame(state, msg);

    expect(result.shouldPersist).toBe(true);
    expect(result.events).toHaveLength(1); // connected
    expect(result.events[0].type).toBe(FleetEventType.AGENT_CONNECTED);
    expect(result.newState.connected_at).toBeGreaterThan(0);
  });

  it("handles heartbeat with no changes — no persist", () => {
    const state = makeDefaultState({
      sequence_num: 5,
      connected_at: Date.now() - 10000,
      healthy: true,
      status: "running",
      capabilities: AgentCapabilities.ReportsStatus, // already stored from prior hello
    });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 6,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    };

    const result = processFrame(state, msg);
    expect(result.shouldPersist).toBe(false);
    expect(result.events).toHaveLength(0);
    expect(result.response).not.toBeNull();
  });

  it("detects sequence gap — requests full state", () => {
    const state = makeDefaultState({ sequence_num: 5, connected_at: Date.now() });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 10, // Gap: expected 6
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    };

    const result = processFrame(state, msg);
    expect(result.response!.flags & ServerToAgentFlags.ReportFullState).toBeTruthy();
    expect(result.shouldPersist).toBe(true);
  });

  it("handles health change — emits event and persists", () => {
    const state = makeDefaultState({
      sequence_num: 1,
      connected_at: Date.now(),
      healthy: true,
      status: "running",
    });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsHealth,
      flags: 0,
      health: {
        healthy: false,
        start_time_unix_nano: 0n,
        last_error: "OOM",
        status: "degraded",
        status_time_unix_nano: BigInt(Date.now()) * 1000000n,
        component_health_map: {},
      },
    };

    const result = processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    expect(result.newState.healthy).toBe(false);
    expect(result.newState.status).toBe("degraded");
    const healthEvent = result.events.find((e) => e.type === FleetEventType.AGENT_HEALTH_CHANGED);
    expect(healthEvent).toBeDefined();
  });

  it("offers remote config when desired != current", () => {
    const state = makeDefaultState({
      sequence_num: 1,
      connected_at: Date.now(),
      desired_config_hash: new Uint8Array([0xaa, 0xbb]),
      current_config_hash: null,
    });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.AcceptsRemoteConfig,
      flags: 0,
    };

    const result = processFrame(state, msg);
    expect(result.response!.remote_config).toBeDefined();
    expect(result.response!.remote_config!.config_hash).toEqual(new Uint8Array([0xaa, 0xbb]));
  });

  it("does NOT offer config when current matches desired", () => {
    const hash = new Uint8Array([0xaa, 0xbb]);
    const state = makeDefaultState({
      sequence_num: 1,
      connected_at: Date.now(),
      desired_config_hash: hash,
      current_config_hash: hash,
    });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.AcceptsRemoteConfig,
      flags: 0,
    };

    const result = processFrame(state, msg);
    expect(result.response!.remote_config).toBeUndefined();
  });

  it("handles config applied — emits event", () => {
    const hash = new Uint8Array([0xaa, 0xbb]);
    const state = makeDefaultState({
      sequence_num: 2,
      connected_at: Date.now(),
      desired_config_hash: hash,
    });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 3,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsRemoteConfig,
      flags: 0,
      remote_config_status: {
        last_remote_config_hash: hash,
        status: RemoteConfigStatuses.APPLIED,
        error_message: "",
      },
    };

    const result = processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    expect(result.newState.current_config_hash).toEqual(hash);
    const configEvent = result.events.find((e) => e.type === FleetEventType.CONFIG_APPLIED);
    expect(configEvent).toBeDefined();
  });

  it("handles disconnect — emits event, no response", () => {
    const state = makeDefaultState({
      sequence_num: 5,
      connected_at: Date.now(),
    });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 6,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
      agent_disconnect: {},
    };

    const result = processFrame(state, msg);
    expect(result.response).toBeNull();
    expect(result.shouldPersist).toBe(true);
    expect(result.events[0].type).toBe(FleetEventType.AGENT_DISCONNECTED);
  });

  it("handles config rejected — emits event", () => {
    const hash = new Uint8Array([0xcc, 0xdd]);
    const state = makeDefaultState({
      sequence_num: 3,
      connected_at: Date.now(),
    });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 4,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsRemoteConfig,
      flags: 0,
      remote_config_status: {
        last_remote_config_hash: hash,
        status: RemoteConfigStatuses.FAILED,
        error_message: "invalid yaml",
      },
    };

    const result = processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    const rejectEvent = result.events.find((e) => e.type === FleetEventType.CONFIG_REJECTED);
    expect(rejectEvent).toBeDefined();
  });

  it("updates agent description — persists", () => {
    const state = makeDefaultState({ sequence_num: 1, connected_at: Date.now() });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
      agent_description: {
        identifying_attributes: [
          { key: "service.name", value: { string_value: "otel-collector" } },
        ],
        non_identifying_attributes: [],
      },
    };

    const result = processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    expect(result.newState.agent_description).toContain("otel-collector");
  });
});

// ========================
// Config Content Delivery (C4 fix)
// ========================
describe("Config Content Delivery", () => {
  it("includes config content in response when configContent is provided", () => {
    const state = makeDefaultState({
      sequence_num: 1,
      connected_at: Date.now(),
      desired_config_hash: new Uint8Array([1, 2, 3]),
      capabilities: AgentCapabilities.AcceptsRemoteConfig,
    });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: AgentCapabilities.AcceptsRemoteConfig,
      flags: 0,
    };

    const yamlContent = "receivers:\n  otlp:\n    protocols:\n      grpc:";
    const result = processFrame(state, msg, new TextEncoder().encode(yamlContent));

    expect(result.response?.remote_config).toBeDefined();
    expect(result.response!.remote_config!.config.config_map).toBeDefined();
    const configMap = result.response!.remote_config!.config.config_map as Record<string, { body: Uint8Array; content_type: string }>;
    expect(configMap[""]).toBeDefined();
    expect(configMap[""].content_type).toBe("text/yaml");
    expect(new TextDecoder().decode(configMap[""].body)).toBe(yamlContent);
  });

  it("sends empty config_map when configContent is null", () => {
    const state = makeDefaultState({
      sequence_num: 1,
      connected_at: Date.now(),
      desired_config_hash: new Uint8Array([1, 2, 3]),
      capabilities: AgentCapabilities.AcceptsRemoteConfig,
    });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: AgentCapabilities.AcceptsRemoteConfig,
      flags: 0,
    };

    const result = processFrame(state, msg, null);
    expect(result.response?.remote_config).toBeDefined();
    const configMap = result.response!.remote_config!.config.config_map as Record<string, unknown>;
    expect(Object.keys(configMap)).toHaveLength(0);
  });

  it("does not offer config when current matches desired", () => {
    const hash = new Uint8Array([1, 2, 3]);
    const state = makeDefaultState({
      sequence_num: 1,
      connected_at: Date.now(),
      desired_config_hash: hash,
      current_config_hash: hash,
      capabilities: AgentCapabilities.AcceptsRemoteConfig,
    });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: AgentCapabilities.AcceptsRemoteConfig,
      flags: 0,
    };

    const result = processFrame(state, msg, new TextEncoder().encode("should not appear"));
    expect(result.response?.remote_config).toBeUndefined();
  });

  it("does not offer config when agent lacks AcceptsRemoteConfig capability", () => {
    const state = makeDefaultState({
      sequence_num: 1,
      connected_at: Date.now(),
      desired_config_hash: new Uint8Array([1, 2, 3]),
      capabilities: AgentCapabilities.ReportsStatus, // no AcceptsRemoteConfig
    });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    };

    const result = processFrame(state, msg, new TextEncoder().encode("should not appear"));
    expect(result.response?.remote_config).toBeUndefined();
  });
});
