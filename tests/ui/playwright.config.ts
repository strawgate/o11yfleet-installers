import { defineConfig, devices } from "@playwright/test";

const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1";
const captureAllScreenshots = process.env.PLAYWRIGHT_CAPTURE_ALL_SCREENSHOTS === "1";
// Intentionally unused - placeholder for future snapshot feature
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _captureSnapshots = process.env.PLAYWRIGHT_CAPTURE_SNAPSHOTS === "1";

export default defineConfig({
  testDir: "./src",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.UI_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: captureAllScreenshots ? "on" : "only-on-failure",
    video: "retain-on-failure",
  },
  snapshotDir: "./__snapshots__",
  // Optimize for speed - use more workers
  workers: process.env.CI ? 2 : undefined,
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  webServer: skipWebServer
    ? undefined
    : {
        command: "pnpm --dir=../../apps/site dev --host 127.0.0.1 --port 3000",
        url: process.env.UI_URL ?? "http://127.0.0.1:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
