/**
 * Codec Decode Benchmarks
 *
 * Measures decoding performance for every message shape an agent can send.
 * Covers JSON framing decode and protobuf minimal/full decode hot paths.
 */
import { bench, describe } from "vitest";
import { decodeFrame, encodeFrame } from "../src/codec/framing.js";
import { decodeAgentToServer, encodeAgentToServer } from "../src/codec/decoder.js";
import { decodeAgentToServerMinimal } from "../src/codec/protobuf.js";
import type { AgentToServer } from "../src/codec/types.js";
import { makeMessages } from "./fixtures.js";

const msgs = makeMessages();

// Pre-encode all message shapes in JSON format
const jsonFrames = Object.fromEntries(Object.entries(msgs).map(([k, v]) => [k, encodeFrame(v)]));

// Pre-encode selected message shapes in protobuf format for minimal/full decode benchmarks.

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

describe("Minimal Decode Hot Path (Protobuf)", () => {
  // Encode heartbeat as protobuf for minimal decode test
  const protoHeartbeat = encodeAgentToServer(msgs.heartbeat);
  const protoHello = encodeAgentToServer(msgs.hello);
  const protoHealthReport = encodeAgentToServer(msgs.unhealthyWithComponents);

  bench("decodeAgentToServerMinimal — heartbeat (no optionals)", () => {
    decodeAgentToServerMinimal(protoHeartbeat);
  });

  bench("decodeAgentToServerMinimal — hello (has optionals, falls back to full)", () => {
    decodeAgentToServerMinimal(protoHello);
  });

  bench("decodeAgentToServerMinimal — health report (has optionals)", () => {
    decodeAgentToServerMinimal(protoHealthReport);
  });

  bench("Full decode for comparison — heartbeat", () => {
    decodeAgentToServer(protoHeartbeat);
  });

  bench("Full decode for comparison — hello", () => {
    decodeAgentToServer(protoHello);
  });
});
