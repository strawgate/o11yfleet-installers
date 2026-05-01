import type { ReactNode } from "react";
import { Activity, Box, FileText, KeyRound, Plug, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";

type EmptyStateIcon = "box" | "plug" | "key" | "users" | "file" | "activity" | "search";

interface EmptyStateProps {
  icon?: EmptyStateIcon;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

const icons = {
  box: Box,
  plug: Plug,
  key: KeyRound,
  users: Users,
  file: FileText,
  activity: Activity,
  search: Search,
};

export function EmptyState({
  icon = "box",
  title,
  description,
  children,
  className,
}: EmptyStateProps) {
  const Icon = icons[icon];

  return (
    <div className={cn("grid justify-items-center gap-3 px-6 py-10 text-center", className)}>
      <span className="grid size-10 place-items-center rounded-full border border-border bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="grid gap-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {description ? (
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
}
