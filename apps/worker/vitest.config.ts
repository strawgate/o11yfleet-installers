import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          API_SECRET: "test-api-secret-for-dev-only-32chars",
          CLAIM_SECRET: "dev-secret-key-for-testing-only-32ch",
          CLOUDFLARE_ACCOUNT_ANALYTICS_API_KEY: "",
          CLOUDFLARE_ACCOUNT_ID: "",
          CLOUDFLARE_WORKER_SCRIPT_NAME: "",
          CLOUDFLARE_D1_DATABASE_ID: "",
          CLOUDFLARE_R2_BUCKET_NAME: "",
          CLOUDFLARE_ANALYTICS_DATASET: "",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
