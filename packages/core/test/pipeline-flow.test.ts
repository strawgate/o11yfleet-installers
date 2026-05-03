import { describe, expect, it } from "vitest";
import {
  graphToFlow,
  flowToGraph,
  relayoutNodes,
  overlappingSignals,
  isValidPipelineConnection,
  determineConnectionSignal,
  PIPELINE_EXAMPLES,
  type PipelineGraph,
  type PipelineNode,
  type PipelineEdge,
  type PipelineComponentRole,
  type PipelineSignal,
} from "../src/pipeline/index.js";

/* ------------------------------------------------------------------ */
/*  Test fixtures                                                     */
/* ------------------------------------------------------------------ */

const simpleGraph: PipelineGraph = {
  id: "simple",
  label: "Simple graph",
  description: "A simple receiver -> processor -> exporter graph",
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
      id: "p-batch",
      role: "processor",
      type: "batch",
      name: "batch",
      signals: ["logs", "metrics", "traces"],
      config: {},
    },
    {
      id: "e-debug",
      role: "exporter",
      type: "debug",
      name: "debug",
      signals: ["logs", "metrics", "traces"],
      config: {},
    },
  ],
  wires: [
    { from: "r-otlp", to: "p-batch", signal: "logs" },
    { from: "p-batch", to: "e-debug", signal: "logs" },
    { from: "r-otlp", to: "p-batch", signal: "metrics" },
    { from: "p-batch", to: "e-debug", signal: "metrics" },
  ],
};

/* ------------------------------------------------------------------ */
/*  graphToFlow tests                                                 */
/* ------------------------------------------------------------------ */

describe("graphToFlow", () => {
  it("converts a simple graph to nodes and edges", () => {
    const { nodes, edges } = graphToFlow(simpleGraph);

    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(4);

    // Check node positions by role
    const receivers = nodes.filter((n) => n.type === "receiver");
    const processors = nodes.filter((n) => n.type === "processor");
    const exporters = nodes.filter((n) => n.type === "exporter");

    expect(receivers).toHaveLength(1);
    expect(processors).toHaveLength(1);
    expect(exporters).toHaveLength(1);

    // Check column layout
    expect(receivers[0]!.position.x).toBe(0);
    expect(processors[0]!.position.x).toBe(300);
    expect(exporters[0]!.position.x).toBe(600);
  });

  it("assigns correct roles to nodes", () => {
    const { nodes } = graphToFlow(simpleGraph);

    for (const node of nodes) {
      const component = node.data.component;
      expect(node.type).toBe(component.role);
    }
  });

  it("preserves component data in node data", () => {
    const { nodes } = graphToFlow(simpleGraph);

    const otlpNode = nodes.find((n) => n.id === "r-otlp");
    expect(otlpNode?.data.component.name).toBe("otlp");
    expect(otlpNode?.data.component.type).toBe("otlp");
    expect(otlpNode?.data.component.signals).toEqual(["logs", "metrics", "traces"]);
  });

  it("creates edges with signal data", () => {
    const { edges } = graphToFlow(simpleGraph);

    const logsEdges = edges.filter((e) => e.data?.wire?.signal === "logs");
    expect(logsEdges).toHaveLength(2);

    const metricsEdges = edges.filter((e) => e.data?.wire?.signal === "metrics");
    expect(metricsEdges).toHaveLength(2);
  });

  it("handles empty graph", () => {
    const empty: PipelineGraph = {
      id: "empty",
      label: "Empty",
      components: [],
      wires: [],
    };

    const { nodes, edges } = graphToFlow(empty);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it("handles graph with only receivers", () => {
    const receiversOnly: PipelineGraph = {
      id: "receivers-only",
      label: "Receivers only",
      components: [
        { id: "r1", role: "receiver", type: "otlp", name: "otlp1", signals: ["logs"], config: {} },
        { id: "r2", role: "receiver", type: "otlp", name: "otlp2", signals: ["logs"], config: {} },
      ],
      wires: [],
    };

    const { nodes, edges } = graphToFlow(receiversOnly);
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(0);

    // Both should be at x=0, stacked vertically
    expect(nodes[0]!.position.x).toBe(0);
    expect(nodes[1]!.position.x).toBe(0);
    expect(nodes[0]!.position.y).not.toBe(nodes[1]!.position.y);
  });

  it("handles multi-signal components", () => {
    const multiSignal: PipelineGraph = {
      id: "multi",
      label: "Multi signal",
      components: [
        {
          id: "r1",
          role: "receiver",
          type: "otlp",
          name: "otlp",
          signals: ["logs", "metrics"],
          config: {},
        },
        { id: "e1", role: "exporter", type: "debug", name: "debug", signals: ["logs"], config: {} },
      ],
      wires: [{ from: "r1", to: "e1", signal: "logs" }],
    };

    const { edges } = graphToFlow(multiSignal);
    expect(edges[0]!.data.wire.signal).toBe("logs");
  });

  it("layouts multiple components per column with vertical spacing", () => {
    const multiPerColumn: PipelineGraph = {
      id: "multi-col",
      label: "Multi per column",
      components: [
        { id: "r1", role: "receiver", type: "otlp", name: "otlp1", signals: ["logs"], config: {} },
        { id: "r2", role: "receiver", type: "otlp", name: "otlp2", signals: ["logs"], config: {} },
        { id: "r3", role: "receiver", type: "otlp", name: "otlp3", signals: ["logs"], config: {} },
        { id: "e1", role: "exporter", type: "debug", name: "debug", signals: ["logs"], config: {} },
      ],
      wires: [],
    };

    const { nodes } = graphToFlow(multiPerColumn);

    const receivers = nodes
      .filter((n) => n.type === "receiver")
      .sort((a, b) => a.position.y - b.position.y);

    // Should be stacked vertically
    expect(receivers[0]!.position.y).toBeLessThan(receivers[1]!.position.y);
    expect(receivers[1]!.position.y).toBeLessThan(receivers[2]!.position.y);

    // Same x position
    for (const r of receivers) {
      expect(r.position.x).toBe(0);
    }
  });

  it("matches PIPELINE_EXAMPLES edge-gateway", () => {
    const { nodes, edges } = graphToFlow(PIPELINE_EXAMPLES["edge-gateway"]!);

    // edge-gateway has 5 components: 1 receiver, 3 processors, 1 exporter
    // wires: r1→p1 (3), p1→p2 (3), p2→p3 (3), p3→e1 (3) = 12 total
    expect(nodes).toHaveLength(5);
    expect(edges).toHaveLength(12);

    // Check column assignment
    const receivers = nodes.filter((n) => n.type === "receiver");
    const processors = nodes.filter((n) => n.type === "processor");
    const exporters = nodes.filter((n) => n.type === "exporter");

    expect(receivers).toHaveLength(1);
    expect(processors).toHaveLength(3);
    expect(exporters).toHaveLength(1);
  });

  it("matches PIPELINE_EXAMPLES host-monitor", () => {
    const { nodes, edges } = graphToFlow(PIPELINE_EXAMPLES["host-monitor"]!);

    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(2); // 1 signal × 2 wires
  });
});

/* ------------------------------------------------------------------ */
/*  flowToGraph tests                                                 */
/* ------------------------------------------------------------------ */

describe("flowToGraph", () => {
  it("converts nodes and edges back to a graph", () => {
    const { nodes: originalNodes, edges: originalEdges } = graphToFlow(simpleGraph);
    const graph = flowToGraph(originalNodes, originalEdges, {
      id: "round-trip",
      label: "Round trip",
      description: "Testing round trip",
    });

    expect(graph.id).toBe("round-trip");
    expect(graph.label).toBe("Round trip");
    expect(graph.description).toBe("Testing round trip");

    // Components should be preserved
    expect(graph.components).toHaveLength(simpleGraph.components.length);

    // Wires should be preserved
    expect(graph.wires).toHaveLength(simpleGraph.wires.length);
  });

  it("preserves component identities through round trip", () => {
    const { nodes, edges } = graphToFlow(simpleGraph);
    const graph = flowToGraph(nodes, edges, { id: "test", label: "Test", description: undefined });

    for (const original of simpleGraph.components) {
      const roundTripped = graph.components.find((c) => c.id === original.id);
      expect(roundTripped).toBeDefined();
      expect(roundTripped!.name).toBe(original.name);
      expect(roundTripped!.type).toBe(original.type);
      expect(roundTripped!.role).toBe(original.role);
      expect(roundTripped!.signals).toEqual(original.signals);
    }
  });

  it("preserves wire identities through round trip", () => {
    const { nodes, edges } = graphToFlow(simpleGraph);
    const graph = flowToGraph(nodes, edges, { id: "test", label: "Test", description: undefined });

    // Sort both by from/to for comparison
    const originalWires = [...simpleGraph.wires].sort(
      (a, b) =>
        a.from.localeCompare(b.from) ||
        a.to.localeCompare(b.to) ||
        a.signal.localeCompare(b.signal),
    );
    const roundTrippedWires = [...graph.wires].sort(
      (a, b) =>
        a.from.localeCompare(b.from) ||
        a.to.localeCompare(b.to) ||
        a.signal.localeCompare(b.signal),
    );

    expect(roundTrippedWires).toEqual(originalWires);
  });

  it("handles empty nodes array", () => {
    const graph = flowToGraph([], [], { id: "empty", label: "Empty", description: undefined });
    expect(graph.components).toHaveLength(0);
    expect(graph.wires).toHaveLength(0);
  });

  it("handles empty edges array", () => {
    const { nodes } = graphToFlow(simpleGraph);
    const graph = flowToGraph(nodes, [], {
      id: "no-edges",
      label: "No edges",
      description: undefined,
    });
    expect(graph.wires).toHaveLength(0);
    expect(graph.components).toHaveLength(simpleGraph.components.length);
  });

  it("preserves existing _layout positions from component config", () => {
    // Create a graph with components that have existing layout positions
    const graphWithLayout: PipelineGraph = {
      id: "layout-test",
      label: "Layout Test",
      components: [
        {
          id: "receiver-1",
          role: "receiver",
          type: "otlp",
          name: "OTLP Receiver",
          signals: ["metrics", "traces"],
          config: {
            _layout: { x: 50, y: 150 },
          },
        },
        {
          id: "processor-1",
          role: "processor",
          type: "batch",
          name: "Batch Processor",
          signals: ["metrics"],
          config: {
            _layout: { x: 400, y: 200 },
          },
        },
      ],
      wires: [],
    };

    const { nodes } = graphToFlow(graphWithLayout);

    // Nodes should preserve their existing layout positions
    const receiverNode = nodes.find((n) => n.id === "receiver-1");
    const processorNode = nodes.find((n) => n.id === "processor-1");

    expect(receiverNode?.position).toEqual({ x: 50, y: 150 });
    expect(processorNode?.position).toEqual({ x: 400, y: 200 });
  });

  it("calculates new positions for components without _layout", () => {
    // Create a graph with some components having layout and some without
    const mixedGraph: PipelineGraph = {
      id: "mixed-layout",
      label: "Mixed Layout",
      components: [
        {
          id: "with-layout",
          role: "receiver",
          type: "otlp",
          name: "OTLP Receiver",
          signals: ["metrics"],
          config: {
            _layout: { x: 50, y: 150 },
          },
        },
        {
          id: "without-layout",
          role: "receiver",
          type: "prometheus",
          name: "Prometheus Receiver",
          signals: ["metrics"],
          config: {},
        },
      ],
      wires: [],
    };

    const { nodes } = graphToFlow(mixedGraph);

    // The node with layout should preserve its position
    const withLayout = nodes.find((n) => n.id === "with-layout");
    expect(withLayout?.position).toEqual({ x: 50, y: 150 });

    // The node without layout should get a calculated position (column x=0)
    const withoutLayout = nodes.find((n) => n.id === "without-layout");
    expect(withoutLayout?.position.x).toBe(0);
    expect(withoutLayout?.position.y).toBeGreaterThanOrEqual(0);
  });

  it("uses baseline config when provided", () => {
    const baseline = new Map(simpleGraph.components.map((c) => [c.id, c]));
    const { nodes, edges } = graphToFlow(simpleGraph);

    // Modify a node's position
    nodes[0]!.position = { x: 999, y: 999 };

    const graph = flowToGraph(
      nodes,
      edges,
      { id: "test", label: "Test", description: undefined },
      baseline,
    );

    // The component should have _layout with the current position
    const component = graph.components.find((c) => c.id === nodes[0]!.id)!;
    expect(component.config["_layout"]).toEqual({ x: 999, y: 999 });
  });

  it("falls back to current node position when no baseline", () => {
    const { nodes, edges } = graphToFlow(simpleGraph);

    // Modify a node's position
    nodes[0]!.position = { x: 123, y: 456 };

    const graph = flowToGraph(nodes, edges, { id: "test", label: "Test", description: undefined });

    const component = graph.components.find((c) => c.id === nodes[0]!.id)!;
    expect(component.config["_layout"]).toEqual({ x: 123, y: 456 });
  });

  it("handles edges with missing source/target gracefully", () => {
    const badEdges: PipelineEdge[] = [
      {
        id: "e1",
        source: "",
        target: "r-otlp",
        type: "signal",
        data: { wire: { from: "", to: "r-otlp", signal: "logs" } },
      },
      {
        id: "e2",
        source: "r-otlp",
        target: "",
        type: "signal",
        data: { wire: { from: "r-otlp", to: "", signal: "logs" } },
      },
    ];

    const { nodes } = graphToFlow(simpleGraph);
    const graph = flowToGraph(nodes, badEdges, {
      id: "test",
      label: "Test",
      description: undefined,
    });

    // Should filter out invalid edges
    expect(graph.wires).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  relayoutNodes tests                                               */
/* ------------------------------------------------------------------ */

describe("relayoutNodes", () => {
  it("reassigns column positions based on role", () => {
    const nodes: PipelineNode[] = [
      {
        id: "r1",
        type: "receiver",
        position: { x: 500, y: 500 },
        data: { component: simpleGraph.components[0]! },
      },
      {
        id: "p1",
        type: "processor",
        position: { x: 500, y: 500 },
        data: { component: simpleGraph.components[1]! },
      },
      {
        id: "e1",
        type: "exporter",
        position: { x: 500, y: 500 },
        data: { component: simpleGraph.components[2]! },
      },
    ];

    const relayouted = relayoutNodes(nodes);

    const receiver = relayouted.find((n) => n.id === "r1")!;
    const processor = relayouted.find((n) => n.id === "p1")!;
    const exporter = relayouted.find((n) => n.id === "e1")!;

    expect(receiver.position.x).toBe(0);
    expect(processor.position.x).toBe(300);
    expect(exporter.position.x).toBe(600);
  });

  it("stacks multiple nodes in same column", () => {
    const nodes: PipelineNode[] = [
      {
        id: "r1",
        type: "receiver",
        position: { x: 0, y: 0 },
        data: { component: { ...simpleGraph.components[0]!, id: "r1", name: "otlp1" } },
      },
      {
        id: "r2",
        type: "receiver",
        position: { x: 0, y: 0 },
        data: { component: { ...simpleGraph.components[0]!, id: "r2", name: "otlp2" } },
      },
    ];

    const relayouted = relayoutNodes(nodes);

    expect(relayouted[0]!.position.y).not.toBe(relayouted[1]!.position.y);
    // Both should have x=0
    expect(relayouted[0]!.position.x).toBe(0);
    expect(relayouted[1]!.position.x).toBe(0);
  });

  it("handles empty array", () => {
    const result = relayoutNodes([]);
    expect(result).toHaveLength(0);
  });

  it("preserves other node properties", () => {
    const nodes: PipelineNode[] = [
      {
        id: "r1",
        type: "receiver",
        position: { x: 0, y: 0 },
        data: { component: simpleGraph.components[0]! },
        selected: true,
      },
    ];

    const relayouted = relayoutNodes(nodes);

    expect(relayouted[0]!.id).toBe("r1");
    expect(relayouted[0]!.selected).toBe(true);
    expect(relayouted[0]!.data).toBe(nodes[0]!.data);
  });
});

/* ------------------------------------------------------------------ */
/*  overlappingSignals tests                                           */
/* ------------------------------------------------------------------ */

describe("overlappingSignals", () => {
  it("returns signals present in both nodes", () => {
    const source: PipelineNode = {
      id: "r1",
      type: "receiver",
      position: { x: 0, y: 0 },
      data: {
        component: {
          id: "r1",
          role: "receiver",
          type: "otlp",
          name: "otlp",
          signals: ["logs", "metrics", "traces"],
          config: {},
        },
      },
    };

    const target: PipelineNode = {
      id: "p1",
      type: "processor",
      position: { x: 300, y: 0 },
      data: {
        component: {
          id: "p1",
          role: "processor",
          type: "batch",
          name: "batch",
          signals: ["logs", "metrics"],
          config: {},
        },
      },
    };

    const overlap = overlappingSignals(source, target);
    expect(overlap).toEqual(["logs", "metrics"]);
  });

  it("returns empty array when no overlap", () => {
    const source: PipelineNode = {
      id: "r1",
      type: "receiver",
      position: { x: 0, y: 0 },
      data: {
        component: {
          id: "r1",
          role: "receiver",
          type: "hostmetrics",
          name: "hostmetrics",
          signals: ["metrics"],
          config: {},
        },
      },
    };

    const target: PipelineNode = {
      id: "e1",
      type: "exporter",
      position: { x: 600, y: 0 },
      data: {
        component: {
          id: "e1",
          role: "exporter",
          type: "debug",
          name: "debug",
          signals: ["logs"],
          config: {},
        },
      },
    };

    const overlap = overlappingSignals(source, target);
    expect(overlap).toHaveLength(0);
  });

  it("returns single signal when only one overlaps", () => {
    const source: PipelineNode = {
      id: "r1",
      type: "receiver",
      position: { x: 0, y: 0 },
      data: {
        component: {
          id: "r1",
          role: "receiver",
          type: "otlp",
          name: "otlp",
          signals: ["logs", "metrics"],
          config: {},
        },
      },
    };

    const target: PipelineNode = {
      id: "e1",
      type: "exporter",
      position: { x: 600, y: 0 },
      data: {
        component: {
          id: "e1",
          role: "exporter",
          type: "debug",
          name: "debug",
          signals: ["traces"],
          config: {},
        },
      },
    };

    const overlap = overlappingSignals(source, target);
    expect(overlap).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Column layout integration tests                                   */
/* ------------------------------------------------------------------ */

describe("column layout", () => {
  it("positions components correctly in three-column layout", () => {
    const { nodes } = graphToFlow(simpleGraph);

    const receiver = nodes.find((n) => n.type === "receiver")!;
    const processor = nodes.find((n) => n.type === "processor")!;
    const exporter = nodes.find((n) => n.type === "exporter")!;

    // Receivers at x=0, Processors at x=300, Exporters at x=600
    expect(receiver.position.x).toBe(0);
    expect(processor.position.x).toBe(300);
    expect(exporter.position.x).toBe(600);
  });

  it("centers columns vertically based on tallest column", () => {
    const mixedGraph: PipelineGraph = {
      id: "mixed",
      label: "Mixed columns",
      components: [
        { id: "r1", role: "receiver", type: "otlp", name: "otlp", signals: ["logs"], config: {} },
        {
          id: "r2",
          role: "receiver",
          type: "filelog",
          name: "filelog",
          signals: ["logs"],
          config: {},
        },
        {
          id: "r3",
          role: "receiver",
          type: "hostmetrics",
          name: "hostmetrics",
          signals: ["metrics"],
          config: {},
        },
        {
          id: "p1",
          role: "processor",
          type: "batch",
          name: "batch",
          signals: ["logs"],
          config: {},
        },
        { id: "e1", role: "exporter", type: "debug", name: "debug", signals: ["logs"], config: {} },
      ],
      wires: [],
    };

    const { nodes } = graphToFlow(mixedGraph);

    const receivers = nodes
      .filter((n) => n.type === "receiver")
      .sort((a, b) => a.position.y - b.position.y);

    // All receivers should be at x=0
    for (const r of receivers) {
      expect(r.position.x).toBe(0);
    }

    // Processor should be at x=300
    const processor = nodes.find((n) => n.id === "p1")!;
    expect(processor.position.x).toBe(300);

    // Exporter should be at x=600
    const exporter = nodes.find((n) => n.id === "e1")!;
    expect(exporter.position.x).toBe(600);
  });

  it("handles single component in each column", () => {
    const { nodes } = graphToFlow(simpleGraph);

    // Each column has exactly one component
    expect(nodes.filter((n) => n.position.x === 0)).toHaveLength(1);
    expect(nodes.filter((n) => n.position.x === 300)).toHaveLength(1);
    expect(nodes.filter((n) => n.position.x === 600)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Connection validation tests                                        */
/* ------------------------------------------------------------------ */

describe("connection validation", () => {
  const createNode = (role: PipelineComponentRole, signals: PipelineSignal[]): PipelineNode => ({
    id: `${role}-test`,
    type: role,
    position: { x: 0, y: 0 },
    data: {
      component: {
        id: `${role}-test`,
        role,
        type: role,
        name: role,
        signals,
        config: {},
      },
    },
  });

  describe("isValidPipelineConnection", () => {
    it("allows receiver to processor connection", () => {
      const receiver = createNode("receiver", ["logs", "metrics"]);
      const processor = createNode("processor", ["logs"]);
      expect(isValidPipelineConnection(receiver, processor)).toBe(true);
    });

    it("allows receiver to exporter connection", () => {
      const receiver = createNode("receiver", ["logs", "metrics"]);
      const exporter = createNode("exporter", ["logs"]);
      expect(isValidPipelineConnection(receiver, exporter)).toBe(true);
    });

    it("allows processor to processor connection", () => {
      const p1 = createNode("processor", ["logs", "metrics"]);
      const p2 = createNode("processor", ["logs"]);
      expect(isValidPipelineConnection(p1, p2)).toBe(true);
    });

    it("allows processor to exporter connection", () => {
      const processor = createNode("processor", ["logs"]);
      const exporter = createNode("exporter", ["logs"]);
      expect(isValidPipelineConnection(processor, exporter)).toBe(true);
    });

    it("rejects exporter to any connection", () => {
      const exporter = createNode("exporter", ["logs"]);
      const processor = createNode("processor", ["logs"]);
      expect(isValidPipelineConnection(exporter, processor)).toBe(false);
      expect(isValidPipelineConnection(exporter, exporter)).toBe(false);
    });

    it("rejects any to receiver connection", () => {
      const receiver = createNode("receiver", ["logs"]);
      const processor = createNode("processor", ["logs"]);
      expect(isValidPipelineConnection(processor, receiver)).toBe(false);
      expect(isValidPipelineConnection(receiver, receiver)).toBe(false);
    });

    it("rejects connections without signal overlap", () => {
      const receiver = createNode("receiver", ["logs"]);
      const processor = createNode("processor", ["metrics", "traces"]);
      expect(isValidPipelineConnection(receiver, processor)).toBe(false);
    });

    it("allows connections with partial signal overlap", () => {
      const receiver = createNode("receiver", ["logs", "metrics", "traces"]);
      const processor = createNode("processor", ["logs", "metrics"]);
      expect(isValidPipelineConnection(receiver, processor)).toBe(true);
    });
  });

  describe("determineConnectionSignal", () => {
    it("prefers overlapping signal", () => {
      const source = createNode("receiver", ["logs", "metrics"]);
      const target = createNode("processor", ["metrics", "traces"]);
      expect(determineConnectionSignal(source, target)).toBe("metrics");
    });

    it("falls back to source first signal when no overlap", () => {
      const source = createNode("receiver", ["logs"]);
      const target = createNode("processor", ["metrics"]);
      expect(determineConnectionSignal(source, target)).toBe("logs");
    });

    it("falls back to 'metrics' when source has no signals", () => {
      const source = createNode("receiver", []);
      const target = createNode("processor", ["logs"]);
      expect(determineConnectionSignal(source, target)).toBe("metrics");
    });
  });
});
