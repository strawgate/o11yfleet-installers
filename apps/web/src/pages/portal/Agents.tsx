import { useConfigurations } from "../../hooks/queries";
import { Badge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { relativeTime } from "../../lib/format";
import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { Agent } from "../../hooks/queries";

export function AgentsPage() {
  const { data: configs, isLoading: configsLoading } = useConfigurations();

  // Fetch agents for all configs in parallel
  const agentQueries = useQueries({
    queries: (configs ?? []).map((c) => ({
      queryKey: ["configuration", c.id, "agents"],
      queryFn: () =>
        api.get<{ agents: Agent[] }>(`/api/v1/configurations/${c.id}/agents`),
      refetchInterval: 10_000,
    })),
  });

  const allAgents = agentQueries.flatMap((q, i) =>
    (q.data?.agents ?? []).map((a) => ({
      ...a,
      configName: configs?.[i]?.name ?? "—",
      configId: configs?.[i]?.id ?? "",
    })),
  );

  const isLoading = configsLoading || agentQueries.some((q) => q.isLoading);

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-fg">Agents</h1>
        <p className="text-xs text-fg-3 mt-0.5">
          {allAgents.length} agent{allAgents.length === 1 ? "" : "s"} across{" "}
          {configs?.length ?? 0} configuration{(configs?.length ?? 0) === 1 ? "" : "s"}
        </p>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-surface" />
          ))}
        </div>
      ) : allAgents.length === 0 ? (
        <EmptyState
          icon="◎"
          title="No agents connected"
          description="Agents will appear here once they connect to a configuration."
        />
      ) : (
        <div className="rounded-xl border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-3">
                  Agent
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-3">
                  Configuration
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-3">
                  Status
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-3">
                  Health
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-3">
                  Last Seen
                </th>
              </tr>
            </thead>
            <tbody>
              {allAgents.map((a) => (
                <tr
                  key={a.instance_uid}
                  className="border-b border-line last:border-0 hover:bg-surface-2/50"
                >
                  <td className="px-4 py-3">
                    <p className="text-fg font-medium text-xs font-mono">
                      {a.hostname ?? a.instance_uid.slice(0, 12)}
                    </p>
                    {a.agent_version && (
                      <p className="text-[10px] text-fg-4">v{a.agent_version}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/portal/configurations/${a.configId}`}
                      className="text-xs text-fg-3 hover:text-brand"
                    >
                      {a.configName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={a.status === "connected" ? "success" : "default"}
                    >
                      {a.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={a.healthy ? "success" : "error"}>
                      {a.healthy ? "healthy" : "unhealthy"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-fg-3">
                    {relativeTime(a.last_seen_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
