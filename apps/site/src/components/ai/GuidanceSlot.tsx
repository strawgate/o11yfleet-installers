import type { AiGuidanceItem } from "@o11yfleet/core/ai";
import { GuidanceBadge } from "./GuidanceBadge";

interface GuidanceSlotProps {
  item?: AiGuidanceItem;
  loading?: boolean;
}

export function GuidanceSlot({ item, loading = false }: GuidanceSlotProps) {
  if (loading) return null;
  if (!item) return null;

  return (
    <div className="ai-slot">
      <div className="ai-slot-title">
        <GuidanceBadge severity={item.severity} />
        <strong>{item.headline}</strong>
      </div>
      <p>{item.detail}</p>
    </div>
  );
}
