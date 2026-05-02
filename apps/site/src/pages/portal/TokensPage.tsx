import { useState } from "react";
import { Plus } from "lucide-react";
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
import { Modal } from "@/components/common/Modal";
import { Group, Text } from "@mantine/core";
import { useToast } from "@/components/common/Toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { relTime } from "@/utils/format";

function TokenSection({ config }: { config: Configuration }) {
  const { data: tokens, isLoading, error, refetch } = useConfigurationTokens(config.id);
  const createToken = useCreateEnrollmentToken(config.id);
  const deleteToken = useDeleteEnrollmentToken(config.id);
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [tokenLabel, setTokenLabel] = useState("");
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null);
  const tokenLabelId = `token-label-${config.id}`;
  const tokenList = tokens ?? [];
  const columns = tokenColumns({
    deletePending: deleteToken.isPending,
    onDelete: handleDelete,
  });

  async function handleCreate() {
    try {
      const result = await createToken.mutateAsync({ name: tokenLabel.trim() || undefined });
      const value = result.token;
      if (value) {
        setNewTokenValue(value);
      }
      toast("Token created", config.name);
      setCreateOpen(false);
      setTokenLabel("");
    } catch (err) {
      toast("Failed to create token", err instanceof Error ? err.message : "Unknown error", "err");
    }
  }

  async function handleDelete(tokenId: string) {
    try {
      await deleteToken.mutateAsync(tokenId);
      toast("Token revoked");
    } catch (err) {
      toast("Failed to revoke token", err instanceof Error ? err.message : "Unknown error", "err");
    }
  }

  return (
    <section className="mt-6 grid gap-4">
      {newTokenValue ? (
        <div className="rounded-md border border-[color:var(--info)]/30 bg-[color:var(--info)]/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">Token created - copy it now</div>
              <p className="mt-1 text-sm text-muted-foreground">
                This token will not be shown again.
              </p>
              <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
                <code className="max-w-full overflow-x-auto rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground">
                  {newTokenValue}
                </code>
                <CopyButton value={newTokenValue} />
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setNewTokenValue(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      <Group justify="space-between" align="center" gap="xs">
        <Text size="sm" fw={500}>
          {config.name}{" "}
          <Text component="span" c="dimmed">
            {tokenList.length}
          </Text>
        </Text>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
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
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New token
            </Button>
          </EmptyState>
        }
      />

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New enrollment token"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={createToken.isPending}>
              {createToken.isPending ? "Creating..." : "Create token"}
            </Button>
          </>
        }
      >
        <div className="grid gap-2">
          <label className="text-sm font-medium text-foreground" htmlFor={tokenLabelId}>
            Label (optional)
          </label>
          <Input
            id={tokenLabelId}
            value={tokenLabel}
            onChange={(event) => setTokenLabel(event.target.value)}
            placeholder="e.g. production-fleet"
            autoFocus
          />
        </div>
      </Modal>
    </section>
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

      <section className="mb-6 rounded-md border border-[color:var(--info)]/30 bg-[color:var(--info)]/10 p-4">
        <div className="text-sm font-medium text-foreground">Token boundary</div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Create enrollment tokens per configuration group, copy them once, and revoke or rotate
          them if exposed. API automation tokens will use a separate scoped credential model.
        </p>
      </section>

      {cfgList.length === 0 ? (
        <section className="rounded-md border border-border bg-card">
          <EmptyState
            icon="file"
            title="No configurations yet"
            description="Create a configuration first to manage enrollment tokens."
          />
        </section>
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
  onDelete: (tokenId: string) => Promise<void>;
}): ColumnDef<EnrollmentToken>[] {
  return [
    {
      id: "label",
      header: "Label",
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{tokenLabel(row.original)}</span>
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
        <span className="text-sm text-muted-foreground">{relTime(row.original.created_at)}</span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) =>
        tokenRevoked(row.original) ? null : (
          <div className="flex justify-end">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void onDelete(row.original.id)}
              disabled={deletePending}
            >
              Revoke
            </Button>
          </div>
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
