/**
 * E2E test helpers — wraps the FleetPlane HTTP API for full-stack tests.
 *
 * These run against a live wrangler dev server (localhost:8787).
 */

export const BASE_URL = process.env.FP_URL ?? "http://localhost:8787";
export const WS_URL = BASE_URL.replace(/^http/, "ws") + "/v1/opamp";

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

/** Create a tenant. Returns { id, name }. */
export async function createTenant(
  name: string,
): Promise<{ id: string; name: string }> {
  const { status, data } = await api<{ id: string; name: string }>(
    "/api/tenants",
    { method: "POST", body: JSON.stringify({ name }) },
  );
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
  }>("/api/configurations", {
    method: "POST",
    body: JSON.stringify({ tenant_id: tenantId, name }),
  });
  if (status !== 201) throw new Error(`Failed to create config: ${status}`);
  return data;
}

/** Upload a YAML config version. */
export async function uploadConfigVersion(
  configId: string,
  yaml: string,
): Promise<{ hash: string; deduplicated: boolean }> {
  const res = await fetch(
    `${BASE_URL}/api/configurations/${configId}/versions`,
    { method: "POST", body: yaml, headers: { "Content-Type": "text/yaml" } },
  );
  if (res.status !== 201)
    throw new Error(`Failed to upload config: ${res.status}`);
  return res.json();
}

/** Create an enrollment token for a config. */
export async function createEnrollmentToken(
  configId: string,
): Promise<{ id: string; token: string }> {
  const { status, data } = await api<{ id: string; token: string }>(
    `/api/configurations/${configId}/enrollment-token`,
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
  }>(`/api/configurations/${configId}/rollout`, { method: "POST" });
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
  const { status, data } = await api(
    `/api/configurations/${configId}/stats`,
  );
  if (status !== 200) throw new Error(`Failed to get stats: ${status}`);
  return data as any;
}

/** Get agent summaries from D1 read model. */
export async function getAgentSummaries(
  configId: string,
): Promise<{ agents: Array<Record<string, unknown>> }> {
  const { status, data } = await api(
    `/api/configurations/${configId}/agents`,
  );
  if (status !== 200) throw new Error(`Failed to get agents: ${status}`);
  return data as any;
}

/** List tenants. */
export async function listTenants(): Promise<{
  tenants: Array<{ id: string; name: string }>;
}> {
  const { status, data } = await api("/api/tenants");
  if (status !== 200) throw new Error(`Failed to list tenants: ${status}`);
  return data as any;
}

/** List configurations for a tenant. */
export async function listConfigs(
  tenantId: string,
): Promise<{
  configurations: Array<{ id: string; name: string; tenant_id: string }>;
}> {
  const { status, data } = await api(
    `/api/tenants/${tenantId}/configurations`,
  );
  if (status !== 200) throw new Error(`Failed to list configs: ${status}`);
  return data as any;
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
export async function waitForServer(
  maxWaitMs = 15_000,
): Promise<void> {
  const start = Date.now();
  let delay = 200;
  while (Date.now() - start < maxWaitMs) {
    if (await healthz()) return;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 2000);
  }
  throw new Error(
    `Server at ${BASE_URL} not ready after ${maxWaitMs}ms. Run 'just dev' first.`,
  );
}

/** Small delay for async operations to settle (e.g., queue processing). */
export function settle(ms = 500): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
