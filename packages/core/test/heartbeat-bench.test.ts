/**
 * Heartbeat hot-path microbenchmark.
 *
 * Measures the CPU cost of each step that happens on every heartbeat message
 * in the Durable Object, so we can calculate max agents per DO.
 *
 * Target: 250K agents @ 3600s heartbeat = 69 msg/s  (zero-wake model)
 * Budget: < 14ms per message (to stay under DO CPU limits)
 */

import { describe, it, expect } from "vitest";
import { encodeFrame, decodeFrame } from "../src/codec/framing.js";
import { encodeServerToAgentProto, isProtobufFrame } from "../src/codec/protobuf.js";
import { processFrame, DEFAULT_HEARTBEAT_INTERVAL_NS } from "../src/state-machine/processor.js";
import type { AgentState } from "../src/state-machine/types.js";
import type { AgentToServer, ServerToAgent } from "../src/codec/types.js";
import { AgentCapabilities, ServerCapabilities, ServerToAgentFlags } from "../src/codec/types.js";
import {
  detectCodecFormat,
  encodeServerToAgent,
  decodeAgentToServer,
} from "../src/codec/decoder.js";

// Build a realistic heartbeat message (what FakeOpampAgent.sendHeartbeat sends)
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

// Build a realistic heartbeat response (what processFrame returns)
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

// Build a realistic AgentState (what loadAgentState returns from SQLite)
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
    desired_config_hash: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), // same = no push
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
  };
}

async function bench(
  name: string,
  fn: () => unknown,
  iterations = 10_000,
): Promise<{ opsPerSec: number; avgNs: number }> {
  // Warm up
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
    const state = makeAgentState(41); // seq - 1 so it matches

    // Step 1: JSON encode (what FakeOpampAgent does)
    const jsonEncoded = encodeFrame(msg);
    const r1 = await bench("JSON encode (AgentToServer)", () => encodeFrame(msg));

    // Step 2: Protobuf encode (what real OTel Collectors do)
    // We don't have a direct AgentToServer proto encoder, so test the response encode
    const protoResponse = makeHeartbeatResponse();
    const protoEncoded = encodeServerToAgentProto(protoResponse);
    const r2encode = await bench("Proto encode (ServerToAgent)", () =>
      encodeServerToAgentProto(protoResponse),
    );

    // Step 3: Format detection
    const r3json = await bench("detectCodecFormat (JSON frame)", () =>
      detectCodecFormat(jsonEncoded),
    );
    const r3proto = await bench("isProtobufFrame (Proto frame)", () =>
      isProtobufFrame(protoEncoded),
    );

    // Step 4: JSON decode
    const r4 = await bench("JSON decode (AgentToServer)", () =>
      decodeFrame<AgentToServer>(jsonEncoded),
    );

    // Step 5: Full decode with format detection (JSON path)
    const r5json = await bench("decodeAgentToServer (JSON)", () =>
      decodeAgentToServer(jsonEncoded),
    );

    // Step 6: processFrame (pure function — the state machine)
    const r6 = await bench("processFrame (heartbeat)", () => processFrame(state, msg, null));

    // Step 7: JSON encode response
    const response = makeHeartbeatResponse();
    const r7json = await bench("JSON encode (ServerToAgent)", () => encodeFrame(response));
    const r7proto = await bench("Proto encode (ServerToAgent)", () =>
      encodeServerToAgentProto(response),
    );

    // Step 8: Full pipeline (decode + processFrame + encode response) — JSON path
    const r8json = await bench("Full pipeline (JSON)", async () => {
      const decoded = decodeFrame<AgentToServer>(jsonEncoded);
      const result = await processFrame(state, decoded, null);
      if (result.response) encodeFrame(result.response);
    });

    // Step 9: Full pipeline — Protobuf decode path
    // Create a protobuf-encoded heartbeat using the AgentToServer proto encoder
    // We need to build one manually since we only have the JSON framing encoder for AgentToServer
    const r9 = await bench("encodeServerToAgent (full, proto)", () =>
      encodeServerToAgent(response, "protobuf"),
    );
    const r9json_full = await bench("encodeServerToAgent (full, json)", () =>
      encodeServerToAgent(response, "json"),
    );

    // Print results
    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log("║       Heartbeat Hot-Path Microbenchmark                     ║");
    console.log("╠══════════════════════════════════════════════════════════════╣");
    console.log(
      `║ JSON encode (AgentToServer)     │ ${String(r1.avgNs).padStart(7)}ns │ ${String(r1.opsPerSec).padStart(10)} ops/s ║`,
    );
    console.log(
      `║ Proto encode (ServerToAgent)    │ ${String(r2encode.avgNs).padStart(7)}ns │ ${String(r2encode.opsPerSec).padStart(10)} ops/s ║`,
    );
    console.log(
      `║ detectCodecFormat (JSON)        │ ${String(r3json.avgNs).padStart(7)}ns │ ${String(r3json.opsPerSec).padStart(10)} ops/s ║`,
    );
    console.log(
      `║ detectCodecFormat (Proto)       │ ${String(r3proto.avgNs).padStart(7)}ns │ ${String(r3proto.opsPerSec).padStart(10)} ops/s ║`,
    );
    console.log(
      `║ JSON decode (AgentToServer)     │ ${String(r4.avgNs).padStart(7)}ns │ ${String(r4.opsPerSec).padStart(10)} ops/s ║`,
    );
    console.log(
      `║ decodeAgentToServer (JSON full) │ ${String(r5json.avgNs).padStart(7)}ns │ ${String(r5json.opsPerSec).padStart(10)} ops/s ║`,
    );
    console.log(
      `║ processFrame (heartbeat)        │ ${String(r6.avgNs).padStart(7)}ns │ ${String(r6.opsPerSec).padStart(10)} ops/s ║`,
    );
    console.log(
      `║ JSON encode (ServerToAgent)     │ ${String(r7json.avgNs).padStart(7)}ns │ ${String(r7json.opsPerSec).padStart(10)} ops/s ║`,
    );
    console.log(
      `║ Proto encode (ServerToAgent)    │ ${String(r7proto.avgNs).padStart(7)}ns │ ${String(r7proto.opsPerSec).padStart(10)} ops/s ║`,
    );
    console.log("╠══════════════════════════════════════════════════════════════╣");
    console.log(
      `║ Full pipeline (JSON path)       │ ${String(r8json.avgNs).padStart(7)}ns │ ${String(r8json.opsPerSec).padStart(10)} ops/s ║`,
    );
    console.log(
      `║ encodeServerToAgent (proto)     │ ${String(r9.avgNs).padStart(7)}ns │ ${String(r9.opsPerSec).padStart(10)} ops/s ║`,
    );
    console.log(
      `║ encodeServerToAgent (json)      │ ${String(r9json_full.avgNs).padStart(7)}ns │ ${String(r9json_full.opsPerSec).padStart(10)} ops/s ║`,
    );
    console.log("╚══════════════════════════════════════════════════════════════╝");

    const totalJsonNs = r5json.avgNs + r6.avgNs + r7json.avgNs;
    const totalProtoNs = r5json.avgNs + r6.avgNs + r7proto.avgNs; // approx
    console.log(`\nEstimated per-heartbeat CPU (excl. SQL + WS send):`);
    console.log(`  JSON path:  ~${totalJsonNs}ns (${(totalJsonNs / 1000).toFixed(1)}µs)`);
    console.log(`  Proto path: ~${totalProtoNs}ns (${(totalProtoNs / 1000).toFixed(1)}µs)`);

    const msgPerSec = Math.floor(250_000 / 3600);
    const budgetNsPerMsg = Math.floor(1_000_000_000 / msgPerSec);
    console.log(`\n250K agents @ 3600s heartbeat = ${msgPerSec} msg/s`);
    console.log(
      `CPU budget per message: ${budgetNsPerMsg}ns (${(budgetNsPerMsg / 1000).toFixed(0)}µs)`,
    );
    console.log(
      `JSON headroom: ${(((budgetNsPerMsg - totalJsonNs) / budgetNsPerMsg) * 100).toFixed(0)}%`,
    );

    // The test passes — this is a benchmark, not a correctness test
    expect(r1.opsPerSec).toBeGreaterThan(0);
  });

  it("verifies pure heartbeat produces no events and minimal state change", async () => {
    const msg = makeHeartbeatMsg(42);
    const state = makeAgentState(41);

    const result = await processFrame(state, msg, null);

    // Should persist (sequence_num + last_seen_at update)
    expect(result.shouldPersist).toBe(true);
    // No events for a pure heartbeat
    expect(result.events).toHaveLength(0);
    // Response should include heartbeat interval
    expect(result.response?.heart_beat_interval).toBe(DEFAULT_HEARTBEAT_INTERVAL_NS);
    // Sequence number updated
    expect(result.newState.sequence_num).toBe(42);
  });
});
