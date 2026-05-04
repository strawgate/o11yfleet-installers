import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight } from "lucide-react";
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { zodResolver } from "mantine-form-zod-resolver";
import { notifications } from "@mantine/notifications";
import { useCreateConfiguration, useOverview, type Configuration } from "@/api/hooks/portal";
import { createConfigurationSchema, type CreateConfigurationValues } from "@/api/form-schemas";
import { normalizeFleetOverview } from "@/api/models/fleet-overview";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { ErrorState } from "@/components/common/ErrorState";
import { EmptyState, PageHeader, PageShell } from "@/components/app";
import { DataTable, type ColumnDef } from "@/components/data-table";
import { relTime, trunc } from "@/utils/format";
import { configurationAgentMetrics } from "@/utils/config-stats";
import { getErrorMessage } from "@/utils/errors";

export default function ConfigurationsPage() {
  const overview = useOverview();
  const createConfig = useCreateConfiguration();
  const navigate = useNavigate();

  const [modalOpen, setModalOpen] = useState(false);
  const form = useForm<CreateConfigurationValues>({
    initialValues: { name: "", description: "" },
    validate: zodResolver(createConfigurationSchema),
  });
  const columns = useMemo(() => configurationColumns(), []);

  if (overview.isLoading) return <LoadingSpinner />;
  if (overview.error)
    return <ErrorState error={overview.error} retry={() => void overview.refetch()} />;

  const view = overview.data ? normalizeFleetOverview(overview.data) : null;
  const cfgList = view?.configurations.rows ?? [];

  async function handleCreate(values: CreateConfigurationValues) {
    try {
      const result = await createConfig.mutateAsync({
        name: values.name,
        description: values.description ?? "",
      });
      notifications.show({ title: "Configuration created", message: values.name, color: "green" });
      setModalOpen(false);
      form.reset();
      void navigate(`/portal/configurations/${result.id}`);
    } catch (err) {
      notifications.show({
        title: "Failed to create configuration",
        message: getErrorMessage(err),
        color: "red",
      });
    }
  }

  return (
    <PageShell width="wide">
      <PageHeader
        title="Configurations"
        actions={<Button onClick={() => setModalOpen(true)}>New configuration</Button>}
      />

      <DataTable
        columns={columns}
        data={cfgList}
        getRowId={(row) => row.id}
        ariaLabel="Configurations"
        empty={
          <EmptyState
            icon="file"
            title="No configurations yet"
            description="Create a configuration before enrolling collectors or pushing rollout updates."
          >
            <Button size="sm" onClick={() => setModalOpen(true)}>
              New configuration
            </Button>
          </EmptyState>
        }
      />

      <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title="New configuration">
        <form onSubmit={form.onSubmit(handleCreate)}>
          <Stack gap="md">
            <TextInput
              label="Name"
              placeholder="my-config"
              autoFocus
              styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
              {...form.getInputProps("name")}
            />
            <Textarea
              label="Description"
              placeholder="Optional description"
              rows={3}
              {...form.getInputProps("description")}
            />
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={createConfig.isPending}>
                Create configuration
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </PageShell>
  );
}

function configurationColumns(): ColumnDef<Configuration>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <Anchor component={Link} to={configurationPath(row.original)} fw={500}>
          {row.original.name}
        </Anchor>
      ),
    },
    {
      id: "config_hash",
      header: "Config hash",
      cell: ({ row }) => (
        <Text size="xs" c="dimmed" ff="monospace">
          {trunc(row.original.current_config_hash ?? undefined, 12)}
        </Text>
      ),
    },
    {
      id: "collectors",
      header: "Collectors",
      cell: ({ row }) => <CollectorCount config={row.original} />,
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ row }) => (
        <Text size="sm" c="dimmed">
          {trunc(row.original.description, 40)}
        </Text>
      ),
    },
    {
      accessorKey: "updated_at",
      header: "Updated",
      cell: ({ row }) => (
        <Text size="sm" c="dimmed">
          {relTime(row.original.updated_at)}
        </Text>
      ),
    },
    {
      id: "open",
      header: () => <span className="sr-only">Open</span>,
      cell: ({ row }) => (
        <ActionIcon
          component={Link}
          to={configurationPath(row.original)}
          variant="subtle"
          size="sm"
          aria-label="Open configuration"
        >
          <ArrowRight className="size-3" />
        </ActionIcon>
      ),
    },
  ];
}

function CollectorCount({ config }: { config: Configuration }) {
  const metrics = configurationAgentMetrics(
    config.stats,
    [],
    config.current_config_hash ?? undefined,
  );
  const hasSnapshot =
    typeof config.stats?.snapshot_at === "string" || typeof config.stats?.snapshot_at === "number";

  if (!hasSnapshot) {
    return (
      <Badge color="yellow" variant="light">
        Metrics unavailable
      </Badge>
    );
  }

  return (
    <Badge variant="default">
      {metrics.connectedAgents} / {metrics.totalAgents} connected
    </Badge>
  );
}

function configurationPath(config: Configuration): string {
  return `/portal/configurations/${config.id}`;
}
