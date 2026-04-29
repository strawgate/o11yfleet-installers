import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  PIPELINE_EXAMPLES,
  deriveSignalPipelines,
  expandPipelineConfig,
  parseCollectorYamlToGraph,
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

  it("marks wires with missing endpoints as invalid", () => {
    const missingEndpoint: PipelineGraph = {
      id: "missing-endpoint",
      label: "Missing endpoint",
      components: [
        { id: "r1", role: "receiver", type: "otlp", name: "otlp", signals: ["logs"], config: {} },
      ],
      wires: [{ from: "r1", to: "missing", signal: "logs" }],
    };

    const validation = validatePipelineGraph(missingEndpoint);

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContainEqual(
      expect.objectContaining({
        code: "wire_missing_endpoint",
        message: "Wire r1 -> missing references a missing component.",
      }),
    );
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

  it("imports basic collector YAML into a complete graph", () => {
    const yaml = readFileSync(new URL("../../../configs/basic-otlp.yaml", import.meta.url), "utf8");

    const result = parseCollectorYamlToGraph(yaml, {
      id: "basic-otlp",
      label: "Basic OTLP",
    });

    expect(result.confidence).toBe("complete");
    expect(result.warnings).toEqual([]);
    expect(result.rawSections).toEqual({});
    expect(result.graph.components.map((component) => component.name)).toEqual([
      "otlp",
      "batch",
      "debug",
    ]);
    expect(deriveSignalPipelines(result.graph)).toEqual([
      {
        signal: "logs",
        receivers: ["otlp"],
        processors: ["batch"],
        exporters: ["debug"],
      },
      {
        signal: "metrics",
        receivers: ["otlp"],
        processors: ["batch"],
        exporters: ["debug"],
      },
      {
        signal: "traces",
        receivers: ["otlp"],
        processors: ["batch"],
        exporters: ["debug"],
      },
    ]);
    expect(validatePipelineGraph(result.graph).ok).toBe(true);
  });

  it("imports richer collector YAML as partial when non-graph sections are preserved", () => {
    const yaml = readFileSync(
      new URL("../../../configs/full-pipeline.yaml", import.meta.url),
      "utf8",
    );

    const result = parseCollectorYamlToGraph(yaml);

    expect(result.confidence).toBe("partial");
    expect(result.rawSections).toHaveProperty("service.telemetry");
    expect(result.graph.components).toHaveLength(10);
    expect(result.graph.components.map((component) => component.name)).toEqual([
      "otlp",
      "prometheus",
      "hostmetrics",
      "batch",
      "memory_limiter",
      "filter",
      "tail_sampling",
      "otlp",
      "otlphttp",
      "prometheus",
    ]);
    expect(deriveSignalPipelines(result.graph)).toContainEqual({
      signal: "traces",
      receivers: ["otlp"],
      processors: ["memory_limiter", "filter", "tail_sampling", "batch"],
      exporters: ["otlp", "otlphttp"],
    });
    expect(validatePipelineGraph(result.graph).ok).toBe(true);
  });

  it("keeps unvisualizable collector YAML as raw-only", () => {
    const result = parseCollectorYamlToGraph(`
extensions:
  health_check: {}
service:
  extensions: [health_check]
`);

    expect(result.confidence).toBe("raw-only");
    expect(result.graph.components).toEqual([]);
    expect(result.graph.wires).toEqual([]);
    expect(result.rawSections).toEqual({
      extensions: { health_check: {} },
      service: { extensions: ["health_check"] },
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "collector_pipelines_missing",
          path: "service.pipelines",
        }),
        expect.objectContaining({
          code: "collector_extensions_not_visualized",
          message:
            "extensions are valid Collector sections but are not represented in the current visual graph model.",
          path: "extensions",
        }),
        expect.objectContaining({
          code: "collector_service_extensions_not_visualized",
          message:
            "service.extensions is preserved as raw YAML and is not represented in the visual graph model.",
          path: "service.extensions",
        }),
      ]),
    );
  });

  it("keeps malformed collector YAML as raw-only instead of throwing", () => {
    const result = parseCollectorYamlToGraph(`
receivers:
  otlp: [
`);

    expect(result.confidence).toBe("raw-only");
    expect(result.graph.components).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toContain("collector_yaml_parse_error");
  });

  it("keeps generated component ids unique when collector names slug the same way", () => {
    const result = parseCollectorYamlToGraph(`
receivers:
  otlp/http: {}
  otlp-http: {}
exporters:
  debug: {}
service:
  pipelines:
    logs:
      receivers: [otlp/http, otlp-http]
      exporters: [debug]
`);

    expect(result.graph.components.map((component) => component.id)).toEqual([
      "r-otlp-http",
      "r-otlp-http-2",
      "e-debug",
    ]);
    expect(validatePipelineGraph(result.graph).ok).toBe(true);
  });

  it("summarizes graphs for experiments and future UI status copy", () => {
    expect(summarizePipelineGraph(PIPELINE_EXAMPLES["host-monitor"]!)).toBe(
      "Host monitor: 3 components, 2 wires, 1 service pipelines (metrics)",
    );
  });
});
