import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { signalStroke } from "../SignalBadge";
import type { BuilderEdge } from "../types";
import classes from "./edge.module.css";

/**
 * Signal-typed edge. Uses smoothstep paths because pipelines are read
 * left-to-right and orthogonal segments map cleaner than bezier curves.
 *
 * `live` flips the `animated` prop, which CSS-animates the dash pattern —
 * cheap, no per-frame work in JS.
 */
export function SignalEdge(props: EdgeProps<BuilderEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, data, selected, markerEnd } = props;
  const [path, lx, ly] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    borderRadius: 8,
  });
  const stroke = data ? signalStroke(data.signal) : "var(--mantine-color-default-color)";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke, strokeWidth: selected ? 2.5 : 1.5 }}
        className={data?.live ? classes["live"] : undefined}
      />
      {(data?.throughput || data?.signal) && (
        <EdgeLabelRenderer>
          <div
            style={{ transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)` }}
            className={classes["edgeLabel"]}
          >
            {data.signal}
            {data.throughput ? ` · ${data.throughput}` : ""}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
