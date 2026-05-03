import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { zodResolver } from "mantine-form-zod-resolver";
import { notifications } from "@mantine/notifications";
import { tenantSettingsSchema, type TenantSettingsValues } from "@/api/form-schemas";
import {
  useAdminTenant,
  useAdminTenantConfigs,
  useAdminTenantUsers,
  useUpdateAdminTenant,
  useDeleteAdminTenant,
  useImpersonateTenant,
} from "../../api/hooks/admin";
import { useAdminGuidance } from "../../api/hooks/ai";
import { GuidancePanel } from "../../components/ai";
import { CopyButton } from "../../components/common/CopyButton";
import { EmptyState, PageHeader, PageShell } from "@/components/app";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { PlanTag } from "@/components/common/PlanTag";
import { PLAN_OPTIONS, normalizePlanId } from "../../shared/plans";
import { relTime } from "../../utils/format";
import {
  buildInsightRequest,
  insightSurfaces,
  insightTarget,
  tabInsightTarget,
} from "../../ai/insight-registry";
import { emailDomain } from "./ai-context-utils";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";

type Tab = "overview" | "configurations" | "users" | "settings";

const TAB_KEYS = ["overview", "configurations", "users", "settings"] as const;
const isTab = (value: string | null): value is Tab =>
  value !== null && (TAB_KEYS as readonly string[]).includes(value);

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const tenant = useAdminTenant(id);
  const configs = useAdminTenantConfigs(id);
  const users = useAdminTenantUsers(id);
  const updateTenant = useUpdateAdminTenant(id!);
  const deleteTenant = useDeleteAdminTenant(id!);
  const impersonateTenant = useImpersonateTenant(id!);

  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<Tab>(isTab(tabParam) ? tabParam : "overview");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const form = useForm<TenantSettingsValues>({
    initialValues: { name: "", plan: "starter" },
    validate: zodResolver(tenantSettingsSchema),
  });

  useEffect(() => {
    setActiveTab(isTab(tabParam) ? tabParam : "overview");
  }, [tabParam]);

  useEffect(() => {
    // Re-seed the form when tenant data first loads or after a save. Skip
    // when the form is dirty so a background refetch (cache invalidation,
    // poll) can't clobber the user's in-flight edits.
    if (tenant.data && !form.isDirty()) {
      form.setInitialValues({
        name: tenant.data.name,
        plan: normalizePlanId(tenant.data.plan),
      });
      form.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.data]);

  const t = tenant.data;
  const currentPlan = normalizePlanId(t?.plan);
  const configList = configs.data ?? [];
  const userList = users.data ?? [];
  const overviewGuidanceReady =
    activeTab === "overview" && Boolean(t) && configs.isSuccess && users.isSuccess;
  const insightSurface = insightSurfaces.adminTenant;
  const guidanceRequest: AiGuidanceRequest | null =
    overviewGuidanceReady && t
      ? buildInsightRequest(
          insightSurface,
          [
            insightTarget(insightSurface, insightSurface.targets.page),
            insightTarget(insightSurface, insightSurface.targets.configurations),
            insightTarget(insightSurface, insightSurface.targets.users),
            tabInsightTarget(insightSurface, "admin.tenant.tab", activeTab),
          ],
          {
            tenant_id: t.id,
            tenant_name: t.name,
            plan: currentPlan,
            active_tab: activeTab,
            config_count: configList.length,
            user_count: userList.length,
            max_configs: (t["max_configs"] as number) ?? null,
            config_limit_utilization:
              typeof t["max_configs"] === "number" && t["max_configs"] > 0
                ? configList.length / t["max_configs"]
                : null,
            max_agents_per_config: (t["max_agents_per_config"] as number) ?? null,
            created_at: t.created_at ?? null,
            configurations: configList.slice(0, 12).map((config) => ({
              id: config.id,
              name: config.name,
              status: config["status"] ?? null,
              agents: config["agents"] ?? null,
              updated_at: config["updated_at"] ?? null,
            })),
            users: userList.slice(0, 12).map((user) => ({
              id: user.id,
              email_domain: emailDomain(user.email),
              role: user.role ?? "member",
              created_at: user["created_at"] ?? null,
            })),
          },
        )
      : null;
  const guidance = useAdminGuidance(guidanceRequest);

  if (tenant.isLoading) return <LoadingSpinner />;
  if (tenant.error) return <ErrorState error={tenant.error} retry={() => void tenant.refetch()} />;
  if (!t) return <ErrorState error={new Error("Tenant not found")} />;

  async function handleSave(values: TenantSettingsValues) {
    try {
      await updateTenant.mutateAsync({ name: values.name, plan: values.plan });
      notifications.show({ message: "Tenant updated", color: "green" });
      form.resetDirty();
    } catch (err) {
      notifications.show({
        title: "Failed to save",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    }
  }

  async function handleDelete() {
    try {
      await deleteTenant.mutateAsync();
      notifications.show({ title: "Tenant deleted", message: t!.name, color: "green" });
      void navigate("/admin/tenants");
    } catch (err) {
      notifications.show({
        title: "Delete failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    }
  }

  async function handleImpersonate() {
    try {
      const result = await impersonateTenant.mutateAsync();
      queryClient.clear();
      queryClient.setQueryData(["auth", "me"], result);
      void navigate("/portal/overview");
    } catch (err) {
      notifications.show({
        title: "Failed to view tenant",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    }
  }

  function handleTabChange(value: string | null) {
    if (!value || !isTab(value)) return;
    setActiveTab(value);
    setSearchParams(value === "overview" ? {} : { tab: value });
  }

  const planOptions = PLAN_OPTIONS.map((option) => ({
    value: option.id,
    label: `${option.label} (${option.audience})`,
  }));

  return (
    <PageShell width="wide">
      <PageHeader
        title={t.name}
        actions={
          <Group gap="xs">
            <PlanTag plan={t.plan ?? "starter"} />
            <Button
              variant="subtle"
              size="sm"
              onClick={() => void handleImpersonate()}
              loading={impersonateTenant.isPending}
            >
              View as tenant
            </Button>
          </Group>
        }
      />

      <Tabs value={activeTab} onChange={handleTabChange}>
        <Tabs.List>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="configurations">Configurations</Tabs.Tab>
          <Tabs.Tab value="users">Users</Tabs.Tab>
          <Tabs.Tab value="settings">Settings</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md">
          <Card>
            <Title order={3} size="sm" fw={500} mb="sm">
              Tenant details
            </Title>
            <Table>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Td c="dimmed">Plan</Table.Td>
                  <Table.Td>
                    <PlanTag plan={t.plan ?? "starter"} />
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">Policies</Table.Td>
                  <Table.Td>{configList.length}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">Policy limit</Table.Td>
                  <Table.Td>{String(t.max_configs ?? "—")}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">Collector limit</Table.Td>
                  <Table.Td>{String(t.max_agents_per_config ?? "—")}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">Users</Table.Td>
                  <Table.Td>{userList.length}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">Created</Table.Td>
                  <Table.Td>{relTime(t.created_at)}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">Tenant ID</Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <Text ff="monospace">{t.id}</Text>
                      <CopyButton value={t.id} />
                    </Group>
                  </Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </Card>
          <GuidancePanel
            title="Tenant operations"
            guidance={guidance.data}
            isLoading={guidance.isLoading}
            error={guidance.error}
            onRefresh={() => void guidance.refetch()}
          />
        </Tabs.Panel>

        <Tabs.Panel value="configurations" pt="md">
          <Card>
            {configs.isLoading ? (
              <LoadingSpinner />
            ) : configList.length === 0 ? (
              <EmptyState
                icon="file"
                title="No configurations found"
                description="This tenant does not have any managed collector configurations yet."
              />
            ) : (
              <Table.ScrollContainer minWidth={500}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Agents</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Updated</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {configList.map((c) => (
                      <Table.Tr key={c.id}>
                        <Table.Td>{c.name}</Table.Td>
                        <Table.Td>{(c["agents"] as number) ?? "—"}</Table.Td>
                        <Table.Td>
                          <Badge
                            color={(c["status"] as string) === "active" ? "green" : "yellow"}
                            variant="light"
                          >
                            {(c["status"] as string) ?? "unknown"}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed">
                            {relTime(c["updated_at"] as string | undefined)}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Card>
        </Tabs.Panel>

        <Tabs.Panel value="users" pt="md">
          <Card>
            {users.isLoading ? (
              <LoadingSpinner />
            ) : userList.length === 0 ? (
              <EmptyState
                icon="users"
                title="No users found"
                description="Users will appear here after they join or are provisioned."
              />
            ) : (
              <Table.ScrollContainer minWidth={500}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Email</Table.Th>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Role</Table.Th>
                      <Table.Th>Joined</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {userList.map((u) => (
                      <Table.Tr key={u.id}>
                        <Table.Td>{u.email}</Table.Td>
                        <Table.Td>{(u["name"] as string) ?? "—"}</Table.Td>
                        <Table.Td>
                          <Badge color={u.role === "admin" ? "blue" : "gray"} variant="light">
                            {u.role ?? "member"}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed">
                            {relTime(u["created_at"] as string | undefined)}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Card>
        </Tabs.Panel>

        <Tabs.Panel value="settings" pt="md">
          <Card>
            <Title order={3} size="sm" fw={500} mb="md">
              General
            </Title>
            <form onSubmit={form.onSubmit(handleSave)}>
              <Stack gap="md">
                <TextInput label="Tenant name" {...form.getInputProps("name")} />
                <Select
                  label="Plan"
                  data={planOptions}
                  allowDeselect={false}
                  {...form.getInputProps("plan")}
                />
                <Group>
                  <Button type="submit" loading={updateTenant.isPending} disabled={!form.isDirty()}>
                    Save changes
                  </Button>
                </Group>
              </Stack>
            </form>
          </Card>

          <Card mt="md" withBorder style={{ borderColor: "var(--mantine-color-red-7)" }}>
            <Title order={3} size="sm" fw={500} c="red">
              Danger zone
            </Title>
            <Group justify="space-between" align="flex-start" mt="md" wrap="wrap">
              <Stack gap={4} style={{ flex: "1 1 16rem" }}>
                <Text size="sm" fw={500}>
                  Delete tenant
                </Text>
                <Text size="sm" c="dimmed">
                  Permanently delete this tenant and all its data. This action cannot be undone.
                </Text>
              </Stack>
              <Button color="red" onClick={() => setDeleteOpen(true)}>
                Delete tenant
              </Button>
            </Group>
          </Card>
        </Tabs.Panel>
      </Tabs>

      <Modal
        opened={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          setConfirmText("");
        }}
        title="Delete tenant"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (confirmText === "delete") void handleDelete();
          }}
        >
          <Stack gap="md">
            <Text size="sm">
              Type <strong>delete</strong> to confirm.
            </Text>
            <TextInput
              value={confirmText}
              onChange={(e) => setConfirmText(e.currentTarget.value)}
              placeholder="delete"
              autoFocus
              aria-label="Delete confirmation"
            />
            <Group justify="flex-end" gap="xs">
              <Button
                type="button"
                variant="default"
                onClick={() => {
                  setDeleteOpen(false);
                  setConfirmText("");
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                color="red"
                disabled={confirmText !== "delete"}
                loading={deleteTenant.isPending}
              >
                Delete permanently
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </PageShell>
  );
}
