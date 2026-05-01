import { expect, test } from "@playwright/test";

const UI_URL = process.env.UI_URL ?? "http://127.0.0.1:3000";

test("localStorage fp-api-base is never set, even after visiting the site with ?api=", async ({
  page,
}) => {
  await page.goto(`${UI_URL}/login`);
  await page.waitForLoadState("networkidle");
  const stored = await page.evaluate(() => localStorage.getItem("fp-api-base"));
  expect(stored).toBeNull();
});

test("localStorage fp-api-base remains null after navigating portal pages", async ({ page }) => {
  await page.goto(`${UI_URL}/login`);
  await page.goto(`${UI_URL}/portal/overview`);
  await page.waitForLoadState("networkidle");
  const stored = await page.evaluate(() => localStorage.getItem("fp-api-base"));
  expect(stored).toBeNull();
});
