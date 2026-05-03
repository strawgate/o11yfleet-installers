/**
 * to-flow.ts — Schema projection from core PipelineGraph to site BuilderNode/BuilderEdge.
 *
 * The canonical model lives in @o11yfleet/core/pipeline. This module bridges
 * to the site's BuilderNode/BuilderEdge types used by the canvas.
 *
 * The core graphToFlow() handles column layout. This module maps the result
 * to the site's type system (BuilderNode has data.name/signals, not data.component).
 */

import { graphToFlow } from "@o11yfleet/core/pipeline";
import type { BuilderEdge, BuilderNode } from "../types";
import type { PipelineNode, PipelineEdge } from "@o11yfleet/core/pipeline";

/**
 * PipelineGraph → site BuilderNode/BuilderEdge.
 * Uses core's graphToFlow for layout, then maps to site types.
 */
export function toFlow(graph: Parameters<typeof graphToFlow>[0]): {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
} {
  const flow = graphToFlow(graph);

  // Map core PipelineNode → site BuilderNode
  const nodes: BuilderNode[] = flow.nodes.map(mapNode);

  // Map core PipelineEdge → site BuilderEdge
  const edges: BuilderEdge[] = flow.edges.map(mapEdge);

  return { nodes, edges };
}

/**
 * Map a core PipelineNode to a site BuilderNode.
 */
function mapNode(node: PipelineNode): BuilderNode {
  return {
    id: node.id,
    type: node.type ?? "processor",
    position: node.position,
    data: {
      name: node.data.component?.name ?? node.id,
      type: node.data.component?.type ?? "unknown",
      signals: node.data.component?.signals ?? [],
    },
  };
}

/**
 * Map a core PipelineEdge to a site BuilderEdge.
 */
function mapEdge(edge: PipelineEdge): BuilderEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.type,
    data: {
      signal: edge.data?.wire.signal ?? "metrics",
    },
  };
}
