import type { Overview, Tenant } from "@/api/hooks/portal";
import { hasStatefulOperations, planLabel, policyLimitForPlan } from "@/shared/plans";

type LegacyOverviewFields = {
  agents?: unknown;
};

export interface BillingView {
  plan: string;
  planLabel: string;
  maxConfigs: number | null;
  maxConfigsLabel: number | "Custom";
  usedConfigs: number;
  configPct: number;
  totalAgents: number;
  stateful: boolean;
}

export function buildBillingView(
  tenant: Tenant | undefined,
  overview: Overview | undefined,
): BillingView {
  const legacyOverview = overview as (Overview & LegacyOverviewFields) | undefined;
  const plan = tenant?.plan ?? "starter";
  const maxConfigs =
    typeof tenant?.["max_configs"] === "number" ? tenant["max_configs"] : policyLimitForPlan(plan);
  const usedConfigs =
    typeof overview?.configs_count === "number"
      ? overview.configs_count
      : Array.isArray(overview?.configurations)
        ? overview.configurations.length
        : 0;
  const totalAgents =
    typeof overview?.total_agents === "number"
      ? overview.total_agents
      : typeof legacyOverview?.agents === "number"
        ? legacyOverview.agents
        : 0;

  return {
    plan,
    planLabel: planLabel(plan),
    maxConfigs,
    maxConfigsLabel: maxConfigs === null ? "Custom" : maxConfigs,
    usedConfigs,
    configPct:
      typeof maxConfigs === "number" && maxConfigs > 0
        ? Math.min(100, Math.round((usedConfigs / maxConfigs) * 100))
        : 0,
    totalAgents,
    stateful: hasStatefulOperations(plan),
  };
}
