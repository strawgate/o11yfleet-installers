import type { AiGuidanceSeverity } from "@o11yfleet/core/ai";

interface GuidanceBadgeProps {
  severity: AiGuidanceSeverity;
}

export function GuidanceBadge({ severity }: GuidanceBadgeProps) {
  return <span className={`ai-badge ai-badge-${severity}`}>{severity}</span>;
}
