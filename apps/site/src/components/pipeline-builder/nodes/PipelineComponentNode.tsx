import type { ReactNode } from "react";
import { Card, Group, Stack, Text, Tooltip } from "@mantine/core";
import { Check, X, AlertTriangle, GripVertical } from "lucide-react";
import type { ComponentHealth } from "@o11yfleet/core/codec";
import classes from "./node.module.css";

export type PipelineComponentNodeProps = {
  role: string;
  name: string;
  type: string;
  signals: ReactNode;
  health?: ComponentHealth;
  selected?: boolean;
  invalid?: string;
};

/**
 * Shared frame for every pipeline node type. Receiver / Processor / Exporter /
 * Connector wrap this with their handles, but the body is identical so
 * visual rhythm stays consistent.
 *
 * Replaces old NodeCard to support role-specific styling, component type rendering,
 * drag handles, and health indicators.
 */
export function PipelineComponentNode({
  role,
  name,
  type,
  signals,
  health,
  selected,
  invalid,
}: PipelineComponentNodeProps) {
  // Determine health icon based on explicit health prop (or implicitly healthy if not provided)
  const isHealthy = health ? health.healthy : true;

  return (
    <Card
      withBorder
      radius="md"
      shadow={selected ? "md" : "sm"}
      className={classes["nodeCard"]}
      data-selected={selected || undefined}
      data-invalid={invalid || undefined}
      data-role={role}
      w={224}
      p={0}
    >
      <Group wrap="nowrap" gap={4} p="xs" className={classes["nodeHeader"]}>
        <div className={`custom-drag-handle ${classes["dragHandle"]}`}>
          <GripVertical size={14} color="var(--mantine-color-dimmed)" />
        </div>
        <Stack gap={0} style={{ flex: 1 }}>
          <Group justify="space-between" gap={4}>
            <Text size="xs" ff="monospace" fw={600} className={classes["roleText"]}>
              {role.toUpperCase()}
            </Text>
            {invalid ? (
              <Tooltip label={invalid} position="top" withArrow>
                <X size={14} color="var(--mantine-color-err-5)" aria-label={invalid} />
              </Tooltip>
            ) : !isHealthy ? (
              <Tooltip label={health?.last_error || "Unhealthy"} position="top" withArrow>
                <AlertTriangle
                  size={14}
                  color="var(--mantine-color-orange-5)"
                  aria-label="unhealthy"
                />
              </Tooltip>
            ) : (
              <Check size={14} color="var(--mantine-color-brand-5)" aria-hidden />
            )}
          </Group>
        </Stack>
      </Group>

      <Stack gap={4} p="xs" pt={0}>
        <Text fw={500} size="sm" lineClamp={1} title={name}>
          {name}
        </Text>
        <Text c="dimmed" size="xs" lineClamp={1} title={type}>
          {type}
        </Text>
        <Group gap={4} mt={4}>
          {signals}
        </Group>
      </Stack>
    </Card>
  );
}
