import { useState } from "react";
import { useTenant, useUpdateTenant } from "../../hooks/queries";
import { useAuth } from "../../lib/auth";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { PrototypeBanner } from "../../components/ui/PrototypeBanner";
import { toast } from "../../components/ui/Toast";

export function SettingsPage() {
  const { user } = useAuth();
  const { data: tenant } = useTenant();
  const updateMutation = useUpdateTenant();
  const [name, setName] = useState<string | null>(null);

  const displayName = name ?? tenant?.name ?? "";

  async function handleSave() {
    if (!displayName.trim()) return;
    try {
      await updateMutation.mutateAsync({ name: displayName.trim() });
      setName(null);
      toast("Settings saved", undefined, "success");
    } catch {
      toast("Failed to save settings", undefined, "error");
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-lg font-semibold text-fg mb-6">Workspace Settings</h1>

      {user?.role === "admin" && (
        <div className="rounded-lg border border-brand/20 bg-brand/5 px-4 py-2.5 text-xs text-brand mb-4">
          You're signed in as an admin — changes affect the entire workspace.
        </div>
      )}

      <Card className="mb-6">
        <h2 className="text-sm font-semibold text-fg mb-4">General</h2>
        <div className="space-y-4">
          <Input
            label="Workspace name"
            value={displayName}
            onChange={(e) => setName(e.target.value)}
          />
          <div>
            <label className="block text-xs font-medium text-fg-3 mb-1.5">Plan</label>
            <Badge>{tenant?.plan ?? "—"}</Badge>
          </div>
          <div>
            <label className="block text-xs font-medium text-fg-3 mb-1.5">Workspace ID</label>
            <code className="text-xs font-mono text-fg-3">{tenant?.id ?? "—"}</code>
          </div>
          <Button
            onClick={handleSave}
            disabled={
              updateMutation.isPending || !displayName.trim() || displayName === tenant?.name
            }
          >
            {updateMutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </Card>

      <PrototypeBanner message="Notification preferences and danger zone actions are not yet implemented." />

      <Card>
        <h2 className="text-sm font-semibold text-fg mb-4">Danger Zone</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-err/20 p-3">
            <div>
              <p className="text-sm text-fg">Delete workspace</p>
              <p className="text-xs text-fg-3">
                Permanently delete this workspace and all its data.
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              onClick={() =>
                toast("Not implemented", "Workspace deletion is not yet available.", "warning")
              }
            >
              Delete
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
