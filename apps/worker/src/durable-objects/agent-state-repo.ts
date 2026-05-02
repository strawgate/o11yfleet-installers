// Agent State Repository — DO-local SQLite persistence for agent state
// Extracted from config-do.ts for testability and separation of concerns
//
// Design: ALL mutable state lives in SQLite. The DO class has zero instance
// fields that need to survive hibernation. SQLite queries are synchronous
// in DO-local storage (~µs per query), so this is effectively free.

import type { AgentState } from "@o11yfleet/core/state-machine";
import type { ConfigMetrics } from "@o11yfleet/core/metrics";
import { hexToUint8Array, uint8ToHex } from "@o11yfleet/core/hex";
import type {
  DesiredConfig,
  DoPolicy,
  AgentPageCursor,
  ListAgentsPageParams,
  StaleAgent,
  SweepResult,
  SweepStats,
} from "./agent-state-repo-interface.js";

// Re-export types from the interface file for backward compatibility
export type {
  DesiredConfig,
  DoPolicy,
  AgentSort,
  AgentPageCursor,
  ListAgentsPageParams,
  AgentPageResult,
  StaleAgent,
  SweepResult,
  SweepStats,
} from "./agent-state-repo-interface.js";

/** Safely parse a JSON string column, returning undefined on malformed data. */
function safeJsonParse(value: unknown): unknown {
  if (!value || typeof value !== "string") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * Initialize all tables in DO-local SQLite.
 */
export function initSchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      instance_uid TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      config_id TEXT NOT NULL,
      sequence_num INTEGER NOT NULL DEFAULT 0,
      generation INTEGER NOT NULL DEFAULT 1,
      healthy INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'unknown',
      last_error TEXT NOT NULL DEFAULT '',
      current_config_hash TEXT,
      effective_config_hash TEXT,
      last_seen_at INTEGER NOT NULL DEFAULT 0,
      connected_at INTEGER NOT NULL DEFAULT 0,
      agent_description TEXT,
      capabilities INTEGER NOT NULL DEFAULT 0,
      rate_window_start INTEGER NOT NULL DEFAULT 0,
      rate_window_count INTEGER NOT NULL DEFAULT 0,
      component_health_map TEXT,
      available_components TEXT
    )
  `);
  // Deduplicated config snapshots — one row per unique effective config hash.
  // Agents reference by hash only; the body lives here once.
  sql.exec(`
    CREATE TABLE IF NOT EXISTS config_snapshots (
      hash TEXT PRIMARY KEY,
      body TEXT NOT NULL
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS do_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      desired_config_hash TEXT,
      desired_config_content TEXT,
      desired_config_bytes BLOB,
      tenant_id TEXT NOT NULL DEFAULT '',
      config_id TEXT NOT NULL DEFAULT '',
      last_sweep_at INTEGER NOT NULL DEFAULT 0,
      last_sweep_stale_count INTEGER NOT NULL DEFAULT 0,
      last_sweep_active_socket_count INTEGER NOT NULL DEFAULT 0,
      last_sweep_duration_ms INTEGER NOT NULL DEFAULT 0,
      last_stale_sweep_at INTEGER NOT NULL DEFAULT 0,
      total_sweeps INTEGER NOT NULL DEFAULT 0,
      total_stale_swept INTEGER NOT NULL DEFAULT 0,
      sweeps_with_stale INTEGER NOT NULL DEFAULT 0,
      max_agents_per_config INTEGER
    )
  `);
  // Ensure singleton row exists
  sql.exec(`INSERT OR IGNORE INTO do_config (id) VALUES (1)`);
  // Indexes for alarm sweep and stats queries
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)`);
  sql.exec(
    `CREATE INDEX IF NOT EXISTS idx_agents_last_seen ON agents(last_seen_at) WHERE status != 'disconnected'`,
  );
  sql.exec(
    `CREATE INDEX IF NOT EXISTS idx_agents_config_hash ON agents(current_config_hash) WHERE current_config_hash IS NOT NULL`,
  );
  // Pending devices table — for __pending__ DOs only
  sql.exec(`
    CREATE TABLE IF NOT EXISTS pending_devices (
      instance_uid TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      display_name TEXT,
      source_ip TEXT,
      geo_country TEXT,
      geo_city TEXT,
      geo_lat REAL,
      geo_lon REAL,
      agent_description TEXT,
      connected_at INTEGER NOT NULL DEFAULT 0,
      last_seen_at INTEGER NOT NULL DEFAULT 0,
      rate_window_start INTEGER NOT NULL DEFAULT 0,
      rate_window_count INTEGER NOT NULL DEFAULT 0
    )
  `);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_pending_devices_tenant ON pending_devices(tenant_id)`);
  sql.exec(
    `CREATE INDEX IF NOT EXISTS idx_pending_devices_last_seen ON pending_devices(last_seen_at)`,
  );
  // Pending assignments — maps device to target config
  sql.exec(`
    CREATE TABLE IF NOT EXISTS pending_assignments (
      instance_uid TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      target_config_id TEXT NOT NULL,
      assigned_at INTEGER NOT NULL DEFAULT 0,
      assigned_by TEXT
    )
  `);
  sql.exec(
    `CREATE INDEX IF NOT EXISTS idx_pending_assignments_config ON pending_assignments(target_config_id)`,
  );
  // Migrate existing DO-local schemas forward.
  migrateSchema(sql);
}

/** Idempotent schema migrations for existing DOs. */
function migrateSchema(sql: SqlStorage): void {
  const cols = sql.exec(`PRAGMA table_info(do_config)`).toArray();
  const addDoConfigColumn = (
    name: string,
    definition = `${name} INTEGER NOT NULL DEFAULT 0`,
  ): void => {
    if (!cols.some((c) => c["name"] === name)) {
      sql.exec(`ALTER TABLE do_config ADD COLUMN ${definition}`);
    }
  };
  addDoConfigColumn("tenant_id", "tenant_id TEXT NOT NULL DEFAULT ''");
  addDoConfigColumn("config_id", "config_id TEXT NOT NULL DEFAULT ''");
  // Cached tenant policy. Seeded at /init when the resource is created and
  // refreshed via /sync-policy when tenant settings change. Lets the DO
  // enforce per-tenant limits without a header from the worker.
  addDoConfigColumn("max_agents_per_config", "max_agents_per_config INTEGER");
  // Migration: pre-encoded YAML bytes for the WS hot path. New rows get
  // this column populated by `saveDesiredConfig`. Existing rows fall
  // back to encoding-on-read in `loadDesiredConfig` until the next
  // `set-desired-config` overwrites them.
  addDoConfigColumn("desired_config_bytes", "desired_config_bytes BLOB");
  // Migration 1: add stale sweep tracking columns to do_config
  for (const column of [
    "last_sweep_at",
    "last_sweep_stale_count",
    "last_sweep_active_socket_count",
    "last_sweep_duration_ms",
    "last_stale_sweep_at",
    "total_sweeps",
    "total_stale_swept",
    "sweeps_with_stale",
  ]) {
    addDoConfigColumn(column);
  }
  // Migration 2: add config_snapshots table (CREATE IF NOT EXISTS handles this)
  // Migration 3: migrate legacy effective_config_body values into config_snapshots.
  const agentCols = sql.exec(`PRAGMA table_info(agents)`).toArray();
  if (agentCols.some((c) => c["name"] === "effective_config_body")) {
    // Move existing bodies to config_snapshots.
    sql.exec(`
      INSERT OR IGNORE INTO config_snapshots (hash, body)
      SELECT effective_config_hash, effective_config_body
      FROM agents
      WHERE effective_config_hash IS NOT NULL AND effective_config_body IS NOT NULL
    `);
    // Leave the legacy column in place for rollback compatibility. New reads use config_snapshots.
  }
}

// ─── Config State ───────────────────────────────────────────────────

/**
 * Load desired config from SQLite (sync, ~µs).
 *
 * The encoded `bytes` column is populated by `saveDesiredConfig` on every
 * write. Older rows that were saved before the column existed will return
 * `bytes: null` even when content is present — callers can fall back to
 * encoding on read; the next `set-desired-config` write upgrades the row.
 */
export function loadDesiredConfig(sql: SqlStorage): DesiredConfig {
  const row = sql
    .exec(
      `SELECT desired_config_hash, desired_config_content, desired_config_bytes
       FROM do_config WHERE id = 1`,
    )
    .one();
  const stored = row["desired_config_bytes"];
  let bytes: Uint8Array | null = null;
  if (stored instanceof Uint8Array) {
    bytes = stored;
  } else if (stored instanceof ArrayBuffer) {
    bytes = new Uint8Array(stored);
  }
  return {
    hash: (row["desired_config_hash"] as string) ?? null,
    content: (row["desired_config_content"] as string) ?? null,
    bytes,
  };
}

/**
 * Save desired config to SQLite (sync, ~µs).
 *
 * Pre-encodes `content` as UTF-8 bytes and stores them in the same row so
 * the WS hot path can avoid running `TextEncoder.encode()` on every
 * heartbeat. The encode happens exactly once per rollout.
 */
export function saveDesiredConfig(sql: SqlStorage, hash: string, content: string | null): void {
  const encoded = content === null ? null : new TextEncoder().encode(content);
  sql.exec(
    `UPDATE do_config
       SET desired_config_hash = ?,
           desired_config_content = ?,
           desired_config_bytes = ?
       WHERE id = 1`,
    hash,
    content,
    encoded,
  );
}

// Identity is derived from `ctx.id.name` at the call site (see ConfigDO's
// `getMyIdentity()`); this helper just persists the parsed identity to
// the do_config row so the SQL surface stays self-describing for ad-hoc
// debug queries. There is intentionally no `loadDoIdentity` — every
// route reads `ctx.id.name` directly, and the repo isn't a source of
// truth for identity any more.
export function saveDoIdentity(sql: SqlStorage, tenantId: string, configId: string): void {
  if (!tenantId || !configId) return;
  sql.exec(`UPDATE do_config SET tenant_id = ?, config_id = ? WHERE id = 1`, tenantId, configId);
}

// `DoPolicy` lives in `./agent-state-repo-interface.ts` as the canonical
// type. The previous duplicate declaration here would have allowed the
// two copies to drift; importing instead keeps them in sync.

/** Pure validator for a single policy value. Exported for unit tests. */
export function isValidMaxAgents(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0
  );
}

export function loadDoPolicy(sql: SqlStorage): DoPolicy {
  const row = sql.exec(`SELECT max_agents_per_config FROM do_config WHERE id = 1`).one();
  const raw = row["max_agents_per_config"];
  if (raw === null || raw === undefined) {
    return { max_agents_per_config: null };
  }
  if (!isValidMaxAgents(raw)) {
    // Silent drift would mask data-corruption bugs; surface it loudly.
    // We still fall back to `null` so callers see a sane default.
    console.warn(
      `[do-policy] discarding invalid max_agents_per_config: ${typeof raw}=${String(raw).slice(0, 32)}`,
    );
    return { max_agents_per_config: null };
  }
  return { max_agents_per_config: raw };
}

/**
 * Defense-in-depth: SQL boundary rejects values that don't pass the
 * pure validator. Even if a future caller skips the schema layer (or a
 * bug lets a bad value through), the column never holds garbage.
 *
 * `undefined` ⇒ field absent, no-op.
 * `null` ⇒ explicit "clear cap" — column set to NULL.
 * positive integer ⇒ stored.
 * anything else ⇒ silent no-op (defensive); structured errors are the
 * caller's job before they reach here.
 */
export function saveDoPolicy(sql: SqlStorage, policy: Partial<DoPolicy>): void {
  if (policy.max_agents_per_config === undefined) return;
  const v = policy.max_agents_per_config;
  if (v === null) {
    sql.exec(`UPDATE do_config SET max_agents_per_config = NULL WHERE id = 1`);
    return;
  }
  if (!isValidMaxAgents(v)) {
    console.warn(
      `[do-policy] saveDoPolicy rejected invalid max_agents_per_config: ${typeof v}=${String(v).slice(0, 32)}`,
    );
    return;
  }
  sql.exec(`UPDATE do_config SET max_agents_per_config = ? WHERE id = 1`, v);
}

// ─── Rate Limiting ──────────────────────────────────────────────────

/**
 * Check rate limit for an agent. Returns true if the agent is rate-limited.
 * Atomic check-and-increment in a single SQL statement.
 * Resets the window if it has expired (sliding 60s window).
 */
export function checkRateLimit(sql: SqlStorage, uid: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;

  // Atomic: reset expired window or increment count, return new count
  const row = sql
    .exec(
      `UPDATE agents SET
       rate_window_start = CASE WHEN rate_window_start < ? THEN ? ELSE rate_window_start END,
       rate_window_count = CASE WHEN rate_window_start < ? THEN 1 ELSE rate_window_count + 1 END
     WHERE instance_uid = ?
     RETURNING rate_window_count`,
      windowStart,
      now,
      windowStart,
      uid,
    )
    .toArray()[0];

  if (!row) return false; // Agent not in DB yet — allow
  return (row["rate_window_count"] as number) > maxPerMinute;
}

/**
 * Load agent state from DO SQLite, or return a default state for new agents.
 */
export function loadAgentState(
  sql: SqlStorage,
  instanceUid: string,
  tenantId: string,
  configId: string,
  desiredConfigHash: string | null,
): AgentState {
  const row = sql.exec(`SELECT * FROM agents WHERE instance_uid = ?`, instanceUid).toArray()[0];

  if (row) {
    const effectiveHash = (row["effective_config_hash"] as string) ?? null;
    return {
      instance_uid: hexToUint8Array(row["instance_uid"] as string),
      tenant_id: row["tenant_id"] as string,
      config_id: row["config_id"] as string,
      sequence_num: row["sequence_num"] as number,
      generation: row["generation"] as number,
      healthy: (row["healthy"] as number) === 1,
      status: row["status"] as string,
      last_error: row["last_error"] as string,
      current_config_hash: row["current_config_hash"]
        ? hexToUint8Array(row["current_config_hash"] as string)
        : null,
      desired_config_hash: desiredConfigHash ? hexToUint8Array(desiredConfigHash) : null,
      effective_config_hash: effectiveHash,
      effective_config_body: null,
      last_seen_at: row["last_seen_at"] as number,
      connected_at: row["connected_at"] as number,
      agent_description: row["agent_description"] as string | null,
      capabilities: (row["capabilities"] as number) ?? 0,
      component_health_map: row["component_health_map"]
        ? (safeJsonParse(row["component_health_map"]) as Record<string, unknown>)
        : null,
      available_components: row["available_components"]
        ? (safeJsonParse(row["available_components"]) as Record<string, unknown>)
        : null,
    };
  }

  // New agent — return default state
  return {
    instance_uid: hexToUint8Array(instanceUid),
    tenant_id: tenantId,
    config_id: configId,
    sequence_num: 0,
    generation: 1,
    healthy: true,
    status: "unknown",
    last_error: "",
    current_config_hash: null,
    desired_config_hash: desiredConfigHash ? hexToUint8Array(desiredConfigHash) : null,
    effective_config_hash: null,
    effective_config_body: null,
    last_seen_at: 0,
    connected_at: 0,
    agent_description: null,
    capabilities: 0,
    component_health_map: null,
    available_components: null,
  };
}

/**
 * Save (upsert) agent state to DO SQLite.
 */
export function saveAgentState(sql: SqlStorage, state: AgentState): void {
  const uid = uint8ToHex(state.instance_uid);
  const configHash = state.current_config_hash ? uint8ToHex(state.current_config_hash) : null;

  // Deduplicate effective config body into config_snapshots table
  if (state.effective_config_hash && state.effective_config_body) {
    sql.exec(
      `INSERT OR IGNORE INTO config_snapshots (hash, body) VALUES (?, ?)`,
      state.effective_config_hash,
      state.effective_config_body,
    );
  }

  const componentHealthMap = state.component_health_map
    ? JSON.stringify(state.component_health_map, (_k, v) =>
        typeof v === "bigint" ? v.toString() : v,
      )
    : null;
  const availableComponents = state.available_components
    ? JSON.stringify(state.available_components, (_k, v) =>
        typeof v === "bigint" ? v.toString() : v,
      )
    : null;

  sql.exec(
    `INSERT INTO agents (instance_uid, tenant_id, config_id, sequence_num, generation, healthy, status, last_error, current_config_hash, effective_config_hash, last_seen_at, connected_at, agent_description, capabilities, rate_window_start, rate_window_count, component_health_map, available_components)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
     ON CONFLICT(instance_uid) DO UPDATE SET
       sequence_num = excluded.sequence_num,
       generation = excluded.generation,
       healthy = excluded.healthy,
       status = excluded.status,
       last_error = excluded.last_error,
       current_config_hash = excluded.current_config_hash,
       effective_config_hash = COALESCE(excluded.effective_config_hash, agents.effective_config_hash),
       last_seen_at = excluded.last_seen_at,
       connected_at = CASE WHEN excluded.connected_at > 0 THEN excluded.connected_at ELSE agents.connected_at END,
       agent_description = COALESCE(excluded.agent_description, agents.agent_description),
       capabilities = excluded.capabilities,
       component_health_map = COALESCE(excluded.component_health_map, agents.component_health_map),
       available_components = COALESCE(excluded.available_components, agents.available_components)`,
    uid,
    state.tenant_id,
    state.config_id,
    state.sequence_num,
    state.generation,
    state.healthy ? 1 : 0,
    state.status,
    state.last_error,
    configHash,
    state.effective_config_hash,
    state.last_seen_at,
    state.connected_at,
    state.agent_description,
    state.capabilities,
    componentHealthMap,
    availableComponents,
  );
}

/**
 * Get agent count for limit enforcement.
 */
export function getAgentCount(sql: SqlStorage): number {
  return sql.exec("SELECT COUNT(*) as count FROM agents").one()["count"] as number;
}

/**
 * Check if a specific agent exists.
 */
export function agentExists(sql: SqlStorage, instanceUid: string): boolean {
  return sql.exec("SELECT 1 FROM agents WHERE instance_uid = ?", instanceUid).toArray().length > 0;
}

/**
 * Get the current generation of an agent, or 0 if not found.
 * Used to increment on reconnect.
 */
export function getAgentGeneration(sql: SqlStorage, instanceUid: string): number {
  const rows = sql
    .exec("SELECT generation FROM agents WHERE instance_uid = ?", instanceUid)
    .toArray();
  if (rows.length === 0) return 0;
  return (rows[0]!["generation"] as number) ?? 0;
}

/**
 * Mark an agent as disconnected.
 */
export function markDisconnected(sql: SqlStorage, instanceUid: string): void {
  sql.exec(
    `UPDATE agents SET status = 'disconnected', last_seen_at = ? WHERE instance_uid = ?`,
    Date.now(),
    instanceUid,
  );
}

/**
 * Get aggregate stats for the fleet.
 */
export function getStats(sql: SqlStorage): {
  total: number;
  connected: number;
  healthy: number;
} {
  const row = sql
    .exec(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status != 'disconnected' AND connected_at > 0 THEN 1 ELSE 0 END) as connected,
        SUM(CASE WHEN healthy = 1 AND status != 'disconnected' THEN 1 ELSE 0 END) as healthy
      FROM agents`,
    )
    .one();

  return {
    total: (row["total"] ?? 0) as number,
    connected: (row["connected"] ?? 0) as number,
    healthy: (row["healthy"] ?? 0) as number,
  };
}

/**
 * Aggregate cohort breakdown that does not require loading every agent row.
 *
 * `desiredConfigHash` is the configuration's current desired hash; agents whose
 * `current_config_hash` is set and differs from it are counted as drifted.
 * Returning the top N current-hash buckets (sorted by count desc) lets callers
 * surface the dominant deployed hashes without paginating through all agents.
 */
export function getCohortBreakdown(
  sql: SqlStorage,
  desiredConfigHash: string | null,
  topHashCount = 5,
  topStatusCount = 16,
): {
  drifted: number;
  status_counts: Record<string, number>;
  current_hash_counts: Array<{ value: string; count: number }>;
} {
  let drifted = 0;
  if (desiredConfigHash) {
    const row = sql
      .exec(
        `SELECT COUNT(*) as drifted
         FROM agents
         WHERE current_config_hash IS NOT NULL
           AND current_config_hash != ?`,
        desiredConfigHash,
      )
      .one();
    drifted = (row["drifted"] ?? 0) as number;
  }

  // Bounded cardinality: ingest already truncates `status` to 32 chars
  // (see `truncate` in state-machine/processor.ts), but defense-in-depth
  // here too — only return the top N statuses ordered by count, so a
  // misbehaving fleet can never make this aggregation unbounded.
  const statusRows = sql
    .exec(
      `SELECT COALESCE(status, 'unknown') as status, COUNT(*) as count
       FROM agents
       GROUP BY status
       ORDER BY count DESC, status ASC
       LIMIT ?`,
      topStatusCount,
    )
    .toArray() as Array<{ status: string; count: number }>;
  const status_counts: Record<string, number> = {};
  for (const r of statusRows) status_counts[r.status] = r.count;

  const hashRows = sql
    .exec(
      `SELECT current_config_hash as hash, COUNT(*) as count
       FROM agents
       WHERE current_config_hash IS NOT NULL
       GROUP BY current_config_hash
       ORDER BY count DESC, current_config_hash ASC
       LIMIT ?`,
      topHashCount,
    )
    .toArray() as Array<{ hash: string; count: number }>;

  return {
    drifted,
    status_counts,
    current_hash_counts: hashRows.map((r) => ({ value: r.hash, count: r.count })),
  };
}

/**
 * List agents (most recently seen first).
 * Returns summary data — excludes large blobs (effective_config_body).
 */

export function listAgentsPage(
  sql: SqlStorage,
  params: ListAgentsPageParams,
): { agents: Record<string, unknown>[]; hasMore: boolean; nextCursor: AgentPageCursor | null } {
  const where: string[] = [];
  const bind: Array<string | number> = [];
  if (params.q) {
    where.push(`(a.instance_uid LIKE ? OR COALESCE(a.agent_description, '') LIKE ?)`);
    const term = `%${params.q}%`;
    bind.push(term, term);
  }
  if (params.status) {
    where.push(`a.status = ?`);
    bind.push(params.status);
  }
  if (params.health === "healthy") where.push(`a.healthy = 1`);
  if (params.health === "unhealthy") where.push(`a.healthy = 0`);
  if (params.health === "unknown") where.push(`a.healthy IS NULL`);

  const dir = params.sort.endsWith("_desc") ? "DESC" : "ASC";
  if (params.cursor) {
    if (params.sort === "instance_uid_asc") {
      where.push(`a.instance_uid > ?`);
      bind.push(params.cursor.instance_uid);
    } else {
      where.push(
        `(a.last_seen_at ${dir === "DESC" ? "<" : ">"} ? OR (a.last_seen_at = ? AND a.instance_uid ${dir === "DESC" ? "<" : ">"} ?))`,
      );
      bind.push(params.cursor.last_seen_at, params.cursor.last_seen_at, params.cursor.instance_uid);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderSql =
    params.sort === "instance_uid_asc"
      ? "a.instance_uid ASC"
      : `a.last_seen_at ${dir}, a.instance_uid ${dir}`;
  // The list endpoint intentionally does not include `effective_config_body`
  // (which can be many KB per agent). Detail endpoints join `config_snapshots`
  // on demand for that field.
  const rows = sql
    .exec(
      `SELECT a.instance_uid,a.tenant_id,a.config_id,a.sequence_num,a.generation,a.healthy,a.status,a.last_error,a.current_config_hash,a.effective_config_hash,a.last_seen_at,a.connected_at,a.agent_description,a.capabilities,a.rate_window_start,a.rate_window_count,a.component_health_map,a.available_components FROM agents a ${whereSql} ORDER BY ${orderSql} LIMIT ?`,
      ...bind,
      params.limit + 1,
    )
    .toArray();
  const hasMore = rows.length > params.limit;
  // Normalize the JSON-encoded blob columns so API consumers see parsed
  // objects (matches `listAgents` and `getAgent` behavior).
  const agents = (hasMore ? rows.slice(0, params.limit) : rows).map((row) => ({
    ...row,
    healthy: row["healthy"] === 1,
    agent_description: row["agent_description"]
      ? (safeJsonParse(row["agent_description"]) as Record<string, unknown>)
      : undefined,
    component_health_map: row["component_health_map"]
      ? (safeJsonParse(row["component_health_map"]) as Record<string, unknown>)
      : undefined,
    available_components: row["available_components"]
      ? (safeJsonParse(row["available_components"]) as Record<string, unknown>)
      : undefined,
  }));
  const tail = agents[agents.length - 1] as Record<string, unknown> | undefined;
  const nextCursor =
    hasMore && tail
      ? {
          last_seen_at: Number(tail["last_seen_at"] ?? 0),
          instance_uid: String(tail["instance_uid"] ?? ""),
        }
      : null;
  return { agents, hasMore, nextCursor };
}

/**
 * Compute fleet metrics via a single SQL aggregate query — O(1) memory.
 * Replaces an earlier `loadAgentsForMetrics()` + `computeConfigMetrics()`
 * pattern that materialized every row into JS memory.
 */
export function computeMetricsSql(
  sql: SqlStorage,
  desiredConfigHash: string | null,
  staleThresholdMs: number,
): ConfigMetrics {
  const now = Date.now();
  const staleTimestamp = now - staleThresholdMs;

  const row = sql
    .exec(
      `SELECT
        COUNT(*) AS agent_count,
        SUM(CASE WHEN status != 'disconnected' AND connected_at > 0 THEN 1 ELSE 0 END) AS connected_count,
        SUM(CASE WHEN status = 'disconnected' THEN 1 ELSE 0 END) AS disconnected_count,
        SUM(CASE WHEN healthy = 1 THEN 1 ELSE 0 END) AS healthy_count,
        SUM(CASE WHEN healthy = 0 OR healthy IS NULL THEN 1 ELSE 0 END) AS unhealthy_count,
        SUM(CASE WHEN healthy = 1 AND status != 'disconnected' AND connected_at > 0 THEN 1 ELSE 0 END) AS connected_healthy_count,
        SUM(CASE WHEN (? IS NULL) OR current_config_hash = ? THEN 1 ELSE 0 END) AS config_up_to_date,
        SUM(CASE WHEN ? IS NOT NULL AND (current_config_hash IS NULL OR current_config_hash != ?) THEN 1 ELSE 0 END) AS config_pending,
        SUM(CASE WHEN last_error != '' AND last_error IS NOT NULL THEN 1 ELSE 0 END) AS agents_with_errors,
        SUM(CASE WHEN status != 'disconnected' AND last_seen_at > 0 AND last_seen_at < ? THEN 1 ELSE 0 END) AS agents_stale
      FROM agents`,
      desiredConfigHash,
      desiredConfigHash,
      desiredConfigHash,
      desiredConfigHash,
      staleTimestamp,
    )
    .toArray()[0];

  if (!row) {
    return {
      agent_count: 0,
      connected_count: 0,
      disconnected_count: 0,
      healthy_count: 0,
      unhealthy_count: 0,
      connected_healthy_count: 0,
      config_up_to_date: 0,
      config_pending: 0,
      agents_with_errors: 0,
      agents_stale: 0,
      websocket_count: 0,
    };
  }

  return {
    agent_count: Number(row["agent_count"] ?? 0),
    connected_count: Number(row["connected_count"] ?? 0),
    disconnected_count: Number(row["disconnected_count"] ?? 0),
    healthy_count: Number(row["healthy_count"] ?? 0),
    unhealthy_count: Number(row["unhealthy_count"] ?? 0),
    connected_healthy_count: Number(row["connected_healthy_count"] ?? 0),
    config_up_to_date: Number(row["config_up_to_date"] ?? 0),
    config_pending: Number(row["config_pending"] ?? 0),
    agents_with_errors: Number(row["agents_with_errors"] ?? 0),
    agents_stale: Number(row["agents_stale"] ?? 0),
    websocket_count: 0, // set by caller
  };
}

/**
 * Get a single agent by instance_uid with full detail (parsed JSON blobs).
 */
export function getAgent(sql: SqlStorage, uid: string): Record<string, unknown> | null {
  const row = sql
    .exec(
      `SELECT
        a.instance_uid,
        a.tenant_id,
        a.config_id,
        a.sequence_num,
        a.generation,
        a.healthy,
        a.status,
        a.last_error,
        a.current_config_hash,
        a.effective_config_hash,
        cs.body AS effective_config_body,
        a.last_seen_at,
        a.connected_at,
        a.agent_description,
        a.capabilities,
        a.component_health_map,
        a.available_components
       FROM agents a
       LEFT JOIN config_snapshots cs ON cs.hash = a.effective_config_hash
       WHERE a.instance_uid = ?`,
      uid,
    )
    .toArray()[0];

  if (!row) return null;

  return {
    ...row,
    healthy: row["healthy"] === 1,
    agent_description: safeJsonParse(row["agent_description"] as string | null),
    component_health_map: safeJsonParse(row["component_health_map"] as string | null),
    available_components: safeJsonParse(row["available_components"] as string | null),
  };
}
// ─── Stale Agent Detection ──────────────────────────────────────────

/**
 * Mark agents as disconnected if their last_seen_at is older than the
 * given threshold (in ms). Returns the UIDs of agents that were marked stale.
 */

export function sweepStaleAgents(
  sql: SqlStorage,
  staleThresholdMs: number,
  activeInstanceUids = new Set<string>(),
): StaleAgent[] {
  const cutoff = Date.now() - staleThresholdMs;
  const candidates = sql
    .exec(
      `SELECT instance_uid, tenant_id, config_id
       FROM agents
       WHERE status != 'disconnected' AND last_seen_at > 0 AND last_seen_at < ?`,
      cutoff,
    )
    .toArray()
    .filter((r) => !activeInstanceUids.has(r["instance_uid"] as string));

  const stale = candidates.map((r) => ({
    instance_uid: r["instance_uid"] as string,
    tenant_id: r["tenant_id"] as string,
    config_id: r["config_id"] as string,
  }));

  for (let i = 0; i < stale.length; i += 250) {
    const chunk = stale.slice(i, i + 250);
    const placeholders = chunk.map(() => "?").join(",");
    sql.exec(
      `UPDATE agents SET status = 'disconnected' WHERE instance_uid IN (${placeholders})`,
      ...chunk.map((agent) => agent.instance_uid),
    );
  }

  return stale;
}

// ─── Alarm Sweep Tracking ───────────────────────────────────────────

/**
 * Record that a stale sweep just completed.
 */
export function recordSweep(sql: SqlStorage, result: SweepResult): void {
  const sweptAt = Date.now();
  sql.exec(
    `UPDATE do_config SET
      last_sweep_at = ?,
      last_sweep_stale_count = ?,
      last_sweep_active_socket_count = ?,
      last_sweep_duration_ms = ?,
      last_stale_sweep_at = CASE WHEN ? > 0 THEN ? ELSE last_stale_sweep_at END,
      total_sweeps = total_sweeps + 1,
      total_stale_swept = total_stale_swept + ?,
      sweeps_with_stale = sweeps_with_stale + ?
     WHERE id = 1`,
    sweptAt,
    result.staleCount,
    result.activeSocketCount,
    result.durationMs,
    result.staleCount,
    sweptAt,
    result.staleCount,
    result.staleCount > 0 ? 1 : 0,
  );
}

export function getSweepStats(sql: SqlStorage): SweepStats {
  const row = sql
    .exec(
      `SELECT
        last_sweep_at,
        last_sweep_stale_count,
        last_sweep_active_socket_count,
        last_sweep_duration_ms,
        last_stale_sweep_at,
        total_sweeps,
        total_stale_swept,
        sweeps_with_stale
       FROM do_config WHERE id = 1`,
    )
    .one();
  return {
    last_sweep_at: row["last_sweep_at"] as number,
    last_sweep_stale_count: row["last_sweep_stale_count"] as number,
    last_sweep_active_socket_count: row["last_sweep_active_socket_count"] as number,
    last_sweep_duration_ms: row["last_sweep_duration_ms"] as number,
    last_stale_sweep_at: row["last_stale_sweep_at"] as number,
    total_sweeps: row["total_sweeps"] as number,
    total_stale_swept: row["total_stale_swept"] as number,
    sweeps_with_stale: row["sweeps_with_stale"] as number,
  };
}

// ─── Pending Devices (DO-local SQLite for __pending__ DOs) ─────────────

export interface PendingDeviceInfo {
  instance_uid: string;
  tenant_id: string;
  display_name: string | null;
  source_ip: string | null;
  geo_country: string | null;
  geo_city: string | null;
  geo_lat: number | null;
  geo_lon: number | null;
  agent_description: string | null;
  connected_at: number;
  last_seen_at: number;
}

export interface PendingAssignment {
  instance_uid: string;
  tenant_id: string;
  target_config_id: string;
  assigned_at: number;
  assigned_by: string | null;
}

export function upsertPendingDevice(
  sql: SqlStorage,
  info: {
    instance_uid: string;
    tenant_id: string;
    display_name?: string | null;
    source_ip?: string | null;
    geo_country?: string | null;
    geo_city?: string | null;
    geo_lat?: number | null;
    geo_lon?: number | null;
    agent_description?: string | null;
    connected_at?: number;
  },
): void {
  const now = Date.now();
  sql.exec(
    `INSERT INTO pending_devices (instance_uid, tenant_id, display_name, source_ip, geo_country, geo_city, geo_lat, geo_lon, agent_description, connected_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(instance_uid) DO UPDATE SET
       display_name = COALESCE(excluded.display_name, pending_devices.display_name),
       source_ip = COALESCE(excluded.source_ip, pending_devices.source_ip),
       geo_country = COALESCE(excluded.geo_country, pending_devices.geo_country),
       geo_city = COALESCE(excluded.geo_city, pending_devices.geo_city),
       geo_lat = COALESCE(excluded.geo_lat, pending_devices.geo_lat),
       geo_lon = COALESCE(excluded.geo_lon, pending_devices.geo_lon),
       agent_description = COALESCE(excluded.agent_description, pending_devices.agent_description),
       connected_at = CASE WHEN excluded.connected_at > 0 THEN excluded.connected_at ELSE pending_devices.connected_at END,
       last_seen_at = ?
     WHERE instance_uid = ?`,
    info.instance_uid,
    info.tenant_id,
    info.display_name ?? null,
    info.source_ip ?? null,
    info.geo_country ?? null,
    info.geo_city ?? null,
    info.geo_lat ?? null,
    info.geo_lon ?? null,
    info.agent_description ?? null,
    info.connected_at ?? 0,
    now,
    now,
    info.instance_uid,
  );
}

export function getPendingDevice(sql: SqlStorage, instanceUid: string): PendingDeviceInfo | null {
  const row = sql
    .exec(`SELECT * FROM pending_devices WHERE instance_uid = ?`, instanceUid)
    .toArray()[0];
  if (!row) return null;
  return {
    instance_uid: row["instance_uid"] as string,
    tenant_id: row["tenant_id"] as string,
    display_name: row["display_name"] as string | null,
    source_ip: row["source_ip"] as string | null,
    geo_country: row["geo_country"] as string | null,
    geo_city: row["geo_city"] as string | null,
    geo_lat: row["geo_lat"] as number | null,
    geo_lon: row["geo_lon"] as number | null,
    agent_description: row["agent_description"] as string | null,
    connected_at: row["connected_at"] as number,
    last_seen_at: row["last_seen_at"] as number,
  };
}

export function listPendingDevices(
  sql: SqlStorage,
  tenantId: string,
  limit = 100,
): PendingDeviceInfo[] {
  const rows = sql
    .exec(
      `SELECT * FROM pending_devices WHERE tenant_id = ? ORDER BY last_seen_at DESC LIMIT ?`,
      tenantId,
      limit,
    )
    .toArray();
  return rows.map((row) => ({
    instance_uid: row["instance_uid"] as string,
    tenant_id: row["tenant_id"] as string,
    display_name: row["display_name"] as string | null,
    source_ip: row["source_ip"] as string | null,
    geo_country: row["geo_country"] as string | null,
    geo_city: row["geo_city"] as string | null,
    geo_lat: row["geo_lat"] as number | null,
    geo_lon: row["geo_lon"] as number | null,
    agent_description: row["agent_description"] as string | null,
    connected_at: row["connected_at"] as number,
    last_seen_at: row["last_seen_at"] as number,
  }));
}

// Deletes only the pending_devices row. pending_assignments has its own
// lifecycle — it's written by /assign and consumed by reconnect, and must
// outlive deletePendingDevice on the assign path. Use deletePendingAssignment
// (below) when you also need to drop the assignment row.
export function deletePendingDevice(sql: SqlStorage, instanceUid: string): void {
  sql.exec(`DELETE FROM pending_devices WHERE instance_uid = ?`, instanceUid);
}

export function upsertPendingAssignment(
  sql: SqlStorage,
  assignment: {
    instance_uid: string;
    tenant_id: string;
    target_config_id: string;
    assigned_by?: string | null;
  },
): void {
  const now = Date.now();
  sql.exec(
    `INSERT INTO pending_assignments (instance_uid, tenant_id, target_config_id, assigned_at, assigned_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(instance_uid) DO UPDATE SET
       target_config_id = excluded.target_config_id,
       assigned_at = excluded.assigned_at,
       assigned_by = COALESCE(excluded.assigned_by, pending_assignments.assigned_by)`,
    assignment.instance_uid,
    assignment.tenant_id,
    assignment.target_config_id,
    now,
    assignment.assigned_by ?? null,
  );
}

export function getPendingAssignment(
  sql: SqlStorage,
  instanceUid: string,
): PendingAssignment | null {
  const row = sql
    .exec(`SELECT * FROM pending_assignments WHERE instance_uid = ?`, instanceUid)
    .toArray()[0];
  if (!row) return null;
  return {
    instance_uid: row["instance_uid"] as string,
    tenant_id: row["tenant_id"] as string,
    target_config_id: row["target_config_id"] as string,
    assigned_at: row["assigned_at"] as number,
    assigned_by: row["assigned_by"] as string | null,
  };
}

export function deletePendingAssignment(sql: SqlStorage, instanceUid: string): void {
  sql.exec(`DELETE FROM pending_assignments WHERE instance_uid = ?`, instanceUid);
}

export function checkPendingDeviceRateLimit(
  sql: SqlStorage,
  uid: string,
  maxPerMinute: number,
): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;

  const row = sql
    .exec(
      `UPDATE pending_devices SET
       rate_window_start = CASE WHEN rate_window_start < ? THEN ? ELSE rate_window_start END,
       rate_window_count = CASE WHEN rate_window_start < ? THEN 1 ELSE rate_window_count + 1 END
     WHERE instance_uid = ?
     RETURNING rate_window_count`,
      windowStart,
      now,
      windowStart,
      uid,
    )
    .toArray()[0];

  if (!row) return false;
  return (row["rate_window_count"] as number) > maxPerMinute;
}
