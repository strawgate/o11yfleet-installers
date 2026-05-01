/**
 * Codec Decode Benchmarks
 *
 * Measures decoding performance for every message shape an agent can send.
 * Currently covers JSON framing only (protobuf decode benchmarks need
 * a dedicated AgentToServer proto encoder — see oracle tests for proto coverage).
 */
import { bench, describe } from "vitest";
import { decodeFrame, encodeFrame } from "../src/codec/framing.js";
import { decodeAgentToServer } from "../src/codec/decoder.js";
import type { AgentToServer } from "../src/codec/types.js";
import { makeMessages } from "./fixtures.js";

const msgs = makeMessages();

// Pre-encode all message shapes in JSON format
const jsonFrames = Object.fromEntries(Object.entries(msgs).map(([k, v]) => [k, encodeFrame(v)]));

// Pre-encode all message shapes in protobuf format
// We encode as JSON and re-decode to simulate — but for protobuf we need actual proto encoding.
// Since we don't have an AgentToServer proto encoder, we benchmark JSON decode + proto decode separately.
// For proto decode benchmarks, we use the JSON-encoded frames (decode path is the same entry point).

describe("JSON Decode — by message shape", () => {
  bench("heartbeat (minimal)", () => {
    decodeFrame<AgentToServer>(jsonFrames.heartbeat);
  });

  bench("hello (with agent_description)", () => {
    decodeFrame<AgentToServer>(jsonFrames.hello);
  });

  bench("health report (healthy)", () => {
    decodeFrame<AgentToServer>(jsonFrames.healthyReport);
  });

  bench("health report (unhealthy + component_health_map)", () => {
    decodeFrame<AgentToServer>(jsonFrames.unhealthyWithComponents);
  });

  bench("effective config (small)", () => {
    decodeFrame<AgentToServer>(jsonFrames.effectiveConfigSmall);
  });

  bench("effective config (large 10KB)", () => {
    decodeFrame<AgentToServer>(jsonFrames.effectiveConfigLarge);
  });

  bench("remote config status", () => {
    decodeFrame<AgentToServer>(jsonFrames.remoteConfigStatus);
  });

  bench("available_components (5 components)", () => {
    decodeFrame<AgentToServer>(jsonFrames.availableComponents);
  });

  bench("connection_settings_status", () => {
    decodeFrame<AgentToServer>(jsonFrames.connectionSettingsStatus);
  });

  bench("agent disconnect", () => {
    decodeFrame<AgentToServer>(jsonFrames.agentDisconnect);
  });
});

describe("Full Decode Pipeline (detectCodecFormat + decode)", () => {
  bench("decodeAgentToServer — heartbeat (JSON)", () => {
    decodeAgentToServer(jsonFrames.heartbeat);
  });

  bench("decodeAgentToServer — hello (JSON)", () => {
    decodeAgentToServer(jsonFrames.hello);
  });

  bench("decodeAgentToServer — health + components (JSON)", () => {
    decodeAgentToServer(jsonFrames.unhealthyWithComponents);
  });

  bench("decodeAgentToServer — effective config large (JSON)", () => {
    decodeAgentToServer(jsonFrames.effectiveConfigLarge);
  });
});
