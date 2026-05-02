import type { DataTableProps } from "./types";

/**
 * Pure derivation of the DataTable's server/client mode flags from prop
 * presence. Extracted so the shell and the test suite share one source
 * of truth — keeping a duplicate copy in tests would let a regression in
 * `DataTable.tsx` slip through silently.
 */
export type DataTableModeFlags = {
  isCursorMode: boolean;
  isOffsetMode: boolean;
  isServerSorting: boolean;
  isServerFiltering: boolean;
  isServerMode: boolean;
};

/**
 * Detect mode flags from a subset of `DataTableProps` (anything controlling
 * server/client behavior). Cursor mode shadows offset mode if both are
 * passed, mirroring the runtime precedence.
 */
export function detectMode<T>(
  props: Pick<DataTableProps<T>, "cursor" | "pagination" | "pageCount" | "sorting" | "filters">,
): DataTableModeFlags {
  const isCursorMode = props.cursor !== undefined;
  const isOffsetMode =
    props.pagination !== undefined && props.pageCount !== undefined && !isCursorMode;
  const isServerSorting = props.sorting !== undefined;
  const isServerFiltering = props.filters !== undefined;
  return {
    isCursorMode,
    isOffsetMode,
    isServerSorting,
    isServerFiltering,
    isServerMode: isCursorMode || isOffsetMode || isServerSorting || isServerFiltering,
  };
}
