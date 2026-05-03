import { useState } from "react";
import { Button, Code, Group, Select, TextInput } from "@mantine/core";
import { useAuditLogs, useTenant, type AuditLogFilters } from "@/api/hooks/portal";
import { DataTable, type ColumnDef } from "@/components/data-table";
import { EmptyState, PageHeader, PageShell, StatusBadge } from "@/components/app";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { relTime } from "@/utils/format";
import type { AuditLogEntry } from "@o11yfleet/core/api";
import { AUDIT_RESOURCE_TYPES } from "@o11yfleet/core/audit";

export default function AuditLogPage() {
  const {
    data: tenant,
    isLoading: tenantLoading,
    error: tenantError,
    refetch: refetchTenant,
  } = useTenant();
  const isEnterprise = tenant?.plan === "enterprise";

  const [filters, setFilters] = useState<AuditLogFilters>({});
  const { data, isLoading, error, refetch } = useAuditLogs(filters, isEnterprise);

  if (tenantLoading) {
    return (
      <PageShell>
        <PageHeader title="Audit Log" description="Track every user action in your tenant." />
        <LoadingSpinner />
      </PageShell>
    );
  }

  if (tenantError) {
    return (
      <PageShell>
        <PageHeader title="Audit Log" description="Track every user action in your tenant." />
        <ErrorState
          error={tenantError}
          retry={() => {
            void refetchTenant();
          }}
        />
      </PageShell>
    );
  }

  if (!isEnterprise) {
    return (
      <PageShell>
        <PageHeader title="Audit Log" description="Track every user action in your tenant." />
        <EmptyState
          icon="activity"
          title="Audit log access is an Enterprise feature"
          description="Upgrade to Enterprise to view and export your tenant's audit history."
        >
          <Button onClick={() => (window.location.href = "/pricing")}>See plans</Button>
        </EmptyState>
      </PageShell>
    );
  }

  const entries = data?.entries ?? [];

  const resourceTypeOptions = [
    { value: "", label: "All" },
    ...AUDIT_RESOURCE_TYPES.map((t) => ({ value: t, label: t })),
  ];

  return (
    <PageShell>
      <PageHeader
        title="Audit Log"
        description="Every mutating user action in this tenant. Read-only."
      />

      <Group align="flex-end" gap="md" wrap="wrap" pb="md">
        <TextInput
          label="Action"
          placeholder="e.g. configuration.update"
          value={filters.action ?? ""}
          onChange={(e) =>
            setFilters((f) => ({ ...f, action: e.currentTarget.value, cursor: undefined }))
          }
        />
        <Select
          label="Resource type"
          value={filters.resource_type ?? ""}
          onChange={(value) =>
            setFilters((f) => ({
              ...f,
              resource_type: value || undefined,
              cursor: undefined,
            }))
          }
          data={resourceTypeOptions}
          allowDeselect={false}
        />
        <TextInput
          label="Resource id"
          placeholder="resource id"
          value={filters.resource_id ?? ""}
          onChange={(e) =>
            setFilters((f) => ({ ...f, resource_id: e.currentTarget.value, cursor: undefined }))
          }
        />
        <TextInput
          label="Actor user id"
          placeholder="user id"
          value={filters.actor_user_id ?? ""}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              actor_user_id: e.currentTarget.value,
              cursor: undefined,
            }))
          }
        />
        <Button variant="default" onClick={() => setFilters({})}>
          Reset
        </Button>
      </Group>

      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorState
          error={error}
          retry={() => {
            void refetch();
          }}
        />
      ) : entries.length === 0 ? (
        <EmptyState
          icon="activity"
          title="No audit events"
          description="No events match the current filters."
        />
      ) : (
        <>
          <DataTable<AuditLogEntry> columns={columns} data={entries} getRowId={(row) => row.id} />
          {data?.next_cursor && (
            <Group justify="center" p="md">
              <Button
                variant="default"
                onClick={() => setFilters((f) => ({ ...f, cursor: data.next_cursor ?? undefined }))}
              >
                Next page
              </Button>
            </Group>
          )}
        </>
      )}
    </PageShell>
  );
}

const columns: ColumnDef<AuditLogEntry>[] = [
  {
    id: "created_at",
    header: "When",
    cell: ({ row }) => (
      <span title={row.original.created_at}>{relTime(row.original.created_at)}</span>
    ),
  },
  {
    id: "action",
    header: "Action",
    cell: ({ row }) => <Code>{row.original.action}</Code>,
  },
  {
    id: "resource",
    header: "Resource",
    cell: ({ row }) => (
      <span style={{ fontSize: 12 }}>
        {row.original.resource_type}
        {row.original.resource_id ? ` / ${row.original.resource_id}` : ""}
      </span>
    ),
  },
  {
    id: "actor",
    header: "Actor",
    cell: ({ row }) => {
      const a = row.original.actor;
      const label = a.email ?? a.user_id ?? (a.api_key_id ? "api key" : "—");
      return (
        <span style={{ fontSize: 12 }}>
          {label}
          {a.impersonator_user_id ? " (via support)" : ""}
        </span>
      );
    },
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge tone={row.original.status === "success" ? "ok" : "error"}>
        {row.original.status_code ?? row.original.status}
      </StatusBadge>
    ),
  },
  {
    id: "ip",
    header: "IP",
    cell: ({ row }) => <span style={{ fontSize: 12 }}>{row.original.actor.ip ?? "—"}</span>,
  },
];
