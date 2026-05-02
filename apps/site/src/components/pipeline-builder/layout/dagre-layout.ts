import dagre from "@dagrejs/dagre";
import type { BuilderEdge, BuilderNode } from "../types";

/**
 * Left-to-right auto-layout via dagre. Pipelines flow LR by convention.
 *
 * dagre is sync and ~40 KB. elkjs would handle more cases but runs in a
 * worker and weighs ~1.5 MB — overkill for our LR pipelines.
 *
 * Returns NEW node objects with updated `position`. Caller decides whether
 * to apply (e.g., on import + on a "Tidy" button), so user-moved positions
 * aren't clobbered on every state change.
 */
export function layoutLR(
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  opts: { nodeWidth?: number; nodeHeight?: number; nodesep?: number; ranksep?: number } = {},
): BuilderNode[] {
  const { nodeWidth = 224, nodeHeight = 96, nodesep = 40, ranksep = 80 } = opts;

  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep, ranksep });

  for (const n of nodes) {
    g.setNode(n.id, {
      width: n.measured?.width ?? nodeWidth,
      height: n.measured?.height ?? nodeHeight,
    });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  return nodes.map((n) => {
    const p = g.node(n.id);
    if (!p) return n;
    return {
      ...n,
      position: {
        x: p.x - (p.width ?? nodeWidth) / 2,
        y: p.y - (p.height ?? nodeHeight) / 2,
      },
    };
  });
}
