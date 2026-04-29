# Pipeline Management Experiments

These notes record small experiments that informed the foundation. They are intentionally modest so the next fanout can branch from evidence instead of from a blank page.

## Experiment 1: Graph Model To YAML

Question: can the builder own a graph model and still produce reviewable OpenTelemetry Collector YAML?

Result: yes for the visual-builder subset. `renderCollectorYaml()` derives `service.pipelines` from signal-specific wires and expands dotted/indexed field paths like `protocols.grpc.endpoint` and `actions[0].key` into nested YAML shape.

Evidence:

```bash
just pipeline-experiment
```

Useful outcome: visual editing can operate on receivers, processors, exporters, and wires without abandoning YAML as the immutable rollout artifact.

Risk: generated YAML is not yet validated against real collector component schemas. A later validation phase should run collector-aware checks before upload or rollout.

## Experiment 2: Graph Validation

Question: can cheap graph validation catch impossible builder states before we need collector-level validation?

Result: yes. The validator catches missing endpoints, invalid role flow such as exporter to receiver, unsupported signal wiring, duplicate component names in YAML sections, and missing receiver/exporter coverage for an active signal.

Useful outcome: the UI can provide immediate feedback while users drag components and wires.

Risk: graph validation is necessary but not sufficient. It cannot prove that a component-specific field is valid for a collector distribution or version.

## Experiment 3: YAML To Graph

Question: how much existing collector YAML can be visualized losslessly?

Result: basic Collector configs can now seed the graph model. `parseCollectorYamlToGraph()` reads `receivers`, `processors`, `exporters`, and `service.pipelines`, then derives graph components, signal-specific wires, import confidence, warnings, and preserved raw sidecar sections.

Implemented approach:

- Parse known collector shape into sections: `receivers`, `processors`, `exporters`, `service.pipelines`.
- Create one component per section key.
- Create signal-specific wires by pipeline order.
- Preserve unknown top-level sections as raw YAML sidecars.
- Mark generated graph as complete, partial, or raw-only.

Useful outcome: uploaded configs and agent-reported effective configs can use the same importer before we build separate UI flows.

Risk: multiple pipelines for the same signal, connectors, extensions, and distribution-specific component schema still need deeper collector-aware handling.
