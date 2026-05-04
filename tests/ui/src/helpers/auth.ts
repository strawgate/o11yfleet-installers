// Authentication helpers for Playwright tests
// Centralizes login/logout patterns and session management

import type { Page } from "@playwright/test";
import { memberUser, adminUser, mockSession, mockPortal, mockAdmin } from "../_audit-helpers";

export { memberUser, adminUser, mockSession, mockPortal, mockAdmin };

/**
 * Sets up a logged-in portal session on the page.
 * Use this in beforeEach or at test start.
 */
export async function loginAsMember(page: Page) {
  await mockPortal(page);
}

/**
 * Sets up a logged-in admin session on the page.
 * Use this in beforeEach or at test start.
 */
export async function loginAsAdmin(page: Page) {
  await mockAdmin(page);
}

/**
 * Navigates to the portal overview page with member session.
 */
export async function visitPortalOverview(page: Page, baseUrl: string) {
  await mockPortal(page);
  await page.goto(`${baseUrl}/portal/overview`, { waitUntil: "domcontentloaded" });
}

/**
 * Navigates to admin overview with admin session.
 */
export async function visitAdminOverview(page: Page, baseUrl: string) {
  await mockAdmin(page);
  await page.goto(`${baseUrl}/admin/overview`, { waitUntil: "domcontentloaded" });
}
