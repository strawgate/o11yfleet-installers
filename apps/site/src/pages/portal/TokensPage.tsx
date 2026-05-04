import { Plus } from "lucide-react";
import { useState } from "react";
import { Alert, Button, Code, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
  useConfigurations,
  useConfigurationTokens,
  useCreateEnrollmentToken,
  useDeleteEnrollmentToken,
  type Configuration,
  type EnrollmentToken,
} from "@/api/hooks/portal";
import { EmptyState, PageHeader, PageShell, StatusBadge } from "@/components/app";
import { DataTable, type ColumnDef } from "@/components/data-table";
import { CopyButton } from "@/components/common/CopyButton";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { relTime } from "@/utils/format";

function TokenSection({ config }: { config: Configuration }) {
  const { data: tokens, isLoading, error, refetch } = useConfigurationTokens(config.id);
  const createToken = useCreateEnrollmentToken(config.id);
  const deleteToken = useDeleteEnrollmentToken(config.id);

  const [createOpen, setCreateOpen] = useState(false);
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null);
  const form = useForm({ initialValues: { label: "" } });

  const tokenList = tokens ?? [];
  const columns = tokenColumns({
    deletePending: deleteToken.isPending,
    onDelete: handleDelete,
  });

  async function handleCreate({ label }: { label: string }) {
    try {
      const result = await createToken.mutateAsync({ label: label.trim() || undefined });
      const value = result.token;
      if (value) setNewTokenValue(value);
      notifications.show({ title: "Token created", message: config.name, color: "green" });
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

  function handleDelete(token: EnrollmentToken): void {
    const label = tokenLabel(token);
    modals.openConfirmModal({
      title: "Revoke enrollment token",
      centered: true,
      children: (
        <Text size="sm">
          Revoke <strong>{label}</strong>? Collectors using this token will be unable to enroll
          again.
        </Text>
      ),
      labels: { confirm: "Revoke", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: () => {
        void (async () => {
          try {
            await deleteToken.mutateAsync(token.id);
            notifications.show({ message: "Token revoked", color: "green" });
          } catch (err) {
            notifications.show({
              title: "Failed to revoke token",
              message: err instanceof Error ? err.message : "Unknown error",
              color: "red",
            });
          }
        })();
      },
    });
  }

  return (
    <Stack gap="md" mt="md">
      {newTokenValue ? (
        <Alert color="blue" variant="light" title="Token created — copy it now">
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

      <Group justify="space-between" align="center" gap="xs">
        <Text size="sm" fw={500}>
          {config.name}{" "}
          <Text component="span" c="dimmed">
            {tokenList.length}
          </Text>
        </Text>
        <Button size="sm" leftSection={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
          New token
        </Button>
      </Group>

      <DataTable
        columns={columns}
        data={tokenList}
        getRowId={(row) => row.id}
        ariaLabel={`${config.name} enrollment tokens`}
        loading={isLoading}
        error={error ? { message: error.message, retry: () => void refetch() } : null}
        empty={
          <EmptyState
            icon="key"
            title="No enrollment tokens"
            description="Create a token when you are ready to connect a collector to this configuration."
          >
            <Button size="sm" leftSection={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
              New token
            </Button>
          </EmptyState>
        }
      />

      <Modal opened={createOpen} onClose={() => setCreateOpen(false)} title="New enrollment token">
        <form onSubmit={form.onSubmit(handleCreate)}>
          <Stack gap="md">
            <TextInput
              label="Label (optional)"
              placeholder="e.g. production-fleet"
              autoFocus
              {...form.getInputProps("label")}
            />
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={createToken.isPending}>
                Create token
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}

export default function TokensPage() {
  const { data: configs, isLoading, error, refetch } = useConfigurations();

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const cfgList = configs ?? [];

  return (
    <PageShell width="wide">
      <PageHeader
        title="Enrollment tokens"
        description="Enrollment tokens are bootstrap credentials for collectors. They are separate from API tokens and should not grant general control-plane write authority."
      />

      <Alert color="blue" variant="light" title="Token boundary" mb="md">
        Create enrollment tokens per configuration group, copy them once, and revoke or rotate them
        if exposed. API automation tokens will use a separate scoped credential model.
      </Alert>

      {cfgList.length === 0 ? (
        <EmptyState
          icon="file"
          title="No configurations yet"
          description="Create a configuration first to manage enrollment tokens."
        />
      ) : (
        cfgList.map((config) => <TokenSection key={config.id} config={config} />)
      )}
    </PageShell>
  );
}

function tokenColumns({
  deletePending,
  onDelete,
}: {
  deletePending: boolean;
  onDelete: (token: EnrollmentToken) => void;
}): ColumnDef<EnrollmentToken>[] {
  return [
    {
      id: "label",
      header: "Label",
      cell: ({ row }) => (
        <Text size="sm" fw={500}>
          {tokenLabel(row.original)}
        </Text>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const revoked = tokenRevoked(row.original);
        return (
          <StatusBadge tone={revoked ? "error" : "ok"}>
            {revoked ? "revoked" : "active"}
          </StatusBadge>
        );
      },
    },
    {
      accessorKey: "created_at",
      header: "Created",
      cell: ({ row }) => (
        <Text size="sm" c="dimmed">
          {relTime(row.original.created_at)}
        </Text>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) =>
        tokenRevoked(row.original) ? null : (
          <Group justify="flex-end">
            <Button
              color="red"
              size="xs"
              onClick={() => onDelete(row.original)}
              disabled={deletePending}
            >
              Revoke
            </Button>
          </Group>
        ),
    },
  ];
}

function tokenLabel(token: EnrollmentToken): string {
  return (token["label"] as string | undefined) ?? token.id;
}

function tokenRevoked(token: EnrollmentToken): boolean {
  return Boolean(token["revoked_at"] as string | undefined);
}
