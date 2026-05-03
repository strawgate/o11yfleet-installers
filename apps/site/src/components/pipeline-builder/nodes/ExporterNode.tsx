import { Position, type NodeProps } from "@xyflow/react";
import { PipelineComponentNode } from "./PipelineComponentNode";
import { NodeHandle } from "./NodeHandle";
import { SignalBadge } from "../SignalBadge";
import type { BuilderNode } from "../types";

export function ExporterNode({ data, selected }: NodeProps<BuilderNode>) {
  return (
    <>
      <NodeHandle type="target" position={Position.Left} />
      <PipelineComponentNode
        role="exporter"
        name={data.name}
        type={data.type}
        health={data.health}
        selected={selected}
        invalid={data.invalid}
        signals={data.signals.map((s) => (
          <SignalBadge key={s} signal={s} />
        ))}
      />
    </>
  );
}
