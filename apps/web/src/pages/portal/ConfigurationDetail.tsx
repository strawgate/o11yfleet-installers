import { useState } from "react";
import { useParams, useNavigate, Link, Navigate } from "react-router-dom";
import {
  useConfiguration,
  useConfigAgents,
  useConfigVersions,
  useConfigStats,
  useDeleteConfiguration,
  useRollout,
  useUploadConfigVersion,
} from "../../hooks/queries";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { StatCard } from "../../components/ui/StatCard";
import { Modal } from "../../components/ui/Modal";
import { toast } from "../../components/ui/Toast";
import { relativeTime } from "../../lib/format";
import { clsx } from "clsx";

type Tab = "agents" | "versions" | "settings";

export function ConfigurationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("agents");
  const [showDelete, setShowDelete] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [yamlContent, setYamlContent] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const { data: config } = useConfiguration(id ?? "");
  const { data: agents } = useConfigAgents(id ?? "");
  const { data: versions } = useConfigVersions(id ?? "");
  const { data: stats } = useConfigStats(id ?? "");
  const deleteMutation = useDeleteConfiguration();
  const rolloutMutation = useRollout(id ?? "");
  const uploadMutation = useUploadConfigVersion(id ?? "");

  if (!id) return <Navigate to="/portal/configurations" replace />;

  async function handleDelete() {
    if (deleteConfirm !== config?.name) return;
    try {
      await deleteMutation.mutateAsync(id!);
      toast("Configuration deleted", undefined, "success");
      navigate("/portal/configurations");
    } catch {
      toast("Failed to delete configuration", undefined, "error");
    }
  }

  async function handleUpload() {
    if (!yamlContent.trim()) return;
    try {
      const result = await uploadMutation.mutateAsync(yamlContent);
      toast("Version uploaded", undefined, "success");
      setShowUpload(false);
      setYamlContent("");
      // Auto-rollout the new version
      if (result.version?.config_hash) {
        await rolloutMutation.mutateAsync({
          config_hash: result.version.config_hash,
        });
        toast("Rollout started", undefined, "success");
      }
    } catch {
      toast("Failed to upload version", undefined, "error");
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "agents", label: `Agents${agents ? ` (${agents.length})` : ""}` },
    {
      key: "versions",
      label: `Versions${versions ? ` (${versions.length})` : ""}`,
    },
    { key: "settings", label: "Settings" },
  ];

  return (
    <div className="p-6 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-fg-3 mb-4">
        <Link to="/portal/configurations" className="hover:text-fg">
          Configurations
        </Link>
        <span>/</span>
        <span className="text-fg">{config?.name ?? "…"}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-fg">{config?.name}</h1>
          <p className="text-xs text-fg-3 mt-0.5 font-mono">{config?.id}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowUpload(true)}>
            Upload YAML
          </Button>
          <Button variant="danger" size="sm" onClick={() => setShowDelete(true)}>
            Delete
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Agents" value={stats?.total_agents ?? "—"} />
        <StatCard label="Connected" value={stats?.connected_agents ?? "—"} />
        <StatCard label="Healthy" value={stats?.healthy_agents ?? "—"} />
      </div>

      {/* Tabs */}
      <div className="border-b border-line mb-4">
        <div className="flex gap-4">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={clsx(
                "pb-2 text-sm transition-colors border-b-2 -mb-px",
                tab === t.key
                  ? "border-brand text-fg font-medium"
                  : "border-transparent text-fg-3 hover:text-fg",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {tab === "agents" && <AgentsTab agents={agents} />}
      {tab === "versions" && <VersionsTab versions={versions} />}
      {tab === "settings" && (
        <div className="text-sm text-fg-3">
          <p>Configuration settings and danger zone are managed above.</p>
        </div>
      )}

      {/* Delete Modal */}
      <Modal
        open={showDelete}
        onClose={() => {
          setShowDelete(false);
          setDeleteConfirm("");
        }}
        title="Delete Configuration"
      >
        <p className="text-sm text-fg-3 mb-4">
          This will permanently delete this configuration and disconnect all agents. Type{" "}
          <span className="font-mono text-fg">{config?.name}</span> to confirm.
        </p>
        <input
          value={deleteConfirm}
          onChange={(e) => setDeleteConfirm(e.target.value)}
          placeholder={config?.name}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg mb-4"
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setShowDelete(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={deleteConfirm !== config?.name || deleteMutation.isPending}
            onClick={handleDelete}
          >
            {deleteMutation.isPending ? "Deleting…" : "Delete Configuration"}
          </Button>
        </div>
      </Modal>

      {/* Upload Modal */}
      <Modal
        open={showUpload}
        onClose={() => {
          setShowUpload(false);
          setYamlContent("");
        }}
        title="Upload Configuration YAML"
      >
        <textarea
          value={yamlContent}
          onChange={(e) => setYamlContent(e.target.value)}
          placeholder="Paste your OTel Collector YAML here..."
          className="w-full h-48 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg font-mono resize-none mb-4"
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setShowUpload(false)}>
            Cancel
          </Button>
          <Button disabled={!yamlContent.trim() || uploadMutation.isPending} onClick={handleUpload}>
            {uploadMutation.isPending ? "Uploading…" : "Upload & Deploy"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function AgentsTab({
  agents,
}: {
  agents?: ReturnType<typeof Array<import("../../hooks/queries").Agent>>;
}) {
  if (!agents?.length) {
    return (
      <p className="text-sm text-fg-3 py-8 text-center">
        No agents connected to this configuration yet.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-line overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2">
            <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-3">Agent</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-3">Status</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-3">Health</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-3">Last Seen</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.instance_uid} className="border-b border-line last:border-0">
              <td className="px-4 py-3">
                <p className="text-fg font-medium text-xs font-mono">
                  {a.hostname ?? a.instance_uid.slice(0, 12)}
                </p>
                {a.agent_version && (
                  <p className="text-[10px] text-fg-4 mt-0.5">v{a.agent_version}</p>
                )}
              </td>
              <td className="px-4 py-3">
                <Badge variant={a.status === "connected" ? "success" : "default"}>{a.status}</Badge>
              </td>
              <td className="px-4 py-3">
                <Badge variant={a.healthy ? "success" : "error"}>
                  {a.healthy ? "healthy" : "unhealthy"}
                </Badge>
              </td>
              <td className="px-4 py-3 text-fg-3 text-xs">{relativeTime(a.last_seen_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VersionsTab({ versions }: { versions?: import("../../hooks/queries").ConfigVersion[] }) {
  if (!versions?.length) {
    return <p className="text-sm text-fg-3 py-8 text-center">No versions uploaded yet.</p>;
  }

  return (
    <div className="space-y-3">
      {versions.map((v, i) => (
        <div key={v.id} className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-mono text-fg-3">{v.config_hash.slice(0, 12)}</span>
              {i === 0 && (
                <Badge variant="success" className="ml-2">
                  latest
                </Badge>
              )}
            </div>
            <span className="text-xs text-fg-4">{relativeTime(v.created_at)}</span>
          </div>
          {v.message && <p className="mt-1 text-sm text-fg-3">{v.message}</p>}
        </div>
      ))}
    </div>
  );
}
