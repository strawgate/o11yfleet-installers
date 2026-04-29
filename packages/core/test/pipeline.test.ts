import { describe, expect, it } from "vitest";
import {
  PIPELINE_EXAMPLES,
  deriveSignalPipelines,
  expandPipelineConfig,
  renderCollectorYaml,
  summarizePipelineGraph,
  validatePipelineGraph,
  type PipelineGraph,
} from "../src/pipeline/index.js";

describe("pipeline model", () => {
  it("derives service pipelines from signal wires", () => {
    const pipelines = deriveSignalPipelines(PIPELINE_EXAMPLES["edge-gateway"]!);

    expect(pipelines.map((pipeline) => pipeline.signal)).toEqual(["logs", "metrics", "traces"]);
    expect(pipelines[0]).toMatchObject({
      receivers: ["otlp"],
      processors: ["memory_limiter", "attributes/env", "batch"],
      exporters: ["otlp/gateway"],
    });
  });

  it("orders processors by wire topology instead of component declaration order", () => {
    const graph: PipelineGraph = {
      id: "out-of-order",
      label: "Out of order",
      components: [
        {
          id: "r1",
          role: "receiver",
          type: "otlp",
          name: "otlp",
          signals: ["traces"],
          config: {},
        },
        {
          id: "p2",
          role: "processor",
          type: "batch",
          name: "batch",
          signals: ["traces"],
          config: {},
        },
        {
          id: "p1",
          role: "processor",
          type: "tail_sampling",
          name: "tail_sampling",
          signals: ["traces"],
          config: {},
        },
        {
          id: "e1",
          role: "exporter",
          type: "otlp",
          name: "otlp",
          signals: ["traces"],
          config: {},
        },
      ],
      wires: [
        { from: "r1", to: "p1", signal: "traces" },
        { from: "p1", to: "p2", signal: "traces" },
        { from: "p2", to: "e1", signal: "traces" },
      ],
    };

    expect(deriveSignalPipelines(graph)).toEqual([
      {
        signal: "traces",
        receivers: ["otlp"],
        processors: ["tail_sampling", "batch"],
        exporters: ["otlp"],
      },
    ]);
  });

  it("validates supported signal edges and role flow", () => {
    const broken: PipelineGraph = {
      ...PIPELINE_EXAMPLES["host-monitor"]!,
      wires: [{ from: "e1", to: "r1", signal: "metrics" }],
    };

    const validation = validatePipelineGraph(broken);

    expect(validation.ok).toBe(false);
    expect(validation.errors.map((error) => error.code)).toContain("invalid_role_edge");
  });

  it("marks branched processor chains as invalid", () => {
    const branched: PipelineGraph = {
      id: "branched",
      label: "Branched",
      components: [
        { id: "r1", role: "receiver", type: "otlp", name: "otlp", signals: ["logs"], config: {} },
        {
          id: "p1",
          role: "processor",
          type: "batch",
          name: "batch",
          signals: ["logs"],
          config: {},
        },
        {
          id: "p2",
          role: "processor",
          type: "filter",
          name: "filter/drop",
          signals: ["logs"],
          config: {},
        },
        {
          id: "p3",
          role: "processor",
          type: "attributes",
          name: "attributes/env",
          signals: ["logs"],
          config: {},
        },
        { id: "e1", role: "exporter", type: "otlp", name: "otlp", signals: ["logs"], config: {} },
      ],
      wires: [
        { from: "r1", to: "p1", signal: "logs" },
        { from: "p1", to: "p2", signal: "logs" },
        { from: "p1", to: "p3", signal: "logs" },
        { from: "p2", to: "e1", signal: "logs" },
        { from: "p3", to: "e1", signal: "logs" },
      ],
    };

    const validation = validatePipelineGraph(branched);

    expect(validation.ok).toBe(false);
    expect(validation.errors.map((error) => error.code)).toContain("pipeline_topology_error");
  });

  it("marks crossed receiver and exporter processor wires as invalid", () => {
    const crossed: PipelineGraph = {
      id: "crossed",
      label: "Crossed",
      components: [
        { id: "r1", role: "receiver", type: "otlp", name: "otlp", signals: ["logs"], config: {} },
        {
          id: "p1",
          role: "processor",
          type: "batch",
          name: "batch",
          signals: ["logs"],
          config: {},
        },
        {
          id: "p2",
          role: "processor",
          type: "filter",
          name: "filter/drop",
          signals: ["logs"],
          config: {},
        },
        { id: "e1", role: "exporter", type: "otlp", name: "otlp", signals: ["logs"], config: {} },
      ],
      wires: [
        { from: "p1", to: "p2", signal: "logs" },
        { from: "r1", to: "p2", signal: "logs" },
        { from: "p1", to: "e1", signal: "logs" },
      ],
    };

    const validation = validatePipelineGraph(crossed);

    expect(validation.ok).toBe(false);
    expect(validation.errors.map((error) => error.code)).toContain("pipeline_topology_error");
  });

  it("expands dotted and indexed config keys before YAML rendering", () => {
    expect(
      expandPipelineConfig({
        "protocols.grpc.endpoint": "0.0.0.0:4317",
        "actions[0].key": "env",
        "actions[0].value": "production",
      }),
    ).toEqual({
      protocols: { grpc: { endpoint: "0.0.0.0:4317" } },
      actions: [{ key: "env", value: "production" }],
    });
  });

  it("rejects conflicting flat and nested config keys", () => {
    expect(() =>
      expandPipelineConfig({
        tls: { insecure: true },
        "tls.insecure": false,
      }),
    ).toThrow(/tls/);

    expect(() =>
      expandPipelineConfig({
        "actions[0].key": "env",
        actions: [{ value: "production" }],
      }),
    ).toThrow(/actions/);
  });

  it("renders collector YAML from the graph model", () => {
    const yaml = renderCollectorYaml(PIPELINE_EXAMPLES["edge-gateway"]!);

    expect(yaml).toContain("receivers:");
    expect(yaml).toContain("protocols:");
    expect(yaml).toContain("actions:");
    expect(yaml).toContain("service:");
    expect(yaml).toContain("traces:");
    expect(yaml).toContain("processors: [memory_limiter, attributes/env, batch]");
  });

  it("renders an empty pipelines map for an unwired draft graph", () => {
    const yaml = renderCollectorYaml({
      id: "empty",
      label: "Empty",
      components: [],
      wires: [],
    });

    expect(yaml).toContain("service:\n  pipelines: {}");
  });

  it("summarizes graphs for experiments and future UI status copy", () => {
    expect(summarizePipelineGraph(PIPELINE_EXAMPLES["host-monitor"]!)).toBe(
      "Host monitor: 3 components, 2 wires, 1 service pipelines (metrics)",
    );
  });
});
