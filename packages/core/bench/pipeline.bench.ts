/**
 * Full Pipeline Benchmarks
 *
 * Measures the complete hot path: decode → processFrame → encode
 * This is what actually happens in the Durable Object per incoming WebSocket message.
 */
import { bench, describe } from "vitest";
import { decodeAgentToServer, encodeServerToAgent } from "../src/codec/decoder.js";
import { encodeFrame } from "../src/codec/framing.js";
import { encodeServerToAgentProto } from "../src/codec/protobuf.js";
import { processFrame } from "../src/state-machine/processor.js";
import type { AgentState } from "../src/state-machine/types.js";
import { AgentCapabilities } from "../src/codec/types.js";
import { makeMessages } from "./fixtures.js";

// ─── Pre-encode messages in both formats ────────────────────────────────────

const msgs = makeMessages();

const jsonFrames = Object.fromEntries(Object.entries(msgs).map(([k, v]) => [k, encodeFrame(v)]));

// ─── State Fixture ──────────────────────────────────────────────────────────

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    instance_uid: new Uint8Array(16).fill(0xab),
    tenant_id: "bench-tenant",
    config_id: "bench-config",
    sequence_num: 41,
    generation: 1,
    healthy: true,
    status: "running",
    last_error: "",
    current_config_hash: new Uint8Array(32).fill(0xcc),
    desired_config_hash: new Uint8Array(32).fill(0xcc), // same = no push
    effective_config_hash: "aabbccdd",
    effective_config_body: null,
    last_seen_at: Date.now() - 30_000,
    connected_at: Date.now() - 3600_000,
    agent_description: '{"identifying_attributes":[]}',
    capabilities:
      AgentCapabilities.ReportsStatus |
      AgentCapabilities.AcceptsRemoteConfig |
      AgentCapabilities.ReportsHealth,
    component_health_map: null,
    available_components: null,
    config_fail_count: 0,
    config_last_failed_hash: null,
    ...overrides,
  };
}

// ─── Full Pipeline Benchmarks ───────────────────────────────────────────────

// `processFrame` mutates `AgentState` (sequence_num, hashes, status, etc.),
// so each bench callback rebuilds a fresh state from `makeState()`. Reusing
// one state across iterations measured stale-frame / already-applied paths
// instead of the intended scenario.

describe("Full Pipeline: decode → processFrame → encode (JSON→JSON)", () => {
  bench("heartbeat (hot path)", async () => {
    const state = makeState();
    const msg = decodeAgentToServer(jsonFrames.heartbeat, "json");
    const result = await processFrame(state, msg, null);
    if (result.response) encodeServerToAgent(result.response, "json");
  });

  bench("health report (no components)", async () => {
    const state = makeState();
    const msg = decodeAgentToServer(jsonFrames.healthyReport, "json");
    const result = await processFrame(state, msg, null);
    if (result.response) encodeServerToAgent(result.response, "json");
  });

  bench("health report (3 components)", async () => {
    const state = makeState();
    const msg = decodeAgentToServer(jsonFrames.unhealthyWithComponents, "json");
    const result = await processFrame(state, msg, null);
    if (result.response) encodeServerToAgent(result.response, "json");
  });

  bench("effective config (10KB)", async () => {
    const state = makeState();
    const msg = decodeAgentToServer(jsonFrames.effectiveConfigLarge, "json");
    const result = await processFrame(state, msg, null);
    if (result.response) encodeServerToAgent(result.response, "json");
  });

  bench("agent disconnect", async () => {
    const state = makeState();
    const msg = decodeAgentToServer(jsonFrames.agentDisconnect, "json");
    const result = await processFrame(state, msg, null);
    if (result.response) encodeServerToAgent(result.response, "json");
  });
});

describe("Full Pipeline: decode → processFrame → encode (protobuf→protobuf)", () => {
  // For protobuf pipeline, we need protobuf-encoded input frames.
  // We don't have an AgentToServer protobuf ENCODER (only decoder),
  // so we benchmark the decode+process+encode with JSON input but protobuf output.
  // This still exercises the protobuf encoder which is the server's hot path.
  bench("heartbeat → protobuf response", async () => {
    const state = makeState();
    const msg = decodeAgentToServer(jsonFrames.heartbeat, "json");
    const result = await processFrame(state, msg, null);
    if (result.response) encodeServerToAgentProto(result.response);
  });

  bench("health + components → protobuf response", async () => {
    const state = makeState();
    const msg = decodeAgentToServer(jsonFrames.unhealthyWithComponents, "json");
    const result = await processFrame(state, msg, null);
    if (result.response) encodeServerToAgentProto(result.response);
  });
});

describe("Full Pipeline: config push scenario", () => {
  const configBytes = new Uint8Array(2048).fill(0x61); // 2KB YAML
  const pushState = () =>
    makeState({
      current_config_hash: new Uint8Array(32).fill(0xaa), // mismatch
      desired_config_hash: new Uint8Array(32).fill(0xbb),
    });

  bench("heartbeat + config push (2KB) → JSON", async () => {
    const state = pushState();
    const msg = decodeAgentToServer(jsonFrames.heartbeat, "json");
    const result = await processFrame(state, msg, configBytes);
    if (result.response) encodeServerToAgent(result.response, "json");
  });

  bench("heartbeat + config push (2KB) → protobuf", async () => {
    const state = pushState();
    const msg = decodeAgentToServer(jsonFrames.heartbeat, "json");
    const result = await processFrame(state, msg, configBytes);
    if (result.response) encodeServerToAgentProto(result.response);
  });
});

describe("Throughput: N messages/second estimate", () => {
  // This helps us understand maximum throughput for a single DO instance
  const state = makeState();
  let seq = 41;

  bench("100 sequential heartbeats (burst)", async () => {
    for (let i = 0; i < 100; i++) {
      seq++;
      const msg = decodeAgentToServer(jsonFrames.heartbeat, "json");
      // Override sequence_num to avoid gap detection
      msg.sequence_num = seq;
      const result = await processFrame({ ...state, sequence_num: seq - 1 }, msg, null);
      if (result.response) encodeServerToAgent(result.response, "json");
    }
  });
});
