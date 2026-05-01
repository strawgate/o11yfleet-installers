import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "neutral" | "ok" | "warn" | "error" | "info";

interface StatusBadgeProps {
  children: ReactNode;
  tone?: StatusTone;
  className?: string;
}

const toneClasses: Record<StatusTone, string> = {
  neutral: "border-border bg-transparent text-muted-foreground",
  ok: "border-transparent bg-primary/12 text-primary",
  warn: "border-transparent bg-[color:var(--warn)]/15 text-[color:var(--warn)]",
  error: "border-transparent bg-destructive/15 text-destructive",
  info: "border-transparent bg-[color:var(--info)]/15 text-[color:var(--info)]",
};

export function StatusBadge({ children, tone = "neutral", className }: StatusBadgeProps) {
  return (
    <Badge variant="outline" className={cn(toneClasses[tone], className)}>
      {children}
    </Badge>
  );
}
