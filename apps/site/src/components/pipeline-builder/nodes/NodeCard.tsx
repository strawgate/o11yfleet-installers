import type { ReactNode } from "react";
import { ActionIcon, Card, Group, Stack, Text, Tooltip } from "@mantine/core";
import { Check, X, Trash2 } from "lucide-react";
import classes from "./node.module.css";

export type NodeCardProps = {
  id?: string;
  role: string;
  name: string;
  signals: ReactNode;
  selected?: boolean;
  invalid?: string;
  readOnly?: boolean;
  onDelete?: () => void;
};

/**
 * Shared frame for every pipeline node type. Receiver / Processor / Exporter /
 * Connector wrap this with their handles, but the body is identical so
 * visual rhythm stays consistent.
 */
export function NodeCard({
  id,
  role,
  name,
  signals,
  selected,
  invalid,
  readOnly,
  onDelete,
}: NodeCardProps) {
  const handleDelete = () => {
    if (onDelete) onDelete();
  };

  return (
    <Card
      withBorder
      radius="md"
      shadow={selected ? "md" : "sm"}
      className={classes["nodeCard"]}
      data-selected={selected || undefined}
      data-invalid={invalid || undefined}
      w={224}
      p="xs"
    >
      <Stack gap={4}>
        <Group justify="space-between" gap={4}>
          <Text size="xs" ff="monospace" c="dimmed">
            {role.toUpperCase()}
          </Text>
          <Group gap={4}>
            {!readOnly && id && (
              <Tooltip label="Delete component">
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={handleDelete}
                  aria-label={`Delete ${name}`}
                >
                  <Trash2 size={12} />
                </ActionIcon>
              </Tooltip>
            )}
            {invalid ? (
              <X size={12} color="var(--mantine-color-err-5)" aria-label={invalid} />
            ) : (
              <Check size={12} color="var(--mantine-color-brand-5)" aria-hidden />
            )}
          </Group>
        </Group>
        <Text fw={500} size="sm" lineClamp={1}>
          {name}
        </Text>
        <Group gap={4}>{signals}</Group>
      </Stack>
    </Card>
  );
}
