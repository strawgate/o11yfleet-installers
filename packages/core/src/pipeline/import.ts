import { parse as parseYaml } from "yaml";
import {
  PIPELINE_SIGNALS,
  type CollectorYamlImportResult,
  type PipelineComponent,
  type PipelineComponentRole,
  type PipelineConfigObject,
  type PipelineConfigValue,
  type PipelineGraph,
  type PipelineImportWarning,
  type PipelineSignal,
  type PipelineWire,
} from "./types.js";

interface ImportOptions {
  id?: string;
  label?: string;
}

type UnknownRecord = Record<string, unknown>;

const SECTION_BY_ROLE: Record<PipelineComponentRole, string> = {
  receiver: "receivers",
  processor: "processors",
  exporter: "exporters",
};

const ROLE_BY_SECTION: Record<string, PipelineComponentRole> = {
  receivers: "receiver",
  processors: "processor",
  exporters: "exporter",
};

const GRAPH_TOP_LEVEL_SECTIONS = new Set(["receivers", "processors", "exporters", "service"]);

export function parseCollectorYamlToGraph(
  yaml: string,
  options: ImportOptions = {},
): CollectorYamlImportResult {
  const warnings: PipelineImportWarning[] = [];
  let parsed: unknown;
  try {
    parsed = parseYaml(yaml);
  } catch (error) {
    return rawOnlyGraph(options, warnings, {
      code: "collector_yaml_parse_error",
      message: `YAML parse failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const root = asRecord(parsed);

  if (!root) {
    return rawOnlyGraph(options, warnings, {
      code: "collector_yaml_not_mapping",
      message: "Collector YAML must parse to a top-level mapping before it can be visualized.",
    });
  }

  const rawSections = extractRawSections(root, warnings);
  const components: PipelineComponent[] = [];
  const componentIdsByRoleAndName = new Map<string, string>();
  const componentSignals = new Map<string, Set<PipelineSignal>>();
  const usedComponentIds = new Set<string>();

  for (const [section, role] of Object.entries(ROLE_BY_SECTION)) {
    const sectionValue = root[section];
    if (sectionValue === undefined) continue;

    const entries = asRecord(sectionValue);
    if (!entries) {
      warnings.push({
        code: "collector_section_not_mapping",
        message: `${section} must be a mapping to be visualized.`,
        path: section,
      });
      continue;
    }

    for (const [name, value] of Object.entries(entries)) {
      const id = componentId(role, name, components.length + 1, usedComponentIds);
      componentIdsByRoleAndName.set(componentKey(role, name), id);
      componentSignals.set(id, new Set());
      components.push({
        id,
        role,
        type: componentType(name),
        name,
        signals: [],
        config: componentConfig(value, `${section}.${name}`, warnings),
      });
    }
  }

  const pipelines = asRecord(asRecord(root["service"])?.["pipelines"]);
  if (!pipelines) {
    warnings.push({
      code: "collector_pipelines_missing",
      message: "Collector YAML does not contain service.pipelines as a mapping.",
      path: "service.pipelines",
    });
  }

  const wires: PipelineWire[] = [];
  const wireKeys = new Set<string>();
  const importedSignals = new Set<PipelineSignal>();

  if (pipelines) {
    for (const [pipelineName, pipelineValue] of Object.entries(pipelines)) {
      const signal = signalFromPipelineName(pipelineName);
      if (!signal) {
        warnings.push({
          code: "collector_pipeline_signal_unsupported",
          message: `Pipeline "${pipelineName}" does not map to logs, metrics, or traces.`,
          path: `service.pipelines.${pipelineName}`,
        });
        continue;
      }

      if (importedSignals.has(signal)) {
        warnings.push({
          code: "collector_pipeline_duplicate_signal",
          message: `Multiple ${signal} pipelines were found; the graph model currently visualizes one pipeline per signal.`,
          path: `service.pipelines.${pipelineName}`,
        });
      }
      importedSignals.add(signal);

      const pipeline = asRecord(pipelineValue);
      if (!pipeline) {
        warnings.push({
          code: "collector_pipeline_not_mapping",
          message: `Pipeline "${pipelineName}" must be a mapping to be visualized.`,
          path: `service.pipelines.${pipelineName}`,
        });
        continue;
      }

      const receivers = componentRefs(
        pipeline["receivers"],
        `service.pipelines.${pipelineName}.receivers`,
        warnings,
      );
      const processors = componentRefs(
        pipeline["processors"],
        `service.pipelines.${pipelineName}.processors`,
        warnings,
      );
      const exporters = componentRefs(
        pipeline["exporters"],
        `service.pipelines.${pipelineName}.exporters`,
        warnings,
      );

      markComponentSignals(
        "receiver",
        receivers,
        signal,
        componentIdsByRoleAndName,
        componentSignals,
        warnings,
      );
      markComponentSignals(
        "processor",
        processors,
        signal,
        componentIdsByRoleAndName,
        componentSignals,
        warnings,
      );
      markComponentSignals(
        "exporter",
        exporters,
        signal,
        componentIdsByRoleAndName,
        componentSignals,
        warnings,
      );

      const processorIds = idsForRefs("processor", processors, componentIdsByRoleAndName);
      const receiverIds = idsForRefs("receiver", receivers, componentIdsByRoleAndName);
      const exporterIds = idsForRefs("exporter", exporters, componentIdsByRoleAndName);

      if (processorIds.length === 0) {
        for (const receiverId of receiverIds) {
          for (const exporterId of exporterIds) {
            addWire(wires, wireKeys, receiverId, exporterId, signal);
          }
        }
        continue;
      }

      const firstProcessor = processorIds[0]!;
      const lastProcessor = processorIds[processorIds.length - 1]!;
      for (const receiverId of receiverIds)
        addWire(wires, wireKeys, receiverId, firstProcessor, signal);
      for (let index = 0; index < processorIds.length - 1; index++) {
        addWire(wires, wireKeys, processorIds[index]!, processorIds[index + 1]!, signal);
      }
      for (const exporterId of exporterIds)
        addWire(wires, wireKeys, lastProcessor, exporterId, signal);
    }
  }

  for (const component of components) {
    component.signals = [...(componentSignals.get(component.id) ?? [])];
    if (component.signals.length === 0) {
      warnings.push({
        code: "collector_component_unused",
        message: `${SECTION_BY_ROLE[component.role]}.${component.name} is not referenced by an imported pipeline.`,
        path: `${SECTION_BY_ROLE[component.role]}.${component.name}`,
      });
    }
  }

  const graph: PipelineGraph = {
    id: options.id ?? "imported-collector-yaml",
    label: options.label ?? "Imported collector config",
    components,
    wires,
  };

  const hasVisualizablePipeline = wires.length > 0;
  const hasRawSections = Object.keys(rawSections).length > 0;
  const confidence = hasVisualizablePipeline
    ? warnings.length > 0 || hasRawSections
      ? "partial"
      : "complete"
    : "raw-only";

  return { graph, confidence, warnings, rawSections };
}

function rawOnlyGraph(
  options: ImportOptions,
  existingWarnings: PipelineImportWarning[],
  warning: PipelineImportWarning,
): CollectorYamlImportResult {
  const graph: PipelineGraph = {
    id: options.id ?? "imported-collector-yaml",
    label: options.label ?? "Imported collector config",
    components: [],
    wires: [],
  };
  return {
    graph,
    confidence: "raw-only",
    warnings: [...existingWarnings, warning],
    rawSections: {},
  };
}

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function componentType(name: string): string {
  return name.split("/", 1)[0] || name;
}

function componentKey(role: PipelineComponentRole, name: string): string {
  return `${role}:${name}`;
}

function componentId(
  role: PipelineComponentRole,
  name: string,
  fallback: number,
  usedIds: Set<string>,
): string {
  const prefix = role[0]!;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = `${prefix}-${slug || fallback}`;
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function componentConfig(
  value: unknown,
  path: string,
  warnings: PipelineImportWarning[],
): PipelineConfigObject {
  if (value === null || value === undefined) return {};

  const record = asRecord(value);
  if (!record) {
    warnings.push({
      code: "collector_component_config_not_mapping",
      message: `${path} has a non-mapping config; it was kept as an empty visual config.`,
      path,
    });
    return {};
  }

  return toConfigObject(record, path, warnings);
}

function toConfigObject(
  record: UnknownRecord,
  path: string,
  warnings: PipelineImportWarning[],
): PipelineConfigObject {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      toConfigValue(value, `${path}.${key}`, warnings),
    ]),
  );
}

function toConfigValue(
  value: unknown,
  path: string,
  warnings: PipelineImportWarning[],
): PipelineConfigValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => toConfigValue(item, `${path}[${index}]`, warnings));
  }

  const record = asRecord(value);
  if (record) return toConfigObject(record, path, warnings);

  warnings.push({
    code: "collector_config_value_unsupported",
    message: `${path} contains a YAML value that cannot be represented in pipeline config JSON.`,
    path,
  });
  return String(value);
}

function extractRawSections(
  root: UnknownRecord,
  warnings: PipelineImportWarning[],
): PipelineConfigObject {
  const rawSections: PipelineConfigObject = {};

  for (const [key, value] of Object.entries(root)) {
    if (GRAPH_TOP_LEVEL_SECTIONS.has(key)) continue;
    if (key === "connectors" || key === "extensions") {
      warnings.push({
        code: `collector_${key}_not_visualized`,
        message: `${key} are valid Collector sections but are not represented in the current visual graph model.`,
        path: key,
      });
    }
    rawSections[key] = toConfigValue(value, key, warnings);
  }

  const service = asRecord(root["service"]);
  if (service) {
    const serviceSidecar = Object.fromEntries(
      Object.entries(service)
        .filter(([key]) => key !== "pipelines")
        .map(([key, value]) => [key, toConfigValue(value, `service.${key}`, warnings)]),
    );
    if (Object.keys(serviceSidecar).length > 0) rawSections["service"] = serviceSidecar;
    if (serviceSidecar["extensions"]) {
      warnings.push({
        code: "collector_service_extensions_not_visualized",
        message:
          "service.extensions is preserved as raw YAML and is not represented in the visual graph model.",
        path: "service.extensions",
      });
    }
  }

  return rawSections;
}

function signalFromPipelineName(name: string): PipelineSignal | null {
  const prefix = name.split("/", 1)[0];
  return PIPELINE_SIGNALS.includes(prefix as PipelineSignal) ? (prefix as PipelineSignal) : null;
}

function componentRefs(value: unknown, path: string, warnings: PipelineImportWarning[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    warnings.push({
      code: "collector_pipeline_refs_invalid",
      message: `${path} must be an array of component names.`,
      path,
    });
    return [];
  }
  return value;
}

function markComponentSignals(
  role: PipelineComponentRole,
  refs: string[],
  signal: PipelineSignal,
  ids: Map<string, string>,
  signals: Map<string, Set<PipelineSignal>>,
  warnings: PipelineImportWarning[],
): void {
  for (const ref of refs) {
    const id = ids.get(componentKey(role, ref));
    if (!id) {
      warnings.push({
        code: "collector_pipeline_component_missing",
        message: `${SECTION_BY_ROLE[role]}.${ref} is referenced by the ${signal} pipeline but is not defined.`,
        path: `service.pipelines.${signal}`,
      });
      continue;
    }
    signals.get(id)?.add(signal);
  }
}

function idsForRefs(
  role: PipelineComponentRole,
  refs: string[],
  ids: Map<string, string>,
): string[] {
  return refs.flatMap((ref) => {
    const id = ids.get(componentKey(role, ref));
    return id ? [id] : [];
  });
}

function addWire(
  wires: PipelineWire[],
  keys: Set<string>,
  from: string,
  to: string,
  signal: PipelineSignal,
): void {
  const key = `${from}:${to}:${signal}`;
  if (keys.has(key)) return;
  keys.add(key);
  wires.push({ from, to, signal });
}
