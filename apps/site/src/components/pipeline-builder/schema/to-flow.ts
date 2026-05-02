import type { PipelineGraph } from "@o11yfleet/core/pipeline";
import type { BuilderEdge, BuilderNode, BuilderRole } from "../types";

/**
 * PipelineGraph → xyflow nodes/edges. The canonical schema lives in core;
 * this is just a view projection.
 *
 * Connector inference: PipelineGraph today only knows three roles
 * (receiver, processor, exporter). The builder UI separately renders
 * "connector" — components flagged via the catalog. For v1 we treat
 * any component with role="processor" AND signals on both input/output
 * as a candidate, but the true connector flag will land with the
 * connector-aware schema in a follow-up. For now, role maps 1:1.
 */
export function toFlow(graph: PipelineGraph): { nodes: BuilderNode[]; edges: BuilderEdge[] } {
  const nodes: BuilderNode[] = graph.components.map((c) => {
    const role: BuilderRole = c.role; // TODO: detect connectors via catalog
    const layout = (c.config["_layout"] ?? null) as { x: number; y: number } | null;
    return {
      id: c.id,
      type: role,
      position: layout ?? { x: 0, y: 0 },
      data: {
        name: c.name || c.type,
        signals: c.signals,
      },
    };
  });

  const edges: BuilderEdge[] = graph.wires.map((w, i) => ({
    id: `e-${w.from}-${w.to}-${w.signal}-${i}`,
    source: w.from,
    target: w.to,
    type: "signal" as const,
    data: { signal: w.signal },
  }));

  return { nodes, edges };
}
