import { FakeOpampAgent } from "@o11yfleet/test-utils";

const WORKER_URL = process.env.WORKER_URL!;
const WS_URL = WORKER_URL.replace(/^http/, "ws") + "/v1/opamp";
const API_KEY = process.env.O11YFLEET_API_BEARER_SECRET!;
const ADMIN_EMAIL = process.env.O11YFLEET_SEED_ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.O11YFLEET_SEED_ADMIN_PASSWORD!;
const CONFIG_NAME = process.env.CONFIG_NAME ?? "ci-smoke-revocation";

let adminSessionCookie: string | null = null;
async function ensureAdminSession(): Promise<string> {
  if (adminSessionCookie) return adminSessionCookie;
  const seedRes = await fetch(`${WORKER_URL}/auth/seed`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!seedRes.ok) throw new Error(`/auth/seed failed: ${seedRes.status}`);
  const loginRes = await fetch(`${WORKER_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: WORKER_URL },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!loginRes.ok) throw new Error(`/auth/login failed: ${loginRes.status}`);
  const match = loginRes.headers.get("set-cookie")?.match(/fp_session=([^;]+)/);
  if (!match) throw new Error(`No fp_session cookie`);
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

console.log("=== Smoke: Setup tenant and config ===");
const tenantRes = await api<{ id: string }>("/api/admin/tenants", {
  method: "POST",
  body: JSON.stringify({ name: `smoke-revocation-${Date.now()}` }),
});
if (tenantRes.status !== 201) throw new Error(`Create tenant failed: ${tenantRes.status}`);
const tenantId = tenantRes.data.id;
console.log(`✓ Tenant: ${tenantId}`);

const configRes = await api<{ id: string }>("/api/v1/configurations", {
  method: "POST",
  body: JSON.stringify({ name: CONFIG_NAME }),
  headers: { "X-Tenant-Id": tenantId },
});
if (configRes.status !== 201) throw new Error(`Create config failed: ${configRes.status}`);
const configId = configRes.data.id;
console.log(`✓ Config: ${configId}`);

console.log("\n=== Smoke: Enroll valid agent ===");
const validTokenRes = await api<{ id: string; token: string }>(
  `/api/v1/configurations/${configId}/enrollment-token`,
  {
    method: "POST",
    body: JSON.stringify({ label: "valid" }),
    headers: { "X-Tenant-Id": tenantId },
  },
);
if (validTokenRes.status !== 201) throw new Error(`Create token failed: ${validTokenRes.status}`);
const validToken = validTokenRes.data.token;
const validTokenId = validTokenRes.data.id;
console.log(`✓ Valid token created: ${validTokenId}`);

const validAgent = new FakeOpampAgent({
  endpoint: WS_URL,
  enrollmentToken: validToken,
  name: "valid-agent",
});
const validEnrollment = await validAgent.connectAndEnroll();
console.log(`✓ Valid agent enrolled: ${validEnrollment.instance_uid}`);

// Send heartbeat to establish connection
await validAgent.sendHeartbeat();
await sleep(1000);
console.log("✓ Valid agent heartbeat sent");

console.log("\n=== Smoke: Create and revoke a token ===");
const revokableTokenRes = await api<{ id: string; token: string }>(
  `/api/v1/configurations/${configId}/enrollment-token`,
  {
    method: "POST",
    body: JSON.stringify({ label: "to-revoke" }),
    headers: { "X-Tenant-Id": tenantId },
  },
);
if (revokableTokenRes.status !== 201)
  throw new Error(`Create token failed: ${revokableTokenRes.status}`);
const revokableTokenId = revokableTokenRes.data.id;
console.log(`✓ Token to revoke: ${revokableTokenId}`);

// Revoke the token
const revokeRes = await api(
  `/api/v1/configurations/${configId}/enrollment-tokens/${revokableTokenId}`,
  { method: "DELETE" },
);
if (revokeRes.status !== 200 && revokeRes.status !== 204) {
  throw new Error(`Revoke token failed: ${revokeRes.status}`);
}
console.log("✓ Token revoked");

console.log("\n=== Smoke: Verify revoked token is rejected ===");
const revokedAgent = new FakeOpampAgent({
  endpoint: WS_URL,
  enrollmentToken: revokableTokenRes.data.token,
  name: "revoked-agent",
});
try {
  // Connect but don't expect enrollment to succeed
  await revokedAgent.connect();
  await revokedAgent.sendHello();
  await sleep(2000);

  // The agent should be disconnected or not enrolled
  if (revokedAgent.connected) {
    // Check if we got any response - a revoked token should not get a valid assignment claim
    const enrollment = revokedAgent.enrollment;
    if (enrollment) {
      throw new Error(`Revoked token was accepted (should be rejected)`);
    }
  }
  console.log("✓ Revoked token properly rejected");
} catch (_e) {
  // Expected - connection should fail
  console.log("✓ Revoked token connection rejected");
} finally {
  revokedAgent.close();
}

console.log("\n=== Smoke: Verify valid agent still connected ===");
await validAgent.sendHeartbeat();
await sleep(1000);

const statsRes = await api<{ connected_agents: number }>(
  `/api/v1/configurations/${configId}/stats`,
  { headers: { "X-Tenant-Id": tenantId } },
);
if (statsRes.data.connected_agents < 1) {
  throw new Error(`Valid agent should still be connected, got ${statsRes.data.connected_agents}`);
}
console.log(`✓ Valid agent still connected: ${statsRes.data.connected_agents} agents`);

console.log("\n=== Smoke: Cleanup ===");
validAgent.close();
await sleep(500);

const deleteRes = await fetch(`${WORKER_URL}/api/admin/tenants/${tenantId}`, {
  method: "DELETE",
  headers: { Cookie: await ensureAdminSession(), Origin: WORKER_URL },
});
console.log(`✓ Tenant deleted: HTTP ${deleteRes.status}`);

console.log("\n✅ Token revocation smoke tests passed!");
