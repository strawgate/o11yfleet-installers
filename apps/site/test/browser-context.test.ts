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
