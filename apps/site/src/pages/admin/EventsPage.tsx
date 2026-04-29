import { PrototypeBanner } from "../../components/common/PrototypeBanner";
import { EmptyState } from "../../components/common/EmptyState";

export default function EventsPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit Events</h1>
          <p className="meta">
            Events should combine customer actions, collector lifecycle, support sessions, and
            platform incidents once the audit pipeline is wired.
          </p>
        </div>
      </div>

      <PrototypeBanner message="Audit integration not yet active" />

      <div className="admin-callout mt-6">
        <strong>Event taxonomy to wire</strong>
        <p>
          Track auth, config, collector, token, team, billing, support, and platform events with
          actor, tenant, resource, severity, timestamp, and correlation id.
        </p>
      </div>

      <div className="dt-card mt-6">
        <div className="dt-toolbar">
          <input
            className="input"
            placeholder="Filter events…"
            disabled
            style={{ maxWidth: 280 }}
          />
        </div>
        <table className="dt">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Resource</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={4}>
                <EmptyState
                  icon="activity"
                  title="No audit events recorded"
                  description="Events will appear here once the audit integration is enabled. Staff support actions should include reason, TTL, scope, and actor."
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
