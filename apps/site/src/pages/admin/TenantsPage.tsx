import { useDeferredValue, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  useAdminTenantsPage,
  useCreateTenant,
  useBulkApproveTenants,
  useAdminSettings,
} from "../../api/hooks/admin";
import { useToast } from "../../components/common/Toast";
import { Modal } from "../../components/common/Modal";
import { EmptyState } from "../../components/common/EmptyState";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { PlanTag } from "@/components/common/PlanTag";
import { relTime } from "../../utils/format";
import { PLAN_OPTIONS } from "../../shared/plans";

type StatusFilter = "all" | "pending" | "active" | "suspended";

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    pending: { bg: "#f97316", color: "#fff", label: "Pending" },
    active: { bg: "#4fd27b", color: "#061008", label: "Active" },
    suspended: { bg: "#ef4444", color: "#fff", label: "Suspended" },
  };
  const style = styles[status] ?? { bg: "#6b7280", color: "#fff", label: status };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 500,
        background: style.bg,
        color: style.color,
      }}
    >
      {style.label}
    </span>
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
  const { toast } = useToast();
  const navigate = useNavigate();

  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [plan, setPlan] = useState("starter");
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

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

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      const result = await createTenant.mutateAsync({ name: name.trim(), plan });
      toast("Tenant created", name);
      setModalOpen(false);
      setName("");
      setPlan("starter");
      void navigate(`/admin/tenants/${result.id}`);
    } catch (err) {
      toast("Failed to create tenant", err instanceof Error ? err.message : "Unknown error", "err");
    }
  }

  async function handleBulkApprove() {
    const ids = Array.from(selectedTenants);
    if (ids.length === 0) return;

    try {
      const result = await bulkApprove.mutateAsync({ tenant_ids: ids });
      const approvedCount = result.approved.length;
      const failedCount = result.failed.length;

      toast(
        `Approved ${approvedCount} tenant${approvedCount !== 1 ? "s" : ""}`,
        failedCount > 0 ? `${failedCount} failed` : undefined,
        failedCount > 0 ? "err" : undefined,
      );

      setSelectedTenants(new Set());
      setBulkConfirmOpen(false);
      void refetch();
    } catch (err) {
      toast("Bulk approve failed", err instanceof Error ? err.message : "Unknown error", "err");
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

  const statusFilters: { key: StatusFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: pendingCount + activeCount + suspendedCount },
    { key: "pending", label: "Pending", count: pendingCount },
    { key: "active", label: "Active", count: activeCount },
    { key: "suspended", label: "Suspended", count: suspendedCount },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tenants</h1>
          <p className="meta">Workspaces, plan limits, and direct troubleshooting entry points.</p>
        </div>
        <div className="actions">
          {/* Auto-approve indicator */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginRight: 16,
              padding: "6px 12px",
              background: settings.data?.auto_approve_signups ? "#4fd27b22" : "#f9731622",
              borderRadius: 6,
              fontSize: 13,
              color: settings.data?.auto_approve_signups ? "#4fd27b" : "#f97316",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: settings.data?.auto_approve_signups ? "#4fd27b" : "#f97316",
              }}
            />
            {settings.data?.auto_approve_signups ? "Auto-approve ON" : "Manual approval"}
          </div>
          <button
            className="btn btn-secondary"
            onClick={() => setBulkConfirmOpen(true)}
            disabled={selectedTenants.size === 0 || bulkApprove.isPending}
          >
            {bulkApprove.isPending ? "Approving..." : `Approve Selected (${selectedTenants.size})`}
          </button>
          <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
            Create tenant
          </button>
        </div>
      </div>

      <div className="tenant-summary-grid">
        <div className="stat">
          <div className="val">{pagination?.total ?? 0}</div>
          <div className="label">Matching tenants</div>
        </div>
        <div className="stat">
          <div className="val">{totalConfigs}</div>
          <div className="label">Configurations</div>
        </div>
        <div className="stat">
          <div className="val">{totalAgents}</div>
          <div className="label">Collectors</div>
        </div>
      </div>

      <div className="dt-card">
        <div className="dt-toolbar" style={{ flexWrap: "wrap", gap: 12 }}>
          <input
            className="input"
            aria-label="Filter tenants by name, ID, or plan"
            placeholder="Filter by name, ID, or plan…"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
            style={{ maxWidth: 280 }}
          />
          <select
            className="input"
            aria-label="Filter by plan"
            value={planFilter}
            onChange={(e) => {
              setPlanFilter(e.target.value);
              setPage(1);
            }}
            style={{ maxWidth: 180 }}
          >
            <option value="all">All plans</option>
            {PLAN_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>

          {/* Status filter tabs */}
          <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
            {statusFilters.map((sf) => (
              <button
                key={sf.key}
                className={`tab${statusFilter === sf.key ? " active" : ""}`}
                onClick={() => {
                  setStatusFilter(sf.key);
                  setPage(1);
                }}
                style={{ padding: "6px 12px", fontSize: 13 }}
              >
                {sf.label}
                {sf.count > 0 && (
                  <span
                    style={{
                      marginLeft: 6,
                      padding: "1px 6px",
                      borderRadius: 10,
                      fontSize: 11,
                      background:
                        sf.key === "pending"
                          ? "#f9731633"
                          : sf.key === "active"
                            ? "#4fd27b33"
                            : "#6b728033",
                      color:
                        sf.key === "pending"
                          ? "#f97316"
                          : sf.key === "active"
                            ? "#4fd27b"
                            : "#9ca3af",
                    }}
                  >
                    {sf.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

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
              <button className="btn btn-primary btn-sm" onClick={() => setModalOpen(true)}>
                Create tenant
              </button>
            ) : null}
          </EmptyState>
        ) : (
          <div className="tenant-list">
            {tenantList.map((t) => {
              const configCount = t.config_count ?? 0;
              const maxAgentsPerConfig = t.max_agents_per_config ?? 0;
              const totalAgentCapacity = configCount * maxAgentsPerConfig;
              const isSelected = selectedTenants.has(t.id);
              const isPending = t.status === "pending";

              return (
                <article
                  key={t.id}
                  className="tenant-row"
                  style={{
                    background: isSelected ? "rgba(79, 210, 123, 0.05)" : undefined,
                    borderLeft: isSelected ? "3px solid #4fd27b" : undefined,
                  }}
                >
                  {/* Checkbox for pending tenants */}
                  {isPending && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleTenantSelection(t.id)}
                      style={{ marginRight: 12, width: 18, height: 18, cursor: "pointer" }}
                    />
                  )}

                  <div className="tenant-main">
                    <Link to={`/admin/tenants/${t.id}`} className="tenant-name">
                      {t.name}
                    </Link>
                    <span className="meta mono tenant-id">{t.id}</span>
                  </div>
                  <div className="tenant-plan">
                    <PlanTag plan={t.plan ?? "starter"} />
                    <div style={{ marginTop: 6 }}>
                      <StatusBadge status={t.status} />
                    </div>
                  </div>
                  <div className="tenant-stats">
                    <span>
                      <strong>{configCount}</strong>
                      <span className="meta">policies / {t.max_configs ?? "—"}</span>
                    </span>
                    <span>
                      <strong>{t.agent_count ?? 0}</strong>
                      <span className="meta">
                        {t.connected_agents ?? 0} connected / {totalAgentCapacity.toLocaleString()}{" "}
                        capacity
                      </span>
                    </span>
                    <span>
                      <strong>{relTime(t.created_at)}</strong>
                      <span className="meta">created</span>
                    </span>
                  </div>
                  <div className="tenant-actions">
                    <Link to={`/admin/tenants/${t.id}`} className="btn btn-secondary btn-sm">
                      Open
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {pagination ? (
          <div className="support-list-footer mt-3">
            <span className="meta">
              Page {pagination.page} · Showing {tenantList.length} of {pagination.total} matching
              tenants
              {selectedTenants.size > 0 && ` (${selectedTenants.size} selected)`}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn-ghost btn-sm"
                disabled={pagination.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={!pagination.has_more}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Bulk Approve Confirmation Modal */}
      <Modal
        open={bulkConfirmOpen}
        onClose={() => setBulkConfirmOpen(false)}
        title="Approve selected tenants"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setBulkConfirmOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void handleBulkApprove()}
              disabled={bulkApprove.isPending}
            >
              {bulkApprove.isPending
                ? "Approving..."
                : `Approve ${selectedTenants.size} tenant${selectedTenants.size !== 1 ? "s" : ""}`}
            </button>
          </>
        }
      >
        <p style={{ marginBottom: 16 }}>
          You are about to approve <strong>{selectedTenants.size}</strong> tenant
          {selectedTenants.size !== 1 ? "s" : ""}. They will receive an email notification.
        </p>
        <div
          style={{
            background: "#1a1d24",
            borderRadius: 8,
            padding: 16,
            maxHeight: 200,
            overflow: "auto",
          }}
        >
          {tenantList
            .filter((t) => selectedTenants.has(t.id))
            .map((t) => (
              <div key={t.id} style={{ padding: "4px 0", borderBottom: "1px solid #252b35" }}>
                <strong>{t.name}</strong>
                <span className="meta" style={{ marginLeft: 8 }}>
                  {t.plan}
                </span>
              </div>
            ))}
        </div>
      </Modal>

      {/* Create Tenant Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Create tenant"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void handleCreate()}
              disabled={!name.trim() || createTenant.isPending}
            >
              {createTenant.isPending ? "Creating…" : "Create tenant"}
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="tenant-name">Name</label>
          <input
            id="tenant-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tenant name"
            autoFocus
          />
        </div>
        <div className="field mt-6">
          <label htmlFor="tenant-plan">Plan</label>
          <select
            id="tenant-plan"
            className="input"
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
          >
            {PLAN_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} ({option.audience})
              </option>
            ))}
          </select>
        </div>
      </Modal>
    </>
  );
}
