import type { AgentState } from "@o11yfleet/core/state-machine";
import type { ConfigMetrics } from "@o11yfleet/core/metrics";

export interface DesiredConfig {
  hash: string | null;
  content: string | null;
  bytes: Uint8Array | null;
}

/** Per-tenant policy values cached in this DO. See agent-state-repo.ts. */
export interface DoPolicy {
  max_agents_per_config: number | null;
  /**
   * Auto-unenroll disconnected agents after this many days.
   * null = disabled (agents persist indefinitely). Default: 30 days.
   * Agents that reconnect after being purged re-enroll seamlessly via
   * the normal UPSERT + ReportFullState path — no data loss.
   */
  auto_unenroll_after_days: number | null;
}

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

export interface AgentPageResult {
  agents: Record<string, unknown>[];
  hasMore: boolean;
  nextCursor: AgentPageCursor | null;
}

export interface StaleAgent {
  instance_uid: string;
  tenant_id: string;
  config_id: string;
}

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
 * Repository interface for DO-local agent state.
 * Abstracts SQLite access so the DO can be tested against different implementations.
 */
export interface AgentStateRepository {
  initSchema(): void;

  // Agent state
  loadAgentState(
    uid: string,
    tenantId: string,
    configId: string,
    desiredHash: string | null,
  ): AgentState;
  saveAgentState(state: AgentState): void;
  /** Tier 1 targeted UPDATE: write only changed columns for an existing agent. */
  updateAgentPartial(uid: string, state: AgentState, dirtyFields: ReadonlySet<string>): void;
  getAgentCount(): number;
  agentExists(uid: string): boolean;
  getAgentGeneration(uid: string): number;
  markDisconnected(uid: string, lastSeenAt?: number, sequenceNum?: number): void;
  getAgent(uid: string): Record<string, unknown> | null;

  // Config state
  loadDesiredConfig(): DesiredConfig;
  saveDesiredConfig(hash: string, content: string | null): void;
  saveDoIdentity(tenantId: string, configId: string): void;
  loadDoPolicy(): DoPolicy;
  saveDoPolicy(policy: Partial<DoPolicy>): void;

  // Queries
  getStats(): { total: number; connected: number; healthy: number };
  getCohortBreakdown(desiredHash: string | null): {
    drifted: number;
    status_counts: Record<string, number>;
    current_hash_counts: Array<{ value: string; count: number }>;
  };
  listAgentsPage(params: ListAgentsPageParams): AgentPageResult;
  /** Compute fleet metrics via SQL aggregation — O(1) memory, no JS materialization. */
  computeMetrics(desiredConfigHash: string | null, staleThresholdMs: number): ConfigMetrics;

  // Sweep
  sweepStaleAgents(thresholdMs: number, isConnected?: (uid: string) => boolean): StaleAgent[];
  /** Delete disconnected agents older than `days` days. Returns count removed. */
  autoUnenrollStaleAgents(days: number): number;
  recordSweep(result: SweepResult): void;
  getSweepStats(): SweepStats;
}
