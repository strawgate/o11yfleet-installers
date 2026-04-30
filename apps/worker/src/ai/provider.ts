import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateObject,
  streamText,
  type UIMessage,
} from "ai";
import {
  aiGuidanceResponseSchema,
  analyzeGuidanceCandidates,
  candidatesToGuidanceItems,
  filterGuidanceItemsForQuality,
  type AiChatRequest,
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

type AiProviderConfig =
  | { mode: "fixture"; model: "o11yfleet-guidance-fixture" }
  | {
      mode: "sdk";
      model: string;
      provider: ReturnType<typeof createOpenAICompatible>;
    };

export async function generateAiGuidance(
  input: AiGuidanceRequest,
  opts: { env: AiGuidanceEnv; scopeLabel: string; fetch?: typeof fetch },
): Promise<AiGuidanceResponse> {
  const providerConfig = createProviderConfig(opts.env, opts.fetch);
  const candidates = analyzeGuidanceCandidates(input, { scopeLabel: opts.scopeLabel });

  if (providerConfig.mode === "fixture") {
    return buildDeterministicGuidance(input, candidatesToGuidanceItems(candidates), {
      model: providerConfig.model,
    });
  }

  try {
    const result = await generateObject({
      model: providerConfig.provider(providerConfig.model),
      schema: modelOutputSchema,
      schemaName: "O11yFleetGuidance",
      schemaDescription: "Evidence-backed guidance for one o11yFleet app surface.",
      system:
        "You are the o11yFleet guidance engine. Return concise, operational guidance only. Base every item on the supplied targets and context. Do not invent data, credentials, outages, tenants, agents, or configuration state.",
      prompt: buildGuidancePrompt(input, opts.scopeLabel, candidates),
      temperature: 0.2,
      maxOutputTokens: 1600,
    });
    const output = qualityGateModelOutput(
      input,
      sanitizeModelOutput(
        validateModelOutputTargets(modelOutputSchema.parse(result.object), input),
      ),
      candidates,
    );

    return aiGuidanceResponseSchema.parse({
      ...output,
      generated_at: new Date().toISOString(),
      model: providerConfig.model,
    });
  } catch (err) {
    if (err instanceof AiProviderError) {
      throw err;
    }
    console.error("AI guidance provider failed:", err);
    throw new AiProviderError("AI guidance provider failed");
  }
}

export async function streamAiChat(
  input: AiChatRequest,
  opts: { env: AiGuidanceEnv; scopeLabel: string; fetch?: typeof fetch },
): Promise<Response> {
  const providerConfig = createProviderConfig(opts.env, opts.fetch);
  const messages = toUIMessages(input.messages);

  if (providerConfig.mode === "fixture") {
    return fixtureChatResponse(input, messages);
  }

  try {
    const result = streamText({
      model: providerConfig.provider(providerConfig.model),
      system: buildChatSystemPrompt(input, opts.scopeLabel),
      messages: await convertToModelMessages(messages),
      temperature: 0.2,
      maxOutputTokens: 1200,
    });

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      onError: (error) => {
        console.error("AI chat stream failed:", error);
        return "AI chat is unavailable right now.";
      },
    });
  } catch (err) {
    if (err instanceof AiProviderError) {
      throw err;
    }
    console.error("AI chat provider failed:", err);
    throw new AiProviderError("AI chat provider failed");
  }
}

function createProviderConfig(env: AiGuidanceEnv, fetchImpl?: typeof fetch): AiProviderConfig {
  const providerMode = env.LLM_PROVIDER?.trim().toLowerCase() ?? "fixture";
  const model = env.LLM_MODEL?.trim() || "MiniMax-M2.7";

  if (providerMode === "fixture" || providerMode === "deterministic" || !env.LLM_PROVIDER) {
    return { mode: "fixture", model: "o11yfleet-guidance-fixture" };
  }

  if (!["minimax", "openai-compatible"].includes(providerMode)) {
    throw new AiProviderError(`Unsupported LLM provider: ${env.LLM_PROVIDER}`);
  }
  if (!env.MINIMAX_API_KEY) {
    throw new AiProviderError("MINIMAX_API_KEY is required when LLM_PROVIDER uses the SDK");
  }

  const baseURL = env.LLM_BASE_URL?.trim();
  if (providerMode === "openai-compatible" && !baseURL) {
    throw new AiProviderError("LLM_BASE_URL is required when LLM_PROVIDER is openai-compatible");
  }

  return {
    mode: "sdk",
    model,
    provider: createOpenAICompatible({
      name: providerMode === "minimax" ? "minimax" : "openai-compatible",
      apiKey: env.MINIMAX_API_KEY,
      baseURL: (providerMode === "minimax"
        ? baseURL || "https://api.minimax.io/v1"
        : baseURL)!.replace(/\/$/, ""),
      fetch: fetchImpl,
    }),
  };
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
      ],
      targets: input.targets,
      candidate_insights: candidates,
      page_context: input.page_context ?? null,
      context: input.context,
    },
    null,
    2,
  );
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

function qualityGateModelOutput(
  input: AiGuidanceRequest,
  output: Pick<AiGuidanceResponse, "summary" | "items">,
  candidates: ReturnType<typeof analyzeGuidanceCandidates>,
) {
  const items = filterGuidanceItemsForQuality(input, output.items, { candidates });
  return {
    summary:
      items.length > 0
        ? output.summary
        : `No non-obvious guidance found in the provided ${input.surface} context.`,
    items,
  };
}

function validateModelOutputTargets(
  output: Pick<AiGuidanceResponse, "summary" | "items">,
  input: AiGuidanceRequest,
) {
  const allowedTargetKeys = new Set(input.targets.map((target) => target.key));
  const invalidItem = output.items.find((item) => !allowedTargetKeys.has(item.target_key));
  if (invalidItem) {
    throw new AiProviderError(
      `AI guidance provider returned unknown target: ${invalidItem.target_key}`,
    );
  }
  return output;
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

function buildChatSystemPrompt(input: AiChatRequest, scopeLabel: string): string {
  return JSON.stringify(
    {
      role: "You are the o11yFleet page copilot.",
      scope: scopeLabel,
      behavior: [
        "Use the supplied browser-visible context as the primary source of truth.",
        "Be concise and operational. Prefer a short answer with direct evidence.",
        "Do not invent agents, tenants, configuration state, credentials, outages, baselines, or history.",
        "Do not call a count unusual, high, low, a spike, or a regression unless the context includes a baseline, history, rollout timing, clustering, or an explicit threshold.",
        "If the visible context is insufficient, say what is missing instead of guessing.",
      ],
      current_surface: input.context.surface,
      current_intent: input.context.intent,
      targets: input.context.targets,
      page_context: input.context.page_context ?? null,
      context: input.context.context,
    },
    null,
    2,
  );
}

function fixtureChatResponse(input: AiChatRequest, messages: UIMessage[]): Response {
  const textId = "fixture-text";
  const stream = createUIMessageStream<UIMessage>({
    originalMessages: messages,
    async execute({ writer }) {
      writer.write({ type: "start" });
      await Promise.resolve();
      writer.write({ type: "text-start", id: textId });
      await Promise.resolve();
      writer.write({ type: "text-delta", id: textId, delta: buildFixtureChatText(input) });
      await Promise.resolve();
      writer.write({ type: "text-end", id: textId });
      await Promise.resolve();
      writer.write({ type: "finish", finishReason: "stop" });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

function toUIMessages(messages: AiChatRequest["messages"]): UIMessage[] {
  return messages.map((message, index) => ({
    id: message.id ?? `message-${index}`,
    parts: message.parts,
    role: message.role,
  }));
}

function buildFixtureChatText(input: AiChatRequest): string {
  const title =
    input.context.page_context?.title ?? input.context.context["title"] ?? input.context.surface;
  const metrics = input.context.page_context?.metrics ?? [];
  const metricSummary =
    metrics.length > 0
      ? metrics
          .slice(0, 4)
          .map((metric) => `${metric.label}: ${metric.value ?? ""}${metric.unit ?? ""}`)
          .join(", ")
      : "No structured page metrics were supplied.";
  const lastUserText = lastUserMessageText(input.messages);

  return [
    `I can use the visible context for ${title}.`,
    metricSummary,
    lastUserText
      ? `For "${lastUserText}", I would look for explicit evidence in the visible metrics and avoid making anomaly claims without a baseline.`
      : "Ask a specific question about this page and I will keep the answer grounded in visible evidence.",
  ].join("\n\n");
}

function lastUserMessageText(messages: AiChatRequest["messages"]): string {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const parts = Array.isArray(lastUser?.parts) ? lastUser.parts : [];
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const candidate = part as { type?: unknown; text?: unknown };
      return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}
