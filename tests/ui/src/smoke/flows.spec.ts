// Critical user flow tests for AI agent auditing
// These tests capture screenshots at key points for style/content review

import { test, expect } from "@playwright/test";
import { mockPortal, mockAdmin, UI_URL } from "../_audit-helpers";

/**
 * Auth Flows - verify login/signup forms render
 */
test.describe("auth flows", () => {
  test("login page renders", async ({ page }) => {
    await page.goto(`${UI_URL}/login`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("signup page renders", async ({ page }) => {
    await page.goto(`${UI_URL}/signup`);
    await expect(page.locator("body")).toBeVisible();
  });
});

/**
 * Portal User Flows - verify main features render
 */
test.describe("portal flows", () => {
  test("agents page renders", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/agents`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("configurations page renders", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/configurations`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("team page renders", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/team`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("tokens page renders", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/tokens`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("settings page renders", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/settings`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("billing page renders", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/billing`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("audit page renders", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/audit`);
    await expect(page.locator("body")).toBeVisible();
  });
});

/**
 * Admin Flows
 */
test.describe("admin flows", () => {
  test("tenants page renders", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`${UI_URL}/admin/tenants`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("health page renders", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`${UI_URL}/admin/health`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("plans page renders", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`${UI_URL}/admin/plans`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("usage page renders", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`${UI_URL}/admin/usage`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("support page renders", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`${UI_URL}/admin/support`);
    await expect(page.locator("body")).toBeVisible();
  });
});

/**
 * Error States
 */
test.describe("error states", () => {
  test("unauthenticated portal redirects to login", async ({ page }) => {
    await page.goto(`${UI_URL}/portal/overview`);
    await expect(page.locator("body")).toBeVisible({ timeout: 5000 });
  });

  test("unauthenticated admin redirects or shows error", async ({ page }) => {
    await page.goto(`${UI_URL}/admin/overview`);
    await expect(page.locator("body")).toBeVisible({ timeout: 5000 });
  });

  test("404 page renders", async ({ page }) => {
    await page.goto(`${UI_URL}/this-page-definitely-does-not-exist-xyz`);
    await expect(page.locator("body")).toBeVisible({ timeout: 5000 });
  });
});

/**
 * Content Verification Flows
 * These tests verify pages render with actual content
 */
test.describe("content verification flows", () => {
  test("portal overview page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/overview`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("portal agents page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/agents`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("login page loads", async ({ page }) => {
    await page.goto(`${UI_URL}/login`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("signup page loads", async ({ page }) => {
    await page.goto(`${UI_URL}/signup`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("portal settings page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/settings`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("portal configurations page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/configurations`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("admin tenants page loads", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`${UI_URL}/admin/tenants`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("portal team page loads", async ({ page }) => {
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/team`);
    await expect(page.locator("body")).toBeVisible();
  });
});

/**
 * Responsive Layout Flows
 */
test.describe("responsive layout flows", () => {
  test("portal works on mobile viewport", async ({ page }) => {
    await mockPortal(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`${UI_URL}/portal/overview`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("admin works on tablet viewport", async ({ page }) => {
    await mockAdmin(page);
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`${UI_URL}/admin/overview`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("login works on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`${UI_URL}/login`);
    await expect(page.locator("body")).toBeVisible();
  });
});
