// Typed Kysely schema for DO-local SQLite tables.
// Mirrors the CREATE TABLE statements in agent-state-repo.ts migrations.
// Used only for compile-time query building — never for execution.

/** Agents table — one row per enrolled agent in this config DO. */
export interface AgentsTable {
  instance_uid: string;
  tenant_id: string;
  config_id: string;
  sequence_num: number;
  generation: number;
  /** SQLite boolean: 0 | 1 */
  healthy: number;
  status: string;
  last_error: string;
  current_config_hash: string | null;
  effective_config_hash: string | null;
  /** epoch ms */
  last_seen_at: number;
  /** epoch ms */
  connected_at: number;
  /** JSON-encoded AgentDescription */
  agent_description: string | null;
  /** Capability bitmask */
  capabilities: number;
  /** JSON-encoded map */
  component_health_map: string | null;
  /** JSON-encoded map */
  available_components: string | null;
  config_fail_count: number;
  config_last_failed_hash: string | null;
}

/** Singleton config row (id always = 1). */
export interface DoConfigTable {
  id: number;
  desired_config_hash: string | null;
  desired_config_content: string | null;
  /** Pre-encoded YAML bytes (stored as BLOB; may be Uint8Array or ArrayBuffer at runtime) */
  desired_config_bytes: Uint8Array | ArrayBuffer | null;
  tenant_id: string;
  config_id: string;
  last_sweep_at: number;
  last_sweep_stale_count: number;
  last_sweep_active_socket_count: number;
  last_sweep_duration_ms: number;
  last_stale_sweep_at: number;
  total_sweeps: number;
  total_stale_swept: number;
  sweeps_with_stale: number;
  max_agents_per_config: number | null;
  auto_unenroll_after_days: number | null;
}

/** Deduplicated config snapshots — one row per unique effective config hash. */
export interface ConfigSnapshotsTable {
  hash: string;
  body: string;
}

/** Pending devices awaiting assignment in the __pending__ DO. */
export interface PendingDevicesTable {
  instance_uid: string;
  tenant_id: string;
  display_name: string | null;
  source_ip: string | null;
  geo_country: string | null;
  geo_city: string | null;
  geo_lat: number | null;
  geo_lon: number | null;
  /** JSON-encoded AgentDescription */
  agent_description: string | null;
  connected_at: number;
  last_seen_at: number;
  expires_at: number | null;
}

/** Pending assignments linking a device to a target config. */
export interface PendingAssignmentsTable {
  instance_uid: string;
  tenant_id: string;
  target_config_id: string;
  assigned_at: number;
  assigned_by: string | null;
}

/** DO-local SQLite database schema for Kysely query building. */
export interface DoDatabase {
  agents: AgentsTable;
  do_config: DoConfigTable;
  config_snapshots: ConfigSnapshotsTable;
  pending_devices: PendingDevicesTable;
  pending_assignments: PendingAssignmentsTable;
}
