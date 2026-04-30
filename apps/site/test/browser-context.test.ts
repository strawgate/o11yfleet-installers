import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildBrowserGuidanceRequest,
  compactVisibleText,
  inferAiSurface,
  mergeBrowserContextSources,
} from "../src/ai/browser-context";

test("infers supported AI surfaces from app routes", () => {
  assert.equal(inferAiSurface("/portal/overview"), "portal.overview");
  assert.equal(inferAiSurface("/portal/configurations"), "portal.configuration");
  assert.equal(inferAiSurface("/portal/configurations/cfg_123"), "portal.configuration");
  assert.equal(inferAiSurface("/portal/agents/cfg_123/agent_456"), "portal.agent");
  assert.equal(inferAiSurface("/admin/overview"), "admin.overview");
  assert.equal(inferAiSurface("/admin/tenants"), "admin.tenant");
  assert.equal(inferAiSurface("/admin/tenants/tenant_123"), "admin.tenant");
  assert.equal(inferAiSurface("/admin/usage"), "admin.usage");
  assert.equal(inferAiSurface("/portal/billing"), null);
});

test("builds a guidance request from visible browser context", () => {
  const snapshot = mergeBrowserContextSources(
    "/portal/overview",
    "Overview 3 configurations 2 collectors connected",
    [
      {
        id: "portal.layout",
        title: "Portal overview",
        facts: [{ label: "Workspace", value: "Acme", source: "layout" }],
        context: { tenant_id: "tenant_123" },
      },
    ],
    new Date("2026-04-29T00:00:00.000Z"),
  );
  const request = buildBrowserGuidanceRequest(snapshot, "Explain this page");

  assert.equal(request?.surface, "portal.overview");
  assert.equal(request?.targets[0]?.key, "browser.page");
  assert.equal(request?.context.visible_text, "Overview 3 configurations 2 collectors connected");
  assert.deepEqual(request?.context.facts, [
    { label: "Workspace", value: "Acme", source: "layout" },
  ]);
  assert.equal(request?.context.tenant_id, "tenant_123");
});

test("merges structured page context and approved light fetches into browser guidance", () => {
  const snapshot = mergeBrowserContextSources(
    "/admin/usage",
    "Usage and spend 1 of 2 sources connected",
    [
      {
        id: "admin.usage.page",
        title: "Usage and spend",
        surface: "admin.usage",
        targets: [
          {
            key: "admin.usage.sources",
            label: "Usage source coverage",
            surface: "admin.usage",
            kind: "section",
          },
        ],
        context: { ready_usage_sources: 1 },
        pageContext: {
          metrics: [
            { key: "ready_usage_sources", label: "Ready usage sources", value: 1 },
            { key: "total_usage_sources", label: "Total usage sources", value: 2 },
          ],
        },
      },
    ],
    new Date("2026-04-29T00:00:00.000Z"),
  );
  const request = buildBrowserGuidanceRequest(snapshot, "Explain usage", "explain_page", {
    lightFetches: [
      {
        key: "usage.source.refresh",
        label: "Refresh usage source",
        status: "included",
        data: { ok: true },
      },
    ],
  });

  assert.equal(request?.surface, "admin.usage");
  assert.equal(request?.page_context?.route, "/admin/usage");
  assert.deepEqual(
    request?.page_context?.metrics.map((metric) => metric.key),
    ["ready_usage_sources", "total_usage_sources"],
  );
  assert.equal(request?.page_context?.light_fetches[0]?.key, "usage.source.refresh");
});

test("caps registered light fetches to the browser copilot fetch budget", () => {
  const snapshot = mergeBrowserContextSources("/portal/configurations/cfg_1", "Configuration", [
    {
      id: "configuration.detail",
      lightFetches: Array.from({ length: 4 }, (_, index) => ({
        key: `fetch.${index}`,
        label: `Fetch ${index}`,
        load: async () => ({ index }),
      })),
    },
  ]);

  assert.deepEqual(
    snapshot.lightFetches.map((fetcher) => fetcher.key),
    ["fetch.0", "fetch.1"],
  );
});

test("keeps page context that only contains meaningful UI state", () => {
  const snapshot = mergeBrowserContextSources("/portal/configurations/cfg_1", "", [
    {
      id: "configuration.detail",
      title: "Configuration detail",
      pageContext: {
        active_tab: "versions",
        filters: { state: "drifted" },
        selection: { configuration_id: "cfg_1" },
      },
    },
  ]);

  assert.equal(snapshot.pageContext?.active_tab, "versions");
  assert.deepEqual(snapshot.pageContext?.filters, { state: "drifted" });
  assert.deepEqual(snapshot.pageContext?.selection, { configuration_id: "cfg_1" });
});

test("clamps browser guidance prompts to the API schema limit", () => {
  const snapshot = mergeBrowserContextSources("/portal/overview", "Overview", []);
  const request = buildBrowserGuidanceRequest(snapshot, "x".repeat(1200));

  assert.equal(request?.user_prompt?.length, 1000);
  assert.equal(request?.user_prompt?.endsWith("…"), true);
});

test("keeps canonical route and title authoritative in merged context", () => {
  const snapshot = mergeBrowserContextSources("/portal/overview", "Overview", [
    {
      id: "source",
      title: "Source title",
      context: { route: "/wrong", title: "Wrong title", tenant_id: "tenant_123" },
    },
  ]);

  assert.equal(snapshot.context.route, "/portal/overview");
  assert.equal(snapshot.context.title, "Source title");
  assert.equal(snapshot.context.tenant_id, "tenant_123");
});

test("caps browser guidance targets to the API schema limit", () => {
  const snapshot = mergeBrowserContextSources(
    "/portal/overview",
    "Overview",
    [
      {
        id: "source",
        targets: Array.from({ length: 40 }, (_, index) => ({
          key: `target.${index}`,
          label: `Target ${index}`,
          surface: "portal.overview" as const,
          kind: "section" as const,
        })),
      },
    ],
    new Date("2026-04-29T00:00:00.000Z"),
  );

  assert.equal(snapshot.targets.length, 32);
  assert.equal(snapshot.targets[0]?.key, "browser.page");
});

test("does not build guidance requests for unsupported routes", () => {
  const snapshot = mergeBrowserContextSources("/portal/billing", "Billing", []);

  assert.equal(buildBrowserGuidanceRequest(snapshot, "Explain this page"), null);
});

test("compacts visible text for prompt payloads", () => {
  const compacted = compactVisibleText("A\n\n  B\tC", 20);
  assert.equal(compacted, "A B C");
  assert.equal(compactVisibleText("x".repeat(30), 10), "xxxxxxxxx…");
});
