import { PrototypeBanner } from "../../components/common/PrototypeBanner";
import { usePortalGuidance } from "../../api/hooks/ai";
import { GuidancePanel } from "../../components/ai";
import { buildInsightRequest, insightSurfaces, insightTarget } from "../../ai/insight-registry";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";
import {
  PIPELINE_EXAMPLES,
  renderCollectorYaml,
  summarizePipelineGraph,
  validatePipelineGraph,
} from "@o11yfleet/core/pipeline";

export default function BuilderPage() {
  const insightSurface = insightSurfaces.portalBuilder;
  const example = PIPELINE_EXAMPLES["edge-gateway"]!;
  const validation = validatePipelineGraph(example);
  const yamlPreview = renderCollectorYaml(example);
  const guidanceRequest: AiGuidanceRequest = buildInsightRequest(
    insightSurface,
    [
      insightTarget(insightSurface, insightSurface.targets.page),
      insightTarget(insightSurface, insightSurface.targets.editor),
    ],
    {
      status: "prototype",
      planned_features: [
        "component palette",
        "drag-and-drop wiring",
        "inline configuration editing",
        "real-time validation",
        "AI-powered suggestions",
      ],
    },
  );
  const guidance = usePortalGuidance(guidanceRequest);

  return (
    <div className="main-wide">
      <PrototypeBanner message="Pipeline builder is a prototype. Visual editing and YAML generation coming soon." />

      <div className="page-head mt-6">
        <h1>Pipeline builder</h1>
      </div>

      <div className="card card-pad">
        <h3>Visual pipeline editor</h3>
        <p className="meta mt-2">
          The pipeline builder will let you visually compose OpenTelemetry collector pipelines by
          dragging receivers, processors, and exporters onto a canvas. You&apos;ll be able to switch
          between a visual view, raw YAML, and a split view.
        </p>
        <p className="meta mt-2">
          Features planned: component palette, drag-and-drop wiring, inline configuration editing,
          real-time validation, and AI-powered suggestions.
        </p>
      </div>

      <div
        className="mt-6"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div className="card card-pad">
          <h3>Foundation model</h3>
          <p className="meta mt-2">{summarizePipelineGraph(example)}</p>
          <div className="mt-6">
            <span className={`tag ${validation.ok ? "tag-ok" : "tag-err"}`}>
              {validation.ok ? "graph valid" : "graph needs work"}
            </span>
          </div>
          <div className="mt-6">
            {validation.pipelines.map((pipeline) => (
              <div key={pipeline.signal} className="banner info mt-2">
                <div>
                  <div className="b-title">{pipeline.signal}</div>
                  <div className="b-body">
                    {pipeline.receivers.join(", ")} to {pipeline.processors.join(", ")} to{" "}
                    {pipeline.exporters.join(", ")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card card-pad">
          <h3>Generated YAML preview</h3>
          <pre className="code-block mt-4" style={{ maxHeight: 360, overflow: "auto" }}>
            {yamlPreview}
          </pre>
        </div>
      </div>

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
