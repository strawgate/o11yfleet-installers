/**
 * to-graph.ts — Schema projection from site BuilderNode/BuilderEdge to core PipelineGraph.
 *
 * The canonical model lives in @o11yfleet/core/pipeline. This module bridges
 * from the site's BuilderNode/BuilderEdge types back to the core PipelineGraph.
 *
 * The core flowToGraph() handles position persistence and round-tripping.
 * This module maps from site types to core types.
 */

import { flowToGraph } from "@o11yfleet/core/pipeline";
import type { BuilderEdge, BuilderNode } from "../types";
import type { PipelineComponent, PipelineNode, PipelineEdge } from "@o11yfleet/core/pipeline";

/**
 * Site BuilderNode/BuilderEdge → PipelineGraph.
 *
 * @param flow - The site's nodes and edges
 * @param identity - Graph identity (id, label, description)
 * @param baseline - Optional map for preserving config fields through round-trip
 */
export function toGraph(
  flow: { nodes: BuilderNode[]; edges: BuilderEdge[] },
  identity: { id: string; label: string; description?: string },
  baseline?: Map<string, PipelineComponent>,
): ReturnType<typeof flowToGraph> {
  // Map site BuilderNode → core PipelineNode
  const nodes: PipelineNode[] = flow.nodes.map(mapToCoreNode);

  // Map site BuilderEdge → core PipelineEdge
  const edges: PipelineEdge[] = flow.edges.map(mapToCoreEdge);

  return flowToGraph(
    nodes,
    edges,
    { id: identity.id, label: identity.label, description: identity.description },
    baseline,
  );
}

/**
 * Map a site BuilderNode to a core PipelineNode.
 * Reconstructs the minimal component data needed for round-trip.
 */
function mapToCoreNode(node: BuilderNode): PipelineNode {
  // The minimal component info we need for round-trip
  const component: PipelineComponent = {
    id: node.id,
    role: node.type === "connector" ? "processor" : (node.type ?? "processor"),
    type: node.data.name, // Use name as type in this direction
    name: node.data.name,
    signals: node.data.signals,
    config: {},
  };

  return {
    id: node.id,
    type: component.role,
    position: node.position,
    data: { component },
  };
}

/**
 * Map a site BuilderEdge to a core PipelineEdge.
 */
function mapToCoreEdge(edge: BuilderEdge): PipelineEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "signal",
    data: {
      wire: {
        from: edge.source,
        to: edge.target,
        signal: edge.data?.signal ?? "metrics",
      },
    },
  };
}
