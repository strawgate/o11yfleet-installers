import { useMemo, useState } from "react";
import { PrototypeBanner } from "../../components/common/PrototypeBanner";
import { usePortalGuidance } from "../../api/hooks/ai";
import { GuidancePanel } from "../../components/ai";
import { buildInsightRequest, insightSurfaces, insightTarget } from "../../ai/insight-registry";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";
import {
  PIPELINE_EXAMPLES,
  PIPELINE_SIGNALS,
  renderCollectorYaml,
  summarizePipelineGraph,
  validatePipelineGraph,
} from "@o11yfleet/core/pipeline";
import type {
  PipelineComponentRole,
  PipelineGraph,
  PipelineSignal,
} from "@o11yfleet/core/pipeline";
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

function roleLabel(role: PipelineComponentRole): string {
  if (role === "receiver") return "Receivers";
  if (role === "processor") return "Processors";
  return "Exporters";
}

function signalLabel(signal: PipelineSignal): string {
  if (signal === "logs") return "Logs";
  if (signal === "metrics") return "Metrics";
  return "Traces";
}

export default function BuilderPage() {
  const [mode, setMode] = useState<BuilderMode>("split");
  const [exampleId, setExampleId] = useState(DEFAULT_EXAMPLE_ID);

  const insightSurface = insightSurfaces.portalBuilder;
  const exampleEntries = Object.entries(PIPELINE_EXAMPLES);
  const selectedExampleId = PIPELINE_EXAMPLES[exampleId]
    ? exampleId
    : (exampleEntries[0]?.[0] ?? EMPTY_PIPELINE_GRAPH.id);
  const graph = PIPELINE_EXAMPLES[selectedExampleId] ?? EMPTY_PIPELINE_GRAPH;
  const validation = useMemo(() => validatePipelineGraph(graph), [graph]);
  const yamlPreview = useMemo(() => renderCollectorYaml(graph), [graph]);
  const componentsById = useMemo(
    () => new Map(graph.components.map((component) => [component.id, component])),
    [graph],
  );
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
      selected_example: graph.label,
      pipeline_summary: summarizePipelineGraph(graph),
      validation_ok: validation.ok,
      warnings: validation.warnings.map((item) => item.message),
      errors: validation.errors.map((item) => item.message),
    },
  );
  const guidance = usePortalGuidance(guidanceRequest);

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
            onChange={(event) => setExampleId(event.target.value)}
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

            <div className="pipe-canvas mt-4">
              <div className="pipe-stage">
                {ROLES.map((role) => (
                  <div key={role} className="pipe-col">
                    <div className="pipe-col-head">
                      {roleLabel(role)}
                      <span className="count">{componentsByRole[role].length}</span>
                    </div>
                    {componentsByRole[role].map((component) => (
                      <article key={component.id} className="pipe-node">
                        <div className="name">
                          <span className="text">{component.name}</span>
                        </div>
                        <div className="sub">{component.type}</div>
                        <div className="sig-row">
                          {component.signals.map((signal) => (
                            <span key={`${component.id}-${signal}`} className={`sig sig-${signal}`}>
                              {signal}
                            </span>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="pipe-wire-list mt-4">
              {PIPELINE_SIGNALS.map((signal) => {
                const signalWires = graph.wires.filter((wire) => wire.signal === signal);
                if (signalWires.length === 0) return null;
                return (
                  <div key={signal} className="banner info mt-2">
                    <div>
                      <div className="b-title">{signalLabel(signal)} flow</div>
                      <div className="b-body">
                        {signalWires
                          .map((wire) => {
                            const from = componentsById.get(wire.from)?.name ?? wire.from;
                            const to = componentsById.get(wire.to)?.name ?? wire.to;
                            return `${from} -> ${to}`;
                          })
                          .join(" / ")}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {mode !== "visual" ? (
          <section className="card card-pad pipe-panel">
            <div className="pipe-panel-head">
              <h3>Generated YAML</h3>
              <span className="tag">artifact preview</span>
            </div>
            <pre className="code-block mt-4 pipe-yaml">{yamlPreview}</pre>
          </section>
        ) : null}
      </div>

      <section className="card card-pad mt-6 pipe-validation-strip">
        <h3>Validation and rollout readiness</h3>
        <p className="meta mt-2">
          Graph checks run locally from the model. Collector runtime validation and rollout gates
          are separate backend contracts.
        </p>

        <div className="pipe-issues mt-4">
          {validation.errors.length === 0 && validation.warnings.length === 0 ? (
            <div className="banner ok">
              <div>
                <div className="b-title">No graph issues detected</div>
                <div className="b-body">Review the generated YAML before creating a version.</div>
              </div>
            </div>
          ) : null}

          {validation.errors.map((issue, index) => (
            <div key={`error-${index}-${issue.code}`} className="banner err mt-2">
              <div>
                <div className="b-title">Error: {issue.code}</div>
                <div className="b-body">{issue.message}</div>
              </div>
            </div>
          ))}

          {validation.warnings.map((issue, index) => (
            <div key={`warning-${index}-${issue.code}`} className="banner warn mt-2">
              <div>
                <div className="b-title">Warning: {issue.code}</div>
                <div className="b-body">{issue.message}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

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
