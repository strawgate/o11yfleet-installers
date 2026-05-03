import type { Edge, Node } from "@xyflow/react";
import type { PipelineSignal } from "@o11yfleet/core/pipeline";
import type { ComponentHealth } from "@o11yfleet/core/codec";

/**
 * Pipeline-builder-local types. Keeps the xyflow node/edge view shape
 * separate from the canonical PipelineGraph schema (which lives in
 * @o11yfleet/core). The schema is the source of truth; the flow is a view.
 */

export type BuilderRole = "receiver" | "processor" | "exporter" | "connector";

export type BuilderNodeData = {
  /** OTel component name, e.g. "otlp", "batch", "filter/redact". */
  name: string;
  /** Component type, e.g. "otlp", "batch" */
  type: string;
  /** Signals this component accepts/emits. */
  signals: PipelineSignal[];
  /** Validation error message; renders red border and X icon when set. */
  invalid?: string;
  /** Health status of the component. */
  health?: ComponentHealth;
};

export type BuilderNode = Node<BuilderNodeData, BuilderRole>;

export type BuilderEdgeData = {
  signal: PipelineSignal;
  /** Optional throughput annotation; the structure is here for future
   * live-data overlays without forcing a schema bump. */
  throughput?: string;
  /** When true, edge animates to indicate live data. */
  live?: boolean;
};

export type BuilderEdge = Edge<BuilderEdgeData, "signal">;

/** Layout metadata persisted alongside PipelineGraph components on save. */
export type ComponentLayout = {
  x: number;
  y: number;
};
