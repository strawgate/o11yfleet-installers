import { Button, Card, Code, Group, Stack, Text, Title } from "@mantine/core";
import { CopyButton } from "@/components/common/CopyButton";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { useConfigurationDetailContext } from "./configuration-detail-context";

export default function YamlTab() {
  const { yamlQuery, runCopilot, copilotIsLoading } = useConfigurationDetailContext();
  const yamlReady = Boolean(yamlQuery.data) && !yamlQuery.isLoading && !yamlQuery.error;

  return (
    <Card
      withBorder
      mt="md"
      id="configuration-tab-yaml"
      role="tabpanel"
      aria-labelledby="configuration-tab-yaml-trigger"
    >
      <Group justify="space-between" mb="md" wrap="wrap" align="flex-start">
        <Stack gap={4}>
          <Title order={3}>Desired YAML</Title>
          <Text size="sm" c="dimmed">
            Effective config is what a collector actually runs after local bootstrap and remote
            config behavior; this page currently shows desired YAML from the control plane.
          </Text>
        </Stack>
        <Group gap="xs">
          <Button
            variant="default"
            onClick={() =>
              void runCopilot(
                "YAML explanation copilot",
                "explain_page",
                "Explain the current Collector YAML from parser-backed context. Do not suggest edits unless the safety gate allows it.",
              )
            }
            disabled={!yamlReady || copilotIsLoading}
          >
            Explain YAML
          </Button>
          <Button
            variant="default"
            onClick={() =>
              void runCopilot(
                "Draft safety copilot",
                "draft_config_change",
                "Check whether this YAML is safe for draft config changes. If blocked, explain the deterministic safety gate reason.",
              )
            }
            disabled={!yamlReady || copilotIsLoading}
          >
            Check draft safety
          </Button>
          <CopyButton value={yamlQuery.data ?? ""} label="Copy YAML" />
        </Group>
      </Group>
      {yamlQuery.isLoading ? (
        <LoadingSpinner />
      ) : (
        <Code block>{yamlQuery.data ?? "# No YAML available"}</Code>
      )}
    </Card>
  );
}
