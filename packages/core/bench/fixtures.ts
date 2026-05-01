/**
 * Benchmark Fixtures — realistic message shapes for all OpAMP message types.
 *
 * Each fixture represents a real-world message that would be received from
 * an OTel Collector or sent by the server.
 */
import type { AgentToServer } from "../src/codec/types.js";
import { AgentCapabilities } from "../src/codec/types.js";

const uid = new Uint8Array(16).fill(0xab);

/**
 * Returns a map of all AgentToServer message shapes we can encounter in production.
 */
export function makeMessages(): Record<string, AgentToServer> {
  return {
    // Minimal heartbeat — the most common message (hot path)
    heartbeat: {
      instance_uid: uid,
      sequence_num: 42,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsHealth,
      flags: 0,
    },

    // First connection hello with full agent description
    hello: {
      instance_uid: uid,
      sequence_num: 0,
      capabilities:
        AgentCapabilities.ReportsStatus |
        AgentCapabilities.AcceptsRemoteConfig |
        AgentCapabilities.ReportsEffectiveConfig |
        AgentCapabilities.ReportsHealth |
        AgentCapabilities.ReportsRemoteConfig |
        AgentCapabilities.ReportsHeartbeat,
      flags: 0,
      agent_description: {
        identifying_attributes: [
          { key: "service.name", value: { string_value: "io.opentelemetry.collector" } },
          { key: "service.version", value: { string_value: "0.96.0" } },
          { key: "service.instance.id", value: { string_value: "collector-pod-abc123" } },
        ],
        non_identifying_attributes: [
          { key: "os.type", value: { string_value: "linux" } },
          { key: "os.version", value: { string_value: "6.1.0" } },
          { key: "host.arch", value: { string_value: "amd64" } },
          { key: "host.name", value: { string_value: "k8s-node-42" } },
          { key: "cloud.provider", value: { string_value: "aws" } },
          { key: "cloud.region", value: { string_value: "us-east-1" } },
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
    },

    // Health report — agent is healthy, no components
    healthyReport: {
      instance_uid: uid,
      sequence_num: 42,
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
    },

    // Unhealthy report with 3 component health entries
    unhealthyWithComponents: {
      instance_uid: uid,
      sequence_num: 42,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsHealth,
      flags: 0,
      health: {
        healthy: false,
        start_time_unix_nano: 1700000000000000000n,
        last_error: "exporter/otlp: connection refused to backend:4317",
        status: "degraded",
        status_time_unix_nano: 1700000001000000000n,
        component_health_map: {
          "receiver/otlp": {
            healthy: true,
            start_time_unix_nano: 1700000000000000000n,
            last_error: "",
            status: "running",
            status_time_unix_nano: 1700000000100000000n,
            component_health_map: {},
          },
          "processor/batch": {
            healthy: true,
            start_time_unix_nano: 1700000000000000000n,
            last_error: "",
            status: "running",
            status_time_unix_nano: 1700000000200000000n,
            component_health_map: {},
          },
          "exporter/otlp": {
            healthy: false,
            start_time_unix_nano: 1700000000000000000n,
            last_error: "connection refused to backend:4317",
            status: "error",
            status_time_unix_nano: 1700000001000000000n,
            component_health_map: {},
          },
        },
      },
    },

    // Effective config — small (500 bytes YAML).
    // `processFrame` reads `msg.effective_config?.config_map?.config_map`, so
    // the file map lives one level deeper than the wrapper — without the
    // nested `config_map` field the bench skips the TextDecoder + hash path.
    effectiveConfigSmall: {
      instance_uid: uid,
      sequence_num: 42,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsEffectiveConfig,
      flags: 0,
      effective_config: {
        config_map: {
          config_map: {
            "": {
              body: new Uint8Array(512).fill(0x61),
              content_type: "application/yaml",
            },
          },
        },
        hash: new Uint8Array(32).fill(0xaa),
      },
    },

    // Effective config — large (10KB YAML, realistic production config)
    effectiveConfigLarge: {
      instance_uid: uid,
      sequence_num: 42,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsEffectiveConfig,
      flags: 0,
      effective_config: {
        config_map: {
          config_map: {
            "": {
              body: new Uint8Array(10240).fill(0x61),
              content_type: "application/yaml",
            },
          },
        },
        hash: new Uint8Array(32).fill(0xbb),
      },
    },

    // Remote config status (APPLYING)
    remoteConfigStatus: {
      instance_uid: uid,
      sequence_num: 42,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsRemoteConfig,
      flags: 0,
      remote_config_status: {
        last_remote_config_hash: new Uint8Array(32).fill(0xcc),
        status: 1, // APPLYING
        error_message: "",
      },
    },

    // Available components (5 components — typical OTel Collector)
    availableComponents: {
      instance_uid: uid,
      sequence_num: 42,
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
        hash: new Uint8Array(32).fill(0xdd),
      },
    },

    // Connection settings status
    connectionSettingsStatus: {
      instance_uid: uid,
      sequence_num: 42,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
      connection_settings_status: {
        status: 1, // Applied
      },
    },

    // Agent disconnect (last message before close)
    agentDisconnect: {
      instance_uid: uid,
      sequence_num: 43,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
      agent_disconnect: {},
    },
  };
}
