/**
 * State Machine (processFrame) Benchmarks
 *
 * Measures the pure CPU cost of the processFrame function for every
 * message type and transition an agent can trigger.
 */
import { bench, describe } from "vitest";
import { processFrame } from "../src/state-machine/processor.js";
import type { AgentState } from "../src/state-machine/types.js";
import type { AgentToServer } from "../src/codec/types.js";
import { AgentCapabilities } from "../src/codec/types.js";

// ─── State Fixtures ─────────────────────────────────────────────────────────

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    instance_uid: new Uint8Array(16).fill(0xab),
    tenant_id: "bench-tenant",
    config_id: "bench-config",
    sequence_num: 100,
    generation: 1,
    healthy: true,
    status: "running",
    last_error: "",
    current_config_hash: new Uint8Array(32).fill(0xcc),
    desired_config_hash: new Uint8Array(32).fill(0xcc), // same = no config push
    effective_config_hash: "aabbccdd",
    effective_config_body: null,
    last_seen_at: Date.now() - 30_000,
    connected_at: Date.now() - 3600_000,
    agent_description:
      '{"identifying_attributes":[{"key":"service.name","value":{"string_value":"otel-collector"}}]}',
    capabilities:
      AgentCapabilities.ReportsStatus |
      AgentCapabilities.AcceptsRemoteConfig |
      AgentCapabilities.ReportsHealth,
    component_health_map: null,
    available_components: null,
    ...overrides,
  };
}

// ─── Message Fixtures ───────────────────────────────────────────────────────

const uid = new Uint8Array(16).fill(0xab);

const heartbeat: AgentToServer = {
  instance_uid: uid,
  sequence_num: 101,
  capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsHealth,
  flags: 0,
};

const helloFirstConnect: AgentToServer = {
  instance_uid: uid,
  sequence_num: 0,
  capabilities:
    AgentCapabilities.ReportsStatus |
    AgentCapabilities.AcceptsRemoteConfig |
    AgentCapabilities.ReportsEffectiveConfig |
    AgentCapabilities.ReportsHealth,
  flags: 0,
  agent_description: {
    identifying_attributes: [
      { key: "service.name", value: { string_value: "otel-collector" } },
      { key: "service.version", value: { string_value: "0.96.0" } },
    ],
    non_identifying_attributes: [
      { key: "os.type", value: { string_value: "linux" } },
      { key: "host.arch", value: { string_value: "amd64" } },
    ],
  },
  health: {
    healthy: true,
    start_time_unix_nano: 1700000000000000000n,
    last_error: "",
    status: "starting",
    status_time_unix_nano: 1700000000000000000n,
    component_health_map: {},
  },
};

const healthReport: AgentToServer = {
  instance_uid: uid,
  sequence_num: 101,
  capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsHealth,
  flags: 0,
  health: {
    healthy: true,
    start_time_unix_nano: 1700000000000000000n,
    last_error: "",
    status: "running",
    status_time_unix_nano: 1700000001000000000n,
    component_health_map: {},
  },
};

const healthWithComponents: AgentToServer = {
  instance_uid: uid,
  sequence_num: 101,
  capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsHealth,
  flags: 0,
  health: {
    healthy: false,
    start_time_unix_nano: 1700000000000000000n,
    last_error: "exporter:otlp connection refused",
    status: "degraded",
    status_time_unix_nano: 1700000001000000000n,
    component_health_map: {
      "receiver:otlp": {
        healthy: true,
        start_time_unix_nano: 1700000000000000000n,
        last_error: "",
        status: "running",
        status_time_unix_nano: 1700000000000000000n,
        component_health_map: {},
      },
      "processor:batch": {
        healthy: true,
        start_time_unix_nano: 1700000000000000000n,
        last_error: "",
        status: "running",
        status_time_unix_nano: 1700000000000000000n,
        component_health_map: {},
      },
      "exporter:otlp": {
        healthy: false,
        start_time_unix_nano: 1700000000000000000n,
        last_error: "connection refused to backend:4317",
        status: "error",
        status_time_unix_nano: 1700000001000000000n,
        component_health_map: {},
      },
    },
  },
};

const effectiveConfig: AgentToServer = {
  instance_uid: uid,
  sequence_num: 101,
  capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsEffectiveConfig,
  flags: 0,
  effective_config: {
    config_map: {
      config_map: {
        "": {
          body: new Uint8Array(4096).fill(0x61),
          content_type: "application/yaml",
        },
      },
    },
    hash: new Uint8Array(32).fill(0xee),
  },
};

const remoteConfigStatus: AgentToServer = {
  instance_uid: uid,
  sequence_num: 101,
  capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsRemoteConfig,
  flags: 0,
  remote_config_status: {
    last_remote_config_hash: new Uint8Array(32).fill(0xcc),
    status: 1, // APPLYING
    error_message: "",
  },
};

const availableComponents: AgentToServer = {
  instance_uid: uid,
  sequence_num: 101,
  capabilities: AgentCapabilities.ReportsStatus,
  flags: 0,
  available_components: {
    components: {
      "receiver/otlp": { metadata: [{ key: "version", value: "0.96.0" }] },
      "processor/batch": { metadata: [{ key: "version", value: "0.96.0" }] },
      "exporter/otlp": { metadata: [{ key: "version", value: "0.96.0" }] },
      "exporter/debug": { metadata: [{ key: "version", value: "0.96.0" }] },
      "extension/health_check": { metadata: [{ key: "version", value: "0.96.0" }] },
    },
    hash: new Uint8Array(32).fill(0xaa),
  },
};

// Config bytes for when server needs to push config
const configBytes = new Uint8Array(2048).fill(0x61);

// ─── Benchmarks ─────────────────────────────────────────────────────────────

describe("processFrame — steady state (no config push)", () => {
  bench("heartbeat (minimal)", () => {
    processFrame(makeState(), heartbeat, null);
  });

  bench("health report (no components)", () => {
    processFrame(makeState(), healthReport, null);
  });

  bench("health report (3 components)", () => {
    processFrame(makeState(), healthWithComponents, null);
  });

  bench("effective config (4KB)", () => {
    processFrame(makeState(), effectiveConfig, null);
  });

  bench("remote_config_status", () => {
    processFrame(makeState(), remoteConfigStatus, null);
  });

  bench("available_components (5 entries)", () => {
    processFrame(makeState(), availableComponents, null);
  });
});

describe("processFrame — first connect (triggers config push)", () => {
  bench("hello → config push (2KB)", () => {
    const freshState = makeState({
      sequence_num: 0,
      current_config_hash: null,
      desired_config_hash: new Uint8Array(32).fill(0xdd),
    });
    processFrame(freshState, helloFirstConnect, configBytes);
  });
});

describe("processFrame — sequence gap (ReportFullState)", () => {
  const gapMsg: AgentToServer = { ...heartbeat, sequence_num: 105 };

  bench("sequence gap detection", () => {
    processFrame(makeState({ sequence_num: 100 }), gapMsg, null);
  });
});

describe("processFrame — config mismatch (triggers push)", () => {
  bench("config mismatch → push 2KB", () => {
    const mismatchState = makeState({
      current_config_hash: new Uint8Array(32).fill(0xaa),
      desired_config_hash: new Uint8Array(32).fill(0xbb),
    });
    processFrame(mismatchState, heartbeat, configBytes);
  });
});

describe("processFrame — throughput simulation", () => {
  // Simulates rapid heartbeats from same agent (hot path)
  const state = makeState();

  bench("sequential heartbeats (hot path)", () => {
    const seq = 101; // fresh each iteration
    const msg: AgentToServer = { ...heartbeat, sequence_num: seq };
    const result = processFrame({ ...state, sequence_num: seq - 1 }, msg, null);
    // Consume result to prevent dead-code elimination
    if (!result.response) throw new Error("unreachable");
  });
});
