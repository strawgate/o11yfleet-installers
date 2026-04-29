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
    ? tenantList.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase()))
    : tenantList;

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
        <h1>Tenants</h1>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
            Create tenant
          </button>
        </div>
      </div>

      <div className="dt-card">
        <div className="dt-toolbar">
          <input
            className="input"
            placeholder="Filter by name…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ maxWidth: 280 }}
          />
        </div>
        <table className="dt">
          <thead>
            <tr>
              <th>Name</th>
              <th>Plan</th>
              <th>Configs</th>
              <th>Agents</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <EmptyState
                    icon={filter ? "search" : "users"}
                    title={filter ? "No tenants match your filter" : "No tenants yet"}
                    description={
                      filter
                        ? "Try a different name or clear the filter to see all tenants."
                        : "Create a tenant to start onboarding a workspace."
                    }
                  >
                    {!filter ? (
                      <button className="btn btn-primary btn-sm" onClick={() => setModalOpen(true)}>
                        Create tenant
                      </button>
                    ) : null}
                  </EmptyState>
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr key={t.id} className="clickable">
                  <td className="name">
                    <Link to={`/admin/tenants/${t.id}`}>{t.name}</Link>
                  </td>
                  <td>
                    <PlanTag plan={t.plan ?? "free"} />
                  </td>
                  <td>{(t["max_configs"] as number) ?? "—"}</td>
                  <td>{(t["max_agents_per_config"] as number) ?? "—"}</td>
                  <td className="meta">{relTime(t.created_at)}</td>
                  <td style={{ width: 32 }}>
                    <Link to={`/admin/tenants/${t.id}`}>→</Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
              {createTenant.isPending ? "Creating…" : "Create"}
            </button>
          </>
        }
      >
        <div className="field">
          <label>Name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tenant name"
            autoFocus
          />
        </div>
        <div className="field mt-6">
          <label>Plan</label>
          <select className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>
      </Modal>
    </>
  );
}
