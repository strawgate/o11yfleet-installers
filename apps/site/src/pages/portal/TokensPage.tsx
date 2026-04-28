import { useState } from "react";
import {
  useConfigurations,
  useConfigurationTokens,
  useCreateEnrollmentToken,
  useDeleteEnrollmentToken,
  type Configuration,
} from "../../api/hooks/portal";
import { useToast } from "../../components/common/Toast";
import { Modal } from "../../components/common/Modal";
import { CopyButton } from "../../components/common/CopyButton";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { relTime } from "../../utils/format";

function TokenSection({ config }: { config: Configuration }) {
  const { data: tokens, isLoading } = useConfigurationTokens(config.id);
  const createToken = useCreateEnrollmentToken(config.id);
  const deleteToken = useDeleteEnrollmentToken(config.id);
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [tokenLabel, setTokenLabel] = useState("");
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null);

  async function handleCreate() {
    try {
      const result = await createToken.mutateAsync({ name: tokenLabel.trim() || undefined });
      const value = result.token;
      if (value) {
        setNewTokenValue(value);
      }
      toast("Token created", config.name);
      setCreateOpen(false);
      setTokenLabel("");
    } catch (err) {
      toast("Failed to create token", err instanceof Error ? err.message : "Unknown error", "err");
    }
  }

  async function handleDelete(tokenId: string) {
    try {
      await deleteToken.mutateAsync(tokenId);
      toast("Token revoked");
    } catch (err) {
      toast("Failed to revoke token", err instanceof Error ? err.message : "Unknown error", "err");
    }
  }

  const tokenList = tokens ?? [];

  return (
    <div className="dt-card mt-6">
      <div className="dt-toolbar">
        <h3>
          {config.name} <span className="count">{tokenList.length}</span>
        </h3>
        <div className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
          New token
        </button>
      </div>

      {newTokenValue && (
        <div className="banner info">
          <div className="b-title">Token created — copy it now</div>
          <div className="b-body">
            This token will not be shown again.
            <div className="flex-row gap-sm mt-2">
              <code className="mono-cell">{newTokenValue}</code>
              <CopyButton value={newTokenValue} />
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setNewTokenValue(null)}>
            Dismiss
          </button>
        </div>
      )}

      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <table className="dt">
          <thead>
            <tr>
              <th>Label</th>
              <th>Status</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tokenList.length === 0 ? (
              <tr>
                <td colSpan={4} className="meta" style={{ textAlign: "center", padding: 32 }}>
                  No enrollment tokens.
                </td>
              </tr>
            ) : (
              tokenList.map((t) => {
                const revoked = !!(t["revoked_at"] as string | undefined);
                return (
                  <tr key={t.id}>
                    <td className="name">{(t["label"] as string) ?? t.id}</td>
                    <td>
                      <span className={`tag ${revoked ? "tag-err" : "tag-ok"}`}>
                        {revoked ? "revoked" : "active"}
                      </span>
                    </td>
                    <td className="meta">{relTime(t.created_at)}</td>
                    <td className="row-actions">
                      {!revoked && (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => void handleDelete(t.id)}
                          disabled={deleteToken.isPending}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New enrollment token"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void handleCreate()}
              disabled={createToken.isPending}
            >
              {createToken.isPending ? "Creating…" : "Create token"}
            </button>
          </>
        }
      >
        <div className="field">
          <label>Label (optional)</label>
          <input
            className="input"
            value={tokenLabel}
            onChange={(e) => setTokenLabel(e.target.value)}
            placeholder="e.g. production-fleet"
            autoFocus
          />
        </div>
      </Modal>
    </div>
  );
}

export default function TokensPage() {
  const { data: configs, isLoading, error, refetch } = useConfigurations();

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const cfgList = configs ?? [];

  return (
    <div className="main-wide">
      <div className="page-head">
        <div>
          <h1>Enrollment tokens</h1>
          <p className="meta">
            Enrollment tokens are bootstrap credentials for collectors. They are separate from API
            tokens and should not grant general control-plane write authority.
          </p>
        </div>
      </div>

      <div className="banner info mb-6">
        <div>
          <div className="b-title">Token boundary</div>
          <div className="b-body">
            Create enrollment tokens per configuration group, copy them once, and revoke/rotate them
            if exposed. API automation tokens will use a separate scoped credential model.
          </div>
        </div>
      </div>

      {cfgList.length === 0 ? (
        <div className="card card-pad" style={{ textAlign: "center" }}>
          <p className="meta">Create a configuration first to manage enrollment tokens.</p>
        </div>
      ) : (
        cfgList.map((c) => <TokenSection key={c.id} config={c} />)
      )}
    </div>
  );
}
