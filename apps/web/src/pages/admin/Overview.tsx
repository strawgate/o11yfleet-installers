import { Link } from "react-router-dom";
import { useAdminOverview, useAdminTenants } from "../../hooks/queries";
import { StatCard } from "../../components/ui/StatCard";
import { relativeTime } from "../../lib/format";

export function AdminOverviewPage() {
  const { data: overview, isLoading } = useAdminOverview();
  const { data: tenants } = useAdminTenants();

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-lg font-semibold text-fg mb-6">Admin Overview</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Tenants" value={isLoading ? "—" : (overview?.total_tenants ?? 0)} />
        <StatCard
          label="Configurations"
          value={isLoading ? "—" : (overview?.total_configurations ?? 0)}
        />
        <StatCard
          label="Active Tokens"
          value={isLoading ? "—" : (overview?.total_active_tokens ?? 0)}
        />
        <StatCard label="Users" value={isLoading ? "—" : (overview?.total_users ?? 0)} />
      </div>

      <h2 className="text-sm font-semibold text-fg mb-3">Recent Tenants</h2>
      {tenants?.length === 0 ? (
        <p className="text-sm text-fg-3">No tenants yet.</p>
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
              {tenants?.slice(0, 10).map((t) => (
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
                  <td className="px-4 py-3 text-fg-3">{t.plan}</td>
                  <td className="px-4 py-3 text-fg-3 text-xs">{relativeTime(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
