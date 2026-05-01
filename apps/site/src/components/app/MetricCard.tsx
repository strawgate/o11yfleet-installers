import type { ReactNode } from "react";
import { ObservationBadge } from "@/components/app/ObservationBadge";
import { cn } from "@/lib/utils";
import type { Observation } from "@/api/models/observed";

interface MetricCardProps {
  label: string;
  value: ReactNode;
  observation?: Observation;
  detail?: ReactNode;
  children?: ReactNode;
  className?: string;
  tone?: "neutral" | "ok" | "warn" | "error";
}

const valueToneClasses = {
  neutral: "text-foreground",
  ok: "text-primary",
  warn: "text-[color:var(--warn)]",
  error: "text-destructive",
};

export function MetricCard({
  label,
  value,
  observation,
  detail,
  children,
  className,
  tone = "neutral",
}: MetricCardProps) {
  const shouldShowObservation = observation && observation.status !== "ok";

  return (
    <section
      role="group"
      aria-label={label}
      className={cn(
        "rounded-md border border-border bg-card px-4 py-4 text-card-foreground shadow-sm",
        className,
      )}
    >
      <div className="flex min-h-5 items-center justify-between gap-3">
        <div className="font-mono text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase">
          {label}
        </div>
        {shouldShowObservation ? <ObservationBadge observation={observation} /> : null}
      </div>
      <div className={cn("mt-2 font-mono text-2xl tracking-normal", valueToneClasses[tone])}>
        {value}
      </div>
      {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}
