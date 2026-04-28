import { useEffect, useState, useRef, useCallback } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/api/hooks/auth";
import { useLogout } from "@/api/hooks/auth";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { Logo } from "@/components/common/Logo";
import { useTheme } from "@/hooks/useTheme";
import { useClickOutside } from "@/hooks/useClickOutside";
import "@/styles/portal-shared.css";
import "@/styles/admin.css";

/* ------------------------------------------------------------------ */
/*  Icon map                                                          */
/* ------------------------------------------------------------------ */

const ICONS: Record<string, string> = {
  home: '<path d="M3 9.5L8 4l5 5.5V13a1 1 0 0 1-1 1h-2v-3H8v3H6a1 1 0 0 1-1-1V9.5z"/>',
  building:
    '<rect x="3" y="2" width="10" height="12" rx="0.5"/><path d="M5 5h2M5 8h2M5 11h2M9 5h2M9 8h2M9 11h2"/>',
  users:
    '<circle cx="6" cy="6" r="2.5"/><path d="M2 13c0-2 2-3.5 4-3.5s4 1.5 4 3.5"/><circle cx="11.5" cy="6" r="2"/><path d="M11 9.5c1.6 0 3 1.2 3 3"/>',
  activity: '<path d="M2 8h3l2-5 3 10 2-5h3"/>',
  list: '<path d="M5 4h9M5 8h9M5 12h9"/><circle cx="2.5" cy="4" r="0.8" fill="currentColor"/><circle cx="2.5" cy="8" r="0.8" fill="currentColor"/><circle cx="2.5" cy="12" r="0.8" fill="currentColor"/>',
  card: '<rect x="2" y="4" width="12" height="9" rx="1.4"/><path d="M2 7h12"/>',
  flag: '<path d="M3 14V2M3 3l8 1-1 3 1 3-8-1"/>',
  tag: '<path d="M2 8V3a1 1 0 0 1 1-1h5l6 6-6 6-6-6z"/><circle cx="5.5" cy="5.5" r="0.8" fill="currentColor"/>',
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

const ADMIN_NAV: (NavSection | NavItem)[] = [
  { sec: "Operations" },
  { id: "overview", label: "Overview", href: "/admin/overview", icon: "home" },
  { id: "tenants", label: "Tenants", href: "/admin/tenants", icon: "building" },
  { id: "users", label: "Users", href: "/admin/users", icon: "users", placeholder: true },
  { id: "health", label: "System health", href: "/admin/health", icon: "activity" },
  { id: "events", label: "Audit events", href: "/admin/events", icon: "list" },
  { sec: "Plans" },
  { id: "plans", label: "Plans & pricing", href: "/admin/plans", icon: "card" },
  { id: "flags", label: "Feature flags", href: "/admin/flags", icon: "flag" },
  { sec: "Platform" },
  { id: "releases", label: "Releases", href: "/admin/releases", icon: "tag", placeholder: true },
  {
    id: "settings",
    label: "Settings",
    href: "/admin/settings",
    icon: "settings",
    placeholder: true,
  },
];

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

function SidebarNav({ nav }: { nav: (NavSection | NavItem)[] }) {
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
        <NavLink to="/admin/settings" onClick={() => setOpen(false)}>
          Account settings
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

function SearchBar() {
  return (
    <div className="search">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5l3 3" strokeLinecap="round" />
      </svg>
      <span>Search tenants, users…</span>
      <span className="kbd-hint">⌘K</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Breadcrumbs                                                       */
/* ------------------------------------------------------------------ */

function Breadcrumbs() {
  const { pathname } = useLocation();
  const segments = pathname
    .replace(/^\/admin\/?/, "")
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
        const href = "/admin/" + segments.slice(0, i + 1).join("/");
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

export default function AdminLayout() {
  const { user, isLoading, isAdmin } = useAuth();
  const navigate = useNavigate();
  const logoutMutation = useLogout();

  const handleLogout = useCallback(() => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => navigate("/"),
    });
  }, [logoutMutation, navigate]);

  // Must be admin
  useEffect(() => {
    if (!isLoading && (!user || !isAdmin)) {
      navigate(user ? "/portal/overview" : "/login", { replace: true });
    }
  }, [isLoading, user, isAdmin, navigate]);

  if (isLoading) return <LoadingSpinner />;
  if (!user || !isAdmin) return null;

  const userName = user.name ?? user.email ?? "Admin";
  const userEmail = user.email ?? "";

  return (
    <div className="app">
      <div className="admin-stripe" />

      <aside className="sidebar">
        <NavLink to="/admin/overview" className="sidebar-brand">
          <Logo />
          O11yFleet
          <span className="admin-badge">ADMIN</span>
        </NavLink>

        <SidebarNav nav={ADMIN_NAV} />

        <div className="sidebar-foot" />
      </aside>

      <header className="topbar">
        <Breadcrumbs />
        <SearchBar />
        <div className="topbar-right">
          <ThemeToggle />
          <NotificationsButton />
          <ProfileDropdown userName={userName} userEmail={userEmail} onLogout={handleLogout} />
        </div>
      </header>

      <main className="main">
        <div className="main-wide">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
