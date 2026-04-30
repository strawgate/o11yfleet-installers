import { defineConfig } from "@playwright/test";

const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1";

export default defineConfig({
  testDir: "./src",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.UI_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: skipWebServer
    ? undefined
    : {
        command: "pnpm --dir=../../apps/site dev --host 127.0.0.1 --port 3000",
        url: process.env.UI_URL ?? "http://127.0.0.1:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
