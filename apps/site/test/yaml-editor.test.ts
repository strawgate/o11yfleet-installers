import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseDocument } from "yaml";

describe("YAML Editor Component Logic", () => {
  it("should detect syntax errors on invalid YAML input", () => {
    // Simulate what the linter hook does in BuilderPage.tsx
    const invalidYaml = `receivers:
  otlp:
    protocols:
      grpc: {}
exporters:
  debug: {}
service:
  pipelines:
    logs:
      receivers: [otlp
      exporters: [debug]`;

    const doc = parseDocument(invalidYaml);
    assert.equal(doc.errors.length > 0, true);
    assert.ok(doc.errors[0]?.message.includes("must be sufficiently indented and end with a ]"));
  });

  it("should format YAML while preserving comments", () => {
    // Simulate what the Format YAML button does in BuilderPage.tsx
    const unformattedYaml = `receivers:
  otlp:
    protocols:
      grpc: {}
exporters:
  debug: {}
# A service pipeline definition
service:
  pipelines:
    logs:
      receivers:   [otlp]
      exporters: [ debug]`;

    const doc = parseDocument(unformattedYaml);
    assert.equal(doc.errors.length, 0);

    const formatted = doc.toString();
    const expected = `receivers:
  otlp:
    protocols:
      grpc: {}
exporters:
  debug: {}
# A service pipeline definition
service:
  pipelines:
    logs:
      receivers: [ otlp ]
      exporters: [ debug ]
`;
    assert.equal(formatted, expected);
  });
});
