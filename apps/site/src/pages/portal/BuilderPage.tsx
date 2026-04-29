import { PrototypeBanner } from "../../components/common/PrototypeBanner";
import { usePortalGuidance } from "../../api/hooks/ai";
import { GuidancePanel } from "../../components/ai";
import { buildInsightRequest, insightSurfaces, insightTarget } from "../../ai/insight-registry";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";

export default function BuilderPage() {
  const insightSurface = insightSurfaces.portalBuilder;
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
