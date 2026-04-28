import { PrototypeBanner } from "../../components/common/PrototypeBanner";

export default function EventsPage() {
  return (
    <>
      <div className="page-head">
        <h1>Audit Events</h1>
      </div>

      <PrototypeBanner message="Audit integration not yet active" />

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
              <td colSpan={4} className="meta" style={{ textAlign: "center", padding: 32 }}>
                No audit events recorded yet. Events will appear here once the audit integration is
                enabled.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
