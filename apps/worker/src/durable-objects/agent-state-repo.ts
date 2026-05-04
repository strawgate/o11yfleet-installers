// Agent State Repository — DO-local SQLite persistence for agent state
// Extracted from config-do.ts for testability and separation of concerns
//
// Design: ALL mutable state lives in SQLite. The DO class has zero instance
// fields that need to survive hibernation. SQLite queries are synchronous
// in DO-local storage (~µs per query), so this is effectively free.

import type { AgentState } from "@o11yfleet/core/state-machine";
import type { ConfigMetrics } from "@o11yfleet/core/metrics";
import { hexToUint8Array, uint8ToHex } from "@o11yfleet/core/hex";
import { assertNever } from "@o11yfleet/core/assert-never";
import type {
  FleetComponentGroup,
  DesiredConfig,
  DoPolicy,
  AgentPageCursor,
  ListAgentsPageParams,
  StaleAgent,
  SweepResult,
  SweepStats,
} from "./agent-state-repo-interface.js";
import { doDb, execQuery, execQueryOne, execMutation, execMutationCount } from "./do-query.js";
import type { AgentsTable, DoConfigTable } from "./do-sqlite-schema.js";

/** JSON.stringify with BigInt → string coercion. SQLite columns
 *  carrying capability bitmasks decode as BigInt; the agent state JSON
 *  needs them serialized as strings. Returns null for null/undefined input
 *  so call sites don't need to wrap in a conditional. */
function stringifyWithBigint(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

/** TTL for pending devices and stale assignments (48 hours). */
const STALE_PENDING_TTL_MS = 48 * 60 * 60 * 1000;

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

// ─── Version-numbered DO SQLite migration system ────────────────────
//
// Each Migration.up function must be idempotent: safe to run on a DO
// whose schema already contains the target objects (e.g. columns added
// by a prior CREATE TABLE IF NOT EXISTS in version 1).

interface Migration {
  version: number;
  description: string;
  up: (sql: SqlStorage) => void;
}

/** Check whether a column exists on a table (used by historical migrations). */
function hasColumn(sql: SqlStorage, table: string, column: string): boolean {
  return sql
    .exec(`PRAGMA table_info(${table})`)
    .toArray()
    .some((c) => c["name"] === column);
}

/** Add a column only if it doesn't already exist. */
function addColumnIfMissing(sql: SqlStorage, table: string, definition: string): void {
  const colName = definition.split(/\s/)[0]!;
  if (!hasColumn(sql, table, colName)) {
    sql.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

export const MIGRATIONS: readonly Migration[] = [
  // ── V1: full base schema (CREATE IF NOT EXISTS — inherently idempotent) ──
  {
    version: 1,
    description: "Base schema: agents, config_snapshots, do_config, pending tables",
    up: (sql) => {
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
          component_health_map TEXT,
          available_components TEXT,
          config_fail_count INTEGER NOT NULL DEFAULT 0,
          config_last_failed_hash TEXT
        )
      `);
      // Deduplicated config snapshots — one row per unique effective config hash.
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
          max_agents_per_config INTEGER,
          auto_unenroll_after_days INTEGER DEFAULT 30
        )
      `);
      sql.exec(`INSERT OR IGNORE INTO do_config (id) VALUES (1)`);
      // Intentionally NO indexes on `agents`. DO-local SQLite is in-process —
      // full table scans of 30K rows take <1ms. Each index adds +1 billed row
      // written per UPSERT ($1/M), dwarfing the read savings ($0.001/M).
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
          expires_at INTEGER
        )
      `);
      sql.exec(
        `CREATE INDEX IF NOT EXISTS idx_pending_devices_tenant ON pending_devices(tenant_id)`,
      );
      sql.exec(
        `CREATE INDEX IF NOT EXISTS idx_pending_devices_last_seen ON pending_devices(last_seen_at)`,
      );
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
    },
  },

  // ── Historical migrations (V2–V9) ──
  // These exist so the version table documents what happened. Each up()
  // is idempotent: columns already present from V1 are silently skipped.

  {
    version: 2,
    description: "Add tenant_id, config_id to do_config",
    up: (sql) => {
      addColumnIfMissing(sql, "do_config", "tenant_id TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(sql, "do_config", "config_id TEXT NOT NULL DEFAULT ''");
    },
  },
  {
    version: 3,
    description: "Add max_agents_per_config policy to do_config",
    up: (sql) => {
      addColumnIfMissing(sql, "do_config", "max_agents_per_config INTEGER");
    },
  },
  {
    version: 4,
    description: "Add desired_config_bytes (pre-encoded YAML) to do_config",
    up: (sql) => {
      addColumnIfMissing(sql, "do_config", "desired_config_bytes BLOB");
    },
  },
  {
    version: 5,
    description: "Add sweep tracking columns to do_config",
    up: (sql) => {
      for (const col of [
        "last_sweep_at INTEGER NOT NULL DEFAULT 0",
        "last_sweep_stale_count INTEGER NOT NULL DEFAULT 0",
        "last_sweep_active_socket_count INTEGER NOT NULL DEFAULT 0",
        "last_sweep_duration_ms INTEGER NOT NULL DEFAULT 0",
        "last_stale_sweep_at INTEGER NOT NULL DEFAULT 0",
        "total_sweeps INTEGER NOT NULL DEFAULT 0",
        "total_stale_swept INTEGER NOT NULL DEFAULT 0",
        "sweeps_with_stale INTEGER NOT NULL DEFAULT 0",
      ]) {
        addColumnIfMissing(sql, "do_config", col);
      }
    },
  },
  {
    version: 6,
    description: "Add auto_unenroll_after_days to do_config",
    up: (sql) => {
      addColumnIfMissing(sql, "do_config", "auto_unenroll_after_days INTEGER DEFAULT 30");
      sql.exec(
        `UPDATE do_config SET auto_unenroll_after_days = 30 WHERE auto_unenroll_after_days IS NULL`,
      );
    },
  },
  {
    version: 7,
    description: "Migrate effective_config_body to config_snapshots, drop agent indexes",
    up: (sql) => {
      if (hasColumn(sql, "agents", "effective_config_body")) {
        sql.exec(`
          INSERT OR IGNORE INTO config_snapshots (hash, body)
          SELECT effective_config_hash, effective_config_body
          FROM agents
          WHERE effective_config_hash IS NOT NULL AND effective_config_body IS NOT NULL
        `);
      }
      sql.exec(`DROP INDEX IF EXISTS idx_agents_status`);
      sql.exec(`DROP INDEX IF EXISTS idx_agents_last_seen`);
      sql.exec(`DROP INDEX IF EXISTS idx_agents_config_hash`);
    },
  },
  {
    version: 8,
    description: "Add config fail tracking columns to agents",
    up: (sql) => {
      addColumnIfMissing(sql, "agents", "config_fail_count INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(sql, "agents", "config_last_failed_hash TEXT");
    },
  },
  {
    version: 9,
    description: "Add expires_at to pending_devices",
    up: (sql) => {
      addColumnIfMissing(sql, "pending_devices", "expires_at INTEGER");
    },
  },
];

/**
 * Run all pending DO-local SQLite migrations.
 *
 * Idempotent: re-running on an already-migrated DO is a no-op (only a
 * single SELECT against `_schema_version`). Each migration's `up` is
 * also individually idempotent so that V1's full CREATE TABLE IF NOT
 * EXISTS doesn't conflict with the historical ALTER TABLE migrations.
 */
export function runMigrations(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS _schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    description TEXT
  )`);

  const applied = new Set(
    sql
      .exec(`SELECT version FROM _schema_version`)
      .toArray()
      .map((r) => (r as Record<string, unknown>)["version"] as number),
  );

  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    m.up(sql);
    sql.exec(
      `INSERT INTO _schema_version (version, description) VALUES (?, ?)`,
      m.version,
      m.description,
    );
    applied.add(m.version);
  }
}

/** @deprecated Use {@link runMigrations} instead. Alias kept for backward compatibility. */
export const initSchema = runMigrations;

// ─── Component Inventory ────────────────────────────────────────────

export function getFleetComponentInventory(
  sql: SqlStorage,
  tenantId: string,
  configId: string,
): FleetComponentGroup[] {
  const compiled = doDb
    .selectFrom("agents")
    .select(["instance_uid", "available_components"])
    .where("tenant_id", "=", tenantId)
    .where("config_id", "=", configId)
    .where("status", "!=", "disconnected")
    .compile();
  const rows = execQuery<Pick<AgentsTable, "instance_uid" | "available_components">>(sql, compiled);

  const groups = new Map<string, FleetComponentGroup>();
  for (const row of rows) {
    const fingerprint = row.available_components ?? "null";
    if (!groups.has(fingerprint)) {
      groups.set(fingerprint, { availableComponents: fingerprint, agentCount: 0, agentUids: [] });
    }
    const g = groups.get(fingerprint)!;
    g.agentCount++;
    g.agentUids.push(row.instance_uid);
  }
  return Array.from(groups.values()).sort((a, b) => b.agentCount - a.agentCount);
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
  const compiled = doDb
    .selectFrom("do_config")
    .select(["desired_config_hash", "desired_config_content", "desired_config_bytes"])
    .where("id", "=", 1)
    .compile();
  const row = execQueryOne<
    Pick<DoConfigTable, "desired_config_hash" | "desired_config_content" | "desired_config_bytes">
  >(sql, compiled);
  if (!row) return { hash: null, content: null, bytes: null };
  const stored = row.desired_config_bytes;
  let bytes: Uint8Array | null = null;
  if (stored instanceof Uint8Array) {
    bytes = stored;
  } else if (stored instanceof ArrayBuffer) {
    bytes = new Uint8Array(stored);
  }
  return {
    hash: row.desired_config_hash ?? null,
    content: row.desired_config_content ?? null,
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
  const compiled = doDb
    .updateTable("do_config")
    .set({
      desired_config_hash: hash,
      desired_config_content: content,
      desired_config_bytes: encoded,
    })
    .where("id", "=", 1)
    .compile();
  execMutation(sql, compiled);
}

// Identity is derived from `ctx.id.name` at the call site (see ConfigDO's
// `getMyIdentity()`); this helper just persists the parsed identity to
// the do_config row so the SQL surface stays self-describing for ad-hoc
// debug queries. There is intentionally no `loadDoIdentity` — every
// route reads `ctx.id.name` directly, and the repo isn't a source of
// truth for identity any more.
export function saveDoIdentity(sql: SqlStorage, tenantId: string, configId: string): void {
  if (!tenantId || !configId) return;
  const compiled = doDb
    .updateTable("do_config")
    .set({ tenant_id: tenantId, config_id: configId })
    .where("id", "=", 1)
    .compile();
  execMutation(sql, compiled);
}

// `DoPolicy` lives in `./agent-state-repo-interface.ts` as the canonical
// type. The previous duplicate declaration here would have allowed the
// two copies to drift; importing instead keeps them in sync.

/** Reusable positive integer check for policy fields. */
export function isValidPositiveInt(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0
  );
}

/** @deprecated Use isValidPositiveInt. Kept for backward compatibility with tests. */
export const isValidMaxAgents = isValidPositiveInt;

export function loadDoPolicy(sql: SqlStorage): DoPolicy {
  const compiled = doDb
    .selectFrom("do_config")
    .select(["max_agents_per_config", "auto_unenroll_after_days"])
    .where("id", "=", 1)
    .compile();
  const row = execQueryOne<
    Pick<DoConfigTable, "max_agents_per_config" | "auto_unenroll_after_days">
  >(sql, compiled);

  let maxAgents: number | null = null;
  if (row) {
    const rawMax = row.max_agents_per_config;
    if (rawMax !== null && rawMax !== undefined) {
      if (isValidMaxAgents(rawMax)) {
        maxAgents = rawMax;
      } else {
        console.warn(
          `[do-policy] discarding invalid max_agents_per_config: ${typeof rawMax}=${String(rawMax).slice(0, 32)}`,
        );
      }
    }
  }

  let autoUnenroll: number | null = null;
  if (row) {
    const rawUnenroll = row.auto_unenroll_after_days;
    if (rawUnenroll !== null && rawUnenroll !== undefined) {
      if (isValidPositiveInt(rawUnenroll)) {
        autoUnenroll = rawUnenroll;
      } else {
        console.warn(
          `[do-policy] discarding invalid auto_unenroll_after_days: ${typeof rawUnenroll}=${String(rawUnenroll).slice(0, 32)}`,
        );
      }
    }
  }

  return {
    max_agents_per_config: maxAgents,
    auto_unenroll_after_days: autoUnenroll,
  };
}

/**
 * Defense-in-depth: SQL boundary rejects values that don't pass the
 * pure validator. Even if a future caller skips the schema layer (or a
 * bug lets a bad value through), the column never holds garbage.
 *
 * `undefined` ⇒ field absent, no-op.
 * `null` ⇒ explicit "clear" — column set to NULL.
 * positive integer ⇒ stored.
 * anything else ⇒ silent no-op (defensive); structured errors are the
 * caller's job before they reach here.
 */
export function saveDoPolicy(sql: SqlStorage, policy: Partial<DoPolicy>): void {
  // max_agents_per_config
  if (policy.max_agents_per_config !== undefined) {
    const v = policy.max_agents_per_config;
    if (v === null) {
      sql.exec(`UPDATE do_config SET max_agents_per_config = NULL WHERE id = 1`);
    } else if (isValidMaxAgents(v)) {
      sql.exec(`UPDATE do_config SET max_agents_per_config = ? WHERE id = 1`, v);
    } else {
      console.warn(
        `[do-policy] saveDoPolicy rejected invalid max_agents_per_config: ${typeof v}=${String(v).slice(0, 32)}`,
      );
    }
  }
  // auto_unenroll_after_days
  if (policy.auto_unenroll_after_days !== undefined) {
    const v = policy.auto_unenroll_after_days;
    if (v === null) {
      sql.exec(`UPDATE do_config SET auto_unenroll_after_days = NULL WHERE id = 1`);
    } else if (isValidPositiveInt(v)) {
      sql.exec(`UPDATE do_config SET auto_unenroll_after_days = ? WHERE id = 1`, v);
    } else {
      console.warn(
        `[do-policy] saveDoPolicy rejected invalid auto_unenroll_after_days: ${typeof v}=${String(v).slice(0, 32)}`,
      );
    }
  }
}

// ─── Agent State ─────────────────────────────────────────────────────

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
  const compiled = doDb
    .selectFrom("agents")
    .selectAll()
    .where("instance_uid", "=", instanceUid)
    .compile();
  const row = execQueryOne<AgentsTable>(sql, compiled);

  if (row) {
    const effectiveHash = row.effective_config_hash ?? null;
    return {
      instance_uid: hexToUint8Array(row.instance_uid),
      tenant_id: row.tenant_id,
      config_id: row.config_id,
      sequence_num: row.sequence_num,
      generation: row.generation,
      healthy: row.healthy === 1,
      status: row.status,
      last_error: row.last_error,
      current_config_hash: row.current_config_hash
        ? hexToUint8Array(row.current_config_hash)
        : null,
      desired_config_hash: desiredConfigHash ? hexToUint8Array(desiredConfigHash) : null,
      effective_config_hash: effectiveHash,
      effective_config_body: null,
      last_seen_at: row.last_seen_at,
      connected_at: row.connected_at,
      agent_description: row.agent_description,
      capabilities: row.capabilities ?? 0,
      component_health_map: row.component_health_map
        ? (safeJsonParse(row.component_health_map) as Record<string, unknown>)
        : null,
      available_components: row.available_components
        ? (safeJsonParse(row.available_components) as Record<string, unknown>)
        : null,
      config_fail_count: row.config_fail_count ?? 0,
      config_last_failed_hash: row.config_last_failed_hash
        ? hexToUint8Array(row.config_last_failed_hash)
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
    config_fail_count: 0,
    config_last_failed_hash: null,
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

  const componentHealthMap = stringifyWithBigint(state.component_health_map);
  const availableComponents = stringifyWithBigint(state.available_components);

  // Trust the state machine: connected_at = 0 means "clear on disconnect",
  // which the old CASE clause was incorrectly overriding.
  sql.exec(
    `INSERT INTO agents (instance_uid, tenant_id, config_id, sequence_num, generation, healthy, status, last_error, current_config_hash, effective_config_hash, last_seen_at, connected_at, agent_description, capabilities, component_health_map, available_components, config_fail_count, config_last_failed_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(instance_uid) DO UPDATE SET
       sequence_num = excluded.sequence_num,
       generation = excluded.generation,
       healthy = excluded.healthy,
       status = excluded.status,
       last_error = excluded.last_error,
       current_config_hash = excluded.current_config_hash,
       effective_config_hash = COALESCE(excluded.effective_config_hash, agents.effective_config_hash),
       last_seen_at = excluded.last_seen_at,
       connected_at = excluded.connected_at,
       agent_description = COALESCE(excluded.agent_description, agents.agent_description),
       capabilities = excluded.capabilities,
       component_health_map = COALESCE(excluded.component_health_map, agents.component_health_map),
       available_components = COALESCE(excluded.available_components, agents.available_components),
       config_fail_count = excluded.config_fail_count,
       config_last_failed_hash = excluded.config_last_failed_hash`,
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
    state.config_fail_count,
    state.config_last_failed_hash ? uint8ToHex(state.config_last_failed_hash) : null,
  );
}

/**
 * Tier 1 targeted UPDATE: write only the changed columns for an existing agent.
 *
 * `sequence_num` and `last_seen_at` are always piggy-backed onto any Tier 1
 * write — they're tracked in the WS attachment at zero cost and flushed
 * opportunistically here. JSON serialization for component_health_map and
 * available_components is skipped entirely when those fields didn't change.
 *
 * @see saveAgentState for the full Tier 2 UPSERT path.
 */
export function updateAgentPartial(
  sql: SqlStorage,
  instanceUid: string,
  state: AgentState,
  dirtyFields: ReadonlySet<string>,
): void {
  // Always piggyback seq_num + last_seen_at (free flush from attachment)
  const setClauses: string[] = ["sequence_num = ?", "last_seen_at = ?"];
  const params: (string | number | null)[] = [state.sequence_num, state.last_seen_at];

  if (dirtyFields.has("capabilities")) {
    setClauses.push("capabilities = ?");
    params.push(state.capabilities);
  }
  if (dirtyFields.has("healthy") || dirtyFields.has("status") || dirtyFields.has("last_error")) {
    setClauses.push("healthy = ?", "status = ?", "last_error = ?");
    params.push(state.healthy ? 1 : 0, state.status, state.last_error);
  }
  if (dirtyFields.has("component_health_map")) {
    setClauses.push("component_health_map = ?");
    params.push(stringifyWithBigint(state.component_health_map));
  }
  if (dirtyFields.has("agent_description")) {
    setClauses.push("agent_description = ?");
    params.push(state.agent_description);
  }
  if (dirtyFields.has("available_components")) {
    setClauses.push("available_components = ?");
    params.push(stringifyWithBigint(state.available_components));
  }
  if (dirtyFields.has("effective_config_hash")) {
    setClauses.push("effective_config_hash = ?");
    params.push(state.effective_config_hash);
    // Deduplicate effective config body into config_snapshots table
    if (state.effective_config_hash && state.effective_config_body) {
      sql.exec(
        `INSERT OR IGNORE INTO config_snapshots (hash, body) VALUES (?, ?)`,
        state.effective_config_hash,
        state.effective_config_body,
      );
    }
  }
  if (dirtyFields.has("current_config_hash")) {
    setClauses.push("current_config_hash = ?");
    params.push(state.current_config_hash ? uint8ToHex(state.current_config_hash) : null);
  }
  if (dirtyFields.has("config_fail_count")) {
    setClauses.push("config_fail_count = ?");
    params.push(state.config_fail_count);
  }
  if (dirtyFields.has("config_last_failed_hash")) {
    setClauses.push("config_last_failed_hash = ?");
    params.push(state.config_last_failed_hash ? uint8ToHex(state.config_last_failed_hash) : null);
  }

  params.push(instanceUid);
  sql.exec(`UPDATE agents SET ${setClauses.join(", ")} WHERE instance_uid = ?`, ...params);
}
export function getAgentCount(sql: SqlStorage): number {
  // sql.fn.countAll() compiles to COUNT(*) — no raw SQL needed.
  const compiled = doDb
    .selectFrom("agents")
    .select(doDb.fn.countAll<number>().as("count"))
    .compile();
  const row = execQueryOne<{ count: number }>(sql, compiled);
  return row?.count ?? 0;
}

/**
 * Check if a specific agent exists.
 */
export function agentExists(sql: SqlStorage, instanceUid: string): boolean {
  const compiled = doDb
    .selectFrom("agents")
    .select(doDb.fn.countAll<number>().as("cnt"))
    .where("instance_uid", "=", instanceUid)
    .compile();
  const row = execQueryOne<{ cnt: number }>(sql, compiled);
  return (row?.cnt ?? 0) > 0;
}

/**
 * Get the current generation of an agent, or 0 if not found.
 * Used to increment on reconnect.
 */
export function getAgentGeneration(sql: SqlStorage, instanceUid: string): number {
  const compiled = doDb
    .selectFrom("agents")
    .select("generation")
    .where("instance_uid", "=", instanceUid)
    .compile();
  const row = execQueryOne<Pick<AgentsTable, "generation">>(sql, compiled);
  return row?.generation ?? 0;
}

/**
 * Mark an agent as disconnected, flushing attachment-tracked fields to SQLite.
 *
 * This is the deferred write for Tier 0 heartbeat optimization: during normal
 * heartbeats, seq_num and last_seen_at are tracked in the WS attachment (free)
 * rather than written to SQLite (billed). This function performs the flush when
 * the WebSocket closes, amortizing what would have been N writes per session
 * into a single write on disconnect.
 *
 * The UPDATE is unconditional — it always sets status='disconnected' and flushes
 * the attachment fields. Even if processFrame already set status='disconnected'
 * (clean agent_disconnect message), the flush of last_seen_at/sequence_num is
 * still needed because those were tracked in the attachment, not in processFrame.
 *
 * Cost: 1 SQLite row write ($1/M).
 *
 * @param lastSeenAt  From the WS attachment (accurate even during Tier 0).
 *                    Falls back to Date.now() if not available.
 * @param sequenceNum From the WS attachment. Flushes the latest seq_num
 *                    that was tracked in-memory during no-op heartbeats.
 */
export function markDisconnected(
  sql: SqlStorage,
  instanceUid: string,
  lastSeenAt?: number,
  sequenceNum?: number,
): void {
  if (sequenceNum !== undefined) {
    const compiled = doDb
      .updateTable("agents")
      .set({
        status: "disconnected",
        last_seen_at: lastSeenAt ?? Date.now(),
        sequence_num: sequenceNum,
      })
      .where("instance_uid", "=", instanceUid)
      .compile();
    execMutation(sql, compiled);
  } else {
    const compiled = doDb
      .updateTable("agents")
      .set({
        status: "disconnected",
        last_seen_at: lastSeenAt ?? Date.now(),
      })
      .where("instance_uid", "=", instanceUid)
      .compile();
    execMutation(sql, compiled);
  }
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

  if (params.cursor) {
    switch (params.sort) {
      case "instance_uid_asc":
        where.push(`a.instance_uid > ?`);
        bind.push(params.cursor.instance_uid);
        break;
      case "last_seen_asc":
        where.push(`(a.last_seen_at > ? OR (a.last_seen_at = ? AND a.instance_uid > ?))`);
        bind.push(
          params.cursor.last_seen_at,
          params.cursor.last_seen_at,
          params.cursor.instance_uid,
        );
        break;
      case "last_seen_desc":
        where.push(`(a.last_seen_at < ? OR (a.last_seen_at = ? AND a.instance_uid < ?))`);
        bind.push(
          params.cursor.last_seen_at,
          params.cursor.last_seen_at,
          params.cursor.instance_uid,
        );
        break;
      default:
        assertNever(params.sort);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  let orderSql: string;
  switch (params.sort) {
    case "instance_uid_asc":
      orderSql = "a.instance_uid ASC";
      break;
    case "last_seen_asc":
      orderSql = "a.last_seen_at ASC, a.instance_uid ASC";
      break;
    case "last_seen_desc":
      orderSql = "a.last_seen_at DESC, a.instance_uid DESC";
      break;
    default:
      assertNever(params.sort);
  }
  // The list endpoint intentionally does not include `effective_config_body`
  // (which can be many KB per agent). Detail endpoints join `config_snapshots`
  // on demand for that field.
  const rows = sql
    .exec(
      `SELECT a.instance_uid,a.tenant_id,a.config_id,a.sequence_num,a.generation,a.healthy,a.status,a.last_error,a.current_config_hash,a.effective_config_hash,a.last_seen_at,a.connected_at,a.agent_description,a.capabilities,a.component_health_map,a.available_components FROM agents a ${whereSql} ORDER BY ${orderSql} LIMIT ?`,
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
        SUM(CASE
          WHEN ? IS NOT NULL AND current_config_hash = ? THEN 1
          WHEN ? IS NULL AND status = 'connected' THEN 1
          ELSE 0
        END) AS config_up_to_date,
        SUM(CASE WHEN ? IS NOT NULL AND (current_config_hash IS NULL OR current_config_hash != ?) THEN 1 ELSE 0 END) AS config_pending,
        SUM(CASE WHEN last_error != '' AND last_error IS NOT NULL THEN 1 ELSE 0 END) AS agents_with_errors,
        SUM(CASE WHEN status != 'disconnected' AND last_seen_at > 0 AND last_seen_at < ? THEN 1 ELSE 0 END) AS agents_stale
      FROM agents`,
      desiredConfigHash,
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
  isConnected: (uid: string) => boolean = () => false,
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
    .filter((r) => !isConnected(r["instance_uid"] as string));

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

/**
 * Delete disconnected agents that haven't been seen for `days` days.
 * Returns the number of rows removed. Freed slots allow new agents to
 * enroll up to the max_agents cap.
 *
 * Agents that reconnect after being auto-unenrolled re-enroll seamlessly:
 * the normal UPSERT + ReportFullState path recreates their state row.
 */
export function autoUnenrollStaleAgents(sql: SqlStorage, days: number): number {
  const cutoffMs = Date.now() - days * 86_400_000;
  const compiled = doDb
    .deleteFrom("agents")
    .where("status", "=", "disconnected")
    .where("last_seen_at", ">", 0)
    .where("last_seen_at", "<", cutoffMs)
    .compile();
  return execMutationCount(sql, compiled);
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
  const compiled = doDb
    .selectFrom("do_config")
    .select([
      "last_sweep_at",
      "last_sweep_stale_count",
      "last_sweep_active_socket_count",
      "last_sweep_duration_ms",
      "last_stale_sweep_at",
      "total_sweeps",
      "total_stale_swept",
      "sweeps_with_stale",
    ])
    .where("id", "=", 1)
    .compile();
  const row = execQueryOne<SweepStats>(sql, compiled);
  return (
    row ?? {
      last_sweep_at: 0,
      last_sweep_stale_count: 0,
      last_sweep_active_socket_count: 0,
      last_sweep_duration_ms: 0,
      last_stale_sweep_at: 0,
      total_sweeps: 0,
      total_stale_swept: 0,
      sweeps_with_stale: 0,
    }
  );
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
  const PENDING_DEVICE_TTL_MS = STALE_PENDING_TTL_MS;
  const expiresAt = now + PENDING_DEVICE_TTL_MS;
  sql.exec(
    `INSERT INTO pending_devices (instance_uid, tenant_id, display_name, source_ip, geo_country, geo_city, geo_lat, geo_lon, agent_description, connected_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(instance_uid) DO UPDATE SET
       display_name = COALESCE(excluded.display_name, pending_devices.display_name),
       source_ip = COALESCE(excluded.source_ip, pending_devices.source_ip),
       geo_country = COALESCE(excluded.geo_country, pending_devices.geo_country),
       geo_city = COALESCE(excluded.geo_city, pending_devices.geo_city),
       geo_lat = COALESCE(excluded.geo_lat, pending_devices.geo_lat),
       geo_lon = COALESCE(excluded.geo_lon, pending_devices.geo_lon),
       agent_description = COALESCE(excluded.agent_description, pending_devices.agent_description),
       connected_at = CASE WHEN excluded.connected_at > 0 THEN excluded.connected_at ELSE pending_devices.connected_at END,
       last_seen_at = ?,
       expires_at = ?
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
    expiresAt,
    now,
    expiresAt,
    info.instance_uid,
  );
}

export function getPendingDevice(sql: SqlStorage, instanceUid: string): PendingDeviceInfo | null {
  const compiled = doDb
    .selectFrom("pending_devices")
    .select([
      "instance_uid",
      "tenant_id",
      "display_name",
      "source_ip",
      "geo_country",
      "geo_city",
      "geo_lat",
      "geo_lon",
      "agent_description",
      "connected_at",
      "last_seen_at",
    ])
    .where("instance_uid", "=", instanceUid)
    .compile();
  return execQueryOne<PendingDeviceInfo>(sql, compiled);
}

export function listPendingDevices(
  sql: SqlStorage,
  tenantId: string,
  limit = 100,
): PendingDeviceInfo[] {
  const compiled = doDb
    .selectFrom("pending_devices")
    .select([
      "instance_uid",
      "tenant_id",
      "display_name",
      "source_ip",
      "geo_country",
      "geo_city",
      "geo_lat",
      "geo_lon",
      "agent_description",
      "connected_at",
      "last_seen_at",
    ])
    .where("tenant_id", "=", tenantId)
    .orderBy("last_seen_at", "desc")
    .limit(limit)
    .compile();
  return execQuery<PendingDeviceInfo>(sql, compiled);
}

// Deletes only the pending_devices row. pending_assignments has its own
// lifecycle — it's written by /assign and consumed by reconnect, and must
// outlive deletePendingDevice on the assign path. Use deletePendingAssignment
// (below) when you also need to drop the assignment row.
export function deletePendingDevice(sql: SqlStorage, instanceUid: string): void {
  const compiled = doDb
    .deleteFrom("pending_devices")
    .where("instance_uid", "=", instanceUid)
    .compile();
  execMutation(sql, compiled);
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
  const compiled = doDb
    .selectFrom("pending_assignments")
    .selectAll()
    .where("instance_uid", "=", instanceUid)
    .compile();
  return execQueryOne<PendingAssignment>(sql, compiled);
}

export function deletePendingAssignment(sql: SqlStorage, instanceUid: string): void {
  const compiled = doDb
    .deleteFrom("pending_assignments")
    .where("instance_uid", "=", instanceUid)
    .compile();
  execMutation(sql, compiled);
}

/**
 * Sweep expired pending devices and stale pending assignments.
 * Returns the number of rows deleted.
 */
export function sweepExpiredPendingDevices(sql: SqlStorage): number {
  const now = Date.now();
  // Delete devices with an expires_at in the past
  const deviceResult = sql.exec(
    `DELETE FROM pending_devices WHERE expires_at IS NOT NULL AND expires_at < ?`,
    now,
  );
  // Delete assignments older than 48 hours (no TTL column — use assigned_at)
  const STALE_ASSIGNMENT_MS = STALE_PENDING_TTL_MS;
  const assignmentResult = sql.exec(
    `DELETE FROM pending_assignments WHERE assigned_at > 0 AND assigned_at < ?`,
    now - STALE_ASSIGNMENT_MS,
  );
  return deviceResult.rowsWritten + assignmentResult.rowsWritten;
}
