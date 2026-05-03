#!/usr/bin/env npx tsx
/**
 * scaling-bench.ts — Prove O(1) per-message cost as connection count grows.
 *
 * Opens connections at increasing tiers (500, 1K, 2K, 5K, 10K, 15K) on a
 * single local workerd, then fires a burst of measured heartbeat probes at
 * each tier. If per-message latency stays flat, the DO code scales to 30K+
 * (production hibernation makes the connection holding cost ~0).
 *
 * Also pre-populates 30K agent rows in SQLite (via enrollment+close cycles)
 * to prove the query/write path handles a fat table.
 *
 * Usage:
 *   pnpm --filter @o11yfleet/load-test bench
 *   FP_URL=https://staging.example.com pnpm --filter @o11yfleet/load-test bench
 *
 * Environment:
 *   FP_URL         — Base URL (default: http://localhost:8787)
 *   FP_TENANT_ID   — Existing tenant to use (required for deployed workers)
 *   FP_API_KEY     — API bearer token
 */

import { FakeOpampAgent } from "@o11yfleet/test-utils";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env["FP_URL"] ?? "http://localhost:8787";
const WS_URL = BASE_URL.replace(/^http/, "ws") + "/v1/opamp";
const API_KEY = process.env["FP_API_KEY"] ?? "test-api-secret-for-dev-only-32chars";

// Connection tiers to test (each tier adds connections to reach the target)
const TIERS = [500, 1_000, 2_000, 5_000, 10_000, 15_000];
const PROBES_PER_TIER = 200; // Number of measured heartbeat round-trips per tier
const PROBE_CONCURRENCY = 50; // Parallel heartbeat probes
const ENROLLMENT_CONCURRENCY = 100;

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const TENANT_ID = process.env["FP_TENANT_ID"] ?? "";

async function apiJson<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      ...(TENANT_ID ? { "X-Tenant-Id": TENANT_ID } : {}),
      ...opts?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${opts?.method ?? "GET"} ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function setupInfra(): Promise<{ configId: string; token: string }> {
  let tenant: { id: string };
  if (TENANT_ID) {
    tenant = { id: TENANT_ID };
  } else {
    try {
      tenant = await apiJson<{ id: string }>("/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify({ name: `bench-${Date.now()}` }),
      });
    } catch {
      throw new Error("Set FP_TENANT_ID for deployed workers");
    }
  }

  const config = await apiJson<{ id: string }>("/api/v1/configurations", {
    method: "POST",
    body: JSON.stringify({ name: `bench-config-${Date.now()}` }),
    headers: { "X-Tenant-Id": tenant.id },
  });

  const yaml = `receivers:\n  otlp:\n    protocols:\n      grpc:\n        endpoint: "0.0.0.0:4317"\nexporters:\n  debug:\n    verbosity: basic\nservice:\n  pipelines:\n    traces:\n      receivers: [otlp]\n      exporters: [debug]\n`;
  await fetch(`${BASE_URL}/api/v1/configurations/${config.id}/versions`, {
    method: "POST",
    body: yaml,
    headers: {
      "Content-Type": "text/yaml",
      Authorization: `Bearer ${API_KEY}`,
      "X-Tenant-Id": tenant.id,
    },
  });

  const { token } = await apiJson<{ token: string }>(
    `/api/v1/configurations/${config.id}/enrollment-token`,
    {
      method: "POST",
      body: JSON.stringify({ label: "bench" }),
      headers: { "X-Tenant-Id": tenant.id },
    },
  );

  return { configId: config.id, token };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TierResult {
  connections: number;
  probes: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
  rssBeforeMB: number;
  rssAfterMB: number;
  enrollRate: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: sorted.length ? sum / sorted.length : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

async function enrollBatch(
  token: string,
  count: number,
  agents: FakeOpampAgent[],
): Promise<{ succeeded: number; failed: number; elapsed: number }> {
  const t0 = performance.now();
  let succeeded = 0;
  let failed = 0;
  const pending: Promise<void>[] = [];

  for (let i = 0; i < count; i++) {
    pending.push(
      (async () => {
        const agent = new FakeOpampAgent({
          endpoint: WS_URL,
          enrollmentToken: token,
          name: "bench-agent",
          autoHeartbeat: false,
        });
        try {
          await agent.connectAndEnroll();
          agents.push(agent);
          succeeded++;
        } catch {
          failed++;
        }
      })(),
    );
    if (pending.length >= ENROLLMENT_CONCURRENCY) {
      await Promise.all(pending);
      pending.length = 0;
    }
  }
  if (pending.length) await Promise.all(pending);

  return { succeeded, failed, elapsed: performance.now() - t0 };
}

async function probeHeartbeats(agents: FakeOpampAgent[], count: number): Promise<number[]> {
  const samples: number[] = [];
  // Pick random agents to probe
  const probeAgents = [];
  for (let i = 0; i < count; i++) {
    probeAgents.push(agents[Math.floor(Math.random() * agents.length)]!);
  }

  const pending: Promise<void>[] = [];
  for (const agent of probeAgents) {
    pending.push(
      (async () => {
        try {
          const t0 = performance.now();
          await agent.sendHeartbeat();
          const resp = await agent.waitForMessage(10_000);
          if (resp) {
            samples.push(performance.now() - t0);
          }
        } catch {
          // skip failed probes
        }
      })(),
    );
    if (pending.length >= PROBE_CONCURRENCY) {
      await Promise.all(pending);
      pending.length = 0;
    }
  }
  if (pending.length) await Promise.all(pending);

  return samples;
}

// ---------------------------------------------------------------------------
// SQLite stress test — prove 30K rows don't degrade queries
// ---------------------------------------------------------------------------

async function sqliteStressTest(
  token: string,
  configId: string,
  targetRows: number,
): Promise<void> {
  console.log(`\n📊 SQLite Stress Test: populating ${targetRows.toLocaleString()} agent rows...`);

  // Enroll agents in batches and immediately close them to create rows
  // without holding connections open
  const BATCH = 500;
  let totalCreated = 0;

  for (let offset = 0; offset < targetRows; offset += BATCH) {
    const batchSize = Math.min(BATCH, targetRows - offset);
    const agents: FakeOpampAgent[] = [];

    await enrollBatch(token, batchSize, agents);
    totalCreated += agents.length;

    // Close all connections (rows stay in SQLite as "disconnected")
    for (const a of agents) {
      try {
        a.close();
      } catch {
        /* best effort */
      }
    }

    process.stdout.write(
      `\r   Created ${totalCreated.toLocaleString()} / ${targetRows.toLocaleString()} rows`,
    );
  }
  console.log();

  // Now measure query latency with fat table
  console.log(`   Measuring stats query with ${totalCreated.toLocaleString()} rows...`);
  const queryTimes: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    await apiJson(`/api/v1/configurations/${configId}/stats`);
    queryTimes.push(performance.now() - t0);
  }
  const qs = summarize(queryTimes);
  console.log(
    `   Stats query: P50=${qs.p50.toFixed(1)}ms  P95=${qs.p95.toFixed(1)}ms  P99=${qs.p99.toFixed(1)}ms`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║        o11yfleet DO Scaling Benchmark                   ║
╚══════════════════════════════════════════════════════════╝

  Target:     ${BASE_URL}
  Tiers:      ${TIERS.join(", ")}
  Probes:     ${PROBES_PER_TIER} heartbeats/tier
  Concurrency: ${PROBE_CONCURRENCY} parallel probes
`);

  const { configId, token } = await setupInfra();
  console.log(`   Config: ${configId}`);
  console.log(`   Token:  ${token.slice(0, 20)}...`);

  const agents: FakeOpampAgent[] = [];
  const results: TierResult[] = [];

  try {
    // ─── Tier-by-tier scaling test ────────────────────────────────────
    for (const tier of TIERS) {
      const toAdd = tier - agents.length;
      if (toAdd <= 0) continue;

      const rssBeforeMB = process.memoryUsage.rss() / 1024 / 1024;

      console.log(
        `\n🔧 Tier ${tier.toLocaleString()}: enrolling ${toAdd.toLocaleString()} more agents...`,
      );
      const enrollResult = await enrollBatch(token, toAdd, agents);
      const enrollRate = enrollResult.succeeded / (enrollResult.elapsed / 1000);

      if (enrollResult.failed > toAdd * 0.5) {
        console.log(
          `   ⚠️  ${enrollResult.failed}/${toAdd} enrollment failures — local workerd ceiling reached.`,
        );
        console.log(
          `   Reached ${agents.length.toLocaleString()} connections (target was ${tier.toLocaleString()}).`,
        );

        if (agents.length >= 100) {
          // Still probe at current level
          console.log(
            `   Probing ${PROBES_PER_TIER} heartbeats at ${agents.length.toLocaleString()} connections...`,
          );
          const samples = await probeHeartbeats(agents, PROBES_PER_TIER);
          const s = summarize(samples);
          const rssAfterMB = process.memoryUsage.rss() / 1024 / 1024;
          results.push({
            connections: agents.length,
            probes: samples.length,
            ...s,
            rssBeforeMB,
            rssAfterMB,
            enrollRate,
          });
        }
        break;
      }

      console.log(
        `   ✅ ${agents.length.toLocaleString()} connected (${enrollRate.toFixed(0)} enroll/s)`,
      );

      // Let connections settle
      await new Promise((r) => {
        setTimeout(r, 2000);
      });
      console.log(`   Probing ${PROBES_PER_TIER} heartbeats...`);
      const samples = await probeHeartbeats(agents, PROBES_PER_TIER);
      const s = summarize(samples);
      const rssAfterMB = process.memoryUsage.rss() / 1024 / 1024;

      console.log(
        `   Heartbeat RTT: P50=${s.p50.toFixed(1)}ms  P95=${s.p95.toFixed(1)}ms  P99=${s.p99.toFixed(1)}ms  (${samples.length}/${PROBES_PER_TIER} ok)`,
      );

      results.push({
        connections: tier,
        probes: samples.length,
        ...s,
        rssBeforeMB,
        rssAfterMB,
        enrollRate,
      });
    }

    // ─── Scaling report ──────────────────────────────────────────────
    console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                         Scaling Results                                     ║
╠═══════════════╦═══════════╦═══════════╦═══════════╦═══════════╦═════════════╣
║  Connections  ║  P50 (ms) ║  P95 (ms) ║  P99 (ms) ║  Max (ms) ║  Client RSS ║
╠═══════════════╬═══════════╬═══════════╬═══════════╬═══════════╬═════════════╣`);

    for (const r of results) {
      console.log(
        `║  ${String(r.connections).padStart(11)} ║ ${r.p50.toFixed(1).padStart(9)} ║ ${r.p95.toFixed(1).padStart(9)} ║ ${r.p99.toFixed(1).padStart(9)} ║ ${r.max.toFixed(1).padStart(9)} ║ ${r.rssAfterMB.toFixed(0).padStart(8)} MB ║`,
      );
    }
    console.log(`╚═══════════════╩═══════════╩═══════════╩═══════════╩═══════════╩═════════════╝`);

    // ─── O(1) assessment ─────────────────────────────────────────────
    if (results.length >= 2) {
      const first = results[0]!;
      const last = results[results.length - 1]!;
      const ratio = last.p50 / first.p50;
      const connRatio = last.connections / first.connections;

      console.log(`\n📈 Scaling analysis:`);
      console.log(
        `   Connection range: ${first.connections.toLocaleString()} → ${last.connections.toLocaleString()} (${connRatio.toFixed(1)}×)`,
      );
      console.log(
        `   P50 latency range: ${first.p50.toFixed(1)}ms → ${last.p50.toFixed(1)}ms (${ratio.toFixed(2)}×)`,
      );

      if (ratio < 2.0) {
        console.log(
          `   ✅ Per-message cost is O(1) — latency ratio ${ratio.toFixed(2)}× across ${connRatio.toFixed(0)}× connections`,
        );
        console.log(
          `   ✅ Extrapolation: 30K connections would have ~${(first.p50 * ratio).toFixed(1)}ms P50 heartbeat RTT`,
        );
      } else if (ratio < connRatio) {
        console.log(
          `   ⚠️  Sub-linear scaling (${ratio.toFixed(2)}× latency for ${connRatio.toFixed(0)}× connections)`,
        );
        console.log(
          `   Extrapolated 30K P50: ~${(first.p50 * Math.pow(ratio, Math.log(30000 / first.connections) / Math.log(connRatio))).toFixed(1)}ms`,
        );
      } else {
        console.log(`   ❌ Linear or worse scaling — investigate DO hot paths`);
      }
    }

    // ─── SQLite stress (30K rows without holding connections) ─────────
    // Close all current connections first to free workerd resources
    console.log(
      `\n🧹 Closing ${agents.length.toLocaleString()} connections for SQLite stress test...`,
    );
    for (const a of agents) a.close();
    agents.length = 0;
    await new Promise((r) => {
      setTimeout(r, 2000);
    });

    await sqliteStressTest(token, configId, 30_000);
  } finally {
    // Cleanup
    if (agents.length > 0) {
      console.log(`\n🧹 Closing ${agents.length.toLocaleString()} remaining connections...`);
      for (const a of agents) a.close();
    }
  }

  console.log(`\n✅ Benchmark complete.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
