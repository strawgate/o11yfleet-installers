import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTenant, useUpdateTenant, useDeleteTenant } from "../../api/hooks/portal";
import { useAuth } from "../../api/hooks/auth";
import { useToast } from "../../components/common/Toast";
import { Modal } from "../../components/common/Modal";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";

export default function SettingsPage() {
  const tenant = useTenant();
  const updateTenant = useUpdateTenant();
  const deleteTenant = useDeleteTenant();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (tenant.data?.name && !name) {
      setName(tenant.data.name);
    }
  }, [tenant.data, name]);

  if (tenant.isLoading) return <LoadingSpinner />;
  if (tenant.error) return <ErrorState error={tenant.error} retry={() => void tenant.refetch()} />;

  const t = tenant.data;

  async function handleSave() {
    try {
      await updateTenant.mutateAsync({ name: name.trim() });
      toast("Settings saved");
    } catch (err) {
      toast("Failed to save", err instanceof Error ? err.message : "Unknown error", "err");
    }
  }

  async function handleDelete() {
    try {
      await deleteTenant.mutateAsync();
      toast("Workspace deleted");
      navigate("/");
    } catch (err) {
      toast("Delete failed", err instanceof Error ? err.message : "Unknown error", "err");
    }
  }

  return (
    <div className="main-narrow">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      {/* Admin banner */}
      {user && (
        <div className="admin-banner mb-6">
          <span className="pulse" />
          <span className="lbl">Signed in as</span>
          <span className="who">{user.name ?? user.email}</span>
        </div>
      )}

      {/* General */}
      <div className="card card-pad">
        <h3>General</h3>

        <div className="field mt-6">
          <label>Workspace name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="field mt-6">
          <label>Tenant ID</label>
          <input className="input mono" value={t?.id ?? ""} readOnly />
          <span className="help">Read-only identifier for your workspace.</span>
        </div>

        <button
          className="btn btn-primary mt-6"
          onClick={() => void handleSave()}
          disabled={updateTenant.isPending || name.trim() === (t?.name ?? "")}
        >
          {updateTenant.isPending ? "Saving…" : "Save changes"}
        </button>
      </div>

      {/* Danger zone */}
      <div className="danger-zone mt-6">
        <div className="dz-head">Danger zone</div>
        <div className="row">
          <div className="desc">
            <strong>Delete workspace</strong>
            <p className="meta">
              Permanently delete this workspace and all its data. This action cannot be undone.
            </p>
          </div>
          <button className="btn btn-danger" onClick={() => setDeleteOpen(true)}>
            Delete workspace
          </button>
        </div>
      </div>

      <Modal
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          setConfirmText("");
        }}
        title="Delete workspace"
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
    </div>
  );
}
