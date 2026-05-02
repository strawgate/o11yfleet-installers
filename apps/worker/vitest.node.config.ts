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
    ],
  },
});
