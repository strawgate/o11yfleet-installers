import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

const API_URL = process.env.FP_URL ?? "http://127.0.0.1:8787";
const UI_URL = process.env.UI_URL ?? "http://127.0.0.1:3000";

async function mockJson(page: Page, path: string, body: unknown) {
  await page.route(`${API_URL}${path}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function mockText(page: Page, path: string, body: string) {
  await page.route(`${API_URL}${path}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/plain",
      body,
    });
  });
}

function collectRuntimeErrors(page: Page): { errors: string[]; dispose: () => void } {
  const errors: string[] = [];
  const pageErrorHandler = (error: Error) => errors.push(error.message);
  const consoleHandler = (message: ConsoleMessage) => {
    const text = message.text();
    if (message.type() === "error" && !text.startsWith("Failed to load resource:")) {
      errors.push(text);
    }
  };
  page.on("pageerror", pageErrorHandler);
  page.on("console", consoleHandler);
  return {
    errors,
    dispose: () => {
      page.off("pageerror", pageErrorHandler);
      page.off("console", consoleHandler);
    },
  };
}

function expectUniqueTargetKeys(requestBody: unknown) {
  expect(requestBody).toMatchObject({ targets: expect.any(Array) });
  const targets = (requestBody as { targets: Array<{ key: string }> }).targets;
  expect(new Set(targets.map((target) => target.key)).size).toBe(targets.length);
}

test.describe("AI guidance surfaces", () => {
  test("portal overview renders guidance from wrapped API payloads", async ({ page }) => {
    const runtime = collectRuntimeErrors(page);

    await mockJson(page, "/auth/me", {
      user: {
        userId: "user-1",
        email: "demo@o11yfleet.com",
        displayName: "Demo User",
        role: "member",
        tenantId: "tenant-1",
      },
    });
    await mockJson(page, "/api/v1/tenant", { id: "tenant-1", name: "Demo Org", plan: "pro" });
    await mockJson(page, "/api/v1/overview", {
      tenant: { id: "tenant-1", name: "Demo Org" },
      total_agents: 10,
      connected_agents: 7,
      healthy_agents: 6,
      configs_count: 1,
      configurations: [
        {
          id: "config-1",
          name: "prod-collectors",
          status: "active",
          updated_at: "2026-04-28T20:00:00.000Z",
        },
      ],
    });
    await mockJson(page, "/api/v1/configurations", {
      configurations: [
        {
          id: "config-1",
          name: "prod-collectors",
          status: "active",
          updated_at: "2026-04-28T20:00:00.000Z",
        },
      ],
    });
    await page.route(`${API_URL}/api/v1/ai/guidance`, async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        surface: "portal.overview",
      });
      expectUniqueTargetKeys(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: "Portal guidance from test data.",
          generated_at: "2026-04-28T20:00:00.000Z",
          model: "o11yfleet-guidance-fixture",
          items: [
            {
              target_key: "overview.agents",
              headline: "3 collectors offline",
              detail: "Three enrolled collectors are missing from the connected set.",
              severity: "warning",
              confidence: 0.82,
              evidence: [{ label: "Connected collectors", value: "7" }],
            },
          ],
        }),
      });
    });

    await page.goto(`${UI_URL}/portal/overview?api=${encodeURIComponent(API_URL)}`);

    await expect(page.getByRole("heading", { name: "Fleet overview" })).toBeVisible();
    await expect(page.getByText("prod-collectors")).toBeVisible();
    await expect(page.getByText("Portal guidance from test data.")).toBeVisible();
    await expect(page.locator(".ai-panel").getByText("3 collectors offline")).toBeVisible();
    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });

  test("admin overview renders guidance from wrapped tenant payloads", async ({ page }) => {
    const runtime = collectRuntimeErrors(page);

    await mockJson(page, "/auth/me", {
      user: {
        userId: "admin-1",
        email: "admin@o11yfleet.com",
        displayName: "Admin",
        role: "admin",
        tenantId: null,
      },
    });
    await mockJson(page, "/api/admin/overview", {
      total_tenants: 1,
      total_configurations: 1,
      total_agents: 12,
      total_active_tokens: 1,
      total_users: 2,
    });
    await mockJson(page, "/api/admin/health", {
      status: "healthy",
      checks: {
        worker: { status: "healthy" },
        d1: { status: "healthy", latency_ms: 2 },
        r2: { status: "healthy", latency_ms: 3 },
        durable_objects: { status: "healthy" },
        queue: { status: "healthy" },
      },
      timestamp: "2026-04-28T20:00:00.000Z",
    });
    await mockJson(page, "/api/admin/tenants", {
      tenants: [
        {
          id: "tenant-1",
          name: "Demo Org",
          plan: "pro",
          max_configs: 50,
          max_agents_per_config: 100000,
          config_count: 1,
          user_count: 2,
          created_at: "2026-04-28T20:00:00.000Z",
        },
      ],
    });
    await page.route(`${API_URL}/api/admin/ai/guidance`, async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        surface: "admin.overview",
      });
      expectUniqueTargetKeys(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: "Admin guidance from test data.",
          generated_at: "2026-04-28T20:00:00.000Z",
          model: "o11yfleet-guidance-fixture",
          items: [
            {
              target_key: "admin.overview.agents",
              headline: "Review collector growth",
              detail: "The admin overview is carrying double-digit collectors.",
              severity: "notice",
              confidence: 0.7,
              evidence: [{ label: "Total agents", value: "12" }],
            },
          ],
        }),
      });
    });

    await page.goto(`${UI_URL}/admin/overview?api=${encodeURIComponent(API_URL)}`);

    await expect(page.getByRole("heading", { name: "Admin Overview" })).toBeVisible();
    await expect(page.getByText("Demo Org")).toBeVisible();
    await expect(page.getByText("Admin guidance from test data.")).toBeVisible();
    await expect(page.locator(".ai-panel").getByText("Review collector growth")).toBeVisible();
    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });

  test("admin overview hides empty guidance instead of rendering placeholder noise", async ({
    page,
  }) => {
    const runtime = collectRuntimeErrors(page);

    await mockJson(page, "/auth/me", {
      user: {
        userId: "admin-1",
        email: "admin@o11yfleet.com",
        displayName: "Admin",
        role: "admin",
        tenantId: null,
      },
    });
    await mockJson(page, "/api/admin/overview", {
      total_tenants: 1,
      total_configurations: 0,
      total_agents: 0,
      total_active_tokens: 0,
      total_users: 1,
    });
    await mockJson(page, "/api/admin/health", {
      status: "healthy",
      checks: { worker: { status: "healthy" } },
      timestamp: "2026-04-28T20:00:00.000Z",
    });
    await mockJson(page, "/api/admin/tenants", { tenants: [] });
    let guidanceResponses = 0;
    const guidanceRequestCounts = new Map<string, number>();
    await page.route(`${API_URL}/api/admin/ai/guidance`, async (route) => {
      const requestBody = route.request().postDataJSON();
      expectUniqueTargetKeys(requestBody);
      const requestKey = JSON.stringify(requestBody);
      guidanceRequestCounts.set(requestKey, (guidanceRequestCounts.get(requestKey) ?? 0) + 1);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: "No non-obvious guidance found in the provided admin.overview context.",
          generated_at: "2026-04-28T20:00:00.000Z",
          model: "o11yfleet-guidance-fixture",
          items: [],
        }),
      });
      guidanceResponses += 1;
    });

    await page.goto(`${UI_URL}/admin/overview?api=${encodeURIComponent(API_URL)}`);

    await expect(page.getByRole("heading", { name: "Admin Overview" })).toBeVisible();
    await expect.poll(() => guidanceResponses).toBeGreaterThanOrEqual(1);
    expect([...guidanceRequestCounts.values()].every((count) => count === 1)).toBe(true);
    await expect(page.locator(".ai-panel")).toHaveCount(0);
    await expect(page.getByText("No targeted guidance")).toHaveCount(0);
    await expect(page.getByText("No non-obvious guidance")).toHaveCount(0);
    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });

  test("portal overview hides empty guidance instead of rendering placeholder noise", async ({
    page,
  }) => {
    const runtime = collectRuntimeErrors(page);

    await mockJson(page, "/auth/me", {
      user: {
        userId: "user-1",
        email: "demo@o11yfleet.com",
        displayName: "Demo User",
        role: "member",
        tenantId: "tenant-1",
      },
    });
    await mockJson(page, "/api/v1/tenant", { id: "tenant-1", name: "Demo Org", plan: "pro" });
    await mockJson(page, "/api/v1/overview", {
      tenant: { id: "tenant-1", name: "Demo Org" },
      total_agents: 0,
      connected_agents: 0,
      healthy_agents: 0,
      configs_count: 1,
      configurations: [
        {
          id: "config-1",
          name: "prod-collectors",
          status: "active",
          updated_at: "2026-04-28T20:00:00.000Z",
        },
      ],
    });
    await mockJson(page, "/api/v1/configurations", {
      configurations: [
        {
          id: "config-1",
          name: "prod-collectors",
          status: "active",
          updated_at: "2026-04-28T20:00:00.000Z",
        },
      ],
    });
    await page.route(`${API_URL}/api/v1/ai/guidance`, async (route) => {
      expectUniqueTargetKeys(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: "No non-obvious guidance found in the provided portal.overview context.",
          generated_at: "2026-04-28T20:00:00.000Z",
          model: "o11yfleet-guidance-fixture",
          items: [],
        }),
      });
    });

    await page.goto(`${UI_URL}/portal/overview?api=${encodeURIComponent(API_URL)}`);

    await expect(page.getByRole("heading", { name: "Fleet overview" })).toBeVisible();
    await expect(page.getByText("prod-collectors")).toBeVisible();
    await expect(page.locator(".ai-panel")).toHaveCount(0);
    await expect(page.getByText("No targeted guidance")).toHaveCount(0);
    await expect(page.getByText("No non-obvious guidance")).toHaveCount(0);
    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });

  test("portal overview suppresses unavailable guidance when the backend route is missing", async ({
    page,
  }) => {
    const runtime = collectRuntimeErrors(page);
    let guidanceRequests = 0;

    await mockJson(page, "/auth/me", {
      user: {
        userId: "user-1",
        email: "demo@o11yfleet.com",
        displayName: "Demo User",
        role: "member",
        tenantId: "tenant-1",
      },
    });
    await mockJson(page, "/api/v1/tenant", { id: "tenant-1", name: "Demo Org", plan: "pro" });
    await mockJson(page, "/api/v1/overview", {
      tenant: { id: "tenant-1", name: "Demo Org" },
      total_agents: 2,
      connected_agents: 2,
      healthy_agents: 2,
      configs_count: 1,
      configurations: [
        {
          id: "config-1",
          name: "prod-collectors",
          status: "active",
          updated_at: "2026-04-28T20:00:00.000Z",
        },
      ],
    });
    await mockJson(page, "/api/v1/configurations", {
      configurations: [
        {
          id: "config-1",
          name: "prod-collectors",
          status: "active",
          updated_at: "2026-04-28T20:00:00.000Z",
        },
      ],
    });
    await page.route(`${API_URL}/api/v1/ai/guidance`, async (route) => {
      guidanceRequests += 1;
      await route.fulfill({
        status: 404,
        contentType: "text/plain",
        body: "Not Found",
      });
    });

    await page.goto(`${UI_URL}/portal/overview?api=${encodeURIComponent(API_URL)}`);

    await expect(page.getByRole("heading", { name: "Fleet overview" })).toBeVisible();
    await expect(page.getByText("prod-collectors")).toBeVisible();
    await expect.poll(() => guidanceRequests).toBe(1);
    await expect(page.locator(".ai-panel")).toHaveCount(0);
    await expect(page.getByText("Guidance unavailable")).toHaveCount(0);
    await expect(page.getByText("Not Found")).toHaveCount(0);
    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });

  test("command palette opens streaming page copilot and navigation still works", async ({
    page,
  }) => {
    const runtime = collectRuntimeErrors(page);
    const chatRequests: unknown[] = [];

    await mockJson(page, "/auth/me", {
      user: {
        userId: "user-1",
        email: "demo@o11yfleet.com",
        displayName: "Demo User",
        role: "member",
        tenantId: "tenant-1",
      },
    });
    await mockJson(page, "/api/v1/tenant", { id: "tenant-1", name: "Demo Org", plan: "pro" });
    await mockJson(page, "/api/v1/overview", {
      tenant: { id: "tenant-1", name: "Demo Org" },
      total_agents: 2,
      connected_agents: 2,
      healthy_agents: 2,
      configs_count: 0,
      configurations: [],
    });
    await mockJson(page, "/api/v1/configurations", { configurations: [] });
    await page.route(`${API_URL}/api/v1/ai/guidance`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: "No page guidance.",
          generated_at: "2026-04-28T20:00:00.000Z",
          model: "o11yfleet-guidance-fixture",
          items: [],
        }),
      });
    });
    await page.route(`${API_URL}/api/v1/ai/chat`, async (route) => {
      chatRequests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          'data: {"type":"start"}',
          "",
          'data: {"type":"text-start","id":"t1"}',
          "",
          'data: {"type":"text-delta","id":"t1","delta":"Copilot response from visible page context."}',
          "",
          'data: {"type":"text-end","id":"t1"}',
          "",
          'data: {"type":"finish","finishReason":"stop"}',
          "",
          "data: [DONE]",
          "",
        ].join("\n"),
      });
    });

    await page.goto(`${UI_URL}/portal/overview?api=${encodeURIComponent(API_URL)}`);
    await page.getByRole("button", { name: "Open command menu" }).click();
    await expect(page.getByRole("dialog", { name: "Command menu" })).toBeVisible();

    await page.getByRole("option", { name: /Ask AI about this page/ }).click();
    await expect.poll(() => chatRequests.length).toBe(1);
    expect(chatRequests[0]).toMatchObject({
      context: { surface: "portal.overview", intent: "explain_page" },
    });
    await expect(page.getByText("No non-obvious guidance found")).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Page copilot" })).toBeVisible();
    await expect(page.getByText("Copilot response from visible page context.")).toBeVisible();

    await page.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Open command menu" }).click();
    await page.getByRole("option", { name: /Ask AI about this page/ }).click();
    await expect.poll(() => chatRequests.length).toBe(2);
    expect(chatRequests[1]).toMatchObject({
      context: { surface: "portal.overview", intent: "explain_page" },
    });
    await page.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: "Open command menu" }).click();
    await page.getByRole("combobox", { name: "Search collectors, configs, pages..." }).fill("age");
    await page.getByRole("option", { name: /Agents Workspace/ }).click();
    await expect(page).toHaveURL(/\/portal\/agents/);
    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });

  test("mobile portal shell keeps controls anchored and search opens commands", async ({
    page,
  }) => {
    const runtime = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 700, height: 820 });

    await mockJson(page, "/auth/me", {
      user: {
        userId: "user-1",
        email: "demo@o11yfleet.com",
        displayName: "Demo User",
        role: "member",
        tenantId: "tenant-1",
      },
    });
    await mockJson(page, "/api/v1/tenant", { id: "tenant-1", name: "Demo Org", plan: "pro" });
    await mockJson(page, "/api/v1/overview", {
      tenant: { id: "tenant-1", name: "Demo Org" },
      total_agents: 0,
      connected_agents: 0,
      healthy_agents: 0,
      configs_count: 0,
      configurations: [],
    });
    await mockJson(page, "/api/v1/configurations", { configurations: [] });
    await page.route(`${API_URL}/api/v1/ai/guidance`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: "No guidance.",
          generated_at: "2026-04-28T20:00:00.000Z",
          model: "o11yfleet-guidance-fixture",
          items: [],
        }),
      });
    });

    await page.goto(`${UI_URL}/portal/overview?api=${encodeURIComponent(API_URL)}`);

    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open command menu" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Docs" })).toBeVisible();
    await expect(page.locator(".topbar-right")).toBeVisible();
    await expect(page.locator(".sidebar.open")).toHaveCount(0);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.locator(".sidebar.open")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Agents" })).toBeVisible();
    await page.locator(".sidebar-backdrop").click();
    await page.getByRole("button", { name: "Open command menu" }).click();
    await expect(page.getByRole("dialog", { name: "Command menu" })).toBeVisible();
    await page
      .getByRole("combobox", { name: "Search collectors, configs, pages..." })
      .fill("agent");
    await page.getByRole("option", { name: /Agents Workspace/ }).click();
    await expect(page).toHaveURL(/\/portal\/agents/);
    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });

  test("getting started shows wrapped commands and install script contents", async ({ page }) => {
    const runtime = collectRuntimeErrors(page);
    const token = "fp_enroll_test_token_with_a_really_long_value_for_wrapping_1234567890";

    await mockJson(page, "/auth/me", {
      user: {
        userId: "user-1",
        email: "demo@o11yfleet.com",
        displayName: "Demo User",
        role: "member",
        tenantId: "tenant-1",
      },
    });
    await mockJson(page, "/api/v1/tenant", { id: "tenant-1", name: "Demo Org", plan: "pro" });
    await mockJson(page, "/api/v1/configurations", {
      configurations: [
        {
          id: "config-1",
          name: "prod-collectors",
          status: "active",
          updated_at: "2026-04-28T20:00:00.000Z",
        },
      ],
    });
    await page.route(
      `${API_URL}/api/v1/configurations/config-1/enrollment-token`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: "token-1", token }),
        });
      },
    );

    await page.goto(`${UI_URL}/portal/getting-started?api=${encodeURIComponent(API_URL)}`);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Generate token" }).click();

    await expect(page.locator(".token-value")).toHaveText(token);
    await expect(page.locator(".token-value")).toHaveCSS("overflow-wrap", "anywhere");
    await expect(page.getByText("bash -s -- --token")).toBeVisible();
    await expect(page.locator(".code-block-wrap").first()).toHaveCSS("white-space", "pre-wrap");
    await page.getByRole("button", { name: "Download script" }).click();
    await expect(page.getByText("./install.sh --token")).toBeVisible();
    await page.getByRole("button", { name: "install.sh" }).click();
    await expect(page.getByText("#!/usr/bin/env bash")).toBeVisible();
    await expect(page.getByText("O11yFleet Collector Installer")).toBeVisible();
    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });

  test("configuration detail sends unique guidance target keys for the active tab", async ({
    page,
  }) => {
    const runtime = collectRuntimeErrors(page);

    await mockJson(page, "/auth/me", {
      user: {
        userId: "user-1",
        email: "demo@o11yfleet.com",
        displayName: "Demo User",
        role: "member",
        tenantId: "tenant-1",
      },
    });
    await mockJson(page, "/api/v1/tenant", { id: "tenant-1", name: "Demo Org", plan: "pro" });
    await mockJson(page, "/api/v1/configurations/config-1", {
      id: "config-1",
      name: "prod-collectors",
      status: "active",
      updated_at: "2026-04-28T20:00:00.000Z",
    });
    await mockText(page, "/api/v1/configurations/config-1/yaml", "receivers: {}\n");
    await mockJson(page, "/api/v1/configurations/config-1/agents", {
      agents: [
        {
          id: "agent-1",
          hostname: "collector-1",
          status: "connected",
          last_seen: "2026-04-28T20:00:00.000Z",
        },
      ],
    });
    await mockJson(page, "/api/v1/configurations/config-1/versions", {
      versions: [{ id: "version-1", version: 1, created_at: "2026-04-28T20:00:00.000Z" }],
    });
    await mockJson(page, "/api/v1/configurations/config-1/enrollment-tokens", { tokens: [] });
    await mockJson(page, "/api/v1/configurations/config-1/stats", { agents_connected: 1 });
    await page.route(`${API_URL}/api/v1/ai/guidance`, async (route) => {
      const requestBody = route.request().postDataJSON();
      expect(requestBody).toMatchObject({
        surface: "portal.configuration",
      });
      expectUniqueTargetKeys(requestBody);
      expect((requestBody as { targets: Array<{ key: string }> }).targets).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: "configuration.tab.agents" })]),
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: "Configuration guidance from test data.",
          generated_at: "2026-04-28T20:00:00.000Z",
          model: "o11yfleet-guidance-fixture",
          items: [
            {
              target_key: "configuration.agents",
              headline: "Collector count is stable",
              detail: "The active tab request uses a distinct tab target key.",
              severity: "notice",
              confidence: 0.8,
              evidence: [{ label: "Connected collectors", value: "1" }],
            },
          ],
        }),
      });
    });

    await page.goto(`${UI_URL}/portal/configurations/config-1?api=${encodeURIComponent(API_URL)}`);

    await expect(page.getByRole("heading", { name: "prod-collectors" })).toBeVisible();
    await expect(page.getByText("Configuration guidance from test data.")).toBeVisible();
    await expect(page.locator(".ai-panel").getByText("Collector count is stable")).toBeVisible();
    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });

  test("configuration detail sends YAML only for explicit copilot actions", async ({ page }) => {
    const runtime = collectRuntimeErrors(page);
    let explainRequestSeen = false;
    let versionDiffRequestSeen = false;

    await mockJson(page, "/auth/me", {
      user: {
        userId: "user-1",
        email: "demo@o11yfleet.com",
        displayName: "Demo User",
        role: "member",
        tenantId: "tenant-1",
      },
    });
    await mockJson(page, "/api/v1/tenant", { id: "tenant-1", name: "Demo Org", plan: "pro" });
    await mockJson(page, "/api/v1/configurations/config-1", {
      id: "config-1",
      name: "prod-collectors",
      status: "active",
      current_config_hash: "cfg-current",
      updated_at: "2026-04-28T20:00:00.000Z",
    });
    await mockText(
      page,
      "/api/v1/configurations/config-1/yaml",
      "receivers:\n  otlp: {}\nexporters:\n  debug: {}\nservice:\n  pipelines:\n    logs:\n      receivers: [otlp]\n      exporters: [debug]\n",
    );
    await mockJson(page, "/api/v1/configurations/config-1/agents", { agents: [] });
    await mockJson(page, "/api/v1/configurations/config-1/versions", {
      versions: [
        { id: "version-2", version: 2, created_at: "2026-04-28T21:00:00.000Z" },
        { id: "version-1", version: 1, created_at: "2026-04-28T20:00:00.000Z" },
      ],
    });
    await mockJson(page, "/api/v1/configurations/config-1/version-diff-latest-previous", {
      available: true,
      latest: {
        id: "version-2",
        config_hash: "cfg-current",
        size_bytes: 180,
        created_at: "2026-04-28T21:00:00.000Z",
      },
      previous: {
        id: "version-1",
        config_hash: "cfg-previous",
        size_bytes: 120,
        created_at: "2026-04-28T20:00:00.000Z",
      },
      diff: {
        previous_line_count: 8,
        latest_line_count: 11,
        line_count_delta: 3,
        size_bytes_delta: 60,
        added_lines: 3,
        removed_lines: 0,
      },
    });
    await mockJson(page, "/api/v1/configurations/config-1/enrollment-tokens", { tokens: [] });
    await mockJson(page, "/api/v1/configurations/config-1/stats", { agents_connected: 0 });
    await page.route(`${API_URL}/api/v1/ai/guidance`, async (route) => {
      const requestBody = route.request().postDataJSON() as {
        intent?: string;
        page_context?: {
          yaml?: { content?: string };
          light_fetches?: Array<{ key: string }>;
          tables?: Array<{ key: string }>;
        };
        targets?: Array<{ key: string }>;
      };
      expectUniqueTargetKeys(requestBody);
      if (requestBody.intent === "explain_page") {
        explainRequestSeen = true;
        expect(requestBody.page_context?.yaml?.content).toContain("receivers:");
        expect(requestBody.targets).toEqual(
          expect.arrayContaining([expect.objectContaining({ key: "configuration.yaml" })]),
        );
        expect(requestBody.targets?.map((target) => target.key)).not.toContain(
          "configuration.versions",
        );
        expect(requestBody.targets?.map((target) => target.key)).not.toContain(
          "configuration.rollout",
        );
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            summary: "Parser-backed YAML explanation.",
            generated_at: "2026-04-28T20:00:00.000Z",
            model: "o11yfleet-guidance-fixture",
            items: [
              {
                target_key: "configuration.yaml",
                headline: "YAML defines one logs pipeline",
                detail: "The explicit copilot request included YAML context.",
                severity: "notice",
                confidence: 0.8,
                evidence: [{ label: "Signals", value: "logs" }],
              },
            ],
          }),
        });
        return;
      }
      if (requestBody.intent === "summarize_table") {
        versionDiffRequestSeen = true;
        expect(requestBody.page_context?.yaml).toBeUndefined();
        expect(requestBody.page_context?.tables?.map((table) => table.key)).toEqual(["versions"]);
        expect(requestBody.page_context?.light_fetches).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ key: "configuration.version_diff_latest_previous" }),
          ]),
        );
        expect(requestBody.targets).toEqual(
          expect.arrayContaining([expect.objectContaining({ key: "configuration.versions" })]),
        );
        expect(requestBody.targets?.map((target) => target.key)).not.toContain(
          "configuration.yaml",
        );
        expect(requestBody.targets?.map((target) => target.key)).not.toContain(
          "configuration.rollout",
        );
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            summary: "Version diff summary.",
            generated_at: "2026-04-28T20:00:00.000Z",
            model: "o11yfleet-guidance-fixture",
            items: [
              {
                target_key: "configuration.versions",
                headline: "Latest version added three lines",
                detail: "The explicit copilot request used compact diff metadata.",
                severity: "notice",
                confidence: 0.8,
                evidence: [{ label: "Added lines", value: "3" }],
              },
            ],
          }),
        });
        return;
      }
      expect(requestBody.page_context?.yaml).toBeUndefined();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: "No ambient YAML guidance.",
          generated_at: "2026-04-28T20:00:00.000Z",
          model: "o11yfleet-guidance-fixture",
          items: [],
        }),
      });
    });

    await page.goto(`${UI_URL}/portal/configurations/config-1?api=${encodeURIComponent(API_URL)}`);
    await page.getByRole("button", { name: "YAML" }).click();
    await page.getByRole("button", { name: "Explain YAML" }).click();

    await expect.poll(() => explainRequestSeen).toBe(true);
    await expect(page.getByText("Parser-backed YAML explanation.")).toBeVisible();
    await expect(page.getByText("YAML defines one logs pipeline")).toBeVisible();
    await page.getByRole("button", { name: "Versions" }).click();
    await page.getByRole("button", { name: "Summarize latest diff" }).click();

    await expect.poll(() => versionDiffRequestSeen).toBe(true);
    await expect(page.getByText("Version diff summary.")).toBeVisible();
    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });

  test("configuration detail empty agents state can create enrollment command", async ({
    page,
  }) => {
    const runtime = collectRuntimeErrors(page);
    const token = "fp_enroll_config_detail_token_for_empty_agents";

    await mockJson(page, "/auth/me", {
      user: {
        userId: "user-1",
        email: "demo@o11yfleet.com",
        displayName: "Demo User",
        role: "member",
        tenantId: "tenant-1",
      },
    });
    await mockJson(page, "/api/v1/tenant", { id: "tenant-1", name: "Demo Org", plan: "pro" });
    await mockJson(page, "/api/v1/configurations/config-1", {
      id: "config-1",
      name: "prod-collectors",
      status: "active",
      updated_at: "2026-04-28T20:00:00.000Z",
    });
    await mockText(page, "/api/v1/configurations/config-1/yaml", "receivers: {}\n");
    await mockJson(page, "/api/v1/configurations/config-1/agents", { agents: [] });
    await mockJson(page, "/api/v1/configurations/config-1/versions", { versions: [] });
    await mockJson(page, "/api/v1/configurations/config-1/enrollment-tokens", { tokens: [] });
    await mockJson(page, "/api/v1/configurations/config-1/stats", { agents_connected: 0 });
    await page.route(`${API_URL}/api/v1/ai/guidance`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: "No guidance.",
          generated_at: "2026-04-28T20:00:00.000Z",
          model: "o11yfleet-guidance-fixture",
          items: [],
        }),
      });
    });
    await page.route(
      `${API_URL}/api/v1/configurations/config-1/enrollment-token`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: "token-1", token }),
        });
      },
    );

    await page.goto(`${UI_URL}/portal/configurations/config-1?api=${encodeURIComponent(API_URL)}`);

    await expect(page.getByText("No agents connected")).toBeVisible();
    await page.getByRole("button", { name: "Enroll agent" }).first().click();
    await expect(page.getByRole("dialog", { name: "Enroll agent" })).toBeVisible();
    await page.getByRole("button", { name: "Create enrollment token" }).click();
    await expect(page.locator(".token-value")).toHaveText(token);
    await expect(page.getByText("bash -s -- --token")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open guided setup" })).toBeVisible();
    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });

  test("admin tenant overview sends unique guidance target keys only while visible", async ({
    page,
  }) => {
    const runtime = collectRuntimeErrors(page);
    const guidanceRequests: unknown[] = [];

    await mockJson(page, "/auth/me", {
      user: {
        userId: "admin-1",
        email: "admin@o11yfleet.com",
        displayName: "Admin",
        role: "admin",
        tenantId: null,
      },
    });
    await mockJson(page, "/api/admin/tenants/tenant-1", {
      id: "tenant-1",
      name: "Demo Org",
      plan: "pro",
      max_configs: 50,
      max_agents_per_config: 100000,
      created_at: "2026-04-28T20:00:00.000Z",
    });
    await mockJson(page, "/api/admin/tenants/tenant-1/configurations", {
      configurations: [
        {
          id: "config-1",
          name: "prod-collectors",
          status: "active",
          agents: 1,
          updated_at: "2026-04-28T20:00:00.000Z",
        },
      ],
    });
    await mockJson(page, "/api/admin/tenants/tenant-1/users", {
      users: [
        {
          id: "user-1",
          email: "demo@o11yfleet.com",
          role: "member",
          created_at: "2026-04-28T20:00:00.000Z",
        },
      ],
    });
    await page.route(`${API_URL}/api/admin/ai/guidance`, async (route) => {
      const requestBody = route.request().postDataJSON();
      guidanceRequests.push(requestBody);
      expect(requestBody).toMatchObject({
        surface: "admin.tenant",
      });
      expectUniqueTargetKeys(requestBody);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: "Tenant guidance from test data.",
          generated_at: "2026-04-28T20:00:00.000Z",
          model: "o11yfleet-guidance-fixture",
          items: [],
        }),
      });
    });

    await page.goto(`${UI_URL}/admin/tenants/tenant-1?api=${encodeURIComponent(API_URL)}`);
    await expect
      .poll(() =>
        guidanceRequests.some((requestBody) =>
          (requestBody as { targets: Array<{ key: string }> }).targets.some(
            (target) => target.key === "admin.tenant.tab.overview",
          ),
        ),
      )
      .toBe(true);

    const requestCount = guidanceRequests.length;
    await page.getByRole("button", { name: "Configurations" }).click();
    await page.waitForTimeout(250);
    expect(guidanceRequests).toHaveLength(requestCount);

    const overviewRequest = guidanceRequests.find((requestBody) =>
      (requestBody as { targets: Array<{ key: string }> }).targets.some(
        (target) => target.key === "admin.tenant.tab.overview",
      ),
    ) as { targets: Array<{ key: string }> } | undefined;
    expect(overviewRequest?.targets).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "admin.tenant.tab.overview" })]),
    );
    await expect(page.getByRole("heading", { name: "Demo Org" })).toBeVisible();
    await expect(page.getByText("prod-collectors")).toBeVisible();
    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });
});
