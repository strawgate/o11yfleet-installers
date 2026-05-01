import type { Agent } from "@/api/hooks/portal";
import {
  agentAcceptsRemoteConfig,
  agentCurrentHash,
  agentHasDrift,
  agentIsHealthy,
  hashLabel,
} from "@/utils/agents";

export type AgentBadgeTone = "neutral" | "ok" | "warn" | "error" | "info";

export interface AgentStatusView {
  label: string;
  tone: AgentBadgeTone;
}

export interface AgentSyncView {
  label: string;
  tone: AgentBadgeTone;
  hashLabel: string;
}

const OK_AGENT_STATUSES = new Set(["connected", "running", "starting"]);
const WARN_AGENT_STATUSES = new Set(["degraded", "stopping"]);
const ERROR_AGENT_STATUSES = new Set(["disconnected", "error", "failed"]);

export function agentStatusView(status: string | null | undefined): AgentStatusView {
  const normalized = status?.trim();
  if (!normalized) return { label: "unknown", tone: "neutral" };
  if (OK_AGENT_STATUSES.has(normalized)) return { label: normalized, tone: "ok" };
  if (WARN_AGENT_STATUSES.has(normalized)) return { label: normalized, tone: "warn" };
  if (ERROR_AGENT_STATUSES.has(normalized)) return { label: normalized, tone: "error" };
  return { label: normalized, tone: "neutral" };
}

export function agentConnectionTone(status: string | null | undefined): AgentBadgeTone {
  return agentStatusView(status).tone;
}

export function agentHealthView(agent: Agent): { label: string; tone: AgentBadgeTone } {
  const healthy = agentIsHealthy(agent);
  if (healthy === true) return { label: "healthy", tone: "ok" };
  if (healthy === false) return { label: "unhealthy", tone: "error" };
  return { label: "unknown", tone: "neutral" };
}

export function agentSyncView(agent: Agent, desiredHash: string | null | undefined): AgentSyncView {
  const currentHash = agentCurrentHash(agent);
  const acceptsRemoteConfig = agentAcceptsRemoteConfig(agent);
  if (!acceptsRemoteConfig) {
    return { label: "not reported", tone: "neutral", hashLabel: hashLabel(currentHash) };
  }
  if (agent.is_drifted ?? agentHasDrift(agent, desiredHash)) {
    return { label: "drift", tone: "warn", hashLabel: hashLabel(currentHash) };
  }
  if (currentHash) return { label: "in sync", tone: "ok", hashLabel: hashLabel(currentHash) };
  return { label: "not reported", tone: "neutral", hashLabel: hashLabel(currentHash) };
}
