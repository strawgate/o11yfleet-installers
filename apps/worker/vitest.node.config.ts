import { defineConfig } from "vitest/config";

// Plain-Node runner for tests that import only pure modules. Splitting
// these out means:
//   - they run in ~ms instead of seconds (no workerd boot)
//   - they're the natural target for Stryker mutation testing
//   - they remain runnable in any TS environment, not just CF
//
// Anything that imports `cloudflare:workers` or `cloudflare:test`
// belongs in `vitest.config.ts` (the workerd-pool config) instead.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "test/hardening.test.ts",
      "test/yaml-validation.test.ts",
      "test/errors.test.ts",
      "test/data-source-policy.test.ts",
      "test/text-diff.test.ts",
      "test/do-name.test.ts",
      "test/policy-schemas.test.ts",
      "test/properties.test.ts",
      "test/github-validate-config.test.ts",
      "test/github-api.test.ts",
      "test/github-installation-token.test.ts",
      "test/github-check-runs.test.ts",
      "test/manifest-drift-check.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "reports/coverage/node",
      // Only the pure modules these tests actually exercise. Adding the
      // workerd-only files here would drown the report in NoCoverage
      // false positives — those are measured by `coverage:runtime` (the
      // workerd-pool config below) and merged separately.
      include: [
        "src/durable-objects/do-name.ts",
        "src/durable-objects/policy-schemas.ts",
        "src/utils/**/*.ts",
        "src/shared/origins.ts",
        "src/shared/errors.ts",
        "src/shared/validation.ts",
        "src/github/api.ts",
        "src/github/validate-config.ts",
        "src/github/check-runs.ts",
        "src/github/installation-token.ts",
        "src/jobs/manifest-drift-check.ts",
      ],
    },
  },
});
