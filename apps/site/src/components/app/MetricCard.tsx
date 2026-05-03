import type { ReactNode } from "react";
import { Box, Group, Stack, Text } from "@mantine/core";
import { ObservationBadge } from "@/components/app/ObservationBadge";
import type { Observation } from "@/api/models/observed";

interface MetricCardProps {
  label: string;
  value: ReactNode;
  observation?: Observation;
  detail?: ReactNode;
  children?: ReactNode;
  className?: string;
  tone?: "neutral" | "ok" | "warn" | "error";
}

const toneToColor: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  neutral: "var(--mantine-color-text)",
  ok: "var(--mantine-color-brand-5)",
  warn: "var(--mantine-color-warn-5)",
  error: "var(--mantine-color-err-5)",
};

/**
 * Headline metric tile. Optional `observation` renders an ObservationBadge
 * in the top-right when status is non-OK so users can tell at a glance that
 * the metric is missing/partial/unavailable rather than zero.
 */
export function MetricCard({
  label,
  value,
  observation,
  detail,
  children,
  className,
  tone = "neutral",
}: MetricCardProps) {
  const shouldShowObservation = observation && observation.status !== "ok";

  return (
    <Box
      component="section"
      role="group"
      aria-label={label}
      className={className}
      p="md"
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: "var(--mantine-radius-md)",
        background: "var(--mantine-color-body)",
        boxShadow: "var(--mantine-shadow-xs)",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <Stack gap={4}>
        <Group justify="space-between" gap="xs" mih={20}>
          <Text
            size="xs"
            ff="monospace"
            c="dimmed"
            tt="uppercase"
            style={{ letterSpacing: "0.08em", fontSize: "10.5px" }}
          >
            {label}
          </Text>
          {shouldShowObservation ? <ObservationBadge observation={observation} /> : null}
        </Group>
        <Text
          ff="monospace"
          fw={500}
          style={{
            fontSize: "1.5rem",
            lineHeight: 1.2,
            color: toneToColor[tone],
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </Text>
        {detail ? (
          <Text size="xs" c="dimmed">
            {detail}
          </Text>
        ) : null}
        {children ? <Box mt="xs">{children}</Box> : null}
      </Stack>
    </Box>
  );
}
