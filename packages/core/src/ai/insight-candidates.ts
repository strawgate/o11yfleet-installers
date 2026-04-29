import type {
  AiGuidanceAction,
  AiGuidanceEvidence,
  AiGuidanceItem,
  AiGuidanceRequest,
  AiGuidanceTarget,
} from "./guidance.js";

export type AiInsightEvidenceLevel = "count_only" | "policy_threshold" | "correlated" | "baseline";

export interface AiInsightCandidate {
  signal: string;
  evidence_level: AiInsightEvidenceLevel;
  rationale: string;
  item: AiGuidanceItem;
}

export interface AnalyzeGuidanceCandidatesOptions {
  scopeLabel: string;
}

const criticalConnectivityGapRatio = 0.5;
const warningHealthGapRatio = 0.25;

export function analyzeGuidanceCandidates(
  input: AiGuidanceRequest,
  options: AnalyzeGuidanceCandidatesOptions,
): AiInsightCandidate[] {
  const candidates: AiInsightCandidate[] = [];
  const pageTarget = targetFor(input, "page") ?? input.targets[0]!;
  const metricTarget = targetFor(input, "metric") ?? pageTarget;
  const sectionTarget = targetFor(input, "section") ?? pageTarget;

  const totalAgents = numberFromRequest(input, "total_agents");
  const connectedAgents = numberFromRequest(input, "connected_agents");
  const healthyAgents = numberFromRequest(input, "healthy_agents");
  const configCount =
    numberFromRequest(input, "configs_count") ?? numberFromRequest(input, "total_configurations");
  const activeTokens = numberFromRequest(input, "total_active_tokens");
  const tenantCount = numberFromRequest(input, "total_tenants");
  const reviewAgentsAction = reviewAgentsActionFor(options.scopeLabel);

  if (totalAgents !== null && connectedAgents !== null && connectedAgents < totalAgents) {
    const offline = totalAgents - connectedAgents;
    const offlineRatio = offline / Math.max(totalAgents, 1);
    if (offlineRatio >= criticalConnectivityGapRatio) {
      candidates.push({
        signal: "connectivity_gap",
        evidence_level: "policy_threshold",
        rationale:
          "The connected collector count is below the configured triage threshold. This is a policy-threshold insight, not a historical anomaly claim.",
        item: {
          target_key: metricTarget.key,
          headline: `${offline} collector${offline === 1 ? "" : "s"} offline`,
          detail:
            "The current page data crosses the connectivity triage threshold. Check whether the gap is concentrated in one configuration before changing rollout policy.",
          severity: offlineRatio > 0.75 ? "critical" : "warning",
          confidence: 0.76,
          evidence: [
            evidence("Total collectors", totalAgents, options.scopeLabel),
            evidence("Connected collectors", connectedAgents, options.scopeLabel),
            evidence("Offline share", `${Math.round(offlineRatio * 100)}%`, "policy threshold"),
          ],
          action: reviewAgentsAction,
        },
      });
    }
  }

  if (
    healthyAgents !== null &&
    connectedAgents !== null &&
    connectedAgents > 0 &&
    healthyAgents < connectedAgents
  ) {
    const unhealthy = connectedAgents - healthyAgents;
    const unhealthyRatio = unhealthy / connectedAgents;
    if (unhealthyRatio >= warningHealthGapRatio) {
      candidates.push({
        signal: "health_gap",
        evidence_level: "policy_threshold",
        rationale:
          "Connected collectors are reporting unhealthy runtime state above the configured triage threshold.",
        item: {
          target_key: sectionTarget.key,
          headline: `${unhealthy} connected collector${unhealthy === 1 ? "" : "s"} unhealthy`,
          detail:
            "This is a health-state gap among collectors that are still connected. Prioritize config status, resource pressure, or exporter failures before network troubleshooting.",
          severity: unhealthyRatio > 0.5 ? "critical" : "warning",
          confidence: 0.72,
          evidence: [
            evidence("Connected collectors", connectedAgents, options.scopeLabel),
            evidence("Healthy collectors", healthyAgents, options.scopeLabel),
            evidence("Unhealthy share", `${Math.round(unhealthyRatio * 100)}%`, "policy threshold"),
          ],
          action: reviewAgentsAction
            ? { ...reviewAgentsAction, label: "Inspect unhealthy agents" }
            : undefined,
        },
      });
    }
  }

  if (
    options.scopeLabel === "admin" &&
    tenantCount !== null &&
    tenantCount > 0 &&
    configCount === 0
  ) {
    candidates.push({
      signal: "tenant_setup_gap",
      evidence_level: "correlated",
      rationale:
        "The admin context has tenants but zero configurations, which is an onboarding or seed-data gap rather than a fleet-health anomaly.",
      item: {
        target_key: pageTarget.key,
        headline: "Tenants exist without configurations",
        detail:
          "The admin view shows tenants but no configurations. Treat this as an onboarding/setup gap before drawing conclusions about fleet health.",
        severity: "notice",
        confidence: 0.78,
        evidence: [
          evidence("Tenants", tenantCount, options.scopeLabel),
          evidence("Configurations", 0, options.scopeLabel),
        ],
        action: { kind: "open_page", label: "Open tenants", href: "/admin/tenants" },
      },
    });
  }

  if (activeTokens !== null && activeTokens > 0 && configCount === 0) {
    candidates.push({
      signal: "token_configuration_mismatch",
      evidence_level: "correlated",
      rationale:
        "Active enrollment tokens without visible configurations are contradictory enough to warrant verification.",
      item: {
        target_key: sectionTarget.key,
        headline: "Active enrollment tokens without configurations",
        detail:
          "Enrollment tokens should normally be attached to managed configurations. Verify that the page context is complete before sharing new tokens.",
        severity: "warning",
        confidence: 0.7,
        evidence: [
          evidence("Active tokens", activeTokens, options.scopeLabel),
          evidence("Configurations", 0, options.scopeLabel),
        ],
      },
    });
  }

  return candidates.slice(0, 12);
}

export function candidatesToGuidanceItems(candidates: AiInsightCandidate[]): AiGuidanceItem[] {
  return candidates.map((candidate) => candidate.item);
}

function targetFor(
  input: AiGuidanceRequest,
  kind: AiGuidanceTarget["kind"],
): AiGuidanceTarget | null {
  return input.targets.find((target) => target.kind === kind) ?? null;
}

function reviewAgentsActionFor(scopeLabel: string): AiGuidanceAction | undefined {
  if (scopeLabel === "admin") return undefined;
  return { kind: "open_page", label: "Review agents", href: "/portal/agents" };
}

function evidence(label: string, value: string | number, source: string): AiGuidanceEvidence {
  return { label, value: String(value), source };
}

function numberFromRequest(input: AiGuidanceRequest, key: string): number | null {
  return numberFromPageContext(input, key) ?? numberFromContext(input.context, key);
}

function numberFromContext(context: Record<string, unknown>, key: string): number | null {
  const value = context[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberFromPageContext(input: AiGuidanceRequest, key: string): number | null {
  const metric = input.page_context?.metrics.find((candidate) => candidate.key === key);
  if (!metric) return null;
  if (typeof metric.value === "number" && Number.isFinite(metric.value)) return metric.value;
  if (typeof metric.value === "string" && metric.value.trim() !== "") {
    const parsed = Number(metric.value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
