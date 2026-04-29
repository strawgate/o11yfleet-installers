export const PLAN_OPTIONS = [
  { id: "hobby", label: "Hobby", audience: "Personal" },
  { id: "pro", label: "Pro", audience: "Personal" },
  { id: "starter", label: "Starter", audience: "Organization" },
  { id: "growth", label: "Growth", audience: "Organization" },
  { id: "enterprise", label: "Enterprise", audience: "Organization" },
] as const;

const PLAN_LABELS = new Map<string, string>([
  ...PLAN_OPTIONS.map((plan) => [plan.id, plan.label] as const),
]);

const PLAN_IDS = new Set<string>(PLAN_OPTIONS.map((plan) => plan.id));
const STATEFUL_PLAN_IDS = new Set(["pro", "growth", "enterprise"]);
const PLAN_POLICY_LIMITS = new Map<string, number | null>([
  ["hobby", 1],
  ["pro", 3],
  ["starter", 1],
  ["growth", 10],
  ["enterprise", null],
]);

export function normalizePlanId(plan: string | null | undefined): string {
  const normalized = (plan ?? "").trim().toLowerCase();
  if (!normalized) return "starter";
  return normalized;
}

export function planLabel(plan: string): string {
  const normalized = normalizePlanId(plan);
  return PLAN_LABELS.get(normalized) ?? normalized.replaceAll("_", " ");
}

export function isKnownPlanId(plan: string): boolean {
  return PLAN_IDS.has(normalizePlanId(plan));
}

export function isPremiumPlan(plan: string): boolean {
  return STATEFUL_PLAN_IDS.has(normalizePlanId(plan));
}

export function hasStatefulOperations(plan: string): boolean {
  return STATEFUL_PLAN_IDS.has(normalizePlanId(plan));
}

export function policyLimitForPlan(plan: string): number | null {
  const normalized = normalizePlanId(plan);
  if (!PLAN_IDS.has(normalized)) return null;
  return PLAN_POLICY_LIMITS.get(normalized) ?? null;
}
