import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/api/hooks/auth";
import { useDeleteTenant, useTenant, useUpdateTenant } from "@/api/hooks/portal";
import { PageHeader, PageShell } from "@/components/app";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { Modal } from "@/components/common/Modal";
import { useToast } from "@/components/common/Toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SettingsPage() {
  const tenant = useTenant();
  const updateTenant = useUpdateTenant();
  const deleteTenant = useDeleteTenant();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [geoEnabled, setGeoEnabled] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const seededTenantId = useRef<string | null>(null);

  useEffect(() => {
    if (tenant.data && tenant.data.id !== seededTenantId.current) {
      seededTenantId.current = tenant.data.id;
      setName(tenant.data.name);
      setGeoEnabled(Boolean(tenant.data["geo_enabled"]));
    }
  }, [tenant.data]);

  if (tenant.isLoading) return <LoadingSpinner />;
  if (tenant.error) return <ErrorState error={tenant.error} retry={() => void tenant.refetch()} />;

  const t = tenant.data;

  async function handleSave() {
    try {
      await updateTenant.mutateAsync({
        name: name.trim(),
        geo_enabled: geoEnabled,
      });
      toast("Settings saved");
    } catch (err) {
      toast("Failed to save", err instanceof Error ? err.message : "Unknown error", "err");
    }
  }

  async function handleDelete() {
    try {
      await deleteTenant.mutateAsync();
      toast("Workspace deleted");
      void navigate("/");
    } catch (err) {
      toast("Delete failed", err instanceof Error ? err.message : "Unknown error", "err");
    }
  }

  return (
    <PageShell width="narrow">
      <PageHeader title="Settings" />

      {user ? (
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-4 py-3 text-sm">
          <span className="size-2 rounded-full bg-primary" />
          <span className="text-muted-foreground">Signed in as</span>
          <span className="font-medium text-foreground">{user.name ?? user.email}</span>
        </div>
      ) : null}

      <section className="rounded-md border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">General</h3>

        <div className="mt-6 grid gap-2">
          <label className="text-sm font-medium text-foreground" htmlFor="workspace-name">
            Workspace name
          </label>
          <Input
            id="workspace-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="mt-6 grid gap-2">
          <label className="text-sm font-medium text-foreground" htmlFor="workspace-tenant-id">
            Tenant ID
          </label>
          <Input id="workspace-tenant-id" className="font-mono" value={t?.id ?? ""} readOnly />
          <span className="text-xs text-muted-foreground">
            Read-only identifier for your workspace.
          </span>
        </div>

        <div className="mt-6 grid gap-2">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-foreground" htmlFor="geo-enabled">
                Geo-IP collection
              </label>
              <p className="text-xs text-muted-foreground">
                Collect IP address and approximate geographic location of collectors.
              </p>
            </div>
            <input
              type="checkbox"
              id="geo-enabled"
              checked={geoEnabled}
              onChange={(e) => setGeoEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
          </div>
        </div>

        <Button
          className="mt-6"
          onClick={() => void handleSave()}
          disabled={
            updateTenant.isPending ||
            (name.trim() === (t?.name ?? "") && geoEnabled === Boolean(t?.["geo_enabled"]))
          }
        >
          {updateTenant.isPending ? "Saving..." : "Save changes"}
        </Button>
      </section>

      <section className="mt-6 rounded-md border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">Remote config authority</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          This workspace can assign desired config to enrolled collectors. Enrollment tokens are
          bootstrap-only secrets; future API tokens should be scoped separately for automation.
        </p>
        <div className="mt-6 rounded-md border border-[color:var(--info)]/30 bg-[color:var(--info)]/10 p-4">
          <div className="text-sm font-medium text-foreground">Governance model to wire</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Role checks, plan gates, API-token scopes, and audit events must agree with backend
            authorization before remote-config mutation controls become broadly available.
          </p>
        </div>
      </section>

      <section className="mt-6 rounded-md border border-destructive/40 bg-card p-4">
        <div className="text-sm font-medium text-destructive">Danger zone</div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground">Delete workspace</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Permanently delete this workspace and all its data. This action cannot be undone.
            </p>
          </div>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            Delete workspace
          </Button>
        </div>
      </section>

      <Modal
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          setConfirmText("");
        }}
        title="Delete workspace"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDeleteOpen(false);
                setConfirmText("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={confirmText !== "delete" || deleteTenant.isPending}
            >
              {deleteTenant.isPending ? "Deleting..." : "Delete permanently"}
            </Button>
          </>
        }
      >
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">
            Type <strong className="text-foreground">delete</strong> to confirm.
          </p>
          <Input
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder="delete"
            autoFocus
          />
        </div>
      </Modal>
    </PageShell>
  );
}
