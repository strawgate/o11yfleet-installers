import { useAdminHealth } from "../../api/hooks/admin";
import { EmptyState } from "../../components/common/EmptyState";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";

const serviceLabels: Record<string, string> = {
  d1: "D1 Database",
  r2: "R2 Storage",
  durable_objects: "Durable Objects",
  queue: "Queue",
};

function statusTag(status: string) {
  const cls =
    status === "healthy" || status === "ok"
      ? "tag-ok"
      : status === "degraded"
        ? "tag-warn"
        : "tag-err";
  return <span className={`tag ${cls}`}>{status}</span>;
}

export default function HealthPage() {
  const { data, isLoading, error, refetch } = useAdminHealth();

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const checks =
    (data?.["checks"] as Record<string, { status: string; latency_ms?: number; error?: string }>) ??
    {};

  return (
    <>
      <div className="page-head">
        <div>
          <h1>System Health</h1>
          <p className="meta">
            This page reports control-plane dependencies. Collector runtime health belongs in tenant
            and configuration drilldowns.
          </p>
        </div>
        <div className="actions">
          <button className="btn btn-ghost btn-sm" onClick={() => void refetch()}>
            Refresh
          </button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="val">{statusTag(data?.status ?? "unknown")}</div>
          <div className="label">Overall status</div>
        </div>
      </div>

      <div className="admin-callout mt-6">
        <strong>Health plane split</strong>
        <p>
          D1, R2, Durable Objects, Queues, and Worker/API health can be degraded independently from
          customer collector health. Keep paging and UI labels explicit.
        </p>
      </div>

      <div
        className="mt-6"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 16,
        }}
      >
        {Object.keys(checks).length === 0 ? (
          <div className="card card-pad">
            <EmptyState
              icon="activity"
              title="No health checks reported"
              description="Service health checks will appear here when the worker reports them."
            />
          </div>
        ) : (
          Object.entries(checks).map(([key, check]) => (
            <div key={key} className="card card-pad">
              <h3>{serviceLabels[key] ?? key}</h3>
              <div className="mt-6">{statusTag(check.status)}</div>
              {check.latency_ms !== null && check.latency_ms !== undefined && (
                <div className="meta mt-2">{check.latency_ms}ms latency</div>
              )}
              {check.error && (
                <div className="meta mt-2" style={{ color: "var(--danger)" }}>
                  {check.error}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}
