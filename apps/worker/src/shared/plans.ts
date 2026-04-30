// Plan definitions — single source of truth for plan names, limits, and validation.

export type PlanAudience = "personal" | "business";
export type PlanId = "hobby" | "pro" | "starter" | "growth" | "enterprise";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  audience: PlanAudience;
  price: string;
  annual_price: string | null;
  max_users: number | null;
  max_collectors: number | null;
  max_policies: number | null;
  max_configs: number;
  max_agents_per_config: number;
  max_github_repos: number | null;
  max_api_keys: number | null;
  history_retention: string;
  supports_api: boolean;
  supports_gitops: boolean;
  supports_sso: boolean;
  stateful_operations: boolean;
  features: string[];
}

export const DEFAULT_PLAN: PlanId = "starter";

export const PLAN_DEFINITIONS: Record<PlanId, PlanDefinition> = {
  hobby: {
    id: "hobby",
    name: "Hobby",
    audience: "personal",
    price: "$0",
    annual_price: null,
    max_users: 1,
    max_collectors: 10,
    max_policies: 1,
    max_configs: 1,
    max_agents_per_config: 10,
    max_github_repos: 0,
    max_api_keys: 0,
    history_retention: "Live only",
    supports_api: false,
    supports_gitops: false,
    supports_sso: false,
    stateful_operations: false,
    features: ["Live collector inventory", "1 policy", "Manual config deployment"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    audience: "personal",
    price: "$29/mo",
    annual_price: "$290/yr",
    max_users: 1,
    max_collectors: 25,
    max_policies: 3,
    max_configs: 3,
    max_agents_per_config: 25,
    max_github_repos: 0,
    max_api_keys: 0,
    history_retention: "7 days",
    supports_api: false,
    supports_gitops: false,
    supports_sso: false,
    stateful_operations: true,
    features: ["3 policies", "7-day history", "Version history, diff, and rollback"],
  },
  starter: {
    id: "starter",
    name: "Starter",
    audience: "business",
    price: "$0",
    annual_price: null,
    max_users: 3,
    max_collectors: 1_000,
    max_policies: 1,
    max_configs: 1,
    max_agents_per_config: 1_000,
    max_github_repos: 0,
    max_api_keys: 0,
    history_retention: "Live only",
    supports_api: false,
    supports_gitops: false,
    supports_sso: false,
    stateful_operations: false,
    features: ["1,000 collectors", "1 policy", "Shared team inventory"],
  },
  growth: {
    id: "growth",
    name: "Growth",
    audience: "business",
    price: "$499/mo",
    annual_price: "$5,000/yr",
    max_users: 10,
    max_collectors: 1_000,
    max_policies: 10,
    max_configs: 10,
    max_agents_per_config: 1_000,
    max_github_repos: 10,
    max_api_keys: null,
    history_retention: "30 days",
    supports_api: true,
    supports_gitops: true,
    supports_sso: false,
    stateful_operations: true,
    features: [
      "10 policies",
      "30-day history",
      "Progressive and canary rollouts",
      "Unlimited API keys and 10 repositories",
      "Basic RBAC",
      "Webhooks and audit log",
    ],
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    audience: "business",
    price: "Starts at $50k/yr",
    annual_price: null,
    max_users: null,
    max_collectors: null,
    max_policies: null,
    max_configs: 1_000,
    max_agents_per_config: 500_000,
    max_github_repos: null,
    max_api_keys: null,
    history_retention: "90d-1yr+",
    supports_api: true,
    supports_gitops: true,
    supports_sso: true,
    stateful_operations: true,
    features: [
      "Custom managed config and repo limits",
      "SSO / SAML / OIDC",
      "Advanced RBAC and governance controls",
      "Audit log export",
      "Custom support and SLA terms",
    ],
  },
};

export const PLAN_LIMITS: Record<
  PlanId,
  Pick<PlanDefinition, "max_configs" | "max_agents_per_config">
> = Object.fromEntries(
  Object.entries(PLAN_DEFINITIONS).map(([id, plan]) => [
    id,
    {
      max_configs: plan.max_configs,
      max_agents_per_config: plan.max_agents_per_config,
    },
  ]),
) as Record<PlanId, Pick<PlanDefinition, "max_configs" | "max_agents_per_config">>;

export const VALID_PLANS = Object.keys(PLAN_DEFINITIONS) as PlanId[];

export function normalizePlan(plan: string): PlanId | null {
  const normalized = plan.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(PLAN_DEFINITIONS, normalized)) {
    return normalized as PlanId;
  }
  return null;
}

export function getPlanLimits(plan: PlanId): {
  max_configs: number;
  max_agents_per_config: number;
} {
  return PLAN_LIMITS[plan];
}
