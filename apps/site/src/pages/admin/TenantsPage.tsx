import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAdminTenants, useCreateTenant } from "../../api/hooks/admin";
import { useToast } from "../../components/common/Toast";
import { Modal } from "../../components/common/Modal";
import { EmptyState } from "../../components/common/EmptyState";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { PlanTag } from "@/components/common/PlanTag";
import { relTime } from "../../utils/format";

export default function TenantsPage() {
  const { data: tenants, isLoading, error, refetch } = useAdminTenants();
  const createTenant = useCreateTenant();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [filter, setFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [plan, setPlan] = useState("free");

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const tenantList = tenants ?? [];
  const filtered = filter
    ? tenantList.filter((t) =>
        `${t.name} ${t.id} ${t.plan ?? ""}`.toLowerCase().includes(filter.toLowerCase()),
      )
    : tenantList;
  const totalConfigs = tenantList.reduce((sum, tenant) => sum + (tenant.config_count ?? 0), 0);
  const totalAgents = tenantList.reduce((sum, tenant) => sum + (tenant.agent_count ?? 0), 0);

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      const result = await createTenant.mutateAsync({ name: name.trim(), plan });
      toast("Tenant created", name);
      setModalOpen(false);
      setName("");
      setPlan("free");
      navigate(`/admin/tenants/${result.id}`);
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
          <div className="val">{tenantList.length}</div>
          <div className="label">Tenants</div>
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
            onChange={(e) => setFilter(e.target.value)}
            style={{ maxWidth: 280 }}
          />
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            icon={filter ? "search" : "users"}
            title={filter ? "No tenants match your filter" : "No tenants yet"}
            description={
              filter
                ? "Try a different name, tenant ID, or plan."
                : "Create a tenant to start onboarding a workspace."
            }
          >
            {!filter ? (
              <button className="btn btn-primary btn-sm" onClick={() => setModalOpen(true)}>
                Create tenant
              </button>
            ) : null}
          </EmptyState>
        ) : (
          <div className="tenant-list">
            {filtered.map((t) => {
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
                    <PlanTag plan={t.plan ?? "free"} />
                  </div>
                  <div className="tenant-stats">
                    <span>
                      <strong>{configCount}</strong>
                      <span className="meta">configs / {t.max_configs ?? "—"}</span>
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
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>
      </Modal>
    </>
  );
}
