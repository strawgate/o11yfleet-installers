import type { AgentState } from "@o11yfleet/core/state-machine";
import type { ConfigMetrics } from "@o11yfleet/core/metrics";
import type {
  AgentStateRepository,
  DesiredConfig,
  DoPolicy,
  ListAgentsPageParams,
  AgentPageResult,
  StaleAgent,
  SweepResult,
  SweepStats,
} from "./agent-state-repo-interface.js";
import {
  initSchema,
  loadAgentState,
  saveAgentState,
  updateAgentPartial,
  getAgentCount,
  agentExists,
  getAgentGeneration,
  markDisconnected,
  getAgent,
  loadDesiredConfig,
  saveDesiredConfig,
  saveDoIdentity,
  loadDoPolicy,
  saveDoPolicy,
  getStats,
  getCohortBreakdown,
  listAgentsPage,
  computeMetricsSql,
  sweepStaleAgents,
  recordSweep,
  getSweepStats,
} from "./agent-state-repo.js";

export class SqliteAgentStateRepo implements AgentStateRepository {
  constructor(private readonly sql: SqlStorage) {}

  initSchema(): void {
    initSchema(this.sql);
  }

  loadAgentState(
    uid: string,
    tenantId: string,
    configId: string,
    desiredHash: string | null,
  ): AgentState {
    return loadAgentState(this.sql, uid, tenantId, configId, desiredHash);
  }

  saveAgentState(state: AgentState): void {
    saveAgentState(this.sql, state);
  }

  updateAgentPartial(uid: string, state: AgentState, dirtyFields: ReadonlySet<string>): void {
    updateAgentPartial(this.sql, uid, state, dirtyFields);
  }

  getAgentCount(): number {
    return getAgentCount(this.sql);
  }

  agentExists(uid: string): boolean {
    return agentExists(this.sql, uid);
  }

  getAgentGeneration(uid: string): number {
    return getAgentGeneration(this.sql, uid);
  }

  markDisconnected(uid: string, lastSeenAt?: number, sequenceNum?: number): void {
    markDisconnected(this.sql, uid, lastSeenAt, sequenceNum);
  }

  getAgent(uid: string): Record<string, unknown> | null {
    return getAgent(this.sql, uid);
  }

  loadDesiredConfig(): DesiredConfig {
    return loadDesiredConfig(this.sql);
  }

  saveDesiredConfig(hash: string, content: string | null): void {
    saveDesiredConfig(this.sql, hash, content);
  }

  saveDoIdentity(tenantId: string, configId: string): void {
    saveDoIdentity(this.sql, tenantId, configId);
  }

  loadDoPolicy(): DoPolicy {
    return loadDoPolicy(this.sql);
  }

  saveDoPolicy(policy: Partial<DoPolicy>): void {
    saveDoPolicy(this.sql, policy);
  }

  getStats(): { total: number; connected: number; healthy: number } {
    return getStats(this.sql);
  }

  getCohortBreakdown(desiredHash: string | null): {
    drifted: number;
    status_counts: Record<string, number>;
    current_hash_counts: Array<{ value: string; count: number }>;
  } {
    return getCohortBreakdown(this.sql, desiredHash);
  }

  listAgentsPage(params: ListAgentsPageParams): AgentPageResult {
    return listAgentsPage(this.sql, params);
  }

  computeMetrics(desiredConfigHash: string | null, staleThresholdMs: number): ConfigMetrics {
    return computeMetricsSql(this.sql, desiredConfigHash, staleThresholdMs);
  }

  sweepStaleAgents(thresholdMs: number, activeUids: Set<string>): StaleAgent[] {
    return sweepStaleAgents(this.sql, thresholdMs, activeUids);
  }

  recordSweep(result: SweepResult): void {
    recordSweep(this.sql, result);
  }

  getSweepStats(): SweepStats {
    return getSweepStats(this.sql);
  }
}
