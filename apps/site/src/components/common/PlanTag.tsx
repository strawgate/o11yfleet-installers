const PREMIUM_PLANS = new Set(["pro", "enterprise"]);

export function PlanTag({ plan }: { plan: string }) {
  const normalized = plan.trim().toLowerCase();
  const isPremium = PREMIUM_PLANS.has(normalized);
  return (
    <span
      className="tag"
      style={isPremium ? { color: "var(--accent)", borderColor: "var(--accent-line)" } : undefined}
    >
      {plan}
    </span>
  );
}
