import { trunc } from "./format";
import type { Agent } from "../api/hooks/portal";

export function agentUid(agent: Agent): string {
  return agent.instance_uid;
}

export function agentHost(agent: Agent): string {
  if (agent.hostname) return agent.hostname;
  // Extract hostname from parsed agent_description (identifying/non-identifying attributes)
  if (agent.agent_description && typeof agent.agent_description === "object") {
    const desc = agent.agent_description;
    // host.name is typically in non_identifying_attributes
    const allAttrs = [
      ...(desc.non_identifying_attributes ?? []),
      ...(desc.identifying_attributes ?? []),
    ];
    const hostAttr = allAttrs.find(
      (a: { key: string; value?: { string_value?: string } }) =>
        a.key === "host.name" || a.key === "hostname",
    );
    if (hostAttr?.value?.string_value) return hostAttr.value.string_value;
  }
  if (typeof agent.agent_description === "string") return agent.agent_description;
  return "—";
}

export function agentLastSeen(agent: Agent): string | undefined {
  return normalizeTimestamp(agent.last_seen_at);
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

export function agentAcceptsRemoteConfig(
  agent: Pick<Agent, "capabilities"> | null | undefined,
): boolean {
  return Boolean(Number(agent?.capabilities ?? 0) & 0x02);
}

export function hashLabel(hash: string | null | undefined, length = 12): string {
  return hash ? trunc(hash, length) : "—";
}

function normalizeTimestamp(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") return new Date(value).toISOString();
  return value;
}
