import type { ReactNode } from "react";

/**
 * Format a cell value for display in the DO viewer table.
 */
export function formatCellValue(value: unknown): string {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Get the column headers from query result rows.
 */
export function getColumnKeys(rows: Array<Record<string, unknown>>): string[] {
  if (rows.length === 0) return [];
  const firstRow = rows[0] as Record<string, unknown>;
  return Object.keys(firstRow);
}

/**
 * Build a simple table cell ReactNode for DO query results.
 */
export function buildDoCell(value: unknown): ReactNode {
  const formatted = formatCellValue(value);
  const isNull = value === null;
  return (
    <span className={`do-cell${isNull ? " is-null" : ""}`} title={formatted}>
      {formatted}
    </span>
  );
}
