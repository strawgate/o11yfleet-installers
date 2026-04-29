import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import {
  aiGuidanceResponseSchema,
  type AiGuidanceItem,
  type AiGuidanceRequest,
  type AiGuidanceResponse,
  type AiGuidanceTarget,
} from "@o11yfleet/core/ai";
import type { Env } from "../index.js";

type AiGuidanceEnv = Pick<Env, "MINIMAX_API_KEY" | "LLM_PROVIDER" | "LLM_MODEL" | "LLM_BASE_URL">;

export class AiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderError";
    Object.setPrototypeOf(this, AiProviderError.prototype);
  }
}

const modelOutputSchema = aiGuidanceResponseSchema.omit({
  generated_at: true,
  model: true,
});

export async function generateAiGuidance(
  input: AiGuidanceRequest,
  opts: { env: AiGuidanceEnv; scopeLabel: string; fetch?: typeof fetch },
): Promise<AiGuidanceResponse> {
  const providerMode = opts.env.LLM_PROVIDER?.trim().toLowerCase() ?? "fixture";
  const model = opts.env.LLM_MODEL?.trim() || "MiniMax-M2.7";

  if (providerMode === "fixture" || providerMode === "deterministic" || !opts.env.LLM_PROVIDER) {
    return buildDeterministicGuidance(input, {
      model: "o11yfleet-guidance-fixture",
      scopeLabel: opts.scopeLabel,
    });
  }

  if (!["minimax", "openai-compatible"].includes(providerMode)) {
    throw new AiProviderError(`Unsupported LLM provider: ${opts.env.LLM_PROVIDER}`);
  }
  if (!opts.env.MINIMAX_API_KEY) {
    throw new AiProviderError("MINIMAX_API_KEY is required when LLM_PROVIDER uses the SDK");
  }

  const provider = createOpenAICompatible({
    name: providerMode === "minimax" ? "minimax" : "openai-compatible",
    apiKey: opts.env.MINIMAX_API_KEY,
    baseURL: (opts.env.LLM_BASE_URL?.trim() || "https://api.minimax.io/v1").replace(/\/$/, ""),
    fetch: opts.fetch,
  });

  try {
    const result = await generateText({
      model: provider(model),
      system:
        "You are the o11yFleet guidance engine. Return concise, operational guidance only. Base every item on the supplied targets and context. Do not invent data, credentials, outages, tenants, agents, or configuration state. Return only valid JSON matching the requested schema.",
      prompt: buildGuidancePrompt(input, opts.scopeLabel),
      temperature: 0.2,
      maxOutputTokens: 1600,
    });
    const output = sanitizeModelOutput(modelOutputSchema.parse(parseModelJson(result.text)));

    return aiGuidanceResponseSchema.parse({
      ...output,
      generated_at: new Date().toISOString(),
      model,
    });
  } catch (err) {
    console.error("AI guidance provider failed:", err);
    throw new AiProviderError("AI guidance provider failed");
  }
}

function buildGuidancePrompt(input: AiGuidanceRequest, scopeLabel: string): string {
  return JSON.stringify(
    {
      task: "Generate up to 6 high-signal guidance items for this app surface. Prefer actionable fleet operations insights over generic observations.",
      scope: scopeLabel,
      surface: input.surface,
      user_prompt: input.user_prompt ?? null,
      constraints: [
        "Use only target_key values from the supplied targets.",
        "Severity must reflect operational urgency: notice, warning, or critical.",
        "Confidence should be conservative when context is sparse.",
        "Evidence values must come from the supplied context or target context.",
        "Actions are optional; use kind none when no safe app action is obvious.",
        "Return only a JSON object with keys summary and items. Do not wrap it in Markdown.",
      ],
      schema: {
        summary: "string, 1-1000 chars",
        items:
          "array of up to 12 objects: { target_key, headline, detail, severity, confidence, evidence?, action? }",
      },
      targets: input.targets,
      context: input.context,
    },
    null,
    2,
  );
}

function parseModelJson(text: string): unknown {
  const withoutThinking = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = withoutThinking.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] ?? withoutThinking;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new AiProviderError("AI guidance provider returned invalid JSON");
  }
}

function sanitizeModelOutput(output: Pick<AiGuidanceResponse, "summary" | "items">) {
  return {
    ...output,
    items: output.items.map((item) => {
      const action = item.action;
      if (!action || !("href" in action) || !action.href || isAppRelativeHref(action.href)) {
        return item;
      }
      return {
        ...item,
        action: {
          kind: "none" as const,
          label: action.label,
        },
      };
    }),
  };
}

function buildDeterministicGuidance(
  input: AiGuidanceRequest,
  opts: { model: string; scopeLabel: string },
): AiGuidanceResponse {
  const items: AiGuidanceItem[] = [];
  const pageTarget = targetFor(input, "page") ?? input.targets[0]!;
  const metricTarget = targetFor(input, "metric") ?? pageTarget;
  const sectionTarget = targetFor(input, "section") ?? pageTarget;

  const totalAgents = numberFromContext(input.context, "total_agents");
  const connectedAgents = numberFromContext(input.context, "connected_agents");
  const healthyAgents = numberFromContext(input.context, "healthy_agents");
  const configCount =
    numberFromContext(input.context, "configs_count") ??
    numberFromContext(input.context, "total_configurations");
  const activeTokens = numberFromContext(input.context, "total_active_tokens");
  const tenantCount = numberFromContext(input.context, "total_tenants");
  const reviewAgentsAction =
    opts.scopeLabel === "admin"
      ? undefined
      : ({ kind: "open_page", label: "Review agents", href: "/portal/agents" } as const);

  if (totalAgents !== null && connectedAgents !== null && connectedAgents < totalAgents) {
    const offline = totalAgents - connectedAgents;
    items.push({
      target_key: metricTarget.key,
      headline: `${offline} collector${offline === 1 ? "" : "s"} offline`,
      detail:
        "Some enrolled collectors are not currently connected. Check whether the gap is concentrated in one configuration before changing rollout policy.",
      severity: offline / Math.max(totalAgents, 1) > 0.25 ? "critical" : "warning",
      confidence: 0.8,
      evidence: [
        { label: "Total collectors", value: String(totalAgents), source: opts.scopeLabel },
        { label: "Connected collectors", value: String(connectedAgents), source: opts.scopeLabel },
      ],
      action: reviewAgentsAction,
    });
  }

  if (
    healthyAgents !== null &&
    connectedAgents !== null &&
    connectedAgents > 0 &&
    healthyAgents < connectedAgents
  ) {
    const unhealthy = connectedAgents - healthyAgents;
    items.push({
      target_key: sectionTarget.key,
      headline: `${unhealthy} connected collector${unhealthy === 1 ? "" : "s"} unhealthy`,
      detail:
        "Connected but unhealthy collectors usually indicate config status, resource pressure, or exporter failures rather than network loss.",
      severity: unhealthy / connectedAgents > 0.2 ? "critical" : "warning",
      confidence: 0.74,
      evidence: [
        { label: "Connected collectors", value: String(connectedAgents), source: opts.scopeLabel },
        { label: "Healthy collectors", value: String(healthyAgents), source: opts.scopeLabel },
      ],
      action: reviewAgentsAction
        ? { ...reviewAgentsAction, label: "Inspect unhealthy agents" }
        : undefined,
    });
  }

  if (configCount === 0) {
    items.push({
      target_key: pageTarget.key,
      headline: "No managed configurations yet",
      detail:
        "There is not enough fleet data for optimization guidance until at least one configuration and collector are connected.",
      severity: "notice",
      confidence: 0.95,
      evidence: [{ label: "Configurations", value: "0", source: opts.scopeLabel }],
      action: {
        kind: "open_page",
        label: "Create configuration",
        href: "/portal/configurations",
      },
    });
  }

  if (opts.scopeLabel === "admin" && tenantCount !== null && tenantCount > 0 && configCount === 0) {
    items.push({
      target_key: pageTarget.key,
      headline: "Tenants exist without configurations",
      detail:
        "The admin view shows tenants but no configurations. This is likely an onboarding or seed-data gap rather than a fleet health issue.",
      severity: "notice",
      confidence: 0.76,
      evidence: [
        { label: "Tenants", value: String(tenantCount), source: opts.scopeLabel },
        { label: "Configurations", value: "0", source: opts.scopeLabel },
      ],
      action: { kind: "open_page", label: "Open tenants", href: "/admin/tenants" },
    });
  }

  if (activeTokens !== null && activeTokens > 0 && configCount === 0) {
    items.push({
      target_key: sectionTarget.key,
      headline: "Active enrollment tokens without configurations",
      detail:
        "Enrollment tokens should normally be attached to managed configurations. Verify that the overview context is complete before sharing new tokens.",
      severity: "warning",
      confidence: 0.7,
      evidence: [
        { label: "Active tokens", value: String(activeTokens), source: opts.scopeLabel },
        { label: "Configurations", value: "0", source: opts.scopeLabel },
      ],
    });
  }

  const summary =
    items.length > 0
      ? `Found ${items.length} guidance item${items.length === 1 ? "" : "s"} from the provided ${input.surface} context.`
      : `No non-obvious guidance found in the provided ${input.surface} context.`;

  return aiGuidanceResponseSchema.parse({
    summary,
    items: items.slice(0, 12),
    generated_at: new Date().toISOString(),
    model: opts.model,
  });
}

function targetFor(
  input: AiGuidanceRequest,
  kind: AiGuidanceTarget["kind"],
): AiGuidanceTarget | null {
  return input.targets.find((target) => target.kind === kind) ?? null;
}

function isAppRelativeHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

function numberFromContext(context: Record<string, unknown>, key: string): number | null {
  const value = context[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
