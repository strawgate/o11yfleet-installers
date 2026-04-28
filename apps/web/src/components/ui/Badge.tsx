import { clsx } from "clsx";

type BadgeVariant = "default" | "success" | "warning" | "error" | "info";

const variants: Record<BadgeVariant, string> = {
  default: "bg-surface-2 text-fg-3 border-line",
  success: "bg-ok/10 text-ok border-ok/20",
  warning: "bg-warn/10 text-warn border-warn/20",
  error: "bg-err/10 text-err border-err/20",
  info: "bg-info/10 text-info border-info/20",
};

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = "default", children, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
