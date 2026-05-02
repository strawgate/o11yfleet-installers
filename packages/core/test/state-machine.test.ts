import { describe, it, expect } from "vitest";
import { processFrame, MAX_CONFIG_FAIL_RETRIES } from "../src/state-machine/processor.js";
import type { AgentState } from "../src/state-machine/types.js";
import type { AgentToServer } from "../src/codec/types.js";
import {
  AgentCapabilities,
  ServerCapabilities,
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
    effective_config_hash: null,
    effective_config_body: null,
    last_seen_at: 0,
    connected_at: 0,
    agent_description: null,
    capabilities: 0,
    component_health_map: null,
    available_components: null,
    config_fail_count: 0,
    config_last_failed_hash: null,
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

  // Pins the OR semantics of the `isHello` check (`seq===0 || connected_at===0`):
  // an agent that previously connected and now sends seq=0 is still a hello,
  // even though connected_at is set. Caught by Stryker as a surviving
  // LogicalOperator mutation (|| → &&) — the prior test only covered the
  // default state (both conditions true), so && passed.
  it("seq=0 on a previously-connected agent is a hello (OR semantics)", async () => {
    const priorConnect = Date.now() - 60_000;
    const state = makeDefaultState({ connected_at: priorConnect, sequence_num: 5 });
    const msg = makeHelloMsg();
    const result = await processFrame(state, msg);
    // Hello must be detected → ReportFullState flag set, AGENT_CONNECTED emitted.
    expect(result.response!.flags & ServerToAgentFlags.ReportFullState).toBeTruthy();
    expect(result.events.some((e) => e.type === FleetEventType.AGENT_CONNECTED)).toBe(true);
    // connected_at refreshed to "now", not the prior value.
    expect(result.newState.connected_at).toBeGreaterThan(priorConnect);
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
// Dedupe key shape (event de-duplication contract)
// ========================
//
// The analytics pipeline relies on `dedupe_key` to drop replays of the
// same event. Stryker found these template literals could be mutated to
// empty strings with all existing tests passing — meaning a future
// refactor that broke the keys would silently break dedup in prod.
// These tests pin the load-bearing components of each key.

import { uint8ToHex } from "../src/hex.js";

describe("event dedupe_key shape", () => {
  function findEvent<T extends { type: string; dedupe_key: string }>(
    events: ReadonlyArray<T | unknown>,
    type: string,
  ): T {
    const found = events.find(
      (e): e is T => typeof e === "object" && e !== null && (e as T).type === type,
    );
    if (!found) throw new Error(`expected event of type ${type}`);
    return found;
  }

  it("AGENT_CONNECTED dedupe_key contains tenant + config + uid + seq", async () => {
    const uid = new Uint8Array(16).fill(0xaa);
    const state = makeDefaultState({ instance_uid: uid });
    const msg = makeHelloMsg(uid);
    const result = await processFrame(state, msg);
    const event = findEvent(result.events, FleetEventType.AGENT_CONNECTED);
    expect(event.dedupe_key.startsWith("connected:")).toBe(true);
    expect(event.dedupe_key).toContain(state.tenant_id);
    expect(event.dedupe_key).toContain(state.config_id);
    expect(event.dedupe_key).toContain(uint8ToHex(uid));
  });

  it("AGENT_DISCONNECTED dedupe_key carries the session generation (replay-safe)", async () => {
    const uid = new Uint8Array(16).fill(0xbb);
    const sessionConnectedAt = 1_700_000_000_000;
    const state = makeDefaultState({
      instance_uid: uid,
      sequence_num: 5,
      connected_at: sessionConnectedAt,
    });
    const msg: AgentToServer = {
      instance_uid: uid,
      sequence_num: 6,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
      agent_disconnect: {},
    };
    const result = await processFrame(state, msg);
    const event = findEvent(result.events, FleetEventType.AGENT_DISCONNECTED);
    expect(event.dedupe_key.startsWith("disconnected:")).toBe(true);
    expect(event.dedupe_key).toContain(state.tenant_id);
    expect(event.dedupe_key).toContain(uint8ToHex(uid));
    // Including the session generation prevents a replayed disconnect
    // from a previous session from sharing a key with the live session's
    // disconnect.
    expect(event.dedupe_key).toContain(String(sessionConnectedAt));
    expect(event.dedupe_key).toContain("agent_disconnect_message");
  });

  it("AGENT_HEALTH_CHANGED dedupe_key includes healthy + status + lastError", async () => {
    const uid = new Uint8Array(16).fill(0xcc);
    const state = makeDefaultState({
      instance_uid: uid,
      sequence_num: 1,
      connected_at: Date.now(),
      healthy: true,
      status: "running",
    });
    const msg: AgentToServer = {
      instance_uid: uid,
      sequence_num: 2,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsHealth,
      flags: 0,
      health: {
        healthy: false,
        start_time_unix_nano: 0n,
        last_error: "OOM-killed-by-host",
        status: "degraded",
        status_time_unix_nano: 0n,
        component_health_map: {},
      },
    };
    const result = await processFrame(state, msg);
    const event = findEvent(result.events, FleetEventType.AGENT_HEALTH_CHANGED);
    expect(event.dedupe_key.startsWith("health:")).toBe(true);
    expect(event.dedupe_key).toContain("false"); // healthy
    expect(event.dedupe_key).toContain("degraded");
    expect(event.dedupe_key).toContain("OOM-killed-by-host");
  });

  it("CONFIG_APPLIED dedupe_key includes the config hash", async () => {
    const uid = new Uint8Array(16).fill(0xdd);
    const hash = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
    const state = makeDefaultState({
      instance_uid: uid,
      sequence_num: 2,
      connected_at: Date.now(),
      desired_config_hash: hash,
    });
    const msg: AgentToServer = {
      instance_uid: uid,
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
    const event = findEvent(result.events, FleetEventType.CONFIG_APPLIED);
    expect(event.dedupe_key.startsWith("applied:")).toBe(true);
    expect(event.dedupe_key).toContain("12345678"); // hex of hash
    expect(event.dedupe_key).toContain(uint8ToHex(uid));
  });

  it("CONFIG_REJECTED dedupe_key includes hash + error_message", async () => {
    const uid = new Uint8Array(16).fill(0xee);
    const hash = new Uint8Array([0x9a, 0xbc, 0xde, 0xf0]);
    const state = makeDefaultState({
      instance_uid: uid,
      sequence_num: 3,
      connected_at: Date.now(),
    });
    const msg: AgentToServer = {
      instance_uid: uid,
      sequence_num: 4,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsRemoteConfig,
      flags: 0,
      remote_config_status: {
        last_remote_config_hash: hash,
        status: RemoteConfigStatuses.FAILED,
        error_message: "schema mismatch on receivers",
      },
    };
    const result = await processFrame(state, msg);
    const event = findEvent(result.events, FleetEventType.CONFIG_REJECTED);
    expect(event.dedupe_key.startsWith("rejected:")).toBe(true);
    expect(event.dedupe_key).toContain("9abcdef0");
    expect(event.dedupe_key).toContain("schema mismatch on receivers");
  });
});

// ========================
// Server Capability Advertisement (§4.4.1)
// ========================
//
// Spec §4.4.1: every ServerToAgent must advertise the capabilities the
// server supports as a bitmask. These tests previously lived in
// `tests/opamp/src/opamp.test.ts` and required wrangler dev to send a
// real WebSocket message; the assertion is purely about what
// `processFrame` writes into `response.capabilities`, so they belong at
// the state-machine tier where each test runs in microseconds instead
// of hundreds of milliseconds.
describe("ServerToAgent capability advertisement (§4.4.1)", () => {
  it("response advertises AcceptsStatus on every heartbeat", async () => {
    const state = makeDefaultState({
      sequence_num: 5,
      connected_at: Date.now() - 10000,
      capabilities: AgentCapabilities.ReportsStatus,
    });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 6,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    };
    const result = await processFrame(state, msg);
    expect(result.response).not.toBeNull();
    expect(result.response!.capabilities & ServerCapabilities.AcceptsStatus).toBe(
      ServerCapabilities.AcceptsStatus,
    );
  });

  it("response advertises OffersRemoteConfig", async () => {
    const state = makeDefaultState({
      sequence_num: 5,
      connected_at: Date.now() - 10000,
      capabilities: AgentCapabilities.ReportsStatus,
    });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 6,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    };
    const result = await processFrame(state, msg);
    expect(result.response!.capabilities & ServerCapabilities.OffersRemoteConfig).toBe(
      ServerCapabilities.OffersRemoteConfig,
    );
  });

  it("response advertises OffersConnectionSettings (0x20)", async () => {
    const state = makeDefaultState({
      sequence_num: 5,
      connected_at: Date.now() - 10000,
      capabilities: AgentCapabilities.ReportsStatus,
    });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 6,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    };
    const result = await processFrame(state, msg);
    expect(result.response!.capabilities & ServerCapabilities.OffersConnectionSettings).toBe(
      ServerCapabilities.OffersConnectionSettings,
    );
  });

  it("response advertises AcceptsEffectiveConfig", async () => {
    const state = makeDefaultState({
      sequence_num: 5,
      connected_at: Date.now() - 10000,
      capabilities: AgentCapabilities.ReportsStatus,
    });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 6,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    };
    const result = await processFrame(state, msg);
    expect(result.response!.capabilities & ServerCapabilities.AcceptsEffectiveConfig).toBe(
      ServerCapabilities.AcceptsEffectiveConfig,
    );
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

  it("config_rejected marks config_fail_count + config_last_failed_hash dirty", async () => {
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
    expect(result.dirtyFields.has("config_fail_count")).toBe(true);
    expect(result.dirtyFields.has("config_last_failed_hash")).toBe(true);
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

// ========================
// Config Fail Retry Limit
// ========================
describe("Config fail retry limit", () => {
  const failedHash = new Uint8Array([0xde, 0xad]);
  const configCaps = AgentCapabilities.ReportsStatus | AgentCapabilities.AcceptsRemoteConfig;

  function makeFailed(seqNum: number, hash = failedHash): AgentToServer {
    return {
      instance_uid: new Uint8Array(16),
      sequence_num: seqNum,
      capabilities: configCaps,
      flags: 0,
      remote_config_status: {
        last_remote_config_hash: hash,
        status: RemoteConfigStatuses.FAILED,
        error_message: "bad yaml",
      },
    };
  }

  it("increments config_fail_count on FAILED status", async () => {
    const state = makeDefaultState({
      sequence_num: 1,
      connected_at: Date.now(),
      capabilities: configCaps,
    });
    const result = await processFrame(state, makeFailed(2));
    expect(result.newState.config_fail_count).toBe(1);
    expect(result.newState.config_last_failed_hash).toEqual(failedHash);
    expect(result.dirtyFields.has("config_fail_count")).toBe(true);
    expect(result.dirtyFields.has("config_last_failed_hash")).toBe(true);
  });

  it("accumulates fail count for the same hash", async () => {
    const state = makeDefaultState({
      sequence_num: 1,
      connected_at: Date.now(),
      capabilities: configCaps,
      config_fail_count: 1,
      config_last_failed_hash: failedHash,
    });
    const result = await processFrame(state, makeFailed(2));
    expect(result.newState.config_fail_count).toBe(2);
  });

  it("resets fail count when a different hash fails", async () => {
    const state = makeDefaultState({
      sequence_num: 1,
      connected_at: Date.now(),
      capabilities: configCaps,
      config_fail_count: 2,
      config_last_failed_hash: failedHash,
    });
    const differentHash = new Uint8Array([0xbe, 0xef]);
    const result = await processFrame(state, makeFailed(2, differentHash));
    expect(result.newState.config_fail_count).toBe(1);
    expect(result.newState.config_last_failed_hash).toEqual(differentHash);
  });

  it("emits CONFIG_STUCK when retry budget exhausted", async () => {
    const state = makeDefaultState({
      sequence_num: 1,
      connected_at: Date.now(),
      capabilities: configCaps,
      config_fail_count: MAX_CONFIG_FAIL_RETRIES - 1,
      config_last_failed_hash: failedHash,
    });
    const result = await processFrame(state, makeFailed(2));
    expect(result.newState.config_fail_count).toBe(MAX_CONFIG_FAIL_RETRIES);
    const stuckEvent = result.events.find((e) => e.type === FleetEventType.CONFIG_STUCK);
    expect(stuckEvent).toBeDefined();
    const rejectedEvent = result.events.find((e) => e.type === FleetEventType.CONFIG_REJECTED);
    expect(rejectedEvent).toBeDefined();
  });

  it("suppresses config re-offer when agent is stuck", async () => {
    const state = makeDefaultState({
      sequence_num: 1,
      connected_at: Date.now(),
      capabilities: configCaps,
      desired_config_hash: failedHash,
      current_config_hash: null,
      config_fail_count: MAX_CONFIG_FAIL_RETRIES,
      config_last_failed_hash: failedHash,
    });
    const heartbeat: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: configCaps,
      flags: 0,
    };
    const result = await processFrame(state, heartbeat);
    expect(result.response!.remote_config).toBeUndefined();
  });

  it("offers config again when desired hash changes (new rollout)", async () => {
    const state = makeDefaultState({
      sequence_num: 1,
      connected_at: Date.now(),
      capabilities: configCaps,
      desired_config_hash: new Uint8Array([0xca, 0xfe]),
      current_config_hash: null,
      config_fail_count: MAX_CONFIG_FAIL_RETRIES,
      config_last_failed_hash: failedHash,
    });
    const heartbeat: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: configCaps,
      flags: 0,
    };
    const result = await processFrame(state, heartbeat);
    expect(result.response!.remote_config).toBeDefined();
    expect(result.response!.remote_config!.config_hash).toEqual(new Uint8Array([0xca, 0xfe]));
  });

  it("clears stuck state when agent successfully applies config", async () => {
    const appliedHash = new Uint8Array([0xca, 0xfe]);
    const state = makeDefaultState({
      sequence_num: 1,
      connected_at: Date.now(),
      capabilities: configCaps,
      desired_config_hash: appliedHash,
      config_fail_count: MAX_CONFIG_FAIL_RETRIES,
      config_last_failed_hash: failedHash,
    });
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: configCaps,
      flags: 0,
      remote_config_status: {
        last_remote_config_hash: appliedHash,
        status: RemoteConfigStatuses.APPLIED,
        error_message: "",
      },
    };
    const result = await processFrame(state, msg);
    expect(result.newState.config_fail_count).toBe(0);
    expect(result.newState.config_last_failed_hash).toBeNull();
  });

  it("does not emit CONFIG_STUCK below retry threshold", async () => {
    const state = makeDefaultState({
      sequence_num: 1,
      connected_at: Date.now(),
      capabilities: configCaps,
      config_fail_count: 0,
      config_last_failed_hash: null,
    });
    const result = await processFrame(state, makeFailed(2));
    expect(result.newState.config_fail_count).toBe(1);
    expect(result.events.find((e) => e.type === FleetEventType.CONFIG_STUCK)).toBeUndefined();
    expect(result.events.find((e) => e.type === FleetEventType.CONFIG_REJECTED)).toBeDefined();
  });
});
