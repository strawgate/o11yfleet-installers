import type { ReactNode } from "react";
import { Text } from "@mantine/core";

export function formatCellValue(value: unknown): string {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function getColumnKeys(rows: Array<Record<string, unknown>>): string[] {
  if (rows.length === 0) return [];
  const firstRow = rows[0] as Record<string, unknown>;
  return Object.keys(firstRow);
}

export function buildDoCell(value: unknown): ReactNode {
  const formatted = formatCellValue(value);
  const isNull = value === null;
  return (
    <Text
      component="span"
      title={formatted}
      size="xs"
      c={isNull ? "dimmed" : undefined}
      fs={isNull ? "italic" : undefined}
      ff="monospace"
      truncate
      style={{ display: "block", maxWidth: "280px" }}
    >
      {formatted}
    </Text>
  );
}
