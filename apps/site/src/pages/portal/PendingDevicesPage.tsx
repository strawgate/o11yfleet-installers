import { useState } from "react";
import { Plus } from "lucide-react";
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
import { Group, Title } from "@mantine/core";
import { CopyButton } from "@/components/common/CopyButton";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { Modal } from "@/components/common/Modal";
import { useToast } from "@/components/common/Toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { relTime } from "@/utils/format";

function PendingTokensSection() {
  const { data: tokens, isLoading, error, refetch } = usePendingTokens();
  const createToken = useCreatePendingToken();
  const revokeToken = useRevokePendingToken();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [tokenLabel, setTokenLabel] = useState("");
  const [targetConfigId, setTargetConfigId] = useState("");
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null);
  const { data: configs } = useConfigurations();

  const tokenList = tokens ?? [];

  async function handleCreate() {
    try {
      const body: { label?: string; target_config_id?: string } = {};
      if (tokenLabel.trim()) body.label = tokenLabel.trim();
      if (targetConfigId.trim()) body.target_config_id = targetConfigId.trim();
      const result = await createToken.mutateAsync(body);
      const value = result.token;
      if (value) {
        setNewTokenValue(value);
      }
      toast("Pending token created", "Token for pending enrollment");
      setCreateOpen(false);
      setTokenLabel("");
      setTargetConfigId("");
    } catch (err) {
      toast("Failed to create token", err instanceof Error ? err.message : "Unknown error", "err");
    }
  }

  async function handleRevoke(tokenId: string) {
    try {
      await revokeToken.mutateAsync(tokenId);
      toast("Token revoked");
    } catch (err) {
      toast("Failed to revoke token", err instanceof Error ? err.message : "Unknown error", "err");
    }
  }

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const columns: ColumnDef<PendingToken>[] = [
    {
      accessorKey: "label",
      header: "Label",
      cell: ({ row: _row }) => {
        const label = _row.getValue("label");
        return label ?? <span className="text-muted-foreground">—</span>;
      },
    },
    {
      accessorKey: "target_config_id",
      header: "Target Config",
      cell: ({ row: _row }) => {
        const configId = _row.getValue("target_config_id") as string | null;
        if (!configId) return <span className="text-muted-foreground">Any</span>;
        const config = configs?.find((c) => c.id === configId);
        return config ? config.name : configId;
      },
    },
    {
      accessorKey: "created_at",
      header: "Created",
      cell: ({ row: _row }) => {
        const createdAt = _row.getValue("created_at") as string;
        return relTime(createdAt);
      },
    },
    {
      accessorKey: "revoked_at",
      header: "Status",
      cell: ({ row: _row }) => {
        const revokedAt = _row.getValue("revoked_at") as string | null;
        return revokedAt ? (
          <span className="text-destructive">Revoked</span>
        ) : (
          <span className="text-success">Active</span>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row: _row }) => {
        const revokedAt = _row.getValue("revoked_at") as string | null;
        if (revokedAt) return null;
        const id = _row.original.id;
        return (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => {
              void handleRevoke(id);
            }}
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
        <div className="rounded-md border border-[color:var(--info)]/30 bg-[color:var(--info)]/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">
                Pending token created - copy it now
              </div>
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

      <Group justify="space-between" align="center" gap="xs" mb="xs">
        <Title order={3} size="sm" fw={500}>
          Pending Enrollment Tokens
        </Title>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
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

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create pending token"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={createToken.isPending}>
              {createToken.isPending ? "Creating..." : "Create"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium text-foreground" htmlFor="pending-token-label">
              Label (optional)
            </label>
            <Input
              id="pending-token-label"
              value={tokenLabel}
              onChange={(e) => setTokenLabel(e.target.value)}
              placeholder="e.g., Production fleet"
            />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium text-foreground" htmlFor="pending-token-config">
              Target configuration (optional)
            </label>
            <select
              id="pending-token-config"
              value={targetConfigId}
              onChange={(e) => setTargetConfigId(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Any configuration</option>
              {configs?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              If not specified, the collector can be assigned to any configuration after connecting.
            </span>
          </div>
        </div>
      </Modal>
    </>
  );
}

function PendingDevicesSection() {
  const { data: devices, isLoading, error, refetch } = usePendingDevices();
  const assignDevice = useAssignPendingDevice();
  const { toast } = useToast();
  const { data: configs } = useConfigurations();

  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<PendingDevice | null>(null);
  const [targetConfigId, setTargetConfigId] = useState("");

  const deviceList = devices ?? [];

  async function handleAssign() {
    if (!selectedDevice || !targetConfigId) return;
    try {
      await assignDevice.mutateAsync({
        deviceUid: selectedDevice.instance_uid,
        configId: targetConfigId,
      });
      toast("Device assigned", "Collector assigned to configuration");
      setAssignOpen(false);
      setSelectedDevice(null);
      setTargetConfigId("");
    } catch (err) {
      toast("Failed to assign device", err instanceof Error ? err.message : "Unknown error", "err");
    }
  }

  function openAssignModal(device: PendingDevice) {
    setSelectedDevice(device);
    setAssignOpen(true);
  }

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const columns: ColumnDef<PendingDevice>[] = [
    {
      accessorKey: "display_name",
      header: "Display Name",
      cell: ({ row: _row }) => {
        const displayName = _row.getValue("display_name");
        return displayName ?? <span className="text-muted-foreground">—</span>;
      },
    },
    {
      accessorKey: "source_ip",
      header: "Source IP",
      cell: ({ row: _row }) => {
        const sourceIp = _row.getValue("source_ip");
        return sourceIp ?? <span className="text-muted-foreground">—</span>;
      },
    },
    {
      id: "location",
      header: "Location",
      cell: ({ row: _row }) => {
        const geoCountry = _row.original.geo_country;
        const geoCity = _row.original.geo_city;
        if (!geoCountry) return <span className="text-muted-foreground">—</span>;
        return geoCity ? `${geoCity}, ${geoCountry}` : geoCountry;
      },
    },
    {
      accessorKey: "connected_at",
      header: "Connected",
      cell: ({ row: _row }) => {
        const connectedAt = _row.getValue("connected_at") as number;
        return relTime(new Date(connectedAt).toISOString());
      },
    },
    {
      accessorKey: "last_seen_at",
      header: "Last Seen",
      cell: ({ row: _row }) => {
        const lastSeenAt = _row.getValue("last_seen_at") as number;
        return relTime(new Date(lastSeenAt).toISOString());
      },
    },
    {
      id: "actions",
      cell: ({ row: _row }) => {
        const device = _row.original;
        return (
          <Button variant="secondary" size="sm" onClick={() => openAssignModal(device)}>
            Assign
          </Button>
        );
      },
    },
  ];

  return (
    <>
      <Title order={3} size="sm" fw={500} mb="xs">
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
        open={assignOpen}
        onClose={() => {
          setAssignOpen(false);
          setSelectedDevice(null);
          setTargetConfigId("");
        }}
        title="Assign to configuration"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setAssignOpen(false);
                setSelectedDevice(null);
                setTargetConfigId("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleAssign()}
              disabled={!targetConfigId || assignDevice.isPending}
            >
              {assignDevice.isPending ? "Assigning..." : "Assign"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          {selectedDevice && (
            <div className="rounded-md border border-border bg-card p-3">
              <div className="text-sm">
                <span className="font-medium">
                  {selectedDevice.display_name ?? "Unknown device"}
                </span>
                {selectedDevice.source_ip && (
                  <span className="ml-2 text-muted-foreground">({selectedDevice.source_ip})</span>
                )}
              </div>
            </div>
          )}
          <div className="grid gap-2">
            <label className="text-sm font-medium text-foreground" htmlFor="assign-config">
              Target configuration
            </label>
            <select
              id="assign-config"
              value={targetConfigId}
              onChange={(e) => setTargetConfigId(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select configuration...</option>
              {configs?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
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
