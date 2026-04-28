import { clsx } from "clsx";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  className?: string;
}

export function StatCard({ label, value, sub, className }: StatCardProps) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-line bg-surface p-5",
        className,
      )}
    >
      <p className="text-xs font-medium text-fg-3">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-fg tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-fg-4">{sub}</p>}
    </div>
  );
}
