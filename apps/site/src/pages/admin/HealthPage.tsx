import { useAdminHealth } from "../../api/hooks/admin";
import { EmptyState } from "../../components/common/EmptyState";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { relTime } from "../../utils/format";
import type { HealthMetrics } from "./support-model";

const serviceLabels: Record<string, string> = {
  worker: "Worker / API",
  d1: "D1 Database",
  r2: "R2 Storage",
  durable_objects: "Durable Objects",
};

function statusTag(status: string) {
  const cls =
    status === "healthy" || status === "ok" || status === "connected" || status === "configured"
      ? "tag-ok"
      : status === "degraded" ||
          status === "write_only" ||
          status === "not_bound" ||
          status === "not_configured" ||
          status === "unavailable"
        ? "tag-warn"
        : "tag-err";
  return <span className={`tag ${cls}`}>{status}</span>;
}

function numberMetric(value: number | undefined): string {
  return typeof value === "number" ? value.toLocaleString() : "—";
}

const emptyHealthMetrics: HealthMetrics = {
  total_tenants: 0,
  total_configurations: 0,
  tenants_without_configurations: 0,
  configurations_without_agents: 0,
  total_users: 0,
  active_sessions: 0,
  impersonation_sessions: 0,
  active_tokens: 0,
  total_agents: 0,
  connected_agents: 0,
  disconnected_agents: 0,
  unknown_agents: 0,
  healthy_agents: 0,
  unhealthy_agents: 0,
  stale_agents: 0,
  last_agent_seen_at: null,
  latest_fleet_snapshot_at: null,
  latest_configuration_updated_at: null,
  plan_counts: {},
};

function planSummary(planCounts: Record<string, number> | undefined): string {
  const entries = Object.entries(planCounts ?? {});
  if (entries.length === 0) return "No tenants";
  return entries.map(([plan, count]) => `${plan}: ${numberMetric(count)}`).join(" / ");
}

export default function HealthPage() {
  const { data, isLoading, error, refetch } = useAdminHealth();

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const checks = data?.checks ?? {};
  const metrics = data?.metrics ?? emptyHealthMetrics;
  const sources = data?.sources ?? {};
  const checkEntries = Object.entries(checks);
  const healthyChecks = checkEntries.filter(
    ([, check]) => check.status === "healthy" || check.status === "ok",
  ).length;
  const degradedChecks = checkEntries.filter(
    ([, check]) => check.status !== "healthy" && check.status !== "ok",
  );
  const timestamp = data?.timestamp;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>System Health</h1>
          <p className="meta">
            O11yFleet control-plane dependencies, fleet counters, and session state in one operator
            view.
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
        <div className="stat">
          <div className="val">
            {healthyChecks}/{checkEntries.length || "—"}
          </div>
          <div className="label">Healthy checks</div>
        </div>
        <div className="stat">
          <div className="val">{numberMetric(metrics.connected_agents)}</div>
          <div className="label">Connected collectors</div>
        </div>
        <div className="stat">
          <div className="val">{timestamp ? relTime(timestamp) : "—"}</div>
          <div className="label">Last checked</div>
        </div>
      </div>

      <div className="health-grid mt-6">
        <section className="card card-pad">
          <h3>O11yFleet app metrics</h3>
          <div className="health-metrics mt-4">
            <span>
              <strong>{numberMetric(metrics.total_tenants)}</strong>
              <span className="meta">tenants</span>
            </span>
            <span>
              <strong>{numberMetric(metrics.total_configurations)}</strong>
              <span className="meta">configs</span>
            </span>
            <span>
              <strong>{numberMetric(metrics.total_agents)}</strong>
              <span className="meta">collectors</span>
            </span>
            <span>
              <strong>{numberMetric(metrics.healthy_agents)}</strong>
              <span className="meta">healthy collectors</span>
            </span>
            <span>
              <strong>{numberMetric(metrics.active_tokens)}</strong>
              <span className="meta">active tokens</span>
            </span>
            <span>
              <strong>{numberMetric(metrics.active_sessions)}</strong>
              <span className="meta">active sessions</span>
            </span>
          </div>
          <p className="meta mt-4">
            Plan mix: {planSummary(metrics.plan_counts)}. Latest config update:{" "}
            {relTime(metrics.latest_configuration_updated_at)}.
          </p>
        </section>

        <section className="card card-pad">
          <h3>Operator attention</h3>
          {degradedChecks.length === 0 ? (
            <p className="meta mt-4">No degraded control-plane dependencies reported.</p>
          ) : (
            <div className="health-issues mt-4">
              {degradedChecks.map(([key, check]) => (
                <div key={key} className="health-issue">
                  <span>
                    <strong>{serviceLabels[key] ?? key}</strong>
                    <span className="meta">{check.error ?? check.detail ?? "Needs attention"}</span>
                  </span>
                  {statusTag(check.status ?? "unknown")}
                </div>
              ))}
            </div>
          )}
          <p className="meta mt-4">
            Latest fleet metrics snapshot:{" "}
            {relTime(metrics.latest_fleet_snapshot_at ?? metrics.last_agent_seen_at)}
          </p>
          <p className="meta mt-2">
            Active impersonation sessions: {numberMetric(metrics.impersonation_sessions)}
          </p>
        </section>

        <section className="card card-pad">
          <h3>Fleet gaps</h3>
          <div className="health-metrics mt-4">
            <span>
              <strong>{numberMetric(metrics.disconnected_agents)}</strong>
              <span className="meta">disconnected</span>
            </span>
            <span>
              <strong>{numberMetric(metrics.unknown_agents)}</strong>
              <span className="meta">unknown status</span>
            </span>
            <span>
              <strong>{numberMetric(metrics.unhealthy_agents)}</strong>
              <span className="meta">unhealthy</span>
            </span>
            <span>
              <strong>{numberMetric(metrics.stale_agents)}</strong>
              <span className="meta">stale heartbeats</span>
            </span>
            <span>
              <strong>{numberMetric(metrics.tenants_without_configurations)}</strong>
              <span className="meta">tenants without configs</span>
            </span>
            <span>
              <strong>{numberMetric(metrics.configurations_without_agents)}</strong>
              <span className="meta">configs without collectors</span>
            </span>
          </div>
        </section>

        <section className="card card-pad">
          <h3>Data sources</h3>
          <div className="health-source-list mt-4">
            {Object.keys(sources).length === 0 ? (
              <p className="meta">No source metadata reported.</p>
            ) : (
              Object.entries(sources).map(([key, source]) => (
                <div key={key} className="health-source-row">
                  <span>
                    <strong>{key.replaceAll("_", " ")}</strong>
                    <span className="meta">{source.detail ?? "No detail reported."}</span>
                  </span>
                  {statusTag(source.status ?? "unknown")}
                </div>
              ))
            )}
          </div>
          <p className="meta mt-4">
            Cloudflare billing, account usage, Worker invocation analytics, and Analytics Engine
            queries are not included unless we add account credentials and API calls.
          </p>
        </section>
      </div>

      <div className="health-check-grid mt-6">
        {Object.keys(checks).length === 0 ? (
          <div className="card card-pad">
            <EmptyState
              icon="activity"
              title="No health checks reported"
              description="Service health checks will appear here when the worker reports them."
            />
          </div>
        ) : (
          checkEntries.map(([key, check]) => (
            <section key={key} className="card card-pad health-check-card">
              <div className="support-section-head">
                <h3>{serviceLabels[key] ?? key}</h3>
                {statusTag(check.status ?? "unknown")}
              </div>
              {check.latency_ms !== null && check.latency_ms !== undefined ? (
                <div className="health-latency mt-4">{check.latency_ms}ms</div>
              ) : (
                <div className="health-latency mt-4">N/A</div>
              )}
              <div className="meta mt-2">{check.detail ?? "No extra detail reported."}</div>
              {check.error ? (
                <div className="meta mt-2" style={{ color: "var(--danger)" }}>
                  {check.error}
                </div>
              ) : null}
            </section>
          ))
        )}
      </div>
    </>
  );
}
