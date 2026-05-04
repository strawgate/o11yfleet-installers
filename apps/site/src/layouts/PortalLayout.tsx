import { useEffect, useCallback, useMemo, useState } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router";
import {
  Alert,
  AppShell,
  Anchor,
  Box,
  Burger,
  Button,
  Group,
  Menu,
  Stack,
  Text,
} from "@mantine/core";
import {
  Activity,
  CreditCard,
  FileText,
  Hourglass,
  House,
  KeyRound,
  Play,
  Settings,
  Users,
} from "lucide-react";
import { useAuth, useLogout } from "@/api/hooks/auth";
import { useConfiguration, useTenant } from "@/api/hooks/portal";
import { useRegisterBrowserContext } from "@/ai/browser-context-react";
import { CommandPalette, type CommandItem } from "@/components/common/CommandPalette";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { Logo } from "@/components/common/Logo";
import { portalBreadcrumbConfigurationId, portalBreadcrumbLabel } from "./portal-breadcrumbs";
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

const USER_NAV: ShellNavEntry[] = [
  { sec: "Workspace" },
  { id: "overview", label: "Overview", href: "/portal/overview", icon: <House size={ICON_SIZE} /> },
  { id: "agents", label: "Agents", href: "/portal/agents", icon: <Activity size={ICON_SIZE} /> },
  {
    id: "configurations",
    label: "Configurations",
    href: "/portal/configurations",
    icon: <FileText size={ICON_SIZE} />,
  },
  { sec: "Setup" },
  {
    id: "getting-started",
    label: "Getting started",
    href: "/portal/getting-started",
    icon: <Play size={ICON_SIZE} />,
  },
  {
    id: "tokens",
    label: "Enrollment tokens",
    href: "/portal/tokens",
    icon: <KeyRound size={ICON_SIZE} />,
  },
  {
    id: "pending-devices",
    label: "Pending collectors",
    href: "/portal/pending-devices",
    icon: <Hourglass size={ICON_SIZE} />,
  },
  { sec: "Settings" },
  { id: "team", label: "Team", href: "/portal/team", icon: <Users size={ICON_SIZE} /> },
  {
    id: "billing",
    label: "Plan & billing",
    href: "/portal/billing",
    icon: <CreditCard size={ICON_SIZE} />,
  },
  {
    id: "settings",
    label: "Workspace settings",
    href: "/portal/settings",
    icon: <Settings size={ICON_SIZE} />,
  },
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

const PORTAL_ROOT = /^\/portal/;

function Breadcrumbs() {
  const { pathname } = useLocation();
  const configurationId = portalBreadcrumbConfigurationId(pathname);
  const configuration = useConfiguration(configurationId);
  const segments = pathname
    .replace(/^\/portal\/?/, "")
    .split("/")
    .filter(Boolean);

  if (segments.length === 0) return <BreadcrumbList>{null}</BreadcrumbList>;

  return (
    <BreadcrumbList>
      {segments.map((seg, i) => {
        const label = portalBreadcrumbLabel(seg, i, segments, {
          configurationId,
          configurationName: configuration.data?.name,
        });
        if (i === segments.length - 1) {
          return <BreadcrumbCurrent key={seg}>{label}</BreadcrumbCurrent>;
        }
        const href = "/portal/" + segments.slice(0, i + 1).join("/");
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

export default function PortalLayout() {
  const { user, isLoading } = useAuth();
  const tenant = useTenant(Boolean(user) && !isLoading);
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
    if (!isLoading && !user) {
      void navigate("/login", { replace: true });
    }
  }, [isLoading, user, navigate]);

  useEffect(() => {
    if (
      !isLoading &&
      user &&
      user.tenantStatus === "pending" &&
      location.pathname !== "/portal/pending-approval"
    ) {
      void navigate("/portal/pending-approval", { replace: true });
    }
  }, [isLoading, user, location.pathname, navigate]);

  useEffect(() => {
    sidebar.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const browserContext = useMemo(
    () => ({
      id: "portal.layout",
      title: "Portal workspace",
      facts: [
        ...(tenant.data?.name
          ? [{ label: "Workspace", value: tenant.data.name, source: "portal layout" }]
          : []),
        ...(tenant.data?.plan
          ? [{ label: "Plan", value: tenant.data.plan, source: "portal layout" }]
          : []),
      ],
      context: {
        tenant_id: user?.tenant_id ?? null,
        workspace_name: tenant.data?.name ?? null,
        plan: tenant.data?.plan ?? null,
      },
    }),
    [tenant.data?.name, tenant.data?.plan, user?.tenant_id],
  );
  useRegisterBrowserContext(browserContext);

  const openCommand = useCallback(() => setCommandOpen(true), []);

  if (isLoading) return <LoadingSpinner />;
  if (!user) return null;

  const userName = user.name ?? user.displayName ?? user.email ?? "User";
  const userEmail = user.email ?? "";
  const isImpersonating = Boolean(user.isImpersonation);
  const orgName =
    tenant.data?.name?.trim() || (tenant.isLoading ? "Loading workspace…" : "Workspace");
  const orgPlan =
    tenant.data?.plan?.trim() || (tenant.isLoading ? "Loading plan…" : "Plan unavailable");
  const orgInitials = orgName
    .split(" ")
    .map((w: string) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

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
            <ShellSearchButton onOpen={openCommand} placeholder="Search collectors, configs…" />
          </Box>
          <Group gap="xs" wrap="nowrap">
            <Anchor href="/docs/" size="sm" c="dimmed" underline="never" visibleFrom="sm">
              Docs
            </Anchor>
            <ColorSchemeToggle />
            <ProfileMenu
              userName={userName}
              userEmail={userEmail}
              onLogout={handleLogout}
              extraItems={
                <>
                  <Menu.Item component={NavLink} to="/portal/settings">
                    Account settings
                  </Menu.Item>
                  <Menu.Item component={NavLink} to="/portal/team">
                    Team
                  </Menu.Item>
                  <Menu.Item component={NavLink} to="/portal/billing">
                    Plan & billing
                  </Menu.Item>
                </>
              }
            />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar>
        <Box p="md" pb="xs">
          <Anchor component={NavLink} to="/portal/overview" underline="never" c="bright">
            <Group gap="xs">
              <Logo />
              <Text fw={600}>O11yFleet</Text>
            </Group>
          </Anchor>
        </Box>

        <Box style={{ flex: 1, overflowY: "auto" }}>
          <ShellNav nav={USER_NAV} onNavigate={sidebar.close} rootPattern={PORTAL_ROOT} />
        </Box>

        <Box p="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
          <Group gap="xs" wrap="nowrap">
            <Box
              style={{
                width: 32,
                height: 32,
                borderRadius: "var(--mantine-radius-sm)",
                background: "var(--accent-soft)",
                color: "var(--accent)",
                border: "1px solid var(--accent-line)",
                display: "grid",
                placeItems: "center",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.02em",
              }}
            >
              {orgInitials}
            </Box>
            <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
              <Text size="sm" fw={500} truncate>
                {orgName}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {orgPlan}
              </Text>
            </Stack>
          </Group>
        </Box>
      </AppShell.Navbar>

      <AppShell.Main id="main-content" tabIndex={-1}>
        {isImpersonating ? (
          <Alert
            color="yellow"
            mb="md"
            title="Viewing as workspace"
            role="status"
            aria-live="polite"
          >
            <Group justify="space-between" wrap="wrap" gap="sm">
              <Text size="sm">
                You are impersonating {orgName}. Actions in this portal affect this workspace.
              </Text>
              <Button size="xs" variant="default" onClick={handleLogout}>
                End impersonation
              </Button>
            </Group>
          </Alert>
        ) : null}

        <Outlet />
      </AppShell.Main>

      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        items={navCommands(USER_NAV)}
        placeholder="Search collectors, configs, pages..."
      />
    </AppShell>
  );
}
