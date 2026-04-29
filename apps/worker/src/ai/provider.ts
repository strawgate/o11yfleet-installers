import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import {
  aiGuidanceResponseSchema,
  analyzeGuidanceCandidates,
  candidatesToGuidanceItems,
  type AiGuidanceRequest,
  type AiGuidanceResponse,
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
  const candidates = analyzeGuidanceCandidates(input, { scopeLabel: opts.scopeLabel });

  if (providerMode === "fixture" || providerMode === "deterministic" || !opts.env.LLM_PROVIDER) {
    return buildDeterministicGuidance(input, candidatesToGuidanceItems(candidates), {
      model: "o11yfleet-guidance-fixture",
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
      prompt: buildGuidancePrompt(input, opts.scopeLabel, candidates),
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

function buildGuidancePrompt(
  input: AiGuidanceRequest,
  scopeLabel: string,
  candidates: ReturnType<typeof analyzeGuidanceCandidates>,
): string {
  return JSON.stringify(
    {
      task: "Generate up to 6 high-signal guidance items for this app surface. Prefer actionable fleet operations insights over generic observations.",
      scope: scopeLabel,
      surface: input.surface,
      intent: input.intent,
      user_prompt: input.user_prompt ?? null,
      constraints: [
        "Treat page_context as the primary source of truth because it is what the user can currently see in the browser.",
        "The generic context object is supplemental compatibility data.",
        "Light fetches are explicit +1/+2 browser API calls requested by the UI; use them when present but do not ask for more data.",
        "Use only target_key values from the supplied targets.",
        "Severity must reflect operational urgency: notice, warning, or critical.",
        "Confidence should be conservative when context is sparse.",
        "Evidence values must come from page_context, generic context, or target context.",
        "Candidate insights are deterministic pre-analysis from app-owned rules. Prefer them when present, and do not weaken their evidence or caveats.",
        "Do not turn raw counts into claims like unusual, high, low, spike, or regression unless the context includes a baseline, history, rollout timing, clustering, or an explicit threshold.",
        "Actions are optional; use kind none when no safe app action is obvious.",
        "If there is no non-obvious useful insight, return an empty items array.",
        "Return only a JSON object with keys summary and items. Do not wrap it in Markdown.",
      ],
      schema: {
        summary: "string, 1-1000 chars",
        items:
          "array of up to 12 objects: { target_key, headline, detail, severity, confidence, evidence?, action? }",
      },
      targets: input.targets,
      candidate_insights: candidates,
      page_context: input.page_context ?? null,
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
  items: ReturnType<typeof candidatesToGuidanceItems>,
  opts: { model: string },
): AiGuidanceResponse {
  const summary =
    items.length > 0
      ? `Found ${items.length} guidance item${items.length === 1 ? "" : "s"} from the provided ${input.surface} context.`
      : `No non-obvious guidance found in the provided ${input.surface} context.`;

  return aiGuidanceResponseSchema.parse({
    summary,
    items,
    generated_at: new Date().toISOString(),
    model: opts.model,
  });
}

function isAppRelativeHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}
