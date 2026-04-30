import { expect, test, type ConsoleMessage, type Page, type Route } from "@playwright/test";

const API_URL = process.env.FP_URL ?? "http://127.0.0.1:8787";
const UI_URL = process.env.UI_URL ?? "http://127.0.0.1:3000";

const memberUser = {
  userId: "user-1",
  email: "demo@o11yfleet.com",
  displayName: "Demo User",
  role: "member",
  tenantId: "tenant-1",
  isImpersonation: false,
};

async function mockJson(page: Page, path: string, body: unknown, status = 200) {
  await page.route(`${API_URL}${path}`, async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function mockEmptyGuidance(page: Page) {
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
}

async function mockPortalSession(page: Page) {
  await mockJson(page, "/auth/me", { user: memberUser });
  await mockJson(page, "/api/v1/tenant", { id: "tenant-1", name: "Demo Org", plan: "pro" });
}

async function mockPortalOverview(page: Page) {
  const configuration = {
    id: "config-1",
    name: "prod-collectors",
    status: "active",
    current_config_hash: "abcdef1234567890",
    description: "Production collector group",
    updated_at: "2026-04-28T20:00:00.000Z",
    stats: { connected: 2, total: 4, healthy: 2 },
  };

  await mockJson(page, "/api/v1/overview", {
    tenant: { id: "tenant-1", name: "Demo Org" },
    configs_count: 1,
    total_agents: 4,
    connected_agents: 2,
    healthy_agents: 2,
    active_rollouts: 0,
    configurations: [configuration],
  });
  await mockJson(page, "/api/v1/configurations", { configurations: [configuration] });
  await mockEmptyGuidance(page);
}

async function mockLoginFlow(page: Page) {
  let loggedIn = false;
  await page.route(`${API_URL}/auth/me`, async (route) => {
    if (!loggedIn) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Session expired" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: memberUser }),
    });
  });
  await page.route(`${API_URL}/auth/login`, async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      email: "demo@o11yfleet.com",
      password: "demo-password",
    });
    loggedIn = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: memberUser }),
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

async function failUnexpectedApi(route: Route) {
  throw new Error(`Unexpected API request: ${route.request().method()} ${route.request().url()}`);
}

test.describe("portal smoke coverage", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`${API_URL}/**`, failUnexpectedApi);
  });

  test("login flow signs in and lands on the portal overview", async ({ page }) => {
    const runtime = collectRuntimeErrors(page);

    await mockLoginFlow(page);
    await mockJson(page, "/api/v1/tenant", { id: "tenant-1", name: "Demo Org", plan: "pro" });
    await mockPortalOverview(page);

    await page.goto(`${UI_URL}/login?api=${encodeURIComponent(API_URL)}`);
    await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();

    await page.getByLabel("Email").fill("demo@o11yfleet.com");
    await page.getByLabel("Password").fill("demo-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/portal\/overview$/);
    await expect(page.getByRole("heading", { name: "Fleet overview" })).toBeVisible();
    await expect(page.getByText("prod-collectors")).toBeVisible();
    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });

  test("portal overview renders fleet totals and recent configurations", async ({ page }) => {
    const runtime = collectRuntimeErrors(page);

    await mockPortalSession(page);
    await mockPortalOverview(page);

    await page.goto(`${UI_URL}/portal/overview?api=${encodeURIComponent(API_URL)}`);

    await expect(page.getByRole("heading", { name: "Fleet overview" })).toBeVisible();
    await expect(page.locator(".stat", { hasText: "Configurations" }).locator(".val")).toHaveText(
      "1",
    );
    await expect(page.locator(".stat", { hasText: "Total collectors" }).locator(".val")).toHaveText(
      "4",
    );
    await expect(page.locator(".stat", { hasText: "Connected" }).locator(".val")).toHaveText("2");
    await expect(page.getByText("2 / 4 connected")).toBeVisible();
    await expect(page.getByRole("link", { name: "prod-collectors" })).toBeVisible();
    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });

  test("configuration list renders existing apps/site configuration rows", async ({ page }) => {
    const runtime = collectRuntimeErrors(page);

    await mockPortalSession(page);
    await mockJson(page, "/api/v1/configurations", {
      configurations: [
        {
          id: "config-1",
          name: "prod-collectors",
          status: "active",
          current_config_hash: "abcdef1234567890",
          description: "Production collector group",
          updated_at: "2026-04-28T20:00:00.000Z",
        },
      ],
    });

    await page.goto(`${UI_URL}/portal/configurations?api=${encodeURIComponent(API_URL)}`);

    await expect(page.getByRole("heading", { name: "Configurations" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New configuration" })).toBeVisible();
    await expect(page.getByRole("link", { name: "prod-collectors" })).toBeVisible();
    await expect(page.getByText("abcdef123456")).toBeVisible();
    await expect(page.getByText("Production collector group")).toBeVisible();
    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });
});

test.describe("admin operations coverage", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`${API_URL}/**`, failUnexpectedApi);
  });

  test("admin overview renders live health totals", async ({ page }) => {
    const runtime = collectRuntimeErrors(page);

    await mockJson(page, "/auth/me", {
      user: {
        userId: "admin-1",
        email: "admin@o11yfleet.com",
        displayName: "Admin",
        role: "admin",
        tenantId: null,
        isImpersonation: false,
      },
    });
    await mockJson(page, "/api/admin/overview", {
      total_tenants: 1,
      total_configurations: 2,
      total_agents: 3,
      total_active_tokens: 1,
      total_users: 4,
    });
    await mockJson(page, "/api/admin/tenants?sort=newest&page=1&limit=25", {
      tenants: [
        {
          id: "tenant-1",
          name: "Demo Org",
          plan: "pro",
          max_configs: 50,
          max_agents_per_config: 100000,
          config_count: 2,
          user_count: 1,
          created_at: "2026-04-28T20:00:00.000Z",
        },
      ],
    });
    await mockJson(page, "/api/admin/health", {
      status: "healthy",
      checks: {
        d1: { status: "healthy", latency_ms: 2 },
        r2: { status: "healthy", latency_ms: 3 },
        durable_objects: { status: "healthy", latency_ms: 1 },
        queue: { status: "healthy", latency_ms: 4 },
      },
    });
    await mockJson(page, "/api/admin/ai/guidance", {
      summary: "No guidance.",
      generated_at: "2026-04-28T20:00:00.000Z",
      model: "o11yfleet-guidance-fixture",
      items: [],
    });

    await page.goto(`${UI_URL}/admin/overview?api=${encodeURIComponent(API_URL)}`);

    await expect(page.getByRole("heading", { name: "Admin Overview" })).toBeVisible();
    await expect(page.locator(".stat", { hasText: "Total tenants" }).locator(".val")).toHaveText(
      "1",
    );
    await expect(page.locator(".stat", { hasText: "Total configs" }).locator(".val")).toHaveText(
      "2",
    );
    await expect(page.locator(".stat", { hasText: "Total agents" }).locator(".val")).toHaveText(
      "3",
    );
    await expect(page.locator(".stat", { hasText: "System health" }).locator(".tag")).toHaveText(
      "healthy",
    );
    await expect(page.getByRole("main").getByRole("link", { name: "System health" })).toBeVisible();
    await expect(page.getByText("Demo Org")).toBeVisible();

    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });

  test("admin plans unwrap the backend payload", async ({ page }) => {
    const runtime = collectRuntimeErrors(page);

    await mockJson(page, "/auth/me", {
      user: {
        userId: "admin-1",
        email: "admin@o11yfleet.com",
        displayName: "Admin",
        role: "admin",
        tenantId: null,
        isImpersonation: false,
      },
    });
    await mockJson(page, "/api/admin/plans", {
      plans: [
        {
          id: "starter",
          name: "Starter",
          audience: "organization",
          max_users: 3,
          max_collectors: 1000,
          max_policies: 1,
          history_retention: "24h",
          supports_api: false,
          supports_gitops: false,
          tenant_count: 1,
        },
      ],
    });

    await page.goto(`${UI_URL}/admin/plans?api=${encodeURIComponent(API_URL)}`);

    await expect(page.getByRole("heading", { name: "Plans" })).toBeVisible();
    const starterRow = page.getByRole("row", { name: /Starter/ });
    await expect(starterRow).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Tenants" })).toBeVisible();
    await expect(starterRow.locator("td").last()).toHaveText("1");
    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });

  test("admin can view a tenant through the normal portal", async ({ page }) => {
    const runtime = collectRuntimeErrors(page);
    let impersonated = false;

    await page.route(`${API_URL}/auth/me`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: impersonated
            ? {
                userId: "user-1",
                email: "impersonation+tenant-1@o11yfleet.local",
                displayName: "Admin view: Demo Org",
                role: "member",
                tenantId: "tenant-1",
                isImpersonation: true,
              }
            : {
                userId: "admin-1",
                email: "admin@o11yfleet.com",
                displayName: "Admin",
                role: "admin",
                tenantId: null,
                isImpersonation: false,
              },
        }),
      });
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
          updated_at: "2026-04-28T20:00:00.000Z",
        },
      ],
    });
    await mockJson(page, "/api/admin/tenants/tenant-1/users", {
      users: [{ id: "user-1", email: "demo@o11yfleet.com", role: "member" }],
    });
    await mockJson(page, "/api/admin/ai/guidance", {
      summary: "No guidance.",
      generated_at: "2026-04-28T20:00:00.000Z",
      model: "o11yfleet-guidance-fixture",
      items: [],
    });
    await page.route(`${API_URL}/api/admin/tenants/tenant-1/impersonate`, async (route) => {
      expect(route.request().method()).toBe("POST");
      impersonated = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            userId: "user-1",
            email: "impersonation+tenant-1@o11yfleet.local",
            displayName: "Admin view: Demo Org",
            role: "member",
            tenantId: "tenant-1",
            isImpersonation: true,
          },
        }),
      });
    });
    await mockJson(page, "/api/v1/tenant", { id: "tenant-1", name: "Demo Org", plan: "pro" });
    await mockPortalOverview(page);

    await page.goto(`${UI_URL}/admin/tenants/tenant-1?api=${encodeURIComponent(API_URL)}`);
    await expect(page.getByRole("heading", { name: "Demo Org" })).toBeVisible();

    await page.getByRole("button", { name: "View as tenant" }).click();

    await expect(page).toHaveURL(/\/portal\/overview$/);
    await expect(page.getByText("Viewing as tenant")).toBeVisible();
    await expect(page.getByText("You are impersonating Demo Org")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Fleet overview" })).toBeVisible();
    await expect(page.getByText("prod-collectors")).toBeVisible();
    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });
});
