import { Link } from "react-router-dom";
import { Button, Card, Group, Progress, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useOverview, useTenant } from "@/api/hooks/portal";
import { PageHeader, PageShell, StatusBadge } from "@/components/app";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { buildBillingView } from "./billing-model";

export default function BillingPage() {
  const tenant = useTenant();
  const overview = useOverview();

  if (tenant.isLoading || overview.isLoading) return <LoadingSpinner />;
  if (tenant.error) return <ErrorState error={tenant.error} retry={() => void tenant.refetch()} />;
  if (overview.error)
    return <ErrorState error={overview.error} retry={() => void overview.refetch()} />;

  const view = buildBillingView(tenant.data, overview.data);

  return (
    <PageShell width="wide">
      <PageHeader title="Billing" />

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Card>
          <Title order={3} size="sm" fw={500}>
            Current plan
          </Title>
          <Group mt="md">
            <StatusBadge tone="info">{view.planLabel}</StatusBadge>
          </Group>

          <Stack gap={6} mt="lg">
            <Group justify="space-between" gap="xs">
              <Text size="sm">Configurations</Text>
              <Text size="sm" c="dimmed" ff="monospace">
                {view.usedConfigs} / {view.maxConfigsLabel}
              </Text>
            </Group>
            <Progress
              value={view.configPct}
              aria-label={`${view.usedConfigs} of ${view.maxConfigsLabel} configurations used`}
            />
          </Stack>

          <Group justify="space-between" gap="xs" mt="lg">
            <Text size="sm">Collectors</Text>
            <Text size="sm" c="dimmed" ff="monospace">
              {view.totalAgents}
            </Text>
          </Group>

          <Group mt="lg">
            <Button component={Link} to="/pricing" variant="subtle" size="sm">
              Compare plans
            </Button>
          </Group>
        </Card>

        <Card>
          <Title order={3} size="sm" fw={500}>
            Control mode
          </Title>
          <Text size="sm" c="dimmed" mt="xs">
            Plans gate quotas and control-plane behavior: retained history, rollback, rollout
            safety, automation, team roles, audit export, and governance controls.
          </Text>
          <Group mt="md">
            <StatusBadge tone={view.stateful ? "ok" : "warn"}>
              {view.stateful ? "stateful operations enabled" : "stateless fleet management"}
            </StatusBadge>
          </Group>
        </Card>

        <Card>
          <Title order={3} size="sm" fw={500}>
            Billing information
          </Title>
          <Text size="sm" c="dimmed" mt="xs">
            Billing management is not yet available. Contact support to update your plan or payment
            details.
          </Text>
        </Card>
      </SimpleGrid>
    </PageShell>
  );
}
