import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useConfigurations, useCreateConfiguration } from "../../api/hooks/portal";
import { useToast } from "../../components/common/Toast";
import { Modal } from "../../components/common/Modal";
import { EmptyState } from "../../components/common/EmptyState";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { relTime, trunc } from "../../utils/format";

export default function ConfigurationsPage() {
  const { data: configs, isLoading, error, refetch } = useConfigurations();
  const createConfig = useCreateConfiguration();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const cfgList = configs ?? [];

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      const result = await createConfig.mutateAsync({
        name: name.trim(),
        description: description.trim(),
      });
      toast("Configuration created", name);
      setModalOpen(false);
      setName("");
      setDescription("");
      navigate(`/portal/configurations/${result.id}`);
    } catch (err) {
      toast(
        "Failed to create configuration",
        err instanceof Error ? err.message : "Unknown error",
        "err",
      );
    }
  }

  return (
    <div className="main-wide">
      <div className="page-head">
        <h1>Configurations</h1>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
            New configuration
          </button>
        </div>
      </div>

      <div className="dt-card">
        <table className="dt">
          <thead>
            <tr>
              <th>Name</th>
              <th>Config hash</th>
              <th>Description</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cfgList.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <EmptyState
                    icon="file"
                    title="No configurations yet"
                    description="Create a configuration before enrolling collectors or pushing rollout updates."
                  >
                    <button className="btn btn-primary btn-sm" onClick={() => setModalOpen(true)}>
                      New configuration
                    </button>
                  </EmptyState>
                </td>
              </tr>
            ) : (
              cfgList.map((c) => (
                <tr key={c.id} className="clickable">
                  <td className="name">
                    <Link to={`/portal/configurations/${c.id}`}>{c.name}</Link>
                  </td>
                  <td className="mono-cell">
                    {trunc(c["current_config_hash"] as string | undefined, 12)}
                  </td>
                  <td className="meta">{trunc(c["description"] as string | undefined, 40)}</td>
                  <td className="meta">{relTime(c.updated_at)}</td>
                  <td style={{ width: 32 }}>
                    <Link to={`/portal/configurations/${c.id}`}>→</Link>
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
        title="New configuration"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void handleCreate()}
              disabled={!name.trim() || createConfig.isPending}
            >
              {createConfig.isPending ? "Creating…" : "Create"}
            </button>
          </>
        }
      >
        <div className="field">
          <label>Name</label>
          <input
            className="input mono"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-config"
            autoFocus
          />
        </div>
        <div className="field">
          <label>Description</label>
          <textarea
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            rows={3}
          />
        </div>
      </Modal>
    </div>
  );
}
