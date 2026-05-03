// Admin console page audit.

import { expect, test } from "@playwright/test";
import { UI_URL, collectRuntimeErrors, mockAdmin } from "./_audit-helpers";

const ADMIN_PAGES: Array<{
  name: string;
  path: string;
  expectVisible: { role?: string; name: string | RegExp; level?: number }[];
}> = [
  {
    name: "01-overview",
    path: "/admin/overview",
    expectVisible: [{ role: "heading", name: /Admin overview/i, level: 1 }],
  },
  {
    name: "02-tenants",
    path: "/admin/tenants",
    expectVisible: [{ role: "heading", name: "Tenants", level: 1 }],
  },
  {
    name: "03-tenant-detail",
    path: "/admin/tenants/t-demo",
    expectVisible: [{ role: "heading", name: /Demo Org/, level: 1 }],
  },
  {
    name: "04-health",
    path: "/admin/health",
    expectVisible: [{ role: "heading", name: /Health/i, level: 1 }],
  },
  {
    name: "05-api-reference",
    path: "/admin/api",
    expectVisible: [{ role: "heading", name: /Admin API Reference/i, level: 1 }],
  },
  {
    name: "06-usage",
    path: "/admin/usage",
    expectVisible: [{ role: "heading", name: /Usage & Spend/i, level: 1 }],
  },
  {
    name: "07-support",
    path: "/admin/support",
    expectVisible: [{ role: "heading", name: /Support/i, level: 1 }],
  },
  {
    name: "08-do-viewer",
    path: "/admin/do-viewer",
    expectVisible: [{ role: "heading", name: /Durable Object Viewer/i, level: 1 }],
  },
  {
    name: "09-plans",
    path: "/admin/plans",
    expectVisible: [{ role: "heading", name: /Plans/i, level: 1 }],
  },
];

test.describe("admin audit", () => {
  for (const page of ADMIN_PAGES) {
    test(`${page.name}: ${page.path}`, async ({ page: browserPage }) => {
      const runtime = collectRuntimeErrors(browserPage);
      await mockAdmin(browserPage);

      await browserPage.goto(`${UI_URL}${page.path}`);

      for (const target of page.expectVisible) {
        const locator = target.role
          ? browserPage.getByRole(target.role as "heading", {
              name: target.name,
              level: target.level,
            })
          : browserPage.getByText(target.name);
        await expect(locator).toBeVisible({ timeout: 10_000 });
      }

      await browserPage.screenshot({
        path: `test-results/audit/admin-${page.name}.png`,
        fullPage: true,
      });

      runtime.dispose();
      if (runtime.errors.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[audit ${page.name}] ${runtime.errors.length} console error(s):\n` +
            runtime.errors.map((e) => `  - ${e}`).join("\n"),
        );
      }
    });
  }
});
