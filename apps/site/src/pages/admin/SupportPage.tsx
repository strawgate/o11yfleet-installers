import { useDeferredValue, useState } from "react";
import { Link } from "react-router";
import {
  Badge,
  Button,
  Card,
  Code,
  Group,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import type { MantineColor } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAdminHealth, useAdminTenantsPage } from "../../api/hooks/admin";
import { EmptyState, PageHeader, PageShell } from "@/components/app";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { PlanTag } from "@/components/common/PlanTag";
import { SYMPTOMS, buildSupportBrief, healthLabel, healthTone } from "./support-model";

function toneToColor(tone: string): MantineColor {
  if (tone === "ok") return "green";
  if (tone === "warn") return "yellow";
  if (tone === "error") return "red";
  return "gray";
}

export default function SupportPage() {
  const [tenantQuery, setTenantQuery] = useState("");
  const deferredTenantQuery = useDeferredValue(tenantQuery);
  const tenantsQuery = useAdminTenantsPage({
    q: deferredTenantQuery,
    page: 1,
    limit: 25,
    sort: "name_asc",
  });
  const healthQuery = useAdminHealth();

  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [selectedSymptomId, setSelectedSymptomId] = useState(SYMPTOMS[0]?.id ?? "");

  const tenants = tenantsQuery.data?.tenants ?? [];
  const tenantPagination = tenantsQuery.data?.pagination;
  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId) ?? null;
  const selectedSymptom =
    SYMPTOMS.find((symptom) => symptom.id === selectedSymptomId) ?? SYMPTOMS[0] ?? null;
  const health = healthQuery.data;
  const healthChecks = health?.checks ?? {};

  if (tenantsQuery.isLoading || healthQuery.isLoading) return <LoadingSpinner />;
  if (tenantsQuery.error)
    return <ErrorState error={tenantsQuery.error} retry={() => void tenantsQuery.refetch()} />;
  if (healthQuery.error)
    return <ErrorState error={healthQuery.error} retry={() => void healthQuery.refetch()} />;
  if (!selectedSymptom) {
    return <ErrorState error={new Error("No symptoms configured")} />;
  }

  const supportBrief = buildSupportBrief({
    tenant: selectedTenant,
    symptom: selectedSymptom,
    health,
  });

  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(supportBrief);
      notifications.show({ message: "Copied support brief", color: "green" });
    } catch {
      notifications.show({
        title: "Copy failed",
        message: "Clipboard access is blocked in this browser context.",
        color: "red",
      });
    }
  }

  return (
    <PageShell width="wide">
      <PageHeader
        title="Support cockpit"
        description="Tenant-scoped starting point for symptom-first support triage. Pick the customer pain first, then jump to the admin screen that can confirm it."
        actions={
          <Button variant="subtle" size="sm" onClick={() => void healthQuery.refetch()}>
            Refresh health
          </Button>
        }
      />

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Card>
          <Title order={3} size="sm" fw={500}>
            1. Select tenant
          </Title>
          <TextInput
            mt="md"
            label="Search by tenant name or ID"
            value={tenantQuery}
            onChange={(event) => setTenantQuery(event.currentTarget.value)}
            placeholder="acme, tenant id"
          />

          <ScrollArea.Autosize mah={320} mt="md">
            {tenants.length === 0 ? (
              <EmptyState
                icon="search"
                title="No tenant matches"
                description="Try a broader name or clear the search term."
              />
            ) : (
              <Stack gap="xs">
                {tenants.map((tenant) => {
                  const isSelected = selectedTenant?.id === tenant.id;
                  return (
                    <UnstyledButton
                      key={tenant.id}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedTenantId(tenant.id)}
                      p="sm"
                      style={{
                        borderRadius: "var(--mantine-radius-md)",
                        border: isSelected
                          ? "1px solid var(--mantine-color-blue-6)"
                          : "1px solid var(--mantine-color-default-border)",
                        background: isSelected ? "var(--mantine-color-blue-light)" : "transparent",
                      }}
                    >
                      <Group justify="space-between" wrap="nowrap">
                        <Stack gap={2} style={{ minWidth: 0 }}>
                          <Text size="sm" fw={500} truncate>
                            {tenant.name}
                          </Text>
                          <Code style={{ fontSize: 11 }}>{tenant.id}</Code>
                        </Stack>
                        <PlanTag plan={tenant.plan ?? "starter"} />
                      </Group>
                    </UnstyledButton>
                  );
                })}
              </Stack>
            )}
          </ScrollArea.Autosize>
          {tenants.length > 0 ? (
            <Text size="xs" c="dimmed" mt="xs">
              Showing {tenants.length} of {tenantPagination?.total ?? tenants.length} matching
              tenants.
            </Text>
          ) : null}
        </Card>

        <Card>
          <Title order={3} size="sm" fw={500}>
            2. Choose symptom
          </Title>
          <Stack gap="xs" mt="md">
            {SYMPTOMS.map((symptom) => {
              const isSelected = selectedSymptom.id === symptom.id;
              return (
                <UnstyledButton
                  key={symptom.id}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedSymptomId(symptom.id)}
                  p="sm"
                  style={{
                    borderRadius: "var(--mantine-radius-md)",
                    border: isSelected
                      ? "1px solid var(--mantine-color-blue-6)"
                      : "1px solid var(--mantine-color-default-border)",
                    background: isSelected ? "var(--mantine-color-blue-light)" : "transparent",
                  }}
                >
                  <Stack gap={2}>
                    <Text size="sm" fw={500}>
                      {symptom.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {symptom.summary}
                    </Text>
                  </Stack>
                </UnstyledButton>
              );
            })}
          </Stack>
        </Card>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" mt="md">
        <Card>
          <Group justify="space-between" align="center">
            <Title order={3} size="sm" fw={500}>
              3. Health context
            </Title>
            <Button component={Link} to="/admin/health" variant="subtle" size="xs">
              Open health
            </Button>
          </Group>
          <Group gap="xs" mt="md" wrap="wrap">
            <Badge color={toneToColor(healthTone(health?.status))} variant="light">
              Overall: {health?.status ?? "unknown"}
            </Badge>
            {Object.entries(healthChecks).map(([key, check]) => (
              <Badge key={key} color={toneToColor(healthTone(check.status))} variant="light">
                {healthLabel(key)}: {check.status ?? "unknown"}
                {check.latency_ms !== null && check.latency_ms !== undefined
                  ? ` · ${check.latency_ms}ms`
                  : ""}
              </Badge>
            ))}
            {Object.keys(healthChecks).length === 0 ? (
              <Text size="sm" c="dimmed">
                No dependency checks reported.
              </Text>
            ) : null}
          </Group>
        </Card>

        <Card>
          <Title order={3} size="sm" fw={500}>
            4. Next admin screens
          </Title>
          <Text size="sm" c="dimmed" mt="xs">
            {selectedSymptom.whyItMatters}
          </Text>
          <Stack gap="xs" mt="md">
            {selectedSymptom.steps.map((step) => {
              const href = step.path(selectedTenant?.id ?? null);
              const disabled = step.requiresTenant && !selectedTenant;
              return (
                <Group key={step.label} justify="space-between" wrap="nowrap">
                  <Stack gap={2} style={{ minWidth: 0 }}>
                    <Text size="sm" fw={500}>
                      {step.label}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {step.description}
                    </Text>
                  </Stack>
                  {disabled ? (
                    <Button variant="default" size="xs" disabled>
                      Open
                    </Button>
                  ) : (
                    <Button component={Link} to={href} variant="default" size="xs">
                      Open
                    </Button>
                  )}
                </Group>
              );
            })}
          </Stack>
          {!selectedTenant ? (
            <Text size="sm" c="dimmed" mt="sm">
              Select a tenant to enable tenant-specific links.
            </Text>
          ) : null}
        </Card>
      </SimpleGrid>

      <Card mt="md">
        <Group justify="space-between" align="center">
          <Title order={3} size="sm" fw={500}>
            Support brief
          </Title>
          <Button size="sm" onClick={() => void copyBrief()}>
            Copy brief
          </Button>
        </Group>
        <Code block mt="md" style={{ whiteSpace: "pre-wrap" }}>
          {supportBrief}
        </Code>
      </Card>
    </PageShell>
  );
}
