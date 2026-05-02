import { type RefObject } from "react";
import type { Row, Table } from "@tanstack/react-table";
import { flexRender } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import classes from "./table.module.css";

export type VirtualizedBodyProps<T> = {
  table: Table<T>;
  /** Shared scroll element ref owned by `<DataTable>` so header and body
   * scroll in sync (both vertically and horizontally). */
  scrollElementRef: RefObject<HTMLDivElement | null>;
  estimatedRowHeight: number;
  overscan?: number;
  onRowClick?: (row: T) => void;
  activeRowId?: string;
  enablePinning?: boolean;
};

/**
 * Virtualized body using @tanstack/react-virtual.
 *
 * Scroll container ownership: the parent `<DataTable>` owns the scroll
 * element so the header sits inside the same scroller (sticky-top) and
 * stays aligned with the body during horizontal scroll. We accept that
 * element ref here; we don't create our own scroller.
 *
 * Row layout follows the official TanStack pattern: tbody has an explicit
 * total height; rows are absolutely positioned via `transform: translateY`.
 * Cells use explicit widths from `column.getSize()` so columns line up
 * across virtualized rows.
 */
export function VirtualizedBody<T>({
  table,
  scrollElementRef,
  estimatedRowHeight,
  overscan = 10,
  onRowClick,
  activeRowId,
  enablePinning = false,
}: VirtualizedBodyProps<T>) {
  const rows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan,
    measureElement:
      typeof window !== "undefined" && navigator.userAgent.includes("Firefox")
        ? undefined // Firefox measureElement has known quirks
        : (el) => el?.getBoundingClientRect().height,
  });

  const totalSize = virtualizer.getTotalSize();
  const items = virtualizer.getVirtualItems();

  return (
    <div
      className={classes["tbody"]}
      role="rowgroup"
      style={{ height: totalSize, position: "relative" }}
    >
      {items.map((vi) => {
        const row = rows[vi.index];
        if (!row) return null;
        return (
          <VirtualRow<T>
            key={row.id}
            row={row}
            vIndex={vi.index}
            start={vi.start}
            measureRef={virtualizer.measureElement}
            onRowClick={onRowClick}
            isActive={activeRowId === row.id}
            enablePinning={enablePinning}
          />
        );
      })}
    </div>
  );
}

function VirtualRow<T>({
  row,
  vIndex,
  start,
  measureRef,
  onRowClick,
  isActive,
  enablePinning,
}: {
  row: Row<T>;
  vIndex: number;
  start: number;
  measureRef: (el: Element | null) => void;
  onRowClick?: (row: T) => void;
  isActive: boolean;
  enablePinning: boolean;
}) {
  const isSelected = row.getIsSelected();
  return (
    <div
      ref={measureRef}
      data-index={vIndex}
      className={classes["tr"]}
      role="row"
      data-selected={isSelected || undefined}
      data-active={isActive || undefined}
      data-clickable={onRowClick ? true : undefined}
      tabIndex={onRowClick ? 0 : undefined}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        transform: `translateY(${start}px)`,
      }}
      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
      onKeyDown={
        onRowClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onRowClick(row.original);
              }
            }
          : undefined
      }
    >
      {row.getVisibleCells().map((cell) => {
        // Gate sticky pin styles behind enablePinning at the table level.
        const isPinned = enablePinning ? cell.column.getIsPinned() : false;
        const pinStyle = isPinned
          ? {
              position: "sticky" as const,
              left: isPinned === "left" ? `${cell.column.getStart("left")}px` : undefined,
              right: isPinned === "right" ? `${cell.column.getAfter("right")}px` : undefined,
              zIndex: 1,
              background: "var(--mantine-color-body)",
            }
          : undefined;
        return (
          <div
            key={cell.id}
            className={classes["td"]}
            role="cell"
            data-pinned={isPinned || undefined}
            style={{ width: cell.column.getSize(), flexShrink: 0, ...pinStyle }}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </div>
        );
      })}
    </div>
  );
}
