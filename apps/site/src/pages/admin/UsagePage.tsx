import { useMemo } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Group,
  List,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { MantineColor } from "@mantine/core";
import { useAdminUsage, type AdminUsageService } from "../../api/hooks/admin";
import { useAdminGuidance } from "../../api/hooks/ai";
import { buildInsightRequest, insightSurfaces, insightTarget } from "../../ai/insight-registry";
import { useRegisterBrowserContext } from "../../ai/browser-context-react";
import { buildBrowserPageContext, pageMetric, pageTable } from "../../ai/page-context";
import { GuidancePanel, GuidanceSlot } from "../../components/ai";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { MetricCard, PageHeader, PageShell } from "@/components/app";
import { relTime } from "../../utils/format";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";

function money(value: number | undefined): string {
  return `$${(value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}

function numberMetric(value: number | undefined): string {
  return typeof value === "number" ? value.toLocaleString() : "-";
}

function statusColor(status: AdminUsageService["status"]): MantineColor {
  if (status === "ready") return "green";
  if (status === "not_configured") return "yellow";
  return "red";
}

function StatusBadge({ status }: { status: AdminUsageService["status"] }) {
  return (
    <Badge color={statusColor(status)} variant="light">
      {status.replace("_", " ")}
    </Badge>
  );
}

function mainUnit(service: AdminUsageService): string {
  const first = service.line_items[0];
  if (first) return `${numberMetric(first.quantity)} ${first.unit}`;
  const dailyUnits = service.daily.flatMap((day) => Object.values(day.units));
  const total = dailyUnits.reduce((sum, value) => sum + value, 0);
  return total > 0 ? numberMetric(total) : "No usage";
}

function maxDailySpend(service: AdminUsageService): number {
  return Math.max(0.01, ...service.daily.map((day) => day.estimated_spend_usd));
}

function DailyBars({ service }: { service: AdminUsageService }) {
  const max = maxDailySpend(service);
  if (service.daily.length === 0) {
    return (
      <Text size="sm" c="dimmed" mt="md">
        Daily usage appears here once this source is configured.
      </Text>
    );
  }
  return (
    <Group
      gap={4}
      mt="md"
      align="flex-end"
      aria-label={`${service.name} daily estimated spend`}
      style={{ minHeight: 96 }}
    >
      {service.daily.map((day) => (
        <Box
          key={day.date}
          tabIndex={0}
          aria-label={`${day.date}: ${money(day.estimated_spend_usd)}`}
          title={`${day.date}: ${money(day.estimated_spend_usd)}`}
          style={{
            width: 18,
            height: `${Math.max(8, (day.estimated_spend_usd / max) * 96)}px`,
            background: "var(--mantine-color-blue-6)",
            borderRadius: 2,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            color: "white",
            fontSize: 10,
            paddingBottom: 2,
          }}
        >
          {new Date(`${day.date}T00:00:00Z`).getUTCDate()}
        </Box>
      ))}
    </Group>
  );
}

function ServiceCard({ service }: { service: AdminUsageService }) {
  return (
    <Card>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={2}>
          <Title order={3} size="sm" fw={500}>
            {service.name}
          </Title>
          <Text size="xs" c="dimmed">
            {service.source}
          </Text>
        </Stack>
        <StatusBadge status={service.status} />
      </Group>

      <Group gap="xl" wrap="wrap" mt="md">
        <Stack gap={2}>
          <Text fw={600}>{mainUnit(service)}</Text>
          <Text size="xs" c="dimmed">
            month-to-date usage
          </Text>
        </Stack>
        <Stack gap={2}>
          <Text fw={600}>{money(service.month_to_date_estimated_spend_usd)}</Text>
          <Text size="xs" c="dimmed">
            month-to-date estimate
          </Text>
        </Stack>
        <Stack gap={2}>
          <Text fw={600}>{money(service.projected_month_estimated_spend_usd)}</Text>
          <Text size="xs" c="dimmed">
            month projection
          </Text>
        </Stack>
      </Group>

      <DailyBars service={service} />

      {service.error ? (
        <Alert color="red" variant="light" mt="md">
          {service.error}
        </Alert>
      ) : null}

      {service.line_items.length > 0 ? (
        <Stack gap="xs" mt="md">
          {service.line_items.map((item) => (
            <Group key={item.label} justify="space-between" wrap="nowrap">
              <Stack gap={0}>
                <Text size="sm" fw={500}>
                  {item.label}
                </Text>
                <Text size="xs" c="dimmed">
                  {numberMetric(item.quantity)} {item.unit} / {numberMetric(item.included)} included
                </Text>
              </Stack>
              <Stack gap={0} align="flex-end">
                <Text size="sm" fw={500}>
                  {money(item.estimated_spend_usd)}
                </Text>
                <Text size="xs" c="dimmed">
                  {numberMetric(item.billable)} billable
                </Text>
              </Stack>
            </Group>
          ))}
        </Stack>
      ) : null}

      {service.notes.length > 0 ? (
        <List size="sm" c="dimmed" mt="md">
          {service.notes.map((note, index) => (
            <List.Item key={`${note}-${index}`}>{note}</List.Item>
          ))}
        </List>
      ) : null}
    </Card>
  );
}

export default function UsagePage() {
  const { data, isLoading, error, refetch } = useAdminUsage();
  const readyServices = useMemo(
    () => data?.services.filter((service) => service.status === "ready").length ?? 0,
    [data?.services],
  );
  const insightSurface = insightSurfaces.adminUsage;
  const pageContext = useMemo(
    () =>
      data
        ? buildBrowserPageContext({
            title: "Usage and spend",
            visible_text: [
              "Usage and spend estimates come from usage metrics and explicit pricing assumptions, not lagging Cloudflare billing totals.",
            ],
            metrics: [
              pageMetric(
                "month_to_date_estimated_spend_usd",
                "Month-to-date estimate",
                data.month_to_date_estimated_spend_usd,
                { unit: "USD" },
              ),
              pageMetric(
                "projected_month_estimated_spend_usd",
                "Projected month",
                data.projected_month_estimated_spend_usd,
                { unit: "USD" },
              ),
              pageMetric("ready_usage_sources", "Ready usage sources", readyServices),
              pageMetric("total_usage_sources", "Total usage sources", data.services.length),
              pageMetric("required_env_count", "Required env vars", data.required_env.length),
            ],
            tables: [
              pageTable(
                "usage_services",
                "Usage services",
                data.services.map((service) => ({
                  id: service.id,
                  name: service.name,
                  status: service.status,
                  source: service.source,
                  month_to_date_estimated_spend_usd: service.month_to_date_estimated_spend_usd,
                  projected_month_estimated_spend_usd: service.projected_month_estimated_spend_usd,
                  line_items: service.line_items.length,
                  notes: service.notes.length,
                })),
                { totalRows: data.services.length },
              ),
            ],
          })
        : null,
    [data, readyServices],
  );
  const guidanceRequest: AiGuidanceRequest | null =
    data && pageContext
      ? buildInsightRequest(
          insightSurface,
          [
            insightTarget(insightSurface, insightSurface.targets.page),
            insightTarget(insightSurface, insightSurface.targets.spend, {
              projected_month_estimated_spend_usd: data.projected_month_estimated_spend_usd,
            }),
            insightTarget(insightSurface, insightSurface.targets.sources, {
              ready_usage_sources: readyServices,
              total_usage_sources: data.services.length,
            }),
            insightTarget(insightSurface, insightSurface.targets.services),
          ],
          {
            month_to_date_estimated_spend_usd: data.month_to_date_estimated_spend_usd,
            projected_month_estimated_spend_usd: data.projected_month_estimated_spend_usd,
            ready_usage_sources: readyServices,
            total_usage_sources: data.services.length,
            required_env_count: data.required_env.length,
            configured: data.configured,
          },
          { intent: "triage_state", pageContext },
        )
      : null;
  const browserContext = useMemo(
    () => ({
      id: "admin.usage.page",
      title: "Usage and spend",
      surface: insightSurface.surface,
      context: guidanceRequest?.context ?? {},
      targets: guidanceRequest?.targets ?? [],
      pageContext: guidanceRequest?.page_context ?? undefined,
    }),
    [
      guidanceRequest?.context,
      guidanceRequest?.page_context,
      guidanceRequest?.targets,
      insightSurface.surface,
    ],
  );
  useRegisterBrowserContext(guidanceRequest ? browserContext : null);
  const guidance = useAdminGuidance(guidanceRequest);
  const spendInsight = guidance.data?.items.find(
    (item) => item.target_key === "admin.usage.spend" || item.target_key === "admin.usage.page",
  );
  const sourceInsight = guidance.data?.items.find(
    (item) => item.target_key === "admin.usage.sources",
  );

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;
  if (!data) return null;

  return (
    <PageShell width="wide">
      <PageHeader
        title="Usage & Spend"
        description="Daily Cloudflare usage, estimated month-to-date spend, and projected monthly cost for the services O11yFleet relies on."
        actions={
          <Button variant="subtle" size="sm" onClick={() => void refetch()}>
            Refresh
          </Button>
        }
      />

      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
        <MetricCard
          label="Month-to-date estimate"
          value={money(data.month_to_date_estimated_spend_usd)}
        >
          <GuidanceSlot item={spendInsight} loading={guidance.isLoading} />
        </MetricCard>
        <MetricCard
          label="Projected month"
          value={money(data.projected_month_estimated_spend_usd)}
        />
        <MetricCard
          label="Days measured"
          value={`${data.window.days_elapsed}/${data.window.days_in_month}`}
        />
        <MetricCard label="Sources connected" value={`${readyServices}/${data.services.length}`}>
          <GuidanceSlot item={sourceInsight} loading={guidance.isLoading} />
        </MetricCard>
      </SimpleGrid>

      <GuidancePanel
        title="Usage guidance"
        guidance={guidance.data}
        isLoading={guidance.isLoading}
        error={guidance.error}
        onRefresh={() => void guidance.refetch()}
        excludeTargetKeys={["admin.usage.spend", "admin.usage.sources"]}
      />

      <Alert
        color="blue"
        variant="light"
        title="Estimated from usage metrics, not Cloudflare billing totals"
        mt="md"
      >
        Cloudflare usage-based billing can lag and may omit usage still inside included allowances.
        This page queries usage surfaces directly and applies explicit pricing/free tier assumptions
        so $0 free-tier usage still shows up as usage.
      </Alert>

      {data.required_env.length > 0 ? (
        <Card mt="md">
          <Title order={3} size="sm" fw={500}>
            Configuration needed
          </Title>
          <Text size="sm" c="dimmed" mt="xs">
            Add these Worker secrets/vars to enable live Cloudflare usage queries:
          </Text>
          <Group gap="xs" mt="sm" wrap="wrap">
            {data.required_env.map((key) => (
              <Code key={key}>{key}</Code>
            ))}
          </Group>
        </Card>
      ) : null}

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md" mt="md">
        {data.services.map((service) => (
          <ServiceCard key={service.id} service={service} />
        ))}
      </SimpleGrid>

      <Card mt="md">
        <Title order={3} size="sm" fw={500}>
          Pricing assumptions
        </Title>
        <Text size="sm" c="dimmed" mt="xs">
          {data.pricing.source}
        </Text>
        <List size="sm" c="dimmed" mt="sm">
          {data.pricing.notes.map((note, index) => (
            <List.Item key={`${note}-${index}`}>{note}</List.Item>
          ))}
        </List>
        <Text size="sm" c="dimmed" mt="md">
          Generated {relTime(data.generated_at)}
        </Text>
      </Card>
    </PageShell>
  );
}
