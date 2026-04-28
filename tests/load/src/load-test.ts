#!/usr/bin/env npx tsx
/**
 * o11yfleet Load Test — simulates N OpAMP agents connecting to the platform.
 *
 * Usage:
 *   pnpm --filter @o11yfleet/load-test load
 *   pnpm --filter @o11yfleet/load-test load -- --agents=100 --ramp=30 --steady=60
 *   FP_URL=https://api.o11yfleet.com pnpm --filter @o11yfleet/load-test load
 *
 * Environment:
 *   FP_URL           — Base URL (default: http://localhost:8787)
 *   FP_AGENTS        — Number of agents (default: 50)
 *   FP_RAMP_SEC      — Ramp-up duration in seconds (default: 10)
 *   FP_STEADY_SEC    — Steady-state duration in seconds (default: 30)
 *   FP_HEARTBEAT_SEC — Heartbeat interval in seconds (default: 10)
 */

import { FakeOpampAgent } from "@o11yfleet/test-utils";
import {
  createTracker,
  createCounters,
  record,
  summarize,
  countError,
  printReport,
  reportToJson,
  type CounterSet,
  type LatencyTracker,
} from "./metrics.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface LoadTestConfig {
  baseUrl: string;
  wsUrl: string;
  agents: number;
  rampSeconds: number;
  steadySeconds: number;
  heartbeatSeconds: number;
}

function parseConfig(): LoadTestConfig {
  const args = process.argv.slice(2);
  const get = (name: string, envKey: string, def: string) => {
    const arg = args.find((a) => a.startsWith(`--${name}=`));
    if (arg) return arg.split("=")[1]!;
    return process.env[envKey] ?? def;
  };

  const baseUrl = get("url", "FP_URL", "http://localhost:8787");
  return {
    baseUrl,
    wsUrl: baseUrl.replace(/^http/, "ws") + "/v1/opamp",
    agents: parseInt(get("agents", "FP_AGENTS", "50"), 10),
    rampSeconds: parseInt(get("ramp", "FP_RAMP_SEC", "10"), 10),
    steadySeconds: parseInt(get("steady", "FP_STEADY_SEC", "30"), 10),
    heartbeatSeconds: parseInt(get("heartbeat", "FP_HEARTBEAT_SEC", "10"), 10),
  };
}

// ---------------------------------------------------------------------------
// API helpers (inline — avoids importing from e2e test helpers)
// ---------------------------------------------------------------------------

const API_KEY = process.env["FP_API_KEY"] ?? "test-api-secret-for-dev-only-32chars";

async function apiJson<T>(baseUrl: string, path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      ...opts?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${opts?.method ?? "GET"} ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function setupTestInfra(baseUrl: string) {
  console.log("📦 Setting up test infrastructure...");

  const tenant = await apiJson<{ id: string }>(baseUrl, "/api/tenants", {
    method: "POST",
    body: JSON.stringify({ name: `load-test-${Date.now()}` }),
  });
  console.log(`   Tenant: ${tenant.id}`);

  const config = await apiJson<{ id: string }>(baseUrl, "/api/configurations", {
    method: "POST",
    body: JSON.stringify({ tenant_id: tenant.id, name: "load-test-config" }),
  });
  console.log(`   Config: ${config.id}`);

  // Upload a basic YAML config
  const yaml = `receivers:\n  otlp:\n    protocols:\n      grpc:\n        endpoint: "0.0.0.0:4317"\nexporters:\n  debug:\n    verbosity: basic\nservice:\n  pipelines:\n    traces:\n      receivers: [otlp]\n      exporters: [debug]\n`;
  const res = await fetch(`${baseUrl}/api/configurations/${config.id}/versions`, {
    method: "POST",
    body: yaml,
    headers: { "Content-Type": "text/yaml", Authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) throw new Error(`Upload config failed: ${res.status}`);
  const version = (await res.json()) as { hash: string };
  console.log(`   Config version: ${version.hash.slice(0, 12)}...`);

  const token = await apiJson<{ token: string }>(
    baseUrl,
    `/api/configurations/${config.id}/enrollment-token`,
    { method: "POST", body: JSON.stringify({ label: "load-test" }) },
  );
  console.log(`   Enrollment token: ${token.token.slice(0, 20)}...`);

  return { tenant, config, token: token.token };
}

// ---------------------------------------------------------------------------
// Agent lifecycle
// ---------------------------------------------------------------------------

interface ManagedAgent {
  agent: FakeOpampAgent;
  assignmentClaim: string | null;
  lastHeartbeat: number;
}

async function enrollAgent(
  wsUrl: string,
  enrollmentToken: string,
  idx: number,
  counters: CounterSet,
  connectTracker: LatencyTracker,
  enrollTracker: LatencyTracker,
): Promise<ManagedAgent | null> {
  const agent = new FakeOpampAgent({
    endpoint: wsUrl,
    enrollmentToken,
    name: `load-agent-${idx}`,
  });

  counters.connectAttempted++;
  const t0 = performance.now();

  try {
    const enrollment = await agent.connectAndEnroll();
    const connectMs = performance.now() - t0;

    counters.connectSucceeded++;
    counters.enrollmentCompleted++;
    counters.messagesSent++; // hello sent during enrollment
    counters.messagesReceived += 2; // enrollment_complete text + binary response
    record(connectTracker, connectMs);
    record(enrollTracker, connectMs);

    return {
      agent,
      assignmentClaim: enrollment.assignment_claim,
      lastHeartbeat: Date.now(),
    };
  } catch (err) {
    const errorMs = performance.now() - t0;
    counters.connectFailed++;
    record(connectTracker, errorMs);
    const msg = err instanceof Error ? err.message : String(err);
    countError(counters, msg.includes("Timeout") ? "connect_timeout" : "connect_error");
    return null;
  }
}

async function sendHeartbeat(
  managed: ManagedAgent,
  counters: CounterSet,
  rttTracker: LatencyTracker,
): Promise<boolean> {
  try {
    const t0 = performance.now();
    await managed.agent.sendHeartbeat();
    counters.messagesSent++;

    const response = await managed.agent.waitForMessage(5000);
    if (response) {
      counters.messagesReceived++;
      record(rttTracker, performance.now() - t0);
    }

    managed.lastHeartbeat = Date.now();
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    countError(counters, msg.includes("Timeout") ? "heartbeat_timeout" : "heartbeat_error");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  const cfg = parseConfig();
  console.log(`
🔥 o11yfleet Load Test
   Target:    ${cfg.baseUrl}
   Agents:    ${cfg.agents}
   Ramp:      ${cfg.rampSeconds}s
   Steady:    ${cfg.steadySeconds}s
   Heartbeat: every ${cfg.heartbeatSeconds}s
`);

  // Setup
  const { token } = await setupTestInfra(cfg.baseUrl);

  const counters = createCounters();
  const connectTracker = createTracker("connect");
  const enrollTracker = createTracker("enrollment");
  const heartbeatTracker = createTracker("heartbeat_rtt");
  let peakMemoryMB = 0;

  const trackMemory = () => {
    const mb = process.memoryUsage().rss / 1024 / 1024;
    if (mb > peakMemoryMB) peakMemoryMB = mb;
  };

  const startTime = performance.now();

  // Phase 1: Ramp-up — enroll agents with linear spacing
  console.log("\n🚀 Phase 1: Ramp-up (enrolling agents)...");
  const delayPerAgent = (cfg.rampSeconds * 1000) / cfg.agents;
  const managed: ManagedAgent[] = [];

  for (let i = 0; i < cfg.agents; i++) {
    const result = await enrollAgent(cfg.wsUrl, token, i, counters, connectTracker, enrollTracker);
    if (result) managed.push(result);

    if ((i + 1) % 10 === 0 || i === cfg.agents - 1) {
      trackMemory();
      process.stdout.write(
        `\r   Enrolled: ${managed.length}/${i + 1} attempted (${counters.connectFailed} failed)`,
      );
    }

    if (delayPerAgent > 0 && i < cfg.agents - 1) {
      await new Promise((r) => setTimeout(r, delayPerAgent));
    }
  }
  console.log(`\n   ✅ Ramp-up complete: ${managed.length} agents connected`);

  // Phase 2: Steady-state — heartbeat loop
  console.log(
    `\n💓 Phase 2: Steady-state (${cfg.steadySeconds}s, heartbeat every ${cfg.heartbeatSeconds}s)...`,
  );
  const steadyDeadline = Date.now() + cfg.steadySeconds * 1000;
  let heartbeatRound = 0;

  while (Date.now() < steadyDeadline) {
    heartbeatRound++;
    const roundStart = performance.now();

    // Send heartbeats to all connected agents
    const alive: ManagedAgent[] = [];
    const promises = managed.map(async (m) => {
      const ok = await sendHeartbeat(m, counters, heartbeatTracker);
      if (ok && m.agent.connected) alive.push(m);
      else m.agent.close();
    });
    await Promise.all(promises);

    trackMemory();
    const roundMs = performance.now() - roundStart;
    const remaining = Math.max(0, cfg.heartbeatSeconds * 1000 - roundMs);

    process.stdout.write(
      `\r   Round ${heartbeatRound}: ${alive.length} alive, round took ${roundMs.toFixed(0)}ms`,
    );

    // Replace managed array with surviving agents
    managed.length = 0;
    managed.push(...alive);

    if (remaining > 0 && Date.now() < steadyDeadline) {
      await new Promise((r) => setTimeout(r, Math.min(remaining, steadyDeadline - Date.now())));
    }
  }

  // Phase 3: Teardown
  console.log(`\n\n🧹 Phase 3: Teardown (closing ${managed.length} connections)...`);
  for (const m of managed) {
    m.agent.close();
  }

  const durationSeconds = (performance.now() - startTime) / 1000;
  trackMemory();

  // Report
  const report = {
    target: cfg.baseUrl,
    agents: cfg.agents,
    rampUpSeconds: cfg.rampSeconds,
    steadyStateSeconds: cfg.steadySeconds,
    heartbeatIntervalSeconds: cfg.heartbeatSeconds,
    counters,
    connect: summarize(connectTracker),
    enrollment: summarize(enrollTracker),
    heartbeatRtt: summarize(heartbeatTracker),
    peakMemoryMB,
    durationSeconds,
  };

  printReport(report);

  // Write JSON report
  const jsonPath = `load-test-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const fs = await import("node:fs/promises");
  await fs.writeFile(jsonPath, reportToJson(report));
  console.log(`📄 JSON report written to ${jsonPath}`);

  // Exit with error if too many failures
  const failRate = counters.connectFailed / counters.connectAttempted;
  if (failRate > 0.1) {
    console.error(`\n❌ Failure rate too high: ${(failRate * 100).toFixed(1)}%`);
    process.exit(1);
  }

  console.log("\n✅ Load test completed successfully.");
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
