import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/hardening.test.ts", "test/yaml-validation.test.ts", "test/errors.test.ts"],
  },
});
