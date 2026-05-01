#!/usr/bin/env npx tsx
import { FakeOpampAgent } from "@o11yfleet/test-utils";
import { countError, createCounters, createTracker, record, summarize } from "./metrics.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface Config {
  baseUrl: string;
  wsUrl: string;
  apiKey: string;
  agents: number;
  durationSec: number;
  rolloutEverySec: number;
  listRps: number;
  statsRps: number;
  reconnectPct: number;
  outputPath: string;
  concurrency: number;
  operationTimeoutMs: number;
}

interface ManagedAgent {
  agent: FakeOpampAgent;
  assignmentClaim: string | null;
}

const LOOP_TICK_MS = 50;
const TIMELINE_SAMPLE_MS = 1000;
const MAX_TIMELINE_SAMPLES = 10_000;

function parsePositiveInt(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeFloat(value: string, name: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

function intervalMsFromRps(rps: number): number {
  return rps > 0 ? Math.max(1, Math.floor(1000 / rps)) : Number.POSITIVE_INFINITY;
}

function parse(): Config {
  const args = process.argv.slice(2);
  const get = (name: string, env: string, def: string) => {
    const prefix = `--${name}=`;
    const arg = args.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : (process.env[env] ?? def);
  };
  const baseUrl = get("url", "FP_URL", "http://localhost:8787");
  const apiKey = get("api-key", "FP_API_KEY", "");
  if (!apiKey) {
    throw new Error("FP_API_KEY or --api-key is required for mixed load runs");
  }
  return {
    baseUrl,
    wsUrl: baseUrl.replace(/^http/, "ws") + "/v1/opamp",
    apiKey,
    agents: parsePositiveInt(get("agents", "FP_AGENTS", "200"), "agents"),
    durationSec: parsePositiveInt(get("duration", "FP_DURATION_SEC", "120"), "duration"),
    rolloutEverySec: parsePositiveInt(
      get("rollout-every", "FP_ROLLOUT_EVERY_SEC", "30"),
      "rollout-every",
    ),
    listRps: parseNonNegativeFloat(get("list-rps", "FP_LIST_RPS", "2"), "list-rps"),
    statsRps: parseNonNegativeFloat(get("stats-rps", "FP_STATS_RPS", "2"), "stats-rps"),
    reconnectPct: parseNonNegativeFloat(
      get("reconnect-pct", "FP_RECONNECT_PCT", "10"),
      "reconnect-pct",
    ),
    outputPath: get("output", "FP_OUTPUT", `mixed-load-${Date.now()}.json`),
    concurrency: parsePositiveInt(get("concurrency", "FP_CONCURRENCY", "50"), "concurrency"),
    operationTimeoutMs: parsePositiveInt(
      get("operation-timeout-ms", "FP_OPERATION_TIMEOUT_MS", "30000"),
      "operation-timeout-ms",
    ),
  };
}

function errorKey(err: unknown): string {
  if (err instanceof Error) return err.name || "Error";
  return typeof err;
}

async function withTimeout<T>(label: string, timeoutMs: number, operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function apiFetch(
  cfg: Config,
  path: string,
  tenantId: string,
  opts?: RequestInit,
): Promise<Response> {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    ...opts,
    signal: opts?.signal ?? AbortSignal.timeout(cfg.operationTimeoutMs),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
      "X-Tenant-Id": tenantId,
      ...opts?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `${opts?.method ?? "GET"} ${path} failed: ${res.status}${body ? ` ${body}` : ""}`,
    );
  }
  return res;
}

async function apiJson<T>(
  cfg: Config,
  path: string,
  tenantId: string,
  opts?: RequestInit,
): Promise<T> {
  const res = await apiFetch(cfg, path, tenantId, opts);
  return res.json() as Promise<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function recordConnectedSample(
  timeline: Array<{ ts: number; connected: number }>,
  managed: ManagedAgent[],
): void {
  if (timeline.length >= MAX_TIMELINE_SAMPLES) timeline.shift();
  timeline.push({ ts: Date.now(), connected: managed.filter((m) => m.agent.connected).length });
}

async function cleanupResources(
  cfg: Config,
  tenantId: string | null,
  configId: string | null,
  counters: ReturnType<typeof createCounters>,
): Promise<void> {
  if (!tenantId) return;

  if (configId) {
    try {
      await apiFetch(cfg, `/api/v1/configurations/${configId}`, tenantId, { method: "DELETE" });
    } catch (err) {
      countError(counters, `cleanup:config:${errorKey(err)}`);
      console.warn(`config cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    const deleteTenantRes = await fetch(`${cfg.baseUrl}/api/admin/tenants/${tenantId}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(cfg.operationTimeoutMs),
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!deleteTenantRes.ok) {
      throw new Error(`DELETE /api/admin/tenants/${tenantId} failed: ${deleteTenantRes.status}`);
    }
  } catch (err) {
    countError(counters, `cleanup:tenant:${errorKey(err)}`);
    console.warn(`tenant cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  const cfg = parse();
  console.log(`Mixed Config DO load: agents=${cfg.agents} duration=${cfg.durationSec}s`);

  const connectTracker = createTracker("connect_ms");
  const rolloutTracker = createTracker("rollout_ms");
  const listTracker = createTracker("list_ms");
  const statsTracker = createTracker("stats_ms");
  const reconnectTracker = createTracker("reconnect_ms");
  const counters = createCounters();
  let reconnectSuccess = 0;
  let reconnectFailed = 0;
  let reconnectBudget = 0;
  let reconnectCursor = 0;
  const connectedTimeline: Array<{ ts: number; connected: number }> = [];
  const managed: ManagedAgent[] = [];
  let tenantId: string | null = null;
  let configId: string | null = null;
  let cleanedUp = false;

  try {
    const tenantRes = await fetch(`${cfg.baseUrl}/api/admin/tenants`, {
      method: "POST",
      signal: AbortSignal.timeout(cfg.operationTimeoutMs),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ name: `mixed-load-${Date.now()}` }),
    });
    if (!tenantRes.ok) throw new Error(`POST /api/admin/tenants failed: ${tenantRes.status}`);
    const tenant = (await tenantRes.json()) as { id: string };
    tenantId = tenant.id;

    const config = await apiJson<{ id: string }>(cfg, "/api/v1/configurations", tenant.id, {
      method: "POST",
      body: JSON.stringify({ name: "mixed-config" }),
    });
    configId = config.id;

    const yaml = `receivers:\n  otlp:\n    protocols:\n      grpc:\n        endpoint: "0.0.0.0:4317"\nexporters:\n  debug:\nservice:\n  pipelines:\n    traces:\n      receivers: [otlp]\n      exporters: [debug]\n`;
    const versionRes = await fetch(`${cfg.baseUrl}/api/v1/configurations/${config.id}/versions`, {
      method: "POST",
      signal: AbortSignal.timeout(cfg.operationTimeoutMs),
      body: yaml,
      headers: {
        "Content-Type": "text/yaml",
        Authorization: `Bearer ${cfg.apiKey}`,
        "X-Tenant-Id": tenant.id,
      },
    });
    if (!versionRes.ok) {
      throw new Error(
        `POST /api/v1/configurations/${config.id}/versions failed: ${versionRes.status}`,
      );
    }

    const token = await apiJson<{ token: string }>(
      cfg,
      `/api/v1/configurations/${config.id}/enrollment-token`,
      tenant.id,
      { method: "POST", body: JSON.stringify({ label: "mixed-load" }) },
    );

    for (let i = 0; i < cfg.agents; i += cfg.concurrency) {
      const batch = Array.from(
        { length: Math.min(cfg.concurrency, cfg.agents - i) },
        (_, j) => i + j,
      );
      const res = await Promise.all(
        batch.map(async (idx) => {
          const t0 = performance.now();
          const agent = new FakeOpampAgent({
            endpoint: cfg.wsUrl,
            enrollmentToken: token.token,
            name: `mixed-${idx}`,
          });
          counters.connectAttempted++;
          try {
            const enrollment = await withTimeout(
              `enroll mixed-${idx}`,
              cfg.operationTimeoutMs,
              agent.connectAndEnroll(),
            );
            counters.connectSucceeded++;
            record(connectTracker, performance.now() - t0);
            agent.setAssignmentClaim(enrollment.assignment_claim);
            return { agent, assignmentClaim: enrollment.assignment_claim };
          } catch (err) {
            counters.connectFailed++;
            countError(counters, `connect:${errorKey(err)}`);
            agent.close();
            return null;
          }
        }),
      );
      for (const a of res) if (a) managed.push(a);
    }

    const start = Date.now();
    let nextRolloutAt = start + cfg.rolloutEverySec * 1000;
    let nextListAt = start;
    let nextStatsAt = start;
    let nextTimelineSampleAt = start;
    const listIntervalMs = intervalMsFromRps(cfg.listRps);
    const statsIntervalMs = intervalMsFromRps(cfg.statsRps);
    const totalTicks = Math.max(1, Math.ceil((cfg.durationSec * 1000) / LOOP_TICK_MS));
    const targetReconnects =
      cfg.reconnectPct > 0 ? Math.max(1, Math.round((managed.length * cfg.reconnectPct) / 100)) : 0;
    const reconnectsPerTick = targetReconnects / totalTicks;

    while (Date.now() - start < cfg.durationSec * 1000) {
      const now = Date.now();
      if (now >= nextTimelineSampleAt) {
        recordConnectedSample(connectedTimeline, managed);
        nextTimelineSampleAt += TIMELINE_SAMPLE_MS;
      }

      if (now >= nextRolloutAt) {
        const t0 = performance.now();
        try {
          await apiJson(cfg, `/api/v1/configurations/${config.id}/rollout`, tenant.id, {
            method: "POST",
          });
          record(rolloutTracker, performance.now() - t0);
        } catch (err) {
          countError(counters, `rollout:${errorKey(err)}`);
        } finally {
          nextRolloutAt += cfg.rolloutEverySec * 1000;
        }
      }

      // Read lanes: at most one request per tick. Using `while` here would
      // never catch up when latency exceeds the configured interval, because
      // each await advances wall-clock time by more than `*IntervalMs`. If we
      // fall behind, snap the next deadline forward instead of looping.
      if (cfg.listRps > 0 && Date.now() >= nextListAt) {
        const t0 = performance.now();
        try {
          await apiJson(
            cfg,
            `/api/v1/configurations/${config.id}/agents?limit=100&offset=0`,
            tenant.id,
          );
          record(listTracker, performance.now() - t0);
        } catch (err) {
          countError(counters, `list:${errorKey(err)}`);
        } finally {
          nextListAt = Math.max(nextListAt + listIntervalMs, Date.now());
        }
      }

      if (cfg.statsRps > 0 && Date.now() >= nextStatsAt) {
        const t0 = performance.now();
        try {
          await apiJson(cfg, `/api/v1/configurations/${config.id}/stats`, tenant.id);
          record(statsTracker, performance.now() - t0);
        } catch (err) {
          countError(counters, `stats:${errorKey(err)}`);
        } finally {
          nextStatsAt = Math.max(nextStatsAt + statsIntervalMs, Date.now());
        }
      }

      const candidates = managed.filter((m) => m.agent.connected && m.assignmentClaim);
      reconnectBudget += candidates.length > 0 ? reconnectsPerTick : 0;
      const reconnectN = Math.min(candidates.length, Math.floor(reconnectBudget));
      reconnectBudget -= reconnectN;
      // Deduplicate: when reconnectN approaches candidates.length, modulo
      // wrap-around could otherwise pick the same agent twice in one tick,
      // and the second pass would race with the close() call from the first.
      const seenIndices = new Set<number>();
      const reconnectBatch: ManagedAgent[] = [];
      for (let i = 0; i < reconnectN && seenIndices.size < candidates.length; i++) {
        const idx = (reconnectCursor + i) % candidates.length;
        if (seenIndices.has(idx)) continue;
        seenIndices.add(idx);
        const m = candidates[idx];
        if (m?.assignmentClaim) reconnectBatch.push(m);
      }

      await Promise.all(
        reconnectBatch.map(async (m) => {
          if (!m.assignmentClaim) return;
          const claim = m.assignmentClaim;
          m.agent.close();
          const t0 = performance.now();
          const replacement = new FakeOpampAgent({
            endpoint: cfg.wsUrl,
            assignmentClaim: claim,
            name: "reconn",
          });
          replacement.setAssignmentClaim(claim);
          try {
            await withTimeout(
              `reconnect ${claim.slice(0, 12)}`,
              cfg.operationTimeoutMs,
              replacement.connect(),
            );
            await replacement.sendHello();
            await replacement.waitForMessage(cfg.operationTimeoutMs);
            m.agent = replacement;
            m.assignmentClaim = claim;
            reconnectSuccess++;
            record(reconnectTracker, performance.now() - t0);
          } catch (err) {
            reconnectFailed++;
            countError(counters, `reconnect:${errorKey(err)}`);
            replacement.close();
            const idx = managed.indexOf(m);
            if (idx !== -1) managed.splice(idx, 1);
          }
        }),
      );
      reconnectCursor += reconnectN;

      await sleep(LOOP_TICK_MS);
    }

    recordConnectedSample(connectedTimeline, managed);
    for (const m of managed) m.agent.close();
    await cleanupResources(cfg, tenantId, configId, counters);
    cleanedUp = true;

    const { apiKey: _apiKey, ...safeConfig } = cfg;
    const output = {
      config: safeConfig,
      counters: { ...counters, errors: Object.fromEntries(counters.errors) },
      metrics: {
        connected_agents_over_time: connectedTimeline,
        connect_latency: summarize(connectTracker),
        rollout: summarize(rolloutTracker),
        list_latency: summarize(listTracker),
        stats_latency: summarize(statsTracker),
        reconnect_latency: summarize(reconnectTracker),
        reconnect_success: reconnectSuccess,
        reconnect_failed: reconnectFailed,
        worker_errors_proxy: Object.fromEntries(counters.errors),
      },
      notes: {
        backlog_proxy:
          "Use /stats drift + reconnect failures + Worker logs; direct queue depth not exposed in this harness.",
      },
    };

    await mkdir(dirname(cfg.outputPath), { recursive: true });
    await writeFile(cfg.outputPath, JSON.stringify(output, null, 2));
    console.log(`Wrote ${cfg.outputPath}`);
  } finally {
    for (const m of managed) m.agent.close();
    if (!cleanedUp) {
      await cleanupResources(cfg, tenantId, configId, counters);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
