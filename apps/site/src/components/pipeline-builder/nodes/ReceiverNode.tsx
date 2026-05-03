import { Position, type NodeProps } from "@xyflow/react";
import { PipelineComponentNode } from "./PipelineComponentNode";
import { NodeHandle } from "./NodeHandle";
import { SignalBadge } from "../SignalBadge";
import type { BuilderNode } from "../types";

export function ReceiverNode({ data, selected }: NodeProps<BuilderNode>) {
  return (
    <>
      <PipelineComponentNode
        role="receiver"
        name={data.name}
        type={data.type}
        health={data.health}
        selected={selected}
        invalid={data.invalid}
        signals={data.signals.map((s) => (
          <SignalBadge key={s} signal={s} />
        ))}
      />
      <NodeHandle type="source" position={Position.Right} />
    </>
  );
}
