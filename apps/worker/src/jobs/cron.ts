// Cron/scheduled handler — GC, product metrics, stale sweep, manifest drift.
//
// Extracted from index.ts (Phase 4). A single `handleScheduled()` export
// dispatches based on cron expression.

import type { Env } from "../index.js";
import type { SweepResult } from "../durable-objects/rpc-types.js";
import { getDb } from "../db/client.js";
import { runManifestDriftCheck } from "./manifest-drift-check.js";

// ─── Cron schedule constants ────────────────────────────────────────

const STALE_AGENT_SWEEP_CRON = "17 3 * * *";
const PRODUCT_METRICS_CRON = "0 0 * * *";
const MANIFEST_DRIFT_CHECK_CRON = "12 6 * * *";
const D1_TABLE_GC_CRON = "45 4 * * *";
const CRON_SWEEP_CONCURRENCY = 100;
const CRON_SWEEP_TIMEOUT_MS = 2_000;

// ─── Helpers ────────────────────────────────────────────────────────

type TenantPlanBucket = "free" | "paid" | "enterprise";

function tenantPlanBucket(plan: string): TenantPlanBucket {
  switch (plan) {
    case "enterprise":
      return "enterprise";
    case "hobby":
      return "free";
    case "pro":
    case "starter":
    case "growth":
      return "paid";
    default:
      return "paid";
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const indexedItems = items.map((item, index) => ({ item, index }));
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  const workerCount = Math.min(concurrency, indexedItems.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const task = indexedItems[nextIndex];
        nextIndex += 1;
        if (!task) break;

        try {
          results[task.index] = { status: "fulfilled", value: await mapper(task.item, task.index) };
        } catch (reason) {
          results[task.index] = { status: "rejected", reason };
        }
      }
    }),
  );

  return results;
}

// ─── Cron jobs ──────────────────────────────────────────────────────

async function emitProductMetrics(env: Env): Promise<void> {
  if (!env.FP_ANALYTICS) return;

  const rows = await getDb(env.FP_DB)
    .selectFrom("tenants")
    .select(["plan", (eb) => eb.fn.countAll<number>().as("c")])
    .groupBy("plan")
    .execute();

  const totals = { total: 0, free: 0, paid: 0, enterprise: 0 };
  for (const row of rows) {
    const bucket = tenantPlanBucket(row.plan);
    totals[bucket] += row.c;
    totals.total += row.c;
  }

  try {
    env.FP_ANALYTICS.writeDataPoint({
      indexes: ["daily"],
      blobs: ["product", "tenants", "daily"],
      doubles: [totals.total, totals.free, totals.paid, totals.enterprise, Date.now() / 1000],
    });
  } catch {
    // Analytics Engine write failures should not fail the cron invocation.
  }
}

/**
 * Daily GC for ephemeral D1 tables — sessions, pending_tokens, enrollment_tokens.
 * Deletes expired/revoked rows that would otherwise accumulate forever.
 */
async function gcEphemeralTables(env: Env): Promise<void> {
  const db = getDb(env.FP_DB);
  const now = new Date().toISOString();
  // revoked_at is stored via SQLite datetime('now') → 'YYYY-MM-DD HH:MM:SS' format,
  // so the cutoff must match that format (not JS toISOString which uses 'T' separator).
  const revokedCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  // Batch the GC queries for efficiency — they're independent
  const [sessionResult, pendingTokenResult, enrollmentTokenResult] = await Promise.allSettled([
    db.deleteFrom("sessions").where("expires_at", "<", now).execute(),
    db
      .deleteFrom("pending_tokens")
      .where((eb) =>
        eb.or([
          // Expired tokens that haven't been revoked (revoked tokens keep 7-day audit trail)
          eb.and([
            eb("expires_at", "is not", null),
            eb("expires_at", "<", now),
            eb("revoked_at", "is", null),
          ]),
          // Revoked tokens older than 7 days
          eb.and([eb("revoked_at", "is not", null), eb("revoked_at", "<", revokedCutoff)]),
        ]),
      )
      .execute(),
    db
      .deleteFrom("enrollment_tokens")
      .where((eb) =>
        eb.or([
          // Expired tokens that haven't been revoked
          eb.and([
            eb("expires_at", "is not", null),
            eb("expires_at", "<", now),
            eb("revoked_at", "is", null),
          ]),
          // Revoked tokens older than 7 days
          eb.and([eb("revoked_at", "is not", null), eb("revoked_at", "<", revokedCutoff)]),
        ]),
      )
      .execute(),
  ]);

  const sessions =
    sessionResult.status === "fulfilled" ? Number(sessionResult.value[0]?.numDeletedRows ?? 0) : 0;
  const pendingTokens =
    pendingTokenResult.status === "fulfilled"
      ? Number(pendingTokenResult.value[0]?.numDeletedRows ?? 0)
      : 0;
  const enrollmentTokens =
    enrollmentTokenResult.status === "fulfilled"
      ? Number(enrollmentTokenResult.value[0]?.numDeletedRows ?? 0)
      : 0;

  const total = sessions + pendingTokens + enrollmentTokens;
  if (total > 0) {
    console.warn(
      `[cron] D1 GC: deleted ${sessions} sessions, ${pendingTokens} pending tokens, ${enrollmentTokens} enrollment tokens`,
    );
  }

  // Log failures but don't throw — each table GC is independent
  for (const [name, result] of [
    ["sessions", sessionResult],
    ["pending_tokens", pendingTokenResult],
    ["enrollment_tokens", enrollmentTokenResult],
  ] as const) {
    if (result.status === "rejected") {
      console.error(`[cron] D1 GC failed for ${name}:`, result.reason);
    }
  }
}

async function staleSweep(env: Env): Promise<void> {
  const configs = await getDb(env.FP_DB)
    .selectFrom("configurations")
    .select(["id", "tenant_id"])
    .execute();

  if (configs.length === 0) {
    return;
  }

  const results = await mapWithConcurrency(configs, CRON_SWEEP_CONCURRENCY, async (config) => {
    const doName = `${config.tenant_id}:${config.id}`;
    const doId = env.CONFIG_DO.idFromName(doName);
    const stub = env.CONFIG_DO.get(doId);
    const result: SweepResult = await Promise.race([
      stub.rpcSweep(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`[cron] sweep timed out for ${doName}`)),
          CRON_SWEEP_TIMEOUT_MS,
        );
      }),
    ]);
    return result;
  });

  const swept = results
    .filter((r): r is PromiseFulfilledResult<SweepResult> => r.status === "fulfilled")
    .reduce((sum, r) => sum + r.value.swept, 0);
  const failed = results.filter((r) => r.status === "rejected").length;

  if (swept > 0 || failed > 0) {
    console.warn(
      `[cron] sweep complete: ${swept} stale agents across ${configs.length} configs (${failed} failures)`,
    );
  }
}

// ─── Main entry point ───────────────────────────────────────────────

/** Dispatch scheduled cron by cron expression. */
export async function handleScheduled(
  controller: ScheduledController,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  if (controller.cron === PRODUCT_METRICS_CRON) {
    await emitProductMetrics(env);
    return;
  }
  if (controller.cron === MANIFEST_DRIFT_CHECK_CRON) {
    await runManifestDriftCheck(env);
    return;
  }
  if (controller.cron === D1_TABLE_GC_CRON) {
    await gcEphemeralTables(env);
    return;
  }
  if (controller.cron === STALE_AGENT_SWEEP_CRON) {
    await staleSweep(env);
  }
}
