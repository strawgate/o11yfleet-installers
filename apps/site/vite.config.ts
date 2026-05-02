import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Use Vite's `loadEnv` so future `.env*` files are picked up automatically.
// Reading directly from `process.env` would silently ignore any `.env.local`
// override added later for the dev proxy target.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_TARGET || "http://localhost:8787";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    define: {
      // Expose API target to client code for preview deployments
      __VITE_API_TARGET__: JSON.stringify(apiTarget),
    },
    server: {
      port: 4000,
      proxy: {
        "/auth": apiTarget,
        "/api": apiTarget,
      },
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };
});
