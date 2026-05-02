import { Button, Center, Stack, Text } from "@mantine/core";

export type ErrorStateProps = {
  message: string;
  retry?: () => void;
  height?: number | string;
};

export function ErrorState({ message, retry, height = 240 }: ErrorStateProps) {
  return (
    <Center h={height}>
      <Stack gap={4} align="center" maw={360} style={{ textAlign: "center" }}>
        <Text size="sm" fw={500} c="var(--mantine-color-err-5)">
          Couldn't load data
        </Text>
        <Text size="xs" c="dimmed">
          {message}
        </Text>
        {retry && (
          <Button size="xs" variant="default" onClick={retry}>
            Retry
          </Button>
        )}
      </Stack>
    </Center>
  );
}
