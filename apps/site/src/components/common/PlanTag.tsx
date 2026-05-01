import { isPremiumPlan, planLabel } from "../../shared/plans";

export function PlanTag({ plan }: { plan: string }) {
  const isPremium = isPremiumPlan(plan);
  return (
    <span
      className="tag"
      style={isPremium ? { color: "var(--accent)", borderColor: "var(--accent-line)" } : undefined}
    >
      {planLabel(plan)}
      {isPremium && <span className="sr-only"> (premium)</span>}
    </span>
  );
}
