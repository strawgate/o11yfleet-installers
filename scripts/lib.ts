/**
 * Shared utilities for local dev scripts
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = resolve(__dirname, "..", ".local-state.json");

export const BASE_URL = process.env.FP_URL ?? "http://localhost:8787";

export interface LocalState {
  tenant_id: string;
  tenant_name: string;
  config_id: string;
  config_name: string;
  enrollment_token: string;
  assignment_claim?: string;
  instance_uid?: string;
  current_config_hash?: string;
}

export function loadState(): LocalState | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

export function saveState(state: LocalState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

export function stateFilePath(): string {
  return STATE_FILE;
}

/** Pretty timestamp */
export function ts(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

/** Colored log helpers */
export const log = {
  info: (msg: string) => console.log(`\x1b[36m[${ts()}]\x1b[0m ${msg}`),
  ok: (msg: string) => console.log(`\x1b[32m[${ts()}]\x1b[0m ✓ ${msg}`),
  warn: (msg: string) => console.log(`\x1b[33m[${ts()}]\x1b[0m ⚠ ${msg}`),
  error: (msg: string) => console.log(`\x1b[31m[${ts()}]\x1b[0m ✗ ${msg}`),
  ws: (dir: "→" | "←" | "↔", msg: string) =>
    console.log(`\x1b[35m[${ts()}]\x1b[0m ${dir} ${msg}`),
  dim: (msg: string) => console.log(`\x1b[2m[${ts()}] ${msg}\x1b[0m`),
};

/** Fetch JSON from the FleetPlane API */
export async function api<T = unknown>(
  path: string,
  opts?: RequestInit,
): Promise<{ status: number; data: T }> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...opts?.headers,
    },
  });
  const data = (await res.json().catch(() => null)) as T;
  return { status: res.status, data };
}
