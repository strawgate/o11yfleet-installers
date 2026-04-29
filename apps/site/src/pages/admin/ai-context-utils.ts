import type { AdminTenant } from "../../api/hooks/admin";
import { normalizePlanId } from "../../shared/plans";

export interface AdminAiOverviewContext {
  onboarding_gap_ratio: number;
  plan_zero_state_rates: Array<{
    plan: string;
    tenant_count: number;
    zero_config_rate: number;
    zero_user_rate: number;
  }>;
  tenant_limit_utilization: Array<{
    plan: string;
    config_limit_utilization_ratio: number;
  }>;
  tenant_config_concentration_top3_ratio: number;
}

export function emailDomain(email: string): string {
  const [, domain] = email.split("@");
  return domain ? `@${domain}` : "unknown";
}

export function buildAdminAiOverviewContext(
  tenants: AdminTenant[],
  totalTenants: number,
  totalConfigurations: number,
): AdminAiOverviewContext {
  const sampledTenantTotal = tenants.length;
  const hasCompleteTenantSample = sampledTenantTotal === totalTenants;
  if (!hasCompleteTenantSample || sampledTenantTotal < 5) {
    return {
      onboarding_gap_ratio: 0,
      plan_zero_state_rates: [],
      tenant_limit_utilization: [],
      tenant_config_concentration_top3_ratio: 0,
    };
  }

  const tenantsWithoutConfigs = tenants.filter(
    (tenant) => numberField(tenant, "config_count") === 0,
  );
  const configCounts = tenants.map((tenant) => numberField(tenant, "config_count"));
  const top3ConfigCount = [...configCounts]
    .sort((a, b) => b - a)
    .slice(0, 3)
    .reduce((sum, count) => sum + count, 0);

  return {
    onboarding_gap_ratio:
      sampledTenantTotal > 0 ? tenantsWithoutConfigs.length / sampledTenantTotal : 0,
    plan_zero_state_rates: planZeroStateRates(tenants),
    tenant_limit_utilization: tenants.flatMap((tenant) => {
      const maxConfigs = numberField(tenant, "max_configs");
      if (maxConfigs <= 0) return [];
      return [
        {
          plan: normalizePlanId(tenant.plan),
          config_limit_utilization_ratio: numberField(tenant, "config_count") / maxConfigs,
        },
      ];
    }),
    tenant_config_concentration_top3_ratio:
      totalConfigurations > 0 ? Math.min(1, top3ConfigCount / totalConfigurations) : 0,
  };
}

function planZeroStateRates(
  tenants: AdminTenant[],
): AdminAiOverviewContext["plan_zero_state_rates"] {
  const buckets = tenants.reduce<
    Record<string, { total: number; zeroConfigs: number; zeroUsers: number }>
  >((acc, tenant) => {
    const plan = normalizePlanId(tenant.plan);
    const bucket = acc[plan] ?? { total: 0, zeroConfigs: 0, zeroUsers: 0 };
    bucket.total += 1;
    if (numberField(tenant, "config_count") === 0) bucket.zeroConfigs += 1;
    if (numberField(tenant, "user_count") === 0) bucket.zeroUsers += 1;
    acc[plan] = bucket;
    return acc;
  }, {});

  return Object.entries(buckets).map(([plan, bucket]) => ({
    plan,
    tenant_count: bucket.total,
    zero_config_rate: bucket.total > 0 ? bucket.zeroConfigs / bucket.total : 0,
    zero_user_rate: bucket.total > 0 ? bucket.zeroUsers / bucket.total : 0,
  }));
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}
