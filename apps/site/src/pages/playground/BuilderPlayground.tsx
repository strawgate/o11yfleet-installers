import { useCallback, useMemo, useState } from "react";
import { Button, Container, Divider, Group, Stack, Text, Title } from "@mantine/core";
import {
  Canvas,
  layoutLR,
  toFlow,
  toGraph,
  type BuilderEdge,
  type BuilderNode,
} from "@/components/pipeline-builder";
import type { PipelineGraph } from "@o11yfleet/core/pipeline";

/**
 * Dev-only playground for the xyflow-based pipeline builder. Loads a
 * fixture PipelineGraph, round-trips through toFlow / toGraph, and lets
 * you exercise dagre auto-layout.
 *
 * Mounted at /playground/builder and gated by import.meta.env.DEV.
 */
export function BuilderPlayground() {
  const [graph, setGraph] = useState<PipelineGraph>(FIXTURE);
  const [{ nodes, edges }, setFlow] = useState(() => toFlow(FIXTURE));

  const layoutedNodes = useMemo(() => nodes, [nodes]);

  const handleChange = useCallback(
    (next: { nodes: BuilderNode[]; edges: BuilderEdge[] }) => setFlow(next),
    [],
  );

  const tidy = useCallback(() => {
    setFlow((prev) => ({
      nodes: layoutLR(prev.nodes, prev.edges),
      edges: prev.edges,
    }));
  }, []);

  const reload = useCallback(() => {
    const next = toFlow(graph);
    setFlow({ nodes: layoutLR(next.nodes, next.edges), edges: next.edges });
  }, [graph]);

  const save = useCallback(() => {
    const baseline = new Map(graph.components.map((c) => [c.id, c]));
    const next = toGraph(
      { nodes, edges },
      { id: graph.id, label: graph.label, description: graph.description },
      baseline,
    );
    setGraph(next);
  }, [edges, graph, nodes]);

  return (
    <Container size="xl" py="xl">
      <Stack gap="xl">
        <Stack gap={4}>
          <Title order={2}>Pipeline builder playground</Title>
          <Text c="dimmed" size="sm">
            xyflow v12 + dagre LR layout + Mantine-themed nodes. Round-trips with the canonical
            PipelineGraph schema in <code>@o11yfleet/core/pipeline</code>. Drag nodes; connect
            handles; signals colour the edges. Connection validity enforces OTel role +
            signal-overlap rules.
          </Text>
        </Stack>

        <Group justify="space-between">
          <Group gap="xs">
            <Button size="xs" variant="default" onClick={tidy}>
              Tidy (dagre LR)
            </Button>
            <Button size="xs" variant="default" onClick={reload}>
              Reload from saved
            </Button>
            <Button size="xs" variant="filled" onClick={save}>
              Save
            </Button>
          </Group>
          <Text size="xs" c="dimmed" ff="monospace">
            {graph.components.length} components · {graph.wires.length} wires · {nodes.length} flow
            nodes · {edges.length} flow edges
          </Text>
        </Group>

        <Divider />

        <Canvas nodes={layoutedNodes} edges={edges} onChange={handleChange} height={620} />
      </Stack>
    </Container>
  );
}

// Fixture: simple OTel pipeline with otlp receiver, batch + memory_limiter
// processors, and an OTLP exporter. Position-less so dagre lays it out
// on first paint via the Tidy button (pre-laid in the toFlow call).
const FIXTURE: PipelineGraph = {
  id: "fixture-edge-gateway",
  label: "Edge gateway",
  description: "Sample pipeline for the builder playground.",
  components: [
    {
      id: "r-otlp",
      role: "receiver",
      type: "otlp",
      name: "otlp",
      signals: ["logs", "metrics", "traces"],
      config: {},
    },
    {
      id: "p-memlim",
      role: "processor",
      type: "memory_limiter",
      name: "memory_limiter",
      signals: ["logs", "metrics", "traces"],
      config: {},
    },
    {
      id: "p-batch",
      role: "processor",
      type: "batch",
      name: "batch",
      signals: ["logs", "metrics", "traces"],
      config: {},
    },
    {
      id: "p-redact",
      role: "processor",
      type: "filter",
      name: "filter/redact",
      signals: ["metrics"],
      config: {},
    },
    {
      id: "x-otlp",
      role: "exporter",
      type: "otlp",
      name: "otlp/backend",
      signals: ["logs", "metrics", "traces"],
      config: {},
    },
  ],
  wires: [
    { from: "r-otlp", to: "p-memlim", signal: "logs" },
    { from: "r-otlp", to: "p-memlim", signal: "metrics" },
    { from: "r-otlp", to: "p-memlim", signal: "traces" },
    { from: "p-memlim", to: "p-batch", signal: "logs" },
    { from: "p-memlim", to: "p-redact", signal: "metrics" },
    { from: "p-redact", to: "p-batch", signal: "metrics" },
    { from: "p-memlim", to: "p-batch", signal: "traces" },
    { from: "p-batch", to: "x-otlp", signal: "logs" },
    { from: "p-batch", to: "x-otlp", signal: "metrics" },
    { from: "p-batch", to: "x-otlp", signal: "traces" },
  ],
};
