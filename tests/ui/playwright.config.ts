import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./src",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // sequential — tests share server state
  retries: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  // Both wrangler dev (API) and serve (UI) must be running:
  // just dev   →  localhost:8787
  // just ui    →  localhost:3000
});
