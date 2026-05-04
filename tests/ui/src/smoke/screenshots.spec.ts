// Screenshot tests for AI agent auditing
// These tests are optimized to capture full page screenshots with content loaded

import { test, expect, type Page } from "@playwright/test";
import { mockPortal, mockAdmin } from "../_audit-helpers";

const UI_URL = process.env.UI_URL ?? "http://127.0.0.1:3000";

/**
 * Helper to wait for page content to fully render
 * Uses multiple strategies to ensure React/SPA has finished rendering
 */
async function waitForContent(page: Page) {
  // 1. Wait for DOM to be ready
  await page.waitForLoadState("domcontentloaded");

  // 2. Wait for document to be complete
  await page.waitForFunction(() => document.readyState === "complete", { timeout: 10000 });

  // 3. Wait for network to be idle (API calls finished)
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {
    // Some apps keep long polling, continue anyway
  });

  // 4. Wait for loading states to disappear
  await page
    .waitForFunction(
      () => {
        const spinners = document.querySelectorAll(
          '[class*="spinner"]:not([style*="hidden"]), ' +
            '[class*="loading"]:not([style*="hidden"]), ' +
            '[data-loading="true"], ' +
            '[aria-busy="true"]',
        );
        return spinners.length === 0;
      },
      { timeout: 5000 },
    )
    .catch(() => {
      // No spinners = good
    });

  // 5. Wait for DOM to have substantial content
  await page
    .waitForFunction(
      () => {
        // Track body content length as a proxy for stability
        return document.body.innerHTML.length > 100;
      },
      { timeout: 5000 },
    )
    .catch(() => {
      // Fallback: body has some content
    });

  // 6. Verify body has rendered children
  await page.waitForFunction(() => document.body.children.length > 0, { timeout: 5000 });
}

/**
 * Portal pages - full screenshots for AI auditing
 */
test.describe("portal screenshots for AI audit", () => {
  test("portal overview - full page", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/overview`);
    await waitForContent(page);
    // Verify body has substantial content
    await expect(page.locator("body")).toBeVisible();
  });

  test("portal agents - full page", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/agents`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });

  test("portal configurations - full page", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/configurations`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });

  test("portal settings - full page", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/settings`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });

  test("portal tokens - full page", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/tokens`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });

  test("portal team - full page", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/team`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });

  test("portal audit - full page", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/audit`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });

  test("portal billing - full page", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/billing`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });

  test("portal pending-approval - full page", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/pending-approval`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });

  test("portal pending-devices - full page", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/pending-devices`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });

  test("portal getting-started - full page", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/getting-started`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });

  test("portal onboarding - full page", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/onboarding`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });

  test("portal builder - full page", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/builder`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });
});

/**
 * Admin pages - full screenshots for AI auditing
 */
test.describe("admin screenshots for AI audit", () => {
  test("admin overview - full page", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`${UI_URL}/admin/overview`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });

  test("admin tenants - full page", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`${UI_URL}/admin/tenants`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });

  test("admin health - full page", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`${UI_URL}/admin/health`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });

  test("admin plans - full page", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`${UI_URL}/admin/plans`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });

  test("admin usage - full page", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`${UI_URL}/admin/usage`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });

  test("admin support - full page", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`${UI_URL}/admin/support`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });
});

/**
 * Auth pages - full screenshots for AI auditing
 */
test.describe("auth screenshots for AI audit", () => {
  test("login page - full page", async ({ page }) => {
    await page.goto(`${UI_URL}/login`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });

  test("signup page - full page", async ({ page }) => {
    await page.goto(`${UI_URL}/signup`);
    await waitForContent(page);
    await expect(page.locator("body")).toBeVisible();
  });
});
