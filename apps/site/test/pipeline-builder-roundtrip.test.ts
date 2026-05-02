import assert from "node:assert/strict";
import { test } from "node:test";
import type { PipelineGraph } from "../../../packages/core/src/pipeline/types";
import { toFlow } from "../src/components/pipeline-builder/schema/to-flow";
import { toGraph } from "../src/components/pipeline-builder/schema/to-graph";
import { ROLE_MATRIX } from "../src/components/pipeline-builder/hooks/useValidConnection";
import { layoutLR } from "../src/components/pipeline-builder/layout/dagre-layout";

const FIXTURE: PipelineGraph = {
  id: "g1",
  label: "Test",
  components: [
    { id: "r", role: "receiver", type: "otlp", name: "otlp", signals: ["metrics"], config: {} },
    { id: "p", role: "processor", type: "batch", name: "batch", signals: ["metrics"], config: {} },
    { id: "x", role: "exporter", type: "otlp", name: "otlp/be", signals: ["metrics"], config: {} },
  ],
  wires: [
    { from: "r", to: "p", signal: "metrics" },
    { from: "p", to: "x", signal: "metrics" },
  ],
};

test("toFlow: produces one node per component, one edge per wire", () => {
  const { nodes, edges } = toFlow(FIXTURE);
  assert.equal(nodes.length, 3);
  assert.equal(edges.length, 2);
  assert.equal(nodes[0]?.type, "receiver");
  assert.equal(edges[0]?.type, "signal");
});

test("toFlow→toGraph: round-trip preserves component & wire identity", () => {
  const flow = toFlow(FIXTURE);
  const baseline = new Map(FIXTURE.components.map((c) => [c.id, c]));
  const out = toGraph(
    flow,
    { id: FIXTURE.id, label: FIXTURE.label, description: FIXTURE.description },
    baseline,
  );
  assert.equal(out.id, FIXTURE.id);
  assert.equal(out.components.length, 3);
  assert.equal(out.wires.length, 2);
  // Components map back to the same IDs in the same order
  for (let i = 0; i < out.components.length; i++) {
    assert.equal(out.components[i]?.id, FIXTURE.components[i]?.id);
    assert.equal(out.components[i]?.type, FIXTURE.components[i]?.type);
  }
  // Wires preserve from/to/signal
  for (let i = 0; i < out.wires.length; i++) {
    assert.equal(out.wires[i]?.from, FIXTURE.wires[i]?.from);
    assert.equal(out.wires[i]?.to, FIXTURE.wires[i]?.to);
    assert.equal(out.wires[i]?.signal, FIXTURE.wires[i]?.signal);
  }
});

test("toGraph: persists positions into config._layout", () => {
  const flow = toFlow(FIXTURE);
  // Move first node
  flow.nodes[0]!.position = { x: 123, y: 456 };
  const out = toGraph(
    flow,
    { id: FIXTURE.id, label: FIXTURE.label },
    new Map(FIXTURE.components.map((c) => [c.id, c])),
  );
  const layout = out.components[0]?.config["_layout"] as { x: number; y: number };
  assert.deepEqual(layout, { x: 123, y: 456 });
});

test("ROLE_MATRIX: receivers can target processor, exporter, connector", () => {
  assert.deepEqual(new Set(ROLE_MATRIX.receiver), new Set(["processor", "exporter", "connector"]));
});

test("ROLE_MATRIX: exporters are sinks (empty out-edges)", () => {
  assert.deepEqual(ROLE_MATRIX.exporter, []);
});

test("ROLE_MATRIX: connectors can fan to processor, exporter, connector", () => {
  assert.deepEqual(new Set(ROLE_MATRIX.connector), new Set(["processor", "exporter", "connector"]));
});

test("layoutLR: produces left-to-right positions for a linear pipeline", () => {
  const flow = toFlow(FIXTURE);
  const laid = layoutLR(flow.nodes, flow.edges);
  // For a linear receiver→processor→exporter, source.x must precede target.x.
  const byId = new Map(laid.map((n) => [n.id, n.position]));
  const r = byId.get("r")!;
  const p = byId.get("p")!;
  const x = byId.get("x")!;
  assert.ok(r.x < p.x, `receiver x=${r.x} must be < processor x=${p.x}`);
  assert.ok(p.x < x.x, `processor x=${p.x} must be < exporter x=${x.x}`);
});

test("layoutLR: idempotent — running twice produces the same positions", () => {
  const flow = toFlow(FIXTURE);
  const a = layoutLR(flow.nodes, flow.edges);
  const b = layoutLR(a, flow.edges);
  for (let i = 0; i < a.length; i++) {
    assert.deepEqual(a[i]?.position, b[i]?.position);
  }
});
