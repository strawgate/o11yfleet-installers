import { Badge, Button, Group, Stack, Table, Text, Title } from "@mantine/core";
import { EmptyState } from "@/components/app";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { relTime, trunc } from "@/utils/format";
import { useConfigurationDetailContext } from "./configuration-detail-context";

export default function VersionsTab() {
  const { versionsQuery, versionList, runCopilot, copilotIsLoading } =
    useConfigurationDetailContext();

  return (
    <Stack
      id="configuration-tab-versions"
      role="tabpanel"
      aria-labelledby="configuration-tab-versions-trigger"
      mt="md"
      gap="md"
    >
      <Group justify="space-between" wrap="wrap" align="flex-start">
        <Stack gap={4}>
          <Title order={3}>Versions</Title>
          <Text size="sm" c="dimmed">
            Compare the latest uploaded YAML against the previous immutable version.
          </Text>
        </Stack>
        <Button
          variant="default"
          onClick={() =>
            void runCopilot(
              "Version diff copilot",
              "summarize_table",
              "Summarize the latest configuration version diff. Use only the provided light fetch and visible version table.",
              "version-diff",
            )
          }
          disabled={versionsQuery.isLoading || versionList.length < 2 || copilotIsLoading}
        >
          Summarize latest diff
        </Button>
      </Group>
      {versionsQuery.isLoading ? (
        <LoadingSpinner />
      ) : versionList.length === 0 ? (
        <EmptyState
          icon="file"
          title="No versions yet"
          description="Upload or roll out a configuration to create the first version."
        />
      ) : (
        <Table.ScrollContainer minWidth={520}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Config hash</Table.Th>
                <Table.Th>Version</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {versionList.map((v, i) => (
                <Table.Tr key={v.id}>
                  <Table.Td ff="monospace">{trunc(v.config_hash ?? v.id, 12)}</Table.Td>
                  <Table.Td>{v.version}</Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {relTime(v.created_at)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {i === 0 ? (
                      <Badge color="brand" variant="light">
                        current
                      </Badge>
                    ) : (
                      <Badge color="gray" variant="light">
                        previous
                      </Badge>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
