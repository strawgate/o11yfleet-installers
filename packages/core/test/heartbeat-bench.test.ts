/**
 * Heartbeat hot-path microbenchmark.
 *
 * Measures the CPU cost of each step that happens on every heartbeat message
 * in the Durable Object, so we can calculate max agents per DO.
 *
 * Target: 250K agents @ 3600s heartbeat = 69 msg/s  (zero-wake model)
 * Budget: < 14ms per message (to stay under DO CPU limits)
 *
 * Note: JSON framing has been removed (PERF-CRIT-20). All codec operations
 * now use protobuf only.
 */

import { describe, it, expect } from "vitest";
import {
  encodeServerToAgentProto,
  encodeAgentToServerProto,
  isProtobufFrame,
} from "../src/codec/protobuf.js";
import { processFrame, DEFAULT_HEARTBEAT_INTERVAL_NS } from "../src/state-machine/processor.js";
import type { AgentState } from "../src/state-machine/types.js";
import type { AgentToServer, ServerToAgent } from "../src/codec/types.js";
import { AgentCapabilities, ServerCapabilities, ServerToAgentFlags } from "../src/codec/types.js";
import { decodeAgentToServer } from "../src/codec/decoder.js";

function makeHeartbeatMsg(seq: number): AgentToServer {
  return {
    instance_uid: new Uint8Array(16).fill(0xab),
    sequence_num: seq,
    capabilities:
      AgentCapabilities.ReportsStatus |
      AgentCapabilities.AcceptsRemoteConfig |
      AgentCapabilities.ReportsHealth,
    flags: 0,
  };
}

function makeHeartbeatResponse(): ServerToAgent {
  return {
    instance_uid: new Uint8Array(16).fill(0xab),
    flags: ServerToAgentFlags.Unspecified,
    capabilities:
      ServerCapabilities.AcceptsStatus |
      ServerCapabilities.OffersRemoteConfig |
      ServerCapabilities.AcceptsEffectiveConfig,
    heart_beat_interval: DEFAULT_HEARTBEAT_INTERVAL_NS,
  };
}

function makeAgentState(seq: number): AgentState {
  return {
    instance_uid: new Uint8Array(16).fill(0xab),
    tenant_id: "tenant-123",
    config_id: "config-456",
    sequence_num: seq,
    generation: 1,
    healthy: true,
    status: "running",
    last_error: "",
    current_config_hash: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    desired_config_hash: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    effective_config_hash: "abcd1234",
    effective_config_body: null,
    last_seen_at: Date.now() - 30_000,
    connected_at: Date.now() - 3600_000,
    agent_description:
      '{"identifying_attributes":[{"key":"service.name","value":{"string_value":"test"}}]}',
    capabilities:
      AgentCapabilities.ReportsStatus |
      AgentCapabilities.AcceptsRemoteConfig |
      AgentCapabilities.ReportsHealth,
    component_health_map: null,
    available_components: null,
    config_fail_count: 0,
    config_last_failed_hash: null,
  };
}

async function bench(
  name: string,
  fn: () => unknown,
  iterations = 10_000,
): Promise<{ opsPerSec: number; avgNs: number }> {
  for (let i = 0; i < 100; i++) await fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) await fn();
  const elapsed = performance.now() - start;

  const avgMs = elapsed / iterations;
  return {
    opsPerSec: Math.round(1000 / avgMs),
    avgNs: Math.round(avgMs * 1000),
  };
}

describe("Heartbeat hot-path benchmark", () => {
  it("measures each step of the heartbeat pipeline", async () => {
    const msg = makeHeartbeatMsg(42);
    const state = makeAgentState(41);

    const protoEncodedHeartbeat = encodeAgentToServerProto(msg);

    const protoResponse = makeHeartbeatResponse();
    const r1 = await bench("Proto encode (AgentToServer)", () => encodeAgentToServerProto(msg));

    const r2encode = await bench("Proto encode (ServerToAgent)", () =>
      encodeServerToAgentProto(protoResponse),
    );

    const r3 = await bench("isProtobufFrame (Proto frame)", () =>
      isProtobufFrame(protoEncodedHeartbeat),
    );

    const r4 = await bench("decodeAgentToServer (Proto)", () =>
      decodeAgentToServer(protoEncodedHeartbeat),
    );

    const r5 = await bench("processFrame (heartbeat)", () => processFrame(state, msg, null));

    const r6 = await bench("Proto encode (ServerToAgent)", () =>
      encodeServerToAgentProto(protoResponse),
    );

    const fullPipeline = async () => {
      const decoded = decodeAgentToServer(protoEncodedHeartbeat);
      const result = await processFrame(state, decoded, null);
      if (result.response) encodeServerToAgentProto(result.response);
    };
    const r7 = await bench("Full pipeline (Proto)", fullPipeline);

    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log("║       Heartbeat Hot-Path Microbenchmark (Protobuf-only)     ║");
    console.log("╠══════════════════════════════════════════════════════════════╣");
    console.log(
      `║ Proto encode (AgentToServer)    │ ${String(r1.avgNs).padStart(7)}ns │ ${String(r1.opsPerSec).padStart(10)} ops/s ║`,
    );
    console.log(
      `║ Proto encode (ServerToAgent)   │ ${String(r2encode.avgNs).padStart(7)}ns │ ${String(r2encode.opsPerSec).padStart(10)} ops/s ║`,
    );
    console.log(
      `║ isProtobufFrame (Proto)          │ ${String(r3.avgNs).padStart(7)}ns │ ${String(r3.opsPerSec).padStart(10)} ops/s ║`,
    );
    console.log(
      `║ decodeAgentToServer (Proto)     │ ${String(r4.avgNs).padStart(7)}ns │ ${String(r4.opsPerSec).padStart(10)} ops/s ║`,
    );
    console.log(
      `║ processFrame (heartbeat)         │ ${String(r5.avgNs).padStart(7)}ns │ ${String(r5.opsPerSec).padStart(10)} ops/s ║`,
    );
    console.log(
      `║ Proto encode (ServerToAgent)    │ ${String(r6.avgNs).padStart(7)}ns │ ${String(r6.opsPerSec).padStart(10)} ops/s ║`,
    );
    console.log("╠══════════════════════════════════════════════════════════════╣");
    console.log(
      `║ Full pipeline (Proto)            │ ${String(r7.avgNs).padStart(7)}ns │ ${String(r7.opsPerSec).padStart(10)} ops/s ║`,
    );
    console.log("╚══════════════════════════════════════════════════════════════╝");

    const totalProtoNs = r4.avgNs + r5.avgNs + r6.avgNs;
    console.log(`\nEstimated per-heartbeat CPU (excl. SQL + WS send):`);
    console.log(`  Proto path: ~${totalProtoNs}ns (${(totalProtoNs / 1000).toFixed(1)}µs)`);

    const msgPerSec = Math.floor(250_000 / 3600);
    const budgetNsPerMsg = Math.floor(1_000_000_000 / msgPerSec);
    console.log(`\n250K agents @ 3600s heartbeat = ${msgPerSec} msg/s`);
    console.log(
      `CPU budget per message: ${budgetNsPerMsg}ns (${(budgetNsPerMsg / 1000).toFixed(0)}µs)`,
    );
    console.log(
      `Proto headroom: ${(((budgetNsPerMsg - totalProtoNs) / budgetNsPerMsg) * 100).toFixed(0)}%`,
    );

    expect(r1.opsPerSec).toBeGreaterThan(0);
  });

  it("verifies pure heartbeat produces no events and minimal state change", async () => {
    const msg = makeHeartbeatMsg(42);
    const state = makeAgentState(41);

    const result = await processFrame(state, msg, null);

    expect(result.shouldPersist).toBe(false); // no-op → tracked in WS attachment
    expect(result.events).toHaveLength(0);
    expect(result.response?.heart_beat_interval).toBe(DEFAULT_HEARTBEAT_INTERVAL_NS);
    expect(result.newState.sequence_num).toBe(42);
  });
});
