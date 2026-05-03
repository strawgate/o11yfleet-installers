import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { isValidPipelineConnection } from "@o11yfleet/core/pipeline";
import { mapToCoreNode } from "../src/components/pipeline-builder/schema/to-graph";
import type { BuilderNode } from "../src/components/pipeline-builder/types";

describe("pipeline connection validation (ui structure)", () => {
  const rMetrics: BuilderNode = {
    id: "r1",
    type: "receiver",
    position: { x: 0, y: 0 },
    data: { name: "otlp", signals: ["metrics"] },
  };
  const rLogs: BuilderNode = {
    id: "r2",
    type: "receiver",
    position: { x: 0, y: 0 },
    data: { name: "filelog", signals: ["logs"] },
  };
  const pMetrics: BuilderNode = {
    id: "p1",
    type: "processor",
    position: { x: 0, y: 0 },
    data: { name: "batch", signals: ["metrics"] },
  };
  const xMetrics: BuilderNode = {
    id: "x1",
    type: "exporter",
    position: { x: 0, y: 0 },
    data: { name: "debug", signals: ["metrics"] },
  };

  test("validates connections correctly via core rules", () => {
    // Receiver -> Processor (Valid)
    assert.equal(isValidPipelineConnection(mapToCoreNode(rMetrics), mapToCoreNode(pMetrics)), true);

    // Receiver -> Exporter (Valid)
    assert.equal(isValidPipelineConnection(mapToCoreNode(rMetrics), mapToCoreNode(xMetrics)), true);

    // Exporter -> Processor (Invalid - exporter is sink)
    assert.equal(
      isValidPipelineConnection(mapToCoreNode(xMetrics), mapToCoreNode(pMetrics)),
      false,
    );

    // Receiver -> Receiver (Invalid - receiver is source)
    assert.equal(isValidPipelineConnection(mapToCoreNode(rMetrics), mapToCoreNode(rLogs)), false);

    // Receiver (logs) -> Processor (metrics) (Invalid - no signal overlap)
    assert.equal(isValidPipelineConnection(mapToCoreNode(rLogs), mapToCoreNode(pMetrics)), false);

    // Same node (Invalid) - the isValidPipelineConnection doesn't strictly check id eq because it assumes different nodes, but we test typical cases
    assert.equal(
      isValidPipelineConnection(mapToCoreNode(rMetrics), mapToCoreNode(rMetrics)),
      false,
    );
  });
});
