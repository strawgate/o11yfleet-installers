// Smoke tests - Fast verification that all pages load without errors
// These tests are designed to run quickly and catch regressions

import { test, expect } from "@playwright/test";
import { mockPortal, mockAdmin } from "../_audit-helpers";

const UI_URL = process.env.UI_URL ?? "http://127.0.0.1:3000";

/**
 * Smoke tests for portal pages
 * Each test verifies the page loads and renders basic structure
 */
test.describe("portal smoke", () => {
  test("overview page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/overview`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("agents page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/agents`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("configurations page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/configurations`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("settings page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/settings`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("tokens page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/tokens`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("team page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/team`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("audit page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/audit`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("billing page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/billing`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("pending-approval page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/pending-approval`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("pending-devices page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/pending-devices`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("getting-started page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/getting-started`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("onboarding page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/onboarding`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("builder page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/builder`);
    await expect(page.locator("body")).toBeVisible();
  });

  // Dynamic routes with params (mock IDs)
  test("agent detail page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/agents/config-1/00112233445566778899aabbccddeeff`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("configuration detail page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/configurations/config-1`);
    await expect(page.locator("body")).toBeVisible();
  });
});

/**
 * Smoke tests for admin pages
 */
test.describe("admin smoke", () => {
  test("overview page loads", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`${UI_URL}/admin/overview`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("tenants page loads", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`${UI_URL}/admin/tenants`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("health page loads", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`${UI_URL}/admin/health`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("plans page loads", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`${UI_URL}/admin/plans`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("usage page loads", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`${UI_URL}/admin/usage`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("support page loads", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`${UI_URL}/admin/support`);
    await expect(page.locator("body")).toBeVisible();
  });

  // Dynamic routes with params
  test("tenant detail page loads", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`${UI_URL}/admin/tenants/t-demo`);
    await expect(page.locator("body")).toBeVisible();
  });
});

/**
 * Smoke tests for auth pages
 */
test.describe("auth smoke", () => {
  test("login page loads", async ({ page }) => {
    await page.goto(`${UI_URL}/login`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("signup page loads", async ({ page }) => {
    await page.goto(`${UI_URL}/signup`);
    await expect(page.locator("body")).toBeVisible();
  });
});
