/**
 * useBuilderState.ts — State management hook for the pipeline builder.
 *
 * This hook centralizes all state for the builder:
 * - Mode (visual/split/yaml)
 * - React Flow nodes and edges
 * - YAML text
 * - Derived graph (always computed from active source)
 * - Validation result
 *
 * Design: the canonical graph is always derived from the active mode's source.
 * There is no independent graph state that can drift.
 */

import { useState, useCallback, useMemo } from "react";
import { useNodesState, useEdgesState, type NodeChange, type EdgeChange } from "@xyflow/react";
import {
  validatePipelineGraph,
  parseCollectorYamlToGraph,
  renderCollectorYaml,
  type PipelineGraph,
} from "@o11yfleet/core/pipeline";
import { toFlow } from "@/components/pipeline-builder/schema/to-flow";
import { toGraph } from "@/components/pipeline-builder/schema/to-graph";
import type { BuilderNode, BuilderEdge } from "@/components/pipeline-builder/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/**
 * Builder view modes.
 */
export type BuilderMode = "visual" | "split" | "yaml";

/**
 * Result of validation.
 */
export interface BuilderValidation {
  ok: boolean;
  canSave: boolean;
  errors: Array<{ code: string; message: string; component_id?: string }>;
  warnings: Array<{ code: string; message: string; component_id?: string }>;
}

/**
 * Return type of useBuilderState.
 */
export interface BuilderState {
  // Mode
  mode: BuilderMode;
  setMode: (mode: BuilderMode) => void;

  // React Flow state (synced from graph)
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  onNodesChange: (changes: NodeChange<BuilderNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<BuilderEdge>[]) => void;

  // YAML state (synced from graph when in yaml mode)
  yamlText: string;
  setYamlText: (yaml: string) => void;
  yamlError: string | null;

  // Derived state
  graph: PipelineGraph;
  validation: BuilderValidation;

  // Actions
  resetGraph: (graph: PipelineGraph) => void;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Create builder state for a given initial graph.
 *
 * @param initialGraph - The graph to start with (from API or example)
 * @returns BuilderState with all state and handlers
 */
export function useBuilderState(initialGraph: PipelineGraph): BuilderState {
  // Current mode
  const [mode, setModeState] = useState<BuilderMode>("split");

  // YAML text (managed directly since it's not React Flow state)
  const [yamlText, setYamlTextState] = useState<string>(() =>
    renderCollectorYamlSafe(initialGraph),
  );
  const [yamlError, setYamlError] = useState<string | null>(null);

  // React Flow state - initialized from graph
  // Note: initialGraph intentionally omitted from deps - use resetGraph() to change the graph
  // eslint-disable-next-line react-hooks/exhaustive-deps -- initial graph is set once on mount
  const initialFlow = useMemo(() => toFlow(initialGraph), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialFlow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialFlow.edges);

  // Derived graph - always computed from the active mode's source
  const graph = useMemo((): PipelineGraph => {
    if (mode === "yaml") {
      // Parse YAML to get graph - errors handled via yamlError state
      try {
        const result = parseCollectorYamlToGraph(yamlText, {
          id: initialGraph.id,
          label: initialGraph.label,
        });
        return result.graph;
      } catch {
        // Return empty graph on parse error - yamlError state shows the issue
        return {
          id: initialGraph.id,
          label: initialGraph.label,
          description: undefined,
          components: [],
          wires: [],
        };
      }
    }

    // Convert React Flow state to graph, passing initial components as baseline for position persistence
    const baseline = new Map(initialGraph.components.map((c) => [c.id, c]));
    const flow = toGraph(
      { nodes, edges },
      { id: initialGraph.id, label: initialGraph.label, description: initialGraph.description },
      baseline,
    );
    return flow;
  }, [mode, yamlText, nodes, edges, initialGraph]);

  // Validation result
  const validation = useMemo((): BuilderValidation => {
    const result = validatePipelineGraph(graph);
    return {
      ok: result.ok,
      canSave: result.ok,
      errors: result.errors.map((e) => ({
        code: e.code,
        message: e.message,
        component_id: e.component_id,
      })),
      warnings: result.warnings.map((w) => ({
        code: w.code,
        message: w.message,
        component_id: w.component_id,
      })),
    };
  }, [graph]);

  // Mode change handler - syncs state between modes
  const setMode = useCallback(
    (nextMode: BuilderMode) => {
      if (nextMode === mode) return;

      if (nextMode === "yaml") {
        // Switching to YAML: generate YAML from current graph
        try {
          const yaml = renderCollectorYamlSafe(graph);
          setYamlTextState(yaml);
          setYamlError(null);
        } catch (err) {
          setYamlError(err instanceof Error ? err.message : String(err));
        }
      } else if (mode === "yaml") {
        // Switching from YAML: parse and update React Flow state
        const result = parseCollectorYamlToGraph(yamlText, {
          id: initialGraph.id,
          label: initialGraph.label,
        });
        const flow = toFlow(result.graph);
        setNodes(flow.nodes);
        setEdges(flow.edges);
        setYamlError(null);
      }

      setModeState(nextMode);
    },
    [mode, graph, yamlText, initialGraph, setNodes, setEdges],
  );

  // YAML text change handler (only meaningful in yaml mode)
  const handleSetYamlText = useCallback(
    (yaml: string) => {
      setYamlTextState(yaml);

      // Try to parse immediately to show errors
      try {
        parseCollectorYamlToGraph(yaml, { id: initialGraph.id, label: initialGraph.label });
        setYamlError(null);
      } catch {
        // YAML parse error - will be shown in validation
        setYamlError("YAML syntax error");
      }
    },
    [initialGraph],
  );

  // Reset graph (e.g., when loading a new config)
  const resetGraph = useCallback(
    (newGraph: PipelineGraph) => {
      const flow = toFlow(newGraph);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setYamlTextState(renderCollectorYamlSafe(newGraph));
      setYamlError(null);
    },
    [setNodes, setEdges],
  );

  return {
    mode,
    setMode,
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    yamlText,
    setYamlText: handleSetYamlText,
    yamlError,
    graph,
    validation,
    resetGraph,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function renderCollectorYamlSafe(graph: PipelineGraph): string {
  try {
    return renderCollectorYaml(graph);
  } catch {
    return "";
  }
}
