import { Badge, Card, Group, SimpleGrid, Stack, Text, Title, Button } from "@mantine/core";
import type { MantineColor } from "@mantine/core";
import { useAdminHealth } from "../../api/hooks/admin";
import { EmptyState, MetricCard, PageHeader, PageShell } from "@/components/app";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { relTime } from "../../utils/format";
import type { HealthMetrics } from "./support-model";

const serviceLabels: Record<string, string> = {
  worker: "Worker / API",
  d1: "D1 Database",
  r2: "R2 Storage",
  durable_objects: "Durable Objects",
};

function statusColor(status: string): MantineColor {
  if (
    status === "healthy" ||
    status === "ok" ||
    status === "connected" ||
    status === "configured"
  ) {
    return "green";
  }
  if (
    status === "degraded" ||
    status === "write_only" ||
    status === "not_bound" ||
    status === "not_configured" ||
    status === "unavailable"
  ) {
    return "yellow";
  }
  return "red";
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge color={statusColor(status)} variant="light">
      {status}
    </Badge>
  );
}

function numberMetric(value: number | undefined): string {
  return typeof value === "number" ? value.toLocaleString() : "—";
}

const emptyHealthMetrics: HealthMetrics = {
  total_tenants: 0,
  total_configurations: 0,
  tenants_without_configurations: 0,
  configurations_without_agents: 0,
  total_users: 0,
  active_sessions: 0,
  impersonation_sessions: 0,
  active_tokens: 0,
  total_agents: 0,
  connected_agents: 0,
  disconnected_agents: 0,
  unknown_agents: 0,
  healthy_agents: 0,
  unhealthy_agents: 0,
  stale_agents: 0,
  last_agent_seen_at: null,
  latest_fleet_snapshot_at: null,
  latest_configuration_updated_at: null,
  plan_counts: {},
};

function planSummary(planCounts: Record<string, number> | undefined): string {
  const entries = Object.entries(planCounts ?? {});
  if (entries.length === 0) return "No tenants";
  return entries.map(([plan, count]) => `${plan}: ${numberMetric(count)}`).join(" / ");
}

function MetricRow({ children }: { children: React.ReactNode }) {
  return (
    <Group gap="xl" wrap="wrap">
      {children}
    </Group>
  );
}

function MetricItem({ value, label }: { value: string; label: string }) {
  return (
    <Stack gap={2}>
      <Text fw={600}>{value}</Text>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Stack>
  );
}

export default function HealthPage() {
  const { data, isLoading, error, refetch } = useAdminHealth();

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const checks = data?.checks ?? {};
  const metrics = data?.metrics ?? emptyHealthMetrics;
  const sources = data?.sources ?? {};
  const checkEntries = Object.entries(checks);
  const healthyChecks = checkEntries.filter(
    ([, check]) => check.status === "healthy" || check.status === "ok",
  ).length;
  const degradedChecks = checkEntries.filter(
    ([, check]) => check.status !== "healthy" && check.status !== "ok",
  );
  const timestamp = data?.timestamp;

  return (
    <PageShell width="wide">
      <PageHeader
        title="System Health"
        description="O11yFleet control-plane dependencies, fleet counters, and session state in one operator view."
        actions={
          <Button variant="subtle" size="sm" onClick={() => void refetch()}>
            Refresh
          </Button>
        }
      />

      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
        <MetricCard label="Overall status" value={data?.status ?? "unknown"} />
        <MetricCard
          label="Healthy checks"
          value={`${healthyChecks}/${checkEntries.length || "—"}`}
        />
        <MetricCard label="Connected collectors" value={numberMetric(metrics.connected_agents)} />
        <MetricCard label="Last checked" value={timestamp ? relTime(timestamp) : "—"} />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md" mt="md">
        <Card>
          <Title order={3} size="sm" fw={500}>
            O11yFleet app metrics
          </Title>
          <MetricRow>
            <MetricItem value={numberMetric(metrics.total_tenants)} label="tenants" />
            <MetricItem value={numberMetric(metrics.total_configurations)} label="configs" />
            <MetricItem value={numberMetric(metrics.total_agents)} label="collectors" />
            <MetricItem value={numberMetric(metrics.healthy_agents)} label="healthy collectors" />
            <MetricItem value={numberMetric(metrics.active_tokens)} label="active tokens" />
            <MetricItem value={numberMetric(metrics.active_sessions)} label="active sessions" />
          </MetricRow>
          <Text size="sm" c="dimmed" mt="md">
            Plan mix: {planSummary(metrics.plan_counts)}. Latest config update:{" "}
            {relTime(metrics.latest_configuration_updated_at)}.
          </Text>
        </Card>

        <Card>
          <Title order={3} size="sm" fw={500}>
            Operator attention
          </Title>
          {degradedChecks.length === 0 ? (
            <Text size="sm" c="dimmed" mt="xs">
              No degraded control-plane dependencies reported.
            </Text>
          ) : (
            <Stack gap="xs" mt="xs">
              {degradedChecks.map(([key, check]) => (
                <Group key={key} justify="space-between" wrap="nowrap">
                  <Stack gap={2}>
                    <Text size="sm" fw={500}>
                      {serviceLabels[key] ?? key}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {check.error ?? check.detail ?? "Needs attention"}
                    </Text>
                  </Stack>
                  <StatusBadge status={check.status ?? "unknown"} />
                </Group>
              ))}
            </Stack>
          )}
          <Text size="sm" c="dimmed" mt="md">
            Latest fleet metrics snapshot:{" "}
            {relTime(metrics.latest_fleet_snapshot_at ?? metrics.last_agent_seen_at)}
          </Text>
          <Text size="sm" c="dimmed" mt={4}>
            Active impersonation sessions: {numberMetric(metrics.impersonation_sessions)}
          </Text>
        </Card>

        <Card>
          <Title order={3} size="sm" fw={500}>
            Fleet gaps
          </Title>
          <MetricRow>
            <MetricItem value={numberMetric(metrics.disconnected_agents)} label="disconnected" />
            <MetricItem value={numberMetric(metrics.unknown_agents)} label="unknown status" />
            <MetricItem value={numberMetric(metrics.unhealthy_agents)} label="unhealthy" />
            <MetricItem value={numberMetric(metrics.stale_agents)} label="stale heartbeats" />
            <MetricItem
              value={numberMetric(metrics.tenants_without_configurations)}
              label="tenants without configs"
            />
            <MetricItem
              value={numberMetric(metrics.configurations_without_agents)}
              label="configs without collectors"
            />
          </MetricRow>
        </Card>

        <Card>
          <Title order={3} size="sm" fw={500}>
            Data sources
          </Title>
          {Object.keys(sources).length === 0 ? (
            <Text size="sm" c="dimmed" mt="xs">
              No source metadata reported.
            </Text>
          ) : (
            <Stack gap="xs" mt="xs">
              {Object.entries(sources).map(([key, source]) => (
                <Group key={key} justify="space-between" wrap="nowrap">
                  <Stack gap={2}>
                    <Text size="sm" fw={500}>
                      {key.replaceAll("_", " ")}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {source.detail ?? "No detail reported."}
                    </Text>
                  </Stack>
                  <StatusBadge status={source.status ?? "unknown"} />
                </Group>
              ))}
            </Stack>
          )}
          <Text size="sm" c="dimmed" mt="md">
            Cloudflare billing, account usage, Worker invocation analytics, and Analytics Engine
            queries are not included unless we add account credentials and API calls.
          </Text>
        </Card>
      </SimpleGrid>

      <Title order={3} size="sm" fw={500} mt="xl" mb="md">
        Service checks
      </Title>
      {Object.keys(checks).length === 0 ? (
        <Card>
          <EmptyState
            icon="activity"
            title="No health checks reported"
            description="Service health checks will appear here when the worker reports them."
          />
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
          {checkEntries.map(([key, check]) => (
            <Card key={key}>
              <Group justify="space-between" align="center">
                <Title order={4} size="sm" fw={500}>
                  {serviceLabels[key] ?? key}
                </Title>
                <StatusBadge status={check.status ?? "unknown"} />
              </Group>
              <Text size="lg" fw={600} mt="sm">
                {check.latency_ms !== null && check.latency_ms !== undefined
                  ? `${check.latency_ms}ms`
                  : "N/A"}
              </Text>
              <Text size="xs" c="dimmed" mt={4}>
                {check.detail ?? "No extra detail reported."}
              </Text>
              {check.error ? (
                <Text size="xs" c="red" mt={4}>
                  {check.error}
                </Text>
              ) : null}
            </Card>
          ))}
        </SimpleGrid>
      )}
    </PageShell>
  );
}
