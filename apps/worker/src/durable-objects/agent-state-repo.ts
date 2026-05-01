// Agent State Repository — DO-local SQLite persistence for agent state
// Extracted from config-do.ts for testability and separation of concerns
//
// Design: ALL mutable state lives in SQLite. The DO class has zero instance
// fields that need to survive hibernation. SQLite queries are synchronous
// in DO-local storage (~µs per query), so this is effectively free.

import type { AgentState } from "@o11yfleet/core/state-machine";
import type { AgentMetricsInput } from "@o11yfleet/core/metrics";
import { hexToUint8Array, uint8ToHex } from "@o11yfleet/core/hex";

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
      rate_window_count INTEGER NOT NULL DEFAULT 0
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
      sweeps_with_stale INTEGER NOT NULL DEFAULT 0
    )
  `);
  // Ensure singleton row exists
  sql.exec(`INSERT OR IGNORE INTO do_config (id) VALUES (1)`);
  // Indexes for alarm sweep and stats queries
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)`);
  sql.exec(
    `CREATE INDEX IF NOT EXISTS idx_agents_last_seen ON agents(last_seen_at) WHERE status != 'disconnected'`,
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

export interface DesiredConfig {
  hash: string | null;
  content: string | null;
  /**
   * UTF-8 encoded bytes of `content`, computed once on `set-desired-config`
   * and persisted alongside the content so the WS hot path doesn't run
   * `TextEncoder.encode()` per heartbeat. `null` when no content is set.
   */
  bytes: Uint8Array | null;
}

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

export interface DoIdentity {
  tenant_id: string;
  config_id: string;
}

export function loadDoIdentity(sql: SqlStorage): DoIdentity {
  const row = sql.exec(`SELECT tenant_id, config_id FROM do_config WHERE id = 1`).one();
  return {
    tenant_id: (row["tenant_id"] as string) ?? "",
    config_id: (row["config_id"] as string) ?? "",
  };
}

export function saveDoIdentity(sql: SqlStorage, tenantId: string, configId: string): void {
  if (!tenantId || !configId) return;
  sql.exec(`UPDATE do_config SET tenant_id = ?, config_id = ? WHERE id = 1`, tenantId, configId);
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
      // Hot path only needs the hash for change detection. The body is written
      // to config_snapshots when newly reported, but not loaded on every heartbeat.
      effective_config_body: null,
      last_seen_at: row["last_seen_at"] as number,
      connected_at: row["connected_at"] as number,
      agent_description: row["agent_description"] as string | null,
      capabilities: (row["capabilities"] as number) ?? 0,
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

  sql.exec(
    `INSERT INTO agents (instance_uid, tenant_id, config_id, sequence_num, generation, healthy, status, last_error, current_config_hash, effective_config_hash, last_seen_at, connected_at, agent_description, capabilities, rate_window_start, rate_window_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
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
       capabilities = excluded.capabilities`,
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
 */
export type AgentSort = "last_seen_desc" | "last_seen_asc" | "instance_uid_asc";

export interface AgentPageCursor {
  last_seen_at: number;
  instance_uid: string;
}

export interface ListAgentsPageParams {
  limit: number;
  cursor?: AgentPageCursor | null;
  q?: string;
  status?: string;
  health?: "healthy" | "unhealthy" | "unknown";
  sort: AgentSort;
}

export function listAgents(sql: SqlStorage, limit = 1000): Record<string, unknown>[] {
  return sql
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
        a.rate_window_start,
        a.rate_window_count
       FROM agents a
       LEFT JOIN config_snapshots cs ON cs.hash = a.effective_config_hash
       ORDER BY a.last_seen_at DESC
       LIMIT ?`,
      limit,
    )
    .toArray();
}

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
  const rows = sql
    .exec(
      `SELECT a.instance_uid,a.tenant_id,a.config_id,a.sequence_num,a.generation,a.healthy,a.status,a.last_error,a.current_config_hash,a.effective_config_hash,cs.body AS effective_config_body,a.last_seen_at,a.connected_at,a.agent_description,a.capabilities,a.rate_window_start,a.rate_window_count FROM agents a LEFT JOIN config_snapshots cs ON cs.hash = a.effective_config_hash ${whereSql} ORDER BY ${orderSql} LIMIT ?`,
      ...bind,
      params.limit + 1,
    )
    .toArray();
  const hasMore = rows.length > params.limit;
  const agents = hasMore ? rows.slice(0, params.limit) : rows;
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

export function loadAgentsForMetrics(sql: SqlStorage): Map<string, AgentMetricsInput> {
  const rows = sql
    .exec(
      `SELECT instance_uid, status, healthy, capabilities, current_config_hash, last_error, last_seen_at FROM agents`,
    )
    .toArray();

  const result = new Map<string, AgentMetricsInput>();
  for (const row of rows) {
    const instanceUid = (row["instance_uid"] as string | null) ?? "unknown";
    result.set(instanceUid, {
      status: (row["status"] as string | null) ?? "unknown",
      healthy: (row["healthy"] as number | null) ?? 0,
      capabilities: (row["capabilities"] as number | null) ?? 0,
      current_config_hash: row["current_config_hash"] as string | null,
      last_error: (row["last_error"] as string | null) ?? "",
      last_seen_at: (row["last_seen_at"] as number | null) ?? 0,
    });
  }
  return result;
}
// ─── Stale Agent Detection ──────────────────────────────────────────

/**
 * Mark agents as disconnected if their last_seen_at is older than the
 * given threshold (in ms). Returns the UIDs of agents that were marked stale.
 */
export interface StaleAgent {
  instance_uid: string;
  tenant_id: string;
  config_id: string;
}

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

export interface SweepResult {
  staleCount: number;
  activeSocketCount: number;
  durationMs: number;
}

export interface SweepStats {
  last_sweep_at: number;
  last_sweep_stale_count: number;
  last_sweep_active_socket_count: number;
  last_sweep_duration_ms: number;
  last_stale_sweep_at: number;
  total_sweeps: number;
  total_stale_swept: number;
  sweeps_with_stale: number;
}

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
