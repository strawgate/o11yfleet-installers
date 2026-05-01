import { useDeferredValue, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAdminTenantsPage, useCreateTenant } from "../../api/hooks/admin";
import { useToast } from "../../components/common/Toast";
import { Modal } from "../../components/common/Modal";
import { EmptyState } from "../../components/common/EmptyState";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { PlanTag } from "@/components/common/PlanTag";
import { relTime } from "../../utils/format";
import { PLAN_OPTIONS } from "../../shared/plans";

export default function TenantsPage() {
  const [page, setPage] = useState(1);
  const [planFilter, setPlanFilter] = useState("all");
  const [filter, setFilter] = useState("");
  const deferredFilter = useDeferredValue(filter);
  const { data, isLoading, error, refetch } = useAdminTenantsPage({
    q: deferredFilter,
    plan: planFilter,
    page,
    limit: 25,
    sort: "newest",
  });
  const createTenant = useCreateTenant();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [plan, setPlan] = useState("starter");

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const tenantList = data?.tenants ?? [];
  const pagination = data?.pagination;
  const totalConfigs = tenantList.reduce((sum, tenant) => sum + (tenant.config_count ?? 0), 0);
  const totalAgents = tenantList.reduce((sum, tenant) => sum + (tenant.agent_count ?? 0), 0);

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

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tenants</h1>
          <p className="meta">Workspaces, plan limits, and direct troubleshooting entry points.</p>
        </div>
        <div className="actions">
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
        <div className="dt-toolbar">
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
        </div>
        {tenantList.length === 0 ? (
          <EmptyState
            icon={filter ? "search" : "users"}
            title={
              filter || planFilter !== "all" ? "No tenants match your filter" : "No tenants yet"
            }
            description={
              filter || planFilter !== "all"
                ? "Try a different name, tenant ID, or plan."
                : "Create a tenant to start onboarding a workspace."
            }
          >
            {!filter && planFilter === "all" ? (
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
              return (
                <article key={t.id} className="tenant-row">
                  <div className="tenant-main">
                    <Link to={`/admin/tenants/${t.id}`} className="tenant-name">
                      {t.name}
                    </Link>
                    <span className="meta mono tenant-id">{t.id}</span>
                  </div>
                  <div className="tenant-plan">
                    <PlanTag plan={t.plan ?? "starter"} />
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
