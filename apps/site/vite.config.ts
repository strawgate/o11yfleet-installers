import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 4000,
    proxy: {
      "/auth": "http://127.0.0.1:8787",
      "/api": "http://127.0.0.1:8787",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
