/**
 * Configuration storage with XDG base directory spec
 * Based on Railway/Turso CLI patterns
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, mkdir, chmod, rename, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";

const CONFIG_DIR = join(homedir(), ".config", "o11y");
const AUTH_FILE = join(CONFIG_DIR, "auth.json");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface AuthConfig {
  apiUrl: string;
  sessionCookie?: string;
  tenantId?: string;
  token?: string; // API token for CI
}

export interface GlobalConfig {
  apiUrl: string;
  defaultTenant?: string;
}

async function ensureConfigDir(): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Atomic write - write to temp file then rename
 * This prevents corruption if the process is interrupted
 */
async function atomicWrite(path: string, content: string): Promise<void> {
  await ensureConfigDir();
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, content, "utf-8");
  try {
    await rename(tmpPath, path);
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

export async function loadAuth(): Promise<AuthConfig> {
  const defaults: AuthConfig = {
    apiUrl: process.env.O11YFLEET_API_URL || "http://localhost:8787",
  };

  if (!existsSync(AUTH_FILE)) {
    return defaults;
  }

  try {
    const data = await readFile(AUTH_FILE, "utf-8");
    const parsed = JSON.parse(data);
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export async function saveAuth(auth: AuthConfig): Promise<void> {
  await atomicWrite(AUTH_FILE, JSON.stringify(auth, null, 2));
  // Set permissions to user-only read/write (0600)
  await chmod(AUTH_FILE, 0o600);
}

export async function loadConfig(): Promise<GlobalConfig> {
  const defaults: GlobalConfig = {
    apiUrl: process.env.O11YFLEET_API_URL || "http://localhost:8787",
  };

  if (!existsSync(CONFIG_FILE)) {
    return defaults;
  }

  try {
    const data = await readFile(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(data);
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export async function saveConfig(config: GlobalConfig): Promise<void> {
  await atomicWrite(CONFIG_FILE, JSON.stringify(config, null, 2));
  await chmod(CONFIG_FILE, 0o644);
}

export async function getApiUrl(): Promise<string> {
  // Check env var first (for CI)
  if (process.env.O11YFLEET_API_URL) {
    return process.env.O11YFLEET_API_URL;
  }
  const auth = await loadAuth();
  return auth.apiUrl;
}

export async function getSession(): Promise<{ cookie?: string; token?: string }> {
  const auth = await loadAuth();
  return { cookie: auth.sessionCookie, token: auth.token };
}

export async function setSession(
  sessionCookie?: string,
  tenantId?: string,
  token?: string,
): Promise<void> {
  const auth = await loadAuth();
  if (sessionCookie !== undefined) auth.sessionCookie = sessionCookie;
  if (tenantId !== undefined) auth.tenantId = tenantId;
  if (token !== undefined) auth.token = token;
  await saveAuth(auth);
}

export async function clearSession(): Promise<void> {
  const auth = await loadAuth();
  auth.sessionCookie = undefined;
  auth.tenantId = undefined;
  auth.token = undefined;
  await saveAuth(auth);
}

export async function getTenantId(): Promise<string | undefined> {
  const auth = await loadAuth();
  return auth.tenantId;
}
