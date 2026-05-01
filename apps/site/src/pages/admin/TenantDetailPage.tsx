import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  useAdminTenant,
  useAdminTenantConfigs,
  useAdminTenantUsers,
  useUpdateAdminTenant,
  useDeleteAdminTenant,
  useImpersonateTenant,
} from "../../api/hooks/admin";
import { useAdminGuidance } from "../../api/hooks/ai";
import { apiBase } from "../../api/client";
import { GuidancePanel } from "../../components/ai";
import { useToast } from "../../components/common/Toast";
import { Modal } from "../../components/common/Modal";
import { CopyButton } from "../../components/common/CopyButton";
import { EmptyState } from "../../components/common/EmptyState";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { PlanTag } from "@/components/common/PlanTag";
import { PLAN_OPTIONS, normalizePlanId } from "../../shared/plans";
import { relTime } from "../../utils/format";
import {
  buildInsightRequest,
  insightSurfaces,
  insightTarget,
  tabInsightTarget,
} from "../../ai/insight-registry";
import { emailDomain } from "./ai-context-utils";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";

type Tab = "overview" | "configurations" | "users" | "settings";

const TAB_KEYS = ["overview", "configurations", "users", "settings"] as const;
const isTab = (value: string | null): value is Tab =>
  value !== null && (TAB_KEYS as readonly string[]).includes(value);

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  const tenant = useAdminTenant(id);
  const configs = useAdminTenantConfigs(id);
  const users = useAdminTenantUsers(id);
  const updateTenant = useUpdateAdminTenant(id!);
  const deleteTenant = useDeleteAdminTenant(id!);
  const impersonateTenant = useImpersonateTenant(id!);

  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<Tab>(isTab(tabParam) ? tabParam : "overview");
  const [editName, setEditName] = useState("");
  const [editPlan, setEditPlan] = useState("starter");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    setActiveTab(isTab(tabParam) ? tabParam : "overview");
  }, [tabParam]);

  useEffect(() => {
    if (tenant.data?.name && !editName) {
      setEditName(tenant.data.name);
    }
    if (tenant.data?.plan) {
      setEditPlan(normalizePlanId(tenant.data.plan));
    }
  }, [tenant.data, editName]);

  const t = tenant.data;
  const currentPlan = normalizePlanId(t?.plan);
  const configList = configs.data ?? [];
  const userList = users.data ?? [];
  const overviewGuidanceReady =
    activeTab === "overview" && Boolean(t) && configs.isSuccess && users.isSuccess;
  const insightSurface = insightSurfaces.adminTenant;
  const guidanceRequest: AiGuidanceRequest | null =
    overviewGuidanceReady && t
      ? buildInsightRequest(
          insightSurface,
          [
            insightTarget(insightSurface, insightSurface.targets.page),
            insightTarget(insightSurface, insightSurface.targets.configurations),
            insightTarget(insightSurface, insightSurface.targets.users),
            tabInsightTarget(insightSurface, "admin.tenant.tab", activeTab),
          ],
          {
            tenant_id: t.id,
            tenant_name: t.name,
            plan: currentPlan,
            active_tab: activeTab,
            config_count: configList.length,
            user_count: userList.length,
            max_configs: (t["max_configs"] as number) ?? null,
            config_limit_utilization:
              typeof t["max_configs"] === "number" && t["max_configs"] > 0
                ? configList.length / t["max_configs"]
                : null,
            max_agents_per_config: (t["max_agents_per_config"] as number) ?? null,
            created_at: t.created_at ?? null,
            configurations: configList.slice(0, 12).map((config) => ({
              id: config.id,
              name: config.name,
              status: config["status"] ?? null,
              agents: config["agents"] ?? null,
              updated_at: config["updated_at"] ?? null,
            })),
            users: userList.slice(0, 12).map((user) => ({
              id: user.id,
              email_domain: emailDomain(user.email),
              role: user.role ?? "member",
              created_at: user["created_at"] ?? null,
            })),
          },
        )
      : null;
  const guidance = useAdminGuidance(guidanceRequest);

  if (tenant.isLoading) return <LoadingSpinner />;
  if (tenant.error) return <ErrorState error={tenant.error} retry={() => void tenant.refetch()} />;
  if (!t) return <ErrorState error={new Error("Tenant not found")} />;

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

  async function handleImpersonate() {
    try {
      await impersonateTenant.mutateAsync();
      const destination = new URL("/portal/overview", window.location.origin);
      if (
        apiBase &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
      ) {
        destination.searchParams.set("api", apiBase);
      }
      window.location.assign(destination.pathname + destination.search);
    } catch (err) {
      toast("Failed to view tenant", err instanceof Error ? err.message : "Unknown error", "err");
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "configurations", label: "Configurations" },
    { key: "users", label: "Users" },
    { key: "settings", label: "Settings" },
  ];

  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
    setSearchParams(tab === "overview" ? {} : { tab });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.name}</h1>
        </div>
        <div className="actions">
          {<PlanTag plan={t.plan ?? "starter"} />}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void handleImpersonate()}
            disabled={impersonateTenant.isPending}
          >
            {impersonateTenant.isPending ? "Opening..." : "View as tenant"}
          </button>
        </div>
      </div>

      <div className="tabs mt-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`tab${activeTab === tab.key ? " active" : ""}`}
            onClick={() => handleTabChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {activeTab === "overview" && (
        <>
          <div className="card card-pad mt-6">
            <h3>Tenant details</h3>
            <table className="dt mt-2">
              <tbody>
                <tr>
                  <td className="meta">Plan</td>
                  <td>
                    <PlanTag plan={t.plan ?? "starter"} />
                  </td>
                </tr>
                <tr>
                  <td className="meta">Policies</td>
                  <td>{configList.length}</td>
                </tr>
                <tr>
                  <td className="meta">Policy limit</td>
                  <td>{String(t.max_configs ?? "—")}</td>
                </tr>
                <tr>
                  <td className="meta">Collector limit</td>
                  <td>{String(t.max_agents_per_config ?? "—")}</td>
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
          <GuidancePanel
            title="Tenant operations"
            guidance={guidance.data}
            isLoading={guidance.isLoading}
            error={guidance.error}
            onRefresh={() => void guidance.refetch()}
          />
        </>
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
                    <td colSpan={4}>
                      <EmptyState
                        icon="file"
                        title="No configurations found"
                        description="This tenant does not have any managed collector configurations yet."
                      />
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
                    <td colSpan={4}>
                      <EmptyState
                        icon="users"
                        title="No users found"
                        description="Users will appear here after they join or are provisioned."
                      />
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
              <label htmlFor="admin-tenant-name">Tenant name</label>
              <input
                id="admin-tenant-name"
                className="input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>

            <div className="field mt-6">
              <label htmlFor="admin-tenant-plan">Plan</label>
              <select
                id="admin-tenant-plan"
                className="input"
                value={editPlan}
                onChange={(e) => setEditPlan(e.target.value)}
              >
                {PLAN_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} ({option.audience})
                  </option>
                ))}
              </select>
            </div>

            <button
              className="btn btn-primary mt-6"
              onClick={() => void handleSave()}
              disabled={
                updateTenant.isPending || (editName.trim() === t.name && editPlan === currentPlan)
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
        <label className="sr-only" htmlFor="delete-confirmation">
          Delete confirmation
        </label>
        <input
          id="delete-confirmation"
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
