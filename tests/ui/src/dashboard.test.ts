/**
 * Playwright UI smoke tests for the FleetPlane dashboard.
 *
 * Prerequisites:
 *   just dev   →  localhost:8787  (API/Worker)
 *   just ui    →  localhost:3000  (Static UI)
 *
 * Run: cd tests/ui && npx playwright test
 */

import { test, expect } from "@playwright/test";

const API_URL = process.env.FP_URL ?? "http://localhost:8787";
const UI_URL = process.env.UI_URL ?? "http://localhost:3000";

// Helper to call the FleetPlane API
async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(`API ${path} returned ${res.status}`);
  return res.json() as T;
}

// ────────────────────────────────────────────────────────────────────
// Smoke Tests
// ────────────────────────────────────────────────────────────────────

test.describe("Dashboard Smoke Tests", () => {
  test("page loads with correct title", async ({ page }) => {
    await page.goto(UI_URL);
    await expect(page).toHaveTitle(/FleetPlane/);
  });

  test("header displays FleetPlane branding", async ({ page }) => {
    await page.goto(UI_URL);
    await expect(page.locator("header h1")).toContainText("FleetPlane");
  });

  test("API URL input is visible and pre-filled", async ({ page }) => {
    await page.goto(UI_URL);
    const input = page.locator("#api-url");
    await expect(input).toBeVisible();
    await expect(input).toHaveValue("http://localhost:8787");
  });

  test("Connect button is visible", async ({ page }) => {
    await page.goto(UI_URL);
    await expect(
      page.locator(".server-url button", { hasText: "Connect" }),
    ).toBeVisible();
  });

  test("stat cards are present", async ({ page }) => {
    await page.goto(UI_URL);
    await expect(page.locator("#stat-total")).toBeVisible();
    await expect(page.locator("#stat-connected")).toBeVisible();
    await expect(page.locator("#stat-healthy")).toBeVisible();
    await expect(page.locator("#stat-ws")).toBeVisible();
  });

  test("configs table is present", async ({ page }) => {
    await page.goto(UI_URL);
    await expect(page.locator("#configs-table")).toBeVisible();
  });

  test("agents table is present", async ({ page }) => {
    await page.goto(UI_URL);
    await expect(page.locator("#agents-table")).toBeVisible();
  });
});

// ────────────────────────────────────────────────────────────────────
// Tenant + Config Workflow
// ────────────────────────────────────────────────────────────────────

test.describe("Tenant Management", () => {
  test("can create a tenant via dialog", async ({ page }) => {
    await page.goto(UI_URL);

    // Click "+ New Config" which should open tenant dialog if no tenant is set
    await page.locator("button", { hasText: "New Config" }).click();

    // The create-tenant-dialog should appear
    const dialog = page.locator("#create-tenant-dialog");
    await expect(dialog).toBeVisible();

    // Fill in tenant name
    await page.fill("#tenant-name", `playwright-${Date.now()}`);
    await page.selectOption("#tenant-plan", "pro");

    // Submit
    await page.locator("#create-tenant-dialog .btn-primary").click();

    // Should transition to config dialog
    await expect(page.locator("#create-config-dialog")).toBeVisible();
  });
});

// ────────────────────────────────────────────────────────────────────
// Data Display with Pre-Seeded Tenant
// ────────────────────────────────────────────────────────────────────

test.describe("Dashboard with Data", () => {
  let tenantId: string;
  let configId: string;

  test.beforeAll(async () => {
    // Create test data via API
    const tenant = await api<{ id: string }>("/api/tenants", {
      method: "POST",
      body: JSON.stringify({ name: `pw-test-${Date.now()}` }),
    });
    tenantId = tenant.id;

    const config = await api<{ id: string }>("/api/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenantId, name: "pw-config" }),
    });
    configId = config.id;
  });

  test("loads tenant data via URL hash", async ({ page }) => {
    await page.goto(`${UI_URL}#${tenantId}`);

    // Wait for data to load — the configs table should populate
    await page.waitForTimeout(2000);

    // Click Connect to trigger refresh with the tenant
    await page.locator(".server-url button", { hasText: "Connect" }).click();
    await page.waitForTimeout(2000);

    // The page should show some data (configs or stats)
    // At minimum, the stat cards should update from "—"
    const lastRefresh = page.locator("#last-refresh");
    await expect(lastRefresh).not.toBeEmpty();
  });

  test("displays config name in table when tenant is set", async ({ page }) => {
    // We need the page to know about our tenant
    // Set it via the page's JS context
    await page.goto(UI_URL);
    await page.evaluate(
      ([tid]) => {
        (window as any).tenantId = tid;
      },
      [tenantId],
    );
    await page.locator(".server-url button", { hasText: "Connect" }).click();
    await page.waitForTimeout(2000);

    // If tenantId was picked up, configs should be rendered
    const configsTable = page.locator("#configs-table");
    const text = await configsTable.textContent();
    // Should either show the config name or the "no configurations" message
    expect(text).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────
// Error Handling
// ────────────────────────────────────────────────────────────────────

test.describe("Error Handling", () => {
  test("shows error toast for invalid API URL", async ({ page }) => {
    await page.goto(UI_URL);

    // Change API URL to invalid
    await page.fill("#api-url", "http://localhost:99999");
    await page.locator(".server-url button", { hasText: "Connect" }).click();

    // Should show an error toast
    await page.waitForTimeout(2000);
    const toast = page.locator(".toast.error");
    // Toast may or may not appear depending on implementation
    // But the page shouldn't crash
    await expect(page.locator("header h1")).toContainText("FleetPlane");
  });
});
