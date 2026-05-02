/**
 * E2E test helpers — wraps the o11yfleet HTTP API for full-stack tests.
 *
 * These run against a live wrangler dev server (localhost:8787).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

export const BASE_URL = process.env.FP_URL ?? "http://localhost:8787";
export const WS_URL = BASE_URL.replace(/^http/, "ws") + "/v1/opamp";
export const API_KEY =
  process.env.FP_API_KEY ??
  process.env.O11YFLEET_API_KEY ??
  process.env.O11YFLEET_API_BEARER_SECRET ??
  "test-api-secret-for-dev-only-32chars";

interface SeededState {
  tenant_id: string;
  tenant_name: string;
  config_id: string;
  config_name: string;
  enrollment_token: string;
  current_config_hash: string;
}

/** Try to load seeded state from .local-state.json (created by seed-local.ts) */
function loadSeededState(): SeededState | null {
  const statePath = resolve(REPO_ROOT, ".local-state.json");
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, "utf-8")) as SeededState;
  } catch {
    return null;
  }
}

/** Get the seeded tenant info if available (from .local-state.json) */
export function getSeededTenant(): { id: string; name: string } | null {
  const state = loadSeededState();
  return state ? { id: state.tenant_id, name: state.tenant_name } : null;
}

/** Get the seeded config ID if available */
export function getSeededConfigId(): string | null {
  const state = loadSeededState();
  return state?.config_id ?? null;
}

/** Get the seeded enrollment token if available */
export function getSeededEnrollmentToken(): string | null {
  const state = loadSeededState();
  return state?.enrollment_token ?? null;
}

const configTenantIds = new Map<string, string>();

function tenantIdForConfig(configId: string): string {
  const tenantId = configTenantIds.get(configId);
  if (!tenantId) {
    throw new Error(`No tenant ID tracked for config ${configId}`);
  }
  return tenantId;
}

function headersForConfig(configId: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${API_KEY}`,
    ...extra,
    "X-Tenant-Id": tenantIdForConfig(configId),
  };
}

function tenantIdFromRequest(path: string, opts?: RequestInit): string | null {
  const headers = new Headers(opts?.headers);
  const explicitTenantId = headers.get("X-Tenant-Id");
  if (explicitTenantId) return explicitTenantId;

  const configId = path.match(/^\/api\/v1\/configurations\/([^/]+)/)?.[1];
  if (configId) return configTenantIds.get(configId) ?? null;

  if (typeof opts?.body === "string") {
    try {
      const body = JSON.parse(opts.body) as { tenant_id?: unknown };
      return typeof body.tenant_id === "string" ? body.tenant_id : null;
    } catch {
      return null;
    }
  }

  return null;
}

/** Fetch JSON from the o11yfleet API */
export async function api<T = unknown>(
  path: string,
  opts?: RequestInit,
): Promise<{ status: number; data: T }> {
  const url = `${BASE_URL}${path}`;
  const headers = new Headers(opts?.headers);
  if (path.startsWith("/api/") && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${API_KEY}`);
  }
  if (path.startsWith("/api/v1/") && !headers.has("X-Tenant-Id")) {
    const tenantId = tenantIdFromRequest(path, { ...opts, headers });
    if (!tenantId) {
      throw new Error(`Could not derive X-Tenant-Id for ${path}`);
    }
    headers.set("X-Tenant-Id", tenantId);
  }
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...Object.fromEntries(headers) },
  });
  const data = (await res.json().catch(() => null)) as T;
  if (path === "/api/v1/configurations" && opts?.method === "POST" && res.status === 201) {
    const config = data as { id?: unknown; tenant_id?: unknown };
    if (typeof config.id === "string" && typeof config.tenant_id === "string") {
      configTenantIds.set(config.id, config.tenant_id);
    }
  }
  return { status: res.status, data };
}

/** Create a tenant. Returns { id, name }. Uses seeded tenant if available in CI. */
export async function createTenant(name: string): Promise<{ id: string; name: string }> {
  // In CI, try to use seeded tenant first (admin API requires auth that wrangler dev doesn't provide)
  const seeded = getSeededTenant();
  if (seeded) {
    console.log(`Using seeded tenant: ${seeded.name} (${seeded.id})`);
    return seeded;
  }

  const { status, data } = await api<{ id: string; name: string }>("/api/admin/tenants", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (status !== 201) throw new Error(`Failed to create tenant: ${status}`);
  return data;
}

/** Create a configuration under a tenant. */
export async function createConfig(
  tenantId: string,
  name: string,
): Promise<{ id: string; tenant_id: string; name: string }> {
  const { status, data } = await api<{
    id: string;
    tenant_id: string;
    name: string;
  }>("/api/v1/configurations", {
    method: "POST",
    body: JSON.stringify({ tenant_id: tenantId, name }),
  });
  if (status !== 201) throw new Error(`Failed to create config: ${status}`);
  configTenantIds.set(data.id, tenantId);
  return data;
}

/** Upload a YAML config version. */
export async function uploadConfigVersion(
  configId: string,
  yaml: string,
): Promise<{ hash: string; deduplicated: boolean }> {
  const res = await fetch(`${BASE_URL}/api/v1/configurations/${configId}/versions`, {
    method: "POST",
    body: yaml,
    headers: headersForConfig(configId, { "Content-Type": "text/yaml" }),
  });
  if (res.status !== 201) throw new Error(`Failed to upload config: ${res.status}`);
  return res.json();
}

/** Create an enrollment token for a config. */
export async function createEnrollmentToken(
  configId: string,
): Promise<{ id: string; token: string }> {
  const { status, data } = await api<{ id: string; token: string }>(
    `/api/v1/configurations/${configId}/enrollment-token`,
    { method: "POST", body: JSON.stringify({ label: "e2e-test" }) },
  );
  if (status !== 201) throw new Error(`Failed to create token: ${status}`);
  return data;
}

/** Rollout config to connected agents. */
export async function rolloutConfig(
  configId: string,
): Promise<{ pushed: number; config_hash: string }> {
  const { status, data } = await api<{
    pushed: number;
    config_hash: string;
  }>(`/api/v1/configurations/${configId}/rollout`, { method: "POST" });
  if (status !== 200) throw new Error(`Failed to rollout: ${status}`);
  return data;
}

/** Get config stats from DO. */
export async function getConfigStats(configId: string): Promise<{
  total_agents: number;
  connected_agents: number;
  healthy_agents: number;
  desired_config_hash: string | null;
  active_websockets: number;
}> {
  const { status, data } = await api<{
    total_agents: number;
    connected_agents: number;
    healthy_agents: number;
    desired_config_hash: string | null;
    active_websockets: number;
  }>(`/api/v1/configurations/${configId}/stats`);
  if (status !== 200) throw new Error(`Failed to get stats: ${status}`);
  return data;
}

/** Get agent summaries from D1 read model. */
export async function getAgentSummaries(
  configId: string,
): Promise<{ agents: Array<Record<string, unknown>> }> {
  const { status, data } = await api<{ agents: Array<Record<string, unknown>> }>(
    `/api/v1/configurations/${configId}/agents`,
  );
  if (status !== 200) throw new Error(`Failed to get agents: ${status}`);
  return data;
}

/** List tenants. */
export async function listTenants(): Promise<{
  tenants: Array<{ id: string; name: string }>;
}> {
  const { status, data } = await api<{ tenants: Array<{ id: string; name: string }> }>(
    "/api/admin/tenants",
  );
  if (status !== 200) throw new Error(`Failed to list tenants: ${status}`);
  return data;
}

/** Get a tenant by ID. */
export async function getTenant(tenantId: string): Promise<Record<string, unknown>> {
  const { status, data } = await api<Record<string, unknown>>(`/api/admin/tenants/${tenantId}`);
  if (status !== 200) throw new Error(`Failed to get tenant: ${status}`);
  return data;
}

/** Update a tenant. */
export async function updateTenant(
  tenantId: string,
  body: { name?: string },
): Promise<{ id: string; name: string }> {
  const { status, data } = await api<{ id: string; name: string }>(
    `/api/admin/tenants/${tenantId}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
    },
  );
  if (status !== 200) throw new Error(`Failed to update tenant: ${status}`);
  return data;
}

/** Delete a tenant. */
export async function deleteTenant(tenantId: string): Promise<number> {
  const res = await fetch(`${BASE_URL}/api/admin/tenants/${tenantId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  return res.status;
}

/** Update a configuration. */
export async function updateConfig(
  configId: string,
  body: { name?: string; description?: string },
): Promise<Record<string, unknown>> {
  const { status, data } = await api<Record<string, unknown>>(
    `/api/v1/configurations/${configId}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
    },
  );
  if (status !== 200) throw new Error(`Failed to update config: ${status}`);
  return data;
}

/** Delete a configuration. */
export async function deleteConfig(configId: string): Promise<number> {
  const res = await fetch(`${BASE_URL}/api/v1/configurations/${configId}`, {
    method: "DELETE",
    headers: headersForConfig(configId),
  });
  return res.status;
}

/** List config versions. */
export async function listConfigVersions(configId: string): Promise<{
  versions: Array<{ config_hash: string; created_at: string }>;
  current_config_hash: string;
}> {
  const { status, data } = await api<{
    versions: Array<{ config_hash: string; created_at: string }>;
    current_config_hash: string;
  }>(`/api/v1/configurations/${configId}/versions`);
  if (status !== 200) throw new Error(`Failed to list versions: ${status}`);
  return data;
}

/** List enrollment tokens. */
export async function listEnrollmentTokens(configId: string): Promise<{
  tokens: Array<{ id: string; label: string | null; revoked_at: string | null }>;
}> {
  const { status, data } = await api<{
    tokens: Array<{ id: string; label: string | null; revoked_at: string | null }>;
  }>(`/api/v1/configurations/${configId}/enrollment-tokens`);
  if (status !== 200) throw new Error(`Failed to list tokens: ${status}`);
  return data;
}

/** Revoke an enrollment token. */
export async function revokeEnrollmentToken(
  configId: string,
  tokenId: string,
): Promise<{ status: number; data: unknown }> {
  return api(`/api/v1/configurations/${configId}/enrollment-tokens/${tokenId}`, {
    method: "DELETE",
  });
}

/** Upload invalid content and return the status + error. */
export async function uploadRaw(
  configId: string,
  body: string,
): Promise<{ status: number; error?: string }> {
  const res = await fetch(`${BASE_URL}/api/v1/configurations/${configId}/versions`, {
    method: "POST",
    body,
    headers: headersForConfig(configId, { "Content-Type": "text/yaml" }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { status: res.status, ...data };
}

/** List configurations for a tenant. */
export async function listConfigs(tenantId: string): Promise<{
  configurations: Array<{ id: string; name: string; tenant_id: string }>;
}> {
  const { status, data } = await api<{
    configurations: Array<{ id: string; name: string; tenant_id: string }>;
  }>(`/api/admin/tenants/${tenantId}/configurations`);
  if (status !== 200) throw new Error(`Failed to list configs: ${status}`);
  return data;
}

/** Health check. */
export async function healthz(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/healthz`);
    return res.status === 200;
  } catch {
    return false;
  }
}

/** Wait for server to be ready with exponential backoff. */
export async function waitForServer(maxWaitMs = 15_000): Promise<void> {
  const start = Date.now();
  let delay = 200;
  while (Date.now() - start < maxWaitMs) {
    if (await healthz()) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delay);
    });
    delay = Math.min(delay * 1.5, 2000);
  }
  throw new Error(`Server at ${BASE_URL} not ready after ${maxWaitMs}ms. Run 'just dev' first.`);
}

/** Small delay for async operations to settle (e.g., queue processing). */
export function settle(ms = 500): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
