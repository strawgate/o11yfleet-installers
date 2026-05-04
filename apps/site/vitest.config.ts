import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// #791 PoC: vitest + @testing-library/react setup. Coexists with node:test
// (the existing `pnpm test` runner). Vitest only picks up `*.vitest.ts(x)`
// files via the `include` glob below, so the two suites can't collide.
//
// ESM-native path resolution via import.meta.url; __dirname isn't available
// in this `"type": "module"` package.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/**/*.vitest.{ts,tsx}"],
    setupFiles: ["./test/vitest-setup.ts"],
  },
});
