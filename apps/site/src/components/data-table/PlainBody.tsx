import type { Row, Table } from "@tanstack/react-table";
import { flexRender } from "@tanstack/react-table";
import classes from "./table.module.css";

export type PlainBodyProps<T> = {
  table: Table<T>;
  onRowClick?: (row: T) => void;
  activeRowId?: string;
  enablePinning?: boolean;
};

/**
 * Non-virtualized body for small tables. Same DOM shape as VirtualizedBody
 * (display:grid rows over a flex-row tr) so styling is consistent.
 */
export function PlainBody<T>({
  table,
  onRowClick,
  activeRowId,
  enablePinning = false,
}: PlainBodyProps<T>) {
  const rows = table.getRowModel().rows;

  return (
    <div className={classes["tbody"]} role="rowgroup">
      {rows.map((row) => (
        <RowView
          key={row.id}
          row={row}
          onRowClick={onRowClick}
          isActive={activeRowId === row.id}
          enablePinning={enablePinning}
        />
      ))}
    </div>
  );
}

function RowView<T>({
  row,
  onRowClick,
  isActive,
  enablePinning,
}: {
  row: Row<T>;
  onRowClick?: (row: T) => void;
  isActive: boolean;
  enablePinning: boolean;
}) {
  const isSelected = row.getIsSelected();
  return (
    <div
      className={classes["tr"]}
      role="row"
      data-selected={isSelected || undefined}
      data-active={isActive || undefined}
      data-clickable={onRowClick ? true : undefined}
      tabIndex={onRowClick ? 0 : undefined}
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
        // Gate sticky pin styles behind enablePinning at the table level —
        // initial column-pin state can leak through getIsPinned() even
        // when pinning is disabled.
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
