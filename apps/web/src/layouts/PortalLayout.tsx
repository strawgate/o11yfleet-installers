import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Toaster } from "../components/ui/Toast";
import { clsx } from "clsx";

const nav = [
  { to: "/portal/overview", label: "Overview", icon: "⌘" },
  { to: "/portal/agents", label: "Agents", icon: "◎" },
  { to: "/portal/configurations", label: "Configurations", icon: "☰" },
  { to: "/portal/getting-started", label: "Getting started", icon: "▶" },
  { divider: true as const, label: "Manage" },
  { to: "/portal/tokens", label: "API tokens", icon: "🔑" },
  { to: "/portal/team", label: "Team", icon: "👥" },
  { to: "/portal/billing", label: "Plan & billing", icon: "💳" },
  { to: "/portal/settings", label: "Workspace settings", icon: "⚙" },
];

export function PortalLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen bg-gray-950">
      {/* Sidebar */}
      <aside className="w-60 flex flex-col border-r border-line bg-[#0a0c10] shrink-0">
        <div className="flex items-center gap-2 h-14 px-4 border-b border-line">
          <span className="text-brand text-lg">⚡</span>
          <span className="font-semibold text-sm text-fg">O11yFleet</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-2">
          {nav.map((item, i) =>
            "divider" in item ? (
              <p
                key={i}
                className="px-3 pt-5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-4"
              >
                {item.label}
              </p>
            ) : (
              <NavLink
                key={item.to}
                to={item.to!}
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors",
                    isActive
                      ? "bg-brand/10 text-brand font-medium"
                      : "text-fg-3 hover:text-fg hover:bg-surface-2",
                  )
                }
              >
                <span className="w-4 text-center text-xs opacity-60">
                  {item.icon}
                </span>
                {item.label}
              </NavLink>
            ),
          )}
        </nav>

        {/* User footer */}
        <div className="border-t border-line px-4 py-3">
          <p className="text-xs font-medium text-fg truncate">
            {user?.displayName}
          </p>
          <p className="text-[10px] text-fg-4 truncate">{user?.email}</p>
          <button
            onClick={logout}
            className="mt-2 text-[11px] text-fg-4 hover:text-fg transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <Toaster />
    </div>
  );
}
