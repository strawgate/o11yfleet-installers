# Pipeline Management

Pipeline management is the long-term product surface for designing, reviewing, rolling out, and troubleshooting OpenTelemetry Collector configuration. This document captures the foundation we want before a larger fanout effort.

## Current Inputs

The strongest design source found during this audit was the static prototype archive supplied outside the repo. The extracted prototype included:

- `portal/builder.html`: draft-oriented builder with Visual/YAML/Split modes, component palette, inspector, validation strip, AI suggestion, Save draft, and Commit & roll out.
- `portal/agent-detail.html`: read-only pipeline visualizer with per-agent insights, Effective YAML, Logs, Resources, and History tabs.
- `portal/configuration-detail.html`: configuration page with Edit pipeline, versions, rollout history, YAML, rollout strategy, and Git-backed source hints.
- `portal-pipeline.js`: vanilla JS model, renderer, inspector, palette, generated YAML, example pipelines, and canned insights.
- `portal-pipeline.css`: visual system already partially copied into `apps/site/src/styles/portal-pipeline.css`.

The current React app only has a placeholder builder page. This PR adds a shared graph model and experiment harness so future UI work has a stable product and code foundation.

## Product Vocabulary

Use these terms consistently:

- Collector pipeline: the OpenTelemetry `service.pipelines` graph made from receivers, processors, and exporters.
- Pipeline component: one receiver, processor, or exporter instance in the collector config.
- Wire: a signal-specific edge between two components. A single visual connection may represent logs, metrics, traces, or a subset.
- Configuration version: immutable YAML snapshot stored by O11yFleet.
- Draft: an editable graph/YAML state forked from a version.
- Rollout: promotion of a version to desired config for a configuration group.
- Effective YAML: what a collector reports after remote config, bootstrap config, and runtime behavior are applied. Keep this conservative until backend contracts are explicit.

## End-To-End Dream

An operator opens a configuration group and sees the whole path from design to production:

1. The configuration detail page shows current version, target selector, collector count, drift, health, rollout strategy, and last rollout.
2. Edit pipeline opens a draft forked from the current version.
3. The builder starts in visual mode with receivers, processors, exporters, and colored signal wires.
4. The operator can switch between Visual, YAML, and Split views without losing state.
5. The palette offers collector-aware components and starts small: common receivers, processors, exporters, and templates.
6. Selecting a component opens an inspector with identity, typed config fields, YAML snippet, docs link, and observed runtime facts when available.
7. Validation runs continuously at three levels:
   - Graph validity: missing endpoints, invalid role edges, unsupported signals, duplicate section keys.
   - Collector YAML shape: generated YAML is syntactically valid and follows known collector component schema where we have it.
   - Fleet readiness: target collector capabilities, plan gates, risky rollout strategy, recent failures, and current drift.
8. AI guidance is evidence-led: suggestions cite observed memory pressure, exporter failures, dropped data, rejected samples, or configuration drift. Suggestions produce reviewable draft diffs, not direct mutation.
9. Save draft stores graph metadata plus generated YAML, but rollout still promotes immutable YAML versions. The graph is an editing aid, not the source of truth for collectors.
10. Commit creates a new version with author, reason, generated YAML hash, optional Git metadata, and audit event.
11. Rollout can start immediately or use the saved default strategy: canary, 50/100, all-at-once, or manual promotion gates.
12. During rollout, the UI shows selected version, target count, connected count, applied count, drift, unhealthy count, failed applies, pause/resume, and rollback candidate.
13. Agent detail reuses the same graph renderer in read-only mode, highlights the collector's current/effective config, and links runtime insights to graph nodes.
14. Support/admin views can impersonate or inspect the same pipeline context without building a second pipeline-management surface.

## Architecture Direction

Keep the boundary explicit:

- `@o11yfleet/core/pipeline`: graph types, catalog, validation, YAML generation, and reusable examples.
- Worker/API: versions, drafts, validation jobs, rollout state, audit events, and effective-config snapshots.
- Site: visual editing, inspection, diff/review, and rollout workflow.
- Docs: operator concepts, troubleshooting, and examples. Docs must distinguish immediate rollout behavior from planned progressive rollout controls.

The collector YAML remains the remote-config artifact. The graph model must round-trip from graph to YAML and eventually from YAML to graph for known-safe subsets. Unknown YAML should stay editable as raw YAML and be visualized best-effort.

## Small Experiments In This PR

This PR includes two deliberately small experiments:

1. Graph to YAML: `@o11yfleet/core/pipeline` can derive `service.pipelines` from a graph and render collector YAML from component config.
2. Validation: the graph validator catches invalid role edges, unsupported signal edges, duplicate YAML section names, missing endpoints, and missing receiver/exporter coverage.

Run them with:

```bash
just pipeline-experiment
```

## Fanout Workstreams After Merge

Good next fanout groups:

- React builder prototype: convert the zip builder into React components using `@o11yfleet/core/pipeline`.
- Read-only visualizer: add agent detail pipeline view backed by example/effective config data, clearly marked when data is simulated.
- YAML parser experiment: evaluate graph extraction from existing collector YAML and define which YAML patterns are visualizable.
- Validation strategy: research collector component schemas, `otelcol --dry-run` options, and how other fleet tools validate config.
- Rollout UX: design rollout progress, pause/resume, rollback, failure handling, and audit requirements.
- Insight UX: define evidence contracts for AI suggestions and decide which suggestions can become draft patches.

## Non-Goals For The Foundation PR

- Production draft persistence is not implemented yet.
- Backend rollout-state schema changes are out of scope.
- Current collectors are not assumed to report enough effective config detail for full visualization.
- OpenTelemetry Collector schema parsing is incomplete.
- No direct adoption of the zip prototype's DOM/vanilla JS runtime.
