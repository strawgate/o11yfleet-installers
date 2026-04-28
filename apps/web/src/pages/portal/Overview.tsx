import { Link } from "react-router-dom";
import { useOverview } from "../../hooks/queries";
import { StatCard } from "../../components/ui/StatCard";

export function OverviewPage() {
  const { data, isLoading } = useOverview();

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-lg font-semibold text-fg mb-6">Overview</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Configurations"
          value={isLoading ? "—" : (data?.total_configurations ?? 0)}
        />
        <StatCard label="Total Agents" value={isLoading ? "—" : (data?.total_agents ?? 0)} />
        <StatCard
          label="Connected"
          value={isLoading ? "—" : (data?.connected_agents ?? 0)}
          sub={
            data && data.total_agents > 0
              ? `${Math.round((data.connected_agents / data.total_agents) * 100)}% of fleet`
              : undefined
          }
        />
        <StatCard
          label="Active Tokens"
          value={isLoading ? "—" : (data?.total_active_tokens ?? 0)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Link
          to="/portal/getting-started"
          className="rounded-xl border border-line bg-surface p-5 hover:border-brand/30 transition-colors"
        >
          <h3 className="text-sm font-semibold text-fg">🚀 Get Started</h3>
          <p className="mt-1 text-xs text-fg-3">Connect your first OTel Collector in minutes</p>
        </Link>

        <Link
          to="/portal/configurations"
          className="rounded-xl border border-line bg-surface p-5 hover:border-brand/30 transition-colors"
        >
          <h3 className="text-sm font-semibold text-fg">☰ Configurations</h3>
          <p className="mt-1 text-xs text-fg-3">Create and manage collector configurations</p>
        </Link>
      </div>
    </div>
  );
}
