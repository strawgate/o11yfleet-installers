import { Link } from "react-router-dom";
import { Button } from "@mantine/core";
import type { AiGuidanceItem, AiGuidanceResponse } from "@o11yfleet/core/ai";
import { GuidanceBadge } from "./GuidanceBadge";

interface GuidancePanelProps {
  title: string;
  guidance?: AiGuidanceResponse;
  isLoading?: boolean;
  error?: Error | null;
  onRefresh?: () => void;
  targetKeys?: string[];
  excludeTargetKeys?: string[];
}

export function GuidancePanel({
  title,
  guidance,
  isLoading = false,
  error,
  onRefresh,
  targetKeys,
  excludeTargetKeys,
}: GuidancePanelProps) {
  const items = filterItems(guidance?.items ?? [], targetKeys, excludeTargetKeys);

  if (items.length === 0) return null;

  return (
    <section className="ai-panel" aria-live="polite">
      <div className="ai-panel-head">
        <div>
          <div className="ai-kicker">AI guidance</div>
          <h3>{title}</h3>
        </div>
        {onRefresh ? (
          <Button size="compact-xs" variant="default" onClick={onRefresh} loading={isLoading}>
            Refresh
          </Button>
        ) : null}
      </div>

      {!error && !isLoading && guidance ? <p className="ai-summary">{guidance.summary}</p> : null}

      {items.length > 0 ? (
        <div className="ai-items">
          {items.map((item) => (
            <GuidanceItemView key={`${item.target_key}:${item.headline}`} item={item} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function GuidanceItemView({ item }: { item: AiGuidanceItem }) {
  const href = item.action && "href" in item.action ? item.action.href : undefined;

  return (
    <article className="ai-item">
      <div className="ai-item-title">
        <GuidanceBadge severity={item.severity} />
        <strong>{item.headline}</strong>
      </div>
      <p>{item.detail}</p>
      {item.evidence.length > 0 ? (
        <div className="ai-evidence">
          {item.evidence.map((evidence) => (
            <span key={`${evidence.label}:${evidence.value}`}>
              {evidence.label}: <strong>{evidence.value}</strong>
            </span>
          ))}
        </div>
      ) : null}
      {href ? (
        <Button
          component={Link}
          to={href}
          size="compact-xs"
          variant="default"
          className="ai-action"
        >
          {item.action?.label ?? "Open"}
        </Button>
      ) : null}
    </article>
  );
}

function filterItems(
  items: AiGuidanceItem[],
  targetKeys?: string[],
  excludeTargetKeys?: string[],
): AiGuidanceItem[] {
  const includeKeys = targetKeys && targetKeys.length > 0 ? new Set(targetKeys) : null;
  const excludeKeys =
    excludeTargetKeys && excludeTargetKeys.length > 0 ? new Set(excludeTargetKeys) : null;
  return items.filter((item) => {
    if (includeKeys && !includeKeys.has(item.target_key)) return false;
    if (excludeKeys?.has(item.target_key)) return false;
    return true;
  });
}
