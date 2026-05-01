// @o11yfleet/test-utils — OpAMP message builders
//
// Pure functions that construct correct AgentToServer messages.
// Single source of truth for message shapes — used by FakeOpampAgent,
// worker test helpers, and inline test constructions.

import {
  type AgentToServer,
  type ComponentHealth,
  type AgentDescription,
  AgentCapabilities,
  AgentToServerFlags,
  RemoteConfigStatuses,
} from "@o11yfleet/core/codec";
import type { PipelineConfig } from "./fake-agent.js";
import { REAL_COLLECTOR_PIPELINES } from "./fake-agent.js";

// ─── Common defaults ────────────────────────────────────────────────

/** Default capabilities matching a real otelcol-contrib (no AcceptsRemoteConfig). */
export const DEFAULT_CAPABILITIES =
  AgentCapabilities.ReportsStatus |
  AgentCapabilities.ReportsEffectiveConfig |
  AgentCapabilities.ReportsHealth;

/** Standard test capabilities for agents that accept remote config. */
export const CONFIGURABLE_CAPABILITIES =
  AgentCapabilities.ReportsStatus |
  AgentCapabilities.AcceptsRemoteConfig |
  AgentCapabilities.ReportsEffectiveConfig |
  AgentCapabilities.ReportsHealth |
  AgentCapabilities.ReportsRemoteConfig;

// ─── Hello / Full Report ────────────────────────────────────────────

export interface HelloOptions {
  instanceUid?: Uint8Array;
  sequenceNum?: number;
  capabilities?: number;
  /** Service name for identifying_attributes. */
  name?: string;
  /** Service version for identifying_attributes. */
  serviceVersion?: string;
  /** Hostname for non_identifying_attributes. */
  hostname?: string;
  /** OS type for non_identifying_attributes. */
  osType?: string;
  /** Architecture for non_identifying_attributes. */
  arch?: string;
  /** Pipeline definitions for component_health_map. */
  pipelines?: PipelineConfig[];
  /** Extensions to include. */
  extensions?: string[];
  /** Override health (default: healthy). */
  healthy?: boolean;
  /** Override health status string. */
  healthStatus?: string;
  /** Override last_error. */
  lastError?: string;
  /** Include effective config YAML. */
  includeEffectiveConfig?: boolean;
}

/**
 * Build a hello/full-report message with realistic OTel Collector fields.
 * All fields have sensible defaults — pass only what you need to customize.
 */
export function buildHello(opts: HelloOptions = {}): AgentToServer {
  const instanceUid = opts.instanceUid ?? new Uint8Array(16);
  if (instanceUid.length !== 16) {
    throw new Error(`instanceUid must be 16 bytes, got ${instanceUid.length}`);
  }
  const capabilities = opts.capabilities ?? CONFIGURABLE_CAPABILITIES;
  const name = opts.name ?? "test-agent";
  const version = opts.serviceVersion ?? "0.123.0";
  const hostname = opts.hostname ?? "test-host";
  const osType = opts.osType ?? "linux";
  const arch = opts.arch ?? "arm64";
  const pipelines = opts.pipelines ?? REAL_COLLECTOR_PIPELINES;
  const extensions = opts.extensions ?? ["opamp"];
  const healthy = opts.healthy ?? true;
  const healthStatus = opts.healthStatus ?? "StatusOK";
  const lastError = opts.lastError ?? "";

  const nowNano = BigInt(Date.now()) * 1_000_000n;
  const componentHealthMap = buildComponentHealthMap(pipelines, extensions, nowNano);

  // Instance UID as UUID for identifying_attributes
  const uidHex = Array.from(instanceUid)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const uidUuid = `${uidHex.slice(0, 8)}-${uidHex.slice(8, 12)}-${uidHex.slice(12, 16)}-${uidHex.slice(16, 20)}-${uidHex.slice(20, 32)}`;

  const msg: AgentToServer = {
    instance_uid: instanceUid,
    sequence_num: opts.sequenceNum ?? 0,
    capabilities,
    flags: AgentToServerFlags.FullState,
    health: {
      healthy,
      start_time_unix_nano: nowNano,
      last_error: lastError,
      status: healthStatus,
      status_time_unix_nano: nowNano,
      component_health_map: componentHealthMap,
    },
    agent_description: buildAgentDescription({
      name,
      instanceId: uidUuid,
      serviceVersion: version,
      hostname,
      osType,
      arch,
    }),
  };

  if (opts.includeEffectiveConfig !== false) {
    const yaml = generateEffectiveConfigYaml(pipelines, extensions);
    msg.effective_config = {
      config_map: {
        config_map: {
          "": { body: new TextEncoder().encode(yaml), content_type: "text/yaml" },
        },
      },
    };
  }

  return msg;
}

// ─── Heartbeat ──────────────────────────────────────────────────────

export interface HeartbeatOptions {
  instanceUid?: Uint8Array;
  sequenceNum?: number;
  capabilities?: number;
}

/** Build a minimal heartbeat message (no health, no description). */
export function buildHeartbeat(opts: HeartbeatOptions = {}): AgentToServer {
  return {
    instance_uid: opts.instanceUid ?? new Uint8Array(16),
    sequence_num: opts.sequenceNum ?? 1,
    capabilities: opts.capabilities ?? CONFIGURABLE_CAPABILITIES,
    flags: 0,
  };
}

// ─── Health Report ──────────────────────────────────────────────────

export interface HealthReportOptions {
  instanceUid?: Uint8Array;
  sequenceNum?: number;
  capabilities?: number;
  healthy: boolean;
  status?: string;
  lastError?: string;
  componentHealthMap?: Record<string, ComponentHealth>;
}

/** Build a health status report. */
export function buildHealthReport(opts: HealthReportOptions): AgentToServer {
  const nowNano = BigInt(Date.now()) * 1_000_000n;
  return {
    instance_uid: opts.instanceUid ?? new Uint8Array(16),
    sequence_num: opts.sequenceNum ?? 1,
    capabilities:
      opts.capabilities ?? AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsHealth,
    flags: 0,
    health: {
      healthy: opts.healthy,
      start_time_unix_nano: nowNano,
      last_error: opts.lastError ?? (opts.healthy ? "" : (opts.status ?? "")),
      status: opts.status ?? (opts.healthy ? "StatusOK" : "degraded"),
      status_time_unix_nano: nowNano,
      component_health_map: opts.componentHealthMap ?? {},
    },
  };
}

// ─── Config Acknowledgement ─────────────────────────────────────────

export interface ConfigAckOptions {
  instanceUid?: Uint8Array;
  sequenceNum?: number;
  capabilities?: number;
  configHash: Uint8Array;
  status?: RemoteConfigStatuses;
  errorMessage?: string;
}

/** Build a remote config acknowledgement message. */
export function buildConfigAck(opts: ConfigAckOptions): AgentToServer {
  return {
    instance_uid: opts.instanceUid ?? new Uint8Array(16),
    sequence_num: opts.sequenceNum ?? 1,
    capabilities: opts.capabilities ?? CONFIGURABLE_CAPABILITIES,
    flags: 0,
    remote_config_status: {
      last_remote_config_hash: opts.configHash,
      status: opts.status ?? RemoteConfigStatuses.APPLIED,
      error_message: opts.errorMessage ?? "",
    },
  };
}

// ─── Agent Description ──────────────────────────────────────────────

export interface AgentDescriptionOptions {
  instanceUid?: Uint8Array;
  sequenceNum?: number;
  capabilities?: number;
  name?: string;
  instanceId?: string;
  serviceVersion?: string;
  hostname?: string;
  osType?: string;
  arch?: string;
}

/** Build a message carrying agent_description (for description updates). */
export function buildDescriptionReport(opts: AgentDescriptionOptions = {}): AgentToServer {
  return {
    instance_uid: opts.instanceUid ?? new Uint8Array(16),
    sequence_num: opts.sequenceNum ?? 1,
    capabilities: opts.capabilities ?? DEFAULT_CAPABILITIES,
    flags: 0,
    agent_description: buildAgentDescription(opts),
  };
}

// ─── Disconnect ─────────────────────────────────────────────────────

export interface DisconnectOptions {
  instanceUid?: Uint8Array;
  sequenceNum?: number;
  capabilities?: number;
}

/** Build a disconnect message (agent_disconnect set, no payload fields). */
export function buildDisconnect(opts: DisconnectOptions = {}): AgentToServer {
  return {
    instance_uid: opts.instanceUid ?? new Uint8Array(16),
    sequence_num: opts.sequenceNum ?? 99,
    capabilities: opts.capabilities ?? DEFAULT_CAPABILITIES,
    flags: 0,
    agent_disconnect: {},
  };
}

// ─── Internal helpers ───────────────────────────────────────────────

/** Build an AgentDescription with standard OTel Collector attributes. */
function buildAgentDescription(
  opts: Omit<AgentDescriptionOptions, "instanceUid" | "sequenceNum" | "capabilities"> = {},
): AgentDescription {
  return {
    identifying_attributes: [
      { key: "service.instance.id", value: { string_value: opts.instanceId ?? "test-instance" } },
      { key: "service.name", value: { string_value: opts.name ?? "test-agent" } },
      { key: "service.version", value: { string_value: opts.serviceVersion ?? "0.123.0" } },
    ],
    non_identifying_attributes: [
      { key: "host.arch", value: { string_value: opts.arch ?? "arm64" } },
      { key: "host.name", value: { string_value: opts.hostname ?? "test-host" } },
      { key: "os.description", value: { string_value: " " } },
      { key: "os.type", value: { string_value: opts.osType ?? "linux" } },
    ],
  };
}

/** Build a component_health_map matching real otelcol-contrib structure. */
function buildComponentHealthMap(
  pipelines: PipelineConfig[],
  extensions: string[],
  nowNano: bigint,
): Record<string, ComponentHealth> {
  const leaf = (): ComponentHealth => ({
    healthy: true,
    start_time_unix_nano: 0n,
    last_error: "",
    status: "StatusOK",
    status_time_unix_nano: nowNano,
    component_health_map: {},
  });

  const map: Record<string, ComponentHealth> = {};

  for (const pipeline of pipelines) {
    const components: Record<string, ComponentHealth> = {};
    for (const r of pipeline.receivers) components[`receiver:${r}`] = leaf();
    for (const proc of pipeline.processors) components[`processor:${proc}`] = leaf();
    for (const exp of pipeline.exporters) components[`exporter:${exp}`] = leaf();
    map[`pipeline:${pipeline.name}`] = {
      healthy: true,
      start_time_unix_nano: 0n,
      last_error: "",
      status: "StatusOK",
      status_time_unix_nano: nowNano,
      component_health_map: components,
    };
  }

  const extComponents: Record<string, ComponentHealth> = {};
  for (const ext of extensions) extComponents[`extension:${ext}`] = leaf();
  map["extensions"] = {
    healthy: true,
    start_time_unix_nano: 0n,
    last_error: "",
    status: "StatusOK",
    status_time_unix_nano: nowNano,
    component_health_map: extComponents,
  };

  return map;
}

/** Generate a realistic YAML effective config matching the pipeline structure. */
function generateEffectiveConfigYaml(
  pipelines: PipelineConfig[],
  extensions: string[] = ["opamp", "health_check"],
): string {
  const receivers = new Set<string>();
  const processors = new Set<string>();
  const exporters = new Set<string>();
  for (const p of pipelines) {
    for (const r of p.receivers) receivers.add(r);
    for (const proc of p.processors) processors.add(proc);
    for (const exp of p.exporters) exporters.add(exp);
  }

  let yaml = "receivers:\n";
  for (const r of receivers) {
    if (r === "otlp") {
      yaml +=
        "  otlp:\n    protocols:\n      grpc:\n        endpoint: 0.0.0.0:4317\n      http:\n        endpoint: 0.0.0.0:4318\n";
    } else if (r === "prometheus") {
      yaml +=
        "  prometheus:\n    config:\n      scrape_configs:\n        - job_name: otel-collector\n          scrape_interval: 10s\n";
    } else {
      yaml += `  ${r}: {}\n`;
    }
  }

  yaml += "\nprocessors:\n";
  for (const proc of processors) {
    if (proc === "batch") {
      yaml += "  batch:\n    send_batch_size: 512\n    timeout: 5s\n";
    } else if (proc === "memory_limiter") {
      yaml += "  memory_limiter:\n    check_interval: 1s\n    limit_mib: 512\n";
    } else {
      yaml += `  ${proc}: {}\n`;
    }
  }

  yaml += "\nexporters:\n";
  for (const exp of exporters) {
    if (exp === "debug") {
      yaml += "  debug:\n    verbosity: basic\n";
    } else if (exp === "otlphttp") {
      yaml += "  otlphttp:\n    endpoint: https://otlp.example.com\n";
    } else {
      yaml += `  ${exp}: {}\n`;
    }
  }

  yaml += "\nextensions:\n";
  for (const ext of extensions) {
    if (ext === "opamp") {
      yaml +=
        "  opamp:\n    server:\n      ws:\n        endpoint: wss://fleet.o11yfleet.com/v1/opamp\n";
    } else if (ext === "health_check") {
      yaml += "  health_check:\n    endpoint: 0.0.0.0:13133\n";
    } else {
      yaml += `  ${ext}: {}\n`;
    }
  }

  yaml += `\nservice:\n  extensions: [${extensions.join(", ")}]\n  pipelines:\n`;
  for (const p of pipelines) {
    yaml += `    ${p.name}:\n`;
    yaml += `      receivers: [${p.receivers.join(", ")}]\n`;
    yaml += `      processors: [${p.processors.join(", ")}]\n`;
    yaml += `      exporters: [${p.exporters.join(", ")}]\n`;
  }
  return yaml;
}
