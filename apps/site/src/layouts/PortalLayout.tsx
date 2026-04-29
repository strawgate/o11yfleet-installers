import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth, useLogout } from "@/api/hooks/auth";
import { useTenant } from "@/api/hooks/portal";
import { useRegisterBrowserContext } from "@/ai/browser-context-react";
import { CommandPalette, type CommandItem } from "@/components/common/CommandPalette";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { Logo } from "@/components/common/Logo";
import { useTheme } from "@/hooks/useTheme";
import { useClickOutside } from "@/hooks/useClickOutside";
import "@/styles/portal-shared.css";

/* ------------------------------------------------------------------ */
/*  Icon map                                                          */
/* ------------------------------------------------------------------ */

const ICONS: Record<string, string> = {
  home: '<path d="M3 9.5L8 4l5 5.5V13a1 1 0 0 1-1 1h-2v-3H8v3H6a1 1 0 0 1-1-1V9.5z"/>',
  cpu: '<rect x="4" y="4" width="8" height="8" rx="1.4"/><path d="M2 6h2M2 9h2M12 6h2M12 9h2M6 2v2M9 2v2M6 12v2M9 12v2"/><rect x="6" y="6" width="4" height="4" fill="currentColor" stroke="none" opacity="0.3"/>',
  file: '<path d="M4 2h6l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M10 2v3h3"/>',
  rocket:
    '<path d="M9.5 6.5L4 12l-1 2 2-1 5.5-5.5"/><path d="M9 4l3 3M11 2c2 0 4 2 4 4l-3-3-1-1z"/><circle cx="10.5" cy="5.5" r="0.8" fill="currentColor"/>',
  activity: '<path d="M2 8h3l2-5 3 10 2-5h3"/>',
  list: '<path d="M5 4h9M5 8h9M5 12h9"/><circle cx="2.5" cy="4" r="0.8" fill="currentColor"/><circle cx="2.5" cy="8" r="0.8" fill="currentColor"/><circle cx="2.5" cy="12" r="0.8" fill="currentColor"/>',
  play: '<circle cx="8" cy="8" r="6"/><path d="M7 5.5L11 8L7 10.5z" fill="currentColor"/>',
  link: '<path d="M6 8a3 3 0 0 0 4 0l2-2a3 3 0 0 0-4-4l-1 1M10 8a3 3 0 0 0-4 0l-2 2a3 3 0 0 0 4 4l1-1"/>',
  key: '<circle cx="5" cy="11" r="2.5"/><path d="M7 9l6-6M11 5l1 1"/>',
  users:
    '<circle cx="6" cy="6" r="2.5"/><path d="M2 13c0-2 2-3.5 4-3.5s4 1.5 4 3.5"/><circle cx="11.5" cy="6" r="2"/><path d="M11 9.5c1.6 0 3 1.2 3 3"/>',
  card: '<rect x="2" y="4" width="12" height="9" rx="1.4"/><path d="M2 7h12"/>',
  settings:
    '<circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"/>',
};

/* ------------------------------------------------------------------ */
/*  Nav definition                                                    */
/* ------------------------------------------------------------------ */

type NavSection = { sec: string };
type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: string;
  placeholder?: boolean;
};

const USER_NAV: (NavSection | NavItem)[] = [
  { sec: "Workspace" },
  { id: "overview", label: "Overview", href: "/portal/overview", icon: "home" },
  { id: "agents", label: "Agents", href: "/portal/agents", icon: "cpu" },
  { id: "configurations", label: "Configurations", href: "/portal/configurations", icon: "file" },
  { sec: "Setup" },
  {
    id: "getting-started",
    label: "Getting started",
    href: "/portal/getting-started",
    icon: "play",
  },
  { id: "tokens", label: "Enrollment tokens", href: "/portal/tokens", icon: "key" },
  { sec: "Settings" },
  { id: "team", label: "Team", href: "/portal/team", icon: "users" },
  { id: "billing", label: "Plan & billing", href: "/portal/billing", icon: "card" },
  { id: "settings", label: "Workspace settings", href: "/portal/settings", icon: "settings" },
];

function navCommands(nav: (NavSection | NavItem)[]): CommandItem[] {
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

/* ------------------------------------------------------------------ */
/*  Components                                                        */
/* ------------------------------------------------------------------ */

function SidebarIcon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: ICONS[name] ?? "" }}
    />
  );
}

function SidebarNav({
  nav,
  onNavigate,
}: {
  nav: (NavSection | NavItem)[];
  onNavigate?: () => void;
}) {
  return (
    <nav className="sidebar-nav">
      {nav.map((item, i) => {
        if ("sec" in item) {
          return (
            <div key={item.sec} className="sidebar-section">
              {item.sec}
            </div>
          );
        }
        if (item.placeholder) {
          return (
            <button
              key={item.id + i}
              type="button"
              className="sidebar-link"
              data-placeholder="true"
              disabled
            >
              <SidebarIcon name={item.icon} />
              <span>{item.label}</span>
            </button>
          );
        }
        return (
          <NavLink
            key={item.id + i}
            to={item.href}
            className="sidebar-link"
            end={item.href.endsWith("/overview")}
            onClick={onNavigate}
          >
            <SidebarIcon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

function ProfileDropdown({
  userName,
  userEmail,
  onLogout,
}: {
  userName: string;
  userEmail: string;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useClickOutside(wrapRef, () => setOpen(false));

  const userInit = userName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="profile-wrap" ref={wrapRef}>
      <button className="profile" onClick={() => setOpen((o) => !o)}>
        <span className="avatar">{userInit}</span>
        <span style={{ fontWeight: 450 }}>{userName.split(" ")[0]}</span>
        <svg
          className="chev"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          width="11"
          height="11"
        >
          <path d="M3 5l3 3 3-3" strokeLinecap="round" />
        </svg>
      </button>
      <div className={`dropdown${open ? " open" : ""}`} id="profile-menu">
        <div className="meta">
          <div className="name">{userName}</div>
          <div className="email">{userEmail}</div>
        </div>
        <NavLink to="/portal/settings" onClick={() => setOpen(false)}>
          Account settings
        </NavLink>
        <NavLink to="/portal/team" onClick={() => setOpen(false)}>
          Team
        </NavLink>
        <NavLink to="/portal/billing" onClick={() => setOpen(false)}>
          Plan & billing
        </NavLink>
        <div className="divider" />
        <button
          onClick={() => {
            const cur = document.documentElement.getAttribute("data-theme");
            const next = cur === "dark" ? "light" : "dark";
            document.documentElement.setAttribute("data-theme", next);
            localStorage.setItem("fb-theme", next);
            setOpen(false);
          }}
        >
          Toggle theme
        </button>
        <button onClick={onLogout}>Sign out</button>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { toggle } = useTheme();
  return (
    <button className="icon-btn" aria-label="Theme" onClick={toggle}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M14 9.5A6 6 0 1 1 6.5 2c-.2 1.6.6 3.4 2 4.6 1.4 1.2 3.4 1.8 5.5.5z" />
      </svg>
    </button>
  );
}

function NotificationsButton() {
  return (
    <button className="icon-btn" aria-label="Notifications">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 7a4 4 0 1 1 8 0v3l1 2H3l1-2V7z" />
        <path d="M6.5 13.5a1.5 1.5 0 0 0 3 0" />
      </svg>
    </button>
  );
}

function SidebarToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      className="icon-btn sidebar-toggle"
      aria-label={open ? "Close navigation" : "Open navigation"}
      aria-expanded={open}
      onClick={onClick}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2.5 4h11M2.5 8h11M2.5 12h11" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function SearchBar({ onOpen }: { onOpen: () => void }) {
  return (
    <button className="search" onClick={onOpen} aria-label="Open command menu">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5l3 3" strokeLinecap="round" />
      </svg>
      <span>Search collectors, configs…</span>
      <span className="kbd-hint">⌘K</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Breadcrumb helper                                                 */
/* ------------------------------------------------------------------ */

function Breadcrumbs() {
  const { pathname } = useLocation();
  const segments = pathname
    .replace(/^\/portal\/?/, "")
    .split("/")
    .filter(Boolean);

  if (segments.length === 0) return <div className="crumbs" />;

  return (
    <div className="crumbs">
      {segments.map((seg, i) => {
        const label = seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        if (i === segments.length - 1) {
          return (
            <span key={seg} className="current">
              {label}
            </span>
          );
        }
        const href = "/portal/" + segments.slice(0, i + 1).join("/");
        return (
          <span key={seg}>
            <NavLink to={href}>{label}</NavLink>
            <span className="sep">/</span>
          </span>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Layout                                                            */
/* ------------------------------------------------------------------ */

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
  );
}

export default function PortalLayout() {
  const { user, isLoading } = useAuth();
  const tenant = useTenant(Boolean(user) && !isLoading);
  const location = useLocation();
  const navigate = useNavigate();
  const logoutMutation = useLogout();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);

  const handleLogout = useCallback(() => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => navigate("/"),
    });
  }, [logoutMutation, navigate]);

  // Redirect unauthenticated users
  useEffect(() => {
    if (!isLoading && !user) {
      navigate("/login", { replace: true });
    }
  }, [isLoading, user, navigate]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (isEditableShortcutTarget(event.target)) return;
        event.preventDefault();
        setCommandOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

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
    <div className={`app${isImpersonating ? " impersonating" : ""}`}>
      <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
        <NavLink to="/portal/overview" className="sidebar-brand">
          <Logo />
          O11yFleet
        </NavLink>

        <SidebarNav nav={USER_NAV} onNavigate={() => setSidebarOpen(false)} />

        <div className="sidebar-foot">
          <div className="org-switcher">
            <span className="org-mark">{orgInitials}</span>
            <div className="org-meta">
              <div className="org-name">{orgName}</div>
              <div className="org-plan">{orgPlan}</div>
            </div>
            <svg
              className="chev"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              width="12"
              height="12"
            >
              <path d="M3 5l3 3 3-3M3 7l3-3 3 3" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      </aside>
      {sidebarOpen ? (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setSidebarOpen(false);
          }}
        />
      ) : null}

      <header className="topbar">
        <SidebarToggle open={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)} />
        <Breadcrumbs />
        <SearchBar onOpen={() => setCommandOpen(true)} />
        <div className="topbar-right">
          <a href="/docs/" className="topbar-docs">
            Docs
          </a>
          <ThemeToggle />
          <NotificationsButton />
          <ProfileDropdown userName={userName} userEmail={userEmail} onLogout={handleLogout} />
        </div>
      </header>
      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        items={navCommands(USER_NAV)}
        placeholder="Search collectors, configs, pages..."
      />

      {isImpersonating ? (
        <div className="impersonation-bar" role="status" aria-live="polite">
          <div>
            <strong>Viewing as tenant</strong>
            <span>
              You are impersonating {orgName}. Actions in this portal affect this tenant workspace.
            </span>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
            End impersonation
          </button>
        </div>
      ) : null}

      <main className="main">
        <div className="main-wide">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
