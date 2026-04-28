import { useState } from "react";
import { Link } from "react-router-dom";
import { useConfigurations, useCreateConfiguration } from "../../hooks/queries";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { EmptyState } from "../../components/ui/EmptyState";
import { toast } from "../../components/ui/Toast";
import { relativeTime } from "../../lib/format";

export function ConfigurationsPage() {
  const { data: configs, isLoading } = useConfigurations();
  const createMutation = useCreateConfiguration();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");

  async function handleCreate() {
    if (!newName.trim()) return;
    try {
      await createMutation.mutateAsync({ name: newName.trim() });
      setShowCreate(false);
      setNewName("");
      toast("Configuration created", undefined, "success");
    } catch {
      toast("Failed to create configuration", undefined, "error");
    }
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-fg">Configurations</h1>
          <p className="text-xs text-fg-3 mt-0.5">
            {configs ? `${configs.length} configuration${configs.length === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>+ New Configuration</Button>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-surface" />
          ))}
        </div>
      ) : configs?.length === 0 ? (
        <EmptyState
          icon="☰"
          title="No configurations yet"
          description="Create your first configuration to start managing collectors."
        >
          <Button onClick={() => setShowCreate(true)}>
            Create Configuration
          </Button>
        </EmptyState>
      ) : (
        <div className="rounded-xl border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-3">
                  Name
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-3">
                  Environment
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-3">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {configs?.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-line last:border-0 hover:bg-surface-2/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/portal/configurations/${c.id}`}
                      className="text-fg font-medium hover:text-brand transition-colors"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-fg-3">
                    {c.environment ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-fg-3">
                    {relativeTime(c.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New Configuration"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleCreate();
          }}
          className="space-y-4"
        >
          <Input
            label="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="production-otel-config"
            required
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
