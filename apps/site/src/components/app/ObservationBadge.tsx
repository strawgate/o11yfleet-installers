import { Badge, Group } from "@mantine/core";
import { AlertTriangle, CheckCircle2, Clock3, HelpCircle, XCircle } from "lucide-react";
import type { Observation, ObservationStatus } from "@/api/models/observed";

interface ObservationBadgeProps {
  observation: Observation;
  className?: string;
}

const labels: Record<ObservationStatus, string> = {
  ok: "Observed",
  partial: "Partial",
  missing: "Missing",
  unavailable: "Unavailable",
  error: "Error",
};

const colors: Record<ObservationStatus, string> = {
  ok: "brand",
  partial: "warn",
  missing: "gray",
  unavailable: "gray",
  error: "err",
};

const icons = {
  ok: CheckCircle2,
  partial: AlertTriangle,
  missing: HelpCircle,
  unavailable: Clock3,
  error: XCircle,
};

/**
 * Renders the data-quality status of a metric value: ok / partial / missing
 * / unavailable / error. Pairs with `MetricCard` so users can distinguish
 * "value is 0" from "we don't have data."
 */
export function ObservationBadge({ observation, className }: ObservationBadgeProps) {
  const Icon = icons[observation.status];
  const age = observation.observed_at ? formatAge(observation.observed_at) : null;
  const isMuted = observation.status === "missing" || observation.status === "unavailable";

  return (
    <Badge
      variant={isMuted ? "default" : "light"}
      color={colors[observation.status]}
      className={className}
      leftSection={
        <Group gap={0} align="center" h="100%">
          <Icon size={11} />
        </Group>
      }
    >
      {age ? `${labels[observation.status]} ${age}` : labels[observation.status]}
    </Badge>
  );
}

function formatAge(observedAt: string): string | null {
  const timestamp = Date.parse(observedAt);
  if (!Number.isFinite(timestamp)) return null;
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
