// Plan definitions — single source of truth for plan names, limits, and validation.

export const PLAN_LIMITS: Record<string, { max_configs: number; max_agents_per_config: number }> = {
  free: { max_configs: 5, max_agents_per_config: 50_000 },
  pro: { max_configs: 50, max_agents_per_config: 100_000 },
  enterprise: { max_configs: 1_000, max_agents_per_config: 500_000 },
};

export const VALID_PLANS = Object.keys(PLAN_LIMITS);

export function getPlanLimits(plan: string): {
  max_configs: number;
  max_agents_per_config: number;
} {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS["free"]!;
}
