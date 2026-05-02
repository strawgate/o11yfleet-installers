import { defineConfig } from "vitest/config";

// Vitest config used by Stryker for mutation testing.
//
// Stryker runs in a sandboxed copy of the package, so any test that
// reads files via relative paths (e.g., the oracle protobuf fixtures)
// will fail. Restrict the test surface to property + unit tests of the
// pure modules Stryker mutates.
export default defineConfig({
  test: {
    include: [
      "test/hex.test.ts",
      "test/hex.properties.test.ts",
      "test/auth.test.ts",
      "test/auth.properties.test.ts",
      "test/protobuf-codec.test.ts",
      "test/codec.properties.test.ts",
      "test/state-machine.test.ts",
      "test/state-machine.properties.test.ts",
    ],
  },
});
