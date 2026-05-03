// Pure-function validator tests. No I/O, no Workers runtime needed.

import { describe, expect, it } from "vitest";
import { validateCollectorConfig } from "../src/github/validate-config.js";

const PATH = "o11yfleet/config.yaml";

function failures(annotations: Array<{ level: string; message: string }>): string[] {
  return annotations.filter((a) => a.level === "failure").map((a) => a.message);
}

function warnings(annotations: Array<{ level: string; message: string }>): string[] {
  return annotations.filter((a) => a.level === "warning").map((a) => a.message);
}

describe("validateCollectorConfig — parse + top-level shape", () => {
  it("succeeds on a parseable mapping", () => {
    const result = validateCollectorConfig({
      path: PATH,
      yaml: "receivers:\n  otlp:\n    protocols:\n      grpc:\n",
    });
    expect(result.conclusion).toBe("success");
    expect(result.annotations).toEqual([]);
  });

  it("fails with a parse-error annotation pointing at the bad line", () => {
    const result = validateCollectorConfig({
      path: PATH,
      yaml: "receivers:\n  otlp: [unterminated\n",
    });
    expect(result.conclusion).toBe("failure");
    expect(result.summary).toContain("YAML parse failed");
    expect(result.annotations).toHaveLength(1);
    const a = result.annotations[0]!;
    expect(a.path).toBe(PATH);
    expect(a.level).toBe("failure");
    expect(a.start_line).toBeGreaterThan(0);
    expect(a.message).toContain("YAML parse error");
  });

  it("fails on an empty file (parses to null)", () => {
    const result = validateCollectorConfig({ path: PATH, yaml: "" });
    expect(result.conclusion).toBe("failure");
    expect(result.summary).toContain("Empty");
    expect(result.annotations[0]?.message).toMatch(/empty/i);
  });

  it("fails on a top-level array", () => {
    const result = validateCollectorConfig({ path: PATH, yaml: "- a\n- b\n" });
    expect(result.conclusion).toBe("failure");
    expect(result.summary).toContain("mapping");
    expect(result.annotations[0]?.message).toMatch(/mapping/i);
  });

  it("fails on a top-level scalar", () => {
    const result = validateCollectorConfig({ path: PATH, yaml: "just-a-string\n" });
    expect(result.conclusion).toBe("failure");
    expect(result.summary).toContain("mapping");
  });

  it("includes the file path in every annotation so the Check Run renders inline", () => {
    const result = validateCollectorConfig({ path: "custom/path/to/config.yaml", yaml: "[[bad" });
    expect(result.annotations.every((a) => a.path === "custom/path/to/config.yaml")).toBe(true);
  });
});

describe("validateCollectorConfig — structural shape", () => {
  it("warns (not fails) on unknown top-level keys", () => {
    // Custom builders can introduce sections we don't know about — but
    // typos like 'recievers' should still get surfaced loudly, just not
    // as a hard failure.
    const result = validateCollectorConfig({
      path: PATH,
      yaml: "recievers:\n  otlp:\n",
    });
    expect(result.conclusion).toBe("neutral");
    expect(warnings(result.annotations)).toEqual([
      expect.stringContaining("Unknown top-level key 'recievers'"),
    ]);
    expect(failures(result.annotations)).toEqual([]);
  });

  it("fails when a component section is not a mapping", () => {
    const result = validateCollectorConfig({
      path: PATH,
      yaml: "receivers:\n  - otlp\n",
    });
    expect(result.conclusion).toBe("failure");
    expect(failures(result.annotations)).toEqual([
      expect.stringMatching(/'receivers' must be a mapping.*got array/),
    ]);
  });

  it("fails when service is not a mapping", () => {
    const result = validateCollectorConfig({
      path: PATH,
      yaml: "service: not-a-mapping\n",
    });
    expect(result.conclusion).toBe("failure");
    expect(failures(result.annotations)).toEqual([
      expect.stringMatching(/'service' must be a mapping.*got string/),
    ]);
  });

  it("tolerates absent or null component sections", () => {
    // Many configs declare only a subset (e.g. no extensions). Null is the
    // YAML representation of an explicitly-empty section like `extensions:`.
    const result = validateCollectorConfig({
      path: PATH,
      yaml: "receivers:\n  otlp:\nextensions:\n",
    });
    expect(result.conclusion).toBe("success");
  });
});

describe("validateCollectorConfig — pipeline reference resolution", () => {
  const validConfig = `
receivers:
  otlp:
processors:
  batch:
exporters:
  otlp/jaeger:
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/jaeger]
`;

  it("succeeds when every reference resolves", () => {
    const result = validateCollectorConfig({ path: PATH, yaml: validConfig });
    expect(result.conclusion).toBe("success");
    expect(result.summary).toContain("Structure valid");
    expect(result.annotations).toEqual([]);
  });

  it("fails when a pipeline references an undeclared receiver", () => {
    const result = validateCollectorConfig({
      path: PATH,
      yaml: validConfig.replace("receivers: [otlp]", "receivers: [otlp, kafka]"),
    });
    expect(failures(result.annotations)).toEqual([
      expect.stringContaining("pipelines.traces.receivers references 'kafka'"),
    ]);
  });

  it("fails when a pipeline references an undeclared processor", () => {
    const result = validateCollectorConfig({
      path: PATH,
      yaml: validConfig.replace("processors: [batch]", "processors: [batch, attributes]"),
    });
    expect(failures(result.annotations)).toEqual([
      expect.stringContaining("pipelines.traces.processors references 'attributes'"),
    ]);
  });

  it("fails when a pipeline references an undeclared exporter", () => {
    const result = validateCollectorConfig({
      path: PATH,
      yaml: validConfig.replace("exporters: [otlp/jaeger]", "exporters: [otlp/jaeger, debug]"),
    });
    expect(failures(result.annotations)).toEqual([
      expect.stringContaining("pipelines.traces.exporters references 'debug'"),
    ]);
  });

  it("accepts a connector as both receiver and exporter", () => {
    // Per the OpenTelemetry spec, connectors connect two pipelines: they
    // appear as an exporter in the upstream pipeline and as a receiver in
    // the downstream one. We must not reject either reference just because
    // the connector wasn't declared in receivers/exporters.
    const result = validateCollectorConfig({
      path: PATH,
      yaml: `
receivers:
  otlp:
processors:
  batch:
exporters:
  otlp/jaeger:
connectors:
  forward:
service:
  pipelines:
    traces/in:
      receivers: [otlp]
      processors: [batch]
      exporters: [forward]
    traces/out:
      receivers: [forward]
      exporters: [otlp/jaeger]
`,
    });
    expect(result.conclusion).toBe("success");
    expect(result.annotations).toEqual([]);
  });

  it("fails when service.extensions references an undeclared extension", () => {
    const result = validateCollectorConfig({
      path: PATH,
      yaml: `
extensions:
  health_check:
service:
  extensions: [health_check, pprof]
  pipelines: {}
`,
    });
    expect(failures(result.annotations)).toEqual([
      expect.stringContaining("service.extensions references 'pprof'"),
    ]);
  });

  it("fails when a pipeline value is not a mapping", () => {
    const result = validateCollectorConfig({
      path: PATH,
      yaml: `
service:
  pipelines:
    traces: not-a-mapping
`,
    });
    expect(failures(result.annotations)).toEqual([
      expect.stringMatching(/pipelines\.traces must be a mapping/),
    ]);
  });

  it("fails when a pipeline role is not a list", () => {
    const result = validateCollectorConfig({
      path: PATH,
      yaml: `
receivers:
  otlp:
service:
  pipelines:
    traces:
      receivers: otlp
`,
    });
    expect(failures(result.annotations)).toEqual([
      expect.stringMatching(/pipelines\.traces\.receivers must be a list/),
    ]);
  });

  it("fails when a pipeline ref entry is not a string", () => {
    const result = validateCollectorConfig({
      path: PATH,
      yaml: `
receivers:
  otlp:
service:
  pipelines:
    traces:
      receivers:
        - otlp
        - {nested: thing}
`,
    });
    expect(failures(result.annotations)).toEqual([
      expect.stringContaining("pipelines.traces.receivers contains non-string entry"),
    ]);
  });

  it("reports every undeclared reference, not just the first", () => {
    const result = validateCollectorConfig({
      path: PATH,
      yaml: `
service:
  pipelines:
    traces:
      receivers: [a]
      processors: [b]
      exporters: [c]
    metrics:
      receivers: [d]
      exporters: [e]
`,
    });
    const failureMessages = failures(result.annotations);
    expect(failureMessages.length).toBe(5);
    for (const ref of ["'a'", "'b'", "'c'", "'d'", "'e'"]) {
      expect(failureMessages.some((m) => m.includes(ref))).toBe(true);
    }
  });

  it("tolerates a config without a service section", () => {
    // Edge case: a partial config that only declares components is valid
    // YAML and shouldn't be flagged. The collector will fail at startup
    // but that's not our problem to surface here.
    const result = validateCollectorConfig({
      path: PATH,
      yaml: "receivers:\n  otlp:\n",
    });
    expect(result.conclusion).toBe("success");
  });
});
