import { Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import { useConfigurationDetailContext } from "./configuration-detail-context";

export default function RolloutTab() {
  const {
    agentsQuery,
    yamlQuery,
    hasConfigContent,
    rollout,
    runCopilot,
    copilotIsLoading,
    openRolloutConfirm,
  } = useConfigurationDetailContext();

  return (
    <Card
      withBorder
      mt="md"
      id="configuration-tab-rollout"
      role="tabpanel"
      aria-labelledby="configuration-tab-rollout-trigger"
    >
      <Stack gap="sm">
        <Title order={3}>Rollout configuration</Title>
        <Text size="sm" c="dimmed">
          Rollout promotes the current version to desired config for this configuration group.
          Collectors are in sync once their reported current hash matches desired.
        </Text>
        <Group gap="xs">
          <Button
            variant="default"
            onClick={() =>
              void runCopilot(
                "Rollout risk copilot",
                "triage_state",
                "Check rollout risk using the visible rollout state and explicit rollout cohort summary. Do not claim historical regression.",
                "rollout-summary",
              )
            }
            disabled={agentsQuery.isLoading || copilotIsLoading}
          >
            Check rollout risk
          </Button>
          <Button
            onClick={openRolloutConfirm}
            loading={rollout.isPending}
            disabled={
              !hasConfigContent ||
              !yamlQuery.data ||
              yamlQuery.isLoading ||
              Boolean(yamlQuery.error) ||
              rollout.isPending
            }
          >
            Start rollout
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
