// OpAMP test scenarios — single source of truth for canonical message shapes.
//
// A "scenario" is a named, deterministic recipe for building one OpAMP message
// (either AgentToServer or ServerToAgent) plus the metadata describing what it
// exercises. Test suites consume the scenarios uniformly:
//
//   - protobuf-codec.test.ts   round-trips encode → decode → compare
//   - reverse-oracle.test.ts   encodes with our codec, opamp-go decodes/verifies
//   - differential.test.ts     adds the TS direction symmetric with opamp-go
//                              fixtures (TS scenario → encode → decode → equal)
//   - opamp.test.ts            uses scenarios where it currently inlines messages
//
// Adding a new scenario adds it to every consumer at once, eliminating the
// drift bug class where a new field is exercised by some tests but not others
// (the §5.9 `command` decoder bug shape).
//
// Scenarios use a fixed `KNOWN_UID`, fixed test-version/host strings, etc. so
// repeated runs produce identical wire bytes for the message-level fields.
// Time-derived fields (start_time_unix_nano, etc.) come from the underlying
// builders and remain non-deterministic — that's fine for round-trip testing,
// and our fixture files are gitignored anyway.

import {
  CommandType,
  RemoteConfigStatuses,
  ServerCapabilities,
  ServerErrorResponseType,
  type AgentToServer,
  type ServerToAgent,
} from "@o11yfleet/core/codec";
import {
  buildConfigAck,
  buildDescriptionReport,
  buildDisconnect,
  buildHealthReport,
  buildHeartbeat,
  buildHello,
  CONFIGURABLE_CAPABILITIES,
} from "./opamp-messages.js";

/** Stable 16-byte UID used by every scenario for reproducibility. */
export const KNOWN_UID: Uint8Array = new Uint8Array([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
]);

/** Stable 16-byte UID used as the "new instance uid" in identification scenarios. */
export const REASSIGNED_UID: Uint8Array = new Uint8Array([
  0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99,
]);

export interface AgentScenario {
  /** Stable identifier — used as fixture filename, test name, etc. */
  name: string;
  /** One-line summary suitable for test output. */
  description: string;
  /** OpAMP spec sections this scenario primarily exercises. Bare numbering, no §. */
  specSections: readonly string[];
  /** Pure builder. Repeated calls return equivalent (modulo time) messages. */
  build: () => AgentToServer;
}

export interface ServerScenario {
  name: string;
  description: string;
  specSections: readonly string[];
  build: () => ServerToAgent;
}

// ─── AgentToServer scenarios ────────────────────────────────────────

export const AGENT_SCENARIOS: readonly AgentScenario[] = [
  {
    name: "hello",
    description: "Full hello/connect message matching real otelcol-contrib behavior.",
    specSections: ["4.2", "5.1", "5.2"],
    build: () =>
      buildHello({
        instanceUid: KNOWN_UID,
        name: "oracle-test-agent",
        hostname: "oracle-host",
        serviceVersion: "0.123.0",
      }),
  },
  {
    name: "heartbeat",
    description: "Minimal heartbeat — only required fields, no health or description.",
    specSections: ["4.3"],
    build: () => buildHeartbeat({ instanceUid: KNOWN_UID, sequenceNum: 42 }),
  },
  {
    name: "health-report",
    description: "Degraded health with last_error populated (§5.2).",
    specSections: ["5.2"],
    build: () =>
      buildHealthReport({
        instanceUid: KNOWN_UID,
        healthy: false,
        lastError: "OOM killed",
        status: "degraded",
      }),
  },
  {
    name: "config-ack",
    description: "Acknowledges an applied remote config with deterministic hash bytes.",
    specSections: ["5.3", "5.3.1"],
    build: () =>
      buildConfigAck({
        instanceUid: KNOWN_UID,
        configHash: new Uint8Array([0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89]),
      }),
  },
  {
    name: "config-ack-failed",
    description:
      "Reports config rejection with error_message — must round-trip the rejection reason.",
    specSections: ["5.3"],
    build: () =>
      buildConfigAck({
        instanceUid: KNOWN_UID,
        configHash: new Uint8Array([0xfa, 0x11, 0xed, 0x00]),
        status: RemoteConfigStatuses.FAILED,
        errorMessage: "validation failed: unknown receiver kafka",
      }),
  },
  {
    name: "config-ack-applying",
    description: "Reports the intermediate APPLYING state per §5.3.2.",
    specSections: ["5.3.2"],
    build: () =>
      buildConfigAck({
        instanceUid: KNOWN_UID,
        configHash: new Uint8Array([0x01, 0x02, 0x03, 0x04]),
        status: RemoteConfigStatuses.APPLYING,
      }),
  },
  {
    name: "description-report",
    description: "agent_description-only message (§5.1) without health or config.",
    specSections: ["5.1"],
    build: () =>
      buildDescriptionReport({
        instanceUid: KNOWN_UID,
        name: "description-agent",
        hostname: "prod-host-42",
        osType: "linux",
        arch: "amd64",
      }),
  },
  {
    name: "disconnect",
    description: "Graceful agent_disconnect signal — no health, no description, no config.",
    specSections: ["5.5"],
    build: () => buildDisconnect({ instanceUid: KNOWN_UID, sequenceNum: 99 }),
  },
  {
    name: "available-components",
    description:
      "Reports compiled-in components (§5.2.2). Wire-compat verified against opamp-go's AvailableComponents / ComponentDetails.",
    specSections: ["5.2.2"],
    build: () => ({
      instance_uid: KNOWN_UID,
      sequence_num: 0,
      capabilities: CONFIGURABLE_CAPABILITIES | REPORTS_AVAILABLE_COMPONENTS,
      flags: 0,
      available_components: {
        hash: new Uint8Array([0xfe, 0xed, 0xfa, 0xce, 0xde, 0xad, 0xbe, 0xef]),
        components: {
          receiver: {
            metadata: [],
            sub_component_map: {
              otlp: {
                metadata: [{ key: "version", value: { string_value: "0.123.0" } }],
                sub_component_map: {},
              },
              hostmetrics: { metadata: [], sub_component_map: {} },
            },
          },
          exporter: {
            metadata: [],
            sub_component_map: {
              otlp: { metadata: [], sub_component_map: {} },
            },
          },
        },
      },
    }),
  },
];

// ─── ServerToAgent scenarios ────────────────────────────────────────

export const SERVER_SCENARIOS: readonly ServerScenario[] = [
  {
    name: "server-command-restart",
    description:
      "Restart command (§5.9). Regression-guards the decoder bug where the `command` field was silently dropped on round-trip.",
    specSections: ["5.9"],
    build: () => ({
      instance_uid: KNOWN_UID,
      flags: 0,
      capabilities: ServerCapabilities.AcceptsStatus,
      command: { type: CommandType.Restart },
    }),
  },
  {
    name: "server-error-response",
    description:
      "BadRequest error_response with retry_info (§4.5). Regression-guards the historical `retry_info` decoder drop.",
    specSections: ["4.5"],
    build: () => ({
      instance_uid: KNOWN_UID,
      flags: 0,
      capabilities: ServerCapabilities.AcceptsStatus,
      error_response: {
        type: ServerErrorResponseType.BadRequest,
        error_message: "malformed AgentToServer",
        retry_info: { retry_after_nanoseconds: 5_000_000_000n },
      },
    }),
  },
  {
    name: "server-connection-settings",
    description:
      "ConnectionSettingsOffers with bearer header (§5.4). Regression-guards the historical `connection_settings` decoder drop.",
    specSections: ["5.4", "5.4.1"],
    build: () => ({
      instance_uid: KNOWN_UID,
      flags: 0,
      capabilities: ServerCapabilities.OffersConnectionSettings,
      connection_settings: {
        hash: new Uint8Array([0xc0, 0xff, 0xee, 0x00, 0xc0, 0xff, 0xee, 0x00]),
        opamp: {
          destination_endpoint: "wss://opamp.example.com/v1/opamp",
          heartbeat_interval_seconds: 30,
          headers: [{ key: "Authorization", value: "Bearer test-claim-xyz" }],
        },
      },
    }),
  },
  {
    name: "server-agent-identification",
    description: "Server reassigns the agent's instance UID (§5.1).",
    specSections: ["5.1"],
    build: () => ({
      instance_uid: KNOWN_UID,
      flags: 0,
      capabilities: ServerCapabilities.AcceptsStatus,
      agent_identification: { new_instance_uid: REASSIGNED_UID },
    }),
  },
  {
    name: "server-remote-config-push",
    description: "Server pushes a remote config with hash and YAML body (§5.3).",
    specSections: ["5.3"],
    build: () => ({
      instance_uid: KNOWN_UID,
      flags: 0,
      capabilities: ServerCapabilities.OffersRemoteConfig,
      remote_config: {
        config: {
          config_map: {
            "": {
              body: new TextEncoder().encode("processors:\n  batch:\n    timeout: 5s\n"),
              content_type: "text/yaml",
            },
          },
        },
        config_hash: new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xfe, 0xed, 0xfa, 0xce]),
      },
    }),
  },
];

/**
 * Look up a scenario by name. Throws if not found — keeps test code from
 * typo-ing a scenario name and getting an undefined silently.
 */
export function agentScenario(name: string): AgentScenario {
  const found = AGENT_SCENARIOS.find((s) => s.name === name);
  if (!found) throw new Error(`Unknown agent scenario: ${name}`);
  return found;
}

export function serverScenario(name: string): ServerScenario {
  const found = SERVER_SCENARIOS.find((s) => s.name === name);
  if (!found) throw new Error(`Unknown server scenario: ${name}`);
  return found;
}

/**
 * `ReportsAvailableComponents` capability bit (OpAMP §5.2.2). Spec status is
 * Development, so it's not in the AgentCapabilities enum yet. Exported here
 * so callers don't hand-write the literal.
 */
export const REPORTS_AVAILABLE_COMPONENTS = 0x00004000 as const;
