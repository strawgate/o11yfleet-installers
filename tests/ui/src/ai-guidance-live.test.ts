import { expect, test, type Page } from "@playwright/test";

const API_URL = process.env.FP_URL ?? "http://127.0.0.1:8787";

type GuidanceItem = {
  target_key: string;
  headline: string;
  detail: string;
  evidence: Array<{ label: string; value: string; source?: string }>;
};

type GuidanceResponse = {
  summary: string;
  model?: string;
  items: GuidanceItem[];
};

test.describe("live AI guidance provider", () => {
  test.skip(
    process.env.LIVE_AI_GUIDANCE !== "1",
    "Set LIVE_AI_GUIDANCE=1 and provide MINIMAX_API_KEY to run the live provider check.",
  );

  test("returns valid guidance responses for seeded portal and admin pages", async ({ page }) => {
    await login(page, "/login", "demo@o11yfleet.com", "demo-password", "Sign in");
    const portalGuidance = await captureGuidance(page, "/portal/overview", "/api/v1/ai/guidance");
    await assertGuidance("portal.overview", portalGuidance, page);

    await page.context().clearCookies();
    await login(
      page,
      "/admin/login",
      "admin@o11yfleet.com",
      "admin-password",
      "Sign in to admin console",
    );
    const adminGuidance = await captureGuidance(page, "/admin/overview", "/api/admin/ai/guidance");
    await assertGuidance("admin.overview", adminGuidance, page);
  });
});

async function login(page: Page, path: string, email: string, password: string, button: string) {
  await page.goto(`${path}?api=${encodeURIComponent(API_URL)}`);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: button }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}

async function captureGuidance(
  page: Page,
  path: string,
  endpoint: "/api/v1/ai/guidance" | "/api/admin/ai/guidance",
): Promise<GuidanceResponse> {
  const guidanceResponse = page.waitForResponse(
    (response) =>
      response.url() === `${API_URL}${endpoint}` && response.request().method() === "POST",
  );

  await page.goto(path);
  const response = await guidanceResponse;
  expect(response.ok()).toBe(true);
  return (await response.json()) as GuidanceResponse;
}

async function assertGuidance(surface: string, guidance: GuidanceResponse, page: Page) {
  // The fixture model id must not appear in a live run, but we also have to
  // reject `undefined` / empty string explicitly — `toBe(...)` alone passes
  // when the field is missing entirely.
  expect(guidance.model).toEqual(expect.any(String));
  expect((guidance.model ?? "").trim().length).toBeGreaterThan(0);
  expect(guidance.model).not.toBe("o11yfleet-guidance-fixture");
  expect(guidance.summary).toEqual(expect.any(String));
  expect(guidance.summary.trim().length).toBeGreaterThan(0);
  expect(guidance.items).toEqual(expect.any(Array));
  expect(guidance.items.length).toBeGreaterThan(0);
  await expect(page.getByText(/Guidance unavailable/i)).toHaveCount(0);

  for (const item of guidance.items) {
    expect(item.target_key).toEqual(expect.any(String));
    expect(item.headline).toEqual(expect.any(String));
    expect(item.detail).toEqual(expect.any(String));
    expect(item.evidence.length).toBeGreaterThan(0);
  }

  console.log(
    JSON.stringify({
      surface,
      model: guidance.model,
      summary: guidance.summary,
      items: guidance.items.map((item) => ({
        target_key: item.target_key,
        headline: item.headline,
        evidence: item.evidence.map((evidence) => evidence.label),
      })),
    }),
  );
}
