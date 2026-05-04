import type { ReactNode } from "react";
import { Box, Center, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { Activity, Box as BoxIcon, FileText, KeyRound, Plug, Search, Users } from "lucide-react";

type EmptyStateIcon = "box" | "plug" | "key" | "users" | "file" | "activity" | "search";

export interface EmptyStateProps {
  /** Icon to display (defaults to "box") */
  icon?: EmptyStateIcon;
  /** Main title text (defaults to "No results") */
  title?: string;
  /** Optional description text */
  description?: ReactNode;
  /** Action elements (buttons, links) - can also pass as children */
  actions?: ReactNode;
  /** Height constraint for table-like containers */
  height?: number | string;
  /** Additional CSS class */
  className?: string;
  /** Make it a simple text-only version without icon */
  simple?: boolean;
  /** Alternative way to pass action elements */
  children?: ReactNode;
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
  title = "No results",
  description,
  actions,
  height,
  className,
  simple = false,
  children,
}: EmptyStateProps) {
  const Icon = icons[icon];
  const actionContent = actions ?? children;

  return (
    <Center className={className} h={height} py="xl" px="md">
      <Stack gap="xs" align="center" maw="32rem" style={{ textAlign: "center" }}>
        {!simple && (
          <ThemeIcon variant="default" radius="xl" size="lg" c="dimmed">
            <Icon size={16} />
          </ThemeIcon>
        )}
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
        {actionContent ? (
          <Box>
            <Group gap="xs" justify="center" wrap="wrap">
              {actionContent}
            </Group>
          </Box>
        ) : null}
      </Stack>
    </Center>
  );
}
