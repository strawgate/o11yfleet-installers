/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_O11YFLEET_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Baked-in API target for Cloudflare Pages preview builds. Defined at
// build time via `define` in vite.config.ts; empty string in dev/prod
// builds where API discovery happens at runtime via host sniffing.
declare const __VITE_API_TARGET__: string;
