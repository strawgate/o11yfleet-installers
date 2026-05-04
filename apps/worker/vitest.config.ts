import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Load production D1 migrations once at config time so every test starts
// against the same schema as production. Beats hand-rolling CREATE TABLE
// in every test file (which drifts) — migrations are the single source
// of truth and `applyD1Migrations()` runs them in `beforeAll`.
const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsPath = resolve(__dirname, "../../packages/db/migrations");
const TEST_MIGRATIONS = await readD1Migrations(migrationsPath);

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
          TEST_MIGRATIONS,
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
    // Tests that import only pure modules run in plain Node via
    // `vitest.node.config.ts` — exclude them here so they don't double-run.
    exclude: [
      "test/data-source-policy.test.ts",
      "test/hardening.test.ts",
      "test/yaml-validation.test.ts",
      "test/errors.test.ts",
      "test/text-diff.test.ts",
      "test/do-name.test.ts",
      "test/policy-schemas.test.ts",
      "test/properties.test.ts",
      "test/github-validate-config.test.ts",
      "test/github-api.test.ts",
      "test/github-installation-token.test.ts",
      "test/github-check-runs.test.ts",
      "test/manifest-drift-check.test.ts",
      // Pure unit tests that run in node pool instead
      "test/observability-events.test.ts",
      "test/tenant-lifecycle.test.ts",
      "test/hono-app.test.ts",
    ],
    // Parallel file execution for faster CI runs on multi-core runners.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      // v8 coverage requires the test runtime to be v8-instrumented.
      // The Cloudflare workerd pool runs tests in a separate workerd
      // process that isn't, so v8 reports 0%. Istanbul instruments at
      // transform time, before the bundle ships into workerd, and
      // works end-to-end — at the cost of a slower transform pass.
      provider: "istanbul",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "reports/coverage/runtime",
      include: ["src/**/*.ts"],
      exclude: [
        "src/worker-configuration.d.ts",
        // Generated/external surface — not a useful signal for tests.
        "src/instrumented.ts",
        "src/tracing.ts",
      ],
    },
  },
});
