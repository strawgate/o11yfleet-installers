import { Badge } from "@mantine/core";
import { isPremiumPlan, planLabel } from "../../shared/plans";

export function PlanTag({ plan }: { plan: string }) {
  const isPremium = isPremiumPlan(plan);
  return (
    <Badge
      size="sm"
      variant={isPremium ? "light" : "default"}
      color={isPremium ? "violet" : undefined}
      tt="none"
    >
      {planLabel(plan)}
      {isPremium ? <span className="sr-only"> (premium)</span> : null}
    </Badge>
  );
}
