import type { ReactNode } from "react";
import { Center, Stack, Text } from "@mantine/core";

export type EmptyStateProps = {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  height?: number | string;
};

export function EmptyState({
  title = "No results",
  description,
  action,
  height = 240,
}: EmptyStateProps) {
  return (
    <Center h={height}>
      <Stack gap={4} align="center" maw={360} style={{ textAlign: "center" }}>
        <Text size="sm" fw={500}>
          {title}
        </Text>
        {description && (
          <Text size="xs" c="dimmed">
            {description}
          </Text>
        )}
        {action && <div>{action}</div>}
      </Stack>
    </Center>
  );
}
