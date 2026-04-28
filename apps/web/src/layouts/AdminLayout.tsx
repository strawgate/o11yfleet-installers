import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Toaster } from "../components/ui/Toast";
import { clsx } from "clsx";

const nav = [
  { to: "/admin/overview", label: "Overview", icon: "⌘" },
  { to: "/admin/tenants", label: "Tenants", icon: "🏢" },
  { to: "/admin/health", label: "System health", icon: "❤" },
  { to: "/admin/events", label: "Audit events", icon: "📋" },
  { to: "/admin/plans", label: "Plans & pricing", icon: "💰" },
  { to: "/admin/flags", label: "Feature flags", icon: "🚩" },
];

export function AdminLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen bg-gray-950">
      {/* Sidebar */}
      <aside className="w-60 flex flex-col border-r border-line bg-[#0a0c10] shrink-0">
        <div className="flex items-center gap-2 h-14 px-4 border-b border-line">
          <span className="text-brand text-lg">⚡</span>
          <span className="font-semibold text-sm text-fg">O11yFleet</span>
          <span className="ml-1 px-1.5 py-0.5 text-[9px] font-mono font-semibold bg-err/10 text-err rounded">
            ADMIN
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-2">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
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
          ))}
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
