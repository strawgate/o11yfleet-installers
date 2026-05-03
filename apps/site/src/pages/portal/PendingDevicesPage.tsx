import { useState } from "react";
import { Plus } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  Code,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
  useConfigurations,
  usePendingDevices,
  usePendingTokens,
  useCreatePendingToken,
  useRevokePendingToken,
  useAssignPendingDevice,
  type PendingDevice,
  type PendingToken,
} from "@/api/hooks/portal";
import { EmptyState, PageHeader, PageShell } from "@/components/app";
import { DataTable, type ColumnDef } from "@/components/data-table";
import { CopyButton } from "@/components/common/CopyButton";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { relTime } from "@/utils/format";

function PendingTokensSection() {
  const { data: tokens, isLoading, error, refetch } = usePendingTokens();
  const createToken = useCreatePendingToken();
  const revokeToken = useRevokePendingToken();
  const { data: configs } = useConfigurations();

  const [createOpen, setCreateOpen] = useState(false);
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null);

  const form = useForm({
    initialValues: { label: "", targetConfigId: "" as string | null },
  });

  const tokenList = tokens ?? [];

  async function handleCreate(values: { label: string; targetConfigId: string | null }) {
    try {
      const body: { label?: string; target_config_id?: string } = {};
      if (values.label.trim()) body.label = values.label.trim();
      if (values.targetConfigId) body.target_config_id = values.targetConfigId;
      const result = await createToken.mutateAsync(body);
      const value = result.token;
      if (value) setNewTokenValue(value);
      notifications.show({
        title: "Pending token created",
        message: "Token for pending enrollment",
        color: "green",
      });
      setCreateOpen(false);
      form.reset();
    } catch (err) {
      notifications.show({
        title: "Failed to create token",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    }
  }

  async function handleRevoke(tokenId: string) {
    try {
      await revokeToken.mutateAsync(tokenId);
      notifications.show({ message: "Token revoked", color: "green" });
    } catch (err) {
      notifications.show({
        title: "Failed to revoke token",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    }
  }

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const configOptions = (configs ?? []).map((c) => ({ value: c.id, label: c.name }));

  const columns: ColumnDef<PendingToken>[] = [
    {
      accessorKey: "label",
      header: "Label",
      cell: ({ row }) => {
        const label = row.getValue("label");
        return label ?? <Text c="dimmed">—</Text>;
      },
    },
    {
      accessorKey: "target_config_id",
      header: "Target Config",
      cell: ({ row }) => {
        const configId = row.getValue("target_config_id") as string | null;
        if (!configId) return <Text c="dimmed">Any</Text>;
        const config = configs?.find((c) => c.id === configId);
        return config ? config.name : configId;
      },
    },
    {
      accessorKey: "created_at",
      header: "Created",
      cell: ({ row }) => relTime(row.getValue("created_at") as string),
    },
    {
      accessorKey: "revoked_at",
      header: "Status",
      cell: ({ row }) => {
        const revokedAt = row.getValue("revoked_at") as string | null;
        return (
          <Text size="sm" c={revokedAt ? "red" : "green"}>
            {revokedAt ? "Revoked" : "Active"}
          </Text>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const revokedAt = row.getValue("revoked_at") as string | null;
        if (revokedAt) return null;
        const id = row.original.id;
        return (
          <Button
            variant="subtle"
            color="red"
            size="xs"
            onClick={() => void handleRevoke(id)}
            disabled={revokeToken.isPending}
          >
            Revoke
          </Button>
        );
      },
    },
  ];

  return (
    <>
      {newTokenValue ? (
        <Alert color="blue" variant="light" title="Pending token created — copy it now" mb="md">
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              This token will not be shown again.
            </Text>
            <Group gap="xs" wrap="wrap">
              <Code style={{ flex: "1 1 auto", overflowX: "auto" }}>{newTokenValue}</Code>
              <CopyButton value={newTokenValue} />
              <Button variant="subtle" size="xs" onClick={() => setNewTokenValue(null)}>
                Dismiss
              </Button>
            </Group>
          </Stack>
        </Alert>
      ) : null}

      <Group justify="space-between" align="center" gap="xs" mb="xs">
        <Title order={3} size="sm" fw={500}>
          Pending Enrollment Tokens
        </Title>
        <Button size="sm" leftSection={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
          Create pending token
        </Button>
      </Group>
      <DataTable
        columns={columns}
        data={tokenList}
        getRowId={(row) => row.id}
        ariaLabel="Pending enrollment tokens"
        empty={
          <EmptyState
            title="No pending tokens"
            description="Create a pending token to allow collectors to enroll without a pre-assigned configuration."
          />
        }
      />

      <Modal opened={createOpen} onClose={() => setCreateOpen(false)} title="Create pending token">
        <form onSubmit={form.onSubmit(handleCreate)}>
          <Stack gap="md">
            <TextInput
              label="Label (optional)"
              placeholder="e.g., Production fleet"
              {...form.getInputProps("label")}
            />
            <Select
              label="Target configuration (optional)"
              description="If not specified, the collector can be assigned to any configuration after connecting."
              placeholder="Any configuration"
              data={configOptions}
              clearable
              {...form.getInputProps("targetConfigId")}
            />
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={createToken.isPending}>
                Create
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}

function PendingDevicesSection() {
  const { data: devices, isLoading, error, refetch } = usePendingDevices();
  const assignDevice = useAssignPendingDevice();
  const { data: configs } = useConfigurations();

  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<PendingDevice | null>(null);
  const form = useForm({ initialValues: { targetConfigId: "" as string | null } });

  const deviceList = devices ?? [];
  const configOptions = (configs ?? []).map((c) => ({ value: c.id, label: c.name }));

  async function handleAssign({ targetConfigId }: { targetConfigId: string | null }) {
    if (!selectedDevice || !targetConfigId) return;
    try {
      await assignDevice.mutateAsync({
        deviceUid: selectedDevice.instance_uid,
        configId: targetConfigId,
      });
      notifications.show({
        title: "Device assigned",
        message: "Collector assigned to configuration",
        color: "green",
      });
      setAssignOpen(false);
      setSelectedDevice(null);
      form.reset();
    } catch (err) {
      notifications.show({
        title: "Failed to assign device",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    }
  }

  function openAssignModal(device: PendingDevice) {
    setSelectedDevice(device);
    form.reset();
    setAssignOpen(true);
  }

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const columns: ColumnDef<PendingDevice>[] = [
    {
      accessorKey: "display_name",
      header: "Display Name",
      cell: ({ row }) => row.getValue("display_name") ?? <Text c="dimmed">—</Text>,
    },
    {
      accessorKey: "source_ip",
      header: "Source IP",
      cell: ({ row }) => row.getValue("source_ip") ?? <Text c="dimmed">—</Text>,
    },
    {
      id: "location",
      header: "Location",
      cell: ({ row }) => {
        const geoCountry = row.original.geo_country;
        const geoCity = row.original.geo_city;
        if (!geoCountry) return <Text c="dimmed">—</Text>;
        return geoCity ? `${geoCity}, ${geoCountry}` : geoCountry;
      },
    },
    {
      accessorKey: "connected_at",
      header: "Connected",
      cell: ({ row }) => relTime(new Date(row.getValue("connected_at") as number).toISOString()),
    },
    {
      accessorKey: "last_seen_at",
      header: "Last Seen",
      cell: ({ row }) => relTime(new Date(row.getValue("last_seen_at") as number).toISOString()),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <Button variant="default" size="xs" onClick={() => openAssignModal(row.original)}>
          Assign
        </Button>
      ),
    },
  ];

  return (
    <>
      <Title order={3} size="sm" fw={500} mb="xs" mt="lg">
        Pending Devices
      </Title>
      <DataTable
        columns={columns}
        data={deviceList}
        getRowId={(row) => row.instance_uid}
        ariaLabel="Pending devices"
        empty={
          <EmptyState
            title="No pending devices"
            description="Pending devices will appear here when collectors connect with a pending enrollment token."
          />
        }
      />

      <Modal
        opened={assignOpen}
        onClose={() => {
          setAssignOpen(false);
          setSelectedDevice(null);
        }}
        title="Assign to configuration"
      >
        <form onSubmit={form.onSubmit(handleAssign)}>
          <Stack gap="md">
            {selectedDevice && (
              <Card>
                <Text size="sm" fw={500}>
                  {selectedDevice.display_name ?? "Unknown device"}
                  {selectedDevice.source_ip && (
                    <Text component="span" c="dimmed" ml="xs">
                      ({selectedDevice.source_ip})
                    </Text>
                  )}
                </Text>
              </Card>
            )}
            <Select
              label="Target configuration"
              placeholder="Select configuration..."
              data={configOptions}
              required
              {...form.getInputProps("targetConfigId")}
            />
            <Group justify="flex-end" gap="xs">
              <Button
                variant="default"
                onClick={() => {
                  setAssignOpen(false);
                  setSelectedDevice(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                loading={assignDevice.isPending}
                disabled={!form.values.targetConfigId}
              >
                Assign
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}

export default function PendingDevicesPage() {
  return (
    <PageShell width="wide">
      <PageHeader
        title="Pending Enrollment"
        description="Manage pending collectors and enrollment tokens"
      />
      <PendingTokensSection />
      <PendingDevicesSection />
    </PageShell>
  );
}
