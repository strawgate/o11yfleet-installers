import type { ReactNode } from "react";
import { Box, Center, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { Activity, Box as BoxIcon, FileText, KeyRound, Plug, Search, Users } from "lucide-react";

type EmptyStateIcon = "box" | "plug" | "key" | "users" | "file" | "activity" | "search";

interface EmptyStateProps {
  icon?: EmptyStateIcon;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

const icons = {
  box: BoxIcon,
  plug: Plug,
  key: KeyRound,
  users: Users,
  file: FileText,
  activity: Activity,
  search: Search,
};

/**
 * Inline empty state for cards / table viewports. Centres a small icon +
 * title + optional description, with a slot for actions.
 */
export function EmptyState({
  icon = "box",
  title,
  description,
  children,
  className,
}: EmptyStateProps) {
  const Icon = icons[icon];

  return (
    <Center className={className} py="xl" px="md">
      <Stack gap="xs" align="center" maw="32rem" style={{ textAlign: "center" }}>
        <ThemeIcon variant="default" radius="xl" size="lg" c="dimmed">
          <Icon size={16} />
        </ThemeIcon>
        <Stack gap={2}>
          <Text size="sm" fw={500}>
            {title}
          </Text>
          {description ? (
            <Text size="sm" c="dimmed">
              {description}
            </Text>
          ) : null}
        </Stack>
        {children ? (
          <Box>
            <Group gap="xs" justify="center" wrap="wrap">
              {children}
            </Group>
          </Box>
        ) : null}
      </Stack>
    </Center>
  );
}
