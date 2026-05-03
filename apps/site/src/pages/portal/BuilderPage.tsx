import { useEffect, useMemo, useState } from "react";
import { CopyButton } from "../../components/common/CopyButton";
import { PrototypeBanner } from "../../components/common/PrototypeBanner";
import { usePortalGuidance } from "../../api/hooks/ai";
import { GuidancePanel } from "../../components/ai";
import { buildInsightRequest, insightSurfaces, insightTarget } from "../../ai/insight-registry";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";
import {
  PIPELINE_EXAMPLES,
  parseCollectorYamlToGraph,
  renderCollectorYaml,
  summarizePipelineGraph,
  validatePipelineGraph,
} from "@o11yfleet/core/pipeline";
import type {
  CollectorYamlImportResult,
  PipelineComponentRole,
  PipelineGraph,
} from "@o11yfleet/core/pipeline";
import {
  Canvas,
  ValidationStrip,
  layoutLR,
  toFlow,
  type BuilderEdge,
  type BuilderNode,
} from "@/components/pipeline-builder";
import "../../styles/portal-pipeline.css";

type BuilderMode = "visual" | "split" | "yaml";

const MODE_LABELS: Record<BuilderMode, string> = {
  visual: "Visual",
  split: "Split",
  yaml: "YAML",
};

const ROLES: PipelineComponentRole[] = ["receiver", "processor", "exporter"];
const DEFAULT_EXAMPLE_ID = "edge-gateway";
const EMPTY_PIPELINE_GRAPH: PipelineGraph = {
  id: "empty",
  label: "No example configured",
  description: "No pipeline examples are available.",
  components: [],
  wires: [],
};
const IMPORTED_GRAPH_LABEL = "Imported Collector YAML";

function roleLabel(role: PipelineComponentRole): string {
  if (role === "receiver") return "Receivers";
  if (role === "processor") return "Processors";
  return "Exporters";
}

export default function BuilderPage() {
  const [mode, setMode] = useState<BuilderMode>("split");
  const [exampleId, setExampleId] = useState(DEFAULT_EXAMPLE_ID);
  const [yamlInput, setYamlInput] = useState("");
  const [importResult, setImportResult] = useState<CollectorYamlImportResult | null>(null);
  const [yamlPreviewError, setYamlPreviewError] = useState<string | null>(null);

  const insightSurface = insightSurfaces.portalBuilder;
  const exampleEntries = Object.entries(PIPELINE_EXAMPLES);
  const selectedExampleId = PIPELINE_EXAMPLES[exampleId]
    ? exampleId
    : (exampleEntries[0]?.[0] ?? EMPTY_PIPELINE_GRAPH.id);
  const exampleGraph = PIPELINE_EXAMPLES[selectedExampleId] ?? EMPTY_PIPELINE_GRAPH;
  const graph = importResult?.graph ?? exampleGraph;
  const rawSectionEntries = useMemo(
    () => (importResult ? Object.entries(importResult.rawSections) : []),
    [importResult],
  );
  const validationResult = useMemo(() => validatePipelineGraph(graph), [graph]);
  const validation = useMemo(
    () => ({
      ok: validationResult.ok,
      canSave: validationResult.ok,
      errors: validationResult.errors,
      warnings: validationResult.warnings,
    }),
    [validationResult],
  );
  const [yamlPreview, setYamlPreview] = useState<string>("");
  useEffect(() => {
    setYamlPreviewError(null);
    try {
      setYamlPreview(renderCollectorYaml(graph));
    } catch (err) {
      setYamlPreviewError(err instanceof Error ? err.message : String(err));
      setYamlPreview("");
    }
  }, [graph]);
  const componentsByRole = useMemo(() => {
    const byRole: Record<PipelineComponentRole, PipelineGraph["components"]> = {
      receiver: [],
      processor: [],
      exporter: [],
    };
    for (const component of graph.components) {
      byRole[component.role].push(component);
    }
    return byRole;
  }, [graph]);

  // Project the canonical PipelineGraph into xyflow nodes/edges, then run
  // dagre LR auto-layout so the graph renders as a left-to-right flow on
  // first paint. Read-only for now — the canvas's onChange is a no-op
  // because draft persistence (#236) hasn't landed yet.
  const flow = useMemo(() => {
    const next = toFlow(graph);
    return { nodes: layoutLR(next.nodes, next.edges), edges: next.edges };
  }, [graph]);
  const [canvasState, setCanvasState] = useState<{
    nodes: BuilderNode[];
    edges: BuilderEdge[];
  }>(flow);
  // When the underlying graph changes (example switch, YAML import), reset
  // the canvas to the freshly laid out nodes.
  useEffect(() => {
    setCanvasState(flow);
  }, [flow]);

  const guidanceRequest: AiGuidanceRequest = buildInsightRequest(
    insightSurface,
    [
      insightTarget(insightSurface, insightSurface.targets.page),
      insightTarget(insightSurface, insightSurface.targets.editor),
    ],
    {
      status: "prototype",
      draft_source: "in-memory example model",
      selected_mode: mode,
      selected_example: importResult ? IMPORTED_GRAPH_LABEL : graph.label,
      import_confidence: importResult?.confidence,
      import_warning_count: importResult?.warnings.length ?? 0,
      pipeline_summary: summarizePipelineGraph(graph),
      validation_ok: validation.ok,
      warnings: validation.warnings.map((item) => item.message),
      errors: validation.errors.map((item) => item.message),
    },
  );
  const guidance = usePortalGuidance(guidanceRequest);

  function handleImportYaml() {
    let result: CollectorYamlImportResult;
    try {
      result = parseCollectorYamlToGraph(yamlInput, {
        id: "builder-import",
        label: IMPORTED_GRAPH_LABEL,
      });
    } catch (error) {
      result = {
        graph: {
          id: "builder-import",
          label: IMPORTED_GRAPH_LABEL,
          components: [],
          wires: [],
        },
        confidence: "raw-only",
        warnings: [
          {
            code: "collector_yaml_import_error",
            message: `Collector YAML import failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        rawSections: {},
      };
    }
    setImportResult(result);
    setMode("split");
  }

  function handleExampleChange(nextExampleId: string) {
    setExampleId(nextExampleId);
    if (importResult) {
      setYamlInput("");
    }
    setImportResult(null);
  }

  function handleBackToExample() {
    setImportResult(null);
    setYamlInput("");
  }

  return (
    <div className="main-wide pipeline-builder-page">
      <PrototypeBanner message="Edits are in-memory only and YAML output is generated from the selected graph." />

      <div className="page-head mt-6">
        <div>
          <h1>Pipeline builder</h1>
          <p className="meta mt-2">
            Review Collector graph shape, generated YAML, and graph validation before draft saving
            is available.
          </p>
        </div>
      </div>

      <div className="pipe-controls mt-6">
        <div className="pipe-segmented" role="group" aria-label="Builder view">
          {(Object.keys(MODE_LABELS) as BuilderMode[]).map((nextMode) => (
            <button
              key={nextMode}
              type="button"
              aria-pressed={mode === nextMode}
              className="btn btn-ghost"
              onClick={() => setMode(nextMode)}
            >
              {MODE_LABELS[nextMode]}
            </button>
          ))}
        </div>

        <div className="pipe-select-row">
          <label htmlFor="builder-example">Scenario</label>
          <select
            id="builder-example"
            className="input"
            value={selectedExampleId}
            onChange={(event) => handleExampleChange(event.target.value)}
          >
            {exampleEntries.length === 0 ? (
              <option value={EMPTY_PIPELINE_GRAPH.id}>No examples configured</option>
            ) : null}
            {exampleEntries.map(([id, example]) => (
              <option key={id} value={id}>
                {example.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <section className="card card-pad mt-6 pipe-import-panel">
        <div className="pipe-panel-head">
          <div>
            <h3>Paste Collector YAML</h3>
            <p className="meta mt-2">
              Import a Collector config into the visual model and review anything that stays raw.
            </p>
          </div>
          {importResult ? (
            <span
              className={`tag ${importResult.confidence === "complete" ? "tag-ok" : "tag-warn"}`}
            >
              {importResult.confidence}
            </span>
          ) : (
            <span className="tag">optional</span>
          )}
        </div>

        <textarea
          className="textarea pipe-yaml-input mt-4"
          value={yamlInput}
          onChange={(event) => setYamlInput(event.target.value)}
          placeholder={`receivers:
  otlp:
    protocols:
      grpc: {}
exporters:
  debug: {}
service:
  pipelines:
    logs:
      receivers: [otlp]
      exporters: [debug]`}
        />

        <div className="pipe-import-actions mt-3">
          <button
            type="button"
            className="btn"
            onClick={handleImportYaml}
            disabled={yamlInput.trim().length === 0}
          >
            Import YAML
          </button>
          {importResult ? (
            <button type="button" className="btn btn-ghost" onClick={handleBackToExample}>
              Back to selected example
            </button>
          ) : null}
        </div>

        {importResult ? (
          <div className="pipe-import-summary mt-4">
            {importResult.warnings.length === 0 ? (
              <div className="banner ok">
                <div>
                  <div className="b-title">Import is fully visualized</div>
                  <div className="b-body">Every imported section is represented in the graph.</div>
                </div>
              </div>
            ) : (
              importResult.warnings.map((warning, index) => (
                <div key={`import-warning-${index}-${warning.code}`} className="banner warn mt-2">
                  <div>
                    <div className="b-title">Import warning: {warning.code}</div>
                    <div className="b-body">
                      {warning.path ? `${warning.path}: ` : ""}
                      {warning.message}
                    </div>
                  </div>
                </div>
              ))
            )}

            {rawSectionEntries.length > 0 ? (
              <details className="pipe-raw-sections mt-3">
                <summary>Preserved raw sections ({rawSectionEntries.length})</summary>
                <pre className="code-block mt-3">
                  {JSON.stringify(importResult.rawSections, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="pipe-layout mt-6" data-mode={mode}>
        {mode !== "yaml" ? (
          <section className="card card-pad pipe-panel">
            <div className="pipe-panel-head">
              <h3>Visual graph</h3>
              <span className={`tag ${validation.ok ? "tag-ok" : "tag-err"}`}>
                {validation.ok ? "graph valid" : "graph issues"}
              </span>
            </div>
            <p className="meta mt-2">{summarizePipelineGraph(graph)}</p>

            <div className="mt-4">
              <Canvas
                nodes={canvasState.nodes}
                edges={canvasState.edges}
                onChange={setCanvasState}
                readOnly
                height={520}
              />
            </div>

            <div className="pipe-role-summary mt-4" aria-label="Component counts by role">
              {ROLES.map((role) => (
                <span key={role} className="tag">
                  {roleLabel(role)} ({componentsByRole[role].length})
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {mode !== "visual" ? (
          <section className="card card-pad pipe-panel">
            <div className="pipe-panel-head">
              <h3>Generated YAML</h3>
              <div className="pipe-panel-actions">
                <span className="tag">artifact preview</span>
                {yamlPreview ? <CopyButton value={yamlPreview} label="copy YAML" /> : null}
              </div>
            </div>
            {yamlPreviewError !== null ? (
              <div className="banner warn mt-4">
                <div>
                  <div className="b-title">YAML preview unavailable</div>
                  <div className="b-body">{yamlPreviewError}</div>
                </div>
              </div>
            ) : (
              <pre className="code-block mt-4 pipe-yaml">{yamlPreview}</pre>
            )}
          </section>
        ) : null}
      </div>

      <ValidationStrip validation={validation} yamlPreviewError={yamlPreviewError} />

      <GuidancePanel
        title="Builder next steps"
        guidance={guidance.data}
        isLoading={guidance.isLoading}
        error={guidance.error}
        onRefresh={() => void guidance.refetch()}
      />
    </div>
  );
}
