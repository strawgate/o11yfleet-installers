import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NodeCard } from "./NodeCard";
import { SignalBadge } from "../SignalBadge";
import type { BuilderNode } from "../types";
import classes from "./node.module.css";

export function ReceiverNode({ data, selected }: NodeProps<BuilderNode>) {
  return (
    <>
      <NodeCard
        role="receiver"
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
