import type { Header, Table } from "@tanstack/react-table";
import { ActionIcon, Group } from "@mantine/core";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import { flexRender } from "@tanstack/react-table";
import classes from "./table.module.css";

export type TableHeaderProps<T> = {
  table: Table<T>;
  enableResizing?: boolean;
  enablePinning?: boolean;
};

export function TableHeader<T>({ table, enableResizing, enablePinning }: TableHeaderProps<T>) {
  return (
    <div className={classes["thead"]} role="rowgroup">
      {table.getHeaderGroups().map((headerGroup) => (
        <div key={headerGroup.id} className={classes["tr"]} role="row">
          {headerGroup.headers.map((header) => (
            <HeaderCell
              key={header.id}
              header={header}
              enableResizing={enableResizing ?? false}
              enablePinning={enablePinning ?? false}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function HeaderCell<T>({
  header,
  enableResizing,
  enablePinning,
}: {
  header: Header<T, unknown>;
  enableResizing: boolean;
  enablePinning: boolean;
}) {
  const canSort = header.column.getCanSort();
  const sort = header.column.getIsSorted();
  // When pinning is disabled at the table level, getIsPinned() can still
  // return a value if a column is pinned in initial state — gate on the
  // enablePinning prop so sticky styles don't appear unexpectedly.
  const isPinned = enablePinning ? header.column.getIsPinned() : false;

  const pinStyle = isPinned
    ? {
        position: "sticky" as const,
        left: isPinned === "left" ? `${header.column.getStart("left")}px` : undefined,
        right: isPinned === "right" ? `${header.column.getAfter("right")}px` : undefined,
        zIndex: 2,
        background: "var(--mantine-color-body)",
      }
    : undefined;

  const sortHandler = canSort ? header.column.getToggleSortingHandler() : undefined;

  return (
    <div
      className={classes["th"]}
      role="columnheader"
      style={{ width: header.getSize(), flexShrink: 0, ...pinStyle }}
      data-pinned={isPinned || undefined}
      data-sortable={canSort || undefined}
      tabIndex={canSort ? 0 : undefined}
      aria-sort={sort === "asc" ? "ascending" : sort === "desc" ? "descending" : undefined}
      onClick={sortHandler}
      onKeyDown={
        sortHandler
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                sortHandler(e);
              }
            }
          : undefined
      }
    >
      <Group gap={4} justify="space-between" wrap="nowrap" h="100%">
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {header.isPlaceholder
            ? null
            : flexRender(header.column.columnDef.header, header.getContext())}
        </span>
        {canSort && (
          <ActionIcon size="xs" variant="subtle" tabIndex={-1} aria-label="sort">
            {sort === "asc" ? (
              <ChevronUp size={12} />
            ) : sort === "desc" ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronsUpDown size={12} opacity={0.5} />
            )}
          </ActionIcon>
        )}
      </Group>
      {enableResizing && header.column.getCanResize() && (
        // Column resize handle: pointer/touch-only by design, no keyboard
        // equivalent. ARIA "separator" + aria-hidden so SR users skip it
        // entirely. Prefer this over silencing the lint rule.
        <div
          className={classes["resizer"]}
          data-resizing={header.column.getIsResizing() || undefined}
          role="separator"
          aria-hidden="true"
          aria-orientation="vertical"
          tabIndex={-1}
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
}
