import { Link } from "react-router-dom";
import type { AiGuidanceItem, AiGuidanceResponse } from "@o11yfleet/core/ai";
import { GuidanceBadge } from "./GuidanceBadge";

interface GuidancePanelProps {
  title: string;
  guidance?: AiGuidanceResponse;
  isLoading?: boolean;
  error?: Error | null;
  onRefresh?: () => void;
  targetKeys?: string[];
}

export function GuidancePanel({
  title,
  guidance,
  isLoading = false,
  error,
  onRefresh,
  targetKeys,
}: GuidancePanelProps) {
  const items = filterItems(guidance?.items ?? [], targetKeys);

  if ((error || !isLoading) && items.length === 0) {
    return null;
  }

  return (
    <section className="ai-panel" aria-live="polite">
      <div className="ai-panel-head">
        <div>
          <div className="ai-kicker">AI guidance</div>
          <h3>{title}</h3>
        </div>
        {onRefresh ? (
          <button className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={isLoading}>
            {isLoading ? "Analyzing..." : "Refresh"}
          </button>
        ) : null}
      </div>

      {!error && isLoading && !guidance ? (
        <p className="ai-empty">Analyzing current data...</p>
      ) : null}
      {!error && !isLoading && guidance ? <p className="ai-summary">{guidance.summary}</p> : null}

      {items.length > 0 ? (
        <div className="ai-items">
          {items.map((item, index) => (
            <GuidanceItemView key={`${item.target_key}:${item.headline}:${index}`} item={item} />
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
          {item.evidence.map((evidence, index) => (
            <span key={`${evidence.label}:${evidence.value}:${index}`}>
              {evidence.label}: <strong>{evidence.value}</strong>
            </span>
          ))}
        </div>
      ) : null}
      {href ? (
        <Link className="btn btn-ghost btn-sm ai-action" to={href}>
          {item.action?.label ?? "Open"}
        </Link>
      ) : null}
    </article>
  );
}

function filterItems(items: AiGuidanceItem[], targetKeys?: string[]): AiGuidanceItem[] {
  if (!targetKeys || targetKeys.length === 0) return items;
  const keys = new Set(targetKeys);
  return items.filter((item) => keys.has(item.target_key));
}
