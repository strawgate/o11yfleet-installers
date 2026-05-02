import { defineConfig } from "vitest/config";

// Vitest config used by Stryker for mutation testing.
//
// Includes only the tests that exercise the pure modules Stryker mutates
// (do-name.ts, policy-schemas.ts). Excludes anything that touches
// workerd or reads project files via relative paths — Stryker runs in a
// sandboxed copy of the package, where those paths resolve incorrectly.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/do-name.test.ts", "test/policy-schemas.test.ts", "test/properties.test.ts"],
  },
});
