import { useCallback, useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  addEdge,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useComputedColorScheme } from "@mantine/core";
import { nanoid } from "nanoid";
import { nodeTypes } from "./nodes/nodeTypes";
import { edgeTypes } from "./edges/edgeTypes";
import { usePipelineConnectionValidation } from "./hooks/usePipelineConnectionValidation";
import { determineConnectionSignal } from "@o11yfleet/core/pipeline";
import type { BuilderEdge, BuilderNode } from "./types";
import { mapToCoreNode } from "./schema/to-graph";

export type CanvasProps = {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  onChange: (next: { nodes: BuilderNode[]; edges: BuilderEdge[] }) => void;
  readOnly?: boolean;
  height?: number;
};

/**
 * Wraps <ReactFlow> with our node/edge types, validity rules, and
 * controlled state propagation. Caller owns the canonical state in a
 * Zustand store or useState — Canvas is pure presentation.
 */
export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({ nodes, edges, onChange, readOnly, height = 600 }: CanvasProps) {
  const scheme = useComputedColorScheme("dark");

  const nodeMap = useMemo(() => {
    const m = new Map<string, BuilderNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const isValidConnection = usePipelineConnectionValidation(nodeMap);

  const onNodesChange = useCallback(
    (changes: NodeChange<BuilderNode>[]) => {
      onChange({ nodes: applyNodeChanges<BuilderNode>(changes, nodes), edges });
    },
    [edges, nodes, onChange],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<BuilderEdge>[]) => {
      onChange({ nodes, edges: applyEdgeChanges<BuilderEdge>(changes, edges) });
    },
    [edges, nodes, onChange],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const src = nodeMap.get(c.source);
      const tgt = nodeMap.get(c.target);
      if (!src || !tgt) return;

      const signal = determineConnectionSignal(mapToCoreNode(src), mapToCoreNode(tgt));

      const newEdge: BuilderEdge = {
        id: `e-${nanoid(6)}`,
        source: c.source,
        target: c.target,
        type: "signal",
        data: { signal },
      };
      onChange({ nodes, edges: addEdge(newEdge, edges) });
    },
    [edges, nodeMap, nodes, onChange],
  );

  return (
    <div style={{ width: "100%", height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={readOnly ? undefined : onNodesChange}
        onEdgesChange={readOnly ? undefined : onEdgesChange}
        onConnect={readOnly ? undefined : onConnect}
        isValidConnection={isValidConnection}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={!readOnly}
        fitView
        proOptions={{ hideAttribution: true }}
        colorMode={scheme}
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
