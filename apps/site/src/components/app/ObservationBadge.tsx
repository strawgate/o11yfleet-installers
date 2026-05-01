import { AlertTriangle, CheckCircle2, Clock3, HelpCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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

const classNames: Record<ObservationStatus, string> = {
  ok: "border-transparent bg-primary/12 text-primary",
  partial: "border-transparent bg-[color:var(--warn)]/15 text-[color:var(--warn)]",
  missing: "border-border bg-transparent text-muted-foreground",
  unavailable: "border-border bg-transparent text-muted-foreground",
  error: "border-transparent bg-destructive/15 text-destructive",
};

const icons = {
  ok: CheckCircle2,
  partial: AlertTriangle,
  missing: HelpCircle,
  unavailable: Clock3,
  error: XCircle,
};

export function ObservationBadge({ observation, className }: ObservationBadgeProps) {
  const Icon = icons[observation.status];
  const age = observation.observed_at ? formatAge(observation.observed_at) : null;

  return (
    <Badge variant="outline" className={cn(classNames[observation.status], className)}>
      <Icon className="size-3" />
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
