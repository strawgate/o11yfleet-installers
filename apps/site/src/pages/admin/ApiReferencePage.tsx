import { Alert, Code, Table } from "@mantine/core";
import { PageHeader, PageShell } from "@/components/app";

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
    method: "POST",
    path: "/api/admin/tenants/:id/approve",
    use: "Approve or reject a pending tenant signup",
  },
  {
    method: "POST",
    path: "/api/admin/bulk-approve",
    use: "Bulk-approve every currently-pending tenant in one call",
  },
  {
    method: "GET",
    path: "/api/admin/settings",
    use: "Read platform-level admin settings (e.g. auto-approve toggle). Updates are controlled via environment variables — the PUT endpoint exists but currently returns a 400 directing operators to the env-var path.",
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
    <PageShell width="wide">
      <PageHeader
        title="Admin API Reference"
        description="Admin-only routes for platform operations. These are intentionally kept out of the public API documentation."
      />

      <Alert color="blue" variant="light" title="Access model" mb="md">
        Admin APIs require an authenticated admin session or controlled deployment automation.
        Tenant-scoped customer and collector routes remain documented in the public reference.
      </Alert>

      <Table.ScrollContainer minWidth={500}>
        <Table withTableBorder withColumnBorders striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Method</Table.Th>
              <Table.Th>Path</Table.Th>
              <Table.Th>Use</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {adminEndpoints.map((endpoint) => (
              <Table.Tr key={`${endpoint.method}:${endpoint.path}`}>
                <Table.Td>{endpoint.method}</Table.Td>
                <Table.Td>
                  <Code>{endpoint.path}</Code>
                </Table.Td>
                <Table.Td>{endpoint.use}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </PageShell>
  );
}
