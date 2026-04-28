import { trunc } from "./format";
import type { Agent } from "../api/hooks/portal";

export function agentUid(agent: Agent): string {
  const uid = agent.instance_uid ?? agent.id;
  if (!uid) throw new Error("Agent is missing instance_uid/id");
  return uid;
}

export function agentHost(agent: Agent): string {
  return agent.hostname ?? agent.agent_description ?? "—";
}

export function agentLastSeen(agent: Agent): string | undefined {
  return normalizeTimestamp(agent.last_seen_at ?? agent.last_seen);
}

export function agentConnectedAt(agent: Agent): string | undefined {
  return normalizeTimestamp(agent.connected_at);
}

export function agentCurrentHash(agent: Agent): string | undefined {
  return agent.current_config_hash ?? undefined;
}

export function agentIsHealthy(agent: Agent): boolean | null {
  if (typeof agent.healthy === "boolean") return agent.healthy;
  if (typeof agent.healthy === "number") return agent.healthy !== 0;
  return null;
}

export function agentHasDrift(agent: Agent, desiredHash: string | null | undefined): boolean {
  const currentHash = agentCurrentHash(agent);
  return !!desiredHash && !!currentHash && currentHash !== desiredHash;
}

export function hashLabel(hash: string | null | undefined, length = 12): string {
  return hash ? trunc(hash, length) : "—";
}

function normalizeTimestamp(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") return new Date(value).toISOString();
  return value;
}
