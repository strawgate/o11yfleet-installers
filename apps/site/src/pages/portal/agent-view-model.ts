import type { Agent } from "@/api/hooks/portal";
import { agentCurrentHash, agentHasDrift, agentIsHealthy, hashLabel } from "@/utils/agents";

export type AgentBadgeTone = "neutral" | "ok" | "warn" | "error" | "info";

export interface AgentSyncView {
  label: string;
  tone: AgentBadgeTone;
  hashLabel: string;
}

export function agentConnectionTone(status: string | null | undefined): AgentBadgeTone {
  if (status === "connected") return "ok";
  if (status === "degraded") return "warn";
  return "error";
}

export function agentHealthView(agent: Agent): { label: string; tone: AgentBadgeTone } {
  const healthy = agentIsHealthy(agent);
  if (healthy === true) return { label: "healthy", tone: "ok" };
  if (healthy === false) return { label: "unhealthy", tone: "error" };
  return { label: "unknown", tone: "neutral" };
}

export function agentSyncView(agent: Agent, desiredHash: string | null | undefined): AgentSyncView {
  const currentHash = agentCurrentHash(agent);
  const acceptsRemoteConfig = Boolean(Number(agent.capabilities ?? 0) & 0x02);
  if (!acceptsRemoteConfig) {
    return { label: "not reported", tone: "neutral", hashLabel: hashLabel(currentHash) };
  }
  if (agent.is_drifted ?? agentHasDrift(agent, desiredHash)) {
    return { label: "drift", tone: "warn", hashLabel: hashLabel(currentHash) };
  }
  if (currentHash) return { label: "in sync", tone: "ok", hashLabel: hashLabel(currentHash) };
  return { label: "not reported", tone: "neutral", hashLabel: hashLabel(currentHash) };
}
