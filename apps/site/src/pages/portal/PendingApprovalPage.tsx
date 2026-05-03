import { Anchor, Button, Card, Center, List, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { useLogout } from "@/api/hooks/auth";
import { Logo } from "@/components/common/Logo";

export default function PendingApprovalPage() {
  const logout = useLogout();

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        window.location.href = "/";
      },
    });
  };

  return (
    <Center mih="100vh" p="md">
      <Card maw={480} w="100%" p="xl">
        <Stack align="center" gap="lg">
          <Anchor href="/" underline="never" c="inherit">
            <Logo />
          </Anchor>

          <ThemeIcon
            size={64}
            radius="xl"
            variant="gradient"
            gradient={{ from: "orange", to: "yellow" }}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </ThemeIcon>

          <Stack gap="xs" align="center">
            <Title order={1} size="h2">
              Pending approval
            </Title>
            <Text c="dimmed" ta="center">
              Your workspace is awaiting review. We typically approve new signups within 1-2
              business days.
            </Text>
          </Stack>

          <Card w="100%" bg="dark.6">
            <Title order={4} size="sm" fw={500} mb="xs">
              What happens next?
            </Title>
            <List size="sm" c="dimmed">
              <List.Item>Our team reviews your signup request</List.Item>
              <List.Item>You&apos;ll receive an email when approved</List.Item>
              <List.Item>Once approved, you can access the full portal</List.Item>
            </List>
          </Card>

          <Card w="100%" bg="dark.7">
            <Text size="sm" c="dimmed">
              <Text span fw={500} c="bright">
                Need faster access?
              </Text>
              <br />
              Email us at{" "}
              <Anchor href="mailto:support@o11yfleet.com" size="sm">
                support@o11yfleet.com
              </Anchor>{" "}
              with your GitHub username and we&apos;ll prioritize your request.
            </Text>
          </Card>

          <Stack gap="xs" w="100%">
            <Button
              variant="default"
              onClick={() => handleLogout()}
              disabled={logout.isPending}
              fullWidth
            >
              {logout.isPending ? "Signing out..." : "Sign out"}
            </Button>
            <Button component="a" href="/" variant="subtle" fullWidth>
              Back to home
            </Button>
          </Stack>
        </Stack>
      </Card>
    </Center>
  );
}
