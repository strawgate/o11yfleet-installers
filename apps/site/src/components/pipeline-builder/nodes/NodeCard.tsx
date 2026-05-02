import type { ReactNode } from "react";
import { Card, Group, Stack, Text } from "@mantine/core";
import { Check, X } from "lucide-react";
import classes from "./node.module.css";

export type NodeCardProps = {
  role: string;
  name: string;
  signals: ReactNode;
  selected?: boolean;
  invalid?: string;
};

/**
 * Shared frame for every pipeline node type. Receiver / Processor / Exporter /
 * Connector wrap this with their handles, but the body is identical so
 * visual rhythm stays consistent.
 */
export function NodeCard({ role, name, signals, selected, invalid }: NodeCardProps) {
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
          {invalid ? (
            <X size={12} color="var(--mantine-color-err-5)" aria-label={invalid} />
          ) : (
            <Check size={12} color="var(--mantine-color-brand-5)" aria-hidden />
          )}
        </Group>
        <Text fw={500} size="sm" lineClamp={1}>
          {name}
        </Text>
        <Group gap={4}>{signals}</Group>
      </Stack>
    </Card>
  );
}
