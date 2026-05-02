import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 15_000,
    coverage: {
      // v8 works for plain-Node tests in this package — fast (no
      // transform) and accurate.
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "reports/coverage",
      include: ["src/**/*.ts"],
      // Generated protobuf and the package entry barrels are not the
      // surface we measure: re-exports inflate the denominator without
      // adding meaningful test signal.
      exclude: ["src/**/gen/**", "src/index.ts", "src/**/index.ts"],
    },
  },
  bench: {
    include: ["bench/**/*.bench.ts"],
  },
});
