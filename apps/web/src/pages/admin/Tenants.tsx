import { useState } from "react";
import { Link } from "react-router-dom";
import { useAdminTenants } from "../../hooks/queries";
import { Badge } from "../../components/ui/Badge";
import { Input } from "../../components/ui/Input";
import { relativeTime } from "../../lib/format";

export function TenantsPage() {
  const { data: tenants, isLoading } = useAdminTenants();
  const [filter, setFilter] = useState("");

  const filtered = tenants?.filter(
    (t) =>
      t.name.toLowerCase().includes(filter.toLowerCase()) ||
      t.slug.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-fg">Tenants</h1>
          <p className="text-xs text-fg-3 mt-0.5">{tenants?.length ?? 0} total</p>
        </div>
      </div>

      <div className="mb-4 max-w-xs">
        <Input
          placeholder="Filter by name or slug…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-surface" />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-3">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-3">Slug</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-3">Plan</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered?.map((t) => (
                <tr key={t.id} className="border-b border-line last:border-0 hover:bg-surface-2/50">
                  <td className="px-4 py-3">
                    <Link
                      to={`/admin/tenants/${t.id}`}
                      className="text-fg font-medium hover:text-brand transition-colors"
                    >
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-fg-3 font-mono text-xs">{t.slug}</td>
                  <td className="px-4 py-3">
                    <Badge>{t.plan}</Badge>
                  </td>
                  <td className="px-4 py-3 text-fg-3 text-xs">{relativeTime(t.created_at)}</td>
                </tr>
              ))}
              {filtered?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-fg-3">
                    No tenants match "{filter}"
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
