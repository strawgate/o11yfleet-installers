import { Badge, Card, Group, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { hashLabel } from "@/utils/agents";
import { relTime } from "@/utils/format";
import {
  ConfigBadge,
  ConnectionBadge,
  HealthBadge,
  StatusBadge,
} from "@/components/common/AgentBadges";
import { DetailList } from "@/components/common/DetailList";
import { useAgentDetailContext } from "./agent-detail-context";
import { formatDuration, tsToIso } from "./utils";

const MONO = { fontFamily: "var(--mantine-font-family-monospace)" } as const;

export default function OverviewTab() {
  const {
    agent,
    identity,
    agentUid,
    healthy,
    isConnected,
    configSync,
    desiredHash,
    currentHash,
    capabilities,
    componentCounts,
    componentInventory,
  } = useAgentDetailContext();

  const componentsValue =
    componentCounts.total > 0 ? (
      <span>
        {componentCounts.total} total
        {componentCounts.healthy > 0 && (
          <Text component="span" c="green" ml={4}>
            ({componentCounts.healthy} ok)
          </Text>
        )}
        {componentCounts.degraded > 0 && (
          <Text component="span" c="yellow" ml={4}>
            ({componentCounts.degraded} degraded)
          </Text>
        )}
      </span>
    ) : (
      "—"
    );

  return (
    <SimpleGrid
      id="agent-tab-overview"
      role="tabpanel"
      cols={{ base: 1, md: 2 }}
      spacing="md"
      mt="md"
    >
      <Card>
        <Title order={3} size="sm" mb="md">
          Identity
        </Title>
        <DetailList
          items={[
            { label: "Instance UID", value: <span style={MONO}>{agentUid}</span> },
            { label: "Hostname", value: identity.hostname ?? "—" },
            {
              label: "Service",
              value: (
                <>
                  {identity.serviceName ?? "—"}
                  {identity.serviceVersion && (
                    <Text component="span" c="dimmed" size="sm" ml={4}>
                      v{identity.serviceVersion}
                    </Text>
                  )}
                </>
              ),
            },
            {
              label: "OS",
              value: (
                <>
                  {identity.osType ?? "—"}
                  {identity.hostArch && (
                    <Text component="span" c="dimmed" size="sm" ml={4}>
                      ({identity.hostArch})
                    </Text>
                  )}
                  {identity.osDescription && (
                    <Text size="xs" c="dimmed" mt={2}>
                      {identity.osDescription}
                    </Text>
                  )}
                </>
              ),
            },
            {
              label: "Connection",
              value: (
                <>
                  <ConnectionBadge connected={isConnected} />
                  {isConnected && agent.uptime_ms !== null && agent.uptime_ms !== undefined && (
                    <Text component="span" c="dimmed" size="sm" ml={8}>
                      uptime {formatDuration(agent.uptime_ms)}
                    </Text>
                  )}
                </>
              ),
            },
            { label: "Generation", value: agent.generation ?? "—" },
            { label: "First connected", value: relTime(tsToIso(agent.connected_at)) },
            { label: "Last seen", value: relTime(tsToIso(agent.last_seen_at)) },
          ]}
        />
      </Card>

      <Card>
        <Title order={3} size="sm" mb="md">
          Health
        </Title>
        <DetailList
          items={[
            { label: "Status", value: <StatusBadge status={agent.status as string} /> },
            { label: "Healthy", value: <HealthBadge healthy={healthy} /> },
            { label: "Components", value: componentsValue },
            {
              label: "Last error",
              value: agent.last_error ? (
                <Text component="span" c="red">
                  {agent.last_error as string}
                </Text>
              ) : (
                "—"
              ),
            },
          ]}
        />
      </Card>

      <Card>
        <Title order={3} size="sm" mb="md">
          Configuration
        </Title>
        <DetailList
          items={[
            { label: "Config sync", value: <ConfigBadge sync={configSync} /> },
            { label: "Desired hash", value: <span style={MONO}>{hashLabel(desiredHash)}</span> },
            { label: "Current hash", value: <span style={MONO}>{hashLabel(currentHash)}</span> },
            {
              label: "Effective config hash",
              value: (
                <span style={MONO}>
                  {hashLabel(agent.effective_config_hash as string | undefined)}
                </span>
              ),
            },
          ]}
        />
      </Card>

      <Card>
        <Title order={3} size="sm" mb="md">
          Capabilities
        </Title>
        {capabilities.length > 0 ? (
          <Group gap="xs" mt="xs">
            {capabilities.map((cap) => (
              <Badge key={cap} variant="default" tt="none">
                {cap}
              </Badge>
            ))}
          </Group>
        ) : (
          <Text size="sm" c="dimmed" mt="xs">
            No capabilities reported
          </Text>
        )}
      </Card>

      <Card>
        <Title order={3} size="sm" mb="md">
          Compiled-in Components
        </Title>
        {componentInventory ? (
          Object.values(componentInventory).some((items) => items.length > 0) ? (
            <Stack gap="xs">
              <ComponentCategory title="Receivers" components={componentInventory.receivers} />
              <ComponentCategory title="Processors" components={componentInventory.processors} />
              <ComponentCategory title="Exporters" components={componentInventory.exporters} />
              <ComponentCategory title="Extensions" components={componentInventory.extensions} />
              <ComponentCategory title="Connectors" components={componentInventory.connectors} />
            </Stack>
          ) : (
            <Text size="sm" c="dimmed">
              Component inventory was reported, but no compiled-in components were listed.
            </Text>
          )
        ) : (
          <Text size="sm" c="dimmed">
            No component inventory reported. The agent may be running an older collector version
            that does not support OpAMP AvailableComponents.
          </Text>
        )}
      </Card>
    </SimpleGrid>
  );
}

function ComponentCategory({ title, components }: { title: string; components: string[] }) {
  if (components.length === 0) return null;
  return (
    <div>
      <Text size="xs" fw={600} c="dimmed" mb="xs">
        {title}
      </Text>
      <Group gap="xs">
        {components.map((name) => (
          <Badge key={name} variant="light" size="sm" tt="none">
            {name}
          </Badge>
        ))}
      </Group>
    </div>
  );
}
