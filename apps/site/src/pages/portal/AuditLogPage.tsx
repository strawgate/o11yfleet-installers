import { useState } from "react";
import { useAuditLogs, useTenant, type AuditLogFilters } from "@/api/hooks/portal";
import { DataTable, type ColumnDef } from "@/components/data-table";
import { EmptyState, PageHeader, PageShell, StatusBadge } from "@/components/app";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  // Hold the upgrade CTA until the tenant query resolves; otherwise
  // enterprise users briefly see the upgrade screen on first paint.
  if (tenantLoading) {
    return (
      <PageShell>
        <PageHeader title="Audit Log" description="Track every user action in your tenant." />
        <LoadingSpinner />
      </PageShell>
    );
  }

  // Tenant query failure must not silently route enterprise users to the
  // upgrade CTA — surface the error and let them retry.
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

  return (
    <PageShell>
      <PageHeader
        title="Audit Log"
        description="Every mutating user action in this tenant. Read-only."
      />

      <div className="flex flex-wrap items-end gap-3 pb-4">
        <FilterField label="Action">
          <Input
            placeholder="e.g. configuration.update"
            value={filters.action ?? ""}
            onChange={(e) =>
              setFilters((f) => ({ ...f, action: e.target.value, cursor: undefined }))
            }
          />
        </FilterField>
        <FilterField label="Resource type">
          <select
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            value={filters.resource_type ?? ""}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                resource_type: e.target.value || undefined,
                cursor: undefined,
              }))
            }
          >
            <option value="">All</option>
            {AUDIT_RESOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Resource id">
          <Input
            placeholder="resource id"
            value={filters.resource_id ?? ""}
            onChange={(e) =>
              setFilters((f) => ({ ...f, resource_id: e.target.value, cursor: undefined }))
            }
          />
        </FilterField>
        <FilterField label="Actor user id">
          <Input
            placeholder="user id"
            value={filters.actor_user_id ?? ""}
            onChange={(e) =>
              setFilters((f) => ({ ...f, actor_user_id: e.target.value, cursor: undefined }))
            }
          />
        </FilterField>
        <Button variant="outline" onClick={() => setFilters({})}>
          Reset
        </Button>
      </div>

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
            <div className="flex justify-center p-4">
              <Button
                variant="outline"
                onClick={() => setFilters((f) => ({ ...f, cursor: data.next_cursor ?? undefined }))}
              >
                Next page
              </Button>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
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
    cell: ({ row }) => <code className="text-xs">{row.original.action}</code>,
  },
  {
    id: "resource",
    header: "Resource",
    cell: ({ row }) => (
      <span className="text-xs">
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
        <span className="text-xs">
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
    cell: ({ row }) => <span className="text-xs">{row.original.actor.ip ?? "—"}</span>,
  },
];
