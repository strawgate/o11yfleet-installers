/**
 * Public surface for the pipeline builder.
 *
 * Pages import lazy:
 *   const Canvas = lazy(() => import("@/components/pipeline-builder/Canvas").then((m) => ({ default: m.Canvas })));
 */

export { Canvas, type CanvasProps } from "./Canvas";
export { ValidationStrip, type ValidationStripProps } from "./ValidationStrip";
export { toFlow } from "./schema/to-flow";
export { toGraph } from "./schema/to-graph";
export { layoutLR } from "./layout/dagre-layout";

export type {
  BuilderNode,
  BuilderEdge,
  BuilderNodeData,
  BuilderEdgeData,
  BuilderRole,
  ComponentLayout,
} from "./types";
