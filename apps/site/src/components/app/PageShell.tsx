import type { ReactNode } from "react";
import { Box } from "@mantine/core";

interface PageShellProps {
  children: ReactNode;
  className?: string;
  width?: "normal" | "wide" | "narrow";
}

const widthValues: Record<NonNullable<PageShellProps["width"]>, string> = {
  narrow: "56rem",
  normal: "72rem",
  wide: "82.5rem",
};

/**
 * Page-level container. Constrains content width and centres horizontally
 * so portal/admin pages share a consistent reading column.
 */
export function PageShell({ children, className, width = "wide" }: PageShellProps) {
  return (
    <Box component="main" className={className} mx="auto" w="100%" maw={widthValues[width]}>
      {children}
    </Box>
  );
}
