/**
 * Public surface of the data-table primitive. Pages import only from here.
 *
 * Re-exports TanStack types for convenience so callers don't need a separate
 * `@tanstack/react-table` import for `ColumnDef` etc.
 */

export { DataTable } from "./DataTable";
export { TableHeader } from "./TableHeader";
export { VirtualizedBody } from "./VirtualizedBody";
export { PlainBody } from "./PlainBody";
export { ColumnControls } from "./ColumnControls";
export { EmptyState } from "./EmptyState";
export { ErrorState } from "./ErrorState";
export { SparklineCell, type SparklineCellProps } from "./SparklineCell";
export { usePersistedTableState } from "./hooks/usePersistedTableState";
export { useDeferredFilter } from "./hooks/useDeferredFilter";

export type { DataTableProps, PersistedTableState } from "./types";

export type {
  ColumnDef,
  ColumnFiltersState,
  ColumnOrderState,
  ColumnPinningState,
  ColumnSizingState,
  PaginationState,
  Row,
  RowSelectionState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";
export { createColumnHelper } from "@tanstack/react-table";
