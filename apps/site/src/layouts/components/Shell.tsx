import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  ActionIcon,
  Avatar,
  Badge,
  Group,
  Menu,
  NavLink as MantineNavLink,
  Stack,
  Text,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { ChevronDown, Moon, Search, Sun } from "lucide-react";

export type ShellNavSection = { sec: string };
export type ShellNavItem = {
  id: string;
  label: string;
  href: string;
  icon: ReactNode;
  placeholder?: boolean;
  badge?: string;
};
export type ShellNavEntry = ShellNavSection | ShellNavItem;

export function ShellNav({
  nav,
  onNavigate,
  rootPattern,
}: {
  nav: ShellNavEntry[];
  onNavigate?: () => void;
  rootPattern: RegExp;
}) {
  const { pathname } = useLocation();
  return (
    <Stack gap={2} p="xs">
      {nav.map((item, i) => {
        if ("sec" in item) {
          return (
            <Text
              key={item.sec}
              size="xs"
              fw={600}
              c="dimmed"
              tt="uppercase"
              px="sm"
              mt={i === 0 ? 0 : "sm"}
              mb={4}
            >
              {item.sec}
            </Text>
          );
        }
        const active = item.href.endsWith("/overview")
          ? pathname.replace(rootPattern, "").replace(/^\//, "") === "overview" ||
            pathname.replace(rootPattern, "") === ""
          : pathname.startsWith(item.href);
        if (item.placeholder) {
          return (
            <MantineNavLink
              key={item.id}
              label={item.label}
              leftSection={item.icon}
              rightSection={item.badge ? <Badge size="xs">{item.badge}</Badge> : null}
              disabled
              variant="filled"
            />
          );
        }
        return (
          <MantineNavLink
            key={item.id}
            component={NavLink}
            to={item.href}
            label={item.label}
            leftSection={item.icon}
            rightSection={item.badge ? <Badge size="xs">{item.badge}</Badge> : null}
            active={active}
            onClick={onNavigate}
            variant="filled"
          />
        );
      })}
    </Stack>
  );
}

export function ShellSearchButton({
  onOpen,
  placeholder = "Search…",
}: {
  onOpen: () => void;
  placeholder?: string;
}) {
  return (
    <UnstyledButton
      onClick={onOpen}
      aria-label="Open command menu"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--mantine-spacing-xs)",
        padding: "0.4rem 0.75rem",
        flex: "1 1 auto",
        maxWidth: "32rem",
        borderRadius: "var(--mantine-radius-md)",
        border: "1px solid var(--mantine-color-default-border)",
        background: "var(--mantine-color-default)",
        color: "var(--mantine-color-dimmed)",
        fontSize: "var(--mantine-font-size-sm)",
      }}
    >
      <Search size={14} />
      <span style={{ flex: 1, textAlign: "left" }}>{placeholder}</span>
      <Text size="xs" c="dimmed" component="kbd">
        ⌘K
      </Text>
    </UnstyledButton>
  );
}

export function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("dark", { getInitialValueInEffect: true });
  const isDark = computed === "dark";
  return (
    <ActionIcon
      variant="default"
      size="lg"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setColorScheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </ActionIcon>
  );
}

export function ProfileMenu({
  userName,
  userEmail,
  onLogout,
  extraItems,
}: {
  userName: string;
  userEmail: string;
  onLogout: () => void;
  extraItems?: ReactNode;
}) {
  const initials = userName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const firstName = userName.split(" ")[0];
  return (
    <Menu position="bottom-end" width={220} withArrow arrowPosition="center">
      <Menu.Target>
        <UnstyledButton
          aria-label="Profile menu"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--mantine-spacing-xs)",
            padding: "0.25rem 0.5rem",
            borderRadius: "var(--mantine-radius-md)",
          }}
        >
          <Avatar size="sm" radius="xl" color="brand">
            {initials}
          </Avatar>
          <Text size="sm" fw={500}>
            {firstName}
          </Text>
          <ChevronDown size={12} />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>
          <Stack gap={2}>
            <Text size="sm" fw={500}>
              {userName}
            </Text>
            <Text size="xs" c="dimmed">
              {userEmail}
            </Text>
          </Stack>
        </Menu.Label>
        {extraItems}
        <Menu.Divider />
        <Menu.Item onClick={onLogout}>Sign out</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export function CommandPaletteShortcut({ onOpen }: { onOpen: () => void }) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        const target = event.target;
        if (target instanceof HTMLElement) {
          if (
            target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
          ) {
            return;
          }
        }
        event.preventDefault();
        onOpen();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);
  return null;
}

export function BreadcrumbList({ children }: { children: ReactNode }) {
  return (
    <Group gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
      {children}
    </Group>
  );
}

export function BreadcrumbSep() {
  return (
    <Text size="sm" c="dimmed" component="span" aria-hidden>
      /
    </Text>
  );
}

export function BreadcrumbCurrent({ children }: { children: ReactNode }) {
  return (
    <Text size="sm" fw={500} truncate>
      {children}
    </Text>
  );
}

export function BreadcrumbLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Text size="sm" c="dimmed" component={NavLink} to={to} style={{ textDecoration: "none" }}>
      {children}
    </Text>
  );
}

export function useSidebarToggle() {
  const [opened, setOpened] = useState(false);
  return {
    opened,
    toggle: () => setOpened((o) => !o),
    close: () => setOpened(false),
  };
}
