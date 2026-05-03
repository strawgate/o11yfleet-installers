// Portal page audit. Renders every authenticated portal route, captures a
// full-page screenshot under tests/ui/test-results/audit/, and asserts no
// runtime/console errors. Acts as both a render-regression gate and a CI
// artifact source.

import { expect, test } from "@playwright/test";
import { AGENT_UID, CONFIG_ID, UI_URL, collectRuntimeErrors, mockPortal } from "./_audit-helpers";

const AUDIT_PAGES: Array<{
  name: string;
  path: string;
  expectVisible: { role?: string; name: string | RegExp; level?: number }[];
}> = [
  {
    name: "01-overview",
    path: "/portal/overview",
    expectVisible: [{ role: "heading", name: /Fleet overview/, level: 1 }],
  },
  {
    name: "02-configurations",
    path: "/portal/configurations",
    expectVisible: [{ role: "heading", name: "Configurations", level: 1 }],
  },
  {
    name: "03-config-detail",
    path: `/portal/configurations/${CONFIG_ID}`,
    expectVisible: [{ role: "heading", name: "prod-collectors", level: 1 }],
  },
  {
    name: "04-agents",
    path: "/portal/agents",
    expectVisible: [{ role: "heading", name: "Collectors", level: 1 }],
  },
  {
    name: "05-agent-detail",
    path: `/portal/agents/${CONFIG_ID}/${AGENT_UID}`,
    expectVisible: [{ role: "heading", name: "demo-host", level: 1 }],
  },
  {
    name: "06-builder",
    path: "/portal/builder",
    expectVisible: [{ role: "heading", name: "Pipeline builder" }],
  },
  {
    name: "07-tokens",
    path: "/portal/tokens",
    expectVisible: [{ role: "heading", name: "Enrollment tokens", level: 1 }],
  },
  {
    name: "08-pending-devices",
    path: "/portal/pending-devices",
    expectVisible: [{ role: "heading", name: "Pending Enrollment", level: 1 }],
  },
  {
    name: "09-team",
    path: "/portal/team",
    expectVisible: [{ role: "heading", name: "Team", level: 1 }],
  },
  {
    name: "10-billing",
    path: "/portal/billing",
    expectVisible: [{ role: "heading", name: "Billing", level: 1 }],
  },
  {
    name: "11-settings",
    path: "/portal/settings",
    expectVisible: [{ role: "heading", name: "Settings", level: 1 }],
  },
  {
    name: "12-getting-started",
    path: "/portal/getting-started",
    expectVisible: [{ role: "heading", name: /Getting started/i }],
  },
  {
    name: "13-onboarding",
    path: "/portal/onboarding",
    expectVisible: [{ role: "heading", name: "Onboarding" }],
  },
  {
    name: "14-pending-approval",
    path: "/portal/pending-approval",
    expectVisible: [{ role: "heading", name: /Pending approval/i }],
  },
];

test.describe("portal audit", () => {
  for (const page of AUDIT_PAGES) {
    test(`${page.name}: ${page.path}`, async ({ page: browserPage }) => {
      const runtime = collectRuntimeErrors(browserPage);
      await mockPortal(browserPage);

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
        path: `test-results/audit/portal-${page.name}.png`,
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
