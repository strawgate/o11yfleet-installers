import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  useOverview,
  useConfigurationAgents,
  useConfigurationStats,
  type Agent,
  type Configuration,
} from "../../api/hooks/portal";
import { usePortalGuidance } from "../../api/hooks/ai";
import { GuidancePanel } from "../../components/ai";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { relTime } from "../../utils/format";
import { agentHost, agentLastSeen, agentUid } from "../../utils/agents";
import { buildInsightRequest, insightTarget, insightSurfaces } from "../../ai/insight-registry";
import { useRegisterBrowserContext } from "../../ai/browser-context-react";
import {
  DataTable,
  EmptyState,
  MetricCard,
  PageHeader,
  PageShell,
  StatusBadge,
  type ColumnDef,
} from "@/components/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { agentHealthView, agentStatusView, agentSyncView } from "./agent-view-model";
import { buildAgentSectionModel } from "./agents-page-model";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";

const EMPTY_AGENTS: Agent[] = [];

function AgentSection({
  config,
  expanded,
  onToggle,
}: {
  config: Configuration;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const setFilterAndResetCursor = (next: string) => {
    setFilter(next);
    setCursor(undefined);
  };
  const {
    data: agentsPage,
    isLoading,
    error,
  } = useConfigurationAgents(config.id, {
    limit: 50,
    cursor,
    q: filter || undefined,
    enabled: expanded,
  });
  const agents = useMemo(() => agentsPage?.agents ?? EMPTY_AGENTS, [agentsPage?.agents]);
  const stats = useConfigurationStats(config.stats || !expanded ? undefined : config.id);
  const statsData = config.stats ?? stats.data;
  const insightSurface = insightSurfaces.portalAgent;
  const aggregateStatsReady = Boolean(config.stats) || (stats.isFetched && !stats.error);
  const model = useMemo(
    () =>
      buildAgentSectionModel({
        config,
        agents,
        stats: statsData,
        filter,
        expanded,
        isLoading,
        hasError: Boolean(error),
        aggregateStatsReady,
      }),
    [agents, aggregateStatsReady, config, error, expanded, filter, isLoading, statsData],
  );
  const {
    desiredHash,
    totalAgents,
    visibleAgents,
    connectedAgents,
    healthyAgents,
    degradedAgents,
    driftedAgents,
    hasSnapshotStats,
    hasDegradedStats,
    hasDriftStats,
    shouldRequestGuidance,
    guidanceContext,
    pageContext,
  } = model;
  const sectionId = `agents-${config.id}`;
  const filterId = `agents-filter-${config.id}`;
  const columns = useMemo(() => agentColumns(config.id, desiredHash), [config.id, desiredHash]);
  const guidanceTargets = useMemo(
    () => [
      insightTarget(insightSurface, {
        key: `agents.${config.id}.section`,
        label: `${config.name} agents`,
        kind: "section",
      }),
      insightTarget(insightSurface, {
        key: `agents.${config.id}.table`,
        label: `${config.name} agent table`,
        kind: "table",
      }),
    ],
    [config.id, config.name, insightSurface],
  );
  const guidanceRequest: AiGuidanceRequest | null =
    expanded && shouldRequestGuidance && !error && !isLoading && aggregateStatsReady && pageContext
      ? buildInsightRequest(insightSurface, guidanceTargets, guidanceContext, {
          intent: "triage_state",
          pageContext,
        })
      : null;
  const browserContext = useMemo(
    () => ({
      id: `portal.agents.${config.id}`,
      title: `${config.name} collectors`,
      surface: insightSurface.surface,
      context: guidanceContext,
      targets: guidanceTargets,
      pageContext: pageContext ?? undefined,
    }),
    [config.id, config.name, guidanceContext, guidanceTargets, insightSurface.surface, pageContext],
  );
  useRegisterBrowserContext(browserContext);
  const guidance = usePortalGuidance(guidanceRequest);
  const totalAgentsLabel = totalAgents !== null ? totalAgents.toLocaleString() : "—";
  const connectedAgentsLabel = connectedAgents !== null ? connectedAgents.toLocaleString() : "—";
  const healthyAgentsLabel = healthyAgents !== null ? healthyAgents.toLocaleString() : "—";
  const summaryText =
    expanded && totalAgents !== null && visibleAgents !== totalAgents
      ? `${visibleAgents} visible / ${totalAgents.toLocaleString()} total`
      : totalAgents !== null
        ? `${totalAgents.toLocaleString()} total`
        : expanded
          ? `${visibleAgents.toLocaleString()} visible`
          : "Metrics unavailable";

  return (
    <section className="mt-6 rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">{config.name}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{summaryText}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {expanded ? (
            <label className="grid gap-1">
              <span className="sr-only">Filter agents for {config.name}</span>
              <Input
                id={filterId}
                aria-label={`Filter agents for ${config.name}`}
                placeholder="Filter agents…"
                value={filter}
                onChange={(e) => setFilterAndResetCursor(e.target.value)}
              />
            </label>
          ) : null}
          <Button
            variant={expanded ? "ghost" : "secondary"}
            size="sm"
            aria-expanded={expanded}
            aria-controls={sectionId}
            onClick={onToggle}
          >
            {expanded ? "Hide collectors" : "View collectors"}
          </Button>
        </div>
      </div>

      {!expanded ? (
        <div id={sectionId} className="grid gap-4 p-4">
          <div
            className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]"
            aria-label={`${config.name} collector summary`}
          >
            <MetricCard label="Total" value={hasSnapshotStats ? totalAgentsLabel : "—"} />
            <MetricCard label="Connected" value={hasSnapshotStats ? connectedAgentsLabel : "—"} />
            <MetricCard label="Healthy" value={hasSnapshotStats ? healthyAgentsLabel : "—"} />
            {hasDegradedStats ? (
              <MetricCard
                label="Degraded"
                value={degradedAgents?.toLocaleString() ?? "—"}
                tone="warn"
              />
            ) : null}
            {hasDriftStats ? (
              <MetricCard
                label="Drifted"
                value={driftedAgents?.toLocaleString() ?? "—"}
                tone="warn"
              />
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {hasSnapshotStats
              ? "Summary uses the fleet metrics snapshot. Collector rows load only when you open this configuration."
              : "Metrics snapshot unavailable. Open this configuration to query its live agent page."}
          </p>
        </div>
      ) : (
        <div id={sectionId}>
          <GuidancePanel
            title={`${config.name} agents`}
            guidance={guidance.data}
            isLoading={guidance.isLoading}
            error={guidance.error}
            onRefresh={() => void guidance.refetch()}
          />
          {isLoading ? (
            <LoadingSpinner />
          ) : error ? (
            <ErrorState error={error} />
          ) : (
            <>
              <DataTable
                columns={columns}
                data={agents}
                getRowId={(agent) => agentUid(agent)}
                emptyState={
                  <EmptyState
                    icon="plug"
                    title={filter ? "No agents match your filter" : "No agents connected"}
                    description={
                      filter
                        ? "Clear the filter to see all collectors for this configuration."
                        : "Enroll a collector from the configuration page to start reporting status."
                    }
                  >
                    {!filter ? (
                      <Button asChild size="sm">
                        <Link to={`/portal/configurations/${config.id}`}>Enroll agent</Link>
                      </Button>
                    ) : null}
                  </EmptyState>
                }
              />
              <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 text-sm text-muted-foreground">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!cursor}
                  onClick={() => setCursor(undefined)}
                >
                  First page
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!agentsPage?.pagination?.has_more}
                  onClick={() => setCursor(agentsPage?.pagination?.next_cursor ?? undefined)}
                >
                  Next page
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function agentColumns(configId: string, desiredHash: string | null): ColumnDef<Agent>[] {
  return [
    {
      id: "instance_uid",
      header: "Instance UID",
      cell: ({ row }) => {
        const uid = agentUid(row.original);
        return (
          <Link
            className="font-mono text-xs text-foreground hover:text-primary"
            to={`/portal/agents/${configId}/${uid}`}
          >
            {uid}
          </Link>
        );
      },
    },
    {
      id: "hostname",
      header: "Hostname",
      cell: ({ row }) => agentHost(row.original),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = agentStatusView(row.original.status);
        return <StatusBadge tone={status.tone}>{status.label}</StatusBadge>;
      },
    },
    {
      id: "health",
      header: "Health",
      cell: ({ row }) => {
        const health = agentHealthView(row.original);
        return <StatusBadge tone={health.tone}>{health.label}</StatusBadge>;
      },
    },
    {
      id: "config_sync",
      header: "Config sync",
      cell: ({ row }) => {
        const sync = agentSyncView(row.original, desiredHash);
        return (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <StatusBadge tone={sync.tone}>{sync.label}</StatusBadge>
            <span className="font-mono text-xs text-muted-foreground">{sync.hashLabel}</span>
          </div>
        );
      },
    },
    {
      id: "last_seen",
      header: "Last seen",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {relTime(agentLastSeen(row.original))}
        </span>
      ),
    },
  ];
}

export default function AgentsPage() {
  const overview = useOverview();
  const [expandedConfigId, setExpandedConfigId] = useState<string | null>(null);

  if (overview.isLoading) return <LoadingSpinner />;
  if (overview.error)
    return <ErrorState error={overview.error} retry={() => void overview.refetch()} />;

  const cfgList = overview.data?.configurations ?? [];

  return (
    <PageShell width="wide">
      <PageHeader
        title="Collectors"
        description="Each row is one managed OpAMP agent identity for a running OpenTelemetry Collector. Status is connectivity; health is collector runtime state; drift is config hash mismatch."
      />

      {cfgList.length === 0 ? (
        <section className="rounded-md border border-border bg-card">
          <EmptyState
            icon="file"
            title="No configurations yet"
            description="Create a configuration first, then enroll collectors into it."
          >
            <Button asChild size="sm">
              <Link to="/portal/configurations">Create configuration</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/portal/getting-started">Guided setup</Link>
            </Button>
          </EmptyState>
        </section>
      ) : (
        cfgList.map((c) => (
          <AgentSection
            key={c.id}
            config={c}
            expanded={expandedConfigId === c.id}
            onToggle={() => setExpandedConfigId((current) => (current === c.id ? null : c.id))}
          />
        ))
      )}
    </PageShell>
  );
}
