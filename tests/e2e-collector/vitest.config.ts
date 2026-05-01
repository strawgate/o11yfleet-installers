import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 120_000, // real collectors take time to start
    hookTimeout: 60_000,
  },
});
