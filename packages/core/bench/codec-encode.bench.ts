/**
 * Codec Encode Benchmarks
 *
 * Measures encoding performance for ServerToAgent responses across all shapes.
 * Covers both JSON framing and protobuf wire format.
 */
import { bench, describe } from "vitest";
import { encodeFrame } from "../src/codec/framing.js";
import { encodeServerToAgent } from "../src/codec/decoder.js";
import { encodeServerToAgentProto } from "../src/codec/protobuf.js";
import type { ServerToAgent } from "../src/codec/types.js";
import {
  ServerCapabilities,
  ServerToAgentFlags,
  CommandType,
  ServerErrorResponseType,
} from "../src/codec/types.js";
import { DEFAULT_HEARTBEAT_INTERVAL_NS } from "../src/state-machine/processor.js";

const CAPABILITIES =
  ServerCapabilities.AcceptsStatus |
  ServerCapabilities.OffersRemoteConfig |
  ServerCapabilities.AcceptsEffectiveConfig |
  ServerCapabilities.OffersConnectionSettings;

const uid = new Uint8Array(16).fill(0xab);

// ─── Response Fixtures ──────────────────────────────────────────────────────

const heartbeatResponse: ServerToAgent = {
  instance_uid: uid,
  flags: ServerToAgentFlags.Unspecified,
  capabilities: CAPABILITIES,
  heart_beat_interval: DEFAULT_HEARTBEAT_INTERVAL_NS,
};

const reportFullStateResponse: ServerToAgent = {
  instance_uid: uid,
  flags: ServerToAgentFlags.ReportFullState,
  capabilities: CAPABILITIES,
  heart_beat_interval: DEFAULT_HEARTBEAT_INTERVAL_NS,
};

const configPushResponse: ServerToAgent = {
  instance_uid: uid,
  flags: ServerToAgentFlags.Unspecified,
  capabilities: CAPABILITIES,
  heart_beat_interval: DEFAULT_HEARTBEAT_INTERVAL_NS,
  remote_config: {
    config: {
      config_map: {
        "collector.yaml": {
          body: new Uint8Array(2048).fill(0x61), // 2KB config
          content_type: "application/yaml",
        },
      },
    },
    config_hash: new Uint8Array(32).fill(0xcc),
  },
};

const largeConfigPushResponse: ServerToAgent = {
  instance_uid: uid,
  flags: ServerToAgentFlags.Unspecified,
  capabilities: CAPABILITIES,
  remote_config: {
    config: {
      config_map: {
        "collector.yaml": {
          body: new Uint8Array(10240).fill(0x61), // 10KB config
          content_type: "application/yaml",
        },
        "exporters.yaml": {
          body: new Uint8Array(4096).fill(0x62), // 4KB
          content_type: "application/yaml",
        },
      },
    },
    config_hash: new Uint8Array(32).fill(0xdd),
  },
};

const connectionSettingsResponse: ServerToAgent = {
  instance_uid: uid,
  flags: ServerToAgentFlags.Unspecified,
  capabilities: CAPABILITIES,
  connection_settings: {
    hash: new Uint8Array(32).fill(0xee),
    opamp: {
      headers: [
        { key: "Authorization", value: "Bearer eyJhbGciOiJIUzI1NiJ9.dGVzdA.signed-token-value" },
      ],
      heartbeat_interval_seconds: 3600,
    },
  },
};

const agentIdentificationResponse: ServerToAgent = {
  instance_uid: uid,
  flags: ServerToAgentFlags.Unspecified,
  capabilities: CAPABILITIES,
  agent_identification: {
    new_instance_uid: new Uint8Array(16).fill(0xff),
  },
};

const commandResponse: ServerToAgent = {
  instance_uid: uid,
  flags: ServerToAgentFlags.Unspecified,
  capabilities: CAPABILITIES,
  command: { type: CommandType.Restart },
};

const errorResponse: ServerToAgent = {
  instance_uid: uid,
  flags: ServerToAgentFlags.Unspecified,
  capabilities: CAPABILITIES,
  error_response: {
    type: ServerErrorResponseType.Unavailable,
    error_message: "Rate limit exceeded — retry after 30s",
    retry_info: { retry_after_nanoseconds: 30000000000n },
  },
};

// ─── Benchmarks ─────────────────────────────────────────────────────────────

describe("JSON Encode — ServerToAgent by shape", () => {
  bench("heartbeat ack", () => {
    encodeFrame(heartbeatResponse);
  });

  bench("report full state", () => {
    encodeFrame(reportFullStateResponse);
  });

  bench("config push (2KB)", () => {
    encodeFrame(configPushResponse);
  });

  bench("config push (14KB multi-file)", () => {
    encodeFrame(largeConfigPushResponse);
  });

  bench("connection_settings offer", () => {
    encodeFrame(connectionSettingsResponse);
  });

  bench("agent_identification (new UID)", () => {
    encodeFrame(agentIdentificationResponse);
  });

  bench("command (restart)", () => {
    encodeFrame(commandResponse);
  });

  bench("error_response with retry_info", () => {
    encodeFrame(errorResponse);
  });
});

describe("Protobuf Encode — ServerToAgent by shape", () => {
  bench("heartbeat ack", () => {
    encodeServerToAgentProto(heartbeatResponse);
  });

  bench("config push (2KB)", () => {
    encodeServerToAgentProto(configPushResponse);
  });

  bench("config push (14KB multi-file)", () => {
    encodeServerToAgentProto(largeConfigPushResponse);
  });

  bench("connection_settings offer", () => {
    encodeServerToAgentProto(connectionSettingsResponse);
  });

  bench("agent_identification (new UID)", () => {
    encodeServerToAgentProto(agentIdentificationResponse);
  });

  bench("command (restart)", () => {
    encodeServerToAgentProto(commandResponse);
  });

  bench("error_response with retry_info", () => {
    encodeServerToAgentProto(errorResponse);
  });
});

describe("encodeServerToAgent — format comparison", () => {
  bench("heartbeat ack — JSON", () => {
    encodeServerToAgent(heartbeatResponse, "json");
  });

  bench("heartbeat ack — protobuf", () => {
    encodeServerToAgent(heartbeatResponse, "protobuf");
  });

  bench("config push 2KB — JSON", () => {
    encodeServerToAgent(configPushResponse, "json");
  });

  bench("config push 2KB — protobuf", () => {
    encodeServerToAgent(configPushResponse, "protobuf");
  });

  bench("connection_settings — JSON", () => {
    encodeServerToAgent(connectionSettingsResponse, "json");
  });

  bench("connection_settings — protobuf", () => {
    encodeServerToAgent(connectionSettingsResponse, "protobuf");
  });
});
