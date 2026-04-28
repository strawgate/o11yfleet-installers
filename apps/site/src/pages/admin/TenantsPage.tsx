import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAdminTenants, useCreateTenant } from "../../api/hooks/admin";
import { useToast } from "../../components/common/Toast";
import { Modal } from "../../components/common/Modal";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
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

  const planTag = (p: string) => {
    const isPremium = p === "pro" || p === "enterprise";
    return (
      <span
        className="tag"
        style={
          isPremium ? { color: "var(--accent)", borderColor: "var(--accent-line)" } : undefined
        }
      >
        {p}
      </span>
    );
  };

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
                <td colSpan={6} className="meta" style={{ textAlign: "center", padding: 32 }}>
                  {filter
                    ? "No tenants match your filter."
                    : "No tenants yet. Create one to get started."}
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr key={t.id} className="clickable">
                  <td className="name">
                    <Link to={`/admin/tenants/${t.id}`}>{t.name}</Link>
                  </td>
                  <td>{planTag(t.plan ?? "free")}</td>
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
