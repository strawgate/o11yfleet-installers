import { useEffect, useCallback, useMemo, useState } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Anchor, AppShell, Badge, Box, Burger, Group, Stack, Text } from "@mantine/core";
import { Activity, Building2, Code2, CreditCard, Database, House, LifeBuoy } from "lucide-react";
import { useAuth, useLogout } from "@/api/hooks/auth";
import { useRegisterBrowserContext } from "@/ai/browser-context-react";
import { CommandPalette, type CommandItem } from "@/components/common/CommandPalette";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { Logo } from "@/components/common/Logo";
import {
  BreadcrumbCurrent,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSep,
  ColorSchemeToggle,
  CommandPaletteShortcut,
  ProfileMenu,
  ShellNav,
  ShellSearchButton,
  type ShellNavEntry,
  useSidebarToggle,
} from "./components/Shell";

const ICON_SIZE = 16;

const ADMIN_NAV: ShellNavEntry[] = [
  { sec: "Operations" },
  { id: "overview", label: "Overview", href: "/admin/overview", icon: <House size={ICON_SIZE} /> },
  {
    id: "tenants",
    label: "Tenants",
    href: "/admin/tenants",
    icon: <Building2 size={ICON_SIZE} />,
  },
  {
    id: "health",
    label: "System health",
    href: "/admin/health",
    icon: <Activity size={ICON_SIZE} />,
  },
  { id: "api", label: "API reference", href: "/admin/api", icon: <Code2 size={ICON_SIZE} /> },
  {
    id: "usage",
    label: "Usage & spend",
    href: "/admin/usage",
    icon: <CreditCard size={ICON_SIZE} />,
  },
  { id: "support", label: "Support", href: "/admin/support", icon: <LifeBuoy size={ICON_SIZE} /> },
  {
    id: "do-viewer",
    label: "DO viewer",
    href: "/admin/do-viewer",
    icon: <Database size={ICON_SIZE} />,
  },
  { sec: "Plans" },
  { id: "plans", label: "Plans", href: "/admin/plans", icon: <CreditCard size={ICON_SIZE} /> },
];

function navCommands(nav: ShellNavEntry[]): CommandItem[] {
  let section = "";
  return nav.flatMap((item) => {
    if ("sec" in item) {
      section = item.sec;
      return [];
    }
    return [
      {
        id: item.id,
        label: item.label,
        href: item.href,
        section,
        disabled: item.placeholder,
      },
    ];
  });
}

const ADMIN_ROOT = /^\/admin/;

function Breadcrumbs() {
  const { pathname } = useLocation();
  const segments = pathname
    .replace(/^\/admin\/?/, "")
    .split("/")
    .filter(Boolean);

  if (segments.length === 0) return <BreadcrumbList>{null}</BreadcrumbList>;

  return (
    <BreadcrumbList>
      {segments.map((seg, i) => {
        const label = seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        const isIdSegment = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          seg,
        );
        if (i === segments.length - 1) {
          return <BreadcrumbCurrent key={seg}>{isIdSegment ? "Detail" : label}</BreadcrumbCurrent>;
        }
        const href = "/admin/" + segments.slice(0, i + 1).join("/");
        return (
          <Group key={seg} gap={4} wrap="nowrap">
            <BreadcrumbLink to={href}>{label}</BreadcrumbLink>
            <BreadcrumbSep />
          </Group>
        );
      })}
    </BreadcrumbList>
  );
}

export default function AdminLayout() {
  const { user, isLoading, isAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const logoutMutation = useLogout();
  const sidebar = useSidebarToggle();
  const [commandOpen, setCommandOpen] = useState(false);

  const handleLogout = useCallback(() => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        void navigate("/");
      },
    });
  }, [logoutMutation, navigate]);

  useEffect(() => {
    if (!isLoading && (!user || !isAdmin)) {
      void navigate(user ? "/portal/overview" : "/admin/login", { replace: true });
    }
  }, [isLoading, user, isAdmin, navigate]);

  useEffect(() => {
    sidebar.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const browserContext = useMemo(
    () => ({
      id: "admin.layout",
      title: "Admin console",
      facts: [{ label: "Surface", value: "Admin console", source: "admin layout" }],
      context: {
        admin_surface: true,
      },
    }),
    [],
  );
  useRegisterBrowserContext(browserContext);

  const openCommand = useCallback(() => setCommandOpen(true), []);

  if (isLoading) return <LoadingSpinner />;
  if (!user || !isAdmin) return null;

  const userName = user.name ?? user.email ?? "Admin";
  const userEmail = user.email ?? "";

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 260, breakpoint: "sm", collapsed: { mobile: !sidebar.opened } }}
      padding="md"
    >
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <CommandPaletteShortcut onOpen={openCommand} />

      <Box
        h={3}
        style={{
          background:
            "linear-gradient(90deg, var(--mantine-color-red-7), var(--mantine-color-orange-7))",
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 300,
        }}
        aria-hidden
      />

      <AppShell.Header>
        <Group h="100%" px="md" gap="md" wrap="nowrap">
          <Burger
            opened={sidebar.opened}
            onClick={sidebar.toggle}
            hiddenFrom="sm"
            size="sm"
            aria-label="Toggle navigation"
          />
          <Box style={{ flex: "0 0 auto", minWidth: 0 }}>
            <Breadcrumbs />
          </Box>
          <Box style={{ flex: "1 1 auto", display: "flex", justifyContent: "center" }}>
            <ShellSearchButton onOpen={openCommand} placeholder="Search pages…" />
          </Box>
          <Group gap="xs" wrap="nowrap">
            <Anchor
              component={NavLink}
              to="/admin/health"
              size="sm"
              c="dimmed"
              underline="never"
              visibleFrom="sm"
            >
              Health
            </Anchor>
            <ColorSchemeToggle />
            <ProfileMenu userName={userName} userEmail={userEmail} onLogout={handleLogout} />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar>
        <Box p="md" pb="xs">
          <Anchor component={NavLink} to="/admin/overview" underline="never" c="bright">
            <Group gap="xs">
              <Logo />
              <Text fw={600}>O11yFleet</Text>
              <Badge size="xs" color="red" variant="filled">
                ADMIN
              </Badge>
            </Group>
          </Anchor>
        </Box>

        <Box style={{ flex: 1, overflowY: "auto" }}>
          <ShellNav nav={ADMIN_NAV} onNavigate={sidebar.close} rootPattern={ADMIN_ROOT} />
        </Box>

        <Stack p="sm" gap={0} />
      </AppShell.Navbar>

      <AppShell.Main id="main-content" tabIndex={-1}>
        <Outlet />
      </AppShell.Main>

      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        items={navCommands(ADMIN_NAV)}
        placeholder="Search pages..."
      />
    </AppShell>
  );
}
