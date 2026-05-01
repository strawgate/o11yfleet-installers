import type { TeamMember } from "@/api/hooks/portal";
import type { StatusTone } from "@/components/app";

export function memberDisplayName(member: TeamMember): string {
  const displayName = (member["display_name"] as string | undefined)?.trim();
  return displayName ? displayName : member.email;
}

export function initials(name: string | undefined): string {
  if (!name || name.trim().length === 0) return "?";
  const value = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return value.length > 0 ? value : "?";
}

export function roleTone(role?: string): StatusTone {
  switch (role) {
    case undefined:
      return "neutral";
    case "owner":
      return "warn";
    case "admin":
      return "info";
    case "operator":
      return "ok";
    default:
      return "neutral";
  }
}
