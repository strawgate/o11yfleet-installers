import { Button, Center, Stack, Text } from "@mantine/core";
import { CircleAlert } from "lucide-react";

interface ErrorStateProps {
  error: Error | null;
  retry?: () => void;
}

export function ErrorState({ error, retry }: ErrorStateProps) {
  return (
    <Center py={64} px="md">
      <Stack align="center" gap="md" maw={420}>
        <CircleAlert size={32} color="var(--mantine-color-red-6)" aria-hidden />
        <Text size="sm" fw={500}>
          Something went wrong
        </Text>
        {error ? (
          <Text size="sm" c="dimmed" ta="center">
            {error.message}
          </Text>
        ) : null}
        {retry ? (
          <Button size="xs" variant="default" onClick={retry}>
            Try again
          </Button>
        ) : null}
      </Stack>
    </Center>
  );
}
