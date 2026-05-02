import type { Table } from "@tanstack/react-table";
import { ActionIcon, Checkbox, Menu, Stack, Text } from "@mantine/core";
import { Settings2 } from "lucide-react";

export type ColumnControlsProps<T> = {
  table: Table<T>;
};

/**
 * Column visibility menu. Users toggle which columns appear; choices
 * persist via the parent DataTable's `persistKey`.
 */
export function ColumnControls<T>({ table }: ColumnControlsProps<T>) {
  const columns = table.getAllLeafColumns().filter((c) => c.getCanHide() && c.id !== "_select");

  if (columns.length === 0) return null;

  return (
    <Menu shadow="md" position="bottom-end" closeOnItemClick={false} withinPortal>
      <Menu.Target>
        <ActionIcon variant="default" aria-label="Toggle columns">
          <Settings2 size={14} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Columns</Menu.Label>
        <Stack gap={4} px="xs" pb="xs">
          {columns.map((c) => (
            <Checkbox
              key={c.id}
              size="xs"
              checked={c.getIsVisible()}
              label={
                <Text size="xs" component="span">
                  {typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}
                </Text>
              }
              onChange={(e) => c.toggleVisibility(e.currentTarget.checked)}
            />
          ))}
        </Stack>
      </Menu.Dropdown>
    </Menu>
  );
}
