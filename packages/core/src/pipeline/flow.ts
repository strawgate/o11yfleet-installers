/**
 * flow.ts — React Flow adapter for pipeline graphs.
 *
 * This module provides bidirectional conversion between the canonical PipelineGraph
 * model (core) and React Flow's Node/Edge types (site). The canonical model
 * lives in core; React Flow state is always derived from it.
 *
 * Design principles:
 * 1. graphToFlow is the primary direction (core → site)
 * 2. flowToGraph is the inverse (site → core) for round-tripping
 * 3. Node positions are stored in component.config._layout for persistence
 * 4. Column layout uses fixed x-coordinates: receivers=0, processors=300, exporters=600
 *
 * Note: This module defines its own minimal Node/Edge types that mirror React Flow's
 * API without importing from @xyflow/react. This keeps core free of React dependencies.
 */

import type {
  PipelineComponent,
  PipelineComponentRole,
  PipelineGraph,
  PipelineSignal,
  PipelineWire,
} from "./types.js";

/* ------------------------------------------------------------------ */
/*  Minimal Node/Edge types (React Flow API compatible)               */
/* ------------------------------------------------------------------ */

/**
 * A React Flow node with pipeline-specific data.
 * Position is stored in component.config._layout for round-trip preservation.
 *
 * Compatible with @xyflow/react Node type:
 * type PipelineNode = Node<PipelineNodeData, PipelineComponentRole>
 */
export interface PipelineNode {
  id: string;
  type: PipelineComponentRole | undefined;
  position: { x: number; y: number };
  data: PipelineNodeData;
  selected?: boolean;
  dragging?: boolean;
  [key: string]: unknown;
}

/**
 * Data payload for a PipelineNode.
 */
export interface PipelineNodeData {
  component: PipelineComponent;
}

/**
 * A React Flow edge with pipeline-specific data.
 * The edge type is always "signal" (defined in the site).
 *
 * Compatible with @xyflow/react Edge type:
 * type PipelineEdge = Edge<PipelineEdgeData, "signal">
 */
export interface PipelineEdge {
  id: string;
  source: string;
  target: string;
  type: "signal";
  data?: PipelineEdgeData;
  [key: string]: unknown;
}

/**
 * Data payload for a PipelineEdge.
 */
export interface PipelineEdgeData {
  wire: PipelineWire;
}

/* ------------------------------------------------------------------ */
/*  Layout constants                                                   */
/* ------------------------------------------------------------------ */

const COLUMN_X: Record<PipelineComponentRole, number> = {
  receiver: 0,
  processor: 300,
  exporter: 600,
};

const NODE_HEIGHT = 80;
const NODE_GAP_Y = 20;
const COLUMN_LABEL_HEIGHT = 40;
const CANVAS_PADDING = 40;

/* ------------------------------------------------------------------ */
/*  graphToFlow: PipelineGraph → React Flow                            */
/* ------------------------------------------------------------------ */

/**
 * Convert a PipelineGraph to React Flow nodes and edges.
 *
 * Layout algorithm:
 * - Components are grouped by role (receiver, processor, exporter)
 * - Each role gets a fixed x-coordinate (0, 300, 600)
 * - Components within a column are evenly distributed vertically
 * - Positions are stored in component.config._layout for round-trip preservation
 *
 * @param graph - The canonical pipeline graph
 * @returns React Flow nodes and edges
 */
export function graphToFlow(graph: PipelineGraph): {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
} {
  const nodes = graphToNodes(graph);
  const edges = wiresToEdges(graph.wires);
  return { nodes, edges };
}

/**
 * Get existing layout position from component config if available.
 */
function getLayoutPosition(component: PipelineComponent): { x: number; y: number } | undefined {
  const layout = component.config["_layout"];
  if (layout && typeof layout === "object" && "x" in layout && "y" in layout) {
    return { x: layout["x"] as number, y: layout["y"] as number };
  }
  return undefined;
}

/**
 * Convert PipelineGraph components to React Flow nodes with column layout.
 * Preserves existing positions from component.config._layout if available.
 */
function graphToNodes(graph: PipelineGraph): PipelineNode[] {
  // Group components by role for column layout
  const byRole = new Map<PipelineComponentRole, PipelineComponent[]>();
  for (const component of graph.components) {
    const existing = byRole.get(component.role) ?? [];
    existing.push(component);
    byRole.set(component.role, existing);
  }

  const nodes: PipelineNode[] = [];

  // Calculate y-offsets per column based on max column height
  const columnHeights = new Map<PipelineComponentRole, number>();
  for (const [role, components] of byRole) {
    // Only count components without existing positions for height calculation
    const componentsWithoutLayout = components.filter((c) => !getLayoutPosition(c));
    const height = calculateColumnHeight(componentsWithoutLayout.length);
    columnHeights.set(role, height);
  }
  const maxColumnHeight = Math.max(...columnHeights.values(), 0);
  const totalHeight = maxColumnHeight + COLUMN_LABEL_HEIGHT + CANVAS_PADDING * 2;

  for (const [role, components] of byRole) {
    const startY =
      CANVAS_PADDING +
      COLUMN_LABEL_HEIGHT +
      (totalHeight - COLUMN_LABEL_HEIGHT - columnHeights.get(role)!) / 2;
    const stepY = NODE_HEIGHT + NODE_GAP_Y;

    // Track position index for components that need layout calculation
    let positionIndex = 0;

    components.forEach((component) => {
      // Use existing position if available, otherwise calculate
      const existingPosition = getLayoutPosition(component);
      let position: { x: number; y: number };

      if (existingPosition) {
        position = existingPosition;
      } else {
        position = {
          x: COLUMN_X[role],
          y: startY + positionIndex * stepY,
        };
        positionIndex++;
      }

      nodes.push({
        id: component.id,
        type: role,
        position,
        data: { component },
      });
    });
  }

  return nodes;
}

/**
 * Calculate the total height needed for a column with n components.
 */
function calculateColumnHeight(count: number): number {
  if (count === 0) return 0;
  return count * NODE_HEIGHT + (count - 1) * NODE_GAP_Y;
}

/**
 * Convert pipeline wires to React Flow edges.
 */
function wiresToEdges(wires: PipelineWire[]): PipelineEdge[] {
  return wires.map((wire, index) => ({
    id: `e-${wire.from}-${wire.to}-${wire.signal}-${index}`,
    source: wire.from,
    target: wire.to,
    type: "signal" as const,
    data: { wire },
  }));
}

/* ------------------------------------------------------------------ */
/*  flowToGraph: React Flow → PipelineGraph                            */
/* ------------------------------------------------------------------ */

/**
 * Convert React Flow nodes and edges back to a PipelineGraph.
 *
 * @param nodes - React Flow nodes (must be PipelineNode type)
 * @param edges - React Flow edges (must be PipelineEdge type)
 * @param meta - Graph identity (id, label, description)
 * @param baseline - Optional map of original components for preserving config fields
 * @returns PipelineGraph
 */
export function flowToGraph(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
  meta: Pick<PipelineGraph, "id" | "label" | "description">,
  baseline?: Map<string, PipelineComponent>,
): PipelineGraph {
  const components = nodesToComponents(nodes, baseline);
  const wires = edgesToWires(edges);

  return {
    id: meta.id,
    label: meta.label,
    description: meta.description,
    components,
    wires,
  };
}

/**
 * Convert React Flow nodes back to PipelineComponents.
 * Persists position in component.config._layout.
 *
 * Position always comes from node.position (current state, including any drags).
 * Baseline is only used for preserving other config fields.
 */
function nodesToComponents(
  nodes: PipelineNode[],
  baseline?: Map<string, PipelineComponent>,
): PipelineComponent[] {
  return nodes.map((node) => {
    const base = baseline?.get(node.id);

    // Preserve original config, updating _layout with current position
    // Always use node.position to capture latest state including drags
    const config = { ...(base?.config ?? {}) };
    config["_layout"] = {
      x: node.position.x,
      y: node.position.y,
    };

    return {
      id: node.id,
      role: node.type ?? base?.role ?? "processor",
      type: base?.type ?? node.data.component?.type ?? node.id,
      name: node.data.component?.name ?? base?.name ?? node.id,
      signals: node.data.component?.signals ?? base?.signals ?? [],
      config,
    };
  });
}

/**
 * Convert React Flow edges back to PipelineWires.
 */
function edgesToWires(edges: PipelineEdge[]): PipelineWire[] {
  return edges
    .filter((edge): edge is PipelineEdge & { source: string; target: string } =>
      Boolean(edge.source && edge.target),
    )
    .map((edge) => ({
      from: edge.source,
      to: edge.target,
      signal: edge.data?.wire?.signal ?? "metrics",
    }));
}

/* ------------------------------------------------------------------ */
/*  Layout utilities                                                   */
/* ------------------------------------------------------------------ */

/**
 * Re-layout nodes using column layout, preserving component identities.
 * Use this when adding/removing components or resetting layout.
 *
 * @param nodes - Current nodes (with positions to update)
 * @returns Nodes with updated positions
 */
export function relayoutNodes(nodes: PipelineNode[]): PipelineNode[] {
  // Group by role
  const byRole = new Map<PipelineComponentRole, PipelineNode[]>();
  for (const node of nodes) {
    const role = node.type ?? "processor";
    const existing = byRole.get(role) ?? [];
    existing.push(node);
    byRole.set(role, existing);
  }

  // Calculate heights
  const columnHeights = new Map<PipelineComponentRole, number>();
  for (const [role, roleNodes] of byRole) {
    columnHeights.set(role, calculateColumnHeight(roleNodes.length));
  }
  const maxColumnHeight = Math.max(...columnHeights.values(), 0);
  const totalHeight = maxColumnHeight + COLUMN_LABEL_HEIGHT + CANVAS_PADDING * 2;

  // Update positions
  const result: PipelineNode[] = [];
  for (const [role, roleNodes] of byRole) {
    const startY =
      CANVAS_PADDING +
      COLUMN_LABEL_HEIGHT +
      (totalHeight - COLUMN_LABEL_HEIGHT - columnHeights.get(role)!) / 2;
    const stepY = NODE_HEIGHT + NODE_GAP_Y;

    roleNodes.forEach((node, index) => {
      result.push({
        ...node,
        position: {
          x: COLUMN_X[role],
          y: startY + index * stepY,
        },
      });
    });
  }

  return result;
}

/**
 * Get the signals that overlap between two nodes.
 * Used by the connection validation hook.
 */
export function overlappingSignals(source: PipelineNode, target: PipelineNode): PipelineSignal[] {
  const sourceSignals = new Set(source.data.component.signals);
  return target.data.component.signals.filter((s: PipelineSignal) => sourceSignals.has(s));
}

/* ------------------------------------------------------------------ */
/*  Connection validation                                              */
/* ------------------------------------------------------------------ */

/**
 * Valid role transitions in a pipeline.
 * Receivers can connect to processors or exporters.
 * Processors can connect to processors or exporters.
 * Exporters are sinks (no outgoing connections).
 */
const VALID_ROLE_TRANSITIONS: Record<PipelineComponentRole, PipelineComponentRole[]> = {
  receiver: ["processor", "exporter"],
  processor: ["processor", "exporter"],
  exporter: [],
};

/**
 * Check if a connection from source to target is valid according to OTel pipeline rules.
 *
 * Rules:
 * 1. Source must not be an exporter (sinks have no outgoing)
 * 2. Target must not be a receiver (receivers have no incoming from pipeline)
 * 3. Source and target must share at least one signal
 *
 * @param source - The source node
 * @param target - The target node
 * @returns true if the connection is valid
 */
export function isValidPipelineConnection(source: PipelineNode, target: PipelineNode): boolean {
  // Check role validity
  const sourceRole = source.type ?? "processor";
  const targetRole = target.type ?? "processor";

  // Exporters can't have outgoing connections
  if (sourceRole === "exporter") return false;

  // Receivers can't have incoming connections from pipeline components
  if (targetRole === "receiver") return false;

  // Check role transition is allowed
  if (!VALID_ROLE_TRANSITIONS[sourceRole].includes(targetRole)) return false;

  // Check signal overlap
  const overlap = overlappingSignals(source, target);
  return overlap.length > 0;
}

/**
 * Determine the signal to use for a new connection.
 * Prefers overlapping signals, falls back to source's first signal.
 *
 * @param source - The source node
 * @param target - The target node
 * @returns The signal to use for the new wire
 */
export function determineConnectionSignal(
  source: PipelineNode,
  target: PipelineNode,
): PipelineSignal {
  const overlap = overlappingSignals(source, target);
  if (overlap.length > 0) {
    // Prefer the first overlapping signal
    return overlap[0]!;
  }
  // Fall back to source's first signal
  return source.data.component.signals[0] ?? "metrics";
}
