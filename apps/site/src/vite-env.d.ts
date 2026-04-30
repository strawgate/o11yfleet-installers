/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_O11YFLEET_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
