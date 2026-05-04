import { useDeferredValue, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Code,
  Group,
  Modal,
  Pagination,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import type { MantineColor } from "@mantine/core";
import { useForm } from "@mantine/form";
import { zodResolver } from "mantine-form-zod-resolver";
import { notifications } from "@mantine/notifications";
import {
  useAdminTenantsPage,
  useCreateTenant,
  useBulkApproveTenants,
  useAdminSettings,
} from "../../api/hooks/admin";
import { createTenantSchema, type CreateTenantValues } from "@/api/form-schemas";
import { EmptyState, MetricCard, PageHeader, PageShell } from "@/components/app";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { PlanTag } from "@/components/common/PlanTag";
import { relTime } from "../../utils/format";
import { PLAN_OPTIONS } from "../../shared/plans";
import { getErrorMessage } from "@/utils/errors";

type StatusFilter = "all" | "pending" | "active" | "suspended";

function statusColor(status?: string): MantineColor {
  if (status === "active") return "green";
  if (status === "pending") return "orange";
  if (status === "suspended") return "red";
  return "gray";
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  return (
    <Badge color={statusColor(status)} variant="light">
      {status}
    </Badge>
  );
}

export default function TenantsPage() {
  const [page, setPage] = useState(1);
  const [planFilter, setPlanFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [filter, setFilter] = useState("");
  const [selectedTenants, setSelectedTenants] = useState<Set<string>>(new Set());
  const deferredFilter = useDeferredValue(filter);
  const { data, isLoading, error, refetch } = useAdminTenantsPage({
    q: deferredFilter,
    plan: planFilter,
    status: statusFilter === "all" ? null : statusFilter,
    page,
    limit: 25,
    sort: "newest",
  });
  const createTenant = useCreateTenant();
  const bulkApprove = useBulkApproveTenants();
  const settings = useAdminSettings();
  const navigate = useNavigate();

  const [modalOpen, setModalOpen] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  const form = useForm<CreateTenantValues>({
    initialValues: { name: "", plan: "starter" },
    validate: zodResolver(createTenantSchema),
  });

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const tenantList = data?.tenants ?? [];
  const pagination = data?.pagination;
  const statusCounts = data?.status_counts ?? {};
  const totalConfigs = tenantList.reduce((sum, tenant) => sum + (tenant.config_count ?? 0), 0);
  const totalAgents = tenantList.reduce((sum, tenant) => sum + (tenant.agent_count ?? 0), 0);

  const pendingCount = statusCounts["pending"] ?? 0;
  const activeCount = statusCounts["active"] ?? 0;
  const suspendedCount = statusCounts["suspended"] ?? 0;
  const totalCount = pendingCount + activeCount + suspendedCount;

  async function handleCreate(values: CreateTenantValues) {
    try {
      const result = await createTenant.mutateAsync({
        name: values.name,
        plan: values.plan,
      });
      notifications.show({ title: "Tenant created", message: values.name, color: "green" });
      setModalOpen(false);
      form.reset();
      void navigate(`/admin/tenants/${result.id}`);
    } catch (err) {
      notifications.show({
        title: "Failed to create tenant",
        message: getErrorMessage(err),
        color: "red",
      });
    }
  }

  async function handleBulkApprove() {
    const ids = Array.from(selectedTenants);
    if (ids.length === 0) return;

    try {
      const result = await bulkApprove.mutateAsync({ tenant_ids: ids });
      const approvedCount = result.approved.length;
      const failedCount = result.failed.length;

      notifications.show({
        title: `Approved ${approvedCount} tenant${approvedCount !== 1 ? "s" : ""}`,
        message: failedCount > 0 ? `${failedCount} failed` : undefined,
        color: failedCount > 0 ? "yellow" : "green",
      });

      setSelectedTenants(new Set());
      setBulkConfirmOpen(false);
      void refetch();
    } catch (err) {
      notifications.show({
        title: "Bulk approve failed",
        message: getErrorMessage(err),
        color: "red",
      });
    }
  }

  function toggleTenantSelection(tenantId: string) {
    const newSet = new Set(selectedTenants);
    if (newSet.has(tenantId)) {
      newSet.delete(tenantId);
    } else {
      newSet.add(tenantId);
    }
    setSelectedTenants(newSet);
  }

  const planSelectOptions = [
    { value: "all", label: "All plans" },
    ...PLAN_OPTIONS.map((option) => ({ value: option.id, label: option.label })),
  ];
  const createPlanOptions = PLAN_OPTIONS.map((option) => ({
    value: option.id,
    label: `${option.label} (${option.audience})`,
  }));

  const statusFilterData = [
    { value: "all", label: `All (${totalCount})` },
    { value: "pending", label: `Pending (${pendingCount})` },
    { value: "active", label: `Active (${activeCount})` },
    { value: "suspended", label: `Suspended (${suspendedCount})` },
  ];

  const autoApprove = settings.data?.auto_approve_signups;

  return (
    <PageShell width="wide">
      <PageHeader
        title="Tenants"
        description="Workspaces, plan limits, and direct troubleshooting entry points."
        actions={
          <Group gap="xs">
            <Badge
              variant="light"
              color={autoApprove ? "green" : "orange"}
              leftSection={
                <Box
                  w={8}
                  h={8}
                  style={{
                    borderRadius: "50%",
                    background: `var(--mantine-color-${autoApprove ? "green" : "orange"}-6)`,
                  }}
                />
              }
            >
              {autoApprove ? "Auto-approve ON" : "Manual approval"}
            </Badge>
            <Button
              variant="default"
              onClick={() => setBulkConfirmOpen(true)}
              disabled={selectedTenants.size === 0 || bulkApprove.isPending}
              loading={bulkApprove.isPending}
            >
              Approve Selected ({selectedTenants.size})
            </Button>
            <Button onClick={() => setModalOpen(true)}>Create tenant</Button>
          </Group>
        }
      />

      <SimpleGrid cols={{ base: 3 }} spacing="md">
        <MetricCard label="Matching tenants" value={String(pagination?.total ?? 0)} />
        <MetricCard label="Configurations" value={String(totalConfigs)} />
        <MetricCard label="Collectors" value={String(totalAgents)} />
      </SimpleGrid>

      <Card mt="md">
        <Group gap="md" wrap="wrap" mb="md">
          <TextInput
            aria-label="Filter tenants by name, ID, or plan"
            placeholder="Filter by name, ID, or plan…"
            value={filter}
            onChange={(e) => {
              setFilter(e.currentTarget.value);
              setPage(1);
            }}
            w={280}
          />
          <Select
            aria-label="Filter by plan"
            value={planFilter}
            onChange={(v) => {
              setPlanFilter(v ?? "all");
              setPage(1);
            }}
            data={planSelectOptions}
            allowDeselect={false}
            w={180}
          />
          <Box style={{ flex: 1 }} />
          <SegmentedControl
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v as StatusFilter);
              setPage(1);
            }}
            data={statusFilterData}
            size="sm"
          />
        </Group>

        {tenantList.length === 0 ? (
          <EmptyState
            icon={filter ? "search" : "users"}
            title={
              filter || planFilter !== "all" || statusFilter !== "all"
                ? "No tenants match your filter"
                : "No tenants yet"
            }
            description={
              filter || planFilter !== "all" || statusFilter !== "all"
                ? "Try a different name, tenant ID, plan, or status."
                : "Create a tenant to start onboarding a workspace."
            }
          >
            {!filter && planFilter === "all" && statusFilter === "all" ? (
              <Button size="sm" onClick={() => setModalOpen(true)}>
                Create tenant
              </Button>
            ) : null}
          </EmptyState>
        ) : (
          <Stack gap="xs">
            {tenantList.map((t) => {
              const configCount = t.config_count ?? 0;
              const maxAgentsPerConfig = t.max_agents_per_config ?? 0;
              const totalAgentCapacity = configCount * maxAgentsPerConfig;
              const isSelected = selectedTenants.has(t.id);
              const isPending = t.status === "pending";

              return (
                <Paper
                  key={t.id}
                  withBorder
                  p="md"
                  style={{
                    borderLeft: isSelected ? "3px solid var(--mantine-color-green-6)" : undefined,
                    background: isSelected ? "var(--mantine-color-green-light)" : undefined,
                  }}
                >
                  <Group wrap="nowrap" gap="md">
                    {isPending ? (
                      <Checkbox
                        checked={isSelected}
                        onChange={() => toggleTenantSelection(t.id)}
                        aria-label={`Select tenant ${t.name}`}
                      />
                    ) : null}
                    <Stack gap={2} style={{ flex: "1 1 16rem", minWidth: 0 }}>
                      <Link to={`/admin/tenants/${t.id}`}>
                        <Text fw={500}>{t.name}</Text>
                      </Link>
                      <Code style={{ fontSize: 11, alignSelf: "flex-start" }}>{t.id}</Code>
                    </Stack>
                    <Stack gap={6} align="flex-start">
                      <PlanTag plan={t.plan ?? "starter"} />
                      <StatusBadge status={t.status} />
                    </Stack>
                    <Group gap="xl" wrap="wrap" style={{ flex: 1 }}>
                      <Stack gap={2}>
                        <Text fw={600}>{configCount}</Text>
                        <Text size="xs" c="dimmed">
                          policies / {t.max_configs ?? "—"}
                        </Text>
                      </Stack>
                      <Stack gap={2}>
                        <Text fw={600}>{t.agent_count ?? 0}</Text>
                        <Text size="xs" c="dimmed">
                          {t.connected_agents ?? 0} connected /{" "}
                          {totalAgentCapacity.toLocaleString()} capacity
                        </Text>
                      </Stack>
                      <Stack gap={2}>
                        <Text fw={600}>{relTime(t.created_at)}</Text>
                        <Text size="xs" c="dimmed">
                          created
                        </Text>
                      </Stack>
                    </Group>
                    <Button
                      component={Link}
                      to={`/admin/tenants/${t.id}`}
                      variant="default"
                      size="sm"
                    >
                      Open
                    </Button>
                  </Group>
                </Paper>
              );
            })}
          </Stack>
        )}
        {pagination ? (
          <Group justify="space-between" mt="md">
            <Text size="sm" c="dimmed">
              Page {pagination.page} · Showing {tenantList.length} of {pagination.total} matching
              tenants
              {selectedTenants.size > 0 && ` (${selectedTenants.size} selected)`}
            </Text>
            <Pagination
              value={pagination.page}
              onChange={setPage}
              total={Math.max(1, Math.ceil(pagination.total / pagination.limit))}
              size="sm"
              withEdges={false}
            />
          </Group>
        ) : null}
      </Card>

      <Modal
        opened={bulkConfirmOpen}
        onClose={() => setBulkConfirmOpen(false)}
        title="Approve selected tenants"
      >
        <Stack gap="md">
          <Text size="sm">
            You are about to approve <strong>{selectedTenants.size}</strong> tenant
            {selectedTenants.size !== 1 ? "s" : ""}. They will receive an email notification.
          </Text>
          <ScrollArea.Autosize mah={200}>
            <Stack gap={4}>
              {tenantList
                .filter((t) => selectedTenants.has(t.id))
                .map((t) => (
                  <Group key={t.id} gap="xs" py={4}>
                    <Text size="sm" fw={500}>
                      {t.name}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {t.plan}
                    </Text>
                  </Group>
                ))}
            </Stack>
          </ScrollArea.Autosize>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setBulkConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleBulkApprove()} loading={bulkApprove.isPending}>
              Approve {selectedTenants.size} tenant{selectedTenants.size !== 1 ? "s" : ""}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={modalOpen}
        onClose={() => {
          setModalOpen(false);
          form.reset();
        }}
        title="Create tenant"
      >
        <form onSubmit={form.onSubmit(handleCreate)}>
          <Stack gap="md">
            <TextInput
              label="Name"
              placeholder="Tenant name"
              autoFocus
              {...form.getInputProps("name")}
            />
            <Select
              label="Plan"
              data={createPlanOptions}
              allowDeselect={false}
              {...form.getInputProps("plan")}
            />
            <Group justify="flex-end" gap="xs">
              <Button
                variant="default"
                onClick={() => {
                  setModalOpen(false);
                  form.reset();
                }}
              >
                Cancel
              </Button>
              <Button type="submit" loading={createTenant.isPending}>
                Create tenant
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </PageShell>
  );
}
