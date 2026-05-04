// Re-export the canonical health-payload types from @o11yfleet/core/api
// so admin pages can keep their existing imports from support-model.
import type { z } from "zod";
import type { adminHealthMetricsSchema, AdminHealth } from "@o11yfleet/core/api";

export type HealthMetrics = z.infer<typeof adminHealthMetricsSchema>;
export type AdminHealthPayload = AdminHealth;

export interface SupportTenant {
  id: string;
  name: string;
  plan?: string;
}

export interface SupportStep {
  label: string;
  description: string;
  path: (tenantId: string | null) => string;
  requiresTenant?: boolean;
}

export interface SupportSymptom {
  id: string;
  title: string;
  summary: string;
  whyItMatters: string;
  steps: SupportStep[];
}

export const SYMPTOMS: SupportSymptom[] = [
  {
    id: "collector-offline",
    title: "Collector offline or stale",
    summary: "Start with tenant configuration assignment, then compare control-plane health.",
    whyItMatters:
      "Offline collectors can be tenant-specific enrollment/config issues or broader Durable Object and Worker availability issues.",
    steps: [
      {
        label: "Open tenant configurations",
        description: "Check config count, rollout target, and collector assignment.",
        path: (tenantId) =>
          tenantId ? `/admin/tenants/${tenantId}?tab=configurations` : "/admin/tenants",
        requiresTenant: true,
      },
      {
        label: "Open system health",
        description: "Check Worker/API and Durable Object availability.",
        path: () => "/admin/health",
      },
    ],
  },
  {
    id: "config-not-applying",
    title: "Config not applying",
    summary: "Verify the tenant's desired configuration and then check control-plane dependencies.",
    whyItMatters:
      "Config apply failures usually need the tenant configuration tab first, then R2/Durable Object health if many tenants are affected.",
    steps: [
      {
        label: "Open tenant configurations",
        description: "Review managed collector configs and current tenant limits.",
        path: (tenantId) =>
          tenantId ? `/admin/tenants/${tenantId}?tab=configurations` : "/admin/tenants",
        requiresTenant: true,
      },
      {
        label: "Open system health",
        description: "Check R2, D1, and Durable Object checks.",
        path: () => "/admin/health",
      },
    ],
  },
  {
    id: "quota-or-plan",
    title: "Quota, billing, or plan confusion",
    summary: "Confirm tenant plan assignment and compare against plan definitions.",
    whyItMatters:
      "Plan and limit issues should be resolved from real tenant settings and plan definitions, not inferred from portal copy.",
    steps: [
      {
        label: "Open tenant settings",
        description: "Check the tenant's assigned plan and limits.",
        path: (tenantId) =>
          tenantId ? `/admin/tenants/${tenantId}?tab=settings` : "/admin/tenants",
        requiresTenant: true,
      },
      {
        label: "Open plans",
        description: "Compare configured plan limits.",
        path: () => "/admin/plans",
      },
    ],
  },
  {
    id: "api-errors",
    title: "API errors or admin UI failures",
    summary: "Start with global control-plane health, then scope to the tenant if needed.",
    whyItMatters:
      "API failures can be global even when the first report arrives through one tenant.",
    steps: [
      {
        label: "Open system health",
        description: "Check Worker/API, D1, R2, Durable Objects, and Analytics Engine.",
        path: () => "/admin/health",
      },
      {
        label: "Open tenant overview",
        description: "Check whether the affected tenant loads and has expected resources.",
        path: (tenantId) => (tenantId ? `/admin/tenants/${tenantId}` : "/admin/tenants"),
        requiresTenant: true,
      },
    ],
  },
];

export function healthTone(status: string | undefined): "ok" | "warn" | "err" {
  if (!status) return "warn";
  if (status === "healthy" || status === "ok") return "ok";
  if (status === "degraded" || status === "unknown") return "warn";
  return "err";
}

export function healthLabel(key: string): string {
  return key.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function buildSupportBrief({
  tenant,
  symptom,
  health,
}: {
  tenant: SupportTenant | null;
  symptom: SupportSymptom;
  health: AdminHealthPayload | undefined;
}): string {
  const checks = health?.checks ?? {};
  const lines = [
    "O11yFleet support brief",
    `Tenant: ${tenant ? `${tenant.name} (${tenant.id})` : "Not selected"}`,
    `Plan: ${tenant?.plan ?? "unknown"}`,
    `Symptom: ${symptom.title}`,
    `Why it matters: ${symptom.whyItMatters}`,
    `Control-plane health: ${health?.status ?? "unknown"}`,
  ];

  const checkLines = Object.entries(checks).map(([key, check]) => {
    const latency =
      check.latency_ms !== null && check.latency_ms !== undefined ? `, ${check.latency_ms}ms` : "";
    const error = check.error ? `, ${check.error}` : "";
    return `- ${healthLabel(key)}: ${check.status ?? "unknown"}${latency}${error}`;
  });
  lines.push("Dependency checks:");
  lines.push(...(checkLines.length > 0 ? checkLines : ["- none reported"]));

  lines.push("Suggested next screens:");
  for (const step of symptom.steps) {
    lines.push(`- ${step.label}: ${step.path(tenant?.id ?? null)}`);
  }

  return lines.join("\n");
}
