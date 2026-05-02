import type { AgentState } from "@o11yfleet/core/state-machine";
import type { AgentMetricsInput, ConfigMetrics } from "@o11yfleet/core/metrics";
import type {
  AgentStateRepository,
  DesiredConfig,
  DoIdentity,
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
  getAgentCount,
  agentExists,
  getAgentGeneration,
  markDisconnected,
  getAgent,
  loadDesiredConfig,
  saveDesiredConfig,
  loadDoIdentity,
  saveDoIdentity,
  loadDoPolicy,
  saveDoPolicy,
  checkRateLimit,
  getStats,
  getCohortBreakdown,
  listAgentsPage,
  loadAgentsForMetrics,
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

  getAgentCount(): number {
    return getAgentCount(this.sql);
  }

  agentExists(uid: string): boolean {
    return agentExists(this.sql, uid);
  }

  getAgentGeneration(uid: string): number {
    return getAgentGeneration(this.sql, uid);
  }

  markDisconnected(uid: string): void {
    markDisconnected(this.sql, uid);
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

  loadDoIdentity(): DoIdentity {
    return loadDoIdentity(this.sql);
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

  checkRateLimit(uid: string, maxPerMinute: number): boolean {
    return checkRateLimit(this.sql, uid, maxPerMinute);
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

  loadAgentsForMetrics(): Map<string, AgentMetricsInput> {
    return loadAgentsForMetrics(this.sql);
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
