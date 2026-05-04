/**
 * Typed interfaces for Durable Object RPC method params and results.
 *
 * These types define the contract between the Worker layer and the
 * ConfigDurableObject. With DO RPC, the Worker calls typed methods
 * directly on the stub instead of constructing internal fetch()
 * requests with URL routing.
 */

// ─── Query types ──────────────────────────────────────────────────

export interface AgentListParams {
  limit?: number;
  cursor?: string | null;
  q?: string;
  status?: string;
  health?: string;
  sort?: string;
}

export interface AgentListResult {
  agents: unknown[];
  pagination: {
    limit: number;
    next_cursor: string | null;
    has_more: boolean;
    sort: string;
  };
  filters: {
    q?: string;
    status?: string;
    health?: string;
  };
}

export interface ConfigStatsResult {
  total_agents: number;
  connected_agents: number;
  healthy_agents: number;
  drifted_agents: number;
  status_counts: Record<string, number>;
  current_hash_counts: Array<{ value: string; count: number }>;
  desired_config_hash: string | null;
  active_websockets: number;
  stale_sweep: unknown;
}

export interface AgentDetailResult {
  is_connected: boolean;
  desired_config_hash: string | null;
  is_drifted: boolean;
  uptime_ms: number | null;
  component_health_map: unknown;
  available_components: unknown;
  [key: string]: unknown;
}

// ─── Command types ────────────────────────────────────────────────

export interface SetDesiredConfigParams {
  config_hash: string;
  config_content?: string | null;
}

export interface SetDesiredConfigResult {
  pushed: number;
  failed: number;
  skipped_no_cap: number;
  config_hash: string;
}

export interface SweepResult {
  swept: number;
  unenrolled: number;
  active_websockets: number;
  duration_ms: number;
}

export interface DisconnectResult {
  disconnected: number;
  failed: number;
}

export interface RestartAllResult {
  restarted: number;
  failed: number;
  skipped_no_cap: number;
}

export interface DisconnectAgentResult {
  disconnected: boolean;
  reason?: string;
}

export interface RestartAgentResult {
  restarted: boolean;
  reason?: string;
}

// ─── Lifecycle types ──────────────────────────────────────────────

export interface InitParams {
  max_agents_per_config?: number | null;
}

export interface InitResult {
  tenant_id: string;
  config_id: string;
  policy: unknown;
  initialized: true;
}

export interface SyncPolicyParams {
  max_agents_per_config?: number | null;
  auto_unenroll_after_days?: number | null;
}

export interface SyncPolicyResult {
  policy: unknown;
}

// ─── Debug types ──────────────────────────────────────────────────

export interface DebugTablesResult {
  tables: string[];
}

export interface DebugQueryParams {
  sql: string;
  params?: unknown[];
}

export interface DebugQueryResult {
  rows: Array<Record<string, unknown>>;
  row_count: number;
  truncated: boolean;
  response_bytes_estimate?: number;
}

// ─── Pending device types ─────────────────────────────────────────

export interface PendingDevicesResult {
  devices: unknown[];
}

export interface AssignPendingDeviceParams {
  config_id: string;
  assigned_by?: string | null;
}

export interface AssignPendingDeviceResult {
  instance_uid: string;
  target_config_id: string;
  assigned: true;
}

// ─── Error types ──────────────────────────────────────────────────

/** Thrown by RPC methods to indicate a client error that the Worker
 *  should map to a specific HTTP status code.
 *
 *  CF DO RPC only preserves Error.message across the boundary —
 *  custom properties like statusCode are dropped. We encode the
 *  status code in the message using a `[NNN] ` prefix. */
export class RpcError extends Error {
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    details?: Record<string, unknown>,
  ) {
    super(`[${statusCode}] ${message}`);
    this.name = "RpcError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

/** Parse an RPC error that crossed the DO boundary.
 *  Returns `{ statusCode, message }` if the error has a `[NNN] ` prefix,
 *  or `null` if it doesn't match. */
export function parseRpcError(
  err: unknown,
): { statusCode: number; message: string } | null {
  if (!(err instanceof Error)) return null;
  const match = /^\[(\d{3})\] (.*)$/.exec(err.message);
  if (!match) return null;
  return { statusCode: parseInt(match[1]!, 10), message: match[2]! };
}
