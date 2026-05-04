// Shared mocking + screenshot helpers for portal/admin audit suites.
// Underscore prefix keeps Playwright from treating this as a test file.

import type { ConsoleMessage, Page, Route } from "@playwright/test";

export const API_URL = process.env.FP_URL ?? "http://127.0.0.1:8787";
export const UI_URL = process.env.UI_URL ?? "http://127.0.0.1:3000";

export const TENANT_ID = "t-demo";
export const USER_ID = "u-demo";
export const CONFIG_ID = "config-1";
export const CONFIG_2_ID = "config-2";
export const AGENT_UID = "00112233445566778899aabbccddeeff";

export const memberUser = {
  userId: USER_ID,
  email: "demo@o11yfleet.com",
  displayName: "Demo User",
  role: "member",
  tenantId: TENANT_ID,
  isImpersonation: false,
};

export const adminUser = {
  userId: "admin-1",
  email: "admin@o11yfleet.com",
  displayName: "Admin User",
  role: "admin",
  tenantId: null,
  isImpersonation: false,
};

// Use glob patterns so we catch the request regardless of which origin the
// SPA points at (relative `/auth/me` against UI_URL or absolute against
// API_URL via the `?api=` query param). `**` matches any path prefix.
function asGlob(path: string): string {
  return `**${path}`;
}

export async function mockJson(page: Page, path: string, body: unknown, status = 200) {
  await page.route(asGlob(path), async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

export async function mockText(page: Page, path: string, body: string) {
  await page.route(asGlob(path), async (route) => {
    await route.fulfill({ status: 200, contentType: "text/plain", body });
  });
}

export async function mockSession(page: Page, user = memberUser) {
  await mockJson(page, "/auth/me", { user });
  if (user.tenantId) {
    await mockJson(page, "/api/v1/tenant", {
      id: user.tenantId,
      name: "Demo Org",
      plan: "pro",
      created_at: "2026-04-01T00:00:00Z",
    });
  }
}

export async function mockGuidance(page: Page) {
  const guidanceFixture = JSON.stringify({
    summary: "",
    items: [],
    generated_at: "2026-04-28T00:00:00Z",
    model: "none",
  });
  await page.route(`**/api/v1/ai/guidance`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: guidanceFixture,
    });
  });
  await page.route(`**/api/admin/ai/guidance`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: guidanceFixture,
    });
  });
}

const configFixture = (id: string, name: string, hash: string) => ({
  id,
  name,
  status: "active",
  current_config_hash: hash,
  description: "Demo",
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-28T00:00:00Z",
  stats: {
    connected_agents: 8,
    total_agents: 10,
    healthy_agents: 7,
    snapshot_at: "2026-04-28T00:00:00Z",
  },
});

const statsFixture = {
  connected_agents: 8,
  total_agents: 10,
  healthy_agents: 7,
  drifted_agents: 0,
  active_websockets: 8,
  desired_config_hash: "abcdef1234",
  snapshot_at: "2026-04-28T00:00:00Z",
};

/** Mocks every portal API endpoint with happy-path fixtures. */
export async function mockPortal(page: Page) {
  await mockSession(page);
  await mockGuidance(page);

  const config1 = configFixture(CONFIG_ID, "prod-collectors", "abcdef1234");
  const config2 = configFixture(CONFIG_2_ID, "dev-collectors", "123456abcd");

  await mockJson(page, "/api/v1/overview", {
    tenant: { id: TENANT_ID, name: "Demo Org" },
    configs_count: 2,
    total_agents: 12,
    connected_agents: 10,
    healthy_agents: 9,
    active_rollouts: 1,
    metrics_source: "analytics_engine",
    metrics_error: null,
    configurations: [config1, config2],
  });

  await mockJson(page, "/api/v1/configurations", { configurations: [config1, config2] });

  for (const cfg of [config1, config2]) {
    await mockJson(page, `/api/v1/configurations/${cfg.id}`, cfg);
    await mockText(page, `/api/v1/configurations/${cfg.id}/yaml`, "");
    await mockJson(page, `/api/v1/configurations/${cfg.id}/versions`, { versions: [] });
    await mockJson(page, `/api/v1/configurations/${cfg.id}/enrollment-tokens`, { tokens: [] });
    await mockJson(page, `/api/v1/configurations/${cfg.id}/stats`, statsFixture);
    await page.route(`**/api/v1/configurations/${cfg.id}/agents*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          agents: [
            {
              instance_uid: AGENT_UID,
              is_connected: true,
              status: "Connected",
              healthy: true,
              capabilities: 0x1 | 0x800 | 0x400 | 0x4000, // ReportsStatus | ReportsHealth | AcceptsRestartCommand | ReportsAvailableComponents
              effective_config_hash: cfg.current_config_hash,
              last_seen_at: "2026-04-28T00:00:00Z",
              agent_description: {
                identifying_attributes: [
                  { key: "service.name", value: { string_value: "otel-collector" } },
                  { key: "host.name", value: { string_value: "demo-host" } },
                ],
                non_identifying_attributes: [],
              },
            },
          ],
          pagination: { has_more: false, next_cursor: null },
        }),
      });
    });
  }

  await mockJson(page, `/api/v1/configurations/${CONFIG_ID}/agents/${AGENT_UID}`, {
    instance_uid: AGENT_UID,
    config_id: CONFIG_ID,
    is_connected: true,
    status: "Connected",
    healthy: true,
    capabilities: 0x1 | 0x800 | 0x400 | 0x4000,
    sequence_num: 42,
    last_seen_at: "2026-04-28T00:00:00Z",
    effective_config_hash: "abcdef1234",
    effective_config_body: "receivers:\n  otlp:\n",
    agent_description: {
      identifying_attributes: [
        { key: "service.name", value: { string_value: "otel-collector" } },
        { key: "host.name", value: { string_value: "demo-host" } },
      ],
      non_identifying_attributes: [],
    },
    component_health_map: null,
    available_components: {
      components: {
        receivers: { sub_component_map: { otlp: {} } },
        processors: { sub_component_map: { batch: {} } },
        exporters: { sub_component_map: { debug: {} } },
        extensions: { sub_component_map: { health_check: {} } },
        connectors: { sub_component_map: {} },
      },
    },
  });

  await mockJson(page, "/api/v1/api-keys", {
    api_keys: [
      {
        id: "k1",
        name: "deploy-key",
        prefix: "sk_demo",
        created_at: "2026-04-01T00:00:00Z",
        last_used_at: null,
      },
    ],
  });
  await mockJson(page, "/api/v1/pending-tokens", { pending_tokens: [] });
  await mockJson(page, "/api/v1/pending-devices", { pending_devices: [] });
  await page.route(`**/api/v1/team*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        members: [
          {
            id: USER_ID,
            email: "demo@o11yfleet.com",
            display_name: "Demo User",
            role: "owner",
          },
        ],
      }),
    });
  });
  await mockJson(page, "/api/v1/billing/usage", {
    current_period: { start: "2026-04-01", end: "2026-04-30" },
    agent_count: 12,
    plan_limit: 50,
    plan: "pro",
  });
}

/** Mocks every admin API endpoint with happy-path fixtures. */
export async function mockAdmin(page: Page) {
  await mockSession(page, adminUser);
  await mockGuidance(page);

  await mockJson(page, "/api/admin/settings", { auto_approve_signups: false });

  await mockJson(page, "/api/admin/overview", {
    total_tenants: 5,
    total_configurations: 12,
    total_active_tokens: 3,
    total_users: 8,
    total_agents: 47,
    connected_agents: 42,
    healthy_agents: 38,
    metrics_source: "analytics_engine",
    metrics_error: null,
  });

  await page.route(`**/api/admin/tenants*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tenants: [
          {
            id: "t-demo",
            name: "Demo Org",
            plan: "pro",
            created_at: "2026-04-01T00:00:00Z",
            agent_count: 12,
            status: "active",
          },
          {
            id: "t-acme",
            name: "Acme Corp",
            plan: "enterprise",
            created_at: "2026-03-15T00:00:00Z",
            agent_count: 35,
            status: "active",
          },
        ],
        pagination: {
          page: 1,
          limit: 25,
          total: 2,
          has_more: false,
        },
        filters: { q: "", plan: "", status: null, sort: "newest" },
        status_counts: { active: 2 },
        metrics_source: "analytics_engine",
        metrics_error: null,
      }),
    });
  });

  await mockJson(page, `/api/admin/tenants/t-demo`, {
    id: "t-demo",
    name: "Demo Org",
    plan: "pro",
    created_at: "2026-04-01T00:00:00Z",
    status: "active",
  });
  await mockJson(page, `/api/admin/tenants/t-demo/configurations`, { configurations: [] });
  await mockJson(page, `/api/admin/tenants/t-demo/users`, { users: [] });
  await mockJson(page, "/api/admin/health", {
    components: {
      d1: { status: "ok", latency_ms: 12 },
      r2: { status: "ok", latency_ms: 8 },
      durable_objects: { status: "ok", count: 47 },
      analytics_engine: { status: "ok" },
    },
  });
  await mockJson(page, "/api/admin/usage", {
    configured: true,
    currency: "USD",
    generated_at: "2026-04-28T00:00:00Z",
    window: {
      start_date: "2026-04-01",
      end_date: "2026-04-30",
      days_elapsed: 28,
      days_in_month: 30,
    },
    services: [
      {
        id: "workers",
        name: "Workers",
        status: "ready",
        source: "Cloudflare Analytics Engine",
        daily: [
          {
            date: "2026-04-28",
            requests: 1000,
            estimated_spend_usd: 0.5,
            units: { requests: 1000 },
          },
        ],
        line_items: [],
        notes: [],
        month_to_date_estimated_spend_usd: 14,
        projected_month_estimated_spend_usd: 15,
      },
    ],
    required_env: [],
    pricing: { source: "Cloudflare published rates 2026-Q2", notes: [] },
    month_to_date_estimated_spend_usd: 14,
    projected_month_estimated_spend_usd: 15,
  });
  await mockJson(page, "/api/admin/plans", {
    plans: [
      { id: "free", name: "Free", agent_limit: 5, config_limit: 1, tenant_count: 0 },
      { id: "pro", name: "Pro", agent_limit: 50, config_limit: 10, tenant_count: 1 },
      {
        id: "enterprise",
        name: "Enterprise",
        agent_limit: -1,
        config_limit: -1,
        tenant_count: 1,
      },
    ],
  });
}

/** Tracks `pageerror` and console errors so the audit can assert clean runs. */
export function collectRuntimeErrors(page: Page): {
  errors: string[];
  dispose: () => void;
} {
  const errors: string[] = [];
  const onPageError = (err: Error) => errors.push(err.message);
  const onConsole = (msg: ConsoleMessage) => {
    const text = msg.text();
    if (msg.type() === "error" && !text.startsWith("Failed to load resource:")) {
      errors.push(text);
    }
  };
  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  return {
    errors,
    dispose: () => {
      page.off("pageerror", onPageError);
      page.off("console", onConsole);
    },
  };
}

/** Fail-fast trap: any unmocked API call throws. Catches missing fixtures. */
export async function trapUnmockedApi(page: Page) {
  await page.route(`**/api/**`, async (route: Route) => {
    throw new Error(`Unexpected API request: ${route.request().method()} ${route.request().url()}`);
  });
}
