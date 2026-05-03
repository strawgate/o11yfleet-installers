import { Link } from "react-router-dom";
import { Button, Card, Stack, Text, Title } from "@mantine/core";
import { PageHeader, PageShell } from "@/components/app";
import { PrototypeBanner } from "@/components/common/PrototypeBanner";

export default function OnboardingPage() {
  return (
    <PageShell width="narrow">
      <PrototypeBanner message="Onboarding wizard is under development." />

      <PageHeader className="mt-6" title="Onboarding" />

      <Card>
        <Title order={3} size="sm" fw={500}>
          Welcome to o11yfleet
        </Title>
        <Stack gap="xs" mt="xs">
          <Text size="sm" c="dimmed">
            The onboarding wizard will guide you through the core model: workspace, configuration
            group, enrollment token, collector install, and first successful connection.
          </Text>
          <Text size="sm" c="dimmed">
            Your workspace is the isolation boundary. A configuration group is the desired state
            target for collectors. An enrollment token is only the bootstrap secret that places a
            collector into that group.
          </Text>
          <Text size="sm" c="dimmed">
            In the meantime, you can use the getting started guide to set up your first
            configuration and connect a collector.
          </Text>
        </Stack>
        <Button component={Link} to="/portal/getting-started" mt="md">
          Go to getting started
        </Button>
      </Card>
    </PageShell>
  );
}
