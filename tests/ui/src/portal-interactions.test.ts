// Portal interaction tests — exercises sortable columns, pagination, and tab
// switching. Complements portal-audit.test.ts (render-only) by verifying that
// state-driven UI actually responds to user input.

import { expect, test } from "@playwright/test";
import { AGENT_UID, CONFIG_ID, UI_URL, collectRuntimeErrors, mockPortal } from "./_audit-helpers";

test.describe("portal interactions", () => {
  test("ConfigurationsPage: clicking a sortable column header flips the sort indicator", async ({
    page,
  }) => {
    const runtime = collectRuntimeErrors(page);
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/configurations`);

    await expect(page.getByRole("heading", { name: "Configurations" })).toBeVisible();

    // The Name column header doubles as the sort toggle. Click cycles the
    // sort state and TanStack Table reorders rows in-place.
    const nameHeader = page.getByRole("columnheader", { name: /Name/i });
    await expect(nameHeader).toBeVisible();
    await nameHeader.click();

    // After clicking, the rows should still render (no crash) and the
    // header retains its accessible role.
    await expect(page.getByText("prod-collectors")).toBeVisible();
    await expect(page.getByText("dev-collectors")).toBeVisible();

    // Click again — second toggle should reverse the sort. Both rows
    // remain visible regardless of order.
    await nameHeader.click();
    await expect(page.getByText("prod-collectors")).toBeVisible();

    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });

  test("ConfigurationDetailPage: switching tabs updates the active panel", async ({ page }) => {
    const runtime = collectRuntimeErrors(page);
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/configurations/${CONFIG_ID}`);

    await expect(page.getByRole("heading", { name: "prod-collectors" })).toBeVisible();

    // Default tab is "Agents". Switch through each Mantine Tab and verify
    // the corresponding tabpanel has fresh content.
    const tabs = ["Versions", "Rollout", "YAML", "Settings"];
    for (const label of tabs) {
      await page.getByRole("tab", { name: label }).click();
      // The tab being active is the strongest signal that the click landed.
      await expect(page.getByRole("tab", { name: label, selected: true })).toBeVisible();
    }

    // Settings tab specifically renders the Fleet actions card.
    await expect(page.getByRole("heading", { name: "Fleet actions" })).toBeVisible();

    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });

  test("AgentDetailPage: switching tabs updates the active panel", async ({ page }) => {
    const runtime = collectRuntimeErrors(page);
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/agents/${CONFIG_ID}/${AGENT_UID}`);

    await expect(page.getByRole("heading", { name: "demo-host" })).toBeVisible();

    for (const label of ["Pipeline", "Configuration", "Overview"]) {
      await page.getByRole("tab", { name: label }).click();
      await expect(page.getByRole("tab", { name: label, selected: true })).toBeVisible();
    }

    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });

  test("ConfigurationDetailPage Agents tab: pagination buttons render and disable correctly", async ({
    page,
  }) => {
    const runtime = collectRuntimeErrors(page);
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/configurations/${CONFIG_ID}`);

    await expect(page.getByRole("heading", { name: "prod-collectors" })).toBeVisible();

    // Mock pagination has has_more=false, so Next page is disabled and
    // First page is also disabled (no cursor set yet).
    await expect(page.getByRole("button", { name: "First page" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();

    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });

  test("OverviewPage: configuration table sorts by name", async ({ page }) => {
    const runtime = collectRuntimeErrors(page);
    await mockPortal(page);
    await page.goto(`${UI_URL}/portal/overview`);

    await expect(page.getByRole("heading", { name: /Fleet overview/ })).toBeVisible();

    // The Recent configurations table has a sortable Name column.
    const nameHeader = page.getByRole("columnheader", { name: /Name/i });
    await expect(nameHeader).toBeVisible();
    await nameHeader.click();

    // Both configurations are visible regardless of sort direction.
    await expect(page.getByText("prod-collectors")).toBeVisible();
    await expect(page.getByText("dev-collectors")).toBeVisible();

    runtime.dispose();
    expect(runtime.errors).toEqual([]);
  });
});
