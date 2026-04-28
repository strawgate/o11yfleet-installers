import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  useAdminTenant,
  useAdminTenantConfigs,
  useAdminTenantUsers,
  useUpdateAdminTenant,
  useDeleteAdminTenant,
} from "../../api/hooks/admin";
import { useToast } from "../../components/common/Toast";
import { Modal } from "../../components/common/Modal";
import { CopyButton } from "../../components/common/CopyButton";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { relTime } from "../../utils/format";

type Tab = "overview" | "configurations" | "users" | "settings";

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const tenant = useAdminTenant(id);
  const configs = useAdminTenantConfigs(id);
  const users = useAdminTenantUsers(id);
  const updateTenant = useUpdateAdminTenant(id!);
  const deleteTenant = useDeleteAdminTenant(id!);

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [editName, setEditName] = useState("");
  const [editPlan, setEditPlan] = useState("free");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (tenant.data?.name && !editName) {
      setEditName(tenant.data.name);
    }
    if (tenant.data?.plan) {
      setEditPlan(tenant.data.plan);
    }
  }, [tenant.data, editName]);

  if (tenant.isLoading) return <LoadingSpinner />;
  if (tenant.error) return <ErrorState error={tenant.error} retry={() => void tenant.refetch()} />;

  const t = tenant.data;
  if (!t) return <ErrorState error={new Error("Tenant not found")} />;

  const configList = configs.data ?? [];
  const userList = users.data ?? [];

  const planTag = (plan: string) => {
    const isPremium = plan === "pro" || plan === "enterprise";
    return (
      <span
        className="tag"
        style={
          isPremium ? { color: "var(--accent)", borderColor: "var(--accent-line)" } : undefined
        }
      >
        {plan}
      </span>
    );
  };

  async function handleSave() {
    try {
      await updateTenant.mutateAsync({ name: editName.trim(), plan: editPlan });
      toast("Tenant updated");
    } catch (err) {
      toast("Failed to save", err instanceof Error ? err.message : "Unknown error", "err");
    }
  }

  async function handleDelete() {
    try {
      await deleteTenant.mutateAsync();
      toast("Tenant deleted", t!.name);
      navigate("/admin/tenants");
    } catch (err) {
      toast("Delete failed", err instanceof Error ? err.message : "Unknown error", "err");
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "configurations", label: "Configurations" },
    { key: "users", label: "Users" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.name}</h1>
        </div>
        <div className="actions">
          {planTag(t.plan ?? "free")}
          <Link
            to={`/portal/overview?tenant=${encodeURIComponent(t.id)}`}
            className="btn btn-ghost btn-sm"
          >
            Open portal
          </Link>
        </div>
      </div>

      <div className="tabs mt-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`tab${activeTab === tab.key ? " active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {activeTab === "overview" && (
        <div className="card card-pad mt-6">
          <h3>Tenant details</h3>
          <table className="dt mt-2">
            <tbody>
              <tr>
                <td className="meta">Plan</td>
                <td>{planTag(t.plan ?? "free")}</td>
              </tr>
              <tr>
                <td className="meta">Configurations</td>
                <td>{configList.length}</td>
              </tr>
              <tr>
                <td className="meta">Users</td>
                <td>{userList.length}</td>
              </tr>
              <tr>
                <td className="meta">Created</td>
                <td>{relTime(t.created_at)}</td>
              </tr>
              <tr>
                <td className="meta">Tenant ID</td>
                <td className="mono-cell">
                  <span style={{ marginRight: 8 }}>{t.id}</span>
                  <CopyButton value={t.id} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Configurations tab */}
      {activeTab === "configurations" && (
        <div className="dt-card mt-6">
          {configs.isLoading ? (
            <LoadingSpinner />
          ) : (
            <table className="dt">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Agents</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {configList.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="meta" style={{ textAlign: "center", padding: 32 }}>
                      No configurations found.
                    </td>
                  </tr>
                ) : (
                  configList.map((c) => (
                    <tr key={c.id}>
                      <td className="name">{c.name}</td>
                      <td>{(c["agents"] as number) ?? "—"}</td>
                      <td>
                        <span
                          className={`tag tag-${(c["status"] as string) === "active" ? "ok" : "warn"}`}
                        >
                          {(c["status"] as string) ?? "unknown"}
                        </span>
                      </td>
                      <td className="meta">{relTime(c["updated_at"] as string | undefined)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Users tab */}
      {activeTab === "users" && (
        <div className="dt-card mt-6">
          {users.isLoading ? (
            <LoadingSpinner />
          ) : (
            <table className="dt">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {userList.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="meta" style={{ textAlign: "center", padding: 32 }}>
                      No users found.
                    </td>
                  </tr>
                ) : (
                  userList.map((u) => (
                    <tr key={u.id}>
                      <td>{u.email}</td>
                      <td>{(u["name"] as string) ?? "—"}</td>
                      <td>
                        <span
                          className="tag"
                          style={
                            u.role === "admin"
                              ? { color: "var(--accent)", borderColor: "var(--accent)" }
                              : undefined
                          }
                        >
                          {u.role ?? "member"}
                        </span>
                      </td>
                      <td className="meta">{relTime(u["created_at"] as string | undefined)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Settings tab */}
      {activeTab === "settings" && (
        <div>
          <div className="card card-pad mt-6">
            <h3>General</h3>

            <div className="field mt-6">
              <label>Tenant name</label>
              <input
                className="input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>

            <div className="field mt-6">
              <label>Plan</label>
              <select
                className="input"
                value={editPlan}
                onChange={(e) => setEditPlan(e.target.value)}
              >
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>

            <button
              className="btn btn-primary mt-6"
              onClick={() => void handleSave()}
              disabled={
                updateTenant.isPending ||
                (editName.trim() === t.name && editPlan === (t.plan ?? "free"))
              }
            >
              {updateTenant.isPending ? "Saving…" : "Save changes"}
            </button>
          </div>

          <div className="danger-zone mt-6">
            <div className="dz-head">Danger zone</div>
            <div className="row">
              <div className="desc">
                <strong>Delete tenant</strong>
                <p className="meta">
                  Permanently delete this tenant and all its data. This action cannot be undone.
                </p>
              </div>
              <button className="btn btn-danger" onClick={() => setDeleteOpen(true)}>
                Delete tenant
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          setConfirmText("");
        }}
        title="Delete tenant"
        footer={
          <>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setDeleteOpen(false);
                setConfirmText("");
              }}
            >
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={() => void handleDelete()}
              disabled={confirmText !== "delete" || deleteTenant.isPending}
            >
              {deleteTenant.isPending ? "Deleting…" : "Delete permanently"}
            </button>
          </>
        }
      >
        <p>
          Type <strong>delete</strong> to confirm.
        </p>
        <input
          className="input mt-2"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="delete"
          autoFocus
        />
      </Modal>
    </>
  );
}
