import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Group,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAdminDoQuery, useAdminDoTables } from "../../api/hooks/admin";
import { EmptyState, PageHeader, PageShell } from "@/components/app";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { getColumnKeys, buildDoCell } from "./utils/do-table";

const DEFAULT_SQL = `SELECT instance_uid, status, healthy, last_seen_at
FROM agents
ORDER BY last_seen_at DESC
LIMIT 50`;

const TABLE_QUERY_LIMIT = 500;

export default function DOViewerPage() {
  const [configId, setConfigId] = useState("");
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [paramsText, setParamsText] = useState("[]");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const trimmedConfigId = configId.trim();
  const tablesQuery = useAdminDoTables(trimmedConfigId);
  const queryMutation = useAdminDoQuery(trimmedConfigId);
  const { reset } = queryMutation;

  useEffect(() => {
    reset();
  }, [trimmedConfigId, sql, paramsText, reset]);

  useEffect(() => {
    setSelectedTable(null);
  }, [trimmedConfigId]);

  async function runQuery() {
    let params: unknown[];
    try {
      const parsed = JSON.parse(paramsText || "[]") as unknown;
      if (!Array.isArray(parsed)) {
        reset();
        notifications.show({ message: "Params must be a JSON array", color: "red" });
        return;
      }
      params = parsed;
    } catch {
      reset();
      notifications.show({ message: "Params must be a valid JSON array", color: "red" });
      return;
    }

    try {
      await queryMutation.mutateAsync({ sql, params });
    } catch (error) {
      notifications.show({
        title: "Failed to run query",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    }
  }

  async function selectTable(tableName: string) {
    const escapedName = tableName.replace(/"/g, '""');
    const tableSql = `SELECT * FROM "${escapedName}" LIMIT ${TABLE_QUERY_LIMIT}`;
    setSql(tableSql);
    setParamsText("[]");
    setSelectedTable(tableName);
    queryMutation.reset();
    // Surface mutation errors via notifications — the same pattern runQuery
    // uses. Previously the call was unawaited and silently swallowed errors
    // (a bad row in the SELECT * preview would just leave the user with no
    // result and no explanation).
    try {
      await queryMutation.mutateAsync({ sql: tableSql, params: [] });
    } catch (error) {
      notifications.show({
        title: "Failed to query table",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    }
  }

  const isQuerying = queryMutation.isPending;
  const hasQueryResult = queryMutation.isSuccess && queryMutation.data;
  const hasQueryError = queryMutation.isError;
  const rows = queryMutation.data?.rows ?? [];
  const columns = getColumnKeys(rows);

  return (
    <PageShell width="wide">
      <PageHeader
        title="Durable Object Viewer"
        description="Read-only SQLite inspection for a configuration Durable Object. Queries are limited to a single SELECT statement and capped at 500 rows."
      />

      <Card>
        <Stack gap="md">
          <TextInput
            label="Configuration ID"
            placeholder="Paste configuration UUID"
            styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
            value={configId}
            onChange={(event) => setConfigId(event.currentTarget.value)}
          />
          <Group gap="xs">
            <Button
              variant="default"
              size="sm"
              disabled={!trimmedConfigId || tablesQuery.isFetching}
              loading={tablesQuery.isFetching}
              onClick={() => void tablesQuery.refetch()}
            >
              Load tables
            </Button>
            {tablesQuery.data ? (
              <Text size="sm" c="dimmed">
                {tablesQuery.data.length} tables
              </Text>
            ) : null}
          </Group>
          {tablesQuery.data ? (
            tablesQuery.data.length > 0 ? (
              <Group gap="xs" wrap="wrap">
                {tablesQuery.data.map((table) => (
                  <Button
                    key={table}
                    size="xs"
                    variant={selectedTable === table ? "filled" : "default"}
                    onClick={() => void selectTable(table)}
                  >
                    {table}
                  </Button>
                ))}
              </Group>
            ) : (
              <Text size="sm" c="dimmed">
                No tables found
              </Text>
            )
          ) : null}
          {tablesQuery.error ? (
            <Alert color="red" variant="light">
              {tablesQuery.error.message}
            </Alert>
          ) : null}
        </Stack>
      </Card>

      <Card mt="md">
        <Stack gap="md">
          <Textarea
            label="SQL"
            value={sql}
            onChange={(event) => setSql(event.currentTarget.value)}
            minRows={5}
            autosize
            styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
          />
          <TextInput
            label="Params JSON array"
            value={paramsText}
            onChange={(event) => setParamsText(event.currentTarget.value)}
            styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
          />
          <Group>
            <Button
              disabled={!trimmedConfigId || isQuerying}
              loading={isQuerying}
              onClick={() => void runQuery()}
            >
              Run query
            </Button>
          </Group>
        </Stack>
      </Card>

      {hasQueryError ? (
        <Alert color="red" variant="light" mt="md">
          {queryMutation.error instanceof Error ? queryMutation.error.message : "Query failed"}
        </Alert>
      ) : null}

      {isQuerying ? (
        <Card mt="md">
          <LoadingSpinner />
        </Card>
      ) : hasQueryResult ? (
        <Card mt="md">
          {rows.length > 0 ? (
            <>
              <Group justify="space-between" mb="sm">
                <Title order={3} size="sm" fw={500}>
                  {queryMutation.data!.row_count} row
                  {queryMutation.data!.row_count !== 1 ? "s" : ""}
                  {queryMutation.data!.row_count >= TABLE_QUERY_LIMIT
                    ? ` (capped at ${TABLE_QUERY_LIMIT})`
                    : ""}
                </Title>
              </Group>
              <Table.ScrollContainer minWidth={500}>
                <Table withTableBorder striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      {columns.map((col) => (
                        <Table.Th key={col}>{col}</Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {rows.map((row, rowIndex) => (
                      <Table.Tr key={rowIndex}>
                        {columns.map((col) => (
                          <Table.Td key={col}>{buildDoCell(row[col])}</Table.Td>
                        ))}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </>
          ) : (
            <EmptyState
              icon="box"
              title="No rows returned"
              description="The query executed successfully but returned no data."
            />
          )}
        </Card>
      ) : null}
    </PageShell>
  );
}
