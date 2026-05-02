import type { ReactNode } from "react";
import { Box, Group, Loader, Skeleton, Stack, Text } from "@mantine/core";
import type { ObservationStatus } from "./types";

export type ChartShellProps = {
  height: number;
  /** Initial load (no data yet). */
  loading?: boolean;
  /** Refetching with previous data — children stay rendered, dimmed. */
  refetching?: boolean;
  /** Total points across all series. <5 ⇒ sparse. 0 ⇒ empty. */
  pointCount?: number;
  /** Observation status from `Observed<T>`. Drives chrome hints. */
  status?: ObservationStatus;
  /** Account-age-relative hint. Suppresses period-compare and sets onboarding copy. */
  newAccountAgeMs?: number;
  /** Error from the data layer; render retry affordance. */
  error?: { message: string; retry?: () => void } | null;
  /** When true, render the chart frame even with zero data so users don't
   * see a blank "broken" panel (Cloudflare pattern). */
  alwaysFrame?: boolean;
  /** Title rendered above the chart frame. Optional. */
  title?: ReactNode;
  /** Right-aligned subtitle: typically the chosen resolution. */
  subtitle?: ReactNode;
  children: ReactNode;
};

/**
 * Unified chrome for every chart on the site. Owns loading / refetching /
 * empty / sparse / error / new-account states so individual chart components
 * never reinvent them.
 */
export function ChartShell(props: ChartShellProps) {
  const {
    height,
    loading,
    refetching,
    pointCount = 0,
    status = "ok",
    newAccountAgeMs,
    error,
    alwaysFrame = true,
    title,
    subtitle,
    children,
  } = props;

  const totalHeight = title || subtitle ? height + 28 : height;

  if (loading && pointCount === 0) {
    return (
      <Stack gap={4}>
        {(title || subtitle) && (
          <Group justify="space-between" gap="xs">
            <Box>{title}</Box>
            <Box>{subtitle}</Box>
          </Group>
        )}
        <Skeleton height={height} radius="md" />
      </Stack>
    );
  }

  const shellHeader =
    title || subtitle ? (
      <Group justify="space-between" gap="xs" align="flex-end">
        <Box>{title}</Box>
        <Group gap="xs">
          {refetching && <Loader size="xs" />}
          <Text size="xs" c="dimmed">
            {subtitle}
          </Text>
        </Group>
      </Group>
    ) : null;

  if (error) {
    return (
      <Stack gap={4} h={totalHeight}>
        {shellHeader}
        <ChartFrame height={height}>
          <Stack align="center" justify="center" gap={4} h="100%">
            <Text size="sm" c="var(--mantine-color-err-5)">
              Couldn't load data
            </Text>
            <Text size="xs" c="dimmed">
              {error.message}
            </Text>
            {error.retry && (
              <Text
                size="xs"
                style={{ cursor: "pointer", textDecoration: "underline" }}
                onClick={error.retry}
              >
                Retry
              </Text>
            )}
          </Stack>
        </ChartFrame>
      </Stack>
    );
  }

  if (pointCount === 0) {
    return (
      <Stack gap={4} h={totalHeight}>
        {shellHeader}
        <ChartFrame height={height}>
          <Stack align="center" justify="center" gap={4} h="100%">
            <Text size="sm" c="dimmed">
              {emptyLabel(status, newAccountAgeMs)}
            </Text>
            {newAccountAgeMs !== undefined &&
              newAccountAgeMs !== null &&
              newAccountAgeMs < 5 * 60_000 && (
                <Text size="xs" c="dimmed">
                  Charts populate as more data arrives.
                </Text>
              )}
          </Stack>
        </ChartFrame>
      </Stack>
    );
  }

  return (
    <Stack gap={4} h={totalHeight}>
      {shellHeader}
      <Box
        style={{
          opacity: refetching ? 0.7 : 1,
          transition: "opacity 200ms",
          height,
        }}
      >
        {children}
      </Box>
    </Stack>
  );

  void alwaysFrame; // reserved: distinguish "draw axes anyway" from "no frame"
}

function ChartFrame({ height, children }: { height: number; children: ReactNode }) {
  return (
    <Box
      h={height}
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: "var(--mantine-radius-md)",
        background: "var(--mantine-color-default-hover)",
      }}
    >
      {children}
    </Box>
  );
}

function emptyLabel(status: ObservationStatus, newAccountAgeMs: number | undefined): string {
  if (newAccountAgeMs !== undefined && newAccountAgeMs !== null && newAccountAgeMs < 60_000) {
    const sec = Math.max(1, Math.floor(newAccountAgeMs / 1000));
    return `Data started arriving ${sec}s ago.`;
  }
  switch (status) {
    case "missing":
      return "No data in this range.";
    case "partial":
      return "Partial data in this range.";
    case "unavailable":
      return "Metric source unavailable.";
    case "error":
      return "Couldn't query metrics.";
    default:
      return "No data in this range.";
  }
}
