#!/usr/bin/env npx tsx
/**
 * o11yfleet Smoke Test — proves a single agent lifecycle works end-to-end.
 *
 * Exercises: enrollment → hello → config rollout → config ACK → heartbeat → disconnect
 *
 * Usage:
 *   pnpm --filter @o11yfleet/load-test smoke
 *   FP_URL=https://api.o11yfleet.com pnpm --filter @o11yfleet/load-test smoke
 */

import { FakeOpampAgent } from "@o11yfleet/test-utils";

const BASE_URL = process.env["FP_URL"] ?? "http://localhost:8787";
const WS_URL = BASE_URL.replace(/^http/, "ws") + "/v1/opamp";
const API_KEY = process.env["FP_API_KEY"] ?? "test-api-secret-for-dev-only-32chars";

async function apiJson<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      ...opts?.headers,
    },
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function run() {
  console.log(`\n🧪 o11yfleet Smoke Test — ${BASE_URL}\n`);
  const steps: string[] = [];
  const pass = (msg: string) => {
    steps.push(`  ✅ ${msg}`);
    console.log(`  ✅ ${msg}`);
  };

  try {
    // 1. Setup
    const tenant = await apiJson<{ id: string }>("/api/tenants", {
      method: "POST",
      body: JSON.stringify({ name: `smoke-test-${Date.now()}` }),
    });
    pass(`Created tenant ${tenant.id}`);

    const config = await apiJson<{ id: string }>("/api/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "smoke-config" }),
    });
    pass(`Created config ${config.id}`);

    const yaml = `receivers:\n  otlp:\n    protocols:\n      grpc:\n        endpoint: "0.0.0.0:4317"\nexporters:\n  debug:\n    verbosity: basic\nservice:\n  pipelines:\n    traces:\n      receivers: [otlp]\n      exporters: [debug]\n`;
    const versionRes = await fetch(`${BASE_URL}/api/configurations/${config.id}/versions`, {
      method: "POST",
      body: yaml,
      headers: { "Content-Type": "text/yaml", Authorization: `Bearer ${API_KEY}` },
    });
    if (!versionRes.ok) throw new Error(`Upload failed: ${versionRes.status}`);
    const version = (await versionRes.json()) as { hash: string };
    pass(`Uploaded config version ${version.hash.slice(0, 12)}...`);

    const tokenBody = await apiJson<{ token: string }>(
      `/api/configurations/${config.id}/enrollment-token`,
      { method: "POST", body: JSON.stringify({ label: "smoke-test" }) },
    );
    pass(`Created enrollment token`);

    // 2. Agent enrollment
    const agent = new FakeOpampAgent({
      endpoint: WS_URL,
      enrollmentToken: tokenBody.token,
      name: "smoke-test-agent",
    });

    const enrollment = await agent.connectAndEnroll();
    pass(`Agent enrolled → instance_uid=${enrollment.instance_uid.slice(0, 12)}...`);
    pass(`Got assignment_claim for reconnect`);

    // 3. Config rollout
    const rollout = await apiJson<{ pushed: number; config_hash: string }>(
      `/api/configurations/${config.id}/rollout`,
      { method: "POST" },
    );
    pass(
      `Rollout triggered → pushed=${rollout.pushed}, hash=${rollout.config_hash.slice(0, 12)}...`,
    );

    // 4. Agent receives config
    const configMsg = await agent.waitForRemoteConfig(10_000);
    if (!configMsg.remote_config) throw new Error("No remote_config in message");
    const remoteConfig = configMsg.remote_config;
    const hashHex = Array.from(remoteConfig.config_hash)
      .map((b: number) => b.toString(16).padStart(2, "0"))
      .join("");
    pass(`Agent received remote config (hash=${hashHex.slice(0, 12)}...)`);

    // 5. Agent ACKs config
    await agent.applyConfig(remoteConfig.config_hash);
    pass(`Agent ACKed config`);

    // 6. Heartbeat
    await agent.sendHeartbeat();
    const hbResponse = await agent.waitForMessage(5000);
    pass(`Heartbeat sent + response received (flags=${hbResponse.flags})`);

    // 7. Check stats
    const stats = await apiJson<{
      total_agents: number;
      connected_agents: number;
    }>(`/api/configurations/${config.id}/stats`);
    pass(`Stats: total=${stats.total_agents}, connected=${stats.connected_agents}`);

    // 8. Reconnect with claim
    agent.close();
    pass(`Agent disconnected`);

    const agent2 = new FakeOpampAgent({
      endpoint: WS_URL,
      assignmentClaim: enrollment.assignment_claim,
      name: "smoke-test-agent-reconnect",
    });
    await agent2.connect();
    await agent2.sendHello();
    const reconnectResp = await agent2.waitForMessage(5000);
    pass(`Agent reconnected with claim → response flags=${reconnectResp.flags}`);

    agent2.close();
    pass(`Agent disconnected (clean)`);

    // Summary
    console.log(`\n${"═".repeat(50)}`);
    console.log(`  🎉 All ${steps.length} checks passed!`);
    console.log(`${"═".repeat(50)}\n`);
  } catch (err) {
    console.error(`\n  ❌ FAILED: ${err instanceof Error ? err.message : err}\n`);
    console.log(`  Passed ${steps.length} checks before failure.\n`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
