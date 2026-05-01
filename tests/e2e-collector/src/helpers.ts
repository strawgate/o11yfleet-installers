/**
 * E2E test helpers for real OTel Collector tests.
 *
 * Provisions resources via the o11yfleet API, generates Docker configs,
 * and manages Docker Compose lifecycle.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCKER_DIR = resolve(__dirname, "../docker");
const GENERATED_DIR = resolve(DOCKER_DIR, "generated");

export const BASE_URL = process.env.FP_URL ?? "http://localhost:8787";
export const WS_URL = BASE_URL.replace(/^http/, "ws") + "/v1/opamp";
export const API_KEY =
  process.env.FP_API_KEY ?? process.env.O11YFLEET_API_KEY ?? "test-api-secret-for-dev-only-32chars";

// Track tenant→config mapping for API calls
const configTenantIds = new Map<string, string>();

/** Call the o11yfleet HTTP API */
export async function api<T = unknown>(
  path: string,
  opts?: RequestInit,
): Promise<{ status: number; data: T }> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  };
  if (path.startsWith("/api/v1/")) {
    // Try to resolve tenant ID
    const configMatch = path.match(/\/configurations\/([^/]+)/);
    if (configMatch) {
      const tid = configTenantIds.get(configMatch[1]!);
      if (tid) headers["X-Tenant-Id"] = tid;
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: { ...headers, ...(opts?.headers as Record<string, string>) },
    });
    const data = (await res.json().catch(() => null)) as T;
    if (!res.ok && !data) {
      console.warn(`API ${url} returned ${res.status} with non-JSON body`);
    }
    return { status: res.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

export async function createTenant(name: string): Promise<{ id: string; name: string }> {
  const { status, data } = await api<{ id: string; name: string }>("/api/admin/tenants", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (status !== 201) throw new Error(`Failed to create tenant: ${status}`);
  return data;
}

export async function createConfig(
  tenantId: string,
  name: string,
): Promise<{ id: string; tenant_id: string; name: string }> {
  const { status, data } = await api<{ id: string; tenant_id: string; name: string }>(
    "/api/v1/configurations",
    {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenantId, name }),
      headers: { "X-Tenant-Id": tenantId },
    },
  );
  if (status !== 201) throw new Error(`Failed to create config: ${status}`);
  configTenantIds.set(data.id, tenantId);
  return data;
}

export async function createEnrollmentToken(
  configId: string,
): Promise<{ id: string; token: string }> {
  const { status, data } = await api<{ id: string; token: string }>(
    `/api/v1/configurations/${configId}/enrollment-token`,
    { method: "POST", body: JSON.stringify({ label: "e2e-collector" }) },
  );
  if (status !== 201) throw new Error(`Failed to create token: ${status}`);
  return data;
}

export async function getConfigStats(configId: string): Promise<{
  total_agents: number;
  connected_agents: number;
  healthy_agents: number;
  active_websockets: number;
}> {
  const { status, data } = await api(`/api/v1/configurations/${configId}/stats`);
  if (status !== 200) throw new Error(`Failed to get stats: ${status}`);
  return data as {
    total_agents: number;
    connected_agents: number;
    healthy_agents: number;
    active_websockets: number;
  };
}

export async function getAgents(
  configId: string,
): Promise<{ agents: Array<Record<string, unknown>> }> {
  const { status, data } = await api(`/api/v1/configurations/${configId}/agents`);
  if (status !== 200) throw new Error(`Failed to get agents: ${status}`);
  return data as { agents: Array<Record<string, unknown>> };
}

export async function healthz(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`${BASE_URL}/healthz`, { signal: controller.signal });
    return res.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function waitForServer(maxWaitMs = 15_000): Promise<void> {
  const start = Date.now();
  let delay = 200;
  while (Date.now() - start < maxWaitMs) {
    if (await healthz()) return;
    await new Promise<void>((r) => {
      setTimeout(r, delay);
    });
    delay = Math.min(delay * 1.5, 2000);
  }
  throw new Error(`Server at ${BASE_URL} not ready after ${maxWaitMs}ms. Run 'just dev' first.`);
}

export function settle(ms = 1000): Promise<void> {
  return new Promise((r) => {
    setTimeout(r, ms);
  });
}

// ─── Docker Config Generation ──────────────────────────────────────────────

/**
 * Generate otelcol-contrib config with opamp extension.
 * The collector connects directly to our OpAMP server via WebSocket.
 */
export function generateExtConfig(token: string): string {
  // Replace localhost/127.0.0.1 with host.docker.internal so containers can reach the host
  const wsEndpoint = WS_URL.replace("localhost", "host.docker.internal").replace(
    "127.0.0.1",
    "host.docker.internal",
  );

  return `extensions:
  opamp:
    server:
      ws:
        endpoint: "${wsEndpoint}"
        headers:
          Authorization: "Bearer ${token}"
        tls:
          insecure: true
    instance_uid: ""
    capabilities:
      reports_effective_config: true
      reports_health: true
      reports_remote_config: true

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: "0.0.0.0:4317"
      http:
        endpoint: "0.0.0.0:4318"

processors:
  batch:
    timeout: 5s

exporters:
  debug:
    verbosity: basic

service:
  extensions: [opamp]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]
`;
}

/**
 * Generate OpAMP Supervisor config.
 * The supervisor manages a collector sub-process and connects to our OpAMP server.
 */
export function generateSupervisorConfig(token: string): string {
  const wsEndpoint = WS_URL.replace("localhost", "host.docker.internal").replace(
    "127.0.0.1",
    "host.docker.internal",
  );

  return `server:
  endpoint: "${wsEndpoint}"
  headers:
    Authorization: "Bearer ${token}"
  tls:
    insecure: true

capabilities:
  reports_effective_config: true
  reports_own_metrics: false
  reports_health: true
  reports_remote_config: true
  accepts_remote_config: true
  accepts_restart_command: true
  accepts_opamp_connection_settings: true

agent:
  executable: /otelcol-contrib

storage:
  directory: /var/lib/opamp-supervisor
`;
}

/** Write generated configs to disk for Docker volume mounts. */
export function writeGeneratedConfigs(token: string): void {
  mkdirSync(GENERATED_DIR, { recursive: true });
  writeFileSync(resolve(GENERATED_DIR, "ext-config.yaml"), generateExtConfig(token));
  writeFileSync(resolve(GENERATED_DIR, "supervisor-config.yaml"), generateSupervisorConfig(token));
}

// ─── Docker Compose Control ────────────────────────────────────────────────

// Use execFileSync with explicit argument arrays so service names and the
// compose-file path can never be re-parsed by a shell. The tests here do
// not pass attacker-controlled input today, but argv-arrays remove the
// footgun entirely.
const COMPOSE_FILE = resolve(DOCKER_DIR, "compose.yaml");

export function dockerComposeUp(services?: string[]): void {
  execFileSync("docker", ["compose", "-f", COMPOSE_FILE, "up", "-d", ...(services ?? [])], {
    stdio: "pipe",
    cwd: DOCKER_DIR,
  });
}

export function dockerComposeDown(): void {
  try {
    execFileSync(
      "docker",
      ["compose", "-f", COMPOSE_FILE, "down", "--volumes", "--remove-orphans"],
      {
        stdio: "pipe",
        cwd: DOCKER_DIR,
      },
    );
  } catch {
    // Ignore errors during cleanup
  }
}

export function dockerComposeLogs(service: string): string {
  try {
    return execFileSync("docker", ["compose", "-f", COMPOSE_FILE, "logs", service, "--tail=50"], {
      encoding: "utf-8",
      cwd: DOCKER_DIR,
    });
  } catch {
    return "(no logs)";
  }
}

export function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
