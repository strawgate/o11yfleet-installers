/**
 * Parse OTel Collector YAML configuration into a pipeline topology.
 * Used by the agent detail page to render pipeline diagrams.
 */

import { parse as parseYaml } from "yaml";

export interface PipelineComponent {
  name: string; // e.g. "otlp", "batch", "otlphttp"
  type: string; // e.g. "otlp/grpc" (full config key)
  healthy: boolean | null; // from component_health_map overlay
  status?: string;
  lastError?: string;
  config?: Record<string, unknown>; // raw config for this component
}

export interface Pipeline {
  name: string; // e.g. "traces", "metrics", "logs", "traces/custom"
  receivers: string[];
  processors: string[];
  exporters: string[];
}

export interface PipelineTopology {
  receivers: PipelineComponent[];
  processors: PipelineComponent[];
  exporters: PipelineComponent[];
  extensions: PipelineComponent[];
  pipelines: Pipeline[];
}

export interface ComponentHealthEntry {
  healthy?: boolean;
  status?: string;
  last_error?: string;
  start_time_unix_nano?: string | number;
  status_time_unix_nano?: string | number;
  component_health_map?: Record<string, ComponentHealthEntry>;
}

/**
 * Parse OTel Collector config YAML and extract pipeline topology.
 * Overlays component_health_map data for health status per component.
 */
export function parsePipelineTopology(
  yamlConfig: string | null | undefined,
  componentHealthMap?: Record<string, ComponentHealthEntry> | null,
): PipelineTopology | null {
  if (!yamlConfig) return null;

  let config: Record<string, unknown>;
  try {
    config = parseYaml(yamlConfig) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (!config || typeof config !== "object") return null;

  const receiversConfig = (config["receivers"] ?? {}) as Record<string, unknown>;
  const processorsConfig = (config["processors"] ?? {}) as Record<string, unknown>;
  const exportersConfig = (config["exporters"] ?? {}) as Record<string, unknown>;
  const extensionsConfig = (config["extensions"] ?? {}) as Record<string, unknown>;
  const serviceConfig = (config["service"] ?? {}) as Record<string, unknown>;
  const pipelinesConfig = (serviceConfig["pipelines"] ?? {}) as Record<string, unknown>;

  // Flatten component_health_map to lookup by component name
  const healthLookup = flattenHealthMap(componentHealthMap);

  const receivers = Object.keys(receiversConfig).map((key) =>
    makeComponent(key, receiversConfig[key], healthLookup),
  );
  const processors = Object.keys(processorsConfig).map((key) =>
    makeComponent(key, processorsConfig[key], healthLookup),
  );
  const exporters = Object.keys(exportersConfig).map((key) =>
    makeComponent(key, exportersConfig[key], healthLookup),
  );
  const extensions = Object.keys(extensionsConfig).map((key) =>
    makeComponent(key, extensionsConfig[key], healthLookup),
  );

  const pipelines: Pipeline[] = Object.entries(pipelinesConfig).map(([name, def]) => {
    const pDef = (def ?? {}) as Record<string, unknown>;
    return {
      name,
      receivers: asStringArray(pDef["receivers"]),
      processors: asStringArray(pDef["processors"]),
      exporters: asStringArray(pDef["exporters"]),
    };
  });

  return { receivers, processors, exporters, extensions, pipelines };
}

function makeComponent(
  key: string,
  config: unknown,
  healthLookup: Map<string, ComponentHealthEntry>,
): PipelineComponent {
  const baseName = key.split("/")[0]!;
  const health = healthLookup.get(key) ?? healthLookup.get(baseName);
  return {
    name: key,
    type: key,
    healthy: health?.healthy ?? null,
    status: health?.status,
    lastError: health?.last_error,
    config: config && typeof config === "object" ? (config as Record<string, unknown>) : undefined,
  };
}

/**
 * Flatten nested component_health_map into a lookup by component name.
 * The map structure is: { "pipeline:traces": { component_health_map: { "receiver:otlp": { ... } } } }
 */
function flattenHealthMap(
  healthMap: Record<string, ComponentHealthEntry> | null | undefined,
): Map<string, ComponentHealthEntry> {
  const lookup = new Map<string, ComponentHealthEntry>();
  if (!healthMap) return lookup;

  function walk(map: Record<string, ComponentHealthEntry>) {
    for (const [key, entry] of Object.entries(map)) {
      // Keys are like "receiver:otlp" or "exporter:otlphttp/prod" — extract component name
      const colonIdx = key.indexOf(":");
      const componentName = colonIdx >= 0 ? key.slice(colonIdx + 1) : key;
      lookup.set(componentName, entry);

      if (entry.component_health_map) {
        walk(entry.component_health_map);
      }
    }
  }

  walk(healthMap);
  return lookup;
}

function asStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is string => typeof v === "string");
}

/**
 * Extract identity fields from parsed agent_description.
 */
export interface AgentIdentity {
  serviceName: string | null;
  serviceVersion: string | null;
  hostname: string | null;
  osType: string | null;
  osDescription: string | null;
  hostArch: string | null;
}

interface KeyValue {
  key: string;
  value?: { string_value?: string; int_value?: string | number };
}

export function extractAgentIdentity(
  agentDescription:
    | { identifying_attributes?: KeyValue[]; non_identifying_attributes?: KeyValue[] }
    | null
    | undefined,
): AgentIdentity {
  const result: AgentIdentity = {
    serviceName: null,
    serviceVersion: null,
    hostname: null,
    osType: null,
    osDescription: null,
    hostArch: null,
  };

  if (!agentDescription) return result;

  const allAttrs = [
    ...(agentDescription.identifying_attributes ?? []),
    ...(agentDescription.non_identifying_attributes ?? []),
  ];

  for (const attr of allAttrs) {
    const val = attr.value?.string_value ?? null;
    switch (attr.key) {
      case "service.name":
        result.serviceName = val;
        break;
      case "service.version":
        result.serviceVersion = val;
        break;
      case "host.name":
        result.hostname = val;
        break;
      case "os.type":
        result.osType = val;
        break;
      case "os.description":
        result.osDescription = val;
        break;
      case "host.arch":
        result.hostArch = val;
        break;
      default:
        break;
    }
  }

  return result;
}
