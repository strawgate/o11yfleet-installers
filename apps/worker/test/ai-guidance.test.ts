import { describe, expect, it, vi } from "vitest";
import { env, exports } from "cloudflare:workers";
import { authHeaders } from "./helpers.js";
import { handleV1Request } from "../src/routes/v1/index.js";
import { generateAiGuidance } from "../src/ai/provider.js";
import type { AiGuidanceResponse } from "@o11yfleet/core/ai";

const overviewRequest = {
  surface: "portal.overview",
  targets: [
    {
      key: "overview.page",
      label: "Overview page",
      surface: "portal.overview",
      kind: "page",
    },
    {
      key: "overview.fleet-health",
      label: "Fleet health cards",
      surface: "portal.overview",
      kind: "metric",
    },
  ],
  context: {
    total_agents: 10,
    connected_agents: 4,
    healthy_agents: 3,
    configs_count: 2,
  },
  page_context: {
    route: "/portal/overview",
    title: "Fleet overview",
    metrics: [
      { key: "total_agents", label: "Total collectors", value: 10 },
      { key: "connected_agents", label: "Connected collectors", value: 4 },
      { key: "healthy_agents", label: "Healthy collectors", value: 3 },
      { key: "configs_count", label: "Configurations", value: 2 },
    ],
    tables: [
      {
        key: "recent_configurations",
        label: "Recent configurations",
        columns: ["name", "status"],
        rows: [{ name: "prod", status: "active" }],
        total_rows: 1,
      },
    ],
  },
};

describe("AI guidance routes", () => {
  it("generates tenant-scoped portal guidance with validated response shape", async () => {
    const request = new Request("http://localhost/api/v1/ai/guidance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(overviewRequest),
    });
    const response = await handleV1Request(request, env, new URL(request.url), "tenant-ai-test");

    expect(response.status).toBe(200);
    const body = await response.json<AiGuidanceResponse>();
    expect(body.model).toBe("o11yfleet-guidance-fixture");
    expect(body.summary).toContain("portal.overview");
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]?.target_key).toBe("overview.fleet-health");
  });

  it("can derive deterministic guidance from browser page context metrics", async () => {
    const response = await generateAiGuidance(
      {
        surface: "portal.overview",
        targets: overviewRequest.targets,
        context: {},
        page_context: overviewRequest.page_context,
      },
      {
        env: {},
        scopeLabel: "tenant:tenant-ai-test",
      },
    );

    expect(response.items.length).toBeGreaterThan(0);
    expect(response.items[0]?.headline).toContain("offline");
    expect(response.items[0]?.evidence.some((item) => item.value === "10")).toBe(true);
  });

  it("prefers browser page context over generic context for deterministic guidance", async () => {
    const response = await generateAiGuidance(
      {
        surface: "portal.overview",
        targets: overviewRequest.targets,
        context: {
          total_agents: 100,
          connected_agents: 100,
          healthy_agents: 100,
          configs_count: 1,
        },
        page_context: overviewRequest.page_context,
      },
      {
        env: {},
        scopeLabel: "tenant:tenant-ai-test",
      },
    );

    expect(response.items[0]?.headline).toContain("offline");
    expect(response.items[0]?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Total collectors", value: "10" }),
        expect.objectContaining({ label: "Connected collectors", value: "4" }),
      ]),
    );
  });

  it("rejects admin surfaces on the tenant route", async () => {
    const request = new Request("http://localhost/api/v1/ai/guidance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...overviewRequest,
        surface: "admin.overview",
        targets: [
          {
            key: "admin.page",
            label: "Admin page",
            surface: "admin.overview",
            kind: "page",
          },
        ],
      }),
    });
    const response = await handleV1Request(request, env, new URL(request.url), "tenant-ai-test");

    expect(response.status).toBe(400);
  });

  it("generates admin guidance only on admin route", async () => {
    const response = await exports.default.fetch("http://localhost/api/admin/ai/guidance", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        surface: "admin.overview",
        targets: [
          {
            key: "admin.page",
            label: "Admin overview",
            surface: "admin.overview",
            kind: "page",
          },
        ],
        context: {
          total_tenants: 3,
          total_configurations: 0,
        },
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json<AiGuidanceResponse>();
    expect(body.items.some((item) => item.headline.includes("Tenants"))).toBe(true);
  });

  it("rejects invalid guidance payload shape on admin route", async () => {
    const response = await exports.default.fetch("http://localhost/api/admin/ai/guidance", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        surface: "admin.overview",
        targets: [
          {
            key: "admin.page",
            label: "Admin overview",
            surface: "portal.overview",
            kind: "page",
          },
        ],
        context: {
          total_tenants: 1,
        },
      }),
    });

    expect(response.status).toBe(400);
  });

  it("blocks unauthenticated admin guidance requests", async () => {
    const response = await exports.default.fetch("http://localhost/api/admin/ai/guidance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        surface: "admin.overview",
        targets: [
          {
            key: "admin.page",
            label: "Admin overview",
            surface: "admin.overview",
            kind: "page",
          },
        ],
      }),
    });

    expect(response.status).toBe(403);
  });

  it("returns a provider error when SDK mode is configured without an API key", async () => {
    const request = new Request("http://localhost/api/v1/ai/guidance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(overviewRequest),
    });
    const llmEnv = { ...env, LLM_PROVIDER: "minimax", MINIMAX_API_KEY: undefined };
    const response = await handleV1Request(request, llmEnv, new URL(request.url), "tenant-ai-test");

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "MINIMAX_API_KEY is required when LLM_PROVIDER uses the SDK",
    });
  });

  it("uses the AI SDK OpenAI-compatible provider when MiniMax is configured", async () => {
    const calls: Request[] = [];
    const fakeFetch: typeof fetch = vi.fn(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push(request);
      return Response.json({
        id: "chatcmpl-guidance-test",
        object: "chat.completion",
        created: 0,
        model: "MiniMax-M2.7",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({
                summary: "The fleet has a connectivity gap.",
                items: [
                  {
                    target_key: "overview.fleet-health",
                    headline: "Collector connectivity needs attention",
                    detail: "Three collectors are not connected based on the supplied counts.",
                    severity: "warning",
                    confidence: 0.82,
                    evidence: [{ label: "Connected collectors", value: "7" }],
                    action: {
                      kind: "open_page",
                      label: "Review agents",
                      href: "/portal/agents",
                    },
                  },
                ],
              }),
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      });
    });

    const response = await generateAiGuidance(overviewRequest, {
      env: {
        LLM_PROVIDER: "minimax",
        LLM_MODEL: "MiniMax-M2.7",
        LLM_BASE_URL: "https://api.minimax.test/v1",
        MINIMAX_API_KEY: "test-key",
      },
      scopeLabel: "tenant:tenant-ai-test",
      fetch: fakeFetch,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.minimax.test/v1/chat/completions");
    expect(calls[0]?.headers.get("Authorization")).toBe("Bearer test-key");
    expect(response.model).toBe("MiniMax-M2.7");
    expect(response.summary).toContain("connectivity");
    expect(response.items[0]?.action?.kind).toBe("open_page");
  });

  it("sanitizes model-generated guidance actions to app-relative links", async () => {
    const fakeFetch: typeof fetch = vi.fn(async (input, init) => {
      void new Request(input, init);
      return Response.json({
        id: "chatcmpl-guidance-test",
        object: "chat.completion",
        created: 0,
        model: "MiniMax-M2.7",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({
                summary: "External links should be stripped from actions.",
                items: [
                  {
                    target_key: "overview.page",
                    headline: "External runbook suggested",
                    detail: "The provider suggested a link outside the app.",
                    severity: "notice",
                    confidence: 0.5,
                    evidence: [],
                    action: {
                      kind: "open_page",
                      label: "Open runbook",
                      href: "//example.com/runbook",
                    },
                  },
                ],
              }),
            },
          },
        ],
      });
    });

    const response = await generateAiGuidance(overviewRequest, {
      env: {
        LLM_PROVIDER: "minimax",
        LLM_MODEL: "MiniMax-M2.7",
        LLM_BASE_URL: "https://api.minimax.test/v1",
        MINIMAX_API_KEY: "test-key",
      },
      scopeLabel: "tenant:tenant-ai-test",
      fetch: fakeFetch,
    });

    expect(response.items[0]?.action).toEqual({
      kind: "none",
      label: "Open runbook",
    });
  });

  it("keeps candidate insights and no-insight constraints in model prompts", async () => {
    const calls: Request[] = [];
    const fakeFetch: typeof fetch = vi.fn(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push(request);
      return Response.json({
        id: "chatcmpl-guidance-test",
        object: "chat.completion",
        created: 0,
        model: "MiniMax-M2.7",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({
                summary: "No non-obvious guidance in supplied context.",
                items: [],
              }),
            },
          },
        ],
      });
    });

    const response = await generateAiGuidance(overviewRequest, {
      env: {
        LLM_PROVIDER: "minimax",
        LLM_MODEL: "MiniMax-M2.7",
        LLM_BASE_URL: "https://api.minimax.test/v1",
        MINIMAX_API_KEY: "test-key",
      },
      scopeLabel: "tenant:tenant-ai-test",
      fetch: fakeFetch,
    });

    expect(response.items).toEqual([]);
    expect(calls).toHaveLength(1);
    const requestBody = (await calls[0]!.json()) as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const prompt = requestBody.messages?.find((message) => message.role === "user")?.content ?? "";
    expect(prompt).toContain('"candidate_insights"');
    expect(prompt).toContain(
      "If there is no non-obvious useful insight, return an empty items array.",
    );
    expect(prompt).toContain("Use only target_key values from the supplied targets.");
  });

  it("rejects model output that targets slots outside the request", async () => {
    const fakeFetch: typeof fetch = vi.fn(async () =>
      Response.json({
        id: "chatcmpl-guidance-test",
        object: "chat.completion",
        created: 0,
        model: "MiniMax-M2.7",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({
                summary: "Model suggested an invalid target.",
                items: [
                  {
                    target_key: "overview.unknown-target",
                    headline: "Invalid target",
                    detail: "This item should not be placed in the UI.",
                    severity: "notice",
                    confidence: 0.5,
                    evidence: [],
                  },
                ],
              }),
            },
          },
        ],
      }),
    );

    await expect(
      generateAiGuidance(overviewRequest, {
        env: {
          LLM_PROVIDER: "minimax",
          LLM_MODEL: "MiniMax-M2.7",
          LLM_BASE_URL: "https://api.minimax.test/v1",
          MINIMAX_API_KEY: "test-key",
        },
        scopeLabel: "tenant:tenant-ai-test",
        fetch: fakeFetch,
      }),
    ).rejects.toMatchObject({
      name: "AiProviderError",
      message: "AI guidance provider returned unknown target: overview.unknown-target",
    });
  });

  it("does not emit portal-only actions for admin deterministic guidance", async () => {
    const response = await generateAiGuidance(
      {
        surface: "admin.overview",
        targets: [
          {
            key: "admin.overview.page",
            label: "Admin overview",
            surface: "admin.overview",
            kind: "page",
          },
          {
            key: "admin.overview.metric",
            label: "Fleet metric",
            surface: "admin.overview",
            kind: "metric",
          },
        ],
        context: {
          total_agents: 10,
          connected_agents: 4,
          healthy_agents: 3,
        },
      },
      {
        env: {},
        scopeLabel: "admin",
      },
    );

    expect(response.items.length).toBeGreaterThan(0);
    expect(response.items.every((item) => item.action?.kind !== "open_page")).toBe(true);
  });

  it("does not turn moderate raw count gaps into deterministic guidance", async () => {
    const response = await generateAiGuidance(
      {
        surface: "portal.overview",
        targets: overviewRequest.targets,
        context: {
          total_agents: 10,
          connected_agents: 8,
          healthy_agents: 8,
          configs_count: 2,
        },
      },
      {
        env: {},
        scopeLabel: "tenant:tenant-ai-test",
      },
    );

    expect(response.items).toEqual([]);
    expect(response.summary).toContain("No non-obvious guidance");
  });

  it("keeps admin deterministic configuration guidance inside admin routes", async () => {
    const response = await generateAiGuidance(
      {
        surface: "admin.overview",
        targets: [
          {
            key: "admin.overview.page",
            label: "Admin overview",
            surface: "admin.overview",
            kind: "page",
          },
        ],
        context: {
          total_tenants: 1,
          total_configurations: 0,
        },
      },
      {
        env: {},
        scopeLabel: "admin",
      },
    );

    const hrefs = response.items
      .map((item) => (item.action && "href" in item.action ? item.action.href : undefined))
      .filter(Boolean);
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((href) => href?.startsWith("/admin/"))).toBe(true);
  });
});
