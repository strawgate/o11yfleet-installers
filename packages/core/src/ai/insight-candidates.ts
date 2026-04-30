import type {
  AiGuidanceAction,
  AiGuidanceEvidence,
  AiGuidanceItem,
  AiGuidanceRequest,
  AiGuidanceTarget,
} from "./guidance.js";
import { analyzeConfigCopilotYaml } from "./config-copilot.js";

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
const warningDriftGapRatio = 0.25;
const offlineClusterMinAgents = 3;
const minOperationalCohortSize = 5;
const minOperationalAffectedCollectors = 3;
const minCriticalAffectedCollectors = 10;
const minAdminCohortSize = 5;
const maxGuidanceDetailLength = 800;

export function analyzeGuidanceCandidates(
  input: AiGuidanceRequest,
  options: AnalyzeGuidanceCandidatesOptions,
): AiInsightCandidate[] {
  const candidates: AiInsightCandidate[] = [];
  const pageTarget = targetFor(input, "page") ?? input.targets[0]!;
  const metricTarget = targetFor(input, "metric") ?? pageTarget;
  const collectorMetricTarget = targetForCollectorMetric(input) ?? metricTarget;
  const sectionTarget = targetFor(input, "section") ?? pageTarget;
  const tableTarget = targetFor(input, "table") ?? sectionTarget;

  const totalAgents = numberFromRequest(input, "total_agents");
  const connectedAgents = numberFromRequest(input, "connected_agents");
  const healthyAgents = numberFromRequest(input, "healthy_agents");
  const configCount =
    numberFromRequest(input, "configs_count") ?? numberFromRequest(input, "total_configurations");
  const activeTokens = numberFromRequest(input, "total_active_tokens");
  const tenantCount = numberFromRequest(input, "total_tenants");
  const reviewAgentsAction = reviewAgentsActionFor(options.scopeLabel);
  const clusterCandidates = deriveOfflineClusterCandidates(
    input,
    tableTarget.key,
    options.scopeLabel,
  );

  if (
    clusterCandidates.length === 0 &&
    totalAgents !== null &&
    connectedAgents !== null &&
    connectedAgents < totalAgents
  ) {
    const offline = totalAgents - connectedAgents;
    const offlineRatio = offline / Math.max(totalAgents, 1);
    if (hasMaterialOperationalShare(offline, totalAgents, criticalConnectivityGapRatio)) {
      candidates.push({
        signal: "connectivity_gap",
        evidence_level: "policy_threshold",
        rationale:
          "The connected collector count is below the configured triage threshold. This is a policy-threshold insight, not a historical anomaly claim.",
        item: {
          target_key: collectorMetricTarget.key,
          headline: `${offline} collector${offline === 1 ? "" : "s"} offline`,
          detail:
            healthyAgents !== null && healthyAgents > connectedAgents
              ? "Connectivity and health counts disagree, so treat health as stale until collectors reconnect. Check configuration-level concentration before changing rollout policy."
              : "The disconnected share crosses the connectivity triage threshold. Check whether the gap is concentrated in one configuration before changing rollout policy.",
          severity: severityForOperationalShare(offline, offlineRatio),
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
    if (hasMaterialOperationalShare(unhealthy, connectedAgents, warningHealthGapRatio)) {
      candidates.push({
        signal: "health_gap",
        evidence_level: "policy_threshold",
        rationale:
          "Connected collectors are reporting unhealthy runtime state above the configured triage threshold.",
        item: {
          target_key: collectorMetricTarget.key,
          headline: `${unhealthy} connected collector${unhealthy === 1 ? "" : "s"} unhealthy`,
          detail:
            "This is a health-state gap among collectors that are still connected. Prioritize config status, resource pressure, or exporter failures before network troubleshooting.",
          severity: severityForOperationalShare(unhealthy, unhealthyRatio, 0.5),
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

  candidates.push(...clusterCandidates);
  if (input.surface === "portal.agent") {
    candidates.push(...deriveAgentCandidates(input, tableTarget.key, sectionTarget.key));
  }
  if (input.surface === "portal.configuration") {
    candidates.push(...deriveConfigurationOperationalCandidates(input, sectionTarget.key));
    candidates.push(...deriveConfigurationCopilotCandidates(input, sectionTarget.key));
  }
  if (input.surface === "admin.usage") {
    candidates.push(...deriveAdminUsageCandidates(input, pageTarget.key, tableTarget.key));
  }
  if (options.scopeLabel === "admin") {
    candidates.push(...deriveAdminCandidates(input, pageTarget.key, sectionTarget.key));
  }

  return candidates.slice(0, 12);
}

function deriveAgentCandidates(
  input: AiGuidanceRequest,
  tableTargetKey: string,
  sectionTargetKey: string,
): AiInsightCandidate[] {
  const totalAgents = numberFromRequest(input, "total_agents");
  if (totalAgents === null || totalAgents <= 0) return [];

  const candidates: AiInsightCandidate[] = [];
  const driftedAgents = numberFromRequest(input, "drifted_agents");
  if (driftedAgents !== null && driftedAgents > 0) {
    const driftRatio = driftedAgents / totalAgents;
    if (hasMaterialOperationalShare(driftedAgents, totalAgents, warningDriftGapRatio)) {
      candidates.push({
        signal: "visible_agent_drift",
        evidence_level: "policy_threshold",
        rationale:
          "Visible agent guidance is based on explicit desired/current config hash mismatch counts, not a historical regression claim.",
        item: {
          target_key: tableTargetKey,
          headline: `${driftedAgents} collector${driftedAgents === 1 ? "" : "s"} drifted`,
          detail:
            "Visible collectors are reporting a current config hash that differs from desired. Check rollout completion and collector apply errors before changing policy.",
          severity: severityForOperationalShare(driftedAgents, driftRatio, 0.5),
          confidence: 0.76,
          evidence: [
            evidence("Total collectors", totalAgents, "visible page"),
            evidence("Drifted collectors", driftedAgents, "visible page"),
            evidence("Drift share", `${Math.round(driftRatio * 100)}%`, "policy threshold"),
          ],
          action: { kind: "open_page", label: "Review configuration", href: "/portal/agents" },
        },
      });
    }
  }

  const degradedAgents = numberFromRequest(input, "degraded_agents");
  if (degradedAgents !== null && degradedAgents > 0) {
    const degradedRatio = degradedAgents / totalAgents;
    if (hasMaterialOperationalShare(degradedAgents, totalAgents, warningHealthGapRatio)) {
      candidates.push({
        signal: "visible_agent_degraded_state",
        evidence_level: "policy_threshold",
        rationale:
          "The visible collector table reports degraded runtime state above the configured triage threshold.",
        item: {
          target_key: sectionTargetKey,
          headline: `${degradedAgents} collector${degradedAgents === 1 ? "" : "s"} degraded`,
          detail:
            "Degraded collectors are still visible but need runtime-state triage. Prioritize their last error, health state, and config sync before connectivity work.",
          severity: severityForOperationalShare(degradedAgents, degradedRatio, 0.5),
          confidence: 0.72,
          evidence: [
            evidence("Total collectors", totalAgents, "visible page"),
            evidence("Degraded collectors", degradedAgents, "visible page"),
            evidence("Degraded share", `${Math.round(degradedRatio * 100)}%`, "policy threshold"),
          ],
        },
      });
    }
  }

  return candidates;
}

function deriveConfigurationOperationalCandidates(
  input: AiGuidanceRequest,
  fallbackTargetKey: string,
): AiInsightCandidate[] {
  const driftedAgents = numberFromRequest(input, "drifted_agents");
  const connectedAgents =
    numberFromRequest(input, "connected_agents") ?? numberFromRequest(input, "agents_connected");
  if (driftedAgents === null || connectedAgents === null || connectedAgents <= 0) return [];

  const driftRatio = driftedAgents / connectedAgents;
  if (!hasMaterialOperationalShare(driftedAgents, connectedAgents, warningDriftGapRatio)) return [];

  const rolloutTarget = targetForKey(input, "configuration.rollout")?.key ?? fallbackTargetKey;
  return [
    {
      signal: "configuration_rollout_drift",
      evidence_level: "policy_threshold",
      rationale:
        "Configuration guidance compares visible drifted collectors against currently connected collectors.",
      item: {
        target_key: rolloutTarget,
        headline: `${driftedAgents} connected collector${driftedAgents === 1 ? "" : "s"} drifted`,
        detail:
          "A meaningful share of connected collectors has not converged to the desired config hash. Check rollout cohort state and collector apply errors before retrying rollout.",
        severity: severityForOperationalShare(driftedAgents, driftRatio, 0.5),
        confidence: 0.74,
        evidence: [
          evidence("Connected collectors", connectedAgents, "visible page"),
          evidence("Drifted collectors", driftedAgents, "visible page"),
          evidence("Drift share", `${Math.round(driftRatio * 100)}%`, "policy threshold"),
        ],
        action: { kind: "none", label: "Review rollout cohort" },
      },
    },
  ];
}

function deriveConfigurationCopilotCandidates(
  input: AiGuidanceRequest,
  fallbackTargetKey: string,
): AiInsightCandidate[] {
  if (input.intent !== "explain_page" && input.intent !== "draft_config_change") return [];

  const yamlTarget =
    input.targets.find((target) => target.key.includes("yaml")) ??
    targetFor(input, "editor_selection") ??
    input.targets.find((target) => target.kind === "section") ??
    input.targets[0];
  const targetKey = yamlTarget?.key ?? fallbackTargetKey;
  const analysis = analyzeConfigCopilotYaml(input.page_context?.yaml, input.intent);

  if (input.intent === "draft_config_change" && analysis.blockers.length > 0) {
    return [
      {
        signal: "configuration_draft_blocked",
        evidence_level: "policy_threshold",
        rationale:
          "Draft configuration changes are fail-closed when deterministic parser and safety gates find blockers.",
        item: {
          target_key: targetKey,
          headline: "Draft change blocked by YAML safety gate",
          detail: cappedGuidanceDetail(analysis.blockers.map((blocker) => blocker.message)),
          severity: "warning",
          confidence: 0.86,
          evidence: [
            evidence("Draft safe", "no", "parser-backed safety gate"),
            evidence("Blockers", analysis.blockers.length, "parser-backed safety gate"),
          ],
          action: { kind: "none", label: "Fix YAML before drafting" },
        },
      },
    ];
  }

  if (input.intent !== "explain_page" || !analysis.yaml_present) return [];

  const severity = analysis.blockers.length > 0 ? "warning" : "notice";
  return [
    {
      signal: "configuration_yaml_explain",
      evidence_level: "correlated",
      rationale:
        "This is an explicit configuration copilot explanation grounded in parser output, not ambient guidance for every valid YAML file.",
      item: {
        target_key: targetKey,
        headline:
          analysis.pipeline_count > 0
            ? `YAML defines ${analysis.pipeline_count} service pipeline${analysis.pipeline_count === 1 ? "" : "s"}`
            : "YAML needs review before graph-based editing",
        detail:
          analysis.summary ??
          "The collector YAML could not be summarized into the visual pipeline model.",
        severity,
        confidence: analysis.safe_for_draft ? 0.78 : 0.68,
        evidence: [
          evidence("Import confidence", analysis.import_confidence, "collector parser"),
          evidence(
            "Signals",
            analysis.signals.length > 0 ? analysis.signals.join(", ") : "none",
            "collector parser",
          ),
          evidence(
            "Draft safe",
            analysis.safe_for_draft ? "yes" : "no",
            "parser-backed safety gate",
          ),
        ],
        action: analysis.safe_for_draft
          ? { kind: "propose_config_change", label: "Ask for a draft" }
          : { kind: "none", label: "Resolve YAML blockers" },
      },
    },
  ];
}

function cappedGuidanceDetail(messages: string[]): string {
  const detail = messages.join(" ");
  if (detail.length <= maxGuidanceDetailLength) return detail;

  const suffix = " Additional blockers omitted.";
  let head = "";
  for (const character of detail) {
    if (head.length + character.length > maxGuidanceDetailLength - suffix.length) break;
    head += character;
  }
  return `${head.trimEnd()}${suffix}`;
}

function deriveAdminCandidates(
  input: AiGuidanceRequest,
  pageTargetKey: string,
  sectionTargetKey: string,
): AiInsightCandidate[] {
  const candidates: AiInsightCandidate[] = [];
  const healthStatus = stringFromRequest(input, "health_status").toLowerCase();
  if (healthStatus && !["healthy", "ok", "ready", "unknown"].includes(healthStatus)) {
    candidates.push({
      signal: "admin_dependency_health_gap",
      evidence_level: "correlated",
      rationale:
        "Admin health guidance is grounded in the explicit dependency health status exposed by the page.",
      item: {
        target_key: pageTargetKey,
        headline: `System health is ${healthStatus}`,
        detail:
          "The admin health surface is not reporting healthy. Triage dependency checks before interpreting tenant or collector metrics.",
        severity: "warning",
        confidence: 0.72,
        evidence: [evidence("Health status", healthStatus, "admin health")],
        action: { kind: "open_page", label: "Open health", href: "/admin/health" },
      },
    });
  }

  const planRates = arrayFromContext(input.context, "plan_zero_state_rates")
    .map((row) => ({
      plan: stringValue(row["plan"]),
      tenantCount: numberValue(row["tenant_count"]),
      zeroConfigRate: numberValue(row["zero_config_rate"]),
      zeroUserRate: numberValue(row["zero_user_rate"]),
    }))
    .filter(
      (row) =>
        row.plan !== "" && row.tenantCount >= minAdminCohortSize && row.zeroConfigRate >= 0.5,
    )
    .sort((a, b) => b.zeroConfigRate - a.zeroConfigRate);

  const onboardingGapRatio = numberFromRequest(input, "onboarding_gap_ratio");
  const worstPlan = planRates[0];
  if (onboardingGapRatio !== null && onboardingGapRatio >= 0.35 && worstPlan) {
    candidates.push({
      signal: "admin_onboarding_gap_by_plan",
      evidence_level: "policy_threshold",
      rationale:
        "Admin onboarding guidance is based on plan-cohort ratios and an explicit zero-configuration threshold.",
      item: {
        target_key: sectionTargetKey,
        headline: `Onboarding gap concentrated in ${worstPlan.plan}`,
        detail:
          "This plan cohort has a high share of tenants without configurations. Focus on first-configuration onboarding before treating this as runtime fleet health.",
        severity: worstPlan.zeroConfigRate >= 0.7 ? "critical" : "warning",
        confidence: 0.74,
        evidence: [
          evidence("Overall zero-config rate", `${Math.round(onboardingGapRatio * 100)}%`, "admin"),
          evidence("Plan cohort", worstPlan.plan, "admin"),
          evidence("Cohort size", worstPlan.tenantCount, "admin"),
          evidence(
            "Plan zero-config rate",
            `${Math.round(worstPlan.zeroConfigRate * 100)}%`,
            "policy threshold",
          ),
          evidence("Plan zero-user rate", `${Math.round(worstPlan.zeroUserRate * 100)}%`, "admin"),
        ],
        action: { kind: "open_page", label: "Review tenants", href: "/admin/tenants" },
      },
    });
  }

  const utilizationRows = arrayFromContext(input.context, "tenant_limit_utilization");
  const measuredUtilization = utilizationRows
    .map((row) => numberValue(row["config_limit_utilization_ratio"]))
    .filter((value) => value > 0);
  const nearLimit = measuredUtilization.filter((value) => value >= 0.85).length;
  if (
    measuredUtilization.length >= minAdminCohortSize &&
    nearLimit / measuredUtilization.length >= 0.3
  ) {
    candidates.push({
      signal: "admin_capacity_pressure_by_limit",
      evidence_level: "policy_threshold",
      rationale:
        "Capacity pressure is normalized by tenant configuration limits, not by absolute tenant counts.",
      item: {
        target_key: pageTargetKey,
        headline: "Tenants are nearing configuration limits",
        detail:
          "A meaningful share of measured tenants is at or above 85% of configuration capacity. Review plan limits before additional onboarding creates friction.",
        severity: nearLimit / measuredUtilization.length >= 0.5 ? "critical" : "warning",
        confidence: 0.72,
        evidence: [
          evidence("Tenants near limit", `${nearLimit}/${measuredUtilization.length}`, "admin"),
          evidence(
            "Near-limit share",
            `${Math.round((nearLimit / measuredUtilization.length) * 100)}%`,
            "policy threshold",
          ),
        ],
        action: { kind: "open_page", label: "Review tenant limits", href: "/admin/tenants" },
      },
    });
  }

  const tenantConfigConcentration = numberFromRequest(
    input,
    "tenant_config_concentration_top3_ratio",
  );
  const totalConfigurations = numberFromRequest(input, "total_configurations");
  if (
    tenantConfigConcentration !== null &&
    totalConfigurations !== null &&
    totalConfigurations >= 20 &&
    tenantConfigConcentration >= 0.65
  ) {
    candidates.push({
      signal: "admin_cross_tenant_concentration",
      evidence_level: "correlated",
      rationale:
        "Configuration ownership concentration is a blast-radius risk when enough configurations exist to make the ratio meaningful.",
      item: {
        target_key: sectionTargetKey,
        headline: "Configurations are concentrated across few tenants",
        detail:
          "A small tenant group owns most configurations. Validate isolation, support readiness, and rollout safeguards for concentrated impact.",
        severity: tenantConfigConcentration >= 0.8 ? "critical" : "warning",
        confidence: 0.7,
        evidence: [
          evidence(
            "Top-3 configuration share",
            `${Math.round(tenantConfigConcentration * 100)}%`,
            "admin aggregate",
          ),
          evidence("Total configurations", totalConfigurations, "admin aggregate"),
        ],
        action: { kind: "open_page", label: "Review tenant mix", href: "/admin/tenants" },
      },
    });
  }

  const tenantUtilization = numberFromRequest(input, "config_limit_utilization");
  const tenantConfigLimit = numberFromRequest(input, "max_configs");
  if (
    tenantConfigLimit !== null &&
    tenantConfigLimit >= 5 &&
    tenantUtilization !== null &&
    tenantUtilization >= 0.85
  ) {
    candidates.push({
      signal: "admin_tenant_capacity_pressure",
      evidence_level: "policy_threshold",
      rationale:
        "Tenant-detail capacity pressure is normalized by the tenant's explicit configuration limit.",
      item: {
        target_key: pageTargetKey,
        headline: "Tenant is near its configuration limit",
        detail:
          "This tenant is close to the configured maximum number of configurations. Review limits or consolidate before adding more workloads.",
        severity: tenantUtilization >= 0.95 ? "critical" : "warning",
        confidence: 0.76,
        evidence: [
          evidence(
            "Config limit utilization",
            `${Math.round(tenantUtilization * 100)}%`,
            "policy threshold",
          ),
          evidence("Configured limit", tenantConfigLimit, "admin"),
        ],
        action: { kind: "open_page", label: "Open tenant settings", href: "/admin/tenants" },
      },
    });
  }

  return candidates;
}

function deriveAdminUsageCandidates(
  input: AiGuidanceRequest,
  pageTargetKey: string,
  tableTargetKey: string,
): AiInsightCandidate[] {
  const candidates: AiInsightCandidate[] = [];
  const sourceTargetKey = targetForKey(input, "admin.usage.sources")?.key ?? tableTargetKey;
  const spendTargetKey = targetForKey(input, "admin.usage.spend")?.key ?? pageTargetKey;
  const totalSources = numberFromRequest(input, "total_usage_sources");
  const readySources = numberFromRequest(input, "ready_usage_sources");
  if (
    totalSources !== null &&
    totalSources > 0 &&
    readySources !== null &&
    readySources < totalSources
  ) {
    candidates.push({
      signal: "admin_usage_source_gap",
      evidence_level: "correlated",
      rationale:
        "Usage guidance compares configured source coverage against the explicit source count on the page.",
      item: {
        target_key: sourceTargetKey,
        headline: `${totalSources - readySources} usage source${totalSources - readySources === 1 ? "" : "s"} not connected`,
        detail:
          "Spend estimates are only as complete as the connected usage sources. Configure missing sources before using projections for planning.",
        severity: readySources === 0 ? "warning" : "notice",
        confidence: 0.78,
        evidence: [
          evidence("Ready sources", `${readySources}/${totalSources}`, "admin usage"),
          evidence(
            "Required env vars",
            numberFromRequest(input, "required_env_count") ?? 0,
            "admin usage",
          ),
        ],
      },
    });
  }

  const projectedSpend = numberFromRequest(input, "projected_month_estimated_spend_usd");
  const monthToDateSpend = numberFromRequest(input, "month_to_date_estimated_spend_usd");
  if (projectedSpend !== null && monthToDateSpend !== null && projectedSpend >= 1) {
    candidates.push({
      signal: "admin_usage_projection_visible",
      evidence_level: "policy_threshold",
      rationale:
        "Usage projection guidance reports explicit estimated spend only; it does not claim a spike or anomaly.",
      item: {
        target_key: spendTargetKey,
        headline: "Monthly usage projection is non-zero",
        detail:
          "The current usage estimate projects billable spend this month. Review service line items before changing plan or free-tier assumptions.",
        severity: projectedSpend >= 25 ? "warning" : "notice",
        confidence: 0.68,
        evidence: [
          evidence("Month-to-date estimate", `$${monthToDateSpend.toFixed(2)}`, "admin usage"),
          evidence("Projected month", `$${projectedSpend.toFixed(2)}`, "admin usage"),
        ],
      },
    });
  }

  return candidates;
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

function targetForCollectorMetric(input: AiGuidanceRequest): AiGuidanceTarget | null {
  return (
    input.targets.find(
      (target) =>
        target.kind === "metric" && /(agent|collector)/i.test(`${target.key} ${target.label}`),
    ) ?? null
  );
}

function reviewAgentsActionFor(scopeLabel: string): AiGuidanceAction | undefined {
  if (scopeLabel === "admin") return undefined;
  return { kind: "open_page", label: "Review agents", href: "/portal/agents" };
}

function hasMaterialOperationalShare(
  affectedCollectors: number,
  totalCollectors: number,
  ratioThreshold: number,
): boolean {
  return (
    totalCollectors >= minOperationalCohortSize &&
    affectedCollectors >= minOperationalAffectedCollectors &&
    affectedCollectors / Math.max(totalCollectors, 1) >= ratioThreshold
  );
}

function severityForOperationalShare(
  affectedCollectors: number,
  affectedRatio: number,
  criticalRatio = 0.75,
): AiGuidanceItem["severity"] {
  return affectedCollectors >= minCriticalAffectedCollectors && affectedRatio >= criticalRatio
    ? "critical"
    : "warning";
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

function arrayFromContext(
  context: Record<string, unknown>,
  key: string,
): Array<Record<string, unknown>> {
  const value = context[key];
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> =>
    Boolean(row && typeof row === "object"),
  );
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringFromRequest(input: AiGuidanceRequest, key: string): string {
  const detail = input.page_context?.details?.find((candidate) => candidate.key === key);
  if (typeof detail?.value === "string") return detail.value.trim();
  return stringValue(input.context[key]).trim();
}

function numberFromPageContext(input: AiGuidanceRequest, key: string): number | null {
  const metric = input.page_context?.metrics?.find((candidate) => candidate.key === key);
  if (!metric) return null;
  if (typeof metric.value === "number" && Number.isFinite(metric.value)) return metric.value;
  if (typeof metric.value === "string" && metric.value.trim() !== "") {
    const parsed = Number(metric.value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function targetForKey(input: AiGuidanceRequest, key: string): AiGuidanceTarget | null {
  return input.targets.find((target) => target.key === key) ?? null;
}

function deriveOfflineClusterCandidates(
  input: AiGuidanceRequest,
  targetKey: string,
  scopeLabel: string,
): AiInsightCandidate[] {
  if (!input.surface.startsWith("portal.")) return [];

  const table = input.page_context?.tables?.find(
    (candidate) =>
      /(agent|collector)/i.test(candidate.key) || /(agent|collector)/i.test(candidate.label),
  );
  if (!table || table.rows.length === 0) return [];

  const groupedByConfig = new Map<string, { total: number; offline: number }>();
  for (const row of table.rows) {
    const configHash = stringFromRow(row, [
      "desired_config_hash",
      "config_hash",
      "configuration_hash",
    ]);
    const status = stringFromRow(row, ["status", "connection_status", "connectivity"]);
    if (!configHash || !status) continue;

    const bucket = groupedByConfig.get(configHash) ?? { total: 0, offline: 0 };
    bucket.total += 1;
    if (isOfflineStatus(status)) bucket.offline += 1;
    groupedByConfig.set(configHash, bucket);
  }

  const strongestCluster = [...groupedByConfig.entries()]
    .map(([configHash, bucket]) => ({ configHash, ...bucket }))
    .filter((bucket) => bucket.total >= offlineClusterMinAgents)
    .sort((a, b) => {
      const ratioDelta = b.offline / b.total - a.offline / a.total;
      if (ratioDelta !== 0) return ratioDelta;
      if (b.offline !== a.offline) return b.offline - a.offline;
      return b.total - a.total;
    })[0];
  if (!strongestCluster || strongestCluster.offline === 0) return [];

  const offlineRatio = strongestCluster.offline / strongestCluster.total;
  if (offlineRatio < criticalConnectivityGapRatio) return [];

  return [
    {
      signal: "offline_cluster_by_config",
      evidence_level: "correlated",
      rationale:
        "Offline state is clustered by visible configuration hash, making this stronger than a raw count-only claim.",
      item: {
        target_key: targetKey,
        headline: `Offline cluster on ${strongestCluster.configHash.slice(0, 12)}`,
        detail:
          "Visible collectors sharing a configuration hash are disproportionately offline. Check recent rollout timing and config validity before broad connectivity remediation.",
        severity: severityForOperationalShare(strongestCluster.offline, offlineRatio),
        confidence: 0.74,
        evidence: [
          evidence("Cluster config hash", strongestCluster.configHash, scopeLabel),
          evidence(
            "Offline in cluster",
            `${strongestCluster.offline}/${strongestCluster.total}`,
            scopeLabel,
          ),
          evidence(
            "Offline share in cluster",
            `${Math.round(offlineRatio * 100)}%`,
            "visible rows",
          ),
        ],
        action: reviewAgentsActionFor(scopeLabel),
      },
    },
  ];
}

function stringFromRow(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function isOfflineStatus(status: string): boolean {
  const normalized = status.toLowerCase().replace(/[\s_-]+/g, "");
  return ["offline", "disconnected", "down", "notconnected"].includes(normalized);
}
