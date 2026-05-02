import { useRef } from "react";
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Table,
} from "@tanstack/react-table";
import { Box, Button, Group, Loader, Skeleton, Stack, Text } from "@mantine/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { TableHeader } from "./TableHeader";
import { VirtualizedBody } from "./VirtualizedBody";
import { PlainBody } from "./PlainBody";
import { ColumnControls } from "./ColumnControls";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { usePersistedTableState } from "./hooks/usePersistedTableState";
import { detectMode } from "./mode";
import type { DataTableProps } from "./types";
import classes from "./table.module.css";

// Note: columns/getRowId memoization is the caller's responsibility; we
// don't memoize here because doing so would shadow caller bugs (inline
// arrays cause full table rebuilds, which we want to surface in profiler).

/**
 * Generic table shell. See `./types.ts` for the full prop API.
 *
 * Server-mode detection: any of `cursor`, `pagination`+`pageCount`,
 * `sorting`, `filters` being passed flips the corresponding `manualXxx`
 * flag (see `./mode.ts`). Cursor mode renders Prev/Next driven by
 * caller-supplied `previousCursor` / `nextCursor`; offset mode renders
 * its own paginator using TanStack's pagination state.
 */
export function DataTable<T>(props: DataTableProps<T>) {
  const {
    columns,
    data,
    getRowId,
    pageCount,
    rowCount,
    pagination,
    onPaginationChange,
    cursor,
    nextCursor,
    previousCursor,
    hasNextPage,
    onCursorChange,
    sorting,
    onSortingChange,
    filters,
    onFiltersChange,
    enableRowSelection,
    rowSelection,
    onRowSelectionChange,
    enableColumnResizing = true,
    enableColumnPinning = false,
    enableColumnVisibility = true,
    initialColumnVisibility,
    initialColumnOrder,
    initialColumnSizing,
    initialColumnPinning,
    virtualizeRows,
    estimatedRowHeight = 40,
    overscan,
    height = 480,
    loading,
    refetching,
    empty,
    error,
    onRowClick,
    activeRowId,
    persistKey,
    toolbar,
    footer,
    ariaLabel,
  } = props;

  const { isCursorMode, isOffsetMode, isServerSorting, isServerFiltering, isServerMode } =
    detectMode<T>({ cursor, pagination, pageCount, sorting, filters });

  const persisted = usePersistedTableState(persistKey, {
    columnSizing: initialColumnSizing,
    columnOrder: initialColumnOrder,
    columnVisibility: initialColumnVisibility,
    columnPinning: initialColumnPinning,
  });

  const table = useReactTable<T>({
    data,
    columns,
    getRowId: (row) => getRowId(row),
    pageCount: isCursorMode ? -1 : (pageCount ?? -1),
    rowCount,
    state: {
      ...(pagination ? { pagination } : {}),
      ...(sorting ? { sorting } : {}),
      ...(filters ? { columnFilters: filters } : {}),
      ...(rowSelection ? { rowSelection } : {}),
      ...(persisted.state.columnSizing ? { columnSizing: persisted.state.columnSizing } : {}),
      ...(persisted.state.columnOrder ? { columnOrder: persisted.state.columnOrder } : {}),
      ...(persisted.state.columnVisibility
        ? { columnVisibility: persisted.state.columnVisibility }
        : {}),
      ...(persisted.state.columnPinning ? { columnPinning: persisted.state.columnPinning } : {}),
    },
    enableRowSelection,
    enableColumnResizing,
    enableColumnPinning,
    columnResizeMode: "onChange",
    manualPagination: isCursorMode || isOffsetMode,
    manualSorting: isServerSorting,
    manualFiltering: isServerFiltering,
    onPaginationChange,
    onSortingChange,
    onColumnFiltersChange: onFiltersChange,
    onRowSelectionChange,
    onColumnSizingChange: persisted.setSizing,
    onColumnOrderChange: persisted.setOrder,
    onColumnVisibilityChange: persisted.setVisibility,
    onColumnPinningChange: persisted.setPinning,
    getCoreRowModel: getCoreRowModel(),
    // Always provide the client row models — when manualXxx is true
    // TanStack uses them as no-op providers, but having them lets per-row
    // features (filtering, sorting, paginating in mixed-mode tables) work
    // when only some manual flags are flipped.
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // ─── render branches ─────────────────────────────────────────────────────
  const showToolbar = toolbar !== undefined || enableColumnVisibility;
  const showFooter = footer !== undefined || isOffsetMode || isCursorMode;
  const isInitialLoading = loading && data.length === 0;
  const isEmpty = !loading && !error && data.length === 0;
  void isServerMode; // retained for potential future scheduling logic

  // The DataTable owns the single scroll container so the header and body
  // share both axes. Without this, horizontal scroll on a wide body would
  // desync the sticky header. VirtualizedBody consumes this ref via
  // `useVirtualizer`'s `getScrollElement`.
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <Box className={classes["root"]} role="table" aria-label={ariaLabel}>
      {showToolbar && (
        <Box className={classes["toolbar"]}>
          <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
            {toolbar}
          </Group>
          <Group gap="xs">
            {refetching && <Loader size="xs" />}
            {enableColumnVisibility && <ColumnControls table={table} />}
          </Group>
        </Box>
      )}

      {error ? (
        <ErrorState message={error.message} retry={error.retry} height={height} />
      ) : isInitialLoading ? (
        <Stack gap={2} p="xs">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} h={estimatedRowHeight} />
          ))}
        </Stack>
      ) : isEmpty ? (
        (empty ?? <EmptyState height={height} />)
      ) : (
        <div
          ref={scrollRef}
          className={`${classes["scrollArea"]} ${refetching ? classes["dim"] : classes["fadeRefetch"]}`}
          style={{ height, overflow: "auto" }}
        >
          <TableHeader
            table={table}
            enableResizing={enableColumnResizing}
            enablePinning={enableColumnPinning}
          />
          {virtualizeRows ? (
            <VirtualizedBody
              table={table}
              scrollElementRef={scrollRef}
              estimatedRowHeight={estimatedRowHeight}
              overscan={overscan}
              onRowClick={onRowClick}
              activeRowId={activeRowId}
              enablePinning={enableColumnPinning}
            />
          ) : (
            <PlainBody
              table={table}
              onRowClick={onRowClick}
              activeRowId={activeRowId}
              enablePinning={enableColumnPinning}
            />
          )}
        </div>
      )}

      {showFooter && (
        <Box className={classes["footer"]}>
          <Group gap="xs">{footer ?? <FooterStatus table={table} rowCount={rowCount} />}</Group>
          {isCursorMode ? (
            <CursorPaginator
              hasPrev={previousCursor !== undefined}
              hasNext={(hasNextPage ?? false) && nextCursor !== undefined}
              onPrev={() => {
                if (previousCursor !== undefined) onCursorChange?.(previousCursor);
              }}
              onNext={() => {
                if (nextCursor !== undefined) onCursorChange?.(nextCursor);
              }}
            />
          ) : isOffsetMode ? (
            <OffsetPaginator table={table} />
          ) : null}
        </Box>
      )}
    </Box>
  );
}

function FooterStatus<T>({ table, rowCount }: { table: Table<T>; rowCount: number | undefined }) {
  const visible = table.getRowModel().rows.length;
  if (rowCount !== undefined) {
    return (
      <Text size="xs" c="dimmed">
        {visible.toLocaleString()} of {rowCount.toLocaleString()} rows
      </Text>
    );
  }
  return (
    <Text size="xs" c="dimmed">
      {visible.toLocaleString()} {visible === 1 ? "row" : "rows"}
    </Text>
  );
}

function CursorPaginator({
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <Group gap="xs">
      <Button
        size="xs"
        variant="default"
        leftSection={<ChevronLeft size={14} />}
        disabled={!hasPrev}
        onClick={onPrev}
      >
        Prev
      </Button>
      <Button
        size="xs"
        variant="default"
        rightSection={<ChevronRight size={14} />}
        disabled={!hasNext}
        onClick={onNext}
      >
        Next
      </Button>
    </Group>
  );
}

function OffsetPaginator<T>({ table }: { table: Table<T> }) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const totalPages = table.getPageCount();
  return (
    <Group gap="xs" align="center">
      <Text size="xs" c="dimmed">
        Page {pageIndex + 1} of {totalPages > 0 ? totalPages : "?"} ({pageSize}/page)
      </Text>
      <Button
        size="xs"
        variant="default"
        leftSection={<ChevronLeft size={14} />}
        disabled={!table.getCanPreviousPage()}
        onClick={() => table.previousPage()}
      >
        Prev
      </Button>
      <Button
        size="xs"
        variant="default"
        rightSection={<ChevronRight size={14} />}
        disabled={!table.getCanNextPage()}
        onClick={() => table.nextPage()}
      >
        Next
      </Button>
    </Group>
  );
}
