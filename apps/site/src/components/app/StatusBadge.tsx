import type { ReactNode } from "react";
import { Badge } from "@mantine/core";

export type StatusTone = "neutral" | "ok" | "warn" | "error" | "info";

interface StatusBadgeProps {
  children: ReactNode;
  tone?: StatusTone;
  className?: string;
}

const toneToColor: Record<StatusTone, string> = {
  neutral: "gray",
  ok: "brand",
  warn: "warn",
  error: "err",
  info: "info",
};

/**
 * Small inline status pill. `tone` maps to a semantic color from the theme.
 *
 * Note: this is the visual primitive. For the full 9-state fleet enum
 * (Connected/Configuring/Disconnected/Error/Pending/Upgrading/Incompatible/
 * NeverConnected/Unhealthy) callers compose this with a status→tone mapper
 * — see `agent-view-model` for the agent state variant.
 */
export function StatusBadge({ children, tone = "neutral", className }: StatusBadgeProps) {
  return (
    <Badge variant="light" color={toneToColor[tone]} className={className}>
      {children}
    </Badge>
  );
}
