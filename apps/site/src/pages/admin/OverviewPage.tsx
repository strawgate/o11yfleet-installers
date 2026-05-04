import { Link } from "react-router";
import { useMemo } from "react";
import { Badge, Button, Card, Group, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { useAdminHealth, useAdminOverview, useAdminTenantsPage } from "../../api/hooks/admin";
import { useAdminGuidance } from "../../api/hooks/ai";
import { GuidancePanel, GuidanceSlot } from "../../components/ai";
import { EmptyState, MetricCard, PageHeader, PageShell } from "@/components/app";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { PlanTag } from "@/components/common/PlanTag";
import { relTime } from "../../utils/format";
import { buildInsightRequest, insightSurfaces, insightTarget } from "../../ai/insight-registry";
import { useRegisterBrowserContext } from "../../ai/browser-context-react";
import { buildBrowserPageContext, pageMetric, pageTable } from "../../ai/page-context";
import { buildAdminAiOverviewContext } from "./ai-context-utils";
import { normalizePlanId } from "../../shared/plans";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";

export default function OverviewPage() {
  const overview = useAdminOverview();
  const tenants = useAdminTenantsPage({ page: 1, limit: 25, sort: "newest" });
  const health = useAdminHealth();
  const ov = overview.data;
  const tenantList = useMemo(() => tenants.data?.tenants ?? [], [tenants.data]);
  const tenantPagination = tenants.data?.pagination;
  const totalTenants = ov?.total_tenants ?? tenantList.length;
  const totalConfigs = ov?.total_configurations ?? 0;
  const totalAgents = ov?.total_agents ?? 0;
  const healthStatus = health.data?.status ?? "unknown";

  const planCounts: Record<string, number> = {};
  for (const t of tenantList) {
    const plan = normalizePlanId(t.plan);
    planCounts[plan] = (planCounts[plan] ?? 0) + 1;
  }

  const recentTenants = [...tenantList]
    .sort((a, b) => {
      const da = a.created_at ?? "";
      const db = b.created_at ?? "";
      return db.localeCompare(da);
    })
    .slice(0, 5);
  const adminAiContext = buildAdminAiOverviewContext(tenantList, totalTenants, totalConfigs);

  const insightSurface = insightSurfaces.adminOverview;
  const pageContext = useMemo(
    () =>
      overview.data && tenants.data && health.data
        ? buildBrowserPageContext({
            title: "Admin overview",
            visible_text: [
              "Admin overview summarizes platform tenants, configurations, collectors, and dependency health.",
            ],
            metrics: [
              pageMetric("total_tenants", "Total tenants", totalTenants),
              pageMetric("total_configurations", "Total configurations", totalConfigs),
              pageMetric("total_agents", "Total agents", totalAgents),
              pageMetric(
                "tenants_without_configs",
                "Tenants without configurations",
                tenantList.filter((tenant) => ((tenant["config_count"] as number) ?? 0) === 0)
                  .length,
              ),
            ],
            details: [{ key: "health_status", label: "System health", value: healthStatus }],
            tables: [
              pageTable(
                "recent_tenants",
                "Recent tenants",
                recentTenants.map((tenant) => ({
                  id: tenant.id,
                  plan: normalizePlanId(tenant.plan),
                  config_count: tenant["config_count"] ?? null,
                  user_count: tenant["user_count"] ?? null,
                  created_at: tenant.created_at ?? null,
                })),
                { totalRows: tenantList.length },
              ),
            ],
          })
        : null,
    [
      overview.data,
      tenants.data,
      health.data,
      totalTenants,
      totalConfigs,
      totalAgents,
      healthStatus,
      recentTenants,
      tenantList,
    ],
  );
  const guidanceRequest: AiGuidanceRequest | null =
    overview.data && tenants.data && health.data && pageContext
      ? buildInsightRequest(
          insightSurface,
          [
            insightTarget(insightSurface, insightSurface.targets.page),
            insightTarget(insightSurface, insightSurface.targets.tenants),
            insightTarget(insightSurface, insightSurface.targets.configurations),
            insightTarget(insightSurface, insightSurface.targets.agents),
            insightTarget(insightSurface, insightSurface.targets.recentTenants),
          ],
          {
            total_tenants: totalTenants,
            total_configurations: totalConfigs,
            total_agents: totalAgents,
            health_status: healthStatus,
            plan_distribution: planCounts,
            tenants_without_configs: tenantList.filter(
              (tenant) => ((tenant["config_count"] as number) ?? 0) === 0,
            ).length,
            tenants_without_users: tenantList.filter(
              (tenant) => ((tenant["user_count"] as number) ?? 0) === 0,
            ).length,
            ...adminAiContext,
            recent_tenants: recentTenants.map((tenant) => ({
              id: tenant.id,
              name: tenant.name,
              plan: normalizePlanId(tenant.plan),
              max_configs: tenant["max_configs"] ?? null,
              max_agents_per_config: tenant["max_agents_per_config"] ?? null,
              created_at: tenant.created_at ?? null,
            })),
          },
          { intent: "triage_state", pageContext },
        )
      : null;
  const browserContext = useMemo(
    () => ({
      id: "admin.overview.page",
      title: "Admin overview",
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
  const tenantInsight = guidance.data?.items.find(
    (item) => item.target_key === "admin.overview.tenants",
  );
  const configInsight = guidance.data?.items.find(
    (item) => item.target_key === "admin.overview.configs",
  );
  const agentInsight = guidance.data?.items.find(
    (item) => item.target_key === "admin.overview.agents",
  );

  if (overview.isLoading || tenants.isLoading || health.isLoading) return <LoadingSpinner />;
  if (overview.error)
    return <ErrorState error={overview.error} retry={() => void overview.refetch()} />;
  if (tenants.error)
    return <ErrorState error={tenants.error} retry={() => void tenants.refetch()} />;
  if (health.error) return <ErrorState error={health.error} retry={() => void health.refetch()} />;

  return (
    <PageShell width="wide">
      <PageHeader
        title="Admin Overview"
        actions={
          <Button component={Link} to="/admin/health" variant="subtle" size="sm">
            System health
          </Button>
        }
      />

      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
        <MetricCard
          label={
            ov?.total_tenants !== undefined
              ? "Total tenants"
              : `Tenants in page ${tenantPagination?.page ?? 1}`
          }
          value={String(totalTenants)}
        >
          <GuidanceSlot item={tenantInsight} loading={guidance.isLoading} />
        </MetricCard>
        <MetricCard label="Total configs" value={String(totalConfigs)}>
          <GuidanceSlot item={configInsight} loading={guidance.isLoading} />
        </MetricCard>
        <MetricCard label="Total agents" value={String(totalAgents)}>
          <GuidanceSlot item={agentInsight} loading={guidance.isLoading} />
        </MetricCard>
        <Card>
          <Stack gap={4}>
            <Badge
              color={healthStatus === "healthy" || healthStatus === "ok" ? "green" : "yellow"}
              variant="light"
              size="lg"
            >
              {healthStatus}
            </Badge>
            <Text size="xs" c="dimmed">
              System health
            </Text>
          </Stack>
        </Card>
      </SimpleGrid>

      <GuidancePanel
        title="Platform operations"
        guidance={guidance.data}
        isLoading={guidance.isLoading}
        error={guidance.error}
        onRefresh={() => void guidance.refetch()}
        excludeTargetKeys={[
          "admin.overview.tenants",
          "admin.overview.configs",
          "admin.overview.agents",
        ]}
      />

      <SimpleGrid
        cols={{ base: 1, lg: 2 }}
        spacing="md"
        mt="md"
        style={{ gridTemplateColumns: "1.2fr 1fr" }}
      >
        <Card>
          <Group justify="space-between" align="center" mb="sm">
            <Title order={3} fw={500} style={{ fontSize: "16px", letterSpacing: "-0.01em" }}>
              Recent tenants
            </Title>
            <Button component={Link} to="/admin/tenants" variant="subtle" size="xs">
              View all
            </Button>
          </Group>
          {recentTenants.length === 0 ? (
            <EmptyState
              icon="users"
              title="No tenants yet"
              description="Create a tenant to start configuring workspaces and enrollment policy."
            >
              <Button component={Link} to="/admin/tenants" size="sm">
                Create tenant
              </Button>
            </EmptyState>
          ) : (
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Plan</Table.Th>
                  <Table.Th>Policy limit</Table.Th>
                  <Table.Th>Collector limit</Table.Th>
                  <Table.Th>Created</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {recentTenants.map((t) => (
                  <Table.Tr key={t.id}>
                    <Table.Td>
                      <Link to={`/admin/tenants/${t.id}`}>{t.name}</Link>
                    </Table.Td>
                    <Table.Td>
                      <PlanTag plan={t.plan ?? "starter"} />
                    </Table.Td>
                    <Table.Td>{(t["max_configs"] as number) ?? "—"}</Table.Td>
                    <Table.Td>{(t["max_agents_per_config"] as number) ?? "—"}</Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {relTime(t.created_at)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Card>

        <Card>
          <Title order={3} fw={500} style={{ fontSize: "16px", letterSpacing: "-0.01em" }} mb="sm">
            Plan distribution
          </Title>
          {Object.keys(planCounts).length === 0 ? (
            <EmptyState
              icon="activity"
              title="No plan data"
              description="Plan distribution appears after tenants are created."
            />
          ) : (
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Plan</Table.Th>
                  <Table.Th>Tenants</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {Object.entries(planCounts).map(([plan, count]) => (
                  <Table.Tr key={plan}>
                    <Table.Td>
                      <PlanTag plan={plan} />
                    </Table.Td>
                    <Table.Td>{count}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Card>
      </SimpleGrid>
    </PageShell>
  );
}
