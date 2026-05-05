import { Button, Card, Code, Group, Stack, Text, Title } from "@mantine/core";
import { DetailList } from "@/components/common/DetailList";
import { relTime } from "@/utils/format";
import { useConfigurationDetailContext } from "./configuration-detail-context";

export default function SettingsTab() {
  const {
    configuration: c,
    activeWebSockets,
    openRestartFleetConfirm,
    openDisconnectFleetConfirm,
    openDeleteDialog,
  } = useConfigurationDetailContext();
  const fleetIdle = !activeWebSockets || activeWebSockets === 0;

  return (
    <Stack
      id="configuration-tab-settings"
      role="tabpanel"
      aria-labelledby="configuration-tab-settings-trigger"
      mt="md"
      gap="md"
    >
      <Card withBorder>
        <Title order={3}>Details</Title>
        <DetailList
          items={[
            {
              label: "ID",
              value: (
                <Text ff="monospace" size="sm">
                  {c.id}
                </Text>
              ),
            },
            { label: "Name", value: <Text size="sm">{c.name}</Text> },
            { label: "Created", value: <Text size="sm">{relTime(c.created_at)}</Text> },
            { label: "Updated", value: <Text size="sm">{relTime(c.updated_at)}</Text> },
          ]}
        />
      </Card>

      <Card withBorder>
        <Title order={3}>Fleet actions</Title>
        <Stack gap="md" mt="sm">
          <Group justify="space-between" wrap="wrap" align="flex-start" gap="md">
            <Stack gap={4} flex="1 1 24rem">
              <Text fw={500}>Restart all collectors</Text>
              <Text size="xs" c="dimmed">
                Sends an OpAMP Restart command to every connected collector that advertises the{" "}
                <Code>AcceptsRestartCommand</Code> capability. Collectors without the capability are
                skipped.
              </Text>
            </Stack>
            <Button variant="default" onClick={openRestartFleetConfirm} disabled={fleetIdle}>
              Restart collectors
            </Button>
          </Group>
          <Group justify="space-between" wrap="wrap" align="flex-start" gap="md">
            <Stack gap={4} flex="1 1 24rem">
              <Text fw={500}>Disconnect all collectors</Text>
              <Text size="xs" c="dimmed">
                Closes the OpAMP WebSocket on every connected collector for this configuration.
                Collectors will reconnect automatically per their backoff policy.
              </Text>
            </Stack>
            <Button variant="default" onClick={openDisconnectFleetConfirm} disabled={fleetIdle}>
              Disconnect collectors
            </Button>
          </Group>
        </Stack>
      </Card>

      <Card withBorder style={{ borderColor: "var(--mantine-color-err-6)" }}>
        <Title order={3} c="red">
          Danger zone
        </Title>
        <Group justify="space-between" mt="sm" wrap="wrap" align="flex-start" gap="md">
          <Stack gap={4} flex="1 1 24rem">
            <Text fw={500}>Delete this configuration</Text>
            <Text size="xs" c="dimmed">
              This will permanently delete the configuration and disconnect all collectors.
            </Text>
          </Stack>
          <Button color="red" onClick={openDeleteDialog}>
            Delete configuration
          </Button>
        </Group>
      </Card>
    </Stack>
  );
}
