import { useMemo, useState } from "react";
import { Link } from "react-router";
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
import { Anchor, Box, Button, Card, Group, Stack, Text, TextInput } from "@mantine/core";
import { EmptyState, MetricCard, PageHeader, PageShell, StatusBadge } from "@/components/app";
import { DataTable, type ColumnDef } from "@/components/data-table";
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
  // `null` = first page (DataTable cursor convention).
  const [cursor, setCursor] = useState<string | null>(null);
  const setFilterAndResetCursor = (next: string) => {
    setFilter(next);
    setCursor(null);
  };
  const {
    data: agentsPage,
    isLoading,
    error,
  } = useConfigurationAgents(config.id, {
    limit: 50,
    cursor: cursor ?? undefined,
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

  // `nextCursor` undefined = no next page (Next button disabled).
  // `previousCursor` null = "Prev jumps to first page"; we don't keep a
  // back-stack so this is the honest semantics for a forward-only cursor.
  const nextCursor = agentsPage?.pagination?.has_more
    ? (agentsPage.pagination.next_cursor ?? null)
    : undefined;
  const previousCursor: string | null | undefined = cursor !== null ? null : undefined;

  return (
    <Card component="section" withBorder mt="md" p={0}>
      <Group
        justify="space-between"
        gap="sm"
        wrap="wrap"
        px="md"
        py="sm"
        style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
      >
        <Stack gap={2}>
          <Text size="sm" fw={500} component="h3">
            {config.name}
          </Text>
          <Text size="xs" c="dimmed">
            {summaryText}
          </Text>
        </Stack>
        <Group gap="xs" wrap="wrap">
          {expanded ? (
            <TextInput
              id={filterId}
              aria-label={`Filter agents for ${config.name}`}
              placeholder="Filter agents…"
              value={filter}
              onChange={(e) => setFilterAndResetCursor(e.currentTarget.value)}
              size="sm"
            />
          ) : null}
          <Button
            variant={expanded ? "subtle" : "default"}
            size="sm"
            aria-expanded={expanded}
            aria-controls={sectionId}
            onClick={onToggle}
          >
            {expanded ? "Hide agents" : "View agents"}
          </Button>
        </Group>
      </Group>

      {!expanded ? (
        <Stack id={sectionId} p="md" gap="md">
          <Box
            aria-label={`${config.name} collector summary`}
            style={{
              display: "grid",
              gap: "var(--mantine-spacing-sm)",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            }}
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
          </Box>
          <Text size="sm" c="dimmed">
            {hasSnapshotStats
              ? "Summary uses the fleet metrics snapshot. Collector rows load only when you open this configuration."
              : "Metrics snapshot unavailable. Open this configuration to query its live agent page."}
          </Text>
        </Stack>
      ) : (
        <Box id={sectionId}>
          <GuidancePanel
            title={`${config.name} agents`}
            guidance={guidance.data}
            isLoading={guidance.isLoading}
            error={guidance.error}
            onRefresh={() => void guidance.refetch()}
          />
          <DataTable
            columns={columns}
            data={agents}
            getRowId={(agent) => agentUid(agent)}
            // Cursor mode — DataTable renders its own Prev/Next; the legacy
            // First Page / Next Page buttons are gone.
            cursor={cursor}
            nextCursor={nextCursor}
            previousCursor={previousCursor}
            hasNextPage={Boolean(agentsPage?.pagination?.has_more)}
            onCursorChange={(next) => setCursor(next)}
            // Loading / error states are owned by the table chrome now —
            // no separate LoadingSpinner / ErrorState wrappers.
            loading={isLoading}
            error={error ? { message: error.message } : null}
            ariaLabel={`${config.name} agents`}
            empty={
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
                  <Button component={Link} to={`/portal/configurations/${config.id}`} size="sm">
                    Enroll agent
                  </Button>
                ) : null}
              </EmptyState>
            }
          />
        </Box>
      )}
    </Card>
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
          <Anchor
            component={Link}
            to={`/portal/agents/${configId}/${uid}`}
            size="xs"
            ff="monospace"
          >
            {uid}
          </Anchor>
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
          <Group gap="xs" wrap="wrap" miw={0}>
            <StatusBadge tone={sync.tone}>{sync.label}</StatusBadge>
            <Text size="xs" c="dimmed" ff="monospace">
              {sync.hashLabel}
            </Text>
          </Group>
        );
      },
    },
    {
      id: "last_seen",
      header: "Last seen",
      cell: ({ row }) => (
        <Text size="sm" c="dimmed">
          {relTime(agentLastSeen(row.original))}
        </Text>
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
        title="Agents"
        description="Each row is one managed OpAMP agent identity for a running OpenTelemetry Collector. Status is connectivity; health is collector runtime state; drift is config hash mismatch."
      />

      {cfgList.length === 0 ? (
        <Card component="section" withBorder>
          <EmptyState
            icon="file"
            title="No configurations yet"
            description="Create a configuration first, then enroll collectors into it."
          >
            <Button component={Link} to="/portal/configurations" size="sm">
              Create configuration
            </Button>
            <Button component={Link} to="/portal/getting-started" variant="subtle" size="sm">
              Guided setup
            </Button>
          </EmptyState>
        </Card>
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
