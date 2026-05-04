import { Alert, Box, Card, Code, Group, Stack, Text, Title } from "@mantine/core";
import { EmptyState } from "@/components/app";
import { CopyButton } from "@/components/common/CopyButton";
import { hashLabel } from "@/utils/agents";
import { useAgentDetailContext } from "./agent-detail-context";

export default function ConfigTab() {
  const { agent, desiredHash } = useAgentDetailContext();
  const effectiveConfig = agent.effective_config_body as string | null;
  const effectiveHash = agent.effective_config_hash as string | null;

  if (!effectiveConfig) {
    return (
      <Box id="agent-tab-config" role="tabpanel" mt="md">
        <EmptyState
          icon="file"
          title="No effective configuration"
          description="This agent has not reported the configuration it is actually running."
        />
      </Box>
    );
  }

  return (
    <Stack id="agent-tab-config" role="tabpanel" mt="md" gap="md">
      <Card>
        <Group justify="space-between" mb="xs">
          <Title order={3} size="sm" mb="md">
            Effective Configuration
          </Title>
          <Group gap="sm">
            <Text component="span" c="dimmed" size="xs">
              Hash:{" "}
              <Text component="span" ff="monospace" inherit>
                {hashLabel(effectiveHash, 12)}
              </Text>
            </Text>
            <CopyButton value={effectiveConfig} />
          </Group>
        </Group>
        {desiredHash && effectiveHash && desiredHash !== effectiveHash && (
          <Alert color="yellow" variant="light" mb="xs">
            ⚠ Effective config hash differs from desired config hash — agent may have additional
            local configuration.
          </Alert>
        )}
        <Code block style={{ maxHeight: 600, overflowY: "auto" }}>
          {effectiveConfig}
        </Code>
      </Card>
    </Stack>
  );
}
