# Pipeline Management

Pipeline management is the product surface for designing, reviewing, rolling out,
and troubleshooting OpenTelemetry Collector configuration. The current React app
has a builder shell and shared graph/YAML helpers; production draft persistence
and progressive rollout state are not implemented yet.

## Vocabulary

| Term               | Meaning                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Collector pipeline | OpenTelemetry `service.pipelines` graph made from receivers, processors, exporters, and eventually connectors.               |
| Pipeline component | One receiver, processor, exporter, or future connector instance.                                                             |
| Wire               | Signal-specific edge between components. A visual edge may carry logs, metrics, traces, or a subset.                         |
| Draft              | Editable graph/YAML state forked from a version. Planned; not persisted today.                                               |
| Version            | Immutable YAML snapshot stored by O11yFleet.                                                                                 |
| Rollout            | Promotion of a version to desired config for a configuration group.                                                          |
| Effective YAML     | Planned diagnostic view of what a collector reports after runtime behavior. Keep conservative until backend contracts exist. |

## Current Foundation

`@o11yfleet/core/pipeline` provides:

- graph types for components and wires
- graph-to-Collector-YAML rendering
- YAML-to-graph import for known Collector sections
- validation for impossible graph states
- reusable example graphs

Run the experiment harness with:

```bash
just pipeline-experiment
```

The importer reads `receivers`, `processors`, `exporters`, and
`service.pipelines`, then derives graph components and signal-specific wires. It
preserves unknown top-level sections as raw sidecars and reports confidence as
`complete`, `partial`, or `raw-only`.

Current validation catches:

- invalid role edges
- unsupported signal edges
- duplicate YAML section names
- missing endpoints
- missing receiver/exporter coverage for active signals

This is useful for immediate UI feedback, but it does not replace collector-aware
schema validation.

## Target Workflow

1. A user opens a configuration group and sees current version, collector count,
   drift, health, and last rollout.
2. Edit pipeline opens a draft forked from the current version.
3. Visual, YAML, and split views stay in sync for the supported subset.
4. The palette starts small: common receivers, processors, exporters, and templates.
5. Selecting a component opens identity, typed fields, YAML snippet, docs link,
   and observed runtime facts when available.
6. Validation runs at graph, Collector YAML, and fleet-readiness levels.
7. AI suggestions cite evidence and produce reviewable draft diffs, not direct
   mutations.
8. Commit creates an immutable version with author, reason, generated YAML hash,
   optional Git metadata, and audit event.
9. Rollout exposes target count, connected count, applied count, drift, unhealthy
   count, failures, pause/resume, and rollback candidate.
10. Agent detail reuses the same graph renderer in read-only mode for current or
    effective config.

## Architecture Boundary

- Core: graph model, catalog, YAML import/render, validation, examples.
- Worker/API: versions, future drafts, validation jobs, rollout state, audit events,
  effective-config snapshots.
- Site: visual editing, inspection, diff/review, and rollout workflow.
- Docs: operator concepts, troubleshooting, and examples.

Collector YAML remains the rollout artifact. The graph is an editing and
diagnostic projection; unknown YAML must remain editable as raw YAML.

## Next Workstreams

- Convert the historical builder prototype into React components backed by
  `@o11yfleet/core/pipeline`.
- Add read-only graph views to configuration and agent detail pages.
- Wire uploaded and agent-reported YAML through the importer with visible
  confidence/warnings.
- Research collector component schemas and `otelcol --dry-run` validation.
- Design rollout progress, pause/resume, rollback, failure handling, and audit
  requirements.
- Define which AI suggestions can become draft patches.
