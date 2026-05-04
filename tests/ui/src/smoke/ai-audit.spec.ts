// AI Auditing tests - Capture screenshots and DOM snapshots for AI review
// Generates both visual screenshots and machine-readable DOM snapshots

import { test, expect, type Page } from "@playwright/test";
import { mockPortal, mockAdmin } from "../_audit-helpers";
import * as fs from "node:fs";
import * as path from "node:path";

const UI_URL = process.env.UI_URL ?? "http://127.0.0.1:3000";
const SNAPSHOT_DIR = process.env.AUDIT_OUTPUT_DIR ?? "test-results/ai-audit";

/**
 * Ensure snapshot directory exists
 */
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Generate unique ID to prevent file overwrite in parallel/retried tests
 */
function generateUniqueId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Clean filename for safe file paths
 */
function cleanName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Wait for page to fully render before capturing
 * Returns true if page rendered with substantial content
 */
async function waitForRender(page: Page): Promise<boolean> {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
  } catch {
    // Already loaded
  }

  try {
    await page.waitForFunction(() => document.readyState === "complete", { timeout: 5000 });
  } catch {
    // Might already be complete
  }

  try {
    await page.waitForLoadState("networkidle", { timeout: 8000 });
  } catch {
    // Network might keep polling, continue anyway
  }

  // Wait for spinners to disappear
  try {
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          '[class*="spinner"]:not([style*="display: none"]):not([style*="display:none"])',
        ).length === 0,
      { timeout: 3000 },
    );
  } catch {
    // No spinners = good
  }

  // Wait for DOM to have content - this is the hard postcondition
  const hasContent = await page
    .waitForFunction(
      () => document.body.children.length > 0 && document.body.innerHTML.length > 100,
      { timeout: 5000 },
    )
    .then(() => true)
    .catch(() => false);

  return hasContent;
}

/**
 * Capture both screenshot and DOM snapshot for a page
 */
async function captureForAI(page: Page, name: string, url: string) {
  ensureDir(SNAPSHOT_DIR);
  const safeName = cleanName(name);
  // Use unique ID to prevent file overwrite in parallel/retried tests
  const uniqueId = generateUniqueId();

  // Navigate to page with proper waiting
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Wait for full render after navigation - hard postcondition
  const renderSuccess = await waitForRender(page);

  // Verify navigation - check we landed on expected page (not redirected to error/login)
  const finalUrl = page.url();
  const urlMatches = finalUrl.includes(url.replace(UI_URL, "")) || finalUrl === url;
  const isNotErrorPage = !finalUrl.includes("/404") && !finalUrl.includes("not-found");
  // Both conditions should be true: URL matches AND not an error page
  const navigationSuccess = urlMatches && isNotErrorPage;

  // Capture screenshot
  const screenshotPath = path.join(SNAPSHOT_DIR, `${safeName}-${uniqueId}.png`);
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    animations: "disabled",
  });

  // Capture DOM snapshot (full HTML)
  const htmlPath = path.join(SNAPSHOT_DIR, `${safeName}-${uniqueId}.html`);
  const html = await page.content();
  fs.writeFileSync(htmlPath, html);

  // Capture structured DOM (innerHTML of body)
  const bodyPath = path.join(SNAPSHOT_DIR, `${safeName}-${uniqueId}.body.html`);
  const bodyHtml = await page.evaluate(() => document.body.innerHTML);
  fs.writeFileSync(bodyPath, bodyHtml);

  // Capture metadata as JSON
  const meta = {
    name,
    url,
    urlTarget: url,
    uniqueId,
    timestamp: new Date().toISOString(),
    viewport: page.viewportSize(),
    title: await page.title(),
    urlFinal: finalUrl,
    navigationSuccess,
    urlMatches: urlMatches,
    isNotErrorPage,
    bodyLength: (await page.evaluate(() => document.body.innerHTML.length)) as number,
    childCount: (await page.evaluate(() => document.body.children.length)) as number,
    renderSuccess,
  };
  const metaPath = path.join(SNAPSHOT_DIR, `${safeName}-${uniqueId}.meta.json`);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  // 5. Capture accessibility tree (for AI)
  const a11y = await page.evaluate(() => {
    const getAccessibleText = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const text = el.textContent?.trim() ?? "";
      const role = el.getAttribute("role") ?? "";
      const ariaLabel = el.getAttribute("aria-label") ?? "";
      const placeholder = (el as HTMLInputElement).placeholder ?? "";

      let result = `<${tag}`;
      if (role) result += ` role="${role}"`;
      if (ariaLabel) result += ` aria-label="${ariaLabel}"`;
      if (placeholder) result += ` placeholder="${placeholder}"`;
      result += ">";
      if (text) result += text;
      result += "</>";

      return result;
    };

    const walk = (el: Element, depth: number): string[] => {
      if (depth > 5) return [];
      const results: string[] = [];
      const children = Array.from(el.children);

      for (const child of children.slice(0, 20)) {
        // Limit children
        const text = getAccessibleText(child);
        if (text.length > 5) {
          results.push("  ".repeat(depth) + text);
        }
        results.push(...walk(child, depth + 1));
      }

      return results;
    };

    return walk(document.body, 0).join("\n");
  });
  const a11yPath = path.join(SNAPSHOT_DIR, `${safeName}-${uniqueId}.a11y.txt`);
  fs.writeFileSync(a11yPath, a11y);

  return {
    screenshot: screenshotPath,
    html: htmlPath,
    body: bodyPath,
    meta: metaPath,
    a11y: a11yPath,
    renderSuccess,
    navigationSuccess,
  };
}

/**
 * Portal pages for AI audit
 */
test.describe("portal AI audit", () => {
  test("portal overview", async ({ page }) => {
    await mockPortal(page);
    const paths = await captureForAI(page, "portal-overview", `${UI_URL}/portal/overview`);
    expect(fs.existsSync(paths.screenshot)).toBeTruthy();
    expect(fs.existsSync(paths.body)).toBeTruthy();
    expect(fs.existsSync(paths.a11y)).toBeTruthy();
    expect(paths.renderSuccess).toBeTruthy();
    expect(paths.navigationSuccess).toBeTruthy();
  });

  test("portal agents", async ({ page }) => {
    await mockPortal(page);
    const paths = await captureForAI(page, "portal-agents", `${UI_URL}/portal/agents`);
    expect(fs.existsSync(paths.screenshot)).toBeTruthy();
    expect(fs.existsSync(paths.body)).toBeTruthy();
    expect(paths.renderSuccess).toBeTruthy();
    expect(paths.navigationSuccess).toBeTruthy();
  });

  test("portal configurations", async ({ page }) => {
    await mockPortal(page);
    const paths = await captureForAI(
      page,
      "portal-configurations",
      `${UI_URL}/portal/configurations`,
    );
    expect(fs.existsSync(paths.screenshot)).toBeTruthy();
    expect(fs.existsSync(paths.body)).toBeTruthy();
    expect(paths.renderSuccess).toBeTruthy();
    expect(paths.navigationSuccess).toBeTruthy();
  });

  test("portal settings", async ({ page }) => {
    await mockPortal(page);
    const paths = await captureForAI(page, "portal-settings", `${UI_URL}/portal/settings`);
    expect(fs.existsSync(paths.screenshot)).toBeTruthy();
    expect(fs.existsSync(paths.body)).toBeTruthy();
    expect(paths.renderSuccess).toBeTruthy();
    expect(paths.navigationSuccess).toBeTruthy();
  });

  test("portal tokens", async ({ page }) => {
    await mockPortal(page);
    const paths = await captureForAI(page, "portal-tokens", `${UI_URL}/portal/tokens`);
    expect(fs.existsSync(paths.screenshot)).toBeTruthy();
    expect(fs.existsSync(paths.body)).toBeTruthy();
    expect(paths.renderSuccess).toBeTruthy();
    expect(paths.navigationSuccess).toBeTruthy();
  });

  test("portal team", async ({ page }) => {
    await mockPortal(page);
    const paths = await captureForAI(page, "portal-team", `${UI_URL}/portal/team`);
    expect(fs.existsSync(paths.screenshot)).toBeTruthy();
    expect(fs.existsSync(paths.body)).toBeTruthy();
    expect(paths.renderSuccess).toBeTruthy();
    expect(paths.navigationSuccess).toBeTruthy();
  });

  test("portal audit", async ({ page }) => {
    await mockPortal(page);
    const paths = await captureForAI(page, "portal-audit", `${UI_URL}/portal/audit`);
    expect(fs.existsSync(paths.screenshot)).toBeTruthy();
    expect(fs.existsSync(paths.body)).toBeTruthy();
    expect(paths.renderSuccess).toBeTruthy();
    expect(paths.navigationSuccess).toBeTruthy();
  });

  test("portal billing", async ({ page }) => {
    await mockPortal(page);
    const paths = await captureForAI(page, "portal-billing", `${UI_URL}/portal/billing`);
    expect(fs.existsSync(paths.screenshot)).toBeTruthy();
    expect(fs.existsSync(paths.body)).toBeTruthy();
    expect(paths.renderSuccess).toBeTruthy();
    expect(paths.navigationSuccess).toBeTruthy();
  });
});

/**
 * Admin pages for AI audit
 */
test.describe("admin AI audit", () => {
  test("admin overview", async ({ page }) => {
    await mockAdmin(page);
    const paths = await captureForAI(page, "admin-overview", `${UI_URL}/admin/overview`);
    expect(fs.existsSync(paths.screenshot)).toBeTruthy();
    expect(fs.existsSync(paths.body)).toBeTruthy();
    expect(paths.renderSuccess).toBeTruthy();
    expect(paths.navigationSuccess).toBeTruthy();
  });

  test("admin tenants", async ({ page }) => {
    await mockAdmin(page);
    const paths = await captureForAI(page, "admin-tenants", `${UI_URL}/admin/tenants`);
    expect(fs.existsSync(paths.screenshot)).toBeTruthy();
    expect(fs.existsSync(paths.body)).toBeTruthy();
    expect(paths.renderSuccess).toBeTruthy();
    expect(paths.navigationSuccess).toBeTruthy();
  });

  test("admin health", async ({ page }) => {
    await mockAdmin(page);
    const paths = await captureForAI(page, "admin-health", `${UI_URL}/admin/health`);
    expect(fs.existsSync(paths.screenshot)).toBeTruthy();
    expect(fs.existsSync(paths.body)).toBeTruthy();
    expect(paths.renderSuccess).toBeTruthy();
    expect(paths.navigationSuccess).toBeTruthy();
  });

  test("admin plans", async ({ page }) => {
    await mockAdmin(page);
    const paths = await captureForAI(page, "admin-plans", `${UI_URL}/admin/plans`);
    expect(fs.existsSync(paths.screenshot)).toBeTruthy();
    expect(fs.existsSync(paths.body)).toBeTruthy();
    expect(paths.renderSuccess).toBeTruthy();
    expect(paths.navigationSuccess).toBeTruthy();
  });
});

/**
 * Auth pages for AI audit
 */
test.describe("auth AI audit", () => {
  test("login page", async ({ page }) => {
    const paths = await captureForAI(page, "auth-login", `${UI_URL}/login`);
    expect(fs.existsSync(paths.screenshot)).toBeTruthy();
    expect(fs.existsSync(paths.body)).toBeTruthy();
    expect(paths.renderSuccess).toBeTruthy();
    expect(paths.navigationSuccess).toBeTruthy();
  });

  test("signup page", async ({ page }) => {
    const paths = await captureForAI(page, "auth-signup", `${UI_URL}/signup`);
    expect(fs.existsSync(paths.screenshot)).toBeTruthy();
    expect(fs.existsSync(paths.body)).toBeTruthy();
    expect(paths.renderSuccess).toBeTruthy();
    expect(paths.navigationSuccess).toBeTruthy();
  });
});
