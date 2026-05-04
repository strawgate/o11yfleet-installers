import type { ReactNode } from "react";
import { Box, Group, Stack, Text, Title } from "@mantine/core";

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}

/**
 * Header row at the top of every portal/admin page. Title + optional
 * description on the left; actions slot on the right that wraps to a
 * second row on narrow viewports.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <Group
      component="header"
      mb="lg"
      gap="md"
      justify="space-between"
      align="flex-start"
      wrap="wrap"
    >
      <Stack gap={6} miw={0} style={{ flex: "1 1 20rem" }}>
        <Title order={1} fw={500} style={{ fontSize: "26px", lineHeight: 1.15 }}>
          {title}
        </Title>
        {description ? (
          <Text size="sm" c="dimmed" maw="48rem">
            {description}
          </Text>
        ) : null}
      </Stack>
      {actions ? (
        <Box style={{ flexShrink: 0 }}>
          <Group gap="xs" wrap="wrap">
            {actions}
          </Group>
        </Box>
      ) : null}
    </Group>
  );
}
