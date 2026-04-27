// Agent State Repository — DO-local SQLite persistence for agent state
// Extracted from config-do.ts for testability and separation of concerns
//
// Design: ALL mutable state lives in SQLite. The DO class has zero instance
// fields that need to survive hibernation. SQLite queries are synchronous
// in DO-local storage (~µs per query), so this is effectively free.

import type { AgentState } from "@o11yfleet/core/state-machine";
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
      last_seen_at INTEGER NOT NULL DEFAULT 0,
      connected_at INTEGER NOT NULL DEFAULT 0,
      agent_description TEXT,
      capabilities INTEGER NOT NULL DEFAULT 0,
      rate_window_start INTEGER NOT NULL DEFAULT 0,
      rate_window_count INTEGER NOT NULL DEFAULT 0
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS do_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      desired_config_hash TEXT,
      desired_config_content TEXT
    )
  `);
  // Ensure singleton row exists
  sql.exec(`INSERT OR IGNORE INTO do_config (id) VALUES (1)`);
  // Indexes for alarm sweep and stats queries
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)`);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_agents_last_seen ON agents(last_seen_at) WHERE status != 'disconnected'`);
}

// ─── Config State ───────────────────────────────────────────────────

export interface DesiredConfig {
  hash: string | null;
  content: string | null;
}

/**
 * Load desired config from SQLite (sync, ~µs).
 */
export function loadDesiredConfig(sql: SqlStorage): DesiredConfig {
  const row = sql.exec(`SELECT desired_config_hash, desired_config_content FROM do_config WHERE id = 1`).one();
  return {
    hash: (row["desired_config_hash"] as string) ?? null,
    content: (row["desired_config_content"] as string) ?? null,
  };
}

/**
 * Save desired config to SQLite (sync, ~µs).
 */
export function saveDesiredConfig(sql: SqlStorage, hash: string, content: string | null): void {
  sql.exec(
    `UPDATE do_config SET desired_config_hash = ?, desired_config_content = ? WHERE id = 1`,
    hash,
    content,
  );
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
  const row = sql.exec(
    `UPDATE agents SET
       rate_window_start = CASE WHEN rate_window_start < ? THEN ? ELSE rate_window_start END,
       rate_window_count = CASE WHEN rate_window_start < ? THEN 1 ELSE rate_window_count + 1 END
     WHERE instance_uid = ?
     RETURNING rate_window_count`,
    windowStart, now,
    windowStart,
    uid,
  ).toArray()[0];

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
  const row = sql
    .exec(`SELECT * FROM agents WHERE instance_uid = ?`, instanceUid)
    .toArray()[0];

  if (row) {
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
      desired_config_hash: desiredConfigHash
        ? hexToUint8Array(desiredConfigHash)
        : null,
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
    desired_config_hash: desiredConfigHash
      ? hexToUint8Array(desiredConfigHash)
      : null,
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

  sql.exec(
    `INSERT INTO agents (instance_uid, tenant_id, config_id, sequence_num, generation, healthy, status, last_error, current_config_hash, last_seen_at, connected_at, agent_description, capabilities, rate_window_start, rate_window_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
     ON CONFLICT(instance_uid) DO UPDATE SET
       sequence_num = excluded.sequence_num,
       generation = excluded.generation,
       healthy = excluded.healthy,
       status = excluded.status,
       last_error = excluded.last_error,
       current_config_hash = excluded.current_config_hash,
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
        SUM(CASE WHEN status = 'connected' THEN 1 ELSE 0 END) as connected,
        SUM(CASE WHEN healthy = 1 THEN 1 ELSE 0 END) as healthy
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
 * List agents (most recently seen first).
 */
export function listAgents(sql: SqlStorage, limit = 1000): Record<string, unknown>[] {
  return sql
    .exec(`SELECT * FROM agents ORDER BY last_seen_at DESC LIMIT ?`, limit)
    .toArray();
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

export function sweepStaleAgents(sql: SqlStorage, staleThresholdMs: number): StaleAgent[] {
  const cutoff = Date.now() - staleThresholdMs;
  const stale = sql
    .exec(
      `UPDATE agents SET status = 'disconnected'
       WHERE status != 'disconnected' AND last_seen_at > 0 AND last_seen_at < ?
       RETURNING instance_uid, tenant_id, config_id`,
      cutoff,
    )
    .toArray();
  return stale.map((r) => ({
    instance_uid: r["instance_uid"] as string,
    tenant_id: r["tenant_id"] as string,
    config_id: r["config_id"] as string,
  }));
}
