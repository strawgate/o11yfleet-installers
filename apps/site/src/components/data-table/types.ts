import type {
  ColumnDef,
  ColumnFiltersState,
  ColumnOrderState,
  ColumnPinningState,
  ColumnSizingState,
  OnChangeFn,
  PaginationState,
  Row,
  RowSelectionState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";
import type { ReactNode } from "react";

/**
 * Generic shell prop API. Every table on the site speaks this.
 *
 * Two modes:
 * - **client-side** (default): pass `data` only; the shell handles
 *   sort/filter/paginate in-memory.
 * - **server-side**: opt in by passing `pageCount` (offset mode) or
 *   `cursor` (cursor mode). Server-side flags `manualPagination`,
 *   `manualSorting`, `manualFiltering` are derived from prop presence.
 *
 * Cursor pagination doesn't fit TanStack's offset model: we ignore
 * `pageIndex/pageSize`, set `pageCount={-1}`, and the caller renders
 * Prev/Next themselves.
 */
export type DataTableProps<T> = {
  columns: ColumnDef<T, unknown>[];
  data: T[];

  /**
   * Required in server-side mode so selection keys persist across refetches.
   * Highly recommended in client-side mode too — defaults to row index, which
   * collides on data reorder.
   */
  getRowId: (row: T) => string;

  // ─── server-side state (controlled when provided) ───────────────────
  pageCount?: number; // offset mode; -1 for cursor mode
  rowCount?: number;
  pagination?: PaginationState;
  onPaginationChange?: OnChangeFn<PaginationState>;

  /** Cursor pagination — caller renders Prev/Next. The current cursor is
   * what produced the visible page; null means "first page". */
  cursor?: string | null;
  /** The cursor for the next page, typically `nextCursor` / `endCursor` from
   * the most recent response. When undefined the Next button is disabled
   * regardless of `hasNextPage`. */
  nextCursor?: string | null;
  /** The cursor for the previous page. When undefined the Prev button is
   * disabled — cursor APIs are forward-only by default; supply this only
   * if the caller maintains a cursor history. */
  previousCursor?: string | null;
  /** Whether more pages exist; controls Next button enable state. */
  hasNextPage?: boolean;
  /** Set new cursor (or null to reset to first page). */
  onCursorChange?: (next: string | null) => void;

  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;

  filters?: ColumnFiltersState;
  onFiltersChange?: OnChangeFn<ColumnFiltersState>;

  // ─── selection ──────────────────────────────────────────────────────
  enableRowSelection?: boolean | ((row: Row<T>) => boolean);
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;

  // ─── column features ────────────────────────────────────────────────
  enableColumnResizing?: boolean;
  enableColumnPinning?: boolean;
  enableColumnReordering?: boolean;
  enableColumnVisibility?: boolean;
  /** Defaults: shown when set, hidden otherwise. Persisted via persistKey. */
  initialColumnVisibility?: VisibilityState;
  initialColumnOrder?: ColumnOrderState;
  initialColumnSizing?: ColumnSizingState;
  initialColumnPinning?: ColumnPinningState;

  // ─── virtualization ─────────────────────────────────────────────────
  virtualizeRows?: boolean;
  estimatedRowHeight?: number;
  overscan?: number;
  /** Total rendered viewport height. Required when virtualizing. */
  height?: number;

  // ─── states ─────────────────────────────────────────────────────────
  loading?: boolean;
  /** Refetching with previous data still rendered — dim the rows. */
  refetching?: boolean;
  empty?: ReactNode;
  error?: { message: string; retry?: () => void } | null;

  // ─── interaction ────────────────────────────────────────────────────
  onRowClick?: (row: T) => void;
  /** Highlight the row whose getRowId matches this value. */
  activeRowId?: string;

  // ─── persistence ────────────────────────────────────────────────────
  /** localStorage key for column sizing/order/visibility/pinning. */
  persistKey?: string;

  // ─── styling hooks ──────────────────────────────────────────────────
  /** Render slot above the table (filter bar, bulk actions). */
  toolbar?: ReactNode;
  /** Render slot below the table (paginator, status). */
  footer?: ReactNode;
  /** ARIA label for screen readers. */
  ariaLabel?: string;
};

/** Persisted-by-localStorage subset of table state. */
export type PersistedTableState = {
  columnSizing?: ColumnSizingState;
  columnOrder?: ColumnOrderState;
  columnVisibility?: VisibilityState;
  columnPinning?: ColumnPinningState;
};
