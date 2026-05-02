import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const requiredWorkerSecretTestBindings = {
  O11YFLEET_API_BEARER_SECRET: "test-api-secret-for-dev-only-32chars",
  O11YFLEET_CLAIM_HMAC_SECRET: "dev-secret-key-for-testing-only-32ch",
  O11YFLEET_AI_GUIDANCE_MINIMAX_API_KEY: "test-minimax-key",
  O11YFLEET_SEED_ADMIN_EMAIL: "admin@o11yfleet.com",
  O11YFLEET_SEED_ADMIN_PASSWORD: "admin-password",
  O11YFLEET_SEED_TENANT_USER_EMAIL: "demo@o11yfleet.com",
  O11YFLEET_SEED_TENANT_USER_PASSWORD: "demo-password",
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
          ENVIRONMENT: "dev",
          CLOUDFLARE_METRICS_API_TOKEN: "",
          CLOUDFLARE_METRICS_ACCOUNT_ID: "",
          CLOUDFLARE_BILLING_API_TOKEN: "",
          CLOUDFLARE_BILLING_ACCOUNT_ID: "",
          GITHUB_APP_CLIENT_ID: "test-github-client-id",
          GITHUB_APP_CLIENT_SECRET: "test-github-client-secret",
          O11YFLEET_OIDC_ALLOWED_REPOS: "strawgate/o11yfleet-load",
          O11YFLEET_OIDC_AUDIENCE: "o11yfleet",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/data-source-policy.test.ts"],
    // Workerd startup is memory-sensitive on small CI runners; serial files keep
    // local and 2-core runner checks stable while test cases still run normally.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
