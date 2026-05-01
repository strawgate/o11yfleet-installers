type AdminEndpoint = {
  method: string;
  path: string;
  use: string;
};

const adminEndpoints: AdminEndpoint[] = [
  {
    method: "GET",
    path: "/api/admin/overview",
    use: "Platform-level tenant, configuration, and token counts",
  },
  {
    method: "POST",
    path: "/api/admin/ai/guidance",
    use: "Admin AI guidance helper",
  },
  {
    method: "POST",
    path: "/api/admin/ai/chat",
    use: "Admin AI page copilot stream",
  },
  {
    method: "GET/POST",
    path: "/api/admin/tenants",
    use: "List or create tenants",
  },
  {
    method: "GET/PUT/DELETE",
    path: "/api/admin/tenants/:id",
    use: "Read, update, or delete one tenant",
  },
  {
    method: "GET",
    path: "/api/admin/tenants/:id/configurations",
    use: "List configurations for one tenant",
  },
  {
    method: "GET",
    path: "/api/admin/tenants/:id/users",
    use: "List users for one tenant",
  },
  {
    method: "POST",
    path: "/api/admin/tenants/:id/impersonate",
    use: "Create a tenant-scoped session for admin troubleshooting",
  },
  {
    method: "GET",
    path: "/api/admin/configurations/:id/do/tables",
    use: "List Durable Object SQLite tables for one configuration",
  },
  {
    method: "POST",
    path: "/api/admin/configurations/:id/do/query",
    use: "Run a bounded read-only Durable Object SQLite SELECT query for troubleshooting",
  },
  {
    method: "GET",
    path: "/api/admin/health",
    use: "Check D1, R2, Durable Object, and Analytics Engine health",
  },
  {
    method: "GET",
    path: "/api/admin/usage",
    use: "Estimate Cloudflare daily usage, month-to-date spend, and monthly projection",
  },
  {
    method: "GET",
    path: "/api/admin/plans",
    use: "List built-in plan limits",
  },
];

export default function ApiReferencePage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Admin API Reference</h1>
          <p className="meta">
            Admin-only routes for platform operations. These are intentionally kept out of the
            public API documentation.
          </p>
        </div>
      </div>

      <div className="admin-callout mb-6">
        <strong>Access model</strong>
        <p>
          Admin APIs require an authenticated admin session or controlled deployment automation.
          Tenant-scoped customer and collector routes remain documented in the public reference.
        </p>
      </div>

      <div className="dt-card">
        <table className="dt">
          <thead>
            <tr>
              <th>Method</th>
              <th>Path</th>
              <th>Use</th>
            </tr>
          </thead>
          <tbody>
            {adminEndpoints.map((endpoint) => (
              <tr key={`${endpoint.method}:${endpoint.path}`}>
                <td>{endpoint.method}</td>
                <td className="mono-cell">{endpoint.path}</td>
                <td>{endpoint.use}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
