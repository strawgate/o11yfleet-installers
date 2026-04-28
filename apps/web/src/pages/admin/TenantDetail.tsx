import { useParams, Link, Navigate } from "react-router-dom";
import { useAdminTenant, useAdminTenantConfigs } from "../../hooks/queries";
import { Badge } from "../../components/ui/Badge";
import { StatCard } from "../../components/ui/StatCard";
import { relativeTime } from "../../lib/format";

export function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: tenant } = useAdminTenant(id ?? "");
  const { data: configs } = useAdminTenantConfigs(id ?? "");

  if (!id) return <Navigate to="/admin/tenants" replace />;

  return (
    <div className="p-6 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-fg-3 mb-4">
        <Link to="/admin/tenants" className="hover:text-fg">
          Tenants
        </Link>
        <span>/</span>
        <span className="text-fg">{tenant?.name ?? "…"}</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-fg">{tenant?.name}</h1>
          <p className="text-xs text-fg-3 font-mono mt-0.5">{tenant?.slug}</p>
        </div>
        <Badge>{tenant?.plan ?? "—"}</Badge>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard label="Configurations" value={configs?.length ?? "—"} />
        <StatCard label="Plan" value={tenant?.plan ?? "—"} />
        <StatCard label="Created" value={tenant ? relativeTime(tenant.created_at) : "—"} />
      </div>

      <h2 className="text-sm font-semibold text-fg mb-3">Configurations</h2>
      {configs?.length === 0 ? (
        <p className="text-sm text-fg-3">No configurations for this tenant.</p>
      ) : (
        <div className="rounded-xl border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-3">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-3">Environment</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {configs?.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-fg font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-fg-3">{c.environment ?? "—"}</td>
                  <td className="px-4 py-3 text-fg-3 text-xs">{relativeTime(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
