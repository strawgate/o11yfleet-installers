import type { AgentDescription } from "@/api/hooks/portal";

export function safeJsonParse(str: string): AgentDescription | null {
  try {
    return JSON.parse(str) as AgentDescription;
  } catch {
    return null;
  }
}

export function tsToIso(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return value > 0 ? new Date(value).toISOString() : undefined;
  return value;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
