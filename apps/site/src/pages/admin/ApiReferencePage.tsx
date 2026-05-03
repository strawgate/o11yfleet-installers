import { Alert, Code, Table } from "@mantine/core";
import { PageHeader, PageShell } from "@/components/app";
import { ADMIN_ENDPOINTS } from "./api-reference-data";

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
            {ADMIN_ENDPOINTS.map((endpoint) => (
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
