import {
  PIPELINE_SIGNALS,
  type PipelineComponent,
  type PipelineComponentRole,
  type PipelineGraph,
  type PipelineSignal,
  type PipelineWire,
  type PipelineValidationIssue,
  type PipelineValidationResult,
  type SignalPipeline,
} from "./types.js";

const VALID_ROLE_EDGES: Record<PipelineComponentRole, PipelineComponentRole[]> = {
  receiver: ["processor", "exporter"],
  processor: ["processor", "exporter"],
  exporter: [],
};

export function componentMap(graph: PipelineGraph): Map<string, PipelineComponent> {
  return new Map(graph.components.map((component) => [component.id, component]));
}

export function deriveSignalPipelines(graph: PipelineGraph): SignalPipeline[] {
  const componentsById = componentMap(graph);

  return PIPELINE_SIGNALS.flatMap((signal) => {
    const signalWires = graph.wires.filter((wire) => wire.signal === signal);
    if (signalWires.length === 0) return [];

    const topology = deriveLinearSignalTopology(signal, signalWires, componentsById);

    const pipeline: SignalPipeline = {
      signal,
      receivers: topology.receivers.map((component) => component.name),
      processors: topology.processors.map((component) => component.name),
      exporters: topology.exporters.map((component) => component.name),
    };

    return pipeline.receivers.length > 0 || pipeline.exporters.length > 0 ? [pipeline] : [];
  });
}

interface LinearSignalTopology {
  receivers: PipelineComponent[];
  processors: PipelineComponent[];
  exporters: PipelineComponent[];
}

function deriveLinearSignalTopology(
  signal: PipelineSignal,
  wires: PipelineWire[],
  componentsById: Map<string, PipelineComponent>,
): LinearSignalTopology {
  const receiverIds = new Set<string>();
  const exporterIds = new Set<string>();
  const processorIds = new Set<string>();
  const processorNext = new Map<string, string>();
  const processorPrev = new Map<string, string>();
  const receiverToProcessorIds = new Set<string>();
  const processorToExporterIds = new Set<string>();
  let directReceiverToExporter = false;

  for (const wire of wires) {
    const from = requireComponent(componentsById, wire.from, signal);
    const to = requireComponent(componentsById, wire.to, signal);

    if (from.role === "receiver") receiverIds.add(from.id);
    if (to.role === "receiver") receiverIds.add(to.id);
    if (from.role === "exporter") exporterIds.add(from.id);
    if (to.role === "exporter") exporterIds.add(to.id);
    if (from.role === "processor") processorIds.add(from.id);
    if (to.role === "processor") processorIds.add(to.id);

    if (from.role === "receiver" && to.role === "exporter") {
      receiverIds.add(from.id);
      exporterIds.add(to.id);
      directReceiverToExporter = true;
    }
    if (from.role === "receiver" && to.role === "processor") {
      receiverToProcessorIds.add(to.id);
    }
    if (from.role === "processor" && to.role === "exporter") {
      processorToExporterIds.add(from.id);
    }
    if (from.role === "processor" && to.role === "processor") {
      setUniqueEdge(processorNext, from.id, to.id, signal, "outgoing");
      setUniqueEdge(processorPrev, to.id, from.id, signal, "incoming");
    }
  }

  if (processorIds.size === 0) {
    return {
      receivers: orderedComponents(receiverIds, componentsById),
      processors: [],
      exporters: orderedComponents(exporterIds, componentsById),
    };
  }

  if (directReceiverToExporter) {
    throw new Error(
      `Ambiguous ${signal} pipeline: direct receiver-to-exporter wires cannot be mixed with processor wires.`,
    );
  }

  const firstProcessorIds = new Set<string>();
  const lastProcessorIds = new Set<string>();
  for (const processorId of processorIds) {
    if (!processorPrev.has(processorId)) firstProcessorIds.add(processorId);
    if (!processorNext.has(processorId)) lastProcessorIds.add(processorId);
  }

  if (firstProcessorIds.size !== 1) {
    throw new Error(
      `Ambiguous ${signal} pipeline: expected one processor chain start, found ${firstProcessorIds.size}.`,
    );
  }
  if (lastProcessorIds.size !== 1) {
    throw new Error(
      `Ambiguous ${signal} pipeline: expected one processor chain end, found ${lastProcessorIds.size}.`,
    );
  }

  const firstProcessorId = firstProcessorIds.values().next().value as string;
  const lastProcessorId = lastProcessorIds.values().next().value as string;
  for (const processorId of receiverToProcessorIds) {
    if (processorId !== firstProcessorId) {
      throw new Error(
        `Ambiguous ${signal} pipeline: receiver wire enters processor "${processorId}" instead of the chain start "${firstProcessorId}".`,
      );
    }
  }
  for (const processorId of processorToExporterIds) {
    if (processorId !== lastProcessorId) {
      throw new Error(
        `Ambiguous ${signal} pipeline: exporter wire leaves processor "${processorId}" instead of the chain end "${lastProcessorId}".`,
      );
    }
  }

  const processors: PipelineComponent[] = [];
  const seen = new Set<string>();
  let currentId = firstProcessorId;

  while (currentId) {
    if (seen.has(currentId)) {
      throw new Error(`Cycle detected in ${signal} processor chain at ${currentId}.`);
    }
    seen.add(currentId);
    processors.push(requireComponent(componentsById, currentId, signal));

    const nextId = processorNext.get(currentId);
    if (!nextId) break;
    currentId = nextId;
  }

  if (seen.size !== processorIds.size) {
    throw new Error(
      `Ambiguous ${signal} pipeline: ${processorIds.size - seen.size} processor(s) are disconnected from the main chain.`,
    );
  }

  return {
    receivers: orderedComponents(receiverIds, componentsById),
    processors,
    exporters: orderedComponents(exporterIds, componentsById),
  };
}

function requireComponent(
  componentsById: Map<string, PipelineComponent>,
  id: string,
  signal: PipelineSignal,
): PipelineComponent {
  const component = componentsById.get(id);
  if (!component) {
    throw new Error(`Cannot derive ${signal} pipeline: missing component "${id}".`);
  }
  return component;
}

function setUniqueEdge(
  edges: Map<string, string>,
  from: string,
  to: string,
  signal: PipelineSignal,
  direction: string,
): void {
  const existing = edges.get(from);
  if (existing && existing !== to) {
    throw new Error(
      `Ambiguous ${signal} pipeline: processor "${from}" has multiple ${direction} processor edges.`,
    );
  }
  edges.set(from, to);
}

function orderedComponents(
  ids: Set<string>,
  componentsById: Map<string, PipelineComponent>,
): PipelineComponent[] {
  return [...ids].map((id) => {
    const component = componentsById.get(id);
    if (!component) {
      throw new Error(`Cannot derive pipeline: missing component "${id}".`);
    }
    return component;
  });
}

export function validatePipelineGraph(graph: PipelineGraph): PipelineValidationResult {
  const errors: PipelineValidationIssue[] = [];
  const warnings: PipelineValidationIssue[] = [];
  const componentsById = componentMap(graph);
  const seenIds = new Set<string>();
  const namesByRole = new Map<PipelineComponentRole, Set<string>>();

  for (const component of graph.components) {
    if (seenIds.has(component.id)) {
      errors.push({
        code: "duplicate_component_id",
        message: `Component id "${component.id}" is used more than once.`,
        component_id: component.id,
      });
    }
    seenIds.add(component.id);

    const names = namesByRole.get(component.role) ?? new Set<string>();
    if (names.has(component.name)) {
      errors.push({
        code: "duplicate_component_name",
        message: `${component.role} name "${component.name}" must be unique in its YAML section.`,
        component_id: component.id,
      });
    }
    names.add(component.name);
    namesByRole.set(component.role, names);

    if (component.signals.length === 0) {
      errors.push({
        code: "component_without_signals",
        message: `${component.name} does not declare any supported telemetry signals.`,
        component_id: component.id,
      });
    }
  }

  for (const wire of graph.wires) {
    const from = componentsById.get(wire.from);
    const to = componentsById.get(wire.to);

    if (!from || !to) {
      errors.push({
        code: "wire_missing_endpoint",
        message: `Wire ${wire.from} -> ${wire.to} references a missing component.`,
        wire,
      });
      continue;
    }

    if (!VALID_ROLE_EDGES[from.role].includes(to.role)) {
      errors.push({
        code: "invalid_role_edge",
        message: `Cannot wire ${from.role} "${from.name}" to ${to.role} "${to.name}".`,
        wire,
      });
    }

    if (!from.signals.includes(wire.signal) || !to.signals.includes(wire.signal)) {
      errors.push({
        code: "unsupported_signal_edge",
        message: `Wire ${from.name} -> ${to.name} uses ${wire.signal}, but both components must support that signal.`,
        wire,
      });
    }
  }

  let pipelines: SignalPipeline[] = [];
  try {
    pipelines = deriveSignalPipelines(graph);
  } catch (error) {
    errors.push({
      code: "pipeline_topology_error",
      message: error instanceof Error ? error.message : "Pipeline topology could not be derived.",
    });
  }
  for (const signal of PIPELINE_SIGNALS) {
    const pipeline = pipelines.find((item) => item.signal === signal);
    if (!pipeline) continue;
    if (pipeline.receivers.length === 0) {
      errors.push({
        code: "signal_without_receiver",
        message: `${signal} pipeline has no receiver.`,
      });
    }
    if (pipeline.exporters.length === 0) {
      errors.push({
        code: "signal_without_exporter",
        message: `${signal} pipeline has no exporter.`,
      });
    }
    if (pipeline.processors.length === 0) {
      warnings.push({
        code: "signal_without_processor",
        message: `${signal} pipeline has no processor; this may be fine, but production pipelines usually batch or limit memory.`,
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    pipelines,
  };
}

export function summarizePipelineGraph(graph: PipelineGraph): string {
  const validation = validatePipelineGraph(graph);
  const pipelineLabels = validation.pipelines.map((pipeline) => pipeline.signal).join(", ");
  return `${graph.label}: ${graph.components.length} components, ${graph.wires.length} wires, ${validation.pipelines.length} service pipelines${pipelineLabels ? ` (${pipelineLabels})` : ""}`;
}
