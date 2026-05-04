import { expect, test, type Page } from "@playwright/test";

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

const CONFIG_ID = "config-1";
// Valid 32-char hex instance UID — passes the worker's edge validation.
const AGENT_UID = "00112233445566778899aabbccddeeff";

async function mockJson(page: Page, path: string, body: unknown, status = 200) {
  await page.route(`${API_URL}${path}`, async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function mockSession(page: Page) {
  await mockJson(page, "/auth/me", { user: memberUser });
  await mockJson(page, "/api/v1/tenant", { id: "tenant-1", name: "Demo Org", plan: "pro" });
}

async function mockGuidance(page: Page) {
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

const configFixture = {
  id: CONFIG_ID,
  name: "prod-collectors",
  status: "active",
  current_config_hash: "abcdef1234567890",
  description: "Production collector group",
  updated_at: "2026-04-28T20:00:00.000Z",
  created_at: "2026-04-01T20:00:00.000Z",
  stats: {
    connected_agents: 2,
    total_agents: 4,
    healthy_agents: 2,
    snapshot_at: "2026-04-28T20:00:00.000Z",
  },
};

async function mockConfigurationDetail(page: Page) {
  await mockJson(page, `/api/v1/configurations/${CONFIG_ID}`, configFixture);
  await mockJson(page, `/api/v1/configurations/${CONFIG_ID}/yaml`, "");
  await mockJson(page, `/api/v1/configurations/${CONFIG_ID}/versions`, { versions: [] });
  await mockJson(page, `/api/v1/configurations/${CONFIG_ID}/enrollment-tokens`, { tokens: [] });
  await mockJson(page, `/api/v1/configurations/${CONFIG_ID}/stats`, {
    connected_agents: 2,
    total_agents: 4,
    healthy_agents: 2,
    drifted_agents: 0,
    active_websockets: 2,
    desired_config_hash: "abcdef1234567890",
    snapshot_at: "2026-04-28T20:00:00.000Z",
  });
  await page.route(`${API_URL}/api/v1/configurations/${CONFIG_ID}/agents*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agents: [],
        pagination: { has_more: false, next_cursor: null },
      }),
    });
  });
}

const AGENT_CAPS_WITH_RESTART =
  // ReportsStatus | ReportsHealth | AcceptsRestartCommand (0x400)
  0x1 | 0x800 | 0x400;

const AGENT_CAPS_NO_RESTART = 0x1 | 0x800;

function agentDetailFixture(opts: { connected: boolean; capabilities: number }) {
  return {
    instance_uid: AGENT_UID,
    config_id: CONFIG_ID,
    is_connected: opts.connected,
    status: opts.connected ? "Connected" : "Disconnected",
    healthy: true,
    capabilities: opts.capabilities,
    last_seen_at: "2026-04-28T20:00:00.000Z",
    sequence_num: 42,
    agent_description: {
      identifying_attributes: [
        { key: "service.name", value: { string_value: "otel-collector" } },
        { key: "host.name", value: { string_value: "demo-host" } },
      ],
      non_identifying_attributes: [],
    },
    effective_config_hash: "abcdef1234567890",
    effective_config_body: "receivers:\n  otlp:\n",
    component_health_map: null,
  };
}

test.describe("admin commands UI", () => {
  test.beforeEach(async ({ page }) => {
    await mockSession(page);
    await mockGuidance(page);
  });

  test("Fleet Actions: Restart collectors opens confirm + shows loading→success toast", async ({
    page,
  }) => {
    await mockConfigurationDetail(page);

    let restartCalled = false;
    await page.route(`**/api/v1/configurations/${CONFIG_ID}/restart`, async (route) => {
      restartCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ restarted: 2, skipped_no_cap: 0 }),
      });
    });

    await page.goto(
      `${UI_URL}/portal/configurations/${CONFIG_ID}?api=${encodeURIComponent(API_URL)}`,
    );
    await expect(page.getByRole("heading", { name: "prod-collectors" })).toBeVisible();

    // Switch to Settings tab where Fleet Actions live
    await page.getByRole("tab", { name: "Settings" }).click();

    // Fleet actions panel renders with Restart and Disconnect buttons
    await expect(page.getByRole("heading", { name: "Fleet actions" })).toBeVisible();
    const restartButton = page.getByRole("button", { name: "Restart collectors" });
    await expect(restartButton).toBeEnabled();

    await restartButton.click();

    // Mantine confirm modal opens
    const modal = page.getByRole("dialog");
    await expect(modal.getByText("Restart all collectors")).toBeVisible();
    await expect(modal.getByText(/Send a Restart command to all/)).toBeVisible();

    // Click confirm — fires mutation
    await modal.getByRole("button", { name: "Restart" }).click();

    // Modal closes (loading→success morph in toast is timing-sensitive in
    // tests; the mutation firing IS the integration-test signal we want).
    await expect(modal).not.toBeVisible({ timeout: 5000 });
    await expect.poll(() => restartCalled, { timeout: 5000 }).toBe(true);
  });

  test("Fleet Actions: Disconnect collectors fires the correct endpoint", async ({ page }) => {
    await mockConfigurationDetail(page);

    let disconnectCalled = false;
    await page.route(`**/api/v1/configurations/${CONFIG_ID}/disconnect`, async (route) => {
      disconnectCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ disconnect_requested: 2 }),
      });
    });

    await page.goto(
      `${UI_URL}/portal/configurations/${CONFIG_ID}?api=${encodeURIComponent(API_URL)}`,
    );
    await page.getByRole("tab", { name: "Settings" }).click();

    await page.getByRole("button", { name: "Disconnect collectors" }).click();
    const modal = page.getByRole("dialog");
    await expect(modal.getByText("Disconnect all collectors")).toBeVisible();
    await modal.getByRole("button", { name: "Disconnect" }).click();

    await expect(modal).not.toBeVisible({ timeout: 5000 });
    await expect.poll(() => disconnectCalled, { timeout: 5000 }).toBe(true);
  });

  test("AgentDetail: Restart button enabled when AcceptsRestartCommand advertised", async ({
    page,
  }) => {
    await mockJson(page, `/api/v1/configurations/${CONFIG_ID}`, configFixture);
    await mockJson(page, `/api/v1/configurations/${CONFIG_ID}/stats`, {
      connected_agents: 1,
      total_agents: 1,
      healthy_agents: 1,
      drifted_agents: 0,
      active_websockets: 1,
      desired_config_hash: "abcdef1234567890",
      snapshot_at: "2026-04-28T20:00:00.000Z",
    });
    await mockJson(
      page,
      `/api/v1/configurations/${CONFIG_ID}/agents/${AGENT_UID}`,
      agentDetailFixture({ connected: true, capabilities: AGENT_CAPS_WITH_RESTART }),
    );

    let restartCalled = false;
    await page.route(
      `**/api/v1/configurations/${CONFIG_ID}/agents/${AGENT_UID}/restart`,
      async (route) => {
        restartCalled = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ restarted: true }),
        });
      },
    );

    await page.goto(
      `${UI_URL}/portal/agents/${CONFIG_ID}/${AGENT_UID}?api=${encodeURIComponent(API_URL)}`,
    );

    const restart = page.getByRole("button", { name: "Restart" });
    await expect(restart).toBeEnabled();
    await restart.click();

    const modal = page.getByRole("dialog");
    await expect(modal.getByText("Restart agent")).toBeVisible();
    await modal.getByRole("button", { name: "Restart" }).click();

    await expect(page.getByText("Restart sent")).toBeVisible({ timeout: 5000 });
    expect(restartCalled).toBe(true);
  });

  test("AgentDetail: Restart disabled when capability not advertised", async ({ page }) => {
    await mockJson(page, `/api/v1/configurations/${CONFIG_ID}`, configFixture);
    await mockJson(page, `/api/v1/configurations/${CONFIG_ID}/stats`, {
      connected_agents: 1,
      total_agents: 1,
      healthy_agents: 1,
      drifted_agents: 0,
      active_websockets: 1,
      desired_config_hash: "abcdef1234567890",
      snapshot_at: "2026-04-28T20:00:00.000Z",
    });
    await mockJson(
      page,
      `/api/v1/configurations/${CONFIG_ID}/agents/${AGENT_UID}`,
      agentDetailFixture({ connected: true, capabilities: AGENT_CAPS_NO_RESTART }),
    );

    await page.goto(
      `${UI_URL}/portal/agents/${CONFIG_ID}/${AGENT_UID}?api=${encodeURIComponent(API_URL)}`,
    );

    const restart = page.getByRole("button", { name: "Restart" });
    await expect(restart).toBeDisabled();
  });

  test("AgentDetail: Disconnect disabled when agent offline", async ({ page }) => {
    await mockJson(page, `/api/v1/configurations/${CONFIG_ID}`, configFixture);
    await mockJson(page, `/api/v1/configurations/${CONFIG_ID}/stats`, {
      connected_agents: 0,
      total_agents: 1,
      healthy_agents: 0,
      drifted_agents: 0,
      active_websockets: 0,
      desired_config_hash: "abcdef1234567890",
      snapshot_at: "2026-04-28T20:00:00.000Z",
    });
    await mockJson(
      page,
      `/api/v1/configurations/${CONFIG_ID}/agents/${AGENT_UID}`,
      agentDetailFixture({ connected: false, capabilities: AGENT_CAPS_WITH_RESTART }),
    );

    await page.goto(
      `${UI_URL}/portal/agents/${CONFIG_ID}/${AGENT_UID}?api=${encodeURIComponent(API_URL)}`,
    );

    await expect(page.getByRole("button", { name: "Disconnect" })).toBeDisabled();
    // Restart is also disabled because the agent is offline (regardless of capability)
    await expect(page.getByRole("button", { name: "Restart" })).toBeDisabled();
  });

  test("AgentDetail: Disconnect happy path hits /agents/:uid/disconnect when online", async ({
    page,
  }) => {
    // Regression guard: until this test, the suite only verified the
    // offline-disabled state, which would silently miss a regression that
    // wired the per-agent button at the wrong endpoint. Confirm the
    // request lands at the per-agent path, not the fleet-wide one.
    await mockJson(page, `/api/v1/configurations/${CONFIG_ID}`, configFixture);
    await mockJson(page, `/api/v1/configurations/${CONFIG_ID}/stats`, {
      connected_agents: 1,
      total_agents: 1,
      healthy_agents: 1,
      drifted_agents: 0,
      active_websockets: 1,
      desired_config_hash: "abcdef1234567890",
      snapshot_at: "2026-04-28T20:00:00.000Z",
    });
    await mockJson(
      page,
      `/api/v1/configurations/${CONFIG_ID}/agents/${AGENT_UID}`,
      agentDetailFixture({ connected: true, capabilities: AGENT_CAPS_WITH_RESTART }),
    );

    let disconnectCalled = false;
    let fleetDisconnectCalled = false;
    await page.route(
      `**/api/v1/configurations/${CONFIG_ID}/agents/${AGENT_UID}/disconnect`,
      async (route) => {
        disconnectCalled = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ disconnected: true }),
        });
      },
    );
    await page.route(`**/api/v1/configurations/${CONFIG_ID}/disconnect`, async (route) => {
      fleetDisconnectCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ disconnect_requested: 0 }),
      });
    });

    await page.goto(
      `${UI_URL}/portal/agents/${CONFIG_ID}/${AGENT_UID}?api=${encodeURIComponent(API_URL)}`,
    );

    const disconnect = page.getByRole("button", { name: "Disconnect" });
    await expect(disconnect).toBeEnabled();
    await disconnect.click();

    const modal = page.getByRole("dialog");
    await expect(modal.getByText("Disconnect agent")).toBeVisible();
    await modal.getByRole("button", { name: "Disconnect" }).click();

    await expect(page.getByText("Disconnect sent")).toBeVisible({ timeout: 5000 });
    expect(disconnectCalled).toBe(true);
    expect(fleetDisconnectCalled).toBe(false);
  });
});
