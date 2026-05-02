import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useCreateConfiguration, useOverview, type Configuration } from "@/api/hooks/portal";
import { normalizeFleetOverview } from "@/api/models/fleet-overview";
import { useToast } from "@/components/common/Toast";
import { Modal } from "@/components/common/Modal";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { ErrorState } from "@/components/common/ErrorState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, PageShell } from "@/components/app";
import { DataTable, type ColumnDef } from "@/components/data-table";
import { relTime, trunc } from "@/utils/format";
import { configurationAgentMetrics } from "@/utils/config-stats";

export default function ConfigurationsPage() {
  const overview = useOverview();
  const createConfig = useCreateConfiguration();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const columns = useMemo(() => configurationColumns(), []);

  if (overview.isLoading) return <LoadingSpinner />;
  if (overview.error)
    return <ErrorState error={overview.error} retry={() => void overview.refetch()} />;

  const view = overview.data ? normalizeFleetOverview(overview.data) : null;
  const cfgList = view?.configurations.rows ?? [];

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      const result = await createConfig.mutateAsync({
        name: name.trim(),
        description: description.trim(),
      });
      toast("Configuration created", name);
      setModalOpen(false);
      setName("");
      setDescription("");
      void navigate(`/portal/configurations/${result.id}`);
    } catch (err) {
      toast(
        "Failed to create configuration",
        err instanceof Error ? err.message : "Unknown error",
        "err",
      );
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

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New configuration"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleCreate()}
              disabled={!name.trim() || createConfig.isPending}
            >
              {createConfig.isPending ? "Creating..." : "Create configuration"}
            </Button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="config-name">Name</label>
          <input
            id="config-name"
            className="input mono"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="my-config"
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="config-description">Description</label>
          <textarea
            id="config-description"
            className="textarea"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional description"
            rows={3}
          />
        </div>
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
        <Link
          className="font-medium text-foreground hover:text-primary"
          to={configurationPath(row.original)}
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      id: "config_hash",
      header: "Config hash",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {trunc(row.original.current_config_hash ?? undefined, 12)}
        </span>
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
        <span className="text-sm text-muted-foreground">{trunc(row.original.description, 40)}</span>
      ),
    },
    {
      accessorKey: "updated_at",
      header: "Updated",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{relTime(row.original.updated_at)}</span>
      ),
    },
    {
      id: "open",
      header: () => <span className="sr-only">Open</span>,
      cell: ({ row }) => (
        <Button asChild variant="ghost" size="icon-xs">
          <Link aria-label="Open configuration" to={configurationPath(row.original)}>
            <ArrowRight className="size-3" />
          </Link>
        </Button>
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
      <Badge
        variant="outline"
        className="border-transparent bg-[color:var(--warn)]/15 text-[color:var(--warn)]"
      >
        Metrics unavailable
      </Badge>
    );
  }

  return (
    <Badge variant="outline">
      {metrics.connectedAgents} / {metrics.totalAgents} connected
    </Badge>
  );
}

function configurationPath(config: Configuration): string {
  return `/portal/configurations/${config.id}`;
}
