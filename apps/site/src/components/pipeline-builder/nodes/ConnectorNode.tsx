import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NodeCard } from "./NodeCard";
import { SignalBadge } from "../SignalBadge";
import type { BuilderNode } from "../types";
import classes from "./node.module.css";

/**
 * Connectors act as both exporter (input) and receiver (output) so they
 * fan out / fan in between signal types. We render both handles like a
 * processor; differentiation is the role label and palette ordering.
 */
export function ConnectorNode({ data, selected }: NodeProps<BuilderNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} className={classes["handle"]} />
      <NodeCard
        role="connector"
        name={data.name}
        selected={selected}
        invalid={data.invalid}
        signals={data.signals.map((s) => (
          <SignalBadge key={s} signal={s} />
        ))}
      />
      <Handle type="source" position={Position.Right} className={classes["handle"]} />
    </>
  );
}
