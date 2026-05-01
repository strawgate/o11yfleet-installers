import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useOverview, type Configuration } from "@/api/hooks/portal";
import { usePortalGuidance } from "@/api/hooks/ai";
import { normalizeFleetOverview } from "@/api/models/fleet-overview";
import type { Observed } from "@/api/models/observed";
import { GuidancePanel, GuidanceSlot } from "@/components/ai";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  EmptyState,
  MetricCard,
  PageHeader,
  PageShell,
  StatusBadge,
  type ColumnDef,
} from "@/components/app";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { ErrorState } from "@/components/common/ErrorState";
import { relTime } from "@/utils/format";
import { hashLabel } from "@/utils/agents";
import { configurationAgentMetrics } from "@/utils/config-stats";
import { buildInsightRequest, insightSurfaces, insightTarget } from "@/ai/insight-registry";
import { useRegisterBrowserContext } from "@/ai/browser-context-react";
import { buildBrowserPageContext, pageMetric, pageTable } from "@/ai/page-context";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";

export default function OverviewPage() {
  const overview = useOverview();
  const view = overview.data ? normalizeFleetOverview(overview.data) : null;
  const cfgList = view?.configurations.rows ?? [];
  const totalConfigs = view?.configurations.total.value ?? cfgList.length;
  const totalAgents = view?.agents.total.value ?? null;
  const connectedAgents = view?.agents.connected.value ?? null;
  const healthyAgents = view?.agents.healthy.value ?? null;
  const activeRollouts = view?.rollouts.active.value ?? null;
  const insightSurface = insightSurfaces.portalOverview;
  const recentConfigurations = cfgList.slice(0, 5);

  const pageContext = view
    ? buildBrowserPageContext({
        title: "Fleet overview",
        visible_text: [
          "Collector status, health, and drift are separate signals.",
          "A collector can be connected and still report unhealthy runtime state.",
        ],
        metrics: [
          pageMetric("configs_count", "Configurations", totalConfigs),
          pageMetric("total_agents", "Total collectors", totalAgents),
          pageMetric("connected_agents", "Connected collectors", connectedAgents),
          pageMetric("healthy_agents", "Healthy collectors", healthyAgents),
          pageMetric("active_rollouts", "Active rollouts", activeRollouts),
        ],
        tables: [
          pageTable(
            "recent_configurations",
            "Recent configurations",
            recentConfigurations.map((config) => ({
              id: config.id,
              name: config.name,
              status: config.status ?? null,
              updated_at: config.updated_at ?? null,
            })),
            { totalRows: cfgList.length },
          ),
        ],
      })
    : null;
  const guidanceRequest: AiGuidanceRequest | null =
    view && pageContext
      ? buildInsightRequest(
          insightSurface,
          [
            insightTarget(insightSurface, insightSurface.targets.page),
            insightTarget(insightSurface, insightSurface.targets.configurations, {
              total_configurations: totalConfigs,
            }),
            insightTarget(insightSurface, insightSurface.targets.agents, {
              total_agents: totalAgents,
              connected_agents: connectedAgents,
              healthy_agents: healthyAgents,
            }),
            insightTarget(insightSurface, insightSurface.targets.recentConfigurations),
          ],
          {
            configurations: {
              total: view.configurations.total,
              rows: recentConfigurations.map((config) => ({
                id: config.id,
                name: config.name,
                status: config.status ?? null,
                updated_at: config.updated_at ?? null,
              })),
            },
            agents: view.agents,
            rollouts: view.rollouts,
          },
          { intent: "triage_state", pageContext },
        )
      : null;
  const browserContext = useMemo(
    () => ({
      id: "portal.overview.page",
      title: "Fleet overview",
      surface: insightSurface.surface,
      context: guidanceRequest?.context ?? {},
      targets: guidanceRequest?.targets ?? [],
      pageContext: pageContext ?? undefined,
    }),
    [guidanceRequest?.context, guidanceRequest?.targets, insightSurface.surface, pageContext],
  );
  useRegisterBrowserContext(browserContext);

  const guidance = usePortalGuidance(guidanceRequest);
  const configurationInsight = guidance.data?.items.find(
    (item) => item.target_key === "overview.configurations",
  );
  const agentInsight = guidance.data?.items.find((item) => item.target_key === "overview.agents");
  const columns = useMemo(() => recentConfigurationColumns(), []);

  if (overview.isLoading) return <LoadingSpinner />;
  if (overview.error)
    return <ErrorState error={overview.error} retry={() => void overview.refetch()} />;

  return (
    <PageShell width="wide">
      <PageHeader
        title="Fleet overview"
        description="Collector status, health, and drift are separate signals. A collector can be connected and still report unhealthy runtime state."
        actions={
          <Button asChild>
            <Link to="/portal/getting-started">Getting started</Link>
          </Button>
        }
      />

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <MetricCard label="Configurations" value={formatMetric(view?.configurations.total)}>
          <GuidanceSlot item={configurationInsight} loading={guidance.isLoading} />
        </MetricCard>
        <MetricCard
          label="Total collectors"
          value={formatMetric(view?.agents.total)}
          observation={view?.agents.total.observation}
        >
          <GuidanceSlot item={agentInsight} loading={guidance.isLoading} />
        </MetricCard>
        <MetricCard
          label="Connected"
          value={formatMetric(view?.agents.connected)}
          observation={view?.agents.connected.observation}
        />
        <MetricCard
          label="Healthy"
          value={formatMetric(view?.agents.healthy)}
          observation={view?.agents.healthy.observation}
          tone={fleetHealthTone(totalAgents, healthyAgents)}
        />
        <MetricCard
          label="Active rollouts"
          value={formatMetric(view?.rollouts.active)}
          observation={view?.rollouts.active.observation}
          detail={activeRollouts === null ? "Not exposed by API yet" : undefined}
        />
      </div>

      <GuidancePanel
        title="Fleet snapshot"
        guidance={guidance.data}
        isLoading={guidance.isLoading}
        error={guidance.error}
        onRefresh={() => void guidance.refetch()}
        excludeTargetKeys={["overview.configurations", "overview.agents"]}
      />

      <DataTable
        className="mt-6"
        title="Recent configurations"
        columns={columns}
        data={recentConfigurations}
        getRowId={(row) => row.id}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link to="/portal/configurations">View all</Link>
          </Button>
        }
        emptyState={
          <EmptyState
            icon="file"
            title="No configurations yet"
            description="Create a configuration to start managing collectors and rollouts."
          >
            <Button asChild size="sm">
              <Link to="/portal/getting-started">Get started</Link>
            </Button>
          </EmptyState>
        }
      />
    </PageShell>
  );
}

function recentConfigurationColumns(): ColumnDef<Configuration>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <Link
          className="font-medium text-foreground hover:text-primary"
          to={configurationPath(row.original)}
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      id: "collectors",
      header: "Collectors",
      cell: ({ row }) => <CollectorSnapshot config={row.original} />,
    },
    {
      id: "desired_config",
      header: "Desired config",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {hashLabel(row.original.current_config_hash ?? undefined)}
        </span>
      ),
    },
    {
      accessorKey: "updated_at",
      header: "Updated",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{relTime(row.original.updated_at)}</span>
      ),
    },
    {
      id: "open",
      header: () => <span className="sr-only">Open</span>,
      cell: ({ row }) => (
        <Button asChild variant="ghost" size="icon-xs">
          <Link aria-label="Open configuration" to={configurationPath(row.original)}>
            <ArrowRight className="size-3" />
          </Link>
        </Button>
      ),
    },
  ];
}

function CollectorSnapshot({ config }: { config: Configuration }) {
  const metrics = configurationAgentMetrics(
    config.stats,
    [],
    config.current_config_hash ?? undefined,
  );
  const hasSnapshot =
    typeof config.stats?.snapshot_at === "string" || typeof config.stats?.snapshot_at === "number";
  const healthyTone =
    metrics.totalAgents === 0
      ? "neutral"
      : metrics.healthyAgents === metrics.totalAgents
        ? "ok"
        : metrics.healthyAgents > 0
          ? "warn"
          : "error";

  if (!hasSnapshot) {
    return <StatusBadge>Snapshot unavailable</StatusBadge>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      <StatusBadge>
        {metrics.connectedAgents} / {metrics.totalAgents} connected
      </StatusBadge>
      <StatusBadge tone={healthyTone}>{metrics.healthyAgents} healthy</StatusBadge>
    </div>
  );
}

function formatMetric(metric: Observed<number> | undefined): string {
  if (!metric || metric.value === null) return "-";
  return metric.value.toLocaleString();
}

function fleetHealthTone(
  totalAgents: number | null,
  healthyAgents: number | null,
): "neutral" | "ok" | "warn" | "error" {
  if (totalAgents === null || healthyAgents === null || totalAgents === 0) return "neutral";
  if (healthyAgents === totalAgents) return "ok";
  if (healthyAgents > 0) return "warn";
  return "error";
}

function configurationPath(config: Configuration): string {
  return `/portal/configurations/${config.id}`;
}
