import type { AiGuidanceItem, AiGuidanceRequest } from "./guidance.js";

type CandidateSupport = {
  evidence_level: "count_only" | "policy_threshold" | "correlated" | "baseline";
  item: Pick<AiGuidanceItem, "target_key">;
};

export interface AiGuidanceQualityOptions {
  candidates?: CandidateSupport[];
}

export interface AiGuidanceQualityDecision {
  keep: boolean;
  reason?: string;
}

const unsupportedSignificancePattern =
  /\b(unusual|anomal(?:y|ous)|spike|regression|higher than normal|lower than normal|above normal|below normal|a lot|large number|high number|low number)\b/i;

const supportPattern =
  /\b(baseline|history|historical|rollout|cohort|threshold|policy threshold|correlated|compared|comparison|version diff|previous version)\b/i;

export function filterGuidanceItemsForQuality(
  input: AiGuidanceRequest,
  items: AiGuidanceItem[],
  options: AiGuidanceQualityOptions = {},
): AiGuidanceItem[] {
  return items.filter((item) => evaluateGuidanceItemQuality(input, item, options).keep);
}

export function evaluateGuidanceItemQuality(
  input: AiGuidanceRequest,
  item: AiGuidanceItem,
  options: AiGuidanceQualityOptions = {},
): AiGuidanceQualityDecision {
  if (item.evidence.length === 0) {
    return { keep: false, reason: "items need visible evidence" };
  }

  if (
    item.evidence.every((evidence) => isCountOnlyEvidenceValue(evidence.value)) &&
    !hasSignificanceSupport(input, item, options)
  ) {
    return { keep: false, reason: "count-only evidence lacks threshold or baseline support" };
  }

  const text = `${item.headline}\n${item.detail}`;
  if (unsupportedSignificancePattern.test(text) && !hasSignificanceSupport(input, item, options)) {
    return { keep: false, reason: "significance claim lacks baseline or threshold support" };
  }

  return { keep: true };
}

function hasSignificanceSupport(
  input: AiGuidanceRequest,
  item: AiGuidanceItem,
  options: AiGuidanceQualityOptions,
): boolean {
  if (
    options.candidates?.some(
      (candidate) =>
        candidate.item.target_key === item.target_key && candidate.evidence_level !== "count_only",
    )
  ) {
    return true;
  }

  const evidenceText = item.evidence
    .map((evidence) => `${evidence.label} ${evidence.value} ${evidence.source ?? ""}`)
    .join("\n");
  if (supportPattern.test(evidenceText)) return true;

  const contextKeys = [
    ...Object.keys(input.context),
    ...(input.page_context?.details ?? []).map((detail) => detail.key),
    ...(input.page_context?.metrics ?? []).map((metric) => metric.key),
    ...(input.page_context?.tables ?? []).map((table) => table.key),
    ...(input.page_context?.light_fetches ?? []).map((fetch) => `${fetch.key} ${fetch.label}`),
  ].join("\n");

  return supportPattern.test(contextKeys);
}

function isCountOnlyEvidenceValue(value: string): boolean {
  return /^[\s$€£¥+-]*\d[\d,]*(?:\.\d+)?\s*(?:%|ms|s|m|h|d|b|kb|mb|gb|tb|collectors?|agents?|tenants?|configs?|sources?)?$/i.test(
    value,
  );
}
