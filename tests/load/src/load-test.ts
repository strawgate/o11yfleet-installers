#!/usr/bin/env npx tsx
/**
 * o11yfleet Load Test — scalable WebSocket load test for OpAMP Durable Objects.
 *
 * Tests enrollment throughput, connection capacity, and heartbeat latency
 * at scale from 100 to 100,000+ agents.
 *
 * Usage:
 *   pnpm --filter @o11yfleet/load-test load                              # default: 50 agents
 *   pnpm --filter @o11yfleet/load-test load -- --agents=1000 --ramp=30
 *   pnpm --filter @o11yfleet/load-test load -- --agents=5000 --concurrency=200
 *   pnpm --filter @o11yfleet/load-test load -- --agents=100000 --workers=10
 *
 * Environment:
 *   FP_URL             — Base URL (default: http://localhost:8787)
 *   FP_AGENTS          — Number of agents (default: 50)
 *   FP_RAMP_SEC        — Ramp-up duration in seconds (default: 10)
 *   FP_STEADY_SEC      — Steady-state duration in seconds (default: 30)
 *   FP_HEARTBEAT_SEC   — Heartbeat interval in seconds (default: 10)
 *   FP_CONCURRENCY     — Parallel enrollment batch size (default: auto)
 *   FP_WORKERS         — Number of child processes for 10K+ (default: 1)
 *   FP_API_KEY         — API bearer token
 */

import { FakeOpampAgent, REAL_COLLECTOR_PIPELINES } from "@o11yfleet/test-utils";
import type { AgentProfile, BehaviorConfig } from "@o11yfleet/test-utils";
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
  concurrency: number;
  workers: number;
  /** Skip heartbeat probe messages during steady-state (passive monitoring only) */
  noProbes: boolean;
  /** When running as a child worker, receive setup info from parent */
  isWorker: boolean;
  workerId: number;
  workerAgents: number;
  /** Named population profile describing how to distribute agent behaviors */
  profile: PopulationProfileName;
}

// ---------------------------------------------------------------------------
// Population Profiles
// ---------------------------------------------------------------------------
//
// A population profile describes what fraction of agents run each behavior mode.
// This lets us simulate realistic fleet conditions (e.g., 15% failing exporters,
// 5% flapping) without hard-coding behavior in the agent logic.
//
// Built-in profiles:
//   healthy       — all agents healthy (baseline, no turmoil)
//   realistic-30k — production-realistic 30K fleet with turmoil
//   chaos         — high turmoil fleet for stress testing

export type PopulationProfileName = "healthy" | "realistic-30k" | "chaos" | "custom";

interface BehaviorBucket {
  behavior: BehaviorConfig;
  /** Fraction of agents to run this behavior (0–1, must sum to 1.0) */
  fraction: number;
}

const POPULATION_PROFILES: Record<Exclude<PopulationProfileName, "custom">, BehaviorBucket[]> = {
  /** All agents steady-state healthy. Use for baseline throughput measurement. */
  healthy: [{ behavior: { mode: "healthy" }, fraction: 1.0 }],

  /**
   * Production-realistic 30K fleet:
   * - 60% healthy (steady heartbeats)
   * - 20% failing-exporter (synthetic health turmoil; real otelcol doesn't emit StatusRecoverableError
   *   for export failures, but this exercises the server's health-state handling under load)
   * - 10% flapping (network instability, 5 min interval)
   * - 5% restarting (supervisor-managed restarts, 5 min interval)
   * - 5% config-rejecting (misconfigured collectors)
   */
  "realistic-30k": [
    { behavior: { mode: "healthy" }, fraction: 0.6 },
    {
      behavior: { mode: "failing-exporter", cycleSeconds: 120, exporter: "otlphttp" },
      fraction: 0.2,
    },
    { behavior: { mode: "flapping", flapIntervalSeconds: 300, offlineSeconds: 30 }, fraction: 0.1 },
    { behavior: { mode: "restarting", restartIntervalSeconds: 300 }, fraction: 0.05 },
    { behavior: { mode: "config-rejecting" }, fraction: 0.05 },
  ],

  /**
   * High-chaos fleet for stress testing:
   * - 30% healthy
   * - 25% failing-exporter (fast cycles)
   * - 25% flapping (frequent, short offline)
   * - 10% restarting (frequent)
   * - 10% config-rejecting
   */
  chaos: [
    { behavior: { mode: "healthy" }, fraction: 0.3 },
    {
      behavior: { mode: "failing-exporter", cycleSeconds: 60, exporter: "otlphttp" },
      fraction: 0.25,
    },
    { behavior: { mode: "flapping", flapIntervalSeconds: 60, offlineSeconds: 10 }, fraction: 0.25 },
    { behavior: { mode: "restarting", restartIntervalSeconds: 60 }, fraction: 0.1 },
    { behavior: { mode: "config-rejecting" }, fraction: 0.1 },
  ],
};

/** Resolve the behavior config for agent index `idx` given a population profile. */
function behaviorForAgent(
  idx: number,
  total: number,
  profile: PopulationProfileName,
): BehaviorConfig {
  if (profile === "custom") return { mode: "healthy" };
  const buckets = POPULATION_PROFILES[profile];
  const position = idx / total;
  let cumulative = 0;
  for (const bucket of buckets) {
    cumulative += bucket.fraction;
    if (position < cumulative) return bucket.behavior;
  }
  return buckets[buckets.length - 1]!.behavior;
}

function parseConfig(): LoadTestConfig {
  const args = process.argv.slice(2);
  const get = (name: string, envKey: string, def: string) => {
    const arg = args.find((a) => a.startsWith(`--${name}=`));
    if (arg) return arg.split("=")[1]!;
    return process.env[envKey] ?? def;
  };

  const baseUrl = get("url", "FP_URL", "http://localhost:8787");
  const agents = parseInt(get("agents", "FP_AGENTS", "50"), 10);

  // Auto-tune concurrency: keep enrollment batches small enough to avoid
  // overwhelming the DO with simultaneous WebSocket upgrades. Each upgrade
  // is an HTTP request through the Worker → D1 lookup → DO.fetch chain.
  // 50 concurrent is safe for staging; local miniflare can handle more.
  const isLocal = get("url", "FP_URL", "http://localhost:8787").includes("localhost");
  const defaultConcurrency = isLocal
    ? agents <= 100
      ? 10
      : agents <= 1000
        ? 50
        : 100
    : agents <= 100
      ? 10
      : 50;

  const concurrency = parseInt(
    get("concurrency", "FP_CONCURRENCY", String(defaultConcurrency)),
    10,
  );
  const workers = parseInt(get("workers", "FP_WORKERS", "1"), 10);

  const isWorker = get("worker-id", "__FP_WORKER_ID", "") !== "";
  const workerId = parseInt(get("worker-id", "__FP_WORKER_ID", "0"), 10);
  const workerAgents = parseInt(get("worker-agents", "__FP_WORKER_AGENTS", String(agents)), 10);
  const noProbes = args.includes("--no-probes") || process.env["FP_NO_PROBES"] === "1";
  const profileArg = get("profile", "FP_PROFILE", "healthy") as PopulationProfileName;

  return {
    baseUrl,
    wsUrl: baseUrl.replace(/^http/, "ws") + "/v1/opamp",
    agents,
    rampSeconds: parseInt(get("ramp", "FP_RAMP_SEC", "10"), 10),
    steadySeconds: parseInt(get("steady", "FP_STEADY_SEC", "30"), 10),
    heartbeatSeconds: parseInt(get("heartbeat", "FP_HEARTBEAT_SEC", "10"), 10),
    concurrency,
    workers,
    noProbes,
    isWorker,
    workerId,
    workerAgents,
    profile: profileArg,
  };
}

// ---------------------------------------------------------------------------
// API helpers
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

  // Use an existing tenant if FP_TENANT_ID is set (admin routes require browser session auth
  // on deployed Workers, so we can't create tenants via the API bearer token alone).
  const existingTenantId = process.env["FP_TENANT_ID"];
  let tenant: { id: string };
  if (existingTenantId) {
    tenant = { id: existingTenantId };
    console.log(`   Tenant: ${tenant.id} (from FP_TENANT_ID)`);
  } else {
    try {
      tenant = await apiJson<{ id: string }>(baseUrl, "/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify({ name: `load-test-${Date.now()}` }),
      });
    } catch (e) {
      throw new Error(
        `Failed to create tenant. On deployed Workers, set FP_TENANT_ID or use OIDC auth. ${e instanceof Error ? e.message : e}`,
      );
    }
    console.log(`   Tenant: ${tenant.id}`);
  }

  const config = await apiJson<{ id: string }>(baseUrl, "/api/v1/configurations", {
    method: "POST",
    body: JSON.stringify({ name: `load-test-config-${Date.now()}` }),
    headers: { "X-Tenant-Id": tenant.id },
  });
  console.log(`   Config: ${config.id}`);

  // Upload a basic YAML config
  const yaml = `receivers:\n  otlp:\n    protocols:\n      grpc:\n        endpoint: "0.0.0.0:4317"\nexporters:\n  debug:\n    verbosity: basic\nservice:\n  pipelines:\n    traces:\n      receivers: [otlp]\n      exporters: [debug]\n`;
  const res = await fetch(`${baseUrl}/api/v1/configurations/${config.id}/versions`, {
    method: "POST",
    body: yaml,
    headers: {
      "Content-Type": "text/yaml",
      Authorization: `Bearer ${API_KEY}`,
      "X-Tenant-Id": tenant.id,
    },
  });
  if (!res.ok) throw new Error(`Upload config failed: ${res.status}`);
  const version = (await res.json()) as { hash: string };
  console.log(`   Config version: ${version.hash.slice(0, 12)}...`);

  const token = await apiJson<{ token: string }>(
    baseUrl,
    `/api/v1/configurations/${config.id}/enrollment-token`,
    {
      method: "POST",
      body: JSON.stringify({ label: "load-test" }),
      headers: { "X-Tenant-Id": tenant.id },
    },
  );
  console.log(`   Enrollment token: ${token.token.slice(0, 20)}...`);

  return { tenant, config, token: token.token };
}

interface ServerStats {
  active_websockets: number;
  total_agents: number;
  connected_agents: number;
  healthy_agents: number;
}

async function fetchServerStats(baseUrl: string, configId: string): Promise<ServerStats | null> {
  try {
    return await apiJson<ServerStats>(baseUrl, `/api/v1/configurations/${configId}/stats`);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Agent lifecycle
// ---------------------------------------------------------------------------

interface ManagedAgent {
  agent: FakeOpampAgent;
  assignmentClaim: string | null;
  lastHeartbeat: number;
}

// Realistic collector versions for varied fleet simulation
const COLLECTOR_VERSIONS = ["0.120.0", "0.121.0", "0.122.0", "0.123.0"];
const OS_TYPES = ["linux", "linux", "linux", "linux", "darwin"]; // 80% linux
const ARCHITECTURES = ["amd64", "amd64", "amd64", "arm64"]; // 75% amd64

function realisticProfile(idx: number): AgentProfile {
  return {
    serviceVersion: COLLECTOR_VERSIONS[idx % COLLECTOR_VERSIONS.length],
    osType: OS_TYPES[idx % OS_TYPES.length],
    arch: ARCHITECTURES[idx % ARCHITECTURES.length],
    pipelines: REAL_COLLECTOR_PIPELINES,
    extensions: ["opamp"],
  };
}

async function enrollAgent(
  wsUrl: string,
  enrollmentToken: string,
  idx: number,
  total: number,
  profile: PopulationProfileName,
  counters: CounterSet,
  connectTracker: LatencyTracker,
  enrollTracker: LatencyTracker,
): Promise<ManagedAgent | null> {
  const behavior = behaviorForAgent(idx, total, profile);
  const agent = new FakeOpampAgent({
    endpoint: wsUrl,
    enrollmentToken,
    name: `otelcol-contrib`,
    autoHeartbeat: true,
    onAutoHeartbeat: () => {
      counters.messagesSent++;
    },
    profile: realisticProfile(idx),
  });

  counters.connectAttempted++;
  const t0 = performance.now();

  try {
    const enrollment = await agent.connectAndEnroll();
    const connectMs = performance.now() - t0;

    counters.connectSucceeded++;
    counters.enrollmentCompleted++;
    counters.messagesSent++;
    counters.messagesReceived += 2;
    record(connectTracker, connectMs);
    record(enrollTracker, connectMs);

    // Start behavior mode after enrollment
    if (behavior.mode !== "healthy") {
      agent.startBehavior(behavior);
    }

    return {
      agent,
      assignmentClaim: enrollment.assignment_claim,
      lastHeartbeat: Date.now(),
    };
  } catch (err) {
    counters.connectFailed++;
    record(connectTracker, performance.now() - t0);
    const msg = err instanceof Error ? err.message : String(err);
    countError(counters, msg.includes("Timeout") ? "connect_timeout" : "connect_error");
    return null;
  }
}

/**
 * Enroll agents in parallel batches of `concurrency`.
 * Auto-heartbeat handles keepalives — server directs the interval via heart_beat_interval.
 */
async function enrollBatched(
  wsUrl: string,
  token: string,
  total: number,
  concurrency: number,
  profile: PopulationProfileName,
  counters: CounterSet,
  connectTracker: LatencyTracker,
  enrollTracker: LatencyTracker,
  rampMs: number,
): Promise<ManagedAgent[]> {
  const managed: ManagedAgent[] = [];
  const batchDelayMs = total <= concurrency ? 0 : rampMs / Math.ceil(total / concurrency);
  let attempted = 0;
  const startTime = performance.now();

  for (let offset = 0; offset < total; offset += concurrency) {
    const batchSize = Math.min(concurrency, total - offset);
    const promises: Promise<ManagedAgent | null>[] = [];

    for (let j = 0; j < batchSize; j++) {
      const idx = offset + j;
      promises.push(
        enrollAgent(wsUrl, token, idx, total, profile, counters, connectTracker, enrollTracker),
      );
    }

    const results = await Promise.all(promises);
    for (const r of results) {
      if (r) managed.push(r);
    }
    attempted += batchSize;

    // Prune disconnected agents periodically
    if (attempted % (concurrency * 10) === 0 && managed.length > 0) {
      const alive = managed.filter((m) => m.agent.connected);
      const dropped = managed.length - alive.length;
      if (dropped > 0) {
        process.stdout.write(`\n   ⚠️  ${dropped} agents disconnected during ramp\n`);
        managed.length = 0;
        managed.push(...alive);
      }
    }

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
    const rate = (managed.length / ((performance.now() - startTime) / 1000)).toFixed(0);
    process.stdout.write(
      `\r   Enrolled: ${managed.length}/${attempted} (${counters.connectFailed} failed) ` +
        `[${rate} enroll/s, ${elapsed}s elapsed]`,
    );

    if (batchDelayMs > 0 && offset + concurrency < total) {
      await new Promise<void>((r) => {
        setTimeout(r, batchDelayMs);
      });
    }
  }
  return managed;
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

    const response = await managed.agent.waitForMessage(10_000);
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
// Multi-process coordinator (for 10K+ agents)
// ---------------------------------------------------------------------------

interface WorkerResult {
  workerId: number;
  counters: Omit<CounterSet, "errors"> & { errors: Record<string, number> };
  connect: ReturnType<typeof summarize>;
  enrollment: ReturnType<typeof summarize>;
  heartbeatRtt: ReturnType<typeof summarize>;
  peakMemoryMB: number;
  durationSeconds: number;
}

async function runMultiProcess(cfg: LoadTestConfig): Promise<void> {
  const { fork } = await import("node:child_process");

  console.log(
    `\n🔀 Multi-process mode: ${cfg.workers} workers × ${Math.ceil(cfg.agents / cfg.workers)} agents each\n`,
  );

  // Setup infra once from the coordinator
  const { token, config } = await setupTestInfra(cfg.baseUrl);

  const agentsPerWorker = Math.ceil(cfg.agents / cfg.workers);
  const workerPromises: Promise<WorkerResult>[] = [];

  for (let i = 0; i < cfg.workers; i++) {
    const workerAgents = Math.min(agentsPerWorker, cfg.agents - i * agentsPerWorker);
    if (workerAgents <= 0) break;

    workerPromises.push(
      new Promise<WorkerResult>((resolve, reject) => {
        const child = fork(
          import.meta.filename,
          [
            `--worker-id=${i}`,
            `--worker-agents=${workerAgents}`,
            `--url=${cfg.baseUrl}`,
            `--ramp=${cfg.rampSeconds}`,
            `--steady=${cfg.steadySeconds}`,
            `--heartbeat=${cfg.heartbeatSeconds}`,
            `--concurrency=${cfg.concurrency}`,
            `--profile=${cfg.profile}`,
          ],
          {
            env: {
              ...process.env,
              __FP_WORKER_ID: String(i),
              __FP_WORKER_AGENTS: String(workerAgents),
              __FP_ENROLLMENT_TOKEN: token,
              __FP_CONFIG_ID: config.id,
            },
            stdio: ["pipe", "pipe", "pipe", "ipc"],
          },
        );

        let result: WorkerResult | null = null;
        child.on("message", (msg: WorkerResult) => {
          result = msg;
        });

        child.stdout?.on("data", (data: Buffer) => {
          const lines = data.toString().split("\n").filter(Boolean);
          for (const line of lines) {
            process.stdout.write(`   [W${i}] ${line}\n`);
          }
        });

        child.stderr?.on("data", (data: Buffer) => {
          process.stderr.write(`   [W${i}:err] ${data}`);
        });

        child.on("exit", (code) => {
          if (result) resolve(result);
          else reject(new Error(`Worker ${i} exited with code ${code} and no result`));
        });
      }),
    );
  }

  const results = await Promise.all(workerPromises);

  // Merge results
  const merged = mergeWorkerResults(results, cfg, config.id);
  printReport(merged);

  // Poll server for final stats
  const serverStats = await fetchServerStats(cfg.baseUrl, config.id);
  if (serverStats) {
    console.log(`📊 Server-side stats:`);
    console.log(`   Active WebSockets: ${serverStats.active_websockets}`);
    console.log(`   Total agents:      ${serverStats.total_agents}`);
    console.log(`   Connected:         ${serverStats.connected_agents}`);
    console.log(`   Healthy:           ${serverStats.healthy_agents}`);
  }

  const fs = await import("node:fs/promises");
  const jsonPath = `load-test-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await fs.writeFile(jsonPath, reportToJson(merged));
  console.log(`\n📄 JSON report written to ${jsonPath}`);

  const failRate = merged.counters.connectFailed / merged.counters.connectAttempted;
  if (failRate > 0.1) {
    console.error(`\n❌ Failure rate too high: ${(failRate * 100).toFixed(1)}%`);
    process.exit(1);
  }
  console.log("\n✅ Load test completed successfully.");
}

function mergeWorkerResults(
  results: WorkerResult[],
  cfg: LoadTestConfig,
  _configId: string,
): ReturnType<typeof buildReport> {
  const counters = createCounters();
  for (const r of results) {
    counters.connectAttempted += r.counters.connectAttempted;
    counters.connectSucceeded += r.counters.connectSucceeded;
    counters.connectFailed += r.counters.connectFailed;
    counters.messagesSent += r.counters.messagesSent;
    counters.messagesReceived += r.counters.messagesReceived;
    counters.enrollmentCompleted += r.counters.enrollmentCompleted;
    if (r.counters.errors) {
      for (const [k, v] of Object.entries(r.counters.errors)) {
        counters.errors.set(k, (counters.errors.get(k) ?? 0) + v);
      }
    }
  }

  // Take worst-case latencies across workers
  const worstConnect = results.reduce(
    (worst, r) => (r.connect.p99 > worst.p99 ? r.connect : worst),
    results[0]!.connect,
  );
  const worstEnroll = results.reduce(
    (worst, r) => (r.enrollment.p99 > worst.p99 ? r.enrollment : worst),
    results[0]!.enrollment,
  );
  const worstHb = results.reduce(
    (worst, r) => (r.heartbeatRtt.p99 > worst.p99 ? r.heartbeatRtt : worst),
    results[0]!.heartbeatRtt,
  );

  return {
    target: cfg.baseUrl,
    agents: cfg.agents,
    rampUpSeconds: cfg.rampSeconds,
    steadyStateSeconds: cfg.steadySeconds,
    heartbeatIntervalSeconds: cfg.heartbeatSeconds,
    counters,
    connect: worstConnect,
    enrollment: worstEnroll,
    heartbeatRtt: worstHb,
    peakMemoryMB: Math.max(...results.map((r) => r.peakMemoryMB)),
    durationSeconds: Math.max(...results.map((r) => r.durationSeconds)),
  };
}

function buildReport(
  cfg: LoadTestConfig,
  counters: CounterSet,
  connectTracker: LatencyTracker,
  enrollTracker: LatencyTracker,
  heartbeatTracker: LatencyTracker,
  peakMemoryMB: number,
  durationSeconds: number,
) {
  return {
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
}

// ---------------------------------------------------------------------------
// Single-process runner
// ---------------------------------------------------------------------------

async function runSingleProcess(cfg: LoadTestConfig): Promise<void> {
  const agentCount = cfg.isWorker ? cfg.workerAgents : cfg.agents;
  const prefix = cfg.isWorker ? `[W${cfg.workerId}] ` : "";

  // If running as worker, get token from env; else setup infra
  let token: string;
  let configId: string;
  if (cfg.isWorker) {
    token = process.env["__FP_ENROLLMENT_TOKEN"]!;
    configId = process.env["__FP_CONFIG_ID"]!;
  } else {
    const infra = await setupTestInfra(cfg.baseUrl);
    token = infra.token;
    configId = infra.config.id;
  }

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

  // Phase 1: Parallel batched ramp-up
  console.log(
    `${prefix}🚀 Phase 1: Enrolling ${agentCount} agents (concurrency=${cfg.concurrency}, profile=${cfg.profile})...`,
  );

  let managed = await enrollBatched(
    cfg.wsUrl,
    token,
    agentCount,
    cfg.concurrency,
    cfg.profile,
    counters,
    connectTracker,
    enrollTracker,
    cfg.rampSeconds * 1000,
  );

  trackMemory();
  const rampDuration = ((performance.now() - startTime) / 1000).toFixed(1);
  const enrollRate = (managed.length / ((performance.now() - startTime) / 1000)).toFixed(0);
  console.log(
    `\n${prefix}   ✅ Ramp-up complete: ${managed.length}/${agentCount} connected in ${rampDuration}s (${enrollRate} enroll/s)`,
  );

  // Poll server stats after ramp
  if (!cfg.isWorker) {
    const stats = await fetchServerStats(cfg.baseUrl, configId);
    if (stats) {
      console.log(
        `${prefix}   📊 Server: ${stats.active_websockets} active WS, ${stats.connected_agents} connected, ${stats.healthy_agents} healthy`,
      );
    }
  }

  // Phase 2: Steady-state monitoring
  // Auto-heartbeat is handled by each agent's timer (server-directed interval).
  // We just monitor connection health and do periodic measurement heartbeats.
  console.log(
    `${prefix}💓 Phase 2: Steady-state (${cfg.steadySeconds}s, auto-heartbeat active)...`,
  );
  const steadyDeadline = Date.now() + cfg.steadySeconds * 1000;
  let monitorRound = 0;
  const MONITOR_INTERVAL_MS = 10_000; // check every 10s

  while (Date.now() < steadyDeadline) {
    monitorRound++;
    trackMemory();

    // Count alive agents and analyze disconnections
    const alive: ManagedAgent[] = [];
    const disconnected: ManagedAgent[] = [];
    for (const m of managed) {
      if (m.agent.connected) {
        alive.push(m);
      } else {
        disconnected.push(m);
      }
    }
    const dropped = disconnected.length;

    // Report close reasons for dropped agents
    if (dropped > 0) {
      const closeReasons = new Map<string, number>();
      for (const m of disconnected) {
        const code = m.agent.lastCloseCode ?? "unknown";
        const reason = m.agent.lastCloseReason || "no reason";
        const key = `${code}: ${reason}`;
        closeReasons.set(key, (closeReasons.get(key) ?? 0) + 1);
      }
      console.log(`\n${prefix}   ⚠️  ${dropped} agents disconnected:`);
      for (const [reason, count] of closeReasons) {
        console.log(`${prefix}      ${count}× close(${reason})`);
      }
      // Show timing spread
      const times = disconnected
        .map((m) => m.agent.disconnectedAt)
        .filter((t): t is number => t !== null)
        .sort((a, b) => a - b);
      if (times.length > 0) {
        const earliest = times[0]!;
        const latest = times[times.length - 1]!;
        const spread = ((latest - earliest) / 1000).toFixed(1);
        const agoSec = ((Date.now() - earliest) / 1000).toFixed(0);
        console.log(`${prefix}      timing: first ${agoSec}s ago, spread=${spread}s`);
      }
      managed = alive;
    }

    // Send one measured heartbeat wave for latency tracking (sample up to 100 agents)
    // Unless --no-probes is set, in which case we passively monitor only
    if (!cfg.noProbes) {
      const sample = managed.slice(0, Math.min(100, managed.length));
      if (sample.length > 0) {
        const results = await Promise.all(
          sample.map((m) => sendHeartbeat(m, counters, heartbeatTracker)),
        );
        const sampleAlive = results.filter(Boolean).length;
        process.stdout.write(
          `\r${prefix}   Monitor ${monitorRound}: ${managed.length} alive` +
            `${dropped > 0 ? ` (-${dropped})` : ""}, ` +
            `sample=${sampleAlive}/${sample.length}, ` +
            `hb_sent=${counters.messagesSent}, ` +
            `mem=${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)}MB` +
            "          ",
        );
      }
    } else {
      process.stdout.write(
        `\r${prefix}   Monitor ${monitorRound}: ${managed.length} alive` +
          `${dropped > 0 ? ` (-${dropped})` : ""}, ` +
          `mem=${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)}MB` +
          ` (passive)          `,
      );
    }

    const sleepMs = Math.min(MONITOR_INTERVAL_MS, Math.max(0, steadyDeadline - Date.now()));
    if (sleepMs > 0) {
      await new Promise<void>((r) => {
        setTimeout(r, sleepMs);
      });
    }
  }

  // Phase 3: Teardown
  console.log(`\n${prefix}🧹 Phase 3: Teardown (closing ${managed.length} connections)...`);
  // Close in batches to avoid overwhelming the event loop
  const closeBatch = 500;
  for (let i = 0; i < managed.length; i += closeBatch) {
    const batch = managed.slice(i, i + closeBatch);
    for (const m of batch) m.agent.close();
    if (i + closeBatch < managed.length) {
      await new Promise<void>((r) => {
        setTimeout(r, 10);
      });
    }
  }

  const durationSeconds = (performance.now() - startTime) / 1000;
  trackMemory();

  // If running as worker child, send results to parent via IPC
  if (cfg.isWorker && process.send) {
    const result: WorkerResult = {
      workerId: cfg.workerId,
      counters: {
        ...counters,
        errors: Object.fromEntries(counters.errors) as Record<string, number>,
      },
      connect: summarize(connectTracker),
      enrollment: summarize(enrollTracker),
      heartbeatRtt: summarize(heartbeatTracker),
      peakMemoryMB,
      durationSeconds,
    };
    process.send(result);
    return;
  }

  // Single-process: print full report
  const report = buildReport(
    cfg,
    counters,
    connectTracker,
    enrollTracker,
    heartbeatTracker,
    peakMemoryMB,
    durationSeconds,
  );
  printReport(report);

  // Poll server for final stats
  const serverStats = await fetchServerStats(cfg.baseUrl, configId);
  if (serverStats) {
    console.log(`📊 Server-side stats (post-teardown):`);
    console.log(`   Total agents:      ${serverStats.total_agents}`);
    console.log(`   Connected:         ${serverStats.connected_agents}`);
    console.log(`   Healthy:           ${serverStats.healthy_agents}`);
  }

  const fs = await import("node:fs/promises");
  const jsonPath = `load-test-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await fs.writeFile(jsonPath, reportToJson(report));
  console.log(`📄 JSON report written to ${jsonPath}`);

  const failRate = counters.connectFailed / Math.max(1, counters.connectAttempted);
  if (failRate > 0.1) {
    console.error(`\n❌ Failure rate too high: ${(failRate * 100).toFixed(1)}%`);
    process.exit(1);
  }
  console.log("\n✅ Load test completed successfully.");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  const cfg = parseConfig();

  if (!cfg.isWorker) {
    console.log(`
🔥 o11yfleet Load Test
   Target:      ${cfg.baseUrl}
   Agents:      ${cfg.agents.toLocaleString()}
   Ramp:        ${cfg.rampSeconds}s
   Steady:      ${cfg.steadySeconds}s
   Heartbeat:   every ${cfg.heartbeatSeconds}s
   Probes:      ${cfg.noProbes ? "DISABLED (passive monitoring)" : "active (100 sample heartbeats/round)"}
   Concurrency: ${cfg.concurrency} parallel enrollments
   Workers:     ${cfg.workers} process(es)
`);
  }

  if (cfg.workers > 1 && !cfg.isWorker) {
    await runMultiProcess(cfg);
  } else {
    await runSingleProcess(cfg);
  }
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
