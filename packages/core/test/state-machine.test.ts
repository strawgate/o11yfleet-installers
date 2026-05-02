import { describe, it, expect } from "vitest";
import { processFrame } from "../src/state-machine/processor.js";
import type { AgentState } from "../src/state-machine/types.js";
import type { AgentToServer } from "../src/codec/types.js";
import { AgentCapabilities, ServerToAgentFlags, RemoteConfigStatuses } from "../src/codec/types.js";
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
    effective_config_hash: null,
    effective_config_body: null,
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
  it("handles hello message — emits connected event", async () => {
    const state = makeDefaultState();
    const msg = makeHelloMsg();
    const result = await processFrame(state, msg);

    expect(result.shouldPersist).toBe(true);
    expect(result.events).toHaveLength(1); // connected
    expect(result.events[0].type).toBe(FleetEventType.AGENT_CONNECTED);
    expect(result.newState.connected_at).toBeGreaterThan(0);
  });

  it("handles heartbeat with no changes — skips persistence (tracked in WS attachment)", async () => {
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

    const result = await processFrame(state, msg);
    // No-op heartbeats skip persistence. sequence_num and last_seen_at are
    // tracked in the WS attachment at zero cost. On reconnect, any gap in
    // SQLite's stale seq_num triggers ReportFullState — correct by spec.
    expect(result.shouldPersist).toBe(false);
    expect(result.events).toHaveLength(0);
    expect(result.response).not.toBeNull();
  });

  it("detects sequence gap — requests full state", async () => {
    const state = makeDefaultState({ sequence_num: 5, connected_at: Date.now() });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 10, // Gap: expected 6
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    };

    const result = await processFrame(state, msg);
    expect(result.response!.flags & ServerToAgentFlags.ReportFullState).toBeTruthy();
    expect(result.shouldPersist).toBe(true);
  });

  it("handles health change — emits event and persists", async () => {
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

    const result = await processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    expect(result.newState.healthy).toBe(false);
    expect(result.newState.status).toBe("degraded");
    const healthEvent = result.events.find((e) => e.type === FleetEventType.AGENT_HEALTH_CHANGED);
    expect(healthEvent).toBeDefined();
  });

  it("offers remote config when desired != current", async () => {
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

    const result = await processFrame(state, msg);
    expect(result.response!.remote_config).toBeDefined();
    expect(result.response!.remote_config!.config_hash).toEqual(new Uint8Array([0xaa, 0xbb]));
  });

  it("does NOT offer config when current matches desired", async () => {
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

    const result = await processFrame(state, msg);
    expect(result.response!.remote_config).toBeUndefined();
  });

  it("handles config applied — emits event", async () => {
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

    const result = await processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    expect(result.newState.current_config_hash).toEqual(hash);
    const configEvent = result.events.find((e) => e.type === FleetEventType.CONFIG_APPLIED);
    expect(configEvent).toBeDefined();
  });

  it("handles disconnect — emits event, no response", async () => {
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

    const result = await processFrame(state, msg);
    expect(result.response).toBeNull();
    expect(result.shouldPersist).toBe(true);
    expect(result.events[0].type).toBe(FleetEventType.AGENT_DISCONNECTED);
    expect(result.newState.status).toBe("disconnected");
    expect(result.newState.connected_at).toBe(0);
  });

  it("handles config rejected — emits event", async () => {
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

    const result = await processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    const rejectEvent = result.events.find((e) => e.type === FleetEventType.CONFIG_REJECTED);
    expect(rejectEvent).toBeDefined();
  });

  it("handles config rejected without hash — does not throw", async () => {
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
        last_remote_config_hash: undefined as unknown as Uint8Array,
        status: RemoteConfigStatuses.FAILED,
        error_message: "failed without hash",
      },
    };

    const result = await processFrame(state, msg);
    expect(result).toBeDefined();
    const rejectEvent = result.events.find((e) => e.type === FleetEventType.CONFIG_REJECTED);
    expect(rejectEvent).toBeDefined();
  });

  it("does not emit config applied when applied hash is unchanged", async () => {
    const hash = new Uint8Array([0xaa, 0xbb]);
    const state = makeDefaultState({
      sequence_num: 2,
      connected_at: Date.now(),
      current_config_hash: hash,
      desired_config_hash: hash,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsRemoteConfig,
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

    const result = await processFrame(state, msg);
    expect(result.events.find((e) => e.type === FleetEventType.CONFIG_APPLIED)).toBeUndefined();
    // Hash unchanged means no real state change — shouldPersist is false.
    // The DO tracks sequence_num in the WS attachment.
    expect(result.shouldPersist).toBe(false);
  });

  it("updates agent description — persists", async () => {
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

    const result = await processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    expect(result.newState.agent_description).toContain("otel-collector");
  });
});

// ========================
// Config Content Delivery (C4 fix)
// ========================
describe("Config Content Delivery", () => {
  it("includes config content in response when configContent is provided", async () => {
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
    const result = await processFrame(state, msg, new TextEncoder().encode(yamlContent));

    expect(result.response?.remote_config).toBeDefined();
    expect(result.response!.remote_config!.config.config_map).toBeDefined();
    const configMap = result.response!.remote_config!.config.config_map as Record<
      string,
      { body: Uint8Array; content_type: string }
    >;
    expect(configMap[""]).toBeDefined();
    expect(configMap[""].content_type).toBe("text/yaml");
    expect(new TextDecoder().decode(configMap[""].body)).toBe(yamlContent);
  });

  it("sends empty config_map when configContent is null", async () => {
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

    const result = await processFrame(state, msg, null);
    expect(result.response?.remote_config).toBeDefined();
    const configMap = result.response!.remote_config!.config.config_map as Record<string, unknown>;
    expect(Object.keys(configMap)).toHaveLength(0);
  });

  it("does not offer config when current matches desired", async () => {
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

    const result = await processFrame(state, msg, new TextEncoder().encode("should not appear"));
    expect(result.response?.remote_config).toBeUndefined();
  });

  it("does not offer config when agent lacks AcceptsRemoteConfig capability", async () => {
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

    const result = await processFrame(state, msg, new TextEncoder().encode("should not appear"));
    expect(result.response?.remote_config).toBeUndefined();
  });
});

// ========================
// Effective Config Processing
// ========================
describe("Effective Config Processing", () => {
  it("stores effective config when reported", async () => {
    const state = makeDefaultState({
      sequence_num: 1,
      connected_at: Date.now(),
    });
    const yamlBody = "receivers:\n  otlp:\n    protocols:\n      grpc:";
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: AgentCapabilities.ReportsEffectiveConfig,
      flags: 0,
      effective_config: {
        config_map: {
          config_map: {
            "": {
              body: new TextEncoder().encode(yamlBody),
              content_type: "text/yaml",
            },
          },
        },
      },
    };

    const result = await processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    expect(result.newState.effective_config_hash).toBe(
      "a9d8ad161fac5160417a2aec6a96fa89f571ba8de8b5d250c0d72ba30abf6384",
    );
    expect(result.newState.effective_config_body).toBe(yamlBody);
    const effEvent = result.events.find((e) => e.type === FleetEventType.CONFIG_EFFECTIVE_REPORTED);
    expect(effEvent).toBeDefined();
  });

  it("does not persist when effective config unchanged", async () => {
    const yamlBody = "receivers:\n  otlp:";
    // Pre-compute the hash by running once
    const firstState = makeDefaultState({
      sequence_num: 1,
      connected_at: Date.now(),
      capabilities: AgentCapabilities.ReportsEffectiveConfig,
    });
    const firstMsg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: AgentCapabilities.ReportsEffectiveConfig,
      flags: 0,
      effective_config: {
        config_map: {
          config_map: {
            "": {
              body: new TextEncoder().encode(yamlBody),
              content_type: "text/yaml",
            },
          },
        },
      },
    };
    const firstResult = await processFrame(firstState, firstMsg);
    const hash = firstResult.newState.effective_config_hash;

    // Second call with same effective config — should not persist
    const secondState = makeDefaultState({
      sequence_num: 2,
      connected_at: Date.now(),
      effective_config_hash: hash,
      effective_config_body: yamlBody,
      capabilities: AgentCapabilities.ReportsEffectiveConfig,
    });
    const secondMsg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 3,
      capabilities: AgentCapabilities.ReportsEffectiveConfig,
      flags: 0,
      effective_config: {
        config_map: {
          config_map: {
            "": {
              body: new TextEncoder().encode(yamlBody),
              content_type: "text/yaml",
            },
          },
        },
      },
    };
    const secondResult = await processFrame(secondState, secondMsg);
    // Same effective config hash → no state change → no persistence needed
    expect(secondResult.shouldPersist).toBe(false);
    expect(secondResult.events).toHaveLength(0);
  });
});

// ========================
// RequestInstanceUid Flag
// ========================
describe("RequestInstanceUid", () => {
  it("assigns new instance UID when RequestInstanceUid flag is set", async () => {
    const state = makeDefaultState({
      sequence_num: 0,
      connected_at: 0,
    });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 0,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 1, // RequestInstanceUid
    };

    const result = await processFrame(state, msg);
    expect(result.response).toBeDefined();
    expect(result.response!.agent_identification).toBeDefined();
    expect(result.response!.agent_identification!.new_instance_uid).toHaveLength(16);
    // Ensure it's actually random (not all zeros)
    const allZero = result.response!.agent_identification!.new_instance_uid.every((b) => b === 0);
    expect(allZero).toBe(false);
  });

  it("does not assign UID when flag is not set", async () => {
    const state = makeDefaultState({
      sequence_num: 0,
      connected_at: 0,
    });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 0,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    };

    const result = await processFrame(state, msg);
    expect(result.response!.agent_identification).toBeUndefined();
  });
});

// ─── dirtyFields ────────────────────────────────────────────────────

describe("dirtyFields tracking", () => {
  it("no-op heartbeat produces empty dirtyFields", async () => {
    const state = makeDefaultState({ sequence_num: 5, connected_at: 1000 });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 6,
      capabilities: 0,
      flags: 0,
    };
    const result = await processFrame(state, msg);
    expect(result.shouldPersist).toBe(false);
    expect(result.dirtyFields.size).toBe(0);
  });

  it("hello marks connected_at dirty (Tier 2)", async () => {
    const state = makeDefaultState({ connected_at: 0 });
    const msg = makeHelloMsg();
    const result = await processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    expect(result.dirtyFields.has("connected_at")).toBe(true);
  });

  it("health change marks healthy/status/last_error dirty (Tier 1)", async () => {
    const state = makeDefaultState({ sequence_num: 1, connected_at: 1000 });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: 0,
      flags: 0,
      health: {
        healthy: false,
        status: "degraded",
        last_error: "disk full",
        start_time_unix_nano: 0n,
        status_time_unix_nano: 0n,
      },
    };
    const result = await processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    expect(result.dirtyFields.has("healthy")).toBe(true);
    expect(result.dirtyFields.has("status")).toBe(true);
    expect(result.dirtyFields.has("last_error")).toBe(true);
    // Should NOT contain connected_at (that's Tier 2)
    expect(result.dirtyFields.has("connected_at")).toBe(false);
  });

  it("capabilities change marks capabilities dirty (Tier 1)", async () => {
    const state = makeDefaultState({ sequence_num: 1, connected_at: 1000, capabilities: 0 });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    };
    const result = await processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    expect(result.dirtyFields.has("capabilities")).toBe(true);
    expect(result.dirtyFields.has("connected_at")).toBe(false);
  });

  it("config_rejected produces empty dirtyFields (event-only)", async () => {
    const state = makeDefaultState({ sequence_num: 1, connected_at: 1000 });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: 0,
      flags: 0,
      remote_config_status: {
        status: RemoteConfigStatuses.FAILED,
        last_remote_config_hash: new Uint8Array([1, 2, 3]),
        error_message: "bad config",
      },
    };
    const result = await processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    expect(result.dirtyFields.size).toBe(0);
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("sequence gap marks sequence_num dirty", async () => {
    const state = makeDefaultState({ sequence_num: 5, connected_at: 1000 });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 10, // gap: expected 6
      capabilities: 0,
      flags: 0,
    };
    const result = await processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    expect(result.dirtyFields.has("sequence_num")).toBe(true);
  });

  it("disconnect marks status and connected_at dirty", async () => {
    const state = makeDefaultState({ sequence_num: 5, connected_at: 1000 });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 6,
      capabilities: 0,
      flags: 0,
      agent_disconnect: {},
    };
    const result = await processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    expect(result.dirtyFields.has("status")).toBe(true);
    expect(result.dirtyFields.has("connected_at")).toBe(true);
  });

  it("component_health_map marks only that field dirty", async () => {
    const state = makeDefaultState({ sequence_num: 1, connected_at: 1000 });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: 0,
      flags: 0,
      health: {
        healthy: true, // unchanged
        status: "running", // unchanged
        last_error: "", // unchanged
        start_time_unix_nano: 0n,
        status_time_unix_nano: 0n,
        component_health_map: {
          receiver_otlp: {
            healthy: true,
            start_time_unix_nano: 0n,
            status: "OK",
            status_time_unix_nano: 0n,
            last_error: "",
          },
        },
      },
    };
    const result = await processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    expect(result.dirtyFields.has("component_health_map")).toBe(true);
    // health fields unchanged → not dirty
    expect(result.dirtyFields.has("healthy")).toBe(false);
  });

  it("agent_description change marks that field dirty", async () => {
    const state = makeDefaultState({ sequence_num: 1, connected_at: 1000 });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: 0,
      flags: 0,
      agent_description: {
        identifying_attributes: [{ key: "service.name", value: { stringValue: "otelcol" } }],
      },
    };
    const result = await processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    expect(result.dirtyFields.has("agent_description")).toBe(true);
    expect(result.dirtyFields.has("connected_at")).toBe(false);
  });

  it("available_components change marks that field dirty", async () => {
    const state = makeDefaultState({ sequence_num: 1, connected_at: 1000 });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: 0,
      flags: 0,
      available_components: { components: [] },
    };
    const result = await processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    expect(result.dirtyFields.has("available_components")).toBe(true);
    expect(result.dirtyFields.has("connected_at")).toBe(false);
  });

  it("effective_config change marks effective_config_hash dirty", async () => {
    const state = makeDefaultState({ sequence_num: 1, connected_at: 1000 });
    const configBody = new TextEncoder().encode("receivers:\n  otlp: {}\n");
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: 0,
      flags: 0,
      effective_config: {
        config_map: {
          config_map: {
            "": { body: configBody, content_type: "text/yaml" },
          },
        },
      },
    };
    const result = await processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    expect(result.dirtyFields.has("effective_config_hash")).toBe(true);
    expect(result.dirtyFields.has("connected_at")).toBe(false);
  });

  it("config APPLIED status marks current_config_hash dirty", async () => {
    const hash = new Uint8Array(32).fill(0xab);
    const state = makeDefaultState({ sequence_num: 1, connected_at: 1000 });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: AgentCapabilities.AcceptsRemoteConfig,
      flags: 0,
      remote_config_status: {
        status: RemoteConfigStatuses.APPLIED,
        last_remote_config_hash: hash,
      },
    };
    const result = await processFrame(state, msg);
    expect(result.shouldPersist).toBe(true);
    expect(result.dirtyFields.has("current_config_hash")).toBe(true);
    expect(result.dirtyFields.has("connected_at")).toBe(false);
  });
});
