import type { ReactNode } from "react";
import { Box, Card, Group, Stack, Text } from "@mantine/core";
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
 * Headline metric tile. The `metric` Card variant (wired in `theme.ts` via
 * `Card.extend`, see #784) absorbs the shadow + overflow rules; Card's default
 * props give us border + radius + bg. The component still owns the layout
 * composition (label / value / detail / children).
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
    <Card
      component="section"
      role="group"
      aria-label={label}
      className={className}
      variant="metric"
      p="md"
    >
      <Stack gap={4}>
        <Group justify="space-between" gap="xs" mih={20}>
          <Text size="xs" ff="monospace" c="dimmed" tt="uppercase" lts="0.08em" fz={10.5}>
            {label}
          </Text>
          {shouldShowObservation ? <ObservationBadge observation={observation} /> : null}
        </Group>
        <Text
          ff="monospace"
          fw={500}
          fz={24}
          lh={1.2}
          c={toneToColor[tone]}
          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
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
    </Card>
  );
}
