import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageShellProps {
  children: ReactNode;
  className?: string;
  width?: "normal" | "wide" | "narrow";
}

const widthClasses = {
  normal: "max-w-6xl",
  wide: "max-w-[1320px]",
  narrow: "max-w-4xl",
};

export function PageShell({ children, className, width = "wide" }: PageShellProps) {
  return <main className={cn("mx-auto w-full", widthClasses[width], className)}>{children}</main>;
}
