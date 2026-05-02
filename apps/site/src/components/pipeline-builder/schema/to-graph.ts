import type { PipelineGraph, PipelineComponent } from "@o11yfleet/core/pipeline";
import type { BuilderEdge, BuilderNode } from "../types";

/**
 * xyflow nodes/edges → PipelineGraph. Inverse of toFlow. Persists the
 * node `position` into `component.config._layout` so a save+load round-trip
 * preserves the canvas placement.
 *
 * The PipelineGraph this returns mirrors the input graph identity (id,
 * label, description) — caller passes those through.
 */
export function toGraph(
  flow: { nodes: BuilderNode[]; edges: BuilderEdge[] },
  identity: Pick<PipelineGraph, "id" | "label" | "description">,
  // Optional: original components carry preserved fields (type, config sans
  // _layout). Without it, we synthesise minimal components.
  baseline?: Map<string, PipelineComponent>,
): PipelineGraph {
  const components: PipelineComponent[] = flow.nodes.map((n) => {
    const base = baseline?.get(n.id);
    const config = { ...(base?.config ?? {}) } as Record<string, unknown>;
    config["_layout"] = { x: n.position.x, y: n.position.y };
    return {
      id: n.id,
      role: n.type === "connector" ? "processor" : (n.type ?? "processor"),
      type: base?.type ?? n.data.name,
      name: n.data.name,
      signals: n.data.signals,
      config: config as PipelineComponent["config"],
    };
  });

  const wires = flow.edges.map((e) => ({
    from: e.source,
    to: e.target,
    signal: e.data?.signal ?? "metrics",
  }));

  return {
    id: identity.id,
    label: identity.label,
    description: identity.description,
    components,
    wires,
  };
}
