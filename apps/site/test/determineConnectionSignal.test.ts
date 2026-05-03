import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { determineConnectionSignal } from "@o11yfleet/core/pipeline";
import type { PipelineNode } from "@o11yfleet/core/pipeline";

describe("determineConnectionSignal in UI context", () => {
  const nodeWithMetrics = {
    id: "r1",
    type: "receiver",
    position: { x: 0, y: 0 },
    data: { component: { signals: ["metrics"] } },
  } as unknown as PipelineNode;

  const nodeWithLogs = {
    id: "r2",
    type: "receiver",
    position: { x: 0, y: 0 },
    data: { component: { signals: ["logs"] } },
  } as unknown as PipelineNode;

  const nodeWithBoth = {
    id: "p1",
    type: "processor",
    position: { x: 0, y: 0 },
    data: { component: { signals: ["metrics", "logs"] } },
  } as unknown as PipelineNode;

  test("auto-determines overlapping signal when available", () => {
    // Both -> Metrics (overlap is metrics)
    assert.equal(determineConnectionSignal(nodeWithBoth, nodeWithMetrics), "metrics");

    // Both -> Logs (overlap is logs)
    assert.equal(determineConnectionSignal(nodeWithBoth, nodeWithLogs), "logs");

    // Metrics -> Both (overlap is metrics)
    assert.equal(determineConnectionSignal(nodeWithMetrics, nodeWithBoth), "metrics");

    // Logs -> Both (overlap is logs)
    assert.equal(determineConnectionSignal(nodeWithLogs, nodeWithBoth), "logs");
  });

  test("falls back to source's first signal if no overlap", () => {
    // This connection shouldn't be valid, but if requested, it should safely fallback
    assert.equal(determineConnectionSignal(nodeWithMetrics, nodeWithLogs), "metrics");
    assert.equal(determineConnectionSignal(nodeWithLogs, nodeWithMetrics), "logs");
  });
});
