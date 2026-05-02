import { FakeOpampAgent } from "@o11yfleet/test-utils";

const WORKER_URL = process.env.WORKER_URL!;
const WS_URL = WORKER_URL.replace(/^http/, "ws") + "/v1/opamp";
const API_KEY = process.env.O11YFLEET_API_BEARER_SECRET!;
const ADMIN_EMAIL = process.env.O11YFLEET_SEED_ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.O11YFLEET_SEED_ADMIN_PASSWORD!;
const CONFIG_NAME = process.env.CONFIG_NAME ?? "ci-smoke-collector";
const CONCURRENT_AGENTS = parseInt(process.env.CONCURRENT_AGENTS ?? "3", 10);

let adminSessionCookie: string | null = null;
async function ensureAdminSession(): Promise<string> {
  if (adminSessionCookie) return adminSessionCookie;

  const seedRes = await fetch(`${WORKER_URL}/auth/seed`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!seedRes.ok) throw new Error(`/auth/seed failed: ${seedRes.status} ${await seedRes.text()}`);

  const loginRes = await fetch(`${WORKER_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: WORKER_URL },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!loginRes.ok)
    throw new Error(`/auth/login failed: ${loginRes.status} ${await loginRes.text()}`);

  const match = loginRes.headers.get("set-cookie")?.match(/fp_session=([^;]+)/);
  if (!match) throw new Error(`/auth/login returned no fp_session cookie`);
  adminSessionCookie = `fp_session=${match[1]}`;
  return adminSessionCookie;
}

async function api<T>(path: string, opts?: RequestInit): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (path.startsWith("/api/admin/")) {
    headers.Cookie = await ensureAdminSession();
    headers.Origin = WORKER_URL;
  } else {
    headers.Authorization = `Bearer ${API_KEY}`;
  }
  if (opts?.headers) {
    Object.assign(headers, opts.headers as Record<string, string>);
  }
  const res = await fetch(`${WORKER_URL}${path}`, { ...opts, headers });
  const data = (await res.json().catch(() => null)) as T;
  return { status: res.status, data };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ─── Smoke Tests ─────────────────────────────────────────────────────────

console.log("=== Smoke: Health check ===");
{
  const res = await fetch(`${WORKER_URL}/healthz`);
  if (res.status !== 200) throw new Error(`Health check failed: ${res.status}`);
  console.log("✓ Worker is healthy");
}

console.log("\n=== Smoke: Create tenant ===");
const tenantRes = await api<{ id: string; name: string }>("/api/admin/tenants", {
  method: "POST",
  body: JSON.stringify({ name: `smoke-${Date.now()}` }),
});
if (tenantRes.status !== 201) throw new Error(`Create tenant failed: ${tenantRes.status}`);
const tenantId = tenantRes.data.id;
console.log(`✓ Tenant: ${tenantId}`);

console.log("\n=== Smoke: Create config ===");
const configRes = await api<{ id: string; tenant_id: string }>("/api/v1/configurations", {
  method: "POST",
  body: JSON.stringify({ name: CONFIG_NAME }),
  headers: { "X-Tenant-Id": tenantId },
});
if (configRes.status !== 201) throw new Error(`Create config failed: ${configRes.status}`);
const configId = configRes.data.id;
console.log(`✓ Config: ${configId}`);

console.log("\n=== Smoke: Create enrollment token ===");
const tokenRes = await api<{ token: string }>(
  `/api/v1/configurations/${configId}/enrollment-token`,
  {
    method: "POST",
    body: JSON.stringify({ label: "ci-smoke" }),
    headers: { "X-Tenant-Id": tenantId },
  },
);
if (tokenRes.status !== 201) throw new Error(`Create token failed: ${tokenRes.status}`);
const enrollmentToken = tokenRes.data.token;
console.log(`✓ Enrollment token: ${enrollmentToken.slice(0, 20)}...`);

console.log("\n=== Smoke: Enroll single agent ===");
const agent = new FakeOpampAgent({
  endpoint: WS_URL,
  enrollmentToken,
  name: "ci-smoke-agent",
});
try {
  const enrollment = await agent.connectAndEnroll();
  console.log(`✓ Agent enrolled: ${enrollment.instance_uid}`);
  console.log(`✓ Assignment claim received`);

  // Send heartbeat
  await agent.sendHeartbeat();
  console.log("✓ Heartbeat sent");

  // Send health report
  await agent.sendHealth(true, "smoke-test-ok");
  console.log("✓ Health report sent");

  // Give Durable Object time to process
  await sleep(2000);

  console.log("\n=== Smoke: Verify stats API ===");
  const statsRes = await api<{
    total_agents: number;
    connected_agents: number;
    healthy_agents: number;
  }>(`/api/v1/configurations/${configId}/stats`, { headers: { "X-Tenant-Id": tenantId } });
  if (statsRes.status !== 200) throw new Error(`Stats failed: ${statsRes.status}`);
  console.log(
    `  Stats: total=${statsRes.data.total_agents} connected=${statsRes.data.connected_agents} healthy=${statsRes.data.healthy_agents}`,
  );
  if (statsRes.data.connected_agents < 1)
    throw new Error(`Expected >=1 connected agent, got ${statsRes.data.connected_agents}`);
  if (statsRes.data.healthy_agents < 1)
    throw new Error(`Expected >=1 healthy agent, got ${statsRes.data.healthy_agents}`);
  console.log("✓ Stats API shows enrolled agent");

  console.log("\n=== Smoke: Verify agents API ===");
  const agentsRes = await api<{ agents: Array<Record<string, unknown>> }>(
    `/api/v1/configurations/${configId}/agents`,
    { headers: { "X-Tenant-Id": tenantId } },
  );
  if (agentsRes.status !== 200) throw new Error(`Agents list failed: ${agentsRes.status}`);
  const ourAgent = agentsRes.data.agents.find(
    (a: { instance_uid?: string }) => a.instance_uid === enrollment.instance_uid,
  );
  if (!ourAgent) throw new Error(`Agent not found in agents list`);
  console.log(`✓ Agent appears in agents list: ${ourAgent.instance_uid}`);
} finally {
  agent.close();
}

console.log("\n=== Smoke: Config upload ===");
const yamlConfig = `
receivers:
  otlp:
    protocol: tcp
processors:
  batch:
exporters:
  debug:
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]
`;
const uploadRes = await fetch(`${WORKER_URL}/api/v1/configurations/${configId}/versions`, {
  method: "POST",
  body: yamlConfig,
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "text/yaml",
    "X-Tenant-Id": tenantId,
  },
});
if (uploadRes.status !== 201) throw new Error(`Config upload failed: ${uploadRes.status}`);
const { hash: configHash } = (await uploadRes.json()) as { hash: string };
console.log(`✓ Config uploaded: ${configHash.slice(0, 16)}...`);

console.log("\n=== Smoke: Config rollout ===");
const rolloutRes = await api<{ pushed: number; config_hash: string }>(
  `/api/v1/configurations/${configId}/rollout`,
  { method: "POST", headers: { "X-Tenant-Id": tenantId } },
);
if (rolloutRes.status !== 200) throw new Error(`Rollout failed: ${rolloutRes.status}`);
console.log(
  `  Rollout: pushed=${rolloutRes.data.pushed} hash=${rolloutRes.data.config_hash.slice(0, 16)}...`,
);
console.log("✓ Config rollout executed");

console.log("\n=== Smoke: Concurrent enrollment stress test ===");
const agents: FakeOpampAgent[] = [];
const tokens: string[] = [];
try {
  // Create multiple tokens
  for (let i = 0; i < CONCURRENT_AGENTS; i++) {
    const tRes = await api<{ token: string }>(
      `/api/v1/configurations/${configId}/enrollment-token`,
      {
        method: "POST",
        body: JSON.stringify({ label: `smoke-${i}` }),
        headers: { "X-Tenant-Id": tenantId },
      },
    );
    if (tRes.status !== 201) throw new Error(`Token ${i} failed: ${tRes.status}`);
    tokens.push(tRes.data.token);
  }
  console.log(`✓ Created ${tokens.length} enrollment tokens`);

  // Enroll all concurrently
  const enrollments = await Promise.all(
    tokens.map((token, i) => {
      const a = new FakeOpampAgent({
        endpoint: WS_URL,
        enrollmentToken: token,
        name: `smoke-concurrent-${i}`,
      });
      agents.push(a);
      return a.connectAndEnroll();
    }),
  );
  console.log(`✓ Enrolled ${enrollments.length} agents concurrently`);

  // Heartbeat all
  await Promise.all(agents.map((a) => a.sendHeartbeat()));
  console.log("✓ All agents sent heartbeat");

  // Wait for processing
  await sleep(3000);

  // Check stats
  const statsAfter = await api<{ total_agents: number; connected_agents: number }>(
    `/api/v1/configurations/${configId}/stats`,
    { headers: { "X-Tenant-Id": tenantId } },
  );
  if (statsAfter.data.connected_agents < CONCURRENT_AGENTS) {
    throw new Error(
      `Expected >=${CONCURRENT_AGENTS} connected, got ${statsAfter.data.connected_agents}`,
    );
  }
  console.log(`✓ Concurrent agents verified: ${statsAfter.data.connected_agents} connected`);
} finally {
  for (const a of agents) a.close();
}

console.log("\n=== Smoke: Cleanup tenant ===");
const deleteRes = await fetch(`${WORKER_URL}/api/admin/tenants/${tenantId}`, {
  method: "DELETE",
  headers: { Cookie: await ensureAdminSession(), Origin: WORKER_URL },
});
console.log(`✓ Tenant deleted: HTTP ${deleteRes.status}`);

console.log("\n✅ All smoke tests passed!");
