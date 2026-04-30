import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const requiredWorkerSecretTestBindings = {
  API_SECRET: "test-api-secret-for-dev-only-32chars",
  CLAIM_SECRET: "dev-secret-key-for-testing-only-32ch",
  MINIMAX_API_KEY: "",
  SEED_ADMIN_EMAIL: "admin@o11yfleet.com",
  SEED_ADMIN_PASSWORD: "admin-password",
  SEED_TENANT_USER_EMAIL: "demo@o11yfleet.com",
  SEED_TENANT_USER_PASSWORD: "demo-password",
};

// Wrangler validates `secrets.required` from process.env before Miniflare applies
// test bindings, so feed both from one object.
for (const [name, value] of Object.entries(requiredWorkerSecretTestBindings)) {
  process.env[name] ??= value;
}

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ...requiredWorkerSecretTestBindings,
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
